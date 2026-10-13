// ============================================================
// TopCatSwap Web — substitui o processo principal do Electron
//
// Implementa no navegador o mesmo window.api que a app de secretária
// expõe à interface (desktop/preload.js + desktop/main.js). Tudo corre
// nesta página: não há servidor do TopCatSwap. As definições e as
// carteiras importadas (cifradas) ficam no localStorage deste site.
// ============================================================

"use strict";

const LANG = globalThis.TCS_LANG === "en" ? "en" : "pt";
const L = (pt, en) => (LANG === "en" ? en : pt);

const CONFIG = globalThis.TCS_CONFIG || {};
const VERSION = CONFIG.version || "web";

const SETTINGS_KEY = "tcs-settings";


// ============================================================
// DEFINIÇÕES (iguais às da app de secretária + relay)
// ============================================================

const DEFAULT_SETTINGS = {
    chain: 1,
    slippage: "0.5",
    fee: 1,
    protect: true,
    protectProvider: { "1": "mevblocker", "3": "merkle" },
    versions: ["V2", "V3", "V4"],
    rpc: { "1": "", "2": "", "3": "" },
    graphKey: "",
    ledger: { mode: "index", index: 0, from: "", path: "44'/60'/0'/0/0" },
    lastAddress: "",
    deadlineMinutes: 3,
    wallet: "metamask",
    localAddress: "",
    trezor: { index: 0 },
    lastAddresses: {},
    language: "",
    // Só na versão web: relay para os builders dos bundles (e reserva para
    // serviços sem CORS). Vazio = o relay predefinido em config.js (se houver).
    relay: ""
};

const WALLET_KEYS = ["ledger", "trezor", "metamask", "okx", "rabby", "coinbase", "trust", "local"];


function sanitizeSettings(input) {

    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const src = input && typeof input === "object" ? input : {};

    if ([1, 2, 3].includes(Number(src.chain))) s.chain = Number(src.chain);
    if (src.slippage !== undefined) s.slippage = String(src.slippage).replace(",", ".").trim() || s.slippage;
    if ([1, 2, 3].includes(Number(src.fee))) s.fee = Number(src.fee);
    if (typeof src.protect === "boolean") s.protect = src.protect;

    if (src.protectProvider && typeof src.protectProvider === "object") {
        for (const k of ["1", "3"]) if (typeof src.protectProvider[k] === "string") s.protectProvider[k] = src.protectProvider[k];
    }

    if (Array.isArray(src.versions)) {
        const v = src.versions.map(x => String(x).toUpperCase()).filter(x => ["V2", "V3", "V4"].includes(x));
        if (v.length > 0) s.versions = v;
    }

    if (src.rpc && typeof src.rpc === "object") {
        for (const k of ["1", "2", "3"]) {
            if (typeof src.rpc[k] === "string") {
                const u = src.rpc[k].trim();
                s.rpc[k] = /^https:\/\//i.test(u) || u === "" ? u : "";
            }
        }
    }

    if (typeof src.graphKey === "string") s.graphKey = src.graphKey.trim();

    if (src.ledger && typeof src.ledger === "object") {
        if (["index", "from", "path"].includes(src.ledger.mode)) s.ledger.mode = src.ledger.mode;
        const idx = Number(src.ledger.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < 100) s.ledger.index = idx;
        if (typeof src.ledger.from === "string") s.ledger.from = src.ledger.from.trim();
        if (typeof src.ledger.path === "string" && src.ledger.path.trim()) s.ledger.path = src.ledger.path.trim();
    }

    if (typeof src.lastAddress === "string") s.lastAddress = src.lastAddress.trim();
    if (src.language === "pt" || src.language === "en") s.language = src.language;

    const dl = Math.round(Number(src.deadlineMinutes));
    if (Number.isFinite(dl) && dl >= 1 && dl <= 60) s.deadlineMinutes = dl;

    if (WALLET_KEYS.includes(src.wallet)) s.wallet = src.wallet;

    if (typeof src.localAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(src.localAddress.trim())) s.localAddress = src.localAddress.trim();
    if (s.wallet === "local" && !s.localAddress) s.wallet = "metamask";

    if (src.trezor && typeof src.trezor === "object") {
        const ti = Number(src.trezor.index);
        if (Number.isInteger(ti) && ti >= 0 && ti < 100) s.trezor.index = ti;
    }

    if (src.lastAddresses && typeof src.lastAddresses === "object") {
        for (const k of WALLET_KEYS) {
            const a = src.lastAddresses[k];
            if (typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.trim())) s.lastAddresses[k] = a.trim();
        }
    }

    if (typeof src.relay === "string") {
        const r = src.relay.trim().replace(/\/+$/, "");
        s.relay = /^https:\/\/[^\s]+$/i.test(r) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s]*)?$/i.test(r) ? r : "";
    }

    return s;
}


