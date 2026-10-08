// GET /tela/comanda: a consulta no banco e a montagem do DadosComanda.
//
// As Comandas do cenário nascem pelas RPC de verdade (app.comanda_criar,
// app.comanda_transicionar) e não por INSERT: o que a tela mostra é o que a FSM
// produz, e um INSERT à mão provaria só o INSERT.
import assert from 'node:assert/strict';
import test from 'node:test';

import { blocosDaExtensao, CONSULTA_COMANDA, linhaNoturnoAgendado, montarComanda, telefoneNaTela } from '../../src/api/telas/comanda.mjs';
import { bancoDisponivel, MARCOS, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const BISCOITO = 'cccccccc-0000-0000-0000-000000000001';
const HOJE_AS = (h) => `((app.quarta_recente() + time '${h}') at time zone 'America/Maceio')`;

// Marcos tem uma aberta (com extras) e uma fechada; Paulo tem uma aberta, que para
// o Marcos é lista de assunção.
const SEMEAR = `
-- app.exigir_ator confere o ator contra a identidade da transação (0014): o
-- semeador tem de dizer quem está agindo, como o processo diz.
select set_config('app.colaborador_id', '${MARCOS}', true);

insert into item_extra (id, nome, tipo, preco_uso_interno, ativo) values
  ('88888888-0000-0000-0000-000000000001', 'Fundo Branco', 'fundo', 30.00, true),
  ('88888888-0000-0000-0000-000000000002', 'Softbox', 'equipamento', 20.00, false);

create temporary table cenario (papel text primary key, comanda_id uuid);

insert into cenario
select 'aberta_marcos', (app.comanda_criar(
  app.agendamento_teste('cli-1', ${HOJE_AS('09:00')}), 'gerar_manual', '${MARCOS}')).id;

insert into cenario
select 'fechada_marcos', (app.comanda_criar(
  app.agendamento_teste('cli-2', ${HOJE_AS('11:00')}), 'gerar_manual', '${MARCOS}')).id;

select set_config('app.colaborador_id', '${PAULO}', true);
insert into cenario
select 'aberta_paulo', (app.comanda_criar(
  app.agendamento_teste('cli-3', ${HOJE_AS('15:00')}), 'gerar_manual', '${PAULO}')).id;
select set_config('app.colaborador_id', '${MARCOS}', true);

insert into comanda_item_extra (comanda_id, item_extra_id, quantidade, preco_snapshot)
select comanda_id, '88888888-0000-0000-0000-000000000001', 1, 30.00
  from cenario where papel = 'aberta_marcos';

insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
select comanda_id, '${BISCOITO}', 2, 6.70
  from cenario where papel = 'aberta_marcos';

select app.comanda_transicionar(
  (select comanda_id from cenario where papel = 'fechada_marcos'),
  'fechar', 1, '${MARCOS}', ${HOJE_AS('12:00')});
`;

// O id da Comanda selecionada sai do cenário por \gset: `execute` não aceita
// subconsulta como parâmetro, e o cenário nasce com uuid gerado pelo banco.
// ⚠ \gset com NULL APAGA a variável, e `:'sel'` sem variável vira erro de
// sintaxe — por isso o caso sem seleção guarda string vazia, não null.
const rodar = (comoQuem, { modo = null, dia = null, status = null, busca = null, comanda = null, extra = '' } = {}) =>
  rodarTela({
    consulta: CONSULTA_COMANDA, comoQuem, semear: SEMEAR,
    extra: `${extra}\n`
      + (comanda === null
          ? "select '' as sel \\gset"
          : `select comanda_id::text as sel from cenario where papel = '${comanda}' \\gset`),
    json: ['lista', 'selecionada', 'linhas', 'envios', 'ajustes', 'catalogo', 'estudios'],
    parametros: [
      ['text', modo === null ? 'null' : `'${modo}'`],
      ['date', dia === null ? 'null' : `'${dia}'`],
      ['text', status === null ? 'null' : `'${status}'`],
      ['text', busca === null ? 'null' : `'${busca}'`],
      ['uuid', "nullif(:'sel', '')"],
    ],
  });

const AGORA = new Date();
const daLista = (dados, cliente) => dados.lista.find((c) => c.cliente === cliente);

test('comanda: a lista de ativas traz as três, e o total da aberta é ao vivo', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS), AGORA);

  assert.equal(d.lista.length, 3);
  // Ensaio 97,00 + fundo 30,00 + 2 biscoitos a 6,70 (data/precos.csv e o seed).
  assert.equal(daLista(d, 'Cliente cli-1').total, 'R$ 140,40');
  assert.equal(d.abertas, '2');
});

