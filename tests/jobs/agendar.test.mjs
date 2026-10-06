// O agendador: só a decisão de o que agendar e o que desagendar.
//
// A conversão de fuso é do banco (app.cron_utc, tests/db/18_jobs_fundacao.sql).
// Aqui se testa o que o script decide fazer com a diferença entre o registro e
// o que o pg_cron tem hoje — sem banco.
import assert from 'node:assert/strict';
import test from 'node:test';

import { montarPlano } from '../../src/db/agendar-jobs.mjs';

const job = (nome, expressao = '30 8 * * *', comando = `select app.job_rodar('${nome}')`) =>
  ({ nome, expressao, comando });

test('job novo entra', () => {
  const p = montarPlano([job('escala')], [], new Set(['escala']));
  assert.deepEqual(p.agendar.map((j) => j.nome), ['escala']);
  assert.deepEqual(p.desagendar, []);
});

test('job em dia nao e reagendado', () => {
  const p = montarPlano([job('escala')], [job('escala')], new Set(['escala']));
  assert.deepEqual(p.agendar, []);
  assert.deepEqual(p.desagendar, []);
});

test('mudar a hora no registro alcanca o cron', () => {
  // Sem isto o registro vira ficção: job_agendado diria 04:00 e o pg_cron
  // continuaria rodando às 05:30.
  const p = montarPlano([job('escala', '0 7 * * *')], [job('escala', '30 8 * * *')],
    new Set(['escala']));
  assert.deepEqual(p.agendar.map((j) => j.expressao), ['0 7 * * *']);
});

test('mudar o comando tambem', () => {
  const p = montarPlano(
    [job('escala', '30 8 * * *', 'set local role lifetrailer_job; select 1')],
    [job('escala', '30 8 * * *', 'select 1')],
    new Set(['escala']),
  );
  assert.equal(p.agendar.length, 1);
});

test('job desativado e desagendado', () => {
  const p = montarPlano([], [job('escala')], new Set(['escala']));
  assert.deepEqual(p.desagendar, ['escala']);
});

test('entrada de cron que nao e nossa NAO e apagada', () => {
  // O pg_cron do banco pode ter job de outra coisa (backup do provedor, por
  // exemplo). Desagendar por ausência no nosso registro seria apagar o alheio.
  const p = montarPlano([], [job('backup_do_provedor')], new Set(['escala']));
  assert.deepEqual(p.desagendar, []);
});
