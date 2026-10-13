# Source-level patches applied to the Portuguese source BEFORE the
# literal-by-literal translation. Used where English word order differs
# or where file names / module paths must change in the English build.

PATCHES = {
    "engine/topcatswap.js": [
        ('''console.log("  Neste modo, " + NATIVE_SYMBOL + " e " + WRAPPED_SYMBOL + " são tokens diferentes: " + NATIVE_SYMBOL + " usa pools V4");
    console.log("  com " + NATIVE_SYMBOL + " nativo (e " + WRAPPED_SYMBOL + " embrulhado na V2/V3); " + WRAPPED_SYMBOL + " usa pools com " + WRAPPED_SYMBOL + ".\\n");''',
         '''console.log("  In this mode, " + NATIVE_SYMBOL + " and " + WRAPPED_SYMBOL + " are different tokens: " + NATIVE_SYMBOL + " uses V4 pools");
    console.log("  with native " + NATIVE_SYMBOL + " (and " + WRAPPED_SYMBOL + " wrapped on V2/V3); " + WRAPPED_SYMBOL + " uses pools with " + WRAPPED_SYMBOL + ".\\n");'''),
        ('''"      Para pools V4 com " + NATIVE_SYMBOL + " nativo usa " + NATIVE_SYMBOL + " (" + NATIVE_ETH + ").\\n"''',
         '''"      For V4 pools with native " + NATIVE_SYMBOL + " use " + NATIVE_SYMBOL + " (" + NATIVE_ETH + ").\\n"'''),
        ('''"(V2/V3 usam " + WRAPPED_SYMBOL + "; V4 inclui pools com " + NATIVE_SYMBOL + " nativo e com " + WRAPPED_SYMBOL + ").\\n"''',
         '''"(V2/V3 use " + WRAPPED_SYMBOL + "; V4 includes pools with native " + NATIVE_SYMBOL + " and with " + WRAPPED_SYMBOL + ").\\n"'''),
        ('''console.log("\\n  Por omissão: --chain=1 (Ethereum). Também aceita o nome ou o Chain ID");''',
         '''console.log("\\n  Default: --chain=1 (Ethereum). Also accepts the name or the Chain ID");'''),
    ],
    "engine/gui-engine.js": [
        ('require("./topcatswap")', 'require("./topcatswap.en")'),
        ('require("./trezor")', 'require("./trezor.en")'),
        ('require("./wallet-bridge")', 'require("./wallet-bridge.en")'),
        ('require("./keystore")', 'require("./keystore.en")'),
        ('require("./gui-bundles")', 'require("./gui-bundles.en")'),
        ('require("./bundles")', 'require("./bundles.en")'),
        ('"A " + walletName() + " ainda não está ligada. Abre a página de ligação (barra lateral)', 'walletName() + " ainda não está ligada. Abre a página de ligação (barra lateral)'),
        ('new Error("A " + walletName() + " ainda não está ligada. Abre a página de ligação e carrega', 'new Error(walletName() + " ainda não está ligada. Abre a página de ligação e carrega'),
    ],
    "engine/wallet-bridge.js": [
        ('"": ["connect.html", ', '"": ["connect.en.html", '),
        ('"connect.js": ["connect.js", ', '"connect.js": ["connect.en.js", '),
        ('return "A " + name + " não autorizou', 'return name + " não autorizou'),
        ('new Error("A " + name + " não respondeu a tempo', 'new Error(name + " não respondeu a tempo'),
    ],
    "engine/gui-bundles.js": [
        ('require("./bundles")', 'require("./bundles.en")'),
        ('reason = c.name ? "A " + c.name + " não tem builders de bundles (sem mempool público ou ainda não suportada)."',
         'reason = c.name ? c.name + " has no bundle builders (no public mempool or not supported yet)."'),
        ('throw new Error("A " + chain.name + " não tem builders de bundles.");', 'throw new Error(chain.name + " has no bundle builders.");'),
        ('blocking = "A carteira " + shortAddress(addr) + " não tem " + st.NATIVE_SYMBOL + " suficiente: tem " + fmtNumber(Number(ethers.formatEther(native))) +',
         'blocking = "Wallet " + shortAddress(addr) + " does not have enough " + st.NATIVE_SYMBOL + ": it has " + fmtNumber(Number(ethers.formatEther(native))) +'),
        ('blocking = "Saldo insuficiente de " + leg.ctx.symbolIn + " em " + shortAddress(leg.address) + ": tem " + fmtUnits(bal, leg.ctx.decimalsIn) + ".";',
         'blocking = "Insufficient " + leg.ctx.symbolIn + " balance in " + shortAddress(leg.address) + ": it has " + fmtUnits(bal, leg.ctx.decimalsIn) + ".";'),
    ],
    "renderer/app.js": [
        ('sub: "A " + h(wn) + " vive no navegador.', 'sub: h(wn) + " vive no navegador.'),
        ('''? "As contas do Ledger Live, de " + WALLET_PAGE + " em " + WALLET_PAGE + ". Escolhe a carteira ativa para os swaps."''',
         '''? "Your Ledger Live accounts, " + WALLET_PAGE + " at a time. Choose the active wallet for swaps."'''),
        ('''? "As contas do Trezor Suite (m/44'/60'/0'/0/N), de " + WALLET_PAGE + " em " + WALLET_PAGE + ". Escolhe a carteira ativa."''',
         '''? "Your Trezor Suite accounts (m/44'/60'/0'/0/N), " + WALLET_PAGE + " at a time. Choose the active wallet."'''),
    ],
}
