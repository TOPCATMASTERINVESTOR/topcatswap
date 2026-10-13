// ============================================================
// TopCatSwap relay — Cloudflare Worker
//
// Os builders de bundles não aceitam pedidos vindos de sites (CORS).
// Este worker recebe do site o bundle JÁ ASSINADO e passa-o ao builder.
// Não guarda nada, não vê chaves e só fala com a lista de allowlist.mjs.
//
// Publicar (conta gratuita da Cloudflare):
//   npm install -g wrangler
//   cd relay && wrangler deploy
// Depois põe o endereço (https://topcatswap-relay.<conta>.workers.dev)
// em Definições › Ligações › Relay dos bundles, ou em web-src/config.js.
//
// Opcional (recomendado): limitar a origem ao teu site, em wrangler.toml:
//   [vars]
//   ALLOWED_ORIGINS = "https://<utilizador>.github.io"
// ============================================================

import { allowedTarget, FORWARD_HEADERS, MAX_BODY } from "./allowlist.mjs";


function corsHeaders(origin, allowed) {
    const any = allowed.includes("*");
    return {
        "Access-Control-Allow-Origin": any ? "*" : origin,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": FORWARD_HEADERS.join(", "),
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function json(status, body, headers) {
    return new Response(JSON.stringify(body), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers) });
}


export default {

    async fetch(request, env) {

        const origin = request.headers.get("Origin") || "";
        const allowed = String((env && env.ALLOWED_ORIGINS) || "*").split(",").map(s => s.trim()).filter(Boolean);
        const originOk = allowed.includes("*") || allowed.includes(origin);
        const cors = originOk ? corsHeaders(origin, allowed) : {};

        if (!originOk) return json(403, { error: "origin not allowed" }, {});

        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

        if (request.method === "GET") return json(200, { ok: true, service: "topcatswap-relay" }, cors);

        if (request.method !== "POST") return json(405, { error: "method" }, cors);

        const target = allowedTarget(new URL(request.url).searchParams.get("u") || "");

        if (!target) return json(403, { error: "destination not allowed" }, cors);

        const body = await request.arrayBuffer();

        if (body.byteLength > MAX_BODY) return json(413, { error: "too large" }, cors);

        const headers = {};
        for (const h of FORWARD_HEADERS) {
            const v = request.headers.get(h);
            if (v) headers[h] = v;
        }

        let upstream;

        try {
            upstream = await fetch(target, { method: "POST", headers, body });
        } catch (error) {
            return json(502, { error: "upstream unreachable", detail: String(error && error.message || error) }, cors);
        }

        return new Response(await upstream.arrayBuffer(), {
            status: upstream.status,
            headers: Object.assign({ "Content-Type": upstream.headers.get("content-type") || "application/json" }, cors)
        });
    }
};
