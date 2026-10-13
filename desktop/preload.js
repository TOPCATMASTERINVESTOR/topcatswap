// Ponte segura entre a janela e o processo principal.
// A interface só tem acesso a estas funções.

const { contextBridge, ipcRenderer } = require("electron");

const call = (channel, arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld("api", {
    init: () => call("init"),
    saveSettings: (settings) => call("settings:save", settings),
    tokenInfo: (arg) => call("tokenInfo", arg),
    balance: (arg) => call("balance", arg),
    analyze: (arg) => call("analyze", arg),
    prepare: (arg) => call("prepare", arg),
    execute: () => call("execute"),
    wallets: (arg) => call("wallets", arg),
    cancel: (kind) => call("cancel", kind),
    ledgerStatus: () => call("ledgerStatus"),
    testConnections: () => call("testConnections"),
    openExternal: (url) => call("openExternal", url),
    chooseWallet: (key) => call("wallet:choose", key),
    openWalletPage: () => call("wallet:openPage"),
    walletPageUrl: () => call("wallet:pageUrl"),
    walletState: () => call("wallet:state"),
    trezorRespond: (answer) => call("trezor:respond", answer),
    setLanguage: (lang) => call("language:set", lang),
    bundleInfo: (arg) => call("bundle:info", arg),
    bundlePrepare: (arg) => call("bundle:prepare", arg),
    bundleExecute: () => call("bundle:execute"),
    bundleUnlock: (arg) => call("bundle:unlock", arg),
    bundleForget: () => call("bundle:forget"),
    bundleCancel: () => call("bundle:cancel"),
    onBundleProgress: (callback) => {
        const listener = (_event, step) => callback(step);
        ipcRenderer.on("bundle-progress", listener);
        return () => ipcRenderer.removeListener("bundle-progress", listener);
    },
    localList: () => call("local:list"),
    localImport: (arg) => call("local:import", arg),
    localUnlock: (arg) => call("local:unlock", arg),
    localLock: () => call("local:lock"),
    localRemove: (address) => call("local:remove", address),
    onProgress: (callback) => {
        const listener = (_event, step) => callback(step);
        ipcRenderer.on("progress", listener);
        return () => ipcRenderer.removeListener("progress", listener);
    },
    onWalletState: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("wallet-state", listener);
        return () => ipcRenderer.removeListener("wallet-state", listener);
    },
    onWalletUi: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("wallet-ui", listener);
        return () => ipcRenderer.removeListener("wallet-ui", listener);
    }
});
