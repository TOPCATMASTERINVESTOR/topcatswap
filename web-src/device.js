// ============================================================
// TopCatSwap Web — que dispositivo e que navegador é este?
//
// Define globalThis.TCS_DEVICE e o atributo data-device no <html>
// (phone | tablet | desktop). O desenho do ecrã adapta-se à largura
// (CSS); a lista de carteiras adapta-se ao que o navegador consegue:
//   - WebHID (Ledger por USB): Chrome, Edge, Brave, Opera no computador;
//   - Web Bluetooth (Ledger Nano X, Stax, Flex): Chrome/Edge no Android
//     e no computador; não existe no iPhone/iPad nem no Firefox;
//   - browser de dApps de uma carteira (MetaMask, Trust, OKX, Coinbase):
//     a carteira já está injetada na página.
// ============================================================

"use strict";

(function (root) {

    const nav = root.navigator || {};
    const ua = String(nav.userAgent || "");
    const uaData = nav.userAgentData || null;
    const touch = (nav.maxTouchPoints || 0) > 0 || "ontouchstart" in root;

    const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    const isIPhone = /iPhone|iPod/.test(ua);
    const isAndroid = /Android/i.test(ua);

    let type = "desktop";

    if (isIPhone) type = "phone";
    else if (isIPad) type = "tablet";
    else if (isAndroid) type = /Mobile/i.test(ua) || (uaData && uaData.mobile) ? "phone" : "tablet";
    else if (uaData && uaData.mobile) type = "phone";
    else if (touch && /Mobi|Tablet|Silk|Kindle|PlayBook|BB10/i.test(ua)) type = /Tablet|Silk|Kindle|PlayBook/i.test(ua) ? "tablet" : "phone";

    const os = isIPhone || isIPad ? "ios" : isAndroid ? "android" : /Windows/.test(ua) ? "windows" : /Mac OS X|Macintosh/.test(ua) ? "macos" : /Linux|X11/.test(ua) ? "linux" : "other";

    const browser =
        /FxiOS|Firefox\//.test(ua) ? "firefox" :
        /EdgiOS|Edg\//.test(ua) ? "edge" :
        /OPR\/|Opera/.test(ua) ? "opera" :
        nav.brave ? "brave" :
        /CriOS|Chrome\//.test(ua) ? "chrome" :
        /Safari\//.test(ua) ? "safari" : "other";

    // Browser de dApps dentro da app de uma carteira (só faz sentido em telemóvel/tablet).
    function detectWalletApp() {
        if (type === "desktop") return null;
        const e = root.ethereum;
        if (/MetaMaskMobile/i.test(ua)) return "metamask";
        if (/Trust/i.test(ua) || (e && (e.isTrust || e.isTrustWallet))) return "trust";
        if (/OKApp|OKEx/i.test(ua) || root.okxwallet || (e && e.isOkxWallet)) return "okx";
        if (/CoinbaseWallet|CoinbaseBrowser/i.test(ua) || (e && (e.isCoinbaseWallet || e.isCoinbaseBrowser))) return "coinbase";
        if (e && e.isRabby) return "rabby";
        if (e && e.isMetaMask) return "metamask";
        return e ? "other" : null;
    }

    const device = {
        type,
        mobile: type !== "desktop",
        os,
        browser,
        touch,
        hid: !!nav.hid,
        bluetooth: !!nav.bluetooth,
        walletApp: detectWalletApp()
    };

    // A carteira pode injetar-se um pouco depois do carregamento.
    device.refreshWalletApp = function () {
        device.walletApp = detectWalletApp();
        return device.walletApp;
    };

    root.TCS_DEVICE = device;

    try {
        const html = root.document && root.document.documentElement;
        if (html) {
            html.dataset.device = type;
            html.dataset.os = os;
            if (touch) html.dataset.touch = "1";
        }
    } catch (_) {}

})(typeof window !== "undefined" ? window : globalThis);
