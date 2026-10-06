// O PDF do envio da Comanda (ADR 0011 §8, conteúdo do ADR 0027 §4), montado no
// navegador da Jana, que o envia pelo ManyChat (ADR 0073 §2). A forma copia a
// comanda de papel do estúdio (issue #161): campos arredondados dentro de uma
// moldura, Nº em vermelho no canto. Títulos e rótulos em Oswald, a mesma letra
// condensada do "STUDIO" da logo; texto e valores em Barlow Semi Condensed.
// Cores dos tokens (docs/design/tokens.md).
//
// Só formata o que a tela recebeu. Valor nenhum é somado aqui — o total é o
// que o banco congelou no fechamento, e as linhas por bloco vêm prontas da
// montagem da tela.

import { jsPDF } from 'jspdf'
import { autoTable, type CellHookData } from 'jspdf-autotable'

import oswaldMedio from './fontes/Oswald-Medium.ttf?inline'
import oswaldNegrito from './fontes/Oswald-Bold.ttf?inline'
import barlowRegular from './fontes/BarlowSemiCondensed-Regular.ttf?inline'
import barlowNegrito from './fontes/BarlowSemiCondensed-SemiBold.ttf?inline'
import logo from './imagens/logo-comanda.png?inline'
import estudioCsv from '../../../data/estudio.csv?raw'
import type { DetalheComanda } from './telas/Comanda'

const ESTUDIO = 'Lifetrailer Studio'
// Família e espessura de cada papel. `TITULO` e `ROTULO` só levam letras fixas
// e o Nº; tudo que vem do banco sai em `TEXTO` ou `VALOR`.
export const FONTES = {
  TITULO: ['Oswald', 'bold'],
  ROTULO: ['Oswald', 'normal'],
  TEXTO: ['Barlow', 'normal'],
  VALOR: ['Barlow', 'bold'],
} as const
type Papel = keyof typeof FONTES

// Medidas em mm, sobre A4 retrato (210 × 297).
const MOLDURA = 10
const ESQUERDA = 18
const DIREITA = 192
const ALTURA_CAMPO = 9
const PASSO_CAMPO = 11 // de um campo do topo ao seguinte
const ALTURA_LINHA = 9.5 // linha de extra e de total, com o respiro
const COLUNA_VALOR = 34
const PAUTA = 8
// Espaço do cabeçalho: o que continua na página seguinte começa abaixo dele.
const TOPO = 44
const BASE = 264 // acima do Pix e do rodapé
// A de papel tem oito linhas de extras; menos que isso fica em branco, igual.
const LINHAS_DE_EXTRAS = 8
// Rótulo em caixa alta, espaçado.
const ESPACO_ROTULO = 0.4

const TINTA = [15, 23, 42] as const
const SECUNDARIO = [71, 85, 105] as const
const CAMPO_FUNDO = [241, 245, 249] as const
const BORDA = [203, 213, 225] as const
const PAUTA_COR = [148, 163, 184] as const
const VERMELHO = [220, 38, 38] as const

const quando = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Maceio', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

// '21 SET 2026, 11:20' — o formato de data da tela (formato.mjs).
function dataEHora(instante: Date): string {
  const p = Object.fromEntries(quando.formatToParts(instante).map((parte) => [parte.type, parte.value]))
  return `${p.day} ${p.month.replace('.', '').toUpperCase()} ${p.year}, ${p.hour}:${p.minute}`
}

export type DadosDoEstudio = { razaoSocial: string; cnpj: string; chavePix: string }

// Mesma regra de celulasDe em src/db/carga.mjs, que é backend e não entra no
// bundle: aspas agrupam, `""` é uma aspa. A razão social da casa tem vírgula.
function celulasDe(linha: string): string[] {
  const celulas: string[] = []
  let atual = ''
  let entreAspas = false
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i]
    if (entreAspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i += 1 }
      else if (ch === '"') entreAspas = false
      else atual += ch
    } else if (ch === '"') entreAspas = true
    else if (ch === ',') { celulas.push(atual); atual = '' }
    else atual += ch
  }
  celulas.push(atual)
  return celulas
}

