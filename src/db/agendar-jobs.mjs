#!/usr/bin/env node
// Aplica no pg_cron a agenda que `job_agendado` declara.
//
//   node src/db/agendar-jobs.mjs           agenda o que falta, desagenda o que saiu
//   node src/db/agendar-jobs.mjs --status  mostra a diferença e não muda nada
//
// Sem dependência: fala com o banco via psql, igual ao migrate.mjs.
//
// Por que isto não é migration: `create extension pg_cron` só funciona no banco
// apontado por `cron.database_name` — no DigitalOcean, só no `defaultdb`
// (ADR 0018). Um `cron.schedule` dentro de migration quebraria todo banco
// descartável de teste (`createdb lt_verify` + migrate é como se prova
// regressão sem sujar o dev). A migration 0027 declara a agenda desejada; este
// script é o passo de deploy que a aplica.
//
// É idempotente por desenho: `cron.schedule` com o mesmo nome substitui a
// entrada, e o que se desagenda é só o que ESTE registro conhece — job de cron
// que não está em `job_agendado` não é tocado, porque pode não ser nosso.
import { spawnSync } from 'node:child_process';

// Separador de campo do psql. Não é `|` nem `,` de propósito: o comando do job
// carrega SQL, e um separador que possa aparecer no dado quebra o parse.
const SEP = '';

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

function psql(sql) {
  const r = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-qtAX', '-F', SEP, '-f', '-'],
    { env, input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`psql falhou (${r.status}):\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

const linhas = (saida) =>
  saida.split('\n').filter(Boolean).map((l) => l.split(SEP));

const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;

// A parte que decide, isolada do banco pra poder ser testada sem ele.
//
// `desejada` vem de app.job_agenda_desejada(); `existentes` é o que o pg_cron
// tem hoje. Reagenda quando expressão OU comando mudaram — trocar a hora no
// registro tem de alcançar o cron, senão o registro vira ficção.
export function montarPlano(desejada, existentes, conhecidos) {
  const atual = new Map(existentes.map((j) => [j.nome, j]));

  const agendar = desejada.filter((d) => {
    const j = atual.get(d.nome);
    return !j || j.expressao !== d.expressao || j.comando !== d.comando;
  });

  const querido = new Set(desejada.map((d) => d.nome));
  // Só desagenda o que o registro conhece e não quer mais (job desativado).
  // Entrada de cron alheia não é nossa pra apagar.
  const desagendar = existentes
    .filter((j) => !querido.has(j.nome) && conhecidos.has(j.nome))
    .map((j) => j.nome);

  return { agendar, desagendar };
}

export async function main(argv = process.argv.slice(2)) {
  const status = argv.includes('--status');

  const temCron = psql("select count(*) from pg_extension where extname = 'pg_cron';");
  if (temCron !== '1') {
    throw new Error(
      'pg_cron nao esta instalado neste banco. No DigitalOcean ele so existe no `defaultdb` ' +
        '(ADR 0018); no dev, `docker compose up -d --wait` ja sobe com ele.',
    );
  }

  const desejada = linhas(
    psql('select nome, expressao, comando from app.job_agenda_desejada();'),
  ).map(([nome, expressao, comando]) => ({ nome, expressao, comando }));

  const existentes = linhas(
    psql('select jobname, schedule, command from cron.job order by jobname;'),
  ).map(([nome, expressao, comando]) => ({ nome, expressao, comando }));

  const conhecidos = new Set(
    linhas(psql('select nome from job_agendado;')).map(([nome]) => nome),
  );

  const { agendar, desagendar } = montarPlano(desejada, existentes, conhecidos);

  if (agendar.length === 0 && desagendar.length === 0) {
    console.log(`agendar-jobs: nada a fazer (${desejada.length} job(s) em dia).`);
    return { agendados: 0, desagendados: 0 };
  }

  const prefixo = status ? 'agendar-jobs [--status]:' : 'agendar-jobs:';
  for (const j of agendar) console.log(`${prefixo} ${j.nome} → ${j.expressao}`);
  for (const nome of desagendar) console.log(`${prefixo} ${nome} → desagendar`);
  if (status) return { agendados: 0, desagendados: 0 };

  for (const j of agendar) {
    psql(
      `select cron.schedule(${literal(j.nome)}, ${literal(j.expressao)}, ${literal(j.comando)});`,
    );
  }
  for (const nome of desagendar) {
    psql(`select cron.unschedule(${literal(nome)});`);
  }

  return { agendados: agendar.length, desagendados: desagendar.length };
}

if (process.argv[1]?.endsWith('agendar-jobs.mjs')) {
  try {
    await main();
  } catch (erro) {
    // Falta de pg_cron e problema de ambiente, nao bug: a mensagem basta, e o
    // stack trace so esconde ela.
    console.error(erro.message);
    process.exit(1);
  }
}
