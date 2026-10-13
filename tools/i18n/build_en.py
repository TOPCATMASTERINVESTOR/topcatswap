import json, re, sys, os
import jsscan, units
from patches_en import PATCHES

order = json.load(open("order.json"))
missed = json.load(open("missed.json"))

def load_dict():
    d = {}
    for fn in ("en1.tsv", "en2.tsv", "en3.tsv", "en4.tsv"):
        for line in open(fn, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line.strip(): continue
            k, v = line.split("\t", 1)
            if k.startswith("="): src = k[1:]
            else: src = missed[int(k[1:])][1] if k.startswith("m") else order[int(k)][1]
            d[src] = v
    return d

def escape_for(text, kind, q):
    out = []
    i = 0
    while i < len(text):
        c = text[i]
        if c == "\\":
            out.append(text[i:i+2]); i += 2; continue
        if kind == "str" and c == q:
            out.append("\\" + c)
        elif kind == "tpl" and (c == "`" or (c == "$" and text[i+1:i+2] == "{")):
            out.append("\\" + c)
        else:
            out.append(c)
        i += 1
    return "".join(out)

def translate_source(path, src, d):
    for old, new in PATCHES.get(path, []):
        if old not in src:
            raise SystemExit("patch not found in " + path + ": " + old[:80])
        src = src.replace(old, new)
    reps = []
    for it in jsscan.scan(src):
        if it["kind"] not in ("str", "tpl"): continue
        for a, b in units.segments(it["text"]):
            seg = it["text"][a:b]
            lead, core, trail = units.core(seg)
            if core in d:
                s = it["start"] + a + len(lead)
                reps.append((s, s + len(core), escape_for(d[core], it["kind"], it.get("q"))))
    reps.sort(key=lambda r: r[0], reverse=True)
    last = None
    for s, e, new in reps:
        if last is not None and e > last: continue   # overlapping (shouldn't happen)
        src = src[:s] + new + src[e:]
        last = s
    return src, len(reps)

def leftovers(src):
    left = []
    for it in jsscan.scan(src):
        if it["kind"] not in ("str", "tpl"): continue
        for a, b in units.segments(it["text"]):
            l, c, t = units.core(it["text"][a:b])
            if c and jsscan.is_pt(c): left.append(c)
    return left

if __name__ == "__main__":
    base = sys.argv[1]
    d = load_dict()
    json.dump(d, open("dict_en.json", "w"), ensure_ascii=False, indent=0)
    targets = {
        "engine/topcatswap.js": "engine/topcatswap.en.js",
        "engine/gui-engine.js": "engine/gui-engine.en.js",
        "engine/keystore.js": "engine/keystore.en.js",
        "engine/trezor.js": "engine/trezor.en.js",
        "engine/wallet-bridge.js": "engine/wallet-bridge.en.js",
        "engine/connect/connect.js": "engine/connect/connect.en.js",
        "renderer/app.js": "renderer/app.en.js",
        "engine/gui-bundles.js": "engine/gui-bundles.en.js",
        "engine/bundles.js": "engine/bundles.en.js",
    }
    for srcp, dstp in targets.items():
        src = open(os.path.join(base, srcp), encoding="utf-8").read()
        out, n = translate_source(srcp, src, d)
        open(os.path.join(base, dstp), "w", encoding="utf-8").write(out)
        left = [x for x in leftovers(out) if x not in ("os",)]
        print(f"{dstp}: {n} replacements, {len(left)} PT-looking left")
        for x in left[:40]: print("    LEFT:", x)
