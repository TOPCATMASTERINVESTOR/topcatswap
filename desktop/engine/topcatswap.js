// ============================================================
// topcatswap 1.1.2 — bot da Uniswap V2/V3/V4 (linha de comandos)
//
// Modos POOL, SWAP e WALLET. Assina na Ledger ou com uma carteira
// importada por chave privada (as mesmas da app gráfica, cifradas
// em ~/.config/TopCatSwap/wallets, cada uma com a sua password).
// ============================================================

const TOPCATSWAP_VERSION = "1.1.2";

const { ethers } = require("ethers");


// ============================================================
// CONFIGURAÇÃO
// ============================================================

// O provider e todos os endereços dependem da rede escolhida com
// --chain (por omissão Ethereum). São definidos em applyChain().
let provider = null;


// ============================================================
// THE GRAPH - UNISWAP V4
//
// Se a variável de ambiente GRAPH_API_KEY estiver definida,
// tem prioridade. Sem chave, as pools V4 são procuradas on-chain
// (pools padrão, sem hooks). Chave gratuita em https://thegraph.com/studio/
// ============================================================

const GRAPH_API_KEY =
    process.env.GRAPH_API_KEY ||
    "";

// Subgraph V4 da rede ativa (null = sem subgraph: descoberta on-chain).
let V4_SUBGRAPH_ID = null;

function getGraphUrl() {

    // Lida em cada pedido: a app pode mudar a chave nas definições.
    const key = process.env.GRAPH_API_KEY || GRAPH_API_KEY;

    if (!key) {

        throw new Error(
            "Falta a variável de ambiente GRAPH_API_KEY. " +
            "Corre o bot sem argumentos para ver como a definir."
        );
    }

    if (!V4_SUBGRAPH_ID) {
        throw new Error("sem subgraph V4 para esta rede");
    }

    return `https://gateway.thegraph.com/api/${key}/subgraphs/id/${V4_SUBGRAPH_ID}`;
}


// ============================================================
// UNISWAP V3
// ============================================================

let V3_FACTORY = "0x1f98431c8ad98523631ae4a59f267346ea31f984";

let V3_QUOTER = "0x61ffe014ba17989e743c5f6cb21bf9697530b21e";

const V3_FEE_TIERS = [100, 500, 3000, 10000];


// ============================================================
// UNISWAP V2
// ============================================================

let V2_FACTORY = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";

// Fee fixa da V2: 0.30% (mesma escala das fees V3: 3000 = 0.30%).
const V2_FEE = 3000;

// A V2 não tem quoter: estimativa de gas de um swap V2 via Universal Router.
const V2_GAS_ESTIMATE = 130000n;

const V2_FACTORY_ABI = [
    "function getPair(address tokenA,address tokenB) view returns (address pair)"
];

const V2_PAIR_ABI = [
    "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
    "function token0() view returns (address)"
];


// Versões suportadas (opção --versions=v2,v3,v4).
const ALL_VERSIONS = ["V2", "V3", "V4"];


// ============================================================
// UNISWAP V4
// ============================================================

let V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203";

// StateView: lê o estado atual (slot0) de uma pool V4 on-chain.
let V4_STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";

// Dynamic fee flag = 0x800000 = 8388608
const DYNAMIC_FEE_FLAG = 0x800000;

// Quantas V4 de maior TVL testar para encontrar a melhor execução.
const MAX_V4_QUOTE_CANDIDATES = 10;


// ============================================================
// TOKENS
// ============================================================

// Na V4, ETH nativo é representado pelo endereço zero.
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";

let WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

let USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";


// ============================================================
// ABIs
// ============================================================

const TOKEN_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address owner) view returns (uint256)"
];

const V3_FACTORY_ABI = [
    "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)"
];

const V3_POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function liquidity() view returns (uint128)"
];

const V3_QUOTER_ABI = [
    "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const V4_QUOTER_ABI = [
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"
];

const V4_STATE_VIEW_ABI = [
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)"
];


// ============================================================
// REDES (opção --chain)
//
// Endereços oficiais da Uniswap (páginas de deployments V2, V3
// e V4). Universal Router 2.0 em todas as redes suportadas.
// ============================================================

const CHAINS = {

    1: {
        key: "ethereum",
        aliases: ["1", "eth", "ethereum", "mainnet"],
        name: "Ethereum",
        chainId: 1n,
        rpc: "https://ethereum-rpc.publicnode.com",
        rpcEnv: "RPC_URL",
        explorer: "https://etherscan.io",
        explorerName: "Etherscan",
        nativeSymbol: "ETH",
        wrappedSymbol: "WETH",
        wrapped: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        v2Factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
        v3Factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        v3Quoter: "0x61ffe014ba17989e743c5f6cb21bf9697530b21e",
        v4Quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
        v4StateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
        universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
        v4SubgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
        protect: {
            mevblocker: {
                name: "MEV Blocker",
                url: "https://rpc.mevblocker.io/fast",
                trackUrl: () => "https://explorer.mevblocker.io"
            },
            flashbots: {
                name: "Flashbots Protect",
                url: "https://rpc.flashbots.net/fast",
                trackUrl: hash => "https://protect.flashbots.net/tx/" + hash
            }
        },
        defaultProtect: "mevblocker",
        noProtectReason: null
    },

    2: {
        key: "arbitrum",
        aliases: ["2", "42161", "arb", "arbitrum"],
        name: "Arbitrum One",
        chainId: 42161n,
        rpc: "https://arbitrum-one-rpc.publicnode.com",
        rpcEnv: "RPC_URL_42161",
        explorer: "https://arbiscan.io",
        explorerName: "Arbiscan",
        nativeSymbol: "ETH",
        wrappedSymbol: "WETH",
        wrapped: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        v2Factory: "0xf1d7cc64fb4452f05c498126312ebe29f30fbcf9",
        v3Factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        v3Quoter: "0x61ffe014ba17989e743c5f6cb21bf9697530b21e",
        v4Quoter: "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
        v4StateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
        universalRouter: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
        v4SubgraphId: null,
        protect: {},
        defaultProtect: null,
        noProtectReason:
            "a Arbitrum não tem mempool público: o sequenciador ordena as transações " +
            "por ordem de chegada, por isso os bots não as veem antes de serem incluídas"
    },

    3: {
        key: "bsc",
        aliases: ["3", "56", "bsc", "bnb", "binance"],
        name: "BNB Smart Chain",
        chainId: 56n,
        rpc: "https://bsc-rpc.publicnode.com",
        rpcEnv: "RPC_URL_56",
        explorer: "https://bscscan.com",
        explorerName: "BscScan",
        nativeSymbol: "BNB",
        wrappedSymbol: "WBNB",
        wrapped: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        v2Factory: "0x8909dc15e40173ff4699343b6eb8132c65e18ec6",
        v3Factory: "0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7",
        v3Quoter: "0x78d78e420da98ad378d7799be8f4af69033eb077",
        v4Quoter: "0x9f75dd27d6664c475b90e105573e550ff69437b0",
        v4StateView: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4",
        universalRouter: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07",
        v4SubgraphId: "EAq1nJKgjnuKH6Gj4RFjCW7LcL7E2uipbncdwV7TTWkX",
        protect: {
            merkle: {
                name: "Merkle (BSC)",
                url: "https://bsc.merkle.io",
                trackUrl: hash => "https://bscscan.com/tx/" + hash
            },
            pancakeswap: {
                name: "PancakeSwap Private RPC",
                url: "https://bscrpc.pancakeswap.finance",
                trackUrl: hash => "https://bscscan.com/tx/" + hash
            },
            "48club": {
                name: "48 Club Privacy RPC",
                url: "https://rpc-bsc.48.club",
                trackUrl: hash => "https://bscscan.com/tx/" + hash
            }
        },
        defaultProtect: "merkle",
        noProtectReason: null
    },

    4: {
        key: "pulsechain",
        aliases: ["4", "369", "pulse", "pulsechain"],
        name: "PulseChain",
        unsupported:
            "a PulseChain não tem Uniswap com liquidez real (as memes estão na PulseX, " +
            "outra DEX) e não há RPC privado anti-sandwich conhecido."
    },

    5: {
        key: "robinhood",
        aliases: ["5", "4663", "robinhood"],
        name: "Robinhood Chain",
        unsupported:
            "a Robinhood Chain tem vários Universal Routers publicados e um router modificado " +
            "com outro formato de swap V4; os endereços têm de ser confirmados on-chain antes de usar."
    },

    6: {
        key: "arc",
        aliases: ["6", "5042", "arc"],
        name: "Arc",
        unsupported:
            "a Arc usa USDC como token de gas e ainda não foi validada neste bot; " +
            "os endereços têm de ser confirmados on-chain antes de usar."
    }
};

const DEFAULT_CHAIN = 1;

// Rede ativa (definida em applyChain).
let CHAIN = null;

let NATIVE_SYMBOL = "ETH";

let WRAPPED_SYMBOL = "WETH";


function findChain(value) {

    if (value === undefined || value === true) {
        return CHAINS[DEFAULT_CHAIN];
    }

    const wanted = String(value).toLowerCase();

    for (const config of Object.values(CHAINS)) {
        if (config.aliases.includes(wanted)) {
            return config;
        }
    }

    throw new Error(
        "--chain inválido: " + value +
        " (usa 1 Ethereum, 2 Arbitrum, 3 BSC, 4 PulseChain, 5 Robinhood, 6 Arc)."
    );
}


function applyChain(config) {

    if (config.unsupported) {
        throw new Error(config.name + " ainda não é suportada: " + config.unsupported);
    }

    CHAIN = config;

    const rpcUrl = process.env[config.rpcEnv] || config.rpc;

    provider = new ethers.JsonRpcProvider(rpcUrl, Number(config.chainId), { staticNetwork: true });

    CHAIN_ID = config.chainId;

    WETH = config.wrapped;

    USDC = config.usdc;

    V2_FACTORY = config.v2Factory;

    V3_FACTORY = config.v3Factory;

    V3_QUOTER = config.v3Quoter;

    V4_QUOTER = config.v4Quoter;

    V4_STATE_VIEW = config.v4StateView;

    UNIVERSAL_ROUTER = config.universalRouter;

    V4_SUBGRAPH_ID = config.v4SubgraphId;

    PROTECT_RPCS = config.protect;

    DEFAULT_PROTECT = config.defaultProtect;

    NATIVE_SYMBOL = config.nativeSymbol;

    WRAPPED_SYMBOL = config.wrappedSymbol;

    TOKEN_ALIASES = {
        [config.nativeSymbol]: NATIVE_ETH,
        [config.wrappedSymbol]: config.wrapped,
        USDC: config.usdc
    };

    v3Factory = new ethers.Contract(V3_FACTORY, V3_FACTORY_ABI, provider);

    v3Quoter = new ethers.Contract(V3_QUOTER, V3_QUOTER_ABI, provider);

    v4Quoter = new ethers.Contract(V4_QUOTER, V4_QUOTER_ABI, provider);

    v4StateView = new ethers.Contract(V4_STATE_VIEW, V4_STATE_VIEW_ABI, provider);

    v2Factory = new ethers.Contract(V2_FACTORY, V2_FACTORY_ABI, provider);
}


// Confirma que o RPC corresponde à rede escolhida.
async function checkChainRpc() {

    let chainId;

    try {

        chainId = BigInt(await provider.send("eth_chainId", []));

    } catch (error) {

        throw new Error(
            "O RPC da " + CHAIN.name + " não responde (" + (error.shortMessage || error.message) + "). " +
            "Define outro com a variável " + CHAIN.rpcEnv + "."
        );
    }

    if (chainId !== CHAIN_ID) {
        throw new Error(
            "O RPC configurado é da rede " + chainId + ", não da " + CHAIN.name + " (" + CHAIN_ID + "). " +
            "Verifica a variável " + CHAIN.rpcEnv + "."
        );
    }
}


// ============================================================
// CONTRATOS PARTILHADOS
// ============================================================

// Criados em applyChain() para a rede ativa.
let v3Factory = null;

let v3Quoter = null;

let v4Quoter = null;

let v4StateView = null;

let v2Factory = null;


// ============================================================
// SWAP - MÓDULOS NODE
// ============================================================

const readline = require("readline");


// ============================================================
// SWAP - CONTRATOS UNISWAP
//
// Os swaps (V3 e V4) são feitos pelo Universal Router, que
// cobra os tokens através do Permit2.
// ============================================================

let CHAIN_ID = 1n;

let UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

// USDT exige approve(0) antes de mudar uma allowance não-zero.
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";


// Comandos do Universal Router.
const UR_COMMANDS = {
    V3_SWAP_EXACT_IN: 0x00,
    V2_SWAP_EXACT_IN: 0x08,
    WRAP_ETH: 0x0b,
    UNWRAP_WETH: 0x0c,
    V4_SWAP: 0x10
};

// Ações do V4 Router (dentro do comando V4_SWAP).
const V4_ACTIONS = {
    SWAP_EXACT_IN_SINGLE: 0x06,
    SETTLE_ALL: 0x0c,
    TAKE_ALL: 0x0f
};

// Destinatários especiais do Universal Router.
const MSG_SENDER = "0x0000000000000000000000000000000000000001";

const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";


// ============================================================
// SWAP - PARÂMETROS
// ============================================================

const DEFAULT_SLIPPAGE_PERCENT = 0.5;

const MAX_SLIPPAGE_PERCENT = 50;

const MIN_SLIPPAGE_PERCENT = 0.01;

// Acima deste valor o resumo avisa que a perda máxima é elevada.
const HIGH_SLIPPAGE_PERCENT = 5;

// Prazo do swap (deadline) depois de construído.
const DEADLINE_SECONDS = 20 * 60;


// ============================================================
// PROTEÇÃO MEV (opção --protect)
//
// A transação assinada é enviada a um RPC privado em vez do
// mempool público: os bots de sandwich/frontrun não a veem.
// As leituras (saldos, quotes, receipts) continuam no RPC normal.
// ============================================================

// RPC privados da rede ativa (definidos em applyChain a partir de CHAINS).
let PROTECT_RPCS = {};

let DEFAULT_PROTECT = "mevblocker";

// Com --protect o swap expira mais depressa (menos tempo exposto).
const PROTECT_DEADLINE_SECONDS = 3 * 60;

// Quanto tempo esperar por uma transação privada antes de avisar.
const PROTECT_WAIT_SECONDS = 5 * 60;

const PROTECT_POLL_MS = 4000;

// Validade da autorização Permit2 → Universal Router.
const PERMIT2_EXPIRATION_SECONDS = 60 * 60;

// Margem sobre o gas estimado.
const GAS_LIMIT_MARGIN_PERCENT = 125n;

// Quantos índices procurar na Ledger quando se usa --from.
const LEDGER_SCAN_COUNT = 10;

// Quantas contas da Ledger mostra o modo WALLET.
const WALLET_COUNT = 5;

// Níveis de fee (opção --fee=N no modo SWAP).
// O "boost" é uma percentagem do preço de gas normal (baseFee + tip)
// que é somada à gorjeta (priority fee) paga ao validador.
const FEE_LEVELS = {
    1: { name: "NORMAL", boostPercent: 0n, description: "fee normal da rede" },
    2: { name: "FAST", boostPercent: 10n, description: "rápida, próximo bloco, +10%" },
    3: { name: "FASTER", boostPercent: 30n, description: "mais rápida, próximo bloco, +30%" }
};

const DEFAULT_FEE_LEVEL = 1;


// ============================================================
// SWAP - ABIs
// ============================================================

const ERC20_WRITE_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
];

const PERMIT2_ABI = [
    "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
    "function approve(address token, address spender, uint160 amount, uint48 expiration)"
];

const UNIVERSAL_ROUTER_ABI = [
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"
];

const erc20Interface = new ethers.Interface(ERC20_WRITE_ABI);

const permit2Interface = new ethers.Interface(PERMIT2_ABI);

const universalRouterInterface = new ethers.Interface(UNIVERSAL_ROUTER_ABI);

const abiCoder = ethers.AbiCoder.defaultAbiCoder();


// ============================================================
// HELP
// ============================================================

// Símbolos que podem ser usados em vez do endereço do contrato.
// Definidos em applyChain(): ETH/WETH/USDC, ou BNB/WBNB/USDC na BSC.
let TOKEN_ALIASES = {};


