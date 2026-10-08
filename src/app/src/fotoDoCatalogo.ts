/// <reference types="vite/client" />
// Foto de catálogo: a imagem fixa de um item (Bomboniere, fundo, equipamento,
// insumo), que vai no build do app — não é Mídia (ADR 0065). O arquivo se chama
// pelo nome do item, então o Doritos da Comanda e o do Estoque, que são a mesma
// linha de `item_bomboniere`, usam a mesma foto sem cadastro nenhum.
//
// `scripts/fotos-catalogo.mjs` importa `arquivoDaFoto` direto deste arquivo, pelo
// Node, pra listar o que falta — por isso o glob do Vite só roda dentro da função.

/** A maior tela que mostra a foto é a ampliada do Estoque, de 420px. */
export const LADO_FOTO = 600
export const TETO_FOTO_BYTES = 150 * 1024

/** "Água mineral sem gás 500ml" → "agua-mineral-sem-gas-500ml.jpg". */
export function arquivoDaFoto(nome: string): string {
  const base = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${base}.jpg`
}

let fotos: Record<string, string> | null = null

/** URL da foto no build, ou `undefined` quando ninguém colocou o arquivo ainda. */
export function fotoDoCatalogo(nome: string): string | undefined {
  fotos ??= Object.fromEntries(
    Object.entries(import.meta.glob<string>('./imagens/catalogo/*.jpg', { eager: true, query: '?url', import: 'default' }))
      .map(([caminho, url]) => [caminho.slice(caminho.lastIndexOf('/') + 1), url]),
  )
  return fotos[arquivoDaFoto(nome)]
}
