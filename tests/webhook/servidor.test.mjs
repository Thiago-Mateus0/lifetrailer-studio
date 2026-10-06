// A porta do webhook: o que ela deixa entrar, o que ela registra, e o que ela
// deliberadamente não faz.
//
// Sem banco: o ingestor é injetado. O que a RPC de ingestão garante está em
// tests/db/15_webhook_entrada.sql.
import assert from 'node:assert/strict';
import test from 'node:test';

import { lerConfig, TOKEN_MINIMO } from '../../src/webhook/config.mjs';
import {
  criarLimitador,
  criarServidor,
  redigirCaminho,
  tokenConfere,
} from '../../src/webhook/servidor.mjs';

const TOKEN = 'a'.repeat(TOKEN_MINIMO);

const config = (extra = {}) => ({
  token: TOKEN,
  porta: 0,
  limitePorJanela: 120,
  janelaMs: 60_000,
  corpoMaxBytes: 1_048_576,
  confiaProxy: false,
  ...extra,
});

// Sobe o servidor numa porta efêmera e devolve o que foi ingerido.
async function comServidor(opcoes, corpoDoTeste) {
  const ingeridos = [];
  const ingerir =
    opcoes.ingerir ??
    (async (r) => {
      ingeridos.push(r);
      return { requisicao_id: 'req', evento_id: 'ev' };
    });

  const servidor = criarServidor({
    config: opcoes.config ?? config(),
    ingerir,
    aoErro: () => {},
  });

  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    return await corpoDoTeste({ base, ingeridos });
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

// ------------------------------------------------------------ redação do path
test('redigirCaminho troca o token pelo marcador e joga fora a query', () => {
  assert.equal(redigirCaminho(`/webhook/altegio/${TOKEN}`), '/webhook/altegio/<token>');
  assert.equal(redigirCaminho(`/webhook/altegio/${TOKEN}/extra`), '/webhook/altegio/<token>');
  // token depois de segmento vazio ou ponto nao pode vazar
  assert.ok(!redigirCaminho(`/webhook/altegio//${TOKEN}`).includes(TOKEN));
  assert.ok(!redigirCaminho(`/webhook/altegio/./${TOKEN}`).includes(TOKEN));
  assert.equal(redigirCaminho(`/webhook/altegio/${TOKEN}?copia=${TOKEN}`), '/webhook/altegio/<token>');
  assert.equal(redigirCaminho('/outra/rota'), '/outra/rota');
});

test('tokenConfere aceita o igual e recusa o resto, inclusive de outro tamanho', () => {
  assert.equal(tokenConfere(TOKEN, TOKEN), true);
  assert.equal(tokenConfere('b'.repeat(TOKEN_MINIMO), TOKEN), false);
  assert.equal(tokenConfere('curto', TOKEN), false);
  assert.equal(tokenConfere(TOKEN + 'a', TOKEN), false);
});

// ------------------------------------------------------------------- limitador
test('limitador deixa passar até o teto e registra uma vez só por janela', () => {
  let agora = 1_000;
  const permitir = criarLimitador({ limitePorJanela: 3, janelaMs: 100 }, () => agora);

  assert.deepEqual(permitir('ip'), { permitido: true, registrar: false });
  permitir('ip');
  permitir('ip');

  assert.deepEqual(permitir('ip'), { permitido: false, registrar: true });
  assert.deepEqual(permitir('ip'), { permitido: false, registrar: false });

  assert.deepEqual(permitir('outro'), { permitido: true, registrar: false });

  agora += 200;
  assert.deepEqual(permitir('ip'), { permitido: true, registrar: false });
});

// --------------------------------------------------------------- caminho feliz
test('POST com token certo entra na fila com o corpo intacto', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const corpo = '{"resource":"record","status":"create","data":{"id":42}}';
    const r = await fetch(`${base}/webhook/altegio/${TOKEN}`, { method: 'POST', body: corpo });

    assert.equal(r.status, 200);
    assert.equal(ingeridos.length, 1);
    assert.equal(ingeridos[0].resultado, 'aceita');
    assert.equal(ingeridos[0].corpoBruto, corpo);
    assert.equal(ingeridos[0].corpoBytes, Buffer.byteLength(corpo));
    assert.equal(ingeridos[0].caminho, '/webhook/altegio/<token>');
  });
});

