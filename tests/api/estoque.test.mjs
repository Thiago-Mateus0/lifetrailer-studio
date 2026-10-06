// GET /tela/estoque: a consulta no banco e a montagem do DadosEstoque.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_ESTOQUE, montarEstoque } from '../../src/api/telas/estoque.mjs';
import { bancoDisponivel, JANA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

// Um de cada criticidade, e um nao conferido com quantidade 0 no banco — que
// NAO pode aparecer como zerado. A sentinela do ADR 0044 num dos fornecedores.
const SEMEAR = `
insert into item_estoque (nome, categoria, severidade, fornecedor, especificacao_compra, quantidade, conferido_em) values
  ('Propes',     'Limpeza', 'atencao', 'Percarbonato',       '2 sacos', 0, (app.quarta_recente() - 1) + time '09:00'),
  ('Papel',      'Limpeza', 'urgente', 'SEM_NOME_PENDENCIA', '3un',     1, app.quarta_recente() + time '07:00'),
  ('Detergente', 'Limpeza', 'atencao', 'Percarbonato',       '1L',      4, (app.quarta_recente() - 3) + time '09:00'),
  ('Cafe',       'Cafe',    'urgente', 'Tuff',               '1 kg',    0, null);

-- saldo_materializado direto: o fixture ja cria o Biscoito com 10.
insert into item_bomboniere (nome, categoria, preco, saldo_materializado) values
  ('Refrigerante', 'Bebidas', 6.00, -2);
`;

const rodar = (extra, comoQuem = PAULO) => rodarTela({
  consulta: CONSULTA_ESTOQUE, comoQuem, semear: SEMEAR, extra, json: ['insumos', 'bomboniere', 'fornecedores', 'categorias'],
});

const AGORA = new Date();

test('estoque: criticidade sai da quantidade contada, e nao conferido e neutro', { skip: semBanco }, () => {
  const d = montarEstoque(rodar(), AGORA);
  const insumo = (nome) => d.colunas.flatMap((c) => c.grupos).flatMap((g) => g.insumos).find((i) => i.nome === nome);

  assert.deepEqual([insumo('Propes').criticidade, insumo('Propes').meta, insumo('Propes').unidade], ['urgente', 'conferido ontem', 'sacos']);
  assert.deepEqual([insumo('Papel').criticidade, insumo('Papel').meta], ['atencao', 'conferido hoje']);
  assert.deepEqual([insumo('Detergente').criticidade, insumo('Detergente').meta], ['normal', 'conferido há 3 dias']);
  assert.deepEqual([insumo('Cafe').criticidade, insumo('Cafe').quantidade], ['neutro', '—']);

  assert.deepEqual(d.resumo.map((r) => r.texto),
    ['3 de 4 conferidos', '1 zerado', '1 na última unidade', '1 não conferidos']);
  assert.equal(d.abas[1].rotulo, 'Compra · 2');
});

test('estoque: a lista de compra agrupa por fornecedor, com a sentinela crua', { skip: semBanco }, () => {
  const d = montarEstoque(rodar(), AGORA, 'compra');

  assert.equal(d.aba, 'compra');
  assert.equal(d.titulo, 'Lista de compra');
  assert.deepEqual(d.compra.map((g) => [g.nome, g.insumos.map((i) => i.nome)]),
    [['Percarbonato', ['Propes']], ['SEM_NOME_PENDENCIA', ['Papel']]]);
  const propes = d.compra[0].insumos[0];
  assert.deepEqual([propes.pedido, propes.quantidade, propes.conferido], ['· pedir 2 sacos', '0 sacos', 'ontem']);
});

// ADR 0071 §1: so o Admin edita o fornecedor, entao so ele recebe o gesto.
test('estoque: o Atendente nao recebe sugestoes nem o fornecedor para editar', { skip: semBanco }, () => {
  const d = montarEstoque(rodar(), AGORA);
  assert.equal(Object.hasOwn(d, 'fornecedores'), false);
  const insumos = d.colunas.flatMap((c) => c.grupos).flatMap((g) => g.insumos);
  assert.ok(insumos.every((i) => !Object.hasOwn(i, 'fornecedor') && !Object.hasOwn(i, 'versao')));
});

test('estoque: o Admin recebe as sugestoes sem a sentinela, e o insumo com versao', { skip: semBanco }, () => {
  const d = montarEstoque(rodar(`insert into item_estoque (nome, categoria, severidade, fornecedor, quantidade, ativo)
    values ('Sem nome', 'Limpeza', 'atencao', null, 0, true);`, JANA), AGORA);
  assert.deepEqual(d.fornecedores, ['Percarbonato', 'Tuff']);

  const insumo = (nome) => d.colunas.flatMap((c) => c.grupos).flatMap((g) => g.insumos).find((i) => i.nome === nome);
  assert.deepEqual([insumo('Propes').fornecedor, insumo('Propes').versao], ['Percarbonato', 1]);
  // A sentinela nao se digita: o campo abre vazio, como o do nulo.
  assert.equal(insumo('Papel').fornecedor, '');
  assert.equal(insumo('Sem nome').fornecedor, '');
});

// ADR 0080: a ficha completa, as categorias e o "Renomear" so pro Admin; a
// mensagem do "Copiar lista" pra todo mundo.
test('estoque: o Admin recebe a ficha, as categorias e o renomear; a compra traz a mensagem', { skip: semBanco }, () => {
  const admin = montarEstoque(rodar('', JANA), AGORA, 'compra');
  assert.ok(Array.isArray(admin.categorias) && admin.categorias.length > 0);
  const insumo = admin.colunas.flatMap((c) => c.grupos).flatMap((g) => g.insumos)[0];
  assert.deepEqual(Object.keys(insumo.ficha).sort(), ['categoria', 'especificacao', 'fornecedor', 'nome', 'severidade']);
  assert.ok(admin.compra.every((g) => g.renomear === g.nome));
  assert.ok(admin.colunas.flatMap((c) => c.grupos).every((g) => g.renomear === g.nome));
  assert.ok(admin.compra.every((g) => g.mensagem.startsWith(`Pedido · ${g.nome}\n• `)));

  const atendente = montarEstoque(rodar(), AGORA, 'compra');
  assert.equal(Object.hasOwn(atendente, 'categorias'), false);
  assert.ok(atendente.compra.every((g) => !Object.hasOwn(g, 'renomear') && g.mensagem.length > 0));
});

test('estoque: bomboniere com saldo negativo e urgente', { skip: semBanco }, () => {
  const d = montarEstoque(rodar(), AGORA, 'bomboniere');
  const refri = d.bomboniere.find((b) => b.nome === 'Refrigerante');
  assert.deepEqual([refri.saldo, refri.preco, refri.meta, refri.criticidade], ['-2', '6,00', 'Bebidas · R$ 6,00', 'urgente']);
  assert.equal(d.bomboniere.find((b) => b.nome === 'Biscoito').criticidade, 'normal');
});

test('estoque: aba desconhecida cai em Conferir', () => {
  const d = montarEstoque({ eu_nome: 'Paulo', eu_perfil: 'atendente', insumos: [], bomboniere: [] }, AGORA, 'x');
  assert.equal(d.aba, 'conferir');
  assert.deepEqual(d.colunas, []);
});

test('estoque: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(`update colaborador set ativo = false where id = '${PAULO}';`);
  assert.throws(() => montarEstoque(l, AGORA), (e) => e.code === 'LT_SEM_COLABORADOR');
});
