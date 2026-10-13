"""Minimal JS scanner: finds string literal pieces (quotes + template static chunks)
and comments. Returns list of dicts {start,end,kind,text} with offsets of the
content (without quotes)."""
import re

REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
KEYWORDS_BEFORE_REGEX = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"}

def scan(src):
    out = []
    i = 0
    n = len(src)
    last_sig = ""   # last significant char/token
    last_word = ""
    stack = []      # for template nesting: count of braces inside ${ }
    def scan_code(i, end_on_brace=False):
        nonlocal last_sig, last_word
        depth = 0
        while i < n:
            c = src[i]
            if c in " \t\r\n":
                i += 1; continue
            if src.startswith("//", i):
                j = src.find("\n", i)
                j = n if j < 0 else j
                out.append({"start": i + 2, "end": j, "kind": "line-comment", "text": src[i+2:j]})
                i = j; continue
            if src.startswith("/*", i):
                j = src.find("*/", i + 2)
                out.append({"start": i + 2, "end": j, "kind": "block-comment", "text": src[i+2:j]})
                i = j + 2; continue
            if c in "'\"":
                j = i + 1
                while src[j] != c:
                    if src[j] == "\\": j += 2
                    else: j += 1
                out.append({"start": i + 1, "end": j, "kind": "str", "q": c, "text": src[i+1:j]})
                i = j + 1; last_sig = "a"; last_word = ""; continue
            if c == "`":
                i = scan_template(i + 1)
                last_sig = "a"; last_word = ""; continue
            if c == "/":
                if last_sig == "" or last_sig in REGEX_PREV or last_word in KEYWORDS_BEFORE_REGEX:
                    # regex literal
                    j = i + 1; in_class = False
                    while True:
                        ch = src[j]
                        if ch == "\\": j += 2; continue
                        if ch == "[": in_class = True
                        elif ch == "]": in_class = False
                        elif ch == "/" and not in_class: break
                        j += 1
                    j += 1
                    while j < n and src[j].isalpha(): j += 1
                    i = j; last_sig = "a"; last_word = ""; continue
                last_sig = "/"; last_word = ""; i += 1; continue
            if c == "{":
                depth += 1
            elif c == "}":
                if end_on_brace and depth == 0:
                    return i + 1
                depth -= 1
            m = re.match(r"[A-Za-z_$][\w$]*", src[i:i+60])
            if m:
                last_word = m.group(0); last_sig = "a"; i += len(last_word); continue
            if c.isdigit():
                m = re.match(r"[0-9a-fA-FxXn_.eE]+", src[i:])
                i += len(m.group(0)); last_sig = "a"; last_word = ""; continue
            if c in ")]":
                last_sig = "a"
            else:
                last_sig = c
            last_word = ""
            i += 1
        return i
    def scan_template(i):
        start = i
        while True:
            c = src[i]
            if c == "\\": i += 2; continue
            if c == "`":
                out.append({"start": start, "end": i, "kind": "tpl", "text": src[start:i]})
                return i + 1
            if c == "$" and src[i+1] == "{":
                out.append({"start": start, "end": i, "kind": "tpl", "text": src[start:i]})
                i = scan_code(i + 2, end_on_brace=True)
                start = i
                continue
            i += 1
    scan_code(0)
    return out

PT = re.compile(r"[áàâãçéêíóôõúÁÀÂÃÇÉÊÍÓÔÕÚ]|\b(?:que|não|nao|para|com|uma|das|dos|nas|nos|carteira|rede|saldo|montante|escolhe|liga|abre|usa|mostra|tenta|faz|está|esta|vendes|recebes|ligada|desbloqueia|Escolhe|Liga|Abre|Usa|Faz|Tenta|Rede|Saldo|Carteira|Cancelar|Voltar|Guardar|Definições|Ler|Copiar|Mudar|Importar|Remover|Usar|Desbloquear|Bloquear|aprovar|Aprovar|Envio|Prazo|Velocidade|Normal|Rápido|ou|em|de|do|da|e|o|a|os|as)\b")

def is_pt(text):
    t = re.sub(r"<[^>]*>", " ", text)
    t = re.sub(r"\\[nt]", " ", t)
    if not re.search(r"[A-Za-zÀ-ú]{2,}", t):
        return False
    return bool(PT.search(t))
