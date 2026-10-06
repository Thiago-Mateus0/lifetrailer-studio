#!/usr/bin/env python3
"""Roda os casos de tests/*.yaml contra a implementação de referência.

Sem dependência externa: nem stack, nem banco, nem framework, nem pip install.
Um runner que precisa de instalação é um runner que não roda.

Na Fase 4 a implementação real substitui as funções de cálculo e os mesmos
casos continuam valendo — é esse o contrato deste arquivo.

═══ D-A e D-B — decididas em 2026-08-12 (ver ADR 0013) ═══
As duas ambiguidades de dinheiro encontradas na revisão externa foram
decididas pelo Wyll/Thiago e as constantes abaixo refletem a decisão. O
mecanismo `sensivel_a` em `extensao.yaml` continua disponível — é a forma
padrão de expor uma regra ambígua nos testes até que alguém decida — mas
nenhum caso o usa hoje.
"""
import csv
import sys
import functools
import datetime as dt
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# --- Parametros de negocio -------------------------------------------------
DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
SEG_SEX = DIAS[:5]
# ADR 0008: domingo tem acrescimo o dia inteiro. E regra, nao dado — por isso
# nao sai de turnos.csv, e por isso e o gabarito da guarda de limites_noturnos.
DIA_INTEIRO = {"dom"}
PROXIMO_DIA = {"seg": "ter", "ter": "qua", "qua": "qui", "qui": "sex",
               "sex": "sab", "sab": "dom", "dom": "seg"}

# ADR 0025: o valor do acrescimo e o limite noturno saem de data/, com
# vigencia resolvida na data do ensaio (regra global 4). Estavam literais
# aqui — o valor sem vigencia nenhuma, e o limite como segunda copia de
# data/turnos.csv.
#
# TOLERANCIA e BLOCO ficam aqui de proposito, e nao e esquecimento: nao sao
# parametros, sao a forma da regra. Toda a tabela de arredondamento da spec e
# construida em cima deles — muda-los nao e atualizar um preco, e revogar o
# ADR 0008. Ver secao 3 do ADR 0025.
TOLERANCIA_MIN = 15
BLOCO_MIN = 30

# D-A: em que minuto começa o primeiro bloco cobrável? — ADR 0013
#   0  -> bloco b comeca em fim_agendado + b*30       (DECIDIDO)
#   15 -> bloco b comeca em fim_agendado + 15 + b*30
# Rationale do Wyll/Thiago: a partir do limite noturno, não existe cortesia
# de 15 min — a tolerância só decide SE cobra, não desloca ONDE cobra.
OFFSET_BLOCO = 0

# D-B: bloco após a meia-noite usa o limite de que dia? — ADR 0013
#   "dia_de_inicio"  -> o dia em que o ensaio começou   (DECIDIDO)
#   "dia_calendario" -> o dia em que o bloco começa
REGRA_POS_MEIA_NOITE = "dia_de_inicio"


# --- Utilidades ------------------------------------------------------------
def hm(s):
    """'22:30' -> 1350 (minutos desde 00:00)."""
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _escalar(v):
    """Converte um escalar YAML respeitando o tipo. int('true') era o bug."""
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    baixo = v.lower()
    if baixo in ("true", "yes"):
        return True
    if baixo in ("false", "no"):
        return False
    if baixo in ("null", "~", ""):
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


def carrega(caminho):
    """Leitor do subconjunto de YAML usado nas fixtures.

    Suporta lista de mapas iniciada por '- id:', escalares tipados e mapas
    inline {a: 1, b: true}. Qualquer coisa fora disso levanta erro — nunca
    ignora em silencio (regra 2.0.5).
    """
    casos, atual = [], None
    for n, linha in enumerate(open(caminho, encoding="utf-8"), 1):
        s = linha.split("#")[0].rstrip()
        if not s.strip():
            continue
        if s.lstrip().startswith("- id:"):
            atual = {"id": _escalar(s.split(":", 1)[1]), "_linha": n}
            casos.append(atual)
            continue
        if not s.startswith(" "):          # chave de topo, ex.: 'casos:'
            continue
        if atual is None:
            raise SyntaxError(f"{caminho}:{n}: campo antes do primeiro '- id:'")
        if ":" not in s:
            raise SyntaxError(f"{caminho}:{n}: linha sem ':' -> {s.strip()!r}")
        k, v = s.strip().split(":", 1)
        k, v = k.strip(), v.strip()
        if v.startswith("{"):
            d = {}
            for par in v.strip("{}").split(","):
                if not par.strip():
                    continue
                if ":" not in par:
                    raise SyntaxError(f"{caminho}:{n}: par sem ':' -> {par!r}")
                kk, vv = par.split(":", 1)
                d[kk.strip()] = _escalar(vv)
            atual[k] = d
        else:
            atual[k] = _escalar(v)
    return casos


