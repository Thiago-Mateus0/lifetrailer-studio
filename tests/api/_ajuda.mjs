// Sobe o servidor real do processo (webhook + app na mesma porta) com a
// configuração mínima do receptor. Existe pra que o teste do app exercite o
// mesmo caminho que produção usa, e não um servidor próprio de teste.
import { criarServidor as criarServidorReal } from '../../src/webhook/servidor.mjs';

export const TOKEN_MINIMO_PARA_TESTE = 'a'.repeat(32);

export function criarServidor({ atenderApp, ingerir }) {
  return criarServidorReal({
    config: {
      token: TOKEN_MINIMO_PARA_TESTE,
      porta: 0,
      limitePorJanela: 1000,
      janelaMs: 60_000,
      corpoMaxBytes: 1_048_576,
      confiaProxy: false,
    },
    ingerir,
    atenderApp,
    aoErro: () => {},
  });
}
