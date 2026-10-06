// GET /tela/avisos: a consulta no banco e a montagem do DadosAvisos.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_AVISOS, montarAvisos } from '../../src/api/telas/avisos.mjs';
import { bancoDisponivel, MARCOS, JANA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const FUNDO = '99999999-0000-0000-0000-000000000001';

// Um urgente de duas linhas que o Marcos confirmou e o Paulo nao; um normal fora
// do snapshot do Paulo; um arquivado. Uma notificacao para o Paulo.
const SEMEAR = `
insert into aviso (id, texto, prioridade, status, autor_id, snapshot_colaboradores, criado_em) values
  ('${FUNDO}', E'Fundo branco em manutencao\\nEnsaios de fundo branco vao pro Acustico.', 'urgente', 'ativo',
   '${JANA}', '{${PAULO},${MARCOS}}', now() - interval '1 day'),
  ('99999999-0000-0000-0000-000000000002', 'Domingo abre 11h', 'normal', 'ativo', '${JANA}', '{${MARCOS}}', now()),
  ('99999999-0000-0000-0000-000000000003', 'Aviso velho', 'normal', 'arquivado', '${JANA}', '{}', now() - interval '20 days');
insert into confirmacao_leitura (comunicado_id, colaborador_id) values ('${FUNDO}', '${MARCOS}');

insert into notificacao (destinatario_id, texto, categoria, status, referencia_ativo) values
  ('${PAULO}', 'Extra de ontem sem colaborador na escala', 'dinheiro', 'nao_vista', 'hora_extra');
`;

const rodar = (comoQuem, aba = 'ativos', extra) => rodarTela({
  consulta: CONSULTA_AVISOS, comoQuem, semear: SEMEAR, extra, json: ['avisos', 'notificacoes', 'lembretes', 'categorias'],
  parametros: [['text', `'${aba}'`]],
});

const AGORA = new Date();

test('avisos: o Admin ve quem confirmou e quem falta', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA), AGORA);

  assert.deepEqual(d.abas.map((a) => a.rotulo), ['Publicados', 'Do sistema', 'Lembretes', 'Arquivados']);
  const [fundo, domingo] = d.avisos;
  assert.deepEqual([fundo.titulo, fundo.texto], ['Fundo branco em manutencao', 'Ensaios de fundo branco vao pro Acustico.']);
  assert.deepEqual(fundo.status, { rotulo: '1 de 2 confirmaram', aparencia: 'faixa' });
  assert.equal(fundo.faltam, 'falta: Paulo');
  // A Jana escreveu o aviso: edita (0072).
  assert.deepEqual(fundo.acoes.map((a) => a.identificador), ['leituras', 'editar', 'arquivar']);
  assert.match(fundo.leituras[0], /^Marcos — \d\d\/\d\d \d\d:\d\d$/);
  assert.equal(fundo.leituras[1], 'Paulo — sem confirmação');
  assert.equal(domingo.titulo, 'Domingo abre 11h');
});

test('avisos: o Atendente ve o que lhe pede confirmacao em destaque', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(PAULO), AGORA);

  assert.deepEqual(d.abas.map((a) => a.identificador), ['ativos', 'lembretes', 'arquivados']);
  const [fundo, domingo] = d.avisos;
  assert.equal(fundo.destaque, true);
  assert.deepEqual(fundo.marcadores.map((m) => m.rotulo), ['não lido', 'urgente']);
  assert.deepEqual(fundo.acoes.map((a) => a.identificador), ['confirmar']);
  assert.equal(fundo.faltam, '');
  // Fora do snapshot dele: nada a confirmar, nada a mostrar de status.
  assert.deepEqual([domingo.destaque, domingo.status, domingo.acoes], [false, null, []]);
});

test('avisos: "Do sistema" le notificacao, e para o Atendente cai em Ativos', { skip: semBanco }, () => {
  const admin = montarAvisos(rodar(JANA, 'sistema'), AGORA, 'sistema');
  assert.equal(admin.avisos.length, 1);
  assert.equal(admin.avisos[0].tipo, 'sistema');
  assert.match(admin.avisos[0].metadados, /para Paulo$/);
  assert.deepEqual(admin.avisos[0].acoes.map((a) => a.identificador), ['horas_extras']);

  const atendente = montarAvisos(rodar(PAULO, 'sistema'), AGORA, 'sistema');
  assert.equal(atendente.abas.find((a) => a.selecionada).identificador, 'ativos');
  assert.equal(atendente.avisos.every((a) => a.tipo === 'equipe'), true);
  assert.equal(atendente.avisos.length, 2);
});

