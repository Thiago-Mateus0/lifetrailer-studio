// O cliente da fronteira do ADR 0042.
//
// Leitura: uma ida por tela, em `GET /tela/<nome>`, devolvendo o `Dados<Tela>`
// que o componente já declara. Escrita: `POST /rpc/<nome>`, com o nome da função
// do banco no caminho — o vocabulário de domínio é um só (regra inviolável 7),
// e traduzi-lo pra uma segunda linguagem REST criaria dois nomes pra mesma coisa.
//
// O front nunca fala com o Postgres. Não há chave de banco aqui.
import type { DadosAchados } from './telas/Achados'
import type { DadosAjustes } from './telas/Ajustes'
import type { AvisoUrgenteApresentado } from './telas/AvisoUrgente'
import type { DadosAvisos } from './telas/Avisos'
import type { DadosChecklist } from './telas/Checklist'
import type { DadosComanda } from './telas/Comanda'
import type { DadosEntrada } from './telas/Entrada'
import type { DadosEscala } from './telas/Escala'
import type { DadosEstoque } from './telas/Estoque'
import type { DadosHome } from './telas/Home'
import type { DadosHorasExtras } from './telas/HorasExtras'
import type { DadosSidebar } from './telas/Sidebar'
import type { DadosTreinamento } from './telas/Treinamento'

/**
 * O que o servidor devolve pra Entrada. Falta `logo` (asset do bundle, não dado
 * de banco) e `exibicao` (estado de interação — em que passo o dedo está).
 */
export type DadosEntradaDoServidor = Omit<DadosEntrada, 'logo' | 'exibicao'>

/**
 * Sem `logo`, que é asset do bundle e não dado de banco. Com os urgentes do
 * modal da navegação (ADR 0070 §2), que o menu não desenha mas carrega.
 */
export type DadosSidebarDoServidor = Omit<DadosSidebar, 'logo'> & { avisosUrgentes: AvisoUrgenteApresentado[] }

/**
 * O registro do lado do cliente: nome da rota `GET /tela/<nome>` → o `Dados<Tela>`
 * que ela devolve. Espelha o `telas` de src/api/index.mjs (ADR 0042 §2).
 */
export type DadosPorTela = {
  achados: DadosAchados
  ajustes: DadosAjustes
  avisos: DadosAvisos
  checklist: DadosChecklist
  comanda: DadosComanda
  escala: DadosEscala
  estoque: DadosEstoque
  home: DadosHome
  horas: DadosHorasExtras
  sidebar: DadosSidebarDoServidor
  treinamento: DadosTreinamento
}

/**
 * Quem está usando o app. `claim` existe só na sessão do Atendente, aberta por PIN
 * no tablet. Sócio, gerente e Desenvolvedor entram por senha (ADR 0049), e a sessão
 * deles é um cookie HttpOnly que o JavaScript não lê — por isso sem `claim`.
 */
export type Sessao = {
  claim?: string
  nome: string
  perfil: string
  exp: string | number
}

/**
 * Quem a claim diz que é. Só leitura, sem conferir assinatura: quem confere é o
 * servidor. A fila usa isto para saber se quem entrou agora é quem tirou a foto
 * (ADR 0072 §5).
 */
