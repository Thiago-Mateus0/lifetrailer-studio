// A montagem do DadosHome (ADR 0042 §2). Sem banco: a consulta é conferida em
// tests/api/consulta.test.mjs; aqui o que se prova é a tradução da linha do banco
// para o que a tela declarou — principalmente a grade da agenda.
//
// ⚠ Os contadores chegam do `pg` como STRING (bigint não cabe em number), e é
// por isso que a linha de exemplo usa string onde a consulta usa count().
import assert from 'node:assert/strict';
import test from 'node:test';

import { montarHome } from '../../src/api/telas/home.mjs';

const AGORA = new Date('2026-08-17T16:35:00Z'); // 13:35 em Maceió, segunda-feira
const config = { local: 'Recepção', dispositivo: 'Tablet 01', versao: '0.9.3' };

// 'HH:MM' de Maceió (UTC-3) em ISO, no dia do AGORA.
const em = (hhmm) => new Date(`2026-08-17T${hhmm}:00-03:00`).toISOString();

const ensaio = (id, estudio, inicio, fim, fimBloqueio, extra = {}) => ({
  id, estudio, inicio: em(inicio), fim: em(fim), fim_bloqueio: em(fimBloqueio),
  cliente: `Cliente ${id}`, servico: 'Ensaio', comanda_status: null, comanda_id: null,
  duracao_nao_tabelada: false, duracao_invalida: false, ...extra,
});

const linha = (extra = {}) => ({
  eu_nome: 'Marcos Souza',
  eu_perfil: 'atendente',
  turno: 'manha',
  expediente_abre: '08:00:00',
  expediente_fecha: '23:00:00',
  comandas_abertas: '1',
  comandas_fechadas_hoje: '2',
  checklist_fase: 'entrada',
  checklist_limite: em('10:00'),
  checklist_total: '12',
  checklist_feitos: '7',
  estoque_zerados: '2',
  estoque_atencao: '3',
  estoque_total: '40',
  avisos_total: '3',
  sinc_ultimo: em('13:34'),
  sinc_pendentes: '0',
  sinc_paradas: '0',
  escala_semana: '6',
  horas_pendentes: '2',
  achados_guardados: '5',
  tutoriais: '9',
  estudios: [{ id: 'acu', nome: 'Acústico' }, { id: 'bra', nome: 'Branco' }, { id: 'luz', nome: 'Luz Natural' }],
  agenda: [
    ensaio('a1', 'acu', '12:30', '14:30', '15:00', { comanda_status: 'aberta', comanda_id: 'cm1' }),
    ensaio('a2', 'bra', '14:00', '16:00', '16:30'),
    ensaio('a3', 'luz', '14:00', '15:00', '15:30'),
    ensaio('a4', 'bra', '16:30', '17:30', '18:00'),
  ],
  checklist_itens: [
    { id: 'c1', nome: 'Espelho', acao: 'limpar', estado: 'nao_marcado' },
    { id: 'c2', nome: 'Piso', acao: 'lavar', estado: 'feito' },
  ],
  avisos: [
    { id: 'v1', texto: 'Led quebrado\nO SK400 está com defeito.', prioridade: 'urgente', criado_em: em('09:57'), autor: 'Helena' },
    { id: 'v2', texto: 'JBL perdida', prioridade: 'normal', criado_em: '2026-08-16T17:57:00Z', autor: 'Helena' },
  ],
  ...extra,
});

test('cabecalho: hora, data, saudacao e iniciais saem do fuso de Maceio', () => {
  const d = montarHome(linha(), AGORA, config);
  assert.equal(d.hora, '13:35');
  assert.equal(d.data, '17 AGO 2026');
  assert.equal(d.saudacao, 'Boa tarde, Marcos');
  assert.equal(d.turno, 'MS');
  assert.equal(d.turnoResumo, 'Turno da manhã · 4 ensaios hoje');
  assert.equal(d.rodape, 'Recepção · Tablet 01 · v0.9.3');
});

test('Admin ve a operacao inteira; atendente sem turno le "Fora de turno"', () => {
  assert.match(montarHome(linha({ eu_perfil: 'administrador' }), AGORA, config).turnoResumo, /^Visão de toda a operação/);
  assert.match(montarHome(linha({ turno: null }), AGORA, config).turnoResumo, /^Fora de turno/);
});

