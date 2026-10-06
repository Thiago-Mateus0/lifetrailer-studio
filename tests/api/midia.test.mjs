// A rota de mídia (ADR 0051). Sem banco: `comSessao` e o armazenamento são
// injetados. Quem prova o que a função do banco faz é tests/db/40; aqui se
// prova a fronteira — quem entra, o que é recusado antes de gravar bytes, e que
// o endereço assinado serve UMA foto e por prazo.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assinarAdmin, NOME_COOKIE } from '../../src/api/admin.mjs';
import { armazenamentoEmDisco } from '../../src/api/armazenamento.mjs';
import { assinar } from '../../src/api/claim.mjs';
import { chaveDaMidia, enderecoConfere, enderecoDaMidia, TETO_BYTES } from '../../src/api/midia.mjs';
import { criarAtendenteApp } from '../../src/api/servidor.mjs';
import { criarServidor } from './_ajuda.mjs';

const SEGREDO = 's'.repeat(32);
const CHAVE = 'chave-do-tablet-de-teste';
const DISPOSITIVO_ID = '33333333-3333-4333-8333-333333333333';
const MARCOS = '11111111-1111-4111-8111-111111111111';
const AGORA = Date.UTC(2026, 8, 16, 14, 0, 0);

const ITEM = '44444444-4444-4444-8444-444444444444';
const MIDIA = '55555555-5555-4555-8555-555555555555';

const config = {
  segredo: SEGREDO, dispositivo: 'Tablet 01', local: 'Recepção', versao: 'teste',
  cookieSeguro: false,
};

const claim = assinar({
  colaborador_id: MARCOS, perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(AGORA / 1000) + 3600, origem_claim: 'online',
  dispositivo_id: DISPOSITIVO_ID,
}, SEGREDO);

const cookie = `${NOME_COOKIE}=${assinarAdmin({
  colaborador_id: MARCOS, perfil: 'administrador', exp: Math.floor(AGORA / 1000) + 3600,
}, SEGREDO)}`;

// Armazenamento de mentira, com a mesma superfície de dois métodos do de disco.
// `falharAoGuardar` existe porque a ordem "bytes antes da linha" (ADR 0051 §8)
// só é observável quando a gravação falha.
function armazenamentoDeTeste({ falharAoGuardar = false, arquivos = new Map() } = {}) {
  return {
    arquivos,
    async guardar(chaveArquivo, bytes) {
      if (falharAoGuardar) throw new Error('disco cheio');
      arquivos.set(chaveArquivo, bytes);
    },
    async ler(chaveArquivo) {
      return arquivos.get(chaveArquivo) ?? null;
    },
  };
}