test('comanda: aberta de outro atendente é lista de assunção, sem valores', { skip: semBanco }, () => {
  const item = daLista(montarComanda(rodar(MARCOS), AGORA), 'Cliente cli-3');

  assert.equal(item.status, 'assuncao');
  assert.equal(item.statusRotulo, 'aguardando assunção');
  assert.equal(item.total, '');
  assert.equal(item.responsavel, 'Paulo');
});

test('comanda: o Admin vê o valor da Comanda que não é dele', { skip: semBanco }, () => {
  assert.equal(daLista(montarComanda(rodar(HELENA), AGORA), 'Cliente cli-3').total, 'R$ 97,00');
});

test('comanda: o detalhe em assunção não carrega valor nenhum', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS, { comanda: 'aberta_paulo' }), AGORA);

  assert.equal(d.selecionada.assuncao.botao, 'Assumir comanda');
  assert.equal(d.selecionada.resumo, null);
  assert.deepEqual(d.selecionada.extras, []);
  assert.deepEqual(d.selecionada.acoes, []);
  assert.equal(JSON.stringify(d.selecionada).includes('97,00'), false);
});

test('comanda: o detalhe da aberta lista extras e bomboniere, e deixa fechar', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS, { comanda: 'aberta_marcos' }), AGORA);
  const s = d.selecionada;

  assert.equal(s.numero, 'sem número');
  // Um grupo por tipo, na ordem do bloco; grupo sem linha não aparece.
  assert.deepEqual(s.extras.map((g) => [g.identificador, g.contagem, g.subtotal]), [
    ['bomboniere', '2 itens', 'R$ 13,40'],
    ['fundo', '1 item', 'R$ 30,00'],
  ]);
  assert.deepEqual(s.extras.flatMap((g) => g.linhas.map((e) => [e.nome, e.quantidade, e.total])), [
    ['Biscoito', '2', 'R$ 13,40'],
    ['Fundo Branco', '1', 'R$ 30,00'],
  ]);
  // O subtotal do resumo é a soma dos subtotais dos grupos mais o ensaio: é a
  // conferência que a tela agora deixa fazer de olho, e que o relato de
  // "a soma não bate" pedia.
  assert.equal(s.resumo.extras, 'R$ 43,40');
  assert.equal(s.resumo.subtotal, 'R$ 140,40');
  assert.equal(s.resumo.congelado, false);
  // O horário praticado é campo da tela, não trava do servidor: fechar sai
  // ligado, dizendo o que a cascata vai fazer.
  const fechar = s.acoes.find((a) => a.identificador === 'fechar');
  assert.equal(fechar.desativada, false);
  assert.match(fechar.motivo, /baixa no bomboniere/);
});

// A válvula de escape do spec (item fora do catálogo) não tem tipo de catálogo:
// sem grupo próprio ela cairia junto dos fundos, e o subtotal do grupo deixaria
// de explicar o resumo — que é justamente o que se foi conferir.
test('comanda: item fora do catálogo é grupo próprio, e os grupos explicam o resumo', { skip: semBanco }, () => {
  const s = montarComanda(rodar(MARCOS, {
    comanda: 'aberta_marcos',
    extra: `insert into comanda_item_extra (comanda_id, item_extra_id, descricao, quantidade, preco_snapshot)
            select comanda_id, null, 'Beca americana', 2, 45.00 from cenario where papel = 'aberta_marcos';`,
  }), AGORA).selecionada;
  const fora = s.extras.find((g) => g.identificador === 'fora');

  assert.deepEqual([fora.titulo, fora.contagem, fora.subtotal, fora.tabela],
    ['Fora do catálogo', '2 itens', 'R$ 90,00', 'item_extra']);
  assert.deepEqual(fora.linhas.map((l) => l.nome), ['Beca americana']);
  // 13,40 + 30,00 + 90,00 = 133,40, e com o ensaio de 97,00 dá o subtotal.
  assert.equal(s.resumo.extras, 'R$ 133,40');
  assert.equal(s.resumo.subtotal, 'R$ 230,40');
  assert.deepEqual(s.extras.map((g) => g.tabela), ['bomboniere', 'item_extra', 'item_extra']);
});

