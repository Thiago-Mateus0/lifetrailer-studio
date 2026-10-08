// GET /tela/ajustes: as duas consultas no banco e a montagem do DadosAjustes.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONSULTA_AJUSTES, CONSULTA_HISTORICO_AJUSTES, DIAS_DE_HISTORICO, montarAjustes,
} from '../../src/api/telas/ajustes.mjs';
import { bancoDisponivel, HELENA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';
const config = { local: 'Recepção', dispositivo: 'Tablet 01', versao: 'teste', segredo: 's'.repeat(32) };

// A Helena troca o PIN do Paulo pelo caminho real (app.pin_definir grava o log).
// O GUC fica setado para a consulta: audit_log_consultar exige o ator (ADR 0020).
const comGuc = (quem) => `select set_config('app.colaborador_id', '${quem}', true);`;
const SEMEAR = `
${comGuc(HELENA)}
select app.pin_definir('${PAULO}', '4721', '${HELENA}');
`;

const AGORA = new Date();

// O psql devolve boolean como 't'/'f'; o driver pg, que é o que produção usa,
// devolve true/false. A conversão fica aqui, no harness do teste, não na tela.
const comoPg = (l) => ({ ...l, eu_socio: l.eu_socio === 't' });

test('ajustes: o socio ve as pessoas ativas e os perfis do dominio', { skip: semBanco }, () => {
  const l = comoPg(rodarTela({ consulta: CONSULTA_AJUSTES, comoQuem: HELENA, semear: SEMEAR, json: ['pessoas', 'equipe'] }));
  const d = montarAjustes(l, [], AGORA, config);

  assert.equal(d.podeEditar, true);
  // O nível vai junto: a seção de PIN filtra Atendente (ADR 0049). PIN, nem máscara.
  assert.deepEqual(d.pessoas.map((p) => [p.nome, p.papel, p.nivel]),
    [['Dev', 'Dev', 'desenvolvedor'], ['Helena', 'Sócio', 'administrador'], ['Marcos', 'Atendente', 'atendente'], ['Paulo', 'Atendente', 'atendente']]);
  assert.ok(d.pessoas.every((p) => !('pinAtual' in p) && !('novoPin' in p)));
  assert.deepEqual(d.perfis.map((p) => p.identificador), ['socio', 'administrador', 'desenvolvedor', 'atendente']);
  assert.equal(d.rodape, 'Recepção · Tablet 01 · vteste');
});

test('ajustes: o historico de PIN sai do audit log, pela funcao que o role pode chamar', { skip: semBanco }, () => {
  const h = rodarTela({
    consulta: CONSULTA_HISTORICO_AJUSTES, comoQuem: HELENA, semear: SEMEAR,
    parametros: [['int', String(DIAS_DE_HISTORICO)]],
    // ts_servidor é o now() da transação; o instante fixo da quarta ficaria antes dele.
    instante: 'now()',
  });
  assert.deepEqual([h.alvo, h.por], ['Paulo', 'Helena']);

  const d = montarAjustes({ eu_nome: 'Helena', eu_perfil: 'administrador', eu_socio: true, pessoas: [] }, [h], AGORA, config);
  assert.match(d.auditoria[0].quando, /^\d\d\/\d\d · \d\d:\d\d$/);
});

test('ajustes: quem nao e Administrador recebe a tela restrita, sem pessoa nenhuma', { skip: semBanco }, () => {
  for (const quem of [PAULO, 'aaaaaaaa-0000-0000-0000-000000000004']) {
    const l = comoPg(rodarTela({ consulta: CONSULTA_AJUSTES, comoQuem: quem, semear: SEMEAR, json: ['pessoas', 'equipe'] }));
    const d = montarAjustes(l, [], AGORA, config);
    assert.equal(d.podeEditar, false);
    assert.deepEqual(d.pessoas, []);
  }
});

// ADR 0050: a gerente é Administradora e ainda assim não dá acesso.
test('ajustes: a gerente (Administradora sem ser socia) recebe a tela restrita', { skip: semBanco }, () => {
  const GERENTE = 'aaaaaaaa-0000-0000-0000-000000000005';
  const l = comoPg(rodarTela({
    consulta: CONSULTA_AJUSTES, comoQuem: GERENTE, json: ['pessoas', 'equipe'],
    semear: `${SEMEAR}
insert into colaborador (id, nome, nivel_acesso) values ('${GERENTE}', 'Gerente', 'administrador');`,
  }));
  const d = montarAjustes(l, [], AGORA, config);
  assert.equal(d.podeEditar, false);
  assert.deepEqual(d.pessoas, []);
  assert.match(d.mensagemPermissao, /sócios/);
});

test('ajustes: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodarTela({
    consulta: CONSULTA_AJUSTES, comoQuem: HELENA, semear: SEMEAR, json: ['pessoas', 'equipe'],
    extra: `update colaborador set ativo = false where id = '${HELENA}';`,
  });
  assert.throws(() => montarAjustes(l, [], AGORA, config), (e) => e.code === 'LT_SEM_COLABORADOR');
});