async function comApp(opcoes, corpoDoTeste) {
  const chamadas = { sql: [] };
  const armazenamento = opcoes.armazenamento ?? armazenamentoDeTeste();

  const atenderApp = criarAtendenteApp({
    config,
    assinarClaim: (c) => assinar(c, SEGREDO),
    abrirSessao: async () => ({ ok: false, motivo: 'nao usado aqui' }),
    conferirDispositivo: async (c) => (c === CHAVE
      ? { ok: true, id: DISPOSITIVO_ID, nome: 'Tablet Recepcao' }
      : { ok: false }),
    telas: {},
    comSessao: opcoes.comSessao ?? (async (sessao, corpo) => corpo({
      query: async (texto, valores) => {
        chamadas.sql.push({ sessao, texto, valores });
        // A função do banco devolve a linha de `midia`; o id é o que o servidor
        // passou, porque é ele quem o gera (a chave o contém).
        return { rows: [{ id: valores[0], tamanho_bytes: valores[4] }] };
      },
    })),
    armazenamento: opcoes.semArmazenamento ? null : armazenamento,
    lerMidia: opcoes.semArmazenamento ? null : (opcoes.lerMidia ?? (async () => null)),
    aoErro: () => {},
    agora: () => AGORA,
  });

  const servidor = criarServidor({ atenderApp, ingerir: async () => {} });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    await corpoDoTeste({ base, chamadas, armazenamento });
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

const JPEG = Buffer.from('nao e um jpeg de verdade, e sao bytes');

const enviar = (base, { busca = `?ativo=item_execucao&registro=${ITEM}`, tipo = 'image/jpeg',
  corpo = JPEG, autorizacao = `Bearer ${claim}`, aparelho = CHAVE, cabecalhos = {} } = {}) =>
  fetch(`${base}/midia${busca}`, {
    method: 'POST',
    headers: {
      ...(tipo === null ? {} : { 'content-type': tipo }),
      ...(autorizacao === null ? {} : { authorization: autorizacao }),
      ...(aparelho === null ? {} : { 'x-lt-dispositivo': aparelho }),
      ...cabecalhos,
    },
    body: corpo,
  });

const ler = async (r) => {
  const texto = await r.text();
  return texto === '' ? null : JSON.parse(texto);
};

// ------------------------------------------------------------------- envio
test('POST /midia: grava os bytes, registra a linha e devolve o endereco assinado', async () => {
  await comApp({}, async ({ base, chamadas, armazenamento }) => {
    const r = await enviar(base, { busca: `?ativo=item_execucao&registro=${ITEM}&compressao=lt1` });
    assert.equal(r.status, 201);

    const corpo = await ler(r);
    assert.match(corpo.endereco, new RegExp(`^/midia/${corpo.midia_id}\\?t=`));
    assert.equal(corpo.bytes, JPEG.length);

    // Os bytes foram pro storage sob a chave <ano>/<mes>/<id>.jpg, em Maceió.
    assert.deepEqual([...armazenamento.arquivos.keys()], [`2026/09/${corpo.midia_id}.jpg`]);
    assert.equal(armazenamento.arquivos.get(`2026/09/${corpo.midia_id}.jpg`).toString(), JPEG.toString());

    // O ator e a origem vêm da CLAIM, nunca da query string.
    const { texto, valores, sessao } = chamadas.sql[0];
    assert.match(texto, /app\.midia_registrar\(/);
    assert.deepEqual(valores.slice(1), [
      'item_execucao', ITEM, `2026/09/${corpo.midia_id}.jpg`, JPEG.length,
      'image/jpeg', 'lt1', MARCOS, 'online',
    ]);
    assert.deepEqual(sessao, { colaboradorId: MARCOS, origem: 'atendente' });
  });
});

test('POST /midia: o Admin envia por cookie, sem aparelho registrado', async () => {
  await comApp({}, async ({ base, chamadas }) => {
    const r = await enviar(base, { autorizacao: null, aparelho: null, cabecalhos: { cookie } });
    assert.equal(r.status, 201);
    assert.deepEqual(chamadas.sql[0].sessao, { colaboradorId: MARCOS, origem: 'admin' });
  });
});

test('POST /midia: sem claim e sem aparelho nao entra', async () => {
  await comApp({}, async ({ base, armazenamento }) => {
    assert.equal((await enviar(base, { autorizacao: null })).status, 401);
    assert.equal((await enviar(base, { aparelho: 'outra-chave' })).status, 401);
    assert.equal(armazenamento.arquivos.size, 0);
  });
});

test('POST /midia: so image/jpeg entra (ADR 0026 §3)', async () => {
  await comApp({}, async ({ base, armazenamento }) => {
    assert.equal((await enviar(base, { tipo: 'image/webp' })).status, 415);
    assert.equal((await enviar(base, { tipo: 'application/json' })).status, 415);
    assert.equal((await enviar(base, { tipo: null })).status, 415);
    // `image/jpeg; charset=x` continua sendo image/jpeg.
    assert.equal((await enviar(base, { tipo: 'image/jpeg; charset=binary' })).status, 201);
    assert.equal(armazenamento.arquivos.size, 1);
  });
});

test('POST /midia: ativo fora da lista e registro que nao e uuid sao recusados ANTES dos bytes', async () => {
  await comApp({}, async ({ base, chamadas, armazenamento }) => {
    // `colaborador` está fora de propósito: nenhuma tela troca foto de ninguém.
    assert.equal((await enviar(base, { busca: `?ativo=colaborador&registro=${ITEM}` })).status, 400);
    assert.equal((await enviar(base, { busca: `?ativo=comanda&registro=${ITEM}` })).status, 400);
    assert.equal((await enviar(base, { busca: '?ativo=achado&registro=nao-uuid' })).status, 400);
    assert.equal((await enviar(base, { busca: '?ativo=achado' })).status, 400);
    assert.equal((await enviar(base, { busca: `?ativo=achado&registro=${ITEM}&compressao=nao pode ter espaço` })).status, 400);

    assert.equal(armazenamento.arquivos.size, 0, 'nada foi gravado no storage');
    assert.equal(chamadas.sql.length, 0, 'e o banco nao foi chamado');
  });
});

test('POST /midia: foto acima do teto do ADR 0026 leva 413, e vazia tambem nao passa', async () => {
  await comApp({}, async ({ base, armazenamento }) => {
    const grande = Buffer.alloc(TETO_BYTES + 1, 7);
    const r = await enviar(base, { corpo: grande });
    assert.equal(r.status, 413);
    assert.equal((await ler(r)).erro, 'foto grande demais');

    assert.equal((await enviar(base, { corpo: Buffer.alloc(0) })).status, 413);
    assert.equal(armazenamento.arquivos.size, 0);
  });
});

test('POST /midia: recusa do dominio vira 409 e o arquivo fica orfao, nao a linha quebrada', async () => {
  const armazenamento = armazenamentoDeTeste();
  const comSessao = async () => {
    const erro = new Error('este item ja tem foto; correcao anexa nova');
    erro.code = 'LT002';
    throw erro;
  };
  await comApp({ armazenamento, comSessao }, async ({ base }) => {
    const r = await enviar(base);
    assert.equal(r.status, 409);
    assert.deepEqual(await ler(r), { erro: 'este item ja tem foto; correcao anexa nova', code: 'LT002' });
    // O preço escrito no ADR 0051 §8: arquivo que ninguém referencia é lixo
    // barato; referência quebrada seria dado mentiroso.
    assert.equal(armazenamento.arquivos.size, 1);
  });
});

// ------------------------------------------------ o id da fila (ADR 0072 §3)
test('POST /midia: o id do tablet vira o id da midia e a chave no storage', async () => {
  await comApp({}, async ({ base, chamadas, armazenamento }) => {
    const r = await enviar(base, { busca: `?ativo=item_execucao&registro=${ITEM}&id=${MIDIA}` });
    assert.equal(r.status, 201);
    assert.equal((await ler(r)).midia_id, MIDIA);
    assert.equal(chamadas.sql[0].valores[0], MIDIA);
    assert.deepEqual([...armazenamento.arquivos.keys()], [`2026/09/${MIDIA}.jpg`]);
  });
});

test('POST /midia: o reenvio com bytes ja guardados nao regrava, e o banco decide', async () => {
  // O storage de disco é write-once ('wx'): regravar a mesma chave daria 503 pra
  // sempre, e a foto que já chegou ficaria parada na fila.
  const arquivos = new Map([[`2026/09/${MIDIA}.jpg`, JPEG]]);
  const armazenamento = { ...armazenamentoDeTeste({ arquivos }), guardar: async () => { throw new Error('ja existe'); } };
  await comApp({ armazenamento }, async ({ base, chamadas }) => {
    const r = await enviar(base, { busca: `?ativo=item_execucao&registro=${ITEM}&id=${MIDIA}` });
    assert.equal(r.status, 201);
    assert.equal(chamadas.sql.length, 1, 'o midia_registrar e chamado e devolve a linha que existe');
  });
});

test('POST /midia: id que nao e uuid e recusado antes dos bytes', async () => {
  await comApp({}, async ({ base, chamadas, armazenamento }) => {
    const r = await enviar(base, { busca: `?ativo=item_execucao&registro=${ITEM}&id=../../etc` });
    assert.equal(r.status, 400);
    assert.equal(armazenamento.arquivos.size, 0);
    assert.equal(chamadas.sql.length, 0);
  });
});

test('POST /midia: storage que falha nao deixa linha nascer', async () => {
  const armazenamento = armazenamentoDeTeste({ falharAoGuardar: true });
  await comApp({ armazenamento }, async ({ base, chamadas }) => {
    assert.equal((await enviar(base)).status, 503);
    assert.equal(chamadas.sql.length, 0, 'o banco nao foi chamado');
  });
});

test('/midia sem armazenamento montado responde 404, nao 500', async () => {
  await comApp({ semArmazenamento: true }, async ({ base }) => {
    assert.equal((await enviar(base)).status, 404);
    assert.equal((await fetch(`${base}/midia/${MIDIA}?t=x`)).status, 404);
  });
});

test('/midia recusa metodo que nao e o dela', async () => {
  await comApp({}, async ({ base }) => {
    assert.equal((await fetch(`${base}/midia`, { method: 'GET' })).status, 405);
    assert.equal((await fetch(`${base}/midia/${MIDIA}`, { method: 'DELETE' })).status, 405);
  });
});

// ------------------------------------------------------------------ leitura
const comFoto = (bytes = JPEG, { url = '2026/09/foto.jpg', expirada = null } = {}) => {
  const arquivos = new Map(bytes === null ? [] : [[url, bytes]]);
  return {
    armazenamento: armazenamentoDeTeste({ arquivos }),
    lerMidia: async () => ({ url, mime: 'image/jpeg', expirada_em: expirada }),
  };
};

test('GET /midia/<id>: o endereco assinado serve os bytes, sem claim nenhuma', async () => {
  await comApp(comFoto(), async ({ base }) => {
    // Sem Authorization e sem x-lt-dispositivo de propósito: é o que um
    // `<img src>` manda — nada.
    const r = await fetch(`${base}${enderecoDaMidia(MIDIA, SEGREDO, () => AGORA)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /private/);
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), JPEG.toString());
  });
});

test('GET /midia/<id>: sem token, com token de outra foto, ou vencido, nao serve', async () => {
  await comApp(comFoto(), async ({ base }) => {
    assert.equal((await fetch(`${base}/midia/${MIDIA}`)).status, 401);
    assert.equal((await fetch(`${base}/midia/${MIDIA}?t=inventado`)).status, 401);

    // Token válido, de OUTRA mídia: sem a conferência do id, um endereço servia
    // pra buscar qualquer foto.
    const deOutra = enderecoDaMidia(ITEM, SEGREDO, () => AGORA).split('?t=')[1];
    assert.equal((await fetch(`${base}/midia/${MIDIA}?t=${deOutra}`)).status, 401);

    // Assinado com outro segredo.
    const forjado = enderecoDaMidia(MIDIA, 'x'.repeat(32), () => AGORA).split('?t=')[1];
    assert.equal((await fetch(`${base}/midia/${MIDIA}?t=${forjado}`)).status, 401);

    // Vencido: emitido meia hora e um segundo antes do agora do servidor.
    const vencido = enderecoDaMidia(MIDIA, SEGREDO, () => AGORA - 1801_000).split('?t=')[1];
    assert.equal((await fetch(`${base}/midia/${MIDIA}?t=${vencido}`)).status, 401);
  });
});

test('GET /midia/<id>: midia que nao existe e 404; midia expirada e 410 (ADR 0036 §2)', async () => {
  await comApp({ lerMidia: async () => null }, async ({ base }) => {
    const r = await fetch(`${base}${enderecoDaMidia(MIDIA, SEGREDO, () => AGORA)}`);
    assert.equal(r.status, 404);
  });

  await comApp(comFoto(JPEG, { expirada: new Date().toISOString() }), async ({ base }) => {
    const r = await fetch(`${base}${enderecoDaMidia(MIDIA, SEGREDO, () => AGORA)}`);
    assert.equal(r.status, 410);
    assert.equal((await ler(r)).erro, 'a foto expirou');
  });
});

test('GET /midia/<id>: linha viva com arquivo ausente e bug nosso — 500, nao 404', async () => {
  await comApp(comFoto(null), async ({ base }) => {
    const r = await fetch(`${base}${enderecoDaMidia(MIDIA, SEGREDO, () => AGORA)}`);
    assert.equal(r.status, 500);
  });
});

// ------------------------------------------------------------------- peças
test('o endereco assinado confere o id e o prazo', () => {
  const token = enderecoDaMidia(MIDIA, SEGREDO, () => AGORA).split('?t=')[1];
  assert.equal(enderecoConfere(MIDIA, token, SEGREDO, () => AGORA), true);
  assert.equal(enderecoConfere(ITEM, token, SEGREDO, () => AGORA), false);
  assert.equal(enderecoConfere(MIDIA, token, 'x'.repeat(32), () => AGORA), false);
  assert.equal(enderecoConfere(MIDIA, token, SEGREDO, () => AGORA + 1801_000), false);
  assert.equal(enderecoConfere(MIDIA, '', SEGREDO, () => AGORA), false);
});

test('a chave no storage e o mes de Maceio, nao o do servidor', () => {
  // 1º de janeiro de 2027, 01:00 UTC, é ainda 31 de dezembro de 2026 em Maceió:
  // a foto pertence a dezembro, que é a competência que a retenção vai apagar.
  assert.equal(chaveDaMidia(MIDIA, new Date(Date.UTC(2027, 0, 1, 1, 0, 0))), `2026/12/${MIDIA}.jpg`);
  assert.equal(chaveDaMidia(MIDIA, new Date(Date.UTC(2026, 8, 16, 14, 0, 0))), `2026/09/${MIDIA}.jpg`);
});

// ------------------------------------------------------ o armazenamento real
// O de disco (ADR 0051 §1) — o único que existe hoje. Numa pasta temporária: o
// que se prova é o contrato dos dois métodos, e o R2 vai ter de passar no mesmo.
test('armazenamento em disco: guarda, le, e nao sobrescreve', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'lt-midia-'));
  const disco = armazenamentoEmDisco(raiz);

  await disco.guardar('2026/09/foto.jpg', JPEG);
  assert.equal((await disco.ler('2026/09/foto.jpg')).toString(), JPEG.toString());

  // Arquivo ausente é resposta, não exceção: quem chama decide se é 404.
  assert.equal(await disco.ler('2026/09/nao-existe.jpg'), null);

  // Write-once do lado do arquivo: a segunda gravação na mesma chave falha em
  // vez de perder a foto que já estava lá.
  await assert.rejects(() => disco.guardar('2026/09/foto.jpg', Buffer.from('outra')));

  // Chave que tentasse sair da pasta não chega ao disco.
  await assert.rejects(() => disco.guardar('../fora.jpg', JPEG), /suspeita/);
  await assert.rejects(() => disco.ler('/etc/passwd'), /suspeita/);

  await rm(raiz, { recursive: true, force: true });
});
