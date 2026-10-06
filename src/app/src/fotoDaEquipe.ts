/// <reference types="vite/client" />
// Foto de quem trabalha no balcão: arquivo fixo no build, como a foto de
// catálogo (ADR 0065, estendido pelo ADR 0082). O arquivo se chama pelo nome
// completo (`thiago-mateus.jpg`) ou só pelo primeiro nome (`thiago.jpg`) — o
// completo vence, e é ele que separa dois Atendentes com o mesmo primeiro nome.
import { arquivoDaFoto } from './fotoDoCatalogo'

/** O arquivo que vale para `nome`, entre os que estão na pasta. */
export function escolherFoto(nome: string, naPasta: Record<string, string>): string | undefined {
  const completo = arquivoDaFoto(nome).slice(0, -'.jpg'.length)
  return naPasta[`${completo}.jpg`] ?? naPasta[`${completo.split('-')[0]}.jpg`]
}

let fotos: Record<string, string> | null = null

/** URL da foto no build, ou `undefined` quando ninguém colocou o arquivo ainda. */
export function fotoDaEquipe(nome: string): string | undefined {
  fotos ??= Object.fromEntries(
    Object.entries(import.meta.glob<string>('./imagens/equipe/*.jpg', { eager: true, query: '?url', import: 'default' }))
      .map(([caminho, url]) => [caminho.slice(caminho.lastIndexOf('/') + 1), url]),
  )
  return escolherFoto(nome, fotos)
}
