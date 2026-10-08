#!/usr/bin/env python3
"""Gera as tabelas que antes eram transcritas à mão em docs/spec/fundacao.md.

Regra 1 da casa: número não se digita, se deriva. As tabelas de extensão, a
carga inicial do StaffAltegio e os casos de referência eram quatro conjuntos de
números deriváveis vivendo em prosa — a mesma estrutura que errou a contagem do
Anexo A em três revisões seguidas.

Uso:
    python3 scripts/gerar-tabelas.py            # todas
    python3 scripts/gerar-tabelas.py extensao   # só uma
"""
import csv
import sys
import datetime as dt
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests"))
from runner import (calcula, valor_1h, carrega, acrescimo_por_bloco,  # noqa: E402
                    preco_da_duracao, OFFSET_BLOCO, REGRA_POS_MEIA_NOITE)

HOJE = dt.date.today()
BLOCOS = [(1, "30 min"), (2, "1h"), (3, "1h30"), (4, "2h")]


def _estudios():
    vistos = []
    for r in csv.DictReader(open(RAIZ / "data/precos.csv", encoding="utf-8")):
        if r["estudio"] not in vistos:
            vistos.append(r["estudio"])
    return vistos


def _brl(v):
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def extensao():
    # ADR 0025: o acrescimo vem de data/, vigente na data — nao mais constante.
    acrescimo = acrescimo_por_bloco(HOJE)
    out = []
    for rotulo, extra in (("DIURNA (nenhum bloco após o limite)", 0.0),
                          ("NOTURNA (todos os blocos após o limite)", acrescimo)):
        out.append(f"\n### Tabela de extensão sobre ensaio de 1h — {rotulo}\n")
        out.append("| Estúdio | " + " | ".join(r for _, r in BLOCOS) + " |")
        out.append("|---" * (len(BLOCOS) + 1) + "|")
        for e in _estudios():
            v = valor_1h(e, HOJE)
            cels = [_brl(preco_da_duracao(e, 60 + n * 30, HOJE) - v + n * extra) for n, _ in BLOCOS]
            out.append(f"| {e} | " + " | ".join(cels) + " |")
    out.append("\n**Estas são as duas pontas, para o ensaio agendado de 1h.** A base é o "
               "preço da duração total menos o do pacote agendado (ADR 0078); cada bloco "
               f"que começa após o limite soma R${_brl(acrescimo)}.\n")
    return "\n".join(out)


def staff():
    out = ["\n### Carga inicial — `StaffAltegio`\n",
           "| company_id | staff_id | tipo | destino |", "|---|---|---|---|"]
    for r in csv.DictReader(open(RAIZ / "data/staff-altegio.csv", encoding="utf-8")):
        destino = r["rotulo"] + (f" (ordem {r['ordem_exibicao']})"
                                 if r["ordem_exibicao"] else "")
        out.append(f"| {r['company_id']} | {r['staff_id']} | {r['tipo']} | {destino} |")
    ids = sorted(int(r["staff_id"])
                 for r in csv.DictReader(open(RAIZ / "data/staff-altegio.csv", encoding="utf-8"))
                 if r["tipo"] == "Estudio")
    consec = [f"{a}/{b}" for a, b in zip(ids, ids[1:]) if b - a == 1]
    if consec:
        out.append(f"\n⚠ Ids de estúdio consecutivos detectados ({', '.join(consec)}). "
                   "Um dígito errado no cadastro joga o ensaio no estúdio vizinho. "
                   "Conferência dupla na carga; o alerta de divergência do "
                   "`valor_altegio_snapshot` é a segunda rede.\n")
    return "\n".join(out)


FASES_CHECKLIST = ("Entrada", "Saida")