const store = globalThis.__TCS_NODE.storage;

function loadSettings() {
    try { return sanitizeSettings(JSON.parse(store.getItem(SETTINGS_KEY) || "{}")); }
    catch (_) { return sanitizeSettings({}); }
}

function saveSettings(s) {
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
}


// O motor lê os RPC e a chave da The Graph de process.env.
function applyEnvironment(s) {
    const env = globalThis.process.env;
    const set = (name, value) => {
        if (value && String(value).trim()) env[name] = String(value).trim();
        else delete env[name];
    };
    set("RPC_URL", s.rpc["1"]);
    set("RPC_URL_42161", s.rpc["2"]);
    set("RPC_URL_56", s.rpc["3"]);
    set("GRAPH_API_KEY", s.graphKey);
}


// ============================================================
// RELAY (builders dos bundles e serviços sem CORS)
//
// Os builders (Flashbots, Titan, beaverbuild, …) não aceitam pedidos
// vindos de páginas web (CORS). O relay (relay/ neste repositório) é
// um reencaminhador mínimo com lista fechada de destinos: recebe a
// transação JÁ ASSINADA e passa-a ao builder. Nunca vê chaves.
// ============================================================

let settings = null;

function relayBase() {
    return (settings && settings.relay) || CONFIG.defaultRelay || "";
}

// Destinos que precisam sempre do relay (sem CORS).
function mustRelay(url) {
    return /^https:\/\/(relay\.flashbots\.net|rpc\.buildernet\.org|rpc\.titanbuilder\.xyz|rpc\.beaverbuild\.org|puissant-builder\.48\.club|bsc\.blockrazor\.xyz)(\/|$)/i.test(url);
}

// Destinos que podem usar o relay se o pedido direto falhar.
function mayRelay(url) {
    return mustRelay(url) || /^https:\/\/(rpc\.mevblocker\.io|rpc\.flashbots\.net|bsc\.merkle\.io|bscrpc\.pancakeswap\.finance|rpc-bsc\.48\.club|gateway\.thegraph\.com)(\/|$)/i.test(url);
}

const nativeFetch = globalThis.fetch.bind(globalThis);

function viaRelay(url) {
    return relayBase() + "/?u=" + encodeURIComponent(url);
}

globalThis.fetch = async function (input, init) {

    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const relay = relayBase();

    if (mustRelay(url)) {
        if (!relay) {
            throw new Error(L(
                "Os builders não aceitam pedidos diretos de um site (CORS). Configura o relay em Definições › Ligações (ver relay/ no GitHub).",
                "Builders do not accept direct requests from a website (CORS). Set up the relay in Settings › Connections (see relay/ on GitHub)."
            ));
        }
        return nativeFetch(viaRelay(url), init);
    }

    try {
        return await nativeFetch(input, init);
    } catch (error) {
        if (relay && mayRelay(url) && error instanceof TypeError) return nativeFetch(viaRelay(url), init);
        throw error;
    }
};


// ============================================================
// MOTOR
// ============================================================

const g = require("./gui-engine");
const ledgerLib = require("./ledger-webhid");
const bridgeWeb = require("./wallet-bridge-web");


// Trezor Connect (script oficial, carregado só quando a Trezor é escolhida).
let trezorScript = null;

globalThis.__TCS_loadTrezor = function () {
    if (globalThis.TrezorConnect) return Promise.resolve();
    if (trezorScript) return trezorScript;
    trezorScript = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = CONFIG.trezorConnectUrl || "https://connect.trezor.io/9/trezor-connect.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { trezorScript = null; reject(new Error(L("Não consegui carregar o Trezor Connect (connect.trezor.io).", "Could not load Trezor Connect (connect.trezor.io)."))); };
        document.head.appendChild(s);
    });
    return trezorScript;
};


