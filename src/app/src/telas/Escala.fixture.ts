import type { DadosEscala, DiaEscala, EdicaoTurno } from './Escala'

// Agenda de exemplo já materializada: não gera escala, alternância ou posse.
// Horários conferidos em data/turnos.csv; nomes e datas são os do mockup.
const diasMaterializados = [
  ['2026-08-17', 'segunda', '17', 'Thiago'], ['2026-08-18', 'terça', '18', 'Paulo'],
  ['2026-08-19', 'quarta', '19', 'Paulo'], ['2026-08-20', 'quinta', '20', 'Paulo'],
  ['2026-08-21', 'sexta', '21', 'Thiago'], ['2026-08-22', 'sábado', '22', 'Paulo'],
  ['2026-08-23', 'domingo', '23', ''],
  ['2026-08-24', 'segunda', '24', 'Paulo'], ['2026-08-25', 'terça', '25', 'Thiago'],
  ['2026-08-26', 'quarta', '26', 'Paulo'], ['2026-08-27', 'quinta', '27', 'Thiago'],
  ['2026-08-28', 'sexta', '28', 'Paulo'], ['2026-08-29', 'sábado', '29', 'Thiago'],
  ['2026-08-30', 'domingo', '30', ''],
  ['2026-08-31', 'segunda', '31', 'Thiago'], ['2026-09-01', 'terça', '01', 'Paulo'],
  ['2026-09-02', 'quarta', '02', 'Thiago'], ['2026-09-03', 'quinta', '03', 'Paulo'],
  ['2026-09-04', 'sexta', '04', 'Thiago'], ['2026-09-05', 'sábado', '05', 'Thiago'],
  ['2026-09-06', 'domingo', '06', ''],
  ['2026-09-07', 'segunda', '07', 'Paulo'], ['2026-09-08', 'terça', '08', 'Thiago'],
  ['2026-09-09', 'quarta', '09', 'Paulo'], ['2026-09-10', 'quinta', '10', 'Thiago'],
  ['2026-09-11', 'sexta', '11', 'Paulo'], ['2026-09-12', 'sábado', '12', 'Thiago'],
  ['2026-09-13', 'domingo', '13', ''],
]
const ID: Record<string, string> = { Marcos: 'c-marcos', Paulo: 'c-paulo', Thiago: 'c-thiago' }
// O que o servidor manda em turno futuro para o rascunho da edição. Hoje não
// leva: é congelado.
const edicao = (data: string, turno: string, tipo: EdicaoTurno['tipo'], titular: string, atual: string | null = titular): EdicaoTurno =>
  ({ identificador: `t-${data}-${turno}`, versao: 1, tipo, atual: atual && ID[atual], titular: ID[titular], titularNome: titular })

const dias: DiaEscala[] = diasMaterializados.map(([data, semana, numero, colaborador]) => ({
  data, rotulo: `${semana}, ${data}`, numero, hoje: data === '2026-08-17',
  turnos: colaborador ? [
    { turno: 'manha', rotulo: 'Manhã', horario: '08–14', colaborador: 'Marcos', destaque: 'padrao', acoes: [],
      ...(data > '2026-08-17' ? { edicao: edicao(data, 'manha', 'padrao', 'Marcos') } : {}) },
    { turno: 'tarde_noite', rotulo: 'Tarde/noite', horario: semana === 'sábado' ? '14–18' : '14–23', colaborador, destaque: 'padrao', acoes: [],
      ...(data > '2026-08-17' ? { edicao: edicao(data, 'tarde_noite', 'padrao', colaborador) } : {}) },
  ] : [],
  ...(!colaborador ? { mensagem: 'domingo extra disponível',
    acao: { identificador: 'assumir', rotulo: 'Assumir · Thiago' },
    alternativa: { identificador: 'outra', rotulo: 'outra pessoa' },
    assumir: { identificador: 'c-thiago', nome: 'Thiago' } } : {}),
}))
dias[0].turnos[0] = { ...dias[0].turnos[0], destaque: 'presente', selo: 'veio' }
dias[0].turnos[1].nota = 'alterado após consumo'
dias[0].acao = { identificador: 'presenca', rotulo: 'Confirmar presença' }
dias[2].turnos[1] = { ...dias[2].turnos[1], destaque: 'troca', selo: 'troca', nota: 'cobre Thiago', edicao: edicao('2026-08-19', 'tarde_noite', 'troca', 'Thiago', 'Paulo') }
dias[4].turnos[0] = { ...dias[4].turnos[0], colaborador: 'Não atribuído', destaque: 'ausencia', selo: 'ausência', nota: 'Marcos ausente', edicao: edicao('2026-08-21', 'manha', 'ausencia', 'Marcos', null) }
dias[19].turnos[1] = { ...dias[19].turnos[1], destaque: 'troca', selo: 'troca', nota: 'cobre Paulo', edicao: edicao('2026-09-05', 'tarde_noite', 'troca', 'Paulo', 'Thiago') }

