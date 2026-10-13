const http = require("http"), os = require("os"), path = require("path"), fs = require("fs");
const { ethers } = require("ethers");
const real = require("../desktop/engine/topcatswap.js");
const bundles = require("../desktop/engine/bundles.js");
const keystore = require("../desktop/engine/keystore.js");
(async () => {
  real.applyChain(real.findChain("1"));
  const st0 = real.getState();
  // mock builder server
  const seen = [];
  const srv = http.createServer((q, r) => { let b = ""; q.on("data", c => b += c); q.on("end", () => { const j = JSON.parse(b); seen.push(j);
    r.setHeader("content-type", "application/json");
    if (j.method === "eth_callBundle") return r.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { results: j.params[0].txs.map(() => ({ gasUsed: 50000 })) } }));
    r.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { bundleHash: "0x1" } })); }); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  bundles.BUILDERS["1"] = [{ key: "flashbots", name: "Flashbots", url: base, sign: true, simulate: true }, { key: "titan", name: "Titan", url: base }];
  bundles.setDir(fs.mkdtempSync(path.join(os.tmpdir(), "f-")));
  // keystore with two imported wallets
  keystore.setDir(fs.mkdtempSync(path.join(os.tmpdir(), "k-")));
  const k1 = ethers.Wallet.createRandom().privateKey, k2 = ethers.Wallet.createRandom().privateKey;
  const w2 = await keystore.importKey({ privateKey: k2, password: "password-2", label: "B" });
  const w1 = await keystore.importKey({ privateKey: k1, password: "password-1", label: "A" }); // active
  // fake chain state
  let block = 1000, mined = new Set(), sentRaw = [];
  const provider = {
    getTransactionCount: async (a) => 5,
    getBlockNumber: async () => block,
    getBalance: async () => ethers.parseEther("1"),
    getTransactionReceipt: async (h) => mined.has(h) ? { status: 1, blockNumber: 1002, gasUsed: 100000n, gasPrice: 10n ** 9n } : null,
    send: async (m, p) => { if (m === "eth_simulateV1") return [{ calls: p[0].blockStateCalls[0].calls.map(() => ({ status: "0x1", gasUsed: "0x186a0" })) }]; throw new Error("x"); }
  };
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const engine = Object.assign({}, real, {
    getState: () => Object.assign({}, st0, { provider }),
    buildContext: async (a, b, amt) => ({ tokenIn: real.lc(real.resolveTokenArg(a)), tokenOut: real.lc(real.resolveTokenArg(b)), amountIn: amt, amountInRaw: ethers.parseUnits(amt, 18), symbolIn: a, symbolOut: b, decimalsIn: 18, decimalsOut: 6 }),
    analyzePools: async (ctx) => ({ selected: [{ quoteOK: true, amountOutRaw: 27000000n, version: "V3", fee: 500, gasEstimate: 120000 }] }),
    quotePool: async (pool) => { pool.quoteOK = true; pool.amountOutRaw = 27100000n; },
    getFeeParams: async () => ({ priorityFee: 2n * 10n ** 9n, maxFeePerGas: 30n * 10n ** 9n, effectiveGasPrice: 12n * 10n ** 9n, baseFee: 10n ** 10n, name: "FAST" }),
    buildSwapRequest: (pool, ctx, min, from, dl) => ({ from, to: st0.UNIVERSAL_ROUTER, data: "0x3593564c", value: real.isNative(ctx.tokenIn) ? ctx.amountInRaw : 0n }),
    getBalance: async () => ethers.parseEther("1000"),
    getTokenInfo: async () => ({ symbol: "USDC", decimals: 6 })
  });
  // ERC20/Permit2 allowance reads via ethers.Contract need a provider with call(): patch ethers.Contract calls by giving provider.call
  provider.call = async (tx) => ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint48","uint48"], [0n, 0n, 0n]);
  const cfg = { wallet: "local", localAddress: w1.address };
  const fmt = (n) => String(n);
  const tab = require("../desktop/engine/gui-bundles.js").create({
    engine, keystore, trezor: null, withLedger: null, cfg,
    walletName: () => "A", isBrowserWallet: () => false,
    fmtUnits: (raw, d) => ethers.formatUnits(raw, d), fmtNumber: fmt, shortAddress: (a) => a.slice(0, 6), useChain: async () => st0.CHAIN,
    poolView: () => ({}), feeLabel: () => "0.05%"
  });
  // multi-wallet: second wallet locked -> expect error at execute, then unlock
  const prep = await tab.prepare({ chain: 1, kind: "swaps", slippage: "0.5", fee: 2, blocks: 3, builders: ["flashbots", "titan"], legs: [
    { address: w1.address, tokenIn: "USDC", tokenOut: "ETH", amount: "25" },
    { address: w2.address, tokenIn: "USDC", tokenOut: "ETH", amount: "25" },
    { address: w1.address, tokenIn: "ETH", tokenOut: "USDC", amount: "0.01" } ] });
  console.log("prepare:", prep.txs.map(t => t.n + " " + t.wallet + " " + t.label + " gas " + t.gas).join(" | "));
  console.log("blocking:", prep.blocking, "simulated:", prep.simulated, "warnings:", prep.warnings.length);
  const steps = [];
  try { await tab.execute(s => steps.push(s.id + ":" + s.state)); } catch (e) { console.log("locked error ok:", e.message.slice(0, 60)); }
  await tab.unlock({ address: w2.address, password: "password-2" });
  setTimeout(() => { for (const j of seen) {} }, 0);
  // mine after send: mark hashes mined when titan receives
  const origSend = bundles.send;
  const p = tab.execute(s => steps.push(s.id + ":" + s.state + (s.sub ? "(" + s.sub.slice(0, 40) + ")" : "")));
  // wait for send then mine
  const watcher = setInterval(() => { const sb = seen.filter(j => j.method === "eth_sendBundle"); if (sb.length) { const txs = sb[0].params[0].txs; txs.forEach(raw => mined.add(ethers.Transaction.from(raw).hash)); sentRaw = txs; block = 1003; clearInterval(watcher); } }, 50);
  const res = await p;
  console.log("steps:", steps.slice(-8).join(" "));
  console.log("included:", res.included, "block", res.block, "txs", res.txs.length);
  const parsed = sentRaw.map(r => ethers.Transaction.from(r));
  console.log("order/nonces:", parsed.map(t => t.from.slice(0, 6) + "#" + t.nonce + ":" + (t.to || "").slice(0, 6)).join(" "));
  console.log("bundle targets:", seen.filter(j => j.method === "eth_sendBundle").map(j => parseInt(j.params[0].blockNumber, 16)).sort().join(","), "callBundle:", seen.some(j => j.method === "eth_callBundle"));
  // revoke flow
  provider.call = async (tx) => ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint48","uint48"], [ethers.MaxUint256 >> 100n, 9999999999n, 0n]);
  const rv = await tab.prepare({ chain: 1, kind: "revoke", address: w1.address, tokens: ["USDC"], fee: 1, blocks: 2 });
  console.log("revoke:", rv.txs.map(t => t.label).join(" | "), rv.revokeRows.map(r => r.symbol + " " + r.erc20 + "/" + r.permit2).join());
  // 1.1.2: RPC that cannot simulate ("could not coalesce error") -> fallback, not blocking
  provider.call = async (tx) => ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint48","uint48"], [0n, 0n, 0n]);
  provider.send = async () => { const e = new Error("could not coalesce error"); e.shortMessage = "could not coalesce error"; e.code = "UNKNOWN_ERROR"; e.error = { code: -32000, message: "method not whitelisted" }; throw e; };
  const pf = await tab.prepare({ chain: 1, kind: "swaps", slippage: "0.5", fee: 2, blocks: 3, versions: ["V2", "V3"], legs: [{ address: w1.address, tokenIn: "USDC", tokenOut: "ETH", amount: "25" }] });
  console.log("fallback: blocking", pf.blocking, "simulated", pf.simulated, "versions", pf.versions, "warn:", pf.warnings.find(w => /RPC/.test(w)));
  // V4 swap reverting in simulation -> hint
  engine.analyzePools = async () => ({ selected: [{ quoteOK: true, amountOutRaw: 27000000n, version: "V4", fee: 500, gasEstimate: 120000 }] });
  provider.send = async (m, p) => [{ calls: p[0].blockStateCalls[0].calls.map((c, i, a) => ({ status: i === a.length - 1 ? "0x0" : "0x1", gasUsed: "0x186a0", error: i === a.length - 1 ? { message: "execution reverted" } : undefined })) }];
  const pv = await tab.prepare({ chain: 1, kind: "swaps", slippage: "0.5", fee: 2, blocks: 3, legs: [{ address: w1.address, tokenIn: "USDC", tokenOut: "ETH", amount: "25" }] });
  console.log("v4 fail:", pv.blocking);
  let ve; try { await tab.prepare({ chain: 1, kind: "swaps", slippage: "0.5", versions: [], legs: [{ address: w1.address, tokenIn: "USDC", tokenOut: "ETH", amount: "25" }] }); } catch (e) { ve = e.message; }
  console.log("no versions:", ve);
  srv.close(); process.exit(0);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
