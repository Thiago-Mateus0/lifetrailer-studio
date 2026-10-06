// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { escolherFoto } from './fotoDaEquipe'
import { TETO_FOTO_BYTES } from './fotoDoCatalogo'

describe('escolherFoto', () => {
  const pasta = { 'dev.jpg': '/t.jpg', 'paulo-duarte.jpg': '/jd.jpg', 'marcos.jpg': '/e.jpg' }

  it('acha pelo primeiro nome', () => {
    expect(escolherFoto('Dev', pasta)).toBe('/t.jpg')
    expect(escolherFoto('Marcos', pasta)).toBe('/e.jpg')
  })

  it('o nome completo vence o primeiro nome', () => {
    expect(escolherFoto('Paulo Duarte', { ...pasta, 'paulo.jpg': '/j.jpg' })).toBe('/jd.jpg')
  })

  it('sem arquivo, sem foto', () => {
    expect(escolherFoto('Maria', pasta)).toBeUndefined()
    expect(escolherFoto('Paulo Silva', pasta)).toBeUndefined()
  })
})

describe('pasta de fotos da equipe', () => {
  it('só tem .jpg dentro do teto', async () => {
    const { readdirSync: listar, statSync: medir } = await vi.importActual<{
      readdirSync: (pasta: URL) => string[]
      statSync: (arquivo: URL) => { size: number }
    }>('node:fs')
    const pasta = new URL('./imagens/equipe/', import.meta.url)

    for (const arquivo of listar(pasta)) {
      expect(arquivo).toMatch(/^[a-z0-9-]+\.jpg$/)
      expect(medir(new URL(arquivo, pasta)).size, arquivo).toBeLessThanOrEqual(TETO_FOTO_BYTES)
    }
  })
})
