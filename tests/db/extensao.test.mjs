// Os casos de `tests/extensao.yaml` rodados contra app.extensao_calcular
// (migration 0081), no Postgres.
//
// ⚠ Nenhum número deste arquivo. Regra inviolável 2: valor esperado, preço,
// limite noturno e acréscimo vêm dos mesmos arquivos que o runner de domínio lê
// — o yaml e os CSVs de `data/` e `tests/`. Reescrever qualquer um deles aqui
// faria dois testes concordando com a cópia, e nenhum com a fonte.
//
// O yaml é lido pelo parser de `tests/runner.py`, por spawn de python3, em vez
// de um segundo parser em JS: duas leituras do mesmo arquivo são duas chances de
// discordar, e a que decide dinheiro é a do runner.
//
// COBERTURA. Os casos com `espera` rodam. Os com `erro_esperado` (EXT-22 a
// EXT-28) NÃO rodam aqui, e isso é contado, não filtrado em silêncio: são
// guardas sobre o CSV MALFORMADO, e no banco a etapa que lê CSV é
// `src/db/carga.mjs`, não a função. Duas delas nem são representáveis em
// `turno_definicao` (o CHECK, agora em 0068, proíbe tarde_noite sem
// hora_fim_calculo).
// Ver a issue aberta na PR que trouxe este arquivo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { lerCsv } from '../../src/db/carga.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

// --------------------------------------------------------------- os casos
const py = spawnSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(RAIZ, 'tests'))})
import runner
print(json.dumps(runner.carrega(${JSON.stringify(join(RAIZ, 'tests/extensao.yaml'))})))
`], { encoding: 'utf8', env });
if (py.status !== 0) throw new Error(`python3: ${(py.stderr || py.stdout).trim()}`);
const casos = JSON.parse(py.stdout);

// --------------------------------------------------------------- a data
// O runner de domínio trata `data` (vigência) e `dia_semana` (limite noturno)
// como independentes — no banco eles são a mesma coisa, porque o dia da semana
// sai da data. A tradução é: a data declarada pelo caso, movida para o dia da
// semana que ele pede DENTRO DA MESMA SEMANA. A semana nunca cruza uma virada
// de vigência das fixtures (01-01→08-09 e 08-10→), então o parâmetro resolvido
// continua sendo o que o caso quer exercitar.
const DIA = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const PADRAO = '2026-08-11';   // o mesmo default de runner.calcula

function dataDoCaso(caso) {
  const base = new Date(`${caso.data ?? PADRAO}T12:00:00Z`);
  const segunda = new Date(base);
  segunda.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const alvo = new Date(segunda);
  alvo.setUTCDate(segunda.getUTCDate() + ((DIA[caso.dia_semana] + 6) % 7));
  return alvo.toISOString().slice(0, 10);
}

// ------------------------------------------------------------- as fontes
const csv = (rel) => lerCsv(readFileSync(join(RAIZ, rel), 'utf8'));
const lit = (v) => (v === null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// Mesmo mapeamento de src/db/carga.mjs — se ele mudar e este não, o teste passa
// a exercitar uma forma que o banco de produção não tem.
const DIAS_CSV = { 'seg-sex': [1, 2, 3, 4, 5], sab: [6], dom: [0] };
const TURNOS_CSV = { Manha: 'manha', 'Tarde-noite': 'tarde_noite', Extra: 'extra' };
const hora = (v) => (v === '' || v === 'primeiro_ensaio' ? null : v);

function semear(caso) {
  const precos = csv(caso.fonte_precos ?? 'data/precos.csv');
  const acrescimos = csv(caso.fonte_acrescimo ?? 'data/acrescimo-noturno.csv');
  const turnos = csv(caso.fonte_turnos ?? 'data/turnos.csv');

  const estudios = [...new Set(precos.map((l) => l.estudio))];
  const linhas = [
    'delete from tabela_preco;',
    'delete from acrescimo_noturno;',
    'delete from turno_definicao;',
    ...estudios.map((nome, i) => `insert into estudio (nome, staff_id, ordem_exibicao)
      select ${lit(nome)}, ${i + 1}, ${i + 1}
       where not exists (select 1 from estudio where nome = ${lit(nome)});`),
    ...precos.map((l) => `insert into tabela_preco
      (estudio_id, duracao_minutos, valor, vigencia_inicio, vigencia_fim)
      values ((select id from estudio where nome = ${lit(l.estudio)}),
              ${Number(l.duracao_min)}, ${lit(l.valor)}::numeric,
              ${lit(l.vigencia_inicio)}::date, ${lit(l.vigencia_fim)}::date);`),
    ...acrescimos.map((l) => `insert into acrescimo_noturno (valor, vigencia_inicio, vigencia_fim)
      values (${lit(l.valor)}::numeric, ${lit(l.vigencia_inicio)}::date, ${lit(l.vigencia_fim)}::date);`),
  ];

  for (const l of turnos) {
    const dias = DIAS_CSV[l.dia_semana];
    if (!dias) throw new Error(`turnos: dia_semana desconhecido "${l.dia_semana}"`);
    const turno = TURNOS_CSV[l.turno];
    if (!turno) throw new Error(`turnos: turno desconhecido "${l.turno}"`);
    for (const d of dias) {
      // Cada valor na sua coluna desde a migration 0068: `hora_fim` e o fim do
      // turno, `hora_fim_calculo` e o limite do acrescimo — e so tarde_noite
      // tem o segundo. Antes os dois vinham colados pelo `??`.
      linhas.push(`insert into turno_definicao
        (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
         janela_posse_inicio, janela_posse_fim, vigencia_inicio, vigencia_fim)
        values (${d}, ${lit(turno)}, ${lit(hora(l.hora_inicio))}::time,
                ${lit(hora(l.hora_fim))}::time,
                ${lit(hora(l.hora_fim_calculo))}::time,
                ${lit(hora(l.janela_posse_inicio))}::time,
                ${lit(hora(l.janela_posse_fim))}::time,
                ${lit(l.vigencia_inicio)}::date, ${lit(l.vigencia_fim)}::date);`);
    }
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------- a chamada
// Fim praticado antes do agendado só acontece por virada de meia-noite: é o
// mesmo `if fim < ini: fim += 24h` do runner, aqui no calendário.
function instantePraticado(caso, data) {
  const viraDia = caso.fim_praticado < caso.fim_agendado;
  return viraDia
    ? `((date '${data}' + 1 + time '${caso.fim_praticado}:00') at time zone 'America/Maceio')`
    : `(timestamp '${data} ${caso.fim_praticado}:00' at time zone 'America/Maceio')`;
}

function rodar(caso) {
  const data = dataDoCaso(caso);
  const script = `\\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Maceio';