test('avisos: alerta de lembrete atrasado leva a aba Lembretes', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA, 'sistema', `
    insert into notificacao (destinatario_id, texto, categoria, status, referencia_ativo)
    values ('${JANA}', 'Lembrete atrasado há 3 dias: Trocar filtro', 'lembrete', 'nao_vista', 'lembrete');`), AGORA, 'sistema');
  const alerta = d.avisos.find((a) => a.titulo.startsWith('Lembrete atrasado'));
  assert.deepEqual(alerta.acoes, [{ identificador: 'lembretes', rotulo: 'Ver em Lembretes', aparencia: 'discreta' }]);
});

test('avisos: arquivados', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA, 'arquivados'), AGORA, 'arquivados');
  assert.deepEqual(d.avisos.map((a) => [a.titulo, a.acoes]), [['Aviso velho', []]]);
});

test('avisos: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(PAULO, 'ativos', `update colaborador set ativo = false where id = '${PAULO}';`);
  assert.throws(() => montarAvisos(l, AGORA), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// ------------------------------------------------------ ADR 0056 (0059)
const DEV = 'aaaaaaaa-0000-0000-0000-000000000004';

test('avisos: o cartao leva a versao, que e o que confirmar e arquivar mandam', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA), AGORA);
  assert.deepEqual(d.avisos.map((a) => a.versao), [1, 1]);
});

test('avisos: o Desenvolvedor ve as leituras, mas nao arquiva', { skip: semBanco }, () => {
  const [fundo] = montarAvisos(rodar(DEV), AGORA).avisos;
  assert.deepEqual(fundo.acoes.map((a) => a.identificador), ['leituras']);
});

// Todo aviso vai para o snapshot dos ativos, Admin incluído. Sem o botão, o
// "arquiva quando todos confirmam" nunca fecharia.
test('avisos: quem nao e Atendente e esta no snapshot tambem confirma', { skip: semBanco }, () => {
  const l = rodar(JANA, 'ativos',
    `update aviso set snapshot_colaboradores = snapshot_colaboradores || '${JANA}'::uuid where id = '${FUNDO}';`);
  const [fundo] = montarAvisos(l, AGORA).avisos;
  assert.deepEqual(fundo.acoes.map((a) => a.identificador), ['confirmar', 'leituras', 'editar', 'arquivar']);
  assert.equal(fundo.acoes[0].rotulo, 'Li e entendi');
});

test('avisos: o formulario so vem com ?escrever=1, com os dois publicos e quantos cada um alcanca', { skip: semBanco }, () => {
  assert.equal(montarAvisos(rodar(PAULO), AGORA).formulario, null);

  const f = montarAvisos(rodar(PAULO), AGORA, 'ativos', true).formulario;
  // Na fixture: Jana (Admin), Marcos e Paulo (Atendentes) e o Dev, que nao conta (ADR 0058).
  assert.deepEqual(f.publicos, [
    { identificador: 'todos', rotulo: 'Todos', selecionado: true, pessoas: 3 },
    { identificador: 'atendentes', rotulo: 'Atendentes', selecionado: false, pessoas: 2 },
  ]);
  assert.deepEqual([f.pedeConfirmacao, f.urgente, f.podePublicar], [true, false, false]);
  assert.deepEqual([f.titulo, f.texto], ['', '']);
  assert.equal('fixar' in f, false);
});

// ADR 0058 (0061): sem confirmação não há destaque, "falta" nem "Li e entendi".
test('avisos: aviso sem confirmacao e so leitura, e diz para quem foi', { skip: semBanco }, () => {
  const extra = `update aviso set pede_confirmacao = false, publico = 'atendentes' where id = '${FUNDO}';`;

  const [fundoAdmin] = montarAvisos(rodar(JANA, 'ativos', extra), AGORA).avisos;
  assert.deepEqual(fundoAdmin.status, { rotulo: 'Sem confirmação', aparencia: 'discreta' });
  assert.equal(fundoAdmin.faltam, '');
  assert.deepEqual(fundoAdmin.acoes.map((a) => a.identificador), ['editar', 'arquivar']);
  assert.match(fundoAdmin.metadados, / · Jana · para atendentes$/);

  const [fundoPaulo] = montarAvisos(rodar(PAULO, 'ativos', extra), AGORA).avisos;
  assert.deepEqual([fundoPaulo.destaque, fundoPaulo.status, fundoPaulo.acoes], [false, null, []]);
  assert.deepEqual(fundoPaulo.marcadores.map((m) => m.rotulo), ['urgente']);
});

