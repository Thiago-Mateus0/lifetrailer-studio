// O backup para o R2 (ADR 0028 §2, ADR 0074): pg_dump de hora em hora, gravado
// em horario/, diario/ e mensal/. O job grava e nunca apaga — quem impede o
// apagamento é o Bucket Lock, e quem limpa é o lifecycle.
//
// O que gravar nesta hora é do banco (`app.backup_camadas`), e o alerta de duas
// falhas seguidas também (`app.backup_registrar`). Aqui ficam o relógio, o
// pg_dump e o PUT.
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';

export const NOME_DO_JOB = 'backup';

// De minuto em minuto só pergunta ao banco se a hora já foi tentada; o dump sai
// uma vez por hora. Conferir de 15 em 15 min deixaria o dump da 00h cair até
// 00h14, e o RPO do ADR 0028 é de uma hora.
export const INTERVALO_PADRAO_MS = 60_000;

export function lerConfigBackup(env = process.env) {
  const faltando = [
    'LT_BACKUP_DATABASE_URL',
    'LT_BACKUP_R2_ENDPOINT',
    'LT_BACKUP_R2_ACCESS_KEY_ID',
    'LT_BACKUP_R2_SECRET_ACCESS_KEY',
  ].filter((nome) => !env[nome]);
  if (faltando.length > 0) {
    throw new Error(`faltam ${faltando.join(', ')}`);
  }
  return {
    bancoUrl: env.LT_BACKUP_DATABASE_URL,
    endpoint: env.LT_BACKUP_R2_ENDPOINT.replace(/\/+$/, ''),
    bucket: env.LT_BACKUP_R2_BUCKET ?? 'lifetrailer-backup',
    chaveId: env.LT_BACKUP_R2_ACCESS_KEY_ID,
    segredo: env.LT_BACKUP_R2_SECRET_ACCESS_KEY,
    pgDump: env.LT_BACKUP_PG_DUMP ?? 'pg_dump',
  };
}

// ADR 0074 §2: `horario/2026-09-26T13-00Z.dump`. O minuto entra porque um
// processo reiniciado dentro da hora não pode gerar o mesmo nome — sobrescrever
// é o que o lock recusa.
export function chaveDoDump(camada, instante) {
  const iso = instante.toISOString(); // 2026-09-26T13:00:12.345Z
  return `${camada}/${iso.slice(0, 13)}-${iso.slice(14, 16)}Z.dump`;
}

