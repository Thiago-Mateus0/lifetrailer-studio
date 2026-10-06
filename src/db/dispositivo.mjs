#!/usr/bin/env node
// Registra, revoga e lista os aparelhos que podem mostrar a Entrada (ADR 0048).
//
//   node src/db/dispositivo.mjs registrar "Tablet Recepção"   imprime a chave UMA vez
//   node src/db/dispositivo.mjs revogar "Tablet Recepção"
//   node src/db/dispositivo.mjs lista
//
// Roda com a credencial do dono do banco, como o migrate.mjs — de propósito: o
// role da app confere chave, mas não cria nem revoga (tests/db/31). Dar chave
// nova a um aparelho é ato de quem tem acesso ao banco, não de quem alcança a porta.
//
// A chave não fica guardada em lugar nenhum além do tablet: o banco só tem o
// hash. Perdeu a chave, registre de novo com outro nome e revogue a antiga.
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

function psql(sql, valor) {
  const r = spawnSync('psql', ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-qtA', '-v', `nome=${valor ?? ''}`, '-f', '-'], {
    input: sql, env, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr.trim() || `psql saiu com ${r.status}`);
    process.exit(1);
  }
  return r.stdout.trim();
}

const [comando, nome] = process.argv.slice(2);

switch (comando) {
  case 'registrar': {
    if (!nome) { console.error('informe o nome do aparelho, ex.: "Tablet Recepção"'); process.exit(2); }
    // `:'nome'` é a interpolação com aspas do psql: o nome nunca vira SQL.
    const chave = psql("select app.dispositivo_registrar(:'nome');", nome);
    console.log(`aparelho "${nome}" registrado.`);
    console.log('');
    console.log(`  ${chave}`);
    console.log('');
    console.log('Esta chave aparece só agora. Abra o app no tablet e cole-a na tela "Registrar este aparelho".');
    break;
  }
  case 'revogar': {
    if (!nome) { console.error('informe o nome do aparelho'); process.exit(2); }
    psql("select app.dispositivo_revogar(:'nome');", nome);
    console.log(`aparelho "${nome}" revogado. O app no tablet volta a pedir chave em até 1 minuto.`);
    break;
  }
  case 'lista':
    console.log(psql(`select nome || '  ·  registrado ' || to_char(criado_em, 'DD/MM/YYYY')
                         || coalesce('  ·  REVOGADO ' || to_char(revogado_em, 'DD/MM/YYYY'), '')
                        from dispositivo order by criado_em;`) || 'nenhum aparelho registrado');
    break;
  default:
    console.error('uso: node src/db/dispositivo.mjs registrar|revogar "<nome>" · lista');
    process.exit(2);
}
