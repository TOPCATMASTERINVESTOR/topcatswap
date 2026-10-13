// ============================================================
// TopCatSwap — ponte para carteiras de navegador
//
// MetaMask, OKX Wallet, Rabby, Coinbase Wallet e Trust Wallet vivem
// como extensões no navegador. A app abre uma página local
// (http://127.0.0.1:PORTA/c/CHAVE/) que fala com a extensão e passa
// os pedidos (contas, rede, enviar transação) entre a app e a carteira.
//
// Segurança:
//   - só escuta em 127.0.0.1 (nunca na rede);
//   - cada arranque gera uma chave aleatória que faz parte do endereço;
//   - recusa pedidos com Host diferente (proteção contra DNS rebinding)
//     e pedidos de outras origens;
//   - a chave privada fica sempre na carteira; a app só recebe hashes.
// ============================================================

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");


// Carteiras suportadas: identificador EIP-6963 (rdns) e marca no window.ethereum.
const BROWSER_WALLETS = {
    metamask: { name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], flag: "isMetaMask" },
    okx: { name: "OKX Wallet", rdns: ["com.okex.wallet"], flag: "isOkxWallet" },
    rabby: { name: "Rabby", rdns: ["io.rabby"], flag: "isRabby" },
    coinbase: { name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], flag: "isCoinbaseWallet" },
    trust: { name: "Trust Wallet", rdns: ["com.trustwallet.app"], flag: "isTrust" }
};

const PREFERRED_PORT = 47615;
const POLL_HOLD_MS = 25000;
const PAGE_ALIVE_MS = 40000;
const PAGE_DIR = path.join(__dirname, "connect");

const STATIC = {
    "": ["connect.html", "text/html; charset=utf-8"],
    "connect.js": ["connect.js", "text/javascript; charset=utf-8"],
    "connect.css": ["connect.css", "text/css; charset=utf-8"],
    "logo.png": [path.join("..", "..", "renderer", "logo-mark.png"), "image/png"]
};


let server = null;
let port = null;
const token = crypto.randomBytes(18).toString("hex");

let walletKey = "metamask";
let chainInfo = null;            // rede que a app está a usar (para pedir a troca)
let onChange = null;

const queue = [];                // pedidos à espera de serem levados pela página
const pending = new Map();       // id -> { resolve, reject, timer }
let waiter = null;               // long-poll da página em espera
let nextId = 1;

const state = {
    lastSeen: 0,
    detected: null,              // nome da carteira encontrada na página
    others: [],
    accounts: [],
    chainId: null,
    connected: false,
    error: null
};


function publicState() {
    const alive = Date.now() - state.lastSeen < PAGE_ALIVE_MS;
    return {
        wallet: walletKey,
        walletName: BROWSER_WALLETS[walletKey].name,
        url: url(),
        pageOpen: alive,
        detected: alive ? state.detected : null,
        others: alive ? state.others : [],
        connected: alive && state.connected && state.accounts.length > 0,
        account: alive && state.accounts[0] ? state.accounts[0] : null,
        accounts: alive ? state.accounts.slice() : [],
        chainId: alive ? state.chainId : null,
        error: alive ? state.error : null
    };
}


function changed() {
    if (onChange) {
        try { onChange(publicState()); } catch (_) {}
    }
}


function url() {
    return port ? "http://127.0.0.1:" + port + "/c/" + token + "/" : null;
}


function send(res, status, body, type) {
    res.writeHead(status, {
        "Content-Type": type || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}


function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > 256 * 1024) { reject(new Error("demasiado grande")); req.destroy(); return; }
            chunks.push(c);
        });
        req.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
            catch (e) { reject(e); }
        });
        req.on("error", reject);
    });
}


function deliver() {
    if (waiter && queue.length > 0) {
        const { res, timer } = waiter;
        waiter = null;
        clearTimeout(timer);
        send(res, 200, { request: queue.shift() });
    }
}