# --- Regras de negocio -----------------------------------------------------
@functools.lru_cache(maxsize=None)
def _linhas(arquivo):
    """Linhas de um CSV de parametro, lidas uma vez por arquivo.

    `calcula` resolve tres parametros com vigencia, e sem cache cada chamada
    reabria e reparseava os tres arquivos inteiros. O custo em segundos e
    irrelevante nesta escala; o que incomoda e a forma, porque esta e a
    implementacao de referencia que a Fase 4 vai espelhar em PL/pgSQL — e ali
    o mesmo desenho vira varredura de tres tabelas de parametro por calculo
    de extensao.

    Cachear e seguro porque parametro nao muda no meio de uma execucao: o
    processo le, calcula e sai. Editar um CSV exige rodar de novo, que e o que
    ja se faz.
    """
    return tuple(csv.DictReader(open(RAIZ / arquivo, encoding="utf-8")))


def _cobre(r, data):
    """A linha esta vigente na data? `vigencia_fim` vazio = em aberto."""
    ini = dt.date.fromisoformat(r["vigencia_inicio"])
    fim = dt.date.fromisoformat(r["vigencia_fim"]) if r["vigencia_fim"] else None
    return ini <= data and (fim is None or data <= fim)


def _unica_vigente(linhas, data, o_que, arquivo):
    """Uma linha vigente por chave, no maximo — ADR 0025.

    Vigencia sobreposta e o defeito que o padrao 'a correcao fecha a linha
    anterior e abre outra' produz quando alguem esquece de fechar. Sem esta
    guarda cada resolver desempatava de um jeito: quem fazia `return` no
    primeiro match ficava com o valor VELHO, quem acumulava em dict ficava com
    o NOVO. Duas linhas esquecidas, uma em cada arquivo, davam preco velho com
    limite novo — em direcoes opostas e sem erro nenhum.

    As guardas de `limites_noturnos` conferem PRESENCA (dia com limite, dia
    sem). Esta confere MULTIPLICIDADE, que e a outra dimensao — e a que produz
    a diferenca de dinheiro que ninguem ve.
    """
    vigentes = [r for r in linhas if _cobre(r, data)]
    if len(vigentes) > 1:
        raise KeyError(
            f"{arquivo}: {len(vigentes)} linhas vigentes em {data} para "
            f"{o_que}. Vigencia sobreposta — a linha nova abriu sem fechar a "
            f"anterior. Qual valor vale e indefinido; ver ADR 0025.")
    return vigentes[0] if vigentes else None


def valor_tabela(estudio, duracao_min, data, fonte=None):
    """Preco da linha `duracao_min` vigente NA DATA DO ENSAIO — regra global 4.

    Ler sempre a linha com vigencia_fim vazia devolve o preco de hoje, o que
    quebra a reprodutibilidade do relatorio de competencia (ADR 0002).
    """
    arquivo = fonte or "data/precos.csv"
    linhas = [r for r in _linhas(arquivo)
              if r["estudio"] == estudio and int(r["duracao_min"]) == duracao_min]
    r = _unica_vigente(linhas, data, f"{estudio} {duracao_min}min", arquivo)
    if r is None:
        raise KeyError(f"sem preco vigente para {estudio} {duracao_min}min em {data}")
    return float(r["valor"])


def valor_1h(estudio, data, fonte=None):
    return valor_tabela(estudio, 60, data, fonte)


