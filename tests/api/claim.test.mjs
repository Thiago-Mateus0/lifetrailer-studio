// A claim assinada do ADR 0020 §2. Sem banco: assinar e verificar são do Node.
import assert from 'node:assert/strict';
import test from 'node:test';

import { assinar, verificar } from '../../src/api/claim.mjs';

const SEGREDO = 's'.repeat(32);
const AGORA = Date.UTC(2026, 7, 17, 11, 0, 0);
const agora = () => AGORA;

const claimBase = () => ({
  colaborador_id: '11111111-1111-4111-8111-111111111111',
  perfil: 'atendente',
  turno_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(AGORA / 1000) + 3600,
  origem_claim: 'online',
  dispositivo_id: '33333333-3333-4333-8333-333333333333',
});

test('assina e verifica de volta, campo por campo', () => {
  const claim = claimBase();
  const r = verificar(assinar(claim, SEGREDO), SEGREDO, agora);
  assert.equal(r.ok, true);
  assert.deepEqual(r.claim, claim);
});

test('assinar recusa claim sem um dos campos do ADR 0020 §2', () => {
  for (const campo of ['colaborador_id', 'perfil', 'turno_id', 'exp', 'origem_claim']) {
    const claim = claimBase();
    delete claim[campo];
    assert.throws(() => assinar(claim, SEGREDO), new RegExp(campo));
  }
});

test('segredo diferente nao verifica', () => {
  const token = assinar(claimBase(), SEGREDO);
  assert.deepEqual(verificar(token, 'x'.repeat(32), agora), { ok: false, motivo: 'assinatura' });
});

test('corpo adulterado nao verifica — a assinatura cobre o corpo', () => {
  const token = assinar(claimBase(), SEGREDO);
  const [cabecalho, , sig] = token.split('.');
  const outro = Buffer.from(
    JSON.stringify({ ...claimBase(), perfil: 'administrador' }), 'utf8').toString('base64url');
  assert.deepEqual(
    verificar(`${cabecalho}.${outro}.${sig}`, SEGREDO, agora),
    { ok: false, motivo: 'assinatura' });
});

// A falha clássica: o token diz `alg: none` e o verificador obedece. Aqui o
// campo nunca é lido, então um cabeçalho forjado só produz outra assinatura.
test('alg: none no cabecalho nao desliga a conferencia', () => {
  const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const corpo = Buffer.from(JSON.stringify(claimBase())).toString('base64url');
  assert.equal(verificar(`${cabecalho}.${corpo}.`, SEGREDO, agora).ok, false);
  assert.equal(verificar(`${cabecalho}.${corpo}`, SEGREDO, agora).ok, false);
});

test('expira na virada do turno, e o segundo exato ja e expirada', () => {
  const claim = { ...claimBase(), exp: Math.floor(AGORA / 1000) };
  assert.deepEqual(verificar(assinar(claim, SEGREDO), SEGREDO, agora), { ok: false, motivo: 'expirada' });

  const viva = { ...claimBase(), exp: Math.floor(AGORA / 1000) + 1 };
  assert.equal(verificar(assinar(viva, SEGREDO), SEGREDO, agora).ok, true);
});

test('token malformado nunca levanta — a resposta e 401, nao 500', () => {
  for (const ruim of ['', 'a', 'a.b', 'a.b.c.d', null, undefined, 42, 'a.@@.c']) {
    const r = verificar(ruim, SEGREDO, agora);
    assert.equal(r.ok, false, `deveria recusar ${JSON.stringify(ruim)}`);
  }
});

// ADR 0020 §3: a escrita precisa saber se o servidor conferiu o PIN agora ou se
// confiou no lote da manhã. Valor fora dos dois não vira 'online' calado.
test('origem_claim fora de online|lote_offline e claim malformada', () => {
  const claim = { ...claimBase(), origem_claim: 'confie_em_mim' };
  assert.deepEqual(verificar(assinar(claim, SEGREDO), SEGREDO, agora), { ok: false, motivo: 'malformada' });

  const lote = { ...claimBase(), origem_claim: 'lote_offline' };
  assert.equal(verificar(assinar(lote, SEGREDO), SEGREDO, agora).ok, true);
});

// ADR 0048: sem o aparelho a claim não se prende a lugar nenhum, e uma cópia
// dela serviria de qualquer computador até a virada do turno.
test('claim sem dispositivo_id e malformada, e assinar recusa', () => {
  const { dispositivo_id: _d, ...semAparelho } = claimBase();
  assert.throws(() => assinar(semAparelho, SEGREDO), /dispositivo_id/);
});
