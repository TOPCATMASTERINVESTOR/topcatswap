// ============================================================
// TopCatSwap — processo principal (Electron)
//
// Abre a janela, guarda as definições e liga a interface ao
// motor do bot (engine/). As chaves privadas nunca saem da carteira
// (Ledger, Trezor ou extensão do navegador).
// ============================================================

const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");


// ============================================================
// DEFINIÇÕES (guardadas em ~/.config/TopCatSwap/settings.json)
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
    // Carteira escolhida no arranque: ledger, trezor, metamask, okx, rabby,
    // coinbase, trust ou local (chave privada importada).
    wallet: "ledger",
    // Carteira importada em uso (o endereço; a chave fica cifrada em wallets/).
    localAddress: "",
    trezor: { index: 0 },
    // Último endereço usado com cada carteira.
    lastAddresses: {},
    // Idioma da app: "pt" (Português PT) ou "en" (English US). Mudar reinicia a app.
    language: ""
};

const WALLET_KEYS = ["ledger", "trezor", "metamask", "okx", "rabby", "coinbase", "trust", "local"];


let settings = null;


// Registo de erros: terminal + ~/.config/TopCatSwap/topcatswap.log
function log(...parts) {

    const line = new Date().toISOString() + " " + parts.map(p =>
        p instanceof Error ? (p.stack || p.message) : typeof p === "string" ? p : JSON.stringify(p)
    ).join(" ");

    console.log(line);

    try {
        fs.mkdirSync(app.getPath("userData"), { recursive: true });
        fs.appendFileSync(path.join(app.getPath("userData"), "topcatswap.log"), line + "\n");
    } catch (_) {}
}

let mainWindow = null;


function settingsFile() {
    return path.join(app.getPath("userData"), "settings.json");
}


function sanitizeSettings(input) {

    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const src = input && typeof input === "object" ? input : {};

    if ([1, 2, 3].includes(Number(src.chain))) s.chain = Number(src.chain);
    if (src.slippage !== undefined) s.slippage = String(src.slippage).replace(",", ".").trim() || s.slippage;
    if ([1, 2, 3].includes(Number(src.fee))) s.fee = Number(src.fee);
    if (typeof src.protect === "boolean") s.protect = src.protect;

    if (src.protectProvider && typeof src.protectProvider === "object") {
        for (const k of ["1", "3"]) {
            if (typeof src.protectProvider[k] === "string") s.protectProvider[k] = src.protectProvider[k];
        }
    }

    if (Array.isArray(src.versions)) {
        const v = src.versions.map(x => String(x).toUpperCase()).filter(x => ["V2", "V3", "V4"].includes(x));
        if (v.length > 0) s.versions = v;
    }

    if (src.rpc && typeof src.rpc === "object") {
        for (const k of ["1", "2", "3"]) {
            if (typeof src.rpc[k] === "string") s.rpc[k] = src.rpc[k].trim();
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

    if (typeof src.localAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(src.localAddress.trim())) {
        s.localAddress = src.localAddress.trim();
    }

    if (s.wallet === "local" && !s.localAddress) s.wallet = "ledger";

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

    // Versões anteriores: o endereço guardado era da Ledger.
    if (!src.lastAddresses && s.lastAddress && s.wallet === "ledger") s.lastAddresses.ledger = s.lastAddress;

    return s;
}


function loadSettings() {

    try {
        return sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile(), "utf8")));
    } catch (_) {
        return sanitizeSettings({});
    }
}


function saveSettings(s) {

    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });

    // Só o próprio utilizador pode ler (tem a chave da The Graph).
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}


// O motor lê os RPC e a chave da The Graph das variáveis de ambiente.
function applyEnvironment(s) {

    const set = (name, value) => {
        if (value && String(value).trim()) process.env[name] = String(value).trim();
        else delete process.env[name];
    };

    set("RPC_URL", s.rpc["1"]);
    set("RPC_URL_42161", s.rpc["2"]);
    set("RPC_URL_56", s.rpc["3"]);
    set("GRAPH_API_KEY", s.graphKey);
}


// Carregado só quando é preciso: se faltar uma dependência,
// o erro aparece na janela em vez de a app não abrir.
// Idioma fixo durante a execução (mudar reinicia a app): carrega o motor
// e a interface na língua escolhida.
let LANG = "pt";

function L(pt, en) {
    return LANG === "en" ? en : pt;
}

function gui() {
    return require(LANG === "en" ? "./engine/gui-engine.en" : "./engine/gui-engine");
}


// ============================================================
// IPC: cada pedido devolve { ok, data } ou { ok:false, error }
// ============================================================

