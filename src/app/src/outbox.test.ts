// A fila de mídia (ADR 0072). O que se prova aqui é a regra: o teto, o
// classificador, a descarga e de quem é a claim. A tela está em App.test.tsx.
import { afterEach as aposCadaTeste, expect as esperar, test as testar, vi as simulacao } from 'vitest'

import { APARELHO_NAO_REGISTRADO, ErroApi } from './api'
import {
  bytesDe, classificar, descarregar, enfileirarMidia, enviarPelaFila, ESPERAS_MS, FilaCheia, naoEnviados,
  ocupacao, reenviar, renovarClaim, TETO_BYTES_FILA, TETO_FOTOS,
} from './outbox'

const claimDe = (colaborador: string) =>
  `cab.${btoa(JSON.stringify({ colaborador_id: colaborador })).replace(/=+$/, '')}.assinatura`
const PAULO = claimDe('c-paulo')
const MARIA = claimDe('c-maria')
const ALVO = { ativo: 'item_execucao' as const, registro: 'item-1', compressao: 'lt1' }
const foto = (bytes = 1000) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

type Resposta = { codigo: number; corpo?: unknown } | 'sem rede'

/** Responde em ordem; a última resposta se repete. Guarda o que foi pedido. */
function servidor(...respostas: Resposta[]) {
  const pedidos: { caminho: string; opcoes: RequestInit }[] = []
  simulacao.stubGlobal('fetch', async (caminho: string, opcoes: RequestInit) => {
    pedidos.push({ caminho, opcoes })
    const r = respostas[Math.min(pedidos.length - 1, respostas.length - 1)]
    if (r === 'sem rede') throw new TypeError('Failed to fetch')
    return { ok: r.codigo < 300, status: r.codigo, text: async () => JSON.stringify(r.corpo ?? {}) } as Response
  })
  return pedidos
}

const CRIADA = { codigo: 201, corpo: { midia_id: 'm', endereco: '/midia/m', bytes: 1000 } }

aposCadaTeste(() => simulacao.unstubAllGlobals())

testar('com rede, a foto sobe na hora com o id da fila, e os bytes saem do tablet', async () => {
  const pedidos = servidor(CRIADA)
  const { item, erro } = await enviarPelaFila(PAULO, ALVO, foto())

  esperar(erro).toBeNull()
  esperar(item.estado).toBe('enviado')
  esperar(await bytesDe(item.id)).toBeNull()
  esperar(pedidos[0].caminho).toBe(`/midia?ativo=item_execucao&registro=item-1&compressao=lt1&id=${item.id}`)
  esperar((pedidos[0].opcoes.headers as Record<string, string>).authorization).toBe(`Bearer ${PAULO}`)
  esperar(await ocupacao()).toEqual({ fotos: 0, bytes: 0 })
})

testar('sem rede, a foto fica na fila e espera 1 minuto para a próxima tentativa', async () => {
  servidor('sem rede')
  const { item } = await enviarPelaFila(PAULO, ALVO, foto(), () => 1_000)

  esperar(item.estado).toBe('pendente')
  esperar(item.tentativas).toBe(1)
  esperar(item.proxima_em).toBe(1_000 + ESPERAS_MS[0])
  esperar((await bytesDe(item.id))?.size).toBe(1000)
})

testar('a descarga respeita a espera, e sobe quando a rede volta', async () => {
  servidor('sem rede')
  await enviarPelaFila(PAULO, ALVO, foto(), () => 0)

  const pedidos = servidor(CRIADA)
  esperar(await descarregar(() => ESPERAS_MS[0] - 1)).toEqual({ enviados: 0, aparelhoRecusado: false })
  esperar(pedidos).toHaveLength(0)

  esperar(await descarregar(() => ESPERAS_MS[0])).toEqual({ enviados: 1, aparelhoRecusado: false })
  esperar(await naoEnviados()).toHaveLength(0)
})

testar('a descarga manda a claim de quem tirou a foto, não a de quem está logado', async () => {
  servidor('sem rede')
  await enfileirarMidia(PAULO, ALVO, foto(), 0)
  const pedidos = servidor(CRIADA)
  await descarregar(() => 0)
  esperar((pedidos[0].opcoes.headers as Record<string, string>).authorization).toBe(`Bearer ${PAULO}`)
})

