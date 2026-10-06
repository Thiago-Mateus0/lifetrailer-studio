// A rota do comprovante (ADR 0073 §3–§4). Sem banco: a leitura da Comanda e o
// armazenamento são injetados. Aqui se prova a fronteira: só o Admin sobe, o
// arquivo é reaproveitado enquanto a Comanda não muda, e o link vale 30 dias.
import assert from 'node:assert/strict';
import test from 'node:test';

import { assinarAdmin, NOME_COOKIE } from '../../src/api/admin.mjs';
import { assinar } from '../../src/api/claim.mjs';
import {
  chaveDoComprovante, envioDoComprovante, idDoComprovante, LINK_SEGUNDOS, linkDoComprovante,
} from '../../src/api/comprovante.mjs';
import { criarAtendenteApp } from '../../src/api/servidor.mjs';
import { criarServidor } from './_ajuda.mjs';

const SEGREDO = 's'.repeat(32);
const CHAVE = 'chave-do-tablet-de-teste';
const DISPOSITIVO_ID = '33333333-3333-4333-8333-333333333333';
const JANA = '11111111-1111-4111-8111-111111111111';
const COMANDA = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.UTC(2026, 8, 26, 14, 0, 0);
// 23h de 30/set em Maceió já é 1º/out em UTC: a pasta é a de setembro.
const FECHADO_EM = '2026-10-01T02:00:00Z';

const config = { segredo: SEGREDO, cookieSeguro: false };
const PDF = Buffer.from('%PDF-1.3 conteudo de teste');

const cookie = `${NOME_COOKIE}=${assinarAdmin({
  colaborador_id: JANA, perfil: 'administrador', exp: Math.floor(AGORA / 1000) + 3600,
}, SEGREDO)}`;

const claim = assinar({
  colaborador_id: JANA, perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(AGORA / 1000) + 3600, origem_claim: 'online',
  dispositivo_id: DISPOSITIVO_ID,
}, SEGREDO);

