// O Caddy só repassa ao app os caminhos que o `@api` lista; o resto vira o
// index.html do front. Rota nova no servidor sem linha no Caddyfile funciona em
// dev e some em produção — foi o que aconteceu com /comprovante (29/09).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8');

const linhaApi = ler('deploy/Caddyfile').split('\n').find((l) => l.trim().startsWith('@api path'));
const noCaddy = linhaApi.trim().split(/\s+/).slice(2);

// `caminho === '/x'` e `caminho.startsWith('/x/')` em servidor.mjs.
const rotas = [...ler('src/api/servidor.mjs').matchAll(/caminho(?: === |\.startsWith\()'([^']+)'/g)]
  .map((m) => m[1]);

const cobre = (rota) => noCaddy.some((p) =>
  p.endsWith('*') ? rota.startsWith(p.slice(0, -1)) : p === rota || `${p}/` === rota);

test('o Caddyfile repassa ao app toda rota que o servidor atende', () => {
  assert.ok(rotas.length > 0);
  for (const rota of rotas) assert.ok(cobre(rota), `${rota} não está no @api do deploy/Caddyfile`);
});
