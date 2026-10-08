// GET /tela/treinamento: a consulta no banco e a montagem do DadosTreinamento.
//
// O que estes testes guardam é a decisao da issue #94: a tela e a do spec
// (tutorial em blocos de texto e foto), nao a do mockup (video e link com URL).
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_TREINAMENTO, DIAS_ATE_ENVELHECER, montarTreinamento } from '../../src/api/telas/treinamento.mjs';
import { bancoDisponivel, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const CONFIG = { segredo: 'x'.repeat(32) };

const CAT_ATIVA = '11111111-0000-4000-8000-000000000001';
const CAT_MORTA = '11111111-0000-4000-8000-000000000002';
const TUT_PUB = '22222222-0000-4000-8000-000000000001';
const TUT_RASCUNHO = '22222222-0000-4000-8000-000000000002';
const TUT_ARQUIVADO = '22222222-0000-4000-8000-000000000003';
const TUT_ESCONDIDO = '22222222-0000-4000-8000-000000000004';
const MIDIA = '33333333-0000-4000-8000-000000000001';

// Uma categoria ativa com um publicado, um rascunho e um arquivado; e uma
// categoria DESATIVADA com um publicado dentro, que nao pode aparecer.
const SEMEAR = `
insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id, enviado_por_id)
values ('${MIDIA}', 'var/midia/x.jpg', 100, 'image/jpeg', 'tutorial', '${TUT_PUB}', '${HELENA}');

insert into categoria_treinamento (id, nome, descricao, ordem, ativo) values
  ('${CAT_ATIVA}', 'Equipamento', 'Montagem e guarda', 1, true),
  ('${CAT_MORTA}', 'Categoria morta', null, 2, false);

insert into tutorial (id, categoria_id, titulo, status, ordem, criado_por_id, criado_em,
                      atualizado_por_id, atualizado_em, publicado_em) values
  ('${TUT_PUB}', '${CAT_ATIVA}', 'Como armar o softbox', 'publicado', 1, '${HELENA}',
   now() - interval '10 days', '${HELENA}', now() - interval '2 days', now() - interval '9 days'),
  ('${TUT_RASCUNHO}', '${CAT_ATIVA}', 'Rascunho do refletor', 'rascunho', 2, '${HELENA}',
   now(), null, null, null),
  ('${TUT_ARQUIVADO}', '${CAT_ATIVA}', 'Fundo infinito de papel', 'arquivado', 3, '${HELENA}',
   now() - interval '90 days', null, null, now() - interval '80 days'),
  ('${TUT_ESCONDIDO}', '${CAT_MORTA}', 'Publicado em categoria morta', 'publicado', 1, '${HELENA}',
   now(), null, null, now());

insert into bloco_tutorial (tutorial_id, ordem, tipo, conteudo_texto, midia_id) values
  ('${TUT_PUB}', 1, 'texto', 'Abra as pernas ate o primeiro encaixe.', null),
  ('${TUT_PUB}', 2, 'foto', null, '${MIDIA}'),
  ('${TUT_PUB}', 3, 'texto', 'Trave o anel de baioneta.', null);
`;

const rodar = (comoQuem, { busca = '', tutorial = null, arquivados = false, extra } = {}) => rodarTela({
  consulta: CONSULTA_TREINAMENTO, comoQuem, semear: SEMEAR, extra,
  json: ['categorias', 'aberto', 'blocos', 'gestao'],
  parametros: [
    ['text', `'${busca}'`],
    ['uuid', tutorial === null ? 'null' : `'${tutorial}'`],
    ['boolean', arquivados ? 'true' : 'false'],
  ],
});

const AGORA = new Date();

// O psql devolve boolean como 't'/'f'; o driver pg, que é o de produção, devolve
// true/false. A conversão fica no harness, não na tela (como em ajustes.test).
const comoPg = (l) => ({ ...l, admin: l.admin === 't' });
const rodarPg = (...args) => comoPg(rodar(...args));

const titulos = (d) => d.categorias.flatMap((c) => c.tutoriais.map((t) => t.titulo));

test('treinamento: so publicado aparece, e rascunho nunca', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(PAULO), AGORA, CONFIG);

  assert.deepEqual(titulos(d), ['Como armar o softbox']);
  assert.equal(d.total, 1);
  assert.equal(d.categorias[0].nome, 'Equipamento');
  assert.equal(d.categorias[0].descricao, 'Montagem e guarda');
});

// A categoria e o agrupamento da tela: desativa-la tira os tutoriais junto,
// sem precisar mexer no status de cada um.
test('treinamento: categoria desativada leva os tutoriais dela junto', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(HELENA), AGORA, CONFIG);
  assert.ok(!titulos(d).includes('Publicado em categoria morta'));
});