testar('o classificador da §6', () => {
  esperar(classificar(new ErroApi(401, 'claim expirada'), 0).mudanca.estado).toBe('caducou')
  esperar(classificar(new ErroApi(409, 'ja tem foto', 'LT002'), 0).mudanca.estado).toBe('invalida')
  esperar(classificar(new ErroApi(409, 'nao existe', 'LT003'), 0).mudanca.estado).toBe('invalida')
  esperar(classificar(new ErroApi(413, 'foto grande demais'), 0).mudanca.estado).toBe('invalida')
  esperar(classificar(new ErroApi(415, 'so image/jpeg'), 0).mudanca.estado).toBe('invalida')

  // Aparelho revogado: a fila inteira para.
  esperar(classificar(new ErroApi(401, APARELHO_NAO_REGISTRADO), 0)).toMatchObject({ mudanca: { estado: 'invalida' }, pararFila: true })
  esperar(classificar(new ErroApi(403, 'revogado'), 0).pararFila).toBe(true)

  // Transitória: a escada inteira, e depois `parada`.
  for (let feitas = 0; feitas < ESPERAS_MS.length; feitas += 1) {
    const { mudanca } = classificar(new ErroApi(503, 'storage fora'), feitas, 0)
    esperar(mudanca).toMatchObject({ tentativas: feitas + 1, proxima_em: ESPERAS_MS[feitas] })
    esperar(mudanca.estado).toBeUndefined()
  }
  esperar(classificar(new TypeError('Failed to fetch'), ESPERAS_MS.length).mudanca.estado).toBe('parada')
})

testar('o teto de fotos bloqueia a captura, e o que já subiu não conta', async () => {
  servidor(CRIADA)
  await enviarPelaFila(PAULO, ALVO, foto())
  servidor('sem rede')
  for (let i = 0; i < TETO_FOTOS; i += 1) await enfileirarMidia(PAULO, ALVO, foto(10))

  const recusa = await enfileirarMidia(PAULO, ALVO, foto(10)).catch((erro) => erro)
  esperar(recusa).toBeInstanceOf(FilaCheia)
  esperar(recusa.fotos).toBe(TETO_FOTOS)
  esperar(await naoEnviados()).toHaveLength(TETO_FOTOS)
})

testar('o teto de bytes também bloqueia', async () => {
  servidor('sem rede')
  await enfileirarMidia(PAULO, ALVO, foto(TETO_BYTES_FILA - 10))
  await esperar(enfileirarMidia(PAULO, ALVO, foto(11))).rejects.toBeInstanceOf(FilaCheia)
})

testar('a mesma pessoa entrando de novo leva as fotos dela que caducaram', async () => {
  servidor({ codigo: 401, corpo: { erro: 'claim expirada' } })
  await enviarPelaFila(PAULO, ALVO, foto())
  await enviarPelaFila(MARIA, ALVO, foto())
  esperar((await naoEnviados()).map((i) => i.estado)).toEqual(['caducou', 'caducou'])

  const PAULO_DE_NOVO = claimDe('c-paulo') + 'nova'
  await renovarClaim(PAULO_DE_NOVO)
  const [doPaulo, daMaria] = await naoEnviados()
  esperar(doPaulo).toMatchObject({ estado: 'pendente', claim: PAULO_DE_NOVO, colaborador_id: 'c-paulo' })
  esperar(daMaria).toMatchObject({ estado: 'caducou', claim: MARIA })
})

testar('reenviar a foto que caducou assina com quem reenviou', async () => {
  servidor({ codigo: 401, corpo: { erro: 'claim expirada' } })
  const { item } = await enviarPelaFila(PAULO, ALVO, foto())

  await reenviar(item.id, MARIA)
  esperar((await naoEnviados())[0]).toMatchObject({ estado: 'pendente', claim: MARIA, colaborador_id: 'c-maria' })
})

testar('reenviar a foto inválida de outra pessoa não troca a autoria', async () => {
  servidor({ codigo: 409, corpo: { erro: 'nao existe', code: 'LT003' } })
  const { item } = await enviarPelaFila(PAULO, ALVO, foto())
  esperar(item.estado).toBe('invalida')

  await reenviar(item.id, MARIA)
  esperar((await naoEnviados())[0]).toMatchObject({ estado: 'pendente', claim: PAULO, colaborador_id: 'c-paulo' })
})

testar('aparelho revogado para a descarga no primeiro item', async () => {
  servidor('sem rede')
  await enfileirarMidia(PAULO, ALVO, foto(), 0)
  await enfileirarMidia(PAULO, ALVO, foto(), 1)
  const pedidos = servidor({ codigo: 401, corpo: { erro: APARELHO_NAO_REGISTRADO } })

  esperar(await descarregar(() => 0)).toEqual({ enviados: 0, aparelhoRecusado: true })
  esperar(pedidos).toHaveLength(1)
  esperar((await naoEnviados()).map((i) => i.estado)).toEqual(['invalida', 'pendente'])
})
