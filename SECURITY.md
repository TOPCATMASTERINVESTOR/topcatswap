# Security

*English · [Português](SECURITY.pt.md)*

TopCatSwap handles wallets. This document states exactly where the keys live, who the app talks to and how you can verify there are no backdoors. All code is in this repository. There is no closed, obfuscated or runtime-downloaded code, with one exception noted below (Trezor Connect).

## Where the keys live

| Wallet | Where the key is | What the app receives |
|---|---|---|
| Ledger | On the device | The address and the signature of each transaction |
| Trezor | On the device | The address and the signature |
| MetaMask, OKX, Rabby, Coinbase Wallet, Trust Wallet | In the browser extension or wallet app | The address and the hash of the sent transaction |
| Imported wallet | Encrypted with that wallet's own password | The plain key exists only in memory while unlocked (it locks after 30 min without use) |

**Imported wallets**:
- They use the standard Ethereum keystore format (scrypt + AES-128-CTR), the same as MetaMask and Geth: [desktop/engine/keystore.js](desktop/engine/keystore.js).
- On the Ubuntu app they are stored in `~/.config/TopCatSwap/wallets/<address>.json`, with `0600` permissions.
- On the web they are stored in the site's `localStorage` (key `tcs-fs:/web/wallets/…`). Any script on the same origin can read that **encrypted** file.
- If you host the site on `<user>.github.io`, all your Pages repositories share that origin. Use your own domain, or an account just for TopCatSwap, if imported wallets will be kept on the site.
- An imported key is less secure than a hardware wallet. Use it only for amounts you are willing to risk.

## Who the app talks to

Only these destinations, and only when needed:

- **The network RPC.** The default is publicnode.com; you can change it in Settings. It is used to read balances, quotes and state, and to send unprotected transactions.
- **MEV-protection services**, when turned on: MEV Blocker, Flashbots Protect, Merkle, PancakeSwap, 48 Club.
- **Bundle builders**: Flashbots, BuilderNet, Titan, beaverbuild, 48 Club, BlockRazor. The list is in [desktop/engine/bundles.js](desktop/engine/bundles.js).
- **The Graph** (gateway.thegraph.com), to find V4 pools, only if you set your own key.
- **Trezor Connect** (connect.trezor.io), web only and only if you choose the Trezor. It is Trezor's official script. The pages' Content Security Policy only allows scripts from this site and from connect.trezor.io.
- **On the Ubuntu app, the local page for browser extensions.** It is a server on `127.0.0.1` (never on the network), with a random key per launch and Host and Origin checks: [desktop/engine/wallet-bridge.js](desktop/engine/wallet-bridge.js).
- **On the web, the relay you configure** (for bundles). It only receives transactions that are **already signed**, and only forwards them to a closed list of destinations: [relay/allowlist.mjs](relay/allowlist.mjs).

There is no telemetry, no usage analytics, no user accounts and no TopCatSwap server.

Before sending, every transaction is checked: the address that signed it must be the chosen wallet's address, otherwise nothing is sent.

## Verifying that what you run is this code

- **Website**:
  - Each page loads its scripts with integrity hashes (SRI).
  - `dist-web/SHA256SUMS.txt` lists the SHA-256 of every file.
  - Build it yourself (`node tools/build-web.js`) from this code and compare it with the published site.
- **Ubuntu app**:
  - Each version in GitHub Releases is built by the public [release.yml](.github/workflows/release.yml) workflow, with a `SHA256SUMS.txt` file.
  - Check it with `sha256sum -c SHA256SUMS.txt`.
- **Dependencies**: ethers v6 (MIT), the official Ledger and Trezor libraries, and Electron. On the web, ethers is in `web-src/vendor/ethers.umd.min.js` (v6.13.4, identical to the npm release).

## Reporting a problem

If you find a security issue, do not open a public issue. Use **Security › Report a vulnerability** in this repository (a private GitHub advisory). Include the version, the steps to reproduce and the impact.