def preco_da_duracao(estudio, minutos, data, fonte=None):
    """Quanto custa ficar `minutos` na sala — ADR 0078.

    Duracao com linha na tabela: o preco da linha. Entre duas linhas: a de
    baixo mais a fracao da diferenca ate a de cima, contada em minutos (que sao
    sempre blocos inteiros). Acima da maior linha: a maior mais meia hora
    avulsa por bloco — nao ha pacote de cima para repartir.
    """
    tabeladas = sorted(duracoes_tabeladas(estudio, data, fonte))
    if minutos in tabeladas:
        return valor_tabela(estudio, minutos, data, fonte)
    abaixo = [d for d in tabeladas if d < minutos]
    if not abaixo:
        raise KeyError(f"{estudio}: {minutos}min abaixo da menor linha da tabela em {data}")
    de_baixo = max(abaixo)
    preco_de_baixo = valor_tabela(estudio, de_baixo, data, fonte)
    acima = [d for d in tabeladas if d > minutos]
    if not acima:
        return preco_de_baixo + (minutos - de_baixo) // BLOCO_MIN * valor_1h(estudio, data, fonte) / 2
    de_cima = min(acima)
    preco_de_cima = valor_tabela(estudio, de_cima, data, fonte)
    return preco_de_baixo + (preco_de_cima - preco_de_baixo) * (minutos - de_baixo) / (de_cima - de_baixo)


def acrescimo_por_bloco(data, fonte=None):
    """Acrescimo noturno vigente NA DATA DO ENSAIO — ADR 0025, regra global 4.

    Estava literal como ACRESCIMO_POR_BLOCO = 25.00, o unico parametro
    financeiro fora da regra: no dia em que virasse outro valor, relatorio de
    competencia antiga recalcularia com o valor de hoje, em silencio.
    """
    arquivo = fonte or "data/acrescimo-noturno.csv"
    linhas = _linhas(arquivo)
    r = _unica_vigente(linhas, data, "acrescimo noturno", arquivo)
    if r is None:
        raise KeyError(f"sem acrescimo noturno vigente em {data}")
    return float(r["valor"])


def limites_noturnos(data, fonte=None):
    """Hora a partir da qual o bloco e noturno, por dia — data/turnos.csv.

    None = dia inteiro. Le `hora_fim_calculo`, que ja carrega vigencia — o
    runner tinha uma segunda copia desses horarios, sem vigencia nenhuma.

    As guardas importam mais que a leitura. None e a codificacao de 'domingo,
    acrescimo o dia inteiro', entao QUALQUER dia que perca seu limite passa a
    cobrar como domingo — sem erro, sem teste falhando, so uma diferenca de
    dinheiro. Por isso os dois lados sao conferidos contra DIA_INTEIRO, que e
    regra do ADR 0008 e nao dado: dia que deveria ter limite e nao tem, e dia
    que nao deveria ter e tem, os dois levantam. Sobreposicao de vigencia e
    conferida por _unica_vigente, por (dia, turno). Ver secao 2 do ADR 0025.
    """
    arquivo = fonte or "data/turnos.csv"

    # `dia_semana` fora do vocabulario nao casava com dia nenhum e a linha
    # sumia calada, levando junto a mudanca de limite que ela pretendia fazer.
    # Era o unico caminho fail-open entre as guardas: todas as outras falham
    # fechado, esta devolvia o limite velho como se nada tivesse sido escrito.
    por_dia_turno = {}
    for r in _linhas(arquivo):
        token = r["dia_semana"].strip()
        if token == "seg-sex":
            dias_da_linha = SEG_SEX
        elif token in DIAS:
            dias_da_linha = [token]
        else:
            raise KeyError(
                f"{arquivo}: dia_semana {token!r} nao e dia conhecido nem "
                f"'seg-sex'. A linha nao se aplica a dia nenhum e sumiria sem "
                f"erro, junto com a mudanca de limite que pretendia fazer.")
        for d in dias_da_linha:
            por_dia_turno.setdefault((d, r["turno"].strip()), []).append(r)

    # Multiplicidade e conferida por (dia, turno) e ANTES de descartar limite
    # em branco. O turno e o que distingue duas linhas do mesmo dia — `Manha`
    # nao tem limite por desenho, e filtrar branco antes escondia justamente a
    # sobreposicao em que a linha nova ZERA o limite: sobrava uma linha so,
    # _unica_vigente nao via nada, e o dia seguia cobrando pelo limite velho.
    limites = {}
    for (d, turno), linhas in sorted(por_dia_turno.items()):
        r = _unica_vigente(linhas, data, f"turno '{turno}' de '{d}'", arquivo)
        if r is None or not r["hora_fim_calculo"].strip():
            continue
        if d in limites:
            raise KeyError(
                f"{arquivo}: '{d}' tem `hora_fim_calculo` vigente em mais de "
                f"um turno em {data}. Qual limite vale e indefinido — ADR 0025.")
        limites[d] = r["hora_fim_calculo"].strip()

    sem_limite = [d for d in DIAS if d not in DIA_INTEIRO and d not in limites]
    if sem_limite:
        raise KeyError(
            f"{arquivo} sem `hora_fim_calculo` vigente em {data} para: "
            f"{sem_limite}. Sem limite, o dia inteiro vira noturno — ADR 0025.")
    conflito = sorted(DIA_INTEIRO & set(limites))
    if conflito:
        raise KeyError(
            f"{arquivo} da limite a {conflito}, que o ADR 0008 define "
            f"como noturno o dia inteiro. CSV e regra discordam — ADR 0025.")
    return {d: limites.get(d) for d in DIAS}


