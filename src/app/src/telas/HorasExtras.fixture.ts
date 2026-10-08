import type { DadosHorasExtras, HoraExtraApresentada } from './HorasExtras'

// Valores de exemplo extraídos de data/acrescimo-noturno.csv e data/precos.csv
// (linhas de 10/08/2026). HorasExtras.test.tsx relê os CSVs e confere cada valor.
// Strings prontas: não há resolução de vigência, posse ou bonificação.
const valoresPorBlocos: Record<number, string> = { 0: 'R$ 0,00', 1: 'R$ 25,00', 2: 'R$ 50,00', 4: 'R$ 100,00', 6: 'R$ 150,00' }
const precoEnsaio = 'R$ 97,00'
const acoesPendentes: HoraExtraApresentada['acoes'] = [
  { identificador: 'pagar', rotulo: 'Marcar paga', principal: true },
  { identificador: 'cancelar', rotulo: 'Cancelar' },
]
const exemplos = [
  { identificador: 'he-1045', data: '16/08 · domingo', intervalo: '09:00 – 12:00', colaborador: 'Thiago', origem: 'Sistema', detalhe: 'Comanda #1045 · domingo é extra desde o início do ensaio', blocos: 6, aviso: 'intervalo descoberto 14:10 – 15:40 · lançar manual' },
  { identificador: 'he-1042', data: '15/08', intervalo: '23:00 – 00:45', colaborador: 'Thiago', origem: 'Sistema', detalhe: 'Comanda #1042 · fechado por Paulo', blocos: 4, aviso: 'cruzou janela de posse · conferir com a administração' },
  { identificador: 'he-1039', data: '14/08', intervalo: '23:00 – 23:50', colaborador: 'Marcos', origem: 'Sistema', detalhe: 'Comanda #1039', blocos: 2, aviso: 'turno sem colaborador na escala · destinatário informado pelo fechamento' },
  { identificador: 'he-1015b', data: '13/08', intervalo: '23:00 – 00:55', colaborador: 'Thiago', origem: 'Sistema', detalhe: 'Comanda #1015 · recriada no refechamento', blocos: 4, aviso: 'substitui he-1015a, cancelada · os dois foram notificados' },
  { identificador: 'he-m12', data: '12/08', intervalo: '06:30 – 07:00', colaborador: 'Paulo', origem: 'Manual', detalhe: 'Montagem do cenário antes do ensaio', blocos: 1, aviso: 'fora da escala do dia · lançamento validado com alerta' },
]
const registros: HoraExtraApresentada[] = exemplos.map((exemplo) => ({
  ...exemplo, versao: 1, blocos: `${exemplo.blocos} ${exemplo.blocos === 1 ? 'bloco' : 'blocos'}`,
  valor: valoresPorBlocos[exemplo.blocos], valorHora: valoresPorBlocos[1], acrescimoNoturno: valoresPorBlocos[exemplo.blocos],
  status: 'Pendente', destaque: 'pendente', acoes: acoesPendentes,
  avisos: [{ texto: exemplo.aviso, destaque: 'atencao' }], historicoAberto: false,
  historico: [exemplo.origem === 'Manual' ? 'Lançada por Paulo · 12/08 07:05' : `Criada pelo sistema no fechamento · ${exemplo.data}`],
}))
registros[2].referencia = { descricao: 'Ensaio Acústico · 60 min · preço base', precoEnsaio }

