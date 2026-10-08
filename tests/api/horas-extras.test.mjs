// GET /tela/horas: a consulta no banco e a montagem do DadosHorasExtras.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_HORAS_EXTRAS, montarHorasExtras } from '../../src/api/telas/horas-extras.mjs';
import { bancoDisponivel, MARCOS, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const linhaExtra = (colaborador, status, extra = '') => `
  ('${colaborador}', app.quarta_recente(),
   (app.quarta_recente() + time '23:00') at time zone 'America/Maceio',
   (app.quarta_recente() + time '23:50') at time zone 'America/Maceio',
   'manual', 50, 60, 2, 50.00, 25.00, '${status}', '${HELENA}'${extra})`;

// Paulo: uma pendente que cruzou a janela, uma paga. Marcos: uma pendente.
// Uma do mes anterior, que nenhum recorte do mes corrente pode trazer.
const SEMEAR = `
insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim, origem,
    minutos_reais, minutos_arredondados, blocos_noturnos, valor, valor_hora_snapshot,
    status, criado_por_id, cruzou_janela) values
  ${linhaExtra(PAULO, 'pendente', ', true')},
  ${linhaExtra(MARCOS, 'pendente', ', false')};

insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim, origem,
    minutos_reais, minutos_arredondados, blocos_noturnos, valor, valor_hora_snapshot,
    status, criado_por_id, pago_por_id, pago_em) values
  ${linhaExtra(PAULO, 'paga', `, '${HELENA}', now()`)};

insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim, origem,
    minutos_reais, minutos_arredondados, blocos_noturnos, valor, valor_hora_snapshot,
    status, criado_por_id) values
  ('${PAULO}', date_trunc('month', app.quarta_recente())::date - 1,
   now() - interval '40 days', now() - interval '40 days' + interval '1 hour',
   'manual', 60, 60, 2, 50.00, 25.00, 'pendente', '${HELENA}');
`;

const rodar = (comoQuem, { status = 'pendente', periodo = 'mes', extra } = {}) => rodarTela({
  consulta: CONSULTA_HORAS_EXTRAS, comoQuem, semear: SEMEAR, extra,
  json: ['registros', 'destinatarios', 'ensaios'],
  parametros: [['text', `'${status}'`], ['text', `'${periodo}'`]],
});

const AGORA = new Date();

test('horas extras: o Admin ve as pendentes de todos no mes, e so ele paga', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(HELENA), AGORA);

  assert.equal(d.registros.length, 2);
  assert.equal(d.totalPeriodo, 'R$ 100,00');
  assert.deepEqual(d.totais.map((t) => [t.colaborador, t.valor, t.detalhe]).sort(),
    [['Marcos', 'R$ 50,00', '1 extra pendente'], ['Paulo', 'R$ 50,00', '1 extra pendente']]);
  assert.deepEqual(d.registros[0].acoes.map((a) => a.identificador), ['pagar', 'cancelar']);

  const paulo = d.registros.find((r) => r.colaborador === 'Paulo');
  assert.deepEqual([paulo.intervalo, paulo.blocos, paulo.valorHora, paulo.origem], ['23:00 – 23:50', '2 blocos', 'R$ 25,00', 'Manual']);
  assert.equal(paulo.avisos[0].destaque, 'atencao');
  // O acrescimo vigente vem do banco, nao de numero escrito no codigo.
  assert.match(d.rodape, /\(R\$ 25,00 por bloco noturno\)/);
});

test('horas extras: o Atendente ve so as dele, sem acao de pagar', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(PAULO), AGORA);
  assert.deepEqual(d.registros.map((r) => r.colaborador), ['Paulo']);
  assert.deepEqual(d.registros[0].acoes, []);
  assert.equal(d.totalPeriodo, 'R$ 50,00');
});