def duracoes_tabeladas(estudio, data, fonte=None):
    return {int(r["duracao_min"])
            for r in _linhas(fonte or "data/precos.csv")
            if r["estudio"] == estudio and _cobre(r, data)}


def valida_duracao(seance_length, buffer_seg, estudio, data, fonte=None):
    """D1 do ADR 0008 — a tabela e a politica. Nunca rejeita silenciosamente."""
    duracao_min = (seance_length - buffer_seg) // 60
    if duracao_min <= 0:
        return dict(duracao_min=duracao_min, tabelada=False,
                    bloqueia_comanda=True, flag="duracao_invalida")
    if duracao_min not in duracoes_tabeladas(estudio, data, fonte):
        return dict(duracao_min=duracao_min, tabelada=False,
                    bloqueia_comanda=True, flag="duracao_nao_tabelada")
    return dict(duracao_min=duracao_min, tabelada=True,
                bloqueia_comanda=False, flag=None)


def calcula(estudio, dia, duracao_agendada, fim_agendado, fim_praticado, data=None,
            offset=0, pos_meia_noite="dia_de_inicio", fonte=None,
            fonte_acrescimo=None, fonte_turnos=None):
    """Extensao de ensaio — ADR 0008; a base, ADR 0078.

    offset          -> D-A (0 ou 15)
    pos_meia_noite  -> D-B ('dia_de_inicio' ou 'dia_calendario')
    """
    data = data or dt.date(2026, 8, 11)
    ini, fim = hm(fim_agendado), hm(fim_praticado)
    if fim < ini:
        fim += 24 * 60                                   # atravessou a meia-noite
    minutos = fim - ini

    blocos = 0 if minutos < TOLERANCIA_MIN else (minutos - TOLERANCIA_MIN) // BLOCO_MIN + 1

    # Parametro so e resolvido quando o resultado depende dele. Um ensaio dentro
    # da tolerancia nao cobra nada, entao nao le preco, nem limite, nem
    # acrescimo — e continua devolvendo zero numa data anterior a vigencia dos
    # CSVs, em vez de levantar. Reproduzir competencia antiga (ADR 0002) precisa
    # de um numero, nao de um KeyError sobre um parametro que nao entrou na conta.
    if blocos == 0:
        return dict(minutos=minutos, blocos=0, blocos_noturnos=0,
                    base=0.00, acrescimo=0.00, total=0.00)

    limite = limites_noturnos(data, fonte_turnos)
    noturnos = 0
    for b in range(blocos):
        inicio_bloco = ini + offset + b * BLOCO_MIN
        dia_do_bloco, instante = dia, inicio_bloco
        if inicio_bloco >= 24 * 60 and pos_meia_noite == "dia_calendario":
            dia_do_bloco = PROXIMO_DIA[dia]
            instante = inicio_bloco - 24 * 60
        lim = limite[dia_do_bloco]
        if lim is None or instante >= hm(lim):           # domingo: dia inteiro
            noturnos += 1

    # ADR 0078: a extensao e a diferenca entre o preco da duracao total e o do
    # pacote agendado — o cliente paga como se tivesse contratado o tempo todo.
    if duracao_agendada not in duracoes_tabeladas(estudio, data, fonte):
        raise KeyError(f"{estudio}: duracao agendada {duracao_agendada}min fora da "
                       f"tabela em {data} — a Comanda nem existe (ADR 0008, D1)")
    total_min = duracao_agendada + blocos * BLOCO_MIN
    base = round(preco_da_duracao(estudio, total_min, data, fonte)
                 - valor_tabela(estudio, duracao_agendada, data, fonte), 2)
    acrescimo = (round(noturnos * acrescimo_por_bloco(data, fonte_acrescimo), 2)
                 if noturnos else 0.00)
    return dict(minutos=minutos, blocos=blocos, blocos_noturnos=noturnos,
                base=base, acrescimo=acrescimo, total=round(base + acrescimo, 2))


