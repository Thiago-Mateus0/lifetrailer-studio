// GET /tela/checklist: a consulta no banco e a montagem do DadosChecklist.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_CHECKLIST, montarChecklist } from '../../src/api/telas/checklist.mjs';
import { bancoDisponivel, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const ACUSTICO = 'bbbbbbbb-0000-0000-0000-000000000001';
const DIA = 'eeeeeeee-0000-0000-0000-000000000001';
const BANHEIRO = 'ffffffff-0000-0000-0000-000000000001';  // justificado, com foto
const AR = 'ffffffff-0000-0000-0000-000000000002';        // feito
const FUNDO = 'ffffffff-0000-0000-0000-000000000003';     // por tratar
const CHAVES = 'ffffffff-0000-0000-0000-000000000004';    // por tratar, na saida

// Entrada: Acustico com um feito e um por marcar; Geral com um justificado.
// Saida: um item no Acustico. O item de Geral vem ANTES no catalogo, e mesmo
// assim a sala sai por ultimo — secao NULL fica fora dos estudios.
const SEMEAR = `
insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Banheiro', 'checar', null,        'entrada', '{1,2,3,4,5}', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'Ar',       'ligar',  '${ACUSTICO}', 'entrada', '{1,2,3,4,5}', 1),
  ('dddddddd-0000-0000-0000-000000000003', 'Fundo',    'checar', '${ACUSTICO}', 'entrada', '{1,2,3,4,5}', 2),
  ('dddddddd-0000-0000-0000-000000000004', 'Ar',       'desligar', '${ACUSTICO}', 'saida', '{1,2,3,4,5}', 1);

insert into checklist_dia (id, data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values ('${DIA}', app.quarta_recente(), 'pendente', 'pendente',
        (app.quarta_recente() + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);

insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id, enviado_por_id)
values ('77777777-0000-0000-0000-000000000001', 'x', 1, 'image/jpeg', 'checklist', '${DIA}', '${PAULO}');

insert into item_execucao (id, checklist_dia_id, data, item_catalogo_id, fase, estado,
                           marcado_por_id, marcado_em, justificativa_midia_id, justificativa_texto) values
  ('${BANHEIRO}', '${DIA}', app.quarta_recente(), 'dddddddd-0000-0000-0000-000000000001', 'entrada',
   'nao_feito_justificado', '${PAULO}', (app.quarta_recente() + time '08:03') at time zone 'America/Maceio',
   '77777777-0000-0000-0000-000000000001', 'Cano estourado'),
  ('${AR}', '${DIA}', app.quarta_recente(), 'dddddddd-0000-0000-0000-000000000002', 'entrada',
   'feito', '${PAULO}', (app.quarta_recente() + time '07:42') at time zone 'America/Maceio', null, null),
  ('${FUNDO}', '${DIA}', app.quarta_recente(), 'dddddddd-0000-0000-0000-000000000003', 'entrada',
   'nao_marcado', null, null, null, null),
  ('${CHAVES}', '${DIA}', app.quarta_recente(), 'dddddddd-0000-0000-0000-000000000004', 'saida',
   'nao_marcado', null, null, null, null);
`;

const rodar = ({
  fase = null, item = null, data = null, comoQuem = PAULO, semear = SEMEAR, extra, instante,
} = {}) => rodarTela({
  consulta: CONSULTA_CHECKLIST, comoQuem, semear, extra, instante, json: ['itens', 'selecionado', 'historico'],
  parametros: [
    ['text', fase === null ? 'null' : `'${fase}'`],
    ['uuid', item === null ? 'null' : `'${item}'`],
    ['date', data === null ? 'null' : `(${data})`],
  ],
});

// Quinta, o dia seguinte ao do SEMEAR.
const QUINTA = (hora) => `((app.quarta_recente() + 1 + time '${hora}') at time zone 'America/Maceio')`;
const DIA_QUINTA = `
insert into checklist_dia (data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values (app.quarta_recente() + 1, 'pendente', 'pendente',
        (app.quarta_recente() + 1 + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);`;

const AGORA = new Date();
// O segredo só assina o endereço da foto (ADR 0051 §5); o valor não importa.
const config = { segredo: 's'.repeat(32) };

test('checklist: sem fase pedida abre na do dia, e Geral fica por ultimo', { skip: semBanco }, () => {
  const d = montarChecklist(rodar(), AGORA, config);

  assert.equal(d.fase, 'entrada');
  assert.equal(d.titulo, 'Checklist de entrada');
  assert.match(d.subtitulo, / · limite 10:00 · saída libera ao concluir$/);
  assert.deepEqual([d.progresso.tratados, d.progresso.total], ['2', '3']);
  assert.equal(d.bloqueio, null);

  const salas = d.colunas.flatMap((c) => c.salas);
  assert.deepEqual(salas.map((s) => s.nome), ['Acustico', 'Geral']);
  assert.deepEqual(d.monitor.map((m) => [m.nome, m.contagem]), [['Acustico', '1/2'], ['Geral', '1/1']]);
  assert.equal(d.monitor[0].ultimaAtualizacao, 'última marcação 07:42');

  const [ar, fundo] = salas[0].itens;
  assert.deepEqual([ar.nome, ar.tratado, ar.hora, ar.podeJustificar], ['Ar · ligar', true, '07:42', false]);
  assert.deepEqual([fundo.tratado, fundo.podeTratar, fundo.podeJustificar], [false, true, true]);

  // Justificado conta pros 100%, mas sai pela justificativa, não pelo toque.
  const banheiro = salas[1].itens[0];
  assert.deepEqual([banheiro.tratado, banheiro.justificado, banheiro.podeTratar], [true, true, false]);
});

// Sem a versão do item e a do dia, nenhum botão pode escrever: a RPC de 0051
// exige as duas de volta. É o que liga a tela às escritas.
test('checklist: a tela leva a versao do dia e a de cada item', { skip: semBanco }, () => {
  const d = montarChecklist(rodar(), AGORA, config);

  assert.equal(d.dia.identificador, DIA);
  assert.equal(typeof d.dia.versao, 'number');
  const itens = d.colunas.flatMap((c) => c.salas).flatMap((s) => s.itens);
  assert.ok(itens.length > 0);
  assert.ok(itens.every((i) => typeof i.versao === 'number'));
});

test('checklist: sem checklist_dia nao ha o que concluir', { skip: semBanco }, () => {
  assert.equal(montarChecklist(rodar({ semear: '' }), AGORA, config).dia, null);
});

test('checklist: saida pedida com a entrada pendente vem bloqueada', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ fase: 'saida' }), AGORA, config);

  assert.equal(d.fase, 'saida');
  assert.equal(d.bloqueio.titulo, 'Saída bloqueada');
  assert.match(d.bloqueio.texto, /Faltam 1 item /);
  // Visivel, mas sem toque.
  assert.equal(d.colunas[0].salas[0].itens[0].podeTratar, false);
});

