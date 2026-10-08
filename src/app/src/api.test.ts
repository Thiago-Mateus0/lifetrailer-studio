// O cliente da rota de mídia (ADR 0051). O resto do api.ts é exercitado pela
// App.test.tsx, que passa por ele em toda tela; a foto tem teste próprio porque
// é a única chamada que não é JSON.
import { afterEach as aposCadaTeste, beforeEach as antesDeCadaTeste, expect as esperar, test as testar, vi as simulacao } from 'vitest'

import { enviarMidia, ErroApi } from './api'

const CHAVE = 'chave-do-tablet-de-teste'
const ITEM = '44444444-4444-4444-8444-444444444444'

antesDeCadaTeste(() => localStorage.setItem('lt-dispositivo', CHAVE))
aposCadaTeste(() => {
  simulacao.unstubAllGlobals()
  localStorage.clear()
})

function simularServidor(resposta: { codigo?: number; corpo: unknown }) {
  const pedidos: { caminho: string; opcoes: RequestInit }[] = []
  simulacao.stubGlobal('fetch', async (caminho: string, opcoes: RequestInit = {}) => {
    pedidos.push({ caminho, opcoes })
    const { codigo = 200, corpo } = resposta
    return {
      ok: codigo >= 200 && codigo < 300,
      status: codigo,
      text: async () => JSON.stringify(corpo),
    } as Response
  })
  return pedidos
}

const FOTO = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })

testar('enviarMidia manda os bytes no corpo e os metadados na query string', async () => {
  const pedidos = simularServidor({
    codigo: 201,
    corpo: { midia_id: 'm-1', endereco: '/midia/m-1?t=abc', bytes: 3 },
  })

  const r = await enviarMidia('claim.de.teste', { ativo: 'item_execucao', registro: ITEM, compressao: 'lt1' }, FOTO)
  esperar(r.endereco).toBe('/midia/m-1?t=abc')

  const [pedido] = pedidos
  esperar(pedido.caminho).toBe(`/midia?ativo=item_execucao&registro=${ITEM}&compressao=lt1`)
  esperar(pedido.opcoes.method).toBe('POST')
  // O corpo é o Blob, não JSON: um `JSON.stringify` aqui subiria "[object Blob]".
  esperar(pedido.opcoes.body).toBe(FOTO)

  const cabecalhos = pedido.opcoes.headers as Record<string, string>
  esperar(cabecalhos['content-type']).toBe('image/jpeg')
  esperar(cabecalhos.authorization).toBe('Bearer claim.de.teste')
  // A chave do tablet vai junto como em qualquer outra chamada (ADR 0048).
  esperar(cabecalhos['x-lt-dispositivo']).toBe(CHAVE)
})

testar('enviarMidia omite a compressao quando ela nao foi declarada', async () => {
  const pedidos = simularServidor({ codigo: 201, corpo: { midia_id: 'm-1', endereco: '/x', bytes: 3 } })
  await enviarMidia(undefined, { ativo: 'achado', registro: ITEM }, FOTO)
  esperar(pedidos[0].caminho).toBe(`/midia?ativo=achado&registro=${ITEM}`)
  esperar((pedidos[0].opcoes.headers as Record<string, string>).authorization).toBe(undefined)
})

testar('foto recusada pelo servidor vira ErroApi com o codigo, pra tela pedir outra', async () => {
  simularServidor({ codigo: 413, corpo: { erro: 'foto grande demais' } })
  await esperar(enviarMidia('c', { ativo: 'achado', registro: ITEM }, FOTO)).rejects.toThrow(ErroApi)

  simularServidor({ codigo: 409, corpo: { erro: 'este item ja tem foto; correcao anexa nova', code: 'LT002' } })
  await esperar(enviarMidia('c', { ativo: 'item_execucao', registro: ITEM }, FOTO))
    .rejects.toMatchObject({ codigo: 409, dominio: 'LT002' })
})