async function handle(req, res) {

    // Só aceita o próprio endereço local (impede DNS rebinding).
    if (req.headers.host !== "127.0.0.1:" + port) {
        return send(res, 403, { error: "host" });
    }

    const prefix = "/c/" + token + "/";
    const u = new URL(req.url, "http://127.0.0.1");

    if (!u.pathname.startsWith(prefix)) {
        return send(res, 404, { error: "não encontrado" });
    }

    const rest = u.pathname.slice(prefix.length);

    // Ficheiros da página.
    if (req.method === "GET" && Object.prototype.hasOwnProperty.call(STATIC, rest)) {
        const [file, type] = STATIC[rest];
        try {
            return send(res, 200, fs.readFileSync(path.join(PAGE_DIR, file)), type);
        } catch (_) {
            return send(res, 404, "");
        }
    }

    if (!rest.startsWith("api/")) {
        return send(res, 404, { error: "não encontrado" });
    }

    // A API só aceita pedidos da própria página.
    const origin = req.headers.origin;
    if (origin && origin !== "http://127.0.0.1:" + port) {
        return send(res, 403, { error: "origem" });
    }

    state.lastSeen = Date.now();

    const api = rest.slice(4);

    if (req.method === "GET" && api === "config") {
        const w = BROWSER_WALLETS[walletKey];
        return send(res, 200, {
            wallet: walletKey,
            name: w.name,
            rdns: w.rdns,
            flag: w.flag,
            all: Object.entries(BROWSER_WALLETS).map(([k, x]) => ({ key: k, name: x.name, rdns: x.rdns, flag: x.flag })),
            chain: chainInfo
        });
    }

    if (req.method === "GET" && api === "poll") {

        if (waiter) {
            clearTimeout(waiter.timer);
            send(waiter.res, 200, { request: null });
            waiter = null;
        }

        if (queue.length > 0) {
            return send(res, 200, { request: queue.shift() });
        }

        const timer = setTimeout(() => {
            if (waiter && waiter.res === res) {
                waiter = null;
                send(res, 200, { request: null });
            }
        }, POLL_HOLD_MS);

        waiter = { res, timer };

        req.on("close", () => {
            if (waiter && waiter.res === res) {
                clearTimeout(timer);
                waiter = null;
            }
        });

        return;
    }

    if (req.method !== "POST" || !/^application\/json/.test(req.headers["content-type"] || "")) {
        return send(res, 405, { error: "método" });
    }

    let body;

    try {
        body = await readJson(req);
    } catch (_) {
        return send(res, 400, { error: "json" });
    }

    if (api === "state") {

        const before = JSON.stringify(publicState());

        state.detected = typeof body.detected === "string" ? body.detected.slice(0, 60) : null;
        state.others = Array.isArray(body.others) ? body.others.filter(x => typeof x === "string").slice(0, 10).map(x => x.slice(0, 60)) : [];
        state.accounts = Array.isArray(body.accounts)
            ? body.accounts.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)).slice(0, 20)
            : [];
        state.chainId = typeof body.chainId === "string" && /^0x[0-9a-fA-F]+$/.test(body.chainId) ? body.chainId.toLowerCase() : null;
        state.connected = !!body.connected;
        state.error = typeof body.error === "string" ? body.error.slice(0, 300) : null;

        if (JSON.stringify(publicState()) !== before) changed();

        return send(res, 200, { ok: true });
    }

    if (api === "reply") {

        const p = pending.get(body.id);

        if (p) {
            pending.delete(body.id);
            clearTimeout(p.timer);
            if (body.error) {
                const e = new Error(String(body.error.message || "Erro da carteira").slice(0, 500));
                e.code = body.error.code;
                p.reject(e);
            } else {
                p.resolve(body.result);
            }
        }

        return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "não encontrado" });
}


function start() {

    if (server) return Promise.resolve(url());

    return new Promise((resolve, reject) => {

        const s = http.createServer((req, res) => {
            handle(req, res).catch(() => {
                try { send(res, 500, { error: "interno" }); } catch (_) {}
            });
        });

        const listen = (p) => s.listen(p, "127.0.0.1");

        s.once("error", (error) => {
            if (error.code === "EADDRINUSE") {
                s.once("error", reject);
                listen(0);
            } else {
                reject(error);
            }
        });

        s.on("listening", () => {
            server = s;
            port = s.address().port;
            resolve(url());
        });

        listen(PREFERRED_PORT);
    });
}


