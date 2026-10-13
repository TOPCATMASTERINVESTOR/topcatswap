// ============================================================
// TopCatSwap Web — Ledger por WebHID (Chrome, Edge, Brave, Opera)
//
// Substitui "@ledgerhq/hw-transport-node-hid" e "@ledgerhq/hw-app-eth"
// com a mesma interface que o motor usa:
//   TransportNodeHid.create() / .list()      transport.close()
//   new Eth(transport).getAddress(path)      .signTransaction(path, rawTxHex)
//
// Protocolo: framing HID da Ledger (pacotes de 64 bytes, canal, tag 0x05,
// sequência) e APDUs da app Ethereum (CLA 0xE0: 0x02 endereço, 0x04 assinar).
// A chave privada nunca sai da Ledger: só recebemos endereço e assinatura.
// ============================================================

"use strict";

const LEDGER_VENDOR_ID = 0x2c97;
const PACKET = 64;
const TAG = 0x05;

const L = (pt, en) => (globalThis.TCS_LANG === "en" ? en : pt);


function statusError(sw, fallback) {
    const e = new Error(fallback || ("Ledger: 0x" + sw.toString(16)));
    e.statusCode = sw;
    return e;
}


function hidAvailable() {
    return typeof navigator !== "undefined" && !!navigator.hid;
}


function notSupported() {
    return new Error(L(
        "Este navegador não fala com a Ledger (falta WebHID). Usa Chrome, Edge, Brave ou Opera no computador, num endereço https.",
        "This browser cannot talk to the Ledger (no WebHID). Use Chrome, Edge, Brave or Opera on a computer, on an https address."
    ));
}


async function authorizedDevices() {
    if (!hidAvailable()) return [];
    const list = await navigator.hid.getDevices();
    return list.filter(d => d.vendorId === LEDGER_VENDOR_ID);
}


class TransportWebHID {

    // Mostra a janela do navegador para escolher a Ledger.
    // Tem de ser chamada diretamente a partir de um clique.
    static request() {
        if (!hidAvailable()) return Promise.reject(notSupported());
        return navigator.hid.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] });
    }

    static isSupported() {
        return hidAvailable();
    }

    static async list() {
        return authorizedDevices();
    }

    static async create() {

        if (!hidAvailable()) throw notSupported();

        const devices = await authorizedDevices();

        if (devices.length === 0) {
            throw new Error(L(
                "A Ledger ainda não foi autorizada neste navegador. Carrega em \"Autorizar Ledger\" (barra lateral) e escolhe-a na janela do navegador.",
                "The Ledger has not been authorized in this browser yet. Click \"Authorize Ledger\" (sidebar) and pick it in the browser window."
            ));
        }

        const device = devices[0];

        if (!device.opened) {
            try {
                await device.open();
            } catch (error) {
                throw new Error(L(
                    "Não consegui abrir a Ledger: está a ser usada por outra aplicação ou separador (Ledger Live, outra página)? No Linux confirma também as regras udev. (",
                    "Could not open the Ledger: is it in use by another app or tab (Ledger Live, another page)? On Linux also check the udev rules. ("
                ) + (error && error.message) + ")");
            }
        }

        return new TransportWebHID(device);
    }

    constructor(device) {
        this.device = device;
        this.channel = Math.floor(Math.random() * 0xffff);
        this.inbox = [];
        this.waiting = null;
        this.lock = Promise.resolve();
        this.onReport = (event) => {
            const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
            if (this.waiting) { const w = this.waiting; this.waiting = null; w(data); }
            else this.inbox.push(data);
        };
        device.addEventListener("inputreport", this.onReport);
    }

    nextPacket(timeoutMs) {
        if (this.inbox.length) return Promise.resolve(this.inbox.shift());
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting = null;
                reject(new Error(L("A Ledger não respondeu a tempo.", "The Ledger did not answer in time.")));
            }, timeoutMs);
            this.waiting = (data) => { clearTimeout(timer); resolve(data); };
        });
    }

    async writeFrames(apdu) {

        const data = new Uint8Array(apdu.length + 2);
        data[0] = (apdu.length >> 8) & 0xff;
        data[1] = apdu.length & 0xff;
        data.set(apdu, 2);

        const chunk = PACKET - 5;
        let seq = 0;

        for (let offset = 0; offset < data.length || seq === 0; offset += chunk) {
            const block = new Uint8Array(PACKET);
            block[0] = (this.channel >> 8) & 0xff;
            block[1] = this.channel & 0xff;
            block[2] = TAG;
            block[3] = (seq >> 8) & 0xff;
            block[4] = seq & 0xff;
            block.set(data.slice(offset, offset + chunk), 5);
            await this.device.sendReport(0, block);
            seq++;
        }
    }

    async readResponse(timeoutMs) {

        let expected = null;
        let seq = 0;
        let out = new Uint8Array(0);

        while (expected === null || out.length < expected) {

            const p = await this.nextPacket(timeoutMs);

            const channel = (p[0] << 8) | p[1];
            if (channel !== this.channel || p[2] !== TAG) continue;          // de outro pedido
            const s = (p[3] << 8) | p[4];
            if (s !== seq) throw new Error("Ledger: sequência inválida");

            let body;
            if (seq === 0) {
                expected = (p[5] << 8) | p[6];
                body = p.slice(7);
            } else {
                body = p.slice(5);
            }

            const merged = new Uint8Array(out.length + body.length);
            merged.set(out, 0);
            merged.set(body, out.length);
            out = merged;
            seq++;
        }

        return out.slice(0, expected);
    }

    // Envia um APDU e devolve a resposta (sem o status word). Lança com statusCode.
    exchange(apdu, timeoutMs = 120000) {

        const run = async () => {
            this.inbox = [];
            await this.writeFrames(apdu);
            const res = await this.readResponse(timeoutMs);
            if (res.length < 2) throw new Error("Ledger: resposta vazia");
            const sw = (res[res.length - 2] << 8) | res[res.length - 1];
            if (sw !== 0x9000) throw statusError(sw);
            return res.slice(0, res.length - 2);
        };

        const p = this.lock.then(run, run);
        this.lock = p.catch(() => {});
        return p;
    }

    async close() {
        try { this.device.removeEventListener("inputreport", this.onReport); } catch (_) {}
        try { if (this.device.opened) await this.device.close(); } catch (_) {}
    }
}


