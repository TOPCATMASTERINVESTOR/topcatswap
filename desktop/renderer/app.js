"use strict";

// ============================================================
// TopCatSwap — interface
//
// Toda a lógica de rede, carteiras e swaps corre no processo
// principal (window.api). Aqui só se mostra o estado.
// ============================================================

const bridge = window.api;


// Se algo falhar, mostra o erro na janela em vez de a deixar em branco.
let fatalShown = false;

function showFatal(message) {
    const view = document.getElementById("view");
    if (!view || fatalShown) return;
    fatalShown = true;
    view.innerHTML =
        '<div style="padding:32px;max-width:760px"><h1 style="margin:0 0 12px;font-size:22px">Não foi possível iniciar a interface</h1>' +
        '<div class="fatal-msg" style="background:#24161A;border:1px solid #6B2E33;color:#F3C9C6;border-radius:12px;padding:14px 16px;font-family:monospace;font-size:13px;white-space:pre-wrap"></div>' +
        '<p style="color:#A6B6CF;font-size:14px;line-height:1.5">O erro também fica em ~/.config/TopCatSwap/topcatswap.log. Ctrl+Shift+I abre as ferramentas de diagnóstico.</p></div>';
    view.querySelector(".fatal-msg").textContent = message;
}

window.addEventListener("error", (event) => showFatal(String(event.message || event.error)));
window.addEventListener("unhandledrejection", (event) => showFatal(String(event.reason && (event.reason.stack || event.reason.message) || event.reason)));

if (!bridge) {
    showFatal("A ponte entre a janela e o motor (preload.js) não carregou: window.api não existe.");
    throw new Error("window.api indisponível");
}


// ============================================================
// ÍCONES
// ============================================================

const svg = (paths, size = 18, extra = "") =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;

const ICON = {
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>', 14),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 14, 'style="color:#A6B6CF"'),
    refresh: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>', 18),
    shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>', 16),
    warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 18),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 34, 'style="color:#00D1B2"'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', 16),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 15),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
    ledger: svg('<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 12h6"/>', 18)
};


// ============================================================
// ESTADO
// ============================================================

const SLIP_PRESETS = ["0.1", "0.3", "0.5", "1", "5"];

const S = {
    ready: false,
    loadError: null,
    chains: [],
    settings: null,
    view: "swap",
    swap: null,
    swapError: null,
    analysis: null,
    analyzeError: null,
    selectedPool: null,
    prepared: null,
    prepareError: null,
    exec: null,
    wallets: { token: "native", ca: "", loading: false, error: null, data: null },
    draft: null,
    draftMsg: null,
    connStatus: null,
    ledger: { connected: false, busy: false, error: null },
    bridge: null,
    walletList: [],
    chooser: null,
    walletUi: null,
    imported: [],
    secure: null,
    lang: "pt",
    bundle: null,
    busy: { analyze: false, prepare: false, wallets: false, test: false },
    modal: null
};


// ============================================================
// CARTEIRAS (Ledger, Trezor e extensões do navegador)
// ============================================================

// Monogramas (letras, não logótipos) nas cores de cada carteira.
const WALLET_LOOK = {
    ledger: { bg: "#E8ECF2", fg: "#0B0C0E", text: "L", sub: "Hardware · ligada por USB. Contas do Ledger Live.", group: "hw" },
    trezor: { bg: "#0F6148", fg: "#FFFFFF", text: "T", sub: "Hardware · ligada por USB. Contas do Trezor Suite.", group: "hw", exp: true },
    metamask: { bg: "#F6851B", fg: "#1E1206", text: "M", sub: "Extensão do navegador. Também funciona com Ledger/Trezor ligadas ao MetaMask.", group: "br" },
    okx: { bg: "#0B0C0E", fg: "#FFFFFF", text: "OKX", sub: "Extensão do navegador.", group: "br" },
    rabby: { bg: "#7084FF", fg: "#FFFFFF", text: "R", sub: "Extensão do navegador. Mostra a simulação antes de assinar.", group: "br" },
    coinbase: { bg: "#0052FF", fg: "#FFFFFF", text: "C", sub: "Extensão Coinbase Wallet (carteira própria, não a conta da exchange).", group: "br" },
    trust: { bg: "#3375BB", fg: "#FFFFFF", text: "T", sub: "Extensão do navegador.", group: "br" },
    local: { bg: "linear-gradient(135deg,#1E8CFF,#00D1B2)", fg: "#04121F", text: "PK", sub: "Chave privada importada, cifrada neste computador com a sua password.", group: "pk" }
};

function walletKey() {
    return (S.settings && S.settings.wallet) || "ledger";
}

// Carteira importada selecionada (ou a indicada por "local:0x…").
function importedOf(key) {
    const addr = key && key.startsWith("local:") ? key.slice(6) : (S.settings && S.settings.localAddress);
    return (S.imported || []).find(w => addr && w.address.toLowerCase() === addr.toLowerCase()) || null;
}

function W(key) {
    let k = key || walletKey();
    const imp = k === "local" || k.startsWith("local:") ? importedOf(k === "local" ? null : k) : null;
    if (k.startsWith("local:")) k = "local";
    const meta = S.walletList.find(w => w.key === k) || { key: k, name: k };
    const out = Object.assign({}, meta, WALLET_LOOK[k] || {});
    if (k === "local" && imp) out.name = imp.label;
    return out;
}

// Idioma: Português (PT) ou English (US). Mudar reinicia a app.
function langSwitch(small) {
    const opt = (k, label) => `<button type="button" class="pill ${small ? "" : "round"}" style="${small ? "min-height:34px;padding:0 12px;font-size:13px" : ""}" aria-pressed="${S.lang === k}" data-action="set-lang" data-lang="${k}">${label}</button>`;
    return `<div class="pills" role="group" aria-label="Idioma / Language">${opt("pt", small ? "PT" : "Português (PT)")}${opt("en", small ? "EN" : "English (US)")}</div>`;
}

function isLocal() {
    return walletKey() === "local";
}

function isBrowser() {
    return !!W().browser;
}

function monogram(key, small) {
    const w = W(key);
    return `<span class="wallet-mono ${small ? "sm" : ""}" style="background:${w.bg};color:${w.fg}" aria-hidden="true">${h(w.text)}</span>`;
}


// ============================================================
// UTILIDADES
// ============================================================

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

function h(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, c => ESC[c]);
}

function chain() {
    return S.chains.find(c => c.number === S.settings.chain) || S.chains[0];
}

function shortAddr(a) {
    return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}

function accountLabel() {
    if (isLocal()) return W().name;
    if (walletKey() === "trezor") return "Trezor · conta " + (Number(S.settings.trezor.index) + 1);
    if (isBrowser()) return W().name;
    const l = S.settings.ledger;
    if (l.mode === "from") return "Endereço fixo";
    if (l.mode === "path") return "m/" + l.path;
    return "Índice " + l.index;
}

function notice(kind, text, icon = true) {
    return `<div class="notice ${kind}" role="${kind === "bad" ? "alert" : "status"}">${icon ? ICON.warn : ""}<span>${h(text)}</span></div>`;
}

function effectiveSlip() {
    return S.swap.slip === "custom" ? String(S.swap.customSlip).replace(",", ".").trim() : S.swap.slip;
}

function deadlineOk(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 60;
}

function checkSlip(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0.01 || n > 50) {
        return { ok: false, kind: "bad", text: "Valor inválido: usa um número entre 0.01 e 50." };
    }
    if (n > 5) {
        return { ok: true, kind: "warn", text: "Acima de 5%: perda máxima elevada. Liga a proteção MEV." };
    }
    return { ok: true, kind: "info", text: "Recebes pelo menos " + (100 - n).toFixed(2) + "% da cotação." };
}

function tokenIcon(symbol) {
    const s = String(symbol || "?").toUpperCase();
    if (s === "ETH") {
        return `<span class="token-icon" style="background:#627EEA"><svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2 5.5 12.4 12 16.2l6.5-3.8L12 2zM5.5 13.9 12 22l6.5-8.1-6.5 3.8-6.5-3.8z"/></svg></span>`;
    }
    const colors = { USDC: ["#2775CA", "#fff", "$"], BNB: ["#F0B90B", "#04121F", "B"], WBNB: ["#B98C08", "#04121F", "W"], WETH: ["#3C4A6E", "#fff", "W"] };
    const [bg, fg, letter] = colors[s] || ["#2A4060", "#fff", s.charAt(0)];
    return `<span class="token-icon" style="background:${bg};color:${fg}">${h(letter)}</span>`;
}

function providerFor(c) {
    const saved = S.settings.protectProvider[String(c.number)];
    return c.protect.some(p => p.key === saved) ? saved : c.defaultProtect;
}

function freshSwap(keepTokens) {
    const c = chain();
    const s = S.settings;
    const old = S.swap;
    return {
        tokenIn: keepTokens && old ? old.tokenIn : { value: c.nativeSymbol, symbol: c.nativeSymbol },
        tokenOut: keepTokens && old ? old.tokenOut : { value: "USDC", symbol: "USDC" },
        amount: keepTokens && old ? old.amount : "",
        protect: s.protect,
        provider: providerFor(c),
        slip: SLIP_PRESETS.includes(s.slippage) ? s.slippage : "custom",
        customSlip: SLIP_PRESETS.includes(s.slippage) ? "3" : s.slippage,
        fee: s.fee,
        versions: { V2: s.versions.includes("V2"), V3: s.versions.includes("V3"), V4: s.versions.includes("V4") },
        balance: null
    };
}

async function call(promise) {
    const r = await promise;
    if (!r || !r.ok) {
        const error = new Error((r && r.error) || "Erro desconhecido.");
        error.cancelled = !!(r && r.cancelled);
        throw error;
    }
    return r.data;
}

// Cada pedido longo tem um número; ao cancelar, o número muda e a
// resposta que ainda chegar é ignorada.
const REQ = { analyze: 0, prepare: 0 };


// ============================================================
// PEÇAS COMUNS
// ============================================================

function topbar({ title, sub, back, actions }) {
    return `<header class="topbar">
<div class="title-block">
${back ? `<button type="button" class="back" data-action="nav" data-view="${h(back.view)}">${ICON.back}${h(back.label)}</button>` : ""}
<h1>${h(title)}</h1>
${sub ? `<p>${sub}</p>` : ""}
</div>
${actions ? `<div class="top-actions">${actions}</div>` : ""}
</header>`;
}

function chainSelect() {
    const options = S.chains.map(c =>
        `<option value="${c.number}" ${c.number === S.settings.chain ? "selected" : ""} ${c.supported ? "" : "disabled"}>${h(c.name)}${c.supported ? "" : " (em breve)"}</option>`
    ).join("");
    return `<label class="sr-only" for="chain-select">Rede</label><select id="chain-select" class="select-chain" data-change="chain">${options}</select>`;
}

function walletChip() {
    const addr = S.settings.lastAddress;
    return `<button type="button" class="chip mono" style="display:inline-flex;align-items:center;gap:8px" data-action="nav" data-view="${isBrowser() ? "connect" : "wallets"}">${monogram(walletKey(), true)}${h(accountLabel())} · ${addr ? h(shortAddr(addr)) : isBrowser() ? "por ligar" : "por ler"}</button>`;
}

function loadingCard(text, sub, cancelAction, cancelLabel) {
    const cancel = cancelAction
        ? `<button type="button" class="btn" data-action="${h(cancelAction)}">${h(cancelLabel || "Cancelar")}</button>`
        : "";
    return `<div class="page"><section class="card" style="flex:1 1 100%;max-width:720px"><div class="empty"><span class="spinner big-spin"></span><h2>${h(text)}</h2>${sub ? `<p>${h(sub)}</p>` : ""}${cancel}</div></section></div>`;
}


// ============================================================
// ECRÃ: SWAP
// ============================================================

function tokenButton(side) {
    const t = side === "in" ? S.swap.tokenIn : S.swap.tokenOut;
    return `<button type="button" class="token-btn" data-action="pick-token" data-side="${side}" aria-label="Token a ${side === "in" ? "vender" : "receber"}: ${h(t.symbol)}. Mudar">${tokenIcon(t.symbol)}${h(t.symbol)}${ICON.chevron}</button>`;
}

function balanceLine() {
    const b = S.swap.balance;
    if (!S.settings.lastAddress) {
        return isBrowser()
            ? `<span>Saldo: <button type="button" class="link-btn" data-action="nav" data-view="connect">ligar a ${h(W().name)}</button></span>`
            : `<span>Saldo: <button type="button" class="link-btn" data-action="nav" data-view="wallets">ler a carteira</button></span>`;
    }
    if (!b) return `<span>Saldo <span class="mono">…</span></span>`;
    if (b.error) return `<span>Saldo indisponível</span>`;
    return `<span>Saldo <span class="mono">${h(b.text)} ${h(b.symbol)}</span><button type="button" class="link-btn" data-action="max">Máx</button></span>`;
}

function viewSwap() {
    const c = chain();
    const sw = S.swap;
    const protectOK = !!c.defaultProtect && !isBrowser();
    const slipCheck = checkSlip(effectiveSlip());
    const providerName = (c.protect.find(p => p.key === sw.provider) || {}).name || "";

    const providers = protectOK && sw.protect
        ? `<div class="seg-2" role="group" aria-label="Serviço de envio privado">${c.protect.map(p =>
            `<button type="button" class="pill" aria-pressed="${p.key === sw.provider}" data-action="provider" data-key="${h(p.key)}">${h(p.name)}</button>`).join("")}</div>`
        : "";

    const slips = SLIP_PRESETS.map(v =>
        `<button type="button" class="pill mono" aria-pressed="${sw.slip === v}" data-action="slip" data-value="${v}">${v}%</button>`).join("");

    const custom = sw.slip === "custom" ? `
<div class="form-row">
<label for="slip-custom">Slippage personalizado (0.01 a 50%)</label>
<div class="custom-slip ${slipCheck.ok ? "" : "invalid"}" id="slip-box"><input id="slip-custom" inputmode="decimal" autocomplete="off" data-model="customSlip" value="${h(sw.customSlip)}"><span class="mono muted">%</span></div>
<span id="slip-hint" class="opt-sub" style="color:${slipCheck.kind === "bad" ? "#F0918C" : slipCheck.kind === "warn" ? "#F5C46B" : "#8496B3"}">${h(slipCheck.text)}</span>
</div>` : "";

    const fees = [[1, "Normal", "fee da rede"], [2, "Rápido", "+10%"], [3, "Mais rápido", "+30%"]].map(([n, name, sub]) =>
        `<button type="button" aria-pressed="${sw.fee === n}" data-action="fee" data-value="${n}"><span>${name}</span><span>${sub}</span></button>`).join("");

    const versions = ["V2", "V3", "V4"].map(k =>
        `<button type="button" class="pill round" aria-pressed="${!!sw.versions[k]}" data-action="version" data-key="${k}">${k}</button>`).join("");

    const protectBlock = isBrowser() && c.defaultProtect ? `
<div><div class="opt-title">Proteção MEV</div><div class="opt-sub">Com a ${h(W().name)} o envio é feito pela própria carteira. Ativa a proteção na carteira (MetaMask: Smart Transactions) ou adiciona-lhe o RPC MEV Blocker: <span class="mono">https://rpc.mevblocker.io</span></div></div>` : protectOK ? `
<div class="opt-head">
<div><div class="opt-title" id="lbl-protect">Proteção MEV</div><div class="opt-sub">Envio privado contra sandwich e frontrun</div></div>
<button type="button" class="switch" aria-labelledby="lbl-protect" aria-pressed="${sw.protect}" data-action="toggle-protect"><span class="track"><span class="knob"></span></span></button>
</div>${providers}` : `
<div><div class="opt-title">Proteção MEV</div><div class="opt-sub">Não aplicável na ${h(c.name)}: ${h(c.noProtectReason || "sem RPC privado")}.</div></div>`;

    return topbar({
        title: "Swap",
        sub: "Escolhe os tokens e o montante. O bot compara V2, V3 e V4 e escolhe a pool que entrega mais.",
        actions: chainSelect() + walletChip()
    }) + `
<div class="page">
<section class="card grow-wide" aria-labelledby="t-troca" style="gap:12px">
<h2 id="t-troca">Troca</h2>
<div class="field">
<label for="amount-in">Vendes</label>
<div class="field-row"><input id="amount-in" class="amount" inputmode="decimal" autocomplete="off" placeholder="0.0" data-model="amount" value="${h(sw.amount)}">${tokenButton("in")}</div>
<div class="field-foot"><span>${h(c.name)}</span>${balanceLine()}</div>
</div>
<div class="invert"><button type="button" data-action="invert" aria-label="Inverter tokens">${ICON.down}</button></div>
<div class="field">
<span class="label">Recebes (estimado)</span>
<div class="field-row"><output class="amount out">—</output>${tokenButton("out")}</div>
</div>
<p class="hint">A quantidade a receber é calculada na análise, cotando cada pool com o montante real.</p>
${S.swapError ? notice("bad", S.swapError) : ""}
${S.busy.analyze
        ? `<div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" class="btn primary big" style="flex:2 1 200px" disabled><span class="spinner"></span>A analisar pools…</button><button type="button" class="btn big" style="flex:1 1 120px" data-action="cancel-analyze">Cancelar</button></div>`
        : `<button type="button" class="btn primary big block" data-action="analyze">Analisar pools${ICON.arrow}</button>`}
