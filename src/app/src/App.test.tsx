import {
  fireEvent as disparar,
  render as renderizar,
  screen as tela,
  waitFor as aguardar,
  within as dentroDe,
} from '@testing-library/react'
import { afterEach as aposCadaTeste, beforeEach as antesDeCadaTeste, expect as esperar, test as testar, vi as simulacao } from 'vitest'

import App from './App'
import { enfileirarMidia, enviarPelaFila, TETO_FOTOS } from './outbox'
import {
  achadosCompartilharFixture, achadosDetalheFixture, achadosDoacaoVaziaFixture,
  achadosEntregaVaziaFixture, achadosFixture, achadosRegistroVazioFixture, achadosSemFotoFixture,
} from './telas/Achados.fixture'
import { avisosUrgentesFixture } from './telas/AvisoUrgente.fixture'
import { avisosAtendenteFixture, avisosEscrevendoFixture, avisosFixture, avisosLembretesFixture } from './telas/Avisos.fixture'
import { ajustesFixture, ajustesRestritaFixture } from './telas/Ajustes.fixture'
import {
  checklistBloqueadaFixture, checklistFixture, checklistModalComFotoFixture, checklistModalFixture,
  checklistModalLeituraFixture,
} from './telas/Checklist.fixture'
import { escalaExtraFixture, escalaFixture, escalaPadroesFixture, escalaRevisaoFixture } from './telas/Escala.fixture'
import { estoqueAdminFixture, estoqueBomboniereFixture, estoqueCompraFixture, estoqueFixture } from './telas/Estoque.fixture'
import { homeFixture } from './telas/Home.fixture'
import { horasExtrasFixture, horasExtrasPagasFixture } from './telas/HorasExtras.fixture'
import { comandaDetalheFixture, comandaFechadaFixture, comandaFixture } from './telas/Comanda.fixture'
import { sidebarFixture } from './telas/Sidebar.fixture'
import { treinamentoAbertoFixture, treinamentoAdminAbertoFixture, treinamentoAdminFixture, treinamentoFixture } from './telas/Treinamento.fixture'

// O fixture é a implementação nº 1 do contrato `Dados<Tela>` (ADR 0042 §2); aqui
// ele faz o papel da nº 2, o servidor. Se o formato divergir, o teste vê.
const ENTRADA = {
  hora: '08:12',
  data: '17 AGO 2026',
  local: 'Recepção',
  aparelho: 'Tablet 01',
  pessoas: [
    { identificador: 'c-paulo', nome: 'Paulo', papel: 'Atendente' },
    { identificador: 'c-helena', nome: 'Helena', papel: 'Admin' },
  ],
}

// O servidor não manda `logo` (asset do bundle): o App põe o dele. Os urgentes
// do modal vêm com o menu (ADR 0070 §2); aqui, nenhum.
const { logo: _logo, ...MENU } = sidebarFixture
const SIDEBAR = { ...MENU, avisosUrgentes: [] as typeof avisosUrgentesFixture }

const SESSAO = { claim: 'claim.de.teste', nome: 'Paulo', perfil: 'atendente', exp: '2026-08-17T09:00:00Z' }

type Resposta = { codigo?: number; corpo: unknown }

/** Roteia por caminho e guarda o que foi pedido, pra conferir cabeçalho e corpo. */
function simularServidor(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos: { caminho: string; opcoes: RequestInit }[] = []

  // O menu é lido em toda tela logada; quem não o testa não precisa declará-lo.
  const todas: typeof rotas = { '/tela/sidebar': { corpo: SIDEBAR }, ...rotas }

  simulacao.stubGlobal('fetch', async (caminho: string, opcoes: RequestInit = {}) => {
    // A conferência de versão (src/versao.ts) fica fora da conta: 404 é "sem versão publicada".
    if (caminho === '/versao.json') return { ok: false, status: 404 } as Response
    pedidos.push({ caminho, opcoes })
    // O `id` da foto é um uuid que a fila sorteia (ADR 0072 §3): a rota casa sem ele.
    const rota = todas[caminho.replace(/&id=[0-9a-f-]+$/, '')]
    if (rota === undefined) throw new Error(`rota nao simulada: ${caminho}`)
    const { codigo = 200, corpo } = typeof rota === 'function' ? rota() : rota
    return {
      ok: codigo >= 200 && codigo < 300,
      status: codigo,
      text: async () => JSON.stringify(corpo),
    } as Response
  })

  return pedidos
}

const tocar = (nome: string | RegExp) => disparar.click(tela.getByRole('button', { name: nome }))

const digitar = (pin: string) => {
  for (const digito of pin) tocar(digito)
}

// O tablet do teste já está registrado (ADR 0048); os testes do registro
// apagam a chave e escrevem o caso de propósito.
const CHAVE = 'chave-do-tablet-de-teste'
antesDeCadaTeste(() => localStorage.setItem('lt-dispositivo', CHAVE))

aposCadaTeste(() => {
  simulacao.unstubAllGlobals()
  simulacao.restoreAllMocks()
  localStorage.clear()
})

/**
 * A câmera e o canvas, que o jsdom não tem. O que o teste exercita é a ORDEM do
 * ADR 0051 §7 — a foto sobe, a tela é relida, e só então o motivo é confirmado;
 * o desenho no canvas é chamada de navegador, e tem teste próprio em foto.test.ts.
 */
function simularCamera(bytes = 1000) {
  simulacao.stubGlobal('createImageBitmap', async () => ({ width: 2000, height: 1000, close: () => {} }))
  simulacao.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D)
  simulacao.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((retorno) => {
    retorno(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
  })
}

const FOTO_DA_CAMERA = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })

testar('sem claim, a primeira tela é a Entrada, com quem o banco disse que está ativo', async () => {
  simularServidor({ '/tela/entrada': { corpo: ENTRADA } })

  renderizar(<App />)

  esperar(await tela.findByRole('button', { name: /Paulo/ })).toBeVisible()
  esperar(tela.getByRole('button', { name: /Helena/ })).toBeVisible()
})

testar('PIN completo abre sessão e a Home entra no lugar da Entrada', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')

  esperar(await tela.findByRole('heading', { name: homeFixture.saudacao })).toBeVisible()

  const sessao = pedidos.find((p) => p.caminho === '/sessao')!
  esperar(JSON.parse(sessao.opcoes.body as string)).toEqual({ colaborador_id: 'c-paulo', pin: '1122' })

  // A claim viaja em cabeçalho, nunca em cookie (ADR 0042 §4).
  const home = pedidos.find((p) => p.caminho === '/tela/home')!
  esperar(home.opcoes.headers).toMatchObject({ authorization: 'Bearer claim.de.teste' })
})

testar('PIN recusado não sai da Entrada e diz o que aconteceu', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { codigo: 401, corpo: { erro: 'pin_invalido' } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('0000')

  esperar(await tela.findByText('PIN incorreto. Tente de novo.')).toBeVisible()
})

// app.sessao_abrir confere o bloqueio ANTES do hash: bloqueado não responde
// sobre o PIN (migration 0034). A tela precisa dizer isso, não "PIN incorreto".
testar('colaborador bloqueado recebe recado próprio, não "PIN incorreto"', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { codigo: 401, corpo: { erro: 'bloqueado' } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('0000')

  esperar(await tela.findByText('Entrada bloqueada. Chame o Admin.')).toBeVisible()
})

// sessao_abrir só devolve 'sem_turno' depois de o PIN conferir (0043). Mostrar
// "PIN incorreto" fazia a pessoa tentar de novo até estourar o limite da rede.
testar('PIN certo sem turno escalado agora recebe recado próprio, não "PIN incorreto"', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { codigo: 401, corpo: { erro: 'sem_turno' } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('0000')

  esperar(await tela.findByText('Nenhum turno na Escala agora. Chame o Admin.')).toBeVisible()
})

// A virada de turno expira a claim (ADR 0020 §2). Não é falha: é o momento em
// que a próxima pessoa digita o PIN dela.
testar('claim expirada devolve o tablet para a Entrada, sem tela de erro', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { codigo: 401, corpo: { erro: 'claim expirada' } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')

  await aguardar(() => esperar(tela.getByRole('button', { name: /Helena/ })).toBeVisible())
  esperar(tela.queryByText(/Não foi possível carregar/)).toBeNull()
})

testar('tocar num ensaio abre o painel; "Ver comanda" leva à Comanda dele, sem criar nada', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/comanda?comanda=c-2': { corpo: comandaDetalheFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const comComanda = homeFixture.agenda.ensaios.find((ensaio) => ensaio.comanda.identificador === 'c-2')!
  tocar(new RegExp(comComanda.cliente))
  esperar(pedidos.some((p) => p.caminho.startsWith('/rpc/'))).toBe(false)
  tocar('Ver comanda')

  await tela.findByRole('form', { name: 'Adicionar item à comanda' })
  esperar(pedidos.some((p) => p.caminho.startsWith('/rpc/'))).toBe(false)
})

// "Criar comanda" (#113), dentro do painel. O ensaio a3 do fixture é o do Ramon, sem Comanda.
const criarComandaDoA3 = () => { tocar(/Ramon Bonifácio/); tocar('Criar comanda') }

async function entrarNaHome() {
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
}

testar('"Criar comanda" cria pela RPC e leva à Comanda criada', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/rpc/comanda_criar': { corpo: { resultado: { id: 'c-1' } } },
    '/tela/comanda?comanda=c-1': { corpo: comandaDetalheFixture },
  })
  await entrarNaHome()

  criarComandaDoA3()

  await tela.findByRole('form', { name: 'Adicionar item à comanda' })
  const chamada = pedidos.find((p) => p.caminho === '/rpc/comanda_criar')!
  // Só o agendamento: evento e ator o servidor crava (allow-list, ADR 0042 §3).
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({ agendamento_id: 'a3' })
})

// O job (0030) pode ter criado entre a Home ser lida e o toque. O banco recusa
// com LT003 "ja tem Comanda", sem o id: a Home relida diz qual é, e o toque
// termina onde terminaria — na Comanda do ensaio, sem erro na tela.
testar('o job criou no meio: "Criar comanda" leva à Comanda que já existe', async () => {
  let leituras = 0
  const criadaPeloJob = {
    ...homeFixture,
    agenda: {
      ...homeFixture.agenda,
      ensaios: homeFixture.agenda.ensaios.map((e) => e.identificador === 'a3'
        ? { ...e, comanda: { status: 'aberta' as const, rotulo: 'Comanda aberta', identificador: 'c-1', podeAbrir: false } }
        : e),
    },
  }
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': () => ({ corpo: leituras++ === 0 ? homeFixture : criadaPeloJob }),
    '/rpc/comanda_criar': { codigo: 409, corpo: { erro: 'agendamento a3 ja tem Comanda', code: 'LT003' } },
    '/tela/comanda?comanda=c-1': { corpo: comandaDetalheFixture },
  })
  await entrarNaHome()

  criarComandaDoA3()

  await tela.findByRole('form', { name: 'Adicionar item à comanda' })
  esperar(pedidos.filter((p) => p.caminho === '/rpc/comanda_criar')).toHaveLength(1)
  esperar(tela.queryByText(/ja tem Comanda/)).toBeNull()
})

testar('recusa que não é corrida fica na Home e diz o que houve', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/rpc/comanda_criar': { codigo: 409, corpo: { erro: 'competencia trancada', code: 'LT004' } },
  })
  await entrarNaHome()

  criarComandaDoA3()

  esperar(await tela.findByRole('alert')).toHaveTextContent('A competência deste mês está trancada.')
  esperar(tela.getByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
})

testar('o menu leva ao Treinamento, relê o menu, e o perfil volta à Entrada', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/treinamento': { corpo: treinamentoFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  // Recolhido por padrão: o servidor não sabe se o dedo abriu o menu.
  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Treinamento/ }))

  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  esperar(await tela.findByRole('button', { name: /Como armar o softbox/ })).toBeVisible()
  // Navegar relê o menu: os contadores mudam com o que o turno faz.
  esperar(pedidos.filter((p) => p.caminho === '/tela/sidebar').length).toBe(2)

  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Helena/ }))
  esperar(await tela.findByRole('button', { name: /Paulo/ })).toBeVisible()
})

// Pedido do Wyll: na tela larga o menu aberto tem coluna própria e não cobre
// nada, então trocar de módulo não o fecha. Na estreita ele cobre a tela e
// fecha, como o teste acima.
testar('na tela larga o menu aberto continua aberto depois de navegar', async () => {
  simulacao.stubGlobal('matchMedia', (consulta: string) => ({ matches: consulta === '(min-width: 1024px)' }))
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/treinamento': { corpo: treinamentoFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  irPeloMenu(/Treinamento/)

  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  esperar(await tela.findByRole('button', { name: /Como armar o softbox/ })).toBeVisible()
  esperar(tela.getByRole('button', { name: 'Recolher menu' })).toHaveAttribute('aria-expanded', 'true')
})

// Com o Treinamento ligado não sobrou módulo do menu sem tela, então este
// caminho deixou de aparecer sozinho. Ele continua sendo a defesa de quando o
// SERVIDOR lista um módulo que este front ainda não conhece — dizer isso é
// melhor que desenhar uma tela em branco.
testar('módulo que o servidor lista e o front não conhece diz isso, em vez de ficar vazio', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/sidebar': {
      corpo: { ...SIDEBAR, itens: [...SIDEBAR.itens, { identificador: 'relatorios', codigo: 'RL', rotulo: 'Relatórios' }] },
    },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar('Abrir menu')
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
    .getByRole('button', { name: /Relatórios/ }))

  esperar(await tela.findByText('Relatórios ainda não está ligada ao banco.')).toBeVisible()
})

testar('Checklist abre pela lateral da Home e a aba vira parâmetro da tela no servidor', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    '/tela/checklist?fase=saida': { corpo: checklistBloqueadaFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  esperar(await tela.findByRole('heading', { name: checklistFixture.titulo })).toBeVisible()
  const lida = pedidos.find((p) => p.caminho === '/tela/checklist')!
  esperar(lida.opcoes.headers).toMatchObject({ authorization: 'Bearer claim.de.teste' })

  tocar('Ver saída')
  esperar(await tela.findByRole('status', { name: 'Saída bloqueada' })).toBeVisible()
  esperar(pedidos.some((p) => p.caminho === '/tela/checklist?fase=saida')).toBe(true)
})

testar('Estoque abre pelo menu e trocar de aba pede a aba ao servidor', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=conferir': { corpo: estoqueFixture },
    '/tela/estoque?aba=compra': { corpo: estoqueCompraFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Conferir' }))
  esperar(await tela.findByRole('heading', { name: estoqueFixture.titulo })).toBeVisible()

  tocar(estoqueFixture.abas[1].rotulo)
  esperar(await tela.findByRole('heading', { name: estoqueCompraFixture.titulo })).toBeVisible()
  esperar(pedidos.some((p) => p.caminho === '/tela/estoque?aba=compra')).toBe(true)
})

testar('Escala abre pela consulta da Home', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/escala': { corpo: escalaFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Escala/ }))
  esperar(await tela.findByText(escalaFixture.periodo)).toBeVisible()
})

// "Editar escala → Confirmar" (migration 0060): o dedo marca vários turnos,
// nada viaja até o Confirmar, e então vai tudo numa chamada só.
async function editarAEscala(rotas: Record<string, Resposta>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/escala': { corpo: escalaFixture },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Escala/ }))
  await tela.findByText(escalaFixture.periodo)
  tocar('Editar escala')
  return pedidos
}

