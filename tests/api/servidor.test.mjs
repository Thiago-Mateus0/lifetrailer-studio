// O roteador do lado-app (ADR 0042). Sem banco: `comSessao` e `abrirSessao` são
// injetados. O que se prova aqui é a fronteira — quem entra sem claim, o que a
// allow-list recusa, e que montar o app não muda o que o webhook responde.
import assert from 'node:assert/strict';
import test from 'node:test';

import { assinarAdmin, NOME_COOKIE } from '../../src/api/admin.mjs';
import { assinar } from '../../src/api/claim.mjs';
import { criarAtendenteApp } from '../../src/api/servidor.mjs';
import { criarServidor, TOKEN_MINIMO_PARA_TESTE } from './_ajuda.mjs';

const SEGREDO = 's'.repeat(32);

// O tablet registrado do teste (ADR 0048). A conferência de verdade é do banco
// (tests/db/31); aqui ela é injetada, e o que se prova é onde o servidor a exige.
const CHAVE = 'chave-do-tablet-de-teste';
const DISPOSITIVO_ID = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 7, 17, 11, 0, 0);

const config = {
  segredo: SEGREDO, dispositivo: 'Tablet 01', local: 'Recepção', versao: 'teste',
  // Sem TLS no teste; o padrão de produção é o inverso (ADR 0047 §4).
  cookieSeguro: false,
};

const cookieAdmin = (extra = {}) => `${NOME_COOKIE}=${assinarAdmin({
  colaborador_id: '11111111-1111-4111-8111-111111111111',
  perfil: 'administrador',
  exp: Math.floor(AGORA / 1000) + 3600,
  ...extra,
}, SEGREDO)}`;

const claimDe = (extra = {}) => assinar({
  colaborador_id: '11111111-1111-4111-8111-111111111111',
  perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(AGORA / 1000) + 3600,
  origem_claim: 'online',
  dispositivo_id: DISPOSITIVO_ID,
  ...extra,
}, SEGREDO);

// Sobe webhook + app na mesma porta, como no processo real (ADR 0042 §1).
async function comApp(opcoes, corpoDoTeste) {
  const chamadas = { sessoes: [], rpcs: [], telas: [], ingeridos: [] };

  const atenderApp = criarAtendenteApp({
    config,
    assinarClaim: (claim) => assinar(claim, SEGREDO),
    abrirSessao: opcoes.abrirSessao ?? (async (p) => {
      chamadas.sessoes.push(p);
      return {
        ok: true, colaborador_id: '11111111-1111-4111-8111-111111111111',
        nome: 'Paulo', perfil: 'atendente',
        turno_id: '22222222-2222-4222-8222-222222222222',
        exp: new Date(AGORA + 3600_000).toISOString(),
      };
    }),
    conferirDispositivo: opcoes.conferirDispositivo ?? (async (chave) => (chave === CHAVE
      ? { ok: true, id: DISPOSITIVO_ID, nome: 'Tablet Recepcao' }
      : { ok: false })),
    telas: opcoes.telas ?? {
      entrada: { semClaim: true, ler: async () => { chamadas.telas.push('entrada'); return { pessoas: [] }; } },
      home: { ler: async (s) => { chamadas.telas.push(s); return { saudacao: 'Bom dia, Paulo' }; } },
    },
    // Injetado: o limitador de verdade tem relógio, e teste com relógio real
    // vira teste lento e intermitente. Quem prova a janela é o teste do
    // criarLimitador, no webhook.
    limitar: opcoes.limitar,
    // Só montado quando o teste pede: sem isto, /admin/sessao responde 404, que
    // é o caso de um processo sem a metade do Admin.
    autenticarAdmin: opcoes.autenticarAdmin,
    assinarAdmin: opcoes.autenticarAdmin ? ((d) => assinarAdmin(d, SEGREDO)) : null,
    comSessao: opcoes.comSessao ?? (async (sessao, corpo) => {
      chamadas.rpcs.push(sessao);
      return corpo({ query: async (texto, valores) => {
        chamadas.rpcs.at(-1).sql = { texto, valores };
        return { rows: [{ id: 'comanda-nova' }] };
      } });
    }),
    aoErro: () => {},
    agora: () => AGORA,
  });

  const servidor = criarServidor({ atenderApp, ingerir: async (r) => { chamadas.ingeridos.push(r); } });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    await corpoDoTeste({ base, chamadas });
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

// Toda requisição sai do tablet registrado, salvo quando o teste pede o
// contrário com `semAparelho` — é o caso que precisa ser escrito, não o comum.
const pegar = async (url, { semAparelho = false, headers = {}, ...opcoes } = {}) => {
  const r = await fetch(url, {
    ...opcoes,
    headers: semAparelho ? headers : { 'x-lt-dispositivo': CHAVE, ...headers },
  });
  const texto = await r.text();
  return {
    codigo: r.status,
    corpo: texto === '' ? null : JSON.parse(texto),
    cookies: r.headers.getSetCookie?.() ?? [],
  };
};

test('a Entrada e lida sem claim — e ela que leva a claim', async () => {
  await comApp({}, async ({ base }) => {
    const r = await pegar(`${base}/tela/entrada`);
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.corpo, { pessoas: [] });
  });
});