</section>

<section class="card grow-narrow" aria-labelledby="t-opcoes" style="gap:22px">
<h2 id="t-opcoes">Opções</h2>
<div style="display:flex;flex-direction:column;gap:12px">${protectBlock}</div>
<div style="display:flex;flex-direction:column;gap:10px">
<span class="opt-title" id="lbl-slip">Slippage máximo</span>
<div class="pills" role="group" aria-labelledby="lbl-slip">${slips}<button type="button" class="pill" aria-pressed="${sw.slip === "custom"}" data-action="slip" data-value="custom">Personalizado</button></div>
${custom}
<span class="opt-sub">Memes com taxa na venda: usa um valor acima da taxa do token.</span>
</div>
<div style="display:flex;flex-direction:column;gap:10px">
<span class="opt-title" id="lbl-fee">Velocidade</span>
<div class="seg" role="group" aria-labelledby="lbl-fee">${fees}</div>
</div>
<div style="display:flex;flex-direction:column;gap:10px">
<span class="opt-title" id="lbl-ver">Versões da Uniswap</span>
<div class="pills" role="group" aria-labelledby="lbl-ver">${versions}</div>
</div>
<div class="rows">
<div><span class="faint">Envio</span><span>${isBrowser() ? "Pela " + h(W().name) : protectOK && sw.protect ? "Privado via " + h(providerName) : protectOK ? "Mempool público" : "Sequenciador (sem mempool público)"}</span></div>
<div><span class="faint">Prazo do swap</span><button type="button" class="link-btn" data-action="nav" data-view="settings">${h(S.settings.deadlineMinutes)} min · alterar</button></div>
<div><span class="faint">Carteira</span><button type="button" class="link-btn mono" data-action="nav" data-view="wallets">${h(accountLabel())} · alterar</button></div>
</div>
</section>
</div>`;
}


// ============================================================
// ECRÃ: POOLS
// ============================================================

function viewPools() {

    if (S.busy.analyze) {
        const vers = Object.keys(S.swap.versions).filter(k => S.swap.versions[k]).join(", ");
        return topbar({ title: "Análise de pools", sub: `<span class="mono">${h(S.swap.amount)} ${h(S.swap.tokenIn.symbol)} → ${h(S.swap.tokenOut.symbol)}</span> · ${h(vers)}` }) +
            loadingCard("A analisar pools…", "A procurar pools " + vers + " e a cotar cada uma com o montante real. Podes cancelar para mudar os tokens, o montante ou as versões.", "cancel-analyze", "Cancelar e voltar ao Swap");
    }

    if (!S.analysis) {
        return topbar({ title: "Pools", sub: "Compara as pools da Uniswap para um par de tokens." }) + `
<div class="page"><section class="card" style="flex:1 1 100%;max-width:720px"><div class="empty">
<h2>Ainda não há nenhuma análise</h2>
${S.analyzeError ? notice("bad", S.analyzeError) : "<p>Escolhe os tokens e o montante no ecrã Swap e carrega em Analisar pools.</p>"}
<button type="button" class="btn primary" data-action="nav" data-view="swap">Ir para o Swap</button>
</div></section></div>`;
    }

    const a = S.analysis;
    const best = a.bestIndex !== null ? a.pools[a.bestIndex] : null;
    const chosen = a.pools[S.selectedPool];

    const rows = a.pools.map(p => `
<tr class="${p.index === S.selectedPool ? "chosen" : ""} ${p.quoteOK ? "" : "unquoted"}">
<td><button type="button" class="pick" data-action="pick-pool" data-index="${p.index}" aria-pressed="${p.index === S.selectedPool}" ${p.quoteOK ? "" : "disabled"}>
<span class="radio"><i></i></span><span class="tag">${h(p.version)}</span><span>${h(p.detail)}</span></button>${p.quoteOK ? "" : `<div class="faint" style="font-size:12px;margin:4px 0 0 28px">${h(p.error)}</div>`}</td>
<td class="mono">${h(p.fee)}</td>
<td class="num" style="color:#C3D2E8">${h(p.tvl)}</td>
<td class="num" style="font-weight:500">${h(p.out)}</td>
<td class="num" style="color:#C3D2E8">${h(p.impact)}</td>
<td class="num" style="color:#C3D2E8">${h(p.gas)}</td>
<td class="num">${h(p.net)}</td>
</tr>`).join("");

    let chosenNote = "";
    if (chosen && best) {
        chosenNote = chosen.index === best.index
            ? "É a melhor execução: entrega mais " + a.symbolOut + "."
            : "Entrega " + (best.outNum - chosen.outNum).toPrecision(4) + " " + a.symbolOut + " a menos do que a melhor execução.";
    }

    const bestCard = best ? `
<section class="best" aria-labelledby="t-best">
<div style="display:flex;flex-direction:column;gap:10px">
<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="tag accent">Melhor execução</span><h2 id="t-best" style="margin:0;font-size:16px">${h(best.version)} · ${h(best.fee)} · ${h(best.detail)}</h2></div>
<div style="display:flex;align-items:baseline;gap:10px"><span class="big-num">${h(best.out)}</span><span class="muted" style="font-size:18px">${h(a.symbolOut)}</span></div>
<div class="stats"><span>Impacto <span class="mono">${h(best.impact)}</span></span><span>Gas <span class="mono">${h(best.gas)}</span></span><span>Líquido de gas <span class="mono">${h(best.net)}</span></span><span>TVL <span class="mono">${h(best.tvl)}</span></span></div>
</div>
<button type="button" class="btn primary big" data-action="prepare" data-index="${best.index}" ${S.busy.prepare ? "disabled" : ""}>Continuar com esta pool${ICON.arrow}</button>
</section>` : notice("bad", "Nenhuma pool devolveu cotação para este montante. Experimenta outro montante ou outras versões.");

    return topbar({
        title: "Análise de pools",
        back: { view: "swap", label: "Voltar ao swap" },
        sub: `<span class="mono">${h(a.amountIn)} ${h(a.symbolIn)} → ${h(a.symbolOut)}</span> · ${a.counts.total} pools encontradas · ${a.counts.quoted} cotadas com o montante real`,
        actions: `<span class="chip small">${h(a.chainName)}</span><span class="chip small">${h(a.versions.join(" · "))}</span><span class="chip small mono">gas ~${h(a.gas)}</span><button type="button" class="btn icon" data-action="analyze" aria-label="Atualizar cotações">${ICON.refresh}</button>`
    }) + `
<div class="page column">
${bestCard}
<section class="card" aria-labelledby="t-pools" style="padding:20px 0 8px;gap:12px">
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:0 24px"><h2 id="t-pools">Pools comparadas</h2><span class="faint" style="font-size:13px">Ordenadas pela quantidade recebida · escolhe uma linha para a usar</span></div>
<div class="table-wrap"><table class="pools">
<thead><tr><th scope="col">Pool</th><th scope="col">Fee</th><th scope="col" class="num">TVL</th><th scope="col" class="num">Recebes (${h(a.symbolOut)})</th><th scope="col" class="num">Impacto</th><th scope="col" class="num">Gas</th><th scope="col" class="num">Líquido</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<div class="faint" style="display:flex;flex-wrap:wrap;gap:8px 20px;padding:6px 24px 10px;font-size:13px"><span>V2: ${a.counts.V2}</span><span>V3: ${a.counts.V3}</span><span>V4: ${a.counts.V4}</span></div>
</section>
${chosen ? `<div class="card" style="flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:18px 24px">
<div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:14px;font-weight:500">Pool escolhida: ${h(chosen.version)} · ${h(chosen.fee)} · ${h(chosen.detail)}</span><span class="faint" style="font-size:13px">${h(chosenNote)}</span></div>
<button type="button" class="btn outline" data-action="prepare" data-index="${chosen.index}" ${S.busy.prepare ? "disabled" : ""}>Continuar para o resumo</button>
</div>` : ""}
</div>`;
}


// ============================================================
// ECRÃ: RESUMO
// ============================================================

function viewSummary() {

    if (S.busy.prepare) {
        const k = walletKey();
        const [lt, ls] = k === "ledger"
            ? ["A ler a carteira na Ledger…", "Desbloqueia a Ledger e abre a app Ethereum. Fecha o Ledger Live se estiver aberto."]
            : k === "local"
                ? ["A ler a carteira importada…", "A ler saldos e autorizações na rede."]
            : k === "trezor"
                ? ["A ler a carteira na Trezor…", "Liga e desbloqueia a Trezor. Fecha o Trezor Suite se estiver aberto. Se pedir PIN ou passphrase, responde no ecrã que aparece."]
                : ["A ler a conta na " + W().name + "…", "A página de ligação tem de estar aberta no navegador."];
        return topbar({ title: "Resumo do swap" }) +
            loadingCard(lt, ls, "cancel-prepare", "Cancelar e voltar à análise");
    }

    if (S.prepareError || !S.prepared) {
        return topbar({ title: "Resumo do swap", back: { view: "pools", label: "Voltar à análise" } }) + `
<div class="page"><section class="card" style="flex:1 1 100%;max-width:720px">
<h2>Não foi possível preparar o swap</h2>
${notice("bad", S.prepareError || "Faz primeiro a análise de pools.")}
<div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" class="btn" data-action="nav" data-view="pools">Voltar à análise</button>${isLocal() && !S.ledger.connected ? `<button type="button" class="btn outline" data-action="unlock-open" data-address="${h(S.settings.localAddress)}">Desbloquear</button>` : ""}${S.analysis ? `<button type="button" class="btn primary" data-action="prepare" data-index="${S.selectedPool}">Tentar de novo</button>` : ""}</div>
</section></div>`;
    }

    const p = S.prepared;

    const txs = p.transactions.map((t, i) => {
        const n = p.transactions.slice(0, i + 1).filter(x => x.needed).length;
        return `<li style="display:flex;gap:12px;align-items:flex-start;${t.needed ? "" : "color:#8496B3"}">
<span style="flex:0 0 auto;width:24px;height:24px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;${t.needed ? "background:#2E9BFF;color:#04121F" : "border:1px solid #2A4060"}">${t.needed ? n : "–"}</span>
<span style="font-size:14px;line-height:1.45">${h(t.title)}<br><span style="font-size:12px;color:#8496B3">${h(t.note)}</span></span></li>`;
    }).join("");

    const balances = p.balances.map(b => `<div style="display:flex;justify-content:space-between"><span class="faint">${h(b.symbol)}</span><span class="mono">${h(b.text)}</span></div>`).join("");

    const protectBadge = p.protect
        ? `<span class="badge good">${ICON.shield}Proteção MEV ativa</span>`
        : `<span class="badge muted">${p.protectApplicable ? "Sem proteção MEV" : "Proteção MEV não aplicável"}</span>`;

    return topbar({
        title: "Resumo do swap",
        back: { view: "pools", label: "Voltar à análise" },
        sub: "Revê tudo antes de assinar. Nada é enviado até confirmares aqui e na " + h(W().name) + ".",
        actions: protectBadge
    }) + `
<div class="page">
<section class="card grow-wide" aria-labelledby="t-troca" style="gap:20px">
<h2 id="t-troca">A troca</h2>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px">
<div class="field" style="flex:1 1 160px"><span class="label">Vendes</span><span class="mono" style="font-size:26px">${h(p.amountIn)} <span class="muted" style="font-size:16px">${h(p.symbolIn)}</span></span></div>
<span class="muted">${ICON.arrow}</span>
<div class="field" style="flex:1 1 160px"><span class="label">Recebes (estimado)</span><span class="mono" style="font-size:26px">${h(p.expectedOut)} <span class="muted" style="font-size:16px">${h(p.symbolOut)}</span></span></div>
</div>
<dl class="kv">
<dt>Mínimo garantido</dt><dd><span class="mono">${h(p.minOut)} ${h(p.symbolOut)}</span> <span class="faint">(slippage ${h(p.slippage)}%)</span></dd>
<dt>Pool</dt><dd>${h(p.pool.version)} · ${h(p.pool.fee)} · ${h(p.pool.detail)}</dd>
<dt>Rede</dt><dd>${h(p.chainName)}</dd>
<dt>Carteira</dt><dd><span class="mono">${h(p.addressShort)}</span> <span class="faint">(${h(p.path)})</span></dd>
<dt>Velocidade</dt><dd>${h(p.speed)}</dd>
<dt>Envio</dt><dd>${p.wallet && p.wallet.browser ? "Pela " + h(p.wallet.name) + " (a carteira escolhe o RPC)" : p.protect ? "Privado via " + h(p.protect.name) + " · nova cotação antes de assinar" : p.protectApplicable ? "Mempool público" : "Sequenciador da rede (sem mempool público)"}</dd>
<dt>Prazo</dt><dd>${h(p.deadline)}</dd>
<dt>Router</dt><dd class="mono">Uniswap Universal Router · ${h(p.router)}</dd>
</dl>
</section>

<div class="grow-narrow" style="display:flex;flex-direction:column;gap:24px">
<section class="card" aria-labelledby="t-tx" style="gap:14px"><h2 id="t-tx">Transações a assinar</h2><ol style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px">${txs}</ol></section>
<section class="card" aria-labelledby="t-bal" style="gap:10px;font-size:14px;padding:20px 24px"><h2 id="t-bal">Saldos atuais</h2>${balances}</section>
${p.blocking ? notice("bad", p.blocking) : ""}
${p.warnings.map(w => notice("warn", w)).join("")}
${notice("warn", signNotice())}
<div style="display:flex;flex-wrap:wrap;gap:12px">
<button type="button" class="btn big" style="flex:1 1 120px" data-action="nav" data-view="swap">Cancelar</button>
<button type="button" class="btn primary big" style="flex:2 1 220px" data-action="confirm" ${p.blocking ? "disabled" : ""}>${isBrowser() || isLocal() ? "" : ICON.ledger}Confirmar e assinar</button>
</div>
</div>
</div>`;
}


function signNotice() {
    const k = walletKey();
    if (k === "ledger") return "Vais ter de confirmar a transação no ecrã da Ledger. O \"Blind signing\" tem de estar ativo na app Ethereum.";
    if (k === "trezor") return "Vais ter de confirmar a transação no ecrã da Trezor (Trezor Suite fechado).";
    if (k === "local") return "Ao carregares em Confirmar, a app assina logo com a chave importada, sem outra confirmação. Revê bem o resumo.";
    return "Cada transação abre uma janela da " + W().name + " no navegador: confirma lá. Deixa a página de ligação aberta.";
}


// ============================================================
// ECRÃ: ASSINATURA E PROGRESSO
// ============================================================

function viewExec() {

    const e = S.exec;

    if (!e) {
        return topbar({ title: "Assinar na " + W().name }) + `<div class="page"><section class="card"><p class="hint">Não há nenhum swap em curso.</p></section></div>`;
    }

    const active = e.steps.find(s => s.state === "active");
    const signing = active && (active.id === "sign" || ((active.id === "approve" || active.id === "permit2") && /^Confirma/.test(active.sub || "")));
    const wn = W().name;
    const browser = isBrowser();

    const steps = e.steps.map(s => `
