// ============================================================
// TopCatSwap — carteiras importadas por chave privada
//
// Até 5 carteiras. Cada uma fica cifrada com a SUA password no
// formato keystore padrão da Ethereum (scrypt + AES-128-CTR, o mesmo
// do MetaMask/Geth), em ~/.config/TopCatSwap/wallets/<endereço>.json,
// só legível pelo próprio utilizador.
//
// A chave privada em claro só existe na memória do processo principal
// enquanto a carteira está desbloqueada; nunca é gravada nem enviada
// à janela.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");


const MAX_WALLETS = 5;
const MIN_PASSWORD = 8;
const AUTO_LOCK_MS = 30 * 60 * 1000;   // bloqueia após 30 min sem uso

let dir = null;
let unlocked = null;                   // { address, label, wallet }
let lockTimer = null;
let onLock = null;


function setDir(d) {
    dir = d;
}

function setLockListener(fn) {
    onLock = fn;
}

function ensureDir() {
    if (!dir) throw new Error("Wallets folder not configured.");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
}

function fileOf(address) {
    return path.join(dir, ethers.getAddress(address).toLowerCase() + ".json");
}

function readEntry(file) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !ethers.isAddress(data.address) || typeof data.keystore !== "string") {
        throw new Error("invalid file");
    }
    return data;
}


function list() {

    if (!dir || !fs.existsSync(dir)) return [];

    const out = [];

    for (const name of fs.readdirSync(dir)) {
        if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
        try {
            const e = readEntry(path.join(dir, name));
            out.push({
                address: ethers.getAddress(e.address),
                label: e.label || "Imported wallet",
                createdAt: e.createdAt || null,
                unlocked: !!unlocked && unlocked.address === ethers.getAddress(e.address)
            });
        } catch (_) {}
    }

    out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    return out;
}


function normalizeKey(input) {

    let k = String(input || "").trim().replace(/\s+/g, "");

    if (/^[0-9a-fA-F]{64}$/.test(k)) k = "0x" + k;

    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
        throw new Error("Invalid private key: it must have 64 hexadecimal characters (with or without 0x).");
    }

    if (/^0x0{64}$/.test(k)) throw new Error("Invalid private key.");

    return k;
}


function checkPassword(password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
        throw new Error("The password must have at least " + MIN_PASSWORD + " characters.");
    }
}


function touch() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => lock("inatividade"), AUTO_LOCK_MS);
}


async function importKey({ privateKey, password, label }) {

    ensureDir();

    const key = normalizeKey(privateKey);

    checkPassword(password);

    let wallet;

    try {
        wallet = new ethers.Wallet(key);
    } catch (_) {
        throw new Error("Invalid private key.");
    }

    const address = wallet.address;

    if (fs.existsSync(fileOf(address))) {
        throw new Error("This wallet (" + address + ") is already imported.");
    }

    if (list().length >= MAX_WALLETS) {
        throw new Error("You already have " + MAX_WALLETS + " imported wallets. Remove one in Settings before importing another.");
    }

    const keystore = await wallet.encrypt(password);

    const entry = {
        version: 1,
        address,
        label: String(label || "").trim().slice(0, 40) || "Imported wallet",
        createdAt: new Date().toISOString(),
        keystore
    };

    const file = fileOf(address);
    const tmp = file + ".tmp";

    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);

    // Fica desbloqueada logo a seguir à importação.
    unlocked = { address, label: entry.label, wallet };
    touch();

    return { address, label: entry.label };
}


async function unlock(address, password) {

    ensureDir();

    const addr = ethers.getAddress(address);
    const file = fileOf(addr);

    if (!fs.existsSync(file)) throw new Error("This imported wallet no longer exists.");

    const entry = readEntry(file);

    let wallet;

    try {
        wallet = await ethers.Wallet.fromEncryptedJson(entry.keystore, String(password || ""));
    } catch (error) {
        if (/password|invalid/i.test(String(error && error.message))) {
            throw new Error("Wrong password.");
        }
        throw new Error("Could not open the wallet: " + (error && error.message));
    }

    if (wallet.address !== addr) {
        throw new Error("The wallet file does not match the address. Nothing was unlocked.");
    }

    unlocked = { address: addr, label: entry.label || "Imported wallet", wallet };
    touch();

    return { address: addr, label: unlocked.label };
}


// Abre outra carteira importada só para assinar um bundle (várias carteiras).
// Não muda a carteira ativa; quem chama guarda a chave só enquanto precisa.
async function decrypt(address, password) {

    ensureDir();

    const addr = ethers.getAddress(address);

    if (unlocked && unlocked.address === addr) return unlocked.wallet;

    const file = fileOf(addr);

    if (!fs.existsSync(file)) throw new Error("This imported wallet no longer exists.");

    const entry = readEntry(file);

    let wallet;

    try {
        wallet = await ethers.Wallet.fromEncryptedJson(entry.keystore, String(password || ""));
    } catch (error) {
        if (/password|invalid/i.test(String(error && error.message))) throw new Error("Wrong password.");
        throw new Error("Could not open the wallet: " + (error && error.message));
    }

    if (wallet.address !== addr) throw new Error("The wallet file does not match the address. Nothing was unlocked.");

    return wallet;
}


function unlockedWallet() {
    return unlocked ? unlocked.wallet : null;
}


function lock(reason) {
    const was = unlocked;
    unlocked = null;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = null;
    if (was && onLock) {
        try { onLock({ address: was.address, reason: reason || "manual" }); } catch (_) {}
    }
    return true;
}


function remove(address) {

    ensureDir();

    const addr = ethers.getAddress(address);

    if (unlocked && unlocked.address === addr) lock("removida");

    const file = fileOf(addr);

    if (fs.existsSync(file)) fs.unlinkSync(file);

    return true;
}


function unlockedAddress() {
    return unlocked ? unlocked.address : null;
}


function signer() {

    return {
        kind: "local",
        name: unlocked ? unlocked.label : "imported wallet",
        async signTransaction(tx, account) {
            if (!unlocked || unlocked.address !== ethers.getAddress(account.address)) {
                throw new Error("The imported wallet is locked. Unlock it with the password and try again.");
            }
            touch();
            return unlocked.wallet.signingKey.sign(tx.unsignedHash);
        }
    };
}


module.exports = {
    MAX_WALLETS,
    MIN_PASSWORD,
    setDir,
    setLockListener,
    list,
    importKey,
    unlock,
    lock,
    remove,
    unlockedAddress,
    unlockedWallet,
    decrypt,
    signer,
    touch
};