test('as outras telas exigem claim no cabecalho, nao em cookie', async () => {
  await comApp({}, async ({ base }) => {
    assert.equal((await pegar(`${base}/tela/home`)).codigo, 401);

    const comCookie = await pegar(`${base}/tela/home`, { headers: { cookie: `claim=${claimDe()}` } });
    assert.equal(comCookie.codigo, 401);

    const comBearer = await pegar(`${base}/tela/home`, {
      headers: { authorization: `Bearer ${claimDe()}` } });
    assert.equal(comBearer.codigo, 200);
  });
});

test('a query string chega na tela como parametros, sem mudar a rota', async () => {
  let recebidos = null;
  const telas = {
    checklist: { ler: async (_s, parametros) => { recebidos = parametros; return {}; } },
  };
  await comApp({ telas }, async ({ base }) => {
    const r = await pegar(`${base}/tela/checklist?fase=saida`, {
      headers: { authorization: `Bearer ${claimDe()}` } });
    assert.equal(r.codigo, 200);
    assert.equal(recebidos.get('fase'), 'saida');
  });
});

test('claim expirada e 401, e o motivo diz qual foi', async () => {
  await comApp({}, async ({ base }) => {
    const velha = claimDe({ exp: Math.floor(AGORA / 1000) - 1 });
    const r = await pegar(`${base}/tela/home`, { headers: { authorization: `Bearer ${velha}` } });
    assert.equal(r.codigo, 401);
    assert.equal(r.corpo.erro, 'claim expirada');
  });
});

test('a origem da transacao sai do perfil da claim (ADR 0020 §1)', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    await pegar(`${base}/tela/home`, { headers: { authorization: `Bearer ${claimDe()}` } });
    assert.deepEqual(chamadas.telas.at(-1), {
      colaboradorId: '11111111-1111-4111-8111-111111111111', origem: 'atendente' });

    await pegar(`${base}/tela/home`, {
      headers: { authorization: `Bearer ${claimDe({ perfil: 'administrador' })}` } });
    assert.equal(chamadas.telas.at(-1).origem, 'admin');
  });
});

// ------------------------------------------------ o limite de /sessao (#78)
// O app.pin_bloqueado (ADR 0039 §3) bloqueia POR COLABORADOR, e /tela/entrada
// devolve a lista inteira sem claim: sem limite por origem, uma origem só queima
// 5 PINs errados de cada pessoa e trava a equipe — a "operação parada" que o §4
// daquele ADR chamou de incidente maior, alcançável de fora.
test('/sessao recusa com 429 quando a origem passa do limite', async () => {
  let n = 0;
  const corpo = { method: 'POST', body: JSON.stringify({ colaborador_id: 'x', pin: '1234' }) };

  await comApp({ limitar: () => ({ permitido: (n += 1) <= 2 }) }, async ({ base, chamadas }) => {
    assert.equal((await pegar(`${base}/sessao`, corpo)).codigo, 200);
    assert.equal((await pegar(`${base}/sessao`, corpo)).codigo, 200);

    const r = await pegar(`${base}/sessao`, corpo);
    assert.equal(r.codigo, 429);
    assert.equal(r.corpo.erro, 'excesso de tentativas');

    assert.equal(chamadas.sessoes.length, 2,
      'a recusada nem chega ao banco — e uma tentativa que nao vira linha');
  });
});

test('o limite NAO alcanca /tela nem /rpc — o quiosque bate nelas o turno inteiro', async () => {
  await comApp({ limitar: () => ({ permitido: false }) }, async ({ base }) => {
    assert.equal((await pegar(`${base}/tela/entrada`)).codigo, 200);
    assert.equal(
      (await pegar(`${base}/tela/home`, { headers: { authorization: `Bearer ${claimDe()}` } })).codigo,
      200);
  });
});

