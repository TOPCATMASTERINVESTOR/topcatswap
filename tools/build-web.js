#!/usr/bin/env node
// ============================================================
// TopCatSwap — gera a versão web (pasta dist-web/)
//
//   node tools/build-web.js
//
// Não precisa de npm install: junta o motor da app de secretária
// (desktop/engine) com os substitutos para o navegador (web-src/) num
// único ficheiro por língua, e copia a interface (desktop/renderer) com
// as alterações de web-src/renderer-web.js.
//
// Resultado (site estático, serve em qualquer alojamento https):
//   dist-web/index.html        Português
//   dist-web/index.en.html     English
//   dist-web/topcatswap-web.pt.js / .en.js   motor + carteiras
//   dist-web/app.js / app.en.js              interface
//   dist-web/vendor/ethers.umd.min.js        ethers v6 (MIT)
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const ENGINE = path.join(ROOT, "desktop", "engine");
const RENDERER = path.join(ROOT, "desktop", "renderer");
const WEB = path.join(ROOT, "web-src");
const OUT = path.join(ROOT, "dist-web");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "package.json"), "utf8"));
const VERSION = pkg.version;

const read = (p) => fs.readFileSync(p, "utf8");


// ---- Trezor: no navegador usa o Trezor Connect web (janela própria) ----

function patchTrezor(src) {

    const a = "const { TrezorConnect, UI, UI_EVENT, DEVICE_EVENT } = loadLib();";
    if (!src.includes(a)) throw new Error("trezor: loadLib não encontrado");
    src = src.replace(a, "if (globalThis.__TCS_loadTrezor) await globalThis.__TCS_loadTrezor();\n        " + a);

    const re = /const base = \{[\s\S]*?\n        const attempts = \[[\s\S]*?\];\n/;
    if (!re.test(src)) throw new Error("trezor: opções de init não encontradas");

    return src.replace(re, `const base = {
            manifest: Object.assign({
                appName: "TopCatSwap",
                appUrl: location.origin + location.pathname.replace(/[^/]*$/, ""),
                email: "topcatswap@users.noreply.github.com"
            }, (globalThis.TCS_CONFIG || {}).trezorManifest || {}),
            lazyLoad: true,
            popup: true,
            debug: false
        };

        const attempts = [base];
`);
}


// ---- mini-bundler CommonJS ----

function bundle(lang) {

    const sfx = lang === "en" ? ".en" : "";

    // id do módulo → código
    const modules = {
        "web-main": read(path.join(WEB, "web-main.js")),
        "gui-engine": read(path.join(ENGINE, "gui-engine" + sfx + ".js")),
        "topcatswap": read(path.join(ENGINE, "topcatswap" + sfx + ".js")),
        "gui-bundles": read(path.join(ENGINE, "gui-bundles" + sfx + ".js")),
        "bundles": read(path.join(ENGINE, "bundles" + sfx + ".js")),
        "keystore": read(path.join(ENGINE, "keystore" + sfx + ".js")),
        "trezor": patchTrezor(read(path.join(ENGINE, "trezor" + sfx + ".js"))),
        "wallet-bridge-web": read(path.join(WEB, "wallet-bridge-web.js")),
        "ledger-webhid": read(path.join(WEB, "ledger-webhid.js")),
        "@ledgerhq/hw-transport-node-hid": 'module.exports = { default: require("./ledger-webhid").TransportWebHID };',
        "@ledgerhq/hw-app-eth": 'module.exports = { default: require("./ledger-webhid").Eth, ledgerService: null };',
        "@trezor/connect": 'if (!globalThis.TrezorConnect) throw new Error("Trezor Connect ainda não carregou / not loaded yet"); module.exports = globalThis.TrezorConnect;',
        "ethers": "module.exports = globalThis.ethers;",
        "fs": "module.exports = globalThis.__TCS_NODE.fs;",
        "path": "module.exports = globalThis.__TCS_NODE.path;",
        "os": "module.exports = globalThis.__TCS_NODE.os;",
        "readline": "module.exports = globalThis.__TCS_NODE.readline;",
        "http": "module.exports = globalThis.__TCS_NODE.http;",
        "crypto": "module.exports = globalThis.__TCS_NODE.crypto;"
    };

    // A app de secretária chama "./wallet-bridge"; no site é a versão web.
    const alias = { "wallet-bridge": "wallet-bridge-web" };

    let out = `/*! TopCatSwap ${VERSION} (web, ${lang}) — gerado por tools/build-web.js a partir de desktop/engine e web-src. Código aberto: ver o repositório. */\n`;
    out += read(path.join(WEB, "shims.js")) + "\n";
    out += `globalThis.TCS_LANG = ${JSON.stringify(lang)};\n`;
    out += `(function () {
"use strict";
const defs = {}, cache = {}, alias = ${JSON.stringify(alias)};
function resolve(name) {
    let id = String(name).replace(/^\\.\\//, "").replace(/\\.js$/, "").replace(/\\.en$/, "");
    if (alias[id]) id = alias[id];
    return id;
}
function req(name) {
    const id = resolve(name);
    if (cache[id]) return cache[id].exports;
    if (!defs[id]) throw new Error("Módulo não incluído na versão web: " + name);
    const module = { exports: {}, id };
    cache[id] = module;
    defs[id].call(module.exports, module, module.exports, req);
    return module.exports;
}
req.main = null;
`;

    for (const [id, code] of Object.entries(modules)) {
        out += `\ndefs[${JSON.stringify(id)}] = function (module, exports, require) {\n${code}\n};\n`;
    }

    out += `\nreq("web-main");\n})();\n`;

    return out;
}


// ---- páginas ----

const CSP = [
    "default-src 'self'",
    "script-src 'self' https://connect.trezor.io",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src https: http://127.0.0.1:* http://localhost:*",
    "frame-src https://connect.trezor.io",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'"
].join("; ");

function page(lang, hashes) {

    const src = read(path.join(RENDERER, lang === "en" ? "index.en.html" : "index.html"));

    let html = src.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);

    if (html === src) throw new Error("index: CSP não encontrada");

    const app = lang === "en" ? "app.en.js" : "app.js";
    const engine = "topcatswap-web." + lang + ".js";

    const tag = (file) => `<script src="${file}" integrity="${hashes[file]}"></script>`;

    const scripts = [tag("config.js"), tag("vendor/ethers.umd.min.js"), tag(engine), tag(app)].join("\n");

    const before = html;
    html = html.replace(new RegExp(`<script src="${app.replace(".", "\\.")}"></script>`), scripts);
    if (html === before) throw new Error("index: script da interface não encontrado");

    html = html.replace("<title>", '<meta name="description" content="TopCatSwap — swaps na Uniswap V2/V3/V4 com Ledger, Trezor ou extensão do navegador. Código aberto, sem servidor.">\n<link rel="icon" href="logo-mark.png">\n<title>');

    return html;
}


