// ============================================================
// TopCatSwap — ponte entre a interface gráfica e o motor do bot
//
// Usa as mesmas funções do topcatswap.js (linha de comandos).
// Guarda em memória a última análise e o último resumo, e devolve
// à interface apenas dados simples (texto e números).
// ============================================================

const { ethers } = require("ethers");

const engine = require("./topcatswap");

const trezor = require("./trezor");

const walletBridge = require("./wallet-bridge");

const keystore = require("./keystore");


// Carteiras que a app sabe usar.
const WALLETS = {
    ledger: { name: "Ledger", hardware: true },
    trezor: { name: "Trezor", hardware: true },
    metamask: { name: "MetaMask", browser: true },
    okx: { name: "OKX Wallet", browser: true },
    rabby: { name: "Rabby", browser: true },
    coinbase: { name: "Coinbase Wallet", browser: true },
    trust: { name: "Trust Wallet", browser: true },
    local: { name: "Carteira importada", local: true }
};

// Escolha atual (vem das definições, via configure()).
const cfg = {
    wallet: "ledger",
    ledger: { mode: "index", index: 0 },
    trezor: { index: 0 },
    localAddress: ""
};

function walletName() {
    if (cfg.wallet === "local") {
        const e = keystore.list().find(w => cfg.localAddress && w.address.toLowerCase() === cfg.localAddress.toLowerCase());
        return e ? e.label : WALLETS.local.name;
    }
    return WALLETS[cfg.wallet].name;
}

function lockedError() {
    const e = new Error("A carteira importada está bloqueada. Desbloqueia-a com a password (botão na barra lateral).");
    e.locked = true;
    return e;
}

function isBrowserWallet() {
    return !!WALLETS[cfg.wallet].browser;
}

function configure(settings) {

    if (settings && WALLETS[settings.wallet]) cfg.wallet = settings.wallet;
    if (settings && settings.ledger) cfg.ledger = settings.ledger;
    if (settings && settings.trezor) cfg.trezor = settings.trezor;
    if (settings && typeof settings.localAddress === "string") cfg.localAddress = settings.localAddress;

    // Outra carteira escolhida: a chave importada deixa de estar em memória.
    const open = keystore.unlockedAddress();
    if (open && (cfg.wallet !== "local" || open.toLowerCase() !== String(cfg.localAddress).toLowerCase())) {
        keystore.lock("troca");
    }

    if (isBrowserWallet()) {
        walletBridge.configure({ wallet: cfg.wallet });
        return walletBridge.start().catch(() => null);
    }

    return Promise.resolve(null);
}


// Estado da sessão (só no processo principal).
const session = {
    analysis: null,
    prepared: null,
    busy: false,
    // Contadores para ignorar resultados de pedidos cancelados.
    analyzeSeq: 0,
    prepareSeq: 0
};


function cancelledError(what) {
    const error = new Error(what + " cancelada.");
    error.cancelled = true;
    return error;
}


// Cancelar: a interface volta logo atrás; o trabalho em curso
// termina em segundo plano e o resultado é ignorado.
function cancel(kind) {
    if (kind === "analyze") session.analyzeSeq++;
    if (kind === "prepare") session.prepareSeq++;
    return true;
}


// ============================================================
// FORMATAÇÃO
// ============================================================