// Estúdio adicional (ADR 0085): nasce pela RPC, vira grupo próprio, e a aberta
// oferece os OUTROS estúdios com as durações da tabela.
test('comanda: estúdio adicional é grupo próprio, e a aberta oferece os outros estúdios', { skip: semBanco }, () => {
  const s = montarComanda(rodar(MARCOS, {
    comanda: 'aberta_marcos',
    extra: `insert into estudio (id, nome, staff_id, ordem_exibicao)
              values ('bbbbbbbb-0000-0000-0000-000000000002', 'Branco', 2, 2);
            insert into tabela_preco (estudio_id, duracao_minutos, valor, vigencia_inicio)
              values ('bbbbbbbb-0000-0000-0000-000000000002', 60, 107.00, date '2026-08-10');
            select app.comanda_estudio_lancar(comanda_id, 1, 'bbbbbbbb-0000-0000-0000-000000000002',
                     ${HOJE_AS('10:00')}, 60, '${MARCOS}')
              from cenario where papel = 'aberta_marcos';`,
  }), AGORA).selecionada;
  const estudio = s.extras.find((g) => g.identificador === 'estudio');

  assert.deepEqual([estudio.titulo, estudio.subtotal, estudio.tabela],
    ['Estúdio adicional', 'R$ 107,00', 'item_extra']);
  assert.deepEqual(estudio.linhas.map((l) => l.nome), ['Estúdio Branco · 1h · 10:00–11:00']);
  // O próprio Acustico não aparece: tempo a mais nele é extensão.
  assert.deepEqual(s.lancamento.estudios, [
    { identificador: 'bbbbbbbb-0000-0000-0000-000000000002', nome: 'Branco', duracoes: [{ minutos: 60, preco: '107,00' }] },
  ]);
  assert.deepEqual([s.lancamento.inicioSugerido, s.lancamento.inicioEnsaio], ['10:00', '09:00']);
});

test('comanda: a aberta leva o catálogo e o horário praticado sugerido', { skip: semBanco }, () => {
  const s = montarComanda(rodar(MARCOS, { comanda: 'aberta_marcos' }), AGORA).selecionada;

  // Biscoito (bomboniere) e Fundo Branco (item extra); o Softbox desativado do
  // seed não entra, porque linha nova não aceita item desativado (0049).
  assert.deepEqual(s.lancamento.catalogo.map((i) => [i.nome, i.tipo]), [
    ['Biscoito', 'bomboniere'], ['Fundo Branco', 'fundo'],
  ]);
  // Sem praticado ainda: sugere o agendado, na data do ENSAIO.
  assert.deepEqual([s.praticado.inicio, s.praticado.fim], ['09:00', '10:00']);
  assert.match(s.praticado.data, /^\d{4}-\d{2}-\d{2}$/);
});

test('comanda: fechada congela o total e ganha número; no tablet reabre e recebe (ADR 0073 §1, 0086)', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS, { comanda: 'fechada_marcos' }), AGORA);
  const s = d.selecionada;

  assert.equal(s.status, 'fechada');
  assert.match(s.numero, /^#\d+$/);
  assert.equal(s.resumo.congelado, true);
  assert.deepEqual(s.acoes.map((a) => a.identificador), ['reabrir', 'receber']);
  assert.equal(s.acoes.find((a) => a.identificador === 'reabrir').desativada, false);
  assert.deepEqual(s.acoes.find((a) => a.identificador === 'receber').formas.map((f) => f.rotulo),
    ['Pix', 'Dinheiro', 'Crédito', 'Débito']);
  // Sem o que enviar, o tablet não recebe o telefone cheio nem o comprovante.
  assert.equal(s.envio, null);
  assert.equal(s.comprovante, null);
  assert.equal(d.modos.some((m) => m.identificador === 'enviar'), false);
});

test('comanda: a Helena copia, baixa e marca Enviei na fechada', { skip: semBanco }, () => {
  const s = montarComanda(rodar(HELENA, { comanda: 'fechada_marcos' }), AGORA).selecionada;

  assert.deepEqual(s.acoes.map((a) => [a.identificador, a.rotulo]), [
    ['copiar', 'Copiar mensagem'], ['baixar', 'Baixar PDF'], ['enviar', 'Já mandei por fora'], ['reabrir', 'Reabrir comanda'],
    ['receber', 'Recebi'],
  ]);
  // Primeiro envio, por quem está na sessão; fechou no horário, então sem bloco.
  assert.deepEqual(
    { ...s.comprovante, dataDoEnsaio: undefined },
    { envio: 1, enviadoPor: 'Helena', blocos: [], noturnoAgendado: null, primeiroNome: 'Cliente', dataDoEnsaio: undefined },
  );
  assert.match(s.comprovante.dataDoEnsaio, /^\d{2}\/\d{2}\/\d{4}$/);
});

