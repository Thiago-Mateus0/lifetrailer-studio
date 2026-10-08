// A outbox do tablet (ADR 0011 §4, ADR 0021, ADR 0072).
//
// Hoje só a foto usa. A forma já é a genérica — um item com estado, tentativas e
// classe de falha — porque as RPC de JSON entram depois na mesma tabela, como
// segundo cliente (ADR 0072 §1).
//
// A foto passa SEMPRE por aqui, com rede ou sem. Com rede, a descarga sai na
// hora e a tela espera por ela; não existe um caminho direto ao lado.
import Dexie, { type Table } from 'dexie'

import { aparelhoRecusado, colaboradorDaClaim, enviarMidia, ErroApi, MIME_MIDIA, type AtivoDeMidia } from './api'

export type EstadoNaFila = 'pendente' | 'enviado' | 'parada' | 'caducou' | 'invalida'

export type ItemDaFila = {
  /** uuid do tablet: token de operação e id da linha de `midia` (§3). */
  id: string
  tipo: 'midia'
  ativo: AtivoDeMidia
  registro: string
  compressao: string
  /** Do JPEG já comprimido. Os bytes moram em `bytes`, e saem quando o servidor confirma (§4). */
  tamanho: number
  /** A claim de quem tirou a foto (§5). Sem claim é sessão por senha, que vai por cookie. */
  claim?: string
  colaborador_id: string | null
  estado: EstadoNaFila
  tentativas: number
  proxima_em: number
  erro: string | null
  criado_em: number
}

// Os bytes ficam numa tabela à parte: só nascem e somem, nunca são reescritos
// junto com o estado do item a cada tentativa.
type BytesDaFila = { id: string; dados: ArrayBuffer }

class BancoDaFila extends Dexie {
  itens!: Table<ItemDaFila, string>
  bytes!: Table<BytesDaFila, string>

  constructor() {
    super('lt-outbox')
    this.version(1).stores({ itens: 'id, estado, criado_em', bytes: 'id' })
  }
}

const banco = new BancoDaFila()

// ADR 0026 §4: 60 fotos ou 50 MB, o que vier primeiro.
export const TETO_FOTOS = 60
export const TETO_BYTES_FILA = 50 * 1024 * 1024

/** ADR 0021 §1: 1min · 5min · 15min · 1h · 6h, e depois `parada`. */
export const ESPERAS_MS = [1, 5, 15, 60, 360].map((minutos) => minutos * 60_000)

/** A captura bloqueia no teto, e nenhuma foto antiga sai para abrir espaço (§2). */
export class FilaCheia extends Error {
  constructor(readonly fotos: number, readonly bytes: number) {
    super(`A fila de fotos está cheia: ${fotos} fotos esperando para subir. Espere a internet voltar para tirar outra.`)
    this.name = 'FilaCheia'
  }
}

// ---------------------------------------------------------- quem observa
// A bandeja e o aviso de "fotos na fila" leem daqui. Sem dexie-react-hooks: é
// uma dependência para trocar um callback.
type Observador = (itens: ItemDaFila[]) => void
const observadores = new Set<Observador>()

export const naoEnviados = () => banco.itens.where('estado').notEqual('enviado').sortBy('criado_em')

async function avisar() {
  if (observadores.size === 0) return
  const itens = await naoEnviados()
  for (const observador of observadores) observador(itens)
}

export function observarFila(observador: Observador) {
  observadores.add(observador)
  void naoEnviados().then(observador)
  return () => {
    observadores.delete(observador)
  }
}

// ---------------------------------------------------------------- o teto
/** O que ainda guarda bytes: tudo menos o que já foi enviado. */
export async function ocupacao() {
  const itens = await banco.itens.where('estado').notEqual('enviado').toArray()
  return { fotos: itens.length, bytes: itens.reduce((soma, item) => soma + item.tamanho, 0) }
}

/** Para a bandeja mostrar a foto parada. */
export async function bytesDe(id: string) {
  const guardados = await banco.bytes.get(id)
  return guardados === undefined ? null : new Blob([guardados.dados], { type: MIME_MIDIA })
}

type Alvo = { ativo: AtivoDeMidia; registro: string; compressao: string }

export async function enfileirarMidia(claim: string | undefined, alvo: Alvo, foto: Blob, agora = Date.now()) {
  const { fotos, bytes } = await ocupacao()
  if (fotos + 1 > TETO_FOTOS || bytes + foto.size > TETO_BYTES_FILA) throw new FilaCheia(fotos, bytes)

  const item: ItemDaFila = {
    id: crypto.randomUUID(),
    tipo: 'midia',
    ...alvo,
    tamanho: foto.size,
    claim,
    colaborador_id: colaboradorDaClaim(claim),
    estado: 'pendente',
    tentativas: 0,
    proxima_em: 0,
    erro: null,
    criado_em: agora,
  }
  const dados = await foto.arrayBuffer()
  await banco.transaction('rw', banco.itens, banco.bytes, async () => {
    await banco.itens.add(item)
    await banco.bytes.add({ id: item.id, dados })
  })
  await avisar()
  return item.id
}

// ------------------------------------------------------ o classificador (§6)
type Desfecho = { mudanca: Partial<ItemDaFila>; pararFila: boolean }