const turnoDaEscala = (dia: string, turno: string) =>
  dentroDe(dentroDe(tela.getByRole('listitem', { name: dia })).getByRole('group', { name: turno }))

testar('Editar escala: as trocas vão juntas no Confirmar, e a tela é relida', async () => {
  const pedidos = await editarAEscala({ '/rpc/escala_alterar': { corpo: { resultado: 2 } } })

  esperar(tela.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  disparar.click(turnoDaEscala('terça, 2026-08-18', 'Tarde/noite').getByRole('button', { name: 'troca' }))
  esperar(turnoDaEscala('terça, 2026-08-18', 'Tarde/noite').getByText('cobre Paulo')).toBeVisible()
  disparar.click(turnoDaEscala('terça, 2026-08-18', 'Manhã').getByRole('button', { name: 'troca' }))
  esperar(pedidos.some((p) => p.caminho === '/rpc/escala_alterar')).toBe(false)

  tocar('Confirmar')
  esperar(await corpoDa(pedidos, '/rpc/escala_alterar')).toEqual({
    alteracoes: [
      { turno_id: 't-2026-08-18-manha', versao: 1, tipo: 'troca', colaborador_id: 'c-paulo' },
      { turno_id: 't-2026-08-18-tarde_noite', versao: 1, tipo: 'troca', colaborador_id: 'c-marcos' },
    ],
  })
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Editar escala' })).toBeVisible())
  esperar(pedidos.filter((p) => p.caminho === '/tela/escala')).toHaveLength(2)
})

testar('Editar escala: a recusa aparece e o modo de edição continua', async () => {
  await editarAEscala({
    '/rpc/escala_alterar': { codigo: 409, corpo: { erro: 'este turno foi alterado por outra pessoa', code: 'LT001' } },
  })
  disparar.click(turnoDaEscala('terça, 2026-08-18', 'Manhã').getByRole('button', { name: 'troca' }))
  tocar('Confirmar')
  esperar(await tela.findByRole('alert')).toHaveTextContent('Alguém alterou um desses turnos')
  esperar(tela.getByRole('button', { name: 'Cancelar' })).toBeVisible()
})

// Domingo extra (migration 0062): os dois gestos saem do mesmo botão do dia.
async function abrirAEscala(rotas: Record<string, Resposta>, corpo = escalaFixture) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/escala': { corpo },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Escala/ }))
  await tela.findByText(corpo.periodo)
  return pedidos
}

testar('Assumir domingo: "outra pessoa" percorre a equipe e o segundo toque grava', async () => {
  const pedidos = await abrirAEscala({ '/rpc/escala_domingo_acionar': { corpo: { resultado: {} } } })

  const domingo = () => dentroDe(tela.getByRole('listitem', { name: 'domingo, 2026-08-23' }))
  // Thiago é o último da equipe: o próximo volta ao começo, no Marcos.
  disparar.click(domingo().getByRole('button', { name: 'outra pessoa' }))
  esperar(domingo().getByRole('button', { name: 'Assumir · Marcos' })).toBeVisible()
  esperar(pedidos.some((p) => p.caminho === '/rpc/escala_domingo_acionar')).toBe(false)

  disparar.click(domingo().getByRole('button', { name: 'Assumir · Marcos' }))
  esperar(await corpoDa(pedidos, '/rpc/escala_domingo_acionar'))
    .toEqual({ data: '2026-08-23', colaborador_id: 'c-marcos' })
})

testar('Desfazer domingo leva o turno e a versão que a tela leu', async () => {
  const pedidos = await abrirAEscala(
    { '/rpc/escala_domingo_desfazer': { corpo: { resultado: {} } } }, escalaExtraFixture)

  const domingo = dentroDe(tela.getByRole('listitem', { name: 'domingo, 2026-08-23' }))
  disparar.click(domingo.getByRole('button', { name: 'Desfazer' }))
  esperar(await corpoDa(pedidos, '/rpc/escala_domingo_desfazer'))
    .toEqual({ turno_id: 't-2026-08-23-extra', versao: 1 })
})

// "Alterar âncora ou colaboradores" (0062): a revisão é recorte (`?revisar=`),
// decidir cada troca é rascunho, e o Confirmar manda a proposta inteira.
testar('Revisão da âncora: sem decidir não confirma; decidida, vai numa chamada só', async () => {
  const pedidos = await abrirAEscala({
    '/tela/escala?visao=padroes': { corpo: escalaPadroesFixture },
    '/tela/escala?revisar=tarde_noite&visao=padroes': { corpo: escalaRevisaoFixture },
    '/rpc/escala_padrao_revisar': { corpo: { resultado: { regerados: 3 } } },
  })

  tocar('Padrões')
  const cartao = await tela.findByRole('article', { name: 'Tarde/noite' })
  disparar.click(dentroDe(cartao).getByRole('button', { name: 'Alterar âncora ou colaboradores' }))

  const revisao = dentroDe(await tela.findByRole('region', { name: 'Revisão obrigatória antes de confirmar' }))
  esperar(revisao.getByRole('button', { name: 'Confirmar nova âncora' })).toBeDisabled()

  disparar.click(revisao.getByRole('button', { name: 'Voltar ao padrão' }))
  esperar(revisao.getByRole('status')).toHaveTextContent('1 de 1 revisadas')
  esperar(pedidos.some((p) => p.caminho === '/rpc/escala_padrao_revisar')).toBe(false)

  disparar.click(revisao.getByRole('button', { name: 'Confirmar nova âncora' }))
  esperar(await corpoDa(pedidos, '/rpc/escala_padrao_revisar')).toEqual({
    turno: 'tarde_noite',
    versao: 1,
    colaboradores: ['c-paulo', 'c-thiago'],
    ancora_data: '2026-08-10',
    ancora_colaborador_id: 'c-thiago',
    decisoes: [{ turno_id: 'troca-19', versao: 1, decisao: 'padrao' }],
  })
  // Confirmada, a revisão fecha: o recorte sai e a visão volta aos Padrões.
  await aguardar(() => esperar(tela.queryByRole('region', { name: 'Revisão obrigatória antes de confirmar' })).not.toBeInTheDocument())
})

testar('Horas extras: aba pelo menu e período pela tela, os dois viram parâmetro', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/horas?aba=pagas': { corpo: horasExtrasPagasFixture },
    '/tela/horas?periodo=q1&aba=pagas': { corpo: horasExtrasFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Horas extras/ }))
  disparar.click(menu().getByRole('button', { name: 'Pagas' }))
  await aguardar(() => esperar(pedidos.some((p) => p.caminho === '/tela/horas?aba=pagas')).toBe(true))
  await tela.findByText(horasExtrasPagasFixture.registros[0].detalhe)

  tocar(horasExtrasPagasFixture.periodos[1].rotulo)
  await aguardar(() => esperar(pedidos.some((p) => p.caminho === '/tela/horas?periodo=q1&aba=pagas')).toBe(true))
})

// Os quatro gestos de dinheiro da tela (migrations 0063 e 0065). Até a PR que
// ligou isto, a tela desenhava os botões e nenhum chamava nada.
async function abrirAsHorasExtras(
  rotas: Record<string, Resposta>, corpo = horasExtrasFixture, aba = 'Pendentes',
) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    [`/tela/horas?aba=${aba.toLowerCase()}`]: { corpo },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  // O item do menu tem subitens: tocar nele abre a lista, e quem navega é a aba.
  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Horas extras/ }))
  disparar.click(menu().getByRole('button', { name: aba }))
  await tela.findByRole('heading', { name: 'Horas extras' })
  return pedidos
}

const registroDeExtra = (identificador: string) =>
  dentroDe(tela.getByRole('listitem', { name: new RegExp(identificador) }))

testar('Marcar paga vai direto, com o id e a versão que a tela leu', async () => {
  const pedidos = await abrirAsHorasExtras({ '/rpc/hora_extra_pagar': { corpo: { resultado: {} } } })

  disparar.click(registroDeExtra('he-1045').getByRole('button', { name: 'Marcar paga' }))
  esperar(await corpoDa(pedidos, '/rpc/hora_extra_pagar'))
    .toEqual({ hora_extra_id: 'he-1045', versao: 1 })
})

// Cancelar e estornar exigem motivo na RPC: o primeiro toque só abre a caixa.
testar('Cancelar abre a caixa de motivo e não escreve antes de confirmar', async () => {
  const pedidos = await abrirAsHorasExtras({ '/rpc/hora_extra_cancelar': { corpo: { resultado: {} } } })

  disparar.click(registroDeExtra('he-1045').getByRole('button', { name: 'Cancelar' }))
  const caixa = dentroDe(await tela.findByRole('form', { name: 'Cancelar he-1045' }))
  esperar(caixa.getByRole('button', { name: 'Cancelar a extra' })).toBeDisabled()
  esperar(pedidos.some((p) => p.caminho === '/rpc/hora_extra_cancelar')).toBe(false)

  disparar.change(caixa.getByLabelText('Motivo do cancelamento'), { target: { value: 'duplicada' } })
  disparar.click(caixa.getByRole('button', { name: 'Cancelar a extra' }))
  esperar(await corpoDa(pedidos, '/rpc/hora_extra_cancelar'))
    .toEqual({ hora_extra_id: 'he-1045', versao: 1, motivo: 'duplicada' })
})

testar('Estornar usa a mesma caixa, com rótulo próprio e a RPC do estorno', async () => {
  const pedidos = await abrirAsHorasExtras(
    { '/rpc/hora_extra_estornar': { corpo: { resultado: {} } } }, horasExtrasPagasFixture, 'Pagas')

  disparar.click(registroDeExtra('he-1021').getByRole('button', { name: 'Estornar' }))
  const caixa = dentroDe(await tela.findByRole('form', { name: 'Cancelar he-1021' }))
  disparar.change(caixa.getByLabelText('Motivo do estorno'), { target: { value: 'pagou errado' } })
  disparar.click(caixa.getByRole('button', { name: 'Estornar o pagamento' }))

  esperar(await corpoDa(pedidos, '/rpc/hora_extra_estornar'))
    .toEqual({ hora_extra_id: 'he-1021', versao: 1, motivo: 'pagou errado' })
  esperar(pedidos.some((p) => p.caminho === '/rpc/hora_extra_cancelar')).toBe(false)
})

// O intervalo vira dois instantes sem fuso — quem resolve é o `timezone` da
// transação, não o relógio do tablet. Fim menor que o início é madrugada do dia
// seguinte, e a data digitada continua sendo a do início (ADR 0061 §1).
testar('Lançar manual: o fim antes do início vira o dia seguinte', async () => {
  const pedidos = await abrirAsHorasExtras({ '/rpc/hora_extra_lancar': { corpo: { resultado: {} } } })

  tocar('Lançar manual')
  const formulario = dentroDe(await tela.findByRole('form', { name: 'Lançar hora extra manual' }))
  esperar(formulario.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()

  disparar.change(formulario.getByLabelText('Data'), { target: { value: '2026-08-17' } })
  disparar.change(formulario.getByLabelText('Início'), { target: { value: '23:00' } })
  disparar.change(formulario.getByLabelText('Fim'), { target: { value: '00:30' } })
  // O ensaio da Ana acaba às 23:00, onde a extra começa: já vem marcado.
  esperar(formulario.getByRole('button', { name: /Ana Souza/ })).toHaveAttribute('aria-pressed', 'true')
  disparar.click(formulario.getByRole('button', { name: 'Enviar para aprovação' }))

  esperar(await corpoDa(pedidos, '/rpc/hora_extra_lancar')).toEqual({
    colaborador_id: 'Helena', inicio: '2026-08-17 23:00', fim: '2026-08-18 00:30',
    ensaio_id: 'ag-1042', sem_ensaio_motivo: null,
  })
})

// A madrugada liga ao ensaio da véspera; "Sem ensaio" só envia com motivo.
testar('Lançar manual: ensaio da véspera aparece marcado, e sem ensaio exige motivo', async () => {
  const pedidos = await abrirAsHorasExtras({ '/rpc/hora_extra_lancar': { corpo: { resultado: {} } } })

  tocar('Lançar manual')
  const formulario = dentroDe(await tela.findByRole('form', { name: 'Lançar hora extra manual' }))
  disparar.change(formulario.getByLabelText('Data'), { target: { value: '2026-08-17' } })
  disparar.change(formulario.getByLabelText('Início'), { target: { value: '00:10' } })
  disparar.change(formulario.getByLabelText('Fim'), { target: { value: '01:00' } })
  esperar(formulario.getByRole('button', { name: 'véspera · 22:30–00:30 · Bruno Lima · sem comanda' })).toBeInTheDocument()

  disparar.click(formulario.getByRole('button', { name: 'Sem ensaio' }))
  esperar(formulario.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()
  disparar.change(formulario.getByLabelText('Motivo'), { target: { value: '  arrumação  ' } })
  disparar.click(formulario.getByRole('button', { name: 'Enviar para aprovação' }))

  esperar(await corpoDa(pedidos, '/rpc/hora_extra_lancar')).toEqual({
    colaborador_id: 'Helena', inicio: '2026-08-17 00:10', fim: '2026-08-17 01:00',
    ensaio_id: null, sem_ensaio_motivo: 'arrumação',
  })
})

testar('Lançar manual por outra pessoa manda o destinatário escolhido', async () => {
  const pedidos = await abrirAsHorasExtras({ '/rpc/hora_extra_lancar': { corpo: { resultado: {} } } })

  tocar('Lançar manual')
  const formulario = dentroDe(await tela.findByRole('form', { name: 'Lançar hora extra manual' }))
  disparar.change(formulario.getByLabelText('Data'), { target: { value: '2026-08-17' } })
  disparar.change(formulario.getByLabelText('Início'), { target: { value: '07:00' } })
  disparar.change(formulario.getByLabelText('Fim'), { target: { value: '07:30' } })
  disparar.click(formulario.getByRole('button', { name: 'Marcos' }))
  // Nenhum ensaio encosta nas 07:00 (ADR 0083): sem escolher, não envia.
  esperar(formulario.getByText(/Nenhum ensaio encosta nesse horário/)).toBeInTheDocument()
  esperar(formulario.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()
  disparar.click(formulario.getByRole('button', { name: 'Outro ensaio…' }))
  disparar.change(formulario.getByRole('searchbox', { name: 'Buscar ensaio' }), { target: { value: '#1042' } })
  esperar(formulario.queryByRole('button', { name: /Bruno Lima/ })).not.toBeInTheDocument()
  disparar.click(formulario.getByRole('button', { name: /Ana Souza/ }))
  // Fechada a busca, o escolhido continua à vista e marcado.
  disparar.click(formulario.getByRole('button', { name: 'Fechar busca' }))
  esperar(formulario.getByRole('button', { name: /Ana Souza/ })).toHaveAttribute('aria-pressed', 'true')
  esperar(formulario.getByRole('status')).toHaveTextContent('Vai para Marcos, que é avisado.')

  disparar.click(formulario.getByRole('button', { name: 'Enviar para aprovação' }))
  esperar(await corpoDa(pedidos, '/rpc/hora_extra_lancar')).toEqual({
    colaborador_id: 'Marcos', inicio: '2026-08-17 07:00', fim: '2026-08-17 07:30',
    ensaio_id: 'ag-1042', sem_ensaio_motivo: null,
  })
})

testar('Achados: abrir um item pede o detalhe ao servidor, e fechar volta à lista', async () => {
  const id = achadosFixture.achados[0].identificador
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/achados': { corpo: achadosFixture },
    [`/tela/achados?achado=${id}`]: { corpo: achadosDetalheFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Achados/ }))
  const item = achadosFixture.achados[0]
  disparar.click(await tela.findByRole('button', { name: `Abrir ${item.descricao}, ${item.codigo}` }))
  esperar(await tela.findByRole('dialog', { name: `Detalhes de ${item.descricao}` })).toBeVisible()

  tocar('Fechar achado')
  await aguardar(() => esperar(tela.queryByRole('dialog')).toBeNull())
  esperar(pedidos.filter((p) => p.caminho === '/tela/achados').length).toBe(2)
})

testar('Avisos: "Ver quem leu" abre as leituras sem nova ida ao servidor', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/avisos?aba=ativos': { corpo: avisosFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar('Abrir menu')
  const menu = dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  disparar.click(menu.getByRole('button', { name: /Avisos/ }))
  disparar.click(menu.getByRole('button', { name: 'Ativos' }))
  const primeiro = avisosFixture.avisos[0]
  await tela.findByRole('heading', { name: primeiro.titulo })

  const antes = pedidos.length
  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Ver quem leu' }))
  esperar(tela.getByRole('list', { name: `Leituras de ${primeiro.titulo}` })).toBeVisible()
  esperar(pedidos.length).toBe(antes)
})