test('agenda: um bloco por ensaio, na coluna do estudio, com fim e arrumacao', () => {
  const { agenda } = montarHome(linha(), AGORA, config);

  assert.deepEqual(agenda.estudios.map((e) => e.nome), ['Acústico', 'Branco', 'Luz Natural']);
  assert.equal(agenda.ensaios.length, 4);
  const branco = agenda.ensaios.find((e) => e.identificador === 'a2');
  assert.deepEqual([branco.estudio, branco.inicio, branco.fim, branco.fimBloqueio], ['bra', '14:00', '16:00', '16:30']);
  assert.equal(agenda.resumo, '4 ensaios · 3 estúdios ocupados');
});

test('agenda: dois ensaios comecando juntos em estudios diferentes ficam os dois', () => {
  const { agenda } = montarHome(linha(), AGORA, config);
  const as14 = agenda.ensaios.filter((e) => e.inicio === '14:00').map((e) => e.estudio);
  assert.deepEqual(as14, ['bra', 'luz']);
});

test('agenda: "agora" durante o ensaio, "em N min" na hora que antecede, nada depois disso', () => {
  const { agenda } = montarHome(linha(), AGORA, config);
  const relogio = Object.fromEntries(agenda.ensaios.map((e) => [e.identificador, e.relogio]));
  assert.deepEqual(relogio, { a1: 'agora', a2: 'em 25 min', a3: 'em 25 min', a4: undefined });
});

test('agenda: sem comanda, e o estado da comanda quando existe', () => {
  const { agenda } = montarHome(linha(), AGORA, config);
  assert.deepEqual(agenda.ensaios[0].comanda,
    { status: 'aberta', rotulo: 'Comanda aberta', identificador: 'cm1', podeAbrir: false });
  assert.deepEqual(agenda.ensaios[1].comanda,
    { status: 'sem_comanda', rotulo: 'Sem comanda', identificador: null, podeAbrir: true });
});

// A cor da Home vira amarelo quando o ensaio acaba com a Comanda por pagar
// (ADR 0081 §4): "acabou" é o fim do ensaio, sem a arrumação.
test('agenda: terminou e o fim do ensaio passado, sem contar a arrumacao', () => {
  const { agenda } = montarHome(linha({ agenda: [
    ensaio('antes', 'e1', '11:00', '12:00', '12:30'),
    ensaio('no_limite', 'e1', '12:35', '13:35', '14:05'),
    ensaio('arrumando', 'e2', '12:00', '13:30', '14:00'),
    ensaio('durante', 'e3', '13:00', '14:00', '14:30'),
  ] }), AGORA, config);
  const terminou = Object.fromEntries(agenda.ensaios.map((e) => [e.identificador, e.terminou]));
  assert.deepEqual(terminou, { antes: true, no_limite: true, arrumando: true, durante: false });
});

test('agenda: Comanda paga chega ao bloco com rotulo proprio', () => {
  const { agenda } = montarHome(linha({ agenda: [
    ensaio('pago', 'e1', '11:00', '12:00', '12:30', { comanda_status: 'paga', comanda_id: 'c1' }),
  ] }), AGORA, config);
  assert.deepEqual([agenda.ensaios[0].comanda.status, agenda.ensaios[0].comanda.rotulo], ['paga', 'Comanda paga']);
});

// "Criar comanda" (#113) é a aresta gerar_manual, e comanda.md:41 a bloqueia com
// duração não tabelada ou inválida: o botão que o banco recusaria não aparece, e
// o rótulo diz por quê — senão o bloco sem botão parece esquecimento.
test('agenda: abrir comanda so sem Comanda e com duracao que deixa gerar', () => {
  const { agenda } = montarHome(linha({
    agenda: [
      ensaio('t', 'acu', '09:00', '10:00', '10:30', { duracao_nao_tabelada: true }),
      ensaio('i', 'bra', '09:00', '10:00', '10:30', { duracao_invalida: true }),
      ensaio('c', 'luz', '09:00', '10:00', '10:30', { comanda_status: 'cancelada', comanda_id: 'cm2' }),
    ],
  }), AGORA, config);
  assert.deepEqual(agenda.ensaios.map((e) => e.comanda), [
    { status: 'sem_comanda', rotulo: 'Sem comanda · duração não tabelada', identificador: null, podeAbrir: false },
    { status: 'sem_comanda', rotulo: 'Sem comanda · duração inválida', identificador: null, podeAbrir: false },
    { status: 'cancelada', rotulo: 'Comanda cancelada', identificador: 'cm2', podeAbrir: false },
  ]);
});

test('grade: vai do expediente, e alarga para caber ensaio fora dele', () => {
  const { abre, fecha, agora } = montarHome(linha(), AGORA, config).agenda;
  assert.deepEqual({ abre, fecha, agora }, { abre: '08:00', fecha: '23:00', agora: '13:35' });

  const cedo = montarHome(linha({ agenda: [ensaio('x', 'acu', '06:30', '07:30', '07:45')] }), AGORA, config).agenda;
  assert.equal(cedo.abre, '06:00', 'hora cheia antes do primeiro ensaio');
});

