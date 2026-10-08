import { useCallback, useEffect, useState } from 'react'

import {
  abrirSessao,
  aparelhoRecusado,
  buscarEntrada,
  entrarComSenha,
  guardarChaveDoAparelho,
  lerSessaoPorSenha,
  sairDaSessaoPorSenha,
  lerChaveDoAparelho,
  buscarHome,
  buscarTela,
  chamarRpc,
  ErroApi,
  enviarComprovante,
  guardarComprovante,
  type DadosEntradaDoServidor,
  type DadosPorTela,
  type DadosSidebarDoServidor,
  type AtivoDeMidia,
  type Sessao,
} from './api'
import { comprimirFoto, FotoRecusada, VERSAO_COMPRESSAO } from './foto'
import { Moldura } from './layout/Moldura'
import { SalasDoEstudio } from './layout/SalasDoEstudio'
import { bytesDe, descarregar, enviarPelaFila, FilaCheia, observarFila, reenviar, renovarClaim, type ItemDaFila } from './outbox'
import { Achados, type DadosAchados, type DetalheAchado, type EscolhaAchado } from './telas/Achados'
import { Ajustes, type AvisoDeSenha, type DadosAjustes } from './telas/Ajustes'
import { AvisoUrgente, type AvisoUrgenteApresentado } from './telas/AvisoUrgente'
import { Avisos, type AcaoCategoria, type AcaoEdicaoAviso, type DadosAvisos } from './telas/Avisos'
import { Checklist, type DadosChecklist, type ItemChecklist, type ModalChecklist } from './telas/Checklist'
import { Comanda, type DetalheComanda, type LinhaNova, type PraticadoComanda } from './telas/Comanda'
import { DescargaPendente, type FotoNaFila } from './telas/DescargaPendente'
import { Entrada, type TeclaEntrada } from './telas/Entrada'
import { Escala, type DadosEscala } from './telas/Escala'
import { alteracoesDe, alternarDomingo, alternarTroca, comDomingo, comEdicao, comRevisao,
  decidirTroca, decisoesDe, quemAssume,
  type RascunhoDomingo, type RascunhoEscala, type RascunhoRevisao } from './telas/Escala.rascunho'
import { Estoque, type DadosEstoque, type FichaAberta, type Renomeacao } from './telas/Estoque'
import { Home, type DadosHome, type ItemChecklistHome } from './telas/Home'
import { HorasExtras } from './telas/HorasExtras'
import type { DadosHorasExtras, HoraExtraApresentada } from './telas/HorasExtras'
import { Sidebar } from './telas/Sidebar'
import { Treinamento, type DadosTreinamento } from './telas/Treinamento'
import { podeRecarregarSozinho, useVersaoNova } from './versao'

// Entrada e login têm fundo escuro (tinta branca); Sidebar tem fundo claro (tinta
// escura). O "-dark.png" do design é a tinta ESCURA, apesar do nome.
const LOGO_TINTA_BRANCA = new URL(
  '../../../docs/design/mockups/fase3/logo-lifetrailer-transparent.png',
  import.meta.url,
).href
const LOGO_TINTA_ESCURA = new URL(
  '../../../docs/design/mockups/fase3/logo-lifetrailer-dark.png',
  import.meta.url,
).href

// O jsPDF e a fonte só descem quando a Comanda com comprovante abre — só a do
// Admin traz um (ADR 0073 §1). No toque em Copiar, o módulo já está na memória.
let comprovante: Promise<typeof import('./comprovante')> | null = null
const carregarComprovante = () => (comprovante ??= import('./comprovante'))

const DIGITOS_DO_PIN = 4

// O teclado é interface, não dado de banco: nasce aqui e não gasta uma ida à rede.
const TECLAS: TeclaEntrada[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((rotulo) => ({
    identificador: rotulo,
    rotulo,
    tipo: 'numero' as const,
  })),
  { identificador: 'limpar', rotulo: 'limpar', tipo: 'acao' },
  { identificador: '0', rotulo: '0', tipo: 'numero' },
  { identificador: 'apagar', rotulo: '←', descricao: 'Apagar último dígito', tipo: 'acao' },
]

const MENSAGEM = {
  normal: 'Quatro dígitos',
  incorreto: 'PIN incorreto. Tente de novo.',
  // app.sessao_abrir devolve 'bloqueado' antes de conferir o hash — colaborador
  // bloqueado não responde sobre o PIN (migration 0034).
  bloqueado: 'Entrada bloqueada. Chame o Admin.',
  // PIN certo, mas não há turno na Escala agora (0043): a claim nasce do turno.
  sem_turno: 'Nenhum turno na Escala agora. Chame o Admin.',
} as const

type Situacao = keyof typeof MENSAGEM

/**
 * Para onde o menu leva. O identificador do item da Sidebar é `modulo` ou
 * `modulo-aba` ('estoque-compra'): a aba é estado de interação da tela, então
 * viaja aqui e não gera uma segunda rota no servidor.
 */
type Destino = { modulo: string; aba?: string; recorte?: Record<string, string> }

const INICIO: Destino = { modulo: 'inicio' }

// Da largura de 1024px pra cima o menu aberto ganha coluna própria (tokens.css)
// e não cobre a tela: navegar o deixa aberto. Abaixo disso ele cobre e fecha.
function menuTemColunaPropria(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches
}

function destinoDe(identificador: string): Destino {
  const corte = identificador.indexOf('-')
  return corte === -1
    ? { modulo: identificador }
    : { modulo: identificador.slice(0, corte), aba: identificador.slice(corte + 1) }
}

/**
 * Módulo do menu → a tela que o servidor monta pra ele, e o nome do parâmetro
 * em que a aba viaja. Módulo fora daqui ainda não tem tela ligada.
 */
const TELAS_LIGADAS: Partial<Record<string, { nome: TelaDeModulo; parametro: string }>> = {
  checklist: { nome: 'checklist', parametro: 'fase' },
  comanda: { nome: 'comanda', parametro: 'modo' },
  estoque: { nome: 'estoque', parametro: 'aba' },
  escala: { nome: 'escala', parametro: 'visao' },
  horas: { nome: 'horas', parametro: 'aba' },
  achados: { nome: 'achados', parametro: 'aba' },
  avisos: { nome: 'avisos', parametro: 'aba' },
  ajustes: { nome: 'ajustes', parametro: 'aba' },
  // Sem aba: o item do menu não tem subitens, e o recorte da busca e do
  // tutorial aberto viaja por `recorte`, não pelo parâmetro de aba.
  treinamento: { nome: 'treinamento', parametro: 'aba' },
}

type TelaDeModulo = Exclude<keyof DadosPorTela, 'home' | 'sidebar'>

/** O que chegou do servidor, e pra qual destino — pra não desenhar a aba velha. */
type TelaCarregada = {
  [N in TelaDeModulo]: { nome: N; chave: string; dados: DadosPorTela[N] }
}[TelaDeModulo]

// A busca fica fora da chave: a lista anterior segue na tela enquanto a nova
// vem, sem remontar o campo (no tablet, remontar fecha o teclado a cada letra).
const chaveDe = (destino: Destino) => {
  const { busca: _busca, ...recorte } = destino.recorte ?? {}
  return `${destino.modulo}-${destino.aba ?? ''}-${new URLSearchParams(recorte).toString()}`
}

/** O recorte do destino como a query string que a tela do servidor lê. */
function parametrosDe(destino: Destino): Record<string, string> {
  const ligada = TELAS_LIGADAS[destino.modulo]
  return {
    ...destino.recorte,
    ...(destino.aba === undefined || ligada === undefined ? {} : { [ligada.parametro]: destino.aba }),
  }
}

// O que cada errcode da fronteira do ADR 0042 vira na tela. Texto do domínio,
// não a mensagem do Postgres: quem lê está no balcão com o cliente na frente.
// Por código HTTP: a rota do comprovante não é RPC e não devolve LT.
const RECUSA_DO_COMPROVANTE: Record<number, string> = {
  403: 'O comprovante é enviado pelo computador do Admin.',
  409: 'Esta comanda não está fechada: não há comprovante para enviar.',
  413: 'O PDF ficou grande demais para guardar.',
  503: 'O servidor não conseguiu guardar o PDF. Tente de novo.',
}