<li class="${s.state}"><div class="step-mark"><span class="step-dot">${s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</span><span class="step-line"></span></div>
<div class="step-text"><span class="step-title">${h(s.title)}</span><span class="step-sub">${h(s.sub || "")}</span></div></li>`).join("");

    const status = e.error
        ? notice("bad", e.error)
        : `<div class="waiting">${e.running ? '<span class="pulse"></span>' : ""}${h(signing ? (isLocal() ? "A assinar com a chave importada" : (browser ? "À espera da confirmação na " : "À espera da assinatura na ") + wn) : active ? active.title + "…" : "A preparar…")}</div>`;

    const local = isLocal();
    const graphic = local
        ? `<div class="browser-mock" aria-hidden="true"><div class="popup">${monogram("local", true)}<b>${signing ? "A assinar…" : "Chave importada"}</b><span>${h(shortAddr(S.settings.localAddress))}</span></div></div>`
        : browser
        ? `<div class="browser-mock" aria-hidden="true"><div class="bar"><i></i><i></i><i></i></div><div class="popup">${monogram(walletKey(), true)}<b>${signing ? "Confirmar transação" : wn}</b>${signing ? '<span class="ok"></span>' : "<span>pronta</span>"}</div></div>`
        : `<div class="device" aria-hidden="true"><div class="screen">${signing ? "Review transaction<small>" + (walletKey() === "ledger" ? "Blind signing" : "Confirm") + "</small>" : "Ethereum<small>" + (walletKey() === "ledger" ? "application is ready" : "ready") + "</small>"}</div><div class="wheel"></div></div>`;

    const headline = local
        ? (signing ? "A assinar com a chave importada" : e.error ? "O swap parou" : "Assinatura nesta app")
        : signing
        ? (browser ? "Confirma a transação na " + wn : "Confirma a transação na tua " + wn)
        : e.error ? "O swap parou" : browser ? "Mantém a página de ligação aberta" : "Mantém a " + wn + " ligada e desbloqueada";

    const explain = local
        ? (e.error ? "Nada foi enviado depois do passo marcado a vermelho." : "Cada transação é assinada aqui com a chave importada e enviada " + (S.prepared && S.prepared.protect ? "em privado." : "para a rede."))
        : signing
        ? (browser ? "Abre a janela da extensão no navegador (se não abrir sozinha, clica no ícone da " + wn + ") e confirma. Se rejeitares, nada é enviado."
            : walletKey() === "ledger" ? "Percorre os ecrãs com os botões e aprova em \"Accept and send\". Se rejeitares, nada é enviado."
                : "Confere o destino e o valor no ecrã da Trezor e confirma. Se rejeitares, nada é enviado.")
        : e.error ? "Nada foi enviado depois do passo marcado a vermelho."
            : browser ? "Cada transação aparece na janela da " + wn + " antes de ser enviada." : "Cada transação é mostrada no ecrã da " + wn + " antes de ser assinada.";

    return topbar({
        title: local ? "Assinar e enviar" : browser ? "Confirmar na " + wn : "Assinar na " + wn,
        sub: S.prepared ? `<span class="mono">${h(S.prepared.amountIn)} ${h(S.prepared.symbolIn)} → ${h(S.prepared.expectedOut)} ${h(S.prepared.symbolOut)}</span> · ${h(S.prepared.pool.version)} ${h(S.prepared.pool.fee)}` : "",
        actions: S.prepared && S.prepared.protect ? `<span class="badge good">${ICON.shield}Envio privado · ${h(S.prepared.protect.name)}</span>` : ""
    }) + `
<div class="page">
<section class="card grow-wide" aria-labelledby="t-device" style="align-items:center;text-align:center;gap:24px;padding:32px 24px">
${graphic}
<div style="display:flex;flex-direction:column;gap:8px;max-width:440px">
<h2 id="t-device" style="font-size:22px">${h(headline)}</h2>
<p class="hint" style="font-size:14px">${h(explain)}</p>
</div>
${status}
</section>
<section class="card grow-narrow" aria-labelledby="t-steps" style="gap:18px">
<h2 id="t-steps">Progresso</h2>
<ol class="steps" aria-live="polite">${steps}</ol>
${e.running ? `<p class="hint">Não feches a app enquanto o swap estiver em curso.</p>` : `<div style="display:flex;flex-wrap:wrap;gap:12px"><button type="button" class="btn" style="flex:1 1 120px" data-action="nav" data-view="swap">Novo swap</button>${S.prepared ? `<button type="button" class="btn outline" style="flex:1 1 160px" data-action="nav" data-view="summary">Voltar ao resumo</button>` : ""}</div>`}
</section>
</div>`;
}


// ============================================================
// ECRÃ: CONCLUÍDO
// ============================================================

function viewDone() {

    const r = S.exec && S.exec.result;

    if (!r) {
        return topbar({ title: "Swap concluído" }) + `<div class="page"><section class="card"><p class="hint">Ainda não há nenhum swap concluído.</p></section></div>`;
    }

    const balances = r.balances.map(b => `<div style="display:flex;justify-content:space-between;gap:12px"><span class="faint">${h(b.symbol)}</span><span class="mono">${h(b.text)}</span></div>`).join("");

    return `<div class="page center" style="padding-top:48px">
<div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
<span class="success-icon">${ICON.check}</span>
<h1 style="margin:0;font-size:28px;font-weight:600">Swap concluído</h1>
<p class="muted" style="margin:0;font-size:16px">${r.received !== null
        ? `Recebeste <span class="mono" style="color:#EAF2FF">${h(r.received)} ${h(r.symbolOut)}</span> por <span class="mono" style="color:#EAF2FF">${h(r.amountIn)} ${h(r.symbolIn)}</span>`
        : `Vendeste <span class="mono" style="color:#EAF2FF">${h(r.amountIn)} ${h(r.symbolIn)}</span> por ${h(r.symbolOut)}`}</p>
</div>
<div style="width:100%;max-width:860px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<section class="card" style="flex:1 1 380px" aria-labelledby="t-tx"><h2 id="t-tx">Transação</h2>
<dl class="kv">
<dt>Hash</dt><dd style="display:flex;align-items:center;gap:8px"><span class="mono">${h(r.hashShort)}</span><button type="button" class="btn icon" style="width:36px;min-height:36px" data-action="copy" data-text="${h(r.hash)}" aria-label="Copiar hash">${ICON.copy}</button></dd>
<dt>Bloco</dt><dd class="mono">${h(r.block)}</dd>
<dt>Pool</dt><dd>${h(r.pool.version)} · ${h(r.pool.fee)} · ${h(r.pool.detail)}</dd>
<dt>Envio</dt><dd>${r.protect ? "Privado via " + h(r.protect) : "Normal"}</dd>
<dt>Gas</dt><dd class="mono">${h(r.gasUsed)} · ${h(r.gasCost)}</dd>
</dl>
<button type="button" class="link-btn" style="align-self:flex-start;font-size:14px;display:inline-flex;gap:8px;align-items:center;min-height:44px" data-action="open" data-url="${h(r.explorerUrl)}">Ver no ${h(r.explorerName)}${ICON.ext}</button>
</section>
<section class="card" style="flex:1 1 280px" aria-labelledby="t-bal"><h2 id="t-bal">Saldos agora</h2>${balances}${r.nativeNote ? `<p class="hint">${h(r.nativeNote)}</p>` : ""}</section>
</div>
<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px">
<button type="button" class="btn primary big" data-action="new-swap">Novo swap</button>
<button type="button" class="btn big" data-action="nav" data-view="wallets">Ver carteiras</button>
</div>
</div>`;
}


// ============================================================
// ECRÃ: CARTEIRAS
// ============================================================

function isActiveWallet(row) {
    if (isLocal()) return !!S.settings.localAddress && S.settings.localAddress.toLowerCase() === row.address.toLowerCase();
    if (isBrowser()) return !!(S.wallets.data && S.wallets.data.active && S.wallets.data.active.toLowerCase() === row.address.toLowerCase());
    if (walletKey() === "trezor") return Number(S.settings.trezor.index) === row.index;
    const l = S.settings.ledger;
    if (l.mode === "index") return l.index === row.index;
    return S.settings.lastAddress && S.settings.lastAddress.toLowerCase() === row.address.toLowerCase();
}

function viewWallets() {
    const c = chain();
    const w = S.wallets;
    const tokens = [["native", c.nativeSymbol], ["USDC", "USDC"]].map(([k, label]) =>
        `<button type="button" class="pill" style="min-width:76px;font-weight:600" aria-pressed="${w.token === k}" data-action="wallets-token" data-key="${k}">${h(label)}</button>`).join("");

    let list;

    const wn = W().name;
    const browser = isBrowser();
    const local = isLocal();
    const howTo = local
        ? "Carrega em Ler carteiras para ver os saldos das carteiras importadas."
        : walletKey() === "ledger"
        ? "Liga a Ledger, desbloqueia-a e abre a app Ethereum. Depois carrega em Ler carteiras."
        : walletKey() === "trezor"
            ? "Liga a Trezor e desbloqueia-a (fecha o Trezor Suite). Depois carrega em Ler carteiras."
            : "Liga a " + wn + " na página de ligação do navegador. Depois carrega em Ler carteiras.";

    if (w.loading) {
        list = `<div class="empty"><span class="spinner" style="color:#2E9BFF"></span><p>A ler as carteiras na ${h(wn)}…</p></div>`;
    } else if (w.error) {
        list = `<div style="padding:24px;display:flex;flex-direction:column;gap:12px">${notice("bad", w.error)}${browser ? `<button type="button" class="btn primary" style="align-self:flex-start" data-action="nav" data-view="connect">Ligar a ${h(wn)}</button>` : ""}</div>`;
    } else if (!w.data) {
        list = `<div class="empty"><p>${h(howTo)}</p><button type="button" class="btn primary" data-action="wallets-load">Ler carteiras</button></div>`;
    } else {
        list = w.data.rows.map(r => {
            const active = isActiveWallet(r);
            return `<div class="wallet-row ${active ? "active" : ""}">
<div style="flex:1 1 280px;display:flex;align-items:center;gap:14px;min-width:0">
<span class="wallet-index">${r.index}</span>
<div style="display:flex;flex-direction:column;gap:3px;min-width:0">
<span style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:500">${local ? h(r.label || "Carteira importada") : browser ? "Conta " + (r.index + 1) : "Ethereum " + (r.index + 1)}${active ? '<span class="tag good">Ativa</span>' : ""}</span>
<span class="mono" style="font-size:13px;color:#C3D2E8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(r.address)}</span>
<span class="mono faint" style="font-size:12px">${h(r.path)}</span>
</div></div>
<div style="flex:0 1 200px;display:flex;flex-direction:column;align-items:flex-end;gap:2px"><span class="mono" style="font-size:16px;font-weight:500">${h(r.balance)} ${h(w.data.symbol)}</span>${r.usd ? `<span class="mono faint" style="font-size:13px">${h(r.usd)}</span>` : ""}</div>
<div style="flex:0 0 auto;display:flex;gap:8px">
<button type="button" class="btn icon" data-action="copy" data-text="${h(r.address)}" aria-label="Copiar endereço">${ICON.copy}</button>
${active ? `<button type="button" class="btn" style="min-width:140px;color:#5CEBD3;border-color:#0E5A55" aria-pressed="true" disabled>Carteira ativa</button>` : local ? `<button type="button" class="btn primary" style="min-width:140px" data-action="unlock-open" data-address="${h(r.address)}">Usar esta</button>` : browser ? `<span class="faint" style="min-width:140px;font-size:12px;text-align:center">Escolhe-a na extensão</span>` : `<button type="button" class="btn primary" style="min-width:140px" data-action="use-wallet" data-index="${r.index}" data-address="${h(r.address)}">Usar esta</button>`}
</div></div>`;
        }).join("") + `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:16px 24px 10px">
${w.data.more === false && local ? `<button type="button" class="btn outline" data-action="import-open" ${(S.imported || []).length >= MAX_IMPORTED ? "disabled" : ""}>Importar chave privada (${(S.imported || []).length}/${MAX_IMPORTED})</button>` : w.data.more === false ? `<span class="faint" style="font-size:13px">Contas autorizadas na ${h(wn)}. Para usar outra, muda de conta na extensão.</span>` : `<button type="button" class="btn outline" data-action="wallets-more" ${w.loadingMore ? "disabled" : ""}>${w.loadingMore ? '<span class="spinner"></span>A ler…' : "Mostrar as próximas " + WALLET_PAGE}</button>`}
<span style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap"><span class="muted" style="font-size:14px">Total nas ${w.data.rows.length} carteiras</span><span class="mono" style="font-size:16px;font-weight:500">${h(fmtTotal(w.data.total))} ${h(w.data.symbol)}</span>${w.data.hasUsd ? `<span class="mono faint" style="font-size:13px">$${h(w.data.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span>` : ""}</span>
</div>${w.moreError ? `<div style="padding:0 24px 14px">${notice("bad", w.moreError)}</div>` : ""}`;
    }

    const sub = local
        ? "As tuas carteiras importadas (até " + MAX_IMPORTED + "). Cada uma pede a sua password ao ser usada."
        : walletKey() === "ledger"
        ? "As contas do Ledger Live, de " + WALLET_PAGE + " em " + WALLET_PAGE + ". Escolhe a carteira ativa para os swaps."
        : walletKey() === "trezor"
            ? "As contas do Trezor Suite (m/44'/60'/0'/0/N), de " + WALLET_PAGE + " em " + WALLET_PAGE + ". Escolhe a carteira ativa."
            : "As contas que autorizaste na " + wn + ". A ativa é a selecionada na extensão.";

    const hint = walletKey() === "ledger"
        ? "Os endereços são os mesmos em todas as redes; os saldos são lidos na rede escolhida em cima. Usas a conta no formato legacy do MetaMask? Escolhe \"Procurar pelo endereço\" em Definições › Ledger."
        : "Os endereços são os mesmos em todas as redes; os saldos são lidos na rede escolhida em cima.";

    return topbar({
        title: local ? "Carteiras importadas" : "Carteiras · " + wn,
        sub,
        actions: chainSelect() + (browser ? `<button type="button" class="btn" data-action="nav" data-view="connect">Ligação</button>` : "") + `<button type="button" class="btn" data-action="wallets-load" ${w.loading ? "disabled" : ""}>${ICON.refresh}Ler carteiras</button>`
    }) + `
<div class="page column">
<section class="card" aria-labelledby="t-token" style="flex-direction:row;flex-wrap:wrap;align-items:flex-end;gap:16px 24px;padding:20px 24px">
<div style="display:flex;flex-direction:column;gap:10px"><h2 id="t-token" style="font-size:15px;font-weight:500">Saldo de</h2><div class="pills" role="group" aria-labelledby="t-token">${tokens}</div></div>
<div class="form-row" style="flex:1 1 300px"><label for="token-ca">Outro token (endereço do contrato)</label>
<div style="display:flex;gap:8px"><input id="token-ca" class="input mono" placeholder="0x…" data-model="walletsCa" value="${h(w.ca)}"><button type="button" class="btn outline" data-action="wallets-custom" ${w.token === "custom" ? 'aria-pressed="true"' : ""}>Ver saldos</button></div></div>
</section>
<section class="card" aria-label="Carteiras" style="padding:8px 0;gap:0">${list}</section>
<p class="hint">${h(hint)}</p>
</div>`;
}


// ============================================================
// ECRÃ: DEFINIÇÕES
// ============================================================

function viewSettings() {

    const d = S.draft;
    const status = (n) => {
        if (!S.connStatus) return "";
        const r = S.connStatus.find(x => x.chain === n);
        if (!r) return "";
        return `<span class="${r.ok ? "status-ok" : "status-bad"}"><span class="dot ${r.ok ? "good" : ""}" style="${r.ok ? "" : "background:#F0716B"}"></span>${h(r.text)}</span>`;
    };

    const chains = S.chains.map(c => {
        const checked = d.chain === c.number;
        const tag = !c.supported ? "em breve" : c.protect.length ? "proteção MEV: " + c.protect.length + " serviços" : "sem mempool público";
        return `<label class="radio-item ${checked ? "checked" : ""} ${c.supported ? "" : "disabled"}"><input type="radio" name="d-chain" value="${c.number}" data-change="draft-chain" ${checked ? "checked" : ""} ${c.supported ? "" : "disabled"}><span class="grow">${h(c.name)}</span><span class="side">${h(tag)}</span></label>`;
    }).join("");

    const ethChain = S.chains.find(c => c.number === 1);
    const bscChain = S.chains.find(c => c.number === 3);
    const providerSelect = (id, c) => `<select id="${id}" class="input" data-draft="protectProvider.${c.number}">${c.protect.map(p =>
        `<option value="${h(p.key)}" ${d.protectProvider[String(c.number)] === p.key ? "selected" : ""}>${h(p.name)}</option>`).join("")}</select>`;

    const rpcs = [1, 2, 3].map(n => {
        const c = S.chains.find(x => x.number === n);
        return `<div class="form-row"><label for="rpc-${n}"><span>RPC ${h(c.name)}</span>${status(n)}</label><input id="rpc-${n}" class="input mono" placeholder="${h(c.rpcDefault)}" data-draft="rpc.${n}" value="${h(d.rpc[String(n)])}"></div>`;
    }).join("");

    const modes = [
        ["index", "Conta do Ledger Live", "Pelo índice: 0 = Ethereum 1"],
        ["from", "Procurar pelo endereço", "Procura nos índices 0–9, Ledger Live e legacy"],
        ["path", "Caminho personalizado", "Para utilizadores avançados"]
    ].map(([k, name, sub]) => `<label class="radio-item tall ${d.ledger.mode === k ? "checked" : ""}"><input type="radio" name="d-mode" value="${k}" data-change="draft-mode" ${d.ledger.mode === k ? "checked" : ""}><span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:14px;font-weight:500">${name}</span><span class="faint" style="font-size:12px">${sub}</span></span></label>`).join("");

    const modeField = d.ledger.mode === "index"
        ? `<label for="ledger-value">Índice</label><input id="ledger-value" class="input mono" inputmode="numeric" data-draft="ledger.index" value="${h(d.ledger.index)}">`
        : d.ledger.mode === "from"
            ? `<label for="ledger-value">Endereço</label><input id="ledger-value" class="input mono" placeholder="0x…" data-draft="ledger.from" value="${h(d.ledger.from)}">`
            : `<label for="ledger-value">Caminho de derivação</label><input id="ledger-value" class="input mono" data-draft="ledger.path" value="${h(d.ledger.path)}">`;

    const slipCheck = checkSlip(String(d.slippage).replace(",", "."));

    return topbar({
        title: "Definições",
        sub: "Predefinições usadas em cada swap. Podes mudá-las no ecrã do swap.",
        actions: `<button type="button" class="btn" data-action="settings-reset">Repor predefinições</button><button type="button" class="btn primary" data-action="settings-save">Guardar</button>`
    }) + `
<div class="page">
${S.draftMsg ? `<div style="flex:1 1 100%">${notice(S.draftMsg.kind, S.draftMsg.text, S.draftMsg.kind !== "good")}</div>` : ""}
<div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:24px">
<section class="card" aria-labelledby="t-rede" style="gap:14px"><div><h2 id="t-rede">Rede por omissão</h2><p class="hint">Equivale à opção --chain.</p></div><div class="radio-list" role="radiogroup" aria-labelledby="t-rede">${chains}</div></section>
<section class="card" aria-labelledby="t-swap" style="gap:18px"><h2 id="t-swap">Predefinições do swap</h2>
<div class="grid-2">
<div class="form-row"><label for="d-slip">Slippage (%)</label><input id="d-slip" class="input mono ${slipCheck.ok ? "" : "invalid"}" inputmode="decimal" data-draft="slippage" value="${h(d.slippage)}"></div>
<div class="form-row"><label for="d-fee">Velocidade</label><select id="d-fee" class="input" data-draft="fee">${[[1, "Normal"], [2, "Rápido (+10%)"], [3, "Mais rápido (+30%)"]].map(([n, l]) => `<option value="${n}" ${d.fee === n ? "selected" : ""}>${l}</option>`).join("")}</select></div>
</div>
<div class="grid-2">
<div class="form-row"><label for="d-deadline">Prazo do swap (minutos)</label><input id="d-deadline" class="input mono ${deadlineOk(d.deadlineMinutes) ? "" : "invalid"}" inputmode="numeric" data-draft="deadlineMinutes" value="${h(d.deadlineMinutes)}"></div>
<p class="hint" style="align-self:end">Tempo máximo para o swap entrar num bloco; depois disso é recusado pela rede. Por omissão 3 minutos (1 a 60).</p>
</div>
<div class="opt-head"><div><div class="opt-title" id="lbl-dprot">Proteção MEV ligada por omissão</div><div class="opt-sub">Ignorada nas redes sem mempool público (Arbitrum)</div></div><button type="button" class="switch" aria-labelledby="lbl-dprot" aria-pressed="${d.protect}" data-action="draft-protect"><span class="track"><span class="knob"></span></span></button></div>
<div class="grid-2">
<div class="form-row"><label for="d-prot-eth">Serviço na Ethereum</label>${providerSelect("d-prot-eth", ethChain)}</div>
<div class="form-row"><label for="d-prot-bsc">Serviço na BSC</label>${providerSelect("d-prot-bsc", bscChain)}</div>
</div>
</section>
</div>
<div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:24px">
<section class="card" aria-labelledby="t-lang" style="gap:12px"><div><h2 id="t-lang">Idioma</h2><p class="hint">A app reinicia para mudar o idioma. As definições e as carteiras mantêm-se.</p></div>${langSwitch(false)}</section>
<section class="card" aria-labelledby="t-rpc"><div><h2 id="t-rpc">Ligações</h2><p class="hint">RPC usados para leituras e para envio sem proteção. Vazio = o RPC por omissão.</p></div>
${rpcs}
<div class="form-row"><label for="graph-key">Chave da The Graph</label><div style="display:flex;gap:8px"><input id="graph-key" class="input mono" type="password" autocomplete="off" placeholder="Vazio = pools V4 procuradas on-chain" data-draft="graphKey" value="${h(d.graphKey)}"><button type="button" class="btn icon" data-action="toggle-key" aria-label="Mostrar chave">${ICON.eye}</button></div><span class="faint" style="font-size:12px">Usada para descobrir as pools V4. Fica guardada só neste computador.</span></div>
<button type="button" class="btn" style="align-self:flex-start" data-action="settings-test" ${S.busy.test ? "disabled" : ""}>${S.busy.test ? '<span class="spinner"></span>A testar…' : "Testar ligações"}</button>
<p class="hint">As ligações são testadas com os valores guardados.</p>
</section>
<section class="card" aria-labelledby="t-wallet" style="gap:14px"><h2 id="t-wallet">Carteira</h2>
<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">${monogram(walletKey())}<div style="flex:1 1 160px;display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">${h(W().name)}</span><span class="faint" style="font-size:13px">${h(W().sub || "")}</span></div><button type="button" class="btn outline" data-action="open-chooser">Mudar carteira</button></div>
</section>
<section class="card" aria-labelledby="t-pk" style="gap:12px"><div><h2 id="t-pk">Carteiras importadas</h2><p class="hint">Até ${MAX_IMPORTED}, cada uma cifrada com a sua password neste computador.</p></div>
${(S.imported || []).length ? (S.imported || []).map(w => `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line-soft)">${monogram("local", true)}<div style="flex:1 1 180px;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-weight:500">${h(w.label)}${isLocal() && S.settings.localAddress.toLowerCase() === w.address.toLowerCase() ? ' <span class="tag good">Em uso</span>' : ""}</span><span class="mono faint" style="font-size:12px;overflow-wrap:anywhere">${h(w.address)}</span></div><button type="button" class="btn" style="min-height:36px" data-action="unlock-open" data-address="${h(w.address)}">Usar</button><button type="button" class="btn" style="min-height:36px;color:#F0918C" data-action="remove-open" data-address="${h(w.address)}">Remover</button></div>`).join("") : '<p class="hint">Nenhuma carteira importada.</p>'}
<button type="button" class="btn outline" style="align-self:flex-start" data-action="import-open" ${(S.imported || []).length >= MAX_IMPORTED ? "disabled" : ""}>Importar chave privada (${(S.imported || []).length}/${MAX_IMPORTED})</button>
</section>
${walletKey() === "ledger" ? `<section class="card" aria-labelledby="t-ledger" style="gap:14px"><h2 id="t-ledger">Ledger</h2>
<div class="radio-list" role="radiogroup" aria-labelledby="t-ledger">${modes}</div>
<div class="form-row">${modeField}</div>
</section>` : ""}
${walletKey() === "trezor" ? `<section class="card" aria-labelledby="t-trezor" style="gap:14px"><h2 id="t-trezor">Trezor</h2>
<div class="form-row"><label for="trezor-index">Conta (índice: 0 = conta 1 do Trezor Suite)</label><input id="trezor-index" class="input mono" inputmode="numeric" data-draft="trezor.index" value="${h(d.trezor.index)}"></div>
<p class="hint">Suporte experimental. Caminho m/44'/60'/0'/0/N. Trezor One: o PIN é escrito na app com a grelha baralhada; Model T e Safe: PIN e passphrase no próprio dispositivo.</p>
</section>` : ""}
</div>
</div>`;
}


// ============================================================
// ECRÃ: LIGAR CARTEIRA DO NAVEGADOR
// ============================================================

const CHAIN_HEX = { 1: "0x1", 2: "0xa4b1", 3: "0x38" };

function viewConnect() {

    if (!isBrowser()) {
        return topbar({ title: "Ligar carteira" }) + `<div class="page"><section class="card" style="max-width:720px"><p class="hint">A carteira escolhida (${h(W().name)}) liga por USB: não precisa da página do navegador.</p><button type="button" class="btn outline" style="align-self:flex-start" data-action="open-chooser">Mudar carteira</button></section></div>`;
    }

    const wn = W().name;
    const b = S.bridge || {};
    const c = chain();
    const rightChain = b.chainId && b.chainId === CHAIN_HEX[c.number];

    const steps = [
        { done: !!b.pageOpen, title: "Página de ligação aberta no navegador", sub: b.pageOpen ? "Aberta · mantém o separador aberto" : "Carrega em Abrir página no navegador" },
        { done: !!b.detected, title: wn + " encontrada", sub: b.detected ? "Extensão: " + b.detected : b.pageOpen ? (b.others && b.others.length ? "Não encontrada; o navegador tem: " + b.others.join(", ") : "Não encontrada nesse navegador. Instala a extensão ou abre a página noutro navegador") : "—" },
        { done: !!b.connected, title: "Conta ligada", sub: b.account ? b.account : "Na página, carrega em Ligar e aprova na extensão" },
        { done: !!rightChain, title: "Rede", sub: b.chainId ? (rightChain ? c.name : "A extensão está noutra rede; a app pede a troca para " + c.name + " ao enviar") : "—" }
    ];

    const firstOpen = steps.findIndex(x => !x.done);

    const list = steps.map((x, i) => `<li class="${x.done ? "done" : i === firstOpen ? "now" : ""}"><span class="mark">${x.done ? "✓" : i + 1}</span><span class="t"><span>${h(x.title)}</span><small class="${i === 2 && b.account ? "mono" : ""}">${h(x.sub)}</small></span></li>`).join("");

    return topbar({
        title: "Ligar a " + wn,
        sub: "A " + h(wn) + " vive no navegador. A app abre uma página local (só neste computador) que liga a extensão à app.",
        actions: chainSelect()
    }) + `
