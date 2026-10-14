# Bundle relay · Relay dos bundles

Builders do not accept requests from web pages (CORS). This relay receives the **already-signed** bundle from the site and hands it to the builder.
- It stores nothing.
- It never sees keys.
- It only talks to the destinations in [allowlist.mjs](allowlist.mjs).

The Ubuntu app does not need it.

**Cloudflare Workers** (free):

```bash
cd relay
npx wrangler login
npx wrangler deploy        # → https://topcatswap-relay.<account>.workers.dev
```

Recommended: set `ALLOWED_ORIGINS = "https://<user>.github.io"` in `wrangler.toml`, so only your site can use the relay.

**On your computer**: `node relay/server.mjs` (listens on `http://127.0.0.1:8787`).

Then put the address in **Settings › Connections › Bundle relay**, or in `web-src/config.js` (`defaultRelay`) before building the site.
---

*Português*

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