// ---- App Ethereum ---------------------------------------------------------

function splitPath(path) {
    return String(path).replace(/^m\//, "").split("/").filter(Boolean).map(part => {
        const hardened = /['hH]$/.test(part);
        const n = parseInt(part, 10);
        if (!Number.isInteger(n) || n < 0) throw new Error("Caminho inválido / invalid path: " + path);
        return hardened ? (n + 0x80000000) >>> 0 : n >>> 0;
    });
}

function pathBytes(path) {
    const parts = splitPath(path);
    const out = new Uint8Array(1 + parts.length * 4);
    out[0] = parts.length;
    parts.forEach((v, i) => {
        out[1 + i * 4] = (v >>> 24) & 0xff;
        out[2 + i * 4] = (v >>> 16) & 0xff;
        out[3 + i * 4] = (v >>> 8) & 0xff;
        out[4 + i * 4] = v & 0xff;
    });
    return out;
}

function apdu(ins, p1, p2, data) {
    const out = new Uint8Array(5 + data.length);
    out[0] = 0xe0; out[1] = ins; out[2] = p1; out[3] = p2; out[4] = data.length;
    out.set(data, 5);
    return out;
}

function hexToBytes(hex) {
    const h = String(hex).replace(/^0x/, "");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
}

function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}


class Eth {

    constructor(transport) {
        this.transport = transport;
        this.loadConfig = {};
    }

    async getAddress(path, display) {
        const res = await this.transport.exchange(apdu(0x02, display ? 0x01 : 0x00, 0x00, pathBytes(path)));
        const pkLen = res[0];
        const addrLen = res[1 + pkLen];
        const address = new TextDecoder().decode(res.slice(2 + pkLen, 2 + pkLen + addrLen));
        return { publicKey: bytesToHex(res.slice(1, 1 + pkLen)), address: "0x" + address };
    }

    // rawTxHex: transação sem assinatura (EIP-1559: 02 || rlp), sem "0x".
    async signTransaction(path, rawTxHex) {

        const raw = hexToBytes(rawTxHex);
        const pb = pathBytes(path);

        let offset = 0;
        let response = null;

        while (offset !== raw.length) {
            const first = offset === 0;
            const max = first ? 150 - pb.length : 150;
            const size = Math.min(max, raw.length - offset);
            const part = raw.slice(offset, offset + size);
            const data = first ? new Uint8Array(pb.length + part.length) : part;
            if (first) { data.set(pb, 0); data.set(part, pb.length); }
            response = await this.transport.exchange(apdu(0x04, first ? 0x00 : 0x80, 0x00, data), 10 * 60 * 1000);
            offset += size;
        }

        return {
            v: bytesToHex(response.slice(0, 1)),
            r: bytesToHex(response.slice(1, 33)),
            s: bytesToHex(response.slice(33, 65))
        };
    }
}


module.exports = { TransportWebHID, Eth, splitPath, LEDGER_VENDOR_ID };
