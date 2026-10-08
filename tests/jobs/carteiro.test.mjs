// O carteiro da âncora. Sem banco e sem rede: pool e envio são injetados.
//
// O que o banco garante está em tests/db/23_ancora_semanal.sql. O que se prova
// aqui é a única coisa que o SQL não alcança: a ORDEM entre pôr na rua e
// marcar que saiu — e o que acontece quando a rua falha.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import {
  criarCarteiro,
  criarEnvioSmtp,
  configuracaoSmtpDoEnv,
  corpoEmTexto,
  destinatariosDoEnv,
  umaLinha,
  INTERVALO_PADRAO_MS,
} from '../../src/jobs/carteiro.mjs';

const CORPO = {
  semana: '2026-W36',
  periodo: '31/08/2026 a 06/09/2026',
  audit_seq: 8421,
  audit_hash: 'a3f9c2e1b7d4',
  horas_extras: [
    { colaborador: 'Marcos', minutos: 90, valor: '45.00', pendentes: 1, pagas: 0 },
  ],
};

function poolFalso(pendentes = []) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      if (sql.includes('ancora_pendente')) return { rows: pendentes };
      return { rows: [] };
    },
  };
}

const UMA = [{ id: 'uuid-1', semana: '2026-W36', assunto: 'Lifetrailer · ancora 2026-W36 · seq 8421 · a3f9c2e1b7d4', corpo: CORPO }];

test('entrega na primeira volta — ancora atrasada nao espera o intervalo', async () => {
  const pool = poolFalso(UMA);
  const enviados = [];
  const entregar = criarCarteiro({
    pool, enviar: async (m) => enviados.push(m),
    destinatarios: ['wyll@exemplo.com'], agora: () => 0,
  });

  assert.equal(await entregar(), 1);
  assert.equal(enviados.length, 1);
});

test('ENVIA ANTES DE MARCAR — entre duplicar e mentir, duplica', async () => {
  const pool = poolFalso(UMA);
  const ordem = [];
  const original = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (sql.includes('marcar_enviada')) ordem.push('marcou');
    return original(sql, params);
  };

  const entregar = criarCarteiro({
    pool,
    enviar: async () => { ordem.push('enviou'); },
    destinatarios: ['wyll@exemplo.com'], agora: () => 0,
  });
  await entregar();

  assert.deepEqual(ordem, ['enviou', 'marcou']);
});

test('envio que falha NAO marca — a linha nao pode dizer que a ancora saiu', async () => {
  const pool = poolFalso(UMA);
  const erros = [];
  const entregar = criarCarteiro({
    pool,
    enviar: async () => { throw new Error('smtp fora do ar'); },
    destinatarios: ['wyll@exemplo.com'], aoErro: (...a) => erros.push(a.join(' ')),
    agora: () => 0,
  });

  assert.equal(await entregar(), 0);
  assert.equal(pool.chamadas.filter((c) => c.sql.includes('marcar_enviada')).length, 0,
    'nenhuma marcacao');
  assert.match(erros.join(' '), /nao foi possivel entregar/);
});

test('o assunto vai INTOCADO — e ele que carrega a ancora (ADR 0038 §3)', async () => {
  const pool = poolFalso(UMA);
  const enviados = [];
  const entregar = criarCarteiro({
    pool, enviar: async (m) => enviados.push(m),
    destinatarios: ['wyll@exemplo.com', 'helena@exemplo.com'], agora: () => 0,
  });
  await entregar();

  assert.equal(enviados[0].assunto, UMA[0].assunto);
  assert.match(enviados[0].assunto, /a3f9c2e1b7d4$/, 'hash inteiro, sem truncar');
  assert.deepEqual(enviados[0].destinatarios, ['wyll@exemplo.com', 'helena@exemplo.com']);
});

test('sem destinatario NAO envia, e grita toda vez (ADR 0038 §2)', async () => {
  const pool = poolFalso(UMA);
  const erros = [];
  let enviou = false;
  const entregar = criarCarteiro({
    pool, enviar: async () => { enviou = true; },
    destinatarios: [], aoErro: (m) => erros.push(m), agora: () => 0,
  });

  assert.equal(await entregar(), null);
  assert.equal(enviou, false);
  assert.match(erros[0], /NAO esta sendo publicada/);
  assert.equal(pool.chamadas.length, 0, 'nem consulta o banco');
});