// ------------------------------------------------------------------ pg_dump
// Formato custom: é o que o pg_restore do drill (ADR 0028 §3) lê, e já vem
// comprimido. O dump inteiro fica em memória: o ADR 0028 mede em poucos MB.
export function criarDespejo({ bancoUrl, pgDump = 'pg_dump' }) {
  return () =>
    new Promise((resolve, reject) => {
      const filho = spawn(pgDump, ['--format=custom', '--dbname', bancoUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const saida = [];
      let erro = '';
      filho.stdout.on('data', (b) => saida.push(b));
      filho.stderr.on('data', (b) => {
        erro += b;
      });
      filho.on('error', reject);
      filho.on('close', (codigo) => {
        const bytes = Buffer.concat(saida);
        // Saída não-zero é dump truncado mesmo que tenha bytes: não sobe.
        if (codigo !== 0) return reject(new Error(`pg_dump saiu com ${codigo}: ${erro.trim().slice(0, 500)}`));
        if (bytes.subarray(0, 5).toString() !== 'PGDMP') {
          return reject(new Error('pg_dump nao devolveu um dump no formato custom'));
        }
        resolve(bytes);
      });
    });
}

// ----------------------------------------------------------------------- R2
// PUT assinado com SigV4, que é o que o R2 aceita pela API S3. Escrito aqui em
// vez de trazer o SDK da AWS: é uma requisição só, e o algoritmo está coberto
// pelo exemplo oficial em tests/jobs/backup.test.mjs.
const sha256 = (dado) => createHash('sha256').update(dado).digest('hex');
const hmac = (chave, dado) => createHmac('sha256', chave).update(dado).digest();

const codificar = (segmento) =>
  encodeURIComponent(segmento).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function assinar({ metodo, url, cabecalhos, hashDoCorpo, chaveId, segredo, regiao, instante }) {
  const u = new URL(url);
  const amzData = instante.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dia = amzData.slice(0, 8);

  const todos = { ...cabecalhos, host: u.host, 'x-amz-date': amzData, 'x-amz-content-sha256': hashDoCorpo };
  const nomes = Object.keys(todos).map((n) => n.toLowerCase()).sort();
  const porNome = Object.fromEntries(Object.entries(todos).map(([n, v]) => [n.toLowerCase(), String(v).trim()]));
  const assinados = nomes.join(';');

  const canonica = [
    metodo,
    u.pathname.split('/').map((s) => codificar(decodeURIComponent(s))).join('/'),
    [...u.searchParams].map(([k, v]) => `${codificar(k)}=${codificar(v)}`).sort().join('&'),
    nomes.map((n) => `${n}:${porNome[n]}\n`).join(''),
    assinados,
    hashDoCorpo,
  ].join('\n');

  const escopo = `${dia}/${regiao}/s3/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', amzData, escopo, sha256(canonica)].join('\n');
  const chave = ['s3', 'aws4_request'].reduce(
    (k, parte) => hmac(k, parte),
    hmac(hmac(`AWS4${segredo}`, dia), regiao),
  );
  const assinatura = createHmac('sha256', chave).update(paraAssinar).digest('hex');

  return {
    ...Object.fromEntries(nomes.filter((n) => n !== 'host').map((n) => [n, porNome[n]])),
    authorization: `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`,
  };
}

export function criarGravadorR2({ endpoint, bucket, chaveId, segredo, buscar = fetch, agora = () => Date.now() }) {
  return async function gravar(chave, bytes) {
    const url = `${endpoint}/${bucket}/${chave}`;
    const cabecalhos = assinar({
      metodo: 'PUT',
      url,
      // If-None-Match: se o nome já existe, o R2 recusa em vez de sobrescrever.
      cabecalhos: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
      hashDoCorpo: sha256(bytes),
      chaveId,
      segredo,
      regiao: 'auto',
      instante: new Date(agora()),
    });
    const resposta = await buscar(url, { method: 'PUT', headers: cabecalhos, body: bytes });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      throw new Error(`r2: HTTP ${resposta.status} ao gravar ${chave}: ${corpo.slice(0, 300)}`);
    }
  };
}

// --------------------------------------------------------------------- o job
export function criarBackup({
  pool,
  despejar,
  gravar,
  intervaloMs = INTERVALO_PADRAO_MS,
  aoErro = console.error,
  agora = () => Date.now(),
}) {
  let proxima = 0;

  return async function backup() {
    if (agora() < proxima) return null;
    proxima = agora() + intervaloMs;

    let camadas;
    try {
      const { rows } = await pool.query('select app.backup_camadas() as camadas');
      camadas = rows[0]?.camadas ?? [];
    } catch (erro) {
      aoErro('backup: nao consegui perguntar ao banco o que gravar —', erro.message ?? String(erro));
      return null;
    }
    if (camadas.length === 0) return null;

    const inicio = new Date(agora());
    const gravadas = [];
    let resultado = 'ok';
    let erroTexto = null;
    let bytes = 0;
    try {
      const dump = await despejar();
      bytes = dump.length;
      // Em ordem: o horário primeiro, que é o que o RPO mede.
      for (const camada of camadas) {
        const chave = chaveDoDump(camada, inicio);
        await gravar(chave, dump);
        gravadas.push(chave);
      }
    } catch (erro) {
      resultado = 'falhou';
      erroTexto = erro.message ?? String(erro);
      aoErro('backup: falhou —', erroTexto);
    }

    const detalhe = { camadas, bytes, gravadas };
    try {
      await pool.query('select app.backup_registrar($1::timestamptz, $2, $3::jsonb, $4)', [
        inicio.toISOString(),
        resultado,
        JSON.stringify(detalhe),
        erroTexto,
      ]);
    } catch (erro) {
      aoErro('backup: nao consegui registrar a execucao —', erro.message ?? String(erro));
    }
    return { resultado, ...detalhe };
  };
}