test('treinamento: arquivado so entra quando o filtro pede', { skip: semBanco }, () => {
  const sem = montarTreinamento(rodar(PAULO), AGORA, CONFIG);
  const com = montarTreinamento(rodar(PAULO, { arquivados: true }), AGORA, CONFIG, '', true);

  assert.ok(!titulos(sem).includes('Fundo infinito de papel'));
  assert.ok(titulos(com).includes('Fundo infinito de papel'));
  assert.equal(com.incluirArquivados, true);
  // Nem com o filtro ligado o rascunho aparece: ele nao e do catalogo.
  assert.ok(!titulos(com).includes('Rascunho do refletor'));
});

test('treinamento: a busca filtra por titulo e nao alcanca rascunho', { skip: semBanco }, () => {
  const achou = montarTreinamento(rodar(PAULO, { busca: 'softbox' }), AGORA, CONFIG, 'softbox');
  const nada = montarTreinamento(rodar(PAULO, { busca: 'refletor' }), AGORA, CONFIG, 'refletor');

  assert.deepEqual(titulos(achou), ['Como armar o softbox']);
  assert.equal(nada.total, 0);
  assert.equal(nada.vazioTitulo, 'Nada encontrado');
});

test('treinamento: a data mostrada e a da ultima alteracao', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(PAULO), AGORA, CONFIG);
  const esperado = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const ddmmaaaa = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(esperado);

  assert.equal(d.categorias[0].tutoriais[0].atualizado, `atualizado em ${ddmmaaaa}`);
  assert.equal(d.categorias[0].tutoriais[0].blocos, '3 blocos');
  assert.match(d.categorias[0].contagem, /^\d+ tutoria(l|is)$/);
  // O texto dos blocos vem junto, na ordem, para a busca ao digitar.
  assert.equal(d.categorias[0].tutoriais[0].texto,
    'Abra as pernas ate o primeiro encaixe. Trave o anel de baioneta.');
});

test('treinamento: o tutorial aberto traz os blocos na ordem gravada', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(PAULO, { tutorial: TUT_PUB }), AGORA, CONFIG);

  assert.equal(d.selecionado.titulo, 'Como armar o softbox');
  assert.equal(d.selecionado.categoria, 'Equipamento');
  assert.match(d.selecionado.atualizado, / por Helena$/);
  assert.deepEqual(d.selecionado.blocos.map((b) => b.tipo), ['texto', 'foto', 'texto']);
  assert.equal(d.selecionado.blocos[0].texto, 'Abra as pernas ate o primeiro encaixe.');
  // A foto vai assinada (ADR 0051 §5): a tela nao entrega id de midia cru.
  assert.match(d.selecionado.blocos[1].foto, /^\/midia\/[0-9a-f-]+\?t=/);
});

// Mesma defesa dos Achados: o registro do bloco fica, o arquivo nao (ADR 0036 §2).
test('treinamento: foto expirada vira bloco sem imagem, nao bloco sumido', { skip: semBanco }, () => {
  const d = montarTreinamento(
    rodar(PAULO, { tutorial: TUT_PUB, extra: `update midia set expirada_em = now() where id = '${MIDIA}';` }),
    AGORA, CONFIG);

  const foto = d.selecionado.blocos[1];
  assert.equal(foto.tipo, 'foto');
  assert.equal(foto.foto, undefined);
  assert.match(foto.descricao, /indispon/);
});

// Capa da pasta: a primeira foto dos tutoriais dela, assinada; expirada não vale.
test('treinamento: a pasta tem a primeira foto como capa, e sem foto fica sem capa', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(PAULO), AGORA, CONFIG);
  const equipamento = d.categorias.find((c) => c.nome === 'Equipamento');
  assert.match(equipamento.capa, new RegExp(`^/midia/${MIDIA}\\?t=`));

  const sem = montarTreinamento(
    rodar(PAULO, { extra: `update midia set expirada_em = now() where id = '${MIDIA}';` }), AGORA, CONFIG);
  assert.equal(sem.categorias.find((c) => c.nome === 'Equipamento').capa, undefined);
});

test('treinamento: rascunho nao abre para o Atendente nem pelo endereco direto', { skip: semBanco }, () => {
  const d = montarTreinamento(rodarPg(PAULO, { tutorial: TUT_RASCUNHO }), AGORA, CONFIG);
  assert.equal(d.selecionado, null);
  assert.equal(d.podeEditar, false);
  assert.deepEqual(d.gestao, []);
});