<div class="page">
<section class="card grow-wide" style="gap:20px" aria-labelledby="t-conn">
<div style="display:flex;align-items:center;gap:14px">${monogram(walletKey())}<h2 id="t-conn" style="font-size:20px">${b.connected ? h(wn) + " ligada" : "Ligar a " + h(wn)}</h2>${b.connected ? '<span class="tag good">Pronta</span>' : ""}</div>
<ol class="conn-steps" aria-live="polite">${list}</ol>
${b.error ? notice("bad", b.error) : ""}
<div style="display:flex;flex-wrap:wrap;gap:12px">
<button type="button" class="btn primary big" data-action="bridge-open">${b.pageOpen ? "Abrir a página outra vez" : "Abrir página no navegador"}${ICON.ext}</button>
<button type="button" class="btn big" data-action="bridge-copy">${ICON.copy}Copiar endereço da página</button>
${b.connected ? `<button type="button" class="btn outline big" data-action="nav" data-view="swap">Ir para o Swap</button>` : ""}
</div>
</section>
<section class="card grow-narrow" style="gap:14px" aria-labelledby="t-how">
<h2 id="t-how">Como funciona</h2>
<p class="hint">A página abre no navegador por omissão. Se a ${h(wn)} estiver noutro navegador, copia o endereço e cola-o lá.</p>
<p class="hint">Cada approve e cada swap aparecem na janela da ${h(wn)}: confirmas lá. A chave nunca sai da extensão.</p>
<p class="hint">A conta usada é a selecionada na extensão. Para mudar, muda-a na ${h(wn)}.</p>
<p class="hint">Proteção MEV: o envio é feito pela carteira. Usa a proteção da própria carteira ou o RPC MEV Blocker nela.</p>
<p class="hint">Só extensões de navegador. As apps de telemóvel não ligam por aqui.</p>
</section>
</div>`;
}


// ============================================================
// MENU DE ESCOLHA DA CARTEIRA (arranque e "Mudar carteira")
// ============================================================

function renderChooser() {

    const root = document.getElementById("overlay-root");

    if (!S.chooser) {
        root.innerHTML = "";
        document.querySelector(".app").removeAttribute("aria-hidden");
        return;
    }

    document.querySelector(".app").setAttribute("aria-hidden", "true");

    const sel = S.chooser.selected;
    const last = S.settings && S.settings.wallet;

    const card = (w) => `<button type="button" class="wallet-opt" aria-pressed="${w.key === sel}" data-action="chooser-pick" data-key="${h(w.key)}">${monogram(w.key)}<span class="w-text"><span class="w-name">${h(w.name)}${w.key === last && S.chooser.startup ? '<span class="w-tag last">Última usada</span>' : ""}${w.exp ? '<span class="w-tag exp">Experimental</span>' : ""}</span><span class="w-sub">${h(w.sub)}</span></span></button>`;

    const all = S.walletList.filter(x => x.key !== "local").map(x => W(x.key));
    const hw = all.filter(w => w.group === "hw").map(card).join("");
    const br = all.filter(w => w.group === "br").map(card).join("");
    const chosen = W(sel);

    const imported = S.imported || [];
    const lastLocal = last === "local" && S.settings.localAddress ? S.settings.localAddress.toLowerCase() : null;
    const pk = imported.map(w => {
        const key = "local:" + w.address;
        return `<button type="button" class="wallet-opt" aria-pressed="${key === sel}" data-action="chooser-pick" data-key="${h(key)}">${monogram("local")}<span class="w-text"><span class="w-name">${h(w.label)}${lastLocal === w.address.toLowerCase() && S.chooser.startup ? '<span class="w-tag last">Última usada</span>' : ""}</span><span class="w-sub mono">${h(shortAddr(w.address))}</span><span class="w-sub">Pede a password desta carteira</span></span></button>`;
    }).join("") + (imported.length < MAX_IMPORTED
        ? `<button type="button" class="wallet-opt add" data-action="import-open"><span class="wallet-mono" style="background:#13243F;color:#5CEBD3;border:1px dashed #2E5486" aria-hidden="true">+</span><span class="w-text"><span class="w-name">Importar chave privada</span><span class="w-sub">${imported.length} de ${MAX_IMPORTED} usadas · cada uma com a sua password</span></span></button>`
        : `<div class="wallet-opt add" style="cursor:default"><span class="w-text"><span class="w-name">Limite de ${MAX_IMPORTED} atingido</span><span class="w-sub">Remove uma em Definições › Carteiras importadas para importar outra.</span></span></div>`);

    root.innerHTML = `<div class="chooser" role="dialog" aria-modal="true" aria-labelledby="ch-title">
<div class="chooser-inner">
<div class="chooser-head"><img src="logo-mark.png" alt="" width="64" height="64"><div style="flex:1 1 auto"><h1 id="ch-title">Escolhe a carteira</h1><p>Com qual carteira vais assinar os swaps nesta sessão?</p></div>${langSwitch(true)}</div>
<section class="chooser-group" aria-labelledby="ch-hw"><h2 id="ch-hw">Carteiras de hardware · USB</h2><div class="wallet-grid">${hw}</div></section>
<section class="chooser-group" aria-labelledby="ch-br"><h2 id="ch-br">Carteiras do navegador · extensão</h2><div class="wallet-grid">${br}</div></section>
<section class="chooser-group" aria-labelledby="ch-pk"><h2 id="ch-pk">Carteiras importadas · chave privada</h2><div class="wallet-grid">${pk}</div></section>
<div class="chooser-foot">
<p>${sel && sel.startsWith("local:") ? "A chave está cifrada neste computador. Vais escrever a password desta carteira; fica desbloqueada até fechares a app, a bloqueares ou passarem 30 min sem uso." : chosen.browser ? "A app abre uma página local no navegador para ligar a " + h(chosen.name) + ". Deixa-a aberta enquanto usas a app." : chosen.key === "trezor" ? "Fecha o Trezor Suite antes de usar a app: só uma aplicação de cada vez fala com a Trezor." : "Fecha o Ledger Live antes de usar a app: só uma aplicação de cada vez fala com a Ledger."}</p>
<div style="display:flex;gap:12px;flex-wrap:wrap">${S.chooser.startup ? "" : `<button type="button" class="btn big" data-action="chooser-close">Cancelar</button>`}<button type="button" class="btn primary big" data-action="chooser-go" ${sel ? "" : "disabled"}>Continuar com ${h(chosen.name)}${ICON.arrow}</button></div>
</div>
</div></div>`;

    const btn = root.querySelector('.wallet-opt[aria-pressed="true"]') || root.querySelector(".wallet-opt");
    if (btn && S.chooser.focus) {
        btn.focus();
        S.chooser.focus = false;
    }
}


// ============================================================
// TREZOR: PIN (Trezor One) E PASSPHRASE
// ============================================================

function trezorModal() {

    const u = S.walletUi;

    if (u.type === "pin") {
        const order = [7, 8, 9, 4, 5, 6, 1, 2, 3];
        return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tz-title">
<h2 id="tz-title">PIN da Trezor</h2>
<p class="hint" style="margin:0">Os números estão baralhados no ecrã da Trezor. Carrega aqui nas posições correspondentes aos dígitos do teu PIN.</p>
${u.invalid ? notice("bad", "PIN errado. Tenta de novo.") : ""}
<div class="pin-dots" aria-live="polite">${"•".repeat((u.value || "").length) || "&nbsp;"}</div>
<div class="pin-grid">${order.map(n => `<button type="button" data-action="pin-key" data-n="${n}" aria-label="Posição ${n}">•</button>`).join("")}</div>
<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button type="button" class="btn" data-action="pin-del">Apagar</button><div style="display:flex;gap:10px"><button type="button" class="btn" data-action="tz-cancel">Cancelar</button><button type="button" class="btn primary" data-action="pin-ok" ${(u.value || "").length ? "" : "disabled"}>Desbloquear</button></div></div>
</div></div>`;
    }

    if (u.type === "passphrase") {
        return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="tz-title">
<h2 id="tz-title">Passphrase da Trezor</h2>
<p class="hint" style="margin:0">A tua Trezor tem a passphrase ativa. Cada passphrase abre uma carteira diferente; sem passphrase é a carteira normal.</p>
<div class="form-row"><label for="tz-pass">Passphrase</label><input id="tz-pass" class="input mono" type="password" autocomplete="off"></div>
<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
${u.onDevice ? `<button type="button" class="btn" data-action="pass-device">Escrever na Trezor</button>` : ""}
<button type="button" class="btn" data-action="pass-empty">Sem passphrase</button>
<button type="button" class="btn primary" data-action="pass-ok">Usar esta</button>
</div>
</div></div>`;
    }

    return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><h2>Confirma na Trezor</h2><p class="hint" style="margin:0">Segue as instruções no ecrã da Trezor.</p></div></div>`;
}


// ============================================================
// CARTEIRAS IMPORTADAS: importar, desbloquear, remover
//
// As chaves e passwords são lidas dos campos só no momento de
// enviar ao processo principal e nunca ficam guardadas no estado.
// ============================================================

const MAX_IMPORTED = 5;

function openSecure(state) {
    S.secure = Object.assign({ error: null, busy: false }, state);
    renderSecure();
    const first = document.querySelector("#secure-root input");
    if (first) first.focus();
}