// ------------------------------------------------------ editar (0072)
// "Editável pelo autor enquanto Ativo" (0007): a regra é autoria, não perfil.
const ids = (aviso) => aviso.acoes.map((a) => a.identificador);

test('avisos: so o autor ve Editar, seja Admin ou Atendente', { skip: semBanco }, () => {
  const doMarcos = `update aviso set autor_id = '${MARCOS}' where id = '${FUNDO}';`;

  // O Admin arquiva o de qualquer um, mas não edita o que não escreveu.
  assert.deepEqual(ids(montarAvisos(rodar(JANA, 'ativos', doMarcos), AGORA).avisos[0]), ['leituras', 'arquivar']);
  assert.deepEqual(ids(montarAvisos(rodar(MARCOS, 'ativos', doMarcos), AGORA).avisos[0]), ['editar']);
  assert.deepEqual(ids(montarAvisos(rodar(PAULO, 'ativos', doMarcos), AGORA).avisos[0]), ['confirmar']);
  assert.deepEqual(ids(montarAvisos(rodar(DEV, 'ativos', doMarcos), AGORA).avisos[0]), ['leituras']);
});

test('avisos: arquivado nao se edita, nem pelo autor', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA, 'arquivados', `update aviso set status = 'arquivado' where id = '${FUNDO}';`),
    AGORA, 'arquivados');
  const fundo = d.avisos.find((a) => a.titulo === 'Fundo branco em manutencao');
  assert.deepEqual(ids(fundo), ['leituras']);
});

test('avisos: a confirmacao de antes da edicao nao conta', { skip: semBanco }, () => {
  // O Marcos confirmou a edição 1; o aviso está na 2.
  const editado = `update aviso set edicao = 2 where id = '${FUNDO}';`;

  const [fundo] = montarAvisos(rodar(JANA, 'ativos', editado), AGORA).avisos;
  assert.deepEqual(fundo.status, { rotulo: '0 de 2 confirmaram', aparencia: 'faixa' });
  assert.equal(fundo.faltam, 'falta: Marcos, Paulo');
  assert.match(fundo.metadados, / · Jana · para todos · editado$/);

  const [doMarcos] = montarAvisos(rodar(MARCOS, 'ativos', editado), AGORA).avisos;
  assert.deepEqual(ids(doMarcos), ['confirmar']);
});

// A frase do "Salvar" (ADR 0069 §4): sem confirmação, não há leitura a zerar.
test('avisos: a edicao so avisa que zera as leituras quando o aviso pede confirmacao', { skip: semBanco }, () => {
  const [pede] = montarAvisos(rodar(JANA, 'ativos'), AGORA).avisos;
  assert.equal(pede.avisoDaEdicao, 'Salvar volta a pedir confirmação de quem já leu.');
  const [naoPede] = montarAvisos(rodar(JANA, 'ativos', `update aviso set pede_confirmacao = false where id = '${FUNDO}';`), AGORA).avisos;
  assert.equal(naoPede.avisoDaEdicao, '');
});

// ------------------------------------------------------ ADR 0066 (0069)
// "Hoje" é a quarta do INSTANTE. A gráfica já está na janela dos 3 dias; o
// fundo ainda não; o de hoje não tem antecedência; o concluído não aparece.
const PAGAMENTO = '98888888-0000-0000-0000-000000000001';
const LEMBRETES = `
insert into categoria_lembrete (id, nome, antecedencia_padrao, ativo) values
  ('${PAGAMENTO}', 'Pagamento de fornecedor', 3, true),
  ('98888888-0000-0000-0000-000000000002', 'Contato', 1, false);
insert into lembrete (texto, data_alvo, status, origem, categoria_id, antecedencia_snapshot) values
  ('Pagar a grafica', app.quarta_recente() + 2, 'ativo', 'admin', '${PAGAMENTO}', 3),
  ('Trocar o fundo', app.quarta_recente() + 10, 'ativo', 'admin', '${PAGAMENTO}', 3),
  (E'Ligar para a Ana\nSobre o carregador', app.quarta_recente(), 'ativo', 'admin', '${PAGAMENTO}', 0),
  ('Ja feito', app.quarta_recente(), 'concluido', 'admin', '${PAGAMENTO}', 0);
`;

