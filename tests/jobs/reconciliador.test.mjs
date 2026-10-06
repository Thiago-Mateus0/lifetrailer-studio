// Os degraus 0 a 3 da guarda do Laço 2 (ADR 0040 §3). Sem banco e sem rede:
// `buscar` e `pool` são injetados.
//
// O degrau 4 (vazio total) é do banco e está em tests/db/25_reconciliacao_laco2.sql.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  criarClienteAltegio,
  criarReconciliador,
  janelaDeHoje,
  NOME_DO_JOB,
  lerConfigAltegio,
  totalDeclarado,
  validarJanela,
} from '../../src/jobs/reconciliador.mjs';

const config = { partnerToken: 'p', userToken: 'u', companyId: 1000001 };

// Uma resposta da Altegio: status + corpo, como o fetch entrega.
const resposta = (status, corpo) => ({ status, json: async () => corpo });
const ok = (data, meta = { page: 1, total_count: data.length }) =>
  resposta(200, { success: true, data, meta });

const rec = (id) => ({ id, company_id: 1000001 });

// ------------------------------------------------------ degrau 0: a janela
test('janela fora do formato ISO lanca antes de virar URL', () => {
  assert.throws(() => validarJanela('x', '2026-12-31'), /janela inválida/);
  assert.throws(() => validarJanela('2026-12-01', ''), /janela inválida/);
  assert.throws(() => validarJanela('01/12/2026', '2026-12-31'), /janela inválida/);
});

test('janela invertida lanca', () => {
  assert.throws(() => validarJanela('2026-12-31', '2026-12-01'), /janela invertida/);
});

test('a Altegio aceitaria a data ruim em silencio — por isso nem chegamos a chamar', async () => {
  let chamou = false;
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => { chamou = true; return ok([]); },
  });
  await assert.rejects(() => cliente('x', '2026-12-31'), /janela inválida/);
  assert.equal(chamou, false, 'nenhuma chamada de rede com janela malformada');
});

test('janelaDeHoje devolve hoje+7 em America/Maceio, no formato ISO', () => {
  const j = janelaDeHoje(new Date('2026-09-09T12:00:00-03:00'));
  assert.equal(j.inicio, '2026-09-09');
  assert.equal(j.fim, '2026-09-16');
});

// ------------------------------------------------------ degrau 1: transporte
test('HTTP diferente de 200 lanca', async () => {
  const cliente = criarClienteAltegio({ config, buscar: async () => resposta(500, {}) });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /HTTP 500/);
});

// ------------------------------------------------------- degrau 2: envelope
test('success:false com data:null e ERRO, nao lista vazia', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(403, {
      success: false, data: null, meta: { message: 'Insufficient rights' },
    }),
  });
  // 403 para no degrau 1; o degrau 2 existe pro erro que vier com 200.
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /HTTP 403/);
});

test('success:false com HTTP 200 tambem lanca', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(200, { success: false, data: null, meta: { message: 'nope' } }),
  });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /success=false/);
});

test('data que nao e array lanca', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(200, { success: true, data: { id: 1 }, meta: [] }),
  });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /data não é array/);
});

test('janela vazia devolve lista vazia — e um caso NORMAL, nao erro', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => ok([], { page: 1, total_count: 0 }),
  });
  assert.deepEqual(await cliente('2027-06-01', '2027-06-30'), []);
});

test('meta como array vazio nao quebra a leitura', () => {
  assert.equal(totalDeclarado([]), null);
  assert.equal(totalDeclarado(null), null);
  assert.equal(totalDeclarado({ message: 'x' }), null);
  assert.equal(totalDeclarado({ page: 1, total_count: 2 }), 2);
});