async function comApp({ comanda = { status: 'fechada', fechado_em: FECHADO_EM, envios: 0 }, agora = AGORA,
  arquivos = new Map() } = {}, corpoDoTeste) {
  const sessoes = [];
  const atenderApp = criarAtendenteApp({
    config,
    assinarClaim: (c) => assinar(c, SEGREDO),
    abrirSessao: async () => ({ ok: false }),
    conferirDispositivo: async (c) => (c === CHAVE ? { ok: true, id: DISPOSITIVO_ID, nome: 'Tablet' } : { ok: false }),
    telas: {},
    comSessao: async (sessao, corpo) => {
      sessoes.push(sessao);
      return corpo({ query: async () => ({ rows: comanda === null ? [] : [comanda] }) });
    },
    armazenamento: {
      async guardar(chave, bytes) {
        if (arquivos.has(chave)) throw new Error('write-once');
        arquivos.set(chave, bytes);
      },
      async ler(chave) { return arquivos.get(chave) ?? null; },
    },
    aoErro: () => {},
    agora: () => agora,
  });

  const servidor = criarServidor({ atenderApp, ingerir: async () => {} });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    await corpoDoTeste({ base, arquivos, sessoes });
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

const subir = (base, { cabecalhos = { cookie }, tipo = 'application/pdf', corpo = PDF, comanda = COMANDA } = {}) =>
  fetch(`${base}/comprovante?comanda=${comanda}`, {
    method: 'POST', headers: { 'content-type': tipo, ...cabecalhos }, body: corpo,
  });

test('POST /comprovante: o Admin sobe o PDF e recebe o link de 30 dias', async () => {
  await comApp({}, async ({ base, arquivos, sessoes }) => {
    const r = await subir(base);
    assert.equal(r.status, 201);
    const corpo = await r.json();

    const id = `${COMANDA}-1-${Date.parse(FECHADO_EM) / 1000}`;
    assert.equal(corpo.comprovante_id, id);
    assert.equal(corpo.envio, 1);
    assert.match(corpo.link, new RegExp(`^/comprovante/${id}\\?t=`));
    assert.deepEqual([...arquivos.keys()], [`comprovante/2026/09/${id}.pdf`]);
    assert.deepEqual(sessoes[0], { colaboradorId: JANA, origem: 'admin' });
  });
});

test('POST /comprovante: a claim do tablet nao sobe comprovante (ADR 0073 §1)', async () => {
  await comApp({}, async ({ base, arquivos }) => {
    const r = await subir(base, { cabecalhos: { authorization: `Bearer ${claim}`, 'x-lt-dispositivo': CHAVE } });
    assert.equal(r.status, 403);
    assert.equal((await subir(base, { cabecalhos: {} })).status, 401);
    assert.equal(arquivos.size, 0);
  });
});

test('POST /comprovante: so PDF, so uuid, so Comanda fechada ou enviada', async () => {
  await comApp({}, async ({ base, arquivos }) => {
    assert.equal((await subir(base, { tipo: 'image/jpeg' })).status, 415);
    assert.equal((await subir(base, { corpo: Buffer.from('nao e pdf') })).status, 415);
    assert.equal((await subir(base, { comanda: 'x' })).status, 400);
    assert.equal(arquivos.size, 0);
  });
  await comApp({ comanda: { status: 'aberta', fechado_em: null, envios: 0 } }, async ({ base }) => {
    assert.equal((await subir(base)).status, 409);
  });
  await comApp({ comanda: null }, async ({ base }) => {
    assert.equal((await subir(base)).status, 404);
  });
});

test('copiar de novo reaproveita o arquivo; Enviei nao troca o comprovante daquele envio', async () => {
  const arquivos = new Map();
  await comApp({ arquivos }, async ({ base }) => {
    assert.equal((await subir(base)).status, 201);
    assert.equal((await subir(base, { corpo: Buffer.from('%PDF-outro') })).status, 201);
  });
  // Depois do Enviei: Enviada com 1 envio aponta para o mesmo PDF.
  await comApp({ arquivos, comanda: { status: 'enviada', fechado_em: FECHADO_EM, envios: 1 } }, async ({ base }) => {
    const corpo = await (await subir(base, { corpo: Buffer.from('%PDF-terceiro') })).json();
    assert.equal(corpo.envio, 1);
  });
  assert.equal(arquivos.size, 1);
  assert.equal([...arquivos.values()][0].toString(), PDF.toString());
});

test('o envio do comprovante: Fechada e o proximo, Enviada e o ultimo', () => {
  assert.equal(envioDoComprovante('fechada', 0), 1);
  assert.equal(envioDoComprovante('fechada', 1), 2);
  assert.equal(envioDoComprovante('enviada', 1), 1);
  assert.equal(envioDoComprovante('aberta', 0), null);
  assert.equal(envioDoComprovante('cancelada', 1), null);
  // Reabrir e fechar muda fechado_em, e com ele o arquivo.
  assert.notEqual(idDoComprovante(COMANDA, 1, FECHADO_EM), idDoComprovante(COMANDA, 1, '2026-10-02T12:00:00Z'));
});

test('GET /comprovante/<id>: o link serve o PDF sem sessao nenhuma', async () => {
  const id = idDoComprovante(COMANDA, 1, FECHADO_EM);
  const arquivos = new Map([[chaveDoComprovante(id), PDF]]);
  await comApp({ arquivos }, async ({ base }) => {
    const r = await fetch(`${base}${linkDoComprovante(id, SEGREDO, () => AGORA)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), PDF.toString());
  });
});

test('GET /comprovante/<id>: depois de 30 dias responde 410 com a pagina curta', async () => {
  const id = idDoComprovante(COMANDA, 1, FECHADO_EM);
  const arquivos = new Map([[chaveDoComprovante(id), PDF]]);
  const link = linkDoComprovante(id, SEGREDO, () => AGORA);
  await comApp({ arquivos, agora: AGORA + LINK_SEGUNDOS * 1000 - 1000 }, async ({ base }) => {
    assert.equal((await fetch(`${base}${link}`)).status, 200);
  });
  await comApp({ arquivos, agora: AGORA + LINK_SEGUNDOS * 1000 }, async ({ base }) => {
    const r = await fetch(`${base}${link}`);
    assert.equal(r.status, 410);
    assert.match(await r.text(), /Peça o comprovante de novo ao estúdio/);
  });
  // Vencer o link não apaga o arquivo (ADR 0073 §3).
  assert.equal(arquivos.size, 1);
});

test('GET /comprovante/<id>: sem token, forjado ou de outro comprovante nao serve', async () => {
  const id = idDoComprovante(COMANDA, 1, FECHADO_EM);
  const outro = idDoComprovante(COMANDA, 2, FECHADO_EM);
  const arquivos = new Map([[chaveDoComprovante(id), PDF], [chaveDoComprovante(outro), PDF]]);
  await comApp({ arquivos }, async ({ base }) => {
    assert.equal((await fetch(`${base}/comprovante/${id}`)).status, 404);
    const forjado = linkDoComprovante(id, 'x'.repeat(32), () => AGORA).split('?t=')[1];
    assert.equal((await fetch(`${base}/comprovante/${id}?t=${forjado}`)).status, 404);
    const deOutro = linkDoComprovante(outro, SEGREDO, () => AGORA).split('?t=')[1];
    assert.equal((await fetch(`${base}/comprovante/${id}?t=${deOutro}`)).status, 404);
    assert.equal((await fetch(`${base}/comprovante/..%2F..%2Fetc?t=${deOutro}`)).status, 404);
  });
});
