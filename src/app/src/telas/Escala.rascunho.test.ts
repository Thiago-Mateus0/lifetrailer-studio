import { expect as esperar, test as testar } from 'vitest'

import { escalaFixture, escalaRevisaoFixture } from './Escala.fixture'
import { alteracoesDe, alternarDomingo, alternarTroca, comDomingo, comEdicao, comRevisao,
  decidirTroca, decisoesDe, quemAssume,
  type RascunhoDomingo, type RascunhoEscala, type RascunhoRevisao } from './Escala.rascunho'

const turno = (data: string, qual: 'manha' | 'tarde_noite') =>
  escalaFixture.dias.find((d) => d.data === data)!.turnos.find((t) => t.turno === qual)!
const edicao = (data: string, qual: 'manha' | 'tarde_noite') => turno(data, qual).edicao!
const na = (r: RascunhoEscala, data: string, qual: 'manha' | 'tarde_noite') =>
  comEdicao(escalaFixture, r).dias.find((d) => d.data === data)!.turnos.find((t) => t.turno === qual)!

const { equipe } = escalaFixture
const TERCA = '2026-08-18' // tarde do Paulo, padrão

testar('troca percorre a equipe sem o titular, e depois da última volta ao padrão', () => {
  const e = edicao(TERCA, 'tarde_noite')
  const um = alternarTroca({}, e, equipe)
  esperar(na(um, TERCA, 'tarde_noite')).toMatchObject({ colaborador: 'Marcos', destaque: 'troca', selo: 'troca', nota: 'cobre Paulo' })

  const dois = alternarTroca(um, e, equipe)
  esperar(na(dois, TERCA, 'tarde_noite').colaborador).toBe('Thiago')
  esperar(na(dois, TERCA, 'tarde_noite').acoes[0]).toMatchObject({ rotulo: 'troca: Thiago', selecionada: true })

  const tres = alternarTroca(dois, e, equipe)
  esperar(tres).toEqual({})
  esperar(na(tres, TERCA, 'tarde_noite')).toMatchObject({ colaborador: 'Paulo', destaque: 'padrao' })
})

// ADR 0079: a falta saiu do modo de edição; "veio" ocupa o lugar dela, no dia.
testar('a edição oferece só a troca', () => {
  esperar(na({}, TERCA, 'manha').acoes.map((a) => a.identificador)).toEqual(['troca'])
})

// O titular fica guardado: tirar a troca gravada devolve o turno a ele, e isso
// é uma alteração ("padrao"), não a ausência dela.
testar('desfazer uma troca gravada vai como voltar ao padrão', () => {
  const e = edicao('2026-08-19', 'tarde_noite') // Paulo cobre Thiago
  let r: RascunhoEscala = {}
  while (r[e.identificador]?.tipo !== 'padrao') r = alternarTroca(r, e, equipe)
  esperar(na(r, '2026-08-19', 'tarde_noite')).toMatchObject({ colaborador: 'Thiago', destaque: 'padrao' })
  esperar(alteracoesDe(escalaFixture, r)).toEqual([
    { turno_id: e.identificador, versao: 1, tipo: 'padrao', colaborador_id: null },
  ])
})

testar('hoje não tem botão: a edição só alcança turno com `edicao`', () => {
  const hoje = comEdicao(escalaFixture, {}).dias[0]
  esperar(hoje.turnos.every((t) => t.acoes.length === 0)).toBe(true)
})

testar('Confirmar só acende com alguma mudança', () => {
  esperar(comEdicao(escalaFixture, {}).podeConfirmar).toBe(false)
  esperar(comEdicao(escalaFixture, alternarTroca({}, edicao(TERCA, 'manha'), equipe)).podeConfirmar).toBe(true)
})