${semear(caso)}
select app.extensao_calcular(
  (select id from estudio where nome = ${lit(caso.estudio)}),
  date '${data}',
  ${Number(caso.duracao_agendada)},
  (timestamp '${data} ${caso.fim_agendado}:00' at time zone 'America/Maceio'),
  ${instantePraticado(caso, data)});
rollback;`;
  const r = spawnSync('psql', ['--no-psqlrc', '-qtAX', '-f', '-'], {
    env, encoding: 'utf8', input: script,
  });
  if (r.status !== 0) throw new Error(`${caso.id} (${data}): ${(r.stderr || r.stdout).trim()}`);
  return { obtido: JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop()), data };
}

// ------------------------------------------------------------- as asserções
const bancoDisponivel = spawnSync('psql', ['--no-psqlrc', '-XAtc', 'select 1'], {
  encoding: 'utf8', env,
}).status === 0;

// yaml -> jsonb. Os dois nomes diferentes são os do schema (0002:51), e é o
// contrato que app.comanda_total e app.comanda_fechar já liam.
const CAMPO = {
  minutos: 'minutos_reais',
  blocos: 'blocos',
  blocos_noturnos: 'blocos_noturnos',
  base: 'base',
  acrescimo: 'acrescimo_noturno',
  total: 'total',
};

test('extensao.yaml tem caso', () => assert.ok(casos.length > 0));

for (const caso of casos.filter((c) => c.espera)) {
  test(`${caso.id} — ${caso.nome}`, { skip: bancoDisponivel ? false : 'sem Postgres' }, () => {
    const { obtido, data } = rodar(caso);
    for (const [doYaml, noBanco] of Object.entries(CAMPO)) {
      assert.equal(Number(obtido[noBanco]), Number(caso.espera[doYaml]),
        `${caso.id} (${data}): campo ${doYaml}`);
    }
  });
}

// Não some da contagem: o teste diz quantos casos ficaram de fora e por quê.
for (const caso of casos.filter((c) => c.erro_esperado)) {
  test(`${caso.id} — ${caso.nome}`, { skip: 'guarda de CSV malformado: mora em src/db/carga.mjs, não na função' }, () => {});
}
