import re, sys, os, jsscan, units
PTW = set("""não nao para uma umas uns com das dos nas nos pela pelo pelas pelos sem mais menos foi ser está estão esta este isto essa esse aqui ali já ainda só também então porque quando onde qual quais você tens tem teu tua teus tuas seu sua carteira carteiras rede redes saldo saldos montante ligar ligada ligado desbloqueia desbloquear bloquear escolhe escolher abre abrir usa usar mostra mostrar tenta faz fazer vendes recebes envio enviado enviada nada assinar assinatura assinado aprovar aprovado definições guardar cancelar voltar ler copiar mudar importar remover chave conta contas página ecrã navegador extensão pedido prazo velocidade rápido moeda token­s erro aviso nota valor preço taxa cotação análise ligação ligações desligada mantém confirma confirmar escreve repete ficheiro pasta apagado apagar sim de do da em ao à às os as e o a um ou que se""".split())
for f in sys.argv[2:]:
    src = open(os.path.join(sys.argv[1], f)).read()
    for it in jsscan.scan(src):
        if it["kind"] not in ("str", "tpl"): continue
        for a, b in units.segments(it["text"]):
            l, c, t = units.core(it["text"][a:b])
            if not c: continue
            words = re.findall(r"[a-zà-ú]+", re.sub(r"<[^>]*>", " ", c).lower())
            hits = [w for w in words if w in PTW and w not in ("a","e","o","as","se","de","do","em","ao","um","os","sim","que","ou","nota","valor","token","ler")]
            if re.search(r"[ãõçáéíóúâêôà]", c) or hits:
                print(f.split("/")[-1], hits, "::", c[:140])
