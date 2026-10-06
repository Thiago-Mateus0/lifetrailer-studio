// Configuração do lado-app do processo. Mesmo desenho do src/webhook/config.mjs:
// tudo por variável de ambiente, e falha no boot quando o segredo falta.
//
// O ADR 0020 §2 põe o segredo da claim "no mesmo lugar do token do webhook do
// ADR 0019" — variável de ambiente do processo, nunca conteúdo versionado.

// O validador de inteiro é o do webhook, importado e não copiado: é um processo
// só (ADR 0042 §1), e duas cópias divergiriam na primeira correção de uma delas.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inteiro } from '../webhook/config.mjs';

// Mesmo piso do token do webhook, e pela mesma razão: abaixo disto deixa de ser
// segredo formal.
export const SEGREDO_MINIMO = 32;

export function lerConfigApp(env = process.env) {
  const segredo = env.LT_CLAIM_SEGREDO ?? '';
  if (segredo.length < SEGREDO_MINIMO) {
    throw new Error(
      `LT_CLAIM_SEGREDO ausente ou curto demais (mínimo ${SEGREDO_MINIMO} caracteres). ` +
        'Gere com: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  return {
    segredo,
    // Só aparece no rodapé das telas. Não é identidade de nada: o ADR 0020
    // deixou a identidade na claim, e o dispositivo não autoriza.
    dispositivo: env.LT_APP_DISPOSITIVO ?? 'Tablet',
    local: env.LT_APP_LOCAL ?? 'Estúdio',
    versao: env.LT_APP_VERSAO ?? 'dev',

    // ---------------------------------------------- o limite de /sessao (#78)
    // ⚠ Este limite NÃO existe pra conter adivinhação de PIN — quem faz isso é
    // app.pin_bloqueado (ADR 0039 §3), no banco, e continua fazendo. Ele existe
    // porque o bloqueio daquele ADR é POR COLABORADOR: com a lista que
    // /tela/entrada devolve sem claim, uma origem só queima 5 PINs errados de
    // cada pessoa e trava a equipe inteira, de novo a cada 15 min. O ADR 0039
    // §4 recusou bloquear o dispositivo justamente pra não parar a operação —
    // e sem este limite a operação para do mesmo jeito, de fora.
    //
    // 10 tentativas por IP em 15 min: um turno inteiro de gente errando o
    // próprio PIN cabe folgado, e o laço não cabe. A janela é a mesma do
    // bloqueio de propósito — dois relógios diferentes pra mesma coisa é onde
    // nascem as bordas.
    limiteSessao: inteiro(env.LT_APP_LIMITE_SESSAO, 10, 'LT_APP_LIMITE_SESSAO'),
    janelaSessaoMs: inteiro(env.LT_APP_JANELA_MS, 900_000, 'LT_APP_JANELA_MS'),

    // Mesma variável do webhook, de propósito: é UM fato sobre UMA porta (ADR
    // 0042 §1). Um segundo nome pro mesmo fato deixaria o limite do app
    // confiando no X-Forwarded-For enquanto o do webhook não confia — e aí
    // qualquer um escolhe de qual dos dois escapar.
    confiaProxy: (env.LT_WEBHOOK_CONFIA_PROXY ?? '') === '1',

    // ---------------------------------------------------- a mídia (ADR 0051 §1)
    // Em dev os bytes vão pro disco, atrás da interface de dois métodos que o
    // R2 implementa depois. Caminho absoluto derivado do próprio arquivo, e não
    // relativo ao cwd: o processo pode ser iniciado de qualquer pasta, e um
    // `var/midia` que muda de lugar conforme quem digitou o comando é foto
    // gravada num canto que ninguém encontra depois.
    midiaDir: env.LT_MIDIA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'var', 'midia'),

    // ⚠ `Secure` no cookie do Admin (ADR 0047 §4) vem LIGADO, e desligar é
    // explícito. O padrão inverso seria o erro silencioso caro: em produção sem
    // TLS o cookie viajaria em claro e ninguém notaria, porque tudo funciona.
    // Existe só para desenvolvimento sem certificado.
    cookieSeguro: (env.LT_APP_COOKIE_INSEGURO ?? '') !== '1',

    // A chave da API do ManyChat (ADR 0076 §2). Só no servidor; vazia desliga
    // o Enviar automático e a Jana segue pelo Copiar mensagem.
    manychatToken: (env.LT_MANYCHAT_TOKEN ?? '').trim(),
  };
}
