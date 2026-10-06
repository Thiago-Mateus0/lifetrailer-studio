// A consulta da Home contra um Postgres de verdade (ADR 0042 §2).
//
// Por que aqui e não em pgTAP: a consulta mora numa string do home.mjs, e é ela
// que precisa ser exercitada — uma cópia em .sql provaria que a cópia funciona.
// O caminho é o mesmo do tests/db/runner.mjs: psql por spawn, sem dependência
// instalada, tudo dentro de uma transação que termina em ROLLBACK.
//
// ⚠ A consulta roda como `lifetrailer_app`, não como o dono. É o role que o
// processo usa (0011: sem BYPASSRLS, sem posse de tabela), e rodar como postgres
// aqui esconderia justamente a classe de falha que a RLS existe pra causar.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONSULTA_HOME, montarHome } from '../../src/api/telas/home.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PAULO = 'aaaaaaaa-0000-0000-0000-000000000003';
const JANA = 'aaaaaaaa-0000-0000-0000-000000000001';

// Um instante de quarta-feira às 08:12 em Maceió: dia útil garantido, dentro da
// janela da manhã. Data relativa de propósito — teste com data fixa apodrece.
const INSTANTE = "((app.quarta_recente() + time '08:12') at time zone 'America/Maceio')";

// O fixture das RPC financeiras já traz colaboradores, estúdio, turno_definicao
// e preços. O que ele não traz é o que só a Home lê.
const SEMEAR = `
-- Aspas porque o psql parte argumento de meta-comando no espaço: sem elas um
-- repositório em "ALTEGIO - Lifetrailer" vira \\ir /home/.../ALTEGIO e quebra
-- — e só quebra na máquina de quem tem espaço no caminho, nunca no CI.
\\ir '${join(RAIZ, 'tests/db/_fixtures.psql')}'

-- Sem turno escalado app.turno_vigente() devolve vazio e ninguém abre sessão.
-- É a lacuna real do ambiente novo: turno_escalado sai do gerador da Escala,
-- que depende de padrao_escala, que ninguém povoou ainda.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (app.quarta_recente(), 'manha', '${PAULO}', 'padrao', 'gerador');

-- Dois ensaios no dia: um às 10h que já tem Comanda, um às 16h que não tem.
select app.agendamento_teste('cli-1', (app.quarta_recente() + time '10:00') at time zone 'America/Maceio') as a1 \\gset
select app.agendamento_teste('cli-2', (app.quarta_recente() + time '16:00') at time zone 'America/Maceio') as a2 \\gset
select set_config('app.colaborador_id', '${PAULO}', true);
select app.comanda_criar(:'a1', 'gerar_manual', '${PAULO}');

-- Checklist do dia: 3 itens de entrada, 1 marcado.
insert into item_catalogo (id, nome, acao, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Fundo infinito sem marca', 'conferir', 'entrada', '{1,2,3,4,5}', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'Radio comunicador carregado', 'conferir', 'entrada', '{1,2,3,4,5}', 2),
  ('dddddddd-0000-0000-0000-000000000003', 'Luzes de modelagem', 'conferir', 'entrada', '{1,2,3,4,5}', 3);

insert into checklist_dia (id, data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values ('eeeeeeee-0000-0000-0000-000000000001', app.quarta_recente(), 'pendente', 'pendente',
        (app.quarta_recente() + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);

insert into item_execucao (checklist_dia_id, data, item_catalogo_id, fase, estado, marcado_por_id, marcado_em)
select 'eeeeeeee-0000-0000-0000-000000000001', app.quarta_recente(), ic.id, 'entrada',
       case when ic.ordem = 1 then 'feito' else 'nao_marcado' end,
       case when ic.ordem = 1 then '${PAULO}'::uuid else null end,
       case when ic.ordem = 1 then now() else null end
  from item_catalogo ic;

-- Estoque: 1 zerado (urgente), 1 com uma unidade (atenção), 2 folgados, 1 não
-- conferido — que é estado próprio e NÃO conta como falta (estoque.md:89).
insert into item_estoque (nome, categoria, severidade, quantidade, conferido_em) values
  ('Papel toalha', 'Limpeza', 'urgente', 0, now()),
  ('Cafe',         'Cafe-Bebidas', 'atencao', 1, now()),
  ('Detergente',   'Limpeza', 'atencao', 5, now()),
  ('Copo',         'Cafe-Bebidas', 'atencao', 9, now()),
  ('Propes',       'Estudio', 'atencao', 0, null);

insert into aviso (texto, prioridade, status, autor_id, snapshot_colaboradores) values
  ('Propes acabando',           'normal',  'ativo', '${JANA}', '{}'),
  ('Fundo branco em manutencao','urgente', 'ativo', '${JANA}', '{}'),
  ('Aviso velho',               'normal',  'arquivado', '${JANA}', '{}');

insert into achado (descricao, datetime_achado, status, registrado_por_id) values
  ('Oculos',  now(), 'em_posse', '${PAULO}'),
  ('Casaco',  now(), 'aguardando_foto', '${PAULO}'),
  ('Chaveiro', now(), 'devolvido', '${PAULO}');

insert into categoria_treinamento (id, nome, ordem) values
  ('ffffffff-0000-0000-0000-000000000001', 'Operacao', 1);
insert into tutorial (categoria_id, titulo, status, ordem) values
  ('ffffffff-0000-0000-0000-000000000001', 'Como abrir o estudio', 'publicado', 1),
  ('ffffffff-0000-0000-0000-000000000001', 'Rascunho', 'rascunho', 2);
`;

