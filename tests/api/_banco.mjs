// Roda a consulta de uma tela contra um Postgres de verdade (ADR 0042 §2).
//
// Por que aqui e não em pgTAP: a consulta mora numa string do módulo da tela, e
// é ela que precisa ser exercitada — uma cópia em .sql provaria que a cópia
// funciona. Caminho igual ao do tests/db/runner.mjs: psql por spawn, sem
// dependência instalada, tudo numa transação que termina em ROLLBACK.
//
// ⚠ A consulta roda como `lifetrailer_app`, não como o dono. É o role que o
// processo usa (0011: sem BYPASSRLS, sem posse de tabela), e rodar como postgres
// esconderia justamente a classe de falha que a RLS existe pra causar.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const JANA = 'aaaaaaaa-0000-0000-0000-000000000001';
export const MARCOS = 'aaaaaaaa-0000-0000-0000-000000000002';
export const PAULO = 'aaaaaaaa-0000-0000-0000-000000000003';

// Uma quarta-feira às 08:12 em Maceió: dia útil garantido, dentro da janela da
// manhã. Relativa de propósito — teste com data fixa apodrece.
export const INSTANTE = "((app.quarta_recente() + time '08:12') at time zone 'America/Maceio')";

// Aspas porque o psql parte argumento de meta-comando no espaço: sem elas um
// repositório em "ALTEGIO - Lifetrailer" vira \ir /home/.../ALTEGIO e quebra —
// e só quebra na máquina de quem tem espaço no caminho, nunca no CI.
export const FIXTURES = `\\ir '${join(RAIZ, 'tests/db/_fixtures.psql')}'`;

const ambiente = () => ({
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
  // Conecta como dono porque o semeador insere em tabela que o role da app não
  // escreve. O `set local role` do script troca antes da consulta.
  PGUSER: process.env.PGUSER ?? 'postgres',
});

export const bancoDisponivel = spawnSync('psql', ['--no-psqlrc', '-XAtc', 'select 1'], {
  encoding: 'utf8', env: ambiente(),
}).status === 0;

/**
 * Consulta solta, sem fixture nem transação: para perguntar ao catálogo o que
 * o banco tem (assinatura de função, por exemplo). Devolve uma linha por
 * registro, já partida nas colunas.
 */
export function consultar(sql) {
  const r = spawnSync('psql', ['--no-psqlrc', '-XAtF', '\u0001', '-c', sql],
    { encoding: 'utf8', env: ambiente() });
  assert.equal(r.status, 0, `psql falhou:\n${r.stderr}`);
  return r.stdout.split('\n').filter((l) => l !== '').map((l) => l.split('\u0001'));
}

/**
 * `semear` e `extra` rodam como dono, nessa ordem; a consulta roda como o role
 * da app, com `$1` = colaborador e `$2` = INSTANTE. `parametros` são os `$3…`
 * da tela, como pares [tipo, literal SQL] — `[['text', "'saida'"]]`. `json`
 * lista as colunas que voltam como jsonb e precisam de parse. `instante` troca o
 * $2 quando o cenário depende do relógio real (o ts_servidor do audit log).
 */
export function rodarTela({
  consulta, comoQuem, semear, extra = '', parametros = [], json = [], instante = INSTANTE,
}) {
  const tipos = ['uuid', 'timestamptz', ...parametros.map(([tipo]) => tipo)].join(', ');
  const valores = [`'${comoQuem}'::uuid`, instante, ...parametros.map(([tipo, v]) => `${v}::${tipo}`)].join(', ');
  const script = `
\\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Maceio';
${FIXTURES}
${semear}
${extra}
set local role lifetrailer_app;
prepare tela(${tipos}) as ${consulta};
\\x on
\\pset tuples_only on
\\pset format unaligned
execute tela(${valores});
rollback;
`;

  const r = spawnSync('psql', ['--no-psqlrc', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: script, encoding: 'utf8', env: ambiente(),
  });
  assert.equal(r.status, 0, `psql falhou:\n${r.stderr}`);

  // \x on + -A -t dá uma linha "coluna|valor" por campo.
  const linha = {};
  for (const bruta of r.stdout.split('\n')) {
    const corte = bruta.indexOf('|');
    if (corte === -1) continue;
    const valor = bruta.slice(corte + 1);
    linha[bruta.slice(0, corte).trim()] = valor === '' ? null : valor;
  }
  // Nulo continua nulo, como o driver pg entrega: um jsonb ausente não é lista vazia.
  for (const campo of json) linha[campo] = linha[campo] === null ? null : JSON.parse(linha[campo]);
  return linha;
}
