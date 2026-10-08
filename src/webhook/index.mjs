#!/usr/bin/env node
// Entrada do processo. Recebe o webhook da Altegio E serve o app (ADR 0042 §1):
// não são dois serviços, é o mesmo pool, o mesmo segredo LT_* e a mesma porta.
//
//   LT_WEBHOOK_TOKEN=... LT_CLAIM_SEGREDO=... node src/webhook/index.mjs
//
// ⚠ Faltando LT_CLAIM_SEGREDO o processo NÃO sobe, nem para o webhook. É de
// propósito: um processo que atende metade das rotas e cala sobre a outra
// metade é o modo de falha mais caro que existe aqui — ninguém percebe até o
// tablet não conseguir entrar.
import { montarApp } from '../api/index.mjs';
import { lerConfig } from './config.mjs';
import { criarIngestor, criarPool } from './db.mjs';
import { criarServidor } from './servidor.mjs';

const config = lerConfig();
const pool = criarPool();

const servidor = criarServidor({
  config,
  ingerir: criarIngestor(pool),
  atenderApp: montarApp({ pool }),
});

servidor.listen(config.porta, () => {
  console.log(`lifetrailer: ouvindo na porta ${config.porta} (webhook + app)`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close(() => pool.end().then(() => process.exit(0)));
  });
}
