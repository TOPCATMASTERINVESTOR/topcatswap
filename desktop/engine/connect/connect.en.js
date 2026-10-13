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
        $("title").textContent = active.info.name + " connected";
        $("title").className = "ok";
        $("lead").textContent = "Ready. Go back to the topcatswap app: swaps will be confirmed in this wallet.";
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
        $("title").textContent = "Connect " + cfg.name;
        $("lead").textContent = "Click Connect and approve the request in the extension window.";
        btn.hidden = false;
        btn.textContent = "Connect " + best.info.name;
        btn.onclick = () => connect(best);
        return;
    }

    btn.hidden = true;
    $("title").textContent = "Could not find " + cfg.name;
    $("lead").textContent = found.size > 0
        ? "This page is open in a browser without the extension " + cfg.name + ". Install it, or open this page in the browser where you have it (in the app: Copy address). You can also use one of the wallets found:"
        : "There is no wallet extension in this browser. Install " + cfg.name + ", or open this page in the browser where you have it (in the app: Copy address), and reload.";

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
        b.appendChild(document.createTextNode("Use " + d.info.name));
        const s = document.createElement("small");
        s.textContent = "not the one chosen in the app";
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
        log(accounts.length ? "Account changed to " + short(accounts[0]) : "The wallet disconnected this page");
        render();
        postState();
    });
    p.provider.on("chainChanged", (id) => {
        if (active !== p) return;
        chainId = String(id).toLowerCase();
        log("Network changed to " + (CHAIN_NAMES[chainId] || chainId));
        render();
        postState();
    });
}


async function connect(p, silent) {
    try {
        showError(null);
        const list = await p.provider.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
        if (!Array.isArray(list) || list.length === 0) {
            if (!silent) showError("The wallet did not return any account.");
            return;
        }
        if (active !== p) watch(p);
        active = p;
        accounts = list;
        chainId = String(await p.provider.request({ method: "eth_chainId" })).toLowerCase();
        log(p.info.name + " connected · " + short(accounts[0]));
    } catch (error) {
        if (!silent) showError(error && error.code === 4001 ? "Request rejected in the wallet." : (error && error.message) || String(error));
    }
    render();
    postState();
}


async function handle(req) {

    let reply;

    try {

        if (!ALLOWED.has(req.method)) {
            throw Object.assign(new Error("Method not allowed: " + req.method), { code: 4200 });
        }

        if (!active) {
            if (req.method === "eth_accounts") {
                reply = { id: req.id, result: [] };
            } else {
                throw Object.assign(new Error("The wallet is not connected on this page yet. Click Connect."), { code: 4100 });
            }
        } else {
            if (req.method === "eth_sendTransaction") log("Asking for confirmation of a transaction in " + active.info.name + "…");
            if (req.method === "wallet_switchEthereumChain") log("Asking to switch network…");
            const result = await active.provider.request({ method: req.method, params: req.params });
            if (req.method === "eth_sendTransaction") log("Transaction sent · " + short(String(result)));
            if (req.method === "eth_accounts" && Array.isArray(result)) accounts = result;
            if (req.method === "eth_chainId") chainId = String(result).toLowerCase();
            reply = { id: req.id, result };
        }

    } catch (error) {

        if (req.method === "eth_sendTransaction") log(error && error.code === 4001 ? "Transaction rejected in the wallet" : "The wallet returned an error");
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
                showError("No connection to the topcatswap app. Open the app (or open this page again from it).");
            }
            await sleep(3000);
        }
    }
}


async function start() {
    try {
        cfg = await api("config");
    } catch (_) {
        $("title").textContent = "Page expired";
        $("lead").textContent = "The topcatswap app was closed or restarted. Open the connection page again from the app.";
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
