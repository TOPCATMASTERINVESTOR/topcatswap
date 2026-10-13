// ============================================================
// TopCatSwap Web — carteiras do navegador (MetaMask, OKX, Rabby,
// Coinbase Wallet, Trust Wallet)
//
// Na app de secretária isto passa por uma página local. No site a
// extensão está na própria página: encontramo-la por EIP-6963 (ou pelo
// window.ethereum) e falamos com ela diretamente (EIP-1193).
// Mesma interface que desktop/engine/wallet-bridge.js.
// ============================================================

"use strict";

const L = (pt, en) => (globalThis.TCS_LANG === "en" ? en : pt);

const BROWSER_WALLETS = {
    metamask: { name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], flag: "isMetaMask" },
    okx: { name: "OKX Wallet", rdns: ["com.okex.wallet"], flag: "isOkxWallet" },
    rabby: { name: "Rabby", rdns: ["io.rabby"], flag: "isRabby" },
    coinbase: { name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], flag: "isCoinbaseWallet" },
    trust: { name: "Trust Wallet", rdns: ["com.trustwallet.app"], flag: "isTrust" }
};

let walletKey = "metamask";
let onChange = null;
let provider = null;            // provider EIP-1193 da carteira escolhida
let subscribed = null;
const announced = [];           // { info, provider } (EIP-6963)

const state = { detected: null, others: [], accounts: [], chainId: null, connected: false, error: null };


if (typeof window !== "undefined") {
    window.addEventListener("eip6963:announceProvider", (event) => {
        const d = event && event.detail;
        if (!d || !d.provider || !d.info) return;
        if (!announced.some(x => x.info.uuid === d.info.uuid)) announced.push(d);
        refreshProvider();
    });
}


function discover() {
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (_) {}
}


function findProvider() {

    const w = BROWSER_WALLETS[walletKey];

    const by6963 = announced.find(x => w.rdns.includes(x.info.rdns));
    if (by6963) return { provider: by6963.provider, name: by6963.info.name || w.name };

    // Sem EIP-6963: window.ethereum (ou a lista de providers de algumas extensões).
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    const candidates = eth ? (Array.isArray(eth.providers) ? eth.providers : [eth]) : [];

    // A Rabby também diz isMetaMask; a MetaMask "verdadeira" não tem outras marcas.
    const others = Object.entries(BROWSER_WALLETS).filter(([k]) => k !== walletKey).map(([, x]) => x.flag);
    const hit = candidates.find(p => p && p[w.flag] && (walletKey !== "metamask" || !others.some(f => p[f])));

    return hit ? { provider: hit, name: w.name } : null;
}


function otherNames() {
    const names = announced.map(x => x.info.name).filter(Boolean);
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (!names.length && eth) {
        for (const [, x] of Object.entries(BROWSER_WALLETS)) if (eth[x.flag]) names.push(x.name);
        if (!names.length) names.push(L("outra carteira", "another wallet"));
    }
    return names.filter(n => n !== state.detected).slice(0, 10);
}


function publicState() {
    return {
        wallet: walletKey,
        walletName: BROWSER_WALLETS[walletKey].name,
        url: null,
        web: true,
        pageOpen: true,
        detected: state.detected,
        others: otherNames(),
        connected: state.connected && state.accounts.length > 0,
        account: state.accounts[0] || null,
        accounts: state.accounts.slice(),
        chainId: state.chainId,
        error: state.error
    };
}


function changed() {
    if (onChange) {
        try { onChange(publicState()); } catch (_) {}
    }
}


function unsubscribe() {
    if (subscribed && subscribed.removeListener) {
        try {
            subscribed.removeListener("accountsChanged", onAccounts);
            subscribed.removeListener("chainChanged", onChain);
        } catch (_) {}
    }
    subscribed = null;
}

function onAccounts(list) {
    state.accounts = Array.isArray(list) ? list.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)) : [];
    state.connected = state.accounts.length > 0;
    changed();
}

