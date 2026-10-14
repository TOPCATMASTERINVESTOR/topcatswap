// ============================================================
// TopCatSwap Web — alterações à interface (desktop/renderer/app.js)
//
// Usado por tools/build-web.js. A interface é a mesma da app de
// secretária; aqui só se trocam os textos e ecrãs que falam de
// "este computador", da página local de ligação e do reinício da app.
// O código injetado usa S.lang, por isso serve às duas línguas.
// ============================================================

"use strict";

// Substituições de texto simples: [português, inglês] → [web pt, web en].
const TEXT = [
    [["neste computador", "on this computer"], ["neste navegador", "in this browser"]],
    [["deste computador", "from this computer"], ["deste navegador", "from this browser"]],
    [["a este computador", "to this computer"], ["a este navegador", "to this browser"]],
    [["até fechares a app", "until you close the app"], ["até fechares a página", "until you close the page"]],
    [["Hardware · ligada por USB. Contas do Ledger Live.", "Hardware · connected over USB. Ledger Live accounts."],
     ["Hardware · USB (Chrome, Edge ou Brave). Contas do Ledger Live.", "Hardware · USB (Chrome, Edge or Brave). Ledger Live accounts."]],
    [["Hardware · ligada por USB. Contas do Trezor Suite.", "Hardware · connected over USB. Trezor Suite accounts."],
     ["Hardware · pelo Trezor Connect (janela da Trezor). Contas do Trezor Suite.", "Hardware · through Trezor Connect (Trezor window). Trezor Suite accounts."]]
];


