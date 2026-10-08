// O Enviar da Helena pelo ManyChat (ADR 0076). Sem banco e sem rede: a Comanda,
// a transição e o ManyChat são injetados. Aqui se prova a regra do §2 — um
// contato só, senão não envia — e a do §4: Enviada só depois do `success`.
import assert from 'node:assert/strict';
import test from 'node:test';

import { assinarAdmin, NOME_COOKIE } from '../../src/api/admin.mjs';
import { assinar } from '../../src/api/claim.mjs';
import { criarManychat, soDigitos } from '../../src/api/manychat.mjs';
import { criarAtendenteApp } from '../../src/api/servidor.mjs';
import { criarServidor } from './_ajuda.mjs';

const SEGREDO = 's'.repeat(32);
const CHAVE = 'chave-do-tablet-de-teste';
const DISPOSITIVO_ID = '33333333-3333-4333-8333-333333333333';
const HELENA = '11111111-1111-4111-8111-111111111111';
const COMANDA = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.UTC(2026, 8, 29, 14, 0, 0);
const TEXTO = 'Olá, Ana! Aqui está o comprovante: https://exemplo/comprovante/x?t=y';

const config = { segredo: SEGREDO, cookieSeguro: false };

const cookie = `${NOME_COOKIE}=${assinarAdmin({
  colaborador_id: HELENA, perfil: 'administrador', exp: Math.floor(AGORA / 1000) + 3600,
}, SEGREDO)}`;

const claim = assinar({
  colaborador_id: HELENA, perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(AGORA / 1000) + 3600, origem_claim: 'online',
  dispositivo_id: DISPOSITIVO_ID,
}, SEGREDO);

// Um ManyChat falso: `contatos` é o que a busca devolve; `aceita` decide o envio.
function manychatFalso({ contatos = ['900'], aceita = true, falhaNaBusca = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async acharContatos(telefone) {
      chamadas.push(['achar', telefone]);
      if (falhaNaBusca) throw new Error('fora do ar');
      return contatos;
    },
    async enviarTexto(id, texto) {
      chamadas.push(['enviar', id, texto]);
      return aceita ? { ok: true } : { ok: false, mensagem: 'Subscriber is out of 24h window' };
    },
  };
}

async function comApp({
  manychat = manychatFalso(),
  comanda = { status: 'fechada', versao: 3, cliente_telefone: '5582999990000' },
  transicao = async () => ({ id: COMANDA, status: 'enviada' }),
} = {}, corpoDoTeste) {
  const consultas = [];
  const atenderApp = criarAtendenteApp({
    config,
    assinarClaim: (c) => assinar(c, SEGREDO),
    abrirSessao: async () => ({ ok: false }),
    conferirDispositivo: async (c) => (c === CHAVE ? { ok: true, id: DISPOSITIVO_ID, nome: 'Tablet' } : { ok: false }),
    telas: {},
    comSessao: async (_sessao, corpo) => corpo({
      query: async (sql, valores) => {
        consultas.push({ sql, valores });
        if (sql.includes('comanda_transicionar')) return { rows: [await transicao(valores)] };
        return { rows: comanda === null ? [] : [comanda] };
      },
    }),
    manychat,
    aoErro: () => {},
    agora: () => AGORA,
  });

  const servidor = criarServidor({ atenderApp, ingerir: async () => {} });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    await corpoDoTeste({ base, consultas, manychat });
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

const enviar = (base, { cabecalhos = { cookie }, corpo = { comanda_id: COMANDA, versao: 3, texto: TEXTO } } = {}) =>
  fetch(`${base}/comprovante/enviar`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecalhos }, body: JSON.stringify(corpo),
  });

const transicoes = (consultas) => consultas.filter((c) => c.sql.includes('comanda_transicionar'));

test('um contato e success: manda o texto e a Comanda vira Enviada com a autoria da Helena', async () => {
  await comApp({}, async ({ base, consultas, manychat }) => {
    const r = await enviar(base);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.enviado, true);
    assert.equal(corpo.registrado, true);

    assert.deepEqual(manychat.chamadas, [['achar', '5582999990000'], ['enviar', '900', TEXTO]]);
    const [t] = transicoes(consultas);
    // id, evento, versão, ator, fim, início, telefone, motivo, origem
    assert.deepEqual(t.valores, [COMANDA, 'enviar', 3, HELENA, null, null, '5582999990000', null, 'online']);
  });
});

test('o telefone da Altegio vai em digitos: e o formato que o campo guarda', async () => {
  await comApp({ comanda: { status: 'fechada', versao: 3, cliente_telefone: '+55 (82) 99999-0000' } },
    async ({ base, manychat }) => {
      await enviar(base);
      assert.deepEqual(manychat.chamadas[0], ['achar', '5582999990000']);
    });
});

for (const [nome, contatos, motivo] of [
  ['nenhum contato', [], /não achou/],
  ['dois contatos', ['900', '901'], /mais de um contato/],
]) {
  test(`${nome}: nao envia, nao transiciona, e diz por que`, async () => {
    await comApp({ manychat: manychatFalso({ contatos }) }, async ({ base, consultas, manychat }) => {
      const corpo = await (await enviar(base)).json();
      assert.equal(corpo.enviado, false);
      assert.match(corpo.motivo, motivo);
      assert.equal(manychat.chamadas.some(([o]) => o === 'enviar'), false);
      assert.equal(transicoes(consultas).length, 0);
    });
  });
}

test('ManyChat recusou o envio (fora da janela): continua Fechada', async () => {
  await comApp({ manychat: manychatFalso({ aceita: false }) }, async ({ base, consultas }) => {
    const corpo = await (await enviar(base)).json();
    assert.equal(corpo.enviado, false);
    assert.match(corpo.motivo, /24h/);
    assert.equal(transicoes(consultas).length, 0);
  });
});

