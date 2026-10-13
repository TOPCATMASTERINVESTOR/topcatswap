# Segurança · Security

*[English below](#english)*

O TopCatSwap mexe em carteiras. Este documento diz exatamente onde ficam as chaves, com quem a app comunica e como podes confirmar que não há backdoors. Todo o código está neste repositório. Não há código fechado, ofuscado ou descarregado de outro sítio em tempo de execução, com uma exceção assinalada abaixo (Trezor Connect).

## Onde ficam as chaves

| Carteira | Onde está a chave | O que a app recebe |
|---|---|---|
| Ledger | No dispositivo | Endereço e assinatura de cada transação |
| Trezor | No dispositivo | Endereço e assinatura |
| MetaMask, OKX, Rabby, Coinbase Wallet, Trust Wallet | Na extensão do navegador | Endereço e o hash da transação enviada |
| Carteira importada | Cifrada com a password dessa carteira | A chave em claro só existe em memória enquanto está desbloqueada (bloqueia ao fim de 30 min sem uso) |

**Carteiras importadas**:
- O formato é o keystore padrão da Ethereum (scrypt + AES-128-CTR), o mesmo do MetaMask e do Geth: [desktop/engine/keystore.js](desktop/engine/keystore.js).
- Na app Ubuntu fica em `~/.config/TopCatSwap/wallets/<endereço>.json`, com permissões `0600`.
- Na web fica no `localStorage` do site (chave `tcs-fs:/web/wallets/…`). Qualquer script com a mesma origem consegue ler esse ficheiro **cifrado**.
- Se publicares o site em `<utilizador>.github.io`, todos os teus repositórios com Pages partilham essa origem. Usa um domínio próprio ou uma conta só para o TopCatSwap se fores guardar carteiras importadas no site.
- Uma chave importada é menos segura do que uma carteira de hardware. Usa-a só para valores que aceitas arriscar.

## Com quem a app comunica

Só com estes destinos, e só quando é preciso:

- **O RPC da rede.** Por omissão é publicnode.com; podes trocar em Definições. Serve para ler saldos, cotações e estado, e para enviar transações sem proteção.
- **Os serviços de proteção MEV**, se ligada: MEV Blocker, Flashbots Protect, Merkle, PancakeSwap, 48 Club.
- **Os builders de bundles**: Flashbots, BuilderNet, Titan, beaverbuild, 48 Club, BlockRazor. A lista está em [desktop/engine/bundles.js](desktop/engine/bundles.js).
- **The Graph** (gateway.thegraph.com), para descobrir pools V4.
- **Trezor Connect** (connect.trezor.io), só na versão web e só se escolheres a Trezor. É o script oficial da Trezor; a política de segurança (CSP) das páginas só deixa carregar scripts deste site e de connect.trezor.io.
- **Na app Ubuntu, a página local das extensões**: um servidor em `127.0.0.1` (nunca na rede), com uma chave aleatória por arranque e verificação de Host e Origin: [desktop/engine/wallet-bridge.js](desktop/engine/wallet-bridge.js).
- **Na web, o relay que configurares** (para bundles). O relay recebe só transações **já assinadas** e só as passa para uma lista fechada de destinos: [relay/allowlist.mjs](relay/allowlist.mjs).

Não há telemetria, análise de uso, contas de utilizador, nem servidor do TopCatSwap.

Antes de enviar, cada transação é verificada: o endereço que assinou tem de ser o da carteira escolhida, senão nada é enviado.

## Confirmar que o que corres é este código

- **Site**:
  - Cada página carrega os scripts com hash de integridade (SRI).
  - `dist-web/SHA256SUMS.txt` lista o SHA-256 de cada ficheiro.
  - Gera-o tu (`node tools/build-web.js`) a partir deste código e compara com o site publicado.
- **App Ubuntu**:
  - Cada versão no GitHub (Releases) é gerada pelo workflow público [release.yml](.github/workflows/release.yml), com `SHA256SUMS.txt`.
  - Confirma com `sha256sum -c SHA256SUMS.txt`.
- **Dependências**: ethers v6 (MIT), as bibliotecas oficiais da Ledger e da Trezor, e o Electron. Na web, o ethers está em `web-src/vendor/ethers.umd.min.js` (v6.13.4, igual ao publicado no npm).

## Reportar um problema

Se encontrares uma falha de segurança, não abras um issue público. Usa **Security › Report a vulnerability** neste repositório (aviso privado do GitHub). Indica a versão, os passos para reproduzir e o impacto.

---

## English

TopCatSwap handles wallets. This document states exactly where keys live, who the app talks to, and how to verify there are no backdoors. All code is in this repository. Nothing is closed, obfuscated or downloaded at runtime, except Trezor Connect (noted below).

**Keys**
- Ledger and Trezor: the key stays on the device; the app only gets addresses and signatures.
- Browser extensions: the key stays in the extension.
- Imported wallets:
  - Standard Ethereum keystore (scrypt + AES), encrypted with that wallet's own password.
  - Stored in `~/.config/TopCatSwap/wallets` on Ubuntu (mode 0600), or in this site's `localStorage` on the web.
  - Same-origin scripts can read the **encrypted** file. On `<user>.github.io` all your Pages repos share one origin, so use a custom domain for imported wallets.
  - Less secure than a hardware wallet.

**Network**: the app only talks to the following.
- The chain RPC, MEV-protection RPCs, bundle builders and The Graph.
- Trezor Connect (web only, when the Trezor is chosen).
- On desktop, a `127.0.0.1` page with a per-launch random token for browser extensions.
- On the web, the relay you configure, which only receives already-signed transactions and only forwards to a closed list ([relay/allowlist.mjs](relay/allowlist.mjs)).

There is no telemetry, no accounts and no TopCatSwap server. Every signed transaction is checked to come from the chosen wallet before sending.

**Verify**
- Web pages use SRI hashes, and `dist-web/SHA256SUMS.txt` lists every file. Rebuild with `node tools/build-web.js` and compare.
- Ubuntu releases are built by the public [release.yml](.github/workflows/release.yml) with `SHA256SUMS.txt`.

**Report** vulnerabilities privately via **Security › Report a vulnerability**, not public issues.