// Trocas de código (expressões regulares; têm de encontrar exatamente 1 vez).
const CODE = [

    // Ecrã "Ligar carteira": na web a extensão está na própria página.
    {
        name: "viewConnect",
        find: /function viewConnect\(\) \{[\s\S]*?\n\}\n/,
        replace: () => `function viewConnect() { return webViewConnect(); }\n`
    },

    // Cartão da carteira na barra lateral (carteiras do navegador).
    {
        name: "ledger-card-browser",
        find: /    \} else if \(isBrowser\(\)\) \{\n        const b = S\.bridge \|\| \{\};[\s\S]*?\n    \} else \{\n        const l = S\.ledger;\n/,
        replace: () => `    } else if (isBrowser()) {
        const r = webBrowserCard(wn, busy);
        dot = r.dot; title = r.title; sub = r.sub; actions = r.actions;
    } else {
        const l = S.ledger;
`
    },

    // Cartão da Ledger: botão para autorizar o dispositivo neste navegador.
    {
        name: "ledger-card-hw",
        find: /(        const l = S\.ledger;\n[\s\S]*?\n)(    \}\n\n    card\.innerHTML)/,
        replace: (m, a, b) => a + `        if (k === "ledger" && bridge.web && !l.connected && !busy) {
            const ble = webWallet("ledger").ble;
            sub = ble ? (S.lang === "en" ? "Unlock it, turn on Bluetooth and connect" : "Desbloqueia-a, liga o Bluetooth e liga-a aqui") : (S.lang === "en" ? "Authorize it in this browser (Chrome, Edge, Brave)" : "Autoriza-a neste navegador (Chrome, Edge, Brave)");
            actions = \`<button type="button" class="btn" data-action="ledger-authorize">\${ble ? (S.lang === "en" ? "Connect Ledger" : "Ligar Ledger") : (S.lang === "en" ? "Authorize Ledger" : "Autorizar Ledger")}</button>\`;
        }
` + b
    },

    // Nota no fundo do menu de escolha da carteira.
    {
        name: "chooser-note",
        find: /(<div class="chooser-foot">\n<p>)\$\{[\s\S]*?\}(<\/p>)/,
        replace: (m, a, b) => a + "${webChooserNote(sel, chosen)}" + b
    },

    // Idioma: na web a página recarrega (não há reinício).
    {
        name: "lang-hint",
        find: /(<h2 id="t-lang">[^<]*<\/h2><p class="hint">)[^<]*(<\/p>)/,
        replace: (m, a, b) => a + '${S.lang === "en" ? "The page reloads in the other language. Settings and wallets are kept in this browser." : "A página recarrega na outra língua. As definições e as carteiras mantêm-se neste navegador."}' + b
    },

    // Definições › Ligações: campo do relay dos bundles.
    {
        name: "relay-field",
        find: /(\n\$\{rpcs\}\n)/,
        replace: (m, a) => a + "${webRelayField(d)}\n"
    },

    // Erro de arranque: na web não há npm install.
    {
        name: "load-error",
        find: /S\.loadError = error\.message \+\s*\n?\s*"[^"]*";/,
        replace: () => "S.loadError = error.message;"
    },

    // Ação: autorizar a Ledger (tem de correr dentro do clique).
    {
        name: "action-ledger-authorize",
        find: /const ACTIONS = \{\n/,
        replace: (m) => m + `
    "ledger-authorize": async () => {
        try { await call(bridge.ledgerAuthorize()); } catch (_) {}
        pollNow();
    },
`
    },

    // Descrição de cada carteira conforme o dispositivo (USB/Bluetooth/app).
    {
        name: "wallet-look",
        find: /(    const out = Object\.assign\(\{\}, meta, WALLET_LOOK\[k\] \|\| \{\}\);\n)/,
        replace: (m, a) => a + `    if (bridge.walletAvailability) { const av = bridge.walletAvailability(k); if (av && av.sub) out.sub = av.sub; }\n`
    },

    // Menu de escolha: esconde as carteiras que não existem neste dispositivo.
    {
        name: "chooser-filter",
        find: /const all = S\.walletList\.filter\(x => x\.key !== "local"\)\.map\(x => W\(x\.key\)\);/,
        replace: () => 'const all = S.walletList.filter(x => x.key !== "local" && webWallet(x.key).state !== "hidden").map(x => W(x.key));'
    },

    // ...e mostra como link (abrir na app) ou desativadas as que não se podem escolher aqui.
    {
        name: "chooser-card",
        find: /    const card = \(w\) => /,
        replace: () => '    const card = (w) => ["link", "off"].includes(webWallet(w.key).state) ? webCard(w) : cardBase(w);\n    const cardBase = (w) => '
    },

    {
        name: "chooser-hw-empty",
        find: /<div class="wallet-grid">\$\{hw\}<\/div>/,
        replace: () => '${hw ? `<div class="wallet-grid">${hw}</div>` : webEmptyGroup("hw")}'
    },

    {
        name: "chooser-br-empty",
        find: /<div class="wallet-grid">\$\{br\}<\/div>/,
        replace: () => '${br ? `<div class="wallet-grid">${br}</div>` : webEmptyGroup("br")}'
    },

    // Seleção inicial: nunca uma carteira indisponível neste dispositivo.
    {
        name: "chooser-selection",
        find: /\n    const sel = S\.chooser\.selected;\n/,
        replace: () => '\n    if (S.chooser.selected && !S.chooser.selected.startsWith("local:") && webWallet(S.chooser.selected).state !== "ok") S.chooser.selected = webFirstWallet();\n    const sel = S.chooser.selected;\n'
    },

    // Títulos dos grupos no telemóvel (Bluetooth / apps em vez de USB / extensões).
    {
        name: "chooser-hw-title",
        find: /(<h2 id="ch-hw">)([^<]*)(<\/h2>)/,
        replace: (m, a, t, b) => a + "${webDevice().mobile ? (S.lang === \"en\" ? \"Hardware wallets · Bluetooth\" : \"Carteiras de hardware · Bluetooth\") : " + JSON.stringify(t) + "}" + b
    },
    {
        name: "chooser-br-title",
        find: /(<h2 id="ch-br">)([^<]*)(<\/h2>)/,
        replace: (m, a, t, b) => a + "${webDevice().mobile ? (S.lang === \"en\" ? \"Wallet apps\" : \"Apps de carteira\") : " + JSON.stringify(t) + "}" + b
    },
    // Botão "Continuar" sem carteira escolhida (telemóvel sem carteira disponível).
    {
        name: "chooser-go-label",
        find: /(data-action="chooser-go" \$\{sel \? "" : "disabled"\}>)([^$<]*\$\{h\(chosen\.name\)\})(\$\{ICON\.arrow\})/,
        replace: (m, a, t, b) => a + "${sel ? `" + t + "` : (S.lang === \"en\" ? \"Choose a wallet\" : \"Escolhe uma carteira\")}" + b
    },
    // Em ecrãs tácteis não se foca o primeiro cartão (parecia escolhido).
    {
        name: "chooser-focus",
        find: /if \(btn && S\.chooser\.focus\) \{/,
        replace: () => 'if (btn && S.chooser.focus && !webDevice().touch) {'
    },
    // Mudar de língua: "A recarregar…" em vez de "A reiniciar…".
    {
        name: "lang-loading",
        find: /loadingCard\(lang === "en" \? "Restarting…" : "A reiniciar…"\)/,
        replace: () => 'loadingCard(lang === "en" ? "Reloading…" : "A recarregar…")'
    }
];


// Funções acrescentadas ao fim de app.js (declarações: ficam disponíveis em todo o ficheiro).
const HELPERS = `

// ============================================================
// VERSÃO WEB (acrescentado por tools/build-web.js)
// ============================================================

function webWallet(key) {
    return (bridge.walletAvailability && bridge.walletAvailability(key)) || { state: "ok" };
}

function webDevice() {
    return (bridge.device && bridge.device()) || { type: "desktop", mobile: false };
}

function webFirstWallet() {
    const d = webDevice();
    if (d.walletApp && webWallet(d.walletApp).state === "ok") return d.walletApp;
    const imported = (S.imported || [])[0];
    if (d.mobile && imported) return "local:" + imported.address;
    if (d.mobile) return null;
    const ok = (S.walletList || []).map(w => w.key).filter(k => k !== "local" && webWallet(k).state === "ok");
    return ok[0] || null;
}

function webCard(w) {
    const av = webWallet(w.key);
    const en = S.lang === "en";
    if (av.state === "link") {
        return \`<a class="wallet-opt app-link" href="\${h(av.link)}" rel="noopener">\${monogram(w.key)}<span class="w-text"><span class="w-name">\${h(w.name)}<span class="w-tag">\${en ? "Open app" : "Abrir app"}</span></span><span class="w-sub">\${h(av.sub || "")}</span></span></a>\`;
    }
    return \`<div class="wallet-opt off" aria-disabled="true">\${monogram(w.key)}<span class="w-text"><span class="w-name">\${h(w.name)}<span class="w-tag">\${en ? "Unavailable" : "Indisponível"}</span></span><span class="w-sub">\${h(av.sub || "")}</span></span></div>\`;
}

function webEmptyGroup(group) {
    const en = S.lang === "en";
    const d = webDevice();
    const where = d.os === "ios" ? (en ? "on iPhone/iPad" : "no iPhone/iPad") : d.mobile ? (en ? "in this mobile browser" : "neste navegador de telemóvel") : (en ? "in this browser" : "neste navegador");
    const text = group === "hw"
        ? (en ? "Hardware wallets are not available " + where + " (no USB or Bluetooth access for websites). Use an imported wallet or your wallet's app."
              : "As carteiras de hardware não estão disponíveis " + where + " (sem acesso a USB nem Bluetooth para sites). Usa uma carteira importada ou a app da tua carteira.")
        : (en ? "No wallet app available here." : "Nenhuma app de carteira disponível aqui.");
    return \`<p class="hint chooser-empty">\${h(text)}</p>\`;
}

function webChooserNote(sel, chosen) {
    const en = S.lang === "en";
    const dev = webDevice();
    if (!sel) {
        return dev.mobile
            ? (en ? "On a phone: open this site inside your wallet's app, use an imported wallet" + (webWallet("ledger").state === "ok" ? " or a Ledger over Bluetooth." : ".")
                  : "No telemóvel: abre este site dentro da app da tua carteira, usa uma carteira importada" + (webWallet("ledger").state === "ok" ? " ou uma Ledger por Bluetooth." : "."))
            : (en ? "Choose a wallet." : "Escolhe uma carteira.");
    }
    if (chosen.browser && dev.mobile) {
        return en ? "You are in the " + h(chosen.name) + " app's browser: the site connects to it directly. Approve the connection when it asks."
                  : "Estás no browser da app " + h(chosen.name) + ": o site liga-se diretamente. Aprova a ligação quando ela pedir.";
    }
    if (sel && sel.startsWith("local:")) {
        return en
            ? "The key is encrypted in this browser. You will type this wallet's password; it stays unlocked until you close the page, lock it or 30 min pass without use."
            : "A chave está cifrada neste navegador. Vais escrever a password desta carteira; fica desbloqueada até fechares a página, a bloqueares ou passarem 30 min sem uso.";
    }
    if (chosen.browser) {
        return en
            ? "The site talks directly to the " + h(chosen.name) + " extension in this browser. Approve the connection when it asks."
            : "O site fala diretamente com a extensão " + h(chosen.name) + " deste navegador. Aprova a ligação quando ela pedir.";
    }
    if (chosen.key === "trezor") {
        return en
            ? "Trezor Connect opens its own window (connect.trezor.io) for the PIN and to confirm. Close Trezor Suite first."
            : "O Trezor Connect abre uma janela própria (connect.trezor.io) para o PIN e para confirmar. Fecha antes o Trezor Suite.";
    }
    if (webWallet("ledger").ble) {
        return en
            ? "Ledger over Bluetooth (Nano X, Stax, Flex), experimental. Unlock it, open the Ethereum app and turn Bluetooth on; the browser asks you to pick it and the phone may ask for a pairing code."
            : "Ledger por Bluetooth (Nano X, Stax, Flex), experimental. Desbloqueia-a, abre a app Ethereum e liga o Bluetooth; o navegador pede para a escolheres e o telemóvel pode pedir um código de emparelhamento.";
    }
    return en
        ? "Needs Chrome, Edge or Brave on a computer (WebHID). Close Ledger Live first: only one app at a time can talk to the Ledger. The browser asks you to pick the Ledger the first time."
        : "Precisa de Chrome, Edge ou Brave num computador (WebHID). Fecha antes o Ledger Live: só uma aplicação de cada vez fala com a Ledger. Na primeira vez o navegador pede para escolheres a Ledger.";
}

function webBrowserCard(wn, busy) {
    const en = S.lang === "en";
    const b = S.bridge || {};
    return {
        dot: busy ? "warn" : b.connected ? "good" : "off",
        title: busy ? wn + (en ? " in use" : " em uso") : b.connected ? wn + (en ? " connected" : " ligada") : wn + (en ? " not connected" : " por ligar"),
        sub: busy ? (en ? "Confirm in the extension" : "Confirma na extensão")
            : b.connected ? (en ? "Extension in this browser" : "Extensão neste navegador")
            : b.detected ? (en ? "Click Connect and approve" : "Carrega em Ligar e aprova")
            : (en ? "Extension not found in this browser" : "Extensão não encontrada neste navegador"),
        actions: b.connected ? "" : \`<button type="button" class="btn" data-action="bridge-open">\${en ? "Connect" : "Ligar"}</button>\`
    };
}

function webViewConnect() {

    const en = S.lang === "en";
    const wn = W().name;

    if (!isBrowser()) {
        return topbar({ title: en ? "Connect wallet" : "Ligar carteira" }) + \`<div class="page"><section class="card" style="max-width:720px"><p class="hint">\${en
            ? "The chosen wallet (" + h(wn) + ") does not use a browser extension."
            : "A carteira escolhida (" + h(wn) + ") não usa extensão do navegador."}</p><button type="button" class="btn outline" style="align-self:flex-start" data-action="open-chooser">\${en ? "Change wallet" : "Mudar carteira"}</button></section></div>\`;
    }

    const b = S.bridge || {};
    const c = chain();
    const rightChain = b.chainId && b.chainId === CHAIN_HEX[c.number];

    const steps = [
        {
            done: !!b.detected,
            title: en ? wn + " found in this browser" : wn + " encontrada neste navegador",
            sub: b.detected ? (en ? "Extension: " : "Extensão: ") + b.detected
                : b.others && b.others.length ? (en ? "Not found; this browser has: " : "Não encontrada; este navegador tem: ") + b.others.join(", ")
                : (en ? "Install or enable the extension, then reload this page" : "Instala ou ativa a extensão e recarrega esta página")
        },
        {
            done: !!b.connected,
            title: en ? "Account connected" : "Conta ligada",
            sub: b.account ? b.account : (en ? "Click Connect and approve in the extension" : "Carrega em Ligar e aprova na extensão")
        },
        {
            done: !!rightChain,
            title: en ? "Network" : "Rede",
            sub: b.chainId ? (rightChain ? c.name : (en ? "The extension is on another network; the site asks to switch to " : "A extensão está noutra rede; o site pede a troca para ") + c.name + (en ? " when sending" : " ao enviar")) : "—"
        }
    ];

    const firstOpen = steps.findIndex(x => !x.done);
    const list = steps.map((x, i) => \`<li class="\${x.done ? "done" : i === firstOpen ? "now" : ""}"><span class="mark">\${x.done ? "✓" : i + 1}</span><span class="t"><span>\${h(x.title)}</span><small class="\${i === 1 && b.account ? "mono" : ""}">\${h(x.sub)}</small></span></li>\`).join("");

    return topbar({
        title: (en ? "Connect " : "Ligar a ") + wn,
        sub: en ? h(wn) + " lives in this browser. The site asks it for the account and sends each transaction to it for you to confirm."
                : "A " + h(wn) + " vive neste navegador. O site pede-lhe a conta e envia-lhe cada transação para confirmares.",
        actions: chainSelect()
    }) + \`
<div class="page">
<section class="card grow-wide" style="gap:20px" aria-labelledby="t-conn">
<div style="display:flex;align-items:center;gap:14px">\${monogram(walletKey())}<h2 id="t-conn" style="font-size:20px">\${b.connected ? h(wn) + (en ? " connected" : " ligada") : (en ? "Connect " : "Ligar a ") + h(wn)}</h2>\${b.connected ? \`<span class="tag good">\${en ? "Ready" : "Pronta"}</span>\` : ""}</div>
<ol class="conn-steps" aria-live="polite">\${list}</ol>
\${b.error ? notice("bad", b.error) : ""}
<div style="display:flex;flex-wrap:wrap;gap:12px">
\${b.connected ? "" : \`<button type="button" class="btn primary big" data-action="bridge-open">\${(en ? "Connect " : "Ligar a ") + h(wn)}\${ICON.arrow}</button>\`}
\${b.connected ? \`<button type="button" class="btn primary big" data-action="nav" data-view="swap">\${en ? "Go to Swap" : "Ir para o Swap"}\${ICON.arrow}</button>\` : ""}
</div>
</section>
<section class="card grow-narrow" style="gap:14px" aria-labelledby="t-how">
<h2 id="t-how">\${en ? "How it works" : "Como funciona"}</h2>
<p class="hint">\${en ? "Each approve and each swap appears in the " + h(wn) + " window: you confirm there. The key never leaves the extension." : "Cada approve e cada swap aparecem na janela da " + h(wn) + ": confirmas lá. A chave nunca sai da extensão."}</p>
<p class="hint">\${en ? "The account used is the one selected in the extension. To change it, change it in " + h(wn) + "." : "A conta usada é a selecionada na extensão. Para mudar, muda-a na " + h(wn) + "."}</p>
<p class="hint">\${en ? "MEV protection: the wallet does the sending. Use the wallet's own protection or the MEV Blocker RPC in it." : "Proteção MEV: o envio é feito pela carteira. Usa a proteção da própria carteira ou o RPC MEV Blocker nela."}</p>
<p class="hint">\${en ? "Bundles need a wallet that signs without sending: Ledger, Trezor or an imported wallet." : "Os bundles precisam de uma carteira que assine sem enviar: Ledger, Trezor ou carteira importada."}</p>
</section>
</div>\`;
}

function webRelayField(d) {
    if (!bridge.web) return "";
    const en = S.lang === "en";
    return \`<div class="form-row"><label for="relay-url">\${en ? "Bundle relay (builders)" : "Relay dos bundles (builders)"}</label><input id="relay-url" class="input mono" placeholder="https://topcatswap-relay.….workers.dev" data-draft="relay" value="\${h(d.relay || "")}"><span class="faint" style="font-size:12px">\${en
        ? "Builders do not accept requests from websites. The relay (relay/ folder on GitHub) only forwards bundles that are already signed to a closed list of builders; it never sees keys."
        : "Os builders não aceitam pedidos de sites. O relay (pasta relay/ no GitHub) só reencaminha bundles já assinados para uma lista fechada de builders; nunca vê chaves."}</span></div>\`;
}
`;


function patchRenderer(src, lang) {

    let out = src;
    const li = lang === "en" ? 1 : 0;

    for (const [from, to] of TEXT) {
        const a = from[li];
        const b = to[li];
        if (!out.includes(a)) throw new Error("renderer (" + lang + "): texto não encontrado: " + a);
        out = out.split(a).join(b);
    }

    for (const p of CODE) {
        const re = new RegExp(p.find.source, p.find.flags.replace("g", ""));
        const all = out.match(new RegExp(p.find.source, p.find.flags.includes("g") ? p.find.flags : p.find.flags + "g"));
        if (!all || all.length !== 1) throw new Error("renderer (" + lang + "): " + p.name + " encontrado " + (all ? all.length : 0) + " vezes");
        out = out.replace(re, p.replace);
    }

    return out + HELPERS;
}


module.exports = { patchRenderer };
