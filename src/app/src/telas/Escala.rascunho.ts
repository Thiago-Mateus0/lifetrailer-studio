import type { DadosEscala, DiaEscala, EdicaoTurno } from './Escala'

// O modo "Editar escala" enquanto não foi confirmado. Nada vai ao servidor até
// o Confirmar (mockup: "Nada é salvo até confirmar"), e então vai tudo numa
// chamada só — app.escala_alterar, migration 0060.

type Tipo = EdicaoTurno['tipo']

/**
 * A escolha do dedo para um turno. `versao` é a do turno quando o dedo tocou:
 * se a tela for relida com outra (alguém gravou no meio), a escolha é velha e
 * sai do rascunho — mostrar por cima do que outra pessoa gravou seria a tela
 * afirmando uma escala que ninguém vai ver.
 */
type Escolha = { tipo: Tipo; colaborador: string | null; versao: number }

/** Por turno, só o que difere do que está gravado. Vazio = editando, sem mudança. */
export type RascunhoEscala = Record<string, Escolha>

type Equipe = DadosEscala['equipe']

const gravada = (e: EdicaoTurno): Escolha =>
  ({ tipo: e.tipo, colaborador: e.tipo === 'troca' ? e.atual : null, versao: e.versao })

const escolhaDe = (e: EdicaoTurno, r: RascunhoEscala): Escolha => {
  const escolha = r[e.identificador]
  return escolha !== undefined && escolha.versao === e.versao ? escolha : gravada(e)
}

function escolher(r: RascunhoEscala, e: EdicaoTurno, tipo: Tipo, colaborador: string | null): RascunhoEscala {
  const { [e.identificador]: _anterior, ...resto } = r
  const g = gravada(e)
  // Voltar ao que está gravado tira o turno da lista: mandar "padrao" para um
  // turno que já é padrão o banco recusa, e com razão.
  if (g.tipo === tipo && g.colaborador === colaborador) return resto
  return { ...resto, [e.identificador]: { tipo, colaborador, versao: e.versao } }
}

// Quem pode cobrir: a equipe menos o titular — trocar alguém por ele mesmo é
// voltar ao padrão.
const candidatos = (e: EdicaoTurno, equipe: Equipe) =>
  equipe.map((p) => p.identificador).filter((id) => id !== e.titular)

/**
 * "troca" percorre a equipe, um toque por pessoa, e depois da última volta ao
 * padrão — é o gesto do mockup, sem lista suspensa num tablet.
 */
export function alternarTroca(r: RascunhoEscala, e: EdicaoTurno, equipe: Equipe): RascunhoEscala {
  const lista = candidatos(e, equipe)
  if (lista.length === 0) return r
  const atual = escolhaDe(e, r)
  const proximo = lista[atual.tipo === 'troca' ? lista.indexOf(atual.colaborador ?? '') + 1 : 0]
  return proximo === undefined ? escolher(r, e, 'padrao', null) : escolher(r, e, 'troca', proximo)
}

const turnosEditaveis = (dados: DadosEscala) =>
  dados.dias.flatMap((dia) => dia.turnos).flatMap((t) => (t.edicao === undefined ? [] : [t.edicao]))

/** O corpo do Confirmar: só o que mudou, com a versão que a tela leu. */
export function alteracoesDe(dados: DadosEscala, r: RascunhoEscala) {
  return turnosEditaveis(dados).flatMap((e) => {
    const escolha = r[e.identificador]
    if (escolha === undefined || escolha.versao !== e.versao) return []
    return [{ turno_id: e.identificador, versao: e.versao, tipo: escolha.tipo, colaborador_id: escolha.colaborador }]
  })
}

/**
 * Sobrepõe o rascunho à tela. Os textos (selo, "cobre X", "X ausente") são os
 * mesmos que o servidor escreve para o que já está gravado, para o turno ter a
 * mesma cara antes e depois do Confirmar.
 */
export function comEdicao(dados: DadosEscala, r: RascunhoEscala | null): DadosEscala {
  if (r === null) return dados
  const nomeDe = (id: string | null, e: EdicaoTurno, colaborador: string) =>
    dados.equipe.find((p) => p.identificador === id)?.nome ?? (id === e.atual ? colaborador : 'Não atribuído')

  return {
    ...dados,
    editando: true,
    podeConfirmar: alteracoesDe(dados, r).length > 0,
    dias: dados.dias.map((dia) => ({
      ...dia,
      turnos: dia.turnos.map((turno) => {
        const e = turno.edicao
        if (e === undefined) return turno
        const escolha = escolhaDe(e, r)
        const titular = e.titularNome ?? 'Não atribuído'
        const quem = nomeDe(escolha.colaborador, e, turno.colaborador)
        const acoes = [
          { identificador: 'troca', rotulo: escolha.tipo === 'troca' ? `troca: ${quem}` : 'troca',
            selecionada: escolha.tipo === 'troca', desativada: candidatos(e, dados.equipe).length === 0 },
        ]
        const { selo: _selo, nota: _nota, ...base } = turno
        if (escolha.tipo === 'troca') {
          return { ...base, colaborador: quem, destaque: 'troca' as const, selo: 'troca', acoes,
            ...(e.titularNome === null ? {} : { nota: `cobre ${e.titularNome}` }) }
        }
        if (escolha.tipo === 'ausencia') {
          return { ...base, colaborador: 'Não atribuído', destaque: 'ausencia' as const, selo: 'ausência', nota: `${titular} ausente`, acoes }
        }
        return { ...base, colaborador: titular, destaque: 'padrao' as const, acoes }
      }),
    })),
  }
}