test('checklist: saida liberada quando a entrada concluiu', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({
    extra: `update checklist_dia set status_entrada = 'concluida' where id = '${DIA}';`,
  }), AGORA, config);

  assert.equal(d.fase, 'saida');
  assert.equal(d.bloqueio, null);
  assert.equal(d.colunas[0].salas[0].itens[0].podeTratar, true);
});

test('checklist: dia sem checklist_dia diz isso, nao "catalogo nao configurado"', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ semear: '' }), AGORA, config);
  assert.equal(d.bloqueio.titulo, 'Checklist de hoje não criado');
  assert.deepEqual(d.colunas, []);
});

test('checklist: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar({ extra: `update colaborador set ativo = false where id = '${PAULO}';` });
  assert.throws(() => montarChecklist(l, AGORA, config), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// ------------------------------------------------------------------- o modal
// O modal é recorte (`?item=`), não estado do cliente: a foto dele é um endereço
// ASSINADO, e assinar exige o segredo do processo (ADR 0051 §5).
test('checklist: sem ?item= nao ha modal', { skip: semBanco }, () => {
  assert.equal(montarChecklist(rodar(), AGORA, config).modal, null);
});

test('checklist: item justificado abre o modal de leitura, com a foto assinada', { skip: semBanco }, () => {
  const { modal } = montarChecklist(rodar({ item: BANHEIRO }), AGORA, config);

  assert.equal(modal.identificador, BANHEIRO);
  assert.equal(typeof modal.versao, 'number');
  assert.equal(modal.modo, 'Justificativa');
  assert.equal(modal.nome, 'Banheiro · checar');
  assert.equal(modal.texto, 'Cano estourado');
  assert.equal(modal.meta, 'por Paulo às 08:03');
  assert.equal(modal.editavel, false);
  assert.match(modal.foto, new RegExp(`^/midia/77777777-0000-0000-0000-000000000001\\?t=`));
});

test('checklist: item por tratar abre o modal de escrita, sem foto ainda', { skip: semBanco }, () => {
  const { modal } = montarChecklist(rodar({ item: FUNDO }), AGORA, config);

  assert.equal(modal.modo, 'Justificar item');
  assert.equal(modal.editavel, true);
  assert.equal(modal.texto, '');
  assert.equal(modal.meta, '');
  // Sem foto o campo nem existe: o componente desenha o quadro vazio.
  assert.equal(modal.foto, undefined);
  assert.equal(modal.fotoRotulo, 'obrigatória');
});

test('checklist: item feito nao abre modal — quem desfaz o feito e o toque', { skip: semBanco }, () => {
  assert.equal(montarChecklist(rodar({ item: AR }), AGORA, config).modal, null);
});

test('checklist: mídia expirada nao vira endereco que responderia 410', { skip: semBanco }, () => {
  const { modal } = montarChecklist(rodar({
    item: BANHEIRO,
    extra: `update midia set expirada_em = now() where id = '77777777-0000-0000-0000-000000000001';`,
  }), AGORA, config);

  assert.equal(modal.foto, undefined);
  assert.equal(modal.texto, 'Cano estourado');
});

test('checklist: saida bloqueada nao abre modal', { skip: semBanco }, () => {
  assert.equal(montarChecklist(rodar({ fase: 'saida', item: CHAVES }), AGORA, config).modal, null);
});

// ADR 0072 §9: motivo gravado, foto na fila. Não conta pros 100%, e sai pelo
// modal de leitura ("Remover justificativa"), nunca pelo toque.
const PENDENTE = `update item_execucao
   set estado = 'nao_feito_pendente_anexo', justificativa_texto = 'Sem luz',
       marcado_por_id = '${PAULO}', marcado_em = now()
 where id = '${FUNDO}';`;

test('checklist: item pendente de anexo nao conta como tratado', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ extra: PENDENTE }), AGORA, config);

  assert.deepEqual([d.progresso.tratados, d.progresso.total], ['2', '3']);
  const fundo = d.colunas.flatMap((c) => c.salas).flatMap((s) => s.itens).find((i) => i.identificador === FUNDO);
  assert.deepEqual(
    [fundo.tratado, fundo.justificado, fundo.podeTratar, fundo.podeJustificar, fundo.hora],
    [false, true, false, false, 'foto a caminho']);
});