function sri(content) {
    return "sha384-" + crypto.createHash("sha384").update(content).digest("base64");
}


function main() {

    const { patchRenderer } = require(path.join(WEB, "renderer-web.js"));

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, "vendor"), { recursive: true });

    const files = {};

    files["config.js"] = read(path.join(WEB, "config.js")).replace("__VERSION__", VERSION);
    files["vendor/ethers.umd.min.js"] = read(path.join(WEB, "vendor", "ethers.umd.min.js"));
    files["topcatswap-web.pt.js"] = bundle("pt");
    files["topcatswap-web.en.js"] = bundle("en");
    files["app.js"] = patchRenderer(read(path.join(RENDERER, "app.js")), "pt");
    files["app.en.js"] = patchRenderer(read(path.join(RENDERER, "app.en.js")), "en");
    files["styles.css"] = read(path.join(RENDERER, "styles.css"));

    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);

    fs.copyFileSync(path.join(RENDERER, "logo-mark.png"), path.join(OUT, "logo-mark.png"));

    const hashes = {};
    for (const name of ["config.js", "vendor/ethers.umd.min.js", "topcatswap-web.pt.js", "topcatswap-web.en.js", "app.js", "app.en.js"]) {
        hashes[name] = sri(files[name]);
    }

    fs.writeFileSync(path.join(OUT, "index.html"), page("pt", hashes));
    fs.writeFileSync(path.join(OUT, "index.en.html"), page("en", hashes));

    // Sem processamento Jekyll no GitHub Pages.
    fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

    // Hashes publicados: quem usar o site pode comparar com o código do repositório.
    const sums = fs.readdirSync(OUT, { recursive: true })
        .filter(f => fs.statSync(path.join(OUT, f)).isFile() && f !== "SHA256SUMS.txt" && f !== ".nojekyll")
        .sort()
        .map(f => crypto.createHash("sha256").update(fs.readFileSync(path.join(OUT, f))).digest("hex") + "  " + f.split(path.sep).join("/"));
    fs.writeFileSync(path.join(OUT, "SHA256SUMS.txt"), sums.join("\n") + "\n");

    console.log("TopCatSwap " + VERSION + " (web) gerado em " + path.relative(process.cwd(), OUT) + "/");
    for (const s of sums) console.log("  " + s);
}


main();