testar('Ajustes restrito: "Ir para a entrada" troca a pessoa no tablet', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    // O fixture da Sidebar tem subitens em Ajustes; a do servidor não. A aba vai e é ignorada.
    '/tela/ajustes?aba=pins': { corpo: ajustesRestritaFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar('Abrir menu')
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Menu principal' })).getByRole('button', { name: /Ajustes/ }))
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Menu principal' })).getByRole('button', { name: 'PINs de acesso' }))
  disparar.click(await tela.findByRole('button', { name: 'Ir para a entrada' }))
  esperar(await tela.findByRole('button', { name: /Helena/ })).toBeVisible()
})

// ------------------------------------------------------ o aparelho (ADR 0048)
testar('aparelho sem chave pede o registro antes de mostrar a equipe', async () => {
  localStorage.removeItem('lt-dispositivo')
  const pedidos = simularServidor({ '/tela/entrada': { corpo: ENTRADA } })

  renderizar(<App />)
  // Sem chave a porta padrão é o login por senha; o tablet é registrado pelo link.
  esperar(tela.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  tocar('Este é o tablet do estúdio? Registrar este aparelho')
  esperar(tela.getByRole('heading', { name: 'Este aparelho ainda não está registrado' })).toBeVisible()
  esperar(pedidos).toHaveLength(0)

  disparar.change(tela.getByLabelText('Chave do aparelho'), { target: { value: `  ${CHAVE}  ` } })
  tocar('Registrar')

  esperar(await tela.findByRole('button', { name: /Paulo/ })).toBeVisible()
  esperar(localStorage.getItem('lt-dispositivo')).toBe(CHAVE)
  esperar(pedidos[0].opcoes.headers).toMatchObject({ 'x-lt-dispositivo': CHAVE })
})

testar('chave revogada volta ao registro e diz por quê', async () => {
  simularServidor({ '/tela/entrada': { codigo: 401, corpo: { erro: 'dispositivo nao registrado' } } })

  renderizar(<App />)
  esperar(await tela.findByRole('alert')).toHaveTextContent('Essa chave não vale')
  esperar(localStorage.getItem('lt-dispositivo')).toBeNull()
})

// --------------------------------------- sócio, gerente e Desenvolvedor (ADR 0049)
const entrarComo = (login: string, senha: string) => {
  disparar.change(tela.getByLabelText('Login'), { target: { value: login } })
  disparar.change(tela.getByLabelText('Senha'), { target: { value: senha } })
  tocar('Entrar')
}

testar('sócio entra por login e senha no computador, sem chave de tablet e sem claim', async () => {
  localStorage.removeItem('lt-dispositivo')
  const pedidos = simularServidor({
    '/admin/sessao': { corpo: { nome: 'Wyll', perfil: 'administrador', exp: Math.floor(Date.now() / 1000) + 3600 } },
    '/tela/home': { corpo: homeFixture },
  })

  renderizar(<App />)
  entrarComo('wyll', 'uma-senha-bem-longa')

  esperar(await tela.findByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
  const login = pedidos.find((p) => p.caminho === '/admin/sessao')!
  esperar(JSON.parse(login.opcoes.body as string)).toEqual({ login: 'wyll', senha: 'uma-senha-bem-longa' })
  // A sessão é o cookie HttpOnly: a leitura das telas não leva Bearer nem chave.
  const home = pedidos.find((p) => p.caminho === '/tela/home')!
  esperar(home.opcoes.headers).not.toHaveProperty('authorization')
  esperar(home.opcoes.headers).not.toHaveProperty('x-lt-dispositivo')
  // O que fica guardado é quem entrou, nunca a senha.
  esperar(localStorage.getItem('lt-sessao-senha')).not.toContain('uma-senha-bem-longa')
})

testar('senha errada diz o que aconteceu e limpa o campo', async () => {
  localStorage.removeItem('lt-dispositivo')
  simularServidor({ '/admin/sessao': { codigo: 401, corpo: { erro: 'invalido' } } })

  renderizar(<App />)
  entrarComo('wyll', 'errada')

  esperar(await tela.findByRole('alert')).toHaveTextContent('Login ou senha incorretos.')
  esperar(tela.getByLabelText('Senha')).toHaveValue('')
})

testar('login vai sem espaço e em minúscula: "Wyll " é o mesmo que "wyll"', async () => {
  localStorage.removeItem('lt-dispositivo')
  const pedidos = simularServidor({ '/admin/sessao': { codigo: 401, corpo: { erro: 'invalido' } } })

  renderizar(<App />)
  esperar(tela.getByLabelText('Login')).toHaveFocus()
  entrarComo('  Wyll ', 'uma-senha-bem-longa')

  await tela.findByRole('alert')
  const login = pedidos.find((p) => p.caminho === '/admin/sessao')!
  esperar(JSON.parse(login.opcoes.body as string).login).toBe('wyll')
})

testar('o olho mostra e esconde a senha', () => {
  localStorage.removeItem('lt-dispositivo')
  simularServidor({})

  renderizar(<App />)
  const senha = tela.getByLabelText('Senha')
  esperar(senha).toHaveAttribute('type', 'password')
  tocar('Mostrar senha')
  esperar(senha).toHaveAttribute('type', 'text')
  tocar('Esconder senha')
  esperar(senha).toHaveAttribute('type', 'password')
})

testar('avisa quando o Caps Lock está ligado', () => {
  localStorage.removeItem('lt-dispositivo')
  simularServidor({})

  renderizar(<App />)
  const senha = tela.getByLabelText('Senha')
  disparar.keyUp(senha, { key: 'A', modifierCapsLock: true })
  esperar(tela.getByText('Caps Lock ligado')).toBeVisible()
  disparar.keyUp(senha, { key: 'a', modifierCapsLock: false })
  esperar(tela.queryByText('Caps Lock ligado')).toBeNull()
})

testar('esqueci a senha diz a quem pedir, sem prometer o que não existe', () => {
  localStorage.removeItem('lt-dispositivo')
  simularServidor({})

  renderizar(<App />)
  tocar('Esqueci minha senha')
  esperar(tela.getByText(/responsável pelo sistema/)).toBeVisible()
})

testar('recarregar mantém a sessão por senha; expirada no servidor volta ao login', async () => {
  localStorage.removeItem('lt-dispositivo')
  localStorage.setItem('lt-sessao-senha', JSON.stringify({ nome: 'Helena', perfil: 'administrador', exp: Math.floor(Date.now() / 1000) + 3600 }))
  simularServidor({
    '/tela/home': { codigo: 401, corpo: { erro: 'claim expirada' } },
    '/admin/sessao': { corpo: { ok: true } },
  })

  renderizar(<App />)
  esperar(await tela.findByRole('heading', { name: 'Entrar' })).toBeVisible()
  esperar(localStorage.getItem('lt-sessao-senha')).toBeNull()
})

testar('fechar a comanda manda o horário praticado e relê a tela', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/comanda': { corpo: comandaFixture },
    '/tela/comanda?comanda=c-1': { corpo: comandaDetalheFixture },
    '/rpc/comanda_transicionar': { corpo: { resultado: { id: 'c-1' } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar(/abertas/)
  const lista = await tela.findByRole('list', { name: 'Comandas do recorte' })
  disparar.click(dentroDe(lista).getAllByRole('button')[0])

  await tela.findByRole('form', { name: 'Adicionar item à comanda' })
  disparar.change(tela.getByLabelText('Fim'), { target: { value: '10:50' } })
  disparar.click(tela.getByRole('button', { name: 'Fechar comanda' }))

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/comanda_transicionar')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    comanda_id: 'c-1', versao: 1, evento: 'fechar',
    // Hora local, sem fuso: quem resolve o America/Maceio é o banco.
    fim_praticado: '2026-08-07 10:50', inicio_praticado: '2026-08-07 09:00', telefone: null, forma_pagamento: null,
  })
  // A escrita é seguida de releitura: o total, as ações e a versão mudaram.
  await aguardar(() =>
    esperar(pedidos.filter((p) => p.caminho === '/tela/comanda?comanda=c-1').length).toBe(2))
})

testar('fim antes do início no fechamento é o dia seguinte: o ensaio passou da meia-noite', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/comanda': { corpo: comandaFixture },
    '/tela/comanda?comanda=c-1': { corpo: comandaDetalheFixture },
    '/rpc/comanda_transicionar': { corpo: { resultado: { id: 'c-1' } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar(/abertas/)
  const lista = await tela.findByRole('list', { name: 'Comandas do recorte' })
  disparar.click(dentroDe(lista).getAllByRole('button')[0])

  await tela.findByRole('form', { name: 'Adicionar item à comanda' })
  disparar.change(tela.getByLabelText('Fim'), { target: { value: '00:30' } })
  disparar.click(tela.getByRole('button', { name: 'Fechar comanda' }))

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/comanda_transicionar')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  // Com a data do início, 00:30 caía antes do fim agendado e a extensão saía zero.
  esperar(JSON.parse(String(chamada.opcoes.body))).toMatchObject({
    fim_praticado: '2026-08-08 00:30', inicio_praticado: '2026-08-07 09:00',
  })
})

// ------------------------------------------- comprovante da Comanda (ADR 0073)
const LINK = '/comprovante/c-3-1-1754611200?t=token'

async function abrirFechadaComoHelena(rotas: Record<string, Resposta> = {}) {
  localStorage.removeItem('lt-dispositivo')
  localStorage.setItem('lt-sessao-senha', JSON.stringify({ nome: 'Helena', perfil: 'administrador', exp: Math.floor(Date.now() / 1000) + 3600 }))
  const pedidos = simularServidor({
    '/tela/home': { corpo: homeFixture },
    '/tela/comanda': { corpo: comandaFixture },
    '/tela/comanda?comanda=c-1': { corpo: comandaFechadaFixture },
    '/comprovante?comanda=c-3': { codigo: 201, corpo: { comprovante_id: 'c-3-1-1754611200', envio: 1, link: LINK } },
    '/rpc/comanda_transicionar': { corpo: { resultado: { id: 'c-3' } } },
    ...rotas,
  })

  renderizar(<App />)
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  tocar(/abertas/)
  const lista = await tela.findByRole('list', { name: 'Comandas do recorte' })
  disparar.click(dentroDe(lista).getAllByRole('button')[0])
  await tela.findByRole('button', { name: 'Copiar mensagem' })
  return pedidos
}

const doComprovante = (pedidos: { caminho: string; opcoes: RequestInit }[]) =>
  pedidos.filter((p) => p.caminho.startsWith('/comprovante'))
const rpcDeEnvio = (pedidos: { caminho: string; opcoes: RequestInit }[]) =>
  pedidos.filter((p) => p.caminho === '/rpc/comanda_transicionar')

testar('"Copiar mensagem" guarda o PDF e copia o texto com o link, sem registrar envio', async () => {
  const writeText = simulacao.fn(async () => {})
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

  const pedidos = await abrirFechadaComoHelena()
  tocar('Copiar mensagem')

  const secao = await tela.findByRole('status', { name: 'Mensagem para o cliente' })
  const [pedido] = doComprovante(pedidos)
  esperar(pedido.opcoes.method).toBe('POST')
  esperar(pedido.opcoes.headers).toMatchObject({ 'content-type': 'application/pdf' })
  // Cookie do Admin, não claim de tablet.
  esperar(pedido.opcoes.headers).not.toHaveProperty('authorization')
  esperar((pedido.opcoes.body as Blob).type).toBe('application/pdf')

  const texto = `Olá, Conceição! Aqui está o comprovante do seu ensaio no Lifetrailer Studio em 07/08/2026: ${window.location.origin}${LINK}`
  esperar(writeText).toHaveBeenCalledWith(texto)
  esperar(dentroDe(secao).getByRole('heading')).toHaveTextContent('Mensagem copiada')
  esperar(dentroDe(secao).getByLabelText('Mensagem')).toHaveValue(texto)
  esperar(rpcDeEnvio(pedidos)).toHaveLength(0)
})

testar('sem área de transferência, a mensagem fica à vista para copiar à mão', async () => {
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } })

  await abrirFechadaComoHelena()
  tocar('Copiar mensagem')

  const secao = await tela.findByRole('status', { name: 'Mensagem para o cliente' })
  esperar(dentroDe(secao).getByRole('heading')).toHaveTextContent('Copie a mensagem')
})

testar('"Enviei" é a transição enviar, com o telefone do cliente', async () => {
  const pedidos = await abrirFechadaComoHelena()
  tocar('Enviei')

  await aguardar(() => esperar(rpcDeEnvio(pedidos)).toHaveLength(1))
  esperar(JSON.parse(String(rpcDeEnvio(pedidos)[0].opcoes.body))).toMatchObject({
    comanda_id: 'c-3', evento: 'enviar', telefone: '82999990000',
  })
  esperar(doComprovante(pedidos)).toHaveLength(0)
})

testar('"Baixar PDF" baixa o arquivo guardado, o mesmo que o link serve', async () => {
  const clicar = simulacao.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  const pedidos = await abrirFechadaComoHelena()
  tocar('Baixar PDF')

  await aguardar(() => esperar(clicar).toHaveBeenCalledOnce())
  const ancora = clicar.mock.contexts[0] as HTMLAnchorElement
  esperar(ancora.href).toBe(`${window.location.origin}${LINK}`)
  esperar(ancora.download).toBe('comprovante-12.pdf')
  esperar(doComprovante(pedidos)).toHaveLength(1)
})

// O Enviar pelo ManyChat (ADR 0076): o mesmo texto do Copiar, mandado pelo servidor.
const comEnviar = {
  ...comandaFechadaFixture,
  selecionada: {
    ...comandaFechadaFixture.selecionada!,
    acoes: [
      { identificador: 'enviar_manychat', rotulo: 'Enviar', desativada: false, motivo: '' },
      ...comandaFechadaFixture.selecionada!.acoes,
    ],
  },
}
const doEnvio = (pedidos: { caminho: string; opcoes: RequestInit }[]) =>
  pedidos.filter((p) => p.caminho === '/comprovante/enviar')

