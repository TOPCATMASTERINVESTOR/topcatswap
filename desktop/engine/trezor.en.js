// ============================================================
// TopCatSwap — Trezor (experimental)
//
// Usa a biblioteca oficial @trezor/connect no processo principal.
// Contas: m/44'/60'/0'/0/N (as mesmas do Trezor Suite e do MetaMask).
// A chave privada nunca sai da Trezor: a app só recebe a assinatura.
// ============================================================

const { ethers } = require("ethers");


let lib = null;          // { TrezorConnect, UI, UI_EVENT, DEVICE_EVENT }
let initPromise = null;
let uiHandler = null;    // (pedido) => void  — encaminha PIN/passphrase para a janela
const devices = new Map();


// Nomes das constantes (com valores de reserva caso a versão mude).
const UI_NAMES = {
    REQUEST_PIN: "ui-request_pin",
    RECEIVE_PIN: "ui-receive_pin",
    INVALID_PIN: "ui-invalid_pin",
    REQUEST_PASSPHRASE: "ui-request_passphrase",
    RECEIVE_PASSPHRASE: "ui-receive_passphrase",
    REQUEST_PASSPHRASE_ON_DEVICE: "ui-request_passphrase_on_device",
    REQUEST_BUTTON: "ui-button",
    REQUEST_CONFIRMATION: "ui-request_confirmation",
    RECEIVE_CONFIRMATION: "ui-receive_confirmation",
    REQUEST_PERMISSION: "ui-request_permission",
    RECEIVE_PERMISSION: "ui-receive_permission",
    CLOSE_UI_WINDOW: "ui-close_window"
};


function trezorPath(index) {
    return "m/44'/60'/0'/0/" + index;
}


function loadLib() {

    if (lib) return lib;

    let mod;

    try {
        mod = require("@trezor/connect");
    } catch (error) {
        throw new Error(
            "The Trezor library (@trezor/connect) is missing. Run ./build-ubuntu.sh again. (" + error.message + ")"
        );
    }

    const TrezorConnect = mod.default || mod.TrezorConnect || mod;
    const UI = Object.assign({}, UI_NAMES, mod.UI || {});

    lib = {
        TrezorConnect,
        UI,
        UI_EVENT: mod.UI_EVENT || "UI_EVENT",
        DEVICE_EVENT: mod.DEVICE_EVENT || "DEVICE_EVENT"
    };

    return lib;
}


function setUiHandler(fn) {
    uiHandler = fn;
}


function emitUi(request) {
    if (uiHandler) {
        try { uiHandler(request); } catch (_) {}
    }
}


async function init() {

    if (initPromise) return initPromise;

    initPromise = (async () => {

        const { TrezorConnect, UI, UI_EVENT, DEVICE_EVENT } = loadLib();

        TrezorConnect.on(DEVICE_EVENT, (event) => {
            const d = event && event.payload;
            const id = d && (d.path || d.id || "trezor");
            if (!event || !id) return;
            if (/disconnect/.test(event.type)) devices.delete(id);
            else devices.set(id, { label: d.label || (d.features && d.features.label) || "Trezor", model: d.features && d.features.model });
            emitUi({ type: "device", connected: devices.size > 0 });
        });

        TrezorConnect.on(UI_EVENT, (event) => {

            const type = event && event.type;
            const payload = (event && event.payload) || {};

            if (type === UI.REQUEST_PIN) {
                // Trezor Model One: o PIN é escrito na app com a grelha baralhada do ecrã.
                emitUi({ type: "pin" });
            } else if (type === UI.INVALID_PIN) {
                emitUi({ type: "pin", invalid: true });
            } else if (type === UI.REQUEST_PASSPHRASE) {
                const features = payload.device && payload.device.features;
                const onDevice = !!(features && Array.isArray(features.capabilities) &&
                    features.capabilities.includes("Capability_PassphraseEntry"));
                emitUi({ type: "passphrase", onDevice });
            } else if (type === UI.REQUEST_PASSPHRASE_ON_DEVICE || type === UI.REQUEST_BUTTON) {
                emitUi({ type: "button" });
            } else if (type === UI.REQUEST_CONFIRMATION) {
                TrezorConnect.uiResponse({ type: UI.RECEIVE_CONFIRMATION, payload: true });
            } else if (type === UI.REQUEST_PERMISSION) {
                TrezorConnect.uiResponse({ type: UI.RECEIVE_PERMISSION, payload: { granted: true, remember: true } });
            } else if (type === UI.CLOSE_UI_WINDOW) {
                emitUi({ type: "close" });
            }
        });

        const base = {
            manifest: {
                appName: "TopCatSwap",
                appUrl: "http://localhost/topcatswap",
                email: "topcat@localhost"
            },
            lazyLoad: false,
            debug: false
        };

        const attempts = [
            Object.assign({}, base, { transports: ["BridgeTransport", "NodeUsbTransport"] }),
            base
        ];

        let lastError = null;

        for (const options of attempts) {
            try {
                await TrezorConnect.init(options);
                return lib;
            } catch (error) {
                const msg = String(error && (error.message || error.code) || error);
                if (/already\s*initialized|Init_AlreadyInitialized/i.test(msg)) return lib;
                lastError = error;
            }
        }

        throw new Error("Could not start the connection to the Trezor: " + (lastError && lastError.message || lastError));

    })();

    initPromise.catch(() => { initPromise = null; });

    return initPromise;
}