// \x on + -A -t dá uma linha "coluna|valor" por campo.
// `extra` roda depois do semeador e ainda como dono: é onde um teste muda o
// cenário (desativar alguém, por exemplo) antes da troca de role.
function rodarConsulta(comoQuem, extra = '') {
  const script = `
\\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Maceio';
${SEMEAR}
${extra}
-- A partir daqui é o role do processo, não o dono das tabelas. Some no
-- ROLLBACK junto com o resto.
set local role lifetrailer_app;
prepare tela_home(uuid, timestamptz) as ${CONSULTA_HOME};
\\x on
\\pset tuples_only on
\\pset format unaligned
execute tela_home('${comoQuem}'::uuid, ${INSTANTE});
rollback;
`;

  const r = spawnSync('psql', ['--no-psqlrc', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '127.0.0.1',
      PGPORT: process.env.PGPORT ?? '5432',
      PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
      // Conecta como dono porque o semeador precisa inserir em tabela que o
      // role da app não escreve. O `set local role` do script troca antes da
      // consulta — que é a parte que precisa provar que passa pelos grants.
      PGUSER: process.env.PGUSER ?? 'postgres',
    },
  });

  assert.equal(r.status, 0, `psql falhou:\n${r.stderr}`);

  const linha = {};
  for (const bruta of r.stdout.split('\n')) {
    const corte = bruta.indexOf('|');
    if (corte === -1) continue;
    const chave = bruta.slice(0, corte).trim();
    const valor = bruta.slice(corte + 1);
    linha[chave] = valor === '' ? null : valor;
  }
  for (const campo of ['estudios', 'agenda', 'checklist_itens', 'avisos']) {
    linha[campo] = JSON.parse(linha[campo] ?? '[]');
  }
  return linha;
}

const disponivel = spawnSync('psql', ['--no-psqlrc', '-XAtc', 'select 1'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PGHOST: process.env.PGHOST ?? '127.0.0.1',
    PGPORT: process.env.PGPORT ?? '5432',
    PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
    PGUSER: process.env.PGUSER ?? 'postgres',
  },
}).status === 0;