// Issue #220. "Minha senha" é de todo mundo que entra por senha — inclusive a
// gerente, que recebe a tela restrita. Redefinir a senha de outra pessoa é só
// do sócio, e a lista dele traz só quem tem senha (Atendente entra por PIN).
test('ajustes: minha senha aparece para quem entra por senha, e so', { skip: semBanco }, () => {
  for (const [quem, espera] of [[HELENA, true], ['aaaaaaaa-0000-0000-0000-000000000004', true], [PAULO, false]]) {
    const l = comoPg(rodarTela({ consulta: CONSULTA_AJUSTES, comoQuem: quem, semear: SEMEAR, json: ['pessoas', 'equipe'] }));
    assert.equal(montarAjustes(l, [], AGORA, config).minhaSenha, espera, quem);
  }
});

test('ajustes: o socio ve quem tem senha para redefinir, com o login atual', { skip: semBanco }, () => {
  const l = comoPg(rodarTela({
    consulta: CONSULTA_AJUSTES, comoQuem: HELENA, json: ['pessoas', 'equipe'],
    semear: `${SEMEAR}
update colaborador set login = 'helena' where id = '${HELENA}';`,
  }));
  const d = montarAjustes(l, [], AGORA, config);
  assert.deepEqual(d.acessos.map((p) => [p.nome, p.login]), [['Dev', ''], ['Helena', 'helena']]);
});

test('ajustes: quem nao e socio nao recebe a lista de redefinir', () => {
  const d = montarAjustes({ eu_nome: 'Gerente', eu_perfil: 'administrador', eu_socio: false, pessoas: [] }, [], AGORA, config);
  assert.deepEqual(d.acessos, []);
  assert.equal(d.minhaSenha, true);
});

// Issue #216: o sócio vê a equipe inteira, inclusive quem está desativado, para
// poder reativar; ele próprio aparece sem o botão de desativar.
test('ajustes: o socio ve a equipe com ativos e desativados, e a si mesmo marcado', { skip: semBanco }, () => {
  const l = comoPg(rodarTela({
    consulta: CONSULTA_AJUSTES, comoQuem: HELENA, json: ['pessoas', 'equipe'],
    semear: `${SEMEAR}
update colaborador set ativo = false where id = '${PAULO}';`,
  }));
  const d = montarAjustes(l, [], AGORA, config);
  assert.deepEqual(d.equipe.map((p) => [p.nome, p.ativo, p.souEu]),
    [['Dev', true, false], ['Helena', true, true], ['Marcos', true, false], ['Paulo', false, false]]);
  assert.equal(typeof d.equipe[0].versao, 'number');
});

test('ajustes: quem nao e socio nao recebe a equipe', () => {
  const d = montarAjustes({ eu_nome: 'Gerente', eu_perfil: 'administrador', eu_socio: false, pessoas: [], equipe: [] }, [], AGORA, config);
  assert.deepEqual(d.equipe, []);
});