function closeSecure() {
    S.secure = null;
    renderSecure();
}

function renderSecure() {

    const root = document.getElementById("secure-root");
    const m = S.secure;

    if (!m) {
        root.innerHTML = "";
        return;
    }

    const err = m.error ? notice("bad", m.error) : "";
    const busy = m.busy;
    let body;

    if (m.mode === "import") {
        body = `<h2 id="sec-title">Importar chave privada</h2>
<p class="hint" style="margin:0">A chave fica cifrada neste computador com a password que escolheres, exclusiva desta carteira. ${(S.imported || []).length} de ${MAX_IMPORTED} carteiras importadas.</p>
<div class="form-row"><label for="imp-label">Nome (opcional)</label><input id="imp-label" class="input" maxlength="40" autocomplete="off" placeholder="Ex.: Carteira de trading"></div>
<div class="form-row"><label for="imp-key">Chave privada</label><div style="display:flex;gap:8px"><input id="imp-key" class="input mono" type="password" autocomplete="off" spellcheck="false" placeholder="0x… (64 caracteres hexadecimais)"><button type="button" class="btn icon" data-action="secure-peek" data-target="imp-key" aria-label="Mostrar chave">${ICON.eye}</button></div></div>
<div class="grid-2">
<div class="form-row"><label for="imp-pass">Password desta carteira</label><input id="imp-pass" class="input" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
<div class="form-row"><label for="imp-pass2">Repete a password</label><input id="imp-pass2" class="input" type="password" autocomplete="new-password"></div>
</div>
${notice("warn", "Uma chave importada é menos segura do que uma carteira de hardware: quem tiver acesso a este computador e à password consegue usá-la. Usa-a para valores que aceitas arriscar. Se esqueceres a password, só recuperas a carteira importando de novo a chave privada.")}
${err}
<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-action="secure-close" ${busy ? "disabled" : ""}>Cancelar</button><button type="button" class="btn primary" data-action="import-go" ${busy ? "disabled" : ""}>${busy ? '<span class="spinner"></span>A cifrar…' : "Importar e usar"}</button></div>`;
    } else if (m.mode === "unlock" || m.mode === "bundle-unlock") {
        const w = (S.imported || []).find(x => x.address.toLowerCase() === String(m.address).toLowerCase()) || { label: "Carteira importada", address: m.address };
        body = `<h2 id="sec-title">Desbloquear ${h(w.label)}</h2>
<p class="mono faint" style="margin:0;font-size:13px;overflow-wrap:anywhere">${h(w.address)}</p>
<div class="form-row"><label for="unl-pass">Password desta carteira</label><input id="unl-pass" class="input" type="password" autocomplete="current-password"></div>
<p class="hint" style="margin:0">${m.mode === "bundle-unlock" ? "Só para assinar este bundle; a chave sai da memória quando o bundle termina." : "Fica desbloqueada até fechares a app, a bloqueares, escolheres outra carteira ou passarem 30 minutos sem uso."}</p>
${err}
<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-action="secure-close" ${busy ? "disabled" : ""}>Cancelar</button><button type="button" class="btn primary" data-action="${m.mode === "bundle-unlock" ? "bundle-unlock-go" : "unlock-go"}" ${busy ? "disabled" : ""}>${busy ? '<span class="spinner"></span>A abrir…' : "Desbloquear"}</button></div>`;
    } else {
        const w = (S.imported || []).find(x => x.address.toLowerCase() === String(m.address).toLowerCase()) || { label: "Carteira importada", address: m.address };
        body = `<h2 id="sec-title">Remover ${h(w.label)}?</h2>
<p class="mono faint" style="margin:0;font-size:13px;overflow-wrap:anywhere">${h(w.address)}</p>
${notice("bad", "A chave cifrada é apagada deste computador. Os fundos continuam no endereço, mas só voltas a usá-lo importando de novo a chave privada. Tens a chave guardada noutro sítio?")}
${err}
<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-action="secure-close">Cancelar</button><button type="button" class="btn" style="color:#F0918C;border-color:#6B2E33" data-action="remove-go" ${busy ? "disabled" : ""}>Sim, remover</button></div>`;
    }

    root.innerHTML = `<div class="modal-back secure-back"><div class="modal" style="max-width:520px" role="dialog" aria-modal="true" aria-labelledby="sec-title">${body}</div></div>`;
}

async function afterLocal(view, data) {
    S.bundle = null;
    S.settings = data.settings;
    S.imported = data.imported;
    S.secure = null;
    S.chooser = null;
    S.prepared = null;
    S.wallets.data = null;
    S.wallets.error = null;
    S.bridge = null;
    S.ledger = { connected: true, busy: false };
    if (S.swap) S.swap.balance = null;
    renderSecure();
    go(view || (S.view === "connect" ? "swap" : S.view));
    pollNow();
}


// ============================================================
// ECRÃ: BUNDLES
//
// Várias transações num único bloco, enviadas diretamente aos
// builders: tudo ou nada, privado, sem gas se falhar.
// ============================================================

const BUNDLE_MAX_LEGS = 12;

function newLeg(tokenIn, tokenOut) {
    const c = chain();
    return { tokenIn: tokenIn || c.nativeSymbol, tokenOut: tokenOut || "USDC", amount: "" };
}

function bundleState() {
    if (!S.bundle) {
        S.bundle = {
            mode: "atomic",
            legs: [newLeg()],
            mw: { tokenIn: chain().nativeSymbol, tokenOut: "USDC", amount: "", selected: [], rows: null, loading: false, error: null },
            revoke: { tokens: "USDC, " + (chain().wrappedSymbol || "WETH"), erc20: true, permit2: true },
            slip: "0.5",
            fee: 2,
            blocks: "",
            builders: null,
            allowRevert: false,
            versions: ["V2", "V3", "V4"].filter(k => !S.swap || !S.swap.versions || S.swap.versions[k]),
            info: null,
            infoError: null,
            prepared: null,
            prepareError: null,
            busy: false,
            exec: null
        };
    }
    return S.bundle;
}

// Endereço e caminho da carteira ativa (para bundles de uma carteira).
function activeAccount() {
    const s = S.settings;
    const k = walletKey();
    if (k === "local") return s.localAddress ? { address: s.localAddress, path: null } : null;
    if (!s.lastAddress) return null;
    if (k === "trezor") return { address: s.lastAddress, path: "44'/60'/0'/0/" + (Number(s.trezor.index) || 0) };
    if (k === "ledger") {
        const l = s.ledger;
        if (l.mode === "index") return { address: s.lastAddress, path: "44'/60'/" + (Number(l.index) || 0) + "'/0/0" };
        if (l.mode === "path") return { address: s.lastAddress, path: String(l.path).replace(/^m\//, "") };
        return { address: s.lastAddress, path: null };
    }
    return null;
}

async function loadBundleInfo() {
    const b = bundleState();
    try {
        b.info = await call(bridge.bundleInfo({ chain: S.settings.chain }));
        b.infoError = null;
        if (!b.builders) b.builders = b.info.builders.map(x => x.key);
        else b.builders = b.builders.filter(k => b.info.builders.some(x => x.key === k));
        if (!b.builders.length) b.builders = b.info.builders.map(x => x.key);
        if (!b.blocks) b.blocks = String(b.info.defaultBlocks || "");
    } catch (error) {
        b.infoError = error.message;
    }
    if (S.view.startsWith("bundle")) render();
}

function advantages() {
    const items = [
        ["1", "Tudo ou nada", "As transações entram todas no mesmo bloco, pela ordem certa, ou nenhuma entra."],
        ["0", "Sem gas se falhar", "O builder simula o bundle e não o inclui se alguma transação falhar: não pagas nada."],
        ["P", "Privado", "Vai diretamente aos builders, sem passar pelo mempool público: sem sandwich nem frontrun."],
        ["N", "Vários builders", "Enviado a vários builders durante vários blocos para entrar mais depressa."]
    ];
    return `<div class="adv-grid">${items.map(([i, t, s]) => `<div class="adv"><i aria-hidden="true">${i}</i><b>${h(t)}</b><span>${h(s)}</span></div>`).join("")}</div>`;
}

function legsEditor(b, max) {
    const rows = b.legs.map((l, i) => `<div class="leg">
<span class="n">${i + 1}</span>
<input class="input mono" aria-label="Token a vender ${i + 1}" list="bundle-tokens" data-bundle="legs.${i}.tokenIn" value="${h(l.tokenIn)}">
<span class="arrow" aria-hidden="true">→</span>
<input class="input mono" aria-label="Token a receber ${i + 1}" list="bundle-tokens" data-bundle="legs.${i}.tokenOut" value="${h(l.tokenOut)}">
<input class="input mono" aria-label="Montante ${i + 1}" inputmode="decimal" placeholder="0.0" data-bundle="legs.${i}.amount" value="${h(l.amount)}">
${b.legs.length > 1 ? `<button type="button" class="btn icon" style="min-height:40px;width:40px" data-action="bundle-leg-del" data-index="${i}" aria-label="Remover swap ${i + 1}">×</button>` : "<span></span>"}
</div>`).join("");
    return `<div class="leg-head"><span></span><span>Vendes</span><span></span><span>Recebes</span><span>Montante</span><span></span></div>${rows}
${max > 1 ? `<button type="button" class="btn outline" style="align-self:flex-start" data-action="bundle-leg-add" ${b.legs.length >= max ? "disabled" : ""}>+ Adicionar swap (${b.legs.length}/${max})</button>` : ""}`;
}

function tokenDatalist() {
    const c = chain();
    return `<datalist id="bundle-tokens"><option value="${h(c.nativeSymbol)}"><option value="${h(c.wrappedSymbol)}"><option value="USDC"></datalist>`;
}

function walletPicker(b) {
    const mw = b.mw;
    const local = isLocal();
    let list;

    if (local) {
        const unlockedExtra = (b.info && b.info.extraUnlocked) || [];
        list = (S.imported || []).map(w => {
            const on = mw.selected.includes(w.address);
            const open = (S.settings.localAddress && S.settings.localAddress.toLowerCase() === w.address.toLowerCase() && S.ledger.connected) || unlockedExtra.some(a => a.toLowerCase() === w.address.toLowerCase());
            return `<label class="wallet-check ${on ? "on" : ""}"><input type="checkbox" data-change="bundle-wallet" value="${h(w.address)}" ${on ? "checked" : ""}>${monogram("local", true)}<span class="grow"><span style="font-weight:500">${h(w.label)}</span><span class="mono faint" style="font-size:12px">${h(shortAddr(w.address))}</span></span>${open ? '<span class="tag good">Desbloqueada</span>' : `<button type="button" class="btn" style="min-height:34px" data-action="bundle-unlock-open" data-address="${h(w.address)}">Desbloquear</button>`}</label>`;
        }).join("") || `<p class="hint">Ainda não importaste nenhuma carteira.</p>`;
    } else if (mw.loading) {
        list = `<div class="empty" style="padding:18px"><span class="spinner"></span><p>A ler as carteiras na ${h(W().name)}…</p></div>`;
    } else if (mw.error) {
        list = notice("bad", mw.error);
    } else if (!mw.rows) {
        list = `<button type="button" class="btn primary" style="align-self:flex-start" data-action="bundle-wallets-load">Ler carteiras da ${h(W().name)}</button>`;
    } else {
        list = mw.rows.map(r => {
            const on = mw.selected.includes(r.address);
            return `<label class="wallet-check ${on ? "on" : ""}"><input type="checkbox" data-change="bundle-wallet" value="${h(r.address)}" ${on ? "checked" : ""}><span class="wallet-index">${r.index}</span><span class="grow"><span class="mono" style="font-size:13px">${h(r.address)}</span><span class="faint mono" style="font-size:12px">${h(r.path)} · ${h(r.balance)} ${h(mw.symbol || "")}</span></span></label>`;
        }).join("") + `<button type="button" class="btn outline" style="align-self:flex-start" data-action="bundle-wallets-more" ${mw.rows.length >= 20 ? "disabled" : ""}>Mostrar as próximas 5</button>`;
    }

    return `<div style="display:flex;flex-direction:column;gap:8px">${list}</div>`;
}

function viewBundles() {

    const b = bundleState();
    const c = chain();

    const top = topbar({
        title: "Bundles",
        sub: "Várias transações num único bloco, enviadas diretamente aos builders.",
        actions: chainSelect()
    });

    if (!b.info && !b.infoError) {
        loadBundleInfo();
        return top + loadingCard("A carregar…");
    }

    if (b.infoError || !b.info.available) {
        return top + `<div class="page column">${advantages()}
<section class="card" style="max-width:820px;gap:12px"><h2>Bundles não disponíveis</h2>${notice("warn", b.infoError || b.info.reason)}
<p class="hint">Os bundles funcionam na Ethereum e na BNB Smart Chain, com Ledger, Trezor ou carteiras importadas.</p>
<div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" class="btn outline" data-action="open-chooser">Mudar carteira</button></div></section></div>`;
    }

    const modes = [
        ["atomic", "Swap atómico", "Approve + swap no mesmo bloco"],
        ["multiswap", "Vários swaps", "Até 12 swaps da mesma carteira"],
        ["multiwallet", "Várias carteiras", "O mesmo swap em várias carteiras"],
        ["revoke", "Revogar autorizações", "Limpar approvals de vários tokens"]
    ].map(([k, t, s]) => `<button type="button" aria-pressed="${b.mode === k}" data-action="bundle-mode" data-mode="${k}"><span>${h(t)}</span><span>${h(s)}</span></button>`).join("");

    const acc = activeAccount();
    const needAccount = b.mode !== "multiwallet" && !acc;

    let form = "";

    if (b.mode === "atomic") {
        form = `<h2>Swap atómico</h2>
<p class="hint">As autorizações que faltarem (approve, Permit2) e o swap vão juntos no mesmo bloco. Se o swap falhar, as autorizações também não entram e não pagas gas.</p>
${legsEditor(b, 1)}`;
    } else if (b.mode === "multiswap") {
        form = `<h2>Vários swaps</h2>
<p class="hint">Vários swaps da carteira ativa, executados por ordem no mesmo bloco. Ex.: vender vários tokens de uma vez, ou rodar uma posição (A → B e B → C).</p>
${legsEditor(b, BUNDLE_MAX_LEGS)}`;
    } else if (b.mode === "multiwallet") {
        const mw = b.mw;
        form = `<h2>Várias carteiras</h2>
<p class="hint">O mesmo swap, com o mesmo montante, feito por cada carteira escolhida, todas no mesmo bloco.</p>
<div class="leg" style="grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr) minmax(0,0.9fr)">
<input class="input mono" aria-label="Token a vender" list="bundle-tokens" data-bundle="mw.tokenIn" value="${h(mw.tokenIn)}">
<span class="arrow" aria-hidden="true">→</span>
<input class="input mono" aria-label="Token a receber" list="bundle-tokens" data-bundle="mw.tokenOut" value="${h(mw.tokenOut)}">
<input class="input mono" aria-label="Montante por carteira" inputmode="decimal" placeholder="por carteira" data-bundle="mw.amount" value="${h(mw.amount)}">
</div>
<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="opt-title">Carteiras (${mw.selected.length} escolhidas)</span><span class="faint" style="font-size:12px">${isLocal() ? "Cada carteira importada pede a sua password." : "Contas da mesma " + h(W().name) + "."}</span></div>
${walletPicker(b)}`;
    } else {
        const r = b.revoke;
        form = `<h2>Revogar autorizações</h2>
<p class="hint">Retira, num só bundle, as autorizações que a carteira ativa deu ao Permit2 (approve ERC20) e ao Universal Router (Permit2). Útil depois de usares tokens que já não queres deixar autorizados.</p>
<div class="form-row"><label for="b-revoke">Tokens (nomes ou endereços, separados por vírgulas)</label><textarea id="b-revoke" class="input mono" rows="3" style="min-height:76px;padding:10px 12px;resize:vertical" data-bundle="revoke.tokens">${h(r.tokens)}</textarea></div>
<div class="pills" role="group" aria-label="O que revogar"><button type="button" class="pill" aria-pressed="${r.erc20}" data-action="bundle-revoke-opt" data-key="erc20">Approve ERC20 → Permit2</button><button type="button" class="pill" aria-pressed="${r.permit2}" data-action="bundle-revoke-opt" data-key="permit2">Permit2 → Universal Router</button></div>`;
    }

    if (!Array.isArray(b.versions) || !b.versions.length) b.versions = ["V2", "V3", "V4"];
    const bVers = ["V2", "V3", "V4"].map(k => `<button type="button" class="pill round" aria-pressed="${b.versions.includes(k)}" data-action="bundle-version" data-key="${k}">${k}</button>`).join("");
    const slips = SLIP_PRESETS.map(v => `<button type="button" class="pill mono" aria-pressed="${b.slip === v}" data-action="bundle-slip" data-value="${v}">${v}%</button>`).join("");
    const fees = [[1, "Normal", "gorjeta da rede"], [2, "Alta", "+10%"], [3, "Máxima", "+30%"]].map(([n, name, sub]) =>
        `<button type="button" aria-pressed="${b.fee === n}" data-action="bundle-fee" data-value="${n}"><span>${name}</span><span>${sub}</span></button>`).join("");
    const builderPills = b.info.builders.map(x => `<button type="button" class="pill" aria-pressed="${b.builders.includes(x.key)}" data-action="bundle-builder" data-key="${h(x.key)}">${h(x.name)}</button>`).join("");
    const blocksN = Number(b.blocks) || b.info.defaultBlocks;
    const secs = blocksN * b.info.blockSeconds;

    const options = `<h2>Opções do bundle</h2>
${b.mode !== "revoke" ? `<div style="display:flex;flex-direction:column;gap:10px"><span class="opt-title" id="lbl-bver">Tipos de pool</span><div class="pills" role="group" aria-labelledby="lbl-bver">${bVers}</div><span class="faint" style="font-size:12px">Só as pools escolhidas entram na cotação. Desliga a V4 para a excluir.</span></div>` : ""}
${b.mode !== "revoke" ? `<div style="display:flex;flex-direction:column;gap:10px"><span class="opt-title">Slippage máximo</span><div class="pills">${slips}</div></div>` : ""}
<div style="display:flex;flex-direction:column;gap:10px"><span class="opt-title">Prioridade (gorjeta ao builder)</span><div class="seg">${fees}</div></div>
<div class="form-row"><label for="b-blocks">Tentar durante quantos blocos</label><input id="b-blocks" class="input mono" inputmode="numeric" data-bundle="blocks" value="${h(b.blocks)}"><span class="faint" style="font-size:12px">≈ ${secs >= 90 ? Math.round(secs / 60) + " min" : secs + " s"} na ${h(c.name)} · máximo ${b.info.maxBlocks}</span></div>
<div style="display:flex;flex-direction:column;gap:10px"><span class="opt-title">Builders</span><div class="pills">${builderPills}</div></div>
${b.mode === "multiswap" || b.mode === "multiwallet" ? `<div class="opt-head"><div><div class="opt-title" id="lbl-brev">Permitir que um swap falhe</div><div class="opt-sub">Desligado: tudo ou nada. Ligado: os outros swaps entram na mesma (o que falhar paga gas).</div></div><button type="button" class="switch" aria-labelledby="lbl-brev" aria-pressed="${b.allowRevert}" data-action="bundle-allow-revert"><span class="track"><span class="knob"></span></span></button></div>` : ""}
${needAccount ? notice("warn", "Lê primeiro a carteira ativa em Carteiras › Ler carteiras.") : ""}
${b.prepareError ? notice("bad", b.prepareError) : ""}
${b.busy ? `<div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" class="btn primary big" style="flex:2 1 200px" disabled><span class="spinner"></span>A analisar e simular…</button><button type="button" class="btn big" style="flex:1 1 120px" data-action="bundle-cancel">Cancelar</button></div>`
        : `<button type="button" class="btn primary big block" data-action="bundle-prepare" ${needAccount ? "disabled" : ""}>Preparar bundle${ICON.arrow}</button>`}
<p class="hint">Nada é assinado nem enviado neste passo: a app analisa as pools, monta as transações e simula a sequência.</p>`;

    return top + `
<div class="page column">
${advantages()}
<div class="mode-seg" role="group" aria-label="Tipo de bundle">${modes}</div>
<div class="page" style="padding:0">
<section class="card grow-wide" style="gap:14px">${form}${tokenDatalist()}</section>
<section class="card grow-narrow" style="gap:18px">${options}</section>
</div>
</div>`;
}

function viewBundleSummary() {

    const b = bundleState();
    const p = b.prepared;

    if (!p) {
        return topbar({ title: "Resumo do bundle", back: { view: "bundles", label: "Voltar aos bundles" } }) + `<div class="page"><section class="card"><p class="hint">Ainda não há nenhum bundle preparado.</p></section></div>`;
    }

    const legs = p.legs.length ? `<section class="card" style="gap:10px"><h2>Swaps</h2><table class="btable"><tr><th>#</th><th>Carteira</th><th>Troca</th><th>Pool</th><th>Recebes (estimado)</th><th>Mínimo garantido</th></tr>${p.legs.map(l =>
        `<tr><td>${l.n}</td><td class="mono">${h(l.walletLabel || l.wallet)}</td><td>${h(l.pair)}</td><td>${h(l.pool)}</td><td class="mono">${h(l.expected)}</td><td class="mono">${h(l.minOut)}</td></tr>`).join("")}</table></section>` : "";

    const revoke = p.revokeRows ? `<section class="card" style="gap:10px"><h2>Autorizações</h2><table class="btable"><tr><th>Token</th><th>Approve → Permit2</th><th>Permit2 → Universal Router</th></tr>${p.revokeRows.map(r =>
        `<tr><td>${h(r.symbol)}</td><td class="mono">${h(r.erc20)}${r.revokeErc20 ? " → 0" : ""}</td><td class="mono">${h(r.permit2)}${r.revokePermit2 ? " → 0" : ""}</td></tr>`).join("")}</table></section>` : "";

    const txs = `<section class="card" style="gap:10px"><h2>Transações do bundle (${p.txs.length})</h2><table class="btable"><tr><th>#</th><th>Carteira</th><th>Transação</th><th>Gas limit</th></tr>${p.txs.map(t =>
        `<tr><td>${t.n}</td><td class="mono">${h(t.wallet)}</td><td>${h(t.label)}</td><td class="mono">${h(t.gas)}</td></tr>`).join("")}</table></section>`;

    const wallets = `<section class="card" style="gap:10px;font-size:14px"><h2>Carteiras</h2>${p.wallets.map(w =>
        `<div style="display:flex;justify-content:space-between;gap:12px"><span class="mono">${h(w.short)} · ${w.txs} tx</span><span class="mono faint">${h(w.native)} ${h(p.nativeSymbol)} (até ${h(w.need)})</span></div>`).join("")}</section>`;

    const minutes = p.windowSeconds >= 90 ? Math.round(p.windowSeconds / 60) + " min" : p.windowSeconds + " s";

    return topbar({
        title: "Resumo do bundle",
        back: { view: "bundles", label: "Voltar aos bundles" },
        sub: "Revê tudo antes de assinar. Nada é enviado até confirmares aqui e na carteira.",
        actions: `<span class="badge good">${ICON.shield}Privado · tudo ou nada</span>`
    }) + `
