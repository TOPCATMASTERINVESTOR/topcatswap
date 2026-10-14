# Changelog

## Web 1.1.3
- Telemóveis e tablets:
  - Deteta telemóvel, tablet ou computador e o que o navegador consegue (USB, Bluetooth, app de carteira).
  - Navegação em baixo e barra da carteira em cima, numa só coluna, com janelas em ecrã inteiro.
- Carteiras no telemóvel:
  - As carteiras de hardware deixam de aparecer. Exceção: Ledger Nano X, Stax e Flex por Bluetooth (experimental), no Chrome, Edge ou Brave para Android.
  - MetaMask, Trust, OKX e Coinbase: um link abre o site dentro da app da carteira. No browser da app, a ligação é direta.
- No computador, a Ledger aparece desativada nos navegadores sem WebHID (Firefox, Safari) e a Trezor no Safari.

## Web 1.1.2
- Versão web completa, com o mesmo motor da app Ubuntu: Swap, Pools, Carteiras, Bundles e Definições, em PT e EN.
- Carteiras:
  - Ledger por WebHID (Chrome/Edge/Brave).
  - Trezor pelo Trezor Connect.
  - MetaMask, OKX, Rabby, Coinbase Wallet e Trust Wallet diretamente (EIP-6963).
  - Carteiras importadas cifradas no navegador.
- Relay dos bundles (`relay/`): Cloudflare Worker ou Node, com lista fechada de destinos.
- Páginas com CSP e hashes de integridade (SRI); `SHA256SUMS.txt` em cada build.

## 1.1.2
- Bundles: escolha dos tipos de pool (V2, V3, V4). Agora é possível excluir a V4.
- Corrigido "simulation: could not coalesce error":
  - Quando o RPC não suporta `eth_simulateV1`, o bundle segue com gas estimado por excesso, em vez de falhar.
  - O aviso mostra o erro real do RPC.
- Quando a simulação falha num swap V4, aparece a sugestão de desligar a V4.

## 1.1.1
- Separador Bundles:
  - Swap atómico, vários swaps, várias carteiras e revogar autorizações.
  - Redes Ethereum e BSC.
  - Envio a vários builders.

## 1.0.9
- Tutoriais em PDF (instalação e funcionamento, PT e EN).

## 1.0.7
- Carteiras importadas por chave privada: até 5, cada uma com a sua password.
- Interface e linha de comandos em inglês, com troca PT/EN dentro da app.

## 1.0.6
- Escolha da carteira no arranque: Ledger, Trezor, MetaMask, OKX, Rabby, Coinbase Wallet e Trust Wallet.
