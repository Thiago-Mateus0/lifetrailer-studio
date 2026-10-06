// O worker da fila: o que ele traduz e o que ele deliberadamente não faz.
//
// Sem banco: o pool é injetado. O que a RPC garante está em
// tests/db/16_agendamento_aplicar_evento.sql.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classificarErro,
  criarProcessador,
  envDoPool,
  montarBackup,
  montarReconciliador,
  ROLE_DO_WORKER,
} from '../../src/webhook/processador.mjs';

const erro = (code, message = 'falhou') => Object.assign(new Error(message), { code });

// Pool falso: guarda as chamadas e responde pelo início do SQL.
function poolFalso({ pendentes = [], aplicar = async () => ({ rows: [{ status: 'processado' }] }) } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, valores) {
      chamadas.push({ sql, valores });
      if (sql.includes('webhook_evento_reclamar')) {
        return { rows: pendentes.map((id) => ({ id })) };
      }
      if (sql.includes('agendamento_aplicar_evento')) return aplicar(valores[0]);
      if (sql.includes('webhook_evento_falhou')) return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
}

// ------------------------------------------------- classificação (ADR 0021 §1)
test('os codigos LT viram as tres classes do ADR 0021', () => {
  // Versão obsoleta é a única LT que converge sozinha: a próxima leitura pega a
  // versão nova.
  assert.equal(classificarErro(erro('LT001')), 'transitoria');
  // Aresta inexistente, guarda de negócio e identidade continuam errados na
  // próxima tentativa — retentar é laço infinito.
  assert.equal(classificarErro(erro('LT002')), 'invalida');
  assert.equal(classificarErro(erro('LT003')), 'invalida');
  assert.equal(classificarErro(erro('LT005')), 'invalida');
  // "O mundo mudou e a operação não vale mais" — a definição de `caducou`.
  assert.equal(classificarErro(erro('LT004')), 'caducou');
});

test('erro do Postgres que passa sozinho e transitorio', () => {
  assert.equal(classificarErro(erro('40001')), 'transitoria');   // serialização
  assert.equal(classificarErro(erro('40P01')), 'transitoria');   // deadlock
  assert.equal(classificarErro(erro('57P01')), 'transitoria');   // desligamento
  assert.equal(classificarErro(erro('08006')), 'transitoria');   // conexão caiu
});

test('dado invalido e violacao de constraint nao convergem', () => {
  assert.equal(classificarErro(erro('22P02')), 'invalida');      // cast impossível
  assert.equal(classificarErro(erro('23514')), 'invalida');      // check violado
});

test('a corrida de dois `create` do mesmo data.id e transitoria, nao invalida', () => {
  // `reclamar` é multi-worker por desenho. Dois eventos `create` do mesmo
  // data.id não se serializam — nenhum acha linha em `agendamento` pra travar —
  // e o perdedor leva 23505 do índice único. Na retentativa ele encontra a
  // linha e segue por update.
  //
  // Desde o 0024 isso deixou de ser inofensivo: `invalida` vai direto pra
  // bandeja, sem retentar. Classificar errado aqui custa uma ida do Admin à
  // tela por corrida de worker.
  assert.equal(classificarErro(erro('23505')), 'transitoria');
  // e o resto do prefixo 23 continua permanente
  assert.equal(classificarErro(erro('23503')), 'invalida');      // FK violada
});

test('erro sem codigo cai no lado seguro, nao na bandeja', () => {
  // Classificar de menos manda pra bandeja um banco que só reiniciou; o
  // desconhecido esgota o backoff e chega na bandeja de qualquer jeito.
  assert.equal(classificarErro(new Error('timeout')), 'transitoria');
  assert.equal(classificarErro(undefined), 'transitoria');
  assert.equal(classificarErro(erro('')), 'transitoria');
});

// ------------------------------------------------------------------- o lote
test('o lote reclama, aplica, e nao carimba nada quando da certo', async () => {
  const pool = poolFalso({ pendentes: ['ev-1', 'ev-2'] });
  const contagem = await criarProcessador({ pool, limite: 7 })();

  assert.deepEqual(contagem, { reclamados: 2, processados: 2, ignorados: 0, falhas: 0 });
  assert.match(pool.chamadas[0].sql, /webhook_evento_reclamar/);
  assert.deepEqual(pool.chamadas[0].valores, [7]);
  // sucesso é marcado pela própria RPC — o worker não escreve por fora dela
  assert.equal(pool.chamadas.filter((c) => c.sql.includes('falhou')).length, 0);
});