test('respeita o intervalo entre voltas', async () => {
  const pool = poolFalso([]);
  let t = 0;
  const entregar = criarCarteiro({
    pool, enviar: async () => {}, destinatarios: ['w@e.com'], agora: () => t,
  });

  await entregar();
  assert.equal(await entregar(), null, 'a segunda volta imediata nao consulta');
  t = INTERVALO_PADRAO_MS;
  assert.equal(await entregar(), 0, 'passado o intervalo, volta a conferir');
});

test('marca com o destino de verdade — a linha diz PRA ONDE foi', async () => {
  const pool = poolFalso(UMA);
  const entregar = criarCarteiro({
    pool, enviar: async () => {},
    destinatarios: ['wyll@exemplo.com', 'helena@exemplo.com'], agora: () => 0,
  });
  await entregar();

  const marcacao = pool.chamadas.find((c) => c.sql.includes('marcar_enviada'));
  assert.deepEqual(marcacao.params, ['uuid-1', 'wyll@exemplo.com, helena@exemplo.com']);
});

// ------------------------------------------------------------------- o corpo
test('o corpo e texto puro e diz que nao ha nada a fazer', () => {
  const t = corpoEmTexto(CORPO);
  assert.match(t, /8421/);
  assert.match(t, /a3f9c2e1b7d4/);
  assert.match(t, /Marcos: 90 min/);
  assert.match(t, /so nao apagar/,
    'a instrucao em uma frase que o ADR 0024 pedia');
});

test('audit log vazio nao inventa hash no corpo', () => {
  const t = corpoEmTexto({ ...CORPO, audit_seq: null, audit_hash: null });
  assert.match(t, /audit log estava vazio/);
  assert.doesNotMatch(t, /hash:/);
});

test('semana sem hora extra diz isso, nao some com a secao', () => {
  assert.match(corpoEmTexto({ ...CORPO, horas_extras: [] }), /nenhuma hora extra lancada/);
});

// ------------------------------------------------------------------- o ambiente
test('destinatariosDoEnv separa por virgula e ignora espaco', () => {
  assert.deepEqual(
    destinatariosDoEnv({ LT_ANCORA_DESTINATARIOS: ' wyll@e.com , helena@e.com ,' }),
    ['wyll@e.com', 'helena@e.com'],
  );
  assert.deepEqual(destinatariosDoEnv({}), []);
});

test('configuracao de SMTP recusa faltando, e nomeia o que falta', () => {
  assert.throws(() => configuracaoSmtpDoEnv({ LT_SMTP_HOST: 'smtp.exemplo.com' }),
    /LT_SMTP_USUARIO.*LT_SMTP_SENHA.*LT_SMTP_REMETENTE/);
});

test('porta 465 e TLS implicito; 587 e STARTTLS — errar isso pendura a conexao', () => {
  const base = {
    LT_SMTP_HOST: 'smtp.exemplo.com', LT_SMTP_USUARIO: 'u',
    LT_SMTP_SENHA: 's', LT_SMTP_REMETENTE: 'r@e.com',
  };
  assert.equal(configuracaoSmtpDoEnv({ ...base, LT_SMTP_PORTA: '465' }).secure, true);
  assert.equal(configuracaoSmtpDoEnv({ ...base, LT_SMTP_PORTA: '587' }).secure, false);
  assert.equal(configuracaoSmtpDoEnv(base).port, 587, 'o padrao e 587');
});

test('assunto e UMA linha — CRLF em cabecalho de e-mail e cabecalho novo', () => {
  assert.equal(
    umaLinha('Lifetrailer · ancora\r\nBcc: invasor@exemplo.com'),
    'Lifetrailer · ancora Bcc: invasor@exemplo.com',
    'as quebras somem; o texto nao vira cabecalho');
  assert.equal(umaLinha('  normal  '), 'normal');
});

// Em produção o `nodemailer` mora em src/webhook/node_modules, e o import nu a
// partir de src/jobs não o achava: o worker subia dizendo "SMTP nao configurado".
// A CI deste job roda sem dependência instalada, então lá o teste se declara skipped.
const instalado = existsSync(new URL('../../src/webhook/node_modules/nodemailer', import.meta.url));
test('criarEnvioSmtp acha o nodemailer instalado em src/webhook', { skip: !instalado && 'sem npm ci em src/webhook' }, async () => {
  const enviar = await criarEnvioSmtp({
    LT_SMTP_HOST: 'smtp.exemplo.com', LT_SMTP_USUARIO: 'u',
    LT_SMTP_SENHA: 's', LT_SMTP_REMETENTE: 'r@e.com',
  });
  assert.equal(typeof enviar, 'function');
});
