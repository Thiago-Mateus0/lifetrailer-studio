// O token do Administrador (ADR 0047 §4). Sem banco e sem rede: aqui só se prova
// que um token não vira o outro, e que o cookie sai com os atributos certos.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assinarAdmin, cookieApagado, cookieDeSessao, lerCookie, NOME_COOKIE, verificarAdmin,
} from '../../src/api/admin.mjs';
import { assinar, assinarPayload } from '../../src/api/claim.mjs';

const SEGREDO = 's'.repeat(32);
const AGORA = Date.UTC(2026, 7, 17, 11, 0, 0);
const agora = () => AGORA;

const tokenDe = (extra = {}) => assinarAdmin({
  colaborador_id: '11111111-1111-4111-8111-111111111111',
  perfil: 'administrador',
  exp: Math.floor(AGORA / 1000) + 3600,
  ...extra,
}, SEGREDO);

test('assina e verifica de volta', () => {
  const r = verificarAdmin(tokenDe(), SEGREDO, agora);
  assert.equal(r.ok, true);
  assert.equal(r.admin.colaborador_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(r.admin.tipo, 'admin');
});

test('assinar recusa token sem os campos do ADR 0047 §4', () => {
  assert.throws(() => assinarAdmin({ perfil: 'administrador', exp: 1 }, SEGREDO),
    /colaborador_id/);
});

test('segredo diferente nao verifica', () => {
  assert.equal(verificarAdmin(tokenDe(), 'o'.repeat(32), agora).motivo, 'assinatura');
});

// ⚠ A asserção que importa: os dois tokens são assinados com o MESMO segredo.
// O que os separa não é a chave, são os campos exigidos — e o `tipo`, conferido
// explicitamente para a separação não depender de um campo faltar por acidente.
test('claim de Atendente NAO vira sessao de Admin', () => {
  const claimDeAtendente = assinar({
    colaborador_id: '11111111-1111-4111-8111-111111111111',
    perfil: 'administrador',
    turno_id: '22222222-2222-4222-8222-222222222222',
    exp: Math.floor(AGORA / 1000) + 3600,
    origem_claim: 'online',
    dispositivo_id: '33333333-3333-4333-8333-333333333333',
  }, SEGREDO);

  assert.equal(verificarAdmin(claimDeAtendente, SEGREDO, agora).ok, false,
    'assinada com o mesmo segredo, e ainda assim recusada');
});

// `assinarAdmin` carimba o tipo depois do spread, então não dá pra trocá-lo por
// ali — o que é a proteção certa. Quem forja tem de montar o payload na mão, e é
// isso que este teste faz: assinado com o segredo bom, e ainda assim recusado.
test('tipo trocado no payload nao passa, mesmo assinado com o segredo certo', () => {
  const forjado = assinarPayload({
    colaborador_id: '11111111-1111-4111-8111-111111111111',
    perfil: 'administrador',
    exp: Math.floor(AGORA / 1000) + 3600,
    tipo: 'atendente',
  }, SEGREDO);

  const r = verificarAdmin(forjado, SEGREDO, agora);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'malformada');
});

test('Atendente nao passa; Administrador e Desenvolvedor passam (ADR 0049)', () => {
  assert.equal(verificarAdmin(tokenDe({ perfil: 'atendente' }), SEGREDO, agora).ok, false);
  assert.equal(verificarAdmin(tokenDe({ perfil: 'desenvolvedor' }), SEGREDO, agora).ok, true);
});

test('expirado e recusado, e o segundo exato ja e expirado', () => {
  const noLimite = tokenDe({ exp: Math.floor(AGORA / 1000) });
  assert.equal(verificarAdmin(noLimite, SEGREDO, agora).motivo, 'expirada');
});

test('token malformado nunca levanta — a resposta e 401, nao 500', () => {
  for (const ruim of ['', 'a.b', 'a.b.c.d', null, undefined, 'nao-e-token']) {
    assert.equal(verificarAdmin(ruim, SEGREDO, agora).ok, false);
  }
});

// ------------------------------------------------------------------ o cookie
test('lerCookie acha o valor entre outros', () => {
  assert.equal(lerCookie(`outro=1; ${NOME_COOKIE}=abc; mais=2`, NOME_COOKIE), 'abc');
  assert.equal(lerCookie('outro=1', NOME_COOKIE), null);
  assert.equal(lerCookie(undefined, NOME_COOKIE), null);
});

test('o cookie sai HttpOnly, SameSite=Strict e Secure por padrao', () => {
  const c = cookieDeSessao('t0ken');
  assert.match(c, /^lt_admin=t0ken;/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Secure/);
});

// Desligar o Secure é explícito e só para dev sem TLS: o padrão inverso seria o
// erro caro e silencioso — em produção sem TLS tudo funciona e o token viaja.
test('Secure so sai com o desligamento explicito', () => {
  assert.doesNotMatch(cookieDeSessao('t', { seguro: false }), /Secure/);
});

test('o logout apaga com Max-Age=0 e valor vazio', () => {
  const c = cookieApagado();
  assert.match(c, /^lt_admin=;/);
  assert.match(c, /Max-Age=0/);
});