function onChain(id) {
    state.chainId = typeof id === "string" ? id.toLowerCase() : null;
    changed();
}


function refreshProvider() {

    const found = findProvider();
    const next = found ? found.provider : null;

    if (next === provider) return;

    unsubscribe();
    provider = next;
    state.detected = found ? found.name : null;
    state.accounts = [];
    state.connected = false;
    state.chainId = null;

    if (provider && provider.on) {
        provider.on("accountsChanged", onAccounts);
        provider.on("chainChanged", onChain);
        subscribed = provider;
    }

    if (provider) {
        // Sem janela: só lê o que já foi autorizado antes.
        provider.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
        provider.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    }

    changed();
}


async function start() {
    discover();
    await new Promise(r => setTimeout(r, 150));
    refreshProvider();
    return null;
}


// Pede à extensão para ligar (abre a janela de aprovação da carteira).
async function connect() {

    discover();
    refreshProvider();

    const name = BROWSER_WALLETS[walletKey].name;

    if (!provider) {
        state.error = L(
            name + " não encontrada neste navegador. Instala a extensão (ou ativa-a) e recarrega a página.",
            name + " was not found in this browser. Install (or enable) the extension and reload the page."
        );
        changed();
        throw new Error(state.error);
    }

    try {
        const list = await provider.request({ method: "eth_requestAccounts" });
        state.error = null;
        onAccounts(list);
        onChain(await provider.request({ method: "eth_chainId" }));
        return publicState();
    } catch (error) {
        state.error = explainWalletError(error, name);
        changed();
        throw new Error(state.error);
    }
}


function url() {
    return null;
}


function configure({ wallet }) {
    if (wallet && BROWSER_WALLETS[wallet] && wallet !== walletKey) {
        walletKey = wallet;
        state.error = null;
        refreshProvider();
    }
}


function setListener(fn) {
    onChange = fn;
}


function explainWalletError(error, name) {

    const code = error && error.code;
    const msg = (error && error.message) || String(error);

    if (code === 4001 || /reject|denied|cancel/i.test(msg)) {
        return L("Rejeitaste o pedido na " + name + ". Nada foi enviado.", "You rejected the request in " + name + ". Nothing was sent.");
    }
    if (code === 4100) {
        return L("A " + name + " não autorizou esta conta. Liga de novo a carteira.", name + " has not authorized this account. Connect the wallet again.");
    }
    if (code === -32002) {
        return L("Já há um pedido pendente na " + name + ": abre a extensão e responde-lhe.", "There is already a pending request in " + name + ": open the extension and answer it.");
    }

    return name + ": " + msg;
}


async function request(method, params, timeoutMs = 60000) {

    const name = BROWSER_WALLETS[walletKey].name;

    if (!provider) refreshProvider();

    if (!provider) {
        throw new Error(L(name + " não encontrada neste navegador.", name + " was not found in this browser."));
    }

    let timer;

    try {
        return await Promise.race([
            provider.request({ method, params: params || [] }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(L("A " + name + " não respondeu a tempo.", name + " did not answer in time."))), timeoutMs);
            })
        ]);
    } catch (error) {
        const e = new Error(explainWalletError(error, name));
        e.code = error && error.code;
        throw e;
    } finally {
        clearTimeout(timer);
    }
}


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
        throw new Error(L(
            "A carteira continua noutra rede. Muda para " + chain.name + " na extensão e tenta de novo.",
            "The wallet is still on another network. Switch to " + chain.name + " in the extension and try again."
        ));
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
            return request("eth_sendTransaction", [tx], 15 * 60 * 1000);
        }
    };
}


function stop() {}


module.exports = {
    BROWSER_WALLETS,
    start,
    stop,
    url,
    connect,
    configure,
    setListener,
    state: publicState,
    request,
    ensureChain,
    accounts,
    signer
};
