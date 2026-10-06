// GET /tela/entrada: a lista de quem entra e a marca do Aviso Urgente (ADR 0070).
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_ENTRADA, montarEntrada } from '../../src/api/telas/entrada.mjs';
import { bancoDisponivel, MARCOS, JANA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const URGENTE = '99999999-0000-0000-0000-000000000001';

// Um urgente para o Paulo; o Marcos só tem o normal. A Jana (autora, Admin) está
// no snapshot do urgente, mas Admin não aparece na Entrada (ADR 0049).
const SEMEAR = `
insert into aviso (id, texto, prioridade, status, autor_id, snapshot_colaboradores) values
  ('${URGENTE}', 'Porta dos fundos', 'urgente', 'ativo', '${JANA}', '{${JANA},${PAULO}}'),
  ('99999999-0000-0000-0000-000000000002', 'Normal', 'normal', 'ativo', '${JANA}', '{${MARCOS},${PAULO}}');
`;

// A consulta não lê claim: o $1 que o rodarTela passa não entra nela.
const rodar = (extra = '') => rodarTela({
  consulta: CONSULTA_ENTRADA, comoQuem: JANA, semear: SEMEAR, extra, json: ['pessoas'],
});

const marcas = (linha) => Object.fromEntries(linha.pessoas.map((p) => [p.nome, p.aviso_urgente]));

test('entrada: marca quem esta no snapshot de um urgente e nao confirmou', { skip: semBanco }, () => {
  assert.deepEqual(marcas(rodar()), { Marcos: false, Paulo: true });
});

test('entrada: a confirmacao da edicao atual tira a marca', { skip: semBanco }, () => {
  const l = rodar(`insert into confirmacao_leitura (comunicado_id, colaborador_id) values ('${URGENTE}', '${PAULO}');`);
  assert.equal(marcas(l).Paulo, false);
});

// 0072: editar volta a pedir a confirmação de todos.
test('entrada: a confirmacao de uma edicao anterior nao conta', { skip: semBanco }, () => {
  const l = rodar(`
    insert into confirmacao_leitura (comunicado_id, colaborador_id) values ('${URGENTE}', '${PAULO}');
    update aviso set edicao = 2 where id = '${URGENTE}';`);
  assert.equal(marcas(l).Paulo, true);
});

test('entrada: arquivado, normal ou sem confirmacao nao marca', { skip: semBanco }, () => {
  for (const mudanca of [
    `status = 'arquivado'`,
    `prioridade = 'normal'`,
    // ADR 0058 §2: o que não pede confirmação não tem "não lido".
    `pede_confirmacao = false`,
  ]) {
    const l = rodar(`update aviso set ${mudanca} where id = '${URGENTE}';`);
    assert.equal(marcas(l).Paulo, false, mudanca);
  }
});

test('entrada: a tela leva a marca e nunca o texto do aviso', { skip: semBanco }, () => {
  const d = montarEntrada(rodar(), { local: 'Recepção', dispositivo: 'Tablet 01' }, new Date());
  assert.deepEqual(d.pessoas.map((p) => [p.nome, p.papel, p.avisoUrgente]),
    [['Marcos', 'Atendente', false], ['Paulo', 'Atendente', true]]);
  assert.equal(JSON.stringify(d).includes('Porta dos fundos'), false);
});

test('entrada: sem ninguem ativo a lista vem vazia', () => {
  const d = montarEntrada({ pessoas: [] }, { local: 'Recepção', dispositivo: 'Tablet 01' },
    new Date('2026-08-17T11:12:00Z'));
  assert.deepEqual([d.pessoas, d.hora, d.local, d.aparelho], [[], '08:12', 'Recepção', 'Tablet 01']);
});