// Converte "ETH", "WETH", "USDC" (maiúsculas ou minúsculas) no endereço.
// Qualquer outro valor é devolvido tal como está (endereço do contrato).
function resolveTokenArg(arg) {

    if (arg === undefined || arg === null) {
        return arg;
    }

    const alias = TOKEN_ALIASES[String(arg).toUpperCase()];

    return alias !== undefined ? alias : arg;
}


const HELP_LINE = "============================================================";


function helpTokens() {

    console.log("TOKENS (" + CHAIN.name + ")\n");
    console.log("  Podes usar o endereço do contrato (CA) ou estes nomes:");
    console.log("    " + NATIVE_SYMBOL.padEnd(6) + " " + NATIVE_SYMBOL + " nativo");
    console.log("    " + WRAPPED_SYMBOL.padEnd(6) + " " + WETH);
    console.log("    " + "USDC".padEnd(6) + " " + USDC);
    console.log("  Os nomes mudam com a rede (ex.: na BSC são BNB, WBNB e USDC).\n");
}


function helpChains() {

    console.log("REDES (--chain=N, em qualquer modo)\n");

    for (const [number, config] of Object.entries(CHAINS)) {

        let status;

        if (config.unsupported) {
            status = "ainda não suportada";
        } else if (config.defaultProtect) {
            status = "--protect: " + Object.keys(config.protect).join(", ");
        } else {
            status = "--protect ignorado (sem mempool público)";
        }

        console.log(
            "    --chain=" + number + "  " +
            config.name.padEnd(17) + " " +
            ("(" + config.aliases.filter(a => a !== number).join(", ") + ")").padEnd(26) + " " +
            status
        );
    }

    console.log("\n  Por omissão: --chain=1 (Ethereum). Também aceita o nome ou o Chain ID");
    console.log("  real (ex.: --chain=bsc, --chain=56).\n");
}


function helpPool() {

    console.log("MODO POOL  (só consulta, nunca assina nada)\n");
    console.log("  node topcatswap.js POOL TOKEN_IN TOKEN_OUT");
    console.log("  node topcatswap.js POOL TOKEN_IN TOKEN_OUT AMOUNT_IN\n");
    console.log("  Sem AMOUNT_IN mostra as 3 maiores pools por TVL (V2 + V3 + V4),");
    console.log("  com fee, TVL e liquidez, e acrescenta a melhor de cada versão");
    console.log("  que não esteja no top 3 (até 5 pools).\n");
    console.log("  Com AMOUNT_IN simula a troca em cada pool e mostra também:");
    console.log("  price impact, diferença spot → execução, quantidade esperada,");
    console.log("  custo de gas em ETH e USD, e no fim a BEST EXECUTION");
    console.log("  (a pool que entrega mais tokens).\n");
    console.log("  ETH e WETH são tratados como equivalentes neste modo.\n");
    console.log("  Opções:");
    console.log("    --versions=v2       só V2 (ou v3, v4, ou combinações: --versions=v2,v3)\n");
    console.log("  Exemplos:");
    console.log("    node topcatswap.js POOL ETH USDC");
    console.log("    node topcatswap.js POOL MEME_CA ETH 1000000 --versions=v2");
    console.log("    node topcatswap.js POOL ETH USDC 10\n");
}


function helpSwap() {

    console.log("MODO SWAP  (executa a troca, assinada na Ledger)\n");
    console.log("  node topcatswap.js SWAP TOKEN_IN TOKEN_OUT AMOUNT_IN [opções]\n");
    const names = Object.keys(TOKEN_ALIASES).join(", ");
    console.log("  TOKEN_IN    token que vendes  (" + names + " ou endereço do contrato)");
    console.log("  TOKEN_OUT   token que recebes (" + names + " ou endereço do contrato)");
    console.log("  AMOUNT_IN   quantidade de TOKEN_IN a vender (ex.: 0.01)\n");
    console.log("  Opções:");
    console.log("    --index=N           carteira N da Ledger (por omissão 0;");
    console.log("                        vê os índices com: node topcatswap.js WALLET)");
    console.log("    --from=0xENDEREÇO   procura este endereço na Ledger");
    console.log("    --wallet=NOME       usa uma carteira IMPORTADA (nome ou endereço;");
    console.log("                        vê-as com: node topcatswap.js WALLET IMPORTED).");
    console.log("                        Pede a password dessa carteira. Sem --wallet usa a Ledger.");
    console.log("    --slippage=0.5      tolerância em %, de 0.01 a 50 (por omissão 0.5)");
    console.log("    --fee=1             1 = NORMAL  fee normal da rede (por omissão)");
    console.log("    --fee=2             2 = FAST    próximo bloco, +10% no preço de gas");
    console.log("    --fee=3             3 = FASTER  próximo bloco, +30% no preço de gas");
    console.log("    --protect           proteção contra sandwich e frontrun:");
    console.log("                        envio privado via MEV Blocker (não passa pelo");
    console.log("                        mempool público), prazo de 3 min e nova cotação");
    console.log("                        imediatamente antes do swap");
    console.log("    --protect=flashbots usa o Flashbots Protect em vez do MEV Blocker");
    console.log("                        Na BSC: --protect (Merkle), --protect=pancakeswap,");
    console.log("                        --protect=48club. Na Arbitrum é ignorado com aviso.");
    console.log("    --chain=N           rede (ver REDES abaixo; por omissão Ethereum)");
    console.log("    --versions=v2       só considera pools V2 (ou v3, v4, ou v2,v3...)");
    console.log("    --path=44'/60'/0'/0/0   caminho de derivação explícito\n");
    console.log("  O que acontece:");
    console.log("    1. Análise igual ao modo POOL; escolhe a pool que entrega mais tokens.");
    console.log("    2. Lê o endereço na Ledger e verifica saldos e approvals.");
    console.log("    3. Mostra um resumo: pool, quantidade esperada, mínimo garantido");
    console.log("       e transações a assinar.");
    console.log("    4. Só avança se escreveres SIM. Cada transação é ainda confirmada");
    console.log("       no ecrã da Ledger.");
    console.log("    5. Simula o swap on-chain; se a simulação falhar, nada é enviado.");
    console.log("    6. Mostra o hash, o link do explorador da rede e os saldos finais.\n");
    console.log("  Transações possíveis (as approvals só quando necessárias):");
    console.log("    - approve TOKEN_IN → Permit2   (uma vez por token)");
    console.log("    - Permit2: autorizar o Universal Router (expira em 1h)");
    console.log("    - swap no Universal Router\n");
    console.log("  Neste modo, " + NATIVE_SYMBOL + " e " + WRAPPED_SYMBOL + " são tokens diferentes: " + NATIVE_SYMBOL + " usa pools V4");
    console.log("  com " + NATIVE_SYMBOL + " nativo (e " + WRAPPED_SYMBOL + " embrulhado na V2/V3); " + WRAPPED_SYMBOL + " usa pools com " + WRAPPED_SYMBOL + ".\n");
    console.log("  Tokens com taxa na transferência (muitas memes): usa a V2");
    console.log("  (--versions=v2) e um --slippage superior à taxa do token.\n");
    console.log("  Exemplos:");
    console.log("    node topcatswap.js SWAP ETH USDC 0.01");
    console.log("    node topcatswap.js SWAP ETH USDC 0.01 --index=1");
    console.log("    node topcatswap.js SWAP ETH USDC 0.01 --wallet=Trading --protect");
    console.log("    node topcatswap.js SWAP ETH USDC 0.01 --fee=2");
    console.log("    node topcatswap.js SWAP MEME_CA ETH 1000000 --protect --slippage=5");
    console.log("    node topcatswap.js SWAP USDC ETH 25 --slippage=0.3");
    console.log("    node topcatswap.js SWAP BNB USDC 0.1 --chain=3 --protect\n");
}


function helpWallet() {

    console.log("MODO WALLET  (só leitura, usa a Ledger para obter endereços)\n");
    console.log("  node topcatswap.js WALLET");
    console.log("    Endereços das primeiras " + WALLET_COUNT + " carteiras da Ledger e o índice.\n");
    console.log("  node topcatswap.js WALLET BALANCE");
    console.log("    Saldo de ETH (gas token) nas " + WALLET_COUNT + " carteiras.\n");
    console.log("  node topcatswap.js WALLET BALANCE TOKEN");
    console.log("    Saldo do token (nome ou endereço do contrato) nas " + WALLET_COUNT + " carteiras,");
    console.log("    com valor em USD quando há preço on-chain.\n");
    console.log("  O índice mostrado é o que usas no SWAP com --index=N.\n");
    console.log("  CARTEIRAS IMPORTADAS (chave privada, até " + IMPORTED_MAX + ", partilhadas com a app):");
    console.log("    node topcatswap.js WALLET IMPORTED          lista as carteiras importadas");
    console.log("    node topcatswap.js WALLET IMPORT            importa uma chave privada");
    console.log("                                                (pede nome, chave e password)");
    console.log("    node topcatswap.js WALLET REMOVE NOME       remove uma carteira importada");
    console.log("    node topcatswap.js WALLET BALANCE USDC --wallet=imported");
    console.log("                                                saldos das carteiras importadas");
    console.log("  Pasta: " + importedDir() + "\n");
    console.log("  Exemplos:");
    console.log("    node topcatswap.js WALLET");
    console.log("    node topcatswap.js WALLET BALANCE");
    console.log("    node topcatswap.js WALLET BALANCE USDC\n");
}


function helpRequirements() {

    console.log("REQUISITOS DOS MODOS SWAP E WALLET\n");
    console.log("  npm install ethers @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth");
    console.log("  Ledger ligada por USB, desbloqueada, com a app Ethereum aberta.");
    console.log("  Na app Ethereum → Settings, ativa 'Blind signing'.");
    console.log("  Com --wallet=NOME (carteira importada) a Ledger não é precisa.\n");
}


function showModeHelp(title, sections) {

    console.log("\n" + HELP_LINE);
    console.log("  " + title);
    console.log(HELP_LINE + "\n");

    for (const section of sections) {
        section();
    }

    console.log(HELP_LINE + "\n");
}


const showPoolHelp = () => showModeHelp("UNISWAP BOT — MODO POOL", [helpPool, helpTokens, helpChains]);

const showSwapHelp = () => showModeHelp("UNISWAP BOT — MODO SWAP", [helpSwap, helpTokens, helpChains, helpRequirements]);

const showWalletHelp = () => showModeHelp("UNISWAP BOT — MODO WALLET", [helpWallet, helpTokens, helpChains, helpRequirements]);


function showHelp() {

    showModeHelp("TOPCATSWAP " + TOPCATSWAP_VERSION + " — UNISWAP V2 + V3 + V4  (modos POOL, SWAP e WALLET)", [
        helpPool,
        helpSwap,
        helpWallet,
        helpTokens,
        helpChains,
        helpRequirements,
        () => {
            console.log("VARIÁVEIS DE AMBIENTE (opcionais)\n");
            console.log("  GRAPH_API_KEY   chave da The Graph (sem ela, pools V4 só on-chain)");
            console.log("  RPC_URL         RPC da Ethereum (por omissão: publicnode)");
            console.log("  RPC_URL_42161   RPC da Arbitrum");
            console.log("  RPC_URL_56      RPC da BSC\n");
            console.log("Ajuda de um só modo: node topcatswap.js POOL | SWAP | WALLET HELP\n");
        }
    ]);
}

// ============================================================
// UTILIDADES
// ============================================================

const lc = address => String(address).toLowerCase();

const isNative = address => lc(address) === NATIVE_ETH;

const isEthLike = address => isNative(address) || lc(address) === WETH;

// Na V3 não existe ETH nativo: usa-se WETH.
const toV3Address = address => (isNative(address) ? WETH : lc(address));

// Na V4, ETH e WETH são pools diferentes; procuramos as duas.
const v4Equivalents = address =>
    isEthLike(address) ? [NATIVE_ETH, WETH] : [lc(address)];


function isDynamicFee(fee) {
    return (Number(fee) & DYNAMIC_FEE_FLAG) !== 0;
}


function feeToString(fee) {

    if (isDynamicFee(fee)) {
        return (
            "DYNAMIC [flag " +
            Number(fee) +
            " / 0x" +
            Number(fee).toString(16) +
            "]"
        );
    }

    return Number(fee) + " (" + (Number(fee) / 10000).toFixed(2) + "%)";
}


function validNumber(value) {
    return (
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
    );
}


function formatUSD(value) {
    return Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}


function formatPercent(value) {
    return validNumber(value) ? value.toFixed(4) + "%" : "N/A";
}


// Ordenação decrescente de BigInt (para amountOutRaw).
function compareBigIntDesc(a, b) {
    if (b > a) return 1;
    if (b < a) return -1;
    return 0;
}


// ============================================================
// DECIMALS / TOKEN INFO (com cache)
// ============================================================

const decimalsCache = new Map();

async function getDecimals(address) {

    const key = lc(address);

    if (isNative(key)) {
        return 18;
    }

    if (!decimalsCache.has(key)) {

        const contract = new ethers.Contract(key, TOKEN_ABI, provider);

        decimalsCache.set(
            key,
            contract.decimals()
                .then(Number)
                .catch(error => {
                    decimalsCache.delete(key);
                    throw error;
                })
        );
    }

    return decimalsCache.get(key);
}


async function getTokenInfo(address) {

    if (isNative(address)) {
        return { address: NATIVE_ETH, symbol: NATIVE_SYMBOL, decimals: 18 };
    }

    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    const [symbol, decimals] = await Promise.all([
        contract.symbol(),
        getDecimals(address)
    ]);

    return { address: lc(address), symbol, decimals };
}


// ============================================================
// SPOT PRICE A PARTIR DE sqrtPriceX96
//
// Devolve: quantos TOKEN_OUT por 1 TOKEN_IN.
// ============================================================

function spotFromSqrtPrice(
    sqrtPriceX96,
    tokenInIsToken0,
    decimalsIn,
    decimalsOut
) {

    const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;

    // Preço "raw": unidades mínimas de token1 por unidade mínima de token0.
    const rawPrice0in1 = sqrtPrice ** 2;

    const decimalAdjust = 10 ** decimalsIn / 10 ** decimalsOut;

    if (tokenInIsToken0) {
        return rawPrice0in1 * decimalAdjust;
    }

    return (1 / rawPrice0in1) * decimalAdjust;
}


// ============================================================
// EXECUTION METRICS
//
// Sem Math.max(0, ...): um valor negativo é informação útil
// (normalmente indica que o spot de referência está desatualizado).
// ============================================================

function calculateExecutionMetrics(
    spotPrice,
    amountIn,
    amountOut,
    poolFee
) {

    if (!validNumber(spotPrice) || spotPrice <= 0) {
        return {
            priceImpactPercent: null,
            executionDifferencePercent: null
        };
    }

    const idealOutNoFee = amountIn * spotPrice;

    const executionDifferencePercent =
        ((idealOutNoFee - amountOut) / idealOutNoFee) * 100;

    // Com fee dinâmica não sabemos a fee efetivamente aplicada,
    // por isso não dá para isolar o price impact.
    if (isDynamicFee(poolFee)) {
        return {
            priceImpactPercent: null,
            executionDifferencePercent
        };
    }

    const feePercent = Number(poolFee) / 10000;

    const idealOutAfterFee = idealOutNoFee * (1 - feePercent / 100);

    const priceImpactPercent =
        ((idealOutAfterFee - amountOut) / idealOutAfterFee) * 100;

    return {
        priceImpactPercent,
        executionDifferencePercent
    };
}


// ============================================================
// GAS PRICE EFETIVO
//
// Antes usava maxFeePerGas (o teto, não o custo real).
// Agora: baseFee do último bloco + priority fee.
// ============================================================

async function getEffectiveGasPrice() {

    const [block, feeData] = await Promise.all([
        provider.getBlock("latest"),
        provider.getFeeData()
    ]);

    if (block && block.baseFeePerGas !== null && block.baseFeePerGas !== undefined) {

        const tip = feeData.maxPriorityFeePerGas ?? 0n;

        const price = block.baseFeePerGas + tip;

        // BSC: baseFee 0; usa o gasPrice da rede se for maior.
        return feeData.gasPrice && feeData.gasPrice > price ? feeData.gasPrice : price;
    }

    return feeData.gasPrice ?? null;
}