test('ManyChat fora do ar: cai no manual', async () => {
  await comApp({ manychat: manychatFalso({ falhaNaBusca: true }) }, async ({ base, consultas }) => {
    const corpo = await (await enviar(base)).json();
    assert.equal(corpo.enviado, false);
    assert.match(corpo.motivo, /não respondeu/);
    assert.equal(transicoes(consultas).length, 0);
  });
});

test('sem LT_MANYCHAT_TOKEN: nao tenta nada', async () => {
  await comApp({ manychat: null }, async ({ base, consultas }) => {
    const corpo = await (await enviar(base)).json();
    assert.equal(corpo.enviado, false);
    assert.match(corpo.motivo, /não está ligado/);
    assert.equal(consultas.length, 0);
  });
});

test('sem telefone na Comanda: nao busca', async () => {
  await comApp({ comanda: { status: 'fechada', versao: 3, cliente_telefone: null } }, async ({ base, manychat }) => {
    const corpo = await (await enviar(base)).json();
    assert.equal(corpo.enviado, false);
    assert.match(corpo.motivo, /telefone/);
    assert.equal(manychat.chamadas.length, 0);
  });
});

test('saiu e a transicao falhou: diz que saiu, para a Helena marcar que mandou', async () => {
  const conflito = Object.assign(new Error('este registro foi alterado por outra pessoa'), { code: 'LT001' });
  await comApp({ transicao: async () => { throw conflito; } }, async ({ base }) => {
    const r = await enviar(base);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.enviado, true);
    assert.equal(corpo.registrado, false);
    assert.match(corpo.motivo, /Já mandei por fora/);
  });
});

test('so o Admin envia, so Comanda fechada, corpo conferido', async () => {
  await comApp({}, async ({ base, manychat }) => {
    const tablet = { authorization: `Bearer ${claim}`, 'x-lt-dispositivo': CHAVE };
    assert.equal((await enviar(base, { cabecalhos: tablet })).status, 403);
    assert.equal((await enviar(base, { cabecalhos: {} })).status, 401);
    assert.equal((await enviar(base, { corpo: { comanda_id: 'x', versao: 3, texto: TEXTO } })).status, 400);
    assert.equal((await enviar(base, { corpo: { comanda_id: COMANDA, versao: 3, texto: '' } })).status, 400);
    assert.equal((await enviar(base, { corpo: { comanda_id: COMANDA, versao: '3', texto: TEXTO } })).status, 400);
    assert.equal(manychat.chamadas.length, 0);
  });
  await comApp({ comanda: { status: 'enviada', versao: 4, cliente_telefone: '5582999990000' } }, async ({ base }) => {
    assert.equal((await enviar(base)).status, 409);
  });
  await comApp({ comanda: null }, async ({ base }) => {
    assert.equal((await enviar(base)).status, 404);
  });
});

// ------------------------------------------------ o cliente HTTP do ManyChat
function fetchFalso(respostas) {
  const pedidos = [];
  return {
    pedidos,
    buscar: async (url, opcoes) => {
      pedidos.push({ url, opcoes });
      const { pathname } = new URL(url);
      return { status: 200, json: async () => respostas[pathname] };
    },
  };
}

const CAMPOS = { status: 'success', data: [{ id: 1, name: 'user_whatsapp' }, { id: 15014427, name: 'telefone_whatsapp' }] };

test('manychat: acha pelo campo telefone_whatsapp, lido pelo nome uma vez so', async () => {
  const f = fetchFalso({
    '/fb/page/getCustomFields': CAMPOS,
    '/fb/subscriber/findByCustomField': { status: 'success', data: [{ id: 1564854710 }] },
  });
  const mc = criarManychat({ token: 'tk', buscar: f.buscar });
  assert.deepEqual(await mc.acharContatos('5582999990000'), ['1564854710']);
  await mc.acharContatos('5582999990000');

  assert.equal(f.pedidos.filter((p) => p.url.includes('getCustomFields')).length, 1);
  const busca = new URL(f.pedidos[1].url).searchParams;
  assert.equal(busca.get('field_id'), '15014427');
  assert.equal(busca.get('field_value'), '5582999990000');
  assert.equal(f.pedidos[0].opcoes.headers.authorization, 'Bearer tk');
});

test('manychat: envia texto de WhatsApp e so success conta', async () => {
  const f = fetchFalso({ '/fb/sending/sendContent': { status: 'success' } });
  assert.deepEqual(await criarManychat({ token: 'tk', buscar: f.buscar }).enviarTexto('900', 'oi'), { ok: true });
  assert.deepEqual(JSON.parse(f.pedidos[0].opcoes.body), {
    subscriber_id: '900',
    data: { version: 'v2', content: { type: 'whatsapp', messages: [{ type: 'text', text: 'oi' }] } },
  });

  const recusa = fetchFalso({ '/fb/sending/sendContent': { status: 'error', message: 'fora da janela' } });
  assert.deepEqual(await criarManychat({ token: 'tk', buscar: recusa.buscar }).enviarTexto('900', 'oi'),
    { ok: false, mensagem: 'fora da janela' });
});

test('manychat: sem o campo na conta, a busca falha em vez de achar nada', async () => {
  const f = fetchFalso({ '/fb/page/getCustomFields': { status: 'success', data: [] } });
  await assert.rejects(criarManychat({ token: 'tk', buscar: f.buscar }).acharContatos('55'), /telefone_whatsapp/);
});

test('soDigitos', () => {
  assert.equal(soDigitos('+55 (11) 99999-0003'), '5511999990003');
  assert.equal(soDigitos(null), '');
});
