// ============================================================
// TopCatSwap Web — substitutos dos módulos do Node no navegador
//
// O motor (desktop/engine) foi escrito para Node/Electron. No navegador:
//   - "fs" é um sistema de ficheiros virtual guardado no localStorage
//     deste site (só neste navegador; nada vai para nenhum servidor);
//   - "path" e "os" são versões mínimas;
//   - "readline", "http" e "crypto" (só usados pela linha de comandos e
//     pela ponte local da app de secretária) não existem aqui.
// ============================================================

/* global window */

(function (root) {

    "use strict";

    const PREFIX = "tcs-fs:";

    // ---- process ----------------------------------------------------------

    const env = {};

    root.process = root.process || {
        env,
        argv: [],
        platform: "browser",
        versions: {},
        stdout: { write() { return true; } },
        stdin: null,
        exit() {},
        on() {}
    };

    // ---- path -------------------------------------------------------------

    function normalize(p) {
        const abs = String(p).startsWith("/");
        const out = [];
        for (const part of String(p).split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") out.pop(); else out.push(part);
        }
        return (abs ? "/" : "") + out.join("/");
    }

    const path = {
        sep: "/",
        join: (...parts) => normalize(parts.filter(x => x !== undefined && x !== null && x !== "").join("/")),
        resolve: (...parts) => normalize("/" + parts.join("/")),
        dirname: (p) => { const n = normalize(p); const i = n.lastIndexOf("/"); return i <= 0 ? "/" : n.slice(0, i); },
        basename: (p, ext) => { let b = normalize(p).split("/").pop() || ""; if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; },
        extname: (p) => { const b = normalize(p).split("/").pop() || ""; const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; }
    };

    // ---- fs (virtual, localStorage) ---------------------------------------

    function storage() {
        try { return root.localStorage; } catch (_) { return null; }
    }

    const memory = new Map();   // reserva se o localStorage estiver bloqueado

    function getItem(k) {
        const s = storage();
        if (s) { try { return s.getItem(k); } catch (_) {} }
        return memory.has(k) ? memory.get(k) : null;
    }

    function setItem(k, v) {
        const s = storage();
        if (s) { try { s.setItem(k, v); return; } catch (_) {} }
        memory.set(k, v);
    }

    function removeItem(k) {
        const s = storage();
        if (s) { try { s.removeItem(k); } catch (_) {} }
        memory.delete(k);
    }

    function allKeys() {
        const keys = new Set(memory.keys());
        const s = storage();
        if (s) {
            try { for (let i = 0; i < s.length; i++) keys.add(s.key(i)); } catch (_) {}
        }
        return [...keys].filter(k => k && k.startsWith(PREFIX));
    }

    function enoent(p) {
        const e = new Error("ENOENT: no such file or directory, '" + p + "'");
        e.code = "ENOENT";
        return e;
    }

    const fs = {
        existsSync(p) {
            const n = normalize(p);
            if (getItem(PREFIX + n) !== null) return true;
            return allKeys().some(k => k.startsWith(PREFIX + n + "/")) || getItem(PREFIX + n + "/") !== null;
        },
        readFileSync(p) {
            const v = getItem(PREFIX + normalize(p));
            if (v === null) throw enoent(p);
            return v;
        },
        writeFileSync(p, data) {
            setItem(PREFIX + normalize(p), typeof data === "string" ? data : String(data));
        },
        appendFileSync(p, data) {
            const k = PREFIX + normalize(p);
            setItem(k, (getItem(k) || "") + String(data));
        },
        renameSync(a, b) {
            const v = fs.readFileSync(a);
            setItem(PREFIX + normalize(b), v);
            removeItem(PREFIX + normalize(a));
        },
        unlinkSync(p) {
            const k = PREFIX + normalize(p);
            if (getItem(k) === null) throw enoent(p);
            removeItem(k);
        },
        mkdirSync(p) {
            setItem(PREFIX + normalize(p) + "/", "");
        },
        chmodSync() {},
        readdirSync(p) {
            const base = PREFIX + normalize(p) + "/";
            const names = new Set();
            for (const k of allKeys()) {
                if (k.startsWith(base) && k.length > base.length) names.add(k.slice(base.length).split("/")[0]);
            }
            return [...names].filter(Boolean).sort();
        }
    };

    // ---- os ---------------------------------------------------------------

    const os = { homedir: () => "/web", platform: () => "browser", tmpdir: () => "/tmp" };

    // ---- módulos que só existem no Node -----------------------------------

    function unavailable(name) {
        return new Proxy({}, {
            get(_, prop) {
                if (prop === "__esModule" || prop === "then") return undefined;
                return () => { throw new Error(name + " não está disponível no navegador / is not available in the browser."); };
            }
        });
    }

    root.__TCS_NODE = {
        fs,
        path,
        os,
        readline: unavailable("readline"),
        http: unavailable("http"),
        crypto: unavailable("crypto"),
        storage: { getItem, setItem, removeItem, allKeys, PREFIX }
    };

})(typeof window !== "undefined" ? window : globalThis);
