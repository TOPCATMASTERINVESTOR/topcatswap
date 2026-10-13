"use strict";

// ============================================================
// topcatswap — página de ligação à carteira do navegador
//
// Encontra a extensão (EIP-6963, com window.ethereum como reserva),
// liga a conta e passa os pedidos da app à carteira. Só aceita uma
// lista fechada de métodos.
// ============================================================

const ALLOWED = new Set([
    "eth_accounts",
    "eth_requestAccounts",
    "eth_chainId",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "eth_sendTransaction"
]);

const CHAIN_NAMES = { "0x1": "Ethereum", "0xa4b1": "Arbitrum One", "0x38": "BNB Smart Chain" };

const $ = (id) => document.getElementById(id);

const found = new Map();      // rdns/uuid -> { info, provider }

let cfg = null;
let active = null;            // { info, provider }
let accounts = [];
let chainId = null;
let lastError = null;
let lost = false;


window.addEventListener("eip6963:announceProvider", (event) => {
    const d = event.detail;
    if (d && d.info && d.provider) {
        found.set(d.info.rdns || d.info.uuid, d);
        if (cfg && !active) render();
    }
});


function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function api(path, body) {
    const r = await fetch("api/" + path, body === undefined
        ? { cache: "no-store" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
}

function short(a) {
    return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
}

function log(text) {
    const li = document.createElement("li");
    li.textContent = new Date().toLocaleTimeString() + " · " + text;
    const list = $("log");
    list.prepend(li);
    while (list.children.length > 8) list.lastChild.remove();
}

function showError(text) {
    lastError = text || null;
    $("error").hidden = !text;
    $("error").textContent = text || "";
}


// Reserva para extensões antigas sem EIP-6963.
function legacyProvider() {
    const eth = window.ethereum;
    if (!eth) return null;
    const list = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
    const want = list.find(p => p && p[cfg.flag] && (cfg.wallet !== "metamask" || (!p.isRabby && !p.isOkxWallet && !p.isTrust && !p.isCoinbaseWallet)));
    if (!want) return null;
    return { info: { name: cfg.name, rdns: "legacy", icon: "" }, provider: want };
}

function preferred() {
    for (const r of cfg.rdns) {
        if (found.has(r)) return found.get(r);
    }
    return legacyProvider();
}


async function postState() {
    try {
        await api("state", {
            detected: active ? active.info.name : (preferred() ? preferred().info.name : null),
            others: [...found.values()].map(d => d.info.name),
            accounts,
            chainId,
            connected: !!active && accounts.length > 0,
            error: lastError
        });
    } catch (_) {}
}


function render() {

    const choices = $("choices");
    const btn = $("connect");
    choices.innerHTML = "";

    if (active && accounts.length > 0) {
        $("title").textContent = active.info.name + " ligada";
        $("title").className = "ok";
        $("lead").textContent = "Pronto. Volta à app topcatswap: os swaps vão ser confirmados nesta carteira.";
        btn.hidden = true;
        $("status").hidden = false;
        $("s-wallet").textContent = active.info.name;
        $("s-account").textContent = accounts[0];
        $("s-chain").textContent = CHAIN_NAMES[chainId] || chainId || "—";
        return;
    }

    $("title").className = "";
    $("status").hidden = true;

    const best = preferred();

    if (best) {
        $("title").textContent = "Ligar a " + cfg.name;
        $("lead").textContent = "Carrega em Ligar e aprova o pedido na janela da extensão.";
        btn.hidden = false;
        btn.textContent = "Ligar " + best.info.name;
        btn.onclick = () => connect(best);
        return;
    }

    btn.hidden = true;
    $("title").textContent = "Não encontrei a " + cfg.name;
    $("lead").textContent = found.size > 0
        ? "Esta página está aberta num navegador sem a extensão " + cfg.name + ". Instala-a, ou abre esta página no navegador onde a tens (na app: Copiar endereço). Também podes usar uma das carteiras encontradas:"
        : "Não há nenhuma extensão de carteira neste navegador. Instala a " + cfg.name + ", ou abre esta página no navegador onde a tens (na app: Copiar endereço), e recarrega.";

    for (const d of found.values()) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn choice";
        if (d.info.icon && /^data:image\//.test(d.info.icon)) {
            const img = document.createElement("img");
            img.src = d.info.icon;
            img.alt = "";
            b.appendChild(img);
        }
        b.appendChild(document.createTextNode("Usar " + d.info.name));
        const s = document.createElement("small");
        s.textContent = "não é a escolhida na app";
        b.appendChild(s);
        b.onclick = () => connect(d);
        choices.appendChild(b);
    }
}


function watch(p) {
    if (!p.provider.on) return;
    p.provider.on("accountsChanged", (list) => {
        if (active !== p) return;
        accounts = Array.isArray(list) ? list : [];
        log(accounts.length ? "Conta mudou para " + short(accounts[0]) : "Carteira desligou esta página");
        render();
        postState();
    });
    p.provider.on("chainChanged", (id) => {
        if (active !== p) return;
        chainId = String(id).toLowerCase();
        log("Rede mudou para " + (CHAIN_NAMES[chainId] || chainId));
        render();
        postState();
    });
}


async function connect(p, silent) {
    try {
        showError(null);
        const list = await p.provider.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
        if (!Array.isArray(list) || list.length === 0) {
            if (!silent) showError("A carteira não devolveu nenhuma conta.");
            return;
        }
        if (active !== p) watch(p);
        active = p;
        accounts = list;
        chainId = String(await p.provider.request({ method: "eth_chainId" })).toLowerCase();
        log(p.info.name + " ligada · " + short(accounts[0]));
    } catch (error) {
        if (!silent) showError(error && error.code === 4001 ? "Pedido rejeitado na carteira." : (error && error.message) || String(error));
    }
    render();
    postState();
}


async function handle(req) {

    let reply;

    try {

        if (!ALLOWED.has(req.method)) {
            throw Object.assign(new Error("Método não permitido: " + req.method), { code: 4200 });
        }

        if (!active) {
            if (req.method === "eth_accounts") {
                reply = { id: req.id, result: [] };
            } else {
                throw Object.assign(new Error("A carteira ainda não está ligada nesta página. Carrega em Ligar."), { code: 4100 });
            }
        } else {
            if (req.method === "eth_sendTransaction") log("A pedir confirmação de uma transação na " + active.info.name + "…");
            if (req.method === "wallet_switchEthereumChain") log("A pedir a troca de rede…");
            const result = await active.provider.request({ method: req.method, params: req.params });
            if (req.method === "eth_sendTransaction") log("Transação enviada · " + short(String(result)));
            if (req.method === "eth_accounts" && Array.isArray(result)) accounts = result;
            if (req.method === "eth_chainId") chainId = String(result).toLowerCase();
            reply = { id: req.id, result };
        }

    } catch (error) {

        if (req.method === "eth_sendTransaction") log(error && error.code === 4001 ? "Transação rejeitada na carteira" : "A carteira devolveu um erro");
        reply = { id: req.id, error: { code: error && error.code, message: (error && error.message) || String(error) } };
    }

    try { await api("reply", reply); } catch (_) {}

    if (req.method !== "eth_chainId" && req.method !== "eth_accounts") {
        render();
        postState();
    }
}


async function pollLoop() {
    while (true) {
        try {
            const r = await api("poll");
            if (lost) {
                lost = false;
                showError(null);
                postState();
            }
            if (r.request) handle(r.request);
        } catch (_) {
            if (!lost) {
                lost = true;
                showError("Sem ligação à app topcatswap. Abre a app (ou volta a abrir esta página a partir dela).");
            }
            await sleep(3000);
        }
    }
}


async function start() {
    try {
        cfg = await api("config");
    } catch (_) {
        $("title").textContent = "Página expirada";
        $("lead").textContent = "A app topcatswap foi fechada ou reiniciada. Abre de novo a página de ligação a partir da app.";
        return;
    }

    document.title = "topcatswap · " + cfg.name;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await sleep(700);

    render();

    const best = preferred();
    if (best) await connect(best, true);   // sem janela: só se já estiver autorizada

    postState();
    pollLoop();
}

start();