export function colaboradorDaClaim(claim: string | undefined): string | null {
  try {
    const meio = claim?.split('.')[1]
    if (meio === undefined) return null
    const json = atob(meio.replace(/-/g, '+').replace(/_/g, '/'))
    const id = JSON.parse(json)?.colaborador_id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/** Recusa do servidor. `dominio` é o errcode LT00x quando a recusa veio da RPC. */
export class ErroApi extends Error {
  constructor(
    readonly codigo: number,
    mensagem: string,
    readonly dominio?: string,
  ) {
    super(mensagem)
    this.name = 'ErroApi'
  }
}

// A chave do tablet (ADR 0048). Fica no próprio aparelho: é ela que o identifica,
// e o servidor só tem o hash. `localStorage` pode não existir (aba privada) — aí
// o aparelho simplesmente não está registrado.
const CHAVE_DO_APARELHO = 'lt-dispositivo'

/** O `erro` que o servidor devolve quando a chave falta, é errada ou foi revogada. */
export const APARELHO_NAO_REGISTRADO = 'dispositivo nao registrado'

export function lerChaveDoAparelho(): string | null {
  try {
    return localStorage.getItem(CHAVE_DO_APARELHO)
  } catch {
    return null
  }
}

export function guardarChaveDoAparelho(chave: string | null) {
  try {
    if (chave === null) localStorage.removeItem(CHAVE_DO_APARELHO)
    else localStorage.setItem(CHAVE_DO_APARELHO, chave)
  } catch {
    // Sem armazenamento, o registro dura só esta aba — melhor que travar.
  }
}

export const aparelhoRecusado = (erro: unknown) =>
  erro instanceof ErroApi && erro.codigo === 401 && erro.message === APARELHO_NAO_REGISTRADO

/** `bruto` é a foto da rota de mídia (ADR 0051 §6): vai no corpo como está, sem JSON. */
type Opcoes = { metodo?: string; claim?: string; corpo?: unknown; bruto?: Blob }

async function pedir<T>(caminho: string, { metodo = 'GET', claim, corpo, bruto }: Opcoes = {}): Promise<T> {
  const resposta = await fetch(caminho, {
    method: metodo,
    // A claim viaja em cabeçalho, não em cookie (ADR 0042 §4): o tablet guarda
    // uma claim por pessoa escalada, e quem está na frente dele muda no turno.
    headers: {
      ...(lerChaveDoAparelho() === null ? {} : { 'x-lt-dispositivo': lerChaveDoAparelho()! }),
      ...(claim === undefined ? {} : { authorization: `Bearer ${claim}` }),
      ...(bruto === undefined ? {} : { 'content-type': bruto.type || MIME_MIDIA }),
      ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
  })

  const texto = await resposta.text()
  const dados = texto === '' ? null : JSON.parse(texto)

  if (!resposta.ok) {
    throw new ErroApi(resposta.status, dados?.erro ?? 'falha na chamada', dados?.code)
  }
  return dados as T
}

export const buscarEntrada = () => pedir<DadosEntradaDoServidor>('/tela/entrada')

export const buscarHome = (claim: string | undefined) => pedir<DadosHome>('/tela/home', { claim })

/** `parametros` é o recorte que o dedo escolheu (`{ fase: 'saida' }`); a tela no servidor valida. */
export const buscarTela = <N extends keyof DadosPorTela>(
  nome: N,
  claim: string | undefined,
  parametros: Record<string, string> = {},
) => {
  const busca = new URLSearchParams(parametros).toString()
  return pedir<DadosPorTela[N]>(`/tela/${nome}${busca === '' ? '' : `?${busca}`}`, { claim })
}

export const abrirSessao = (colaboradorId: string, pin: string) =>
  pedir<Sessao>('/sessao', { metodo: 'POST', corpo: { colaborador_id: colaboradorId, pin } })

export const chamarRpc = <T>(claim: string | undefined, nome: string, corpo: Record<string, unknown>) =>
  pedir<{ resultado: T }>(`/rpc/${nome}`, { metodo: 'POST', claim, corpo })

// ------------------------------------------------------------------- a foto
// A rota de mídia (ADR 0051). Não é RPC: o corpo são os bytes do JPEG e os
// metadados vão na query string, porque um parser de multipart seria
// dependência nova pra transportar um arquivo e dois campos curtos.
//
// A foto já chega comprimida aqui — 1600px no maior lado, JPEG, EXIF fora
// (ADR 0026 §1-§3). O servidor recusa acima de 1 MB, que é o mesmo teto daquele
// ADR aplicado do lado que o cliente não contorna.

/** JPEG, não WebP nem AVIF: o que precisa abrir daqui a cinco anos abre em JPEG (ADR 0026 §3). */
export const MIME_MIDIA = 'image/jpeg'

/** Os ativos que recebem foto hoje. A mídia nasce ligada a um registro que já existe. */
export type AtivoDeMidia = 'item_execucao' | 'achado' | 'tutorial'

/** `endereco` é a URL assinada que o `<img src>` usa, e vale 30 minutos (ADR 0051 §5). */
export type MidiaEnviada = { midia_id: string; endereco: string; bytes: number }

/** `id` é o da fila (ADR 0072 §3): com ele, reenviar a mesma foto não vira LT002. */
export const enviarMidia = (
  claim: string | undefined,
  alvo: { ativo: AtivoDeMidia; registro: string; compressao?: string; id?: string },
  foto: Blob,
) => {
  const busca = new URLSearchParams({
    ativo: alvo.ativo,
    registro: alvo.registro,
    ...(alvo.compressao === undefined ? {} : { compressao: alvo.compressao }),
    ...(alvo.id === undefined ? {} : { id: alvo.id }),
  })
  return pedir<MidiaEnviada>(`/midia?${busca}`, { metodo: 'POST', claim, bruto: foto })
}

// ------------------------------------------------------- o comprovante (0073)
/** `link` é o caminho assinado que o cliente abre; vale 30 dias (ADR 0073 §3). */
export type ComprovanteGuardado = { comprovante_id: string; envio: number; link: string }

/**
 * Guarda o PDF que o navegador da Jana gerou. Sem claim: a rota só aceita o
 * cookie do Admin. Copiar de novo devolve link novo para o arquivo já guardado.
 */
export const guardarComprovante = (comanda: string, pdf: Blob) =>
  pedir<ComprovanteGuardado>(`/comprovante?comanda=${encodeURIComponent(comanda)}`, { metodo: 'POST', bruto: pdf })

/**
 * O Enviar pelo ManyChat (ADR 0076). `registrado` só com `enviado`: a mensagem
 * saiu e a Comanda virou Enviada. Sem ele, `motivo` diz o que aconteceu.
 */
export type EnvioDoComprovante = { enviado: boolean; registrado?: boolean; motivo?: string }

export const enviarComprovante = (comanda: string, versao: number, texto: string) =>
  pedir<EnvioDoComprovante>('/comprovante/enviar', { metodo: 'POST', corpo: { comanda_id: comanda, versao, texto } })

// ------------------------------------------------ sócio, gerente e Desenvolvedor
// A sessão por senha (ADR 0047, 0049) é um cookie HttpOnly: o servidor o põe e o
// navegador o manda sozinho. O app só guarda QUEM entrou e até quando, para não
// voltar ao login a cada recarga — se o cookie tiver morrido, a primeira tela
// responde 401 e o app esquece.
const SESSAO_POR_SENHA = 'lt-sessao-senha'

export const entrarComSenha = async (login: string, senha: string): Promise<Sessao> => {
  const r = await pedir<{ nome: string; perfil: string; exp: number }>('/admin/sessao', {
    metodo: 'POST',
    corpo: { login, senha },
  })
  const sessao = { nome: r.nome, perfil: r.perfil, exp: r.exp }
  try {
    localStorage.setItem(SESSAO_POR_SENHA, JSON.stringify(sessao))
  } catch {
    // Sem armazenamento, a sessão dura só esta aba.
  }
  return sessao
}

export function lerSessaoPorSenha(agora = Date.now()): Sessao | null {
  try {
    const guardada = JSON.parse(localStorage.getItem(SESSAO_POR_SENHA) ?? 'null') as Sessao | null
    // `exp` do token do Admin é em segundos, como o do JWT.
    if (guardada === null || Number(guardada.exp) * 1000 <= agora) return null
    return guardada
  } catch {
    return null
  }
}

export async function sairDaSessaoPorSenha() {
  try {
    localStorage.removeItem(SESSAO_POR_SENHA)
  } catch {
    // nada guardado
  }
  // Apagar o cookie é do servidor: HttpOnly não se apaga daqui.
  await pedir('/admin/sessao', { metodo: 'DELETE' }).catch(() => {})
}