test('lembretes: o Admin ve todos os abertos, por data, e o que ainda nao apareceu para a equipe', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA, 'lembretes', LEMBRETES), AGORA, 'lembretes');

  assert.deepEqual(d.abas.map((a) => a.identificador), ['ativos', 'sistema', 'lembretes', 'arquivados']);
  assert.deepEqual(d.avisos.map((a) => a.titulo), ['Ligar para a Ana', 'Pagar a grafica', 'Trocar o fundo']);
  const [ana, grafica, fundo] = d.avisos;
  assert.equal(ana.texto, 'Sobre o carregador');
  assert.deepEqual(ana.status, { rotulo: 'É hoje', aparencia: 'faixa' });
  assert.match(ana.metadados, /^para \d\d\/\d\d · avisa no dia$/);
  assert.equal(grafica.status, null);
  assert.match(grafica.metadados, / · avisa 3 dias antes$/);
  assert.deepEqual(grafica.marcadores, [{ rotulo: 'Pagamento de fornecedor', aparencia: 'neutra' }]);
  assert.match(fundo.status.rotulo, /^Aparece em \d\d\/\d\d$/);
  // O Admin conclui qualquer aberto, até o que a equipe ainda não vê (ADR 0067 §1).
  const concluir = [{ identificador: 'concluir', rotulo: 'Concluir', aparencia: 'principal' }];
  assert.deepEqual(d.avisos.map((a) => [a.tipo, a.acoes]), [['lembrete', concluir], ['lembrete', concluir], ['lembrete', concluir]]);

  assert.deepEqual([d.podeEscrever, d.rotuloEscrever, d.formulario, d.formularioLembrete], [true, 'Criar lembrete', null, null]);
  assert.deepEqual(d.categorias.itens.map((c) => [c.nome, c.detalhe, c.versao]), [
    ['Pagamento de fornecedor', 'avisa 3 dias antes', 1],
    ['Contato', 'avisa 1 dia antes · desativada', 1],
  ]);
});

test('lembretes: o Atendente so ve o que ja entrou na antecedencia, e nao cria nem ve categoria', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(PAULO, 'lembretes', LEMBRETES), AGORA, 'lembretes', true);

  assert.deepEqual(d.abas.map((a) => a.identificador), ['ativos', 'lembretes', 'arquivados']);
  assert.deepEqual(d.avisos.map((a) => a.titulo), ['Ligar para a Ana', 'Pagar a grafica']);
  assert.deepEqual([d.podeEscrever, d.formularioLembrete, d.categorias], [false, null, null]);
  // Conclui o que vê.
  assert.ok(d.avisos.every((a) => a.acoes.some((x) => x.identificador === 'concluir')));
});

test('lembretes: o Desenvolvedor ve a lista, mas nao cria', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(DEV, 'lembretes', LEMBRETES), AGORA, 'lembretes', true);
  assert.equal(d.avisos.length, 3);
  assert.deepEqual([d.podeEscrever, d.formularioLembrete, d.categorias], [false, null, null]);
  assert.ok(d.avisos.every((a) => a.acoes.length === 0), 'e nao conclui: a lista e da operacao');
});

test('lembretes: o formulario so oferece categoria ativa, ja com a antecedencia dela', { skip: semBanco }, () => {
  const f = montarAvisos(rodar(JANA, 'lembretes', LEMBRETES), AGORA, 'lembretes', true).formularioLembrete;
  assert.deepEqual(f.categorias, [
    { identificador: PAGAMENTO, rotulo: 'Pagamento de fornecedor', antecedencia: 3, selecionada: false },
  ]);
  assert.match(f.hoje, /^\d{4}-\d\d-\d\d$/);
  assert.deepEqual([f.texto, f.data, f.antecedencia, f.podeCriar], ['', '', '', false]);
});

test('lembretes: catalogo vazio e a verdade, nao falta de configuracao (ADR 0043)', { skip: semBanco }, () => {
  const d = montarAvisos(rodar(JANA, 'lembretes'), AGORA, 'lembretes', true);
  assert.deepEqual([d.avisos, d.categorias.itens, d.formularioLembrete.categorias], [[], [], []]);
  assert.equal(d.mensagemVazia, 'Nenhum lembrete aberto.');
});