<div class="page">
<div class="grow-wide" style="display:flex;flex-direction:column;gap:24px">${legs}${revoke}${txs}</div>
<div class="grow-narrow" style="display:flex;flex-direction:column;gap:24px">
<section class="card" style="gap:6px"><h2>Envio</h2>
<dl class="kv">
<dt>Rede</dt><dd>${h(p.chainName)}</dd>
<dt>Builders</dt><dd>${h(p.builders.join(", "))}</dd>
${p.versions ? `<dt>Pools</dt><dd>${h(p.versions.join(" · "))}</dd>` : ""}
<dt>Janela</dt><dd>${p.blocks} blocos (≈ ${minutes})</dd>
<dt>Gorjeta</dt><dd class="mono">${h(p.tip)}</dd>
<dt>Gas estimado</dt><dd class="mono">${h(p.costEstimate)}</dd>
<dt>Simulação</dt><dd>${p.simulated ? "Sequência simulada: todas passam" : "Feita pelo builder ao receber"}</dd>
<dt>Se falhar</dt><dd>${p.allowRevert ? "Os swaps que falharem pagam gas; os outros entram" : "Nada entra e não pagas gas"}</dd>
</dl></section>
${wallets}
${p.blocking ? notice("bad", p.blocking) : ""}
${p.warnings.map(w => notice("warn", w)).join("")}
${notice("warn", bundleSignNotice(p.txs.length))}
<div style="display:flex;flex-wrap:wrap;gap:12px">
<button type="button" class="btn big" style="flex:1 1 120px" data-action="nav" data-view="bundles">Cancelar</button>
<button type="button" class="btn primary big" style="flex:2 1 220px" data-action="bundle-execute" ${p.blocking ? "disabled" : ""}>Assinar e enviar bundle</button>
</div>
</div>
</div>`;
}

function bundleSignNotice(n) {
    const k = walletKey();
    if (k === "ledger") return "Vais confirmar " + n + " transações no ecrã da Ledger, uma a uma. Nenhuma é enviada antes de assinares todas.";
    if (k === "trezor") return "Vais confirmar " + n + " transações no ecrã da Trezor, uma a uma. Nenhuma é enviada antes de assinares todas.";
    return "A app assina as " + n + " transações com as chaves importadas, sem outra confirmação. Revê bem o resumo.";
}

function viewBundleExec() {

    const b = bundleState();
    const e = b.exec;

    if (!e) {
        return topbar({ title: "Bundle" }) + `<div class="page"><section class="card"><p class="hint">Não há nenhum bundle em curso.</p></section></div>`;
    }

    const steps = e.steps.map(s => `
