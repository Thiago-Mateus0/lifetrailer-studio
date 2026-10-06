// O job de backup sem banco e sem R2: pool, pg_dump e fetch são falsos. O que
// o banco decide (camadas, alerta de duas falhas) está em tests/db/62_backup.sql.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assinar,
  chaveDoDump,
  criarBackup,
  criarDespejo,
  criarGravadorR2,
  lerConfigBackup,
} from '../../src/jobs/backup.mjs';

// ----------------------------------------------------------------- SigV4
// Os dois exemplos da documentação da AWS ("Signature Calculations for the
// Authorization Header"). Se a assinatura bate aqui, bate no R2.
const EXEMPLO = {
  chaveId: 'AKIAIOSFODNN7EXAMPLE',
  segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  regiao: 'us-east-1',
  instante: new Date('2013-05-24T00:00:00Z'),
};

test('SigV4: o exemplo GET Object da AWS', () => {
  const c = assinar({
    ...EXEMPLO,
    metodo: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    cabecalhos: { Range: 'bytes=0-9' },
    hashDoCorpo: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  });
  assert.match(c.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.match(c.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('SigV4: o exemplo PUT Object da AWS, com caractere que se codifica no caminho', () => {
  const c = assinar({
    ...EXEMPLO,
    metodo: 'PUT',
    url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
    cabecalhos: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    hashDoCorpo: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
  });
  assert.match(c.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

// ------------------------------------------------------------------- nomes
test('a chave leva camada e instante UTC ate o minuto (ADR 0074 §2)', () => {
  const t = new Date('2026-09-26T13:00:12.345Z');
  assert.equal(chaveDoDump('horario', t), 'horario/2026-09-26T13-00Z.dump');
  assert.equal(chaveDoDump('mensal', new Date('2026-10-01T03:07:00Z')), 'mensal/2026-10-01T03-07Z.dump');
});

test('config: sem credencial nao ha job, e o erro diz o que falta', () => {
  assert.throws(() => lerConfigBackup({ LT_BACKUP_DATABASE_URL: 'postgres://x' }), /LT_BACKUP_R2_ENDPOINT/);
  const c = lerConfigBackup({
    LT_BACKUP_DATABASE_URL: 'postgres://x',
    LT_BACKUP_R2_ENDPOINT: 'https://conta.r2.cloudflarestorage.com/',
    LT_BACKUP_R2_ACCESS_KEY_ID: 'id',
    LT_BACKUP_R2_SECRET_ACCESS_KEY: 'segredo',
  });
  assert.equal(c.endpoint, 'https://conta.r2.cloudflarestorage.com');
  assert.equal(c.bucket, 'lifetrailer-backup');
});

// --------------------------------------------------------------------- PUT
test('o PUT vai assinado, com If-None-Match — nunca sobrescreve', async () => {
  const pedidos = [];
  const gravar = criarGravadorR2({
    endpoint: 'https://conta.r2.cloudflarestorage.com',
    bucket: 'lifetrailer-backup',
    chaveId: 'id',
    segredo: 'segredo',
    agora: () => Date.parse('2026-09-26T13:00:00Z'),
    buscar: async (url, init) => {
      pedidos.push({ url, init });
      return { ok: true, status: 200 };
    },
  });
  await gravar('horario/2026-09-26T13-00Z.dump', Buffer.from('PGDMP...'));

  assert.equal(pedidos[0].url, 'https://conta.r2.cloudflarestorage.com/lifetrailer-backup/horario/2026-09-26T13-00Z.dump');
  assert.equal(pedidos[0].init.method, 'PUT');
  assert.equal(pedidos[0].init.headers['if-none-match'], '*');
  assert.match(pedidos[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=id\/20260926\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;if-none-match;/);
});

test('resposta de erro do R2 vira excecao com o status', async () => {
  const gravar = criarGravadorR2({
    endpoint: 'https://r2',
    bucket: 'b',
    chaveId: 'id',
    segredo: 's',
    buscar: async () => ({ ok: false, status: 412, text: async () => 'PreconditionFailed' }),
  });
  await assert.rejects(gravar('horario/x.dump', Buffer.from('x')), /HTTP 412.*PreconditionFailed/);
});

// ---------------------------------------------------------------- pg_dump
async function pgDumpFalso(script) {
  const dir = await mkdtemp(join(tmpdir(), 'lt-backup-'));
  const caminho = join(dir, 'pg_dump');
  await writeFile(caminho, `#!/bin/sh\n${script}\n`);
  await chmod(caminho, 0o755);
  return caminho;
}

test('despejo: devolve os bytes e passa formato custom e a url', async () => {
  const pgDump = await pgDumpFalso('printf "PGDMP:%s %s %s" "$1" "$2" "$3"');
  const bytes = await criarDespejo({ bancoUrl: 'postgres://banco', pgDump })();
  assert.equal(bytes.toString(), 'PGDMP:--format=custom --dbname postgres://banco');
});

test('despejo: saida nao-zero recusa, mesmo com bytes ja escritos', async () => {
  const pgDump = await pgDumpFalso('printf PGDMP-meio; echo "conexao caiu" >&2; exit 1');
  await assert.rejects(criarDespejo({ bancoUrl: 'x', pgDump })(), /saiu com 1: conexao caiu/);
});

test('despejo: saida que nao e dump custom recusa', async () => {
  const pgDump = await pgDumpFalso('echo "-- SQL puro"');
  await assert.rejects(criarDespejo({ bancoUrl: 'x', pgDump })(), /formato custom/);
});

// -------------------------------------------------------------------- o job
function poolFalso(camadas) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      if (sql.includes('backup_camadas')) return { rows: [{ camadas }] };
      return { rows: [] };
    },
  };
}

const T = Date.parse('2026-10-01T03:00:30Z');

test('grava o mesmo dump em cada camada devida e registra ok', async () => {
  const pool = poolFalso(['horario', 'diario', 'mensal']);
  const gravadas = [];
  const backup = criarBackup({
    pool,
    despejar: async () => Buffer.from('PGDMP-conteudo'),
    gravar: async (chave, bytes) => gravadas.push([chave, bytes.toString()]),
    agora: () => T,
  });

  const r = await backup();
  assert.equal(r.resultado, 'ok');
  assert.deepEqual(gravadas.map(([c]) => c), [
    'horario/2026-10-01T03-00Z.dump',
    'diario/2026-10-01T03-00Z.dump',
    'mensal/2026-10-01T03-00Z.dump',
  ]);
  assert.ok(gravadas.every(([, b]) => b === 'PGDMP-conteudo'));

  const registro = pool.chamadas.at(-1);
  assert.match(registro.sql, /backup_registrar/);
  assert.equal(registro.params[1], 'ok');
  assert.equal(registro.params[3], null);
});

test('hora ja tentada: nao despeja nada', async () => {
  let despejou = false;
  const pool = poolFalso([]);
  const backup = criarBackup({
    pool,
    despejar: async () => {
      despejou = true;
    },
    gravar: async () => {},
    agora: () => T,
  });
  assert.equal(await backup(), null);
  assert.equal(despejou, false);
  assert.equal(pool.chamadas.length, 1);
});

test('falha no meio registra falhou, com o que chegou a ser gravado', async () => {
  const pool = poolFalso(['horario', 'diario']);
  const backup = criarBackup({
    pool,
    despejar: async () => Buffer.from('PGDMP'),
    gravar: async (chave) => {
      if (chave.startsWith('diario/')) throw new Error('r2: HTTP 503');
    },
    aoErro: () => {},
    agora: () => T,
  });

  const r = await backup();
  assert.equal(r.resultado, 'falhou');
  assert.deepEqual(r.gravadas, ['horario/2026-10-01T03-00Z.dump']);
  const registro = pool.chamadas.at(-1);
  assert.equal(registro.params[1], 'falhou');
  assert.equal(registro.params[3], 'r2: HTTP 503');
});

test('entre intervalos nem pergunta ao banco', async () => {
  let t = T;
  const pool = poolFalso([]);
  const backup = criarBackup({ pool, despejar: async () => {}, gravar: async () => {}, agora: () => t });
  await backup();
  t += 59_000;
  await backup();
  assert.equal(pool.chamadas.length, 1);
});