function calculateTxFee(
    gasEstimate,
    gasPrice,
    ethUSD
) {

    if (
        gasEstimate === null ||
        gasEstimate === undefined ||
        gasPrice === null ||
        ethUSD === null
    ) {
        return { eth: null, usd: null };
    }

    const feeWei = BigInt(gasEstimate) * BigInt(gasPrice);

    const feeETH = Number(ethers.formatEther(feeWei));

    return {
        eth: feeETH,
        usd: feeETH * ethUSD
    };
}


// ============================================================
// V3 HELPERS
// ============================================================

async function getV3PoolAddress(
    tokenA,
    tokenB,
    fee
) {

    const poolAddress = await v3Factory.getPool(tokenA, tokenB, fee);

    return poolAddress === ethers.ZeroAddress ? null : poolAddress;
}


async function getV3SpotPrice(
    poolAddress,
    tokenIn,
    tokenOut
) {

    const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);

    const [token0, slot0, decimalsIn, decimalsOut] = await Promise.all([
        pool.token0(),
        pool.slot0(),
        getDecimals(tokenIn),
        getDecimals(tokenOut)
    ]);

    return spotFromSqrtPrice(
        slot0.sqrtPriceX96,
        lc(token0) === lc(tokenIn),
        decimalsIn,
        decimalsOut
    );
}


// ============================================================
// ETH/USD
// ============================================================

async function getETHPriceUSD() {

    for (const fee of [500, 3000, 100, 10000]) {

        try {

            const poolAddress = await getV3PoolAddress(WETH, USDC, fee);

            if (!poolAddress) {
                continue;
            }

            const price = await getV3SpotPrice(poolAddress, WETH, USDC);

            if (Number.isFinite(price) && price > 0) {
                return price;
            }

        } catch (_) {}
    }

    // Reserva: pair V2 WETH/USDC (ou WBNB/USDC).
    try {

        const pairAddress = await getV2PairAddress(WETH, USDC);

        if (pairAddress) {

            const state = await readV2Pair(pairAddress, WETH);

            const price = v2SpotPrice(
                state.reserveInRaw,
                state.reserveOutRaw,
                await getDecimals(WETH),
                await getDecimals(USDC)
            );

            if (Number.isFinite(price) && price > 0) {
                return price;
            }
        }

    } catch (_) {}

    throw new Error("Não consegui obter o preço " + NATIVE_SYMBOL + "/USD na " + CHAIN.name + ".");
}


// ============================================================
// TOKEN/USD (com cache)
//
// Antes usava a primeira pool V3 encontrada contra WETH,
// que podia ser uma pool quase vazia com preço absurdo.
//
// Agora procura contra WETH e USDC e usa a pool com mais
// liquidez (em USD) do lado do token de referência.
// ============================================================

const priceCache = new Map();

async function getTokenPriceUSD(
    token,
    ethUSD
) {

    const address = toV3Address(token);

    if (address === USDC) {
        return 1;
    }

    if (address === WETH) {
        return ethUSD;
    }

    if (!priceCache.has(address)) {
        priceCache.set(address, findTokenPriceUSD(address, ethUSD));
    }

    return priceCache.get(address);
}


// Lê uma pair V2: reservas do lado de entrada e de saída.
async function readV2Pair(
    pairAddress,
    tokenIn
) {

    const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);

    const [token0, reserves] = await Promise.all([
        pair.token0(),
        pair.getReserves()
    ]);

    const tokenInIsToken0 = lc(token0) === lc(tokenIn);

    return {
        tokenInIsToken0,
        reserveInRaw: tokenInIsToken0 ? reserves.reserve0 : reserves.reserve1,
        reserveOutRaw: tokenInIsToken0 ? reserves.reserve1 : reserves.reserve0
    };
}


async function getV2PairAddress(
    tokenA,
    tokenB
) {

    const pairAddress = await v2Factory.getPair(tokenA, tokenB);

    return pairAddress === ethers.ZeroAddress ? null : pairAddress;
}


// Preço spot V2: quantos TOKEN_OUT por 1 TOKEN_IN.
function v2SpotPrice(
    reserveInRaw,
    reserveOutRaw,
    decimalsIn,
    decimalsOut
) {

    const reserveIn = Number(ethers.formatUnits(reserveInRaw, decimalsIn));

    const reserveOut = Number(ethers.formatUnits(reserveOutRaw, decimalsOut));

    return reserveIn > 0 ? reserveOut / reserveIn : null;
}


// Fórmula de saída da V2 (x*y=k com fee de 0.30%).
function v2AmountOut(
    amountInRaw,
    reserveInRaw,
    reserveOutRaw
) {

    const amountInWithFee = amountInRaw * 997n;

    return (amountInWithFee * reserveOutRaw) / (reserveInRaw * 1000n + amountInWithFee);
}


async function findTokenPriceUSD(
    address,
    ethUSD
) {

    const references = [
        { token: WETH, usd: ethUSD },
        { token: USDC, usd: 1 }
    ];

    let best = null;

    for (const reference of references) {

        const referenceContract = new ethers.Contract(reference.token, TOKEN_ABI, provider);

        const referenceDecimals = await getDecimals(reference.token);

        // Pools V3
        for (const fee of V3_FEE_TIERS) {

            try {

                const poolAddress = await getV3PoolAddress(address, reference.token, fee);

                if (!poolAddress) {
                    continue;
                }

                const balanceRaw = await referenceContract.balanceOf(poolAddress);

                const depthUSD =
                    Number(ethers.formatUnits(balanceRaw, referenceDecimals)) *
                    reference.usd;

                if (depthUSD <= 0) {
                    continue;
                }

                if (!best || depthUSD > best.depthUSD) {
                    best = { kind: "V3", poolAddress, reference, depthUSD };
                }

            } catch (_) {}
        }

        // Pair V2 (muitas memes só têm liquidez aqui)
        try {

            const pairAddress = await getV2PairAddress(address, reference.token);

            if (pairAddress) {

                const state = await readV2Pair(pairAddress, address);

                const depthUSD =
                    Number(ethers.formatUnits(state.reserveOutRaw, referenceDecimals)) *
                    reference.usd;

                if (depthUSD > 0 && (!best || depthUSD > best.depthUSD)) {
                    best = { kind: "V2", poolAddress: pairAddress, reference, depthUSD, state, referenceDecimals };
                }
            }

        } catch (_) {}
    }

    if (!best) {
        return null;
    }

    try {

        let price;

        if (best.kind === "V2") {

            price = v2SpotPrice(
                best.state.reserveInRaw,
                best.state.reserveOutRaw,
                await getDecimals(address),
                best.referenceDecimals
            );

        } else {

            price = await getV3SpotPrice(best.poolAddress, address, best.reference.token);
        }

        if (Number.isFinite(price) && price > 0) {
            return price * best.reference.usd;
        }

    } catch (_) {}

    return null;
}


// ============================================================
// V3 TVL
// ============================================================

async function calculateV3TVLUSD(
    poolAddress,
    ethUSD
) {

    try {

        const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);

        const [token0Address, token1Address] = await Promise.all([
            pool.token0(),
            pool.token1()
        ]);

        const token0 = new ethers.Contract(token0Address, TOKEN_ABI, provider);

        const token1 = new ethers.Contract(token1Address, TOKEN_ABI, provider);

        const [
            decimals0,
            decimals1,
            balance0Raw,
            balance1Raw,
            price0USD,
            price1USD
        ] = await Promise.all([
            getDecimals(token0Address),
            getDecimals(token1Address),
            token0.balanceOf(poolAddress),
            token1.balanceOf(poolAddress),
            getTokenPriceUSD(token0Address, ethUSD),
            getTokenPriceUSD(token1Address, ethUSD)
        ]);

        if (price0USD === null || price1USD === null) {
            return null;
        }

        const balance0 = Number(ethers.formatUnits(balance0Raw, decimals0));

        const balance1 = Number(ethers.formatUnits(balance1Raw, decimals1));

        return balance0 * price0USD + balance1 * price1USD;

    } catch (_) {

        return null;
    }
}


// ============================================================
// GRAPH
// ============================================================

async function graphQuery(
    query,
    variables = {}
) {

    const response = await fetch(getGraphUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {

        const text = await response.text();

        throw new Error("The Graph HTTP " + response.status + ": " + text);
    }

    const json = await response.json();

    if (json.errors) {
        throw new Error("The Graph: " + JSON.stringify(json.errors));
    }

    return json.data;
}


// ============================================================
// DISCOVER V4
//
// Modo POOL: se um dos tokens for ETH ou WETH, procura as duas
// variantes, porque as maiores pools V4 com ETH usam ETH nativo.
//
// Modo SWAP (exact = true): só pools com EXATAMENTE as moedas
// pedidas, para que o que se paga/recebe seja o que se indicou.
// ============================================================

async function discoverV4Pools(
    tokenIn,
    tokenOut,
    exact = false
) {

    const inSet = new Set(exact ? [lc(tokenIn)] : v4Equivalents(tokenIn));

    const outSet = new Set(exact ? [lc(tokenOut)] : v4Equivalents(tokenOut));

    const tokens = [...new Set([...inSet, ...outSet])];

    const query = `
        query FindPools($tokens: [String!]) {
            pools(
                first: 1000
                where: {
                    token0_in: $tokens
                    token1_in: $tokens
                }
            ) {
                id
                token0 { id symbol decimals }
                token1 { id symbol decimals }
                feeTier
                tickSpacing
                hooks
                liquidity
                sqrtPrice
                token0Price
                token1Price
                totalValueLockedToken0
                totalValueLockedToken1
                totalValueLockedUSD
                totalValueLockedUSDUntracked
            }
        }
    `;

    const data = await graphQuery(query, { tokens });

    const pools = data.pools.filter(pool => {

        const p0 = lc(pool.token0.id);

        const p1 = lc(pool.token1.id);

        return (
            (inSet.has(p0) && outSet.has(p1)) ||
            (outSet.has(p0) && inSet.has(p1))
        );
    });

    return { pools, inSet };
}


// ============================================================
// REGISTO DE POOL (campos comuns)
// ============================================================

function newPoolRecord(fields) {

    return {
        quoteOK: false,
        quoteError: null,
        amountOutRaw: null,
        amountOut: null,
        amountOutUSD: null,
        netOutUSD: null,
        executionPrice: null,
        priceImpactPercent: null,
        executionDifferencePercent: null,
        gasEstimate: null,
        ticksCrossed: null,
        txFeeETH: null,
        txFeeUSD: null,
        lpFeeCurrent: null,
        ...fields
    };
}


// ============================================================
// FIND V3
// ============================================================

async function findV3Pools(ctx) {

    const results = [];

    for (const fee of V3_FEE_TIERS) {

        const poolAddress = await getV3PoolAddress(ctx.tokenInV3, ctx.tokenOutV3, fee);

        if (!poolAddress) {
            continue;
        }

        const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);

        const [slot0, token0, liquidity, tvlUSD] = await Promise.all([
            pool.slot0(),
            pool.token0(),
            pool.liquidity(),
            calculateV3TVLUSD(poolAddress, ctx.ethUSD)
        ]);

        const spotPrice = spotFromSqrtPrice(
            slot0.sqrtPriceX96,
            lc(token0) === ctx.tokenInV3,
            ctx.decimalsIn,
            ctx.decimalsOut
        );

        console.log(
            "V3 encontrada:",
            poolAddress,
            "| fee",
            fee,
            "| TVL",
            tvlUSD !== null ? "$" + formatUSD(tvlUSD) : "N/A"
        );

        results.push(newPoolRecord({
            version: "V3",
            id: poolAddress,
            fee: Number(fee),
            tickSpacing: null,
            hooks: null,
            liquidity: liquidity.toString(),
            tvlUSD,
            tvlSource: "saldos on-chain × preços on-chain",
            tvlUntrackedUSD: null,
            spotPrice,
            spotSource: "on-chain (slot0)",
            currencyInLabel: ctx.v3LabelIn,
            currencyOutLabel: ctx.v3LabelOut
        }));
    }

    return results;
}


// ============================================================
// FIND V4
//
// TVL: calculado com as quantidades de tokens do subgraph
// e os MESMOS preços on-chain usados na V3, para o ranking
// ser comparável. O totalValueLockedUSDUntracked deixou de
// entrar no ranking (só é mostrado, como informação).
// ============================================================

// Pools V4 "padrão" (sem hooks) procuradas diretamente on-chain quando
// não há subgraph para a rede ou o subgraph falha.
const V4_STANDARD_POOLS = [
    [100, 1],
    [500, 10],
    [3000, 60],
    [10000, 200]
];


async function probeV4Pools(ctx) {

    const inList = ctx.exactV4 ? [ctx.tokenIn] : v4Equivalents(ctx.tokenIn);

    const outList = ctx.exactV4 ? [ctx.tokenOut] : v4Equivalents(ctx.tokenOut);

    const label = (address, fallback) => {
        if (isNative(address)) return NATIVE_SYMBOL + " (nativo)";
        if (lc(address) === WETH) return WRAPPED_SYMBOL;
        return fallback;
    };

    const results = [];

    for (const a of inList) {

        for (const b of outList) {

            const [currency0, currency1] = BigInt(a) < BigInt(b) ? [lc(a), lc(b)] : [lc(b), lc(a)];

            const zeroForOne = currency0 === lc(a);

            for (const [fee, tickSpacing] of V4_STANDARD_POOLS) {

                const poolId = ethers.keccak256(abiCoder.encode(
                    ["address", "address", "uint24", "int24", "address"],
                    [currency0, currency1, fee, tickSpacing, ethers.ZeroAddress]
                ));

                try {

                    const [slot0, liquidity] = await Promise.all([
                        v4StateView.getSlot0(poolId),
                        v4StateView.getLiquidity(poolId)
                    ]);

                    if (slot0.sqrtPriceX96 === 0n || liquidity === 0n) {
                        continue;
                    }

                    console.log(
                        "V4 encontrada:", poolId.slice(0, 18) + "…",
                        "| fee", fee, "| tickSpacing", tickSpacing,
                        "|", label(a, ctx.symbolIn), "→", label(b, ctx.symbolOut)
                    );

                    results.push(newPoolRecord({
                        version: "V4",
                        id: poolId,
                        currency0,
                        currency1,
                        fee,
                        tickSpacing,
                        hooks: ethers.ZeroAddress,
                        liquidity: liquidity.toString(),
                        tvlUSD: null,
                        tvlSource: null,
                        tvlUntrackedUSD: null,
                        spotPrice: spotFromSqrtPrice(slot0.sqrtPriceX96, zeroForOne, ctx.decimalsIn, ctx.decimalsOut),
                        spotSource: "on-chain (StateView)",
                        zeroForOne,
                        currencyInLabel: label(a, ctx.symbolIn),
                        currencyOutLabel: label(b, ctx.symbolOut)
                    }));

                } catch (_) {}
            }
        }
    }

    console.log("V4 encontradas on-chain (pools padrão, sem hooks):", results.length);

    return results;
}


async function findV4Pools(ctx) {

    if (!V4_SUBGRAPH_ID) {

        console.log("\nSem subgraph V4 para a " + CHAIN.name + ": a procurar pools V4 padrão on-chain...");

        return probeV4Pools(ctx);
    }

    let discovered;

    try {

        discovered = await discoverV4Pools(ctx.tokenIn, ctx.tokenOut, ctx.exactV4);

    } catch (error) {

        console.log(
            "\nSubgraph V4 indisponível (" + (error.shortMessage || error.message).slice(0, 120) + ")." +
            "\nA procurar pools V4 padrão on-chain..."
        );

        return probeV4Pools(ctx);
    }

    const { pools, inSet } = discovered;

    console.log("\nV4 encontradas no índice:", pools.length);

    return pools.map(pool => {

        const currency0 = lc(pool.token0.id);

        const currency1 = lc(pool.token1.id);

        const zeroForOne = inSet.has(currency0);

        const amount0 = Number(pool.totalValueLockedToken0);

        const amount1 = Number(pool.totalValueLockedToken1);

        const amountInSide = zeroForOne ? amount0 : amount1;

        const amountOutSide = zeroForOne ? amount1 : amount0;

        let tvlUSD = null;

        let tvlSource = null;

        if (
            validNumber(ctx.priceInUSD) &&
            validNumber(ctx.priceOutUSD) &&
            Number.isFinite(amountInSide) &&
            Number.isFinite(amountOutSide)
        ) {

            tvlUSD =
                amountInSide * ctx.priceInUSD +
                amountOutSide * ctx.priceOutUSD;

            tvlSource = "quantidades do subgraph × preços on-chain";

        } else {

            const tracked = Number(pool.totalValueLockedUSD);

            if (Number.isFinite(tracked) && tracked > 0) {

                tvlUSD = tracked;

                tvlSource = "subgraph (tracked)";
            }
        }

        const untracked = Number(pool.totalValueLockedUSDUntracked);

        const tokenInfoIn = zeroForOne ? pool.token0 : pool.token1;

        const tokenInfoOut = zeroForOne ? pool.token1 : pool.token0;

        const label = token =>
            isNative(token.id) ? NATIVE_SYMBOL + " (nativo)" : token.symbol;

        // Spot do subgraph como valor provisório.
        // Antes de fazer quote é substituído pelo spot on-chain (StateView).
        const spotPrice = Number(zeroForOne ? pool.token1Price : pool.token0Price);

        return newPoolRecord({
            version: "V4",
            id: pool.id,
            currency0,
            currency1,
            fee: Number(pool.feeTier),
            tickSpacing: Number(pool.tickSpacing),
            hooks: pool.hooks,
            liquidity: pool.liquidity,
            tvlUSD,
            tvlSource,
            tvlUntrackedUSD: Number.isFinite(untracked) ? untracked : null,
            spotPrice,
            spotSource: "subgraph (pode estar desatualizado)",
            zeroForOne,
            currencyInLabel: label(tokenInfoIn),
            currencyOutLabel: label(tokenInfoOut)
        });
    });
}