testar('"Enviar" guarda o PDF e manda o texto com o link pelo servidor', async () => {
  const pedidos = await abrirFechadaComoHelena({
    '/tela/comanda?comanda=c-1': { corpo: comEnviar },
    '/comprovante/enviar': { corpo: { enviado: true, registrado: true, resultado: { id: 'c-3' } } },
  })
  tocar('Enviar')

  await aguardar(() => esperar(doEnvio(pedidos)).toHaveLength(1))
  esperar(JSON.parse(String(doEnvio(pedidos)[0].opcoes.body))).toEqual({
    comanda_id: 'c-3',
    versao: comandaFechadaFixture.selecionada!.versao,
    texto: `Olá, Conceição! Aqui está o comprovante do seu ensaio no Lifetrailer Studio em 07/08/2026: ${window.location.origin}${LINK}`,
  })
  // Quem registra o envio é o servidor, depois do success: o front não chama a RPC.
  esperar(rpcDeEnvio(pedidos)).toHaveLength(0)
  esperar(tela.queryByRole('alert')).toBeNull()
})

testar('"Enviar" que não deu mostra o motivo e já deixa a mensagem com o link copiada', async () => {
  const writeText = simulacao.fn(async () => {})
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  const pedidos = await abrirFechadaComoHelena({
    '/tela/comanda?comanda=c-1': { corpo: comEnviar },
    '/comprovante/enviar': { corpo: { enviado: false, motivo: 'O cliente não mandou mensagem ao estúdio nas últimas 24h.' } },
  })
  tocar('Enviar')

  const alerta = await tela.findByRole('alert')
  esperar(alerta).toHaveTextContent('Não deu para enviar pelo automático')
  esperar(alerta).toHaveTextContent('últimas 24h')
  esperar(alerta).toHaveTextContent('Envie pelo link')
  const texto = `Olá, Conceição! Aqui está o comprovante do seu ensaio no Lifetrailer Studio em 07/08/2026: ${window.location.origin}${LINK}`
  await aguardar(() => esperar(writeText).toHaveBeenCalledWith(texto))
  esperar(tela.getByRole('heading', { name: 'Mensagem copiada' })).toBeInTheDocument()
  esperar(tela.getByRole('textbox', { name: 'Mensagem' })).toHaveValue(texto)
  esperar(rpcDeEnvio(pedidos)).toHaveLength(0)
})

testar('comanda que não está mais fechada diz isso e não copia nada', async () => {
  const writeText = simulacao.fn(async () => {})
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

  await abrirFechadaComoHelena({ '/comprovante?comanda=c-3': { codigo: 409, corpo: { erro: 'x' } } })
  tocar('Copiar mensagem')

  esperar(await tela.findByRole('alert')).toHaveTextContent('não está fechada')
  esperar(writeText).not.toHaveBeenCalled()
})

testar('tocar num item do Checklist alterna o estado e relê a tela', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    '/rpc/checklist_item_marcar': { corpo: { resultado: { id: 'i-1' } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })

  // Um item por marcar: o que vai é o OPOSTO do que a tela mostra.
  const item = checklistFixture.colunas
    .flatMap((coluna) => coluna.salas)
    .flatMap((sala) => sala.itens)
    .find((i) => i.podeTratar && !i.tratado)!
  disparar.click(tela.getByRole('button', { name: item.nome }))

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/checklist_item_marcar')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    item_id: item.identificador, versao: item.versao, estado: 'feito',
  })
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/checklist').length).toBe(2))
})

testar('"Concluir entrada" manda o dia e a versão dele, não o item', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    '/rpc/checklist_fase_concluir': { corpo: { resultado: { id: 'dia-1' } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })
  tocar(`Concluir ${checklistFixture.fase}`)

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/checklist_fase_concluir')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    dia_id: checklistFixture.dia!.identificador,
    versao: checklistFixture.dia!.versao,
    fase: checklistFixture.fase,
  })
})

testar('o cartão da Home marca o item sem sair da Home', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/rpc/checklist_item_marcar': { corpo: { resultado: { id: 'i-1' } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const item = homeFixture.checklist!.itens.find((i) => !i.marcado)!
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: item.texto }))

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/checklist_item_marcar')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    item_id: item.identificador, versao: item.versao, estado: 'feito',
  })
  // Quem tocou não saiu do início: é a HOME que é relida, não /tela/checklist.
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/home').length).toBe(2))
  esperar(pedidos.some((p) => p.caminho.startsWith('/tela/checklist'))).toBe(false)
})


testar('Tentar novamente recupera a Entrada mesmo depois de outra falha de rede', async () => {
  let conectado = false
  const pedidos = simularServidor({
    '/tela/entrada': () => {
      if (!conectado) throw new TypeError('Failed to fetch')
      return { corpo: ENTRADA }
    },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: 'Tentar novamente' }))
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled())

  conectado = true
  tocar('Tentar novamente')
  esperar(await tela.findByRole('button', { name: /Paulo/ })).toBeVisible()
  esperar(pedidos.every((p) => p.opcoes.method === 'GET')).toBe(true)
})

testar.each(['/tela/home', '/tela/sidebar'])('Tentar novamente recupera %s sem pedir outro PIN', async (caminho) => {
  let conectado = false
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/sidebar': { corpo: SIDEBAR },
    [caminho]: () => conectado
      ? { corpo: caminho === '/tela/home' ? homeFixture : SIDEBAR }
      : { codigo: 503, corpo: { erro: 'temporariamente indisponível' } },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('button', { name: 'Tentar novamente' })

  conectado = true
  tocar('Tentar novamente')
  esperar(await tela.findByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
  esperar(tela.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
  esperar(pedidos.filter((p) => p.caminho === '/sessao')).toHaveLength(1)
  esperar(pedidos.filter((p) => p.caminho === caminho).at(-1)?.opcoes.headers)
    .toMatchObject({ authorization: `Bearer ${SESSAO.claim}` })
})

testar('Tentar novamente preserva a fase do Checklist que falhou ao carregar', async () => {
  let conectado = false
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    '/tela/checklist?fase=saida': () => conectado
      ? { corpo: checklistBloqueadaFixture }
      : { codigo: 503, corpo: { erro: 'temporariamente indisponível' } },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })
  tocar('Ver saída')
  await tela.findByRole('button', { name: 'Tentar novamente' })

  conectado = true
  tocar('Tentar novamente')
  esperar(await tela.findByRole('status', { name: 'Saída bloqueada' })).toBeVisible()
})

testar('Tentar novamente após falha de releitura não repete a marcação já enviada', async () => {
  let marcou = false
  let conectado = false
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': () => marcou && !conectado
      ? { codigo: 503, corpo: { erro: 'temporariamente indisponível' } }
      : { corpo: homeFixture },
    '/rpc/checklist_item_marcar': () => {
      marcou = true
      return { corpo: { resultado: { id: 'i-1' } } }
    },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  const item = homeFixture.checklist!.itens.find((i) => !i.marcado)!
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: item.texto }))
  await tela.findByRole('button', { name: 'Tentar novamente' })

  conectado = true
  tocar('Tentar novamente')
  esperar(await tela.findByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
  esperar(pedidos.filter((p) => p.caminho === '/rpc/checklist_item_marcar')).toHaveLength(1)
})

testar('Tentar novamente após falha ao entrar limpa o PIN e espera nova digitação', async () => {
  let conectado = false
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': () => {
      if (!conectado) throw new TypeError('Failed to fetch')
      return { corpo: SESSAO }
    },
    '/tela/home': { corpo: homeFixture },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('button', { name: 'Tentar novamente' })

  conectado = true
  tocar('Tentar novamente')
  await tela.findByRole('button', { name: '1' })
  esperar(pedidos.filter((p) => p.caminho === '/sessao')).toHaveLength(1)
  digitar('1122')
  esperar(await tela.findByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
})

testar('sessão que expira durante Tentar novamente volta à Entrada', async () => {
  let expirou = false
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': () => expirou
      ? { codigo: 401, corpo: { erro: 'claim expirada' } }
      : { codigo: 503, corpo: { erro: 'temporariamente indisponível' } },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('button', { name: 'Tentar novamente' })

  expirou = true
  tocar('Tentar novamente')
  esperar(await tela.findByRole('button', { name: /Paulo/ })).toBeVisible()
  esperar(tela.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
})

// ------------------------------------------------------ conferência do Estoque
// O identificador é o que viaja para o banco; o nome é o que a tela rotula.
const PROPES = { id: 'limpeza:Propés', nome: 'Propés' }            // conferido, quantidade "0"
const ESPONJA = { id: 'limpeza:Esponja piso', nome: 'Esponja piso' } // nunca conferido, "—"

/** Entra, abre o Estoque na aba Conferir e põe a tela em modo de edição. */
async function editarOEstoque(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=conferir': { corpo: estoqueFixture },
    ...rotas,
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Conferir' }))
  await tela.findByRole('heading', { name: estoqueFixture.titulo })

  tocar('Editar quantidades')
  return pedidos
}

const quantidadeDe = (nome: string) =>
  dentroDe(tela.getByRole('group', { name: `Quantidade de ${nome}` })).getByText(/\d+|—/).textContent

const corpoDa = async (pedidos: { caminho: string; opcoes: RequestInit }[], caminho: string) => {
  const p = await aguardar(() => {
    const achado = pedidos.find((pedido) => pedido.caminho === caminho)
    if (achado === undefined) throw new Error(`${caminho} nao chamada`)
    return achado
  })
  return JSON.parse(String(p.opcoes.body))
}

testar('conferir o Estoque manda a passada inteira numa chamada só, e relê a tela', async () => {
  const pedidos = await editarOEstoque({
    '/rpc/estoque_conferir': { corpo: { resultado: 2 } },
  })

  // Insumo nunca conferido mostra "—" em leitura e abre a edição em 0: quem
  // está contando parte do zero, e não de um número que ninguém contou.
  esperar(quantidadeDe(ESPONJA.nome)).toBe('0')
  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  esperar(quantidadeDe(ESPONJA.nome)).toBe('2')

  tocar(`Aumentar quantidade de ${PROPES.nome}`)
  tocar('Confirmar')

  esperar(await corpoDa(pedidos, '/rpc/estoque_conferir')).toEqual({
    itens: [
      { item_id: ESPONJA.id, quantidade: 2 },
      { item_id: PROPES.id, quantidade: 1 },
    ],
  })
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/estoque?aba=conferir').length).toBe(2))
})

// O coração do desenho: a lista que vai é o que o dedo mexeu, não o catálogo.
// Mandar tudo carimbaria "conferido" em 52 itens que ninguém contou — e nos
// nunca conferidos gravaria 0, que é justamente o topo da escala de urgência.
testar('o que ninguém contou não entra na lista', async () => {
  const pedidos = await editarOEstoque({
    '/rpc/estoque_conferir': { corpo: { resultado: 1 } },
  })

  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar('Confirmar')

  const corpo = await corpoDa(pedidos, '/rpc/estoque_conferir')
  esperar(corpo.itens).toHaveLength(1)
  esperar(corpo.itens[0].item_id).toBe(ESPONJA.id)
})

// Contar e achar o mesmo número TAMBÉM é conferir: o que muda é `conferido_em`.
testar('mexer e voltar ao número de antes continua sendo uma contagem', async () => {
  const pedidos = await editarOEstoque({
    '/rpc/estoque_conferir': { corpo: { resultado: 1 } },
  })

  tocar(`Aumentar quantidade de ${PROPES.nome}`)
  tocar(`Diminuir quantidade de ${PROPES.nome}`)
  esperar(quantidadeDe(PROPES.nome)).toBe('0')
  tocar('Confirmar')

  esperar(await corpoDa(pedidos, '/rpc/estoque_conferir'))
    .toEqual({ itens: [{ item_id: PROPES.id, quantidade: 0 }] })
})

testar('a quantidade não desce abaixo de zero', async () => {
  await editarOEstoque({})

  tocar(`Diminuir quantidade de ${PROPES.nome}`)
  esperar(quantidadeDe(PROPES.nome)).toBe('0')
})

testar('Cancelar joga a passada fora, sem chamar o banco', async () => {
  const pedidos = await editarOEstoque({})

  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar('Cancelar')

  esperar(quantidadeDe(ESPONJA.nome)).toBe('—')
  esperar(pedidos.some((p) => p.caminho === '/rpc/estoque_conferir')).toBe(false)
})

testar('Confirmar sem ter mexido em nada não chama o banco', async () => {
  const pedidos = await editarOEstoque({})

  tocar('Confirmar')

  await aguardar(() => esperar(tela.getByRole('button', { name: 'Editar quantidades' })).toBeVisible())
  esperar(pedidos.some((p) => p.caminho === '/rpc/estoque_conferir')).toBe(false)
})

// Perder uma passada de contagem inteira por uma falha é pior que a tela ficar
// em modo de edição: a recusa aparece e os números contados continuam lá.
testar('recusa do banco mantém o rascunho aberto, com os números contados', async () => {
  await editarOEstoque({
    '/rpc/estoque_conferir': { codigo: 400, corpo: { erro: 'insumo inativo', code: 'LT002' } },
  })

  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar('Confirmar')

  esperar(await tela.findByRole('alert')).toHaveTextContent(/saiu do catálogo/)
  esperar(quantidadeDe(ESPONJA.nome)).toBe('2')
  esperar(tela.getByRole('button', { name: 'Confirmar' })).toBeVisible()
})

testar('trocar de aba abandona a passada não confirmada', async () => {
  const pedidos = await editarOEstoque({
    '/tela/estoque?aba=compra': { corpo: estoqueCompraFixture },
  })

  tocar(`Aumentar quantidade de ${ESPONJA.nome}`)
  tocar(estoqueFixture.abas[1].rotulo)
  await tela.findByRole('heading', { name: estoqueCompraFixture.titulo })

  tocar(estoqueFixture.abas[0].rotulo)
  await tela.findByRole('heading', { name: estoqueFixture.titulo })
  esperar(tela.getByRole('button', { name: 'Editar quantidades' })).toBeVisible()
  esperar(quantidadeDe(ESPONJA.nome)).toBe('—')
  esperar(pedidos.some((p) => p.caminho === '/rpc/estoque_conferir')).toBe(false)
})

// ------------------------------------------------ fornecedor do insumo (ADR 0071)
async function abrirOEstoqueComoAdmin(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=conferir': { corpo: estoqueAdminFixture },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Conferir' }))
  await tela.findByRole('heading', { name: estoqueFixture.titulo })
  return pedidos
}

testar('editar o insumo manda item, versão e a ficha inteira, e relê a tela', async () => {
  const pedidos = await abrirOEstoqueComoAdmin({
    '/rpc/estoque_insumo_alterar': { corpo: { resultado: {} } },
  })

  tocar(`Editar ${PROPES.nome}`)
  const ficha = dentroDe(tela.getByRole('dialog', { name: `Editar ${PROPES.nome}` }))
  esperar(ficha.getByLabelText('Fornecedor')).toHaveValue('Percarbonato')
  disparar.change(ficha.getByLabelText('Fornecedor'), { target: { value: 'Atacadão' } })
  disparar.click(ficha.getByRole('button', { name: 'Salvar' }))

  esperar(await corpoDa(pedidos, '/rpc/estoque_insumo_alterar')).toEqual({
    item_id: PROPES.id, versao: 3, nome: PROPES.nome, categoria: 'Limpeza', fornecedor: 'Atacadão',
    especificacao: '', severidade: 'atencao',
  })
  await aguardar(() => esperar(tela.queryByRole('dialog')).not.toBeInTheDocument())
  esperar(pedidos.filter((p) => p.caminho === '/tela/estoque?aba=conferir').length).toBe(2)
})

