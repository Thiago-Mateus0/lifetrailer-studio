#!/usr/bin/env node
// Roda os testes pgTAP de tests/db/*.sql e reporta cada asserção como subteste
// do runner nativo do Node 22 (node --test). Sem vitest, sem jest, sem pg_prove.
//
//   node --test tests/db/runner.mjs
//   node --test tests/db/runner.mjs -- 04_audit   (filtra por trecho do nome)
//
// Cada arquivo abre a própria transação e termina em ROLLBACK: rodar duas vezes
// dá o mesmo resultado e o banco não guarda nada do teste.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const DIR = dirname(fileURLToPath(import.meta.url));

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

const filtro = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const arquivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => filtro.length === 0 || filtro.some((p) => f.includes(p)))
  .sort();

// Uma linha TAP do pgTAP: "ok 3 - descrição" / "not ok 3 - descrição".
const LINHA_TAP = /^(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/;

for (const arquivo of arquivos) {
  test(arquivo, async (t) => {
    const r = spawnSync('psql', ['--no-psqlrc', '-qtAX', '-f', join(DIR, arquivo)], {
      env,
      encoding: 'utf8',
    });

    const saida = `${r.stdout}${r.stderr}`;
    const linhas = saida.split('\n').map((l) => l.trim());

    // O diagnóstico do pgTAP vem em linhas '#' logo depois do 'not ok'.
    const diagnostico = (i) => {
      const out = [];
      for (let j = i + 1; j < linhas.length && linhas[j].startsWith('#'); j++) out.push(linhas[j]);
      return out.join('\n');
    };

    const assercoes = [];
    linhas.forEach((linha, i) => {
      const m = linha.match(LINHA_TAP);
      if (m) assercoes.push({ ok: m[1] === 'ok', numero: m[2], descricao: m[3], diag: diagnostico(i) });
    });

    if (assercoes.length === 0) {
      assert.fail(`${arquivo} nao produziu saida TAP:\n${saida}`);
    }

    for (const a of assercoes) {
      await t.test(`${a.numero} ${a.descricao}`, () => {
        if (!a.ok) assert.fail(`${a.descricao}\n${a.diag}`);
      });
    }

    const planejadas = saida.match(/^1\.\.(\d+)$/m);
    assert.ok(planejadas, `${arquivo}: pgTAP nao emitiu plano\n${saida}`);
    assert.equal(
      assercoes.length,
      Number(planejadas[1]),
      `${arquivo}: plano diz ${planejadas[1]} assercoes, sairam ${assercoes.length}`,
    );
  });
}