function handle(channel, fn) {

    ipcMain.handle(channel, async (event, arg) => {

        try {

            return { ok: true, data: await fn(arg, event) };

        } catch (error) {

            if (!(error && error.cancelled)) log("[" + channel + "]", error);

            return {
                ok: false,
                cancelled: !!(error && error.cancelled),
                error: (error && (error.shortMessage || error.message)) || String(error)
            };
        }
    });
}


function registerHandlers() {

    handle("init", () => ({
        settings,
        chains: gui().chainsInfo(),
        wallets: Object.entries(gui().WALLETS).map(([key, w]) => Object.assign({ key }, w)),
        version: app.getVersion(),
        language: LANG
    }));

    handle("settings:save", async (input) => {

        settings = sanitizeSettings(input);

        if (settings.lastAddress) settings.lastAddresses[settings.wallet] = settings.lastAddress;

        saveSettings(settings);

        applyEnvironment(settings);

        await gui().configure(settings);

        return settings;
    });

    // Escolha da carteira (menu do arranque ou "Mudar carteira").
    handle("wallet:choose", async (key) => {

        if (!WALLET_KEYS.includes(key)) throw new Error(L("Carteira desconhecida.", "Unknown wallet."));

        if (settings.lastAddress) settings.lastAddresses[settings.wallet] = settings.lastAddress;

        settings.wallet = key;
        settings.lastAddress = settings.lastAddresses[key] || "";

        saveSettings(settings);

        await gui().configure(settings);

        return settings;
    });

    // Abre no navegador a página que liga a extensão (MetaMask, OKX, ...).
    handle("wallet:openPage", async () => {

        const url = await gui().openBridge();

        await shell.openExternal(url);

        return url;
    });

    handle("wallet:pageUrl", () => gui().openBridge());

    handle("wallet:state", () => gui().bridgeState());

    handle("trezor:respond", (answer) => gui().trezorRespond(answer));

    // ---- Carteiras importadas por chave privada (até 5) ----

    const localView = () => ({ settings, imported: gui().keystore.list() });

    const useLocal = async (address) => {
        if (settings.lastAddress && settings.wallet !== "local") settings.lastAddresses[settings.wallet] = settings.lastAddress;
        settings.wallet = "local";
        settings.localAddress = address;
        settings.lastAddress = address;
        saveSettings(settings);
        await gui().configure(settings);
    };

    handle("local:list", () => localView());

    handle("local:import", async (arg) => {
        const a = arg || {};
        const r = await gui().keystore.importKey({ privateKey: a.privateKey, password: a.password, label: a.label });
        log("[carteira] importada " + r.address);
        await useLocal(r.address);
        return localView();
    });

    handle("local:unlock", async (arg) => {
        const a = arg || {};
        const r = await gui().keystore.unlock(a.address, a.password);
        await useLocal(r.address);
        return localView();
    });

    handle("local:lock", () => {
        gui().keystore.lock("manual");
        return localView();
    });

    handle("local:remove", async (address) => {
        gui().keystore.remove(address);
        log("[carteira] removida " + address);
        if (String(settings.localAddress).toLowerCase() === String(address).toLowerCase()) {
            settings.localAddress = "";
            if (settings.wallet === "local") {
                settings.wallet = "ledger";
                settings.lastAddress = settings.lastAddresses.ledger || "";
            }
            saveSettings(settings);
            await gui().configure(settings);
        }
        return localView();
    });

    // Idioma: guarda e reinicia a app (motor e interface mudam juntos).
    handle("language:set", (lang) => {
        if (lang !== "pt" && lang !== "en") throw new Error("pt | en");
        settings.language = lang;
        saveSettings(settings);
        if (lang !== LANG) {
            setTimeout(() => { app.relaunch(); app.exit(0); }, 150);
        }
        return true;
    });

    handle("tokenInfo", (arg) => gui().tokenInfo(arg));

    handle("balance", (arg) => gui().balance(arg));

    handle("analyze", (arg) => gui().analyze(arg));

    handle("prepare", async (arg) => {

        const result = await gui().prepare(arg);

        // Lembra o endereço lido da carteira (para mostrar saldos sem a ligar).
        if (result && result.address && result.address !== settings.lastAddress) {
            settings.lastAddress = result.address;
            settings.lastAddresses[settings.wallet] = result.address;
            saveSettings(settings);
        }

        return result;
    });

    handle("execute", (_arg, event) => gui().execute((step) => {
        if (!event.sender.isDestroyed()) event.sender.send("progress", step);
    }));

    handle("wallets", (arg) => gui().wallets(arg));

    // ---- Bundles (separador "Bundles") ----
    handle("bundle:info", (arg) => gui().bundleInfo(arg));

    handle("bundle:prepare", (arg) => gui().bundlePrepare(Object.assign({}, arg, { deadlineMinutes: settings.deadlineMinutes })));

    handle("bundle:execute", (_arg, event) => gui().bundleExecute((step) => {
        if (!event.sender.isDestroyed()) event.sender.send("bundle-progress", step);
    }));

    handle("bundle:unlock", (arg) => gui().bundleUnlock(arg));

    handle("bundle:forget", () => gui().bundleForget());

    handle("bundle:cancel", () => gui().bundleCancel());

    handle("cancel", (kind) => gui().cancel(kind));

    handle("ledgerStatus", () => gui().ledgerStatus());

    handle("testConnections", () => gui().testConnections());

    handle("openExternal", (url) => {

        if (typeof url !== "string" || !/^https:\/\//.test(url)) {
            throw new Error(L("Endereço não permitido.", "Address not allowed."));
        }

        return shell.openExternal(url);
    });
}