testar('Novo insumo cria com categoria nova, e a recusa mantém a ficha aberta', async () => {
  const pedidos = await abrirOEstoqueComoAdmin({
    '/rpc/estoque_insumo_criar': { codigo: 400, corpo: { erro: 'ja existe o insumo Sal', code: 'LT003' } },
  })

  tocar('Novo insumo')
  const ficha = dentroDe(tela.getByRole('dialog', { name: 'Novo insumo' }))
  disparar.change(ficha.getByLabelText('Nome'), { target: { value: 'Sal' } })
  disparar.change(ficha.getByLabelText('Categoria'), { target: { value: 'Cozinha' } })
  disparar.click(ficha.getByRole('button', { name: 'Urgente' }))
  disparar.click(ficha.getByRole('button', { name: 'Salvar' }))

  esperar(await corpoDa(pedidos, '/rpc/estoque_insumo_criar')).toEqual({
    nome: 'Sal', categoria: 'Cozinha', fornecedor: '', especificacao: '', severidade: 'urgente',
  })
  esperar(await tela.findByRole('alert')).toHaveTextContent('ja existe o insumo Sal')
  esperar(tela.getByLabelText('Nome')).toHaveValue('Sal')
})

testar('renomear a categoria manda o nome velho e o novo', async () => {
  const pedidos = await abrirOEstoqueComoAdmin({
    '/rpc/estoque_renomear': { corpo: { resultado: 3 } },
  })
  const grupo = estoqueAdminFixture.colunas[0].grupos[0]
  tocar(`Renomear categoria ${grupo.nome}`)
  disparar.change(tela.getByLabelText('Novo nome'), { target: { value: 'Higiene' } })
  disparar.click(dentroDe(tela.getByRole('group', { name: `Renomear ${grupo.nome}` })).getByRole('button', { name: 'Salvar' }))
  esperar(await corpoDa(pedidos, '/rpc/estoque_renomear')).toEqual({ campo: 'categoria', de: grupo.nome, para: 'Higiene' })
})

// ------------------------------------------------ A foto ampliada do Estoque
// A miniatura existia desenhada e não abria nada: o App não passava os dois
// callbacks, e o servidor manda `fotoAberta` sempre nula (issue #147).
testar('tocar na miniatura amplia a foto do insumo, sem ida ao servidor', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=conferir': { corpo: estoqueFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Conferir' }))
  await tela.findByRole('heading', { name: estoqueFixture.titulo })

  const idas = pedidos.length
  esperar(tela.queryByRole('dialog')).not.toBeInTheDocument()

  tocar('Ver foto de Propés')
  const dialogo = await tela.findByRole('dialog', { name: 'Foto de Propés' })
  // A foto já veio na lista: ampliar não pede nada de novo.
  esperar(pedidos.length).toBe(idas)

  disparar.click(dentroDe(dialogo).getByRole('button', { name: 'Fechar' }))
  await aguardar(() => esperar(tela.queryByRole('dialog')).not.toBeInTheDocument())
})

// A miniatura é desenhada em Conferir, Compra e Bomboniere, e o item procurado
// vive numa lista diferente em cada uma. Sem este caso, procurar só em `colunas`
// passaria no teste de cima e deixaria duas abas mudas.
testar('a miniatura também amplia na Bomboniere, que é outra lista', async () => {
  simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=bomboniere': { corpo: estoqueBomboniereFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Bomboniere' }))
  await tela.findByRole('heading', { name: estoqueBomboniereFixture.titulo })

  tocar('Ver foto de Doritos 32g')
  esperar(await tela.findByRole('dialog', { name: 'Foto de Doritos 32g' })).toBeVisible()
})

// ---------------------------------------- "Repor / ajustar" da Bomboniere
const DORITOS = { id: 'bomboniere-doritos-32g', nome: 'Doritos 32g' }  // saldo "14"

/** Entra, abre o Estoque na aba Bomboniere e abre o ajuste de um item. */
async function abrirAjusteDaBomboniere(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/estoque?aba=bomboniere': { corpo: estoqueBomboniereFixture },
    ...rotas,
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Estoque/ }))
  disparar.click(menu().getByRole('button', { name: 'Bomboniere' }))
  await tela.findByRole('heading', { name: estoqueBomboniereFixture.titulo })

  tocar(`Repor ou ajustar ${DORITOS.nome}`)
  return pedidos
}

// O que viaja é o DELTA contra o saldo lido, e não o alvo que a tela mostra:
// "chegaram 2" continua verdade se uma Comanda der baixa no meio.
testar('repor manda o delta, não o saldo alvo, e não manda motivo', async () => {
  const pedidos = await abrirAjusteDaBomboniere({
    '/rpc/bomboniere_movimentar': { corpo: { resultado: { id: 'b-1' } } },
  })

  tocar(`Aumentar saldo de ${DORITOS.nome}`)
  tocar(`Aumentar saldo de ${DORITOS.nome}`)
  tocar(`Confirmar ajuste de ${DORITOS.nome}`)

  esperar(await corpoDa(pedidos, '/rpc/bomboniere_movimentar'))
    .toEqual({ item_id: DORITOS.id, delta: 2, motivo: null })
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/estoque?aba=bomboniere').length).toBe(2))
})

testar('tirar do saldo manda o delta negativo com o motivo escrito', async () => {
  const pedidos = await abrirAjusteDaBomboniere({
    '/rpc/bomboniere_movimentar': { corpo: { resultado: { id: 'b-1' } } },
  })

  tocar(`Diminuir saldo de ${DORITOS.nome}`)
  disparar.change(tela.getByLabelText('Por que está saindo do saldo?'), { target: { value: '  vencido  ' } })
  tocar(`Confirmar ajuste de ${DORITOS.nome}`)

  esperar(await corpoDa(pedidos, '/rpc/bomboniere_movimentar'))
    .toEqual({ item_id: DORITOS.id, delta: -1, motivo: 'vencido' })
})

testar('abrir e fechar sem mexer no saldo não escreve no ledger', async () => {
  const pedidos = await abrirAjusteDaBomboniere({})

  tocar(`Confirmar ajuste de ${DORITOS.nome}`)

  await aguardar(() => esperar(tela.getByRole('button', { name: `Repor ou ajustar ${DORITOS.nome}` })).toBeVisible())
  esperar(pedidos.some((p) => p.caminho === '/rpc/bomboniere_movimentar')).toBe(false)
})

testar('recusa do ledger mantém o ajuste aberto, com o número e o motivo', async () => {
  await abrirAjusteDaBomboniere({
    '/rpc/bomboniere_movimentar': { codigo: 400, corpo: { erro: 'item inativo', code: 'LT002' } },
  })

  tocar(`Aumentar saldo de ${DORITOS.nome}`)
  tocar(`Confirmar ajuste de ${DORITOS.nome}`)

  esperar(await tela.findByRole('alert')).toHaveTextContent(/saiu do catálogo/)
  esperar(tela.getByRole('group', { name: `Ajuste de ${DORITOS.nome}` })).toHaveTextContent('15')
})

// ---------------------------------------------------- PINs de acesso (Ajustes)
const BIA = { id: 'bia', nome: 'Bia' }
const WYLL = { id: 'wyll', nome: 'Wyll' }

async function abrirAjustes(rotas: Record<string, Resposta | (() => Resposta)>, secao = 'PINs de acesso') {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    // A Sidebar tem o subitem "PINs de acesso" em Ajustes; a tela do servidor
    // não usa aba. A aba viaja e é ignorada — como no teste do acesso restrito.
    '/tela/ajustes?aba=pins': { corpo: ajustesFixture },
    ...rotas,
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  const menu = () => dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  tocar('Abrir menu')
  disparar.click(menu().getByRole('button', { name: /Ajustes/ }))
  disparar.click(menu().getByRole('button', { name: 'PINs de acesso' }))
  await tela.findByRole('heading', { name: 'Ajustes' })
  // A tela abre na Equipe; a seção é escolhida no menu da própria tela.
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Seções dos ajustes' })).getByRole('button', { name: secao }))
  return pedidos
}

const trocarPin = (nome: string, pin: string, repetido = pin) => {
  disparar.click(tela.getByRole('button', { name: `Trocar PIN de ${nome}` }))
  disparar.change(tela.getByLabelText(`Digite o PIN novo de ${nome}`), { target: { value: pin } })
  disparar.change(tela.getByLabelText(`Repita o PIN novo de ${nome}`), { target: { value: repetido } })
}

// Uma pessoa por vez: o lote vai com um item só, e a tela relê depois.
testar('trocar PIN manda só aquela pessoa e relê a tela', async () => {
  const pedidos = await abrirAjustes({
    '/rpc/pin_definir_lote': { corpo: { resultado: 1 } },
  })

  trocarPin(BIA.nome, '4721')

  esperar(await corpoDa(pedidos, '/rpc/pin_definir_lote')).toEqual({ pines: [{ colaborador_id: BIA.id, pin: '4721' }] })
  esperar(await tela.findByRole('status')).toHaveTextContent('PIN de Bia trocado. Vale no próximo acesso.')
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/ajustes?aba=pins').length).toBe(2))
})

// Quem entra por senha não tem PIN (ADR 0049): nem aparece para trocar.
testar('a lista de PIN não oferece Gerente nem sócio', async () => {
  await abrirAjustes({})

  esperar(tela.queryByRole('button', { name: `Trocar PIN de ${WYLL.nome}` })).toBeNull()
  esperar(tela.getByRole('button', { name: `Trocar PIN de ${BIA.nome}` })).toBeVisible()
})

// A 0088 escreve o motivo; a tela mostra esse texto, não um genérico.
testar('recusa do banco mostra o motivo que o banco escreveu', async () => {
  await abrirAjustes({
    '/rpc/pin_definir_lote': { codigo: 409, corpo: { erro: 'O PIN novo é igual ao atual. Escolha outro PIN.', code: 'LT002' } },
  })

  trocarPin(BIA.nome, '4721')

  esperar(await tela.findByRole('alert')).toHaveTextContent('O PIN novo é igual ao atual. Escolha outro PIN.')
  esperar((tela.getByLabelText(`Digite o PIN novo de ${BIA.nome}`) as HTMLInputElement).value).toBe('')
})

testar('sem ser sócio, a recusa diz quem pode', async () => {
  await abrirAjustes({
    '/rpc/pin_definir_lote': { codigo: 409, corpo: { erro: 'acao restrita ao socio', code: 'LT005' } },
  })

  trocarPin(BIA.nome, '4721')

  esperar(await tela.findByRole('alert')).toHaveTextContent(/Só o sócio define PIN/)
})

// Issue #220: "senha atual errada" chega como RESULTADO (o banco grava a
// tentativa), e a tela tem de dizer isso, não "senha trocada".
testar('trocar a própria senha: atual errada avisa; certa confirma e relê a tela', async () => {
  let certa = false
  const pedidos = await abrirAjustes({
    '/rpc/senha_trocar_propria': () => ({ corpo: { resultado: certa ? { ok: true } : { ok: false, motivo: 'senha_atual_incorreta' } } }),
  }, 'Senhas')
  const caixa = dentroDe(tela.getByRole('region', { name: 'Minha senha' }))
  const preencher = () => {
    disparar.change(caixa.getByLabelText('Senha atual'), { target: { value: 'a-senha-de-hoje' } })
    disparar.change(caixa.getByLabelText('Senha nova'), { target: { value: 'a-senha-de-amanha' } })
    disparar.change(caixa.getByLabelText('Repita a senha nova'), { target: { value: 'a-senha-de-amanha' } })
    disparar.click(caixa.getByRole('button', { name: 'Trocar senha' }))
  }

  preencher()
  esperar(await caixa.findByRole('alert')).toHaveTextContent('A senha atual não confere.')
  esperar(await corpoDa(pedidos, '/rpc/senha_trocar_propria')).toEqual({ senha_atual: 'a-senha-de-hoje', senha_nova: 'a-senha-de-amanha' })

  certa = true
  preencher()
  esperar(await caixa.findByRole('status')).toHaveTextContent('Senha trocada')
})

// --------------------------------------------- a justificativa do Checklist
const ITEM_JUSTIFICADO = checklistModalLeituraFixture.modal!.identificador
const ITEM_POR_TRATAR = checklistModalFixture.modal!.identificador

testar('justificar: a foto sobe primeiro, e só então o motivo grava', async () => {
  simularCamera()
  let fotoSubiu = false
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    // O modal vem do SERVIDOR, e o que ele mostra muda quando a foto chega.
    [`/tela/checklist?item=${ITEM_POR_TRATAR}`]: () =>
      ({ corpo: fotoSubiu ? checklistModalComFotoFixture : checklistModalFixture }),
    [`/midia?ativo=item_execucao&registro=${ITEM_POR_TRATAR}&compressao=lt1`]: () => {
      fotoSubiu = true
      return { codigo: 201, corpo: { midia_id: 'm-1', endereco: '/midia/m-1?t=assinado', bytes: 1000 } }
    },
    '/rpc/checklist_item_justificar': { corpo: { resultado: { id: ITEM_POR_TRATAR } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })

  // "justificar" é recorte: quem monta o modal é o servidor.
  const grupo = tela.getByRole('group', { name: 'Luzes, tomadas · checar' })
  disparar.click(dentroDe(grupo).getByRole('button', { name: 'justificar' }))
  await tela.findByRole('dialog', { name: 'Justificar item' })
  esperar(tela.getByRole('button', { name: 'Confirmar justificativa' })).toBeDisabled()

  disparar.change(tela.getByLabelText('Tirar foto'), { target: { files: [FOTO_DA_CAMERA] } })

  const envio = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho.startsWith('/midia?'))
    if (p === undefined) throw new Error('a foto nao subiu')
    return p
  })
  // Os bytes vão crus no corpo (ADR 0051 §6), e são os do JPEG comprimido.
  esperar((envio.opcoes.body as Blob).type).toBe('image/jpeg')
  esperar((envio.opcoes.headers as Record<string, string>)['content-type']).toBe('image/jpeg')

  // A releitura é o que traz a versão nova e o endereço assinado da foto.
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Confirmar justificativa' })).toBeEnabled())

  disparar.change(tela.getByRole('textbox'), { target: { value: '  Ar quebrado  ' } })
  tocar('Confirmar justificativa')

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/checklist_item_justificar')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    item_id: ITEM_POR_TRATAR,
    versao: checklistModalComFotoFixture.modal!.versao,
    texto: 'Ar quebrado',
  })
})

// ------------------------------------------------ a fila de fotos (ADR 0072)
async function abrirAJustificativa(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    [`/tela/checklist?item=${ITEM_POR_TRATAR}`]: { corpo: checklistModalFixture },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })
  const grupo = tela.getByRole('group', { name: 'Luzes, tomadas · checar' })
  disparar.click(dentroDe(grupo).getByRole('button', { name: 'justificar' }))
  await tela.findByRole('dialog', { name: 'Justificar item' })
  return pedidos
}