function configure({ wallet, chain }) {

    if (wallet && BROWSER_WALLETS[wallet] && wallet !== walletKey) {
        walletKey = wallet;
        changed();
    }

    if (chain) chainInfo = chain;
}


function setListener(fn) {
    onChange = fn;
}


function explainWalletError(error, name) {

    const code = error && error.code;
    const msg = (error && error.message) || String(error);

    if (code === 4001 || /reject|denied|cancel/i.test(msg)) {
        return "Rejeitaste o pedido na " + name + ". Nada foi enviado.";
    }
    if (code === 4100) {
        return "A " + name + " não autorizou esta conta. Volta a ligar a carteira na página de ligação.";
    }
    if (code === -32002) {
        return "Já há um pedido pendente na " + name + ": abre a extensão e responde-lhe.";
    }

    return name + ": " + msg;
}


// Envia um pedido à carteira (através da página aberta no navegador).
function request(method, params, timeoutMs = 60000) {

    const name = BROWSER_WALLETS[walletKey].name;

    if (Date.now() - state.lastSeen > PAGE_ALIVE_MS) {
        return Promise.reject(new Error(
            "A página de ligação da " + name + " não está aberta. Usa \"Abrir página\" na barra lateral e deixa-a aberta no navegador."
        ));
    }

    return new Promise((resolve, reject) => {

        const id = nextId++;

        const timer = setTimeout(() => {
            pending.delete(id);
            const i = queue.findIndex(q => q.id === id);
            if (i >= 0) queue.splice(i, 1);
            reject(new Error("A " + name + " não respondeu a tempo. Confirma que a página de ligação está aberta e responde na extensão."));
        }, timeoutMs);

        pending.set(id, {
            resolve,
            reject: (error) => {
                const e = new Error(explainWalletError(error, name));
                e.code = error && error.code;
                reject(e);
            },
            timer
        });

        queue.push({ id, method, params: params || [] });

        deliver();
    });
}


// Garante que a carteira está na rede da app (pede a troca ou adiciona-a).
async function ensureChain(chain) {

    const want = "0x" + BigInt(chain.chainId).toString(16);

    const current = String(await request("eth_chainId", [], 20000)).toLowerCase();

    if (current === want) return;

    try {

        await request("wallet_switchEthereumChain", [{ chainId: want }], 120000);

    } catch (error) {

        if (error.code !== 4902 && !/4902|unrecognized|not been added|unknown chain/i.test(error.message)) {
            throw error;
        }

        await request("wallet_addEthereumChain", [{
            chainId: want,
            chainName: chain.name,
            nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
            rpcUrls: [chain.rpc],
            blockExplorerUrls: chain.explorer ? [chain.explorer] : []
        }], 120000);
    }

    const after = String(await request("eth_chainId", [], 20000)).toLowerCase();

    if (after !== want) {
        throw new Error("A carteira continua noutra rede. Muda para " + chain.name + " na extensão e tenta de novo.");
    }
}


async function accounts() {

    const list = await request("eth_accounts", [], 20000);

    return Array.isArray(list) ? list.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)) : [];
}


function signer(chain) {

    const name = BROWSER_WALLETS[walletKey].name;

    return {
        kind: "browser",
        name,
        async sendTransaction(tx) {
            await ensureChain(chain);
            // Até 15 minutos para o utilizador confirmar na extensão.
            return request("eth_sendTransaction", [tx], 15 * 60 * 1000);
        }
    };
}


function stop() {
    if (server) {
        try { server.close(); } catch (_) {}
        server = null;
        port = null;
    }
}


module.exports = {
    BROWSER_WALLETS,
    start,
    stop,
    url,
    configure,
    setListener,
    state: publicState,
    request,
    ensureChain,
    accounts,
    signer
};
