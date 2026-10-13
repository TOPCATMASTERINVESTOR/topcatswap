// Teste do protocolo Ledger/WebHID com um dispositivo simulado (sem hardware):
//   node tests/ledger-webhid.test.js   (precisa do ethers: NODE_PATH ou npm i ethers)
"use strict";
const assert = require("assert");
const { ethers } = require("ethers");
const wallet = new ethers.Wallet("0x" + "11".repeat(32));

// Dispositivo falso: remonta os pacotes HID, responde como a app Ethereum.
function fakeDevice() {
    const listeners = [];
    let frames = [], txBuf = [], lastPath = null;
    const dev = {
        vendorId: 0x2c97, opened: false,
        async open() { this.opened = true; }, async close() { this.opened = false; },
        addEventListener(_, f) { listeners.push(f); }, removeEventListener() {},
        async sendReport(id, block) {
            assert.equal(id, 0); assert.equal(block.length, 64); assert.equal(block[2], 0x05);
            const seq = (block[3] << 8) | block[4];
            assert.equal(seq, frames.length);
            frames.push(block);
            const first = frames[0]; const len = (first[5] << 8) | first[6];
            const data = Buffer.concat(frames.map((f, i) => Buffer.from(i === 0 ? f.slice(7) : f.slice(5)))).slice(0, len);
            if (data.length < len) return;
            const channel = [first[0], first[1]];
            frames = [];
            reply(channel, handleApdu(data));
        }
    };
    function handleApdu(apdu) {
        assert.equal(apdu[0], 0xe0);
        const ins = apdu[1], p1 = apdu[2], lc = apdu[4], data = apdu.slice(5, 5 + lc);
        if (ins === 0x02) {
            const pub = Buffer.from(wallet.signingKey.publicKey.slice(2), "hex");
            const addr = Buffer.from(wallet.address.slice(2), "ascii");
            return Buffer.concat([Buffer.from([pub.length]), pub, Buffer.from([addr.length]), addr, Buffer.from([0x90, 0x00])]);
        }
        if (ins === 0x04) {
            let body = data;
            if (p1 === 0x00) { const n = data[0]; lastPath = []; for (let i = 0; i < n; i++) lastPath.push(data.readUInt32BE(1 + i * 4)); body = data.slice(1 + n * 4); txBuf = []; }
            txBuf.push(body);
            const raw = Buffer.concat(txBuf);
            const sig = wallet.signingKey.sign(ethers.keccak256(raw));
            return Buffer.concat([Buffer.from([sig.yParity]), Buffer.from(sig.r.slice(2), "hex"), Buffer.from(sig.s.slice(2), "hex"), Buffer.from([0x90, 0x00])]);
        }
        return Buffer.from([0x6d, 0x00]);
    }
    function reply(channel, resp) {
        const data = Buffer.concat([Buffer.from([resp.length >> 8, resp.length & 0xff]), resp]);
        for (let off = 0, seq = 0; off < data.length; off += 59, seq++) {
            const block = Buffer.alloc(64);
            block[0] = channel[0]; block[1] = channel[1]; block[2] = 5; block[3] = seq >> 8; block[4] = seq & 0xff;
            data.copy(block, 5, off, off + 59);
            const dv = new DataView(block.buffer, block.byteOffset, 64);
            setTimeout(() => listeners.forEach(f => f({ data: dv })), 1);
        }
    }
    dev.getPath = () => lastPath;
    return dev;
}

(async () => {
    const dev = fakeDevice();
    Object.defineProperty(globalThis, "navigator", { value: { hid: { getDevices: async () => [dev], requestDevice: async () => [dev] } }, configurable: true });
    const { TransportWebHID, Eth } = require("../web-src/ledger-webhid.js");

    const t = await TransportWebHID.create();
    const eth = new Eth(t);
    const { address } = await eth.getAddress("44'/60'/0'/0/0", false);
    assert.equal(ethers.getAddress(address), wallet.address);

    // Transação longa (dados de swap com ~1 KB): obriga a vários pedaços.
    const tx = ethers.Transaction.from({ type: 2, chainId: 1, nonce: 7, to: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
        data: "0x3593564c" + "ab".repeat(1000), value: 0n, gasLimit: 300000n, maxFeePerGas: 30n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n });
    const s = await eth.signTransaction("44'/60'/0'/0/0", tx.unsignedSerialized.slice(2));
    assert.deepEqual(dev.getPath(), [0x8000002c, 0x8000003c, 0x80000000, 0, 0]);
    tx.signature = ethers.Signature.from({ r: "0x" + s.r, s: "0x" + s.s, v: 27 + parseInt(s.v, 16) });
    assert.equal(tx.from, wallet.address);
    await t.close();
    console.log("ledger-webhid: endereço e assinatura (" + tx.unsignedSerialized.length / 2 + " bytes, vários pedaços) OK");
})().catch(e => { console.error("FALHOU", e); process.exit(1); });