testar('sem rede, a foto da justificativa fica na fila e aparece na bandeja', async () => {
  simularCamera()
  const pedidos = await abrirAJustificativa({})
  // Nenhuma rota /midia simulada: o fetch falha como falha sem rede.

  disparar.change(tela.getByLabelText('Tirar foto'), { target: { files: [FOTO_DA_CAMERA] } })

  esperar(await tela.findByRole('alert')).toHaveTextContent('ficou guardada no tablet')
  const envio = await achar(pedidos, (c) => c.startsWith('/midia?'))
  esperar(envio.caminho).toMatch(new RegExp(`&id=[0-9a-f-]{36}$`))

  tocar('1 foto esperando para subir')
  const bandeja = await tela.findByRole('dialog', { name: 'Descarga pendente' })
  const item = dentroDe(bandeja).getByRole('listitem', { name: 'Foto do Checklist' })
  esperar(item).toHaveTextContent('Esperando a internet')
  // Esperando a rede não tem o que reenviar: a fila tenta sozinha.
  esperar(dentroDe(item).queryByRole('button', { name: 'Reenviar' })).toBeNull()
})

testar('com a fila cheia, a captura bloqueia e o tablet avisa o Admin', async () => {
  simularCamera()
  // Enche a fila antes de abrir o app, sem rede.
  simulacao.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
  const alvo = { ativo: 'achado' as const, registro: 'outro', compressao: 'lt1' }
  for (let i = 0; i < TETO_FOTOS; i += 1) await enfileirarMidia('claim.antiga', alvo, new Blob([new Uint8Array(10)]))

  const pedidos = await abrirAJustificativa({ '/rpc/midia_fila_cheia': { corpo: { resultado: 1 } } })
  disparar.change(tela.getByLabelText('Tirar foto'), { target: { files: [FOTO_DA_CAMERA] } })

  esperar(await tela.findByRole('alert')).toHaveTextContent(`fila de fotos está cheia: ${TETO_FOTOS} fotos`)
  const aviso = await achar(pedidos, '/rpc/midia_fila_cheia')
  esperar(JSON.parse(String(aviso.opcoes.body))).toEqual({ fotos: TETO_FOTOS, bytes: TETO_FOTOS * 10 })
  esperar(pedidos.some((p) => p.caminho.startsWith(`/midia?ativo=item_execucao`))).toBe(false)
})

testar('"Reenviar" na bandeja manda de novo a foto que o sistema recusou', async () => {
  simulacao.stubGlobal('fetch', async () => ({
    ok: false, status: 409, text: async () => JSON.stringify({ erro: 'achado nao existe', code: 'LT003' }),
  }) as Response)
  const alvo = { ativo: 'achado' as const, registro: 'a-1', compressao: 'lt1' }
  await enviarPelaFila(SESSAO.claim, alvo, new Blob([new Uint8Array(10)]))

  let tentativas = 0
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/midia?ativo=achado&registro=a-1&compressao=lt1': () => {
      tentativas += 1
      return { codigo: 201, corpo: { midia_id: 'm', endereco: '/midia/m', bytes: 10 } }
    },
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })

  tocar('1 foto esperando para subir')
  const item = dentroDe(await tela.findByRole('dialog', { name: 'Descarga pendente' }))
    .getByRole('listitem', { name: 'Foto de achado' })
  esperar(item).toHaveTextContent('achado nao existe')
  // A inválida não retenta sozinha: só com o toque.
  esperar(tentativas).toBe(0)

  disparar.click(dentroDe(item).getByRole('button', { name: 'Reenviar' }))
  await aguardar(() => esperar(tentativas).toBe(1))
  await aguardar(() => esperar(tela.queryByRole('button', { name: /esperando para subir/ })).toBeNull())
  esperar(pedidos.filter((p) => p.caminho.startsWith('/midia?'))).toHaveLength(1)
})

testar('a foto pesada demais é recusada dentro do modal, sem subir nada', async () => {
  // Acima de 1 MB depois da escada inteira de qualidade (ADR 0026 §1).
  simularCamera(2 * 1024 * 1024)
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    [`/tela/checklist?item=${ITEM_POR_TRATAR}`]: { corpo: checklistModalFixture },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })

  const grupo = tela.getByRole('group', { name: 'Luzes, tomadas · checar' })
  disparar.click(dentroDe(grupo).getByRole('button', { name: 'justificar' }))
  await tela.findByRole('dialog', { name: 'Justificar item' })
  disparar.change(tela.getByLabelText('Tirar foto'), { target: { files: [FOTO_DA_CAMERA] } })

  esperar(await tela.findByRole('alert')).toHaveTextContent('pesada demais')
  esperar(pedidos.some((p) => p.caminho.startsWith('/midia?'))).toBe(false)
})

testar('remover a justificativa manda o item e a versão, e fecha o modal', async () => {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/checklist': { corpo: checklistFixture },
    [`/tela/checklist?item=${ITEM_JUSTIFICADO}`]: { corpo: checklistModalLeituraFixture },
    '/rpc/checklist_item_justificativa_remover': { corpo: { resultado: { id: ITEM_JUSTIFICADO } } },
  })

  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('region', { name: 'Checklist' })).getByRole('button', { name: 'Abrir' }))
  await tela.findByRole('heading', { name: checklistFixture.titulo })

  const grupo = tela.getByRole('group', { name: 'Piso · checar' })
  disparar.click(dentroDe(grupo).getByRole('button', { name: 'ver' }))
  const dialogo = await tela.findByRole('dialog', { name: 'Justificativa' })
  esperar(dialogo).toHaveTextContent('Cano estourado, chamei o encanador')

  disparar.click(dentroDe(dialogo).getByRole('button', { name: 'Remover justificativa' }))

  const chamada = await aguardar(() => {
    const p = pedidos.find((pedido) => pedido.caminho === '/rpc/checklist_item_justificativa_remover')
    if (p === undefined) throw new Error('rpc nao chamada')
    return p
  })
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    item_id: ITEM_JUSTIFICADO,
    versao: checklistModalLeituraFixture.modal!.versao,
  })
  // Fechado o modal, a tela volta a ser lida sem o recorte do item.
  await aguardar(() => esperar(tela.queryByRole('dialog')).toBeNull())
})

// ------------------------------------------------------ registrar achado
// O ACHADO NASCE, DEPOIS A FOTO (ADR 0053 §1). É a ordem inversa da do
// Checklist, e é o que estes três testes fixam: o item precisa existir para que
// a foto tenha a que se ligar.
const NOVO_ACHADO = 'ac-novo'

/** As rotas comuns dos três: entrada, sessão, home e a lista dos Achados. */
const servidorDosAchados = (rotas: Record<string, Resposta | (() => Resposta)>) => simularServidor({
  '/tela/entrada': { corpo: ENTRADA },
  '/sessao': { corpo: SESSAO },
  '/tela/home': { corpo: homeFixture },
  '/tela/achados': { corpo: achadosFixture },
  ...rotas,
})

async function irParaAchados() {
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Achados/ }))
  await tela.findByRole('heading', { name: 'Achados e perdidos' })
}

/**
 * Preenche o mínimo que o Guardar exige: descrição e foto.
 *
 * ⚠ NÃO toca no lugar de propósito. Com um só na lista (G11), ele já vem
 * marcado — e o teste abaixo prova que o que a tela mostra marcado é o que a
 * RPC recebe. Era aqui que dava para a tela dizer "Gaveta" e o banco gravar
 * nulo.
 */
function preencherORegistro(formulario: HTMLElement) {
  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'O que é' }), { target: { value: 'Casaco jeans' } })
  disparar.change(dentroDe(formulario).getByLabelText('Selecionar foto do achado'), { target: { files: [FOTO_DA_CAMERA] } })
}

const achar = async (pedidos: { caminho: string; opcoes: RequestInit }[], caminho: string | ((c: string) => boolean)) =>
  aguardar(() => {
    const teste = typeof caminho === 'string' ? (c: string) => c === caminho : caminho
    const p = pedidos.find((pedido) => teste(pedido.caminho))
    if (p === undefined) throw new Error(`nao houve pedido para ${caminho}`)
    return p
  })

testar('registrar achado: o item nasce sem foto, e a foto sobe em seguida', async () => {
  simularCamera()
  const pedidos = servidorDosAchados({
    '/tela/achados?registrar=1': { corpo: achadosRegistroVazioFixture },
    [`/tela/achados?achado=${NOVO_ACHADO}`]: { corpo: achadosDetalheFixture },
    '/rpc/achado_registrar': { corpo: { resultado: { id: NOVO_ACHADO } } },
    [`/midia?ativo=achado&registro=${NOVO_ACHADO}&compressao=lt1`]:
      { codigo: 201, corpo: { midia_id: 'm-9', endereco: '/midia/m-9?t=assinado', bytes: 1000 } },
  })

  await irParaAchados()
  // Abrir o formulário é recorte: quem o monta é o servidor.
  tocar('Registrar achado')
  const formulario = await tela.findByRole('form', { name: 'Registrar achado' })
  esperar(dentroDe(formulario).getByRole('button', { name: 'Guardar' })).toBeDisabled()

  preencherORegistro(formulario)
  await aguardar(() => esperar(dentroDe(formulario).getByRole('button', { name: 'Guardar' })).toBeEnabled())
  disparar.click(dentroDe(formulario).getByRole('button', { name: 'Guardar' }))

  // A RPC não recebe foto: o achado nasce em `aguardando_foto` (ADR 0053 §1).
  const registro = await achar(pedidos, '/rpc/achado_registrar')
  esperar(JSON.parse(String(registro.opcoes.body))).toEqual({
    descricao: 'Casaco jeans',
    estudio_id: null,
    data_achado: null,
    cliente_nome: '',
    observacao: '',
    local_guarda: 'Gaveta',
  })

  // E só então os bytes, crus no corpo, para o achado que acabou de existir.
  const foto = await achar(pedidos, (c) => c.startsWith('/midia?'))
  esperar((foto.opcoes.body as Blob).type).toBe('image/jpeg')
  esperar(pedidos.indexOf(registro)).toBeLessThan(pedidos.indexOf(foto))

  // O formulário fecha e a tela abre o item que nasceu.
  await achar(pedidos, `/tela/achados?achado=${NOVO_ACHADO}`)
  await aguardar(() => esperar(tela.queryByRole('form', { name: 'Registrar achado' })).toBeNull())
})

testar('a foto que não sobe deixa o achado registrado, e a foto guardada na fila', async () => {
  simularCamera()
  const pedidos = servidorDosAchados({
    '/tela/achados?registrar=1': { corpo: achadosRegistroVazioFixture },
    // O item nasceu e está sem foto: é este o estado que o spec tem pra isso.
    [`/tela/achados?achado=${NOVO_ACHADO}`]: { corpo: {
      ...achadosSemFotoFixture,
      selecionado: { ...achadosSemFotoFixture.selecionado!, identificador: NOVO_ACHADO },
    } },
    '/rpc/achado_registrar': { corpo: { resultado: { id: NOVO_ACHADO } } },
    [`/midia?ativo=achado&registro=${NOVO_ACHADO}&compressao=lt1`]:
      { codigo: 503, corpo: { erro: 'storage fora do ar' } },
  })

  await irParaAchados()
  tocar('Registrar achado')
  preencherORegistro(await tela.findByRole('form', { name: 'Registrar achado' }))
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Guardar' })).toBeEnabled())
  tocar('Guardar')

  await achar(pedidos, (c) => c.startsWith('/midia?'))
  // O achado existe: não há caminho de volta pro formulário. A foto não se
  // perdeu: está na fila do tablet (ADR 0072), e sobe sozinha.
  esperar(await tela.findByRole('alert')).toHaveTextContent('ficou guardada no tablet')
  esperar(tela.getByLabelText('Anexar foto')).toBeInTheDocument()
  esperar(await tela.findByRole('button', { name: '1 foto esperando para subir' })).toBeInTheDocument()
  esperar(pedidos.filter((p) => p.caminho === '/rpc/achado_registrar')).toHaveLength(1)
})

// ---------------------------------------------- as duas saídas do achado
// O formulário de saída é RECORTE (ADR 0054 §6): tocar em "Entregar" pede
// `?saida=entregar` ao servidor, e o que volta é o esqueleto — o aviso e quem
// assina. O que o dedo escreve é sobreposto aqui, como o rascunho do registro.
testar('entregar: o formulário vem do servidor, e o Confirmar manda versão e nome', async () => {
  const id = achadosFixture.achados[0].identificador
  const detalhe = achadosEntregaVaziaFixture.selecionado!
  const pedidos = servidorDosAchados({
    [`/tela/achados?achado=${id}`]: { corpo: achadosDetalheFixture },
    [`/tela/achados?achado=${id}&saida=entregar`]: { corpo: achadosEntregaVaziaFixture },
    '/rpc/achado_entregar': { corpo: { resultado: { id } } },
  })

  await irParaAchados()
  const item = achadosFixture.achados[0]
  disparar.click(await tela.findByRole('button', { name: `Abrir ${item.descricao}, ${item.codigo}` }))
  disparar.click(await tela.findByRole('button', { name: 'Entregar' }))

  // O esqueleto é do servidor: a tela não inventa o aviso nem quem assina.
  const formulario = await tela.findByRole('form', { name: 'Entrega do achado' })
  esperar(dentroDe(formulario).getByText(detalhe.entrega!.aviso)).toBeInTheDocument()
  // Sem o nome de quem retirou não há o que confirmar (ADR 0054 §4).
  esperar(dentroDe(formulario).getByRole('button', { name: 'Confirmar entrega' })).toBeDisabled()

  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'Entregue para quem' }), { target: { value: '  Renata Alves ' } })
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Confirmar entrega' })).toBeEnabled())
  tocar('Confirmar entrega')

  const chamada = await achar(pedidos, '/rpc/achado_entregar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    achado_id: id,
    // A versão é a do detalhe recém-lido: ela sobe quando a foto entra (0055).
    versao: detalhe.versao,
    retirado_por: 'Renata Alves',
  })
  // Passou: o formulário fecha e o detalhe fica, porque é o histórico dele que
  // confirma o gesto.
  await aguardar(() => esperar(tela.queryByRole('form', { name: 'Entrega do achado' })).toBeNull())
})

testar('doar: o destino vai na RPC, e a recusa aparece dentro do formulário', async () => {
  const id = achadosFixture.achados[0].identificador
  const pedidos = servidorDosAchados({
    [`/tela/achados?achado=${id}`]: { corpo: achadosDetalheFixture },
    [`/tela/achados?achado=${id}&saida=doar`]: { corpo: achadosDoacaoVaziaFixture },
    '/rpc/achado_doar': { codigo: 400, corpo: { erro: 'este achado ja foi doado', code: 'LT002' } },
  })

  await irParaAchados()
  const item = achadosFixture.achados[0]
  disparar.click(await tela.findByRole('button', { name: `Abrir ${item.descricao}, ${item.codigo}` }))
  disparar.click(await tela.findByRole('button', { name: 'Doar' }))

  const formulario = await tela.findByRole('form', { name: 'Doação do achado' })
  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'Destino da doação' }), { target: { value: 'Bazar da Paróquia' } })
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Confirmar doação' })).toBeEnabled())
  tocar('Confirmar doação')

  const chamada = await achar(pedidos, '/rpc/achado_doar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    achado_id: id, versao: achadosDoacaoVaziaFixture.selecionado!.versao, destino: 'Bazar da Paróquia',
  })
  // A recusa é lida DENTRO do formulário, que continua aberto: fora dele não
  // haveria onde a mensagem encostar no gesto que a causou.
  esperar(await tela.findByRole('alert')).toHaveTextContent('Este achado já saiu')
  esperar(tela.getByRole('form', { name: 'Doação do achado' })).toBeInTheDocument()
})