test('horas extras: a aba de pagas traz o historico do pagamento, e o Admin estorna', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(HELENA, { status: 'paga' }), AGORA, 'pagas');
  assert.equal(d.abas.find((a) => a.selecionada).identificador, 'pagas');
  assert.equal(d.registros.length, 1);
  assert.equal(d.registros[0].status, 'Paga');
  assert.match(d.registros[0].historico[1], /^Paga por Helena · \d\d\/\d\d \d\d:\d\d$/);
  // Estornar e a unica saida de uma paga (ADR 0061 §3) — cancelar e so de pendente.
  assert.deepEqual(d.registros[0].acoes.map((a) => a.identificador), ['estornar']);
});

test('horas extras: a paga nao oferece estorno a quem nao e Admin', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(PAULO, { status: 'paga' }), AGORA, 'pagas');
  assert.deepEqual(d.registros[0].acoes, []);
});

test('horas extras: a versao viaja por registro, senao nenhuma escrita tem o que comparar', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(HELENA), AGORA);
  assert.ok(d.registros.every((r) => Number.isInteger(r.versao)));
});

test('horas extras: o Admin lanca por qualquer ativo, com ele proprio primeiro', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(HELENA), AGORA);
  assert.equal(d.destinatarios[0].rotulo, 'Helena');
  assert.equal(d.destinatarios[0].eu, true);
  assert.ok(d.destinatarios.length > 1);
  assert.equal(d.destinatarios.filter((p) => p.eu).length, 1);
});

test('horas extras: quem nao e Admin so lanca para si', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodar(PAULO), AGORA);
  assert.deepEqual(d.destinatarios.map((p) => [p.rotulo, p.eu]), [['Paulo', true]]);
});

test('horas extras: colaborador desativado sai da lista de destinatarios', { skip: semBanco }, () => {
  const d = montarHorasExtras(
    rodar(HELENA, { extra: `update colaborador set ativo = false where id = '${MARCOS}';` }), AGORA);
  assert.ok(!d.destinatarios.some((p) => p.rotulo === 'Marcos'));
});

test('horas extras: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(PAULO, { extra: `update colaborador set ativo = false where id = '${PAULO}';` });
  assert.throws(() => montarHorasExtras(l, AGORA), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// ADR 0083: a manual ligada a um ensaio mostra de onde veio; a sem ensaio mostra
// o motivo como aviso. O formulário recebe os ensaios com o dia de cada um.
const SEMEAR_LIGADAS = `
select app.agendamento_teste('cli-ligada', app.quarta_recente() + time '22:00');
insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim, origem,
    minutos_reais, minutos_arredondados, blocos_noturnos, valor, valor_hora_snapshot,
    status, criado_por_id, agendamento_id, sem_ensaio_motivo) values
  ${linhaExtra(PAULO, 'pendente', ", (select id from agendamento where cliente_id = 'cli-ligada'), null")},
  ${linhaExtra(MARCOS, 'pendente', ", null, 'arrumação do estúdio'")};
`;

test('horas extras: a manual mostra o ensaio ligado, ou o motivo de não ter', { skip: semBanco }, () => {
  const d = montarHorasExtras(rodarTela({
    consulta: CONSULTA_HORAS_EXTRAS, comoQuem: HELENA, semear: SEMEAR_LIGADAS,
    json: ['registros', 'destinatarios', 'ensaios'],
    parametros: [['text', "'pendente'"], ['text', "'mes'"]],
  }), AGORA);

  const paulo = d.registros.find((r) => r.colaborador === 'Paulo');
  assert.equal(paulo.detalhe, 'Ensaio 22:00–23:00 · Cliente cli-ligada · sem comanda');
  assert.deepEqual(paulo.avisos, []);

  const marcos = d.registros.find((r) => r.colaborador === 'Marcos');
  assert.equal(marcos.detalhe, 'Sem ensaio');
  assert.deepEqual(marcos.avisos, [{ texto: 'sem ensaio ligado · motivo: arrumação do estúdio', destaque: 'atencao' }]);

  const ensaio = d.ensaios.find((e) => e.rotulo.includes('cli-ligada'));
  assert.equal(ensaio.rotulo, '22:00–23:00 · Cliente cli-ligada · sem comanda');
  assert.match(ensaio.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([ensaio.inicio, ensaio.fim], ['22:00', '23:00']);
});
