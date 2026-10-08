// GET /tela/escala: a consulta no banco e a montagem do DadosEscala.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_ESCALA, montarEscala } from '../../src/api/telas/escala.mjs';
import { bancoDisponivel, MARCOS, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

// Quarta: manha padrao do Marcos, tarde com troca (Paulo cobre Marcos).
// Quinta: manha com ausencia do Marcos, sem ninguem atribuido.
// Domingo seguinte a quarta: extra do Paulo.
const SEMEAR = `
insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis,
                           ancora_data, ancora_colaborador_id, vigencia_inicio) values
  ('manha', 'fixo', '{${MARCOS}}', '{1,2,3,4,5,6}', date '2026-08-10', '${MARCOS}', date '2026-08-10'),
  ('tarde_noite', 'alternado_diario', '{${PAULO},${MARCOS}}', '{1,2,3,4,5,6}', date '2026-08-10', '${PAULO}', date '2026-08-10');

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, substituido_colaborador_id, origem) values
  (app.quarta_recente(),     'manha',       '${MARCOS}', 'padrao',        null,       'gerador'),
  (app.quarta_recente(),     'tarde_noite', '${PAULO}',  'troca',         '${MARCOS}', 'manual'),
  (app.quarta_recente() + 1, 'manha',       null,       'ausencia',      '${MARCOS}', 'manual'),
  (app.quarta_recente() + 4, 'extra',       '${PAULO}',  'extra_domingo', null,       'manual');
`;

const rodar = (comoQuem = PAULO, extra, revisar = null) => rodarTela({
  consulta: CONSULTA_ESCALA, comoQuem, semear: SEMEAR, extra,
  parametros: [['text', revisar === null ? 'null' : `'${revisar}'`]],
  json: ['turnos', 'padroes', 'equipe', 'afetados'],
});

const AGORA = new Date();

test('escala: quatro semanas a partir da segunda, com troca, ausencia e extra', { skip: semBanco }, () => {
  const d = montarEscala(rodar(), AGORA);

  assert.equal(d.dias.length, 28);
  assert.equal(new Date(`${d.dias[0].data}T00:00:00Z`).getUTCDay(), 1); // segunda
  const quarta = d.dias[2];
  assert.equal(quarta.hoje, true); // o INSTANTE do harness e quarta

  assert.deepEqual(quarta.turnos.map((t) => [t.rotulo, t.horario, t.colaborador, t.destaque]),
    [['Manhã', '08–14', 'Marcos', 'padrao'], ['Tarde/noite', '14–23', 'Paulo', 'troca']]);
  assert.equal(quarta.turnos[1].nota, 'cobre Marcos');

  const quinta = d.dias[3].turnos[0];
  assert.deepEqual([quinta.colaborador, quinta.selo, quinta.nota], ['Não atribuído', 'ausência', 'Marcos ausente']);

  const domingo = d.dias[6];
  assert.deepEqual(domingo.turnos.map((t) => [t.destaque, t.colaborador]), [['extra', 'Paulo']]);
  assert.equal(domingo.mensagem, undefined);
  assert.equal(d.dias[13].mensagem, 'domingo extra disponível');

  assert.equal(d.resumo, '1 troca · 1 ausência · 1 extra');
  assert.equal(d.janela, '3 de 28 dias materializados');
});

test('escala: padroes vigentes com horario, ancora e quem pode revisar', { skip: semBanco }, () => {
  const atendente = montarEscala(rodar(PAULO), AGORA, 'padroes');
  assert.equal(atendente.visao, 'padroes');

  const [manha, tarde] = atendente.padroes;
  assert.deepEqual([manha.tipo, manha.colaboradores, manha.dias, manha.horario],
    ['Fixo', 'Marcos', 'Segunda a sábado', '08:00 – 14:00']);
  assert.deepEqual([tarde.tipo, tarde.colaboradores, tarde.horario, tarde.ancora],
    ['Alternado diário', 'Paulo · Marcos', '14:00 – 23:00 · sábado até 18:00', '10/08/2026 · Paulo']);
  assert.equal(tarde.podeRevisar, false);

  const admin = montarEscala(rodar(HELENA), AGORA, 'padroes');
  assert.deepEqual(admin.padroes.map((p) => p.podeRevisar), [false, true]);
});

// O rascunho da edição (0060) troca sem ida ao servidor: precisa de id, versao
// e titular em cada turno que o modo de edição oferece — e só nesses.
test('escala: turno futuro leva o que a troca precisa; hoje e domingo extra nao', { skip: semBanco }, () => {
  const d = montarEscala(rodar(), AGORA);

  assert.deepEqual(d.equipe.map((p) => p.nome), ['Marcos', 'Paulo']);

  const [quarta, quinta, domingo] = [d.dias[2], d.dias[3], d.dias[6]];
  assert.ok(quarta.turnos.every((t) => t.edicao === undefined), 'hoje fica congelado');
  assert.equal(domingo.turnos[0].edicao, undefined, 'domingo extra tem gesto proprio');

  const falta = quinta.turnos[0].edicao;
  assert.deepEqual([falta.tipo, falta.atual, falta.titular, falta.titularNome, falta.versao],
    ['ausencia', null, MARCOS, 'Marcos', 1]);
  assert.match(falta.identificador, /^[0-9a-f-]{36}$/);
});

test('escala: sem turno materializado a tela diz que nao ha escala', { skip: semBanco }, () => {
  const d = montarEscala(rodarTela({
    consulta: CONSULTA_ESCALA, comoQuem: PAULO, semear: '',
    parametros: [['text', 'null']], json: ['turnos', 'padroes', 'equipe'],
  }), AGORA);
  assert.deepEqual(d.dias, []);
  assert.equal(d.resumo, 'Sem escala carregada');
});

test('escala: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(PAULO, `update colaborador set ativo = false where id = '${PAULO}';`);
  assert.throws(() => montarEscala(l, AGORA), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// ------------------------------------------------------- domingo extra (0062)
// O botao nasce com uma pessoa e "outra pessoa" percorre a equipe (ADR 0060). O
// padrao e voce, se for da equipe do balcao; o Admin nao e, entao ve o primeiro.
test('escala: domingo livre oferece Assumir com uma pessoa e o seletor da equipe', { skip: semBanco }, () => {
  const doAtendente = montarEscala(rodar(PAULO), AGORA).dias[13];
  assert.equal(doAtendente.mensagem, 'domingo extra disponível');
  assert.deepEqual(doAtendente.acao, { identificador: 'assumir', rotulo: 'Assumir · Paulo' });
  assert.deepEqual(doAtendente.assumir, { identificador: PAULO, nome: 'Paulo' });
  assert.deepEqual(doAtendente.alternativa, { identificador: 'outra', rotulo: 'outra pessoa' });
  assert.equal(doAtendente.extra, undefined);

  // A Helena aciona o domingo (escala.md), mas quem FAZ o extra e Atendente: o
  // botao dela ja nasce apontando pra equipe, nao pra ela.
  const doAdmin = montarEscala(rodar(HELENA), AGORA).dias[13];
  assert.deepEqual(doAdmin.acao, { identificador: 'assumir', rotulo: 'Assumir · Marcos' });
  assert.deepEqual(doAdmin.assumir, { identificador: MARCOS, nome: 'Marcos' });
});

test('escala: domingo acionado oferece Desfazer com o turno e a versao', { skip: semBanco }, () => {
  const domingo = montarEscala(rodar(PAULO), AGORA).dias[6];
  assert.deepEqual(domingo.acao, { identificador: 'desfazer', rotulo: 'Desfazer' });
  assert.equal(domingo.extra.versao, 1);
  assert.match(domingo.extra.identificador, /^[0-9a-f-]{36}$/);
});

// ----------------------------------------------------- padrao e revisao (0062)
// A revisao vale de amanha, entao e o padrao de AMANHA que a visao mostra: o de
// hoje ja esta congelado, e mostra-lo faria a revisao operar sobre outra versao.
test('escala: a visao Padroes mostra o padrao que rege amanha', { skip: semBanco }, () => {
  const revisado = `
    update padrao_escala set vigencia_fim = app.quarta_recente(), versao = versao + 1
     where turno = 'tarde_noite';
    insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis,
                               ancora_data, ancora_colaborador_id, vigencia_inicio, versao)
    values ('tarde_noite', 'alternado_diario', '{${MARCOS},${PAULO}}', '{1,2,3,4,5,6}',
            date '2026-08-10', '${MARCOS}', app.quarta_recente() + 1, 2);
  `;
  const tarde = montarEscala(rodar(HELENA, revisado), AGORA, 'padroes').padroes[1];
  assert.equal(tarde.colaboradores, 'Marcos · Paulo');
  assert.match(tarde.versao, /^v2 · desde /);
  assert.equal(tarde.ancora.endsWith('Marcos'), true);
});

// Girar a ancora uma posicao inverte o titular de todo dia futuro: a troca
// registrada passaria a cobrir a pessoa errada, e e ela que a revisao lista.
// Quem cobre e quem o padrao NAO escalava — a troca so e afetada assim, e e
// tambem a unica forma que existe na operacao.
// ⚠ `current_date`, nao o instante do harness: quem decide o que e futuro aqui e
// app.escala_padrao_afetados, que le now(). A tela desenha a semana da quarta
// ($2), mas a revisao alcanca toda troca futura, dentro da janela ou fora.
const trocaFutura = (dias, tipo) => `
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, substituido_colaborador_id, origem)
select current_date + ${dias}, 'tarde_noite',
       case when '${tipo}' = 'ausencia' then null
            when t.titular = '${PAULO}' then '${MARCOS}'::uuid else '${PAULO}'::uuid end,
       '${tipo}', t.titular, 'manual'
  from (select app.escala_colaborador_do_dia(p, current_date + ${dias}) as titular
          from padrao_escala p where p.turno = 'tarde_noite') t;
`;

const TROCA_FUTURA = trocaFutura(2, 'troca');

test('escala: revisar lista a troca afetada, com a decisao de cada uma', { skip: semBanco }, () => {
  const linha = rodar(HELENA, TROCA_FUTURA, 'tarde_noite');
  const d = montarEscala(linha, AGORA, 'padroes');

  assert.match(d.revisao.descricao, /passa de Paulo para Marcos/);
  assert.equal(d.revisao.podeConfirmar, false);
  assert.equal(d.revisao.status, '0 de 1 revisadas');

  // Com duas pessoas, girar a ancora inverte o titular: quem cobria a troca
  // passa a ser o titular dela.
  const [cru] = linha.afetados;
  assert.equal(cru.titular_novo, cru.colaborador);
  assert.notEqual(cru.titular_novo, cru.titular_atual);

  const [afetada] = d.revisao.afetadas;
  assert.match(afetada.rotulo, /^\d\d\/\d\d · Tarde\/noite$/);
  assert.equal(afetada.registrada, `registrada: ${cru.colaborador} cobre ${cru.titular_atual}`);
  assert.equal(afetada.depois, `com a nova âncora: o titular passa a ser ${cru.colaborador}`);
  assert.deepEqual(afetada.acoes.map((a) => a.identificador), ['manter', 'padrao']);

  // O corpo do Confirmar: so a ancora muda.
  assert.deepEqual(d.revisao.alteracao.colaboradores, [PAULO, MARCOS]);
  assert.equal(d.revisao.alteracao.ancoraColaborador, MARCOS);
  assert.equal(d.revisao.alteracao.turno, 'tarde_noite');
  assert.equal(d.revisao.alteracao.versao, 1);
});

// A falta afetada recebe os mesmos dois botoes da troca (ADR 0059, migration
// 0064), com o rotulo dela: manter a falta deixa vago o turno do titular NOVO.
test('escala: falta afetada entra na revisao, com o rotulo da falta', { skip: semBanco }, () => {
  const linha = rodar(HELENA, TROCA_FUTURA + trocaFutura(3, 'ausencia'), 'tarde_noite');
  const d = montarEscala(linha, AGORA, 'padroes');

  assert.equal(d.revisao.status, '0 de 2 revisadas');
  const falta = d.revisao.afetadas.find((a) => a.registrada.startsWith('registrada: falta'));
  const cru = linha.afetados.find((a) => a.tipo_registro === 'ausencia');
  assert.equal(falta.registrada, `registrada: falta de ${cru.titular_atual}`);
  assert.equal(falta.depois, `com a nova âncora: quem fica sem cobertura passa a ser ${cru.titular_novo}`);
  assert.deepEqual(falta.acoes, [
    { identificador: 'manter', rotulo: 'Manter a falta' },
    { identificador: 'padrao', rotulo: 'Voltar ao padrão' },
  ]);
});

test('escala: revisar nao e do Atendente, e turno fora da lista nao abre', { skip: semBanco }, () => {
  assert.equal(montarEscala(rodar(PAULO, TROCA_FUTURA, 'tarde_noite'), AGORA, 'padroes').revisao, undefined);
  // 'manha' e padrao fixo: nao tem ancora que mude nada.
  assert.equal(montarEscala(rodar(HELENA, TROCA_FUTURA, 'manha'), AGORA, 'padroes').revisao, undefined);
});
