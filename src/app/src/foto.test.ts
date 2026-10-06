// O compressor do ADR 0026. O que se testa aqui é a REGRA — o tamanho alvo e a
// escada de qualidade; o desenho no canvas é chamada de navegador, e jsdom não
// tem canvas pra exercitar.
import { expect as esperar, test as testar } from 'vitest'

import { ALVO_BYTES, FotoRecusada, LADO_MAX, medida, melhorQualidade, QUALIDADES, TETO_BYTES } from './foto'

const blobDe = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

testar('medida reduz o maior lado a 1600 e mantém a proporção', () => {
  esperar(medida(4000, 3000)).toEqual({ largura: LADO_MAX, altura: 1200 })
  esperar(medida(3000, 4000)).toEqual({ largura: 1200, altura: LADO_MAX })
})

testar('medida só reduz: foto menor que o limite sobe como saiu', () => {
  esperar(medida(800, 600)).toEqual({ largura: 800, altura: 600 })
  esperar(medida(LADO_MAX, 900)).toEqual({ largura: LADO_MAX, altura: 900 })
})

testar('a primeira qualidade que couber no alvo é a que vai', async () => {
  const tentadas: number[] = []
  const saida = await melhorQualidade(async (qualidade) => {
    tentadas.push(qualidade)
    return blobDe(qualidade > 0.66 ? ALVO_BYTES + 1 : ALVO_BYTES - 1)
  })

  esperar(tentadas).toEqual([QUALIDADES[0], QUALIDADES[1]])
  esperar(saida.size).toBe(ALVO_BYTES - 1)
})

testar('nenhuma coube no alvo mas a última cabe no teto: sobe assim mesmo', async () => {
  const tentadas: number[] = []
  const saida = await melhorQualidade(async (qualidade) => {
    tentadas.push(qualidade)
    return blobDe(TETO_BYTES - 1)
  })

  esperar(tentadas).toEqual(QUALIDADES)
  esperar(saida.size).toBe(TETO_BYTES - 1)
})

testar('acima de 1 MB depois da escada inteira, recusa e pede outra foto', async () => {
  await esperar(melhorQualidade(async () => blobDe(TETO_BYTES + 1))).rejects.toThrow(FotoRecusada)
})