def checklist():
    """Carga inicial do ItemCatalogo — ADR 0032, transcrito do quadro fisico.

    Valida secao contra data/staff-altegio.csv. Secao orfa seria item que nunca
    aparece em tela nenhuma, e a fase fecharia 100% sem ele — o mesmo modo de
    falha que o ADR 0030 secao 3 existe pra impedir, so que por dado errado em
    vez de catalogo vazio.

    As tres guardas cobrem os tres jeitos de um item sumir entre o quadro e o
    catalogo: secao que nao existe (`orfas`), par (secao, fase) sem item nenhum
    (`vazios`) e fase escrita fora do vocabulario (`fases_estranhas`). A do meio
    era por estudio: um estudio com item de Entrada e nenhum de Saida passava, e
    a checklist de Saida abria com zero item — fechando 100% sem ninguem conferir
    nada, que e exatamente o que a guarda existe pra impedir. A terceira e o
    caminho mais provavel pra la: `Saída` acentuado, como a prosa escreve em todo
    lugar, saia da tabela em silencio enquanto o cabecalho seguia contando o
    arquivo inteiro.
    """
    todos = list(csv.DictReader(open(RAIZ / "data/checklist-itens.csv", encoding="utf-8")))
    # `ativo` e a forma de aposentar item antes do go-live sem perder a
    # transcricao. Sem o filtro, o item inativo continuava na carga e continuava
    # contando no cabecalho.
    itens = [i for i in todos if i.get("ativo", "true").strip().lower() == "true"]
    estudios = {r["estudio"] for r in
                csv.DictReader(open(RAIZ / "data/staff-altegio.csv", encoding="utf-8"))
                if r["tipo"] == "Estudio" and r["ativo"].strip().lower() == "true"}

    fases_estranhas = sorted({i["fase"] for i in itens} - set(FASES_CHECKLIST))
    if fases_estranhas:
        raise SystemExit(f"ERRO: checklist-itens.csv tem fase fora de "
                         f"{list(FASES_CHECKLIST)}: {fases_estranhas}. Item com "
                         "fase estranha nao entra em tela nenhuma (ADR 0030).")
    orfas = {i["secao"] for i in itens if i["secao"]} - estudios
    if orfas:
        raise SystemExit(f"ERRO: checklist-itens.csv tem secao sem estudio "
                         f"correspondente em staff-altegio.csv: {sorted(orfas)}")
    presentes = {(i["secao"], i["fase"]) for i in itens if i["secao"]}
    vazios = sorted({(e, f) for e in estudios for f in FASES_CHECKLIST} - presentes)
    if vazios:
        raise SystemExit(
            f"ERRO: par (estudio, fase) sem nenhum item de checklist: "
            f"{[f'{e}/{f}' for e, f in vazios]}. "
            "Fase sem item fecha 100% por vacuidade (ADR 0030).")

    out = [f"\n### Carga inicial — `ItemCatalogo` ({len(itens)} itens)\n",
           "*Gerado de `data/checklist-itens.csv`. Transcricao do quadro fisico, "
           "ADR 0032. Depois do go-live quem manda e a tabela, nao este arquivo.*\n"]
    for fase in FASES_CHECKLIST:
        da_fase = [i for i in itens if i["fase"] == fase]
        out.append(f"\n**{fase} — {len(da_fase)} itens**\n")
        out.append("| Seção | Item | Ação | Dias | Horário |")
        out.append("|---|---|---|---|---|")
        for i in sorted(da_fase, key=lambda x: (x["secao"] == "", x["secao"],
                                                int(x["ordem"]))):
            dias = "" if i["dias_aplicaveis"] == "todos" else i["dias_aplicaveis"]
            out.append(f"| {i['secao'] or 'Geral'} | {i['nome']} | {i['acao']} | "
                       f"{dias} | {i['horario_referencia']} |")
    return "\n".join(out)


def casos():
    """Casos de referência — derivados de tests/extensao.yaml, não redigitados."""
    fixos, pend = [], []
    for c in carrega(RAIZ / "tests/extensao.yaml"):
        (pend if "sensivel_a" in c else fixos).append(c)

    out = ["\n### Casos de referência — extensão\n",
           "*Gerado de `tests/extensao.yaml`. Para alterar um número, altere o caso.*\n",
           "| # | estúdio | agendado | dia | fim agend. | fim prat. | min | blocos | D/N | base | acrésc. | total |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in fixos:
        if "fonte_precos" in c:
            continue
        r = calcula(c["estudio"], c["dia_semana"], c["duracao_agendada"],
                    c["fim_agendado"], c["fim_praticado"],
                    offset=OFFSET_BLOCO or 0,
                    pos_meia_noite=REGRA_POS_MEIA_NOITE or "dia_de_inicio")
        dn = "—" if not r["blocos"] else (
            "D" * (r["blocos"] - r["blocos_noturnos"]) + "N" * r["blocos_noturnos"])
        out.append(f"| {c['id']} | {c['estudio']} | {c['duracao_agendada']} min | {c['dia_semana']} | "
                   f"{c['fim_agendado']} | {c['fim_praticado']} | {r['minutos']} | "
                   f"{r['blocos']} | {dn} | {_brl(r['base'])} | "
                   f"{_brl(r['acrescimo'])} | **{_brl(r['total'])}** |")

    if pend:
        out.append("\n⚠ **Casos sem valor definido — dependem de decisão em aberto** "
                   "(`docs/decisoes-abertas.md`):\n")
        out.append("| # | caso | decisão | leituras |")
        out.append("|---|---|---|---|")
        for c in pend:
            leituras = {k[7:]: v.get("total") for k, v in c.items()
                        if k.startswith("espera_")}
            txt = " · ".join(f"`{r}` → R${_brl(t)}" for r, t in sorted(leituras.items()))
            out.append(f"| {c['id']} | {c.get('nome','')} | {c['sensivel_a']} | {txt} |")
    out.append("")
    return "\n".join(out)


SECOES = {"extensao": extensao, "staff": staff, "checklist": checklist,
          "casos": casos}

if __name__ == "__main__":
    alvo = sys.argv[1:] or list(SECOES)
    for nome in alvo:
        if nome not in SECOES:
            raise SystemExit(f"seção desconhecida: {nome}. Opções: {', '.join(SECOES)}")
        print(SECOES[nome]())