# --- Execucao --------------------------------------------------------------
def _data(caso):
    return dt.date.fromisoformat(caso["data"]) if "data" in caso else None


def _roda_extensao(caso, offset, pos_mn):
    return calcula(caso["estudio"], caso["dia_semana"], caso["duracao_agendada"],
                   caso["fim_agendado"], caso["fim_praticado"],
                   data=_data(caso), offset=offset, pos_meia_noite=pos_mn,
                   fonte=caso.get("fonte_precos"),
                   fonte_acrescimo=caso.get("fonte_acrescimo"),
                   fonte_turnos=caso.get("fonte_turnos"))


def _difere(esperado, obtido):
    ruim = {}
    for k, v in esperado.items():
        if k not in obtido:
            ruim[k] = (v, "CAMPO INEXISTENTE")
        elif isinstance(v, (int, float)) and not isinstance(v, bool) \
                and isinstance(obtido[k], (int, float)):
            if abs(obtido[k] - v) > 1e-9:
                ruim[k] = (v, obtido[k])
        elif obtido[k] != v:
            ruim[k] = (v, obtido[k])
    return ruim


def executa(caminho, tipo):
    casos = carrega(caminho)
    if not casos:
        raise SystemExit(f"ERRO: {caminho} nao produziu nenhum caso.")
    ok = falhas = pendentes = 0

    for c in casos:
        nome = f"{c['id']}  {c.get('nome', '')}".rstrip()
        # Um caso mal fixturado e um caso que falhou, nao a suite quebrada.
        # `calcula` resolve tres CSVs com vigencia agora, e cada `fonte_*`
        # esquecida levantava daqui pra cima: os casos seguintes nao rodavam,
        # nenhuma linha FALHOU saia, e nem o sumario. O traceback dizia "o
        # runner esta quebrado" quando o defeito era uma chave faltando no yaml.
        try:

            # -- caso que exige que uma guarda LEVANTE --
            # As guardas do ADR 0025 sao a metade do runner que decide dinheiro
            # calado quando falha, e nao davam pra testar: o yaml so sabia
            # comparar numero, entao guarda sem cobertura era guarda que ninguem
            # verificava. `erro_esperado` compara trecho da mensagem, e nao
            # `espera_*`, que colidiria com o dicionario de variantes do
            # `sensivel_a` logo abaixo.
            if "erro_esperado" in c:
                try:
                    _roda_extensao(c, OFFSET_BLOCO, REGRA_POS_MEIA_NOITE)
                except Exception as e:
                    if c["erro_esperado"].lower() in str(e).lower():
                        ok += 1
                        print(f"ok         {nome}")
                    else:
                        falhas += 1
                        print(f"FALHOU     {nome}")
                        print(f"             levantou, mas com outra mensagem")
                        print(f"             esperado conter: {c['erro_esperado']!r}")
                        print(f"             obtido: {str(e)!r}")
                else:
                    falhas += 1
                    print(f"FALHOU     {nome}")
                    print(f"             NAO levantou — a guarda deixou passar")
                continue

            # -- caso sensivel a decisao aberta: verifica AS DUAS leituras --
            if "sensivel_a" in c:
                chave = c["sensivel_a"]
                variantes = {k[7:]: v for k, v in c.items() if k.startswith("espera_")}
                if len(variantes) < 2:
                    raise SyntaxError(f"{caminho}: {c['id']} declara sensivel_a "
                                      f"mas tem {len(variantes)} variante(s)")
                problemas = {}
                for rotulo, esperado in variantes.items():
                    if chave == "offset_bloco":
                        got = _roda_extensao(c, int(rotulo), "dia_de_inicio")
                    else:
                        got = _roda_extensao(c, 0, rotulo)
                    d = _difere(esperado, got)
                    if d:
                        problemas[rotulo] = d
                if problemas:
                    falhas += 1
                    print(f"FALHOU     {nome}")
                    for rot, d in problemas.items():
                        for k, (esp, obt) in d.items():
                            print(f"             [{rot}] {k}: esperado {esp} - obtido {obt}")
                else:
                    pendentes += 1
                    totais = {r: v.get("total") for r, v in variantes.items()}
                    vals = [v for v in totais.values() if v is not None]
                    delta = f"   DELTA R$ {max(vals) - min(vals):.2f}" if len(vals) > 1 else ""
                    print(f"PENDENTE   {nome}")
                    print(f"             {chave}: "
                          + "  ".join(f"{r} -> R$ {t:.2f}" for r, t in sorted(totais.items()))
                          + delta)
                continue

            # -- caso normal --
            if tipo == "extensao":
                got = _roda_extensao(c, OFFSET_BLOCO, REGRA_POS_MEIA_NOITE)
            else:
                got = valida_duracao(c["seance_length"], c.get("buffer", 1800),
                                     c.get("estudio", "Acustico"),
                                     _data(c) or dt.date(2026, 8, 11),
                                     c.get("fonte_precos"))
            d = _difere(c["espera"], got)
            if d:
                falhas += 1
                print(f"FALHOU     {nome}")
                for k, (esp, obt) in d.items():
                    print(f"             {k}: esperado {esp} - obtido {obt}")
            else:
                ok += 1
                print(f"ok         {nome}")
        except Exception as e:
            falhas += 1
            print(f"ERRO       {nome}")
            print(f"             {type(e).__name__}: {e}")
            print(f"             caso nao executou — os demais continuam.")
            continue

    return ok, falhas, pendentes


