// O vigia: só o relógio. Quem decide o que está atrasado é o banco.
//
// Sem banco: o pool é injetado. O que as funções garantem está em
// tests/db/18_jobs_fundacao.sql.
import assert from 'node:assert/strict';
import test from 'node:test';

import { criarVigia, INTERVALO_PADRAO_MS } from '../../src/jobs/vigia.mjs';

function poolFalso(resposta = { rows: [{ alertados: 0 }] }) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql) {
      chamadas.push(sql);
      if (typeof resposta === 'function') return resposta();
      return resposta;
    },
  };
}

test('confere na primeira volta — job morto no fim de semana nao espera o intervalo', async () => {
  const pool = poolFalso({ rows: [{ alertados: 2 }] });
  const vigiar = criarVigia({ pool, agora: () => 0 });

  assert.equal(await vigiar(), 2);
  assert.equal(pool.chamadas.length, 1);
  assert.match(pool.chamadas[0], /job_alertar_ausencia/);
});

test('e nao reconfere antes do intervalo', async () => {
  // O laço do webhook roda a cada 5s; sem isto, seriam 180 consultas por
  // intervalo pra reler a mesma resposta.
  let t = 0;
  const pool = poolFalso();
  const vigiar = criarVigia({ pool, agora: () => t });

  await vigiar();
  t = INTERVALO_PADRAO_MS - 1;
  assert.equal(await vigiar(), null);
  assert.equal(pool.chamadas.length, 1);

  t = INTERVALO_PADRAO_MS;
  await vigiar();
  assert.equal(pool.chamadas.length, 2);
});

test('banco fora nao derruba o worker nem vira consulta a cada 5s', async () => {
  let t = 0;
  const erros = [];
  const pool = {
    chamadas: [],
    async query(sql) {
      this.chamadas.push(sql);
      throw new Error('conexao caiu');
    },
  };
  const vigiar = criarVigia({ pool, agora: () => t, aoErro: (...a) => erros.push(a) });

  assert.equal(await vigiar(), null);
  assert.equal(erros.length, 1);

  t = 1000;
  assert.equal(await vigiar(), null);
  assert.equal(pool.chamadas.length, 1, 'a falha nao antecipa a proxima conferencia');
});