// ============================================================
// RESULTADO DO QUOTE (comum a V3 e V4)
// ============================================================

function applyQuote(
    pool,
    amountOutRaw,
    gasEstimate,
    ticksCrossed,
    ctx
) {

    pool.amountOutRaw = amountOutRaw;

    pool.amountOut = Number(ethers.formatUnits(amountOutRaw, ctx.decimalsOut));

    pool.executionPrice = pool.amountOut / ctx.amountInNumber;

    const metrics = calculateExecutionMetrics(
        pool.spotPrice,
        ctx.amountInNumber,
        pool.amountOut,
        pool.fee
    );

    pool.priceImpactPercent = metrics.priceImpactPercent;

    pool.executionDifferencePercent = metrics.executionDifferencePercent;

    pool.gasEstimate = gasEstimate;

    pool.ticksCrossed = ticksCrossed ?? null;

    const txFee = calculateTxFee(gasEstimate, ctx.gasPrice, ctx.ethUSD);

    pool.txFeeETH = txFee.eth;

    pool.txFeeUSD = txFee.usd;

    pool.amountOutUSD = validNumber(ctx.priceOutUSD)
        ? pool.amountOut * ctx.priceOutUSD
        : null;

    pool.netOutUSD =
        pool.amountOutUSD !== null && pool.txFeeUSD !== null
            ? pool.amountOutUSD - pool.txFeeUSD
            : null;

    pool.quoteOK = true;

    pool.quoteError = null;
}


// ============================================================
// FIND V2
//
// Uma só pair por par de tokens (fee fixa 0.30%).
// ETH nativo é tratado como WETH (a V2 só usa WETH).
// ============================================================

async function findV2Pools(ctx) {

    const pairAddress = await getV2PairAddress(ctx.tokenInV3, ctx.tokenOutV3);

    if (!pairAddress) {
        console.log("V2: sem pair para este par de tokens.");
        return [];
    }

    const state = await readV2Pair(pairAddress, ctx.tokenInV3);

    if (state.reserveInRaw === 0n || state.reserveOutRaw === 0n) {
        console.log("V2 encontrada:", pairAddress, "| sem liquidez");
        return [];
    }

    const reserveIn = Number(ethers.formatUnits(state.reserveInRaw, ctx.decimalsIn));

    const reserveOut = Number(ethers.formatUnits(state.reserveOutRaw, ctx.decimalsOut));

    let tvlUSD = null;

    if (validNumber(ctx.priceInUSD) && validNumber(ctx.priceOutUSD)) {
        tvlUSD = reserveIn * ctx.priceInUSD + reserveOut * ctx.priceOutUSD;
    }

    console.log(
        "V2 encontrada:",
        pairAddress,
        "| fee",
        V2_FEE,
        "| TVL",
        tvlUSD !== null ? "$" + formatUSD(tvlUSD) : "N/A"
    );

    return [newPoolRecord({
        version: "V2",
        id: pairAddress,
        fee: V2_FEE,
        tickSpacing: null,
        hooks: null,
        liquidity:
            "reservas " + reserveIn + " " + ctx.symbolIn +
            " / " + reserveOut + " " + ctx.symbolOut,
        tvlUSD,
        tvlSource: "reservas on-chain × preços on-chain",
        tvlUntrackedUSD: null,
        spotPrice: v2SpotPrice(state.reserveInRaw, state.reserveOutRaw, ctx.decimalsIn, ctx.decimalsOut),
        spotSource: "on-chain (reservas)",
        currencyInLabel: ctx.v3LabelIn,
        currencyOutLabel: ctx.v3LabelOut
    })];
}


// ============================================================
// QUOTE V2
//
// Calculado com as reservas atuais (lidas no momento).
// Não inclui taxas de transferência de tokens "taxados":
// para esses, usa um --slippage superior à taxa.
// ============================================================

async function quoteV2Pool(
    pool,
    ctx
) {

    if (pool.quoteOK) {
        return;
    }

    try {

        const state = await readV2Pair(pool.id, ctx.tokenInV3);

        pool.spotPrice = v2SpotPrice(state.reserveInRaw, state.reserveOutRaw, ctx.decimalsIn, ctx.decimalsOut);

        const amountOutRaw = v2AmountOut(ctx.amountInRaw, state.reserveInRaw, state.reserveOutRaw);

        if (amountOutRaw === 0n) {
            throw new Error("quantidade de saída zero (liquidez insuficiente)");
        }

        applyQuote(pool, amountOutRaw, V2_GAS_ESTIMATE, null, ctx);

        pool.quoteNote = "calculado pelas reservas; gas estimado; não inclui taxas de transferência do token";

    } catch (error) {

        pool.quoteOK = false;

        pool.quoteError = error.shortMessage || error.message;
    }
}


// ============================================================
// QUOTE V3
// ============================================================

async function quoteV3Pool(
    pool,
    ctx
) {

    if (pool.quoteOK) {
        return;
    }

    try {

        const quote = await v3Quoter.quoteExactInputSingle.staticCall({
            tokenIn: ctx.tokenInV3,
            tokenOut: ctx.tokenOutV3,
            amountIn: ctx.amountInRaw,
            fee: pool.fee,
            sqrtPriceLimitX96: 0
        });

        applyQuote(
            pool,
            quote.amountOut,
            quote.gasEstimate,
            quote.initializedTicksCrossed,
            ctx
        );

    } catch (error) {

        pool.quoteOK = false;

        pool.quoteError = error.shortMessage || error.message;
    }
}


// ============================================================
// QUOTE V4
//
// Antes do quote lê o slot0 on-chain via StateView, para que
// o spot de referência seja atual (e comparável com a V3).
// ============================================================

async function refreshV4Spot(
    pool,
    ctx
) {

    try {

        const slot0 = await v4StateView.getSlot0(pool.id);

        if (slot0.sqrtPriceX96 > 0n) {

            pool.spotPrice = spotFromSqrtPrice(
                slot0.sqrtPriceX96,
                pool.zeroForOne,
                ctx.decimalsIn,
                ctx.decimalsOut
            );

            pool.spotSource = "on-chain (StateView)";

            pool.lpFeeCurrent = Number(slot0.lpFee);
        }

    } catch (_) {

        // Mantém o spot do subgraph.
    }
}


async function quoteV4Pool(
    pool,
    ctx
) {

    if (pool.quoteOK) {
        return;
    }

    await refreshV4Spot(pool, ctx);

    const params = {
        poolKey: {
            currency0: pool.currency0,
            currency1: pool.currency1,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hooks: pool.hooks
        },
        zeroForOne: pool.zeroForOne,
        exactAmount: ctx.amountInRaw,
        hookData: "0x"
    };

    try {

        const quote = await v4Quoter.quoteExactInputSingle.staticCall(params);

        applyQuote(pool, quote.amountOut, quote.gasEstimate, null, ctx);

    } catch (error) {

        pool.quoteOK = false;

        pool.quoteError = error.shortMessage || error.message;
    }
}


async function quotePool(
    pool,
    ctx
) {

    if (pool.version === "V2") {
        await quoteV2Pool(pool, ctx);
    } else if (pool.version === "V3") {
        await quoteV3Pool(pool, ctx);
    } else {
        await quoteV4Pool(pool, ctx);
    }
}


// ============================================================
// RANKINGS
// ============================================================

function rankByTVL(pools) {

    return [...pools].sort((a, b) => {

        const aTVL = validNumber(a.tvlUSD) ? Number(a.tvlUSD) : -1;

        const bTVL = validNumber(b.tvlUSD) ? Number(b.tvlUSD) : -1;

        return bTVL - aTVL;
    });
}


// Melhor execução = maior quantidade recebida (amountOut real do quoter).
function pickBestByAmountOut(pools) {

    const executable = pools
        .filter(p => p.quoteOK && p.amountOutRaw !== null)
        .sort((a, b) => compareBigIntDesc(a.amountOutRaw, b.amountOutRaw));

    return executable.length > 0 ? executable[0] : null;
}


// Melhor depois de descontar o custo de gas (só se houver dados em USD).
function pickBestByNetUSD(pools) {

    const executable = pools
        .filter(p => p.quoteOK && validNumber(p.netOutUSD))
        .sort((a, b) => b.netOutUSD - a.netOutUSD);

    return executable.length > 0 ? executable[0] : null;
}


// ============================================================
// MELHOR V4 EXECUTÁVEL (entre as TOP 10 por TVL)
// ============================================================

async function findBestExecutableV4(
    v4Pools,
    ctx
) {

    if (v4Pools.length === 0) {
        return null;
    }

    const candidates = rankByTVL(v4Pools).slice(0, MAX_V4_QUOTE_CANDIDATES);

    console.log("\nA testar as", candidates.length, "V4 de maior TVL...\n");

    for (let i = 0; i < candidates.length; i++) {

        const pool = candidates[i];

        process.stdout.write(
            "V4 #" +
            (i + 1) +
            " | TVL " +
            (validNumber(pool.tvlUSD) ? "$" + formatUSD(pool.tvlUSD) : "N/A") +
            " | " +
            feeToString(pool.fee) +
            " | " +
            pool.currencyInLabel + " → " + pool.currencyOutLabel +
            " ... "
        );

        await quoteV4Pool(pool, ctx);

        if (pool.quoteOK) {

            console.log(
                "OK | OUT " +
                ethers.formatUnits(pool.amountOutRaw, ctx.decimalsOut) +
                " " +
                pool.currencyOutLabel
            );

        } else {

            console.log("SEM QUOTE");
        }
    }

    return pickBestByAmountOut(candidates);
}


// ============================================================
// MELHOR V3
//
// Com AMOUNT_IN: faz quote a todas as V3 (no máximo 4) e
// escolhe a que dá mais output. Sem AMOUNT_IN: maior TVL.
// ============================================================

async function findBestV3(
    v3Pools,
    ctx
) {

    if (v3Pools.length === 0) {
        return null;
    }

    if (!ctx.amountInRaw) {
        return rankByTVL(v3Pools)[0];
    }

    for (const pool of v3Pools) {
        await quoteV3Pool(pool, ctx);
    }

    return pickBestByAmountOut(v3Pools) || rankByTVL(v3Pools)[0];
}


// ============================================================
// TOP 3 GLOBAL POR TVL
// ============================================================

function selectTop3(allPools) {
    return rankByTVL(allPools).slice(0, 3);
}


// ============================================================
// PRINT
// ============================================================

function printPool(
    pool,
    index,
    ctx
) {

    console.log("#" + index);

    console.log("VERSION:                  ", pool.version);

    console.log(
        pool.version === "V4"
            ? "POOL ID:                  "
            : (pool.version === "V2" ? "PAIR:                     " : "POOL:                     "),
        pool.id
    );

    console.log("POOL FEE:                 ", feeToString(pool.fee));

    if (isDynamicFee(pool.fee) && pool.lpFeeCurrent !== null) {

        console.log(
            "LP FEE ARMAZENADA:        ",
            pool.lpFeeCurrent +
            " (" + (pool.lpFeeCurrent / 10000).toFixed(4) + "%)" +
            " — o hook pode aplicar outra no swap"
        );
    }

    console.log(
        "TROCA:                    ",
        pool.currencyInLabel + " → " + pool.currencyOutLabel
    );

    if (pool.version === "V4") {

        console.log("TICK SPACING:             ", pool.tickSpacing);

        console.log("HOOKS:                    ", pool.hooks);
    }

    console.log(
        "POOL TVL USD:             ",
        validNumber(pool.tvlUSD)
            ? "$ " + formatUSD(pool.tvlUSD) + "  [" + pool.tvlSource + "]"
            : "N/A"
    );

    if (
        pool.version === "V4" &&
        !validNumber(pool.tvlUSD) &&
        validNumber(pool.tvlUntrackedUSD) &&
        pool.tvlUntrackedUSD > 0
    ) {

        console.log(
            "TVL UNTRACKED (subgraph): ",
            "$ " + formatUSD(pool.tvlUntrackedUSD) +
            "  [pouco fiável, não usado no ranking]"
        );
    }

    console.log(
        pool.version === "V2" ? "LIQUIDEZ:                 " : "ACTIVE LIQUIDITY RAW:     ",
        pool.liquidity
    );

    if (!ctx.amountIn) {
        console.log("");
        return;
    }

    if (!pool.quoteOK) {

        console.log("QUOTE:                     unavailable");

        if (pool.quoteError) {
            console.log("REASON:                   ", pool.quoteError);
        }

        console.log("");

        return;
    }

    if (pool.priceImpactPercent === null) {

        console.log(
            "PRICE IMPACT:             ",
            isDynamicFee(pool.fee) ? "N/A (dynamic fee)" : "N/A"
        );

    } else {

        console.log("PRICE IMPACT:             ", formatPercent(pool.priceImpactPercent));
    }

    console.log(
        "SPOT -> EXECUTION DIFF:   ",
        formatPercent(pool.executionDifferencePercent) +
        (
            validNumber(pool.executionDifferencePercent) &&
            pool.executionDifferencePercent < 0
                ? "  (negativo: spot de referência provavelmente desatualizado)"
                : ""
        )
    );

    console.log("");

    console.log("Amount IN:                ", ctx.amountIn, pool.currencyInLabel);

    console.log(
        "Expected OUT:             ",
        ethers.formatUnits(pool.amountOutRaw, ctx.decimalsOut),
        pool.currencyOutLabel
    );

    if (pool.amountOutUSD !== null) {
        console.log("Expected OUT USD:          $", formatUSD(pool.amountOutUSD));
    }

    if (validNumber(pool.spotPrice)) {

        console.log(
            "Spot price:               ",
            pool.spotPrice.toFixed(8),
            ctx.symbolOut + "/" + ctx.symbolIn,
            "[" + pool.spotSource + "]"
        );
    }

    console.log(
        "Execution price:          ",
        pool.executionPrice.toFixed(8),
        ctx.symbolOut + "/" + ctx.symbolIn
    );

    if (pool.ticksCrossed !== null) {
        console.log("Ticks crossed:            ", pool.ticksCrossed.toString());
    }

    if (pool.gasEstimate !== null) {
        console.log(
            pool.version === "V2" ? "Gas (estimativa):         " : "Quoter gas:               ",
            pool.gasEstimate.toString()
        );
    }

    if (pool.quoteNote) {
        console.log("Nota:                     ", pool.quoteNote);
    }

    if (pool.txFeeETH !== null) {

        console.log("TX fee estimate:          ", pool.txFeeETH.toFixed(8), NATIVE_SYMBOL, "(baseFee + tip)");

        console.log("TX fee USD:                $", pool.txFeeUSD.toFixed(2));
    }

    if (pool.netOutUSD !== null) {
        console.log("OUT líquido de gas USD:    $", formatUSD(pool.netOutUSD));
    }

    console.log("");
}



// ============================================================
// --versions=v2,v3,v4
// ============================================================