export const escalaFixture: DadosEscala = {
  hora: '09:40', data: '17 AGO 2026', turno: 'JA',
  subtitulo: 'Dias materializados. Trocas, extras e ausências ficam preservados.',
  visao: 'calendario', podeEditar: true, editando: false, podeConfirmar: false,
  resumo: 'janela de 4 semanas completa · 2 trocas · 1 ausência · 0 extras',
  sugestoes: '4 domingos disponíveis', periodo: '17 ago – 13 set 2026', janela: '4 semanas materializadas',
  diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'], dias,
  legenda: [
    { destaque: 'padrao', rotulo: 'padrão' }, { destaque: 'troca', rotulo: 'troca' },
    { destaque: 'extra', rotulo: 'extra domingo' }, { destaque: 'ausencia', rotulo: 'ausência' },
    { destaque: 'presente', rotulo: 'presença confirmada' },
  ],
  mensagemVazia: 'Nenhuma escala disponível neste período.',
  rodape: 'Passado e hoje ficam congelados. O gerador preserva os dias com troca, extra ou ausência.',
  avisoEdicao: 'Modo de edição: dias passados e hoje estão congelados. Marcar troca escala outra pessoa da equipe. Nada é salvo até confirmar.',
  equipe: [{ identificador: 'c-marcos', nome: 'Marcos' }, { identificador: 'c-paulo', nome: 'Paulo' }, { identificador: 'c-thiago', nome: 'Thiago' }],
  padroes: [
    { turno: 'manha', rotulo: 'Manhã', tipo: 'Fixo', versao: 'v1 · desde 10/08/2026', colaboradores: 'Marcos', dias: 'Segunda a sábado', horario: '08:00 – 14:00', podeRevisar: false },
    { turno: 'tarde_noite', rotulo: 'Tarde/noite', tipo: 'Alternado diário', versao: 'v1 · desde 10/08/2026', colaboradores: 'Paulo · Thiago', dias: 'Segunda a sábado', horario: '14:00 – 23:00 · sábado até 18:00', ancora: '10/08/2026 · Paulo', nota: 'A contagem inclui o domingo. A inversão acontece a cada semana.', podeRevisar: true },
  ],
}
export const escalaVaziaFixture: DadosEscala = { ...escalaFixture, dias: [], padroes: [], resumo: 'Sem escala carregada', sugestoes: '', janela: 'Sem dias materializados', rodape: '' }
export const escalaEdicaoFixture: DadosEscala = {
  ...escalaFixture, editando: true, podeConfirmar: true,
  dias: dias.map((dia) => ({ ...dia, turnos: dia.turnos.map((turno) => ({ ...turno, acoes: dia.hoje ? [] : [
    { identificador: 'troca', rotulo: 'troca', selecionada: turno.destaque === 'troca' },
    { identificador: 'ausencia', rotulo: 'falta', selecionada: turno.destaque === 'ausencia' },
  ] })) })),
}
export const escalaExtraFixture: DadosEscala = {
  ...escalaFixture, resumo: 'janela de 4 semanas completa · 2 trocas · 1 ausência · 1 extra', sugestoes: '3 domingos disponíveis',
  dias: dias.map((dia) => dia.data === '2026-08-23' ? {
    ...dia, mensagem: undefined, acao: { identificador: 'desfazer', rotulo: 'Desfazer' },
    alternativa: undefined, assumir: undefined,
    extra: { identificador: 't-2026-08-23-extra', versao: 1 },
    turnos: [{ turno: 'extra', rotulo: 'Extra domingo', horario: '09:00 – 12:00', colaborador: 'Thiago', destaque: 'extra', selo: 'extra', nota: 'checklist criado', acoes: [] }],
  } : dia),
}
export const escalaPadroesFixture: DadosEscala = { ...escalaFixture, visao: 'padroes' }
export const escalaRevisaoFixture: DadosEscala = {
  ...escalaPadroesFixture,
  revisao: {
    descricao: 'A nova âncora afeta as trocas abaixo. Revise cada uma antes de confirmar.',
    afetadas: [{ identificador: 'troca-19', versao: 1, rotulo: '19/08 · Tarde/noite', registrada: 'registrada: Paulo cobre Thiago', depois: 'com a nova âncora: o titular passa a ser Paulo', acoes: [
      { identificador: 'manter', rotulo: 'Manter a troca', selecionada: false },
      { identificador: 'padrao', rotulo: 'Voltar ao padrão', selecionada: false },
    ] }],
    status: '0 de 1 revisadas', podeConfirmar: false,
    alteracao: {
      turno: 'tarde_noite', versao: 1, colaboradores: ['c-paulo', 'c-thiago'],
      ancoraData: '2026-08-10', ancoraColaborador: 'c-thiago',
    },
  },
}
export const escalaRevisadaFixture: DadosEscala = {
  ...escalaRevisaoFixture,
  revisao: { ...escalaRevisaoFixture.revisao!, afetadas: escalaRevisaoFixture.revisao!.afetadas.map((troca) => ({ ...troca, acoes: troca.acoes.map((acao) => ({ ...acao, selecionada: acao.identificador === 'padrao' })) })), status: '1 de 1 revisadas', podeConfirmar: true },
}
export const escalaAtendenteFixture: DadosEscala = { ...escalaFixture, turno: 'EL', podeEditar: false, padroes: escalaFixture.padroes.map((padrao) => ({ ...padrao, podeRevisar: false })) }