// ----------------------------------- procurar o dono pelo ManyChat (ADR 0075)
async function abrirOAchadoComFoto() {
  const selecionado = achadosCompartilharFixture.selecionado!
  const pedidos = servidorDosAchados({ [`/tela/achados?achado=${selecionado.identificador}`]: { corpo: achadosCompartilharFixture } })
  await irParaAchados()
  const item = achadosFixture.achados[0]
  disparar.click(await tela.findByRole('button', { name: `Abrir ${item.descricao}, ${item.codigo}` }))
  await tela.findByRole('button', { name: 'Copiar mensagem' })
  return { selecionado, pedidos }
}

testar('"Copiar mensagem" põe o texto do servidor na área de transferência, sem escrever nada', async () => {
  const writeText = simulacao.fn(async () => {})
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

  const { selecionado, pedidos } = await abrirOAchadoComFoto()
  const antes = pedidos.length
  tocar('Copiar mensagem')

  const secao = await tela.findByRole('status', { name: 'Mensagem para o cliente' })
  esperar(writeText).toHaveBeenCalledWith(selecionado.compartilhar!.texto)
  esperar(dentroDe(secao).getByRole('heading')).toHaveTextContent('Mensagem copiada')
  // Procurar o dono não escreve nada: nenhuma RPC sai, e a tela não é relida.
  esperar(pedidos).toHaveLength(antes)
})

testar('sem área de transferência, o texto do achado fica à vista para copiar à mão', async () => {
  simulacao.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } })

  const { selecionado } = await abrirOAchadoComFoto()
  tocar('Copiar mensagem')

  const secao = await tela.findByRole('status', { name: 'Mensagem para o cliente' })
  esperar(dentroDe(secao).getByRole('heading')).toHaveTextContent('Copie a mensagem')
  esperar(dentroDe(secao).getByLabelText('Mensagem')).toHaveValue(selecionado.compartilhar!.texto)
})

testar('"Baixar foto" baixa o mesmo endereço da foto do detalhe', async () => {
  const { selecionado } = await abrirOAchadoComFoto()
  const baixar = tela.getByRole('link', { name: 'Baixar foto' })
  esperar(baixar).toHaveAttribute('href', selecionado.foto)
  esperar(baixar).toHaveAttribute('download')
})

testar('"Anexar foto" no detalhe sobe a foto e relê a tela', async () => {
  simularCamera()
  const id = achadosSemFotoFixture.selecionado!.identificador
  const pedidos = servidorDosAchados({
    [`/tela/achados?achado=${id}`]: { corpo: achadosSemFotoFixture },
    [`/midia?ativo=achado&registro=${id}&compressao=lt1`]:
      { codigo: 201, corpo: { midia_id: 'm-9', endereco: '/midia/m-9?t=assinado', bytes: 1000 } },
  })

  await irParaAchados()
  const item = achadosFixture.achados[0]
  disparar.click(await tela.findByRole('button', { name: `Abrir ${item.descricao}, ${item.codigo}` }))
  const anexar = await tela.findByLabelText('Anexar foto')
  disparar.change(anexar, { target: { files: [FOTO_DA_CAMERA] } })

  await achar(pedidos, (c) => c.startsWith('/midia?'))
  // A releitura é o que traz o item já em `em_posse`: quem move o estado é a
  // rota de mídia, dentro da mesma transação do anexo (ADR 0051 §7).
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho.startsWith('/tela/achados')).length).toBeGreaterThan(2))
})

// ------------------------------------------- Avisos (ADR 0056 e 0058)
// O formulário é RECORTE (`?escrever=1`), como o registro dos Achados: o
// esqueleto — os públicos e quantas pessoas cada um alcança — é do servidor.
const FORMULARIO_VAZIO = {
  ...avisosEscrevendoFixture.formulario!,
  titulo: '', texto: '',
  publicos: [
    { identificador: 'todos', rotulo: 'Todos', selecionado: true, pessoas: 3 },
    { identificador: 'atendentes', rotulo: 'Atendentes', selecionado: false, pessoas: 2 },
  ],
  pedeConfirmacao: true, urgente: false, aviso: '', podePublicar: false,
}

async function irParaAvisos(rotas: Record<string, Resposta>, lista = avisosFixture) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/avisos?aba=ativos': { corpo: lista },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  tocar('Abrir menu')
  const menu = dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  disparar.click(menu.getByRole('button', { name: /Avisos/ }))
  disparar.click(menu.getByRole('button', { name: 'Ativos' }))
  await tela.findByRole('heading', { name: lista.avisos[0].titulo })
  return pedidos
}

testar('publicar: o formulário vem do servidor, e Publicar manda título, texto, prioridade, público e confirmação', async () => {
  const pedidos = await irParaAvisos({
    '/tela/avisos?escrever=1&aba=ativos': { corpo: { ...avisosFixture, formulario: FORMULARIO_VAZIO } },
    '/rpc/aviso_publicar': { corpo: { resultado: { id: 'a9' } } },
  })

  tocar('Escrever aviso')
  const formulario = await tela.findByRole('form', { name: 'Escrever aviso' })
  // Sem título não há aviso: é a linha que a lista mostra.
  esperar(dentroDe(formulario).getByRole('button', { name: 'Publicar' })).toBeDisabled()
  esperar(formulario).toHaveTextContent('Vai para 3 pessoas (Administradores e Atendentes) e fica em destaque até cada uma confirmar.')

  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'Título' }), { target: { value: '  Domingo abre 11h ' } })
  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'Texto' }), { target: { value: 'Quem abre chega 10h15.' } })
  tocar('Marcar como urgente')
  await aguardar(() => esperar(tela.getByRole('button', { name: 'Publicar' })).toBeEnabled())
  tocar('Publicar')

  const chamada = await achar(pedidos, '/rpc/aviso_publicar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    titulo: 'Domingo abre 11h', texto: 'Quem abre chega 10h15.', prioridade: 'urgente',
    publico: 'todos', pede_confirmacao: true,
  })
  // Passou: o formulário fecha, e a lista relida é que mostra o aviso novo.
  await aguardar(() => esperar(tela.queryByRole('form', { name: 'Escrever aviso' })).toBeNull())
})

testar('publicar só para Atendentes, sem pedir confirmação (ADR 0058)', async () => {
  const pedidos = await irParaAvisos({
    '/tela/avisos?escrever=1&aba=ativos': { corpo: { ...avisosFixture, formulario: FORMULARIO_VAZIO } },
    '/rpc/aviso_publicar': { corpo: { resultado: { id: 'a9' } } },
  })

  tocar('Escrever aviso')
  const formulario = await tela.findByRole('form', { name: 'Escrever aviso' })
  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'Título' }), { target: { value: 'Chegou café novo' } })
  disparar.click(dentroDe(formulario).getByRole('button', { name: 'Atendentes' }))
  disparar.click(dentroDe(formulario).getByRole('button', { name: 'Pedir confirmação de leitura' }))

  await aguardar(() => esperar(dentroDe(formulario).getByRole('button', { name: 'Atendentes' })).toHaveAttribute('aria-pressed', 'true'))
  esperar(dentroDe(formulario).getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false')
  esperar(dentroDe(formulario).getByRole('button', { name: 'Pedir confirmação de leitura' })).toHaveAttribute('aria-pressed', 'false')
  esperar(formulario).toHaveTextContent('Vai para 2 pessoas (só Atendentes) sem pedir confirmação.')
  tocar('Publicar')

  const chamada = await achar(pedidos, '/rpc/aviso_publicar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    titulo: 'Chegou café novo', texto: '', prioridade: 'normal', publico: 'atendentes', pede_confirmacao: false,
  })
})

testar('"Li e entendi" manda o aviso e a versão que a tela leu', async () => {
  const pedidos = await irParaAvisos({ '/rpc/aviso_confirmar': { corpo: { resultado: {} } } }, avisosAtendenteFixture)
  const primeiro = avisosAtendenteFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Li e entendi' }))

  const chamada = await achar(pedidos, '/rpc/aviso_confirmar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({ aviso_id: primeiro.identificador, versao: primeiro.versao })
})

testar('editar (ADR 0069): Salvar só acende com mudança, e manda aviso, versão, título e texto', async () => {
  const pedidos = await irParaAvisos({ '/rpc/aviso_editar': { corpo: { resultado: {} } } })
  const primeiro = avisosFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Editar' }))
  const edicao = await tela.findByRole('form', { name: `Editar ${primeiro.titulo}` })
  esperar(dentroDe(edicao).getByRole('textbox', { name: 'Título' })).toHaveValue(primeiro.titulo)
  // Salvar o mesmo texto zeraria as leituras por nada.
  esperar(dentroDe(edicao).getByRole('button', { name: 'Salvar' })).toBeDisabled()
  disparar.change(dentroDe(edicao).getByRole('textbox', { name: 'Título' }), { target: { value: `  ${primeiro.titulo} ` } })
  esperar(dentroDe(edicao).getByRole('button', { name: 'Salvar' })).toBeDisabled()

  disparar.change(dentroDe(edicao).getByRole('textbox', { name: 'Texto' }), { target: { value: ' Volta dia 28. ' } })
  await aguardar(() => esperar(dentroDe(edicao).getByRole('button', { name: 'Salvar' })).toBeEnabled())
  disparar.click(dentroDe(edicao).getByRole('button', { name: 'Salvar' }))

  const chamada = await achar(pedidos, '/rpc/aviso_editar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    aviso_id: primeiro.identificador, versao: primeiro.versao, titulo: primeiro.titulo, texto: 'Volta dia 28.',
  })
  await aguardar(() => esperar(tela.queryByRole('form', { name: `Editar ${primeiro.titulo}` })).toBeNull())
})

testar('editar recusado mantém o texto no cartão e diz por quê', async () => {
  await irParaAvisos({
    '/rpc/aviso_editar': { codigo: 400, corpo: { erro: 'so quem escreveu o aviso edita', code: 'LT005' } },
  })
  const primeiro = avisosFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Editar' }))
  const edicao = await tela.findByRole('form', { name: `Editar ${primeiro.titulo}` })
  disparar.change(dentroDe(edicao).getByRole('textbox', { name: 'Texto' }), { target: { value: 'Volta dia 28.' } })
  await aguardar(() => esperar(dentroDe(edicao).getByRole('button', { name: 'Salvar' })).toBeEnabled())
  disparar.click(dentroDe(edicao).getByRole('button', { name: 'Salvar' }))

  esperar(await tela.findByRole('alert')).toHaveTextContent('Só quem escreveu o aviso edita')
  esperar(tela.getByRole('form', { name: `Editar ${primeiro.titulo}` })).toBeInTheDocument()
  esperar(tela.getByRole('textbox', { name: 'Texto' })).toHaveValue('Volta dia 28.')
})

testar('arquivar recusado diz por quê, sem sair da tela', async () => {
  const pedidos = await irParaAvisos({
    '/rpc/aviso_arquivar': { codigo: 400, corpo: { erro: 'aviso ja arquivado', code: 'LT002' } },
  })
  const primeiro = avisosFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Arquivar' }))

  const chamada = await achar(pedidos, '/rpc/aviso_arquivar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({ aviso_id: primeiro.identificador, versao: primeiro.versao })
  esperar(await tela.findByRole('alert')).toHaveTextContent('Este aviso já foi arquivado')
  esperar(tela.getByRole('heading', { name: primeiro.titulo })).toBeInTheDocument()
})

// ------------------------------------------------------- Lembretes (ADR 0066)
// A aba sem nada aberto: o quadro Categorias vem sem edição, e o formulário só
// com `?escrever=1`.
const LEMBRETES_LISTA = {
  ...avisosLembretesFixture,
  formularioLembrete: null,
  categorias: {
    ...avisosLembretesFixture.categorias!,
    itens: avisosLembretesFixture.categorias!.itens.map((c) => ({ ...c, edicao: null })),
  },
}
const LEMBRETE_VAZIO = {
  ...avisosLembretesFixture.formularioLembrete!,
  texto: '', data: '', antecedencia: '', aviso: '', podeCriar: false,
  categorias: avisosLembretesFixture.formularioLembrete!.categorias.map((c) => ({ ...c, selecionada: false })),
}

async function irParaLembretes(rotas: Record<string, Resposta>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/avisos?aba=lembretes': { corpo: LEMBRETES_LISTA },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  tocar('Abrir menu')
  const menu = dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
  disparar.click(menu.getByRole('button', { name: /Avisos/ }))
  disparar.click(menu.getByRole('button', { name: 'Lembretes' }))
  await tela.findByRole('region', { name: 'Categorias de lembrete' })
  return pedidos
}

testar('criar lembrete: a categoria traz a antecedência, o Admin troca, e Criar manda o que ficou', async () => {
  const pedidos = await irParaLembretes({
    '/tela/avisos?escrever=1&aba=lembretes': { corpo: { ...LEMBRETES_LISTA, formularioLembrete: LEMBRETE_VAZIO } },
    '/rpc/lembrete_criar': { corpo: { resultado: { id: 'l9' } } },
  })

  tocar('Criar lembrete')
  const formulario = await tela.findByRole('form', { name: 'Criar lembrete' })
  esperar(dentroDe(formulario).getByRole('button', { name: 'Criar' })).toBeDisabled()
  disparar.change(dentroDe(formulario).getByRole('textbox', { name: 'O que lembrar' }), { target: { value: ' Pagar a gráfica ' } })
  disparar.change(dentroDe(formulario).getByLabelText('Data'), { target: { value: '2026-10-05' } })
  disparar.click(dentroDe(formulario).getByRole('button', { name: 'Pagamento de fornecedor' }))

  const antecedencia = dentroDe(formulario).getByRole('textbox', { name: 'Avisar quantos dias antes' })
  await aguardar(() => esperar(antecedencia).toHaveValue('3'))
  esperar(formulario).toHaveTextContent('Aparece para a equipe em 02/10.')
  disparar.change(antecedencia, { target: { value: '5' } })
  await aguardar(() => esperar(formulario).toHaveTextContent('Aparece para a equipe em 30/09.'))
  tocar('Criar')

  const chamada = await achar(pedidos, '/rpc/lembrete_criar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({
    texto: 'Pagar a gráfica', data: '2026-10-05', categoria_id: 'c1', antecedencia: 5,
  })
  await aguardar(() => esperar(tela.queryByRole('form', { name: 'Criar lembrete' })).toBeNull())
})