function parseVersions(value) {

    if (value === undefined || value === true) {
        return new Set(ALL_VERSIONS);
    }

    const versions = String(value)
        .split(",")
        .map(v => v.trim().toUpperCase())
        .filter(Boolean)
        .map(v => (v.startsWith("V") ? v : "V" + v));

    for (const version of versions) {
        if (!ALL_VERSIONS.includes(version)) {
            throw new Error("--versions inválido: " + value + " (usa v2, v3, v4 separados por vírgulas).");
        }
    }

    if (versions.length === 0) {
        throw new Error("--versions vazio.");
    }

    return new Set(versions);
}


// ============================================================
// CONTEXTO (validação + dados base)
// ============================================================

async function buildContext(
    tokenInArg,
    tokenOutArg,
    amountArg,
    options = {}
) {

    if (!tokenInArg || !tokenOutArg) {
        throw new Error("Indica TOKEN_IN e TOKEN_OUT.");
    }

    tokenInArg = resolveTokenArg(tokenInArg);

    tokenOutArg = resolveTokenArg(tokenOutArg);

    for (const arg of [tokenInArg, tokenOutArg]) {
        if (!ethers.isAddress(arg)) {
            throw new Error(
                "Token inválido: " + arg + " (usa " + Object.keys(TOKEN_ALIASES).join(", ") + " ou o endereço do contrato)."
            );
        }
    }

    const tokenIn = lc(tokenInArg);

    const tokenOut = lc(tokenOutArg);

    if (toV3Address(tokenIn) === toV3Address(tokenOut)) {
        throw new Error(
            "TOKEN_IN e TOKEN_OUT são o mesmo token (" + NATIVE_SYMBOL + " e " + WRAPPED_SYMBOL + " contam como o mesmo)."
        );
    }

    let amountIn = null;

    if (amountArg !== undefined && amountArg !== null) {

        const amountNumber = Number(amountArg);

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            throw new Error("AMOUNT_IN inválido: " + amountArg);
        }

        amountIn = String(amountArg);
    }

    const [infoIn, infoOut] = await Promise.all([
        getTokenInfo(tokenIn),
        getTokenInfo(tokenOut)
    ]);

    const ethUSD = await getETHPriceUSD();

    const [priceInUSD, priceOutUSD, gasPrice] = await Promise.all([
        getTokenPriceUSD(tokenIn, ethUSD),
        getTokenPriceUSD(tokenOut, ethUSD),
        amountIn ? getEffectiveGasPrice() : null
    ]);

    return {
        exactV4: Boolean(options.exactV4),
        versions: options.versions || new Set(ALL_VERSIONS),
        tokenIn,
        tokenOut,
        tokenInV3: toV3Address(tokenIn),
        tokenOutV3: toV3Address(tokenOut),
        symbolIn: infoIn.symbol,
        symbolOut: infoOut.symbol,
        v3LabelIn: isNative(tokenIn) ? NATIVE_SYMBOL + " (nativo, embrulhado em " + WRAPPED_SYMBOL + ")" : infoIn.symbol,
        v3LabelOut: isNative(tokenOut) ? NATIVE_SYMBOL + " (nativo, desembrulhado de " + WRAPPED_SYMBOL + ")" : infoOut.symbol,
        decimalsIn: infoIn.decimals,
        decimalsOut: infoOut.decimals,
        ethUSD,
        priceInUSD,
        priceOutUSD,
        gasPrice,
        amountIn,
        amountInNumber: amountIn ? Number(amountIn) : null,
        amountInRaw: amountIn ? ethers.parseUnits(amountIn, infoIn.decimals) : null
    };
}


function printHeader(ctx, modeLabel) {

    console.log("\n============================================================");
    console.log("            " + modeLabel + " — UNISWAP V2 + V3 + V4");
    console.log("                  rede: " + CHAIN.name + " (" + CHAIN_ID + ")");
    console.log("                  " + ctx.symbolIn + " / " + ctx.symbolOut);

    if (ctx.amountIn) {
        console.log("                 MONTANTE: " + ctx.amountIn + " " + ctx.symbolIn);
    }

    console.log("============================================================\n");

    if (ctx.exactV4) {

        if (isEthLike(ctx.tokenIn) || isEthLike(ctx.tokenOut)) {

            console.log(
                "Nota: no modo SWAP só se usam pools V4 com exatamente estas moedas.\n" +
                "      Para pools V4 com " + NATIVE_SYMBOL + " nativo usa " + NATIVE_SYMBOL + " (" + NATIVE_ETH + ").\n"
            );
        }

    } else if (isEthLike(ctx.tokenIn) || isEthLike(ctx.tokenOut)) {

        console.log(
            "Nota: " + NATIVE_SYMBOL + " e " + WRAPPED_SYMBOL + " tratados como equivalentes " +
            "(V2/V3 usam " + WRAPPED_SYMBOL + "; V4 inclui pools com " + NATIVE_SYMBOL + " nativo e com " + WRAPPED_SYMBOL + ").\n"
        );
    }

    if (ctx.priceInUSD === null || ctx.priceOutUSD === null) {

        console.log(
            "Aviso: sem preço USD on-chain para um dos tokens; " +
            "algumas TVL podem ficar N/A ou vir do subgraph.\n"
        );
    }
}


// ============================================================
// ANÁLISE DE POOLS (comum a POOL e SWAP)
// ============================================================

async function analyzePools(ctx) {

    console.log("Versões: " + [...ctx.versions].join(", ") + "\n");

    // V2
    let v2Pools = [];

    if (ctx.versions.has("V2")) {

        console.log("A procurar V2...\n");

        try {

            v2Pools = await findV2Pools(ctx);

        } catch (error) {

            console.log("ERRO NA PESQUISA V2:", error.shortMessage || error.message);
        }
    }

    // V3
    let v3Pools = [];

    if (ctx.versions.has("V3")) {

        console.log("\nA procurar V3...\n");

        v3Pools = await findV3Pools(ctx);
    }

    // V4
    let v4Pools = [];

    if (ctx.versions.has("V4")) {

        console.log("\nA procurar V4...");

        try {

            v4Pools = await findV4Pools(ctx);

        } catch (error) {

            console.log("\nERRO NA PESQUISA V4:", error.shortMessage || error.message);

            console.log("A continuar sem V4.");
        }
    }

    const allPools = [...v2Pools, ...v3Pools, ...v4Pools];

    // TOP 3 por TVL + quote
    const selected = selectTop3(allPools);

    if (ctx.amountIn) {

        for (const pool of selected) {
            await quotePool(pool, ctx);
        }
    }

    // Garantir uma pool de cada versão disponível (V2, V3, V4)
    const hasV2 = selected.some(p => p.version === "V2");

    const hasV3 = selected.some(p => p.version === "V3");

    const hasV4 = selected.some(p => p.version === "V4");

    if (!hasV4 && v4Pools.length > 0) {

        const bestV4 = ctx.amountIn
            ? await findBestExecutableV4(v4Pools, ctx)
            : rankByTVL(v4Pools)[0];

        if (bestV4) {
            selected.push(bestV4);
        }
    }

    if (!hasV3 && v3Pools.length > 0) {

        const bestV3 = await findBestV3(v3Pools, ctx);

        if (bestV3) {
            selected.push(bestV3);
        }
    }

    if (!hasV2 && v2Pools.length > 0) {

        const v2 = v2Pools[0];

        if (ctx.amountIn) {
            await quotePool(v2, ctx);
        }

        selected.push(v2);
    }

    // Output
    console.log("\n============================================================");
    console.log("        MAIORES POOLS + MELHOR DE CADA VERSÃO");
    console.log("                  " + ctx.symbolIn + " / " + ctx.symbolOut);
    console.log("============================================================\n");

    for (let i = 0; i < selected.length; i++) {
        printPool(selected[i], i + 1, ctx);
    }

    let best = null;

    if (ctx.amountIn) {

        best = pickBestByAmountOut(selected);

        if (best) {
            printBestExecution(best, selected, ctx);
        } else {
            console.log("Nenhuma das pools mostradas devolveu quote.");
        }
    }

    return { v2Pools, v3Pools, v4Pools, allPools, selected, best };
}


function printBestExecution(
    best,
    selected,
    ctx
) {

    console.log("============================================================");
    console.log("BEST EXECUTION (maior quantidade recebida)");
    console.log("============================================================");

    console.log("VERSION:                  ", best.version);

    console.log("POOL FEE:                 ", feeToString(best.fee));

    console.log(
        "Expected OUT:             ",
        ethers.formatUnits(best.amountOutRaw, ctx.decimalsOut),
        best.currencyOutLabel
    );

    if (best.amountOutUSD !== null) {
        console.log("Expected OUT USD:          $", formatUSD(best.amountOutUSD));
    }

    if (best.txFeeUSD !== null) {
        console.log("TX fee USD:                $", best.txFeeUSD.toFixed(2));
    }

    console.log(
        "SPOT -> EXECUTION DIFF:   ",
        formatPercent(best.executionDifferencePercent)
    );

    console.log(
        best.version === "V4"
            ? "POOL ID:                  "
            : (best.version === "V2" ? "PAIR:                     " : "POOL:                     "),
        best.id
    );

    const bestNet = pickBestByNetUSD(selected);

    if (bestNet && bestNet !== best) {

        console.log("");

        console.log(
            "Nota: descontando o gas, a melhor seria a #" +
            (selected.indexOf(bestNet) + 1) +
            " (" + bestNet.version + ", " + feeToString(bestNet.fee) + ")" +
            " com $" + formatUSD(bestNet.netOutUSD) + " líquidos" +
            " vs $" + formatUSD(best.netOutUSD) + "."
        );
    }

    console.log("============================================================");
}


function printStats(result) {

    console.log("\nV2 encontradas:", result.v2Pools.length);

    console.log("V3 encontradas:", result.v3Pools.length);

    console.log("V4 encontradas:", result.v4Pools.length);

    console.log("TOTAL DESCOBERTAS:", result.allPools.length);

    console.log("MOSTRADAS:", result.selected.length);
}


// ============================================================
// MODO POOL
// ============================================================

async function runPool(args) {

    const { positional, flags } = parseArgs(args);

    if (positional.length === 0 || isHelpArg(positional[0])) {
        showPoolHelp();
        return;
    }

    if (positional.length < 2) {
        showPoolHelp();
        throw new Error("O modo POOL precisa de TOKEN_IN e TOKEN_OUT.");
    }

    const ctx = await buildContext(positional[0], positional[1], positional[2], {
        versions: parseVersions(flags.versions)
    });

    printHeader(ctx, "POOL");

    const result = await analyzePools(ctx);

    printStats(result);

    console.log("\nNENHUMA TRANSACÇÃO FOI ASSINADA OU ENVIADA.\n");
}


// ============================================================
// ARGUMENTOS
// ============================================================

function parseArgs(args) {

    const positional = [];

    const flags = {};

    for (const arg of args) {

        if (arg.startsWith("--")) {

            const [key, ...rest] = arg.slice(2).split("=");

            flags[key.toLowerCase()] = rest.length > 0 ? rest.join("=") : true;

        } else {

            positional.push(arg);
        }
    }

    return { positional, flags };
}


function isHelpArg(arg) {
    return ["HELP", "-H", "--HELP", "AJUDA"].includes(String(arg).toUpperCase());
}


function askQuestion(question) {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}


// ============================================================
// CARTEIRAS IMPORTADAS (chave privada cifrada)
//
// Mesmo formato da app gráfica: um ficheiro por carteira em
// ~/.config/TopCatSwap/wallets/<endereço>.json com o keystore
// padrão da Ethereum (scrypt), cifrado com a password dessa carteira.
// ============================================================

const IMPORTED_MAX = 5;

function importedDir() {

    if (process.env.TOPCATSWAP_WALLETS) return process.env.TOPCATSWAP_WALLETS;

    const os = require("os");
    const path = require("path");
    const home = os.homedir();

    let base;

    if (process.platform === "win32") base = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    else if (process.platform === "darwin") base = path.join(home, "Library", "Application Support");
    else base = process.env.XDG_CONFIG_HOME || path.join(home, ".config");

    return path.join(base, "TopCatSwap", "wallets");
}


function listImported() {

    const fs = require("fs");
    const path = require("path");
    const dir = importedDir();

    if (!fs.existsSync(dir)) return [];

    const out = [];

    for (const name of fs.readdirSync(dir)) {
        if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
        try {
            const e = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
            if (ethers.isAddress(e.address) && typeof e.keystore === "string") {
                out.push({ address: ethers.getAddress(e.address), label: e.label || "Carteira importada", createdAt: e.createdAt || "", file: path.join(dir, name), keystore: e.keystore });
            }
        } catch (_) {}
    }

    return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}


function findImported(nameOrAddress) {

    const list = listImported();
    const q = String(nameOrAddress || "").trim().toLowerCase();

    if (list.length === 0) {
        throw new Error("Não há carteiras importadas. Importa uma com: node topcatswap.js WALLET IMPORT");
    }

    const hit = list.find(w => w.address.toLowerCase() === q) ||
        list.filter(w => w.label.toLowerCase() === q)[0] ||
        (/^\d+$/.test(q) ? list[Number(q)] : null);

    if (!hit) {
        throw new Error(
            "Carteira importada não encontrada: " + nameOrAddress + ". Disponíveis: " +
            list.map((w, i) => i + "=" + w.label).join(", ")
        );
    }

    return hit;
}


// Pergunta sem mostrar o que se escreve (passwords e chaves).
function askHidden(question) {

    return new Promise(resolve => {

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

        let asked = false;

        rl._writeToOutput = (text) => {
            if (!asked) {
                process.stdout.write(text);
                if (text.includes(question)) asked = true;
            }
        };

        rl.question(question, answer => {
            rl.close();
            process.stdout.write("\n");
            resolve(answer);
        });
    });
}


async function openImported(nameOrAddress) {

    const entry = findImported(nameOrAddress);

    console.log("\nCarteira importada: " + entry.label + "  " + entry.address);

    for (let attempt = 1; attempt <= 3; attempt++) {

        const password = await askHidden("Password desta carteira: ");

        try {

            const wallet = await ethers.Wallet.fromEncryptedJson(entry.keystore, password);

            if (wallet.address !== entry.address) {
                throw new Error("O ficheiro da carteira não corresponde ao endereço.");
            }

            return {
                kind: "local",
                name: entry.label,
                account: { address: wallet.address, path: null },
                transport: { close: async () => {} },
                async signTransaction(tx) {
                    return wallet.signingKey.sign(tx.unsignedHash);
                }
            };

        } catch (error) {

            if (!/password|invalid/i.test(String(error && error.message))) throw error;

            console.log("Password errada." + (attempt < 3 ? " Tenta de novo." : ""));
        }
    }

    throw new Error("Password errada 3 vezes. Nada foi feito.");
}


async function importWalletCli() {

    const fs = require("fs");
    const path = require("path");

    const list = listImported();

    if (list.length >= IMPORTED_MAX) {
        throw new Error("Já tens " + IMPORTED_MAX + " carteiras importadas. Remove uma com: node topcatswap.js WALLET REMOVE NOME");
    }

    console.log("\nIMPORTAR CARTEIRA POR CHAVE PRIVADA (" + list.length + " de " + IMPORTED_MAX + ")");
    console.log("A chave fica cifrada com uma password exclusiva desta carteira em:");
    console.log("  " + importedDir());
    console.log("Uma chave importada é menos segura do que uma Ledger: usa-a para valores que aceitas arriscar.\n");

    const label = (await askQuestion("Nome (opcional): ")).trim().slice(0, 40) || "Carteira importada";

    let key = (await askHidden("Chave privada (não aparece no ecrã): ")).trim().replace(/\s+/g, "");

    if (/^[0-9a-fA-F]{64}$/.test(key)) key = "0x" + key;

    if (!/^0x[0-9a-fA-F]{64}$/.test(key) || /^0x0{64}$/.test(key)) {
        throw new Error("Chave privada inválida: tem de ter 64 caracteres hexadecimais (com ou sem 0x).");
    }

    const wallet = new ethers.Wallet(key);

    if (list.some(w => w.address === wallet.address)) {
        throw new Error("Esta carteira (" + wallet.address + ") já está importada.");
    }

    const p1 = await askHidden("Password desta carteira (mínimo 8 caracteres): ");

    if (p1.length < 8) throw new Error("A password tem de ter pelo menos 8 caracteres.");

    const p2 = await askHidden("Repete a password: ");

    if (p1 !== p2) throw new Error("As passwords não coincidem. Nada foi guardado.");

    console.log("A cifrar...");

    const entry = {
        version: 1,
        address: wallet.address,
        label,
        createdAt: new Date().toISOString(),
        keystore: await wallet.encrypt(p1)
    };

    const dir = importedDir();

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const file = path.join(dir, wallet.address.toLowerCase() + ".json");

    fs.writeFileSync(file + ".tmp", JSON.stringify(entry, null, 2), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);

    console.log("\nImportada: " + label + "  " + wallet.address);
    console.log("Usa-a com: node topcatswap.js SWAP ETH USDC 0.01 --wallet=\"" + label + "\"\n");
}