// ---- eventos para a interface ----

const listeners = { progress: [], "bundle-progress": [], "wallet-state": [], "wallet-ui": [] };

function emit(channel, data) {
    for (const fn of listeners[channel]) {
        try { fn(data); } catch (_) {}
    }
}

function on(channel, fn) {
    listeners[channel].push(fn);
    return () => { const i = listeners[channel].indexOf(fn); if (i >= 0) listeners[channel].splice(i, 1); };
}


// Cada pedido devolve { ok, data } ou { ok:false, error } (como o IPC).
function handle(fn) {
    return async (arg) => {
        try {
            return { ok: true, data: await fn(arg) };
        } catch (error) {
            if (!(error && error.cancelled)) console.error(error);
            return { ok: false, cancelled: !!(error && error.cancelled), error: (error && (error.shortMessage || error.message)) || String(error) };
        }
    };
}


// Ledgers autorizadas neste navegador (para pedir autorização dentro do clique).
let ledgerAuthorized = 0;

function refreshLedgerAuthorized() {
    return ledgerLib.TransportWebHID.list().then(l => { ledgerAuthorized = l.length; return l.length; }).catch(() => 0);
}

function requestLedger() {
    // Chamado de forma síncrona dentro do clique (o navegador exige-o).
    return ledgerLib.TransportWebHID.request().then((list) => {
        if (list && list.length) ledgerAuthorized = list.length;
        return refreshLedgerAuthorized();
    });
}


// ---- arranque ----

settings = loadSettings();

if (!settings.language) {
    settings.language = /^pt/i.test(navigator.language || "") ? "pt" : "en";
    try { saveSettings(settings); } catch (_) {}
}

applyEnvironment(settings);

g.keystore.setDir("/web/wallets");
g.bundlesSetDir("/web");

g.keystore.setLockListener((info) => emit("wallet-ui", { type: "locked", address: info.address, reason: info.reason }));
g.onTrezorUi((request) => emit("wallet-ui", request));

g.onBridgeChange((state) => {
    if (state.account && settings.wallet === state.wallet &&
        state.account.toLowerCase() !== String(settings.lastAddress).toLowerCase()) {
        settings.lastAddress = state.account;
        settings.lastAddresses[settings.wallet] = state.account;
        saveSettings(settings);
    }
    emit("wallet-state", { state, lastAddress: settings.lastAddress });
});

refreshLedgerAuthorized();

if (navigator.hid) {
    navigator.hid.addEventListener("connect", refreshLedgerAuthorized);
    navigator.hid.addEventListener("disconnect", refreshLedgerAuthorized);
}

try { g.configure(settings); } catch (error) { console.error(error); }


const localView = () => ({ settings, imported: g.keystore.list() });

async function useLocal(address) {
    if (settings.lastAddress && settings.wallet !== "local") settings.lastAddresses[settings.wallet] = settings.lastAddress;
    settings.wallet = "local";
    settings.localAddress = address;
    settings.lastAddress = address;
    saveSettings(settings);
    await g.configure(settings);
}