export function classificar(erro: unknown, tentativas: number, agora = Date.now()): Desfecho {
  if (erro instanceof ErroApi) {
    // Aparelho revogado (ADR 0048): nenhum item deste tablet vai passar.
    if (aparelhoRecusado(erro) || erro.codigo === 403) {
      return { mudanca: { estado: 'invalida', erro: 'Este tablet não está mais registrado.' }, pararFila: true }
    }
    if (erro.codigo === 401) {
      return { mudanca: { estado: 'caducou', erro: 'O turno de quem tirou a foto acabou antes dela subir.' }, pararFila: false }
    }
    if (erro.codigo < 500) {
      return { mudanca: { estado: 'invalida', erro: erro.message }, pararFila: false }
    }
  }

  // Sem rede, timeout, 5xx: transitória.
  const feitas = tentativas + 1
  const erroLegivel = erro instanceof ErroApi ? erro.message : 'Sem conexão com o sistema.'
  if (feitas > ESPERAS_MS.length) {
    return { mudanca: { estado: 'parada', tentativas: feitas, erro: erroLegivel }, pararFila: false }
  }
  return {
    mudanca: { tentativas: feitas, proxima_em: agora + ESPERAS_MS[feitas - 1], erro: erroLegivel },
    pararFila: false,
  }
}

// ------------------------------------------------------------ a descarga
// Um item nunca sobe duas vezes ao mesmo tempo: a descarga do fundo e a da tela
// podem se cruzar.
const emVoo = new Set<string>()

/** Tenta um item. Devolve o erro cru (para a tela decidir se sai da sessão) e se a fila deve parar. */
async function tentar(id: string, agora: () => number): Promise<{ erro: unknown; pararFila: boolean }> {
  if (emVoo.has(id)) return { erro: null, pararFila: false }
  const item = await banco.itens.get(id)
  const foto = await bytesDe(id)
  if (item === undefined || item.estado !== 'pendente' || foto === null) return { erro: null, pararFila: false }

  emVoo.add(id)
  try {
    await enviarMidia(
      item.claim,
      { ativo: item.ativo, registro: item.registro, compressao: item.compressao, id: item.id },
      foto,
    )
    // §4: a linha fica, os bytes saem.
    await banco.transaction('rw', banco.itens, banco.bytes, async () => {
      await banco.itens.update(id, { estado: 'enviado', erro: null })
      await banco.bytes.delete(id)
    })
    return { erro: null, pararFila: false }
  } catch (erro) {
    const { mudanca, pararFila } = classificar(erro, item.tentativas, agora())
    await banco.itens.update(id, mudanca)
    return { erro, pararFila }
  } finally {
    emVoo.delete(id)
    await avisar()
  }
}

/**
 * O caminho da tela: enfileira e tenta na hora. A tela espera por isto como
 * esperava pelo envio direto. `FilaCheia` sobe antes de qualquer envio.
 */
export async function enviarPelaFila(claim: string | undefined, alvo: Alvo, foto: Blob, agora = Date.now) {
  const id = await enfileirarMidia(claim, alvo, foto, agora())
  const { erro } = await tentar(id, agora)
  return { item: (await banco.itens.get(id))!, erro }
}

let descarregando: Promise<{ enviados: number; aparelhoRecusado: boolean }> | null = null

/** A descarga do fundo: ao abrir o app, quando a rede volta, e de tempos em tempos. */
export function descarregar(agora = Date.now) {
  descarregando ??= (async () => {
    let enviados = 0
    try {
      const prontos = (await banco.itens.where('estado').equals('pendente').sortBy('criado_em'))
        .filter((item) => item.proxima_em <= agora())
      for (const item of prontos) {
        const { erro, pararFila } = await tentar(item.id, agora)
        if (pararFila) return { enviados, aparelhoRecusado: true }
        if (erro === null && (await banco.itens.get(item.id))?.estado === 'enviado') enviados += 1
      }
      return { enviados, aparelhoRecusado: false }
    } finally {
      descarregando = null
    }
  })()
  return descarregando
}

// -------------------------------------------------- saindo da bandeja (§5, §7)
/** Quem entra de novo leva as fotos dele que caducaram, com a claim nova. */
export async function renovarClaim(claim: string | undefined) {
  const colaborador = colaboradorDaClaim(claim)
  if (colaborador === null) return
  await banco.itens
    .where('estado').equals('caducou')
    .filter((item) => item.colaborador_id === colaborador)
    .modify({ estado: 'pendente', claim, tentativas: 0, proxima_em: 0, erro: null })
  await avisar()
}

/**
 * "Reenviar" da bandeja. Seguro porque o envio é idempotente pelo id (§3).
 * A foto que caducou, reenviada por outra pessoa, sobe com o nome de quem
 * reenviou: ela viu a foto e assina por ela (ADR 0021 §3).
 */
export async function reenviar(id: string, claim: string | undefined) {
  const item = await banco.itens.get(id)
  if (item === undefined || item.estado === 'pendente' || item.estado === 'enviado') return
  const quem = colaboradorDaClaim(claim)
  const assume = item.estado === 'caducou' || item.colaborador_id === quem
  await banco.itens.update(id, {
    estado: 'pendente',
    tentativas: 0,
    proxima_em: 0,
    erro: null,
    ...(assume ? { claim, colaborador_id: quem } : {}),
  })
  await avisar()
}

/** Só para os testes: a fila de um teste não vaza para o seguinte. */
export async function esvaziarParaTeste() {
  await Promise.all([banco.itens.clear(), banco.bytes.clear()])
  emVoo.clear()
  descarregando = null
}
