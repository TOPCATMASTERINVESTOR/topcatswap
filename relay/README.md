# Relay dos bundles · Bundle relay

Os builders de bundles não aceitam pedidos vindos de páginas web (CORS). Este relay recebe do site o bundle **já assinado** e entrega-o ao builder:
- Não guarda nada.
- Não vê chaves.
- Só fala com os destinos de [allowlist.mjs](allowlist.mjs).

A app Ubuntu não precisa dele.

**Cloudflare Workers** (gratuito):

```bash
cd relay
npx wrangler login
npx wrangler deploy        # → https://topcatswap-relay.<conta>.workers.dev
```

Recomendado: em `wrangler.toml`, `ALLOWED_ORIGINS = "https://<utilizador>.github.io"`, para que só o teu site o use.

**No teu computador**: `node relay/server.mjs` (escuta em `http://127.0.0.1:8787`).

Depois põe o endereço em **Definições › Ligações › Relay dos bundles**, ou em `web-src/config.js` (`defaultRelay`) antes de gerar o site.

---

Builders do not accept requests from websites (CORS). This relay forwards already-signed bundles to a closed list of destinations ([allowlist.mjs](allowlist.mjs)). It stores nothing and never sees keys.
- Deploy with `npx wrangler deploy`, or run `node relay/server.mjs`.
- Then set the URL in **Settings › Connections › Bundle relay**.
