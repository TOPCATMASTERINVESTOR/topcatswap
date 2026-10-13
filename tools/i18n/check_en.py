import json, re, sys, os, jsscan, units
d = json.load(open("dict_en.json"))
order = json.load(open("order.json")); missed = json.load(open("missed.json"))
tok = lambda s: set(w.lower() for w in re.findall(r"[A-Za-zÀ-ú]{3,}", re.sub(r"<[^>]*>", " ", s)))
pt_words = set()
for f, c in order + missed: pt_words |= tok(c)
en_words = set()
for v in d.values(): en_words |= tok(v)
# also common English/code words
en_words |= tok(open(os.path.join(sys.argv[1], "engine/topcatswap.en.js")).read().split("// ===")[0])
pt_only = {w for w in pt_words - en_words if re.search(r"[à-ú]", w) or len(w) > 3}
skipw = {"ethereum","arbitrum","ledger","trezor","metamask","rabby","coinbase","uniswap","permit","router","universal","mempool","flashbots","pancakeswap","merkle","subgraph","pulsechain","robinhood","slippage","approve","approvals","password","passphrase","hook","hooks","quote","wallet","swap","pools","pool","token","tokens","sandwich","frontrun","gas","index","legacy","ledgerhq","node","topcatswap","electron","https","http","json","true","false"}
pt_only -= skipw
for f in sys.argv[2:]:
    src = open(os.path.join(sys.argv[1], f)).read()
    hits = []
    for it in jsscan.scan(src):
        if it["kind"] not in ("str", "tpl"): continue
        for a, b in units.segments(it["text"]):
            l, c, t = units.core(it["text"][a:b])
            if not c: continue
            bad = tok(c) & pt_only
            if bad or re.search(r"[ãõçáéíóúâêô]", c):
                hits.append((c, sorted(bad)))
    print(f, len(hits))
    for c, b in hits: print("   ", b, "::", c[:150])