// ------------------------------------------------------- o IP da tentativa (#77)
test('o IP da requisicao vai pro banco junto do dispositivo', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    await pegar(`${base}/sessao`, {
      method: 'POST', body: JSON.stringify({ colaborador_id: 'x', pin: '1234' }) });

    assert.match(chamadas.sessoes[0].ip ?? '', /127\.0\.0\.1/,
      'sem ele toda tentativa tem a mesma cara: `dispositivo` e constante do processo');
  });
});

test('tela que nao existe e 404', async () => {
  await comApp({}, async ({ base }) => {
    assert.equal((await pegar(`${base}/tela/comanda`)).codigo, 404);
  });
});

test('POST /sessao devolve claim assinada, e nunca o PIN de volta', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/sessao`, {
      method: 'POST',
      body: JSON.stringify({ colaborador_id: '11111111-1111-4111-8111-111111111111', pin: '1234' }),
    });
    assert.equal(r.codigo, 200);
    assert.equal(r.corpo.nome, 'Paulo');
    assert.equal(JSON.stringify(r.corpo).includes('1234'), false);
    // O nome do aparelho vai pra tentativa_pin — o registrado, não uma
    // constante do processo (issue #77).
    assert.equal(chamadas.sessoes[0].dispositivo, 'Tablet Recepcao');

    // A claim emitida abre a Home na mesma hora.
    const home = await pegar(`${base}/tela/home`, {
      headers: { authorization: `Bearer ${r.corpo.claim}` } });
    assert.equal(home.codigo, 200);
  });
});

// app.sessao_abrir devolve {ok:false, motivo} em vez de levantar, pra não levar
// junto a linha de tentativa_pin (migration 0034). Quem traduz em 401 é aqui.
test('recusa do PIN vira 401 com o motivo do banco', async () => {
  await comApp({ abrirSessao: async () => ({ ok: false, motivo: 'bloqueado' }) },
    async ({ base }) => {
      const r = await pegar(`${base}/sessao`, {
        method: 'POST', body: JSON.stringify({ colaborador_id: 'x', pin: '0000' }) });
      assert.equal(r.codigo, 401);
      assert.equal(r.corpo.erro, 'bloqueado');
    });
});

test('RPC fora da allow-list e 404, nao 403', async () => {
  await comApp({}, async ({ base }) => {
    for (const nome of ['reconciliacao_laco2', 'competencia_trancar_automatica', 'comanda_fechar']) {
      const r = await pegar(`${base}/rpc/${nome}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${claimDe()}` },
        body: JSON.stringify({}),
      });
      assert.equal(r.codigo, 404, nome);
    }
  });
});

test('RPC da allow-list chama a funcao com o ator da claim', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/rpc/comanda_criar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${claimDe()}` },
      body: JSON.stringify({ agendamento_id: '33333333-3333-4333-8333-333333333333' }),
    });
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.corpo, { resultado: { id: 'comanda-nova' } });

    const { sql } = chamadas.rpcs.at(-1);
    assert.equal(sql.texto, 'select * from app.comanda_criar($1::uuid, $2::text, $3::uuid, $4::text)');
    assert.deepEqual(sql.valores, [
      '33333333-3333-4333-8333-333333333333', 'gerar_manual',
      '11111111-1111-4111-8111-111111111111', 'online']);
  });
});