test('corpo que não é JSON também entra — quem recusa é o processador', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/webhook/altegio/${TOKEN}`, { method: 'POST', body: 'isto nao e json' });
    assert.equal(r.status, 200);
    assert.equal(ingeridos[0].resultado, 'aceita');
    assert.equal(ingeridos[0].corpoBruto, 'isto nao e json');
  });
});

test('credencial em cabeçalho não vai pra tabela append-only', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    await fetch(`${base}/webhook/altegio/${TOKEN}`, {
      method: 'POST',
      body: '{}',
      headers: { authorization: 'Bearer segredo', 'x-altegio': 'ok' },
    });
    assert.equal(ingeridos[0].cabecalhos.authorization, undefined);
    assert.equal(ingeridos[0].cabecalhos['x-altegio'], 'ok');
  });
});

// --------------------------------------------------------------------- recusas
test('token errado responde 404 — nem confirma que o endpoint existe', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/webhook/altegio/${'z'.repeat(TOKEN_MINIMO)}`, {
      method: 'POST',
      body: '{}',
    });

    assert.equal(r.status, 404);
    assert.equal(ingeridos[0].resultado, 'token_invalido');
    assert.equal(ingeridos[0].corpoBruto, null, 'corpo de requisicao nao autenticada nao e lido');
    assert.equal(ingeridos[0].caminho, '/webhook/altegio/<token>');
  });
});

test('método errado no endpoint certo é 405 e fica registrado', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/webhook/altegio/${TOKEN}`);
    assert.equal(r.status, 405);
    assert.equal(ingeridos[0].resultado, 'metodo_invalido');
  });
});

test('varredura fora de /webhook não vira linha no log permanente', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/wp-admin`);
    assert.equal(r.status, 404);
    assert.equal(ingeridos.length, 0);
  });
});

test('mas quem mira no /webhook e erra a rota fica registrado', async () => {
  await comServidor({}, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/webhook/outra-coisa`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 404);
    assert.equal(ingeridos[0].resultado, 'rota_desconhecida');
  });
});

test('corpo acima do teto é 413, e o prefixo lido ainda vai pro log', async () => {
  await comServidor({ config: config({ corpoMaxBytes: 64 }) }, async ({ base, ingeridos }) => {
    const r = await fetch(`${base}/webhook/altegio/${TOKEN}`, {
      method: 'POST',
      body: 'x'.repeat(5_000),
    });

    assert.equal(r.status, 413);
    assert.equal(ingeridos[0].resultado, 'corpo_grande');
    assert.ok(ingeridos[0].corpoBytes > 64);
  });
});

test('excesso responde 429 e registra uma vez, não uma por requisição', async () => {
  await comServidor({ config: config({ limitePorJanela: 2 }) }, async ({ base, ingeridos }) => {
    const codigos = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await fetch(`${base}/webhook/altegio/${TOKEN}`, { method: 'POST', body: '{}' });
      codigos.push(r.status);
    }

    assert.deepEqual(codigos, [200, 200, 429, 429, 429]);
    assert.equal(ingeridos.filter((i) => i.resultado === 'excesso').length, 1);
  });
});

test('falha ao registrar não responde 200 — não se finge sucesso', async () => {
  const ingerir = async () => {
    throw new Error('banco fora');
  };

  await comServidor({ ingerir }, async ({ base }) => {
    const r = await fetch(`${base}/webhook/altegio/${TOKEN}`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 503);
  });
});

// ----------------------------------------------------------------- configuração
test('subir sem token, ou com token curto, falha no boot', () => {
  assert.throws(() => lerConfig({}), /LT_WEBHOOK_TOKEN/);
  assert.throws(() => lerConfig({ LT_WEBHOOK_TOKEN: 'curto' }), /LT_WEBHOOK_TOKEN/);
});

test('lerConfig recusa token com caractere que nao cabe no caminho da URL', () => {
  assert.throws(() => lerConfig({ LT_WEBHOOK_TOKEN: 'a/'.repeat(TOKEN_MINIMO) }), /so pode ter/);
  assert.throws(() => lerConfig({ LT_WEBHOOK_TOKEN: 'a+'.repeat(TOKEN_MINIMO) }), /so pode ter/);
  assert.doesNotThrow(() => lerConfig({ LT_WEBHOOK_TOKEN: 'aB-_'.repeat(TOKEN_MINIMO) }));
});

test('lerConfig tem padrões e recusa número inválido', () => {
  const c = lerConfig({ LT_WEBHOOK_TOKEN: TOKEN });
  assert.equal(c.porta, 8787);
  assert.equal(c.confiaProxy, false);
  assert.throws(() => lerConfig({ LT_WEBHOOK_TOKEN: TOKEN, LT_WEBHOOK_PORTA: 'abc' }), /PORTA/);
});