test('comanda: com o ManyChat ligado, Enviar vem primeiro na fechada (ADR 0076 §3)', { skip: semBanco }, () => {
  const linha = rodar(HELENA, { comanda: 'fechada_marcos' });
  assert.deepEqual(montarComanda(linha, AGORA, { envioAutomatico: true }).selecionada.acoes.map((a) => a.identificador),
    ['enviar_manychat', 'copiar', 'baixar', 'enviar', 'reabrir', 'receber']);
  const marcos = rodar(MARCOS, { comanda: 'fechada_marcos' });
  assert.equal(montarComanda(marcos, AGORA, { envioAutomatico: true }).selecionada.acoes
    .some((a) => a.identificador === 'enviar_manychat'), false);
});

test('comanda: enviada, o comprovante é o do último envio e o Enviei some', { skip: semBanco }, () => {
  const s = montarComanda(rodar(HELENA, {
    comanda: 'fechada_marcos',
    extra: `select set_config('app.colaborador_id', '${HELENA}', true);
            select app.comanda_transicionar(comanda_id, 'enviar', 2, '${HELENA}', null, null, '82999990000')
              from cenario where papel = 'fechada_marcos';`,
  }), AGORA).selecionada;

  assert.equal(s.status, 'enviada');
  assert.deepEqual(s.acoes.map((a) => a.identificador), ['copiar', 'baixar', 'reabrir', 'receber']);
  assert.equal(s.comprovante.envio, 1);
  assert.equal(s.comprovante.enviadoPor, 'Helena');
});

// ADR 0086: o atendente marca Recebi também na Enviada; desfazer é do Admin.
const PAGA_PELO_MARCOS = `select set_config('app.colaborador_id', '${HELENA}', true);
  select app.comanda_transicionar(comanda_id, 'enviar', 2, '${HELENA}', null, null, '82999990000')
    from cenario where papel = 'fechada_marcos';
  select set_config('app.colaborador_id', '${MARCOS}', true);
  select app.comanda_transicionar(comanda_id, 'receber', 3, '${MARCOS}', p_forma_pagamento => 'credito')
    from cenario where papel = 'fechada_marcos';`;

test('comanda: paga mostra a forma, e só o Admin desfaz o Recebi', { skip: semBanco }, () => {
  const marcos = montarComanda(rodar(MARCOS, { comanda: 'fechada_marcos', extra: PAGA_PELO_MARCOS }), AGORA).selecionada;
  assert.equal(marcos.status, 'paga');
  assert.equal(marcos.statusRotulo, 'paga · Crédito');
  assert.deepEqual(marcos.acoes.map((a) => [a.identificador, a.desativada]), [['desfazer_recebimento', true]]);

  const helena = montarComanda(rodar(HELENA, { comanda: 'fechada_marcos', extra: PAGA_PELO_MARCOS }), AGORA).selecionada;
  assert.deepEqual(helena.acoes.map((a) => [a.identificador, a.desativada]), [['desfazer_recebimento', false]]);
});

test('comanda: "Para enviar" é a aba da Helena, com todas as fechadas', { skip: semBanco }, () => {
  const d = montarComanda(rodar(HELENA, { modo: 'enviar' }), AGORA, { modo: 'enviar' });

  assert.deepEqual(d.modos.map((m) => [m.rotulo, m.selecionado]),
    [['Ativas', false], ['Histórico', false], ['Para enviar', true]]);
  assert.deepEqual(d.lista.map((c) => c.cliente), ['Cliente cli-2']);
});

test('comanda: aberta não tem comprovante — não há o que enviar', { skip: semBanco }, () => {
  assert.equal(montarComanda(rodar(MARCOS, { comanda: 'aberta_marcos' }), AGORA).selecionada.comprovante, null);
});