function explain(payload) {

    const msg = (payload && (payload.error || payload.message)) || "Unknown Trezor error.";
    const code = payload && payload.code;

    if (code === "Device_NotFound" || /device not found|no device/i.test(msg)) {
        return "Trezor not detected. Plug in the USB cable, unlock it and check the Trezor udev rules.";
    }
    if (code === "Device_UsedElsewhere" || /used elsewhere|another (session|application)/i.test(msg)) {
        return "The Trezor is being used by another application (Trezor Suite, browser). Close it and try again.";
    }
    if (code === "Transport_Missing" || /transport/i.test(msg)) {
        return "No USB connection to the Trezor. Open Trezor Suite (it includes Trezor Bridge) or install the udev rules, and try again.";
    }
    if (/cancel|denied|rejected|Failure_ActionCancelled/i.test(msg) || code === "Failure_ActionCancelled") {
        return "Operation rejected or cancelled on the Trezor. Nothing was sent.";
    }
    if (/pin/i.test(msg) && /invalid/i.test(msg)) {
        return "Wrong PIN on the Trezor.";
    }

    return "Trezor: " + msg;
}


async function call(method, params) {

    const { TrezorConnect } = await init();

    const result = await TrezorConnect[method](params);

    if (!result || !result.success) {
        throw new Error(explain(result && result.payload));
    }

    return result.payload;
}


async function getAccounts(start, count) {

    const bundle = [];

    for (let i = start; i < start + count; i++) {
        bundle.push({ path: trezorPath(i), showOnTrezor: false });
    }

    const payload = await call("ethereumGetAddress", { bundle });

    return payload.map((item, i) => ({
        index: start + i,
        path: trezorPath(start + i).slice(2),
        address: ethers.getAddress(item.address)
    }));
}


async function getAccount(index) {

    const [account] = await getAccounts(index, 1);

    return account;
}


// Assina uma transação EIP-1559 (ethers.Transaction) e devolve a assinatura.
async function signTransaction(tx, account) {

    const payload = await call("ethereumSignTransaction", {
        path: "m/" + String(account.path).replace(/^m\//, ""),
        transaction: {
            to: tx.to,
            value: ethers.toQuantity(tx.value),
            data: tx.data || "0x",
            chainId: Number(tx.chainId),
            nonce: ethers.toQuantity(tx.nonce),
            gasLimit: ethers.toQuantity(tx.gasLimit),
            maxFeePerGas: ethers.toQuantity(tx.maxFeePerGas),
            maxPriorityFeePerGas: ethers.toQuantity(tx.maxPriorityFeePerGas)
        }
    });

    let v = Number(BigInt(payload.v));

    // EIP-1559: a Trezor devolve a paridade (0/1).
    if (v >= 35) v = (v - 35) % 2;
    else if (v >= 27) v -= 27;

    return ethers.Signature.from({ r: payload.r, s: payload.s, yParity: v });
}


// Resposta da janela aos pedidos de PIN / passphrase.
async function respond(answer) {

    const { TrezorConnect, UI } = await init();

    if (!answer || answer.type === "cancel") {
        try { TrezorConnect.cancel("Cancelled in the app"); } catch (_) {}
        return true;
    }

    if (answer.type === "pin") {
        TrezorConnect.uiResponse({ type: UI.RECEIVE_PIN, payload: String(answer.value || "").replace(/[^1-9]/g, "") });
        return true;
    }

    if (answer.type === "passphrase") {
        const payload = answer.onDevice
            ? { value: "", passphraseOnDevice: true, save: true }
            : { value: String(answer.value || ""), save: true };
        TrezorConnect.uiResponse({ type: UI.RECEIVE_PASSPHRASE, payload });
        return true;
    }

    return false;
}


function signer() {
    return { kind: "trezor", name: "Trezor", signTransaction };
}


function status() {
    return { initialized: !!lib && !!initPromise, connected: devices.size > 0 };
}


function dispose() {
    try { if (lib) lib.TrezorConnect.dispose(); } catch (_) {}
}


module.exports = {
    init,
    setUiHandler,
    getAccounts,
    getAccount,
    signTransaction,
    respond,
    signer,
    status,
    dispose,
    trezorPath
};