function fmtNumber(n) {

    if (!Number.isFinite(n)) return "—";
    if (n === 0) return "0";

    const abs = Math.abs(n);

    if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (abs >= 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

    return Number(n.toPrecision(6)).toString();
}


function fmtUnits(raw, decimals) {
    return fmtNumber(Number(ethers.formatUnits(raw, decimals)));
}


function fmtUSD(value) {
    return engine.validNumber(value) ? "$" + engine.formatUSD(value) : "—";
}


function fmtCompactUSD(value) {

    if (!engine.validNumber(value)) return "—";

    const v = Number(value);

    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "k";

    return "$" + v.toFixed(0);
}


function shortAddress(address) {
    const a = ethers.getAddress(address);
    return a.slice(0, 6) + "…" + a.slice(-4);
}


function feeLabel(fee) {
    return engine.isDynamicFee(fee) ? "dinâmica" : (Number(fee) / 10000).toFixed(2) + "%";
}


function gwei(wei) {
    return Number(ethers.formatUnits(wei, "gwei")).toFixed(3) + " gwei";
}


// ============================================================
// REDES
// ============================================================

function chainsInfo() {

    return Object.entries(engine.CHAINS).map(([number, c]) => ({
        number: Number(number),
        key: c.key,
        name: c.name,
        supported: !c.unsupported,
        reason: c.unsupported || null,
        chainId: c.chainId ? String(c.chainId) : null,
        nativeSymbol: c.nativeSymbol || null,
        wrappedSymbol: c.wrappedSymbol || null,
        wrapped: c.wrapped || null,
        usdc: c.usdc || null,
        explorer: c.explorer || null,
        explorerName: c.explorerName || null,
        rpcEnv: c.rpcEnv || null,
        rpcDefault: c.rpc || null,
        protect: c.protect
            ? Object.entries(c.protect).map(([key, p]) => ({ key, name: p.name }))
            : [],
        defaultProtect: c.defaultProtect || null,
        noProtectReason: c.noProtectReason || null
    }));
}


async function useChain(number) {

    engine.applyChain(engine.findChain(String(number)));

    await engine.checkChainRpc();

    return engine.getState().CHAIN;
}


// Converte a escolha de conta das definições nas opções do bot.
function ledgerFlags(ledger) {

    const mode = (ledger && ledger.mode) || "index";

    if (mode === "from" && ledger.from) return { from: ledger.from };
    if (mode === "path" && ledger.path) return { path: ledger.path };

    return { index: String((ledger && ledger.index) || 0) };
}


// Só um pedido de cada vez fala com a Ledger (um pedido cancelado
// pode ainda estar a terminar quando chega o seguinte).
let ledgerQueue = Promise.resolve();

function withLedger(fn) {

    const run = ledgerQueue.then(async () => {

        const ledger = await engine.connectLedger();

        try {
            return await fn(ledger);
        } finally {
            try { await ledger.transport.close(); } catch (_) {}
        }
    });

    ledgerQueue = run.catch(() => {});

    return run;
}


// Liga à carteira escolhida e devolve (assinante, conta).
// Ledger e Trezor: um pedido de cada vez. Navegador: conta ativa na extensão.
function withSigner(fn) {

    if (cfg.wallet === "ledger") {
        return withLedger(async (ledger) => {
            const account = await engine.resolveLedgerAccount(ledger, ledgerFlags(cfg.ledger));
            return fn(ledger, account);
        });
    }

    if (cfg.wallet === "local") {

        return (async () => {
            const open = keystore.unlockedAddress();
            if (!open || open.toLowerCase() !== String(cfg.localAddress).toLowerCase()) {
                throw lockedError();
            }
            return fn(keystore.signer(), { address: open, path: null });
        })();
    }

    if (cfg.wallet === "trezor") {

        const run = ledgerQueue.then(async () => {
            const index = Math.max(0, Math.floor(Number(cfg.trezor && cfg.trezor.index) || 0));
            const account = await trezor.getAccount(index);
            return fn(trezor.signer(), account);
        });

        ledgerQueue = run.catch(() => {});

        return run;
    }

    return (async () => {

        const list = await walletBridge.accounts();

        if (list.length === 0) {
            throw new Error(
                "A " + walletName() + " ainda não está ligada. Abre a página de ligação (barra lateral) e carrega em Ligar."
            );
        }

        const account = { address: ethers.getAddress(list[0]), path: null };

        return fn(walletBridge.signer(engine.getState().CHAIN), account);
    })();
}


function accountPath(account) {
    return account.path ? "m/" + account.path : walletName();
}


// ============================================================
// TOKENS E SALDOS (sem Ledger)
// ============================================================

async function tokenInfo({ chain, token }) {

    await useChain(chain);

    const address = engine.resolveTokenArg(token);

    if (!ethers.isAddress(address)) {
        throw new Error("Endereço de token inválido.");
    }

    let info;

    try {
        info = await engine.getTokenInfo(address);
    } catch (_) {
        throw new Error("Não consegui ler este token. É um contrato ERC20 nesta rede?");
    }

    return { address: engine.lc(address), symbol: info.symbol, decimals: info.decimals };
}


async function balance({ chain, token, address }) {

    await useChain(chain);

    const tokenAddress = engine.resolveTokenArg(token);
    const info = await engine.getTokenInfo(tokenAddress);
    const raw = await engine.getBalance(engine.lc(tokenAddress), address);

    return {
        raw: raw.toString(),
        value: ethers.formatUnits(raw, info.decimals),
        text: fmtUnits(raw, info.decimals),
        symbol: info.symbol
    };
}


// ============================================================
// ANÁLISE DE POOLS
// ============================================================

function poolView(pool, ctx, index) {

    const hooks = pool.version === "V4" && pool.hooks && engine.lc(pool.hooks) !== engine.NATIVE_ETH;

    let detail = pool.currencyInLabel + " → " + pool.currencyOutLabel;

    if (pool.version === "V4") detail += hooks ? " · com hook" : " · sem hook";
    if (pool.version === "V2") detail += " · pair";

    return {
        index,
        version: pool.version,
        detail,
        fee: feeLabel(pool.fee),
        tvl: fmtCompactUSD(pool.tvlUSD),
        out: pool.quoteOK ? fmtUnits(pool.amountOutRaw, ctx.decimalsOut) : "—",
        outNum: pool.quoteOK ? Number(ethers.formatUnits(pool.amountOutRaw, ctx.decimalsOut)) : null,
        impact: engine.validNumber(pool.priceImpactPercent)
            ? Math.max(0, pool.priceImpactPercent).toFixed(2) + "%"
            : (engine.isDynamicFee(pool.fee) ? "n/d" : "—"),
        gas: fmtUSD(pool.txFeeUSD),
        net: fmtUSD(pool.netOutUSD),
        quoteOK: !!pool.quoteOK,
        error: pool.quoteOK ? null : (pool.quoteError || "sem cotação"),
        hooks: !!hooks,
        id: pool.id
    };
}


async function analyze(params) {

    const seq = ++session.analyzeSeq;

    const chain = await useChain(params.chain);

    const versions = new Set((params.versions || ["V2", "V3", "V4"]).map(v => String(v).toUpperCase()));

    if (versions.size === 0) {
        throw new Error("Escolhe pelo menos uma versão da Uniswap.");
    }

    const ctx = await engine.buildContext(params.tokenIn, params.tokenOut, String(params.amount), {
        exactV4: true,
        versions
    });

    const fees = await engine.getFeeParams(params.fee || 1);

    ctx.gasPrice = fees.effectiveGasPrice;

    const result = await engine.analyzePools(ctx);

    // Cotadas primeiro, da que entrega mais para a que entrega menos.
    const pools = result.selected.slice().sort((a, b) => {
        if (a.quoteOK && !b.quoteOK) return -1;
        if (!a.quoteOK && b.quoteOK) return 1;
        if (!a.quoteOK && !b.quoteOK) return 0;
        return b.amountOutRaw > a.amountOutRaw ? 1 : b.amountOutRaw < a.amountOutRaw ? -1 : 0;
    });

    if (seq !== session.analyzeSeq) {
        throw cancelledError("Análise");
    }

    session.analysis = { chain: params.chain, ctx, pools, params };
    session.prepared = null;

    const views = pools.map((p, i) => poolView(p, ctx, i));
    const best = views.find(v => v.quoteOK) || null;

    return {
        chainName: chain.name,
        symbolIn: ctx.symbolIn,
        symbolOut: ctx.symbolOut,
        amountIn: ctx.amountIn,
        gas: gwei(fees.effectiveGasPrice),
        versions: [...versions],
        counts: {
            V2: result.v2Pools.length,
            V3: result.v3Pools.length,
            V4: result.v4Pools.length,
            total: result.allPools.length,
            quoted: views.filter(v => v.quoteOK).length
        },
        pools: views,
        bestIndex: best ? best.index : null
    };
}


// ============================================================
// RESUMO (lê a Ledger, saldos e autorizações)
// ============================================================

async function prepare(params) {

    const seq = ++session.prepareSeq;

    const a = session.analysis;

    if (!a) {
        throw new Error("Faz primeiro a análise de pools.");
    }

    const chain = await useChain(a.chain);
    const st = engine.getState();
    const ctx = a.ctx;
    const pool = a.pools[params.poolIndex];

    if (!pool || !pool.quoteOK) {
        throw new Error("Esta pool não tem cotação. Escolhe outra.");
    }

    const slippage = Number(String(params.slippage).replace(",", "."));

    if (!Number.isFinite(slippage) || slippage < engine.MIN_SLIPPAGE_PERCENT || slippage > engine.MAX_SLIPPAGE_PERCENT) {
        throw new Error("Slippage inválido: usa um valor entre 0.01 e 50%.");
    }

    const fee = Number(params.fee) || 1;

    // Prazo do swap (Definições), em minutos: 1 a 60, por omissão 3.
    const deadlineMinutes = Math.min(60, Math.max(1, Math.round(Number(params.deadlineMinutes) || 3)));

    // Proteção MEV só nas redes com RPC privado.
    let protect = null;

    // Carteiras de navegador enviam pela própria carteira: o RPC privado não se aplica.
    if (params.protect && st.DEFAULT_PROTECT && !isBrowserWallet()) {

        const key = params.provider && st.PROTECT_RPCS[params.provider] ? params.provider : st.DEFAULT_PROTECT;

        protect = engine.parseProtect(key);

        await engine.checkProtectRpc(protect);
    }

    const slippageBps = BigInt(Math.round(slippage * 100));
    const amountOutMin = (pool.amountOutRaw * (10000n - slippageBps)) / 10000n;

    if (amountOutMin <= 0n) {
        throw new Error("O mínimo a receber é zero: o montante é demasiado pequeno.");
    }

    const fees = await engine.getFeeParams(fee);
    const flags = ledgerFlags(cfg.ledger);

    const read = await withSigner(async (_signer, account) => {

        const [nativeBalance, balanceIn, balanceOut, approvals] = await Promise.all([
            st.provider.getBalance(account.address),
            engine.getBalance(ctx.tokenIn, account.address),
            engine.getBalance(ctx.tokenOut, account.address),
            engine.checkApprovals(ctx, account.address)
        ]);

        return { account, nativeBalance, balanceIn, balanceOut, approvals };
    });

    if (seq !== session.prepareSeq) {
        throw cancelledError("Leitura da carteira");
    }

    const { account, nativeBalance, balanceIn, balanceOut, approvals } = read;

    // Estimativa grosseira de gas (igual ao modo SWAP do bot).
    const approvalsCount = (approvals.needsErc20 ? 1 : 0) + (approvals.needsPermit2 ? 1 : 0);
    const roughGas = (pool.gasEstimate !== null ? BigInt(pool.gasEstimate) : 200000n) + 150000n + BigInt(approvalsCount) * 70000n;
    const roughCost = roughGas * fees.effectiveGasPrice;
    const nativeNeeded = roughCost + (engine.isNative(ctx.tokenIn) ? ctx.amountInRaw : 0n);

    const warnings = [];
    let blocking = null;

    if (balanceIn < ctx.amountInRaw) {
        blocking =
            "Saldo insuficiente: tens " + fmtUnits(balanceIn, ctx.decimalsIn) + " " + ctx.symbolIn +
            " e precisas de " + ctx.amountIn + ".";
    }

    if (nativeBalance < nativeNeeded) {
        warnings.push(
            "O saldo de " + st.NATIVE_SYMBOL + " pode não chegar para o gas (estimativa ~" +
            fmtNumber(Number(ethers.formatEther(roughCost))) + " " + st.NATIVE_SYMBOL + ")."
        );
    }

    if (slippage > engine.HIGH_SLIPPAGE_PERCENT) {
        warnings.push(
            "Slippage acima de " + engine.HIGH_SLIPPAGE_PERCENT + "%: a perda máxima é elevada." +
            (protect ? "" : " Liga a proteção MEV.")
        );
    }

    if (isBrowserWallet() && params.protect && st.DEFAULT_PROTECT) {
        warnings.push(
            "Com a " + walletName() + " o envio é feito pela própria carteira, por isso a proteção MEV do topcatswap " +
            "não se aplica. Protege-te na carteira: MetaMask → Smart Transactions ativo, ou adiciona o RPC " +
            "MEV Blocker (https://rpc.mevblocker.io) à carteira, e usa um slippage baixo."
        );
    }

    if (pool.version === "V2") {
        warnings.push("Cotação V2 calculada pelas reservas: se o token cobrar taxa na venda, o slippage tem de ser superior à taxa.");
    }

    if (pool.version === "V4" && pool.hooks && engine.lc(pool.hooks) !== engine.NATIVE_ETH) {
        warnings.push("Esta pool V4 tem um hook (código de terceiros): " + pool.hooks);
    }

    const wName = walletName();
    const browser = isBrowserWallet();

    const plan = [{ id: "ledger", title: wName + " ligada", sub: "Confirmar a carteira" }];

    if (approvals.needsErc20) {
        plan.push({ id: "approve", title: "Aprovar " + ctx.symbolIn + " no Permit2", sub: "Uma vez por token" });
    }

    if (approvals.needsPermit2) {
        plan.push({ id: "permit2", title: "Autorizar o Universal Router", sub: "Limitado ao montante · expira em 1h" });
    }

    if (protect) {
        plan.push({ id: "quote", title: "Confirmar a cotação", sub: "Nova cotação antes de assinar" });
    }

    plan.push(
        { id: "simulate", title: "Simulação on-chain", sub: "Se falhar, nada é enviado" },
        browser
            ? { id: "sign", title: "Confirmação na " + wName, sub: "Confirma na janela da extensão" }
            : cfg.wallet === "local"
                ? { id: "sign", title: "Assinatura nesta app", sub: "Com a chave importada (" + wName + ")" }
                : { id: "sign", title: "Assinatura na " + wName, sub: "Confirma no dispositivo" },
        { id: "send", title: protect ? "Envio privado" : "Envio", sub: protect ? protect.name + " · fora do mempool público" : browser ? "Enviado pela " + wName : "Mempool público" },
        { id: "confirm", title: "Inclusão num bloco", sub: "À espera da confirmação" }
    );

    const transactions = [];

    if (engine.isNative(ctx.tokenIn)) {
        transactions.push({ needed: false, title: "Aprovar no Permit2", note: "Não é preciso: vendes " + st.NATIVE_SYMBOL + " nativo" });
    } else {
        transactions.push({
            needed: approvals.needsErc20,
            title: "Aprovar " + ctx.symbolIn + " no Permit2",
            note: approvals.needsErc20 ? "Uma vez por token (ilimitado)" : "Já aprovado"
        });
        transactions.push({
            needed: approvals.needsPermit2,
            title: "Permit2 → Universal Router",
            note: approvals.needsPermit2 ? "Limitado a " + ctx.amountIn + " " + ctx.symbolIn + " · expira em 1h" : "Já autorizado"
        });
    }

    transactions.push({
        needed: true,
        title: "Swap no Universal Router",
        note: (engine.isNative(ctx.tokenIn) ? "Valor " + ctx.amountIn + " " + st.NATIVE_SYMBOL + " · " : "") +
            "gas ~" + fmtNumber(Number(ethers.formatEther(roughCost))) + " " + st.NATIVE_SYMBOL
    });

    session.prepared = {
        poolIndex: params.poolIndex,
        pool,
        amountOutMin,
        slippage,
        fee,
        protect,
        flags,
        deadlineSeconds: deadlineMinutes * 60,
        address: account.address,
        path: account.path,
        plan
    };

    const feeLevel = engine.FEE_LEVELS[fee];

    return {
        chainName: chain.name,
        address: account.address,
        addressShort: shortAddress(account.address),
        path: accountPath(account),
        wallet: { key: cfg.wallet, name: wName, browser, local: cfg.wallet === "local" },
        pool: poolView(pool, ctx, params.poolIndex),
        amountIn: ctx.amountIn,
        symbolIn: ctx.symbolIn,
        symbolOut: ctx.symbolOut,
        expectedOut: fmtUnits(pool.amountOutRaw, ctx.decimalsOut),
        minOut: fmtUnits(amountOutMin, ctx.decimalsOut),
        slippage: String(slippage),
        speed: (fee === 1 ? "Normal" : fee === 2 ? "Rápido (+10%)" : "Mais rápido (+30%)") + " · gas ~" + gwei(fees.effectiveGasPrice),
        speedName: feeLevel ? feeLevel.name : "NORMAL",
        protect: protect ? { name: protect.name } : null,
        protectApplicable: !!st.DEFAULT_PROTECT,
        noProtectReason: st.CHAIN.noProtectReason || null,
        deadline: deadlineMinutes + (deadlineMinutes === 1 ? " minuto" : " minutos"),
        router: shortAddress(st.UNIVERSAL_ROUTER),
        transactions,
        balances: [
            { symbol: ctx.symbolIn, text: fmtUnits(balanceIn, ctx.decimalsIn) },
            { symbol: ctx.symbolOut, text: fmtUnits(balanceOut, ctx.decimalsOut) },
            ...(engine.isNative(ctx.tokenIn) || engine.isNative(ctx.tokenOut)
                ? []
                : [{ symbol: st.NATIVE_SYMBOL + " (gas)", text: fmtNumber(Number(ethers.formatEther(nativeBalance))) }])
        ],
        warnings,
        blocking,
        plan
    };
}


// ============================================================
// EXECUÇÃO (approvals + nova cotação + simulação + swap)
// ============================================================

async function execute(emit) {

    const a = session.analysis;
    const p = session.prepared;

    if (!a || !p) {
        throw new Error("Não há nenhum swap preparado.");
    }

    if (session.busy) {
        throw new Error("Já há um swap em curso.");
    }

    session.busy = true;

    const step = (id, state, sub) => emit({ id, state, sub: sub || null });

    try {

        const chain = await useChain(a.chain);
        const st = engine.getState();
        const ctx = a.ctx;
        const pool = p.pool;

        const wName = walletName();
        const confirmText = isBrowserWallet()
            ? "Confirma na janela da " + wName
            : cfg.wallet === "local" ? "A assinar com a chave importada…" : "Confirma no ecrã da " + wName;

        step("ledger", "active", "A ligar à " + wName + "…");

        return await withSigner(async (ledger, account) => {

            if (engine.lc(account.address) !== engine.lc(p.address)) {
                throw new Error(
                    "A conta ativa na " + wName + " (" + shortAddress(account.address) + ") não é a do resumo (" +
                    shortAddress(p.address) + "). Volta ao resumo para o preparar de novo."
                );
            }

            step("ledger", "done", shortAddress(account.address) + " · " + accountPath(account));

            // Espera pela transação privada: pelo menos 5 min, e mais do que o prazo.
            const waitSeconds = Math.max(300, p.deadlineSeconds + 60);

            const hooksFor = (id) => ({
                waitSeconds,
                onAwaitLedger: () => step(id, "active", confirmText),
                onSent: () => step(id, "active", "Enviada · à espera do bloco")
            });

            // Autorizações (verificadas de novo agora).
            const approvals = await engine.checkApprovals(ctx, account.address);

            if (approvals.needsErc20) {

                step("approve", "active", "A preparar…");

                if (ctx.tokenIn === engine.USDT && approvals.erc20Allowance > 0n) {

                    const resetRequest = {
                        from: account.address,
                        to: ctx.tokenIn,
                        data: engine.erc20Interface.encodeFunctionData("approve", [st.PERMIT2, 0n]),
                        value: 0n
                    };

                    resetRequest.gasLimit = await engine.estimateGasLimit(resetRequest);

                    await engine.signAndSend(ledger, account, resetRequest, "USDT: repor approve a 0", p.fee, p.protect, hooksFor("approve"));
                }

                const request = {
                    from: account.address,
                    to: ctx.tokenIn,
                    data: engine.erc20Interface.encodeFunctionData("approve", [st.PERMIT2, ethers.MaxUint256]),
                    value: 0n
                };

                request.gasLimit = await engine.estimateGasLimit(request);

                await engine.signAndSend(ledger, account, request, "approve " + ctx.symbolIn + " → Permit2", p.fee, p.protect, hooksFor("approve"));

                step("approve", "done", "Aprovado");

            } else if (p.plan.some(s => s.id === "approve")) {

                step("approve", "done", "Já não era preciso");
            }

            if (approvals.needsPermit2) {

                step("permit2", "active", "A preparar…");

                const expiration = BigInt(Math.floor(Date.now() / 1000) + engine.PERMIT2_EXPIRATION_SECONDS);

                const request = {
                    from: account.address,
                    to: st.PERMIT2,
                    data: engine.permit2Interface.encodeFunctionData("approve", [ctx.tokenIn, st.UNIVERSAL_ROUTER, ctx.amountInRaw, expiration]),
                    value: 0n
                };

                request.gasLimit = await engine.estimateGasLimit(request);

                await engine.signAndSend(ledger, account, request, "Permit2 → Universal Router", p.fee, p.protect, hooksFor("permit2"));

                step("permit2", "done", "Autorizado");

            } else if (p.plan.some(s => s.id === "permit2")) {

                step("permit2", "done", "Já não era preciso");
            }

            // Nova cotação (com proteção MEV).
            if (p.protect) {

                step("quote", "active", "A cotar de novo…");

                const previous = pool.amountOutRaw;

                pool.quoteOK = false;

                await engine.quotePool(pool, ctx);

                if (!pool.quoteOK) {
                    throw new Error("A nova cotação falhou; nada foi enviado. Motivo: " + pool.quoteError);
                }

                if (pool.amountOutRaw < p.amountOutMin) {
                    throw new Error(
                        "O preço piorou abaixo do mínimo garantido (" + fmtUnits(p.amountOutMin, ctx.decimalsOut) + " " +
                        ctx.symbolOut + "). Nada foi enviado. Antes: " + fmtUnits(previous, ctx.decimalsOut) +
                        ", agora: " + fmtUnits(pool.amountOutRaw, ctx.decimalsOut) + "."
                    );
                }

                step("quote", "done", fmtUnits(pool.amountOutRaw, ctx.decimalsOut) + " " + ctx.symbolOut + " · acima do mínimo " + fmtUnits(p.amountOutMin, ctx.decimalsOut));
            }

            // Simulação.
            step("simulate", "active", "A simular…");

            const swapRequest = engine.buildSwapRequest(
                pool,
                ctx,
                p.amountOutMin,
                account.address,
                p.deadlineSeconds
            );

            try {
                swapRequest.gasLimit = await engine.estimateGasLimit(swapRequest);
            } catch (error) {
                throw new Error(
                    "A simulação do swap falhou; nada foi enviado. Motivo: " + engine.revertReason(error) +
                    " (pode ser o preço ter mudado acima do slippage; as autorizações feitas mantêm-se)."
                );
            }

            step("simulate", "done", "O swap passa · gas limit " + swapRequest.gasLimit.toString());

            const outBefore = await engine.getBalance(ctx.tokenOut, account.address);

            let hash = null;
            let link = null;

            const receipt = await engine.signAndSend(
                ledger,
                account,
                swapRequest,
                "SWAP " + ctx.amountIn + " " + ctx.symbolIn + " → " + ctx.symbolOut,
                p.fee,
                p.protect,
                {
                    waitSeconds,
                    onAwaitLedger: () => step("sign", "active", confirmText),
                    onSent: (h, url) => {
                        hash = h;
                        link = url;
                        step("sign", "done", "Assinado");
                        step("send", "done", h.slice(0, 10) + "…" + h.slice(-6));
                        step("confirm", "active", "À espera do bloco…");
                    }
                }
            );

            step("confirm", "done", "Bloco " + receipt.blockNumber);

            const [inAfter, outAfter, nativeAfter] = await Promise.all([
                engine.getBalance(ctx.tokenIn, account.address),
                engine.getBalance(ctx.tokenOut, account.address),
                st.provider.getBalance(account.address)
            ]);

            const received = outAfter - outBefore;
            const gasCost = receipt.gasUsed * (receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n);

            session.prepared = null;

            return {
                chainName: chain.name,
                hash,
                hashShort: hash.slice(0, 10) + "…" + hash.slice(-6),
                explorerName: chain.explorerName,
                explorerUrl: chain.explorer + "/tx/" + hash,
                trackUrl: link,
                block: String(receipt.blockNumber),
                gasUsed: receipt.gasUsed.toString(),
                gasCost: fmtNumber(Number(ethers.formatEther(gasCost))) + " " + st.NATIVE_SYMBOL,
                pool: poolView(pool, ctx, p.poolIndex),
                protect: p.protect ? p.protect.name : null,
                amountIn: ctx.amountIn,
                symbolIn: ctx.symbolIn,
                symbolOut: ctx.symbolOut,
                received: engine.isNative(ctx.tokenOut) ? null : fmtUnits(received, ctx.decimalsOut),
                balances: [
                    { symbol: ctx.symbolIn, text: fmtUnits(inAfter, ctx.decimalsIn) },
                    { symbol: ctx.symbolOut, text: fmtUnits(outAfter, ctx.decimalsOut) },
                    ...(engine.isNative(ctx.tokenIn) || engine.isNative(ctx.tokenOut)
                        ? []
                        : [{ symbol: st.NATIVE_SYMBOL, text: fmtNumber(Number(ethers.formatEther(nativeAfter))) }])
                ],
                nativeNote: engine.isNative(ctx.tokenIn) || engine.isNative(ctx.tokenOut)
                    ? "O saldo de " + st.NATIVE_SYMBOL + " já desconta o gas pago."
                    : null
            };
        });

    } finally {

        session.busy = false;
    }
}


// ============================================================
// CARTEIRAS
// ============================================================

async function wallets({ chain, token, start = 0, count = engine.WALLET_COUNT }) {

    start = Math.max(0, Math.floor(Number(start) || 0));
    count = Math.min(20, Math.max(1, Math.floor(Number(count) || engine.WALLET_COUNT)));

    await useChain(chain);

    const st = engine.getState();
    const tokenAddress = engine.lc(token ? engine.resolveTokenArg(token) : engine.NATIVE_ETH);

    if (!ethers.isAddress(tokenAddress)) {
        throw new Error("Endereço de token inválido.");
    }

    let info;

    try {
        info = await engine.getTokenInfo(tokenAddress);
    } catch (_) {
        throw new Error("Não consegui ler este token. É um contrato ERC20 nesta rede?");
    }

    let list;
    let active = null;

    if (cfg.wallet === "ledger") {
        list = await withLedger(ledger => engine.getLedgerWallets(ledger, count, start));
    } else if (cfg.wallet === "trezor") {
        list = await trezor.getAccounts(start, count);
    } else if (cfg.wallet === "local") {
        // Todas as carteiras importadas (os endereços não precisam da password).
        list = start === 0 ? keystore.list().map((w, i) => ({ index: i, path: null, address: w.address, label: w.label })) : [];
        if (start === 0 && list.length === 0) throw new Error("Ainda não importaste nenhuma carteira.");
        active = cfg.localAddress ? ethers.getAddress(cfg.localAddress) : null;
    } else {
        // Carteira de navegador: as contas que a extensão autorizou (a primeira é a ativa).
        const accounts = start === 0 ? await walletBridge.accounts() : [];
        if (start === 0 && accounts.length === 0) {
            throw new Error("A " + walletName() + " ainda não está ligada. Abre a página de ligação e carrega em Ligar.");
        }
        list = accounts.map((a, i) => ({ index: i, path: null, address: ethers.getAddress(a) }));
        active = list.length ? list[0].address : null;
    }

    const balances = await Promise.all(list.map(w => engine.getBalance(tokenAddress, w.address)));

    let price = null;

    try {
        price = await engine.getTokenPriceUSD(tokenAddress, await engine.getETHPriceUSD());
    } catch (_) {}

    let total = 0n;

    const rows = list.map((w, i) => {

        total += balances[i];

        const amount = Number(ethers.formatUnits(balances[i], info.decimals));

        return {
            index: w.index,
            address: w.address,
            addressShort: shortAddress(w.address),
            path: w.path ? "m/" + w.path : (w.label || walletName()),
            label: w.label || null,
            balance: fmtUnits(balances[i], info.decimals),
            amount,
            usdValue: engine.validNumber(price) ? amount * price : null,
            usd: engine.validNumber(price) ? fmtUSD(amount * price) : null
        };
    });

    const totalAmount = Number(ethers.formatUnits(total, info.decimals));

    return {
        symbol: engine.isNative(tokenAddress) ? st.NATIVE_SYMBOL : info.symbol,
        token: tokenAddress,
        start,
        count,
        wallet: { key: cfg.wallet, name: walletName(), browser: isBrowserWallet() },
        active,
        more: !isBrowserWallet() && cfg.wallet !== "local",
        wallets: rows,
        total: fmtUnits(total, info.decimals),
        totalUsd: engine.validNumber(price) ? fmtUSD(totalAmount * price) : null
    };
}


// ============================================================
// LEDGER E LIGAÇÕES
// ============================================================

async function ledgerStatus() {

    if (cfg.wallet === "local") {
        const open = keystore.unlockedAddress();
        return {
            wallet: "local",
            connected: !!open && open.toLowerCase() === String(cfg.localAddress).toLowerCase(),
            address: cfg.localAddress || null,
            name: walletName(),
            busy: session.busy
        };
    }

    if (cfg.wallet === "trezor") {
        try {
            await trezor.init();
            const t = trezor.status();
            return { wallet: "trezor", connected: t.connected, busy: session.busy };
        } catch (error) {
            return { wallet: "trezor", connected: false, busy: session.busy, error: error.message };
        }
    }

    if (isBrowserWallet()) {
        return Object.assign({ busy: session.busy }, walletBridge.state());
    }

    try {

        const libs = engine.loadLedgerLibs();
        const list = await libs.TransportNodeHid.list();

        return { wallet: "ledger", connected: list.length > 0, busy: session.busy };

    } catch (error) {

        return { wallet: "ledger", connected: false, busy: session.busy, error: error.message };
    }
}


async function testConnections() {

    const results = [];

    for (const c of chainsInfo().filter(x => x.supported)) {

        const url = process.env[c.rpcEnv] || c.rpcDefault;

        try {

            const id = BigInt(await engine.rpcCall(url, "eth_chainId", []));

            results.push({
                chain: c.number,
                ok: String(id) === c.chainId,
                text: String(id) === c.chainId ? "Ligado" : "Rede errada (" + id + ")"
            });

        } catch (error) {

            results.push({ chain: c.number, ok: false, text: "Sem resposta" });
        }
    }

    return results;
}


async function openBridge() {
    walletBridge.configure({ wallet: cfg.wallet });
    return walletBridge.start();
}


// Separador Bundles (engine/gui-bundles.js).
const bundleTab = require("./gui-bundles").create({
    engine, keystore, trezor, withLedger, cfg,
    walletName, isBrowserWallet, fmtUnits, fmtNumber, shortAddress, useChain, poolView, feeLabel
});


module.exports = {
    WALLETS,
    bundleInfo: (arg) => bundleTab.info(arg || {}),
    bundlePrepare: (arg) => bundleTab.prepare(arg || {}),
    bundleExecute: (emit) => bundleTab.execute(emit),
    bundleUnlock: (arg) => bundleTab.unlock(arg || {}),
    bundleForget: () => bundleTab.forget(),
    bundleCancel: () => bundleTab.cancel(),
    bundlesSetDir: (dir) => require("./bundles").setDir(dir),
    keystore,
    configure,
    openBridge,
    bridgeState: () => walletBridge.state(),
    onBridgeChange: (fn) => walletBridge.setListener(fn),
    onTrezorUi: (fn) => trezor.setUiHandler(fn),
    trezorRespond: (answer) => trezor.respond(answer),
    dispose: () => trezor.dispose(),
    chainsInfo,
    tokenInfo,
    balance,
    analyze,
    prepare,
    execute,
    wallets,
    cancel,
    ledgerStatus,
    testConnections
};