test('checklist: saida bloqueada conta o pendente de anexo como falta', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ fase: 'saida', extra: PENDENTE }), AGORA, config);
  assert.match(d.bloqueio.texto, /Faltam 1 item /);
});

test('checklist: item pendente de anexo abre o modal de leitura, com a foto a caminho', { skip: semBanco }, () => {
  const { modal } = montarChecklist(rodar({ item: FUNDO, extra: PENDENTE }), AGORA, config);

  assert.equal(modal.modo, 'Justificativa');
  assert.equal(modal.editavel, false);
  assert.equal(modal.texto, 'Sem luz');
  assert.equal(modal.foto, undefined);
  assert.equal(modal.fotoRotulo, 'a caminho');
});

// ---------------------------------------------------------------- ADR 0087

test('checklist: de madrugada a saida de ontem ainda e o checklist, e se toca', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({
    fase: 'saida', instante: QUINTA('01:00'),
    extra: `update checklist_dia set status_entrada = 'concluida' where id = '${DIA}';`,
  }), AGORA, config);

  assert.equal(d.dia.identificador, DIA);
  assert.equal(d.bloqueio, null);
  assert.equal(d.colunas[0].salas[0].itens[0].podeTratar, true);
});

test('checklist: atendente nao tem historico, e a data pedida e ignorada', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({
    data: 'app.quarta_recente()', semear: SEMEAR + DIA_QUINTA, instante: QUINTA('08:12'),
  }), AGORA, config);

  assert.equal(d.historico, null);
  assert.notEqual(d.dia, null);
  assert.notEqual(d.dia.identificador, DIA);
});

test('checklist: admin abre um dia passado so pra ler', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({
    comoQuem: HELENA, data: 'app.quarta_recente()', item: BANHEIRO,
    semear: SEMEAR + DIA_QUINTA, instante: QUINTA('08:12'),
  }), AGORA, config);

  assert.equal(d.historico.somenteLeitura, true);
  assert.equal(d.dia, null);
  const itens = d.colunas.flatMap((c) => c.salas).flatMap((s) => s.itens);
  assert.equal(itens.length, 3);
  assert.ok(itens.every((i) => !i.podeTratar && !i.podeJustificar));
  // A justificativa se lê, não se remove.
  assert.equal(d.modal.podeRemover, false);
  assert.deepEqual(d.historico.dias.map((dia) => [dia.situacao, dia.selecionado]),
    [['entrada pendente', false], ['entrada pendente', true]]);
});

test('checklist: admin sem data pedida fica no dia vigente, que se toca', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ comoQuem: HELENA }), AGORA, config);

  assert.equal(d.historico.somenteLeitura, false);
  assert.equal(d.dia.identificador, DIA);
  assert.equal(d.historico.dias[0].selecionado, true);
});

test('checklist: dia passado sem checklist e "nao houve expediente"', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ comoQuem: HELENA, data: 'app.quarta_recente() - 1' }), AGORA, config);

  assert.equal(d.bloqueio.titulo, 'Não houve expediente');
  assert.equal(d.dia, null);
});

test('checklist: data futura nao abre — volta ao dia vigente', { skip: semBanco }, () => {
  const d = montarChecklist(rodar({ comoQuem: HELENA, data: 'app.quarta_recente() + 3' }), AGORA, config);

  assert.equal(d.historico.somenteLeitura, false);
  assert.equal(d.dia.identificador, DIA);
});