async function removeWalletCli(nameOrAddress) {

    const fs = require("fs");

    const entry = findImported(nameOrAddress);

    console.log("\nVais remover " + entry.label + "  " + entry.address);
    console.log("A chave cifrada é apagada deste computador. Os fundos continuam no endereço,");
    console.log("mas só voltas a usá-lo importando de novo a chave privada.");

    const answer = await askQuestion("Escreve REMOVER para confirmar: ");

    if (answer.trim().toUpperCase() !== "REMOVER") {
        console.log("Cancelado. Nada foi apagado.\n");
        return;
    }

    fs.unlinkSync(entry.file);

    console.log("Removida.\n");
}


// ============================================================
// LEDGER
// ============================================================

function loadLedgerLibs() {

    try {

        const transportModule = require("@ledgerhq/hw-transport-node-hid");

        const ethModule = require("@ledgerhq/hw-app-eth");

        return {
            TransportNodeHid: transportModule.default || transportModule,
            Eth: ethModule.default || ethModule,
            ledgerService: ethModule.ledgerService || null
        };

    } catch (error) {

        throw new Error(
            "Faltam as bibliotecas da Ledger. Instala com:\n" +
            "  npm install @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth\n" +
            "(" + error.message + ")"
        );
    }
}


// Caminhos de derivação (sem o prefixo "m/").
const ledgerLivePath = index => `44'/60'/${index}'/0/0`;

const ledgerLegacyPath = index => `44'/60'/0'/${index}`;


function explainLedgerError(error) {

    const code = error && error.statusCode;

    if (code === 0x6985) {
        return "Transação rejeitada na Ledger.";
    }

    if (code === 0x6a80) {
        return (
            "A Ledger recusou por falta de 'Blind signing'. " +
            "Na app Ethereum → Settings, ativa 'Blind signing' e tenta de novo."
        );
    }

    if (code === 0x6e00 || code === 0x6d00 || code === 0x6511 || code === 0x6e01) {
        return "Abre a app Ethereum na Ledger e tenta de novo.";
    }

    if (code === 0x5515 || code === 0x6b0c) {
        return "A Ledger está bloqueada. Desbloqueia-a com o PIN e tenta de novo.";
    }

    return (error && (error.message || String(error))) || "Erro desconhecido na Ledger.";
}


async function connectLedger() {

    const libs = loadLedgerLibs();

    console.log("\nA ligar à Ledger (desbloqueada, com a app Ethereum aberta)...");

    let transport;

    try {

        transport = await libs.TransportNodeHid.create();

    } catch (error) {

        throw new Error(
            "Não consegui ligar à Ledger: " + explainLedgerError(error) + "\n" +
            "Confirma: cabo USB ligado, Ledger desbloqueada, app Ethereum aberta,\n" +
            "nenhuma outra aplicação (Ledger Live, browser) a usar a Ledger,\n" +
            "e regras udev instaladas no Ubuntu."
        );
    }

    return {
        transport,
        eth: new libs.Eth(transport),
        ledgerService: libs.ledgerService
    };
}


async function ledgerAddressAt(
    ledger,
    path
) {

    try {

        const { address } = await ledger.eth.getAddress(path, false);

        return ethers.getAddress(address);

    } catch (error) {

        throw new Error(explainLedgerError(error));
    }
}


// Escolhe a conta da Ledger:
//   --path  → caminho explícito
//   --from  → procura o endereço nos primeiros índices
//   --index → conta N do Ledger Live (por omissão 0)
async function resolveLedgerAccount(
    ledger,
    flags
) {

    let wanted = null;

    if (flags.from !== undefined) {

        if (!ethers.isAddress(String(flags.from))) {
            throw new Error("--from inválido: " + flags.from);
        }

        wanted = lc(flags.from);
    }

    if (flags.path !== undefined) {

        const path = String(flags.path).replace(/^m\//, "");

        const address = await ledgerAddressAt(ledger, path);

        if (wanted && lc(address) !== wanted) {
            throw new Error(
                "O caminho " + path + " corresponde a " + address +
                ", não a " + flags.from + "."
            );
        }

        return { path, address };
    }

    if (wanted) {

        console.log("A procurar " + ethers.getAddress(wanted) + " na Ledger...");

        for (const makePath of [ledgerLivePath, ledgerLegacyPath]) {

            for (let i = 0; i < LEDGER_SCAN_COUNT; i++) {

                const path = makePath(i);

                const address = await ledgerAddressAt(ledger, path);

                if (lc(address) === wanted) {
                    return { path, address };
                }
            }
        }

        throw new Error(
            "O endereço " + flags.from + " não foi encontrado nesta Ledger " +
            "(índices 0-" + (LEDGER_SCAN_COUNT - 1) + "). " +
            "Usa --path=... com o caminho correto."
        );
    }

    const index = flags.index !== undefined ? Number(flags.index) : 0;

    if (!Number.isInteger(index) || index < 0) {
        throw new Error("--index inválido: " + flags.index);
    }

    const path = ledgerLivePath(index);

    const address = await ledgerAddressAt(ledger, path);

    return { path, address };
}


// Converte o "v" devolvido pela Ledger em paridade (0/1).
function ledgerVToParity(vHex) {

    const v = parseInt(vHex, 16);

    if (v === 0 || v === 1) {
        return v;
    }

    if (v === 27 || v === 28) {
        return v - 27;
    }

    return (v - 35) % 2 === 0 ? 0 : 1;
}


// ============================================================
// FEES (EIP-1559)
//
// NORMAL: gorjeta sugerida pela rede.
// FAST / FASTER: gorjeta + 10% / 30% do preço de gas normal,
// para o validador preferir esta transação no próximo bloco.
//
// maxFeePerGas = 2 × baseFee + gorjeta: cobre subidas da baseFee
// (máx. +12.5% por bloco). Só se paga baseFee real + gorjeta.
// ============================================================

function formatGwei(wei) {
    return Number(ethers.formatUnits(wei, "gwei")).toFixed(3) + " gwei";
}


async function getFeeParams(level) {

    const config = FEE_LEVELS[level];

    const [block, feeData] = await Promise.all([
        provider.getBlock("latest"),
        provider.getFeeData()
    ]);

    // Redes sem baseFee (ou com baseFee 0, como a BSC) usam só a gorjeta.
    const baseFee = block.baseFeePerGas ?? 0n;

    let tip;

    try {

        tip = BigInt(await provider.send("eth_maxPriorityFeePerGas", []));

    } catch (_) {

        tip = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei");
    }

    // Se a gorjeta sugerida ficar abaixo do gasPrice mínimo da rede
    // (acontece na BSC, com baseFee 0), usa esse mínimo.
    if (feeData.gasPrice && baseFee + tip < feeData.gasPrice) {
        tip = feeData.gasPrice - baseFee;
    }

    const normalGasPrice = baseFee + tip;

    const boost = (normalGasPrice * config.boostPercent) / 100n;

    const priorityFee = tip + boost;

    return {
        level,
        name: config.name,
        description: config.description,
        baseFee,
        priorityFee,
        maxFeePerGas: baseFee * 2n + priorityFee,
        effectiveGasPrice: baseFee + priorityFee
    };
}


function parseFeeLevel(value) {

    if (value === undefined) {
        return DEFAULT_FEE_LEVEL;
    }

    const level = Number(value);

    if (!FEE_LEVELS[level]) {
        throw new Error("--fee inválido: " + value + " (usa 1, 2 ou 3).");
    }

    return level;
}


// ============================================================
// ENVIO PRIVADO
// ============================================================

function parseProtect(value) {

    if (value === undefined) {
        return null;
    }

    // Rede sem RPC privado: a opção é ignorada com aviso.
    if (!DEFAULT_PROTECT) {

        console.log(
            "\nAVISO: --protect ignorado na " + CHAIN.name + ": " + CHAIN.noProtectReason + "." +
            "\n       O envio segue pelo RPC normal; o --slippage continua a limitar a perda máxima.\n"
        );

        return null;
    }

    const key = value === true ? DEFAULT_PROTECT : String(value).toLowerCase();

    const config = PROTECT_RPCS[key];

    if (!config) {
        throw new Error(
            "--protect inválido na " + CHAIN.name + ": " + value +
            " (opções: " + Object.keys(PROTECT_RPCS).join(", ") + ")."
        );
    }

    return { key, ...config };
}


async function rpcCall(
    url,
    method,
    params
) {

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });

    const text = await response.text();

    let json;

    try {

        json = JSON.parse(text);

    } catch (_) {

        throw new Error("Resposta inválida do RPC (HTTP " + response.status + "): " + text.slice(0, 200));
    }

    if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
    }

    return json.result;
}


// Verifica que o RPC privado responde antes de começar.
async function checkProtectRpc(protect) {

    try {

        const chainId = await rpcCall(protect.url, "eth_chainId", []);

        if (BigInt(chainId) !== CHAIN_ID) {
            throw new Error("chainId " + chainId);
        }

    } catch (error) {

        const others = Object.keys(PROTECT_RPCS).filter(k => k !== protect.key);

        throw new Error(
            protect.name + " não está a responder (" + error.message + ")." +
            (others.length > 0 ? " Experimenta --protect=" + others.join(" ou --protect=") + "." : "")
        );
    }
}


// Espera pela receipt no RPC normal (a transação não aparece no
// mempool público enquanto está pendente; só depois de incluída).
async function waitForPrivateReceipt(
    hash,
    protect,
    waitSeconds = PROTECT_WAIT_SECONDS
) {

    const startBlock = await provider.getBlockNumber();

    const startTime = Date.now();

    let lastBlock = startBlock;

    while (true) {

        const receipt = await provider.getTransactionReceipt(hash);

        if (receipt) {
            return receipt;
        }

        const current = await provider.getBlockNumber();

        if (current !== lastBlock) {

            lastBlock = current;

            const elapsed = Math.round((Date.now() - startTime) / 1000);

            process.stdout.write("  ... bloco " + current + " (+" + (current - startBlock) + " blocos, " + elapsed + "s)   \r");
        }

        if (Date.now() - startTime >= waitSeconds * 1000) {

            console.log("");

            throw new Error(
                "A transação privada não foi incluída em " + Math.round(waitSeconds / 60) + " minutos.\n" +
                "Hash: " + hash + "\n" +
                "Estado: " + protect.trackUrl(hash) + "\n" +
                "Não foi publicada no mempool público. Pode ainda ser incluída ou ser descartada;\n" +
                "confirma o estado antes de tentar de novo."
            );
        }

        await new Promise(resolve => setTimeout(resolve, PROTECT_POLL_MS));
    }
}


// Carteira de navegador (MetaMask, OKX, Rabby, ...): a própria carteira
// escolhe o nonce, assina e envia. O bot só sugere gas e fees e espera
// pela confirmação no RPC normal.
async function sendViaBrowserWallet(
    signer,
    account,
    request,
    label,
    feeLevel,
    hooks
) {

    const fees = await getFeeParams(feeLevel);

    const tx = {
        from: ethers.getAddress(account.address),
        to: request.to,
        data: request.data,
        value: ethers.toQuantity(request.value ?? 0n),
        gas: ethers.toQuantity(request.gasLimit),
        maxFeePerGas: ethers.toQuantity(fees.maxFeePerGas),
        maxPriorityFeePerGas: ethers.toQuantity(fees.priorityFee)
    };

    console.log("\n[" + label + "] a pedir confirmação a " + (signer.name || "carteira") + "...");

    if (hooks.onAwaitLedger) {
        hooks.onAwaitLedger();
    }

    const hash = await signer.sendTransaction(tx);

    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) {
        throw new Error("A carteira não devolveu um hash de transação válido.");
    }

    console.log("  Enviada pela carteira:", hash);

    if (hooks.onSent) {
        hooks.onSent(hash, CHAIN.explorer + "/tx/" + hash);
    }

    const waitMs = (hooks.waitSeconds || PROTECT_WAIT_SECONDS) * 1000;

    let receipt;

    try {

        receipt = await provider.waitForTransaction(hash, 1, waitMs);

    } catch (error) {

        if (error && error.code === "TIMEOUT") {
            throw new Error(
                "A transação não foi confirmada em " + Math.round(waitMs / 60000) + " minutos.\n" +
                "Hash: " + hash + "\n" +
                "Se a aceleraste ou cancelaste na carteira, o hash mudou: confirma o estado na carteira."
            );
        }

        throw error;
    }

    if (!receipt || receipt.status !== 1) {
        throw new Error("A transação falhou (revertida): " + hash);
    }

    return receipt;
}


// Constrói e assina uma transação EIP-1559 com nonce e fees dados, SEM a
// enviar (usado pelo envio normal e pelos bundles).
async function signPrepared(
    ledger,
    account,
    request,
    nonce,
    fees,
    label,
    hooks = {}
) {

    // Trezor e carteira importada assinam com signTransaction(tx, account).
    const external = !!(ledger && typeof ledger.signTransaction === "function");

    const deviceName = external ? (ledger.name || "carteira") : "Ledger";

    const tip = fees.priorityFee;

    const maxFeePerGas = fees.maxFeePerGas;

    const tx = ethers.Transaction.from({
        type: 2,
        chainId: CHAIN_ID,
        nonce,
        to: request.to,
        data: request.data,
        value: request.value ?? 0n,
        gasLimit: request.gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas: tip
    });

    const rawTxHex = tx.unsignedSerialized.slice(2);

    // Dá à Ledger informação para mostrar a transação de forma legível
    // (quando possível). Se falhar, a Ledger usa blind signing.
    let resolution = null;

    if (!external && ledger.ledgerService) {

        try {

            resolution = await ledger.ledgerService.resolveTransaction(
                rawTxHex,
                ledger.eth.loadConfig,
                { externalPlugins: true, erc20: true, nft: false }
            );

        } catch (_) {

            resolution = null;
        }
    }

    const maxCostETH = ethers.formatEther(request.gasLimit * maxFeePerGas);

    console.log("\n------------------------------------------------------------");
    console.log("[" + label + "]");
    console.log("  Para:           ", request.to);
    console.log("  Valor:          ", ethers.formatEther(request.value ?? 0n), NATIVE_SYMBOL);
    console.log("  Gas limit:      ", request.gasLimit.toString());
    console.log("  Fee:            ", fees.name, "| base " + formatGwei(fees.baseFee) + " + gorjeta " + formatGwei(fees.priorityFee));
    console.log("  Custo máx. gas: ", maxCostETH, NATIVE_SYMBOL);
    console.log("  Nonce:          ", nonce);
    if (ledger.kind !== "local") {
        console.log("\n  >>> Confirma a transação no ecrã da " + deviceName + " <<<");
    }

    if (external) {

        if (hooks.onAwaitLedger) {
            hooks.onAwaitLedger();
        }

        tx.signature = await ledger.signTransaction(tx, account);

    } else {

        let signature;

        try {

            if (hooks.onAwaitLedger) {
                hooks.onAwaitLedger();
            }

            signature = await ledger.eth.signTransaction(account.path, rawTxHex, resolution);

        } catch (error) {

            throw new Error(explainLedgerError(error));
        }

        tx.signature = ethers.Signature.from({
            r: "0x" + signature.r,
            s: "0x" + signature.s,
            v: 27 + ledgerVToParity(signature.v)
        });
    }

    // Verificação de segurança: a assinatura tem de ser desta carteira.
    if (lc(tx.from) !== lc(account.address)) {
        throw new Error(
            "A assinatura não corresponde ao endereço da " + deviceName + ". Transação NÃO enviada."
        );
    }

    return tx;
}