test('evento fora de ordem conta como ignorado, nao como falha', async () => {
  const pool = poolFalso({
    pendentes: ['ev-1'],
    aplicar: async () => ({ rows: [{ status: 'ignorado' }] }),
  });
  const contagem = await criarProcessador({ pool })();

  assert.deepEqual(contagem, { reclamados: 1, processados: 0, ignorados: 1, falhas: 0 });
});

test('falha registra classe, codigo e texto — e o evento continua pendente', async () => {
  const pool = poolFalso({
    pendentes: ['ev-1'],
    aplicar: async () => {
      throw erro('LT002', 'evento sem data.id');
    },
  });
  const contagem = await criarProcessador({ pool, aoErro: () => {} })();

  assert.deepEqual(contagem, { reclamados: 1, processados: 0, ignorados: 0, falhas: 1 });

  const marcada = pool.chamadas.find((c) => c.sql.includes('webhook_evento_falhou'));
  assert.deepEqual(marcada.valores, ['ev-1', 'invalida', 'LT002', 'evento sem data.id']);
  // ⚠ fronteira do PR C: nada aqui muda status, backoff ou bandeja.
  assert.equal(marcada.sql.includes('parada'), false);
});

test('um evento que falha nao derruba o resto do lote', async () => {
  const pool = poolFalso({
    pendentes: ['ev-1', 'ev-2', 'ev-3'],
    aplicar: async (id) => {
      if (id === 'ev-2') throw erro('LT003', 'guarda recusou');
      return { rows: [{ status: 'processado' }] };
    },
  });
  const contagem = await criarProcessador({ pool, aoErro: () => {} })();

  assert.deepEqual(contagem, { reclamados: 3, processados: 2, ignorados: 0, falhas: 1 });
});

test('banco fora na hora de marcar a falha nao derruba o worker', async () => {
  // O evento continua pendente e o lease vence sozinho: nada some da fila.
  const pool = {
    async query(sql, valores) {
      if (sql.includes('reclamar')) return { rows: [{ id: 'ev-1' }] };
      if (sql.includes('aplicar_evento')) throw erro('LT002', 'payload nao e JSON valido');
      throw erro('08006', 'conexao caiu');
    },
  };
  const contagem = await criarProcessador({ pool, aoErro: () => {} })();

  assert.deepEqual(contagem, { reclamados: 1, processados: 0, ignorados: 0, falhas: 1 });
});

// ------------------------------------------------------------------- o role
// issue #31: o role do worker é fronteira de privilégio, não configuração.
test('PGUSER do ambiente NAO rebaixa o worker', () => {
  // O receptor roda como lifetrailer_app na mesma máquina e com o mesmo .env.
  // Se ele mandasse aqui, todo reclamar voltaria 42501 — e esse erro estoura
  // fora do try por evento, então nunca vira classe_erro nem chega à bandeja.
  assert.equal(envDoPool({ PGUSER: 'lifetrailer_app' }).PGUSER, ROLE_DO_WORKER);
  assert.equal(envDoPool({}).PGUSER, ROLE_DO_WORKER);
});

test('variavel em branco nao rebaixa o worker pro role do receptor', () => {
  const env = { PGUSER: 'lifetrailer_app', LT_WEBHOOK_PGUSER: '' };
  assert.equal(envDoPool(env).PGUSER, ROLE_DO_WORKER);
});

test('a troca de role e uma variavel propria, que nao colide com a do receptor', () => {
  const env = { PGUSER: 'lifetrailer_app', LT_WEBHOOK_PGUSER: 'postgres' };
  assert.equal(envDoPool(env).PGUSER, 'postgres');
  // e o resto do ambiente passa intacto pro pool
  assert.equal(envDoPool({ ...env, PGHOST: 'db.interno' }).PGHOST, 'db.interno');
});