<li class="${s.state}"><div class="step-mark"><span class="step-dot">${s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</span><span class="step-line"></span></div>
<div class="step-text"><span class="step-title">${h(s.title)}</span><span class="step-sub">${h(s.sub || "")}</span></div></li>`).join("");

    let main;

    if (e.result && e.result.included) {
        const r = e.result;
        main = `<span class="success-icon">${ICON.check}</span><h2 style="font-size:22px">Bundle incluído no bloco ${h(r.block)}</h2>
<p class="hint">Todas as transações entraram juntas${r.reverted ? " (" + r.reverted + " falharam por opção tua)" : ""}. Gas pago: <span class="mono">${h(r.gasCost)}</span>.</p>
<button type="button" class="link-btn" style="font-size:14px;display:inline-flex;gap:8px;align-items:center" data-action="open" data-url="${h(r.blockUrl)}">Ver o bloco${ICON.ext}</button>
<table class="btable" style="text-align:left">${r.txs.map(t => `<tr><td>${h(t.label)}</td><td class="mono"><button type="button" class="link-btn mono" data-action="open" data-url="${h(t.url)}">${h(t.hash.slice(0, 10) + "…" + t.hash.slice(-6))}</button></td><td>${t.ok ? "✓" : "falhou"}</td></tr>`).join("")}</table>`;
    } else if (e.result) {
        const r = e.result;
        main = `<h2 style="font-size:22px">Bundle não incluído</h2>${notice(r.partial ? "bad" : "warn", r.message)}
<table class="btable" style="text-align:left">${r.builders.map(x => `<tr><td>${h(x.builder)}</td><td>${x.ok ? "aceite" : "recusado"}</td><td class="faint">${h(x.error || "")}</td></tr>`).join("")}</table>`;
    } else if (e.error) {
        main = `<h2 style="font-size:22px">O bundle parou</h2>${notice("bad", e.error)}`;
    } else {
        const active = e.steps.find(s => s.state === "active");
        main = `<div class="waiting"><span class="pulse"></span>${h(active ? active.title + "…" : "A preparar…")}</div>
<p class="hint" style="max-width:460px">${h(active && active.id === "sign" ? (walletKey() === "local" ? "A assinar com as chaves importadas." : "Confirma cada transação no dispositivo. Nenhuma é enviada antes de assinares todas.") : "Não feches a app enquanto o bundle estiver em curso.")}</p>`;
    }

    return topbar({ title: "Bundle", sub: e.title ? h(e.title) : "" }) + `
<div class="page">
<section class="card grow-wide" style="align-items:center;text-align:center;gap:18px;padding:32px 24px">${main}</section>
<section class="card grow-narrow" style="gap:18px"><h2>Progresso</h2><ol class="steps" aria-live="polite">${steps}</ol>
${e.running ? "" : `<div style="display:flex;flex-wrap:wrap;gap:12px"><button type="button" class="btn primary" data-action="bundle-new">Novo bundle</button>${e.result && !e.result.included && S.bundle.prepared ? `<button type="button" class="btn outline" data-action="nav" data-view="bundle-summary">Voltar ao resumo</button>` : ""}</div>`}
</section>
</div>`;
}

function bundleParams() {
    const b = bundleState();
    const base = { chain: S.settings.chain, kind: b.mode === "revoke" ? "revoke" : "swaps", slippage: b.slip, fee: b.fee, blocks: Number(b.blocks) || undefined, builders: b.builders, allowRevert: b.allowRevert, versions: b.versions.slice() };
    const acc = activeAccount();
    if (b.mode === "revoke") {
        return Object.assign(base, { address: acc && acc.address, path: acc && acc.path, tokens: b.revoke.tokens.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean), revokeErc20: b.revoke.erc20, revokePermit2: b.revoke.permit2 });
    }
    if (b.mode === "multiwallet") {
        const mw = b.mw;
        const rows = isLocal() ? (S.imported || []).map(w => ({ address: w.address, label: w.label, path: null })) : (mw.rows || []).map(r => ({ address: r.address, label: null, path: r.path }));
        return Object.assign(base, { legs: mw.selected.map(a => {
            const r = rows.find(x => x.address.toLowerCase() === a.toLowerCase()) || { address: a };
            return { address: r.address, path: r.path ? String(r.path).replace(/^m\//, "") : null, label: r.label, tokenIn: mw.tokenIn, tokenOut: mw.tokenOut, amount: mw.amount };
        }) });
    }
    const legs = b.mode === "atomic" ? b.legs.slice(0, 1) : b.legs;
    return Object.assign(base, { legs: legs.map(l => ({ address: acc && acc.address, path: acc && acc.path, tokenIn: l.tokenIn, tokenOut: l.tokenOut, amount: l.amount })) });
}

const BUNDLE_STEPS = [
    { id: "build", title: "Montar o bundle", sub: "Nova cotação e prazo" },
    { id: "simulate", title: "Simulação da sequência", sub: "Se falhar, nada é assinado" },
    { id: "sign", title: "Assinar as transações", sub: "Uma a uma" },
    { id: "check", title: "Simulação final", sub: "Com as transações assinadas" },
    { id: "send", title: "Enviar aos builders", sub: "Privado, fora do mempool" },
    { id: "include", title: "Inclusão num bloco", sub: "Tudo ou nada" }
];

async function bundlePrepare() {
    const b = bundleState();
    const params = bundleParams();

    if (b.mode === "multiwallet") {
        if (!params.legs.length) { b.prepareError = "Escolhe pelo menos uma carteira."; return render(); }
        if (isLocal()) {
            const open = (b.info.extraUnlocked || []).map(a => a.toLowerCase());
            if (S.ledger.connected && S.settings.localAddress) open.push(S.settings.localAddress.toLowerCase());
            const locked = params.legs.find(l => !open.includes(l.address.toLowerCase()));
            if (locked) { b.prepareError = "Desbloqueia todas as carteiras escolhidas antes de preparar o bundle."; return render(); }
        }
    }

    if (params.kind === "swaps" && params.legs.some(l => !(Number(String(l.amount).replace(",", ".")) > 0))) {
        b.prepareError = "Indica o montante de cada swap.";
        return render();
    }

    b.busy = true;
    b.prepareError = null;
    render();

    try {
        b.prepared = await call(bridge.bundlePrepare(params));
        b.busy = false;
        go("bundle-summary");
    } catch (error) {
        b.busy = false;
        if (!error.cancelled) b.prepareError = error.message;
        render();
    }
}

async function bundleExecute() {
    const b = bundleState();
    const p = b.prepared;
    if (!p || p.blocking) return;

    b.exec = {
        title: p.legs.length ? p.legs.length + " swap(s) · " + p.txs.length + " transações" : p.txs.length + " transações",
        steps: BUNDLE_STEPS.map(s => Object.assign({ state: "todo" }, s)),
        running: true, error: null, result: null
    };
    go("bundle-exec");

    try {
        b.exec.result = await call(bridge.bundleExecute());
        b.exec.running = false;
        if (b.exec.result.included) { b.prepared = null; if (S.swap) S.swap.balance = null; }
    } catch (error) {
        b.exec.running = false;
        b.exec.error = error.message;
        const active = b.exec.steps.find(s => s.state === "active") || b.exec.steps.find(s => s.state === "todo");
        if (active) active.state = "error";
    }
    render();
}

async function bundleLoadWallets(more) {
    const mw = bundleState().mw;
    mw.loading = !more;
    mw.error = null;
    render();
    try {
        const start = more && mw.rows ? mw.rows.length : 0;
        const page = await call(bridge.wallets({ chain: S.settings.chain, token: null, start, count: 5 }));
        mw.symbol = page.symbol;
        mw.rows = (more && mw.rows ? mw.rows : []).concat(page.wallets);
    } catch (error) {
        mw.error = error.message;
    }
    mw.loading = false;
    render();
}


// ============================================================
// JANELA DE ESCOLHA DE TOKEN
// ============================================================

function renderModal() {

    const root = document.getElementById("modal-root");

    if (S.walletUi && (S.walletUi.type === "pin" || S.walletUi.type === "passphrase")) {
        root.innerHTML = trezorModal();
        const pass = document.getElementById("tz-pass");
        if (pass) pass.focus();
        return;
    }

    if (!S.modal) {
        root.innerHTML = "";
        return;
    }

    const c = chain();
    const m = S.modal;
    const list = [
        { value: c.nativeSymbol, symbol: c.nativeSymbol, name: c.nativeSymbol + " nativo", addr: "moeda da rede" },
        { value: c.wrappedSymbol, symbol: c.wrappedSymbol, name: c.wrappedSymbol, addr: c.wrapped },
        { value: "USDC", symbol: "USDC", name: "USD Coin", addr: c.usdc }
    ];

    root.innerHTML = `<div class="modal-back" data-action="modal-backdrop">
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
<h2 id="m-title">Token a ${m.side === "in" ? "vender" : "receber"}</h2>
<div class="token-list">${list.map(t => `<button type="button" class="token-item" data-action="modal-choose" data-value="${h(t.value)}" data-symbol="${h(t.symbol)}">${tokenIcon(t.symbol)}<span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-weight:500">${h(t.name)}</span><span class="addr">${h(t.addr)}</span></span></button>`).join("")}</div>
<div class="form-row"><label for="m-ca">Outro token (endereço do contrato)</label><div style="display:flex;gap:8px"><input id="m-ca" class="input mono" placeholder="0x…" autocomplete="off" value="${h(m.ca || "")}"><button type="button" class="btn outline" data-action="modal-custom" ${m.loading ? "disabled" : ""}>${m.loading ? '<span class="spinner"></span>' : "Usar"}</button></div></div>
${m.error ? notice("bad", m.error) : ""}
<div style="display:flex;justify-content:flex-end"><button type="button" class="btn" data-action="modal-close">Cancelar</button></div>
</div></div>`;

    const input = document.getElementById("m-ca");
    if (input && m.focusCa) input.focus();
}


// ============================================================
// RENDER
// ============================================================

const VIEWS = { swap: viewSwap, pools: viewPools, summary: viewSummary, exec: viewExec, done: viewDone, wallets: viewWallets, settings: viewSettings, connect: viewConnect, bundles: viewBundles, "bundle-summary": viewBundleSummary, "bundle-exec": viewBundleExec };

const NAV_OF = { swap: "swap", summary: "swap", exec: "swap", done: "swap", pools: "pools", wallets: "wallets", settings: "settings", connect: "wallets", bundles: "bundles", "bundle-summary": "bundles", "bundle-exec": "bundles" };

function render() {

    const view = document.getElementById("view");

    if (!S.ready) {
        view.innerHTML = S.loadError
            ? `<div class="page"><section class="card" style="max-width:720px"><h2>Não foi possível iniciar o TopCatSwap</h2>${notice("bad", S.loadError)}</section></div>`
            : loadingCard("A iniciar…");
        return;
    }

    view.innerHTML = VIEWS[S.view]();

    document.querySelectorAll(".nav-link").forEach(b => {
        if (b.dataset.view === NAV_OF[S.view]) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
    });

    renderLedgerCard();
    renderModal();
    renderChooser();
}

function renderLedgerCard() {
    const card = document.getElementById("ledger-card");
    if (!S.settings) return;
    const k = walletKey();
    const wn = W().name;
    const busy = S.exec && S.exec.running;
    let dot, title, sub, actions = "";

    if (isLocal()) {
        const open = !!S.ledger.connected;
        dot = busy ? "warn" : open ? "good" : "off";
        title = busy ? "A assinar…" : open ? "Desbloqueada" : "Bloqueada";
        sub = open ? "Chave importada em memória" : "Escreve a password para usar";
        actions = open
            ? `<button type="button" class="btn" data-action="local-lock" ${busy ? "disabled" : ""}>Bloquear</button>`
            : `<button type="button" class="btn" data-action="unlock-open" data-address="${h(S.settings.localAddress)}">Desbloquear</button>`;
    } else if (isBrowser()) {
        const b = S.bridge || {};
        dot = busy ? "warn" : b.connected ? "good" : "off";
        title = busy ? wn + " em uso" : b.connected ? wn + " ligada" : b.pageOpen ? "Página aberta" : wn + " por ligar";
        sub = busy ? "Confirma na extensão" : b.connected ? "Página de ligação aberta" : b.pageOpen ? (b.detected ? "Carrega em Ligar na página" : "Extensão não encontrada") : "Abre a página no navegador";
        actions = b.connected ? "" : `<button type="button" class="btn" data-action="bridge-open">Abrir página</button>`;
    } else {
        const l = S.ledger;
        dot = busy ? "warn" : l.connected ? "good" : "off";
        title = busy ? wn + " em uso" : l.connected ? wn + " ligada" : wn + " não detetada";
        sub = busy ? "Confirma no dispositivo" : l.connected ? (k === "ledger" ? "Abre a app Ethereum para assinar" : "Pronta para assinar") : "Liga o cabo USB e desbloqueia";
    }

    card.innerHTML = `<div class="w-row">${monogram(k, true)}<div style="display:flex;flex-direction:column;gap:2px;min-width:0"><div class="title"><span class="dot ${dot}"></span>${h(title)}</div><div class="sub">${h(sub)}</div></div></div>
<div class="addr">${h(accountLabel())} · ${S.settings.lastAddress ? h(shortAddr(S.settings.lastAddress)) : isBrowser() ? "por ligar" : "por ler"}</div>
<div class="w-actions">${actions}<button type="button" class="btn" data-action="open-chooser" ${busy ? "disabled" : ""}>Mudar carteira</button></div>`;
}

function go(view) {
    S.view = view;
    if (view === "settings") {
        S.draft = JSON.parse(JSON.stringify(S.settings));
        S.draftMsg = null;
    }
    render();
    document.getElementById("view").focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (view === "swap") refreshBalance();
}


// ============================================================
// AÇÕES
// ============================================================

async function refreshBalance(force) {

    if (!S.settings.lastAddress || !S.swap) return;

    const t = S.swap.tokenIn;
    const key = S.settings.chain + ":" + t.value + ":" + S.settings.lastAddress;

    if (!force && S.swap.balance && S.swap.balance.key === key) return;

    S.swap.balance = null;

    try {
        const b = await call(bridge.balance({ chain: S.settings.chain, token: t.value, address: S.settings.lastAddress }));
        if (S.swap.tokenIn === t) S.swap.balance = Object.assign({ key }, b);
    } catch (error) {
        S.swap.balance = { key, error: error.message };
    }

    if (S.view === "swap") render();
}

async function saveSettings(next) {
    S.settings = await call(bridge.saveSettings(next));
}

async function analyze() {

    const sw = S.swap;
    const amount = String(sw.amount).replace(",", ".").trim();
    const slip = effectiveSlip();

    S.swapError = null;

    if (!(Number(amount) > 0)) {
        S.swapError = "Indica a quantidade a vender.";
        return render();
    }
    if (sw.tokenIn.value === sw.tokenOut.value) {
        S.swapError = "Escolhe dois tokens diferentes.";
        return render();
    }
    if (!checkSlip(slip).ok) {
        S.swapError = "Slippage inválido: usa um valor entre 0.01 e 50%.";
        return render();
    }

    const req = ++REQ.analyze;

    S.busy.analyze = true;
    S.analysis = null;
    S.analyzeError = null;
    S.prepared = null;
    go("pools");

    try {

        const result = await call(bridge.analyze({
            chain: S.settings.chain,
            tokenIn: sw.tokenIn.value,
            tokenOut: sw.tokenOut.value,
            amount,
            versions: Object.keys(sw.versions).filter(k => sw.versions[k]),
            fee: sw.fee
        }));

        if (req !== REQ.analyze) return;

        S.analysis = result;
        S.selectedPool = result.bestIndex;

    } catch (error) {

        if (req !== REQ.analyze || error.cancelled) return;

        S.analyzeError = error.message;
        S.swapError = error.message;
        S.view = "swap";
    }

    S.busy.analyze = false;
    render();
}

function cancelAnalyze() {
    REQ.analyze++;
    try { bridge.cancel("analyze"); } catch (_) {}
    S.busy.analyze = false;
    S.analysis = null;
    S.swapError = null;
    go("swap");
}

function cancelPrepare() {
    REQ.prepare++;
    try { bridge.cancel("prepare"); } catch (_) {}
    S.busy.prepare = false;
    S.prepared = null;
    S.prepareError = null;
    go(S.analysis ? "pools" : "swap");
}

async function prepare(index) {

    const sw = S.swap;

    const req = ++REQ.prepare;

    S.selectedPool = index;
    S.busy.prepare = true;
    S.prepareError = null;
    S.prepared = null;
    go("summary");

    try {

        const result = await call(bridge.prepare({
            poolIndex: index,
            slippage: effectiveSlip(),
            fee: sw.fee,
            protect: sw.protect,
            provider: sw.provider,
            deadlineMinutes: S.settings.deadlineMinutes
        }));

        if (req !== REQ.prepare) return;

        S.prepared = result;

        if (result.address && result.address !== S.settings.lastAddress) {
            S.settings.lastAddress = result.address;
        }

    } catch (error) {

        if (req !== REQ.prepare || error.cancelled) return;

        S.prepareError = error.message;
    }

    S.busy.prepare = false;
    render();
}

async function confirmSwap() {

    const p = S.prepared;

    if (!p || p.blocking) return;

    S.exec = {
        steps: p.plan.map(s => Object.assign({ state: "todo" }, s)),
        running: true,
        error: null,
        result: null
    };

    go("exec");

    try {

        S.exec.result = await call(bridge.execute());
        S.exec.running = false;
        S.prepared = null;
        S.swap.balance = null;
        go("done");

    } catch (error) {

        S.exec.running = false;
        S.exec.error = error.message;

        const active = S.exec.steps.find(s => s.state === "active") || S.exec.steps.find(s => s.state === "todo");
        if (active) active.state = "error";

        render();
    }
}

const WALLET_PAGE = 5;

function fmtTotal(n) {
    if (!Number.isFinite(n) || n === 0) return "0";
    if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return String(Number(n.toFixed(4)));
    return String(Number(n.toPrecision(6)));
}

async function loadWallets(more) {

    const w = S.wallets;
    let token = null;

    if (w.token === "USDC") token = "USDC";
    if (w.token === "custom") {
        if (!/^0x[0-9a-fA-F]{40}$/.test(w.ca.trim())) {
            w.error = "Endereço de token inválido.";
            return render();
        }
        token = w.ca.trim();
    }

    const start = more && w.data ? w.data.rows.length : 0;

    if (more) {
        w.loadingMore = true;
        w.moreError = null;
    } else {
        w.loading = true;
        w.error = null;
    }
    render();

    try {

        const page = await call(bridge.wallets({ chain: S.settings.chain, token, start, count: WALLET_PAGE }));

        if (!more || !w.data || w.data.token !== page.token) {
            w.data = { symbol: page.symbol, token: page.token, rows: [], total: 0, totalUsd: 0, hasUsd: true, more: page.more !== false, active: page.active || null };
        }

        for (const r of page.wallets) {
            if (w.data.rows.some(x => x.index === r.index)) continue;
            w.data.rows.push(r);
            w.data.total += Number(r.amount) || 0;
            if (r.usdValue === null || r.usdValue === undefined) w.data.hasUsd = false;
            else w.data.totalUsd += r.usdValue;
        }

    } catch (error) {
        if (more) w.moreError = error.message;
        else w.error = error.message;
    }

    w.loading = false;
    w.loadingMore = false;
    render();
}

function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
}

async function changeChain(number) {

    if (number === S.settings.chain) return;

    await saveSettings(Object.assign({}, S.settings, { chain: number }));

    S.swap = freshSwap(false);
    S.analysis = null;
    S.prepared = null;
    S.wallets.data = null;
    S.swapError = null;
    if (S.bundle) { S.bundle = null; }
    render();
    refreshBalance();
}


const ACTIONS = {

    "nav": (el) => go(el.dataset.view),

    "open-chooser": () => {
        if (S.exec && S.exec.running) return;
        S.chooser = { selected: isLocal() ? "local:" + S.settings.localAddress : walletKey(), startup: false, focus: true };
        renderChooser();
    },

    "chooser-pick": (el) => {
        S.chooser.selected = el.dataset.key;
        renderChooser();
        const b = document.querySelector('.wallet-opt[aria-pressed="true"]');
        if (b) b.focus();
    },

    "chooser-close": () => {
        S.chooser = null;
        renderChooser();
    },

    "chooser-go": async () => {
        const key = S.chooser.selected;
        if (key && key.startsWith("local:")) {
            return openSecure({ mode: "unlock", address: key.slice(6) });
        }
        const changed = key !== walletKey();
        if (changed) { S.bundle = null; try { bridge.bundleForget(); } catch (_) {} }
        try {
            S.settings = await call(bridge.chooseWallet(key));
        } catch (error) {
            return showFatal(error.message);
        }
        S.chooser = null;
        if (changed) {
            S.prepared = null;
            S.wallets.data = null;
            S.wallets.error = null;
            S.ledger = { connected: false, busy: false };
            S.bridge = null;
            if (S.swap) S.swap.balance = null;
        }
        if (isBrowser()) {
            await refreshBridge();
            go("connect");
            if (!S.bridge || !S.bridge.connected) ACTIONS["bridge-open"]();
        } else {
            go(S.view === "connect" ? "swap" : S.view);
            pollNow();
        }
    },

    "set-lang": async (el) => {
        const lang = el.dataset.lang;
        if (lang === S.lang) return;
        if (S.exec && S.exec.running) return;
        try {
            await call(bridge.setLanguage(lang));
            document.getElementById("view").innerHTML = loadingCard(lang === "en" ? "Restarting…" : "A reiniciar…");
            document.getElementById("overlay-root").innerHTML = "";
        } catch (error) {
            showFatal(error.message);
        }
    },

    "import-open": () => openSecure({ mode: "import" }),

    "bundle-mode": (el) => { const b = bundleState(); b.mode = el.dataset.mode; b.prepareError = null; if (b.mode === "atomic") b.legs = b.legs.slice(0, 1); render(); },

    "bundle-leg-add": () => { const b = bundleState(); if (b.legs.length < BUNDLE_MAX_LEGS) { const last = b.legs[b.legs.length - 1]; b.legs.push(newLeg(last && last.tokenOut, "USDC")); } render(); },

    "bundle-leg-del": (el) => { const b = bundleState(); b.legs.splice(Number(el.dataset.index), 1); if (!b.legs.length) b.legs.push(newLeg()); render(); },

    "bundle-slip": (el) => { bundleState().slip = el.dataset.value; render(); },

    "bundle-fee": (el) => { bundleState().fee = Number(el.dataset.value); render(); },

    "bundle-builder": (el) => {
        const b = bundleState();
        const k = el.dataset.key;
        const next = b.builders.includes(k) ? b.builders.filter(x => x !== k) : b.builders.concat(k);
        if (next.length) b.builders = next;
        render();
    },

    "bundle-version": (el) => {
        const b = bundleState();
        const k = el.dataset.key;
        const next = b.versions.includes(k) ? b.versions.filter(x => x !== k) : ["V2", "V3", "V4"].filter(x => x === k || b.versions.includes(x));
        if (next.length) { b.versions = next; b.prepared = null; b.prepareError = null; }
        render();
    },

    "bundle-allow-revert": () => { const b = bundleState(); b.allowRevert = !b.allowRevert; render(); },

    "bundle-revoke-opt": (el) => {
        const r = bundleState().revoke;
        const k = el.dataset.key;
        const other = k === "erc20" ? "permit2" : "erc20";
        if (r[k] && !r[other]) return;
        r[k] = !r[k];
        render();
    },

    "bundle-wallets-load": () => bundleLoadWallets(false),

    "bundle-wallets-more": () => bundleLoadWallets(true),

    "bundle-unlock-open": (el, event) => { event.preventDefault(); openSecure({ mode: "bundle-unlock", address: el.dataset.address }); },

    "bundle-unlock-go": async () => {
        const input = document.getElementById("unl-pass");
        const password = input.value;
        if (!password) return;
        S.secure.busy = true;
        S.secure.error = null;
        renderSecure();
        try {
            await call(bridge.bundleUnlock({ address: S.secure.address, password }));
            const b = bundleState();
            if (!b.mw.selected.includes(S.secure.address)) b.mw.selected.push(S.secure.address);
            closeSecure();
            await loadBundleInfo();
        } catch (error) {
            S.secure.busy = false;
            S.secure.error = error.message;
            renderSecure();
        }
    },

    "bundle-prepare": () => bundlePrepare(),

    "bundle-cancel": () => { try { bridge.bundleCancel(); } catch (_) {} const b = bundleState(); b.busy = false; b.prepareError = null; render(); },

    "bundle-execute": () => bundleExecute(),

    "bundle-new": () => { const b = bundleState(); b.exec = null; b.prepared = null; go("bundles"); },

    "unlock-open": (el) => openSecure({ mode: "unlock", address: el.dataset.address }),

    "remove-open": (el) => openSecure({ mode: "remove", address: el.dataset.address }),

    "secure-close": () => closeSecure(),

    "secure-peek": (el) => {
        const input = document.getElementById(el.dataset.target);
        if (input) input.type = input.type === "password" ? "text" : "password";
    },

    "import-go": async () => {
        const key = document.getElementById("imp-key");
        const p1 = document.getElementById("imp-pass");
        const p2 = document.getElementById("imp-pass2");
        const label = document.getElementById("imp-label").value;
        const fail = (msg) => { S.secure.error = msg; S.secure.busy = false; const k = key.value, a = p1.value, b = p2.value, l = label; renderSecure(); document.getElementById("imp-key").value = k; document.getElementById("imp-pass").value = a; document.getElementById("imp-pass2").value = b; document.getElementById("imp-label").value = l; };
        if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key.value.trim())) return fail("Chave privada inválida: tem de ter 64 caracteres hexadecimais (com ou sem 0x).");
        if (p1.value.length < 8) return fail("A password tem de ter pelo menos 8 caracteres.");
        if (p1.value !== p2.value) return fail("As passwords não coincidem.");
        const payload = { privateKey: key.value.trim(), password: p1.value, label };
        S.secure.busy = true;
        S.secure.error = null;
        renderSecure();
        try {
            const data = await call(bridge.localImport(payload));
            afterLocal("wallets", data);
        } catch (error) {
            S.secure.busy = false;
            S.secure.error = error.message;
            renderSecure();
        }
    },

    "unlock-go": async () => {
        const input = document.getElementById("unl-pass");
        const password = input.value;
        if (!password) return;
        S.secure.busy = true;
        S.secure.error = null;
        renderSecure();
        try {
            const data = await call(bridge.localUnlock({ address: S.secure.address, password }));
            afterLocal(null, data);
        } catch (error) {
            S.secure.busy = false;
            S.secure.error = error.message;
            renderSecure();
            const again = document.getElementById("unl-pass");
            if (again) again.focus();
        }
    },

    "remove-go": async () => {
        const address = S.secure.address;
        const wasActive = isLocal() && S.settings.localAddress.toLowerCase() === address.toLowerCase();
        try {
            const data = await call(bridge.localRemove(address));
            S.settings = data.settings;
            S.imported = data.imported;
            S.secure = null;
            renderSecure();
            if (wasActive) {
                S.prepared = null;
                S.wallets.data = null;
                S.ledger = { connected: false, busy: false };
                S.chooser = { selected: walletKey(), startup: false, focus: true };
            }
            if (S.view === "settings") S.draft = JSON.parse(JSON.stringify(S.settings));
            render();
        } catch (error) {
            S.secure.error = error.message;
            renderSecure();
        }
    },

    "local-lock": async () => {
        try { await call(bridge.localLock()); } catch (_) {}
        S.ledger = { connected: false, busy: false };
        render();
    },

    "bridge-open": async () => {
        try {
            await call(bridge.openWalletPage());
        } catch (error) {
            S.bridge = Object.assign({}, S.bridge, { error: error.message });
            render();
        }
    },

    "bridge-copy": async (el) => {
        try {
            const url = await call(bridge.walletPageUrl());
            await navigator.clipboard.writeText(url);
            el.innerHTML = ICON.copy + "Copiado";
        } catch (_) {}
    },

    "pin-key": (el) => {
        S.walletUi.value = (S.walletUi.value || "") + el.dataset.n;
        S.walletUi.invalid = false;
        renderModal();
    },

    "pin-del": () => {
        S.walletUi.value = (S.walletUi.value || "").slice(0, -1);
        renderModal();
    },

    "pin-ok": () => {
        const value = S.walletUi.value || "";
        S.walletUi = null;
        renderModal();
        bridge.trezorRespond({ type: "pin", value });
    },

    "tz-cancel": () => {
        S.walletUi = null;
        renderModal();
        bridge.trezorRespond({ type: "cancel" });
    },

    "pass-ok": () => {
        const value = document.getElementById("tz-pass").value;
        S.walletUi = null;
        renderModal();
        bridge.trezorRespond({ type: "passphrase", value });
    },

    "pass-empty": () => {
        S.walletUi = null;
        renderModal();
        bridge.trezorRespond({ type: "passphrase", value: "" });
    },

    "pass-device": () => {
        S.walletUi = null;
        renderModal();
        bridge.trezorRespond({ type: "passphrase", onDevice: true });
    },

    "new-swap": () => {
        S.swap.amount = "";
        go("swap");
    },

    "pick-token": (el) => {
        S.modal = { side: el.dataset.side, ca: "", error: null, loading: false };
        renderModal();
        const first = document.querySelector(".token-item");
        if (first) first.focus();
    },

    "modal-backdrop": (el, event) => {
        if (event.target === el) ACTIONS["modal-close"]();
    },

    "modal-close": () => {
        S.modal = null;
        renderModal();
    },

    "modal-choose": (el) => {
        const t = { value: el.dataset.value, symbol: el.dataset.symbol };
        if (S.modal.side === "in") S.swap.tokenIn = t; else S.swap.tokenOut = t;
        S.modal = null;
        S.swap.balance = null;
        render();
        refreshBalance();
    },

    "modal-custom": async () => {
        const ca = document.getElementById("m-ca").value.trim();
        S.modal.ca = ca;
        if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) {
            S.modal.error = "Endereço inválido: tem de começar por 0x e ter 42 caracteres.";
            S.modal.focusCa = true;
            return renderModal();
        }
        S.modal.loading = true;
        S.modal.error = null;
        renderModal();
        try {
            const info = await call(bridge.tokenInfo({ chain: S.settings.chain, token: ca }));
            const t = { value: info.address, symbol: info.symbol };
            if (S.modal.side === "in") S.swap.tokenIn = t; else S.swap.tokenOut = t;
            S.modal = null;
            S.swap.balance = null;
            render();
            refreshBalance();
        } catch (error) {
            S.modal.loading = false;
            S.modal.error = error.message;
            renderModal();
        }
    },

    "invert": () => {
        const t = S.swap.tokenIn;
        S.swap.tokenIn = S.swap.tokenOut;
        S.swap.tokenOut = t;
        S.swap.balance = null;
        render();
        refreshBalance();
    },

    "max": () => {
        const b = S.swap.balance;
        if (!b || b.error) return;
        let value = Number(b.value);
        if (S.swap.tokenIn.value === chain().nativeSymbol) value = Math.max(0, value - 0.001);
        S.swap.amount = value > 0 ? String(Number(value.toPrecision(12))) : "0";
        render();
    },

    "toggle-protect": () => { S.swap.protect = !S.swap.protect; render(); },

    "provider": (el) => { S.swap.provider = el.dataset.key; render(); },

    "slip": (el) => { S.swap.slip = el.dataset.value; render(); },

    "fee": (el) => { S.swap.fee = Number(el.dataset.value); render(); },

    "version": (el) => {
        const k = el.dataset.key;
        const next = Object.assign({}, S.swap.versions, { [k]: !S.swap.versions[k] });
        if (next.V2 || next.V3 || next.V4) S.swap.versions = next;
        render();
    },

    "analyze": () => analyze(),

    "cancel-analyze": () => cancelAnalyze(),

    "cancel-prepare": () => cancelPrepare(),

    "pick-pool": (el) => { S.selectedPool = Number(el.dataset.index); render(); },

    "prepare": (el) => prepare(Number(el.dataset.index)),

    "confirm": () => confirmSwap(),

    "open": (el) => bridge.openExternal(el.dataset.url),

    "copy": async (el) => {
        try {
            await navigator.clipboard.writeText(el.dataset.text);
            el.setAttribute("aria-label", "Copiado");
            el.style.color = "#5CEBD3";
        } catch (_) {}
    },

    "wallets-token": (el) => {
        S.wallets.token = el.dataset.key;
        S.wallets.data = null;
        loadWallets();
    },

    "wallets-custom": () => {
        S.wallets.ca = document.getElementById("token-ca").value;
        S.wallets.token = "custom";
        S.wallets.data = null;
        loadWallets();
    },

    "wallets-load": () => loadWallets(false),

    "wallets-more": () => loadWallets(true),

    "use-wallet": async (el) => {
        const next = JSON.parse(JSON.stringify(S.settings));
        if (walletKey() === "trezor") {
            next.trezor.index = Number(el.dataset.index);
        } else {
            next.ledger.mode = "index";
            next.ledger.index = Number(el.dataset.index);
        }
        next.lastAddress = el.dataset.address;
        await saveSettings(next);
        S.swap.balance = null;
        S.prepared = null;
        render();
    },

    "draft-protect": () => { S.draft.protect = !S.draft.protect; render(); },

    "toggle-key": () => {
        const input = document.getElementById("graph-key");
        input.type = input.type === "password" ? "text" : "password";
    },

    "settings-reset": () => {
        const keep = { rpc: S.draft.rpc, graphKey: S.draft.graphKey, ledger: S.draft.ledger, lastAddress: S.draft.lastAddress, wallet: S.draft.wallet, trezor: S.draft.trezor, lastAddresses: S.draft.lastAddresses };
        S.draft = Object.assign({
            chain: 1, slippage: "0.5", fee: 1, protect: true,
            protectProvider: { "1": "mevblocker", "3": "merkle" },
            versions: ["V2", "V3", "V4"],
            deadlineMinutes: 3
        }, keep);
        S.draftMsg = { kind: "info", text: "Predefinições do swap repostas. Carrega em Guardar para aplicar." };
        render();
    },

    "settings-save": async () => {
        const d = S.draft;
        if (!checkSlip(String(d.slippage).replace(",", ".")).ok) {
            S.draftMsg = { kind: "bad", text: "Slippage inválido: usa um valor entre 0.01 e 50." };
            return render();
        }
        if (!deadlineOk(d.deadlineMinutes)) {
            S.draftMsg = { kind: "bad", text: "Prazo do swap inválido: usa um número inteiro de minutos entre 1 e 60." };
            return render();
        }
        if (d.ledger.mode === "from" && !/^0x[0-9a-fA-F]{40}$/.test(String(d.ledger.from).trim())) {
            S.draftMsg = { kind: "bad", text: "Endereço da carteira inválido." };
            return render();
        }
        const before = S.settings.ledger;
        const ledgerChanged = before.mode !== d.ledger.mode || Number(before.index) !== Number(d.ledger.index) ||
            before.from !== d.ledger.from || before.path !== d.ledger.path;
        if (walletKey() === "ledger" && ledgerChanged) d.lastAddress = d.ledger.mode === "from" ? String(d.ledger.from).trim() : "";
        if (walletKey() === "trezor" && Number(S.settings.trezor.index) !== Number(d.trezor.index)) d.lastAddress = "";
        const chainChanged = d.chain !== S.settings.chain;
        try {
            await saveSettings(d);
            S.draft = JSON.parse(JSON.stringify(S.settings));
            S.draftMsg = { kind: "good", text: "Definições guardadas." };
            S.swap = freshSwap(!chainChanged);
            if (chainChanged) { S.analysis = null; S.wallets.data = null; }
        } catch (error) {
            S.draftMsg = { kind: "bad", text: error.message };
        }
        render();
    },

    "settings-test": async () => {
        S.busy.test = true;
        render();
        try {
            S.connStatus = await call(bridge.testConnections());
        } catch (error) {
            S.draftMsg = { kind: "bad", text: error.message };
        }
        S.busy.test = false;
        render();
    }
};


document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el, event);
});

document.addEventListener("input", (event) => {
    const el = event.target;

    if (el.dataset.model === "amount") {
        S.swap.amount = el.value;
    } else if (el.dataset.model === "customSlip") {
        S.swap.customSlip = el.value;
        const c = checkSlip(effectiveSlip());
        const hint = document.getElementById("slip-hint");
        const box = document.getElementById("slip-box");
        if (hint) {
            hint.textContent = c.text;
            hint.style.color = c.kind === "bad" ? "#F0918C" : c.kind === "warn" ? "#F5C46B" : "#8496B3";
        }
        if (box) box.classList.toggle("invalid", !c.ok);
    } else if (el.dataset.bundle && S.bundle) {
        setPath(S.bundle, el.dataset.bundle, el.value);
    } else if (el.dataset.model === "walletsCa") {
        S.wallets.ca = el.value;
    } else if (el.dataset.draft && S.draft) {
        const path = el.dataset.draft;
        let value = el.value;
        if (path === "fee") value = Number(value);
        if (path === "ledger.index" || path === "trezor.index") value = Number(value) || 0;
        if (path === "deadlineMinutes") {
            value = value.trim() === "" ? "" : Number(value);
            el.classList.toggle("invalid", !deadlineOk(value));
        }
        setPath(S.draft, path, value);
        if (path === "slippage") el.classList.toggle("invalid", !checkSlip(String(value).replace(",", ".")).ok);
    }
});

document.addEventListener("change", (event) => {
    const el = event.target;
    if (el.dataset.change === "chain") changeChain(Number(el.value));
    if (el.dataset.change === "bundle-wallet" && S.bundle) {
        const sel = S.bundle.mw.selected;
        const i = sel.indexOf(el.value);
        if (el.checked && i < 0) sel.push(el.value);
        if (!el.checked && i >= 0) sel.splice(i, 1);
        render();
    }
    if (el.dataset.change === "draft-chain") { S.draft.chain = Number(el.value); render(); }
    if (el.dataset.change === "draft-mode") { S.draft.ledger.mode = el.value; render(); }
    if (el.tagName === "SELECT" && el.dataset.draft && S.draft) {
        setPath(S.draft, el.dataset.draft, el.dataset.draft === "fee" ? Number(el.value) : el.value);
    }
});

document.addEventListener("keydown", (event) => {
    if (S.secure) {
        if (event.key === "Escape" && !S.secure.busy) closeSecure();
        if (event.key === "Enter" && event.target.id === "unl-pass") ACTIONS[S.secure.mode === "bundle-unlock" ? "bundle-unlock-go" : "unlock-go"]();
        if (event.key === "Enter" && /^imp-/.test(event.target.id)) ACTIONS["import-go"]();
        return;
    }
    if (event.key === "Escape" && S.chooser && !S.chooser.startup) ACTIONS["chooser-close"]();
    if (event.key === "Escape" && S.modal && !S.walletUi) ACTIONS["modal-close"]();
    if (event.key === "Enter" && event.target.id === "tz-pass") ACTIONS["pass-ok"]();
    if (event.key === "Enter" && event.target.id === "m-ca") ACTIONS["modal-custom"]();
    if (event.key === "Enter" && event.target.id === "amount-in") analyze();
});


// ============================================================
// ARRANQUE
// ============================================================

bridge.onBundleProgress((step) => {
    const e = S.bundle && S.bundle.exec;
    if (!e) return;
    const s = e.steps.find(x => x.id === step.id);
    if (!s) return;
    s.state = step.state;
    if (step.sub) s.sub = step.sub;
    if (S.view === "bundle-exec") render();
});

bridge.onProgress((step) => {
    if (!S.exec) return;
    const s = S.exec.steps.find(x => x.id === step.id);
    if (!s) return;
    s.state = step.state;
    if (step.sub) s.sub = step.sub;
    if (S.view === "exec") render(); else renderLedgerCard();
});

// Estado da carteira: Ledger/Trezor (USB) ou a página do navegador.
async function pollNow() {
    if (!S.ready || S.chooser && S.chooser.startup) return;
    try {
        const r = await call(bridge.ledgerStatus());
        if (r.wallet !== walletKey()) return;
        if (isBrowser()) {
            applyBridge(r);
        } else {
            const changed = r.connected !== S.ledger.connected;
            S.ledger = r;
            if (changed) renderLedgerCard();
        }
    } catch (_) {}
}

async function pollLedger() {
    if (!document.hidden) await pollNow();
    setTimeout(pollLedger, 3000);
}

function applyBridge(state, lastAddress) {
    const before = JSON.stringify(S.bridge);
    S.bridge = state;
    if (lastAddress !== undefined && lastAddress !== S.settings.lastAddress) {
        S.settings.lastAddress = lastAddress;
        if (S.swap) S.swap.balance = null;
        S.wallets.data = null;
        refreshBalance();
    }
    if (JSON.stringify(S.bridge) !== before) {
        if (S.view === "connect") render(); else renderLedgerCard();
    }
}

async function refreshBridge() {
    try {
        applyBridge(await call(bridge.walletState()));
    } catch (_) {}
}

bridge.onWalletState((data) => {
    if (!S.ready || !isBrowser()) return;
    applyBridge(data.state, data.lastAddress);
});

bridge.onWalletUi((request) => {
    if (request.type === "device") {
        S.ledger = Object.assign({}, S.ledger, { connected: request.connected });
        renderLedgerCard();
        return;
    }
    if (request.type === "locked") {
        S.ledger = { connected: false, busy: false };
        renderLedgerCard();
        return;
    }
    if (request.type === "close") {
        S.walletUi = null;
    } else if (request.type === "pin") {
        S.walletUi = { type: "pin", value: "", invalid: !!request.invalid };
    } else if (request.type === "passphrase") {
        S.walletUi = { type: "passphrase", onDevice: !!request.onDevice };
    } else if (request.type === "button") {
        S.walletUi = null;
    }
    renderModal();
});

async function start() {
    render();
    try {
        const init = await call(bridge.init());
        S.chains = init.chains;
        S.settings = init.settings;
        S.walletList = init.wallets || [];
        S.lang = init.language === "en" ? "en" : "pt";
        try { S.imported = (await call(bridge.localList())).imported; } catch (_) { S.imported = []; }
        // Menu de escolha da carteira em cada arranque (a última fica pré-selecionada).
        S.chooser = { selected: S.settings.wallet === "local" && S.settings.localAddress ? "local:" + S.settings.localAddress : (S.settings.wallet || "ledger"), startup: true, focus: true };
        const ver = document.getElementById("app-version");
        if (ver && init.version) ver.textContent = init.version;
        document.title = "topcatswap " + (init.version || "");
        S.swap = freshSwap(false);
        S.ready = true;
        render();
        refreshBalance();
        pollLedger();
    } catch (error) {
        S.loadError = error.message +
            " — Confirma que correste o script de instalação (npm install) e que a pasta node_modules existe.";
        render();
    }
}

start();