window.api = {

    web: true,

    init: handle(() => ({
        settings,
        chains: g.chainsInfo(),
        wallets: Object.entries(g.WALLETS).map(([key, w]) => Object.assign({ key }, w)),
        version: VERSION,
        language: LANG
    })),

    saveSettings: handle(async (input) => {
        settings = sanitizeSettings(Object.assign({}, input, { language: settings.language }));
        if (settings.lastAddress) settings.lastAddresses[settings.wallet] = settings.lastAddress;
        saveSettings(settings);
        applyEnvironment(settings);
        await g.configure(settings);
        return settings;
    }),

    chooseWallet: (key) => {
        // Ledger: a janela de autorização do navegador tem de abrir já, dentro do clique.
        const auth = key === "ledger" && ledgerAuthorized === 0 && ledgerLib.TransportWebHID.isSupported()
            ? requestLedger().catch(() => 0) : null;
        return handle(async () => {
            if (!WALLET_KEYS.includes(key)) throw new Error(L("Carteira desconhecida.", "Unknown wallet."));
            if (auth) await auth;
            if (key === "trezor") await globalThis.__TCS_loadTrezor().catch(() => null);
            if (settings.lastAddress) settings.lastAddresses[settings.wallet] = settings.lastAddress;
            settings.wallet = key;
            settings.lastAddress = settings.lastAddresses[key] || "";
            saveSettings(settings);
            await g.configure(settings);
            return settings;
        })();
    },

    // Na web não há página de ligação: pede diretamente à extensão.
    openWalletPage: handle(async () => {
        await g.openBridge();
        return bridgeWeb.connect();
    }),

    walletPageUrl: handle(() => null),

    walletState: handle(() => g.bridgeState()),

    trezorRespond: handle((answer) => g.trezorRespond(answer)),

    // Autoriza a Ledger neste navegador (botão na barra lateral).
    ledgerAuthorize: () => {
        const p = requestLedger();
        return handle(async () => {
            await p;
            return { authorized: ledgerAuthorized > 0 };
        })();
    },

    setLanguage: handle((lang) => {
        if (lang !== "pt" && lang !== "en") throw new Error("pt | en");
        settings.language = lang;
        saveSettings(settings);
        if (lang !== LANG) {
            setTimeout(() => { location.href = lang === "en" ? "index.en.html" : "index.html"; }, 150);
        }
        return true;
    }),

    localList: handle(() => localView()),

    localImport: handle(async (arg) => {
        const a = arg || {};
        const r = await g.keystore.importKey({ privateKey: a.privateKey, password: a.password, label: a.label });
        await useLocal(r.address);
        return localView();
    }),

    localUnlock: handle(async (arg) => {
        const a = arg || {};
        const r = await g.keystore.unlock(a.address, a.password);
        await useLocal(r.address);
        return localView();
    }),

    localLock: handle(() => {
        g.keystore.lock("manual");
        return localView();
    }),

    localRemove: handle(async (address) => {
        g.keystore.remove(address);
        if (String(settings.localAddress).toLowerCase() === String(address).toLowerCase()) {
            settings.localAddress = "";
            if (settings.wallet === "local") {
                settings.wallet = "metamask";
                settings.lastAddress = settings.lastAddresses.metamask || "";
            }
            saveSettings(settings);
            await g.configure(settings);
        }
        return localView();
    }),

    tokenInfo: handle((arg) => g.tokenInfo(arg)),
    balance: handle((arg) => g.balance(arg)),
    analyze: handle((arg) => g.analyze(arg)),

    prepare: handle(async (arg) => {
        const result = await g.prepare(arg);
        if (result && result.address && result.address !== settings.lastAddress) {
            settings.lastAddress = result.address;
            settings.lastAddresses[settings.wallet] = result.address;
            saveSettings(settings);
        }
        return result;
    }),

    execute: handle(() => g.execute((step) => emit("progress", step))),
    wallets: handle((arg) => g.wallets(arg)),

    bundleInfo: handle((arg) => g.bundleInfo(arg)),
    bundlePrepare: handle((arg) => g.bundlePrepare(Object.assign({}, arg, { deadlineMinutes: settings.deadlineMinutes }))),
    bundleExecute: handle(() => g.bundleExecute((step) => emit("bundle-progress", step))),
    bundleUnlock: handle((arg) => g.bundleUnlock(arg)),
    bundleForget: handle(() => g.bundleForget()),
    bundleCancel: handle(() => g.bundleCancel()),

    cancel: handle((kind) => g.cancel(kind)),
    ledgerStatus: handle(() => g.ledgerStatus()),
    testConnections: handle(() => g.testConnections()),

    openExternal: handle((url) => {
        if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error(L("Endereço não permitido.", "Address not allowed."));
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
    }),

    onProgress: (fn) => on("progress", fn),
    onBundleProgress: (fn) => on("bundle-progress", fn),
    onWalletState: (fn) => on("wallet-state", fn),
    onWalletUi: (fn) => on("wallet-ui", fn)
};


// Página na língua errada (primeira visita ou definição mudada noutro separador).
if (settings.language !== LANG && !/[?&]lang=keep\b/.test(location.search)) {
    location.replace(settings.language === "en" ? "index.en.html" : "index.html");
}


window.addEventListener("beforeunload", () => {
    try { g.dispose(); } catch (_) {}
});
