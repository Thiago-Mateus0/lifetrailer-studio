// GET /tela/sidebar: a consulta no banco e a montagem do DadosSidebar.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_SIDEBAR, montarSidebar } from '../../src/api/telas/sidebar.mjs';
import { bancoDisponivel, JANA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const SEMEAR = `
insert into item_catalogo (id, nome, acao, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Fundo', 'conferir', 'entrada', '{1,2,3,4,5}', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'Radio', 'conferir', 'entrada', '{1,2,3,4,5}', 2);
insert into checklist_dia (id, data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values ('eeeeeeee-0000-0000-0000-000000000001', app.quarta_recente(), 'pendente', 'pendente',
        (app.quarta_recente() + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);
insert into item_execucao (checklist_dia_id, data, item_catalogo_id, fase, estado)
select 'eeeeeeee-0000-0000-0000-000000000001', app.quarta_recente(), id, 'entrada', 'nao_marcado'
  from item_catalogo;

insert into item_estoque (nome, categoria, severidade, quantidade, conferido_em) values
  ('Propes',       'Limpeza', 'urgente', 0, now()),
  ('Papel toalha', 'Limpeza', 'atencao', 1, now()),
  ('Cafe',         'Cafe',    'atencao', 0, null);

-- Um urgente e um normal para o Paulo; um que ele ja confirmou; um em que ele
-- nao estava no snapshot (entrou depois) e por isso nao lhe pede nada.
insert into aviso (id, texto, prioridade, status, autor_id, snapshot_colaboradores) values
  ('99999999-0000-0000-0000-000000000001', 'Urgente', 'urgente', 'ativo', '${JANA}', '{${PAULO}}'),
  ('99999999-0000-0000-0000-000000000002', 'Normal',  'normal',  'ativo', '${JANA}', '{${PAULO}}'),
  ('99999999-0000-0000-0000-000000000003', 'Lido',    'urgente', 'ativo', '${JANA}', '{${PAULO}}'),
  ('99999999-0000-0000-0000-000000000004', 'Antes',   'urgente', 'ativo', '${JANA}', '{}');
insert into confirmacao_leitura (comunicado_id, colaborador_id)
values ('99999999-0000-0000-0000-000000000003', '${PAULO}');
`;

const rodar = (comoQuem, extra) => rodarTela({
  consulta: CONSULTA_SIDEBAR, comoQuem, semear: SEMEAR, extra,
  json: ['estoque_zerados_nomes', 'avisos_urgentes_lista'],
});

test('sidebar: a consulta conta o que pede gesto de quem esta logado', { skip: semBanco }, () => {
  const l = rodar(PAULO);
  assert.equal(l.eu_nome, 'Paulo');
  assert.equal(l.checklist_fase, 'entrada');
  assert.equal(l.checklist_pendentes, '2');
  assert.equal(l.estoque_zerados, '1');        // o nao conferido nao conta
  assert.equal(l.estoque_atencao, '1');
  assert.deepEqual(l.estoque_zerados_nomes, ['Propes']);
  assert.equal(l.avisos_pendentes, '2');       // sem o lido e sem o de antes dele
  assert.equal(l.avisos_urgentes, '1');
});

// ADR 0058: o aviso que não pede confirmação não espera gesto de ninguém.
test('sidebar: aviso sem confirmacao nao conta', { skip: semBanco }, () => {
  const l = rodar(PAULO, `update aviso set pede_confirmacao = false where texto = 'Urgente';`);
  assert.deepEqual([l.avisos_pendentes, l.avisos_urgentes], ['1', '0']);
});

// ADR 0069: editar volta a pedir confirmação. A do texto antigo fica na tabela
// (append-only), mas não tira o aviso do contador.
test('sidebar: confirmacao de uma edicao antiga nao conta', { skip: semBanco }, () => {
  const l = rodar(PAULO, `update aviso set edicao = 2 where texto = 'Lido';`);
  assert.deepEqual([l.avisos_pendentes, l.avisos_urgentes], ['3', '2']);
});

// ADR 0070: o modal da próxima navegação lê esta lista, na mesma regra da contagem.
test('sidebar: lista os urgentes que esperam a confirmacao de quem esta logado', { skip: semBanco }, () => {
  const d = montarSidebar(rodar(PAULO, `update aviso set texto = E'Porta dos fundos\\nUse a da frente'
    where texto = 'Urgente';`), new Date());
  assert.deepEqual(d.avisosUrgentes, [{
    identificador: '99999999-0000-0000-0000-000000000001', versao: 1,
    titulo: 'Porta dos fundos', texto: 'Use a da frente',
  }]);
});

test('sidebar: urgente editado depois da confirmacao volta a lista', { skip: semBanco }, () => {
  const d = montarSidebar(rodar(PAULO, `update aviso set edicao = 2 where texto = 'Lido';`), new Date());
  assert.deepEqual(d.avisosUrgentes.map((a) => a.titulo), ['Urgente', 'Lido']);
});

test('sidebar: urgente sem confirmacao nao entra na lista', { skip: semBanco }, () => {
  const d = montarSidebar(rodar(PAULO, `update aviso set pede_confirmacao = false where texto = 'Urgente';`), new Date());
  assert.deepEqual(d.avisosUrgentes, []);
});

test('sidebar: a linha do banco monta o menu e a faixa de urgentes', { skip: semBanco }, () => {
  const d = montarSidebar(rodar(PAULO), new Date());
  const item = (id) => d.itens.find((i) => i.identificador === id);

  assert.deepEqual([item('checklist').contador, item('checklist').destaque], [2, 'urgente']);
  assert.deepEqual([item('estoque').contador, item('estoque').destaque], [2, 'urgente']);
  assert.deepEqual([item('avisos').contador, item('avisos').destaque], [2, 'urgente']);
  assert.deepEqual(d.urgencias.map((u) => u.identificador), ['checklist', 'estoque', 'avisos']);
  assert.equal(d.urgencias[0].detalhe, '2 itens · limite 10:00');
  assert.equal(d.usuario.papel, 'Atendente');
});

test('sidebar: Ajustes e o badge de horas extras sao do Admin', { skip: semBanco }, () => {
  const extra = `insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim, origem,
      minutos_reais, minutos_arredondados, blocos_noturnos, valor, valor_hora_snapshot, status, criado_por_id)
    values ('${PAULO}', app.quarta_recente(), now(), now() + interval '30 minutes', 'manual',
      30, 30, 1, 25, 25, 'pendente', '${JANA}');`;

  const atendente = montarSidebar(rodar(PAULO, extra), new Date());
  assert.equal(atendente.itens.some((i) => i.identificador === 'ajustes'), false);
  assert.equal(atendente.itens.find((i) => i.identificador === 'horas').contador, undefined);

  const admin = montarSidebar(rodar(JANA, extra), new Date());
  assert.equal(admin.itens.some((i) => i.identificador === 'ajustes'), true);
  assert.equal(admin.itens.find((i) => i.identificador === 'horas').contador, 1);
});

test('sidebar: claim de desativado nao monta o menu', { skip: semBanco }, () => {
  const l = rodar(PAULO, `update colaborador set ativo = false where id = '${PAULO}';`);
  assert.throws(() => montarSidebar(l, new Date()), (e) => e.code === 'LT_SEM_COLABORADOR');
});

test('sidebar: sem nada pendente nao ha contador nem urgencia', () => {
  const d = montarSidebar({
    eu_nome: 'Jana Alves', eu_perfil: 'administrador',
    checklist_fase: null, checklist_limite: null, checklist_pendentes: '0',
    estoque_zerados: '0', estoque_atencao: '0', estoque_zerados_nomes: [],
    avisos_pendentes: '0', avisos_urgentes: '0', avisos_urgentes_lista: [], horas_pendentes: '0',
  }, new Date('2026-08-17T11:12:00Z'));

  assert.equal(d.itens.some((i) => i.contador !== undefined), false);
  assert.deepEqual(d.urgencias, []);
  assert.deepEqual(d.avisosUrgentes, []);
  assert.equal(d.totalUrgencias, 0);
  assert.equal(d.hora, '08:12');
  assert.deepEqual(d.usuario, { nome: 'Jana Alves', iniciais: 'JA', papel: 'Admin' });
});
