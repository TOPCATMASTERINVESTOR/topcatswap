import re, jsscan, json, sys
BASE = "../topcatswap-app/"
FILES = ["engine/topcatswap.js", "engine/gui-engine.js", "engine/keystore.js", "engine/trezor.js",
         "engine/wallet-bridge.js", "engine/connect/connect.js", "renderer/app.js", "main.js", "engine/gui-bundles.js", "engine/bundles.js"]
ATTR = re.compile(r'((?:aria-label|placeholder|title|alt)=")([^"<>]*)(")')

def segments(text):
    """Yield (start,end) spans of translatable text inside a literal piece."""
    if "<" not in text and not ATTR.search(text):
        yield (0, len(text)); return
    for m in ATTR.finditer(text):
        yield (m.start(2), m.end(2))
    # text nodes between tags (also before first tag / after last tag)
    for m in re.finditer(r"(?:^|>)([^<>]+)(?=<|$)", text):
        yield (m.start(1), m.end(1))

def core(seg):
    """Strip surrounding whitespace / escaped newlines; return (lead, core, trail)."""
    m = re.match(r"^((?:\s|\\n)*)(.*?)((?:\s|\\n)*)$", seg, re.S)
    return m.group(1), m.group(2), m.group(3)

def collect(files=FILES):
    units = {}
    for f in files:
        src = open(BASE + f).read()
        for it in jsscan.scan(src):
            if it["kind"] not in ("str", "tpl"): continue
            for a, b in segments(it["text"]):
                lead, c, trail = core(it["text"][a:b])
                if c and jsscan.is_pt(c):
                    units.setdefault(c, set()).add(f)
    return units

if __name__ == "__main__":
    u = collect()
    print(len(u))
    json.dump({k: sorted(v) for k, v in u.items()}, open("units.json", "w"), ensure_ascii=False, indent=0)
