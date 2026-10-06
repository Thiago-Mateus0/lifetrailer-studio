#!/usr/bin/env python3
"""Índice único de tudo que está em aberto.

Pendência mora em três lugares, e cada um é a casa certa: decorrência de ADR
precisa do contexto que só existe no ADR; D-A/D-B/D-C vivem no documento que vai
para o Wyll; os itens numerados nascem em pendencias.md. O problema nunca foi ter
três fontes — foi não ter uma visão.

Este script é a visão. **Não escreve arquivo**: imprime. Índice guardado é índice
que drifa, e nada aqui é fonte da verdade — para alterar um item, altere a fonte.

Convenção de fechamento: item riscado (~~assim~~) na fonte some do índice.
Append-only continua valendo — nada é apagado, só riscado.

Uso:
    python3 scripts/gerar-pendencias.py            # índice completo
    python3 scripts/gerar-pendencias.py --abertas  # só o que bloqueia alguma fase
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
RISCADO = re.compile(r"~~.*?~~")
LINHA = re.compile(r"^\|(?!\s*-)(.+)\|\s*$")
DECORRENCIA_ID = re.compile(r"^0*(\d+)\.(\d+)$")

# Ordem de exibição, e o que cada rótulo significa
FASES = ["Fase 3", "Fase 4", "Go-live", "Não bloqueia"]


def _celulas(linha):
    return [c.strip() for c in linha.strip().strip("|").split("|")]


def _fechado(celulas):
    """Riscado em qualquer célula, ou ✅ no estado: item encerrado."""
    return any(RISCADO.search(c) for c in celulas) or any("✅" in c for c in celulas)


def _id_decorrencia(celula):
    """Id de decorrência sem enfeite de markdown.

    `decorrencias_fechadas` já normalizava dos dois lados; `de_adrs` comparava a
    célula crua. Negritar o id dentro do ADR 0011 bastava pra `**5**` deixar de
    casar com `5`: a decorrência reaparecia no índice como `11.**5**` mesmo
    fechada, e o aviso de "id errado não fecha nada" também calava, porque do
    outro lado a comparação era com a versão normalizada. Errava nas duas
    pontas ao mesmo tempo. Normalizar num lugar só é o que faz as duas falarem
    da mesma coisa.
    """
    return re.sub(r"[~`* ]", "", celula)


def _tabelas(texto, titulo_re):
    """Devolve as linhas de tabela que aparecem sob um cabeçalho que casa."""
    blocos, capturando = [], False
    for linha in texto.splitlines():
        if linha.startswith("#"):
            capturando = bool(titulo_re.search(linha))
            continue
        if not capturando:
            continue
        m = LINHA.match(linha)
        if m and not set(m.group(1)) <= set("-| "):
            cel = _celulas(linha)
            if cel and cel[0].lower() not in ("#", "item"):
                blocos.append(cel)
    return blocos


def decorrencias_fechadas():
    """Ids de decorrência que um ADR POSTERIOR declara fechados.

    ADR aceito não se edita (regra 3 do README dos ADRs). Sem isto, uma
    decorrência aberta dentro do 0011 nunca poderia sair deste índice: fechá-la
    exigiria riscar a linha lá dentro, que é exatamente o que a regra proíbe —
    e o índice ficaria mentindo pra sempre.

    Quem fecha é o ADR que decidiu. Ele declara o id numa tabela sob o título
    `Decorrências fechadas`, e o item some daqui sem ninguém tocar no original.
    Aceita `0011.1` ou `11.1`.
    """
    fechados, declarados = {}, set()
    for p in sorted((RAIZ / "docs/adr").glob("0*.md")):
        num = p.name[:4]
        texto = p.read_text(encoding="utf-8")
        for cel in _tabelas(texto, re.compile(r"Decorrências abertas", re.I)):
            if cel:
                declarados.add(f"{int(num)}.{_id_decorrencia(cel[0])}")
        for cel in _tabelas(texto, re.compile(r"Decorrências fechadas", re.I)):
            if not cel:
                continue
            m = DECORRENCIA_ID.match(_id_decorrencia(cel[0]))
            if m:
                fechados[f"{int(m.group(1))}.{m.group(2)}"] = num

    # Um id que nao casa com decorrencia nenhuma nao fecha nada, e o ADR
    # continua lendo como se tivesse fechado: `0011.8` digitado no lugar de
    # `0011.7` deixa a 11.7 no indice pra sempre e apaga a intencao de quem
    # escreveu — o inverso exato do que esta funcao existe pra impedir.
    # Fechar de tras pra frente contradiz o contrato do proprio nome.
    for id_, fechador in sorted(fechados.items()):
        origem = int(id_.split(".")[0])
        if id_ not in declarados:
            print(f"⚠ AVISO: ADR {fechador} declara fechada a decorrência "
                  f"{id_}, que não existe em nenhuma tabela `Decorrências "
                  f"abertas`. Id errado não fecha nada, e não avisa ninguém.",
                  file=sys.stderr)
        elif int(fechador) <= origem:
            print(f"⚠ AVISO: ADR {fechador} fecha a decorrência {id_}, aberta "
                  f"no ADR {origem:04d}, que não é anterior a ele. Quem fecha "
                  f"é o ADR POSTERIOR.", file=sys.stderr)
    return fechados


def de_adrs():
    """Decorrências abertas declaradas dentro dos ADRs."""
    fechados = decorrencias_fechadas()
    itens = []
    for p in sorted((RAIZ / "docs/adr").glob("0*.md")):
        num = p.name[:4]
        texto = p.read_text(encoding="utf-8")
        for cel in _tabelas(texto, re.compile(r"Decorrências abertas", re.I)):
            if len(cel) < 2 or _fechado(cel):
                continue
            id_ = f"{int(num)}.{_id_decorrencia(cel[0])}"
            if id_ in fechados:
                continue
            porque = cel[2] if len(cel) > 2 else ""
            itens.append(dict(id=id_, item=cel[1],
                              origem=f"ADR {num}", detalhe=porque,
                              fase="Fase 4", arquivo=f"docs/adr/{p.name}"))
    return itens


def de_decisoes():
    """As regras de negócio — tabela-resumo do topo de decisoes-abertas.md.

    Aceita a linha com ou sem risco em volta do id (~~**D-A**~~ fechada,
    **D-A** aberta) e aplica o mesmo critério de fechamento das outras duas
    fontes — antes desta correção, item riscado aqui continuava aparecendo
    no índice.
    """
    p = RAIZ / "docs/decisoes-abertas.md"
    if not p.exists():
        raise SystemExit("ERRO: docs/decisoes-abertas.md nao existe.")
    itens = []
    padrao = re.compile(r"^\|\s*~{0,2}\*\*(D-[A-Z])\*\*~{0,2}\s*\|(.+)$")
    for linha in p.read_text(encoding="utf-8").splitlines():
        m = padrao.match(linha)
        if not m:
            continue
        cel = [m.group(1)] + _celulas("|" + m.group(2))
        if _fechado([linha]):
            continue
        itens.append(dict(id=cel[0], item=cel[1], origem="decisões abertas",
                          detalhe=f"decide: {cel[2]}" if len(cel) > 2 else "",
                          fase=cel[3] if len(cel) > 3 else "Fase 3",
                          arquivo="docs/decisoes-abertas.md"))
    return itens


CABECALHO = re.compile(r"^(#{1,6})\s+(.*)$")
ID_PENDENCIA = re.compile(r"^[`*~ ]*G?\d+(\.\d+)?[`*~ ]*$")

# Titulos de `##` que legitimamente nao carregam pendencia. Comparado com o
# titulo inteiro, nao por substring: `"pendências" in titulo` casava com quase
# todo titulo plausivel deste arquivo, entao uma `## Novas pendências da Fase 5`
# com itens abertos sumia do indice sem disparar aviso nenhum — o guard so valia
# pra quem evitasse a palavra que da nome ao arquivo.
SEM_PENDENCIA = ("encerradas",)


def _fase_do_titulo(titulo):
    baixo = titulo.lower()
    return ("Fase 3" if "fase 3" in baixo else
            "Fase 4" if "fase 4" in baixo else
            "Go-live" if "go-live" in baixo else
            "Não bloqueia" if "não bloqueiam" in baixo else None)


def de_pendencias():
    """Itens numerados que nascem em pendencias.md.

    So conta tabela DIRETAMENTE sob um `##` de fase. `#` e o topo do arquivo,
    cuja tabela e a de defeitos — lida por defeitos(), nao aqui. `###` ou mais
    fundo e comentario: passo ja decidido, item fora do MVP, decorrencia
    fechada. Sem essa regra, uma sub-tabela explicando o que NAO e pendencia
    entrava na contagem como se fosse, e o indice passava a mentir pra cima.

    O nivel sai do numero de `#`, nao de `startswith("### ")`: com a comparacao
    textual, `####` nao era nem cabecalho informativo nem cabecalho de fase —
    passava batido, deixando a fase anterior de pe, e a sub-tabela voltava a
    contar como pendencia aberta.

    Duas coisas viram aviso em stderr em vez de sumico silencioso: tabela sob
    `##` sem fase reconhecida, e linha com cara de pendencia aberta (id `17`,
    `G3`, `11.7`) parada sob um `###`, que quase sempre e item no lugar errado.
    """
    p = RAIZ / "docs/pendencias.md"
    if not p.exists():
        raise SystemExit("ERRO: docs/pendencias.md nao existe.")
    texto = p.read_text(encoding="utf-8")
    itens, fase, informativa = [], None, True
    ignoradas, suspeitas = {}, {}
    titulo = "Pendências"
    for linha in texto.splitlines():
        m = CABECALHO.match(linha)
        if m:
            nivel, titulo = len(m.group(1)), m.group(2).strip()
            informativa = nivel != 2
            fase = _fase_do_titulo(titulo) if nivel == 2 else None
            continue
        m = LINHA.match(linha)
        if not m or set(m.group(1)) <= set("-| "):
            continue
        cel = _celulas(linha)
        if not cel or cel[0].lower() in ("#", "item") or _fechado(cel):
            continue
        if fase is None or informativa:
            if informativa and ID_PENDENCIA.match(cel[0]):
                suspeitas.setdefault(titulo, []).append(cel[0])
            elif not informativa and titulo.lower() not in SEM_PENDENCIA:
                ignoradas[titulo] = ignoradas.get(titulo, 0) + 1
            continue
        itens.append(dict(id=cel[0], item=cel[1], origem="pendências",
                          detalhe=cel[2] if len(cel) > 2 else "",
                          fase=fase, arquivo="docs/pendencias.md"))
    for titulo, ids in suspeitas.items():
        print(f"⚠ AVISO: {', '.join(ids)} tem id de pendência mas está sob "
              f"'{titulo}', que é seção informativa — item NAO entrou no "
              f"índice. Se é pendência de verdade, mova pra um `##` de fase.",
              file=sys.stderr)
    for titulo, n in ignoradas.items():
        print(f"⚠ AVISO: {n} linha(s) de tabela sob '## {titulo}' — seção sem "
              f"fase reconhecida, itens NAO entraram no indice.", file=sys.stderr)
    return itens


def defeitos():
    """Defeitos internos ainda abertos — bloqueio absoluto, fora das fases."""
    texto = (RAIZ / "docs/pendencias.md").read_text(encoding="utf-8")
    fora = []
    for cel in _tabelas(texto, re.compile(r"Pendências$")):
        if len(cel) >= 3 and not _fechado(cel) and "🔴" in cel[2]:
            fora.append(dict(id=cel[0], item=cel[1], detalhe=cel[2]))
    return fora


def _corta(s, n):
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def _ordem(i):
    """Ordena numericamente: 3 antes de 10, e 11.2 antes de 11.10."""
    partes = re.findall(r"\d+", i["id"])
    return (i["origem"], [int(x) for x in partes] if partes else [999], i["id"])


def main():
    so_abertas = "--abertas" in sys.argv
    # Coletado UMA vez. O sumario chamava as tres de novo: cada aviso de stderr
    # saia duplicado, lido como dois problemas distintos, e de_adrs() reparseava
    # todos os ADRs so pra recontar o que ja estava na lista.
    decisoes, pendencias, adrs = de_decisoes(), de_pendencias(), de_adrs()
    todos = decisoes + pendencias + adrs

    print("# Índice de pendências\n")
    print("*Gerado por `scripts/gerar-pendencias.py`. Não editar — altere a fonte.*")
    print("*Item riscado na fonte não aparece aqui.*\n")

    d = defeitos()
    if d:
        print(f"## 🚨 Defeitos internos abertos: {len(d)}\n")
        print("Bloqueio absoluto — não convivem com nenhuma fase.\n")
        print("| # | Defeito |")
        print("|---|---|")
        for x in d:
            print(f"| {x['id']} | {_corta(x['item'], 110)} |")
        print()

    for fase in FASES:
        if so_abertas and fase == "Não bloqueia":
            continue
        grupo = [i for i in todos if i["fase"].strip().startswith(fase)]
        if not grupo:
            continue
        icone = {"Fase 3": "🔴", "Fase 4": "🟡", "Go-live": "🚦",
                 "Não bloqueia": "🟢"}[fase]
        rotulo = {"Fase 3": "Bloqueiam a Fase 3 (Design)",
                  "Fase 4": "Bloqueiam a Fase 4 (Código)",
                  "Go-live": "Bloqueiam o go-live (não o código)",
                  "Não bloqueia": "Não bloqueiam nada"}[fase]
        print(f"## {icone} {rotulo} — {len(grupo)}\n")
        print("| # | Item | Origem |")
        print("|---|---|---|")
        for i in sorted(grupo, key=_ordem):
            print(f"| {i['id']} | {_corta(i['item'], 95)} | `{i['arquivo']}` |")
        print()

    total = len(todos)
    print(f"**{total} itens abertos** · {len(decisoes)} decisões · "
          f"{len(pendencias)} pendências · {len(adrs)} decorrências de ADR")
    if d:
        print(f"\n⚠ **{len(d)} defeito(s) interno(s) aberto(s).** "
              "Defeito não é pendência: pendência é informação que não chegou, "
              "defeito é trabalho que não foi feito.")


if __name__ == "__main__":
    main()
