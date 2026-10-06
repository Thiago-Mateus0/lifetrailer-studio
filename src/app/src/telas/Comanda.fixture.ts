import type { DadosComanda, DetalheComanda } from './Comanda'

// Exemplo de apresentação; os valores de verdade vêm do banco (data/precos.csv,
// data/bomboniere.csv). Serve para exercitar o desenho, não para conferir conta.
const detalheAberta: DetalheComanda = {
  identificador: 'c-1', numero: 'sem número', status: 'aberta', statusRotulo: 'aberta',
  cliente: 'Renata Alves', estudio: 'Acústico', data: '07 AGO 2026', horario: '09:00–10:00',
  responsavel: 'Marcos', versao: 1,
  assuncao: null,
  responsabilidade: { criadoPor: 'Marcos', origem: 'Manual', responsavelAtual: 'Marcos', assumiuPosse: '' },
  ensaio: { servico: '60 min', agendado: '09:00–10:00', praticado: 'não registrado', valor: 'R$ 97,00' },
  extensao: null,
  extras: [
    {
      identificador: 'bomboniere', titulo: 'Bomboniere', tabela: 'bomboniere',
      contagem: '2 itens', subtotal: 'R$ 13,40',
      linhas: [{ identificador: 'l-1', nome: 'Biscoito', quantidade: '2', precoUnitario: '6,70', total: 'R$ 13,40', podeRemover: true }],
    },
    {
      identificador: 'fundo', titulo: 'Fundos', tabela: 'item_extra',
      contagem: '1 item', subtotal: 'R$ 30,00',
      linhas: [{ identificador: 'l-2', nome: 'Fundo Branco', quantidade: '1', precoUnitario: '30,00', total: 'R$ 30,00', podeRemover: true }],
    },
  ],
  resumo: {
    ensaio: 'R$ 97,00', extensao: '', extras: 'R$ 43,40', subtotal: 'R$ 140,40', prePago: '',
    congelado: false, totalOriginal: 'R$ 140,40', ajustes: [], totalCorrigido: '', aPagarAgora: 'R$ 140,40',
  },
  acoes: [{ identificador: 'fechar', rotulo: 'Fechar comanda', desativada: false, motivo: 'Congela o total, dá baixa no bomboniere e registra a hora extra do turno.' }],
  envios: [], telefoneCliente: '(82) 9••••-0000', cancelamento: null, observacoes: '',
  competenciaTrancada: false,
  lancamento: {
    catalogo: [
      { identificador: 'k-1', nome: 'Biscoito', tipo: 'bomboniere', preco: '6,70' },
      { identificador: 'k-2', nome: 'Fundo Branco', tipo: 'fundo', preco: '30,00' },
    ],
    estudios: [
      { identificador: 'e-2', nome: 'Branco', duracoes: [{ minutos: 60, preco: '107,00' }, { minutos: 90, preco: '150,00' }] },
    ],
    inicioSugerido: '10:00',
    data: '2026-08-07',
    inicioEnsaio: '09:00',
  },
  praticado: { data: '2026-08-07', inicio: '09:00', fim: '10:00' },
  envio: null,
  comprovante: null,
}

