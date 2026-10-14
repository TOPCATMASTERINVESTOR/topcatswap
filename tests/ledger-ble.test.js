// Ledger por Bluetooth (Web Bluetooth) com um dispositivo simulado:
//   NODE_PATH=.ci/node_modules node tests/ledger-ble.test.js
"use strict";
const assert = require("assert");
const { ethers } = require("ethers");
const wallet = new ethers.Wallet("0x" + "22".repeat(32));
const MTU = 153;

function fakeBle() {
    let notifyListener = null, frames = [], txBuf = [], mtuAsked = false, maxFrame = 0;
    const notify = {
        startNotifications: async () => notify,
        addEventListener: (_, f) => { notifyListener = f; }
    };
    const send = (bytes) => setTimeout(() => notifyListener({ target: { value: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) } }), 1);
    function reply(resp) {
        for (let off = 0, seq = 0; off < resp.length || seq === 0; seq++) {
            const head = seq === 0 ? 5 : 3, size = Math.min(MTU - head, resp.length - off);
            const f = Buffer.alloc(head + size);
            f[0] = 5; f.writeUInt16BE(seq, 1); if (seq === 0) f.writeUInt16BE(resp.length, 3);
            resp.copy(f, head, off, off + size); off += size; send(f);
        }
    }
    function apdu(a) {
        const ins = a[1], p1 = a[2], data = a.slice(5, 5 + a[4]);
        if (ins === 0x02) {
            const pub = Buffer.from(wallet.signingKey.publicKey.slice(2), "hex"), addr = Buffer.from(wallet.address.slice(2), "ascii");
            return Buffer.concat([Buffer.from([pub.length]), pub, Buffer.from([addr.length]), addr, Buffer.from([0x90, 0])]);
        }
        if (p1 === 0) { const n = data[0]; txBuf = [data.slice(1 + n * 4)]; } else txBuf.push(data);
        const sig = wallet.signingKey.sign(ethers.keccak256(Buffer.concat(txBuf)));
        return Buffer.concat([Buffer.from([sig.yParity]), Buffer.from(sig.r.slice(2), "hex"), Buffer.from(sig.s.slice(2), "hex"), Buffer.from([0x90, 0])]);
    }
    const write = {
        writeValueWithResponse: async (bytes) => {
            const b = Buffer.from(bytes);
            maxFrame = Math.max(maxFrame, b.length);
            if (b[0] === 0x08) { mtuAsked = true; send(Buffer.from([0x08, 0, 0, 0, 0, MTU])); return; }
            assert.equal(b[0], 0x05);
            assert.ok(b.length <= (mtuAsked ? MTU : 20), "frame maior do que o MTU");
            const seq = b.readUInt16BE(1);
            assert.equal(seq, frames.length);
            frames.push(b);
            const total = frames[0].readUInt16BE(3);
            const data = Buffer.concat(frames.map((f, i) => f.slice(i === 0 ? 5 : 3)));
            if (data.length >= total) { frames = []; reply(apdu(data.slice(0, total))); }
        }
    };
    const service = { getCharacteristic: async (u) => u.endsWith("0002-4c6564676572") ? write : notify };
    const device = {
        name: "Nano X 1A2B",
        addEventListener() {},
        gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryService: async (u) => { if (!u.includes("-0004-")) throw new Error("no"); return service; } }; } }
    };
    device.maxFrame = () => maxFrame;
    return device;
}

(async () => {
    const dev = fakeBle();
    Object.defineProperty(globalThis, "navigator", { value: { bluetooth: { requestDevice: async () => dev } }, configurable: true });
    const { LedgerTransport, Eth } = require("../web-src/ledger-webhid.js");
    LedgerTransport.mode = "ble";
    await LedgerTransport.request();
    assert.equal((await LedgerTransport.list()).length, 1);
    const t = await LedgerTransport.create();
    assert.equal(t.mtu, MTU);
    const eth = new Eth(t);
    assert.equal(ethers.getAddress((await eth.getAddress("44'/60'/0'/0/0")).address), wallet.address);
    const tx = ethers.Transaction.from({ type: 2, chainId: 1, nonce: 1, to: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", data: "0x3593564c" + "cd".repeat(900), gasLimit: 300000n, maxFeePerGas: 3n * 10n ** 10n, maxPriorityFeePerGas: 10n ** 9n });
    const s = await eth.signTransaction("44'/60'/0'/0/0", tx.unsignedSerialized.slice(2));
    tx.signature = ethers.Signature.from({ r: "0x" + s.r, s: "0x" + s.s, v: 27 + parseInt(s.v, 16) });
    assert.equal(tx.from, wallet.address);
    assert.ok(dev.maxFrame() > 20 && dev.maxFrame() <= MTU);
    console.log("ledger-ble: MTU " + t.mtu + ", endereço e assinatura OK");
})().catch(e => { console.error("FALHOU", e); process.exit(1); });