const RECUSA_DE_COMANDA: Record<string, string> = {
  LT001: 'Esta comanda mudou enquanto você olhava. Confira os valores e tente de novo.',
  LT002: 'Essa ação não existe para o estado atual da comanda.',
  LT003: 'Não deu para fazer: confira se a comanda é sua e se os campos estão preenchidos.',
  LT004: 'A competência deste mês está trancada. A correção é por Ajuste, com o Admin.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// A criação tem recusas próprias: LT003 aqui é a guarda da linha 1 da FSM
// (duração fora da tabela, agendamento que saiu da agenda), não posse ou campo.
const RECUSA_DE_ABRIR_COMANDA: Record<string, string> = {
  LT003: 'Este ensaio não pode ter comanda agora: a duração não está na tabela ou ele saiu da agenda. Chame o Admin.',
  LT004: 'A competência deste mês está trancada. Comanda nova não nasce nela — chame o Admin.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

const RECUSA_DE_CHECKLIST: Record<string, string> = {
  LT001: 'Alguém mexeu neste checklist enquanto você olhava. A tela já está em dia — toque de novo.',
  LT002: 'Essa ação não vale agora: a saída só abre depois da entrada, e item justificado sai pela justificativa.',
  LT003: 'Ainda falta item por tratar nesta fase, ou foto de justificativa que ainda não subiu.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// A foto da justificativa recusada — outra lista porque a recusa é outra: aqui
// quem responde é a rota de mídia, não a RPC do Checklist.
const RECUSA_DE_FOTO: Record<string, string> = {
  LT002: 'Este item já tem foto, e trocar a foto ainda não existe. Remova a justificativa e trate o item.',
  LT003: 'Não deu para anexar a foto a este item.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// A mesma rota, outro ativo: o que o LT002 e o LT003 querem dizer muda com o
// registro que recusou a foto (ADR 0053 §2).
const RECUSA_DE_FOTO_DO_ACHADO: Record<string, string> = {
  LT002: 'Este achado já tem foto, e trocar a foto ainda não existe.',
  LT003: 'Não deu para anexar a foto a este achado.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// Treinamento (0089). LT002 e LT003 ficam de fora: o banco escreve o motivo
// (publicar sem bloco, categoria com publicado, nome repetido), e é ele que aparece.
const semAcento = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const TRECHO_EM_VOLTA = 40

/**
 * Busca ao digitar, no tablet: recarregar a tela a cada letra remontaria o
 * campo e fecharia o teclado. Acha no título ou no texto, sem acento; achado só
 * no texto mostra o trecho.
 */
function filtrarTreinamento(dados: DadosTreinamento, digitado: string): DadosTreinamento {
  const termos = semAcento(digitado).split(/\s+/).filter(Boolean)
  if (termos.length === 0) return dados
  const categorias = dados.categorias
    .map((categoria) => ({
      ...categoria,
      tutoriais: categoria.tutoriais
        .filter((t) => termos.every((termo) => semAcento(`${t.titulo} ${t.texto}`).includes(termo)))
        .map((t) => {
          const termo = termos.find((x) => !semAcento(t.titulo).includes(x))
          if (termo === undefined) return t
          // Sem acento o texto pode mudar de tamanho: cada letra guarda de onde
          // veio, para o corte cair no texto original.
          const letras = [...t.texto]
          let normal = ''
          const origem: number[] = []
          letras.forEach((letra, k) => { for (const c of semAcento(letra)) { normal += c; origem.push(k) } })
          const j = normal.indexOf(termo)
          if (j < 0) return t
          const i = origem[j]
          const fim = origem[j + termo.length - 1] + 1
          return {
            ...t,
            trecho: [
              { texto: letras.slice(Math.max(0, i - TRECHO_EM_VOLTA), i).join(''), marcado: false },
              { texto: letras.slice(i, fim).join(''), marcado: true },
              { texto: letras.slice(fim, fim + TRECHO_EM_VOLTA).join(''), marcado: false },
            ],
          }
        }),
    }))
    .filter((categoria) => categoria.tutoriais.length > 0)
  return {
    ...dados,
    categorias,
    total: categorias.reduce((n, c) => n + c.tutoriais.length, 0),
    vazioTitulo: 'Nada encontrado',
    vazioDescricao: 'Nenhum tutorial tem essa palavra no título ou no texto. Tente outra, ou inclua os arquivados.',
  }
}

const RECUSA_DO_TREINAMENTO: Record<string, string> = {
  LT001: 'Este item foi alterado em outra tela. A tela foi atualizada; refaça a alteração.',
  LT005: 'Só a administração escreve no Treinamento.',
}

/** A recusa da foto em português de balcão. `FotoRecusada` já vem escrita assim. */
function recusaDaFoto(erro: unknown, recusas: Record<string, string> = RECUSA_DE_FOTO): string {
  if (erro instanceof FotoRecusada) return erro.message
  if (erro instanceof ErroApi) {
    // 413 é o teto do ADR 0026 aplicado no servidor: o pedido está certo, a foto
    // é que não cabe.
    if (erro.codigo === 413) return 'Esta foto é pesada demais. Tire outra, mais de perto.'
    return recusas[erro.dominio ?? ''] ?? erro.message
  }
  return 'Sem conexão com o sistema. A foto não subiu.'
}

/** A foto não subiu agora, mas está guardada no tablet: a fila tenta de novo sozinha. */
const FOTO_NA_FILA = 'Sem conexão agora. A foto ficou guardada no tablet e sobe sozinha quando a internet voltar.'
const FOTO_NA_FILA_JUSTIFICATIVA = `${FOTO_NA_FILA} Pode confirmar a justificativa: a fase só conclui depois que a foto subir.`

const SITUACAO_NA_FILA: Record<ItemDaFila['estado'], string> = {
  pendente: 'Esperando a internet',
  enviado: 'Enviada',
  parada: 'Não subiu depois de várias tentativas',
  caducou: 'O turno de quem tirou acabou antes de subir',
  invalida: 'O sistema recusou',
}

/** O que a bandeja mostra de cada item da fila (ADR 0072 §7). */
const fotoNaFila = (item: ItemDaFila): FotoNaFila => ({
  identificador: item.id,
  rotulo: item.ativo === 'achado' ? 'Foto de achado' : 'Foto do Checklist',
  situacao: SITUACAO_NA_FILA[item.estado],
  erro: item.estado === 'pendente' ? null : item.erro,
  podeReenviar: item.estado !== 'pendente' && item.estado !== 'enviado',
})

const RECUSA_DE_ACHADO: Record<string, string> = {
  LT003: 'Confira os campos: o achado precisa de descrição, e a data não pode ser no futuro.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// As duas saídas (ADR 0054).
const RECUSA_DE_SAIDA_DO_ACHADO: Record<string, string> = {
  LT001: 'Este achado mudou enquanto você olhava. A tela já está em dia — confira e refaça.',
  LT002: 'Este achado já saiu: não dá para entregar nem doar de novo.',
  LT003: 'Falta preencher: a entrega precisa do nome de quem retirou, e a doação do destino.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

/**
 * O que o dedo está escrevendo num dos dois formulários de saída. Um só tipo
 * para os dois porque é um campo só: o nome de quem retirou, ou o destino da
 * doação. O esqueleto (o aviso, quem assina) vem do servidor pelo `?saida=`.
 */
type SaidaDoAchado = { achado: string; acao: 'entregar' | 'doar'; texto: string }

/**
 * Sobrepõe o que está sendo escrito, calcula o `podeConfirmar` no cliente e põe
 * a recusa DENTRO do formulário aberto — como o modal da justificativa. O
 * formulário só fecha quando a escrita passa, então é ali que a recusa é lida.
 */
function comSaidaDoAchado(
  dados: DadosAchados, saida: SaidaDoAchado | null, recusa: string | null,
): DadosAchados {
  const selecionado = dados.selecionado
  if (selecionado === undefined || saida === null || saida.achado !== selecionado.identificador) return dados
  const preenchido = saida.texto.trim() !== ''
  const comRecusa = recusa === null ? {} : { recusa }
  return {
    ...dados,
    selecionado: {
      ...selecionado,
      ...(selecionado.entrega === undefined ? {} : {
        entrega: { ...selecionado.entrega, nomeRetirada: saida.texto, podeConfirmar: preenchido, ...comRecusa },
      }),
      ...(selecionado.doacao === undefined ? {} : {
        doacao: { ...selecionado.doacao, destino: saida.texto, podeConfirmar: preenchido, ...comRecusa },
      }),
    },
  }
}

/**
 * O formulário de "Registrar achado" enquanto ele não foi guardado. O esqueleto
 * (estúdios, lugares, aviso) vem do servidor pelo `?registrar=1`; o que mora
 * aqui é o que o dedo escreveu e a foto que ele escolheu.
 *
 * A foto fica como `File` porque ela só sobe DEPOIS do Guardar: ela nasce ligada
 * a um achado que ainda não existe (ADR 0053 §1). `previa` é o `blob:` que a
 * tela mostra enquanto isso, e que o App revoga ao fechar.
 */
type RascunhoAchado = {
  descricao: string
  data: string
  cliente: string
  observacao: string
  estudio: string | null
  lugar: string | null
  arquivo: File | null
  previa: string | null
  enviando: boolean
  recusa: string | null
}

const RASCUNHO_VAZIO: RascunhoAchado = {
  descricao: '', data: '', cliente: '', observacao: '',
  estudio: null, lugar: null, arquivo: null, previa: null, enviando: false, recusa: null,
}

/** O envio da foto de UM achado que já existe — do "Anexar foto" ou do Guardar que passou pela metade. */
type FotoDoAchado = { achado: string; enviando: boolean; recusa: string | null }
type MensagemDoAchado = { achado: string; naAreaDeTransferencia: boolean }

/**
 * A miniatura do arquivo escolhido, enquanto ele não subiu. Sem
 * `createObjectURL` (jsdom, navegador que não o tem) a tela fica sem miniatura e
 * o gesto continua: quem manda no Guardar é o arquivo, não a prévia dele.
 */
function previaDe(arquivo: File): string | null {
  try {
    return URL.createObjectURL(arquivo)
  } catch {
    return null
  }
}

/**
 * Sobrepõe o rascunho no formulário e o estado do envio no detalhe.
 *
 * `podeGuardar` é calculado aqui, e não no servidor, porque depende do que
 * ainda não foi enviado: descrição, lugar e foto. A tela exige a foto; a RPC
 * não (ADR 0053 §1) — se o envio falhar depois, o item fica em `aguardando_foto`
 * em vez de se perder.
 */
/**
 * Onde o achado vai ser guardado. Com um lugar só, escolher não é decisão: vale
 * o único, e o formulário abre com ele marcado — exigir o toque seria pedir
 * confirmação de algo sem alternativa. Com dois ou mais, continua nulo até o
 * dedo escolher.
 *
 * ⚠ Mora aqui, e não dentro do `com*`, porque QUEM ENVIA precisa da mesma
 * resposta. A tela dizendo "Gaveta" marcada e a RPC recebendo nulo seria a
 * diferença entre o que a pessoa vê e o que o banco grava.
 */
function lugarEfetivo(
  registro: DadosAchados['registro'], rascunho: RascunhoAchado | null,
): string | null {
  if (rascunho?.lugar != null) return rascunho.lugar
  return registro?.lugares.length === 1 ? registro.lugares[0].identificador : null
}

function comRegistroDeAchado(
  dados: DadosAchados, rascunho: RascunhoAchado | null, foto: FotoDoAchado | null,
  copiada: MensagemDoAchado | null,
): DadosAchados {
  const marcar = (lista: EscolhaAchado[], escolhido: string | null) =>
    lista.map((item) => ({ ...item, selecionado: item.identificador === escolhido }))

  const lugar = lugarEfetivo(dados.registro, rascunho)

  return {
    ...dados,
    ...(dados.registro === undefined || rascunho === null ? {} : {
      registro: {
        ...dados.registro,
        descricao: rascunho.descricao,
        data: rascunho.data,
        cliente: rascunho.cliente,
        observacao: rascunho.observacao,
        estudios: marcar(dados.registro.estudios, rascunho.estudio),
        lugares: marcar(dados.registro.lugares, lugar),
        ...(rascunho.previa === null ? {} : { foto: rascunho.previa }),
        enviando: rascunho.enviando,
        ...(rascunho.recusa === null ? {} : { recusa: rascunho.recusa }),
        podeGuardar: rascunho.descricao.trim() !== '' && lugar !== null && rascunho.arquivo !== null,
      },
    }),
    ...(dados.selecionado === undefined ? {} : {
      selecionado: {
        ...dados.selecionado,
        ...(dados.selecionado.anexarFoto === undefined || foto === null
          || foto.achado !== dados.selecionado.identificador ? {} : {
          anexarFoto: {
            ...dados.selecionado.anexarFoto,
            enviando: foto.enviando,
            ...(foto.recusa === null ? {} : { recusa: foto.recusa }),
          },
        }),
        ...(dados.selecionado.compartilhar === undefined || copiada === null
          || copiada.achado !== dados.selecionado.identificador ? {} : {
          compartilhar: { ...dados.selecionado.compartilhar, copiada: { naAreaDeTransferencia: copiada.naAreaDeTransferencia } },
        }),
      },
    }),
  }
}

/**
 * O que o dedo está fazendo no modal da justificativa. O resto do modal (a foto
 * assinada, o motivo já gravado, a versão) vem do servidor pelo `?item=`.
 */
type RascunhoJustificativa = { item: string; texto: string; enviando: boolean; recusa: string | null }

/**
 * Sobrepõe o que está sendo digitado, mostra a recusa DENTRO do modal aberto, e
 * diz se a foto do item está na fila do tablet. A `invalida` não conta: ela não
 * vai subir.
 */
function comJustificativa(
  dados: DadosChecklist, rascunho: RascunhoJustificativa | null, recusa: string | null, fila: ItemDaFila[],
): DadosChecklist {
  if (dados.modal === null) return dados
  const meu = rascunho !== null && rascunho.item === dados.modal.identificador
  const aviso = (meu ? rascunho.recusa : null) ?? recusa
  const item = dados.modal.identificador
  const fotoNaFila = fila.some((f) => f.ativo === 'item_execucao' && f.registro === item && f.estado !== 'invalida')
  return {
    ...dados,
    modal: {
      ...dados.modal,
      fotoNaFila,
      ...(meu ? { texto: rascunho.texto, enviando: rascunho.enviando } : {}),
      ...(aviso === null ? {} : { recusa: aviso }),
    },
  }
}

/**
 * A passada de conferência do Estoque enquanto ela não foi confirmada.
 * `tocados` é o que separa "contei e deu zero" de "não conferi": os dois
 * aparecem como 0 em `valores`, e só o primeiro deve chegar ao banco.
 */
type RascunhoEstoque = { valores: Record<string, number>; tocados: Set<string> }

/**
 * O "Repor / ajustar" de um item da Bomboniere enquanto o dedo está nele.
 * `saldo` é o ALVO na tela; o que vai pro banco é o delta contra o saldo lido.
 */
type AjusteBomboniere = { item: string; saldo: number; motivo: string }

const insumosDe = (dados: DadosEstoque) => dados.colunas.flatMap((coluna) => coluna.grupos).flatMap((grupo) => grupo.insumos)

/** Abre a edição no número que a tela mostra. Insumo não conferido mostra "—" e começa em 0. */
function rascunhoDe(dados: DadosEstoque): RascunhoEstoque {
  const valores: Record<string, number> = {}
  for (const insumo of insumosDe(dados)) {
    const contado = Number(insumo.quantidade)
    valores[insumo.identificador] = Number.isFinite(contado) ? contado : 0
  }
  return { valores, tocados: new Set() }
}

/**
 * Sobrepõe o rascunho ao que veio do servidor. `criticidade` NÃO é recalculada
 * aqui de propósito: a cor é contrato de apresentação do ADR 0042 §2, e refazer
 * a fórmula no front criaria um segundo lugar onde ela mora. Enquanto a passada
 * não é confirmada, a cor é a da última contagem — que é o que de fato vale.
 */
function comRascunho(dados: DadosEstoque, rascunho: RascunhoEstoque | null, ajuste: AjusteBomboniere | null): DadosEstoque {
  const bomboniere = ajuste === null ? dados.bomboniere : dados.bomboniere.map((item) =>
    item.identificador === ajuste.item
      ? { ...item, ajuste: { saldo: String(ajuste.saldo), motivo: ajuste.motivo } }
      : item)
  if (rascunho === null) return { ...dados, bomboniere }
  return {
    ...dados,
    bomboniere,
    editando: true,
    colunas: dados.colunas.map((coluna) => ({
      ...coluna,
      grupos: coluna.grupos.map((grupo) => ({
        ...grupo,
        insumos: grupo.insumos.map((insumo) => ({
          ...insumo,
          quantidade: String(rascunho.valores[insumo.identificador] ?? 0),
        })),
      })),
    })),
  }
}

/** A ficha e a renomeação abertas pelo Admin (ADR 0080) entram por cima da tela. */
function comCatalogo(dados: DadosEstoque, fichaAberta: FichaAberta | null, renomeacao: Renomeacao | null): DadosEstoque {
  return { ...dados, fichaAberta, renomeacao }
}

const FICHA_NOVA: FichaAberta = { item: null, nome: '', categoria: '', fornecedor: '', especificacao: '', severidade: 'atencao' }

/**
 * Põe na tela a foto que o dedo abriu. O servidor manda `fotoAberta` sempre
 * nula: qual miniatura foi tocada é estado de interação, e a foto em si já veio
 * na lista — abrir não gasta ida à rede.
 *
 * Procura nas três listas porque a miniatura é desenhada nas três abas
 * (conferir, compra e bomboniere), e o identificador é único entre elas.
 */
function comFotoDoEstoque(dados: DadosEstoque, aberta: string | null): DadosEstoque {
  if (aberta === null) return dados
  const candidatos = [
    ...dados.colunas.flatMap((coluna) => coluna.grupos.flatMap((grupo) => grupo.insumos)),
    ...dados.compra.flatMap((pedido) => pedido.insumos),
    ...dados.bomboniere,
  ]
  return { ...dados, fotoAberta: candidatos.find((item) => item.identificador === aberta) ?? null }
}

const RECUSA_DE_ESCALA: Record<string, string> = {
  LT001: 'Alguém alterou um desses turnos enquanto você editava. Ele voltou ao que está gravado: confira e confirme de novo.',
  LT002: 'Domingo extra não se troca por aqui.',
  LT003: 'Uma das alterações não passou: quem cobre precisa ser Atendente ativo. Recarregue a escala e tente de novo.',
  LT005: 'Hoje e dias passados só o Administrador altera. Se não for isso, entre de novo.',
}

// "Marcar que veio" (ADR 0079). LT001: trocaram o turno entre a leitura e o toque.
const RECUSA_DE_PRESENCA: Record<string, string> = {
  LT001: 'Este turno mudou de pessoa. A escala foi recarregada: confira e toque de novo.',
  LT002: 'Presença se marca no dia, não antes.',
  LT005: 'Cada um marca a própria presença, no dia. Outro dia ou outra pessoa, só o Administrador.',
}

// Domingo extra (0062). Quem faz o extra é Atendente ativo: LT003 é o escolhido
// que saiu da equipe entre a leitura da tela e o toque.
const RECUSA_DE_DOMINGO: Record<string, string> = {
  LT001: 'Este domingo mudou enquanto você olhava: outra pessoa assumiu ou desfez. A tela já está em dia — confira e toque de novo.',
  LT003: 'Não deu para acionar: quem faz o domingo extra é Atendente ativo. Recarregue a escala e escolha de novo.',
  LT005: 'Hoje e dias passados só o Administrador mexe. Se não for isso, entre de novo.',
}

// "Confirmar nova âncora" (migrations 0062 e 0064). LT003 cobre a lista de
// decisões que não bate com as trocas e faltas afetadas — o que acontece quando
// alguém marcou uma falta nova entre a leitura da tela e o toque.
const RECUSA_DE_REVISAO: Record<string, string> = {
  LT001: 'O padrão ou um dos turnos mudou enquanto você revisava. A tela já está em dia — revise de novo.',
  LT003: 'A revisão não passou: a lista mudou enquanto você decidia, ou alguém do padrão foi desativado. Revise de novo.',
  LT005: 'Alterar o padrão da escala é do Administrador. Entre com o login dele.',
}

// Pagar, cancelar, estornar e lançar (migrations 0063 e 0065). LT005 cobre dois
// casos de uma vez — não ser Admin e a sessão não conferir — porque a RPC não
// os distingue, e para quem está no balcão o remédio é o mesmo.
const RECUSA_DE_HORA_EXTRA: Record<string, string> = {
  LT001: 'Esta hora extra mudou enquanto você olhava. A tela já está em dia — confira e toque de novo.',
  LT003: 'Não deu: confira o estado do registro e o motivo. Pendente se paga ou cancela, paga se estorna, e o motivo não pode ser o do cancelamento automático.',
  LT005: 'Pagar, cancelar e estornar são do Administrador. Se for você, entre de novo.',
}

const RECUSA_DE_LANCAR_EXTRA: Record<string, string> = {
  LT003: 'Não deu para lançar: o fim precisa vir depois do início, a pessoa precisa estar ativa e a data precisa ter acréscimo noturno vigente.',
  LT005: 'Lançar por outra pessoa é do Administrador. Se for você, entre de novo.',
}

type RascunhoHoraExtra = {
  data: string
  inicio: string
  fim: string
  destinatario: string
  /** Id do agendamento, '' para ficar com o sugerido, SEM_ENSAIO se não há ensaio (ADR 0083). */
  ensaio: string
  motivo: string
  /** "Outro ensaio" aberto, e o que foi digitado na busca. */
  outrosAbertos: boolean
  busca: string
  enviando: boolean
}

const SEM_ENSAIO = 'sem-ensaio'

// O banco aceita o ensaio do dia ou da véspera — a da madrugada (0091).
const diaAnterior = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Só sugestão: quem lança confirma, e o banco segue aceitando qualquer ensaio
// do dia ou da véspera.
const PERTO_MINUTOS = 60
const SUGERIDOS_NO_MAXIMO = 3
const OUTROS_SEM_BUSCA = 5

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/**
 * Os ensaios do dia e da véspera, em minutos a partir da meia-noite da data
 * digitada (véspera fica negativa), com a distância até o horário da extra:
 * 0 se cruzam, senão o vão entre um e outro. Sem horário, a distância é nula.
 */
function ensaiosComDistancia(r: RascunhoHoraExtra, ensaios: DadosHorasExtras['ensaios']) {
  const vespera = diaAnterior(r.data)
  const temHorario = r.inicio !== '' && r.fim !== ''
  const ini = minutos(r.inicio)
  const fim = minutos(r.fim) <= ini ? minutos(r.fim) + 1440 : minutos(r.fim)
  return ensaios
    .filter((e) => e.data === r.data || e.data === vespera)
    .map((e) => {
      const desloca = e.data === vespera ? -1440 : 0
      const a = minutos(e.inicio) + desloca
      const b = (minutos(e.fim) <= minutos(e.inicio) ? minutos(e.fim) + 1440 : minutos(e.fim)) + desloca
      return {
        ...e,
        vespera: e.data === vespera,
        distancia: temHorario ? Math.max(0, ini - b, a - fim) : null,
      }
    })
    .sort((x, y) => (x.distancia ?? 0) - (y.distancia ?? 0) || minutos(x.inicio) - minutos(y.inicio))
}

const sugeridosDoLancamento = (r: RascunhoHoraExtra, ensaios: DadosHorasExtras['ensaios']) =>
  r.data === '' ? [] : ensaiosComDistancia(r, ensaios)
    .filter((e) => e.distancia !== null && e.distancia <= PERTO_MINUTOS)
    .slice(0, SUGERIDOS_NO_MAXIMO)

/** O que vai no envio: o escolhido, ou o primeiro sugerido se ninguém escolheu. */
const ensaioDoLancamento = (r: RascunhoHoraExtra, ensaios: DadosHorasExtras['ensaios']) =>
  r.ensaio !== '' ? r.ensaio : (sugeridosDoLancamento(r, ensaios)[0]?.identificador ?? '')

function ensaiosDoLancamento(r: RascunhoHoraExtra, ensaios: DadosHorasExtras['ensaios']) {
  const escolhido = ensaioDoLancamento(r, ensaios)
  const apresentar = (e: ReturnType<typeof ensaiosComDistancia>[number]) => ({
    identificador: e.identificador,
    rotulo: e.vespera ? `véspera · ${e.rotulo}` : e.rotulo,
    selecionado: e.identificador === escolhido,
  })
  const vazio = { ensaios: [], nenhumPerto: false, outros: { aberto: r.outrosAbertos, busca: r.busca, ensaios: [], restantes: 0, semResultado: false } }
  if (r.data === '') return vazio

  const todos = ensaiosComDistancia(r, ensaios)
  const sugeridos = sugeridosDoLancamento(r, ensaios)
  // O escolhido na busca sobe para cima, para continuar à vista com ela fechada.
  const emCima = [...sugeridos, ...todos.filter((e) => e.identificador === r.ensaio && !sugeridos.includes(e))]
  const resto = todos.filter((e) => !emCima.includes(e))
  const termos = semAcento(r.busca).replace(/#/g, '').split(/\s+/).filter(Boolean)
  const achados = termos.length === 0
    ? resto.slice(0, OUTROS_SEM_BUSCA)
    : resto.filter((e) => termos.every((t) => semAcento(e.rotulo).includes(t)))
  return {
    ensaios: emCima.map(apresentar),
    nenhumPerto: r.inicio !== '' && r.fim !== '' && sugeridos.length === 0,
    outros: {
      aberto: r.outrosAbertos,
      busca: r.busca,
      ensaios: achados.map(apresentar),
      restantes: termos.length === 0 ? resto.length - achados.length : 0,
      semResultado: termos.length > 0 && achados.length === 0,
    },
  }
}

const ligacaoPronta = (r: RascunhoHoraExtra, ensaios: DadosHorasExtras['ensaios']) =>
  r.ensaio === SEM_ENSAIO ? r.motivo.trim() !== '' : ensaioDoLancamento(r, ensaios) !== ''

/** Caixa de motivo aberta num registro. Cancelar e estornar usam a mesma. */
type MotivoDeHoraExtra = {
  extra: string
  acao: 'cancelar' | 'estornar'
  motivo: string
  enviando: boolean
}

const diaSeguinte = (iso: string) => {
  // Meio-dia UTC: aritmética de data sem tropeçar em virada de fuso.
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * O que vai para `hora_extra_lancar`. Fim menor ou igual ao início só pode ser
 * a madrugada do dia seguinte — a RPC exige fim > início, e o dia da hora extra
 * sai do início do intervalo (ADR 0061 §1), então a data digitada continua
 * sendo a do início.
 *
 * Sem fuso na string, como no fim praticado da Comanda: quem resolve é o
 * `timezone` da transação, não o relógio do tablet.
 */
function instantesDoLancamento(r: RascunhoHoraExtra) {
  const virou = r.fim <= r.inicio
  return {
    inicio: `${r.data} ${r.inicio}`,
    fim: `${virou ? diaSeguinte(r.data) : r.data} ${r.fim}`,
    virou,
  }
}

// O valor NÃO é calculado aqui: quem conta bloco de 30 minutos é a RPC, e duas
// contas da mesma regra são duas chances de discordar. O aviso só diz a régua.
function avisoDoLancamento(r: RascunhoHoraExtra, dados: DadosHorasExtras) {
  if (r.data === '' || r.inicio === '' || r.fim === '') return 'Preencha data, início e fim.'
  if (ensaioDoLancamento(r, dados.ensaios) === '') return 'Escolha o ensaio, ou "Sem ensaio" com o motivo.'
  if (!ligacaoPronta(r, dados.ensaios)) return 'Escreva o motivo de não ter ensaio. A Helena confere.'
  const outro = dados.destinatarios.find((p) => p.identificador === r.destinatario && !p.eu)
  const virada = instantesDoLancamento(r).virou ? ' O fim cai no dia seguinte.' : ''
  const quem = outro === undefined ? '' : ` Vai para ${outro.rotulo}, que é avisado.`
  return `Vale blocos de 30 minutos começados, ao acréscimo noturno vigente na data.${virada}${quem}`
}

/**
 * Sobrepõe à tela o que é do cliente: o formulário de lançamento, quais
 * históricos estão abertos e em qual registro a caixa de motivo está aberta.
 */
function comEstadoDasHorasExtras(
  dados: DadosHorasExtras,
  rascunho: RascunhoHoraExtra | null,
  historicos: string[],
  motivo: MotivoDeHoraExtra | null,
): DadosHorasExtras {
  return {
    ...dados,
    lancamento: rascunho === null ? undefined : {
      data: rascunho.data,
      inicio: rascunho.inicio,
      fim: rascunho.fim,
      destinatarios: dados.destinatarios.map((pessoa) => ({
        ...pessoa, selecionado: pessoa.identificador === rascunho.destinatario,
      })),
      ...ensaiosDoLancamento(rascunho, dados.ensaios),
      semEnsaio: rascunho.ensaio === SEM_ENSAIO,
      motivo: rascunho.motivo,
      aviso: avisoDoLancamento(rascunho, dados),
      podeEnviar: rascunho.data !== '' && rascunho.inicio !== '' && rascunho.fim !== ''
        && rascunho.destinatario !== '' && ligacaoPronta(rascunho, dados.ensaios) && !rascunho.enviando,
    },
    registros: dados.registros.map((extra) => ({
      ...extra,
      historicoAberto: historicos.includes(extra.identificador),
      cancelamento: motivo === null || motivo.extra !== extra.identificador ? undefined : {
        motivo: motivo.motivo,
        podeConfirmar: motivo.motivo.trim() !== '' && !motivo.enviando,
        rotulo: motivo.acao === 'estornar' ? 'Motivo do estorno' : 'Motivo do cancelamento',
        confirmar: motivo.acao === 'estornar' ? 'Estornar o pagamento' : 'Cancelar a extra',
      },
    })),
  }
}

const RECUSA_DE_ESTOQUE: Record<string, string> = {
  LT002: 'Um dos itens saiu do catálogo. Recarregue a lista e conte de novo.',
  LT003: 'A contagem não passou: confira se todos os números são inteiros e não negativos.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// LT002 fica de fora de propósito: a 0088 diz o motivo exato (PIN fácil, igual
// a um dos últimos, quem não é Atendente), e é esse texto que aparece.
const RECUSA_DE_PIN: Record<string, string> = {
  LT005: 'Só o sócio define PIN. Entre com o login dele.',
}

const RECUSA_DE_SENHA_NO_APP: Record<string, string> = {
  senha_atual_incorreta: 'A senha atual não confere.',
  bloqueado: 'Muitas tentativas erradas. Aguarde 15 minutos.',
  LT002: 'Essa pessoa não está ativa.',
  LT003: 'Preencha o login, e a senha com pelo menos 12 caracteres.',
  LT005: 'Só o sócio redefine a senha de outra pessoa.',
}

const RECUSA_DE_EQUIPE: Record<string, string> = {
  LT001: 'Alguém mexeu nessa pessoa enquanto você olhava. A lista foi atualizada: tente de novo.',
  LT002: 'Essa pessoa não existe mais na lista. Recarregue a tela.',
  LT003: 'Confira o nome, o nível e o PIN (4 dígitos, só para Atendente). Ninguém desativa a si mesmo.',
  LT005: 'Só o sócio cadastra e desativa pessoas.',
}

// O catálogo de insumos (ADR 0080). LT003 traz a frase do banco ("ja existe o
// insumo Papel toalha"), que diz mais do que um texto fixo.
const RECUSA_DE_CATALOGO: Record<string, string> = {
  LT001: 'Alguém mexeu neste insumo enquanto você editava. A lista foi atualizada: salve de novo.',
  LT002: 'Este insumo saiu do catálogo. Recarregue a lista.',
  LT005: 'Só o administrador mexe no catálogo.',
}

const RECUSA_DE_BOMBONIERE: Record<string, string> = {
  LT002: 'Este item saiu do catálogo. Recarregue a lista.',
  LT003: 'Não deu para gravar: mexa no saldo e, se estiver tirando, diga por quê.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

// "Escrever aviso" (migrations 0059 e 0061). O esqueleto vem pelo
// `?escrever=1`; o que mora aqui é o que o dedo escreveu.
type RascunhoAviso = {
  titulo: string
  texto: string
  publico: string
  pedeConfirmacao: boolean
  urgente: boolean
  enviando: boolean
}

const RASCUNHO_AVISO_VAZIO: RascunhoAviso = {
  titulo: '', texto: '', publico: 'todos', pedeConfirmacao: true, urgente: false, enviando: false,
}

function orientacaoDoAviso(pessoas: number, publico: string, pedeConfirmacao: boolean): string {
  if (pessoas === 0) return 'Ninguém ativo recebe este aviso.'
  const quem = `${pessoas === 1 ? '1 pessoa' : `${pessoas} pessoas`} (${publico === 'atendentes' ? 'só Atendentes' : 'Administradores e Atendentes'})`
  return pedeConfirmacao
    ? `Vai para ${quem} e fica em destaque até cada uma confirmar.`
    : `Vai para ${quem} sem pedir confirmação. Sai da lista em 15 dias ou quando um Administrador arquivar.`
}

// "Criar lembrete" e o quadro Categorias (ADR 0066). Como no aviso, o
// esqueleto vem do servidor e o que mora aqui é o que o dedo escreveu.
type RascunhoLembrete = { texto: string; data: string; categoria: string | null; antecedencia: string; enviando: boolean }
const RASCUNHO_LEMBRETE_VAZIO: RascunhoLembrete = { texto: '', data: '', categoria: null, antecedencia: '', enviando: false }

type RascunhoCategoria = { nome: string; antecedencia: string; enviando: boolean }
const RASCUNHO_CATEGORIA_VAZIO: RascunhoCategoria = { nome: '', antecedencia: '', enviando: false }

type EdicaoCategoria = RascunhoCategoria & { identificador: string }

// "Editar" um aviso (ADR 0069): um cartão por vez, com o que o dedo já mudou.
type EdicaoAviso = { identificador: string; titulo: string; texto: string; enviando: boolean }

// Salvar o mesmo texto zeraria as leituras por nada, e o banco recusa (LT003).
// A comparação é a do banco: sem os espaços das pontas.
const edicaoPodeSalvar = (e: EdicaoAviso, aviso: { titulo: string; texto: string }) =>
  e.titulo.trim() !== '' && !e.enviando && (e.titulo.trim() !== aviso.titulo || e.texto.trim() !== aviso.texto)

/** 'AAAA-MM-DD' menos `dias`. Meio-dia UTC: a conta de dias não cruza a meia-noite de fuso nenhum. */
function diasAntes(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

const ddmmDe = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`

function orientacaoDoLembrete(hoje: string, semCategoria: boolean, r: RascunhoLembrete): string {
  if (semCategoria) return 'Crie uma categoria antes: todo lembrete tem uma.'
  if (r.categoria === null) return 'Escolha a categoria: ela sugere quantos dias antes avisar.'
  if (r.data === '') return 'Escolha a data.'
  if (r.data < hoje) return 'A data é hoje ou depois.'
  if (r.antecedencia === '') return 'Diga quantos dias antes avisar.'
  const aparece = diasAntes(r.data, Number(r.antecedencia))
  return aparece <= hoje ? 'Aparece para a equipe hoje.' : `Aparece para a equipe em ${ddmmDe(aparece)}.`
}

const categoriaCompleta = (r: RascunhoCategoria) => r.nome.trim() !== '' && r.antecedencia !== '' && !r.enviando

/**
 * Sobrepõe à tela o que é do cliente: de qual aviso as leituras estão abertas,
 * e os rascunhos nos formulários. `podePublicar` e `podeCriar` são daqui
 * porque dependem do que ainda não foi enviado.
 */
function comEstadoDosAvisos(
  dados: DadosAvisos,
  leiturasAbertas: string | null,
  rascunho: RascunhoAviso | null,
  rascunhoLembrete: RascunhoLembrete | null = null,
  novaCategoria: RascunhoCategoria | null = null,
  edicaoCategoria: EdicaoCategoria | null = null,
  edicaoAviso: EdicaoAviso | null = null,
): DadosAvisos {
  const r = rascunho ?? RASCUNHO_AVISO_VAZIO
  const rl = rascunhoLembrete ?? RASCUNHO_LEMBRETE_VAZIO
  const nc = novaCategoria ?? RASCUNHO_CATEGORIA_VAZIO
  const fl = dados.formularioLembrete
  const pessoas = dados.formulario?.publicos.find((p) => p.identificador === r.publico)?.pessoas ?? 0
  return {
    ...dados,
    formulario: dados.formulario === null ? null : {
      ...dados.formulario,
      titulo: r.titulo,
      texto: r.texto,
      publicos: dados.formulario.publicos.map((p) => ({ ...p, selecionado: p.identificador === r.publico })),
      pedeConfirmacao: r.pedeConfirmacao,
      urgente: r.urgente,
      aviso: orientacaoDoAviso(pessoas, r.publico, r.pedeConfirmacao),
      podePublicar: r.titulo.trim() !== '' && pessoas > 0 && !r.enviando,
    },
    formularioLembrete: fl === null ? null : {
      ...fl,
      texto: rl.texto,
      data: rl.data,
      antecedencia: rl.antecedencia,
      categorias: fl.categorias.map((c) => ({ ...c, selecionada: c.identificador === rl.categoria })),
      aviso: orientacaoDoLembrete(fl.hoje, fl.categorias.length === 0, rl),
      podeCriar: rl.texto.trim() !== '' && rl.categoria !== null && rl.data >= fl.hoje
        && rl.antecedencia !== '' && !rl.enviando,
    },
    categorias: dados.categorias === null ? null : {
      ...dados.categorias,
      novoNome: nc.nome,
      novaAntecedencia: nc.antecedencia,
      podeCriar: categoriaCompleta(nc),
      itens: dados.categorias.itens.map((c) => c.identificador !== edicaoCategoria?.identificador ? c : {
        ...c,
        edicao: { nome: edicaoCategoria.nome, antecedencia: edicaoCategoria.antecedencia, podeSalvar: categoriaCompleta(edicaoCategoria) },
      }),
    },
    avisos: dados.avisos.map((aviso) => {
      const aberta = aviso.identificador === leiturasAbertas
      const editando = aviso.identificador === edicaoAviso?.identificador
        ? { titulo: edicaoAviso.titulo, texto: edicaoAviso.texto, podeSalvar: edicaoPodeSalvar(edicaoAviso, aviso) }
        : aviso.editando
      return {
        ...aviso,
        leiturasAbertas: aberta,
        editando,
        acoes: aviso.acoes.map((acao) =>
          acao.identificador === 'leituras' && aberta ? { ...acao, rotulo: 'Fechar leituras' } : acao,
        ),
      }
    }),
  }
}

const RECUSA_DE_PUBLICAR: Record<string, string> = {
  LT003: 'Não deu para publicar: o aviso precisa de título, numa linha só.',
  LT005: 'Sua sessão não confere. Entre de novo.',
}

const RECUSA_DE_LEMBRETE: Record<string, string> = {
  LT002: 'Esta categoria foi desativada enquanto você escrevia. Escolha outra.',
  LT003: 'Não deu para criar: o lembrete precisa de texto, categoria e uma data de hoje em diante.',
  LT005: 'Só o Administrador cria lembrete. Se não for o caso, sua sessão não confere — entre de novo.',
}

const RECUSA_DE_CATEGORIA: Record<string, string> = {
  LT001: 'Esta categoria mudou enquanto você olhava. A tela já está em dia — confira e salve de novo.',
  LT002: 'Já existe uma categoria com esse nome.',
  LT003: 'A categoria precisa de nome e de quantos dias antes avisar.',
  LT005: 'Só o Administrador mexe em categoria. Se não for o caso, sua sessão não confere — entre de novo.',
}

const RECUSA_DE_CONCLUIR: Record<string, string> = {
  LT001: 'Este lembrete mudou enquanto você olhava. A tela já está em dia — confira e conclua de novo.',
  LT002: 'Este lembrete já foi concluído.',
  LT005: 'Este lembrete não está na sua lista. Se não for o caso, sua sessão não confere — entre de novo.',
}

const RECUSA_DE_EDITAR: Record<string, string> = {
  LT001: 'Este aviso mudou enquanto você editava. A tela já está em dia — confira e salve de novo.',
  LT002: 'Este aviso foi arquivado enquanto você editava.',
  LT003: 'Não deu para salvar: o aviso precisa de título, numa linha só, e de alguma mudança.',
  LT005: 'Só quem escreveu o aviso edita. Se não for o caso, sua sessão não confere — entre de novo.',
}

const RECUSA_DE_AVISO: Record<string, string> = {
  LT001: 'Este aviso mudou enquanto você olhava. A tela já está em dia — leia de novo.',
  LT002: 'Este aviso já foi arquivado, ou a sua leitura já estava confirmada.',
  LT003: 'Este aviso não foi para você: ele saiu antes de você entrar na equipe.',
  LT005: 'Só o Administrador arquiva aviso. Se não for o caso, sua sessão não confere — entre de novo.',
}

/** Módulo do menu que ainda não tem tela ligada: diz isso, em vez de uma tela vazia. */
function TelaPendente({ nome, hora, carregando }: { nome: string; hora: string; carregando: boolean }) {
  return (
    <div className="lt-tela">
      <Moldura contexto={nome} hora={hora}>
        <p role="status" className="lt-vazio">
          {carregando ? 'Carregando…' : `${nome} ainda não está ligada ao banco.`}
        </p>
      </Moldura>
    </div>
  )
}

/**
 * Primeira abertura do app num aparelho, ou chave revogada (ADR 0048). A chave
 * sai de `node src/db/dispositivo.mjs registrar`, que só quem tem acesso ao banco
 * roda — por isso a tela não explica como consegui-la além de "peça".
 */
function RegistroDoAparelho({ recusada, aoRegistrar, aoEntrarComSenha }: { recusada: boolean; aoRegistrar: (chave: string) => void; aoEntrarComSenha: () => void }) {
  const [chave, definirChave] = useState('')
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return (
    <Moldura contexto="Registrar este aparelho" hora={hora}>
      <form
        className="lt-registro-aparelho"
        aria-label="Registrar este aparelho"
        onSubmit={(evento) => {
          evento.preventDefault()
          if (chave.trim() !== '') aoRegistrar(chave.trim())
        }}
      >
        <h1>Este aparelho ainda não está registrado</h1>
        <p>Por segurança, só um aparelho registrado mostra a equipe e aceita PIN. Peça a chave ao responsável pelo sistema e cole abaixo.</p>
        {recusada && <p role="alert">Essa chave não vale (errada ou revogada). Confira e cole de novo.</p>}
        <label htmlFor="chave-do-aparelho">Chave do aparelho</label>
        <input id="chave-do-aparelho" value={chave} autoComplete="off" spellCheck={false} onChange={(evento) => definirChave(evento.target.value)} />
        <button type="submit" disabled={chave.trim() === ''}>Registrar</button>
        <button type="button" className="lt-porta-troca" onClick={aoEntrarComSenha}>Sou sócio, gerente ou desenvolvedor: entrar com login e senha</button>
      </form>
    </Moldura>
  )
}

const RECUSA_DE_SENHA: Record<string, string> = {
  invalido: 'Login ou senha incorretos.',
  // app.admin_autenticar confere o bloqueio antes da senha (0044): 5 erros em 15 min.
  bloqueado: 'Acesso bloqueado por tentativas erradas. Aguarde 15 minutos.',
  'excesso de tentativas': 'Muitas tentativas a partir desta rede. Aguarde alguns minutos.',
}

/**
 * Login de sócio, gerente e Desenvolvedor (ADR 0047, 0049). É a porta de quem
 * administra pelo computador: aparelho sem chave de tablet cai aqui primeiro, e o
 * registro do tablet é o caminho secundário — o tablet é registrado uma vez só.
 */
function LoginPorSenha({ aoEntrar, aoRegistrarAparelho }: { aoEntrar: (sessao: Sessao) => void; aoRegistrarAparelho: () => void }) {
  const [login, definirLogin] = useState('')
  const [senha, definirSenha] = useState('')
  const [recusa, definirRecusa] = useState<string | null>(null)
  const [enviando, definirEnviando] = useState(false)
  const [senhaVisivel, definirSenhaVisivel] = useState(false)
  const [capsLock, definirCapsLock] = useState(false)
  const [esqueci, definirEsqueci] = useState(false)
  // O login abre com foco: o fundo só para quando alguém começa a digitar.
  const [digitando, definirDigitando] = useState(false)
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const conferirCapsLock = (evento: React.KeyboardEvent<HTMLInputElement>) => definirCapsLock(evento.getModifierState('CapsLock'))

  return (
    <div className="lt-login">
      <Moldura contexto="Entrar" hora={hora}>
        <SalasDoEstudio parado={digitando} />
        <form
          className="lt-registro-aparelho"
          aria-label="Entrar com login e senha"
          onKeyDown={() => definirDigitando(true)}
          onBlur={(evento) => { if (!evento.currentTarget.contains(evento.relatedTarget)) definirDigitando(false) }}
          onSubmit={async (evento) => {
            evento.preventDefault()
            definirEnviando(true)
            definirRecusa(null)
            try {
              // Os logins são minúsculos (wyll, paulo.holanda); "Wyll " não pode virar senha errada.
              aoEntrar(await entrarComSenha(login.trim().toLowerCase(), senha))
            } catch (erro) {
              definirSenha('')
              definirRecusa(
                erro instanceof ErroApi
                  ? RECUSA_DE_SENHA[erro.message] ?? 'Não foi possível entrar agora. Tente de novo.'
                  : 'Sem conexão com o sistema. Confira a rede e tente de novo.',
              )
            } finally {
              definirEnviando(false)
            }
          }}
        >
          <img className="lt-porta-logo" src={LOGO_TINTA_BRANCA} alt="Lifetrailer Studio" />
          <h1>Entrar</h1>
          <p>Acesso de sócios, gerente e desenvolvedor.</p>
          {recusa !== null && <p role="alert">{recusa}</p>}
          <label htmlFor="login">Login</label>
          <input id="login" value={login} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(evento) => definirLogin(evento.target.value)} />
          <label htmlFor="senha">Senha</label>
          <div className="lt-senha-campo">
            <input id="senha" type={senhaVisivel ? 'text' : 'password'} value={senha} autoComplete="current-password" onKeyUp={conferirCapsLock} onKeyDown={conferirCapsLock} onChange={(evento) => definirSenha(evento.target.value)} />
            <button type="button" className="lt-senha-olho" aria-pressed={senhaVisivel} onClick={() => definirSenhaVisivel((v) => !v)}>
              {senhaVisivel ? 'Esconder senha' : 'Mostrar senha'}
            </button>
          </div>
          {capsLock && <p className="lt-senha-caps">Caps Lock ligado</p>}
          <button type="submit" disabled={enviando || login.trim() === '' || senha === ''}>{enviando ? 'Entrando…' : 'Entrar'}</button>
          <button type="button" className="lt-porta-troca" aria-expanded={esqueci} onClick={() => definirEsqueci((v) => !v)}>Esqueci minha senha</button>
          {/* Não há troca de senha pelo app ainda: prometer "redefinir" seria mentir. */}
          {esqueci && <p>Fale com o responsável pelo sistema: ele cria uma senha nova para você. Depois de 5 tentativas erradas o acesso trava por 15 minutos.</p>}
          <button type="button" className="lt-porta-troca" onClick={aoRegistrarAparelho}>Este é o tablet do estúdio? Registrar este aparelho</button>
        </form>
      </Moldura>
    </div>
  )
}

/** Aviso curto no lugar da tela, enquanto ela não pode ser desenhada. */
function Recado({ texto, aoTentarNovamente, carregando = false }: {
  texto: string
  aoTentarNovamente?: () => void
  carregando?: boolean
}) {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return (
    <Moldura contexto="Lifetrailer" hora={hora}>
      <p role="status">{texto}</p>
      {aoTentarNovamente && <button type="button" className="lt-vazio-acao" disabled={carregando} onClick={aoTentarNovamente}>Tentar novamente</button>}
    </Moldura>
  )
}

export default function App() {
  // A sessão por senha sobrevive à recarga (o cookie continua valendo); a do
  // Atendente não — no tablet, recarregar é voltar a quem está entrando.
  const [sessao, definirSessao] = useState<Sessao | null>(() => lerSessaoPorSenha())
  const [entrada, definirEntrada] = useState<DadosEntradaDoServidor | null>(null)
  const [home, definirHome] = useState<DadosHome | null>(null)
  const [sidebar, definirSidebar] = useState<DadosSidebarDoServidor | null>(null)
  const [telaAtual, definirTelaAtual] = useState<TelaCarregada | null>(null)
  const [falha, definirFalha] = useState<string | null>(null)
  const [recuperando, definirRecuperando] = useState(false)

  // Estado de interação do menu. O servidor manda recolhido e em Início.
  const [destino, definirDestino] = useState<Destino>(INICIO)
  const [menuExpandido, definirMenuExpandido] = useState(false)
  const [grupoAberto, definirGrupoAberto] = useState<string | undefined>(undefined)

  // Estado de interação da Entrada — em que passo o dedo está. O servidor não
  // sabe disto e não deveria: é o que muda entre um toque e o seguinte.
  const [pessoaId, definirPessoaId] = useState<string | null>(null)
  const [digitos, definirDigitos] = useState('')
  const [situacao, definirSituacao] = useState<Situacao>('normal')

  // Deploy novo: na Entrada, sem ninguém digitando PIN, recarrega sozinho — não
  // há nada a perder. Com sessão aberta, só avisa; recarregar derrubaria o turno.
  const versaoNova = useVersaoNova()
  useEffect(() => {
    if (versaoNova && sessao === null && pessoaId === null && podeRecarregarSozinho()) window.location.reload()
  }, [versaoNova, sessao, pessoaId])


  // Estado de interação da tela de Avisos: de qual aviso a lista de leituras está
  // aberta. As leituras já vieram na resposta; abrir não gasta ida à rede.
  const [leiturasAbertas, definirLeiturasAbertas] = useState<string | null>(null)
  const [rascunhoAviso, definirRascunhoAviso] = useState<RascunhoAviso | null>(null)
  const [rascunhoLembrete, definirRascunhoLembrete] = useState<RascunhoLembrete | null>(null)
  const [novaCategoria, definirNovaCategoria] = useState<RascunhoCategoria | null>(null)
  const [edicaoCategoria, definirEdicaoCategoria] = useState<EdicaoCategoria | null>(null)
  const [edicaoAviso, definirEdicaoAviso] = useState<EdicaoAviso | null>(null)

  // Horas extras: o formulário de lançamento (nulo é fechado), quais históricos
  // o dedo abriu e em que registro a caixa de motivo está aberta. Tudo já veio
  // na resposta — abrir não gasta ida à rede.
  const [rascunhoHoraExtra, definirRascunhoHoraExtra] = useState<RascunhoHoraExtra | null>(null)
  const [historicosAbertos, definirHistoricosAbertos] = useState<string[]>([])
  const [motivoDeHoraExtra, definirMotivoDeHoraExtra] = useState<MotivoDeHoraExtra | null>(null)

  // Treinamento: o que está sendo digitado na busca. Nulo é "ainda não digitou",
  // e aí vale o que o servidor já filtrou — quem manda na lista é o recorte.
  const [buscaDeTreinamento, definirBuscaDeTreinamento] = useState<string | null>(null)
  // O tutorial aberto no editor (0089). Fora do componente: a releitura depois
  // de criar remonta a tela, e o tutorial novo tem de abrir já editando.
  const [tutorialEmEdicao, definirTutorialEmEdicao] = useState<string | null>(null)
  const [pastaDeTreinamento, definirPastaDeTreinamento] = useState<string | null>(null)

  // A passada de conferência do Estoque, enquanto o dedo está nela: `valores` é
  // o número que a tela mostra, `tocados` são os insumos que a pessoa de fato
  // mexeu. Nulo é "não está editando".
  //
  // ⚠ Os dois são necessários. Só `valores` não distinguiria "contei e deu
  // zero" de "nunca foi conferido" — os dois chegam como 0 —, e conferência é
  // justamente a diferença entre contar e não ter contado.
  const [rascunhoEstoque, definirRascunhoEstoque] = useState<RascunhoEstoque | null>(null)

  // Um "Repor / ajustar" aberto por vez: a tela só desenha um, e dois abertos
  // no mesmo item seriam dois deltas contra o mesmo saldo lido.
  const [ajusteBomboniere, definirAjusteBomboniere] = useState<AjusteBomboniere | null>(null)

  // Qual miniatura do Estoque está ampliada. Só o identificador: a foto vem da
  // lista, e guardar o objeto deixaria a ampliação velha depois de uma releitura.
  const [fotoDoEstoque, definirFotoDoEstoque] = useState<string | null>(null)

  const [fichaAberta, definirFichaAberta] = useState<FichaAberta | null>(null)
  const [renomeacao, definirRenomeacao] = useState<Renomeacao | null>(null)

  // "Editar escala": nulo é leitura; objeto (mesmo vazio) é o modo de edição,
  // com o que o dedo marcou por turno. Nada vai ao banco antes do Confirmar.
  const [rascunhoEscala, definirRascunhoEscala] = useState<RascunhoEscala | null>(null)
  // A decisão de cada troca afetada pela nova âncora, até o "Confirmar nova
  // âncora". Quem abre e fecha a revisão é o recorte `?revisar=`.
  const [decisoesRevisao, definirDecisoesRevisao] = useState<RascunhoRevisao>({})
  // Quem o botão de cada domingo livre escala agora. "outra pessoa" mexe aqui;
  // nada vai ao servidor até o "Assumir · <nome>".
  const [domingoEscolhido, definirDomingoEscolhido] = useState<RascunhoDomingo>({})

  // O modal da justificativa do Checklist é recorte (`?item=`), não estado
  // guardado aqui: a foto dele é endereço assinado, e só o servidor assina. O
  // que mora no cliente é o motivo sendo escrito e o que a foto está fazendo.
  const [rascunhoJustificativa, definirRascunhoJustificativa] = useState<RascunhoJustificativa | null>(null)

  // O formulário dos Achados segue o mesmo desenho: o esqueleto é recorte
  // (`?registrar=1`) e o que está sendo escrito mora aqui. `fotoDoAchado` é o
  // envio da foto de um achado que JÁ existe — do "Anexar foto" do detalhe, ou
  // do Guardar cuja segunda chamada não chegou.
  const [rascunhoAchado, definirRascunhoAchado] = useState<RascunhoAchado | null>(null)
  const [fotoDoAchado, definirFotoDoAchado] = useState<FotoDoAchado | null>(null)
  const [saidaDoAchado, definirSaidaDoAchado] = useState<SaidaDoAchado | null>(null)
  // O último "Copiar mensagem" de um achado (ADR 0075). Não escreve nada: só
  // diz à Helena se o texto foi para a área de transferência.
  const [mensagemDoAchado, definirMensagemDoAchado] = useState<MensagemDoAchado | null>(null)

  // A fila de fotos do tablet (ADR 0072): o que ainda não subiu, e se a bandeja
  // está aberta. Quem manda na lista é o IndexedDB; isto é só o espelho.
  const [fila, definirFila] = useState<ItemDaFila[]>([])
  const [bandejaAberta, definirBandejaAberta] = useState(false)

  // A recusa da última escrita (Comanda, Checklist). Vive aqui e não na tela
  // porque some quando a tela é relida — o que é o próprio sinal de que a
  // escrita passou.
  const [recusaEscrita, definirRecusaEscrita] = useState<string | null>(null)
  // A mensagem do último "Copiar mensagem", da Comanda em que foi copiada.
  const [mensagemCopiada, definirMensagemCopiada] = useState<
    { comanda: string; texto: string; naAreaDeTransferencia: boolean } | null>(null)
  const [recusaNaHome, definirRecusaNaHome] = useState<string | null>(null)

  // O modal do Aviso Urgente (ADR 0070 §2): espera a primeira troca de tela
  // depois do PIN, e o "Depois" o guarda até o fim da sessão. Os avisos vêm do
  // menu, que já é relido a cada navegação.
  const [urgentesNaNavegacao, definirUrgentesNaNavegacao] = useState<'aguardando' | 'mostrar' | 'adiado'>('aguardando')
  const [recusaUrgente, definirRecusaUrgente] = useState<string | null>(null)

  // O aparelho: sem chave guardada, nem se tenta a Entrada — a resposta seria 401.
  // `chaveRecusada` separa "primeira vez" de "a chave que estava aqui não vale mais".
  const [aparelhoRegistrado, definirAparelhoRegistrado] = useState(() => lerChaveDoAparelho() !== null)
  const [chaveRecusada, definirChaveRecusada] = useState(false)
  // Aparelho sem chave: a porta padrão é o login por senha; o registro do tablet
  // é o outro lado da mesma porta.
  const [mostrarRegistro, definirMostrarRegistro] = useState(false)

  const esquecerAparelho = useCallback(() => {
    guardarChaveDoAparelho(null)
    definirAparelhoRegistrado(false)
    definirChaveRecusada(true)
    definirSessao(null)
    definirEntrada(null)
  }, [])

  useEffect(() => {
    if (sessao !== null || !aparelhoRegistrado) return
    buscarEntrada().then(
      (dados) => {
        definirEntrada(dados)
        definirChaveRecusada(false)
      },
      (erro: Error) => (aparelhoRecusado(erro) ? esquecerAparelho() : definirFalha(erro.message)),
    )
  }, [sessao, aparelhoRegistrado, esquecerAparelho])

  // A descarga da fila: ao abrir o app, quando a rede volta, e a cada minuto,
  // que é o degrau mais curto da espera (ADR 0021 §1). Cada foto sobe com a
  // claim de quem a tirou, então não depende de haver alguém logado.
  const descarregarFila = useCallback(() => {
    void descarregar().then(({ aparelhoRecusado: recusado }) => { if (recusado) esquecerAparelho() })
  }, [esquecerAparelho])

  useEffect(() => observarFila(definirFila), [])

  useEffect(() => {
    descarregarFila()
    window.addEventListener('online', descarregarFila)
    const relogio = window.setInterval(descarregarFila, 60_000)
    return () => {
      window.removeEventListener('online', descarregarFila)
      window.clearInterval(relogio)
    }
  }, [descarregarFila])

  // Quem entra de novo leva as fotos dele que caducaram na virada de turno (ADR 0072 §5).
  useEffect(() => {
    if (sessao?.claim === undefined) return
    void renovarClaim(sessao.claim).then(descarregarFila)
  }, [sessao, descarregarFila])

  // Volta pro passo "quem está entrando", não pro PIN de quem saiu: a claim
  // expira na virada de turno, e quem chega é outra pessoa.
  const sair = useCallback(() => {
    // Sessão por senha: o cookie é apagado no servidor. Chamar sem sessão por
    // senha é inofensivo — o DELETE só devolve um cookie vazio.
    if (lerSessaoPorSenha() !== null) void sairDaSessaoPorSenha()
    definirSessao(null)
    definirHome(null)
    definirSidebar(null)
    definirTelaAtual(null)
    definirPessoaId(null)
    definirRascunhoJustificativa(null)
    definirRascunhoAchado(null)
    definirFotoDoAchado(null)
    definirSaidaDoAchado(null)
    definirMensagemDoAchado(null)
    definirBandejaAberta(false)
    definirRascunhoAviso(null)
    definirRascunhoLembrete(null)
    definirNovaCategoria(null)
    definirEdicaoCategoria(null)
    definirEdicaoAviso(null)
    definirRascunhoHoraExtra(null)
    definirHistoricosAbertos([])
    definirMotivoDeHoraExtra(null)
    definirBuscaDeTreinamento(null)
    definirTutorialEmEdicao(null)
    definirPastaDeTreinamento(null)
    definirUrgentesNaNavegacao('aguardando')
    definirRecusaUrgente(null)
    definirDestino(INICIO)
    definirMenuExpandido(false)
  }, [])

  const lerOuSair = useCallback(async (ler: () => Promise<void>) => {
    try {
      await ler()
    } catch (erro) {
      // Chave revogada no meio do turno: volta ao registro, não à Entrada.
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      // Claim expirada é o caminho normal na virada de turno, não uma falha.
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      definirFalha(erro instanceof Error ? erro.message : 'falha ao carregar')
    }
  }, [sair, esquecerAparelho])

  const recarregarHome = useCallback(
    (claim: string | undefined) => lerOuSair(async () => definirHome(await buscarHome(claim))),
    [lerOuSair],
  )

  // O menu é relido a cada navegação: os contadores mudam com o que o turno faz,
  // e uma ida à rede por troca de tela é o custo que o ADR 0042 §2 já aceitou.
  const recarregarSidebar = useCallback(
    (claim: string | undefined) => lerOuSair(async () => definirSidebar(await buscarTela('sidebar', claim))),
    [lerOuSair],
  )

  // A releitura do gesto: uma ida, e a tela inteira em dia. Vive aqui porque a
  // escrita e o envio da foto terminam do mesmo jeito.
  const recarregarTela = (nome: TelaDeModulo) =>
    lerOuSair(async () => {
      const dados = await buscarTela(nome, sessao?.claim, parametrosDe(destino))
      definirTelaAtual({ nome, chave: chaveDe(destino), dados } as TelaCarregada)
    })

  // A miniatura da foto escolhida é um `blob:` que o navegador segura até alguém
  // devolvê-lo. Sem isto, cada foto trocada no formulário deixa uma cópia na
  // memória do quiosque, que fica aberto o turno inteiro.
  useEffect(() => {
    const previa = rascunhoAchado?.previa
    if (previa === null || previa === undefined) return
    return () => { try { URL.revokeObjectURL(previa) } catch { /* sem suporte, nada a devolver */ } }
  }, [rascunhoAchado?.previa])

  useEffect(() => {
    if (sessao === null) return
    void recarregarHome(sessao.claim)
  }, [sessao, recarregarHome])

  useEffect(() => {
    if (sessao === null) return
    void recarregarSidebar(sessao.claim)
  }, [sessao, destino, recarregarSidebar])

  // A tela do módulo é lida quando o destino muda — inclusive a aba, que é um
  // recorte diferente no servidor (fase, período), não um filtro local.
  useEffect(() => {
    if (sessao === null) return
    // Sair da tela (ou trocar de aba) abandona a passada: o que não foi
    // confirmado não existe, e voltar depois mostrando números de antes seria
    // a tela afirmando uma contagem que ninguém gravou.
    definirRascunhoEstoque(null)
    definirAjusteBomboniere(null)
    definirFichaAberta(null)
    definirRenomeacao(null)
    definirFotoDoEstoque(null)
    definirRascunhoEscala(null)
    const ligada = TELAS_LIGADAS[destino.modulo]
    if (ligada === undefined) return
    // Uma letra a cada leitura: a resposta de uma busca já trocada chega tarde
    // e não pode cobrir a da busca atual.
    let vigente = true
    void lerOuSair(async () => {
      const dados = await buscarTela(ligada.nome, sessao.claim, parametrosDe(destino))
      if (vigente) definirTelaAtual({ nome: ligada.nome, chave: chaveDe(destino), dados } as TelaCarregada)
    })
    return () => { vigente = false }
  }, [sessao, destino, lerOuSair])

  // Recupera as leituras do destino atual. Uma escrita pode ter passado antes
  // de a releitura falhar, por isso nenhuma RPC (nem o PIN) é reenviada aqui.
  async function tentarCarregarNovamente() {
    definirRecuperando(true)
    definirFalha(null)
    try {
      await lerOuSair(async () => {
        if (sessao === null) {
          definirDigitos('')
          definirEntrada(await buscarEntrada())
          definirChaveRecusada(false)
          return
        }

        const ligada = TELAS_LIGADAS[destino.modulo]
        const [novaHome, novaSidebar, dados] = await Promise.all([
          buscarHome(sessao.claim),
          buscarTela('sidebar', sessao.claim),
          ligada === undefined ? null : buscarTela(ligada.nome, sessao.claim, parametrosDe(destino)),
        ])
        definirHome(novaHome)
        definirSidebar(novaSidebar)
        if (ligada !== undefined && dados !== null) {
          definirTelaAtual({ nome: ligada.nome, chave: chaveDe(destino), dados } as TelaCarregada)
        }
      })
    } finally {
      definirRecuperando(false)
    }
  }

  // Escrita ligada onde a RPC existe (Comanda, Checklist, conferência do
  // Estoque). Nos outros módulos, o que está ligado é só o que navega.
  function desenharTela(carregada: TelaCarregada) {
    switch (carregada.nome) {
      case 'achados':
        return (
          <Achados
            dados={comSaidaDoAchado(
              comRegistroDeAchado(carregada.dados, rascunhoAchado, fotoDoAchado, mensagemDoAchado),
              saidaDoAchado, recusaEscrita)}
            aoSelecionarAba={(aba) => navegar(`achados-${aba}`)}
            aoAbrirAchado={(achado) => {
              fecharSaidaDoAchado()
              definirMensagemDoAchado(null)
              recortar({ achado })
            }}
            aoFecharAchado={() => {
              definirFotoDoAchado(null)
              definirSaidaDoAchado(null)
              definirMensagemDoAchado(null)
              recortar({ achado: null, saida: null })
            }}
            aoRegistrarAchado={abrirRegistroDeAchado}
            aoCancelarRegistro={fecharRegistroDeAchado}
            aoAlterarRegistro={(campo, valor) => alterarRascunho({ [campo]: valor })}
            aoEscolherFoto={(arquivo) =>
              alterarRascunho({ arquivo, previa: previaDe(arquivo) })}
            aoSelecionarEstudio={(estudio) =>
              definirRascunhoAchado((atual) => (atual === null ? atual
                : { ...atual, estudio: alternarEscolha(atual.estudio, estudio), recusa: null }))}
            aoSelecionarLugar={(lugar) =>
              definirRascunhoAchado((atual) => (atual === null ? atual
                : { ...atual, lugar: alternarEscolha(atual.lugar, lugar), recusa: null }))}
            aoGuardarAchado={() => void guardarAchado(carregada.dados)}
            aoAnexarFoto={(achado, arquivo) => void (async () => {
              await enviarFotoDoAchado(achado, arquivo)
              await recarregarTela('achados')
            })()}
            aoCopiarMensagemDoAchado={() => void copiarMensagemDoAchado(carregada.dados.selecionado)}
            aoAcionarAchado={abrirSaidaDoAchado}
            aoAlterarNomeRetirada={(_, nome) => alterarSaidaDoAchado(nome)}
            aoAlterarDestino={(_, destino) => alterarSaidaDoAchado(destino)}
            aoConfirmarEntrega={() => void confirmarSaidaDoAchado(carregada.dados.selecionado)}
            aoConfirmarDoacao={() => void confirmarSaidaDoAchado(carregada.dados.selecionado)}
            aoCancelarEntrega={fecharSaidaDoAchado}
            aoCancelarDoacao={fecharSaidaDoAchado}
          />
        )
      case 'ajustes':
        return (
          <Ajustes
            dados={carregada.dados}
            aoIrParaEntrada={sair}
            // Um item no lote: a troca é de uma pessoa por vez, e o PIN fica
            // só no estado da linha que o digitou (TrocaDePin.tsx).
            aoTrocarPin={(colaborador, pin) =>
              agirNosAjustes('pin_definir_lote', { pines: [{ colaborador_id: colaborador, pin }] },
                `PIN de ${carregada.dados.pessoas.find((p) => p.identificador === colaborador)?.nome ?? 'Atendente'} trocado. Vale no próximo acesso.`,
                RECUSA_DE_PIN)}
            aoTrocarMinhaSenha={(atual, nova) =>
              agirNosAjustes('senha_trocar_propria', { senha_atual: atual, senha_nova: nova }, 'Senha trocada. Use a nova no próximo login.')}
            aoRedefinirSenha={(colaborador, login, senha) =>
              agirNosAjustes('senha_definir', { colaborador_id: colaborador, login, senha }, 'Senha redefinida. Passe a senha nova à pessoa.')}
            aoCadastrarColaborador={(nome, nivel, socio, pin) =>
              agirNosAjustes('colaborador_criar', { nome, nivel, socio, pin }, `${nome} cadastrado(a).`, RECUSA_DE_EQUIPE)}
            aoDefinirAtivo={(colaborador, ativo, versao) =>
              agirNosAjustes('colaborador_ativo_definir', { colaborador_id: colaborador, ativo, versao },
                ativo ? 'Reativado(a).' : 'Desativado(a). Os turnos futuros ficaram sem ninguém: confira a Escala.', RECUSA_DE_EQUIPE)}
          />
        )
      case 'avisos':
        return (
          <Avisos
            dados={comEstadoDosAvisos(carregada.dados, leiturasAbertas, rascunhoAviso, rascunhoLembrete, novaCategoria, edicaoCategoria, edicaoAviso)}
            recusa={recusaEscrita}
            aoSelecionarAba={(aba) => navegar(`avisos-${aba}`)}
            aoAlternarEscrita={() => (carregada.dados.formulario === null && carregada.dados.formularioLembrete === null
              ? abrirEscritaDeAviso() : fecharEscritaDeAviso())}
            aoAlterarTitulo={(titulo) => alterarRascunhoAviso({ titulo })}
            aoAlterarTexto={(texto) => alterarRascunhoAviso({ texto })}
            aoSelecionarPublico={(publico) => alterarRascunhoAviso({ publico })}
            aoAlternarConfirmacao={() => alterarRascunhoAviso({ pedeConfirmacao: !(rascunhoAviso?.pedeConfirmacao ?? true) })}
            aoAlternarUrgencia={() => alterarRascunhoAviso({ urgente: !(rascunhoAviso?.urgente ?? false) })}
            aoPublicar={() => void publicarAviso()}
            aoAlterarLembrete={(mudanca) => {
              // Escolher a categoria traz a antecedência dela; o Admin pode trocar depois.
              const categoria = carregada.dados.formularioLembrete?.categorias.find((c) => c.identificador === mudanca.categoria)
              definirRascunhoLembrete((atual) => ({
                ...(atual ?? RASCUNHO_LEMBRETE_VAZIO), ...mudanca,
                ...(categoria === undefined ? {} : { antecedencia: String(categoria.antecedencia) }),
              }))
            }}
            aoCriarLembrete={() => void criarLembrete()}
            aoAlterarNovaCategoria={(mudanca) => definirNovaCategoria((atual) => ({ ...(atual ?? RASCUNHO_CATEGORIA_VAZIO), ...mudanca }))}
            aoCriarCategoria={() => void criarCategoria()}
            aoAlterarEdicaoCategoria={(mudanca) => definirEdicaoCategoria((atual) => (atual === null ? atual : { ...atual, ...mudanca }))}
            aoAcionarCategoria={(identificador, acao) => void acionarCategoria(carregada.dados, identificador, acao)}
            aoAlterarEdicaoAviso={(mudanca) => definirEdicaoAviso((atual) => (atual === null ? atual : { ...atual, ...mudanca }))}
            aoAcionarEdicaoAviso={(identificador, acao) => void acionarEdicaoAviso(carregada.dados, identificador, acao)}
            aoAcionarAviso={(identificador, acao) => {
              if (acao === 'editar') {
                const aviso = carregada.dados.avisos.find((a) => a.identificador === identificador)
                if (aviso === undefined) return
                definirRecusaEscrita(null)
                definirEdicaoAviso({ identificador, titulo: aviso.titulo, texto: aviso.texto, enviando: false })
              }
              if (acao === 'leituras') {
                definirLeiturasAbertas((atual) => (atual === identificador ? null : identificador))
              }
              if (acao === 'horas_extras') navegar('horas')
              if (acao === 'lembretes') navegar('avisos-lembretes')
              if (acao === 'confirmar' || acao === 'arquivar') {
                const aviso = carregada.dados.avisos.find((a) => a.identificador === identificador)
                if (aviso === undefined) return
                void escrever('avisos', RECUSA_DE_AVISO, `aviso_${acao}`, { aviso_id: identificador, versao: aviso.versao })
              }
              if (acao === 'concluir') {
                const lembrete = carregada.dados.avisos.find((a) => a.identificador === identificador)
                if (lembrete === undefined) return
                void escrever('avisos', RECUSA_DE_CONCLUIR, 'lembrete_concluir', { lembrete_id: identificador, versao: lembrete.versao })
              }
            }}
          />
        )
      case 'comanda':
        if (carregada.dados.selecionada?.comprovante) void carregarComprovante()
        return (
          <Comanda
            dados={carregada.dados}
            aoSelecionarModo={(modo) => navegar(`comanda-${modo}`)}
            aoFiltrarStatus={(status) => recortar({ status: status === 'todas' ? null : status })}
            aoBuscar={(texto) => recortar({ busca: texto === '' ? null : texto })}
            aoAbrirComanda={(comanda) => recortar({ comanda })}
            aoFecharDetalhe={() => recortar({ comanda: null })}
            recusa={recusaEscrita}
            copiada={mensagemCopiada !== null && mensagemCopiada.comanda === carregada.dados.selecionada?.identificador
              ? mensagemCopiada : null}
            aoAssumir={(comanda, versao) =>
              void escreverNaComanda('comanda_assumir_posse', { comanda_id: comanda, versao })}
            aoLancarLinha={(comanda, linha) =>
              void escreverNaComanda('comanda_linha_lancar', {
                comanda_id: comanda.identificador,
                versao: comanda.versao,
                tipo: linha.tipo,
                item_id: linha.item,
                descricao: linha.item === null ? linha.descricao : null,
                quantidade: linha.quantidade,
                // Vírgula é como se digita preço aqui; o banco quer ponto.
                preco: linha.item === null ? Number(linha.preco.replace(',', '.')) : null,
              })}
            aoLancarEstudio={(comanda, novo, lancamento) =>
              void escreverNaComanda('comanda_estudio_lancar', {
                comanda_id: comanda.identificador,
                versao: comanda.versao,
                estudio_id: novo.estudio,
                // Hora local, como o praticado: o banco resolve em America/Maceio.
                // Início antes do início do ensaio é depois da meia-noite.
                inicio: `${novo.inicio < lancamento.inicioEnsaio ? diaSeguinte(lancamento.data) : lancamento.data} ${novo.inicio}`,
                duracao_minutos: novo.duracao,
              })}
            aoRemoverLinha={(comanda, linha, tipo) =>
              void escreverNaComanda('comanda_linha_remover', {
                comanda_id: comanda.identificador, versao: comanda.versao, tipo, linha_id: linha,
              })}
            aoAcionar={(acao, comanda, praticado, forma) => void acionarComanda(acao, comanda, praticado, forma)}
          />
        )
      case 'checklist':
        return (
          <Checklist
            dados={comJustificativa(carregada.dados, rascunhoJustificativa, recusaEscrita, fila)}
            aoSelecionarFase={(fase) => irParaFaseDoChecklist(fase)}
            aoVerSaida={() => irParaFaseDoChecklist('saida')}
            aoVerEntrada={() => irParaFaseDoChecklist('entrada')}
            aoIrParaEntrada={() => irParaFaseDoChecklist('entrada')}
            aoSelecionarDia={(data) => { fecharJustificativa(); recortar({ data }) }}
            aoTratarItem={(item: ItemChecklist) => void marcarItemDoChecklist(item)}
            aoJustificar={abrirJustificativa}
            aoVerJustificativa={verJustificativa}
            aoFecharModal={fecharJustificativa}
            aoAlterarTexto={(texto) =>
              definirRascunhoJustificativa((atual) => (atual === null ? atual : { ...atual, texto }))}
            aoEscolherFoto={(arquivo) => void enviarFotoDaJustificativa(arquivo)}
            aoConfirmarJustificativa={() => void confirmarJustificativa(carregada.dados.modal)}
            aoRemoverJustificativa={() => void removerJustificativa(carregada.dados.modal)}
            aoConcluir={() => {
              const { dia, fase } = carregada.dados
              if (dia === null) return
              void escrever('checklist', RECUSA_DE_CHECKLIST, 'checklist_fase_concluir', {
                dia_id: dia.identificador, versao: dia.versao, fase,
              })
            }}
          />
        )
      case 'escala':
        return (
          <Escala
            dados={comDomingo(comRevisao(comEdicao(carregada.dados, rascunhoEscala), decisoesRevisao), domingoEscolhido)}
            recusa={recusaEscrita}
            aoSelecionarVisao={(visao) => navegar(`escala-${visao}`)}
            aoEditar={() => definirRascunhoEscala({})}
            aoCancelarEdicao={() => definirRascunhoEscala(null)}
            aoConfirmarEdicao={() => void confirmarEscala(carregada.dados)}
            aoAcionarTurno={(data, turno, acao) => {
              const alvo = carregada.dados.dias.find((dia) => dia.data === data)
                ?.turnos.find((t) => t.turno === turno)
              if (acao === 'veio') {
                const presenca = alvo?.presenca
                if (presenca === undefined) return
                void escrever('escala', RECUSA_DE_PRESENCA, 'escala_presenca_marcar', {
                  turno_id: presenca.identificador, colaborador_id: presenca.colaborador, presente: !presenca.veio,
                })
                return
              }
              const edicao = alvo?.edicao
              if (edicao === undefined || acao !== 'troca') return
              definirRascunhoEscala((atual) => atual === null ? atual
                : alternarTroca(atual, edicao, carregada.dados.equipe))
            }}
            aoAcionarDia={(data, acao) => void acionarDomingo(carregada.dados, data, acao)}
            aoRevisarPadrao={(turno) => {
              definirDecisoesRevisao({})
              recortar({ revisar: turno })
            }}
            aoDecidirTroca={(identificador, acao) => {
              const afetada = carregada.dados.revisao?.afetadas
                .find((troca) => troca.identificador === identificador)
              if (afetada === undefined) return
              definirDecisoesRevisao((atual) => decidirTroca(atual, afetada, acao))
            }}
            aoCancelarRevisao={() => {
              definirDecisoesRevisao({})
              recortar({ revisar: null })
            }}
            aoConfirmarRevisao={() => void confirmarRevisao(carregada.dados)}
          />
        )
      case 'horas':
        return (
          <HorasExtras
            dados={comEstadoDasHorasExtras(
              carregada.dados, rascunhoHoraExtra, historicosAbertos, motivoDeHoraExtra)}
            recusa={recusaEscrita}
            aoSelecionarAba={(aba) => navegar(`horas-${aba}`)}
            aoSelecionarPeriodo={(periodo) => recortar({ periodo })}
            aoLancar={() => abrirLancamentoDeExtra(carregada.dados)}
            aoCancelarLancamento={() => definirRascunhoHoraExtra(null)}
            aoAlterarLancamento={(campo, valor) => alterarLancamentoDeExtra(
              // Trocar a data tira o ensaio escolhido: ele era de outro dia.
              campo === 'data'
                ? { data: valor, ...(rascunhoHoraExtra?.ensaio === SEM_ENSAIO ? {} : { ensaio: '' }) }
                : { [campo]: valor })}
            aoSelecionarDestinatario={(destinatario) => alterarLancamentoDeExtra({ destinatario })}
            aoSelecionarEnsaio={(ensaio) => alterarLancamentoDeExtra({ ensaio: ensaio ?? SEM_ENSAIO })}
            aoAlternarOutrosEnsaios={() => alterarLancamentoDeExtra({ outrosAbertos: !rascunhoHoraExtra?.outrosAbertos, busca: '' })}
            aoBuscarEnsaio={(busca) => alterarLancamentoDeExtra({ busca })}
            aoEnviarLancamento={() => void enviarLancamentoDeExtra(carregada.dados.ensaios)}
            aoAcionarExtra={(identificador, acao) => {
              const extra = carregada.dados.registros.find((r) => r.identificador === identificador)
              if (extra !== undefined) acionarHoraExtra(extra, acao)
            }}
            aoAlternarHistorico={(identificador) =>
              definirHistoricosAbertos((atual) => atual.includes(identificador)
                ? atual.filter((i) => i !== identificador)
                : [...atual, identificador])}
            aoAlterarMotivoCancelamento={(identificador, motivo) =>
              definirMotivoDeHoraExtra((atual) =>
                atual === null || atual.extra !== identificador ? atual : { ...atual, motivo })}
            aoVoltarCancelamento={() => definirMotivoDeHoraExtra(null)}
            aoConfirmarCancelamento={(identificador) => {
              const extra = carregada.dados.registros.find((r) => r.identificador === identificador)
              if (extra !== undefined) void confirmarMotivoDeHoraExtra(extra)
            }}
          />
        )
      case 'estoque':
        return (
          <Estoque
            dados={comFotoDoEstoque(comCatalogo(
              comRascunho(carregada.dados, rascunhoEstoque, ajusteBomboniere), fichaAberta, renomeacao), fotoDoEstoque)}
            recusa={recusaEscrita}
            aoSelecionarAba={(aba) => navegar(`estoque-${aba}`)}
            aoAbrirFoto={definirFotoDoEstoque}
            aoFecharFoto={() => definirFotoDoEstoque(null)}
            aoEditar={() => definirRascunhoEstoque(rascunhoDe(carregada.dados))}
            aoCancelar={() => definirRascunhoEstoque(null)}
            aoConfirmar={() => void confirmarConferencia()}
            aoDiminuirQuantidade={(item) => mexerNaQuantidade(item, -1)}
            aoAumentarQuantidade={(item) => mexerNaQuantidade(item, +1)}
            aoReporAjustar={(item) => definirAjusteBomboniere({
              item,
              saldo: Number(carregada.dados.bomboniere.find((b) => b.identificador === item)?.saldo ?? 0),
              motivo: '',
            })}
            aoDiminuirSaldo={(item) => mexerNoSaldo(item, -1)}
            aoAumentarSaldo={(item) => mexerNoSaldo(item, +1)}
            aoAlterarMotivoAjuste={(item, motivo) =>
              definirAjusteBomboniere((atual) => (atual?.item === item ? { ...atual, motivo } : atual))}
            aoConfirmarAjuste={(item) => void confirmarAjuste(carregada.dados, item)}
            aoNovoInsumo={() => { definirRecusaEscrita(null); definirFichaAberta(FICHA_NOVA) }}
            aoEditarInsumo={(item) => {
              const ficha = insumosDe(carregada.dados).find((i) => i.identificador === item)?.ficha
              if (ficha === undefined) return
              definirRecusaEscrita(null)
              definirFichaAberta({ ...ficha, item })
            }}
            aoAlterarFicha={(campo, valor) =>
              definirFichaAberta((atual) => (atual === null ? atual : { ...atual, [campo]: valor }))}
            aoCancelarFicha={() => { definirRecusaEscrita(null); definirFichaAberta(null) }}
            aoSalvarFicha={() => void salvarFicha(carregada.dados)}
            aoDesativarInsumo={() => void desativarInsumo(carregada.dados)}
            aoRenomear={(campo, de) => definirRenomeacao({ campo, de, texto: de === 'SEM_NOME_PENDENCIA' ? '' : de })}
            aoAlterarRenomeacao={(texto) => definirRenomeacao((atual) => (atual === null ? atual : { ...atual, texto }))}
            aoCancelarRenomeacao={() => definirRenomeacao(null)}
            aoSalvarRenomeacao={() => void salvarRenomeacao()}
          />
        )
      // Só de leitura: abrir tutorial não escreve nada (o spec decidiu que não
      // há rastreio de quem leu o quê). Busca e tutorial aberto são recorte.
      case 'treinamento':
        return (
          <Treinamento
            dados={filtrarTreinamento(carregada.dados, buscaDeTreinamento ?? '')}
            digitado={buscaDeTreinamento ?? ''}
            aoDigitarBusca={definirBuscaDeTreinamento}
            aoLimparBusca={() => definirBuscaDeTreinamento('')}
            aoReportarProblema={(tutorial, texto) =>
              agirNoTreinamento('tutorial_reportar', { tutorial_id: tutorial, texto: texto.trim() },
                'Aviso enviado. A administração vai revisar o tutorial.')}
            aoAlternarArquivados={() =>
              recortar({ arquivados: carregada.dados.incluirArquivados ? null : '1', tutorial: null })}
            aoAbrirTutorial={(tutorial) => recortar({ tutorial })}
            aoFecharTutorial={() => recortar({ tutorial: null })}
            editando={tutorialEmEdicao}
            pasta={pastaDeTreinamento}
            aoAbrirPasta={definirPastaDeTreinamento}
            aoDefinirEdicao={definirTutorialEmEdicao}
            aoCriarTutorial={async (categoria, titulo) => {
              const r = await agirNoTreinamento('tutorial_criar', { categoria_id: categoria, titulo }, 'Rascunho criado.')
              return { ...r, id: (r.resultado as { id?: string } | null)?.id }
            }}
            aoSalvarTutorial={(tutorial, versao, categoria, titulo, blocos) =>
              agirNoTreinamento('tutorial_salvar', {
                tutorial_id: tutorial, versao, categoria_id: categoria, titulo,
                blocos: blocos.map((b) => (b.tipo === 'texto' ? { tipo: 'texto', texto: b.texto } : { tipo: 'foto', midia_id: b.midiaId })),
              }, 'Tutorial salvo.')}
            aoEnviarFotoDoTutorial={enviarFotoDoTutorial}
            aoMudarStatusDoTutorial={(tutorial, versao, status) =>
              agirNoTreinamento('tutorial_status_definir', { tutorial_id: tutorial, versao, status },
                status === 'publicado' ? 'Publicado: a equipe já vê.' : status === 'arquivado' ? 'Arquivado.' : 'Despublicado: voltou a Rascunho.')}
            aoRestaurarTutorial={(tutorial, versao) =>
              agirNoTreinamento('tutorial_restaurar', { tutorial_id: tutorial, versao }, 'Versão anterior restaurada. Restaurar de novo desfaz.')}
            aoCriarCategoria={(nome, descricao) =>
              agirNoTreinamento('treinamento_categoria_criar', { nome, descricao: descricao || null }, `Categoria ${nome} criada.`)}
            aoAlterarCategoria={(categoria, versao, nome, descricao, ativa) =>
              agirNoTreinamento('treinamento_categoria_alterar', { categoria_id: categoria, versao, nome, descricao: descricao || null, ativa }, 'Categoria salva.')}
          />
        )
    }
  }

  // ------------------------------------------------------------- escritas
  // Cada gesto é uma RPC e uma releitura: o servidor devolve a linha nova, mas
  // a tela inteira depende dela (total, ações, progresso, versão) e reler é uma
  // ida, não seis. A `versao` viaja em todas — duas telas abertas no mesmo
  // balcão é o caso normal, e a segunda leva LT001 em vez de escrever por cima.
  // Devolve se a RPC passou. Quem escreve um gesto só ignora a resposta — a
  // releitura já conta a história; quem escreve uma passada inteira (a
  // conferência do Estoque) precisa saber, para não jogar fora o que contou.
  async function escrever(
    tela: TelaDeModulo,
    recusas: Record<string, string>,
    nome: string,
    corpo: Record<string, unknown>,
  ): Promise<boolean> {
    if (sessao === null) return false
    definirRecusaEscrita(null)
    let passou = true
    try {
      await chamarRpc(sessao.claim, nome, corpo)
    } catch (erro) {
      passou = false
      if (aparelhoRecusado(erro)) {
        esquecerAparelho()
        return false
      }
      if (erro instanceof ErroApi && erro.codigo === 401) {
        sair()
        return false
      }
      definirRecusaEscrita(erro instanceof ErroApi ? recusas[erro.dominio ?? ''] ?? erro.message : 'Sem conexão com o sistema.')
    }
    // Relê mesmo depois da recusa: LT001 significa que a tela está velha, e é
    // a releitura que a põe em dia.
    await recarregarTela(tela)
    return passou
  }

  // "Li e entendi" do modal. Não passa pelo `escrever` porque o modal não é uma
  // tela: quem fica velho é o menu (que tira o aviso da lista) e, se estiverem
  // atrás do modal, a Home ou os Avisos, que mostram o mesmo aviso.
  async function confirmarUrgente(aviso: AvisoUrgenteApresentado) {
    if (sessao === null) return
    definirRecusaUrgente(null)
    try {
      await chamarRpc(sessao.claim, 'aviso_confirmar', { aviso_id: aviso.identificador, versao: aviso.versao })
    } catch (erro) {
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      definirRecusaUrgente(erro instanceof ErroApi ? RECUSA_DE_AVISO[erro.dominio ?? ''] ?? erro.message : 'Sem conexão com o sistema.')
    }
    await Promise.all([
      recarregarSidebar(sessao.claim),
      destino.modulo === 'inicio' ? recarregarHome(sessao.claim)
        : destino.modulo === 'avisos' ? recarregarTela('avisos') : null,
    ])
  }

  const escreverNaComanda = (nome: string, corpo: Record<string, unknown>) =>
    escrever('comanda', RECUSA_DE_COMANDA, nome, corpo)

  // Tocar no item é alternar: o estado que vai é o oposto do que a tela mostra.
  const alternar = (item: { identificador: string; versao: number }, tratado: boolean) => ({
    item_id: item.identificador,
    versao: item.versao,
    estado: tratado ? 'nao_marcado' : 'feito',
  })

  // Trocar de fase no histórico continua no mesmo dia: o `data` do recorte vai junto.
  function irParaFaseDoChecklist(fase: string) {
    const data = destino.recorte?.data
    navegar(`checklist-${fase}`)
    if (data !== undefined) recortar({ data })
  }

  const marcarItemDoChecklist = (item: ItemChecklist) =>
    escrever('checklist', RECUSA_DE_CHECKLIST, 'checklist_item_marcar', alternar(item, item.tratado))

  // Da Home o mesmo gesto relê a HOME, não a tela do Checklist: quem tocou não
  // saiu do início, e o cartão é que precisa ficar em dia.
  async function marcarItemDaHome(item: ItemChecklistHome) {
    if (sessao === null) return
    definirRecusaEscrita(null)
    try {
      await chamarRpc(sessao.claim, 'checklist_item_marcar', alternar(item, item.marcado))
    } catch (erro) {
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      definirRecusaEscrita(erro instanceof ErroApi ? RECUSA_DE_CHECKLIST[erro.dominio ?? ''] ?? erro.message : 'Sem conexão com o sistema.')
    }
    await recarregarHome(sessao.claim)
  }

  // "Criar comanda" (#113): a exceção ao job da 0030 — ensaio remarcado que
  // chegou depois dele. Se o job (ou um segundo toque) criou no meio, o banco
  // responde LT003 "ja tem Comanda" sem dizer qual; e LT003 também é a guarda da
  // duração. Em vez de ler o texto do erro, relê a Home: se o ensaio ganhou
  // Comanda, o toque termina onde terminaria — nela.
  async function criarComandaDoEnsaio(ensaio: string) {
    if (sessao === null) return
    definirRecusaNaHome(null)
    let comanda: string | null = null
    try {
      const { resultado } = await chamarRpc<{ id: string }>(sessao.claim, 'comanda_criar', { agendamento_id: ensaio })
      comanda = resultado.id
    } catch (erro) {
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      if (erro instanceof ErroApi && erro.dominio === 'LT003') {
        try {
          const relida = await buscarHome(sessao.claim)
          definirHome(relida)
          comanda = relida.agenda.ensaios.find((e) => e.identificador === ensaio)?.comanda.identificador ?? null
        } catch {
          // A releitura falhou: fica a recusa, e o próximo toque tenta de novo.
        }
      }
      if (comanda === null) {
        definirRecusaNaHome(erro instanceof ErroApi
          ? RECUSA_DE_ABRIR_COMANDA[erro.dominio ?? ''] ?? erro.message
          : 'Sem conexão com o sistema.')
        return
      }
    }
    navegar('comanda')
    recortar({ comanda })
  }

  // ------------------------------------------- a justificativa do Checklist
  // Abrir é recortar: `?item=` faz o servidor montar o modal daquele item, com a
  // foto assinada se ela já estiver lá.
  function abrirJustificativa(item: string) {
    definirRecusaEscrita(null)
    definirRascunhoJustificativa({ item, texto: '', enviando: false, recusa: null })
    recortar({ item })
  }

  // Ler a justificativa de um item já justificado: só o recorte, porque não há
  // nada a escrever — o texto e a foto vêm do servidor.
  function verJustificativa(item: string) {
    definirRecusaEscrita(null)
    recortar({ item })
  }

  function fecharJustificativa() {
    definirRascunhoJustificativa(null)
    definirRecusaEscrita(null)
    recortar({ item: null })
  }

  /**
   * Toda foto passa pela fila (ADR 0072 §1): comprime, enfileira e tenta na
   * hora. `saiu` é a sessão ou o aparelho que caíram no meio — a tela já mudou.
   */
  async function fotoPelaFila(
    alvo: { ativo: AtivoDeMidia; registro: string },
    arquivo: File,
    recusas?: Record<string, string>,
  ): Promise<'subiu' | 'saiu' | { recusa: string }> {
    let foto: Blob
    try {
      foto = await comprimirFoto(arquivo)
    } catch (erro) {
      return { recusa: recusaDaFoto(erro, recusas) }
    }

    let envio: Awaited<ReturnType<typeof enviarPelaFila>>
    try {
      envio = await enviarPelaFila(sessao?.claim, { ...alvo, compressao: VERSAO_COMPRESSAO }, foto)
    } catch (erro) {
      if (!(erro instanceof FilaCheia)) return { recusa: 'Este tablet não conseguiu guardar a foto. Tente de novo.' }
      // O servidor não vê a fila; quem avisa o Admin é o tablet (§8). Um aviso
      // por dia, e quem conta o dia é o banco.
      void chamarRpc(sessao?.claim, 'midia_fila_cheia', { fotos: erro.fotos, bytes: erro.bytes }).catch(() => {})
      return { recusa: erro.message }
    }

    const { item, erro } = envio
    if (item.estado === 'enviado') return 'subiu'
    if (aparelhoRecusado(erro)) {
      esquecerAparelho()
      return 'saiu'
    }
    // A claim de quem está logado venceu: a foto fica na fila e sobe quando a
    // mesma pessoa entrar de novo (§5).
    if (item.estado === 'caducou') {
      sair()
      return 'saiu'
    }
    return { recusa: item.estado === 'pendente' ? FOTO_NA_FILA : recusaDaFoto(erro, recusas) }
  }

  // A FOTO VEM ANTES DO MOTIVO (ADR 0051 §7). Ela sobe pela rota de mídia, que
  // anexa e sobe a versão do item sem mexer no estado — por isso a releitura logo
  // em seguida: é dela que saem a versão nova e o endereço assinado da foto. Se
  // ela ficou na fila, o motivo pode ir mesmo assim (ADR 0072 §9).
  //
  // Comprimir é do cliente (ADR 0026 §1): 1600px, JPEG, EXIF fora. O que sobe já
  // é o arquivo final, e a versão do algoritmo vai junto como procedência.
  async function enviarFotoDaJustificativa(arquivo: File) {
    const rascunho = rascunhoJustificativa
    if (rascunho === null || sessao === null) return

    definirRascunhoJustificativa({ ...rascunho, enviando: true, recusa: null })
    const desfecho = await fotoPelaFila({ ativo: 'item_execucao', registro: rascunho.item }, arquivo)
    if (desfecho === 'saiu') return
    if (desfecho !== 'subiu') {
      const recusa = desfecho.recusa === FOTO_NA_FILA ? FOTO_NA_FILA_JUSTIFICATIVA : desfecho.recusa
      definirRascunhoJustificativa({ ...rascunho, enviando: false, recusa })
      return
    }
    definirRascunhoJustificativa({ ...rascunho, enviando: false, recusa: null })
    await recarregarTela('checklist')
  }

  // A versão vem do MODAL, não do item na lista: ela subiu quando a foto entrou.
  async function confirmarJustificativa(modal: ModalChecklist | null) {
    if (modal === null) return
    const passou = await escrever('checklist', RECUSA_DE_CHECKLIST, 'checklist_item_justificar', {
      item_id: modal.identificador,
      versao: modal.versao,
      texto: rascunhoJustificativa?.texto.trim() ?? '',
    })
    if (passou) fecharJustificativa()
  }

  // Remover desfaz o tratamento e reabre a fase; a foto fica anexada (ADR 0052),
  // e por isso não há nada a confirmar aqui além do gesto.
  async function removerJustificativa(modal: ModalChecklist | null) {
    if (modal === null) return
    const passou = await escrever('checklist', RECUSA_DE_CHECKLIST, 'checklist_item_justificativa_remover', {
      item_id: modal.identificador,
      versao: modal.versao,
    })
    if (passou) fecharJustificativa()
  }

  // ------------------------------------------------------ escrever aviso
  // O mesmo botão abre "Escrever aviso" ou, na aba Lembretes, "Criar lembrete":
  // quem decide qual formulário vem é o servidor, pela aba.
  function abrirEscritaDeAviso() {
    definirRecusaEscrita(null)
    definirRascunhoAviso(RASCUNHO_AVISO_VAZIO)
    definirRascunhoLembrete(RASCUNHO_LEMBRETE_VAZIO)
    recortar({ escrever: '1' })
  }

  function fecharEscritaDeAviso() {
    definirRascunhoAviso(null)
    definirRascunhoLembrete(null)
    definirRecusaEscrita(null)
    recortar({ escrever: null })
  }

  const alterarRascunhoAviso = (mudanca: Partial<RascunhoAviso>) =>
    definirRascunhoAviso((atual) => ({ ...(atual ?? RASCUNHO_AVISO_VAZIO), ...mudanca }))

  // O formulário só fecha quando a escrita passa: a recusa é lida com o
  // rascunho ainda na tela, para corrigir e mandar de novo.
  async function publicarAviso() {
    const rascunho = rascunhoAviso
    // O Enter no título submete de novo enquanto a primeira chamada corre.
    if (rascunho === null || rascunho.enviando || rascunho.titulo.trim() === '') return
    definirRascunhoAviso({ ...rascunho, enviando: true })
    const passou = await escrever('avisos', RECUSA_DE_PUBLICAR, 'aviso_publicar', {
      titulo: rascunho.titulo.trim(),
      texto: rascunho.texto.trim(),
      prioridade: rascunho.urgente ? 'urgente' : 'normal',
      publico: rascunho.publico,
      pede_confirmacao: rascunho.pedeConfirmacao,
    })
    if (passou) {
      definirRascunhoAviso(null)
      recortar({ escrever: null })
    } else {
      definirRascunhoAviso((atual) => (atual === null ? atual : { ...atual, enviando: false }))
    }
  }

  // ------------------------------------------------------ editar aviso (ADR 0069)
  // Como no formulário, a edição só fecha quando a escrita passa: a recusa é
  // lida com o texto ainda no cartão.
  async function acionarEdicaoAviso(dados: DadosAvisos, identificador: string, acao: AcaoEdicaoAviso) {
    if (acao === 'cancelar') {
      definirRecusaEscrita(null)
      return definirEdicaoAviso(null)
    }
    const edicao = edicaoAviso
    const aviso = dados.avisos.find((a) => a.identificador === identificador)
    if (edicao === null || edicao.identificador !== identificador || aviso === undefined || !edicaoPodeSalvar(edicao, aviso)) return
    definirEdicaoAviso({ ...edicao, enviando: true })
    const passou = await escrever('avisos', RECUSA_DE_EDITAR, 'aviso_editar', {
      aviso_id: identificador,
      versao: aviso.versao,
      titulo: edicao.titulo.trim(),
      texto: edicao.texto.trim(),
    })
    definirEdicaoAviso((atual) => (passou || atual === null ? null : { ...atual, enviando: false }))
  }

  // ------------------------------------------------------ lembrete (ADR 0066)
  async function criarLembrete() {
    const r = rascunhoLembrete
    if (r === null || r.enviando || r.categoria === null) return
    definirRascunhoLembrete({ ...r, enviando: true })
    const passou = await escrever('avisos', RECUSA_DE_LEMBRETE, 'lembrete_criar', {
      texto: r.texto.trim(),
      data: r.data,
      categoria_id: r.categoria,
      antecedencia: Number(r.antecedencia),
    })
    if (passou) {
      definirRascunhoLembrete(null)
      recortar({ escrever: null })
    } else {
      definirRascunhoLembrete((atual) => (atual === null ? atual : { ...atual, enviando: false }))
    }
  }

  async function criarCategoria() {
    const r = novaCategoria
    if (r === null || !categoriaCompleta(r)) return
    definirNovaCategoria({ ...r, enviando: true })
    const passou = await escrever('avisos', RECUSA_DE_CATEGORIA, 'categoria_lembrete_criar', {
      nome: r.nome.trim(), antecedencia: Number(r.antecedencia),
    })
    definirNovaCategoria((atual) => (passou || atual === null ? null : { ...atual, enviando: false }))
  }

  // Editar, desativar e reativar são o mesmo gesto no banco: a linha inteira
  // viaja, com a versão que a tela leu.
  async function acionarCategoria(dados: DadosAvisos, identificador: string, acao: AcaoCategoria) {
    const categoria = dados.categorias?.itens.find((c) => c.identificador === identificador)
    if (categoria === undefined) return
    if (acao === 'editar') {
      definirEdicaoCategoria({ identificador, nome: categoria.nome, antecedencia: String(categoria.antecedencia), enviando: false })
      return
    }
    if (acao === 'cancelar') return definirEdicaoCategoria(null)

    const edicao = acao === 'salvar' ? edicaoCategoria : null
    if (acao === 'salvar' && (edicao === null || !categoriaCompleta(edicao))) return
    if (edicao !== null) definirEdicaoCategoria({ ...edicao, enviando: true })
    const passou = await escrever('avisos', RECUSA_DE_CATEGORIA, 'categoria_lembrete_alterar', {
      categoria_id: identificador,
      versao: categoria.versao,
      nome: edicao === null ? categoria.nome : edicao.nome.trim(),
      antecedencia: edicao === null ? categoria.antecedencia : Number(edicao.antecedencia),
      ativo: acao === 'salvar' ? categoria.ativo : acao === 'ativar',
    })
    if (edicao !== null) definirEdicaoCategoria((atual) => (passou || atual === null ? null : { ...atual, enviando: false }))
  }

  // ------------------------------------------------------ registrar achado
  // Abrir é recorte (`?registrar=1`), como abrir o detalhe: o esqueleto do
  // formulário — estúdios, lugares, aviso — é conteúdo do servidor.
  function abrirRegistroDeAchado() {
    definirRecusaEscrita(null)
    definirRascunhoAchado(RASCUNHO_VAZIO)
    recortar({ registrar: '1', achado: null })
  }

  function fecharRegistroDeAchado() {
    definirRascunhoAchado(null)
    definirRecusaEscrita(null)
    recortar({ registrar: null })
  }

  const alterarRascunho = (mudanca: Partial<RascunhoAchado>) =>
    definirRascunhoAchado((atual) => (atual === null ? atual : { ...atual, ...mudanca, recusa: null }))

  // Tocar no estúdio (ou no lugar) já escolhido o desmarca: "Sem estúdio" é
  // resposta legítima, e sem isso não haveria como voltar atrás.
  const alternarEscolha = (atual: string | null, tocado: string) => (atual === tocado ? null : tocado)

  /**
   * O GESTO INTEIRO (ADR 0053 §1): o achado nasce, e a foto é a segunda chamada.
   *
   * Não passa pelo `escrever` porque precisa do `id` que a RPC devolve — é ele
   * que diz a que registro a foto se liga (ADR 0051 §7).
   *
   * Se a foto não subir, o achado JÁ EXISTE: o formulário fecha, a tela abre o
   * detalhe dele e a recusa aparece no "Anexar foto". É o `aguardando_foto` do
   * spec fazendo o trabalho dele — item marcado, não item perdido.
   */
  async function guardarAchado(dados: DadosAchados) {
    const rascunho = rascunhoAchado
    if (rascunho === null || rascunho.arquivo === null || sessao === null) return
    // O Enter no formulário submete de novo enquanto a primeira chamada corre —
    // e a segunda registraria o mesmo item duas vezes.
    if (rascunho.enviando) return

    definirRascunhoAchado({ ...rascunho, enviando: true, recusa: null })
    let achadoId: string
    try {
      const { resultado } = await chamarRpc<{ id: string }>(sessao.claim, 'achado_registrar', {
        descricao: rascunho.descricao.trim(),
        estudio_id: rascunho.estudio,
        data_achado: rascunho.data === '' ? null : rascunho.data,
        cliente_nome: rascunho.cliente.trim(),
        observacao: rascunho.observacao.trim(),
        local_guarda: lugarEfetivo(dados.registro, rascunho),
      })
      achadoId = resultado.id
    } catch (erro) {
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      definirRascunhoAchado({
        ...rascunho, enviando: false,
        recusa: erro instanceof ErroApi
          ? RECUSA_DE_ACHADO[erro.dominio ?? ''] ?? erro.message
          : 'Sem conexão com o sistema. O achado não foi registrado.',
      })
      return
    }

    // Daqui em diante o achado EXISTE. O formulário só fecha no fim, e enquanto
    // isso o botão fica em "Guardando…": fechá-lo agora deixaria o envio da foto
    // acontecendo atrás de uma lista que ainda não tem o item.
    const recusa = await enviarFotoDoAchado(achadoId, rascunho.arquivo)
    definirRascunhoAchado(null)
    // Fecha o formulário e abre o detalhe do item que acabou de nascer — é lá
    // que mora o "Anexar foto", e é lá que a recusa precisa aparecer. O efeito
    // do destino relê a tela sozinho.
    recortar({ registrar: null, achado: achadoId })
    if (recusa !== null) definirFotoDoAchado({ achado: achadoId, enviando: false, recusa })
  }

  // ------------------------------------------------------------ Horas extras

  function abrirLancamentoDeExtra(dados: DadosHorasExtras) {
    const eu = dados.destinatarios.find((p) => p.eu) ?? dados.destinatarios[0]
    definirMotivoDeHoraExtra(null)
    definirRascunhoHoraExtra({
      data: '', inicio: '', fim: '', destinatario: eu?.identificador ?? '',
      ensaio: '', motivo: '', outrosAbertos: false, busca: '', enviando: false,
    })
  }

  const alterarLancamentoDeExtra = (mudanca: Partial<RascunhoHoraExtra>) =>
    definirRascunhoHoraExtra((atual) => (atual === null ? atual : { ...atual, ...mudanca }))

  async function enviarLancamentoDeExtra(ensaios: DadosHorasExtras['ensaios']) {
    const rascunho = rascunhoHoraExtra
    if (rascunho === null || rascunho.enviando) return
    const ensaio = ensaioDoLancamento(rascunho, ensaios)
    definirRascunhoHoraExtra({ ...rascunho, enviando: true })
    const { inicio, fim } = instantesDoLancamento(rascunho)
    const passou = await escrever('horas', RECUSA_DE_LANCAR_EXTRA, 'hora_extra_lancar', {
      colaborador_id: rascunho.destinatario,
      inicio,
      fim,
      ensaio_id: ensaio === SEM_ENSAIO ? null : ensaio,
      sem_ensaio_motivo: rascunho.ensaio === SEM_ENSAIO ? rascunho.motivo.trim() : null,
    })
    // Recusado, o formulário fica aberto com o que foi digitado: o remédio de
    // LT003 é corrigir o intervalo, e reabrir do zero apagaria a correção.
    if (passou) definirRascunhoHoraExtra(null)
    else definirRascunhoHoraExtra((atual) => (atual === null ? atual : { ...atual, enviando: false }))
  }

  /**
   * "Marcar paga" vai direto; cancelar e estornar abrem a caixa de motivo, que
   * a RPC exige. Estornar só aparece em paga, cancelar só em pendente — quem
   * decide isso é a tela, e a RPC confere de novo.
   */
  function acionarHoraExtra(extra: HoraExtraApresentada, acao: string) {
    if (acao === 'pagar') {
      void escrever('horas', RECUSA_DE_HORA_EXTRA, 'hora_extra_pagar', {
        hora_extra_id: extra.identificador, versao: extra.versao,
      })
      return
    }
    if (acao === 'cancelar' || acao === 'estornar') {
      definirRascunhoHoraExtra(null)
      definirMotivoDeHoraExtra({ extra: extra.identificador, acao, motivo: '', enviando: false })
    }
  }

  async function confirmarMotivoDeHoraExtra(extra: HoraExtraApresentada) {
    const aberto = motivoDeHoraExtra
    if (aberto === null || aberto.extra !== extra.identificador || aberto.enviando) return
    definirMotivoDeHoraExtra({ ...aberto, enviando: true })
    const passou = await escrever('horas', RECUSA_DE_HORA_EXTRA,
      aberto.acao === 'estornar' ? 'hora_extra_estornar' : 'hora_extra_cancelar',
      { hora_extra_id: extra.identificador, versao: extra.versao, motivo: aberto.motivo.trim() })
    if (passou) definirMotivoDeHoraExtra(null)
    else definirMotivoDeHoraExtra((atual) => (atual === null ? atual : { ...atual, enviando: false }))
  }

  /**
   * O texto que a Helena cola no ManyChat (ADR 0075). Não escreve nada e não
   * relê a tela: o item continua onde está.
   */
  async function copiarMensagemDoAchado(detalhe: DadosAchados['selecionado']) {
    if (detalhe?.compartilhar === undefined) return
    let naAreaDeTransferencia = true
    try {
      await navigator.clipboard.writeText(detalhe.compartilhar.texto)
    } catch {
      // Navegador sem permissão: o texto fica à vista para copiar à mão.
      naAreaDeTransferencia = false
    }
    definirMensagemDoAchado({ achado: detalhe.identificador, naAreaDeTransferencia })
  }

  /**
   * A foto de um achado que já existe. É ela que move `aguardando_foto` ->
   * `em_posse`, dentro do `midia_registrar` (ADR 0051 §7) — a rota anexa e
   * transiciona numa transação, e o app não manda estado nenhum.
   *
   * Devolve a recusa, ou `null` se passou: o Guardar precisa saber, porque a
   * tela dele já fechou.
   */
  async function enviarFotoDoAchado(achado: string, arquivo: File): Promise<string | null> {
    if (sessao === null) return null
    definirFotoDoAchado({ achado, enviando: true, recusa: null })
    const desfecho = await fotoPelaFila({ ativo: 'achado', registro: achado }, arquivo, RECUSA_DE_FOTO_DO_ACHADO)
    if (desfecho === 'saiu') return null
    if (desfecho !== 'subiu') {
      definirFotoDoAchado({ achado, enviando: false, recusa: desfecho.recusa })
      return desfecho.recusa
    }
    definirFotoDoAchado(null)
    return null
  }

  // ------------------------------------------ as duas saídas do achado
  // Abrir é recorte, como tudo nesta tela (ADR 0054 §6): o esqueleto do
  // formulário — o aviso, quem vai assinar, a hora — é conteúdo do servidor, e
  // o servidor não monta o que ele mesmo recusaria.
  function abrirSaidaDoAchado(achado: string, acao: string) {
    if (acao !== 'entregar' && acao !== 'doar') return
    definirRecusaEscrita(null)
    definirSaidaDoAchado({ achado, acao, texto: '' })
    recortar({ achado, saida: acao })
  }

  function fecharSaidaDoAchado() {
    definirSaidaDoAchado(null)
    definirRecusaEscrita(null)
    recortar({ saida: null })
  }

  const alterarSaidaDoAchado = (texto: string) =>
    definirSaidaDoAchado((atual) => (atual === null ? atual : { ...atual, texto }))

  /**
   * Confirma a saída. A `versao` é a do detalhe recém-lido: ela sobe quando a
   * foto entra (0055), e por isso anexar foto e entregar em seguida exige a
   * releitura que o `escrever` já faz.
   *
   * O detalhe FICA aberto depois de passar: o histórico ganha a linha da saída,
   * e é ela que confirma o gesto. Fechar aqui trocaria a confirmação por um
   * item que sumiu da lista.
   */
  async function confirmarSaidaDoAchado(detalhe: DetalheAchado | undefined) {
    const saida = saidaDoAchado
    if (saida === null || detalhe === undefined || detalhe.identificador !== saida.achado) return
    const texto = saida.texto.trim()
    const passou = saida.acao === 'entregar'
      ? await escrever('achados', RECUSA_DE_SAIDA_DO_ACHADO, 'achado_entregar',
        { achado_id: detalhe.identificador, versao: detalhe.versao, retirado_por: texto })
      : await escrever('achados', RECUSA_DE_SAIDA_DO_ACHADO, 'achado_doar',
        { achado_id: detalhe.identificador, versao: detalhe.versao, destino: texto })
    if (passou) fecharSaidaDoAchado()
  }

  // ------------------------------------------------- conferência do Estoque
  // O − e o + mexem no rascunho, não no banco: a passada inteira vai numa
  // chamada só, no Confirmar. Mexer marca o insumo como TOCADO mesmo que o
  // número volte ao que era — quem contou e achou o mesmo número conferiu.
  function mexerNaQuantidade(item: string, passo: number) {
    definirRascunhoEstoque((atual) => {
      if (atual === null) return atual
      return {
        valores: { ...atual.valores, [item]: Math.max(0, (atual.valores[item] ?? 0) + passo) },
        tocados: new Set(atual.tocados).add(item),
      }
    })
  }

  async function confirmarConferencia() {
    const rascunho = rascunhoEstoque
    if (rascunho === null) return
    const itens = [...rascunho.tocados].map((item) => ({ item_id: item, quantidade: rascunho.valores[item] }))
    // Confirmar sem ter mexido em nada só fecha a edição: não há contagem a
    // gravar, e a lista vazia o banco recusaria com LT003.
    if (itens.length === 0) return definirRascunhoEstoque(null)
    // Recusa mantém o rascunho aberto: perder uma passada de contagem inteira
    // por uma falha de rede é pior que a tela ficar em modo de edição.
    if (await escrever('estoque', RECUSA_DE_ESTOQUE, 'estoque_conferir', { itens })) {
      definirRascunhoEstoque(null)
    }
  }

  // ---------------------------------------------------- "Editar escala"
  // Tudo numa chamada, como a conferência do Estoque. Recusa mantém o modo de
  // edição: a releitura tira do rascunho só o turno que outra pessoa mexeu.
  async function confirmarEscala(dados: DadosEscala) {
    if (rascunhoEscala === null) return
    const alteracoes = alteracoesDe(dados, rascunhoEscala)
    if (alteracoes.length === 0) return definirRascunhoEscala(null)
    if (await escrever('escala', RECUSA_DE_ESCALA, 'escala_alterar', { alteracoes })) {
      definirRascunhoEscala(null)
    }
  }

  // ------------------------------------------------------- domingo extra
  // Dois gestos no mesmo botão do dia: "Assumir" escala quem está no tablet (a
  // pessoa sai da claim, não do corpo) e "Desfazer" leva o turno e a versão que
  // a tela leu. Dia sem `extra` não tem o que desfazer.
  async function acionarDomingo(dados: DadosEscala, data: string, acao: string) {
    const dia = dados.dias.find((d) => d.data === data)
    if (dia === undefined) return

    if (acao === 'outra') {
      definirDomingoEscolhido((atual) => alternarDomingo(atual, dia, dados.equipe))
      return
    }
    if (acao === 'assumir') {
      const colaborador = quemAssume(dia, domingoEscolhido)
      if (colaborador === undefined) return
      if (await escrever('escala', RECUSA_DE_DOMINGO, 'escala_domingo_acionar',
        { data, colaborador_id: colaborador })) {
        // Acionado, o dia deixa de ter botão de assumir: a escolha não tem mais
        // onde aparecer, e guardá-la reapareceria se alguém desfizesse.
        definirDomingoEscolhido(({ [data]: _feito, ...resto }) => resto)
      }
      return
    }
    if (acao === 'desfazer' && dia.extra !== undefined) {
      await escrever('escala', RECUSA_DE_DOMINGO, 'escala_domingo_desfazer',
        { turno_id: dia.extra.identificador, versao: dia.extra.versao })
    }
  }

  // ------------------------------------------- "Confirmar nova âncora"
  // A proposta inteira numa chamada: o banco confere que as decisões são
  // exatamente as trocas que ela afeta, então mandar metade não é meio caminho.
  async function confirmarRevisao(dados: DadosEscala) {
    const revisao = dados.revisao
    if (revisao === undefined) return
    const decisoes = decisoesDe(dados, decisoesRevisao)
    if (decisoes.length !== revisao.afetadas.length) return

    const { alteracao } = revisao
    const passou = await escrever('escala', RECUSA_DE_REVISAO, 'escala_padrao_revisar', {
      turno: alteracao.turno,
      versao: alteracao.versao,
      colaboradores: alteracao.colaboradores,
      ancora_data: alteracao.ancoraData,
      ancora_colaborador_id: alteracao.ancoraColaborador,
      decisoes,
    })
    if (passou) {
      definirDecisoesRevisao({})
      recortar({ revisar: null })
    }
  }

  // --------------------------------------------------------- "Salvar PINs"
  // A lista inteira numa chamada: o botão é um só, e metade dos PINs gravada é
  // o pior resultado possível — quem digitou não tem como saber qual metade.
  // ---------------------------------------------- Treinamento pelo app (0089)
  // Como nos Ajustes: a resposta vai para o quadro que a pediu, e a tela relê
  // depois — inclusive na recusa, porque LT001 quer dizer tela velha.
  async function agirNoTreinamento(
    nome: string, corpo: Record<string, unknown>, sucesso: string,
  ): Promise<AvisoDeSenha & { resultado?: unknown }> {
    if (sessao === null) return { texto: 'Sessão encerrada. Entre de novo.', erro: true }
    try {
      const { resultado } = await chamarRpc<unknown>(sessao.claim, nome, corpo)
      await recarregarTela('treinamento')
      return { texto: sucesso, erro: false, resultado }
    } catch (erro) {
      if (aparelhoRecusado(erro)) { esquecerAparelho(); return { texto: 'Este aparelho não está mais registrado.', erro: true } }
      if (erro instanceof ErroApi && erro.codigo === 401) { sair(); return { texto: 'Sessão encerrada. Entre de novo.', erro: true } }
      await recarregarTela('treinamento')
      return {
        texto: erro instanceof ErroApi ? RECUSA_DO_TREINAMENTO[erro.dominio ?? ''] ?? erro.message : 'Sem conexão com o sistema.',
        erro: true,
      }
    }
  }

  // A foto do bloco passa pela fila como toda foto (ADR 0072 §1), e o id da fila
  // é o id da mídia (§3): é ele que entra no bloco. O endereço assinado só vem na
  // releitura; até salvar, o editor mostra a própria foto comprimida.
  async function enviarFotoDoTutorial(tutorial: string, arquivo: File): Promise<{ midiaId: string; foto: string } | AvisoDeSenha> {
    let foto: Blob
    try {
      foto = await comprimirFoto(arquivo)
    } catch (erro) {
      return { texto: recusaDaFoto(erro), erro: true }
    }
    try {
      const { item, erro } = await enviarPelaFila(sessao?.claim, { ativo: 'tutorial', registro: tutorial, compressao: VERSAO_COMPRESSAO }, foto)
      if (item.estado === 'enviado') return { midiaId: item.id, foto: URL.createObjectURL(foto) }
      if (aparelhoRecusado(erro)) { esquecerAparelho(); return { texto: 'Este aparelho não está mais registrado.', erro: true } }
      // Na fila ela sobe sozinha, mas o bloco precisa da foto já no servidor.
      return {
        texto: item.estado === 'pendente'
          ? 'Sem conexão agora: a foto não entrou no tutorial. Tente de novo com internet.'
          : recusaDaFoto(erro, RECUSA_DO_TREINAMENTO),
        erro: true,
      }
    } catch {
      return { texto: 'Este aparelho não conseguiu guardar a foto. Tente de novo.', erro: true }
    }
  }

  // ------------------------------------- Senha e equipe pelo app (#220, #216)
  // Fora do `escrever`: a resposta vai para o quadro que a pediu, não para a
  // recusa da tela, e "senha atual errada" chega como resultado, não como erro — o
  // banco precisa gravar a tentativa, que é o que bloqueia depois de cinco.
  async function agirNosAjustes(
    nome: string, corpo: Record<string, unknown>, sucesso: string,
    recusas: Record<string, string> = RECUSA_DE_SENHA_NO_APP,
  ): Promise<AvisoDeSenha> {
    if (sessao === null) return { texto: 'Sessão encerrada. Entre de novo.', erro: true }
    try {
      const { resultado } = await chamarRpc<{ ok: boolean; motivo?: string } | null>(sessao.claim, nome, corpo)
      if (resultado !== null && resultado.ok === false) {
        return { texto: recusas[resultado.motivo ?? ''] ?? 'Não deu para salvar.', erro: true }
      }
      await recarregarTela('ajustes')
      return { texto: sucesso, erro: false }
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === 401) {
        sair()
        return { texto: 'Sessão encerrada. Entre de novo.', erro: true }
      }
      return {
        texto: erro instanceof ErroApi ? recusas[erro.dominio ?? ''] ?? erro.message : 'Sem conexão com o sistema.',
        erro: true,
      }
    }
  }

  // ------------------------------------------------ "Repor / ajustar" da Bomboniere
  // O − e o + mexem no alvo na tela. O que viaja é o DELTA contra o saldo que
  // foi lido, e não o alvo: se uma Comanda der baixa entre a leitura e o OK,
  // "chegaram 5" continua sendo 5 — o alvo é que teria virado mentira.
  function mexerNoSaldo(item: string, passo: number) {
    definirAjusteBomboniere((atual) =>
      atual === null || atual.item !== item ? atual : { ...atual, saldo: atual.saldo + passo })
  }

  async function confirmarAjuste(dados: DadosEstoque, item: string) {
    const aberto = ajusteBomboniere
    if (aberto === null || aberto.item !== item) return
    const delta = aberto.saldo - Number(dados.bomboniere.find((b) => b.identificador === item)?.saldo ?? 0)
    // Abrir e fechar sem mexer não é movimento: o banco recusaria com LT003, e
    // não há nada a registrar num ledger append-only.
    if (delta === 0) return definirAjusteBomboniere(null)
    const passou = await escrever('estoque', RECUSA_DE_BOMBONIERE, 'bomboniere_movimentar', {
      item_id: item, delta, motivo: aberto.motivo.trim() === '' ? null : aberto.motivo.trim(),
    })
    if (passou) definirAjusteBomboniere(null)
  }

  // ------------------------------------------ catálogo de insumos (Admin)
  // Recusa mantém a ficha aberta com o que foi digitado; a releitura traz a
  // versão nova, então depois de um LT001 basta salvar de novo.
  async function salvarFicha(dados: DadosEstoque) {
    const ficha = fichaAberta
    if (ficha === null) return
    const campos = {
      nome: ficha.nome, categoria: ficha.categoria, fornecedor: ficha.fornecedor,
      especificacao: ficha.especificacao, severidade: ficha.severidade,
    }
    const passou = ficha.item === null
      ? await escrever('estoque', RECUSA_DE_CATALOGO, 'estoque_insumo_criar', campos)
      : await escrever('estoque', RECUSA_DE_CATALOGO, 'estoque_insumo_alterar', {
        item_id: ficha.item, versao: insumosDe(dados).find((i) => i.identificador === ficha.item)?.versao, ...campos,
      })
    if (passou) definirFichaAberta(null)
  }

  async function desativarInsumo(dados: DadosEstoque) {
    const item = fichaAberta?.item
    if (item === null || item === undefined) return
    if (await escrever('estoque', RECUSA_DE_CATALOGO, 'estoque_insumo_desativar',
      { item_id: item, versao: insumosDe(dados).find((i) => i.identificador === item)?.versao })) {
      definirFichaAberta(null)
    }
  }

  async function salvarRenomeacao() {
    const aberta = renomeacao
    if (aberta === null) return
    if (await escrever('estoque', RECUSA_DE_CATALOGO, 'estoque_renomear',
      { campo: aberta.campo, de: aberta.de, para: aberta.texto })) {
      definirRenomeacao(null)
    }
  }

  /**
   * O PDF sai do navegador da Helena e fica no servidor (ADR 0073 §2). Devolve o
   * link absoluto, ou `null` depois de dizer por que não deu. Copiar ou baixar
   * não é envio: quem registra é o "Enviei".
   */
  async function guardarOComprovante(comanda: DetalheComanda) {
    definirRecusaEscrita(null)
    const { arquivoDoComprovante } = await carregarComprovante()
    try {
      const guardado = await guardarComprovante(comanda.identificador, arquivoDoComprovante(comanda, new Date()))
      return new URL(guardado.link, window.location.origin).href
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === 401) sair()
      else definirRecusaEscrita(erro instanceof ErroApi
        ? RECUSA_DO_COMPROVANTE[erro.codigo] ?? erro.message
        : 'Sem conexão com o sistema.')
      return null
    }
  }

  async function copiarMensagem(comanda: DetalheComanda) {
    definirMensagemCopiada(null)
    const link = await guardarOComprovante(comanda)
    if (link === null) return
    const { mensagemDoComprovante } = await carregarComprovante()
    await deixarCopiada(comanda, mensagemDoComprovante(comanda, link))
  }

  async function deixarCopiada(comanda: DetalheComanda, texto: string) {
    let naAreaDeTransferencia = true
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      // Navegador sem permissão: a mensagem fica à vista para copiar à mão.
      naAreaDeTransferencia = false
    }
    definirMensagemCopiada({ comanda: comanda.identificador, texto, naAreaDeTransferencia })
  }

  // Baixa o arquivo GUARDADO, e não um gerado agora: o que a Helena anexa no
  // ManyChat é o mesmo que o link serve.
  async function baixarPdf(comanda: DetalheComanda) {
    const link = await guardarOComprovante(comanda)
    if (link === null) return
    const ancora = document.createElement('a')
    ancora.href = link
    ancora.download = `comprovante-${comanda.numero.replace(/^#/, '')}.pdf`
    ancora.click()
  }

  // O mesmo texto do Copiar, mandado pelo servidor (ADR 0076). Quem registra o
  // envio é ele, depois do success; o que não deu fica na linha de recusa, com
  // os botões do manual logo abaixo.
  async function enviarPeloManychat(comanda: DetalheComanda) {
    definirMensagemCopiada(null)
    const link = await guardarOComprovante(comanda)
    if (link === null) return
    const { mensagemDoComprovante } = await carregarComprovante()
    const texto = mensagemDoComprovante(comanda, link)
    try {
      const r = await enviarComprovante(comanda.identificador, comanda.versao, texto)
      if (!r.enviado) {
        // O manual já pronto: a mensagem com o link copiada, à vista abaixo.
        definirRecusaEscrita(`Não deu para enviar pelo automático. ${r.motivo ?? ''} `
          + 'Envie pelo link: cole a mensagem abaixo na conversa do cliente no ManyChat e toque em Já mandei por fora.')
        await deixarCopiada(comanda, texto)
        return
      }
      if (!r.registrado) definirRecusaEscrita(r.motivo ?? '')
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === 401) return sair()
      definirRecusaEscrita(erro instanceof ErroApi
        ? RECUSA_DO_COMPROVANTE[erro.codigo] ?? erro.message
        : 'Sem conexão com o sistema.')
    }
    await recarregarTela('comanda')
  }

  function acionarComanda(acao: string, comanda: DetalheComanda, praticado: PraticadoComanda | null, forma?: string) {
    if (acao === 'enviar_manychat') return enviarPeloManychat(comanda)
    if (acao === 'copiar') return copiarMensagem(comanda)
    if (acao === 'baixar') return baixarPdf(comanda)
    if (acao === 'enviar') definirMensagemCopiada(null)
    return transicionarComanda(acao, comanda, praticado, forma)
  }

  // Fechar, enviar e receber pedem campo a mais; reabrir e desfazer não pedem
  // nada. Todos são a mesma RPC, com o evento fechado na allow-list.
  function transicionarComanda(acao: string, comanda: DetalheComanda, praticado: PraticadoComanda | null, forma?: string) {
    // Hora local, sem fuso: o banco resolve em America/Maceio (transacao.mjs).
    // Mandar o fuso daqui seria confiar no relógio do tablet.
    const instante = (hora: string, dia = praticado?.data) => (praticado === null ? null : `${dia} ${hora}`)
    // Fim antes do início é ensaio que passou da meia-noite: com o dia do
    // início, o fim caía antes do agendado e a extensão saía zero.
    const virou = praticado !== null && praticado.fim < praticado.inicio

    return escreverNaComanda('comanda_transicionar', {
      comanda_id: comanda.identificador,
      versao: comanda.versao,
      evento: acao,
      fim_praticado: acao === 'fechar'
        ? instante(praticado?.fim ?? '', virou ? diaSeguinte(praticado.data) : praticado?.data)
        : null,
      inicio_praticado: acao === 'fechar' ? instante(praticado?.inicio ?? '') : null,
      telefone: acao === 'enviar' ? comanda.envio?.telefone ?? null : null,
      forma_pagamento: acao === 'receber' ? forma ?? null : null,
    })
  }

  // Recorte dentro da mesma tela e aba (o período das Horas extras): muda o que o
  // servidor devolve sem mudar para onde o menu aponta.
  // `null` tira o parâmetro — fechar o detalhe de um achado, por exemplo.
  function recortar(recorte: Record<string, string | null>) {
    definirDestino((atual) => {
      const novo = { ...atual.recorte, ...recorte }
      return {
        ...atual,
        recorte: Object.fromEntries(
          Object.entries(novo).filter((par): par is [string, string] => par[1] !== null),
        ),
      }
    })
  }

  function navegar(identificador: string) {
    // O perfil no rodapé do menu leva à Entrada: é a troca de pessoa no tablet.
    if (identificador === 'entrada') return sair()
    definirUrgentesNaNavegacao((atual) => (atual === 'aguardando' ? 'mostrar' : atual))
    // Trocar de tela (ou de fase) abandona o modal aberto, como abandona a
    // passada do Estoque: o que não foi confirmado não existe.
    definirRascunhoJustificativa(null)
    definirRascunhoAchado(null)
    definirFotoDoAchado(null)
    definirSaidaDoAchado(null)
    definirMensagemDoAchado(null)
    definirRascunhoAviso(null)
    definirRascunhoLembrete(null)
    definirNovaCategoria(null)
    definirEdicaoCategoria(null)
    definirEdicaoAviso(null)
    definirRascunhoHoraExtra(null)
    definirMotivoDeHoraExtra(null)
    definirBuscaDeTreinamento(null)
    definirTutorialEmEdicao(null)
    definirPastaDeTreinamento(null)
    definirDecisoesRevisao({})
    definirDomingoEscolhido({})
    // A recusa é do gesto que a causou: noutra tela ela não diz nada.
    definirRecusaEscrita(null)
    definirRecusaNaHome(null)
    definirDestino(destinoDe(identificador))
    if (!menuTemColunaPropria()) definirMenuExpandido(false)
  }

  async function conferir(pin: string) {
    try {
      definirSessao(await abrirSessao(pessoaId!, pin))
      definirDigitos('')
      definirSituacao('normal')
    } catch (erro) {
      definirDigitos('')
      if (aparelhoRecusado(erro)) return esquecerAparelho()
      if (erro instanceof ErroApi && erro.codigo === 401) {
        definirSituacao(erro.message === 'bloqueado' || erro.message === 'sem_turno' ? erro.message : 'incorreto')
        return
      }
      definirFalha(erro instanceof Error ? erro.message : 'falha ao entrar')
    }
  }

  function teclar(tecla: string) {
    if (tecla === 'limpar') return definirDigitos('')
    if (tecla === 'apagar') return definirDigitos((d) => d.slice(0, -1))
    if (digitos.length >= DIGITOS_DO_PIN) return

    const novo = digitos + tecla
    definirDigitos(novo)
    definirSituacao('normal')
    if (novo.length === DIGITOS_DO_PIN) void conferir(novo)
  }

  if (falha !== null || recuperando) return (
    <Recado
      texto={recuperando ? 'Carregando…' : `Não foi possível carregar: ${falha}`}
      carregando={recuperando}
      aoTentarNovamente={() => void tentarCarregarNovamente()}
    />
  )

  if (sessao === null && !aparelhoRegistrado) {
    // Chave recusada volta direto ao registro: quem estava aqui era o tablet.
    if (mostrarRegistro || chaveRecusada) {
      return (
        <RegistroDoAparelho
          recusada={chaveRecusada}
          aoRegistrar={(chave) => {
            guardarChaveDoAparelho(chave)
            definirAparelhoRegistrado(true)
          }}
          aoEntrarComSenha={() => {
            definirMostrarRegistro(false)
            definirChaveRecusada(false)
          }}
        />
      )
    }
    return <LoginPorSenha aoEntrar={definirSessao} aoRegistrarAparelho={() => definirMostrarRegistro(true)} />
  }

  // Sessão por senha carregando a Home: não há Entrada de tablet a mostrar.
  if (sessao !== null && sessao.claim === undefined && home === null) return <Recado texto="Carregando…" />

  // ------------------------------------------------------------------ Entrada
  if (sessao === null || home === null) {
    if (entrada === null) return <Recado texto="Carregando…" />

    const pessoa = entrada.pessoas.find((p) => p.identificador === pessoaId)

    return (
      <Entrada
        dados={{
          ...entrada,
          logo: LOGO_TINTA_BRANCA,
          exibicao:
            pessoa === undefined
              ? { etapa: 'quem' }
              : {
                  etapa: 'pin',
                  pessoa,
                  situacao,
                  pontos: Array.from({ length: DIGITOS_DO_PIN }, (_, i) => ({
                    identificador: String(i),
                    preenchido: i < digitos.length,
                  })),
                  descricaoPontos:
                    digitos.length === 0
                      ? 'Nenhum dígito preenchido'
                      : `${digitos.length} de ${DIGITOS_DO_PIN} dígitos preenchidos`,
                  mensagem: MENSAGEM[situacao],
                  // O mockup mostrava o PIN embaixo do teclado. Vazio aqui: o
                  // componente só desenha a linha quando há dica.
                  dica: '',
                  teclas: TECLAS.map((t) =>
                    situacao === 'bloqueado' ? { ...t, desativada: true } : t,
                  ),
                },
        }}
        aoEscolherPessoa={(identificador) => {
          definirPessoaId(identificador)
          definirDigitos('')
          definirSituacao('normal')
        }}
        aoVoltar={() => {
          definirPessoaId(null)
          definirDigitos('')
        }}
        aoTeclar={teclar}
      />
    )
  }

  // ------------------------------------------------------------ Logado: menu
  const conteudo =
    destino.modulo === 'inicio' ? (
      <Home
        dados={home}
        recusa={recusaNaHome}
        aoAbrirComandaDoEnsaio={(comanda) => { navegar('comanda'); recortar({ comanda }) }}
        aoCriarComanda={(ensaio) => void criarComandaDoEnsaio(ensaio)}
        aoAbrirComandas={() => navegar('comanda')}
        aoAbrirAvisos={() => navegar('avisos')}
        aoAbrirChecklist={() => navegar('checklist')}
        aoAbrirEstoque={() => navegar('estoque')}
        aoAbrirConsulta={(identificador) => navegar(identificador)}
        // O cartão da Home marca sem sair da Home: é o gesto de quem passa pelo
        // balcão. Quem quer a lista inteira toca no título e vai pro Checklist.
        aoAlternarItemChecklist={(item: ItemChecklistHome) => void marcarItemDaHome(item)}
      />
    ) : telaAtual?.chave === chaveDe(destino) ? (
      desenharTela(telaAtual)
    ) : (
      <TelaPendente
        nome={sidebar?.itens.find((i) => i.identificador === destino.modulo)?.rotulo ?? destino.modulo}
        hora={home.hora}
        carregando={TELAS_LIGADAS[destino.modulo] !== undefined}
      />
    )

  // Sem o menu ainda, a tela aparece sozinha: o menu é navegação, não pré-requisito
  // pra ler a Home.
  if (sidebar === null) return conteudo

  const urgentes = urgentesNaNavegacao === 'mostrar' ? sidebar.avisosUrgentes : []

  return (<>
    <Sidebar
      dados={{
        ...sidebar,
        logo: LOGO_TINTA_ESCURA,
        expandida: menuExpandido,
        ativo: destino.modulo,
        grupoAberto,
      }}
      aoAlternarMenu={() => definirMenuExpandido((expandido) => !expandido)}
      aoFecharMenu={() => definirMenuExpandido(false)}
      aoAlternarGrupo={(identificador) =>
        definirGrupoAberto((atual) => (atual === identificador ? undefined : identificador))
      }
      aoNavegar={navegar}
    >
      {conteudo}
    </Sidebar>
    {versaoNova && (
      <button
        type="button"
        className="lt-versao-nova"
        onClick={() => {
          sair()
          window.location.reload()
        }}
      >
        Saiu uma versão nova do sistema. Tocar para atualizar (volta para a Entrada).
      </button>
    )}
    {fila.length > 0 && (
      <DescargaPendente
        fotos={fila.map(fotoNaFila)}
        aberta={bandejaAberta}
        aoAlternar={() => definirBandejaAberta((aberta) => !aberta)}
        aoReenviar={(id) => void reenviar(id, sessao.claim).then(descarregarFila)}
        carregarFoto={bytesDe}
      />
    )}
    {urgentes.length > 0 && (
      <AvisoUrgente
        avisos={urgentes}
        recusa={recusaUrgente}
        aoConfirmar={(aviso) => void confirmarUrgente(aviso)}
        aoAdiar={() => {
          definirUrgentesNaNavegacao('adiado')
          definirRecusaUrgente(null)
        }}
      />
    )}
  </>)
}