test('a senha do worker e a dele, nao a do receptor', () => {
  // Em produção lifetrailer_job e lifetrailer_app têm senhas diferentes, e a do
  // job mora num arquivo que só o worker lê (deploy/worker.exemplo).
  const env = { PGPASSWORD: 'do-app', LT_WEBHOOK_PGPASSWORD: 'do-job' };
  assert.equal(envDoPool(env).PGPASSWORD, 'do-job');
  // sem ela (dev local), o pool segue com o que o ambiente tiver
  assert.equal(envDoPool({ PGPASSWORD: 'dev' }).PGPASSWORD, 'dev');
});

// ------------------------------------------------ reconciliação (ADR 0003)
// Os dois laços existiam e ninguém os ligava. Estes testes não repetem os
// degraus da guarda (tests/jobs/reconciliador.test.mjs) — provam a LIGAÇÃO.
const ENV_ALTEGIO = {
  LT_ALTEGIO_PARTNER_TOKEN: 'p',
  LT_ALTEGIO_USER_TOKEN: 'u',
  LT_ALTEGIO_COMPANY_ID: '1000001',
};

test('sem credencial da Altegio o processo NAO cai — e grita a cada intervalo, nao so no boot', async () => {
  const erros = [];
  let t = 0;
  const reconciliar = montarReconciliador({
    env: {},
    pool: { query: async () => { throw new Error('sem credencial nao devia consultar o banco'); } },
    aoErro: (...a) => erros.push(a.join(' ')),
    agora: () => t,
  });

  assert.equal(await reconciliar(), null);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /NAO estao rodando/);
  assert.match(erros[0], /LT_ALTEGIO_PARTNER_TOKEN/, 'a mensagem nomeia o que falta');

  assert.equal(await reconciliar(), null);
  assert.equal(erros.length, 1, 'dentro do intervalo nao repete');

  t = 900_000;
  await reconciliar();
  assert.equal(erros.length, 2,
    'passado o intervalo grita de novo — aviso so no boot vira silencio no dia seguinte');
});

test('com credencial, a funcao montada chega nos dois lacos do banco', async () => {
  const chamadas = [];
  const pool = {
    async query(sql) {
      chamadas.push(sql);
      return { rows: [{ r: {} }] };
    },
  };
  const buscar = async () => ({
    status: 200,
    json: async () => ({ success: true, data: [{ id: 7, company_id: 1000001 }], meta: { total_count: 1 } }),
  });

  const reconciliar = montarReconciliador({
    env: ENV_ALTEGIO,
    pool,
    buscar,
    agora: () => 0,
    aoErro: (...a) => { throw new Error(a.join(' ')); },
  });

  assert.ok(await reconciliar(), 'rodou');
  assert.ok(chamadas.some((s) => s.includes('reconciliacao_laco1')), 'chegou no laco 1');
  assert.ok(chamadas.some((s) => s.includes('reconciliacao_laco2')), 'chegou no laco 2');
});

test('LT_RECONCILIACAO_INTERVALO_MS manda no intervalo', async () => {
  let consultas = 0;
  let t = 0;
  const reconciliar = montarReconciliador({
    env: { ...ENV_ALTEGIO, LT_RECONCILIACAO_INTERVALO_MS: '1000' },
    pool: { async query() { consultas += 1; return { rows: [{ r: {} }] }; } },
    buscar: async () => ({ status: 200, json: async () => ({ success: true, data: [], meta: [] }) }),
    agora: () => t,
    aoErro: () => {},
  });

  await reconciliar();
  const primeira = consultas;
  t = 999;
  await reconciliar();
  assert.equal(consultas, primeira, 'antes de 1000ms nao roda');
  t = 1000;
  await reconciliar();
  assert.ok(consultas > primeira, 'aos 1000ms roda de novo');
});

test('sem credencial do backup o processo NAO cai — e grita de hora em hora', async () => {
  const erros = [];
  let t = 0;
  const fazerBackup = montarBackup({
    env: {},
    pool: { query: async () => { throw new Error('sem credencial nao devia consultar o banco'); } },
    aoErro: (...a) => erros.push(a.join(' ')),
    agora: () => t,
  });

  assert.equal(await fazerBackup(), null);
  assert.match(erros[0], /NAO esta rodando/);
  assert.match(erros[0], /LT_BACKUP_DATABASE_URL/, 'a mensagem nomeia o que falta');

  t = 3_599_999;
  await fazerBackup();
  assert.equal(erros.length, 1);
  t = 3_600_000;
  await fazerBackup();
  assert.equal(erros.length, 2);
});