// Valores sintéticos: a função só reparte o que o fechamento congelou.
// 22:00Z é 19:00 em São Paulo.
test('comanda: uma linha por bloco, com os noturnos no fim', () => {
  const linhas = blocosDaExtensao(
    { blocos: 3, blocos_noturnos: 1, base: 145.5, acrescimo_noturno: 10, total: 155.5 },
    '2026-08-05T22:00:00Z',
  );

  assert.deepEqual(linhas, [
    { inicio: '19:00', valor: 'R$ 48,50', acrescimo: '' },
    { inicio: '19:30', valor: 'R$ 48,50', acrescimo: '' },
    { inicio: '20:00', valor: 'R$ 58,50', acrescimo: 'inclui 10,00 noturno' },
  ]);
});

test('comanda: as linhas dos blocos somam o total congelado, centavo a centavo', () => {
  const extensao = { blocos: 3, blocos_noturnos: 2, base: 100.01, acrescimo_noturno: 0.05, total: 100.06 };
  const centavos = blocosDaExtensao(extensao, '2026-08-05T22:00:00Z')
    .map((l) => Number(l.valor.replace(/[^\d]/g, '')));

  assert.equal(centavos.reduce((a, b) => a + b, 0), 10006);
});

// ADR 0082: os agregados incluem o noturno do agendado; os blocos da extensão
// ficam só com a parte dela, e o agendado vira uma linha à parte. 02:00Z é 23:00.
test('comanda: noturno agendado sai dos blocos da extensão e vira linha própria', () => {
  const extensao = {
    blocos: 1, blocos_noturnos: 4, base: 48.5, acrescimo_noturno: 40, total: 128.5,
    agendado_blocos_noturnos: 3, agendado_acrescimo_noturno: 30,
    agendado_inicio_noturno: '2026-08-06T02:00:00Z',
  };
  assert.deepEqual(blocosDaExtensao(extensao, '2026-08-06T03:30:00Z'), [
    { inicio: '00:30', valor: 'R$ 58,50', acrescimo: 'inclui 10,00 noturno' },
  ]);
  assert.deepEqual(linhaNoturnoAgendado(extensao),
    { rotulo: '3 blocos de 30 min a partir das 23:00', valor: 'R$ 30,00' });
  assert.equal(linhaNoturnoAgendado({ blocos: 0 }), null);
});

test('comanda: sem extensão, sem linha de bloco', () => {
  assert.deepEqual(blocosDaExtensao(null, '2026-08-05T22:00:00Z'), []);
  assert.deepEqual(blocosDaExtensao({ blocos: 0, blocos_noturnos: 0, base: 0, acrescimo_noturno: 0, total: 0 }, '2026-08-05T22:00:00Z'), []);
});

test('comanda: competência trancada tira reabrir e explica o caminho', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS, {
    comanda: 'fechada_marcos',
    extra: `update competencia set status = 'trancada'
             where mes_ano = date_trunc('month', app.quarta_recente())::date;`,
  }), AGORA);
  const reabrir = d.selecionada.acoes.find((a) => a.identificador === 'reabrir');

  assert.equal(reabrir.desativada, true);
  assert.match(reabrir.motivo, /Ajuste/);
  assert.equal(d.selecionada.competenciaTrancada, true);
});

test('comanda: histórico de outro dia não mostra a aberta de hoje', { skip: semBanco }, () => {
  const d = montarComanda(rodar(MARCOS, { modo: 'historico', dia: '2020-01-01' }), AGORA, { modo: 'historico' });

  assert.deepEqual(d.lista, []);
  assert.match(d.vazio, /Nenhuma comanda/);
});

test('comanda: a busca atravessa o recorte de data', { skip: semBanco }, () => {
  const d = montarComanda(
    rodar(MARCOS, { modo: 'historico', dia: '2020-01-01', busca: 'cli-1' }),
    AGORA, { modo: 'historico', busca: 'cli-1' },
  );

  assert.deepEqual(d.lista.map((c) => c.cliente), ['Cliente cli-1']);
});

// O número vem da Altegio com o 55 do país na frente. Mostrado cru, o 55 virava
// DDD: "(55) 8••••-7137" para um celular de São Paulo.
test('telefone na tela: o 55 do país sai, o DDD fica', () => {
  assert.equal(telefoneNaTela('5511999990001'), '(11) 9••••-0001');
  assert.equal(telefoneNaTela('551188880001'), '(11) 8••••-0001');
  assert.equal(telefoneNaTela('11999990001'), '(11) 9••••-0001');
  assert.equal(telefoneNaTela(''), '');
});
