// A allow-list do ADR 0042 §3. O que ela precisa garantir não é que a chamada
// funcione — é que o cliente não consiga escolher quem assina o que faz.
import assert from 'node:assert/strict';
import test from 'node:test';

import { montarArgumentos, RPCS } from '../../src/api/rpcs.mjs';
import { bancoDisponivel, consultar } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const claim = {
  colaborador_id: '11111111-1111-4111-8111-111111111111',
  perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  origem_claim: 'online',
};

const AGENDAMENTO = '33333333-3333-4333-8333-333333333333';

test('toda entrada declara origem para cada argumento da assinatura', () => {
  for (const [nome, rpc] of Object.entries(RPCS)) {
    for (const [arg] of rpc.argumentos) {
      const declarado =
        Object.hasOwn(rpc.fixos ?? {}, arg) ||
        Object.hasOwn(rpc.daClaim ?? {}, arg) ||
        Object.hasOwn(rpc.doCliente ?? {}, arg);
      assert.ok(declarado, `${nome}: ${arg} sem origem declarada`);
    }
  }
});

test('comanda_criar monta os quatro argumentos na ordem da assinatura', () => {
  const r = montarArgumentos(RPCS.comanda_criar, { agendamento_id: AGENDAMENTO }, claim);
  assert.deepEqual(r, {
    ok: true,
    valores: [AGENDAMENTO, 'gerar_manual', claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::text', '$3::uuid', '$4::text'],
  });
});

// O ponto inteiro da lista: quem age vem da claim assinada, não do corpo. Sem
// isto qualquer atendente lançaria Comanda no nome de qualquer outro.
test('o corpo nao escolhe o ator nem o evento', () => {
  const r = montarArgumentos(RPCS.comanda_criar, {
    agendamento_id: AGENDAMENTO,
    p_ator_id: '99999999-9999-4999-8999-999999999999',
    p_evento: 'gerar_automatico',
    p_origem_claim: 'lote_offline',
  }, claim);
  assert.equal(r.valores[1], 'gerar_manual');
  assert.equal(r.valores[2], claim.colaborador_id);
  assert.equal(r.valores[3], 'online');
});

test('origem_claim acompanha a claim, nao um padrao do servidor', () => {
  const r = montarArgumentos(
    RPCS.comanda_criar, { agendamento_id: AGENDAMENTO },
    { ...claim, origem_claim: 'lote_offline' });
  assert.equal(r.valores[3], 'lote_offline');
});

// As duas saídas do Achado (ADR 0054 §1). Duas entradas e não uma com `opcoes`:
// o que cada uma pede é diferente, e a ordem posicional tem de bater com a
// assinatura da migration 0058 — é ela que o `$n::tipo` monta.
test('as duas saidas do achado montam na ordem da assinatura, com o ator da claim', () => {
  const ACHADO = '44444444-4444-4444-8444-444444444444';

  assert.deepEqual(montarArgumentos(RPCS.achado_entregar, {
    achado_id: ACHADO, versao: 3, retirado_por: 'Renata', p_ator_id: 'outro',
  }, claim), {
    ok: true,
    valores: [ACHADO, 3, 'Renata', claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::int', '$3::text', '$4::uuid', '$5::text'],
  });

  assert.deepEqual(montarArgumentos(RPCS.achado_doar, {
    achado_id: ACHADO, versao: 3, destino: 'Bazar da Paroquia',
  }, claim).valores, [ACHADO, 3, 'Bazar da Paroquia', claim.colaborador_id, 'online']);

  // O campo da outra saída não serve: quem manda `destino` para o entregar está
  // pedindo um argumento que aquela chamada não tem.
  assert.deepEqual(montarArgumentos(RPCS.achado_entregar, { achado_id: ACHADO, versao: 3, destino: 'x' }, claim),
    { ok: false, motivo: 'campo ausente: retirado_por' });
});

test('campo do cliente ausente e recusa nomeada, nao default silencioso', () => {
  assert.deepEqual(
    montarArgumentos(RPCS.comanda_criar, {}, claim),
    { ok: false, motivo: 'campo ausente: agendamento_id' });
});

// `null` explícito é um valor que o banco vai recusar com a mensagem dele.
// Ausente é outra coisa, e tratar os dois igual deixaria o cliente omitir um
// argumento pra cair no default da função.
test('null explicito passa; ausente nao', () => {
  const r = montarArgumentos(RPCS.comanda_criar, { agendamento_id: null }, claim);
  assert.equal(r.ok, true);
  assert.equal(r.valores[0], null);
});

test('entrada com argumento orfao estoura no boot, nao em producao', () => {
  const quebrada = { argumentos: [['p_x', 'text']], doCliente: {}, fixos: {}, daClaim: {} };
  assert.throws(() => montarArgumentos(quebrada, {}, claim), /não tem origem declarada/);
});

// ------------------------------------------------- as escritas da Comanda

const COMANDA = '44444444-4444-4444-8444-444444444444';

const transicionar = (corpo) =>
  montarArgumentos(RPCS.comanda_transicionar, {
    comanda_id: COMANDA, evento: 'fechar', versao: 3,
    fim_praticado: null, inicio_praticado: null, telefone: null, forma_pagamento: null, ...corpo,
  }, claim);

test('comanda_transicionar so alcanca as arestas de quem opera', () => {
  assert.equal(transicionar({ evento: 'fechar' }).ok, true);
  assert.equal(transicionar({ evento: 'enviar' }).ok, true);
  assert.equal(transicionar({ evento: 'reabrir' }).ok, true);
  assert.equal(transicionar({ evento: 'desfazer_recebimento' }).ok, true);
  // A forma viaja como veio: quem recusa forma fora da lista é o banco (0093).
  const recebi = transicionar({ evento: 'receber', forma_pagamento: 'pix' });
  assert.equal(recebi.ok, true);
  assert.equal(recebi.valores[9], 'pix');

  // As arestas cujo gatilho é a Altegio não têm porta pelo tablet — 'excluir'
  // é terminal, e a rota que o cliente alcança não pode oferecê-la.
  for (const evento of ['excluir', 'cancelar_reversivel', 'descancelar', 'gerar_manual']) {
    assert.deepEqual(transicionar({ evento }),
      { ok: false, motivo: 'valor nao permitido em evento' }, evento);
  }
});

test('comanda_transicionar nao deixa o corpo escolher ator, motivo nem origem', () => {
  const r = transicionar({ p_ator_id: 'outro', p_motivo: 'porque sim', p_origem_claim: 'lote_offline' });
  assert.equal(r.valores[3], claim.colaborador_id);
  assert.equal(r.valores[7], null);
  assert.equal(r.valores[8], 'online');
});

test('lancar linha: o tipo e fechado, e o preco viaja para o banco decidir', () => {
  const corpo = {
    comanda_id: COMANDA, versao: 2, tipo: 'bomboniere',
    item_id: '55555555-5555-4555-8555-555555555555', descricao: null,
    quantidade: 2, preco: 999.99,
  };
  const r = montarArgumentos(RPCS.comanda_linha_lancar, corpo, claim);

  // O preço chega à função — e é ela que o ignora quando o item é de catálogo
  // (migration 0049). A allow-list não é o lugar dessa regra.
  assert.equal(r.ok, true);
  assert.equal(r.valores[6], 999.99);
  assert.equal(r.valores[7], claim.colaborador_id);

  assert.deepEqual(montarArgumentos(RPCS.comanda_linha_lancar, { ...corpo, tipo: 'hora_extra' }, claim),
    { ok: false, motivo: 'valor nao permitido em tipo' });
});

test('estudio adicional: sem preco no corpo, o banco le da tabela (ADR 0085)', () => {
  const corpo = {
    comanda_id: COMANDA, versao: 3, estudio_id: '55555555-5555-4555-8555-555555555555',
    inicio: '2026-10-01 22:30', duracao_minutos: 60, preco: 1,
  };
  const r = montarArgumentos(RPCS.comanda_estudio_lancar, corpo, claim);

  assert.equal(r.ok, true);
  assert.deepEqual(r.valores, [COMANDA, 3, corpo.estudio_id, corpo.inicio, 60,
                               claim.colaborador_id, 'online']);
});

test('assumir posse leva so a comanda, a versao e quem assina a claim', () => {
  const r = montarArgumentos(RPCS.comanda_assumir_posse, { comanda_id: COMANDA, versao: 1 }, claim);
  assert.deepEqual(r.valores, [COMANDA, 1, claim.colaborador_id, 'online']);
});

const ITEM = '66666666-6666-4666-8666-666666666666';
const DIA = '77777777-7777-4777-8777-777777777777';

test('marcar item: o estado e fechado em feito/nao_marcado', () => {
  const r = montarArgumentos(RPCS.checklist_item_marcar,
    { item_id: ITEM, versao: 1, estado: 'feito' }, claim);
  assert.deepEqual(r.valores, [ITEM, 1, 'feito', claim.colaborador_id, 'online']);

  // `nao_feito_justificado` exige foto e sai pelo modal, que ainda não tem rota
  // de mídia — pedir por aqui é corpo ruim, não permissão (migration 0051).
  assert.deepEqual(
    montarArgumentos(RPCS.checklist_item_marcar,
      { item_id: ITEM, versao: 1, estado: 'nao_feito_justificado' }, claim),
    { ok: false, motivo: 'valor nao permitido em estado' });
});

test('concluir fase: so entrada e saida, e quem concluiu vem da claim', () => {
  const r = montarArgumentos(RPCS.checklist_fase_concluir,
    { dia_id: DIA, versao: 3, fase: 'saida' }, claim);
  assert.deepEqual(r.valores, [DIA, 3, 'saida', claim.colaborador_id, 'online']);

  assert.deepEqual(
    montarArgumentos(RPCS.checklist_fase_concluir, { dia_id: DIA, versao: 3, fase: 'ambas' }, claim),
    { ok: false, motivo: 'valor nao permitido em fase' });
});

// ------------------------------------------------------ conferência do Estoque
const INSUMO = '88888888-8888-4888-8888-888888888888';

// O argumento é jsonb, e `pg` manda parâmetro como texto: um array JS viraria
// literal de array do Postgres (`{...}`), que `::jsonb` recusa. Este teste é o
// que segura essa serialização — sem ela a conferência falha só em produção.
test('conferir estoque: a lista vira JSON, nao literal de array do Postgres', () => {
  const itens = [{ item_id: INSUMO, quantidade: 3 }];
  const r = montarArgumentos(RPCS.estoque_conferir, { itens }, claim);

  assert.equal(r.ok, true);
  assert.equal(r.valores[0], JSON.stringify(itens));
  assert.deepEqual(r.casts, ['$1::jsonb', '$2::uuid', '$3::text']);
});

// A única entrada da lista sem `versao` esperada: o spec manda a última
// gravação valer, sem merge (estoque.md, casos de borda).
test('conferir estoque: nao ha versao esperada, e o ator sai da claim', () => {
  const r = montarArgumentos(RPCS.estoque_conferir, { itens: [] }, claim);
  assert.deepEqual(r.valores.slice(1), [claim.colaborador_id, 'online']);
  assert.equal(Object.hasOwn(RPCS.estoque_conferir.doCliente, 'p_versao_esperada'), false);
});

test('conferir estoque sem a lista e recusa nomeada', () => {
  assert.deepEqual(montarArgumentos(RPCS.estoque_conferir, {}, claim),
    { ok: false, motivo: 'campo ausente: itens' });
});

// A ordem posicional tem de bater com a migration 0074. Quem edita vem da
// claim: é o banco que confere se é Admin (ADR 0071 §1).
test('fornecedor do insumo: item, versao e fornecedor do corpo; quem edita vem da claim', () => {
  assert.deepEqual(montarArgumentos(RPCS.estoque_fornecedor_alterar, {
    item_id: INSUMO, versao: 2, fornecedor: 'Atacadao', colaborador_id: 'outro',
  }, claim), {
    ok: true,
    valores: [INSUMO, 2, 'Atacadao', claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::int', '$3::text', '$4::uuid', '$5::text'],
  });
});

// ------------------------------------------------------------------ Escala
const TURNO = '77777777-7777-4777-8777-777777777777';
const QUEM_COBRE = '55555555-5555-4555-8555-555555555555';

test('alterar escala: a lista vira JSON, e o ator sai da claim', () => {
  const alteracoes = [{ turno_id: TURNO, versao: 2, tipo: 'troca', colaborador_id: QUEM_COBRE }];
  const r = montarArgumentos(RPCS.escala_alterar, {
    alteracoes, p_ator_id: '99999999-9999-4999-8999-999999999999',
  }, claim);

  assert.equal(r.ok, true);
  assert.deepEqual(r.valores, [JSON.stringify(alteracoes), claim.colaborador_id, 'online']);
  assert.deepEqual(r.casts, ['$1::jsonb', '$2::uuid', '$3::text']);
});

test('alterar escala sem a lista e recusa nomeada', () => {
  assert.deepEqual(montarArgumentos(RPCS.escala_alterar, {}, claim),
    { ok: false, motivo: 'campo ausente: alteracoes' });
});

// Domingo extra (0062). Quem FAZ o extra vem do corpo — o botao do dia percorre
// a equipe (ADR 0060) —, mas quem ACIONA continua saindo da claim: sao os dois
// papeis da mesma chamada, e so um deles o cliente escolhe.
test('assumir domingo: o escalado vem do corpo, o ator sai da claim', () => {
  const r = montarArgumentos(RPCS.escala_domingo_acionar,
    { data: '2026-10-04', colaborador_id: QUEM_COBRE }, claim);

  assert.deepEqual(r.valores, ['2026-10-04', QUEM_COBRE, claim.colaborador_id, 'online']);
  assert.deepEqual(r.casts, ['$1::date', '$2::uuid', '$3::uuid', '$4::text']);
});

test('assumir domingo sem data e recusa nomeada', () => {
  assert.deepEqual(montarArgumentos(RPCS.escala_domingo_acionar, { colaborador_id: QUEM_COBRE }, claim),
    { ok: false, motivo: 'campo ausente: data' });
});

test('desfazer domingo leva o turno e a versao que a tela leu', () => {
  const r = montarArgumentos(RPCS.escala_domingo_desfazer, { turno_id: TURNO, versao: 3 }, claim);
  assert.deepEqual(r.valores, [TURNO, 3, claim.colaborador_id, 'online']);
  assert.deepEqual(r.casts, ['$1::uuid', '$2::int', '$3::uuid', '$4::text']);
});

// A revisao da ancora vai inteira: array, ancora e uma decisao por troca. O
// array e um uuid[] — nao jsonb —, entao ele viaja como array e o driver o
// converte; so `decisoes` vira JSON.
test('revisar padrao: a proposta inteira numa chamada, com o ator da claim', () => {
  const decisoes = [{ turno_id: TURNO, versao: 2, decisao: 'manter' }];
  const r = montarArgumentos(RPCS.escala_padrao_revisar, {
    turno: 'tarde_noite', versao: 1, colaboradores: [QUEM_COBRE, claim.colaborador_id],
    ancora_data: '2026-08-10', ancora_colaborador_id: claim.colaborador_id, decisoes,
  }, claim);

  assert.deepEqual(r.valores, [
    'tarde_noite', 1, [QUEM_COBRE, claim.colaborador_id], '2026-08-10', claim.colaborador_id,
    JSON.stringify(decisoes), claim.colaborador_id, 'online',
  ]);
  assert.equal(r.casts[2], '$3::uuid[]');
});

// `turno` e a chave do padrao a alterar: fora da lista e corpo ruim, nao
// permissao — do mesmo jeito que o evento da Comanda.
test('revisar padrao com turno fora da lista e recusado', () => {
  assert.deepEqual(montarArgumentos(RPCS.escala_padrao_revisar, {
    turno: 'madrugada', versao: 1, colaboradores: [QUEM_COBRE], ancora_data: '2026-08-10',
    ancora_colaborador_id: QUEM_COBRE, decisoes: [],
  }, claim), { ok: false, motivo: 'valor nao permitido em turno' });
});

// ------------------------------------------------ "Repor / ajustar" da Bomboniere
const ITEM_BOMBONIERE = '99999999-9999-4999-8999-999999999999';

// Não há `tipo` no corpo, e é isso que este teste segura: o sinal do delta é
// que escolhe entre repor e ajustar, dentro da função (migration 0053). Uma
// entrada com `tipo` daria ao cliente uma escolha que o domínio não tem.
test('movimentar bomboniere: o corpo manda delta e motivo, nunca o tipo', () => {
  const r = montarArgumentos(RPCS.bomboniere_movimentar,
    { item_id: ITEM_BOMBONIERE, delta: -2, motivo: 'vencido' }, claim);

  assert.deepEqual(r.valores, [ITEM_BOMBONIERE, -2, 'vencido', claim.colaborador_id, 'online']);
  assert.equal(Object.hasOwn(RPCS.bomboniere_movimentar.doCliente, 'p_tipo'), false);
});

test('movimentar bomboniere: motivo nulo passa, motivo ausente nao', () => {
  const r = montarArgumentos(RPCS.bomboniere_movimentar,
    { item_id: ITEM_BOMBONIERE, delta: 5, motivo: null }, claim);
  assert.equal(r.ok, true);
  assert.equal(r.valores[2], null);

  assert.deepEqual(
    montarArgumentos(RPCS.bomboniere_movimentar, { item_id: ITEM_BOMBONIERE, delta: 5 }, claim),
    { ok: false, motivo: 'campo ausente: motivo' });
});

// ------------------------------------------------------------------- Avisos
// A ordem posicional tem de bater com a assinatura da migration 0061.
test('publicar aviso: titulo, texto e prioridade do corpo; o autor e da claim', () => {
  assert.deepEqual(montarArgumentos(RPCS.aviso_publicar, {
    titulo: 'Domingo abre 11h', texto: 'Quem abre chega 10h15.', prioridade: 'urgente',
    publico: 'todos', pede_confirmacao: true, p_ator_id: 'outro',
  }, claim), {
    ok: true,
    valores: ['Domingo abre 11h', 'Quem abre chega 10h15.', 'urgente', 'todos', true, claim.colaborador_id, 'online'],
    casts: ['$1::text', '$2::text', '$3::text', '$4::text', '$5::boolean', '$6::uuid', '$7::text'],
  });
});

const AVISO_OK = { titulo: 'x', texto: '', prioridade: 'normal', publico: 'todos', pede_confirmacao: true };

test('publicar aviso: prioridade e normal ou urgente, e nada mais', () => {
  assert.deepEqual(montarArgumentos(RPCS.aviso_publicar, { ...AVISO_OK, prioridade: 'fixado' }, claim),
    { ok: false, motivo: 'valor nao permitido em prioridade' });
});

// ADR 0058: "Estúdio" não existe, e "sim"/1 não são booleano — o cast do
// Postgres aceitaria 'sim' como texto e recusaria só lá dentro.
test('publicar aviso: publico e todos ou atendentes, e a confirmacao e booleana', () => {
  assert.deepEqual(montarArgumentos(RPCS.aviso_publicar, { ...AVISO_OK, publico: 'estudio' }, claim),
    { ok: false, motivo: 'valor nao permitido em publico' });
  assert.deepEqual(montarArgumentos(RPCS.aviso_publicar, { ...AVISO_OK, pede_confirmacao: 'sim' }, claim),
    { ok: false, motivo: 'valor nao permitido em pede_confirmacao' });
  assert.deepEqual(montarArgumentos(RPCS.aviso_publicar, { ...AVISO_OK, publico: 'atendentes', pede_confirmacao: false }, claim), {
    ok: true,
    valores: ['x', '', 'normal', 'atendentes', false, claim.colaborador_id, 'online'],
    casts: ['$1::text', '$2::text', '$3::text', '$4::text', '$5::boolean', '$6::uuid', '$7::text'],
  });
});

// "Fixar no topo" não existe (ADR 0058). Um campo aceito aqui e jogado fora
// no banco seria a tela jurando que gravou.
test('publicar aviso: fixar nao viaja', () => {
  assert.deepEqual(Object.values(RPCS.aviso_publicar.doCliente),
    ['titulo', 'texto', 'prioridade', 'publico', 'pede_confirmacao']);
});

test('confirmar e arquivar levam o aviso e a versao; quem assina vem da claim', () => {
  const AVISO = '55555555-5555-4555-8555-555555555555';
  for (const nome of ['aviso_confirmar', 'aviso_arquivar']) {
    assert.deepEqual(montarArgumentos(RPCS[nome], { aviso_id: AVISO, versao: 2, colaborador_id: 'outro' }, claim), {
      ok: true,
      valores: [AVISO, 2, claim.colaborador_id, 'online'],
      casts: ['$1::uuid', '$2::int', '$3::uuid', '$4::text'],
    });
  }
});

// A ordem posicional tem de bater com a assinatura da migration 0072. Quem
// edita vem da claim: é o banco que confere se é o autor.
test('editar aviso: aviso, versao, titulo e texto do corpo; quem edita vem da claim', () => {
  const AVISO = '55555555-5555-4555-8555-555555555555';
  assert.deepEqual(montarArgumentos(RPCS.aviso_editar, {
    aviso_id: AVISO, versao: 3, titulo: 'Domingo abre 11h', texto: 'Quem abre chega 10h.', colaborador_id: 'outro',
  }, claim), {
    ok: true,
    valores: [AVISO, 3, 'Domingo abre 11h', 'Quem abre chega 10h.', claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::int', '$3::text', '$4::text', '$5::uuid', '$6::text'],
  });
});

// Prioridade e público ficam como nasceram (ADR 0069).
test('editar aviso: prioridade e publico nao viajam', () => {
  assert.deepEqual(Object.values(RPCS.aviso_editar.doCliente), ['aviso_id', 'versao', 'titulo', 'texto']);
});

// ---------------------------------------------------------------- Lembretes
const CATEGORIA = '66666666-6666-4666-8666-666666666666';

test('criar lembrete: texto, data, categoria e antecedencia do corpo; quem cria vem da claim', () => {
  assert.deepEqual(montarArgumentos(RPCS.lembrete_criar, {
    texto: 'Pagar a grafica', data: '2026-10-05', categoria_id: CATEGORIA, antecedencia: null, colaborador_id: 'outro',
  }, claim), {
    ok: true,
    valores: ['Pagar a grafica', '2026-10-05', CATEGORIA, null, claim.colaborador_id, 'online'],
    casts: ['$1::text', '$2::date', '$3::uuid', '$4::int', '$5::uuid', '$6::text'],
  });
  // Nula é "a da categoria"; ausente é corpo ruim — senão o cliente escolheria
  // o default sem dizer.
  assert.deepEqual(montarArgumentos(RPCS.lembrete_criar, { texto: 'x', data: '2026-10-05', categoria_id: CATEGORIA }, claim),
    { ok: false, motivo: 'campo ausente: antecedencia' });
});

test('alterar categoria: ativo e booleano, e a versao viaja', () => {
  const OK = { categoria_id: CATEGORIA, versao: 2, nome: 'Contato', antecedencia: 1, ativo: false };
  assert.deepEqual(montarArgumentos(RPCS.categoria_lembrete_alterar, OK, claim), {
    ok: true,
    valores: [CATEGORIA, 2, 'Contato', 1, false, claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::int', '$3::text', '$4::int', '$5::boolean', '$6::uuid', '$7::text'],
  });
  assert.deepEqual(montarArgumentos(RPCS.categoria_lembrete_alterar, { ...OK, ativo: 'nao' }, claim),
    { ok: false, motivo: 'valor nao permitido em ativo' });
});

test('concluir lembrete: id e versao do corpo; quem conclui vem da claim', () => {
  assert.deepEqual(montarArgumentos(RPCS.lembrete_concluir, { lembrete_id: CATEGORIA, versao: 2, colaborador_id: 'outro' }, claim), {
    ok: true,
    valores: [CATEGORIA, 2, claim.colaborador_id, 'online'],
    casts: ['$1::uuid', '$2::int', '$3::uuid', '$4::text'],
  });
});

// ------------------------------------------------------------------ Ajustes
const PESSOA = '77777777-aaaa-4aaa-8aaa-777777777777';

test('salvar PINs: a lista vira JSON e o ator sai da claim', () => {
  const pines = [{ colaborador_id: PESSOA, pin: '4321' }];
  const r = montarArgumentos(RPCS.pin_definir_lote, { pines }, claim);

  assert.equal(r.ok, true);
  assert.deepEqual(r.valores, [JSON.stringify(pines), claim.colaborador_id]);
  assert.deepEqual(r.casts, ['$1::jsonb', '$2::uuid']);
});

// `app.pin_definir` TEM grant para o role da app desde a migration 0034. O que
// a mantém fora do alcance do cliente é ESTA lista não ter entrada para ela —
// e a rota responder 404 a quem não está aqui. Sem este teste, alguém acrescenta
// `pin_definir` "por simetria" e o botão de lote perde a atomicidade.
test('a porta de um PIN so nao existe: o caminho e o lote', () => {
  assert.equal(Object.hasOwn(RPCS, 'pin_definir'), false);
});

// Issue #220: a senha sai do psql. Quem recusa quem não é sócio é
// app.exigir_socio dentro de senha_definir; aqui só se prova que o cliente não
// escolhe o ator.
test('redefinir senha: pessoa, login e senha do corpo, o ator da claim', () => {
  const r = montarArgumentos(RPCS.senha_definir,
    { colaborador_id: PESSOA, login: 'helena', senha: 'uma-senha-longa' }, claim);
  assert.deepEqual(r.valores, [PESSOA, 'helena', 'uma-senha-longa', claim.colaborador_id]);
  assert.deepEqual(r.casts, ['$1::uuid', '$2::text', '$3::text', '$4::uuid']);
});

test('trocar a propria senha: a atual e a nova do corpo, quem troca da claim', () => {
  const r = montarArgumentos(RPCS.senha_trocar_propria,
    { senha_atual: 'a-atual-aqui', senha_nova: 'a-nova-aqui!!' }, claim);
  assert.deepEqual(r.valores, ['a-atual-aqui', 'a-nova-aqui!!', claim.colaborador_id]);
  assert.deepEqual(r.casts, ['$1::text', '$2::text', '$3::uuid']);
});

// Sem `p_origem_claim`: o sócio entra por senha (ADR 0049) e a função não tem
// esse argumento — não existe lote offline de PIN.
test('salvar PINs nao carrega origem_claim', () => {
  assert.deepEqual(RPCS.pin_definir_lote.argumentos.map(([nome]) => nome),
    ['p_pines', 'p_ator_id']);
});

// Issue #216: cadastro e desativação são do sócio (exigir_socio na função).
test('cadastrar colaborador: nome, nivel, socio e PIN do corpo, o ator da claim', () => {
  const r = montarArgumentos(RPCS.colaborador_criar,
    { nome: 'Bia', nivel: 'atendente', socio: false, pin: '1234' }, claim);
  assert.deepEqual(r.valores, ['Bia', 'atendente', false, '1234', claim.colaborador_id]);
  assert.deepEqual(r.casts, ['$1::text', '$2::text', '$3::boolean', '$4::text', '$5::uuid']);
});

test('desativar e reativar: pessoa, estado e versao do corpo, o ator da claim', () => {
  const r = montarArgumentos(RPCS.colaborador_ativo_definir,
    { colaborador_id: PESSOA, ativo: false, versao: 3 }, claim);
  assert.deepEqual(r.valores, [PESSOA, false, 3, claim.colaborador_id]);
  assert.deepEqual(r.casts, ['$1::uuid', '$2::boolean', '$3::int', '$4::uuid']);
});

// -------------------------------------------------------------- Horas extras
const EXTRA = '99999999-9999-4999-8999-999999999999';
const OUTRA_PESSOA = '99999999-aaaa-4aaa-8aaa-999999999999';

test('lancar hora extra: o destinatario vem do corpo, o ator da claim', () => {
  const r = montarArgumentos(RPCS.hora_extra_lancar, {
    colaborador_id: OUTRA_PESSOA, inicio: '2026-09-22 23:00', fim: '2026-09-23 00:30',
    ensaio_id: null, sem_ensaio_motivo: 'arrumação',
  }, claim);

  assert.equal(r.ok, true);
  // Os dois primeiros sao do corpo; o ator, o ultimo antes da origem, e da claim.
  // Sao campos homonimos em objetos diferentes: quem RECEBE nunca assina.
  assert.deepEqual(r.valores, [OUTRA_PESSOA, '2026-09-22 23:00', '2026-09-23 00:30',
    null, 'arrumação', claim.colaborador_id, claim.origem_claim]);
  assert.deepEqual(r.casts, ['$1::uuid', '$2::timestamptz', '$3::timestamptz',
    '$4::uuid', '$5::text', '$6::uuid', '$7::text']);
});

// Quem barra lancamento por outra pessoa e `app.exigir_admin` dentro da RPC: a
// allow-list nao le linha nenhuma, entao nao tem como saber de quem ela e.
test('lancar hora extra leva o ensaio ou o motivo de nao ter (ADR 0083)', () => {
  assert.deepEqual(RPCS.hora_extra_lancar.argumentos.map(([nome]) => nome),
    ['p_colaborador_id', 'p_datetime_inicio', 'p_datetime_fim', 'p_agendamento_id',
      'p_sem_ensaio_motivo', 'p_ator_id', 'p_origem_claim']);
  // Ausente é campo faltando, não null: a tela manda os dois sempre.
  assert.equal(montarArgumentos(RPCS.hora_extra_lancar, {
    colaborador_id: OUTRA_PESSOA, inicio: '2026-09-22 23:00', fim: '2026-09-23 00:30',
  }, claim).ok, false);
});

test('pagar hora extra leva so o id, a versao e quem assina a claim', () => {
  const r = montarArgumentos(RPCS.hora_extra_pagar, { hora_extra_id: EXTRA, versao: 3 }, claim);

  assert.equal(r.ok, true);
  assert.deepEqual(r.valores, [EXTRA, 3, claim.colaborador_id, claim.origem_claim]);
});

// A ordem de `p_motivo` difere entre as duas (0063 vs 0065), e e posicional:
// trocar uma pela outra mandaria o motivo para o lugar do ator.
test('cancelar e estornar montam o motivo na posicao da propria assinatura', () => {
  const cancelar = montarArgumentos(RPCS.hora_extra_cancelar,
    { hora_extra_id: EXTRA, versao: 2, motivo: 'duplicada' }, claim);
  const estornar = montarArgumentos(RPCS.hora_extra_estornar,
    { hora_extra_id: EXTRA, versao: 2, motivo: 'pagou errado' }, claim);

  assert.deepEqual(cancelar.valores,
    [EXTRA, 2, claim.colaborador_id, 'duplicada', claim.origem_claim]);
  assert.deepEqual(estornar.valores,
    [EXTRA, 2, 'pagou errado', claim.colaborador_id, claim.origem_claim]);
});

test('sem motivo, cancelar e estornar sao recusa nomeada, nao null silencioso', () => {
  for (const nome of ['hora_extra_cancelar', 'hora_extra_estornar']) {
    const r = montarArgumentos(RPCS[nome], { hora_extra_id: EXTRA, versao: 1 }, claim);
    assert.equal(r.ok, false, nome);
    assert.match(r.motivo, /motivo/);
  }
});

// A rede de seguranca e a cascata sao de JOB: tem `revoke` deliberado do role da
// app. Uma entrada aqui "por simetria" as poria ao alcance do tablet.
test('as horas extras de job ficam fora do alcance do tablet', () => {
  for (const nome of ['hora_extra_rede_de_seguranca', 'hora_extra_da_comanda',
    'hora_extra_cascata_cancelar', 'hora_extra_cascata_reverter']) {
    assert.equal(Object.hasOwn(RPCS, nome), false, nome);
  }
});

// --------------------------------------------- A lista contra o banco de fato
// Até aqui os testes provam o que a lista MONTA. Nada provava que o que ela
// monta corresponde à função que existe: `montarArgumentos` é posicional, e um
// nome trocado ou uma ordem errada só apareceria com o dedo no tablet. Foi o
// risco real ao ligar as horas extras — `p_motivo` é o 4º argumento em
// `hora_extra_cancelar` e o 3º em `hora_extra_estornar`.
test('cada entrada bate com a assinatura da funcao no banco', { skip: semBanco }, () => {
  const assinaturas = new Map(consultar(`
    select p.proname,
           coalesce(array_to_string(p.proargnames, ','), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'`));

  for (const [nome, rpc] of Object.entries(RPCS)) {
    const noBanco = assinaturas.get(nome);
    assert.ok(noBanco !== undefined, `${nome}: a allow-list aponta para funcao que nao existe`);
    assert.deepEqual(rpc.argumentos.map(([arg]) => arg), noBanco.split(','),
      `${nome}: a ordem ou o nome dos argumentos nao bate com o banco`);
  }
});

// 0089: salvar manda o tutorial inteiro; os blocos vão como JSON, não como
// literal de array do Postgres.
test('salvar tutorial: blocos em JSON, o ator da claim', () => {
  const blocos = [{ tipo: 'texto', texto: 'Liga o estabilizador.' }, { tipo: 'foto', midia_id: 'm-1' }];
  const r = montarArgumentos(RPCS.tutorial_salvar,
    { tutorial_id: 't-1', versao: 3, categoria_id: 'c-1', titulo: 'Mesa de som', blocos }, claim);
  assert.deepEqual(r.valores.slice(0, 6),
    ['t-1', 3, 'c-1', 'Mesa de som', JSON.stringify(blocos), claim.colaborador_id]);
  assert.equal(r.casts[4], '$5::jsonb');
});

test('status do tutorial so aceita os tres do spec', () => {
  const ok = montarArgumentos(RPCS.tutorial_status_definir, { tutorial_id: 't-1', versao: 1, status: 'publicado' }, claim);
  const ruim = montarArgumentos(RPCS.tutorial_status_definir, { tutorial_id: 't-1', versao: 1, status: 'excluido' }, claim);
  assert.equal(ok.ok, true);
  assert.equal(ruim.ok, false);
});
