// ============================================================
// TopCatSwap — bundles (Ethereum e BSC)
//
// Um bundle é uma lista de transações assinadas que um builder
// inclui num bloco TODAS juntas e pela ordem dada, ou nenhuma.
// Vantagens:
//   - tudo ou nada: approve + swap (ou vários swaps) no mesmo bloco;
//   - não pagas gas se falhar (o builder não inclui bundles que revertem);
//   - privado: as transações não passam pelo mempool público
//     (sem sandwich nem frontrun);
//   - várias carteiras ou vários swaps no mesmo bloco.
//
// Envio para vários builders ao mesmo tempo, durante N blocos.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");


// Builders por rede (chainId).
const BUILDERS = {
    "1": [
        { key: "flashbots", name: "Flashbots", url: "https://relay.flashbots.net", sign: true, simulate: true },
        { key: "buildernet", name: "BuilderNet", url: "https://rpc.buildernet.org", sign: true },
        { key: "titan", name: "Titan", url: "https://rpc.titanbuilder.xyz" },
        { key: "beaver", name: "beaverbuild", url: "https://rpc.beaverbuild.org" }
    ],
    "56": [
        { key: "48club", name: "48 Club", url: "https://puissant-builder.48.club/", bsc: true },
        { key: "blockrazor", name: "BlockRazor", url: "https://bsc.blockrazor.xyz", bsc: true, method: "eth_sendMevBundle" }
    ]
};

// Blocos durante os quais o bundle fica válido (por omissão) e tempo de bloco aproximado.
const DEFAULT_BLOCKS = { "1": 10, "56": 40 };
const BLOCK_SECONDS = { "1": 12, "56": 1 };
const MAX_BLOCKS = { "1": 50, "56": 200 };

const PERMIT2_LOCKDOWN_ABI = ["function lockdown((address token, address spender)[] approvals)"];
const permit2Lockdown = new ethers.Interface(PERMIT2_LOCKDOWN_ABI);


let authFile = null;
let authWallet = null;

function setDir(dir) {
    authFile = path.join(dir, "bundle-signer.json");
}

// Chave aleatória só para assinar os pedidos à Flashbots/BuilderNet
// (identidade e reputação). Não guarda fundos.
function authSigner() {

    if (authWallet) return authWallet;

    try {
        const saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
        authWallet = new ethers.Wallet(saved.key);
    } catch (_) {
        authWallet = ethers.Wallet.createRandom();
        try {
            fs.mkdirSync(path.dirname(authFile), { recursive: true });
            fs.writeFileSync(authFile, JSON.stringify({ key: authWallet.privateKey, note: "Only for signing requests to the builders. Do not send funds here." }), { mode: 0o600 });
        } catch (_) {}
    }

    return authWallet;
}


function supported(chainId) {
    return !!BUILDERS[String(chainId)];
}

function builders(chainId) {
    return (BUILDERS[String(chainId)] || []).map(b => ({ key: b.key, name: b.name }));
}


