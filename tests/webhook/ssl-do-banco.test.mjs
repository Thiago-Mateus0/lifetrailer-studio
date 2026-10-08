import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sslDoBanco } from '../../src/webhook/config.mjs';

// O banco gerenciado usa certificado de CA própria: sem ela o `pg` recusa a
// conexão ("self-signed certificate in certificate chain"), e desligar a
// verificação trocaria o erro por conexão sem prova de com quem se fala.
test('PGSSLROOTCERT vira a CA conferida na conexao', () => {
  const arq = join(mkdtempSync(join(tmpdir(), 'lt-ca-')), 'ca.crt');
  writeFileSync(arq, 'CA-DE-TESTE');
  assert.deepEqual(sslDoBanco({ PGSSLROOTCERT: arq }), { ssl: { ca: 'CA-DE-TESTE' } });
});

test('sem PGSSLROOTCERT o pool nao fixa ssl (dev local)', () => {
  assert.deepEqual(sslDoBanco({}), {});
});
