import type { DadosHome } from './Home'

// Dados de exemplo para apresentação; não são fonte de verdade — os reais vêm do banco.
// Retrato das 13:35 de um dia com três ensaios começando juntos em estúdios diferentes.
export const homeFixture: DadosHome = {
  hora: '13:35', turno: 'EL', data: '17 AGO 2026',
  saudacao: 'Boa tarde, Marcos', turnoResumo: 'Turno da manhã · 6 ensaios hoje',
  sincronizacao: { rotulo: 'sincronizado', hora: '13:34' },
  agenda: {
    resumo: '6 ensaios · 4 estúdios ocupados',
    estudios: [
      { identificador: 'acu', nome: 'Acústico' },
      { identificador: 'bra', nome: 'Branco' },
      { identificador: 'luz', nome: 'Luz Natural' },
      { identificador: 'lof', nome: 'Loft' },
      { identificador: 'qui', nome: 'Quintal' },
    ],
    abre: '08:00', fecha: '23:00', agora: '13:35',
    ensaios: [
      { identificador: 'a1', estudio: 'bra', inicio: '09:00', fim: '10:00', fimBloqueio: '10:30', cliente: 'Davyd Jino', servico: 'Ensaio 1h', terminou: true, comanda: { status: 'enviada', rotulo: 'Comanda enviada', identificador: 'c-1', podeAbrir: false } },
      { identificador: 'a2', estudio: 'acu', inicio: '12:30', fim: '14:30', fimBloqueio: '15:00', cliente: 'Renata Prado', servico: 'Ensaio 2h', relogio: 'agora', terminou: false, comanda: { status: 'aberta', rotulo: 'Comanda aberta', identificador: 'c-2', podeAbrir: false } },
      { identificador: 'a3', estudio: 'bra', inicio: '14:00', fim: '16:00', fimBloqueio: '16:30', cliente: 'Ramon Bonifácio', servico: 'Foto e vídeo 2h', relogio: 'em 25 min', observacao: 'Luz direta', terminou: false, comanda: { status: 'sem_comanda', rotulo: 'Sem comanda', identificador: null, podeAbrir: true } },
      { identificador: 'a4', estudio: 'luz', inicio: '14:00', fim: '15:00', fimBloqueio: '15:30', cliente: 'Layssiane Oliveira', servico: 'Ensaio 1h', relogio: 'em 25 min', terminou: false, comanda: { status: 'sem_comanda', rotulo: 'Sem comanda', identificador: null, podeAbrir: true } },
      { identificador: 'a5', estudio: 'lof', inicio: '14:00', fim: '18:00', fimBloqueio: '18:30', cliente: 'Simples Prev', servico: 'Produção 4h', relogio: 'em 25 min', terminou: false, comanda: { status: 'sem_comanda', rotulo: 'Sem comanda', identificador: null, podeAbrir: true } },
      { identificador: 'a6', estudio: 'bra', inicio: '16:30', fim: '17:30', fimBloqueio: '18:00', cliente: 'Giovanna Rodrigues', servico: 'Ensaio 1h', terminou: false, comanda: { status: 'sem_comanda', rotulo: 'Sem comanda · duração não tabelada', identificador: null, podeAbrir: false } },
    ],
  },
  comandas: { abertas: '1', fechadasHoje: '1' },
  avisos: {
    contador: '3',
    itens: [
      { identificador: 'av1', titulo: 'Led quebrado', texto: 'O LED SK400 está com defeito, não usar até a troca.', meta: 'Helena · hoje 09:57', urgente: true },
      { identificador: 'av2', titulo: 'JBL perdida', texto: 'A caixa JBL não está no armário. Alguém viu?', meta: 'Helena · ontem 14:57', urgente: false },
    ],
  },
  checklist: {
    titulo: 'Checklist de entrada', progresso: '7 de 12 itens · limite 10:00', percentual: '58%', criticidade: 'urgente',
    itens: [
      { identificador: 'c1', versao: 1, texto: 'Espelho do Branco · limpar', marcado: false, podeTratar: true },
      { identificador: 'c2', versao: 1, texto: 'Propé · verificar', marcado: false, podeTratar: true },
      { identificador: 'c3', versao: 1, texto: 'Piso branco · verificar e lavar', marcado: true, podeTratar: true },
    ],
  },
  estoque: { resumo: '2 zerados · 3 na última unidade', criticidade: 'urgente' },
  consultas: [
    { identificador: 'escala', nome: 'Escala', nota: '6 na semana' },
    { identificador: 'horas', nome: 'Horas extras', nota: '2 pendentes', destaque: '2' },
    { identificador: 'achados', nome: 'Achados', nota: '5 guardados' },
    { identificador: 'treinamento', nome: 'Treinamento', nota: '9 tutoriais' },
  ],
  rodape: 'Recepção · Tablet 01 · v0.9.3',
}

export const homeVaziaFixture: DadosHome = {
  ...homeFixture, saudacao: 'Bom dia, Marcos', turnoResumo: 'Nenhum ensaio hoje',
  agenda: { ...homeFixture.agenda, resumo: 'Nenhum ensaio hoje', ensaios: [] },
  avisos: { contador: '0', itens: [] }, checklist: null, estoque: null, consultas: [],
}