test('RPC sem claim nem chega no banco', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/rpc/comanda_criar`, {
      method: 'POST', body: JSON.stringify({ agendamento_id: 'x' }) });
    assert.equal(r.codigo, 401);
    assert.equal(chamadas.rpcs.length, 0);
  });
});

// LT002..LT005 são recusa de domínio, escrita pra quem opera. 409, não 500.
test('recusa da FSM chega ao cliente com o texto do banco', async () => {
  const erro = Object.assign(new Error('agendamento ja tem Comanda'), { code: 'LT003' });
  await comApp({ comSessao: async () => { throw erro; } }, async ({ base }) => {
    const r = await pegar(`${base}/rpc/comanda_criar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${claimDe()}` },
      body: JSON.stringify({ agendamento_id: '33333333-3333-4333-8333-333333333333' }),
    });
    assert.equal(r.codigo, 409);
    assert.deepEqual(r.corpo, { erro: 'agendamento ja tem Comanda', code: 'LT003' });
  });
});

// 28000 é o GUC faltando (ADR 0020 §1) — bug nosso, não recusa de domínio. Vira
// 500 pra aparecer no log em vez de virar mensagem de tela.
test('erro que nao e do dominio nao vaza o interior do banco', async () => {
  const erro = Object.assign(new Error('app.colaborador_id nao definido'), { code: '28000' });
  await comApp({ comSessao: async () => { throw erro; } }, async ({ base }) => {
    const r = await pegar(`${base}/rpc/comanda_criar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${claimDe()}` },
      body: JSON.stringify({ agendamento_id: '33333333-3333-4333-8333-333333333333' }),
    });
    assert.equal(r.codigo, 500);
    assert.deepEqual(r.corpo, { erro: 'falha interna' });
  });
});

// ------------------------------------------------- o login do Admin (ADR 0047)
const entrarComoAdmin = {
  autenticarAdmin: async () => ({
    ok: true, colaborador_id: '11111111-1111-4111-8111-111111111111',
    nome: 'Jana', perfil: 'administrador',
  }),
};

test('POST /admin/sessao entra e o token vai SO no cookie', async () => {
  await comApp(entrarComoAdmin, async ({ base }) => {
    const r = await pegar(`${base}/admin/sessao`, {
      method: 'POST', body: JSON.stringify({ login: 'jana', senha: 'uma-senha-bem-longa' }) });

    assert.equal(r.codigo, 200);
    assert.equal(r.corpo.nome, 'Jana');

    const cookie = r.cookies.find((c) => c.startsWith(`${NOME_COOKIE}=`));
    assert.ok(cookie, 'o cookie de sessão sai no Set-Cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    // HttpOnly não serve de nada se a resposta entrega o mesmo valor pro
    // JavaScript da página ler.
    assert.equal(JSON.stringify(r.corpo).includes('eyJ'), false,
      'o token nao aparece no corpo da resposta');
  });
});

test('senha errada e 401 com o motivo do banco', async () => {
  await comApp({ autenticarAdmin: async () => ({ ok: false, motivo: 'invalido' }) },
    async ({ base }) => {
      const r = await pegar(`${base}/admin/sessao`, {
        method: 'POST', body: JSON.stringify({ login: 'jana', senha: 'errada' }) });
      assert.equal(r.codigo, 401);
      assert.equal(r.corpo.erro, 'invalido');
      assert.equal(r.cookies.length, 0, 'e nenhum cookie e emitido');
    });
});

test('o cookie do Admin autentica /tela, e a origem vira admin', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/tela/home`, { headers: { cookie: cookieAdmin() } });
    assert.equal(r.codigo, 200);
    assert.deepEqual(chamadas.telas.at(-1), {
      colaboradorId: '11111111-1111-4111-8111-111111111111', origem: 'admin' });
  });
});

// Um navegador com cookie não deve poder escolher qual identidade usar: se veio
// Bearer, é o Bearer que vale, e um Bearer ruim não "cai" no cookie.
test('Bearer tem precedencia sobre o cookie', async () => {
  await comApp({}, async ({ base }) => {
    const r = await pegar(`${base}/tela/home`, {
      headers: { authorization: 'Bearer nao-e-token', cookie: cookieAdmin() } });
    assert.equal(r.codigo, 401);
  });
});

test('DELETE /admin/sessao apaga o cookie', async () => {
  await comApp(entrarComoAdmin, async ({ base }) => {
    const r = await pegar(`${base}/admin/sessao`, { method: 'DELETE' });
    assert.equal(r.codigo, 200);
    assert.match(r.cookies[0], /^lt_admin=;/);
    assert.match(r.cookies[0], /Max-Age=0/);
  });
});

test('/admin/sessao entra no mesmo limite por origem do /sessao', async () => {
  await comApp({ ...entrarComoAdmin, limitar: () => ({ permitido: false }) }, async ({ base }) => {
    const r = await pegar(`${base}/admin/sessao`, {
      method: 'POST', body: JSON.stringify({ login: 'jana', senha: 'x' }) });
    assert.equal(r.codigo, 429);
  });
});

test('sem a metade do Admin montada, /admin/sessao e 404', async () => {
  await comApp({}, async ({ base }) => {
    assert.equal((await pegar(`${base}/admin/sessao`, { method: 'POST', body: '{}' })).codigo, 404);
  });
});

test('metodo errado e 405 em cada rota', async () => {
  await comApp({}, async ({ base }) => {
    assert.equal((await pegar(`${base}/sessao`)).codigo, 405);
    assert.equal((await pegar(`${base}/tela/entrada`, { method: 'POST', body: '{}' })).codigo, 405);
    assert.equal((await pegar(`${base}/rpc/comanda_criar`, {
      headers: { authorization: `Bearer ${claimDe()}` } })).codigo, 405);
  });
});