test('grade: domingo sem expediente se ajusta aos ensaios, e agora fora dela e nulo', () => {
  const d = montarHome(linha({
    expediente_abre: null, expediente_fecha: null,
    agenda: [ensaio('x', 'acu', '15:00', '17:00', '17:20')],
  }), AGORA, config).agenda;
  assert.deepEqual([d.abre, d.fecha], ['08:00', '18:00']);

  const noite = montarHome(linha(), new Date('2026-08-18T02:30:00Z'), config).agenda; // 23:30
  assert.equal(noite.agora, null);
});

test('grade: arrumacao que passa da meia-noite fecha a grade no fim do dia', () => {
  const d = montarHome(linha({
    agenda: [ensaio('x', 'acu', '22:00', '23:30', '00:15')],
  }), AGORA, config).agenda;
  assert.equal(d.fecha, '24:00');
});

test('dia sem ensaio diz isso no resumo', () => {
  assert.equal(montarHome(linha({ agenda: [] }), AGORA, config).agenda.resumo, 'Nenhum ensaio hoje');
});

test('avisos: titulo e a primeira linha, e hoje/ontem na meta', () => {
  const { avisos } = montarHome(linha(), AGORA, config);
  assert.equal(avisos.contador, '3');
  assert.deepEqual(avisos.itens[0], {
    identificador: 'v1', titulo: 'Led quebrado', texto: 'O SK400 está com defeito.',
    meta: 'Helena · hoje 09:57', urgente: true,
  });
  assert.equal(avisos.itens[1].meta, 'Helena · ontem 14:57');
  assert.equal(avisos.itens[1].texto, '');
});

test('checklist: progresso com limite, e item com a acao', () => {
  const { checklist } = montarHome(linha(), AGORA, config);
  assert.equal(checklist.titulo, 'Checklist de entrada');
  assert.equal(checklist.progresso, '7 de 12 itens · limite 10:00');
  assert.equal(checklist.percentual, '58%');
  assert.equal(checklist.criticidade, 'urgente');
  assert.deepEqual(checklist.itens.map((i) => [i.texto, i.marcado]), [['Espelho · limpar', false], ['Piso · lavar', true]]);
});

test('checklist: sem checklist_dia a lateral recebe nulo; catalogo vazio se anuncia', () => {
  assert.equal(montarHome(linha({ checklist_fase: null }), AGORA, config).checklist, null);
  const vazio = montarHome(linha({ checklist_total: '0', checklist_feitos: '0', checklist_itens: [] }), AGORA, config).checklist;
  assert.equal(vazio.progresso, 'Catálogo não configurado');
});

test('estoque: zerado e urgente, ultima unidade e atencao, nada em falta e normal', () => {
  assert.deepEqual(montarHome(linha(), AGORA, config).estoque, { resumo: '2 zerados · 3 na última unidade', criticidade: 'urgente' });
  assert.equal(montarHome(linha({ estoque_zerados: '0' }), AGORA, config).estoque.criticidade, 'atencao');
  assert.deepEqual(montarHome(linha({ estoque_zerados: '0', estoque_atencao: '0' }), AGORA, config).estoque,
    { resumo: 'nada em falta', criticidade: 'normal' });
  assert.equal(montarHome(linha({ estoque_total: '0' }), AGORA, config).estoque, null);
});

test('o badge de horas extras so existe quando ha o que resolver', () => {
  const horas = (l) => montarHome(l, AGORA, config).consultas.find((c) => c.identificador === 'horas');
  assert.equal(horas(linha()).destaque, '2');
  assert.equal(horas(linha({ horas_pendentes: '0' })).destaque, undefined);
});

test('a sincronizacao le o estado da fila, nao um "faz N minutos"', () => {
  assert.equal(montarHome(linha({ sinc_paradas: '1' }), AGORA, config).sincronizacao.rotulo, 'bandeja travada');
  assert.equal(montarHome(linha({ sinc_pendentes: '3' }), AGORA, config).sincronizacao.rotulo, 'processando');
  assert.deepEqual(montarHome(linha({ sinc_ultimo: null }), AGORA, config).sincronizacao, { rotulo: 'sem eventos', hora: '--:--' });
});

test('claim de colaborador que nao esta mais ativo nao monta a tela', () => {
  assert.throws(() => montarHome(linha({ eu_nome: null }), AGORA, config), (e) => e.code === 'LT_SEM_COLABORADOR');
});