// data/estudio.csv (ADR 0064): cabeçalho e, quando preenchido, uma linha. Vai
// no bundle, não pela API — o PDF sai com o tablet offline.
export function lerEstudioCsv(texto: string): DadosDoEstudio | null {
  const [, linha] = texto.trim().split(/\r?\n/)
  if (linha === undefined) return null
  const [razaoSocial, cnpj, chavePix] = celulasDe(linha).map((campo) => campo.trim())
  return { razaoSocial, cnpj, chavePix }
}

const DADOS_DO_ESTUDIO = lerEstudioCsv(estudioCsv)

const semCerquilha = (numero: string) => numero.replace(/^#/, '')

// '19:00–20:00' → 'DE 19:00   ÀS 20:00', como o campo de papel.
function deAs(faixa: string): string {
  const [de, as] = faixa.split('–')
  return as === undefined ? faixa : `DE ${de}   ÀS ${as}`
}

export type SecoesDoComprovante = {
  numero: string
  envio: string
  campos: { cliente: string; data: string; estudio: string; agendado: string; praticado: string; atendente: string }
  /** Descrição e valor: o ensaio, um bloco de extensão por linha, os extras grupo a grupo. */
  linhas: string[][]
  /** A última é a que se paga. */
  total: string[][]
  observacoes: string
  /** Chave Pix, razão social e CNPJ; vazio enquanto data/estudio.csv não tiver a linha. */
  pagamento: string
  rodape: string
}

type Enviavel = DetalheComanda & {
  comprovante: NonNullable<DetalheComanda['comprovante']>
  resumo: NonNullable<DetalheComanda['resumo']>
}

function enviavel(detalhe: DetalheComanda): Enviavel {
  if (detalhe.comprovante === null || detalhe.resumo === null) {
    throw new Error(`comanda ${detalhe.identificador} não tem comprovante`)
  }
  return detalhe as Enviavel
}

export function secoesDoComprovante(
  detalhe: DetalheComanda,
  agora: Date,
  estudio: DadosDoEstudio | null = DADOS_DO_ESTUDIO,
): SecoesDoComprovante {
  const { comprovante, resumo } = enviavel(detalhe)

  const linhas = [
    ...(detalhe.ensaio === null ? [] : [[`Ensaio · ${detalhe.ensaio.servico}`, detalhe.ensaio.valor]]),
    ...(comprovante.noturnoAgendado === null ? [] : [[
      `Acréscimo noturno · ${comprovante.noturnoAgendado.rotulo}`, comprovante.noturnoAgendado.valor]]),
    ...comprovante.blocos.map((bloco) => [
      `Extensão · bloco das ${bloco.inicio}${bloco.acrescimo === '' ? '' : ` (${bloco.acrescimo})`}`,
      bloco.valor,
    ]),
    ...detalhe.extras.flatMap((grupo) =>
      grupo.linhas.map((extra) => [`${grupo.titulo} · ${extra.nome} × ${extra.quantidade}`, extra.total])),
  ]

  const total = [
    ['Subtotal', resumo.subtotal],
    ...resumo.ajustes.map((ajuste) => [`Ajuste — ${ajuste.motivo}`, ajuste.valor]),
    ...(resumo.totalCorrigido === '' ? [] : [['Total corrigido', resumo.totalCorrigido]]),
    ...(resumo.prePago === '' ? [] : [['Pago antecipado', resumo.prePago]]),
    ['TOTAL A PAGAR', resumo.aPagarAgora],
  ]

  return {
    numero: semCerquilha(detalhe.numero),
    envio: `ENVIO ${comprovante.envio}`,
    campos: {
      cliente: detalhe.cliente,
      data: detalhe.data,
      estudio: detalhe.estudio,
      agendado: deAs(detalhe.ensaio?.agendado ?? detalhe.horario),
      praticado: deAs(detalhe.ensaio?.praticado ?? ''),
      atendente: detalhe.responsavel,
    },
    linhas,
    total,
    observacoes: detalhe.observacoes,
    pagamento: estudio === null ? '' : `PIX ${estudio.chavePix} · ${estudio.razaoSocial} · CNPJ ${estudio.cnpj}`,
    rodape: `Enviado em ${dataEHora(agora)} por ${comprovante.enviadoPor} · versão ${detalhe.versao}`,
  }
}

// `?inline` entrega 'data:font/ttf;base64,…'; o jsPDF quer só o base64.
const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

function comFontes(pdf: jsPDF): jsPDF {
  const arquivos: [string, string, string, string][] = [
    ['Oswald-Medium.ttf', oswaldMedio, ...FONTES.ROTULO],
    ['Oswald-Bold.ttf', oswaldNegrito, ...FONTES.TITULO],
    ['BarlowSemiCondensed-Regular.ttf', barlowRegular, ...FONTES.TEXTO],
    ['BarlowSemiCondensed-SemiBold.ttf', barlowNegrito, ...FONTES.VALOR],
  ]
  for (const [nome, dado, familia, espessura] of arquivos) {
    pdf.addFileToVFS(nome, base64(dado))
    pdf.addFont(nome, familia, espessura)
  }
  return pdf
}

export function montarPdf(detalhe: DetalheComanda, agora: Date): jsPDF {
  const secoes = secoesDoComprovante(detalhe, agora)
  const pdf = comFontes(new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }))
  const largura = pdf.internal.pageSize.getWidth()
  const altura = pdf.internal.pageSize.getHeight()

  const usar = (papel: Papel, tamanho: number) => pdf.setFont(FONTES[papel][0], FONTES[papel][1]).setFontSize(tamanho)

  // O jsPDF alinha sem contar o charSpace: à direita, o texto passaria do x.
  function rotulo(texto: string, x: number, y: number, tamanho = 8.5, alinhar: 'left' | 'right' | 'center' = 'right') {
    const sobra = texto.length * ESPACO_ROTULO
    const ajuste = alinhar === 'right' ? sobra : alinhar === 'center' ? sobra / 2 : 0
    usar('ROTULO', tamanho).setTextColor(...SECUNDARIO).text(texto, x - ajuste, y, { align: alinhar, charSpace: ESPACO_ROTULO })
  }
  const larguraDoRotulo = (texto: string, tamanho = 8.5) =>
    usar('ROTULO', tamanho).getTextWidth(texto) + texto.length * ESPACO_ROTULO

  function titulo(texto: string, x: number, y: number, tamanho = 15) {
    usar('TITULO', tamanho).setTextColor(...TINTA).text(texto, x, y, { charSpace: 0.3 })
  }

  function fundoDeCampo(x: number, y: number, w: number, h: number) {
    pdf.setFillColor(...CAMPO_FUNDO).setDrawColor(...BORDA).setLineWidth(0.25).roundedRect(x, y, w, h, 1.4, 1.4, 'FD')
  }

  function campo(x: number, y: number, w: number, texto: string) {
    fundoDeCampo(x, y, w, ALTURA_CAMPO)
    usar('TEXTO', 11.5).setTextColor(...TINTA).text(texto, x + 3.5, y + 6.1, { maxWidth: w - 7 })
  }

  // A coluna de rótulos cabe o maior deles; os campos começam logo depois.
  const ROTULO = ESQUERDA + Math.max(...['CLIENTE/ RESPONSÁVEL', 'HORÁRIO AGENDADO', 'HORÁRIO PRATICADO'].map((t) => larguraDoRotulo(t)))
  const CAMPO = ROTULO + 3

  function linhaDeCampo(texto: string, y: number, valor: string) {
    rotulo(texto, ROTULO, y + 5.9)
    campo(CAMPO, y, DIREITA - CAMPO, valor)
  }

  // Campo por célula, com respiro entre descrição e valor e entre as linhas —
  // o autotable só sabe pintar a célula inteira.
  function celulaDeCampo({ cell, column }: CellHookData) {
    const recuo = column.index === 1 ? 2 : 0
    fundoDeCampo(cell.x + recuo, cell.y + 0.6, cell.width - recuo, cell.height - 1.2)
  }

  const margem = { top: TOPO, left: ESQUERDA, right: largura - DIREITA, bottom: altura - BASE }
  const estiloDaLinha = {
    font: FONTES.TEXTO[0], fontStyle: FONTES.TEXTO[1], fontSize: 11, textColor: [...TINTA] as [number, number, number],
    minCellHeight: ALTURA_LINHA, valign: 'middle' as const, cellPadding: { left: 3.5, right: 3.5, top: 1, bottom: 1 },
  }
  const colunaDeValor = {
    cellWidth: COLUNA_VALOR, halign: 'right' as const, font: FONTES.VALOR[0], fontStyle: FONTES.VALOR[1],
  }
  const fimDaTabela = () => (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  let y = TOPO
  linhaDeCampo('CLIENTE/ RESPONSÁVEL', y, secoes.campos.cliente)
  y += PASSO_CAMPO
  rotulo('DATA', ROTULO, y + 5.9)
  campo(CAMPO, y, 42, secoes.campos.data)
  const xEstudio = CAMPO + 42 + 6
  rotulo('ESTÚDIO', xEstudio, y + 5.9, 8.5, 'left')
  const xCampoEstudio = xEstudio + larguraDoRotulo('ESTÚDIO') + 3
  campo(xCampoEstudio, y, DIREITA - xCampoEstudio, secoes.campos.estudio)
  y += PASSO_CAMPO
  linhaDeCampo('HORÁRIO AGENDADO', y, secoes.campos.agendado)
  y += PASSO_CAMPO
  linhaDeCampo('HORÁRIO PRATICADO', y, secoes.campos.praticado)
  y += ALTURA_CAMPO + 11

  titulo('EXTRAS', ESQUERDA, y)
  rotulo('HORAS, FUNDOS, EQUIPAMENTOS E BOMBONIERE', ESQUERDA, y + 4.8, 7, 'left')
  rotulo('VALOR', DIREITA - (COLUNA_VALOR - 2) / 2, y + 4.8, 7.5, 'center')
  y += 6.5

  const emBranco = Math.max(0, LINHAS_DE_EXTRAS - secoes.linhas.length)
  autoTable(pdf, {
    startY: y,
    margin: margem,
    body: [...secoes.linhas, ...Array.from({ length: emBranco }, () => ['', ''])],
    theme: 'plain',
    rowPageBreak: 'avoid', // linha cortada na virada vira um campo achatado
    styles: estiloDaLinha,
    columnStyles: { 1: colunaDeValor },
    willDrawCell: celulaDeCampo,
  })

  // O total a pagar é a última linha: valor em branco sobre a tinta.
  const ultima = secoes.total.length - 1
  autoTable(pdf, {
    startY: fimDaTabela() + 1,
    margin: margem,
    body: secoes.total,
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { ...estiloDaLinha, textColor: [...SECUNDARIO] },
    columnStyles: { 0: { halign: 'right' }, 1: { ...colunaDeValor, textColor: [...TINTA] } },
    didParseCell: (dado) => {
      if (dado.row.index !== ultima) return
      dado.cell.styles.minCellHeight = ALTURA_LINHA + 1.5
      dado.cell.styles.font = FONTES.TITULO[0]
      dado.cell.styles.fontStyle = FONTES.TITULO[1]
      dado.cell.styles.textColor = dado.column.index === 1 ? [255, 255, 255] : [...TINTA]
      dado.cell.styles.fontSize = dado.column.index === 1 ? 13 : 11
    },
    willDrawCell: (dado) => {
      if (dado.column.index !== 1) return
      if (dado.row.index === ultima) {
        const { cell } = dado
        pdf.setFillColor(...TINTA).roundedRect(cell.x + 2, cell.y + 0.6, cell.width - 2, cell.height - 1.2, 1.4, 1.4, 'F')
      } else celulaDeCampo(dado)
    },
  })
  y = fimDaTabela() + 8

  // Observações: o texto em cima das pautas, no mínimo as três do papel.
  usar('TEXTO', 11)
  const pautas: string[] = secoes.observacoes === '' ? [] : pdf.splitTextToSize(secoes.observacoes, DIREITA - ESQUERDA - 2)
  const quantasPautas = Math.max(3, pautas.length)
  if (y + 3 + PAUTA * quantasPautas > BASE) {
    pdf.addPage()
    y = TOPO + 6
  }
  titulo('OBSERVAÇÕES', ESQUERDA, y)
  for (let i = 0; i < quantasPautas; i++) {
    const pauta = y + 3 + PAUTA * (i + 1)
    pdf.setDrawColor(...PAUTA_COR).setLineWidth(0.25).line(ESQUERDA, pauta, DIREITA, pauta)
    if (pautas[i] !== undefined) usar('TEXTO', 11).setTextColor(...TINTA).text(pautas[i], ESQUERDA + 1, pauta - 2)
  }
  y += 3 + PAUTA * quantasPautas + 5

  // Atendente no pé da página, como a assinatura no papel; na coluna dos campos.
  if (y + ALTURA_CAMPO > BASE) {
    pdf.addPage()
    y = TOPO
  }
  y = Math.max(y, BASE - ALTURA_CAMPO)
  titulo('ATENDENTE', ESQUERDA, y + 6.4, 13)
  campo(CAMPO, y, 72, secoes.campos.atendente)

  // Moldura, cabeçalho e rodapé em TODA página, depois do conteúdo: Comanda
  // longa passa da primeira, e o sequencial não pode sumir da segunda (ADR 0027 §4).
  const paginas = pdf.getNumberOfPages()
  for (let pagina = 1; pagina <= paginas; pagina++) {
    pdf.setPage(pagina)
    pdf.setDrawColor(...TINTA).setLineWidth(0.5)
      .roundedRect(MOLDURA, MOLDURA, largura - 2 * MOLDURA, altura - 2 * MOLDURA, 5, 5, 'S')

    // Logo, título e Nº na mesma faixa, alinhados pelo meio da logo.
    pdf.addImage(logo, 'PNG', ESQUERDA, 17, 40, (40 * 180) / 530)
    usar('TITULO', 18).setTextColor(...TINTA)
      .text('COMANDA', largura / 2 - ('COMANDA'.length * 1.2) / 2, 27, { align: 'center', charSpace: 1.2 })

    usar('TITULO', 24).setTextColor(...VERMELHO).text(secoes.numero, DIREITA, 27.5, { align: 'right' })
    const larguraDoNumero = pdf.getTextWidth(secoes.numero)
    usar('TITULO', 14).setTextColor(...TINTA).text('Nº', DIREITA - larguraDoNumero - 2, 27.5, { align: 'right' })
    rotulo(secoes.envio, DIREITA, 33, 7.5)
    pdf.setDrawColor(...BORDA).setLineWidth(0.3).line(ESQUERDA, 37, DIREITA, 37)

    if (secoes.pagamento !== '') {
      usar('VALOR', 9).setTextColor(...TINTA)
        .text(secoes.pagamento, largura / 2, altura - MOLDURA - 12, { align: 'center' })
    }
    usar('TEXTO', 8).setTextColor(...SECUNDARIO)
    pdf.text(secoes.rodape, ESQUERDA, altura - MOLDURA - 5)
    if (paginas > 1) pdf.text(`página ${pagina} de ${paginas}`, DIREITA, altura - MOLDURA - 5, { align: 'right' })
  }

  return pdf
}

export function arquivoDoComprovante(detalhe: DetalheComanda, agora: Date): File {
  const { comprovante } = enviavel(detalhe)
  return new File(
    [montarPdf(detalhe, agora).output('blob')],
    `comprovante-${semCerquilha(detalhe.numero)}-envio-${comprovante.envio}.pdf`,
    { type: 'application/pdf' },
  )
}

// O texto que a Jana cola na conversa do cliente (ADR 0073 §2): só o primeiro
// nome e a data (ADR 0027 §5). `link` já é absoluto.
export function mensagemDoComprovante(detalhe: DetalheComanda, link: string): string {
  const { comprovante } = enviavel(detalhe)
  return `Olá, ${comprovante.primeiroNome}! Aqui está o comprovante do seu ensaio no ${ESTUDIO} em ${comprovante.dataDoEnsaio}: ${link}`
}