export const horasExtrasFixture: DadosHorasExtras = {
  hora: '09:40', data: '17 AGO 2026', turno: 'HA', podeLancar: true,
  // Admin: a equipe ativa inteira, ele primeiro (ADR 0061 §2).
  destinatarios: [
    { identificador: 'Helena', rotulo: 'Helena', eu: true },
    { identificador: 'Marcos', rotulo: 'Marcos', eu: false },
    { identificador: 'Paulo', rotulo: 'Paulo', eu: false },
    { identificador: 'Thiago', rotulo: 'Thiago', eu: false },
  ],
  ensaios: [
    { identificador: 'ag-1042', data: '2026-08-17', rotulo: '22:00–23:00 · Ana Souza · Comanda #1042', inicio: '22:00', fim: '23:00' },
    { identificador: 'ag-1040', data: '2026-08-16', rotulo: '22:30–00:30 · Bruno Lima · sem comanda', inicio: '22:30', fim: '00:30' },
  ],
  subtitulo: 'Criadas no fechamento da comanda ou lançadas à mão. Pagar e cancelar são ações suas.',
  abas: [{ identificador: 'pendentes', rotulo: 'Pendentes', selecionada: true }, { identificador: 'pagas', rotulo: 'Pagas', selecionada: false }, { identificador: 'canceladas', rotulo: 'Canceladas', selecionada: false }],
  periodos: [{ identificador: 'mes', rotulo: 'Agosto', selecionado: true }, { identificador: 'q1', rotulo: '1 – 15 ago', selecionado: false }, { identificador: 'q2', rotulo: '16 – 31 ago', selecionado: false }],
  totalPeriodo: 'R$ 425,00',
  totais: [
    { colaborador: 'Marcos', valor: 'R$ 50,00', detalhe: '1 extra pendente' },
    { colaborador: 'Thiago', valor: 'R$ 350,00', detalhe: '3 extras pendentes' },
    { colaborador: 'Paulo', valor: 'R$ 25,00', detalhe: '1 extra pendente' },
  ],
  registros, vazioTitulo: 'Nada pendente', vazioDescricao: 'Você não tem hora extra esperando pagamento.',
  rodape: `O valor é cópia do acréscimo da comanda (${valoresPorBlocos[1]} por bloco noturno) e nunca é recalculado. Refechamento cancela e cria nova, notificando as pessoas envolvidas.`,
}
export const horasExtrasVazioFixture: DadosHorasExtras = { ...horasExtrasFixture, registros: [], totais: [], totalPeriodo: valoresPorBlocos[0] }
export const horasExtrasHistoricoFixture: DadosHorasExtras = { ...horasExtrasFixture, registros: registros.map((extra) => ({ ...extra, historicoAberto: true })) }
export const horasExtrasLancamentoFixture: DadosHorasExtras = {
  ...horasExtrasFixture,
  lancamento: { data: '2026-08-17', inicio: '07:00', fim: '07:30', destinatarios: ['Marcos', 'Thiago', 'Paulo'].map((nome) => ({ identificador: nome, rotulo: nome, selecionado: nome === 'Paulo' })), ensaios: [{ identificador: 'ag-1042', rotulo: '22:00–23:00 · Ana Souza · Comanda #1042', selecionado: true }], nenhumPerto: false, outros: { aberto: false, busca: '', ensaios: [], restantes: 0, semResultado: false }, semEnsaio: false, motivo: '', aviso: 'Vale blocos de 30 minutos começados, ao acréscimo noturno vigente na data. Vai para Paulo, que é avisado.', podeEnviar: true },
}
export const horasExtrasLancamentoVazioFixture: DadosHorasExtras = { ...horasExtrasLancamentoFixture, lancamento: { ...horasExtrasLancamentoFixture.lancamento!, data: '', inicio: '', fim: '', ensaios: [], aviso: 'Preencha data, início e fim.', podeEnviar: false } }
export const horasExtrasCancelamentoFixture: DadosHorasExtras = { ...horasExtrasFixture, registros: [{ ...registros[0], cancelamento: { motivo: 'Lançamento duplicado', podeConfirmar: true } }, ...registros.slice(1)] }
export const horasExtrasCancelamentoVazioFixture: DadosHorasExtras = { ...horasExtrasFixture, registros: [{ ...registros[0], cancelamento: { motivo: '', erro: 'Escreva o motivo antes de cancelar.', podeConfirmar: false } }, ...registros.slice(1)] }
export const horasExtrasPagasFixture: DadosHorasExtras = {
  ...horasExtrasFixture, abas: horasExtrasFixture.abas.map((aba) => ({ ...aba, selecionada: aba.identificador === 'pagas' })),
  registros: [{ ...registros[4], identificador: 'he-1021', data: '10/08', origem: 'Sistema', intervalo: '23:00 – 23:40', detalhe: 'Comanda #1021', status: 'Paga', destaque: 'paga', avisos: [], acoes: [{ identificador: 'estornar', rotulo: 'Estornar' }], historico: ['Criada pelo sistema · 10/08 23:47', 'Paga por Helena · 12/08 09:12'] }],
}
export const horasExtrasCanceladasFixture: DadosHorasExtras = {
  ...horasExtrasFixture, abas: horasExtrasFixture.abas.map((aba) => ({ ...aba, selecionada: aba.identificador === 'canceladas' })),
  registros: [{ ...registros[4], identificador: 'he-1015a', data: '13/08', colaborador: 'Thiago', origem: 'Sistema', intervalo: '23:00 – 23:20', detalhe: 'Comanda #1015 · substituída no refechamento', status: 'Cancelada', destaque: 'cancelada', avisos: [], acoes: [], historico: ['Cancelada pelo sistema · 14/08 10:22 · motivo: refechamento da comanda'] }],
}
export const horasExtrasAtendenteFixture: DadosHorasExtras = {
  ...horasExtrasFixture, turno: 'TH', subtitulo: 'Suas horas extras. A Helena paga por fora e marca cada uma individualmente.',
  totalPeriodo: horasExtrasFixture.totais[1].valor, totais: [horasExtrasFixture.totais[1]],
  registros: registros.filter((extra) => extra.colaborador === 'Thiago').map((extra) => ({ ...extra, acoes: [] })),
}