testar('categoria: criar manda nome e dias; desativar manda a linha com a versão lida', async () => {
  const pedidos = await irParaLembretes({
    '/rpc/categoria_lembrete_criar': { corpo: { resultado: { id: 'c9' } } },
    '/rpc/categoria_lembrete_alterar': { corpo: { resultado: { id: 'c1' } } },
  })
  const quadro = tela.getByRole('region', { name: 'Categorias de lembrete' })
  const nova = dentroDe(quadro).getByRole('group', { name: 'Nova categoria' })
  disparar.change(dentroDe(nova).getByRole('textbox', { name: 'Nome da nova categoria' }), { target: { value: ' Contrato ' } })
  disparar.change(dentroDe(nova).getByRole('textbox', { name: 'Dias antes da nova categoria' }), { target: { value: '2' } })
  await aguardar(() => esperar(dentroDe(nova).getByRole('button', { name: 'Criar categoria' })).toBeEnabled())
  disparar.click(dentroDe(nova).getByRole('button', { name: 'Criar categoria' }))

  const criada = await achar(pedidos, '/rpc/categoria_lembrete_criar')
  esperar(JSON.parse(String(criada.opcoes.body))).toEqual({ nome: 'Contrato', antecedencia: 2 })

  const pagamento = dentroDe(quadro).getByRole('group', { name: 'Ações de Pagamento de fornecedor' })
  disparar.click(dentroDe(pagamento).getByRole('button', { name: 'Desativar' }))
  const alterada = await achar(pedidos, '/rpc/categoria_lembrete_alterar')
  esperar(JSON.parse(String(alterada.opcoes.body))).toEqual({
    categoria_id: 'c1', versao: 1, nome: 'Pagamento de fornecedor', antecedencia: 3, ativo: false,
  })
})

testar('categoria com nome repetido: a recusa diz por quê, e o que foi digitado fica', async () => {
  await irParaLembretes({
    '/rpc/categoria_lembrete_criar': { codigo: 400, corpo: { erro: 'ja existe a categoria Contato', code: 'LT002' } },
  })
  const nova = tela.getByRole('group', { name: 'Nova categoria' })
  disparar.change(dentroDe(nova).getByRole('textbox', { name: 'Nome da nova categoria' }), { target: { value: 'Contato' } })
  disparar.change(dentroDe(nova).getByRole('textbox', { name: 'Dias antes da nova categoria' }), { target: { value: '1' } })
  await aguardar(() => esperar(dentroDe(nova).getByRole('button', { name: 'Criar categoria' })).toBeEnabled())
  disparar.click(dentroDe(nova).getByRole('button', { name: 'Criar categoria' }))

  esperar(await tela.findByRole('alert')).toHaveTextContent('Já existe uma categoria com esse nome.')
  esperar(dentroDe(nova).getByRole('textbox', { name: 'Nome da nova categoria' })).toHaveValue('Contato')
})

testar('"Concluir" manda o lembrete e a versão que a tela leu (ADR 0067)', async () => {
  const pedidos = await irParaLembretes({ '/rpc/lembrete_concluir': { corpo: { resultado: {} } } })
  const primeiro = avisosLembretesFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Concluir' }))

  const chamada = await achar(pedidos, '/rpc/lembrete_concluir')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({ lembrete_id: primeiro.identificador, versao: primeiro.versao })
})

testar('concluir lembrete que o job acabou de marcar Atrasado: a recusa manda ler de novo', async () => {
  await irParaLembretes({
    '/rpc/lembrete_concluir': { codigo: 400, corpo: { erro: 'este registro foi alterado por outra pessoa', code: 'LT001' } },
  })
  const primeiro = avisosLembretesFixture.avisos[0]

  disparar.click(dentroDe(tela.getByRole('group', { name: `Ações de ${primeiro.titulo}` })).getByRole('button', { name: 'Concluir' }))

  esperar(await tela.findByRole('alert')).toHaveTextContent('Este lembrete mudou enquanto você olhava')
})

// ------------------------------------------- Aviso Urgente na navegação (ADR 0070 §2)
const URGENTE = avisosUrgentesFixture[0]

async function entrarComUrgente(rotas: Record<string, Resposta | (() => Resposta)> = {}) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/comanda': { corpo: comandaFixture },
    '/tela/treinamento': { corpo: treinamentoFixture },
    '/tela/sidebar': { corpo: { ...SIDEBAR, avisosUrgentes: [URGENTE] } },
    ...rotas,
  })
  await entrarNaHome()
  return pedidos
}

function irPeloMenu(rotulo: RegExp) {
  tocar('Abrir menu')
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Menu principal' })).getByRole('button', { name: rotulo }))
}

testar('urgente: não abre na Home do PIN; abre na primeira troca de tela', async () => {
  await entrarComUrgente()
  esperar(tela.queryByRole('dialog', { name: 'Aviso urgente' })).toBeNull()

  irPeloMenu(/Comanda/)

  const dialogo = await tela.findByRole('dialog', { name: 'Aviso urgente' })
  esperar(dentroDe(dialogo).getByRole('heading', { name: URGENTE.titulo })).toBeVisible()
  esperar(dialogo).toHaveTextContent(URGENTE.texto)
})

testar('urgente: "Depois" fecha até o fim da sessão, e a próxima troca de tela não reabre', async () => {
  await entrarComUrgente()
  irPeloMenu(/Comanda/)
  disparar.click(await tela.findByRole('button', { name: 'Depois' }))
  esperar(tela.queryByRole('dialog', { name: 'Aviso urgente' })).toBeNull()

  irPeloMenu(/Treinamento/)
  await tela.findByRole('heading', { name: 'Treinamento' })
  esperar(tela.queryByRole('dialog', { name: 'Aviso urgente' })).toBeNull()
})

testar('urgente: "Li e entendi" confirma com a versão lida, e o menu relido fecha o modal', async () => {
  let confirmou = false
  const pedidos = await entrarComUrgente({
    '/tela/sidebar': () => ({ corpo: { ...SIDEBAR, avisosUrgentes: confirmou ? [] : [URGENTE] } }),
    '/rpc/aviso_confirmar': () => {
      confirmou = true
      return { corpo: { resultado: {} } }
    },
  })
  irPeloMenu(/Comanda/)
  const dialogo = await tela.findByRole('dialog', { name: 'Aviso urgente' })

  disparar.click(dentroDe(dialogo).getByRole('button', { name: 'Li e entendi' }))

  const chamada = await achar(pedidos, '/rpc/aviso_confirmar')
  esperar(JSON.parse(String(chamada.opcoes.body))).toEqual({ aviso_id: URGENTE.identificador, versao: URGENTE.versao })
  await aguardar(() => esperar(tela.queryByRole('dialog', { name: 'Aviso urgente' })).toBeNull())
})

testar('urgente: sair zera o "Depois" — quem entra de novo vê o modal na primeira troca', async () => {
  await entrarComUrgente()
  irPeloMenu(/Comanda/)
  disparar.click(await tela.findByRole('button', { name: 'Depois' }))

  tocar('Abrir menu')
  disparar.click(dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))
    .getByRole('button', { name: new RegExp(SIDEBAR.usuario!.nome) }))
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  irPeloMenu(/Comanda/)

  esperar(await tela.findByRole('dialog', { name: 'Aviso urgente' })).toBeVisible()
})

// "Marcar que veio" (ADR 0079): fora do modo de edição, um toque grava.
testar('Escala: marcar que veio grava na hora, com o turno e quem a tela mostrava', async () => {
  const hoje = escalaFixture.dias[0]
  const comVeio = {
    ...escalaFixture,
    dias: [{ ...hoje, turnos: hoje.turnos.map((t) => t.turno !== 'tarde_noite' ? t : {
      ...t, acoes: [{ identificador: 'veio', rotulo: 'marcar que veio', selecionada: false }],
      presenca: { identificador: 't-hoje', colaborador: 'c-thiago', veio: false },
    }) }, ...escalaFixture.dias.slice(1)],
  }
  const pedidos = await abrirAEscala({ '/rpc/escala_presenca_marcar': { corpo: { resultado: true } } }, comVeio)
  disparar.click(turnoDaEscala(hoje.rotulo, 'Tarde/noite').getByRole('button', { name: 'marcar que veio' }))
  esperar(await corpoDa(pedidos, '/rpc/escala_presenca_marcar')).toEqual({
    turno_id: 't-hoje', colaborador_id: 'c-thiago', presente: true,
  })
})

// ------------------------------------------------ Treinamento pelo app (0089)
async function abrirTreinamentoComoAdmin(rotas: Record<string, Resposta | (() => Resposta)>) {
  const pedidos = simularServidor({
    '/tela/entrada': { corpo: ENTRADA },
    '/sessao': { corpo: SESSAO },
    '/tela/home': { corpo: homeFixture },
    '/tela/treinamento': { corpo: treinamentoAdminFixture },
    ...rotas,
  })
  renderizar(<App />)
  disparar.click(await tela.findByRole('button', { name: /Paulo/ }))
  digitar('1122')
  await tela.findByRole('heading', { name: homeFixture.saudacao })
  irPeloMenu(/Treinamento/)
  await tela.findByRole('button', { name: 'Novo tutorial' })
  return pedidos
}

testar('novo tutorial: cria pelo banco e abre o tutorial novo no editor', async () => {
  const pedidos = await abrirTreinamentoComoAdmin({
    '/rpc/tutorial_criar': { corpo: { resultado: { id: 'tut-softbox', versao: 1 } } },
    '/tela/treinamento?tutorial=tut-softbox': { corpo: treinamentoAdminAbertoFixture },
  })

  tocar('Novo tutorial')
  const painel = dentroDe(tela.getByRole('dialog', { name: 'Novo tutorial' }))
  disparar.change(painel.getByLabelText('Título'), { target: { value: 'Como armar o softbox' } })
  disparar.click(painel.getByRole('button', { name: 'Criar e editar' }))

  esperar(await corpoDa(pedidos, '/rpc/tutorial_criar')).toEqual({ categoria_id: 'cat-equipamento', titulo: 'Como armar o softbox' })
  esperar(await tela.findByRole('group', { name: 'Editar tutorial' })).toBeVisible()
})

testar('salvar tutorial manda os blocos como o banco quer (midia_id) e relê', async () => {
  const pedidos = await abrirTreinamentoComoAdmin({
    '/tela/treinamento?tutorial=tut-softbox': { corpo: treinamentoAdminAbertoFixture },
    '/rpc/tutorial_salvar': { corpo: { resultado: { id: 'tut-softbox', versao: 6 } } },
  })
  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  disparar.click(tela.getByRole('button', { name: /Como armar o softbox/ }))
  disparar.click(await tela.findByRole('button', { name: 'Editar' }))
  tocar('Salvar')

  esperar(await corpoDa(pedidos, '/rpc/tutorial_salvar')).toEqual({
    tutorial_id: 'tut-softbox', versao: 5, categoria_id: 'cat-equipamento', titulo: 'Como armar o softbox',
    blocos: [
      { tipo: 'texto', texto: 'Monte o tripé.' },
      { tipo: 'foto', midia_id: 'm-1' },
      { tipo: 'texto', texto: 'Prenda o softbox pela haste.' },
    ],
  })
  await aguardar(() => esperar(pedidos.filter((p) => p.caminho === '/tela/treinamento?tutorial=tut-softbox').length).toBe(2))
})

testar('recusa de versão velha diz que a tela foi atualizada', async () => {
  await abrirTreinamentoComoAdmin({
    '/tela/treinamento?tutorial=tut-softbox': { corpo: treinamentoAdminAbertoFixture },
    '/rpc/tutorial_status_definir': { codigo: 409, corpo: { erro: 'este registro foi alterado por outra pessoa', code: 'LT001' } },
  })
  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  disparar.click(tela.getByRole('button', { name: /Como armar o softbox/ }))
  disparar.click(await tela.findByRole('button', { name: 'Arquivar' }))

  esperar(await tela.findByRole('alert')).toHaveTextContent('alterado em outra tela')
})

// Busca ao digitar filtra no tablet (recarregar a cada letra fecharia o teclado),
// e acha no texto também. Reportar vira a RPC, com o texto aparado.
testar('Treinamento: a busca filtra a cada letra, sem ir ao servidor, e acha no texto', async () => {
  const pedidos = await entrarComUrgente({ '/tela/sidebar': { corpo: SIDEBAR } })
  irPeloMenu(/Treinamento/)
  await tela.findByRole('heading', { name: 'Treinamento' })
  const antes = pedidos.length

  disparar.change(tela.getByLabelText('Buscar'), { target: { value: 'agua' } })
  esperar(tela.getByRole('button', { name: /Receber o cliente/ })).toBeInTheDocument()
  esperar(tela.queryByRole('button', { name: /Como armar o softbox/ })).toBeNull()
  esperar(tela.getByText('água').tagName).toBe('MARK')
  esperar(pedidos.slice(antes).some((p) => p.caminho.startsWith('/tela/treinamento'))).toBe(false)

  disparar.change(tela.getByLabelText('Buscar'), { target: { value: 'refletor' } })
  esperar(tela.getByRole('heading', { name: 'Nada encontrado' })).toBeInTheDocument()
})

// A busca da Comanda vai ao servidor (acha fora do dia), mas o campo não pode
// sair da tela enquanto a lista recarrega: no tablet, isso fecha o teclado.
testar('Comanda: digitar na busca não tira o campo da tela', async () => {
  const pedidos = await entrarComUrgente({
    '/tela/sidebar': { corpo: SIDEBAR },
    '/tela/comanda?busca=a': { corpo: { ...comandaFixture, busca: 'a' } },
    '/tela/comanda?busca=an': { corpo: { ...comandaFixture, busca: 'an' } },
  })
  irPeloMenu(/Comanda/)
  const campo = await tela.findByRole('searchbox')

  disparar.change(campo, { target: { value: 'a' } })
  disparar.change(campo, { target: { value: 'an' } })
  esperar(campo).toBeInTheDocument()
  esperar(campo).toHaveValue('an')

  await aguardar(() => esperar(pedidos.some((p) => p.caminho === '/tela/comanda?busca=an')).toBe(true))
  esperar(campo).toBeInTheDocument()
  esperar(campo).toHaveValue('an')
})

testar('Treinamento: reportar problema chama a RPC com o tutorial e o texto', async () => {
  const pedidos = await entrarComUrgente({
    '/tela/sidebar': { corpo: SIDEBAR },
    '/tela/treinamento?tutorial=tut-softbox': { corpo: treinamentoAbertoFixture },
    '/rpc/tutorial_reportar': { corpo: { resultado: 2 } },
  })
  irPeloMenu(/Treinamento/)
  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  disparar.click(await tela.findByRole('button', { name: /Como armar o softbox/ }))
  disparar.click(await tela.findByRole('button', { name: 'Reportar problema' }))
  disparar.change(tela.getByLabelText('O que está errado neste tutorial?'), { target: { value: '  foto velha  ' } })
  disparar.click(tela.getByRole('button', { name: 'Enviar para a administração' }))

  esperar(await corpoDa(pedidos, '/rpc/tutorial_reportar')).toEqual({ tutorial_id: 'tut-softbox', texto: 'foto velha' })
  esperar(await tela.findByText(/Aviso enviado/)).toBeInTheDocument()
})

// Abrir tutorial relê a tela e remonta o componente: a pasta mora no App.
testar('Treinamento: fechar o tutorial volta para dentro da pasta, não para as pastas', async () => {
  await entrarComUrgente({
    '/tela/sidebar': { corpo: SIDEBAR },
    '/tela/treinamento?tutorial=tut-softbox': { corpo: treinamentoAbertoFixture },
  })
  irPeloMenu(/Treinamento/)
  disparar.click(await tela.findByRole('button', { name: /^Equipamento/ }))
  disparar.click(tela.getByRole('button', { name: /Como armar o softbox/ }))
  disparar.click(await tela.findByRole('button', { name: 'Fechar' }))

  esperar(await tela.findByRole('button', { name: '← Pastas' })).toBeInTheDocument()
  esperar(tela.getByRole('region', { name: 'Equipamento' })).toBeInTheDocument()
})