// Depois de um LT001 a tela é relida: o turno que outra pessoa gravou volta ao
// que está gravado, e os outros continuam marcados.
testar('escolha feita sobre uma versão velha sai do rascunho', () => {
  const e = edicao(TERCA, 'manha')
  const r = alternarTroca({}, e, equipe)
  const relida = {
    ...escalaFixture,
    dias: escalaFixture.dias.map((d) => ({
      ...d,
      turnos: d.turnos.map((t) => (t.edicao?.identificador === e.identificador ? { ...t, edicao: { ...e, versao: 2 } } : t)),
    })),
  }
  esperar(alteracoesDe(relida, r)).toEqual([])
  esperar(comEdicao(relida, r).dias[1].turnos[0].destaque).toBe('padrao')
})

// ------------------------------------------------- revisão da âncora (0062)
const afetada = escalaRevisaoFixture.revisao!.afetadas[0]
const naRevisao = (r: RascunhoRevisao) => comRevisao(escalaRevisaoFixture, r).revisao!

testar('cada troca afetada decide manter ou voltar ao padrão, e a conta anda', () => {
  esperar(naRevisao({}).podeConfirmar).toBe(false)
  esperar(naRevisao({}).status).toBe('0 de 1 revisadas')

  const r = decidirTroca({}, afetada, 'manter')
  const revisada = naRevisao(r)
  esperar(revisada.status).toBe('1 de 1 revisadas')
  esperar(revisada.podeConfirmar).toBe(true)
  esperar(revisada.afetadas[0].acoes.map((acao) => acao.selecionada)).toEqual([true, false])
  esperar(decisoesDe(escalaRevisaoFixture, r))
    .toEqual([{ turno_id: afetada.identificador, versao: afetada.versao, decisao: 'manter' }])

  // Decidir de novo troca a decisão; ação que não existe não decide nada.
  esperar(naRevisao(decidirTroca(r, afetada, 'padrao')).afetadas[0].acoes.map((a) => a.selecionada))
    .toEqual([false, true])
  esperar(decidirTroca(r, afetada, 'regerar')).toBe(r)
})

// Mesma regra do calendário: a tela relida com outra versão desfaz a decisão,
// porque a troca que estava ali não é mais a que está gravada.
testar('decisão tomada sobre uma versão velha sai da lista', () => {
  const r = decidirTroca({}, afetada, 'manter')
  const relida = {
    ...escalaRevisaoFixture,
    revisao: {
      ...escalaRevisaoFixture.revisao!,
      afetadas: [{ ...afetada, versao: 2 }],
    },
  }
  esperar(decisoesDe(relida, r)).toEqual([])
  esperar(comRevisao(relida, r).revisao!.podeConfirmar).toBe(false)
})

// ------------------------------------------------- domingo extra (ADR 0060)
const domingo = escalaFixture.dias.find((d) => d.data === '2026-08-23')!

testar('"outra pessoa" percorre a equipe e volta ao começo, sem tocar no servidor', () => {
  esperar(quemAssume(domingo, {})).toBe('c-thiago')

  // Thiago é o último da equipe (Marcos · Paulo · Thiago).
  const um = alternarDomingo({}, domingo, escalaFixture.equipe)
  esperar(quemAssume(domingo, um)).toBe('c-marcos')
  const dois = alternarDomingo(um, domingo, escalaFixture.equipe)
  esperar(quemAssume(domingo, dois)).toBe('c-paulo')

  const naTela = (r: RascunhoDomingo) =>
    comDomingo(escalaFixture, r).dias.find((d) => d.data === domingo.data)!.acao!.rotulo
  esperar(naTela({})).toBe('Assumir · Thiago')
  esperar(naTela(um)).toBe('Assumir · Marcos')
})

testar('dia sem botão de assumir não guarda escolha', () => {
  const hoje = escalaFixture.dias[0] // tem ação de presença, não de assumir
  esperar(quemAssume(hoje, {})).toBe(undefined)
  esperar(alternarDomingo({}, hoje, escalaFixture.equipe)).toEqual({})
})