// Fechada com extensão noturna: o que o comprovante imprime.
export const detalheFechadaFixture: DetalheComanda = {
  ...detalheAberta,
  identificador: 'c-3', numero: '#12', status: 'fechada', statusRotulo: 'fechada',
  cliente: 'Conceição Araújo', horario: '19:00–20:00',
  ensaio: { servico: '60 min', agendado: '19:00–20:00', praticado: '19:00–21:10', valor: 'R$ 97,00' },
  extensao: { titulo: 'Extensão calculada', detalhe: ['70 min além do agendado'], total: 'R$ 155,50' },
  extras: detalheAberta.extras.map((grupo) => ({
    ...grupo, linhas: grupo.linhas.map((extra) => ({ ...extra, podeRemover: false })),
  })),
  resumo: {
    ensaio: 'R$ 97,00', extensao: 'R$ 155,50', extras: 'R$ 43,40', subtotal: 'R$ 295,90', prePago: '−50,00',
    congelado: true, totalOriginal: 'R$ 295,90', ajustes: [], totalCorrigido: '', aPagarAgora: 'R$ 245,90',
  },
  acoes: [
    { identificador: 'copiar', rotulo: 'Copiar mensagem', desativada: false, motivo: '' },
    { identificador: 'baixar', rotulo: 'Baixar PDF', desativada: false, motivo: '' },
    { identificador: 'enviar', rotulo: 'Enviei', desativada: false, motivo: '' },
  ],
  lancamento: null, praticado: null,
  envio: { telefone: '82999990000' },
  comprovante: {
    envio: 1,
    enviadoPor: 'Marcos',
    blocos: [
      { inicio: '20:00', valor: 'R$ 48,50', acrescimo: '' },
      { inicio: '20:30', valor: 'R$ 48,50', acrescimo: '' },
      { inicio: '21:00', valor: 'R$ 58,50', acrescimo: 'inclui 10,00 noturno' },
    ],
    noturnoAgendado: null,
    primeiroNome: 'Conceição',
    dataDoEnsaio: '07/08/2026',
  },
}

export const comandaFixture: DadosComanda = {
  hora: '08:12', data: '07 AGO 2026', turno: 'EA', perfil: 'atendente',
  perfis: [{ identificador: 'atendente', rotulo: 'Atendente', selecionado: true }],
  sincronizacao: { rotulo: 'sincronizado', criticidade: 'normal' },
  titulo: 'Comandas', abertas: '2', busca: '',
  modos: [
    { identificador: 'ativas', rotulo: 'Ativas', selecionado: true },
    { identificador: 'historico', rotulo: 'Histórico', selecionado: false },
  ],
  filtros: [
    { identificador: 'todas', rotulo: 'todas' }, { identificador: 'aberta', rotulo: 'aberta' },
    { identificador: 'fechada', rotulo: 'fechada' }, { identificador: 'enviada', rotulo: 'enviada' },
    { identificador: 'cancelada', rotulo: 'cancelada' },
  ],
  lista: [
    { identificador: 'c-1', cliente: 'Renata Alves', estudio: 'ACÚSTICO', horario: '09:00–10:00', data: '07 AGO 2026', numero: '', origem: 'manual', status: 'aberta', statusRotulo: 'aberta', responsavel: 'Marcos', total: 'R$ 140,40' },
    { identificador: 'c-2', cliente: 'Marcos Lima', estudio: 'BRANCO', horario: '15:00–16:00', data: '07 AGO 2026', numero: '', origem: 'sistema', status: 'assuncao', statusRotulo: 'aguardando assunção', responsavel: 'Paulo', total: '' },
  ],
  vazio: '',
  selecionada: null,
}

export const comandaDetalheFixture: DadosComanda = { ...comandaFixture, selecionada: detalheAberta }

export const comandaAssuncaoFixture: DadosComanda = {
  ...comandaFixture,
  selecionada: {
    ...detalheAberta,
    identificador: 'c-2', cliente: 'Marcos Lima', responsavel: 'Paulo',
    assuncao: {
      titulo: 'Comanda de outro atendente',
      texto: 'Sem valores, sem bomboniere, sem ação até assumir. A posse foi entregue pelo que a Escala diz — se você está no estúdio agora, assuma.',
      botao: 'Assumir comanda',
    },
    responsabilidade: null, ensaio: null, extras: [], resumo: null, acoes: [],
    lancamento: null, praticado: null, envio: null, comprovante: null,
  },
}

export const comandaTrancadaFixture: DadosComanda = {
  ...comandaFixture,
  selecionada: {
    ...detalheAberta,
    competenciaTrancada: true,
    acoes: [{ identificador: 'fechar', rotulo: 'Fechar comanda', desativada: true, motivo: 'Competência trancada.' }],
  },
}

export const comandaVaziaFixture: DadosComanda = {
  ...comandaFixture, lista: [], abertas: '0', vazio: 'Nenhuma comanda neste recorte.',
}

export const comandaFechadaFixture: DadosComanda = { ...comandaFixture, selecionada: detalheFechadaFixture }