// ------------------------------------------------------ degrau 3: completude
test('resposta paginada e seguida ate o total declarado', async () => {
  const paginas = {
    1: { success: true, data: [rec(1), rec(2)], meta: { page: 1, total_count: 3 } },
    2: { success: true, data: [rec(3)], meta: { page: 2, total_count: 3 } },
  };
  const cliente = criarClienteAltegio({
    config,
    buscar: async (url) => resposta(200, paginas[new URL(url).searchParams.get('page')]),
  });
  const registros = await cliente('2026-12-01', '2026-12-31');
  assert.deepEqual(registros.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(registros[0], rec(1), 'o registro vem inteiro, nao so o id');
});

test('parcial lanca — pagina que some viraria ausencia, e ausencia cancela', async () => {
  const paginas = {
    1: { success: true, data: [rec(1)], meta: { page: 1, total_count: 9 } },
    2: { success: true, data: [], meta: { page: 2, total_count: 9 } },
  };
  const cliente = criarClienteAltegio({
    config,
    buscar: async (url) => resposta(200, paginas[new URL(url).searchParams.get('page')]),
  });
  await assert.rejects(
    () => cliente('2026-12-01', '2026-12-31'),
    /resposta parcial.*total_count=9, lidos=1/,
  );
});

// Issue #83: o degrau 3 se desligava justamente quando não podia se verificar.
// `meta` sem `total_count` com registros na mão é indistinguível de resposta
// truncada — e truncada, no laço 2, é cancelamento.
test('registros sem total_count nao viram completude — o degrau 3 recusa', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(200, { success: true, data: [rec(1), rec(2)], meta: [] }),
  });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /sem meta\.total_count/);
});

test('meta objeto sem total_count tambem recusa', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(200, { success: true, data: [rec(1)], meta: { page: 1 } }),
  });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /sem meta\.total_count/);
});

// ⚠ O contrário disto é o caso NORMAL do ADR 0040 §2: `meta` vem array vazio
// justamente quando não há nada a dizer. Recusar aqui quebraria toda janela
// vazia legítima — e é o degrau 4, no banco, que decide o vazio.
test('janela vazia com meta [] continua sendo caso normal, nao falha de guarda', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => resposta(200, { success: true, data: [], meta: [] }),
  });
  assert.deepEqual(await cliente('2027-06-01', '2027-06-30'), []);
});

test('registro sem id inteiro lanca em vez de entrar como ausencia', async () => {
  const cliente = criarClienteAltegio({
    config,
    buscar: async () => ok([{ id: null }]),
  });
  await assert.rejects(() => cliente('2026-12-01', '2026-12-31'), /sem id inteiro positivo/);
});

// ------------------------------------------------------------- a credencial
test('credencial faltando falha no boot, e aponta o ADR', () => {
  assert.throws(() => lerConfigAltegio({}), /LT_ALTEGIO_PARTNER_TOKEN/);
  assert.throws(() => lerConfigAltegio({}), /ADR 0040/);
});

test('LT_WEBHOOK_TOKEN nao substitui a credencial de leitura', () => {
  assert.throws(
    () => lerConfigAltegio({ LT_WEBHOOK_TOKEN: 'a'.repeat(40) }),
    /LT_ALTEGIO_USER_TOKEN/,
  );
});

test('company_id nao inteiro lanca', () => {
  assert.throws(
    () => lerConfigAltegio({
      LT_ALTEGIO_PARTNER_TOKEN: 'p', LT_ALTEGIO_USER_TOKEN: 'u', LT_ALTEGIO_COMPANY_ID: 'abc',
    }),
    /inteiro positivo/,
  );
});

// ------------------------------------------------------------- o relogio
test('os dois lacos rodam na ordem, sobre a MESMA foto da API', async () => {
  const consultas = [];
  const pool = {
    query: async (sql, p) => { consultas.push([sql, p]); return { rows: [{ r: {} }] }; },
  };
  const reconciliar = criarReconciliador({
    pool,
    recordsDaJanela: async () => [rec(7)],
    agora: () => new Date('2026-09-09T12:00:00-03:00').getTime(),
  });

  await reconciliar();
  assert.equal(consultas.length, 3, 'laco 1, laco 2, e o registro da execucao');

  // Laco 1 primeiro (ADR 0003), com o registro INTEIRO.
  assert.match(consultas[0][0], /reconciliacao_laco1/);
  assert.deepEqual(JSON.parse(consultas[0][1][0]), [rec(7)]);

  // Laco 2 depois, com os ids da mesma resposta.
  const [sql2, [inicio, fim, ids]] = consultas[1];
  assert.match(sql2, /reconciliacao_laco2/);
  assert.equal(inicio, '2026-09-09');
  // +1 dia no SQL: sem isso, o ultimo dia da janela viraria ausencia inteira.
  assert.equal(fim, '2026-09-16');
  assert.deepEqual(ids, [7]);

  // E por ultimo o registro, com o resultado dos dois lacos no detalhe.
  const [sql3, [job, , resultado, detalhe]] = consultas[2];
  assert.match(sql3, /job_registrar_execucao/);
  assert.equal(job, NOME_DO_JOB);
  assert.equal(resultado, 'ok');
  assert.deepEqual(JSON.parse(detalhe), {
    laco1: {}, laco2: {},
    // A janela vai no detalhe: sem ela não dá pra responder "a varredura dos
    // dias 2–7 rodou hoje?" olhando `execucao_job`.
    janela: { inicio: '2026-09-09', fim: '2026-09-16', longa: true },
  });
});