// ------------------------------------------------- revisão da âncora (0062)
// Mesmo desenho do modo de edição: o dedo decide no cliente, nada vai ao banco
// até o "Confirmar nova âncora", e então vai a proposta inteira numa chamada —
// app.escala_padrao_revisar exige uma decisão por troca afetada, e só elas.

type Decisao = 'manter' | 'padrao'

/** Por troca afetada, a decisão e a versão que a tela mostrava quando o dedo decidiu. */
export type RascunhoRevisao = Record<string, { decisao: Decisao; versao: number }>

type Afetada = NonNullable<DadosEscala['revisao']>['afetadas'][number]

const decisaoValida = (acao: string): acao is Decisao => acao === 'manter' || acao === 'padrao'

export function decidirTroca(r: RascunhoRevisao, afetada: Afetada, acao: string): RascunhoRevisao {
  if (!decisaoValida(acao)) return r
  return { ...r, [afetada.identificador]: { decisao: acao, versao: afetada.versao } }
}

/**
 * O que o Confirmar manda. Decisão tomada sobre uma versão velha sai da lista,
 * como no calendário: o banco recusaria a troca inteira com LT001, e a releitura
 * é que põe a tela em dia.
 */
export function decisoesDe(dados: DadosEscala, r: RascunhoRevisao) {
  const revisao = dados.revisao
  if (revisao === undefined) return []
  return revisao.afetadas.flatMap((afetada) => {
    const escolha = r[afetada.identificador]
    return escolha === undefined || escolha.versao !== afetada.versao
      ? []
      : [{ turno_id: afetada.identificador, versao: afetada.versao, decisao: escolha.decisao }]
  })
}

/** Sobrepõe as decisões à tela: o botão marcado, a conta e o Confirmar. */
export function comRevisao(dados: DadosEscala, r: RascunhoRevisao): DadosEscala {
  const revisao = dados.revisao
  if (revisao === undefined) return dados
  const decididas = decisoesDe(dados, r)
  const total = revisao.afetadas.length

  return {
    ...dados,
    revisao: {
      ...revisao,
      afetadas: revisao.afetadas.map((afetada) => ({
        ...afetada,
        acoes: afetada.acoes.map((acao) => ({
          ...acao,
          selecionada: r[afetada.identificador]?.versao === afetada.versao
            && r[afetada.identificador]?.decisao === acao.identificador,
        })),
      })),
      // Sem nada afetado o servidor já disse o que havia para dizer.
      status: total === 0 ? revisao.status : `${decididas.length} de ${total} revisadas`,
      podeConfirmar: decididas.length === total,
    },
  }
}

// --------------------------------------------- domingo extra: quem assume
// O botão do dia nasce com uma pessoa (o servidor manda em `dia.assumir`) e
// "outra pessoa" percorre a equipe, sem ir ao servidor. Quem grava é o
// "Assumir · <nome>" — o segundo toque (ADR 0060).

/** Por domingo, quem o botão escala agora. Vazio = o padrão que o servidor mandou. */
export type RascunhoDomingo = Record<string, string>

/** Quem o "Assumir" deste dia escala: a escolha do dedo, ou o padrão do servidor. */
export function quemAssume(dia: DiaEscala, r: RascunhoDomingo): string | undefined {
  if (dia.assumir === undefined) return undefined
  return r[dia.data] ?? dia.assumir.identificador
}

/** "outra pessoa": anda um na equipe e volta ao começo depois da última. */
export function alternarDomingo(r: RascunhoDomingo, dia: DiaEscala, equipe: Equipe): RascunhoDomingo {
  const atual = quemAssume(dia, r)
  if (atual === undefined || equipe.length < 2) return r
  const proximo = equipe[(equipe.findIndex((p) => p.identificador === atual) + 1) % equipe.length]
  return { ...r, [dia.data]: proximo.identificador }
}

/** Põe no rótulo do botão o nome de quem ele escala agora. */
export function comDomingo(dados: DadosEscala, r: RascunhoDomingo): DadosEscala {
  if (Object.keys(r).length === 0) return dados
  return {
    ...dados,
    dias: dados.dias.map((dia) => {
      const quem = quemAssume(dia, r)
      if (quem === undefined || dia.acao === undefined || quem === dia.assumir?.identificador) return dia
      const nome = dados.equipe.find((p) => p.identificador === quem)?.nome
      if (nome === undefined) return dia
      return { ...dia, acao: { ...dia.acao, rotulo: `Assumir · ${nome.split(' ')[0]}` } }
    }),
  }
}