// 0089: quem escreve é o Administrador, e só ele vê Rascunho e os dados de edição.
test('treinamento: o Admin ve rascunho na lista e as categorias para cuidar', { skip: semBanco }, () => {
  const d = montarTreinamento(rodarPg(HELENA), AGORA, CONFIG);

  assert.equal(d.podeEditar, true);
  assert.ok(titulos(d).includes('Rascunho do refletor'));
  assert.equal(d.categorias[0].tutoriais.find((t) => t.titulo === 'Rascunho do refletor').status, 'Rascunho');
  // Todas as categorias, desativada inclusive: é onde se reativa.
  assert.deepEqual(d.gestao.map((c) => [c.nome, c.ativa, c.publicados]),
    [['Equipamento', true, 1], ['Categoria morta', false, 1]]);
});

test('treinamento: o Admin abre o tutorial com o que o editor precisa para salvar', { skip: semBanco }, () => {
  const d = montarTreinamento(rodarPg(HELENA, { tutorial: TUT_PUB }), AGORA, CONFIG);
  const { edicao } = d.selecionado;

  assert.equal(edicao.versao, 1);
  assert.equal(edicao.status, 'publicado');
  assert.equal(edicao.categoria, CAT_ATIVA);
  assert.equal(edicao.podeRestaurar, false);
  assert.deepEqual(edicao.blocos.map((b) => b.tipo), ['texto', 'foto', 'texto']);
  assert.equal(edicao.blocos[1].midiaId, MIDIA);
  assert.match(edicao.blocos[1].foto, /^\/midia\/[0-9a-f-]+\?t=/);
});

test('treinamento: o Admin abre o proprio rascunho', { skip: semBanco }, () => {
  const d = montarTreinamento(rodarPg(HELENA, { tutorial: TUT_RASCUNHO }), AGORA, CONFIG);
  assert.equal(d.selecionado.status, 'Rascunho');
  assert.deepEqual(d.selecionado.edicao.blocos, []);
});

test('treinamento: o Atendente nao recebe dados de edicao', { skip: semBanco }, () => {
  const d = montarTreinamento(rodarPg(PAULO, { tutorial: TUT_PUB }), AGORA, CONFIG);
  assert.equal(d.selecionado.edicao, undefined);
});

test('treinamento: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(PAULO, { extra: `update colaborador set ativo = false where id = '${PAULO}';` });
  assert.throws(() => montarTreinamento(l, AGORA, CONFIG), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// "Destaque para tutoriais antigos" (spec · issue #149). O spec pedia o
// destaque e nao dizia o prazo; 180 dias foi a decisao. O que estes testes
// guardam e a BORDA, porque e nela que um `>` virado para `>=` some.
test('treinamento: tutorial recem-atualizado nao e antigo', { skip: semBanco }, () => {
  const d = montarTreinamento(rodar(PAULO), AGORA, CONFIG);
  assert.equal(d.categorias[0].tutoriais[0].antigo, false);
});

test('treinamento: passado o prazo, o tutorial fica marcado', { skip: semBanco }, () => {
  const d = montarTreinamento(
    rodar(PAULO, { extra: `update tutorial set atualizado_em = now() - interval '${DIAS_ATE_ENVELHECER + 1} days' where id = '${TUT_PUB}';` }),
    AGORA, CONFIG);
  assert.equal(d.categorias[0].tutoriais[0].antigo, true);
});

test('treinamento: exatamente no prazo ainda NAO e antigo', { skip: semBanco }, () => {
  const d = montarTreinamento(
    rodar(PAULO, { extra: `update tutorial set atualizado_em = now() - interval '${DIAS_ATE_ENVELHECER} days' + interval '1 hour' where id = '${TUT_PUB}';` }),
    AGORA, CONFIG);
  assert.equal(d.categorias[0].tutoriais[0].antigo, false);
});

// `criado_em` e `not null`, entao o coalesce de atualizado/publicado/criado
// sempre resolve: "sem data" nao e alcancavel por este caminho. A guarda de
// nulo em `envelheceu` fica como defesa barata, e o que se testa aqui e o
// invariante de verdade — data sempre existe, e o tutorial recem-criado que
// nunca foi editado conta a idade a partir da criacao.
test('treinamento: tutorial nunca editado conta a idade desde a criacao', { skip: semBanco }, () => {
  const d = montarTreinamento(
    rodar(PAULO, { extra: `update tutorial set atualizado_em = null, publicado_em = null, criado_em = now() - interval '${DIAS_ATE_ENVELHECER + 1} days' where id = '${TUT_PUB}';` }),
    AGORA, CONFIG);

  assert.equal(d.categorias[0].tutoriais[0].antigo, true);
  assert.notEqual(d.categorias[0].tutoriais[0].atualizado, 'atualizado em sem data');
});