// ============================================================
// JANELA
// ============================================================

function createWindow() {

    mainWindow = new BrowserWindow({
        width: 1320,
        height: 880,
        minWidth: 900,
        minHeight: 640,
        backgroundColor: "#081222",
        title: "topcatswap " + app.getVersion(),
        icon: path.join(__dirname, "build", "icon.png"),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            // O preload precisa de carregar mesmo em Ubuntu com AppArmor
            // restrito; a janela só mostra ficheiros locais da app.
            sandbox: false
        }
    });

    // A janela só mostra os ficheiros da app; links externos abrem no navegador.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

    // Diagnóstico: erros da janela vão para o terminal e para o ficheiro de registo.
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
        log("[preload] falhou ao carregar " + preloadPath, error);
    });

    mainWindow.webContents.on("console-message", (event, ...args) => {
        const d = args.length ? { level: args[0], message: args[1], line: args[2], source: args[3] } : event;
        const level = d.level;
        if (level === 3 || level === "error" || level === 2 || level === "warning") {
            log("[janela]", String(d.message), "(" + (d.sourceId || d.source || "") + ":" + (d.lineNumber || d.line || "") + ")");
        }
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => log("[janela] terminou:", details));

    // Ctrl+Shift+I abre as ferramentas de diagnóstico; F5 recarrega.
    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        if (input.control && input.shift && input.key.toLowerCase() === "i") {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
        if (input.key === "F5") {
            mainWindow.webContents.reload();
            event.preventDefault();
        }
    });

    mainWindow.loadFile(path.join(__dirname, "renderer", LANG === "en" ? "index.en.html" : "index.html"));
}


process.on("uncaughtException", (error) => log("[principal] erro:", error));
process.on("unhandledRejection", (error) => log("[principal] erro:", error));


app.whenReady().then(() => {

    log("TopCatSwap " + app.getVersion() + " · Electron " + process.versions.electron + " · " + process.platform);

    settings = loadSettings();

    // Primeira utilização: Português se o sistema estiver em português, senão inglês.
    if (!settings.language) {
        settings.language = /^pt/i.test(app.getLocale() || "") ? "pt" : "en";
        try { saveSettings(settings); } catch (_) {}
    }

    LANG = settings.language;

    applyEnvironment(settings);

    Menu.setApplicationMenu(null);

    registerHandlers();

    createWindow();

    try {

        const g = gui();

        // Carteira de navegador: a conta ativa passa a ser a da extensão.
        g.onBridgeChange((state) => {

            if (state.account && WALLET_KEYS.includes(settings.wallet) && settings.wallet === state.wallet &&
                state.account.toLowerCase() !== String(settings.lastAddress).toLowerCase()) {
                settings.lastAddress = state.account;
                settings.lastAddresses[settings.wallet] = state.account;
                saveSettings(settings);
            }

            if (mainWindow && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send("wallet-state", { state, lastAddress: settings.lastAddress });
            }
        });

        // Carteira importada: pasta das chaves cifradas e aviso de bloqueio.
        g.keystore.setDir(path.join(app.getPath("userData"), "wallets"));

        // Chave só para assinar os pedidos aos builders (não guarda fundos).
        g.bundlesSetDir(app.getPath("userData"));

        g.keystore.setLockListener((info) => {
            if (mainWindow && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send("wallet-ui", { type: "locked", address: info.address, reason: info.reason });
            }
        });

        // Trezor: pedidos de PIN / passphrase vão para a janela.
        g.onTrezorUi((request) => {
            if (mainWindow && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send("wallet-ui", request);
            }
        });

        g.configure(settings);

    } catch (error) {

        log("[carteira]", error);
    }
});


app.on("before-quit", () => {
    try { gui().dispose(); } catch (_) {}
});

app.on("window-all-closed", () => app.quit());