// Constrói, assina e envia uma transação EIP-1559.
// "ledger" é a Ledger ligada (linha de comandos e app) ou outro
// assinante da app: { kind: "trezor" | "local", signTransaction } (Trezor ou
// chave importada, cifrada neste computador) ou { kind: "browser", sendTransaction }.
async function signAndSend(
    ledger,
    account,
    request,
    label,
    feeLevel = DEFAULT_FEE_LEVEL,
    protect = null,
    hooks = {}
) {

    if (ledger && ledger.kind === "browser") {
        return sendViaBrowserWallet(ledger, account, request, label, feeLevel, hooks);
    }

    // Trezor e carteira importada assinam com signTransaction(tx, account).
    const external = !!(ledger && typeof ledger.signTransaction === "function");

    const deviceName = external ? (ledger.name || "carteira") : "Ledger";

    const [nonce, fees] = await Promise.all([
        provider.getTransactionCount(account.address, "pending"),
        getFeeParams(feeLevel)
    ]);

    const tx = await signPrepared(ledger, account, request, nonce, fees, label, hooks);

    let hash;

    let receipt;

    if (protect) {

        // Envio privado: só o RPC protegido recebe a transação.
        const returnedHash = await rpcCall(protect.url, "eth_sendRawTransaction", [tx.serialized]);

        hash = tx.hash;

        if (returnedHash && lc(returnedHash) !== lc(hash)) {
            console.log("  Aviso: o RPC devolveu um hash diferente (" + returnedHash + ").");
        }

        console.log("\n  Enviada em PRIVADO via " + protect.name + ":", hash);
        console.log("  Estado:    " + protect.trackUrl(hash));
        console.log("  " + CHAIN.explorerName + ": " + CHAIN.explorer + "/tx/" + hash + "  (só aparece depois de incluída)");
        console.log("  A aguardar inclusão num bloco...");

        if (hooks.onSent) {
            hooks.onSent(hash, protect.trackUrl(hash));
        }

        receipt = await waitForPrivateReceipt(hash, protect, hooks.waitSeconds || PROTECT_WAIT_SECONDS);

        console.log("");

    } else {

        const response = await provider.broadcastTransaction(tx.serialized);

        hash = response.hash;

        console.log("\n  Enviada:  ", hash);
        console.log("  " + CHAIN.explorerName + ": " + CHAIN.explorer + "/tx/" + hash);
        console.log("  A aguardar confirmação...");

        if (hooks.onSent) {
            hooks.onSent(hash, CHAIN.explorer + "/tx/" + hash);
        }

        receipt = await response.wait(1);
    }

    if (!receipt || receipt.status !== 1) {
        throw new Error("A transação falhou (revertida): " + hash);
    }

    const costETH = ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n));

    console.log(
        "  Confirmada no bloco " + receipt.blockNumber +
        " | gas usado " + receipt.gasUsed.toString() +
        " | custo " + costETH + " " + NATIVE_SYMBOL
    );

    return receipt;
}


async function estimateGasLimit(request) {

    const estimate = await provider.estimateGas({
        from: request.from,
        to: request.to,
        data: request.data,
        value: request.value ?? 0n
    });

    return (estimate * GAS_LIMIT_MARGIN_PERCENT) / 100n;
}


function revertReason(error) {
    return (
        error.reason ||
        error.shortMessage ||
        (error.info && error.info.error && error.info.error.message) ||
        error.message
    );
}


// ============================================================
// SWAP - SALDOS E APPROVALS
// ============================================================

async function getBalance(
    token,
    owner
) {

    if (isNative(token)) {
        return provider.getBalance(owner);
    }

    const contract = new ethers.Contract(token, ERC20_WRITE_ABI, provider);

    return contract.balanceOf(owner);
}


async function checkApprovals(
    ctx,
    owner
) {

    if (isNative(ctx.tokenIn)) {
        return { erc20Allowance: null, needsErc20: false, needsPermit2: false };
    }

    const token = new ethers.Contract(ctx.tokenIn, ERC20_WRITE_ABI, provider);

    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, provider);

    const [erc20Allowance, permit2Allowance] = await Promise.all([
        token.allowance(owner, PERMIT2),
        permit2.allowance(owner, ctx.tokenIn, UNIVERSAL_ROUTER)
    ]);

    // Margem de 5 minutos para a expiração da autorização Permit2.
    const minExpiration = BigInt(Math.floor(Date.now() / 1000) + 300);

    return {
        erc20Allowance,
        needsErc20: erc20Allowance < ctx.amountInRaw,
        needsPermit2:
            permit2Allowance.amount < ctx.amountInRaw ||
            BigInt(permit2Allowance.expiration) < minExpiration
    };
}


// ============================================================
// SWAP - CONSTRUÇÃO DA TRANSAÇÃO (Universal Router)
// ============================================================

// V3: suporta ETH nativo na entrada (WRAP_ETH) e na saída (UNWRAP_WETH).
function buildV3Swap(
    pool,
    ctx,
    amountOutMin
) {

    const nativeIn = isNative(ctx.tokenIn);

    const nativeOut = isNative(ctx.tokenOut);

    const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [ctx.tokenInV3, pool.fee, ctx.tokenOutV3]
    );

    const commands = [];

    const inputs = [];

    if (nativeIn) {

        commands.push(UR_COMMANDS.WRAP_ETH);

        inputs.push(abiCoder.encode(
            ["address", "uint256"],
            [ADDRESS_THIS, ctx.amountInRaw]
        ));
    }

    commands.push(UR_COMMANDS.V3_SWAP_EXACT_IN);

    inputs.push(abiCoder.encode(
        ["address", "uint256", "uint256", "bytes", "bool"],
        [
            nativeOut ? ADDRESS_THIS : MSG_SENDER,
            ctx.amountInRaw,
            amountOutMin,
            path,
            !nativeIn // payerIsUser: tokens pagos pela carteira via Permit2
        ]
    ));

    if (nativeOut) {

        commands.push(UR_COMMANDS.UNWRAP_WETH);

        inputs.push(abiCoder.encode(
            ["address", "uint256"],
            [MSG_SENDER, amountOutMin]
        ));
    }

    return {
        commands,
        inputs,
        value: nativeIn ? ctx.amountInRaw : 0n
    };
}


// V2: path [tokenIn, tokenOut]. O Universal Router mede o que a pair
// recebe e o que chega ao destinatário, por isso funciona com tokens
// que cobram taxa na transferência (o mínimo é verificado no saldo final).
function buildV2Swap(
    pool,
    ctx,
    amountOutMin
) {

    const nativeIn = isNative(ctx.tokenIn);

    const nativeOut = isNative(ctx.tokenOut);

    const commands = [];

    const inputs = [];

    if (nativeIn) {

        commands.push(UR_COMMANDS.WRAP_ETH);

        inputs.push(abiCoder.encode(
            ["address", "uint256"],
            [ADDRESS_THIS, ctx.amountInRaw]
        ));
    }

    commands.push(UR_COMMANDS.V2_SWAP_EXACT_IN);

    inputs.push(abiCoder.encode(
        ["address", "uint256", "uint256", "address[]", "bool"],
        [
            nativeOut ? ADDRESS_THIS : MSG_SENDER,
            ctx.amountInRaw,
            amountOutMin,
            [ctx.tokenInV3, ctx.tokenOutV3],
            !nativeIn // payerIsUser: tokens pagos pela carteira via Permit2
        ]
    ));

    if (nativeOut) {

        commands.push(UR_COMMANDS.UNWRAP_WETH);

        inputs.push(abiCoder.encode(
            ["address", "uint256"],
            [MSG_SENDER, amountOutMin]
        ));
    }

    return {
        commands,
        inputs,
        value: nativeIn ? ctx.amountInRaw : 0n
    };
}


// V4: SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL.
function buildV4Swap(
    pool,
    ctx,
    amountOutMin
) {

    const currencyIn = pool.zeroForOne ? pool.currency0 : pool.currency1;

    const currencyOut = pool.zeroForOne ? pool.currency1 : pool.currency0;

    // Segurança: no modo SWAP as moedas da pool têm de ser as pedidas.
    if (lc(currencyIn) !== ctx.tokenIn || lc(currencyOut) !== ctx.tokenOut) {
        throw new Error("As moedas da pool V4 não coincidem com TOKEN_IN/TOKEN_OUT.");
    }

    const poolKey = [
        pool.currency0,
        pool.currency1,
        pool.fee,
        pool.tickSpacing,
        pool.hooks
    ];

    const actions = ethers.solidityPacked(
        ["uint8", "uint8", "uint8"],
        [V4_ACTIONS.SWAP_EXACT_IN_SINGLE, V4_ACTIONS.SETTLE_ALL, V4_ACTIONS.TAKE_ALL]
    );

    const params = [
        abiCoder.encode(
            ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
            [[poolKey, pool.zeroForOne, ctx.amountInRaw, amountOutMin, "0x"]]
        ),
        abiCoder.encode(["address", "uint256"], [currencyIn, ctx.amountInRaw]),
        abiCoder.encode(["address", "uint256"], [currencyOut, amountOutMin])
    ];

    return {
        commands: [UR_COMMANDS.V4_SWAP],
        inputs: [abiCoder.encode(["bytes", "bytes[]"], [actions, params])],
        value: isNative(currencyIn) ? ctx.amountInRaw : 0n
    };
}


