<p align="center"><img src="docs/logo.png" alt="TopCatSwap" width="360"></p>

# TopCatSwap

**Uniswap V2, V3 and V4 swaps with sandwich protection, private bundles and the wallet of your choice. Open source, no server, no backdoors.**

*English · [Português](README.pt.md)*

**Live app:** https://topcatmasterinvestor.github.io/topcatswap/

**Docs:** [User guide (PDF)](docs/topcatswap-user-guide-EN.pdf) · [Installation and hosting guide (PDF)](docs/topcatswap-installation-EN.pdf)

TopCatSwap compares the Uniswap V2, V3 and V4 pools for your pair, shows what you get from each and swaps on the best one, signed by your own wallet. Keys never leave the wallet and there is no TopCatSwap server in between: the code talks straight to the blockchain (RPC) and to your wallet.

| | Web | Ubuntu app | Command line |
|---|---|---|---|
| Swap (V2/V3/V4), Pools, Wallets | ✓ | ✓ | ✓ |
| Bundles (all-or-nothing, private) | ✓ (with relay) | ✓ | — |
| Ledger | ✓ USB: Chrome/Edge/Brave · Bluetooth: Android (Nano X, Stax, Flex) | ✓ USB | ✓ USB |
| Trezor | ✓ Trezor Connect | ✓ (experimental) | — |
| MetaMask, OKX, Rabby, Coinbase Wallet, Trust Wallet | ✓ direct | ✓ via local page | — |
| Imported wallets (up to 5, encrypted) | ✓ in the browser | ✓ on the computer | ✓ |
| English (US) and Português (PT) | ✓ | ✓ | ✓ |

Networks: Ethereum, Arbitrum One and BNB Smart Chain.

## How to use it

### Web app

Open the live app, or run it on your computer:

```bash
node tools/build-web.js          # creates dist-web/ (no npm install needed)
python3 -m http.server 8080 -d dist-web
# open http://localhost:8080
```

- **Ledger** needs Chrome, Edge, Brave or Opera (WebHID) on an `https://` or `localhost` address. On Linux, install the Ledger udev rules.
- **Bundles** need a *relay*, because builders do not accept requests from websites (CORS). See [Bundle relay](#bundle-relay).
- **Phones and tablets** (iPhone, iPad, Android; Chrome, Brave, Firefox, Safari):
  - The layout adapts, with navigation at the bottom and a single column.
  - Hardware wallets only show up when the browser can use them. On Android (Chrome, Edge or Brave) the Ledger Nano X, Stax or Flex work over Bluetooth (experimental). iPhone and Firefox give websites no Bluetooth.
  - MetaMask, Trust, OKX and Coinbase: open the site inside the wallet's app (there is a link for each one), or use an imported wallet.
- Settings and imported wallets stay in your browser's `localStorage` for this site. Nothing is sent to TopCatSwap servers (there are none).

### Ubuntu app

```bash
cd desktop
./build-ubuntu.sh
sudo apt install ./dist/TopCatSwap-1.1.2-amd64.deb
```

Full instructions: [Installation guide (PDF)](docs/topcatswap-installation-EN.pdf) and [desktop/INSTALL-UBUNTU.txt](desktop/INSTALL-UBUNTU.txt).

### Command line

```bash
cd desktop && npm install ethers @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth
node engine/topcatswap.en.js HELP     # English
node engine/topcatswap.js HELP        # Português
```

## Security

Read [SECURITY.md](SECURITY.md). It covers where keys live, who the app talks to, how to verify that what you run is this code, and how to report a problem.

In short:

- **Ledger and Trezor**: the key never leaves the device; you confirm each transaction on its screen.
- **Extensions** (MetaMask, …): the key stays in the extension; you confirm there.
- **Imported wallets**: the key is encrypted (standard Ethereum keystore, scrypt + AES) with a password for that wallet only, on your computer or in your browser. It is less secure than a hardware wallet.
- **No telemetry, no server of our own, no hidden API keys.**

## Bundle relay

Builders (Flashbots, BuilderNet, Titan, beaverbuild, 48 Club, BlockRazor) do not answer requests coming from web pages. The [relay/](relay/) folder has a minimal forwarder.
- It has a **closed list of destinations** ([relay/allowlist.mjs](relay/allowlist.mjs)).
- It only ever receives **already-signed** bundles.

```bash
# Cloudflare Workers (free account)
cd relay && npx wrangler deploy
# or on your computer
node relay/server.mjs      # http://127.0.0.1:8787
```

Then put the relay address in **Settings › Connections › Bundle relay**. You can also set it in `web-src/config.js` before the build, for every user of your site. The desktop app does not need a relay.

## Publishing on GitHub

1. Create a repository and push this code (`git push`).
2. In **Settings › Pages**, choose **Source: GitHub Actions**. The [pages.yml](.github/workflows/pages.yml) workflow builds and publishes the site on every push to `main`.
3. To release the Ubuntu app, run `git tag v1.1.2 && git push --tags`. The [release.yml](.github/workflows/release.yml) workflow builds the `.deb` and the `.AppImage` and publishes them with `SHA256SUMS`.

## Layout

```
desktop/            Electron app (Ubuntu) and the shared engine
  engine/           engine: quotes, swaps, bundles, wallets (*.en.js = English)
  renderer/         user interface
web-src/            browser adapters: shims, Ledger WebHID/Bluetooth, extensions, window.api
tools/build-web.js  builds dist-web/ from desktop/ + web-src/
tools/i18n/         generates the *.en.js files from the Portuguese sources
relay/              bundle relay (Cloudflare Worker or Node)
tests/              offline tests (relay, simulated Ledger, bundle flow)
docs/               PDF guides
```

The web app runs **the same engine** as the desktop app. Only system access (USB, files, local network) is replaced by browser equivalents.

## Development

```bash
node tools/build-web.js
node tests/relay.test.mjs
npm install --no-save --prefix .ci ethers@6.13.4
NODE_PATH=.ci/node_modules node tests/ledger-webhid.test.js
NODE_PATH=.ci/node_modules node tests/ledger-ble.test.js
NODE_PATH=.ci/node_modules node tests/bundles-flow.test.js
```

The source strings are written in Portuguese in the `*.js` files. To regenerate the English files, run `cd tools/i18n && python3 build_en.py ../../desktop`. For new sentences, add them to `en4.tsv`.

## Disclaimer

Experimental software with no warranty ([MIT](LICENSE) license). DeFi swaps carry a risk of loss. Start with small amounts. This is not financial advice.
