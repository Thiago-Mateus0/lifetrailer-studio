#!/usr/bin/env node
// Aplica src/db/migrations/*.sql em ordem, uma transação por arquivo.
//
// Sem dependência: fala com o banco via psql. Node 22.
//
//   node src/db/migrate.mjs           aplica o que falta
//   node src/db/migrate.mjs --status  lista o que já foi aplicado
//
// Migration é append-only: o runner guarda o sha256 de cada arquivo aplicado e
// recusa rodar se um arquivo já aplicado mudou. Decisão nova vira arquivo novo.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function aguardarBanco() {
  const args = ['--no-psqlrc', '-qtA', '-c', 'select 1'];
  for (let tentativa = 1; tentativa <= 30; tentativa++) {
    const r = spawnSync('psql', args, { env, encoding: 'utf8' });
    if (r.status === 0) return;

    // psql usa status 2 para falha de conexao. Erro SQL nao e transitorio.
    if (r.status !== 2 || tentativa === 30) {
      throw new Error(`psql falhou (${r.status}):\n${r.stderr || r.stdout || r.error?.message}`);
    }
    await esperar(1000);
  }
}

function psql(sql, { quiet = true } = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-f', '-'];
  if (quiet) args.push('-qtA');
  const r = spawnSync('psql', args, { env, input: sql, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`psql falhou (${r.status}):\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const arquivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((nome) => {
    const sql = readFileSync(join(DIR, nome), 'utf8');
    return { nome, sql, hash: sha256(sql) };
  });

await aguardarBanco();

psql(`
  create table if not exists schema_migrations (
    nome        text        primary key,
    hash        text        not null,
    aplicada_em timestamptz not null default now()
  );
`);

const aplicadas = new Map(
  psql('select nome || E\'\\t\' || hash from schema_migrations order by nome;')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t')),
);

// A única edição de migration aplicada que este runner aceita (ADR 0077): o
// par exato antes→depois. Qualquer outro hash divergente continua recusado.
const CORRIGIDAS = {
  '0011_role_app_e_rls.sql': [
    '665744dd6cedc283198fdd083beddffa9ffb2464dc8e6964b99b32ba0bd0c485',
    'b368a16c217434424f59646e76b54175e21f364cd89759ef6fd9217fbce58225',
  ],
  '0017_tranca_automatica_role_job.sql': [
    'f0c06502645e6ecea4c4b74c2821441dcb10fb7f068bf791bc029a483f348873',
    'ef4c31a4cfd217796f55e047ddfe33f8beb3f349476cf8f579c67dfcfdaaf1e9',
  ],
  '0018_audit_seq_e_verificar_cadeia.sql': [
    '5509f82b923f83adc35f8af14a9162fb7b56905efac8ea9ccb585da71b9cf441',
    'f98fa4756a25264489b2c33979818f119f7caf846b1a335bba39c986c91ec50e',
  ],
};
for (const { nome, hash } of arquivos) {
  const [de, para] = CORRIGIDAS[nome] ?? [];
  if (de && aplicadas.get(nome) === de && hash === para) {
    psql(`update schema_migrations set hash = '${para}' where nome = '${nome}' and hash = '${de}';`);
    aplicadas.set(nome, para);
    console.log(`migrate: ${nome} — hash atualizado (ADR 0077)`);
  }
}

if (process.argv.includes('--status')) {
  for (const { nome, hash } of arquivos) {
    const anterior = aplicadas.get(nome);
    const marca = anterior === undefined ? 'pendente'
      : anterior === hash ? 'aplicada'
      : 'ALTERADA APOS APLICADA';
    console.log(`${marca.padEnd(22)} ${nome}`);
  }
  process.exit(0);
}

const alteradas = arquivos.filter(
  ({ nome, hash }) => aplicadas.has(nome) && aplicadas.get(nome) !== hash,
);
if (alteradas.length > 0) {
  console.error(
    'migration ja aplicada foi editada (append-only):\n  ' +
      alteradas.map((m) => m.nome).join('\n  '),
  );
  process.exit(1);
}

const pendentes = arquivos.filter(({ nome }) => !aplicadas.has(nome));
if (pendentes.length === 0) {
  console.log('migrate: nada pendente.');
  process.exit(0);
}

for (const { nome, sql, hash } of pendentes) {
  process.stdout.write(`migrate: aplicando ${nome}... `);
  psql(
    ['begin;', sql, `insert into schema_migrations (nome, hash) values ('${nome}', '${hash}');`, 'commit;'].join('\n'),
  );
  console.log('ok');
}