async function post(builder, method, params, timeoutMs = 8000) {

    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const headers = { "Content-Type": "application/json" };

    if (builder.sign) {
        const w = authSigner();
        headers["X-Flashbots-Signature"] = w.address + ":" + await w.signMessage(ethers.id(body));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {

        const res = await fetch(builder.url, { method: "POST", headers, body, signal: ctrl.signal });
        const text = await res.text();

        let json;
        try { json = JSON.parse(text); } catch (_) { throw new Error("HTTP " + res.status + ": " + text.slice(0, 120)); }

        const err = json.error || json.jsonerror;
        if (err) throw new Error(err.message || JSON.stringify(err));

        return json.result;

    } catch (error) {

        if (error.name === "AbortError") throw new Error("no response in " + Math.round(timeoutMs / 1000) + " s");
        throw error;

    } finally {

        clearTimeout(timer);
    }
}


// Lê o erro JSON-RPC verdadeiro que o ethers embrulha. Quando o ethers não
// reconhece a resposta do nó, a mensagem curta é só "could not coalesce
// error" e o código/mensagem reais ficam em error.error (ou error.info).
function rpcError(error) {
    const inner = (error && (error.error || (error.info && error.info.error))) || null;
    const code = inner && inner.code !== undefined ? inner.code : (error && error.code);
    const message = String((inner && inner.message) || (error && (error.shortMessage || error.message)) || error);
    const data = inner && inner.data !== undefined ? inner.data : null;
    return { code, message, data };
}


// Simulação sem assinaturas (antes de assinar): eth_simulateV1 executa as
// chamadas em sequência, cada uma vendo o estado deixado pela anterior.
// Devolve [{ ok, gasUsed, error }] ou null se o RPC não a puder fazer
// (nesse caso info.reason explica porquê; o builder simula na mesma).
async function simulateCalls(provider, calls, info) {

    // Teto de gas por chamada: a soma tem de caber num bloco, senão o nó
    // recusa a simulação inteira (erro -38015 / "block gas limit").
    const perCall = BigInt(Math.max(500000, Math.min(3000000, Math.floor(25000000 / Math.max(1, calls.length)))));

    const payload = calls.map(c => ({
        from: c.from,
        to: c.to,
        data: c.data,
        value: ethers.toQuantity(c.value ?? 0n),
        gas: ethers.toQuantity(c.gas || perCall)
    }));

    let result;

    try {

        if (!provider || typeof provider.send !== "function") throw new Error("RPC has no send method");

        result = await provider.send("eth_simulateV1", [{ blockStateCalls: [{ calls: payload }], validation: false }, "latest"]);

    } catch (error) {

        const e = rpcError(error);

        // Um revert devolvido como erro de topo (alguns nós fazem isto):
        // é uma falha real da sequência, não falta de suporte.
        if (e.code === 3 || /execution reverted|revert/i.test(e.message)) {
            throw new Error("Simulation: " + e.message.slice(0, 200));
        }

        // Tudo o resto (método inexistente ou bloqueado no RPC público,
        // parâmetros num formato que o nó não aceita, limites do nó,
        // resposta que o ethers não consegue interpretar…): sem simulação
        // prévia. Não é perigoso: um bundle que falhe não entra e não paga gas.
        if (info) info.reason = (e.code !== undefined && e.code !== null ? "[" + e.code + "] " : "") + e.message.slice(0, 160);
        return null;
    }

    const block = Array.isArray(result) ? result[0] : null;

    if (!block || !Array.isArray(block.calls) || block.calls.length !== calls.length) {
        if (info) info.reason = "unexpected RPC response";
        return null;
    }

    return block.calls.map(r => ({
        ok: r.status === "0x1" || r.status === 1,
        gasUsed: r.gasUsed ? BigInt(r.gasUsed) : 0n,
        error: r.error ? (r.error.message || JSON.stringify(r.error)) : (r.status === "0x1" || r.status === 1 ? null : "revert")
    }));
}


// Simulação final com as transações já assinadas (só Flashbots, Ethereum).
async function callBundle(chainId, rawTxs, blockNumber) {

    const fb = (BUILDERS[String(chainId)] || []).find(b => b.simulate);
    if (!fb) return null;

    const r = await post(fb, "eth_callBundle", [{
        txs: rawTxs,
        blockNumber: ethers.toQuantity(blockNumber),
        stateBlockNumber: "latest"
    }], 12000);

    const bad = (r && r.results || []).find(x => x.error || x.revert);
    return { ok: !bad, error: bad ? (bad.revert || bad.error) : null, raw: r };
}


// Envia o bundle a todos os builders escolhidos.
// Ethereum: um pedido por bloco-alvo (current+1 … current+blocks).
// BSC: um pedido com maxBlockNumber.
async function send(chainId, rawTxs, { fromBlock, blocks, builderKeys, revertingTxHashes = [] }) {

    const list = (BUILDERS[String(chainId)] || []).filter(b => !builderKeys || builderKeys.includes(b.key));
    const results = [];

    await Promise.all(list.map(async (b) => {

        const res = { builder: b.name, ok: false, accepted: 0, error: null };

        try {

            if (b.bsc) {

                const bundle = { txs: rawTxs, maxBlockNumber: fromBlock + blocks };
                if (revertingTxHashes.length) bundle.revertingTxHashes = revertingTxHashes;

                await post(b, b.method || "eth_sendBundle", [bundle]);
                res.accepted = 1;

            } else {

                const targets = [];
                for (let n = 1; n <= blocks; n++) targets.push(fromBlock + n);

                const outcomes = await Promise.allSettled(targets.map(block => post(b, "eth_sendBundle", [Object.assign(
                    { txs: rawTxs, blockNumber: ethers.toQuantity(block) },
                    revertingTxHashes.length ? { revertingTxHashes } : {}
                )])));

                res.accepted = outcomes.filter(o => o.status === "fulfilled").length;
                const firstErr = outcomes.find(o => o.status === "rejected");
                if (!res.accepted && firstErr) throw firstErr.reason;
            }

            res.ok = res.accepted > 0;

        } catch (error) {

            res.error = String(error && error.message || error).slice(0, 160);
        }

        results.push(res);
    }));

    return results;
}


// Espera que as transações apareçam num bloco até ao último bloco-alvo.
async function waitInclusion(provider, hashes, lastBlock, onTick, isCancelled) {

    while (true) {

        if (isCancelled && isCancelled()) return { included: false, cancelled: true };

        const receipts = await Promise.all(hashes.map(h => provider.getTransactionReceipt(h)));

        if (receipts.every(Boolean)) return { included: true, receipts };

        const current = await provider.getBlockNumber();

        if (onTick) onTick(current, lastBlock, receipts.filter(Boolean).length);

        if (current > lastBlock + 1 && !receipts.some(Boolean)) {
            return { included: false, lastSeen: current };
        }

        if (current > lastBlock + 3) {
            return { included: false, partial: true, receipts, lastSeen: current };
        }

        await new Promise(r => setTimeout(r, 2500));
    }
}


module.exports = {
    BUILDERS,
    DEFAULT_BLOCKS,
    BLOCK_SECONDS,
    MAX_BLOCKS,
    permit2Lockdown,
    setDir,
    supported,
    builders,
    simulateCalls,
    rpcError,
    callBundle,
    send,
    waitInclusion,
    authSigner
};
