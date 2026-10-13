#!/usr/bin/env node
// ============================================================
// TopCatSwap relay — versão Node (sem dependências)
//
// Para quem prefere correr o relay no próprio computador:
//   node relay/server.mjs            → http://127.0.0.1:8787
// e pôr  http://127.0.0.1:8787  em Definições › Ligações › Relay.
//
// Variáveis: PORT (8787), HOST (127.0.0.1), ALLOWED_ORIGINS ("*").
// Mesma lógica e mesma lista fechada do worker da Cloudflare.
// ============================================================

import http from "node:http";
import { pathToFileURL } from "node:url";
import worker from "./worker.mjs";


export function createRelayServer(env = {}) {

    return http.createServer(async (req, res) => {

        try {

            const chunks = [];
            let size = 0;

            for await (const c of req) {
                size += c.length;
                if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
                chunks.push(c);
            }

            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);

            const request = new Request("http://relay.local" + req.url, {
                method: req.method,
                headers,
                body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks)
            });

            const response = await worker.fetch(request, env);

            const out = {};
            response.headers.forEach((v, k) => { out[k] = v; });
            res.writeHead(response.status, out);
            res.end(Buffer.from(await response.arrayBuffer()));

        } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal" }));
        }
    });
}


if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const port = Number(process.env.PORT) || 8787;
    const host = process.env.HOST || "127.0.0.1";
    createRelayServer({ ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "*" }).listen(port, host, () => {
        console.log("TopCatSwap relay em http://" + host + ":" + port + "  (destinos: relay/allowlist.mjs)");
    });
}
