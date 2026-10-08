#!/usr/bin/env python3
"""Concatena spec + ADRs + pendências num documento único, para colar num chat novo.
Gerado, nunca editado à mão. A fonte da verdade continua sendo docs/ e data/."""
import csv, datetime as dt
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# schema por ultimo: e derivado, montado a partir dos 12 specs acima.
ORDEM_SPEC = ["fundacao","permissoes","audit-log","integracao-altegio","ui",
              "comanda","checklist","estoque","escala","horas-extras",
              "lembretes","achados","treinamento","schema"]
saida = []
saida.append(f"# Lifetrailer Studio — contexto consolidado\n")
saida.append(f"*Gerado em {dt.date.today()} a partir de docs/ e data/. "
             f"Não editar: edite a fonte e gere de novo.*\n")
saida.append((RAIZ/"README.md").read_text())

saida.append("\n\n# ═══ DADOS DE REFERÊNCIA ═══\n")
for csvf in sorted((RAIZ/"data").glob("*.csv")):
    linhas = list(csv.DictReader(csvf.open()))
    saida.append(f"\n## `data/{csvf.name}` — {len(linhas)} registros\n")
    saida.append("```\n" + csvf.read_text().rstrip() + "\n```\n")

saida.append("\n\n# ═══ ESPECIFICAÇÃO ═══\n")
existentes = {p.stem for p in (RAIZ/"docs/spec").glob("*.md")}
faltando = existentes - set(ORDEM_SPEC)
if faltando:
    raise SystemExit(f"ERRO: spec fora de ORDEM_SPEC: {sorted(faltando)}. "
                     "Some do contexto sem aviso — adicione a lista. (regra 2.0.5)")
for nome in ORDEM_SPEC:
    p = RAIZ/"docs/spec"/f"{nome}.md"
    if not p.exists():
        raise SystemExit(f"ERRO: ORDEM_SPEC cita {nome}.md, que nao existe.")
    saida.append("\n" + p.read_text().rstrip() + "\n\n---\n")

saida.append("\n\n# ═══ DECISÕES (ADR) ═══\n")
for p in sorted((RAIZ/"docs/adr").glob("0*.md")):
    saida.append("\n" + p.read_text().rstrip() + "\n\n---\n")

saida.append("\n\n# ═══ CASOS DE TESTE ═══\n")
saida.append("*Regra da casa: regra de dinheiro precisa de caso aqui antes de virar "
             "codigo. Sem esta secao, o contexto tem a prosa e nao tem a verificacao.*\n")
for y in sorted((RAIZ/"tests").glob("*.yaml")):
    saida.append(f"\n## `tests/{y.name}`\n")
    saida.append("```yaml\n" + y.read_text().rstrip() + "\n```\n")

saida.append("\n\n# ═══ DECISOES ABERTAS ═══\n")
saida.append((RAIZ/"docs/decisoes-abertas.md").read_text())

saida.append("\n\n# ═══ PENDÊNCIAS ═══\n")
saida.append((RAIZ/"docs/pendencias.md").read_text())

print("\n".join(saida))
