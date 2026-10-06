// Pool do Postgres e a única escrita que o receptor faz.
//
// `pg` é a primeira dependência de runtime do repositório. Justificativa: um
// servidor de longa duração precisa de pool e de statement parametrizado; o
// caminho sem dependência que o migrate.mjs usa (abrir um `psql` por chamada)
// não tem nenhum dos dois.
import pg from 'pg';

import { sslDoBanco } from './config.mjs';

export function criarPool(env = process.env) {
  const pool = new pg.Pool({
    host: env.PGHOST ?? '127.0.0.1',
    port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER ?? 'lifetrailer_app',
    password: env.PGPASSWORD,
    database: env.PGDATABASE ?? 'lifetrailer',
    max: Number(env.PGPOOL_MAX ?? 4),
    connectionTimeoutMillis: 5_000,
    ...sslDoBanco(env),
  });
  // Sem listener, o erro de uma conexão ociosa (failover do banco gerenciado,
  // reset de rede) vira exceção não tratada e derruba o receptor e o worker. O
  // pg-pool já descarta o cliente; a próxima query abre outro.
  pool.on('error', (e) => console.error('[webhook] conexao ociosa do pool caiu:', e.message));
  return pool;
}

// Um statement, uma transação implícita: app.webhook_ingerir() escreve a
// requisição bruta e, se aceita, enfileira. O receptor não interpreta payload.
export function criarIngestor(pool) {
  return async function ingerir(req) {
    const { rows } = await pool.query(
      `select requisicao_id, evento_id
         from app.webhook_ingerir($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.ipOrigem,
        req.metodo,
        req.caminho,
        req.cabecalhos === null ? null : JSON.stringify(req.cabecalhos),
        req.corpoBruto,
        req.corpoBytes,
        req.resultado,
      ],
    );
    return rows[0] ?? { requisicao_id: null, evento_id: null };
  };
}