// O ponto do ADR 0042 §1: montar o app não pode mudar o webhook. O caminho do
// receptor continua respondendo como antes, e a requisição continua indo pro log.
test('montar o app nao muda o que a porta do webhook responde', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/webhook/altegio/${TOKEN_MINIMO_PARA_TESTE}`, {
      method: 'POST', body: '{"resource":"record"}' });
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.corpo, { ok: true });
    assert.equal(chamadas.ingeridos.length, 1);

    // E o que não é do webhook nem do app continua sendo 404 sem virar linha.
    assert.equal((await pegar(`${base}/qualquer-coisa`)).codigo, 404);
    assert.equal(chamadas.ingeridos.length, 1);
  });
});

// ------------------------------------------------ o tablet registrado (ADR 0048)
test('sem a chave do tablet a Entrada nao entrega a lista da equipe (#78)', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const sem = await pegar(`${base}/tela/entrada`, { semAparelho: true });
    assert.equal(sem.codigo, 401);
    assert.equal(sem.corpo.erro, 'dispositivo nao registrado');

    const errada = await pegar(`${base}/tela/entrada`, { semAparelho: true, headers: { 'x-lt-dispositivo': 'outra' } });
    assert.equal(errada.codigo, 401);
    assert.deepEqual(chamadas.telas, [], 'a consulta nem roda');
  });
});

test('sem a chave do tablet /sessao nao confere PIN (#78)', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await pegar(`${base}/sessao`, {
      semAparelho: true, method: 'POST', body: JSON.stringify({ colaborador_id: 'x', pin: '1234' }) });
    assert.equal(r.codigo, 401);
    assert.deepEqual(chamadas.sessoes, [], 'o banco nem e consultado: nenhuma tentativa, nenhum bloqueio');
  });
});

test('claim emitida num tablet nao vale em outro aparelho', async () => {
  await comApp({}, async ({ base }) => {
    const deOutro = claimDe({ dispositivo_id: '44444444-4444-4444-8444-444444444444' });
    const r = await pegar(`${base}/tela/home`, { headers: { authorization: `Bearer ${deOutro}` } });
    assert.equal(r.codigo, 401);

    const semChave = await pegar(`${base}/rpc/comanda_criar`, {
      semAparelho: true, method: 'POST',
      headers: { authorization: `Bearer ${claimDe()}` }, body: JSON.stringify({ agendamento_id: 'a' }) });
    assert.equal(semChave.codigo, 401, 'claim certa copiada pra fora do tablet nao escreve');
  });
});

// ------------------------------------------------------- PIN so atendente (0049)
test('/sessao nao emite claim para quem nao e atendente, mesmo se o banco deixar', async () => {
  const abrirSessao = async () => ({
    ok: true, colaborador_id: '11111111-1111-4111-8111-111111111111', nome: 'Jana', perfil: 'administrador',
    turno_id: '22222222-2222-4222-8222-222222222222', exp: new Date(AGORA + 3600_000).toISOString(),
  });
  await comApp({ abrirSessao }, async ({ base }) => {
    const r = await pegar(`${base}/sessao`, {
      method: 'POST', body: JSON.stringify({ colaborador_id: 'x', pin: '1234' }) });
    assert.equal(r.codigo, 401);
    assert.equal(r.corpo.erro, 'pin_invalido');
    assert.equal(r.corpo.claim, undefined);
  });
});

test('o cookie do Admin vale sem chave de tablet: ele entra pelo computador', async () => {
  await comApp({}, async ({ base }) => {
    const r = await pegar(`${base}/tela/home`, { semAparelho: true, headers: { cookie: cookieAdmin() } });
    assert.equal(r.codigo, 200);
  });
});

// O processo inteiro num import só. Existe porque nenhum teste tocava em
// src/api/index.mjs nem em transacao.mjs: uma crase dentro de comentário de SQL
// (que mora em template literal) derrubou o boot com a suíte toda verde. Erro de
// sintaxe em qualquer módulo do lado-app estoura aqui, não no tablet.
test('o app monta com as telas e as RPC que o processo publica', async () => {
  const { montarApp } = await import('../../src/api/index.mjs');
  const app = montarApp({
    pool: { connect: async () => { throw new Error('nao conecta neste teste'); } },
    env: { LT_CLAIM_SEGREDO: SEGREDO, LT_WEBHOOK_TOKEN: TOKEN_MINIMO_PARA_TESTE },
    aoErro: () => {},
  });
  assert.equal(typeof app, 'function');
});
