import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { podeRecarregarSozinho, useVersaoNova, VERSAO_DO_APP, versaoPublicada } from './versao'

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

const servidorResponde = (resposta: () => Promise<Response>) => {
  const buscar = vi.fn(resposta)
  vi.stubGlobal('fetch', buscar)
  return buscar
}

test('le a versao publicada sem cache', async () => {
  const buscar = servidorResponde(async () => Response.json({ versao: 'x' }))
  expect(await versaoPublicada()).toBe('x')
  expect(buscar).toHaveBeenCalledWith('/versao.json', { cache: 'no-store' })
})

test('sem versao.json (dev devolve o index.html) nao e versao nova', async () => {
  servidorResponde(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
  expect(await versaoPublicada()).toBeNull()
})

test('rede caida nao e versao nova', async () => {
  servidorResponde(async () => { throw new TypeError('Failed to fetch') })
  expect(await versaoPublicada()).toBeNull()
})

test('a mesma versao do bundle nao avisa; outra avisa', async () => {
  servidorResponde(async () => Response.json({ versao: VERSAO_DO_APP }))
  const igual = renderHook(() => useVersaoNova())
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(igual.result.current).toBe(false)

  servidorResponde(async () => Response.json({ versao: 'deploy-de-depois' }))
  const outra = renderHook(() => useVersaoNova())
  await waitFor(() => expect(outra.result.current).toBe(true))
})

// O tablet com o bundle velho em cache recarregava, voltava no mesmo bundle e
// recarregava de novo: a Entrada piscando sem parar (06/10).
test('recarrega sozinho uma vez por bundle; na segunda, so avisa', () => {
  expect(podeRecarregarSozinho()).toBe(true)
  expect(podeRecarregarSozinho()).toBe(false)
})

test('sem sessionStorage, nao recarrega sozinho', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
  expect(podeRecarregarSozinho()).toBe(false)
  vi.restoreAllMocks()
})