function buildSwapRequest(
    pool,
    ctx,
    amountOutMin,
    from,
    deadlineSeconds = DEADLINE_SECONDS
) {

    let built;

    if (pool.version === "V2") {
        built = buildV2Swap(pool, ctx, amountOutMin);
    } else if (pool.version === "V3") {
        built = buildV3Swap(pool, ctx, amountOutMin);
    } else {
        built = buildV4Swap(pool, ctx, amountOutMin);
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    const data = universalRouterInterface.encodeFunctionData("execute", [
        ethers.hexlify(Uint8Array.from(built.commands)),
        built.inputs,
        deadline
    ]);

    return {
        from,
        to: UNIVERSAL_ROUTER,
        data,
        value: built.value
    };
}


// ============================================================
// MODO SWAP
// ============================================================

async function runSwap(args) {

    const { positional, flags } = parseArgs(args);

    const [tokenInArg, tokenOutArg, amountArg] = positional;

    // "node topcatswap.js SWAP" sem argumentos → instruções do modo SWAP.
    if (positional.length === 0 || isHelpArg(positional[0])) {
        showSwapHelp();
        return;
    }

    if (!tokenInArg || !tokenOutArg || !amountArg) {

        showSwapHelp();

        throw new Error("O modo SWAP precisa de TOKEN_IN TOKEN_OUT AMOUNT_IN.");
    }

    const slippagePercent = flags.slippage !== undefined
        ? Number(flags.slippage)
        : DEFAULT_SLIPPAGE_PERCENT;

    if (
        !Number.isFinite(slippagePercent) ||
        slippagePercent < MIN_SLIPPAGE_PERCENT ||
        slippagePercent > MAX_SLIPPAGE_PERCENT
    ) {
        throw new Error(
            "--slippage inválido: usa um valor entre " + MIN_SLIPPAGE_PERCENT + " e " + MAX_SLIPPAGE_PERCENT + "."
        );
    }

    const feeLevel = parseFeeLevel(flags.fee);

    const protect = parseProtect(flags.protect);

    if (protect) {
        await checkProtectRpc(protect);
    }

    if ((await provider.getCode(UNIVERSAL_ROUTER)) === "0x") {
        throw new Error("Universal Router não encontrado em " + UNIVERSAL_ROUTER + ".");
    }

    // ========================================================
    // 1. ANÁLISE (igual ao modo POOL)
    // ========================================================

    const ctx = await buildContext(tokenInArg, tokenOutArg, amountArg, {
        exactV4: true,
        versions: parseVersions(flags.versions)
    });

    // Custos de gas na análise já com o nível de fee escolhido.
    const initialFees = await getFeeParams(feeLevel);

    ctx.gasPrice = initialFees.effectiveGasPrice;

    printHeader(ctx, "SWAP");

    console.log(
        "Fee: " + initialFees.name + " (" + initialFees.description + ") — " +
        "gas ~" + formatGwei(initialFees.effectiveGasPrice) + "\n"
    );

    const result = await analyzePools(ctx);

    printStats(result);

    const best = result.best;

    if (!best) {
        throw new Error("Nenhuma pool devolveu quote. Nada a executar.");
    }

    const slippageBps = BigInt(Math.round(slippagePercent * 100));

    const amountOutMin = (best.amountOutRaw * (10000n - slippageBps)) / 10000n;

    if (amountOutMin <= 0n) {
        throw new Error("Mínimo a receber é zero. Montante demasiado pequeno.");
    }

    // ========================================================
    // 2. LEDGER
    // ========================================================

    // Carteira importada (--wallet=NOME) ou Ledger.
    const imported = flags.wallet !== undefined && flags.wallet !== true;

    if (flags.wallet === true) {
        throw new Error("--wallet precisa do nome ou endereço da carteira importada (ex.: --wallet=Trading).");
    }

    const ledger = imported ? await openImported(flags.wallet) : await connectLedger();

    const deviceName = imported ? "carteira importada" : "Ledger";

    try {

        const account = imported ? ledger.account : await resolveLedgerAccount(ledger, flags);

        console.log(
            imported
                ? "Carteira (importada): " + ledger.name + "  " + account.address
                : "Carteira (Ledger): " + account.address + "   [m/" + account.path + "]"
        );

        // ====================================================
        // 3. SALDOS E APPROVALS
        // ====================================================

        const [ethBalance, balanceIn, balanceOut, approvals] = await Promise.all([
            provider.getBalance(account.address),
            getBalance(ctx.tokenIn, account.address),
            getBalance(ctx.tokenOut, account.address),
            checkApprovals(ctx, account.address)
        ]);

        if (balanceIn < ctx.amountInRaw) {
            throw new Error(
                "Saldo insuficiente: tens " +
                ethers.formatUnits(balanceIn, ctx.decimalsIn) + " " + ctx.symbolIn +
                ", precisas de " + ctx.amountIn + "."
            );
        }

        // Estimativa grosseira de gas para avisar antes do SIM.
        const plannedTxs =
            (approvals.needsErc20 ? 1 : 0) +
            (approvals.needsPermit2 ? 1 : 0);

        const roughGas =
            (best.gasEstimate !== null ? BigInt(best.gasEstimate) : 200000n) +
            150000n +
            BigInt(plannedTxs) * 70000n;

        const roughGasCost = ctx.gasPrice !== null ? roughGas * ctx.gasPrice : 0n;

        const ethNeeded = roughGasCost + (isNative(ctx.tokenIn) ? ctx.amountInRaw : 0n);

        // ====================================================
        // 4. RESUMO
        // ====================================================

        console.log("\n============================================================");
        console.log("RESUMO DO SWAP");
        console.log("============================================================");
        console.log("Carteira:                 ", account.address);
        console.log("Pool:                     ", best.version, "|", feeToString(best.fee));
        console.log(best.version === "V4" ? "Pool ID:                  " : "Endereço da pool:         ", best.id);

        if (best.version === "V2") {
            console.log("Nota V2:                   cotação calculada pelas reservas; se o token cobrar taxa");
            console.log("                           na transferência, o --slippage tem de ser superior à taxa.");
        }

        if (best.version === "V4" && lc(best.hooks) !== NATIVE_ETH) {
            console.log("Hooks:                    ", best.hooks, " (pool com hook)");
        }

        console.log("Vendes:                   ", ctx.amountIn, best.currencyInLabel);
        console.log("Recebes (estimado):       ", ethers.formatUnits(best.amountOutRaw, ctx.decimalsOut), best.currencyOutLabel);
        console.log("Mínimo garantido:         ", ethers.formatUnits(amountOutMin, ctx.decimalsOut), best.currencyOutLabel, "(slippage " + slippagePercent + "%)");

        if (slippagePercent > HIGH_SLIPPAGE_PERCENT) {
            console.log(
                "AVISO:                     slippage acima de " + HIGH_SLIPPAGE_PERCENT + "%: perda máxima elevada." +
                (protect ? "" : " Usa --protect.")
            );
        }

        if (best.amountOutUSD !== null) {
            console.log("Valor estimado:            $", formatUSD(best.amountOutUSD));
        }

        console.log("Router:                   ", UNIVERSAL_ROUTER, "(Uniswap Universal Router)");
        console.log("Fee:                      ", "--fee=" + feeLevel, initialFees.name, "(" + initialFees.description + ")");

        if (protect) {
            console.log("Proteção MEV:              ATIVA — envio privado via " + protect.name);
            console.log("                           prazo do swap " + (PROTECT_DEADLINE_SECONDS / 60) + " min, nova cotação antes de assinar");
        } else {
            console.log(
                DEFAULT_PROTECT
                    ? "Proteção MEV:              desligada — envio pelo mempool público (usa --protect)"
                    : "Proteção MEV:              não aplicável na " + CHAIN.name + " (sem mempool público)"
            );
        }
        console.log("Preço de gas:             ", "~" + formatGwei(initialFees.effectiveGasPrice), "(base " + formatGwei(initialFees.baseFee) + " + gorjeta " + formatGwei(initialFees.priorityFee) + ")");
        console.log("");
        console.log("Saldo " + ctx.symbolIn + ":", ethers.formatUnits(balanceIn, ctx.decimalsIn));
        console.log("Saldo " + ctx.symbolOut + ":", ethers.formatUnits(balanceOut, ctx.decimalsOut));
        console.log("Saldo " + NATIVE_SYMBOL + " (gas):", ethers.formatEther(ethBalance));

        if (ethBalance < ethNeeded) {
            console.log(
                "\nAVISO: o saldo de " + NATIVE_SYMBOL + " pode não chegar para o gas " +
                "(estimativa ~" + ethers.formatEther(roughGasCost) + " " + NATIVE_SYMBOL + ")."
            );
        }

        console.log("\nTransações a assinar na " + deviceName + ":");

        let step = 1;

        if (approvals.needsErc20) {
            console.log("  " + step++ + ". approve " + ctx.symbolIn + " → Permit2 (ilimitado, uma vez por token)");
        }

        if (approvals.needsPermit2) {
            console.log("  " + step++ + ". Permit2: autorizar o Universal Router a gastar " + ctx.amountIn + " " + ctx.symbolIn + " (expira em 1h)");
        }

        console.log("  " + step + ". swap no Universal Router");

        console.log(
            imported
                ? "\nCom a carteira importada, cada transação é assinada logo após o SIM (sem outra confirmação)."
                : "\nSe a Ledger recusar, ativa 'Blind signing' na app Ethereum → Settings."
        );
        console.log("============================================================");

        // ====================================================
        // 5. CONFIRMAÇÃO
        // ====================================================

        const answer = await askQuestion("\nEscreve SIM para executar (qualquer outra coisa cancela): ");

        if (answer.trim().toUpperCase() !== "SIM") {

            console.log("\nCancelado. NENHUMA TRANSACÇÃO FOI ASSINADA OU ENVIADA.\n");

            return;
        }

        // ====================================================
        // 6. APPROVALS
        // ====================================================

        if (approvals.needsErc20) {

            // USDT: tem de voltar a 0 antes de definir um novo valor.
            if (ctx.tokenIn === USDT && approvals.erc20Allowance > 0n) {

                const resetData = erc20Interface.encodeFunctionData("approve", [PERMIT2, 0n]);

                const resetRequest = { from: account.address, to: ctx.tokenIn, data: resetData, value: 0n };

                resetRequest.gasLimit = await estimateGasLimit(resetRequest);

                await signAndSend(ledger, account, resetRequest, "USDT: repor approve a 0", feeLevel, protect);
            }

            const data = erc20Interface.encodeFunctionData("approve", [PERMIT2, ethers.MaxUint256]);

            const request = { from: account.address, to: ctx.tokenIn, data, value: 0n };

            request.gasLimit = await estimateGasLimit(request);

            await signAndSend(ledger, account, request, "approve " + ctx.symbolIn + " → Permit2", feeLevel, protect);
        }

        if (approvals.needsPermit2) {

            const expiration = BigInt(Math.floor(Date.now() / 1000) + PERMIT2_EXPIRATION_SECONDS);

            const data = permit2Interface.encodeFunctionData("approve", [
                ctx.tokenIn,
                UNIVERSAL_ROUTER,
                ctx.amountInRaw,
                expiration
            ]);

            const request = { from: account.address, to: PERMIT2, data, value: 0n };

            request.gasLimit = await estimateGasLimit(request);

            await signAndSend(ledger, account, request, "Permit2 → Universal Router", feeLevel, protect);
        }

        // ====================================================
        // 7. SIMULAÇÃO + SWAP
        //
        // O mínimo garantido mantém-se o calculado no resumo:
        // se o preço piorou entretanto, a simulação falha e
        // nada é enviado.
        // ====================================================

        if (protect) {

            // Nova cotação: confirma que o preço não piorou desde o resumo.
            console.log("\nA confirmar a cotação antes do swap...");

            const previousOut = best.amountOutRaw;

            best.quoteOK = false;

            await quotePool(best, ctx);

            if (!best.quoteOK) {
                throw new Error("A nova cotação falhou; swap NÃO enviado. Motivo: " + best.quoteError);
            }

            console.log(
                "Cotação atual: " + ethers.formatUnits(best.amountOutRaw, ctx.decimalsOut) + " " + best.currencyOutLabel +
                "  (antes: " + ethers.formatUnits(previousOut, ctx.decimalsOut) + ")"
            );

            if (best.amountOutRaw < amountOutMin) {
                throw new Error(
                    "O preço piorou abaixo do mínimo garantido (" +
                    ethers.formatUnits(amountOutMin, ctx.decimalsOut) + " " + best.currencyOutLabel +
                    "). Swap NÃO enviado. As approvals feitas mantêm-se."
                );
            }
        }

        const swapRequest = buildSwapRequest(
            best,
            ctx,
            amountOutMin,
            account.address,
            protect ? PROTECT_DEADLINE_SECONDS : DEADLINE_SECONDS
        );

        console.log("\nA simular o swap on-chain...");

        try {

            swapRequest.gasLimit = await estimateGasLimit(swapRequest);

        } catch (error) {

            throw new Error(
                "A simulação do swap falhou; transação NÃO enviada.\n" +
                "Motivo: " + revertReason(error) + "\n" +
                "(Pode ser o preço ter mudado acima do slippage. As approvals feitas mantêm-se.)"
            );
        }

        console.log("Simulação OK.");

        await signAndSend(ledger, account, swapRequest, "SWAP " + ctx.amountIn + " " + ctx.symbolIn + " → " + ctx.symbolOut, feeLevel, protect);

        // ====================================================
        // 8. RESULTADO
        // ====================================================

        const [balanceInAfter, balanceOutAfter] = await Promise.all([
            getBalance(ctx.tokenIn, account.address),
            getBalance(ctx.tokenOut, account.address)
        ]);

        console.log("\n============================================================");
        console.log("SWAP CONCLUÍDO");
        console.log("============================================================");
        console.log("Saldo " + ctx.symbolIn + ":  ", ethers.formatUnits(balanceInAfter, ctx.decimalsIn));
        console.log("Saldo " + ctx.symbolOut + ":  ", ethers.formatUnits(balanceOutAfter, ctx.decimalsOut));

        if (!isNative(ctx.tokenOut)) {
            console.log("Recebido:       ", ethers.formatUnits(balanceOutAfter - balanceOut, ctx.decimalsOut), ctx.symbolOut);
        } else {
            console.log("(o saldo de " + NATIVE_SYMBOL + " já desconta o gas pago)");
        }

        console.log("============================================================\n");

    } finally {

        try {
            await ledger.transport.close();
        } catch (_) {}
    }
}


// ============================================================
// MODO WALLET
//
//   WALLET                 → endereços das primeiras contas
//   WALLET BALANCE         → saldo de ETH nessas contas
//   WALLET BALANCE TOKEN   → saldo do token nessas contas
// ============================================================

async function getLedgerWallets(
    ledger,
    count,
    start = 0
) {

    const wallets = [];

    for (let index = start; index < start + count; index++) {

        const path = ledgerLivePath(index);

        const address = await ledgerAddressAt(ledger, path);

        wallets.push({ index, path, address });
    }

    return wallets;
}


async function runWallet(args) {

    const { positional, flags } = parseArgs(args);

    if (positional.length > 0 && isHelpArg(positional[0])) {
        showWalletHelp();
        return;
    }

    const sub = positional[0] ? positional[0].toUpperCase() : null;

    if (sub === "IMPORT") {
        await importWalletCli();
        return;
    }

    if (sub === "REMOVE") {
        if (!positional[1]) throw new Error("Indica a carteira: node topcatswap.js WALLET REMOVE NOME");
        await removeWalletCli(positional.slice(1).join(" "));
        return;
    }

    if (sub === "IMPORTED" || (sub === null && flags.wallet !== undefined)) {

        const list = listImported();

        console.log("\n============================================================");
        console.log("CARTEIRAS IMPORTADAS (" + list.length + " de " + IMPORTED_MAX + ")");
        console.log("============================================================\n");

        if (list.length === 0) {
            console.log("Nenhuma. Importa com: node topcatswap.js WALLET IMPORT\n");
            return;
        }

        list.forEach((w, i) => console.log(i + "   " + w.address + "   " + w.label));

        console.log("\nNo modo SWAP usa --wallet=NOME (ou o endereço, ou o número).");
        console.log("Pasta: " + importedDir() + "\n");

        return;
    }

    // Aceita BALANCE e BALLANCE.
    if (sub !== null && sub !== "BALANCE" && sub !== "BALLANCE") {

        showWalletHelp();

        throw new Error("Subcomando WALLET desconhecido: " + positional[0]);
    }

    let token = NATIVE_ETH;

    if (sub !== null && positional[1]) {

        const tokenArg = resolveTokenArg(positional[1]);

        if (!ethers.isAddress(tokenArg)) {
            throw new Error(
                "Token inválido: " + positional[1] + " (usa " + Object.keys(TOKEN_ALIASES).join(", ") + " ou o endereço do contrato)."
            );
        }

        token = lc(tokenArg);
    }

    // Lê os dados do token antes de ligar à Ledger (falha mais cedo se o CA estiver errado).
    let tokenInfo = null;

    if (sub !== null) {

        try {

            tokenInfo = await getTokenInfo(token);

        } catch (error) {

            throw new Error(
                "Não consegui ler o token " + token + ". É um contrato ERC20 na Ethereum mainnet?"
            );
        }
    }

    let wallets;

    if (flags.wallet !== undefined) {

        // Saldos das carteiras importadas (os endereços não precisam de password).
        wallets = listImported().map((w, i) => ({ index: i, address: w.address, path: w.label }));

        if (wallets.length === 0) throw new Error("Não há carteiras importadas.");

    } else {

        // Endereços da Ledger
        const ledger = await connectLedger();

        try {

            wallets = await getLedgerWallets(ledger, WALLET_COUNT);

        } finally {

            try {
                await ledger.transport.close();
            } catch (_) {}
        }
    }

    // ========================================================
    // WALLET (só endereços)
    // ========================================================

    if (sub === null) {

        console.log("\n============================================================");
        console.log("CARTEIRAS DA LEDGER (caminhos Ledger Live)");
        console.log("============================================================\n");

        for (const wallet of wallets) {

            console.log("Índice " + wallet.index + "   " + wallet.address + "   m/" + wallet.path);
        }

        console.log("\nNo modo SWAP usa --index=N (ou --from=ENDEREÇO) para escolher a carteira.\n");

        return;
    }

    // ========================================================
    // WALLET BALANCE
    // ========================================================

    const balances = await Promise.all(
        wallets.map(wallet => getBalance(token, wallet.address))
    );

    let priceUSD = null;

    try {

        const ethUSD = await getETHPriceUSD();

        priceUSD = await getTokenPriceUSD(token, ethUSD);

    } catch (_) {

        priceUSD = null;
    }

    const label = isNative(token) ? NATIVE_SYMBOL + " (gas token)" : tokenInfo.symbol;

    console.log("\n============================================================");
    console.log("SALDOS: " + label);

    if (!isNative(token)) {
        console.log("Token:  " + ethers.getAddress(token));
    }

    console.log("============================================================\n");

    let total = 0n;

    for (let i = 0; i < wallets.length; i++) {

        const amount = Number(ethers.formatUnits(balances[i], tokenInfo.decimals));

        total += balances[i];

        console.log(
            "Índice " + wallets[i].index + "   " +
            wallets[i].address + "   " +
            ethers.formatUnits(balances[i], tokenInfo.decimals) + " " + tokenInfo.symbol +
            (validNumber(priceUSD) ? "   ($" + formatUSD(amount * priceUSD) + ")" : "")
        );
    }

    const totalAmount = Number(ethers.formatUnits(total, tokenInfo.decimals));

    console.log(
        "\nTOTAL:     " +
        ethers.formatUnits(total, tokenInfo.decimals) + " " + tokenInfo.symbol +
        (validNumber(priceUSD) ? "   ($" + formatUSD(totalAmount * priceUSD) + ")" : "")
    );

    if (!validNumber(priceUSD)) {
        console.log("(sem preço USD on-chain para este token)");
    }

    console.log("");
}


// ============================================================
// MAIN
// ============================================================

async function main() {

    // --chain pode aparecer em qualquer posição.
    const chainArg = process.argv.find(arg => arg.toLowerCase().startsWith("--chain"));

    const chainValue = chainArg
        ? (chainArg.includes("=") ? chainArg.slice(chainArg.indexOf("=") + 1) : true)
        : undefined;

    const argv = process.argv.filter(arg => arg !== chainArg);

    const mode = argv[2];

    const args = argv.slice(3);

    if (mode && ["--VERSION", "-V", "VERSION"].includes(mode.toUpperCase())) {
        console.log("topcatswap " + TOPCATSWAP_VERSION);
        return;
    }

    // Rede por omissão para a ajuda; a escolhida é validada a seguir.
    applyChain(CHAINS[DEFAULT_CHAIN]);

    if (!mode) {
        showHelp();
        return;
    }

    if (chainValue !== undefined) {
        applyChain(findChain(chainValue));
    }

    const upperMode = mode.toUpperCase();

    const wantsHelp = args.length === 0 || ["HELP", "-H", "--HELP", "AJUDA"].includes(String(args[0]).toUpperCase());

    // Só verifica o RPC quando o modo vai realmente usar a rede.
    const offline = upperMode === "WALLET" && args[0] && ["IMPORT", "IMPORTED", "REMOVE"].includes(String(args[0]).toUpperCase());

    if (!offline && !(wantsHelp && (upperMode === "POOL" || upperMode === "POOLS" || upperMode === "SWAP" || upperMode === "WALLET"))) {
        await checkChainRpc();
    }

    const upper = mode.toUpperCase();

    if (upper === "POOL" || upper === "POOLS") {
        await runPool(args);
        return;
    }

    if (upper === "SWAP") {
        await runSwap(args);
        return;
    }

    if (upper === "WALLET") {
        await runWallet(args);
        return;
    }

    showHelp();
}


// ============================================================
// START
// ============================================================

// Executado diretamente (node topcatswap.js): modo de linha de comandos.
// Carregado com require(): só exporta o motor (usado pela app gráfica).
if (require.main === module) {

    main()
        .then(() => process.exit(0))
        .catch(error => {

            console.error("\nERRO:", error.shortMessage || error.message);

            process.exit(1);
        });

} else {

    module.exports = {
        CHAINS,
        DEFAULT_CHAIN,
        NATIVE_ETH,
        USDT,
        MIN_SLIPPAGE_PERCENT,
        MAX_SLIPPAGE_PERCENT,
        HIGH_SLIPPAGE_PERCENT,
        DEADLINE_SECONDS,
        PROTECT_DEADLINE_SECONDS,
        PERMIT2_EXPIRATION_SECONDS,
        FEE_LEVELS,
        WALLET_COUNT,
        erc20Interface,
        permit2Interface,
        findChain,
        applyChain,
        checkChainRpc,
        resolveTokenArg,
        buildContext,
        analyzePools,
        quotePool,
        getTokenInfo,
        getETHPriceUSD,
        getTokenPriceUSD,
        getFeeParams,
        parseProtect,
        checkProtectRpc,
        rpcCall,
        loadLedgerLibs,
        connectLedger,
        resolveLedgerAccount,
        getLedgerWallets,
        getBalance,
        checkApprovals,
        estimateGasLimit,
        buildSwapRequest,
        signAndSend,
        signPrepared,
        revertReason,
        isNative,
        isDynamicFee,
        lc,
        validNumber,
        formatUSD,
        // Valores que mudam com a rede ativa (lidos no momento).
        getState: () => ({
            CHAIN,
            CHAIN_ID,
            UNIVERSAL_ROUTER,
            PERMIT2,
            NATIVE_SYMBOL,
            WRAPPED_SYMBOL,
            TOKEN_ALIASES,
            DEFAULT_PROTECT,
            PROTECT_RPCS,
            WETH,
            USDC,
            provider
        })
    };
}