test('falha de guarda nao propaga — e fica registrada, sem tocar nos lacos', async () => {
  // ⚠ Este teste dizia "nao devia chegar ao banco". Mudou de proposito na 0040:
  // a falha agora CHEGA ao banco, mas so para virar linha em execucao_job — e
  // e essa linha que poe o laco sob o vigia. Os lacos continuam intocados.
  const erros = [];
  const consultas = [];
  const reconciliar = criarReconciliador({
    pool: { query: async (sql, p) => { consultas.push([sql, p]); return { rows: [] }; } },
    recordsDaJanela: async () => { throw new Error('resposta parcial'); },
    aoErro: (...a) => erros.push(a.join(' ')),
  });

  assert.equal(await reconciliar(), null);
  assert.match(erros[0], /nao rodou/);

  assert.equal(consultas.filter(([sql]) => /reconciliacao_laco/.test(sql)).length, 0,
    'nenhum dos dois lacos roda com a guarda recusando');
  assert.equal(consultas.length, 1, 'so o registro');
  const [sql, [job, , resultado, detalhe, erroTexto]] = consultas[0];
  assert.match(sql, /job_registrar_execucao/);
  assert.equal(job, NOME_DO_JOB);
  assert.equal(resultado, 'falhou');
  assert.equal(detalhe, null);
  assert.match(erroTexto, /resposta parcial/, 'com o motivo, pra quem for olhar execucao_job');
});

test('registro que falha nao derruba o ciclo — o resultado dos lacos vale mais que a linha', async () => {
  const erros = [];
  const reconciliar = criarReconciliador({
    pool: {
      query: async (sql) => {
        if (/job_registrar_execucao/.test(sql)) throw new Error('banco recusou o registro');
        return { rows: [{ r: { cancelados: 0 } }] };
      },
    },
    recordsDaJanela: async () => [rec(7)],
    aoErro: (...a) => erros.push(a.join(' ')),
  });

  const r = await reconciliar();
  assert.deepEqual(r.laco1, { cancelados: 0 }, 'o ciclo devolve o resultado');
  assert.deepEqual(r.laco2, { cancelados: 0 });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /nao consegui registrar/);
});

test('ciclo pulado pelo intervalo NAO vira execucao', async () => {
  let t = 0;
  const consultas = [];
  const reconciliar = criarReconciliador({
    pool: { query: async (sql, p) => { consultas.push(sql); return { rows: [{ r: {} }] }; } },
    recordsDaJanela: async () => [],
    intervaloMs: 900_000,
    agora: () => t,
  });

  await reconciliar();
  const depoisDoPrimeiro = consultas.length;
  t = 300_000;
  await reconciliar();
  assert.equal(consultas.length, depoisDoPrimeiro,
    'pular nao e rodar — uma linha por pulo faria o vigia achar que o laco esta vivo');
});

test('respeita o intervalo entre execucoes', async () => {
  let t = 0;
  let chamadas = 0;
  const reconciliar = criarReconciliador({
    pool: { query: async () => ({ rows: [{ r: {} }] }) },
    recordsDaJanela: async () => { chamadas += 1; return []; },
    intervaloMs: 900_000,
    agora: () => t,
  });

  await reconciliar();
  t = 300_000;
  await reconciliar();
  assert.equal(chamadas, 1, 'dentro do intervalo nao chama a API de novo');
  t = 900_001;
  await reconciliar();
  assert.equal(chamadas, 2);
});

test('registro que o laco 1 enfileira nao pode ser lido como ausente pelo laco 2', async () => {
  const consultas = [];
  const reconciliar = criarReconciliador({
    pool: { query: async (sql, p) => { consultas.push([sql, p]); return { rows: [{ r: {} }] }; } },
    recordsDaJanela: async () => [rec(11), rec(12)],
  });

  await reconciliar();
  const idsDoLaco2 = consultas[1][1][2];
  // Os dois vieram na resposta, entao os dois estao na lista de presentes —
  // e presente nunca e ausencia, tenha ou nao virado Agendamento ainda.
  assert.deepEqual(idsDoLaco2, [11, 12]);
});