PARAMETROS_PRODUCAO = ("data/precos.csv", "data/turnos.csv",
                       "data/acrescimo-noturno.csv")


def valida_dados_producao():
    """Resolve os parametros de `data/` uma vez, fora dos casos.

    `calcula` sai cedo quando o ensaio nao gera bloco e, por desenho, nao le
    parametro nenhum nesse caminho — ver o comentario dentro de `calcula`, que
    e o que garante reproduzir competencia antiga em vez de levantar. A
    consequencia e que um caso de zero bloco imprime `ok` mesmo com `data/`
    quebrado: ele esta certo, so nao exercita guarda nenhuma. Hoje os outros
    casos levantam e a suite falha assim mesmo, mas isso depende da mistura de
    fixtures — descobrir CSV quebrado por coincidencia nao e guarda.

    A data de referencia sai dos proprios CSVs: a ultima `vigencia_inicio`
    declarada, ou seja, os parametros como valem agora. Nao usa a data de
    execucao de proposito — teste que muda de resultado com a passagem do
    tempo falha um dia sem ninguem ter mexido em nada.
    """
    data = max(dt.date.fromisoformat(r["vigencia_inicio"])
               for a in PARAMETROS_PRODUCAO for r in _linhas(a))
    limites_noturnos(data)
    acrescimo_por_bloco(data)
    for estudio in sorted({r["estudio"] for r in _linhas("data/precos.csv")}):
        valor_1h(estudio, data)
    return data


def main():
    total_ok = total_falhas = total_pend = 0

    print("\n--- data/ (parametros de producao) ---")
    try:
        data_ref = valida_dados_producao()
    except Exception as e:
        total_falhas += 1
        print("FALHOU     parametros de producao nao resolvem")
        print(f"             {type(e).__name__}: {e}")
    else:
        total_ok += 1
        print(f"ok         parametros de producao resolvem em {data_ref}")

    for arquivo, tipo in (("tests/extensao.yaml", "extensao"),
                          ("tests/duracao.yaml", "duracao")):
        caminho = RAIZ / arquivo
        if not caminho.exists():
            raise SystemExit(f"ERRO: {arquivo} nao existe. Fixture sumiu?")
        print(f"\n--- {arquivo} ---")
        o, f, p = executa(caminho, tipo)
        total_ok += o
        total_falhas += f
        total_pend += p

    print(f"\n{total_ok} ok - {total_falhas} falhas - {total_pend} pendentes de decisao")
    if total_pend:
        print("Pendentes nao sao falhas: as duas leituras conferem, falta escolher "
              "qual vale.\nVer docs/decisoes-abertas.md")
    sys.exit(1 if total_falhas else 0)


if __name__ == "__main__":
    main()
