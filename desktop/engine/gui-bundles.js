// ============================================================
// TopCatSwap — separador "Bundles" (lado do motor)
//
// Tipos:
//   swaps   — um ou mais swaps, de uma ou várias carteiras, num único
//             bundle (approvals incluídos). Serve para:
//               · swap atómico (approve + Permit2 + swap no mesmo bloco)
//               · vários swaps da mesma carteira
//               · o mesmo swap feito por várias carteiras
//   revoke  — retirar autorizações (ERC20 → Permit2 e Permit2 → Universal
//             Router) de vários tokens de uma vez.
//
// Fluxo: prepare (análise + simulação sem assinar) → execute (nova
// simulação, assinatura, simulação final, envio aos builders, espera).
// ============================================================

const { ethers } = require("ethers");

const bundles = require("./bundles");


function create(d) {

    const { engine, keystore, trezor, withLedger, cfg, walletName, isBrowserWallet, fmtUnits, fmtNumber, shortAddress, useChain, poolView, feeLabel } = d;

    const state = {
        prepared: null,
        busy: false,
        seq: 0,
        extra: new Map()      // endereço → ethers.Wallet (carteiras importadas abertas só para o bundle)
    };

    function cancelledError() {
        const e = new Error("Preparação cancelada.");
        e.cancelled = true;
        return e;
    }


    // ---------------------------------------------------------
    // Informação para o separador
    // ---------------------------------------------------------

    function info({ chain }) {

        const c = engine.CHAINS[String(chain)] || {};
        const chainId = c.chainId ? String(c.chainId) : null;
        const ok = !!chainId && bundles.supported(chainId);

        let reason = null;
        if (!ok) reason = c.name ? "A " + c.name + " não tem builders de bundles (sem mempool público ou ainda não suportada)." : "Rede não suportada.";
        if (isBrowserWallet()) reason = "As carteiras do navegador não permitem assinar sem enviar. Usa Ledger, Trezor ou uma carteira importada para bundles.";

        return {
            available: ok && !isBrowserWallet(),
            reason,
            chainName: c.name || "",
            builders: ok ? bundles.builders(chainId) : [],
            defaultBlocks: ok ? bundles.DEFAULT_BLOCKS[chainId] : 0,
            maxBlocks: ok ? bundles.MAX_BLOCKS[chainId] : 0,
            blockSeconds: ok ? bundles.BLOCK_SECONDS[chainId] : 0,
            wallet: { key: cfg.wallet, name: walletName() },
            extraUnlocked: [...state.extra.keys()]
        };
    }


    // ---------------------------------------------------------
    // Assinantes por conta
    // ---------------------------------------------------------

    function localSigner(address) {

        const addr = ethers.getAddress(address);
        const active = keystore.unlockedAddress();
        const wallet = active && active === addr ? keystore.unlockedWallet() : state.extra.get(addr);

        if (!wallet) {
            const e = new Error("A carteira importada " + shortAddress(addr) + " está bloqueada. Escreve a password dela no separador Bundles.");
            e.locked = addr;
            throw e;
        }

        return {
            kind: "local",
            name: "carteira importada",
            async signTransaction(tx) { return wallet.signingKey.sign(tx.unsignedHash); }
        };
    }

    async function unlock({ address, password }) {
        const wallet = await keystore.decrypt(address, password);
        state.extra.set(wallet.address, wallet);
        return { address: wallet.address };
    }

    function forget() {
        state.extra.clear();
        return true;
    }


    // ---------------------------------------------------------
    // Construção dos pedidos (sem assinar)
    // ---------------------------------------------------------

    async function analyzeLeg(leg, versions, feeParams) {

        const ctx = await engine.buildContext(leg.tokenIn, leg.tokenOut, String(leg.amount), { exactV4: true, versions });
        ctx.gasPrice = feeParams.effectiveGasPrice;

        const result = await engine.analyzePools(ctx);

        const quoted = result.selected.filter(p => p.quoteOK);

        if (quoted.length === 0) {
            throw new Error("Sem cotação para " + leg.amount + " " + ctx.symbolIn + " → " + ctx.symbolOut + " nas pools " + [...versions].join("/") + ".");
        }

        quoted.sort((a, b) => (b.amountOutRaw > a.amountOutRaw ? 1 : b.amountOutRaw < a.amountOutRaw ? -1 : 0));

        return { ctx, pool: quoted[0] };
    }


    // Monta a lista ordenada de pedidos: approvals antes do primeiro swap
    // que usa cada (carteira, token), com o total desse token.
    async function buildSwapRequests(legs, slippageBps, deadlineSeconds) {

        const st = engine.getState();
        const requests = [];
        const groups = new Map();

        for (const leg of legs) {
            if (engine.isNative(leg.ctx.tokenIn)) continue;
            const k = engine.lc(leg.address) + ":" + leg.ctx.tokenIn;
            const g = groups.get(k) || { total: 0n, done: false };
            g.total += leg.ctx.amountInRaw;
            groups.set(k, g);
        }

        for (const leg of legs) {

            const ctx = leg.ctx;
            const from = leg.address;

            if (!engine.isNative(ctx.tokenIn)) {

                const k = engine.lc(from) + ":" + ctx.tokenIn;
                const g = groups.get(k);

                if (!g.done) {

                    g.done = true;

                    const token = new ethers.Contract(ctx.tokenIn, ["function allowance(address,address) view returns (uint256)"], st.provider);
                    const permit2 = new ethers.Contract(st.PERMIT2, ["function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)"], st.provider);

                    const [erc20Allowance, p2] = await Promise.all([
                        token.allowance(from, st.PERMIT2),
                        permit2.allowance(from, ctx.tokenIn, st.UNIVERSAL_ROUTER)
                    ]);

                    if (erc20Allowance < g.total) {

                        if (ctx.tokenIn === engine.USDT && erc20Allowance > 0n) {
                            requests.push({ leg, kind: "approve0", label: "USDT: approve a 0", from, to: ctx.tokenIn, value: 0n,
                                data: engine.erc20Interface.encodeFunctionData("approve", [st.PERMIT2, 0n]) });
                        }

                        requests.push({ leg, kind: "approve", label: "Aprovar " + ctx.symbolIn + " no Permit2", from, to: ctx.tokenIn, value: 0n,
                            data: engine.erc20Interface.encodeFunctionData("approve", [st.PERMIT2, ethers.MaxUint256]) });
                    }

                    const minExp = BigInt(Math.floor(Date.now() / 1000) + 300);

                    if (p2.amount < g.total || BigInt(p2.expiration) < minExp) {

                        const expiration = BigInt(Math.floor(Date.now() / 1000) + engine.PERMIT2_EXPIRATION_SECONDS);

                        requests.push({ leg, kind: "permit2", label: "Permit2 → Universal Router (" + ctx.symbolIn + ")", from, to: st.PERMIT2, value: 0n,
                            data: engine.permit2Interface.encodeFunctionData("approve", [ctx.tokenIn, st.UNIVERSAL_ROUTER, g.total, expiration]) });
                    }
                }
            }

            const amountOutMin = (leg.pool.amountOutRaw * (10000n - slippageBps)) / 10000n;

            if (amountOutMin <= 0n) throw new Error("O mínimo a receber é zero para " + ctx.amountIn + " " + ctx.symbolIn + ": montante demasiado pequeno.");

            leg.amountOutMin = amountOutMin;

            const swap = engine.buildSwapRequest(leg.pool, ctx, amountOutMin, from, deadlineSeconds);

            requests.push({ leg, kind: "swap", label: "Swap " + ctx.amountIn + " " + ctx.symbolIn + " → " + ctx.symbolOut, from,
                to: swap.to, data: swap.data, value: swap.value ?? 0n, poolGas: leg.pool.gasEstimate });
        }

        return requests;
    }


    async function buildRevokeRequests(address, tokens, which) {

        const st = engine.getState();
        const rows = [];
        const requests = [];
        const lockdown = [];

        for (const t of tokens) {

            const addr = engine.resolveTokenArg(t);

            if (!ethers.isAddress(addr) || engine.isNative(engine.lc(addr))) continue;

            let info;
            try { info = await engine.getTokenInfo(addr); } catch (_) { throw new Error("Não consegui ler o token " + t + "."); }

            const token = new ethers.Contract(addr, ["function allowance(address,address) view returns (uint256)"], st.provider);
            const permit2 = new ethers.Contract(st.PERMIT2, ["function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)"], st.provider);

            const [erc20Allowance, p2] = await Promise.all([
                token.allowance(address, st.PERMIT2),
                permit2.allowance(address, addr, st.UNIVERSAL_ROUTER)
            ]);

            const unlimited = erc20Allowance > (ethers.MaxUint256 / 2n);

            rows.push({
                token: engine.lc(addr),
                symbol: info.symbol,
                erc20: erc20Allowance === 0n ? "0" : unlimited ? "ilimitado" : fmtUnits(erc20Allowance, info.decimals),
                permit2: p2.amount === 0n ? "0" : fmtUnits(p2.amount, info.decimals),
                revokeErc20: which.erc20 && erc20Allowance > 0n,
                revokePermit2: which.permit2 && p2.amount > 0n
            });

            if (which.erc20 && erc20Allowance > 0n) {
                requests.push({ kind: "revoke", label: "Revogar " + info.symbol + " → Permit2", from: address, to: addr, value: 0n,
                    data: engine.erc20Interface.encodeFunctionData("approve", [st.PERMIT2, 0n]) });
            }

            if (which.permit2 && p2.amount > 0n) {
                lockdown.push({ token: addr, spender: st.UNIVERSAL_ROUTER });
            }
        }

        if (lockdown.length) {
            requests.unshift({ kind: "lockdown", label: "Permit2: retirar " + lockdown.length + " autorizações ao Universal Router", from: address, to: st.PERMIT2, value: 0n,
                data: bundles.permit2Lockdown.encodeFunctionData("lockdown", [lockdown.map(x => [x.token, x.spender])]) });
        }

        return { rows, requests };
    }


    // Gas: simulação sem assinaturas; sem suporte, valores prudentes.
    async function applyGas(requests, info) {

        const st = engine.getState();
        const sim = await bundles.simulateCalls(st.provider, requests, info);

        if (sim) {

            const bad = sim.findIndex(r => !r.ok);

            if (bad >= 0) {
                const r = requests[bad];
                const v4 = r.kind === "swap" && r.leg && r.leg.pool && r.leg.pool.version === "V4";
                throw new Error("A simulação do bundle falhou no passo " + (bad + 1) + " (" + r.label + (v4 ? ", pool V4" : "") + "): " + (sim[bad].error || "revert") + ". Nada foi assinado nem enviado." +
                    (v4 ? " Experimenta desligar a V4 em Tipos de pool." : ""));
            }

            requests.forEach((r, i) => { r.gasLimit = (sim[i].gasUsed * 125n) / 100n + 20000n; });

            return true;
        }

        for (const r of requests) {
            r.gasLimit = r.kind === "swap"
                ? (BigInt(r.poolGas || 250000) * 150n) / 100n + 150000n
                : r.kind === "lockdown" ? 120000n : 80000n;
        }

        return false;
    }


    // ---------------------------------------------------------
    // Preparar (sem assinar nada)
    // ---------------------------------------------------------

    async function prepare(p) {

        const seq = ++state.seq;

        if (isBrowserWallet()) throw new Error("As carteiras do navegador não suportam bundles.");

        const chain = await useChain(p.chain);
        const st = engine.getState();
        const chainId = String(st.CHAIN_ID);

        if (!bundles.supported(chainId)) throw new Error("A " + chain.name + " não tem builders de bundles.");

        const blocks = Math.min(bundles.MAX_BLOCKS[chainId], Math.max(1, Math.round(Number(p.blocks) || bundles.DEFAULT_BLOCKS[chainId])));
        const fee = [1, 2, 3].includes(Number(p.fee)) ? Number(p.fee) : 2;
        const feeParams = await engine.getFeeParams(fee);
        const builderKeys = Array.isArray(p.builders) && p.builders.length ? p.builders : bundles.builders(chainId).map(b => b.key);

        const warnings = [];
        let blocking = null;
        let requests;
        let legs = [];
        let revokeRows = null;
        let poolVersions = null;

        const windowSeconds = blocks * bundles.BLOCK_SECONDS[chainId];
        const deadlineSeconds = Math.max((Number(p.deadlineMinutes) || 3) * 60, windowSeconds + 120);

        if (p.kind === "revoke") {

            const address = p.address;
            if (!ethers.isAddress(address)) throw new Error("Escolhe a carteira.");

            const which = { erc20: p.revokeErc20 !== false, permit2: p.revokePermit2 !== false };
            const built = await buildRevokeRequests(address, p.tokens || [], which);

            revokeRows = built.rows;
            requests = built.requests;

            if (requests.length === 0) {
                blocking = "Não há autorizações para retirar nestes tokens.";
            }

        } else {

            const slippage = Number(String(p.slippage).replace(",", "."));

            if (!Number.isFinite(slippage) || slippage < engine.MIN_SLIPPAGE_PERCENT || slippage > engine.MAX_SLIPPAGE_PERCENT) {
                throw new Error("Slippage inválido: usa um valor entre 0.01 e 50%.");
            }

            if (!Array.isArray(p.legs) || p.legs.length === 0) throw new Error("Adiciona pelo menos um swap.");
            if (p.legs.length > 12) throw new Error("No máximo 12 swaps por bundle.");

            const versions = new Set((Array.isArray(p.versions) ? p.versions : ["V2", "V3", "V4"]).map(v => String(v).toUpperCase()).filter(v => ["V2", "V3", "V4"].includes(v)));
            if (versions.size === 0) throw new Error("Escolhe pelo menos um tipo de pool (V2, V3 ou V4).");
            poolVersions = [...versions];

            for (const raw of p.legs) {

                if (!ethers.isAddress(raw.address)) throw new Error("Carteira inválida num dos swaps.");
                if (!(Number(String(raw.amount).replace(",", ".")) > 0)) throw new Error("Indica o montante de cada swap.");

                const { ctx, pool } = await analyzeLeg({ tokenIn: raw.tokenIn, tokenOut: raw.tokenOut, amount: String(raw.amount).replace(",", ".") }, versions, feeParams);

                if (seq !== state.seq) throw cancelledError();

                legs.push({ address: ethers.getAddress(raw.address), path: raw.path || null, label: raw.label || null, ctx, pool });
            }

            requests = await buildSwapRequests(legs, BigInt(Math.round(slippage * 100)), deadlineSeconds);

            if (slippage > engine.HIGH_SLIPPAGE_PERCENT) warnings.push("Slippage acima de " + engine.HIGH_SLIPPAGE_PERCENT + "%: a perda máxima é elevada.");
            if (legs.some(l => l.pool.version === "V2")) warnings.push("Há swaps em pools V2: se o token cobrar taxa na venda, o slippage tem de ser superior à taxa.");
        }

        if (seq !== state.seq) throw cancelledError();

        let simulated = false;
        const simInfo = {};

        if (requests.length) {
            try {
                simulated = await applyGas(requests, simInfo);
            } catch (error) {
                blocking = error.message;
                for (const r of requests) if (!r.gasLimit) r.gasLimit = 200000n;
            }
        }

        if (!simulated && !blocking && requests.length) {
            warnings.push("O RPC não permite simular a sequência antes de assinar" + (simInfo.reason ? " (" + simInfo.reason + ")" : "") + "; o gas foi estimado por excesso. O builder simula o bundle e não o inclui se falhar (não pagas gas).");
        }

        // Saldos: cada carteira tem de ter o token e gas suficientes.
        const byWallet = new Map();
        for (const r of requests) {
            const w = byWallet.get(r.from) || { gas: 0n, value: 0n, n: 0 };
            w.gas += r.gasLimit * feeParams.maxFeePerGas;
            w.value += BigInt(r.value || 0n);
            w.n += 1;
            byWallet.set(r.from, w);
        }

        const walletRows = [];

        for (const [addr, w] of byWallet) {

            const native = await st.provider.getBalance(addr);

            walletRows.push({ address: addr, short: shortAddress(addr), txs: w.n, native: fmtNumber(Number(ethers.formatEther(native))), need: fmtNumber(Number(ethers.formatEther(w.gas + w.value))) });

            if (native < w.gas + w.value && !blocking) {
                blocking = "A carteira " + shortAddress(addr) + " não tem " + st.NATIVE_SYMBOL + " suficiente: tem " + fmtNumber(Number(ethers.formatEther(native))) +
                    " e precisa até " + fmtNumber(Number(ethers.formatEther(w.gas + w.value))) + " (valor + gas máximo).";
            }
        }

        for (const leg of legs) {
            if (!engine.isNative(leg.ctx.tokenIn) && !blocking) {
                const bal = await engine.getBalance(leg.ctx.tokenIn, leg.address);
                const totalSame = legs.filter(l => l.address === leg.address && l.ctx.tokenIn === leg.ctx.tokenIn).reduce((a, l) => a + l.ctx.amountInRaw, 0n);
                if (bal < totalSame) {
                    blocking = "Saldo insuficiente de " + leg.ctx.symbolIn + " em " + shortAddress(leg.address) + ": tem " + fmtUnits(bal, leg.ctx.decimalsIn) + ".";
                }
            }
        }

        const totalGas = requests.reduce((a, r) => a + r.gasLimit, 0n);

        state.prepared = { kind: p.kind, chain: p.chain, chainId, legs, revokeTokens: p.tokens || [], revokeWhich: p.kind === "revoke" ? { erc20: p.revokeErc20 !== false, permit2: p.revokePermit2 !== false } : null,
            revokeAddress: p.address, slippageBps: p.kind === "revoke" ? 0n : BigInt(Math.round(Number(String(p.slippage).replace(",", ".")) * 100)),
            fee, blocks, builderKeys, allowRevert: !!p.allowRevert, deadlineMinutes: Number(p.deadlineMinutes) || 3, paths: Object.fromEntries((p.legs || []).filter(l => l.path).map(l => [ethers.getAddress(l.address), l.path])) };

        if (p.kind === "revoke" && p.path) state.prepared.paths[ethers.getAddress(p.address)] = p.path;

        return {
            kind: p.kind,
            chainName: chain.name,
            nativeSymbol: st.NATIVE_SYMBOL,
            legs: legs.map((l, i) => ({
                n: i + 1,
                wallet: shortAddress(l.address),
                walletLabel: l.label,
                pair: l.ctx.amountIn + " " + l.ctx.symbolIn + " → " + l.ctx.symbolOut,
                pool: l.pool.version + " · " + feeLabel(l.pool.fee),
                expected: fmtUnits(l.pool.amountOutRaw, l.ctx.decimalsOut) + " " + l.ctx.symbolOut,
                minOut: fmtUnits(l.amountOutMin, l.ctx.decimalsOut) + " " + l.ctx.symbolOut
            })),
            revokeRows,
            txs: requests.map((r, i) => ({ n: i + 1, wallet: shortAddress(r.from), label: r.label, gas: r.gasLimit.toString() })),
            wallets: walletRows,
            simulated,
            gasTotal: totalGas.toString(),
            costEstimate: fmtNumber(Number(ethers.formatEther(totalGas * feeParams.effectiveGasPrice))) + " " + st.NATIVE_SYMBOL,
            tip: Number(ethers.formatUnits(feeParams.priorityFee, "gwei")).toFixed(3) + " gwei",
            blocks,
            windowSeconds,
            builders: bundles.builders(chainId).filter(b => builderKeys.includes(b.key)).map(b => b.name),
            allowRevert: !!p.allowRevert,
            versions: poolVersions,
            warnings,
            blocking
        };
    }


    // ---------------------------------------------------------
    // Executar: rever, assinar, simular, enviar, esperar
    // ---------------------------------------------------------

    async function execute(emit) {

        const P = state.prepared;

        if (!P) throw new Error("Prepara primeiro o bundle.");
        if (state.busy) throw new Error("Já há um bundle em curso.");

        state.busy = true;

        const step = (id, s, sub) => emit({ id, state: s, sub: sub || null });

        try {

            await useChain(P.chain);

            const st = engine.getState();
            const chainId = P.chainId;

            // 1. Pedidos de novo (prazo novo) e nova simulação.
            step("build", "active", "A montar o bundle…");

            let requests;
            const windowSeconds = P.blocks * bundles.BLOCK_SECONDS[chainId];
            const deadlineSeconds = Math.max(P.deadlineMinutes * 60, windowSeconds + 120);

            if (P.kind === "revoke") {
                requests = (await buildRevokeRequests(P.revokeAddress, P.revokeTokens, P.revokeWhich)).requests;
            } else {
                for (const leg of P.legs) {
                    const prev = leg.pool.amountOutRaw;
                    leg.pool.quoteOK = false;
                    await engine.quotePool(leg.pool, leg.ctx);
                    if (!leg.pool.quoteOK) throw new Error("A nova cotação de " + leg.ctx.symbolIn + " → " + leg.ctx.symbolOut + " falhou. Nada foi assinado.");
                    const min = (prev * (10000n - P.slippageBps)) / 10000n;
                    if (leg.pool.amountOutRaw < min) {
                        throw new Error("O preço de " + leg.ctx.symbolIn + " → " + leg.ctx.symbolOut + " piorou abaixo do mínimo. Nada foi assinado.");
                    }
                    leg.pool.amountOutRaw = prev;   // o mínimo garantido continua o do resumo
                }
                requests = await buildSwapRequests(P.legs, P.slippageBps, deadlineSeconds);
            }

            if (requests.length === 0) throw new Error("Não há nada para enviar.");

            step("build", "done", requests.length + " transações");

            step("simulate", "active", "A simular a sequência…");
            const simulated = await applyGas(requests);
            step("simulate", "done", simulated ? "Todas as transações passam" : "Simulação feita pelo builder");

            // 2. Assinar (nonces sequenciais por carteira).
            const fees = await engine.getFeeParams(P.fee);
            const nonces = new Map();

            for (const addr of new Set(requests.map(r => r.from))) {
                nonces.set(addr, await st.provider.getTransactionCount(addr, "pending"));
            }

            // Carteiras importadas: confirma que todas estão abertas antes de assinar a primeira.
            if (cfg.wallet === "local") {
                for (const addr of new Set(requests.map(r => r.from))) localSigner(addr);
            }

            const signed = [];

            const signAll = async (signerFor) => {
                for (let i = 0; i < requests.length; i++) {
                    const r = requests[i];
                    const nonce = nonces.get(r.from);
                    nonces.set(r.from, nonce + 1);
                    const { signer, account } = await signerFor(r.from);
                    const tx = await engine.signPrepared(signer, account, r, nonce, fees, r.label, {
                        onAwaitLedger: () => step("sign", "active",
                            (cfg.wallet === "local" ? "A assinar " : "Confirma no dispositivo: ") + (i + 1) + " de " + requests.length + " · " + r.label)
                    });
                    signed.push(tx);
                }
            };

            step("sign", "active", "A assinar 1 de " + requests.length + "…");

            if (cfg.wallet === "ledger") {

                await withLedger(async (ledger) => {
                    await signAll(async (addr) => {
                        let p = P.paths[addr];
                        if (!p) {
                            const acc = await engine.resolveLedgerAccount(ledger, { from: addr });
                            p = acc.path;
                            P.paths[addr] = p;
                        }
                        return { signer: ledger, account: { address: addr, path: String(p).replace(/^m\//, "") } };
                    });
                });

            } else if (cfg.wallet === "trezor") {

                const t = trezor.signer();
                await signAll(async (addr) => {
                    let p = P.paths[addr];
                    if (!p) {
                        const found = (await trezor.getAccounts(0, 10)).find(a => a.address === addr);
                        if (!found) throw new Error("A conta " + shortAddress(addr) + " não está nas 10 primeiras da Trezor.");
                        p = found.path;
                        P.paths[addr] = p;
                    }
                    return { signer: t, account: { address: addr, path: String(p).replace(/^m\//, "") } };
                });

            } else if (cfg.wallet === "local") {

                await signAll(async (addr) => ({ signer: localSigner(addr), account: { address: addr, path: null } }));

            } else {

                throw new Error("Esta carteira não suporta bundles.");
            }

            step("sign", "done", signed.length + " assinadas");

            const raw = signed.map(t => t.serialized);
            const hashes = signed.map(t => t.hash);
            const revertingTxHashes = P.allowRevert ? signed.filter((t, i) => requests[i].kind === "swap").map(t => t.hash) : [];

            // 3. Simulação final (Ethereum, Flashbots) e envio.
            const fromBlock = await st.provider.getBlockNumber();

            if (bundles.BUILDERS[chainId].some(b => b.simulate && P.builderKeys.includes(b.key))) {

                step("check", "active", "Simulação final no builder…");

                try {
                    const r = await bundles.callBundle(chainId, raw, fromBlock + 1);
                    if (r && !r.ok && !P.allowRevert) throw Object.assign(new Error("A simulação final falhou: " + r.error + ". Nada foi enviado."), { fatal: true });
                    step("check", "done", "OK");
                } catch (error) {
                    if (error.fatal) throw error;
                    step("check", "done", "Sem resposta da simulação (" + String(error.message).slice(0, 60) + ")");
                }

            } else {

                step("check", "done", "Simulação feita por cada builder ao receber");
            }

            step("send", "active", "A enviar a " + P.builderKeys.length + " builders…");

            const sendResults = await bundles.send(chainId, raw, { fromBlock, blocks: P.blocks, builderKeys: P.builderKeys, revertingTxHashes });

            if (!sendResults.some(r => r.ok)) {
                throw new Error("Nenhum builder aceitou o bundle: " + sendResults.map(r => r.builder + " (" + (r.error || "erro") + ")").join("; ") + ". Nada foi executado e não pagaste gas.");
            }

            step("send", "done", sendResults.filter(r => r.ok).map(r => r.builder).join(", "));

            // 4. Esperar pela inclusão.
            const lastBlock = fromBlock + P.blocks;

            step("include", "active", "À espera de um bloco (até ao bloco " + lastBlock + ")…");

            const res = await bundles.waitInclusion(st.provider, hashes, lastBlock, (cur, last, n) => {
                step("include", "active", "Bloco " + cur + " de " + last + (n ? " · " + n + "/" + hashes.length + " incluídas" : ""));
            });

            const explorer = st.CHAIN.explorer;

            if (!res.included) {

                step("include", "error", res.partial ? "Incluído em parte" : "Não incluído");

                return {
                    included: false,
                    partial: !!res.partial,
                    chainName: st.CHAIN.name,
                    blocks: P.blocks,
                    builders: sendResults,
                    message: res.partial
                        ? "Só parte das transações apareceu na rede. Confirma o estado de cada uma no explorador."
                        : "Nenhum builder incluiu o bundle nos " + P.blocks + " blocos. Nada foi executado e não pagaste gas. Tenta de novo com prioridade maior ou mais blocos.",
                    txs: hashes.map((h, i) => ({ label: requests[i].label, hash: h, url: explorer + "/tx/" + h }))
                };
            }

            const block = res.receipts[res.receipts.length - 1].blockNumber;
            const gasCost = res.receipts.reduce((a, r) => a + r.gasUsed * (r.gasPrice ?? r.effectiveGasPrice ?? 0n), 0n);
            const reverted = res.receipts.filter(r => r.status !== 1).length;

            step("include", "done", "Bloco " + block);

            state.prepared = null;
            state.extra.clear();

            return {
                included: true,
                chainName: st.CHAIN.name,
                block: String(block),
                blockUrl: explorer + "/block/" + block,
                gasCost: fmtNumber(Number(ethers.formatEther(gasCost))) + " " + st.NATIVE_SYMBOL,
                reverted,
                builders: sendResults,
                txs: hashes.map((h, i) => ({ label: requests[i].label, hash: h, url: explorer + "/tx/" + h, ok: res.receipts[i].status === 1 }))
            };

        } finally {

            state.busy = false;
        }
    }


    function cancel() {
        state.seq++;
        return true;
    }


    return { info, prepare, execute, unlock, forget, cancel };
}


module.exports = { create };