test('a consulta da Home roda no banco e conta o que o cenário tem', { skip: !disponivel && 'sem Postgres' }, () => {
  const l = rodarConsulta(PAULO);

  assert.equal(l.eu_nome, 'Paulo');
  assert.equal(l.eu_perfil, 'atendente');
  assert.equal(l.turno, 'manha');

  // Quarta-feira: o expediente é o da turno_definicao dos dias úteis do fixture.
  assert.equal(l.expediente_abre, '08:00:00');
  assert.equal(l.expediente_fecha, '23:00:00');

  assert.equal(l.comandas_abertas, '1');
  assert.equal(l.comandas_fechadas_hoje, '0');

  assert.equal(l.checklist_fase, 'entrada');
  assert.equal(l.checklist_total, '3');
  assert.equal(l.checklist_feitos, '1');

  // O não conferido com quantidade 0 NÃO é zerado (estoque.md:89).
  assert.equal(l.estoque_zerados, '1');
  assert.equal(l.estoque_atencao, '1');
  assert.equal(l.estoque_total, '5');

  assert.equal(l.escala_semana, '1');
  assert.equal(l.achados_guardados, '2');
  assert.equal(l.tutoriais, '1');

  // Só os ativos, urgente primeiro.
  assert.equal(l.avisos_total, '2');
  assert.equal(l.avisos[0].texto, 'Fundo branco em manutencao');

  assert.deepEqual(l.estudios.map((e) => e.nome), ['Acustico']);

  // Um ensaio com Comanda, um sem. O fim é o do ENSAIO (60 min) e o bloqueio é o
  // seance_length do fixture (5400 s = 90 min): a diferença é a arrumação.
  assert.equal(l.agenda.length, 2);
  assert.equal(l.agenda[0].comanda_status, 'aberta');
  assert.equal(l.agenda[1].comanda_status, null);
  // O id é pra onde "Criar comanda" leva quando o job criou no meio (#113).
  assert.match(l.agenda[0].comanda_id, /^[0-9a-f-]{36}$/);
  assert.equal(l.agenda[1].comanda_id, null);
  assert.equal(l.agenda[1].duracao_nao_tabelada, false);
  assert.equal(l.agenda[1].duracao_invalida, false);
  const [a1] = l.agenda;
  assert.equal((new Date(a1.fim) - new Date(a1.inicio)) / 60_000, 60);
  assert.equal((new Date(a1.fim_bloqueio) - new Date(a1.inicio)) / 60_000, 90);
});

test('a linha do banco monta um DadosHome inteiro', { skip: !disponivel && 'sem Postgres' }, () => {
  const d = montarHome(rodarConsulta(PAULO), new Date(), {
    local: 'Recepção', dispositivo: 'Tablet 01', versao: 'teste',
  });

  // 'Paulo' é nome de uma palavra só: uma inicial.
  assert.equal(d.turno, 'P');
  assert.match(d.saudacao, /^(Bom dia|Boa tarde|Boa noite), Paulo$/);
  assert.equal(d.comandas.abertas, '1');
  assert.equal(d.checklist.progresso.startsWith('1 de 3 itens'), true);
  assert.equal(d.estoque.criticidade, 'urgente');
  assert.equal(d.agenda.estudios.length, 1);
  assert.deepEqual(d.agenda.ensaios.map((e) => [e.inicio, e.fim, e.fimBloqueio]), [['10:00', '11:00', '11:30'], ['16:00', '17:00', '17:30']]);
  assert.equal(d.agenda.ensaios[1].comanda.status, 'sem_comanda');
  assert.equal(d.agenda.ensaios[0].comanda.podeAbrir, false);
  assert.equal(d.agenda.ensaios[1].comanda.podeAbrir, true);
  assert.equal(d.avisos.contador, '2');
});

// A flag é do agendamento e a consulta a lê pelo role da app: se o grant da
// coluna faltar, a Home inteira cai, e é aqui que isso aparece.
test('ensaio com duracao nao tabelada nao oferece abrir comanda',
  { skip: !disponivel && 'sem Postgres' }, () => {
    const l = rodarConsulta(PAULO, `update agendamento set duracao_nao_tabelada = true where id = :'a2';`);
    assert.equal(l.agenda[1].duracao_nao_tabelada, true);
    const d = montarHome(l, new Date(), { local: 'Recepção', dispositivo: 'Tablet 01', versao: 'teste' });
    assert.equal(d.agenda.ensaios[1].comanda.podeAbrir, false);
  });

// O teste gêmeo em home.test.mjs monta `eu_nome: null` na mão e por isso passava
// mesmo quando a consulta não filtrava `ativo` — a linha do desativado continuava
// existindo, e a Home montava normal. Quem prova isto é o banco, não o fixture.
test('claim de quem foi desativado no meio do turno nao monta a tela',
  { skip: !disponivel && 'sem Postgres' }, () => {
    const l = rodarConsulta(PAULO, `update colaborador set ativo = false where id = '${PAULO}';`);

    assert.equal(l.eu_nome, null);
    assert.throws(
      () => montarHome(l, new Date(), { local: 'Recepção', dispositivo: 'Tablet 01', versao: 'teste' }),
      (e) => e.code === 'LT_SEM_COLABORADOR',
    );
  });
