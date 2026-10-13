// Testes do relay (sem rede): node tests/relay.test.mjs
import assert from "node:assert/strict";
import worker from "../relay/worker.mjs";

const seen = [];
globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: Buffer.from(init.body).toString() });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }), { headers: { "content-type": "application/json" } });
};

const call = (path, init = {}, env = {}) => worker.fetch(new Request("http://relay.local" + path, init), env);
const u = (x) => "/?u=" + encodeURIComponent(x);

// 1. destino permitido, cabeçalho Flashbots passa
let r = await call(u("https://relay.flashbots.net"), { method: "POST", headers: { "content-type": "application/json", "x-flashbots-signature": "0xabc:0xdef", cookie: "x=1", origin: "https://a.github.io" }, body: '{"method":"eth_sendBundle"}' });
assert.equal(r.status, 200);
assert.equal(r.headers.get("access-control-allow-origin"), "*");
assert.equal(seen[0].url, "https://relay.flashbots.net/");
assert.equal(seen[0].headers["x-flashbots-signature"], "0xabc:0xdef");
assert.equal(seen[0].headers.cookie, undefined);

// 2. destino fora da lista → 403, nada é pedido
r = await call(u("https://evil.example/x"), { method: "POST", body: "{}" });
assert.equal(r.status, 403);
r = await call(u("http://relay.flashbots.net"), { method: "POST", body: "{}" });
assert.equal(r.status, 403);
r = await call(u("https://user:pw@relay.flashbots.net"), { method: "POST", body: "{}" });
assert.equal(r.status, 403);
r = await call(u("https://relay.flashbots.net.evil.example"), { method: "POST", body: "{}" });
assert.equal(r.status, 403);
assert.equal(seen.length, 1);

// 3. preflight
r = await call(u("https://rpc.titanbuilder.xyz"), { method: "OPTIONS", headers: { origin: "https://a.github.io" } });
assert.equal(r.status, 204);
assert.match(r.headers.get("access-control-allow-headers"), /x-flashbots-signature/);

// 4. origem restrita
const env = { ALLOWED_ORIGINS: "https://me.github.io" };
r = await call(u("https://rpc.titanbuilder.xyz"), { method: "POST", headers: { origin: "https://other.site" }, body: "{}" }, env);
assert.equal(r.status, 403);
r = await call(u("https://rpc.titanbuilder.xyz"), { method: "POST", headers: { origin: "https://me.github.io" }, body: "{}" }, env);
assert.equal(r.status, 200);
assert.equal(r.headers.get("access-control-allow-origin"), "https://me.github.io");

// 5. demasiado grande
r = await call(u("https://rpc.titanbuilder.xyz"), { method: "POST", body: "x".repeat(600 * 1024) });
assert.equal(r.status, 413);

console.log("relay: todos os testes passaram");
