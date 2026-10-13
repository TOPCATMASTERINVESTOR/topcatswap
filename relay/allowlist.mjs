// ============================================================
// TopCatSwap relay — lista fechada de destinos
//
// O relay só reencaminha pedidos para estes endereços (builders de
// bundles e serviços de proteção MEV / The Graph). Qualquer outro
// destino é recusado: não é um proxy aberto.
// Partilhado por worker.mjs (Cloudflare) e server.mjs (Node).
// ============================================================

export const ALLOWED = [
    // Builders Ethereum
    "https://relay.flashbots.net",
    "https://rpc.buildernet.org",
    "https://rpc.titanbuilder.xyz",
    "https://rpc.beaverbuild.org",
    // Builders BSC
    "https://puissant-builder.48.club",
    "https://bsc.blockrazor.xyz",
    // Proteção MEV (envio de transações assinadas)
    "https://rpc.mevblocker.io",
    "https://rpc.flashbots.net",
    "https://bsc.merkle.io",
    "https://bscrpc.pancakeswap.finance",
    "https://rpc-bsc.48.club",
    // The Graph (descoberta de pools V4)
    "https://gateway.thegraph.com"
];

// Cabeçalhos do pedido que passam para o destino.
export const FORWARD_HEADERS = ["content-type", "x-flashbots-signature", "authorization"];

export const MAX_BODY = 512 * 1024;

export function allowedTarget(raw) {
    let u;
    try { u = new URL(raw); } catch (_) { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const base = u.origin;
    return ALLOWED.includes(base) ? u.toString() : null;
}

