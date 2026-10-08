// Configuração do receptor do webhook. Tudo por variável de ambiente do
// processo (ADR 0018); o token é segredo de deploy, nunca conteúdo versionado.
//
// Falha no boot é de propósito: subir sem token é subir com a porta destrancada,
// e o ADR 0012 chama isso de defeito de desenho, não de configuração faltando.

import { readFileSync } from 'node:fs';

// O token vive no path (ADR 0019) e é o único mecanismo que a Altegio permite —
// não há header, não há HMAC, não há allowlist de IP. Curto demais deixa de ser
// segredo formal e vira a "obscuridade da URL" que o 0012 já rejeitou.
export const TOKEN_MINIMO = 32;

export const PREFIXO_ROTA = '/webhook/altegio/';

// Só o que começa com isto é registrado. Ver comentário em servidor.mjs.
export const PREFIXO_LOG = '/webhook';

// Exportada porque o lado-app lê os limites dele com a MESMA regra (ADR 0042
// §1: um processo). Duas cópias divergiriam no dia em que uma aceitasse zero.
export const inteiro = (bruto, padrao, nome) => {
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${nome} precisa ser um inteiro positivo, veio ${JSON.stringify(bruto)}`);
  }
  return n;
};

// O banco gerenciado assina com CA própria; o `pg` não lê PGSSLROOTCERT
// sozinho, e sem a CA recusa a conexão (deploy/README.md, passo 3).
export function sslDoBanco(env = process.env) {
  return env.PGSSLROOTCERT ? { ssl: { ca: readFileSync(env.PGSSLROOTCERT, 'utf8') } } : {};
}

export function lerConfig(env = process.env) {
  const token = env.LT_WEBHOOK_TOKEN ?? '';
  if (token.length < TOKEN_MINIMO) {
    throw new Error(
      `LT_WEBHOOK_TOKEN ausente ou curto demais (mínimo ${TOKEN_MINIMO} caracteres). ` +
        'Gere com: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  // O token viaja no caminho da URL: caractere fora disto (`/`, `?`, `#`, `%`,
  // `+` do base64 comum) passa na validação e nunca casa na rota.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('LT_WEBHOOK_TOKEN so pode ter letras, numeros, "-" e "_" (use base64url, nao base64).');
  }

  return {
    token,
    porta: inteiro(env.LT_WEBHOOK_PORTA, 8787, 'LT_WEBHOOK_PORTA'),
    // Volume real são dezenas de eventos por dia; o limite existe pra proteger
    // a tabela append-only de log, não pra moldar tráfego legítimo.
    limitePorJanela: inteiro(env.LT_WEBHOOK_LIMITE, 120, 'LT_WEBHOOK_LIMITE'),
    janelaMs: inteiro(env.LT_WEBHOOK_JANELA_MS, 60_000, 'LT_WEBHOOK_JANELA_MS'),
    corpoMaxBytes: inteiro(env.LT_WEBHOOK_CORPO_MAX, 1_048_576, 'LT_WEBHOOK_CORPO_MAX'),
    // X-Forwarded-For só vale quando existe um proxy nosso na frente. Confiar
    // por padrão deixaria qualquer um forjar o IP do log e escapar do limite.
    confiaProxy: (env.LT_WEBHOOK_CONFIA_PROXY ?? '') === '1',
  };
}
