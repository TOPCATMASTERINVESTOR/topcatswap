// ============================================================
// TopCatSwap Web — configuração do site
//
// Edita ANTES de correr  node tools/build-web.js  (os ficheiros
// gerados levam um hash de integridade; editar depois quebra-o).
// ============================================================

window.TCS_CONFIG = {

    version: "__VERSION__",

    // Relay dos bundles (pasta relay/ do repositório) usado quando o
    // utilizador não indica outro em Definições › Ligações.
    // Ex.: "https://topcatswap-relay.<a-tua-conta>.workers.dev"
    // Vazio = cada utilizador configura o seu (ou não usa bundles).
    defaultRelay: "",

    // Identificação pedida pelo Trezor Connect (https://connect.trezor.io).
    // Põe um email de contacto teu. appUrl, se vazio, é o endereço do site.
    trezorManifest: {
        appName: "TopCatSwap",
        email: "topcatswap@users.noreply.github.com"
    },

    trezorConnectUrl: "https://connect.trezor.io/9/trezor-connect.js"
};