test('id repetido entre paginas nao faz truncamento parecer completude', async () => {
  const paginas = {
    1: { success: true, data: [rec(1), rec(2)], meta: { page: 1, total_count: 4 } },
    2: { success: true, data: [rec(1), rec(2)], meta: { page: 2, total_count: 4 } },
    3: { success: true, data: [], meta: { page: 3, total_count: 4 } },
  };
  const cliente = criarClienteAltegio({
    config,
    buscar: async (url) => resposta(200, paginas[new URL(url).searchParams.get('page')]),
  });
  await assert.rejects(
    () => cliente('2026-12-01', '2026-12-31'),
    /resposta parcial.*total_count=4, lidos=2/,
  );
});

// ------------------------------------------------ a cadência do ADR 0003
// "dias 0–1 a cada 15 min, dias 2–7 uma vez pela manhã". Até a PR da cadência o
// laço pedia os 7 dias a cada 15 min — mesmo resultado, mais chamadas, e janela
// maior por ciclo é mais superfície pra cancelamento errado.
const janelaPedida = (consultas) => {
  const [, [inicio, fim]] = consultas.find(([sql]) => /reconciliacao_laco2/.test(sql));
  return { inicio, fim };
};

const cicloEm = (iso, extra = {}) => {
  const consultas = [];
  const t = new Date(iso).getTime();
  return {
    consultas,
    t,
    reconciliar: criarReconciliador({
      pool: { query: async (sql, p) => { consultas.push([sql, p]); return { rows: [{ r: {} }] }; } },
      recordsDaJanela: async () => [],
      agora: () => t,
      ...extra,
    }),
  };
};

test('antes das 06:30 a janela e a curta — dias 0 e 1', async () => {
  const c = cicloEm('2026-09-09T05:00:00-03:00');
  await c.reconciliar();
  assert.deepEqual(janelaPedida(c.consultas), { inicio: '2026-09-09', fim: '2026-09-10' });
});

test('depois das 06:30 a PRIMEIRA do dia varre os 7 dias, e a seguinte volta a curta', async () => {
  let t = new Date('2026-09-09T07:00:00-03:00').getTime();
  const consultas = [];
  const reconciliar = criarReconciliador({
    pool: { query: async (sql, p) => { consultas.push([sql, p]); return { rows: [{ r: {} }] }; } },
    recordsDaJanela: async () => [],
    intervaloMs: 900_000,
    agora: () => t,
  });

  await reconciliar();
  assert.deepEqual(janelaPedida(consultas), { inicio: '2026-09-09', fim: '2026-09-16' },
    'a varredura da manhã');

  consultas.length = 0;
  t += 900_001;
  await reconciliar();
  assert.deepEqual(janelaPedida(consultas), { inicio: '2026-09-09', fim: '2026-09-10' },
    'e o ciclo seguinte volta aos dias 0–1: uma vez por dia, não uma por ciclo');
});

// ⚠ Marcar o dia na DECISÃO adiaria os dias 2–7 pro dia seguinte sempre que a
// API falhasse às 06:30 — e falha de rede ali é rotina, não exceção.
test('varredura longa que falha NAO conta como feita', async () => {
  let t = new Date('2026-09-09T07:00:00-03:00').getTime();
  let primeira = true;
  const consultas = [];
  const reconciliar = criarReconciliador({
    pool: { query: async (sql, p) => { consultas.push([sql, p]); return { rows: [{ r: {} }] }; } },
    recordsDaJanela: async () => {
      if (primeira) { primeira = false; throw new Error('rede caiu'); }
      return [];
    },
    intervaloMs: 900_000,
    aoErro: () => {},
    agora: () => t,
  });

  await reconciliar();
  assert.equal(consultas.some(([sql]) => /reconciliacao_laco2/.test(sql)), false,
    'a falhada nem chega aos laços');

  t += 900_001;
  await reconciliar();
  assert.deepEqual(janelaPedida(consultas), { inicio: '2026-09-09', fim: '2026-09-16' },
    'o ciclo seguinte tenta a varredura de novo, no mesmo dia');
});
