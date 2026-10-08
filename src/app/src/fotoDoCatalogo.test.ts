// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { arquivoDaFoto, TETO_FOTO_BYTES } from './fotoDoCatalogo'

describe('arquivoDaFoto', () => {
  it('tira acento, símbolo e maiúscula', () => {
    expect(arquivoDaFoto('Água mineral sem gás 500ml')).toBe('agua-mineral-sem-gas-500ml.jpg')
    expect(arquivoDaFoto('Pringles & Ruffles tubo 100g')).toBe('pringles-ruffles-tubo-100g.jpg')
    expect(arquivoDaFoto('Canon 6D + 50mm 1.4')).toBe('canon-6d-50mm-1-4.jpg')
    expect(arquivoDaFoto('"Propés"')).toBe('propes.jpg')
  })
})

// Foto de celular crua tem megabytes e iria inteira pro build de todo tablet.
// `node scripts/fotos-catalogo.mjs --encolher` resolve antes do commit.
describe('pasta de fotos do catálogo', () => {
  it('só tem .jpg dentro do teto', async () => {
    const { readdirSync: listar, statSync: medir } = await vi.importActual<{
      readdirSync: (pasta: URL) => string[]
      statSync: (arquivo: URL) => { size: number }
    }>('node:fs')
    const pasta = new URL('./imagens/catalogo/', import.meta.url)

    for (const arquivo of listar(pasta).filter((nome) => nome !== '.gitkeep')) {
      expect(arquivo).toMatch(/^[a-z0-9-]+\.jpg$/)
      expect(medir(new URL(arquivo, pasta)).size, arquivo).toBeLessThanOrEqual(TETO_FOTO_BYTES)
    }
  })
})
