// O carteiro da âncora: quem tira a linha da fila e põe o e-mail na rua.
//
// ADR 0038 — a âncora do audit log sai por e-mail, e o destinatário que
// sustenta a propriedade é o Wyll: a caixa dele é a única que não é
// administrada por quem administra o banco. O ADR 0024 §3 explica por que isso
// é a parte que funciona — o Dev pode reescrever a cadeia inteira, mas não o
// que já saiu.
//
// ⚠ ESTE ARQUIVO NÃO É A ÂNCORA, e o de SQL também não era. A âncora é a cópia
// que CHEGA. Aqui é só o carteiro — e um carteiro que mente sobre ter entregado
// é pior que um que não entrega, o que decide a ordem das operações abaixo.
//
// A decisão de O QUE mandar é do banco (`app.ancora_pendente`, que já monta o
// assunto). Aqui existe o relógio, a rede, e a marcação de volta.
import { createRequire } from 'node:module';

// 15 min, o mesmo do vigia. A âncora é semanal: o que este intervalo decide não
// é "quando a âncora sai", é "quanto tempo depois de o job gravar a linha o
// e-mail vai embora". Meia hora a mais numa entrega semanal não muda nada; o
// que não pode é ficar parado até alguém reiniciar o processo.
export const INTERVALO_PADRAO_MS = 900_000;

export function destinatariosDoEnv(env) {
  return String(env.LT_ANCORA_DESTINATARIOS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

export function criarCarteiro({
  pool,
  enviar,
  destinatarios,
  intervaloMs = INTERVALO_PADRAO_MS,
  aoErro = console.error,
  agora = () => Date.now(),
}) {
  // Zero, não `agora()`: se o processo subiu depois de uma semana fora, a
  // âncora atrasada tem de sair agora e não daqui a 15 min.
  let proxima = 0;

  return async function entregar() {
    if (agora() < proxima) return null;
    proxima = agora() + intervaloMs;

    if (destinatarios.length === 0) {
      // Sem destinatário a âncora não existe (ADR 0038 §2). Isto é erro de
      // configuração, e tem de gritar toda vez — deixar passar em silêncio é
      // construir a cadeia de hash inteira e não publicar nada.
      aoErro('carteiro: LT_ANCORA_DESTINATARIOS vazio — a ancora NAO esta sendo publicada (ADR 0038)');
      return null;
    }

    let entregues = 0;
    try {
      const { rows } = await pool.query(
        'select id, semana, assunto, corpo from app.ancora_pendente()',
      );

      for (const linha of rows) {
        // ⚠ ENVIA ANTES DE MARCAR, e a ordem é a decisão, não o acaso.
        //
        // Marcar primeiro e falhar no envio deixa uma linha dizendo que a
        // âncora foi publicada quando ela não foi — e essa linha é justamente a
        // que alguém vai consultar numa disputa. Enviar primeiro e falhar na
        // marcação, no pior caso, manda o mesmo e-mail duas vezes na volta
        // seguinte: conteúdo idêntico, incômodo e inofensivo.
        //
        // Entre duplicar e mentir, duplica.
        await enviar({
          destinatarios,
          // O assunto vem PRONTO do banco e não se toca: é ele que carrega a
          // âncora (ADR 0038 §3). Nada de prefixo, contador ou reticências.
          assunto: linha.assunto,
          corpo: linha.corpo,
        });

        await pool.query('select app.ancora_marcar_enviada($1, $2)', [
          linha.id,
          destinatarios.join(', '),
        ]);
        entregues += 1;
      }

      return entregues;
    } catch (erro) {
      // Falha de rede ou de SMTP não para o worker do webhook: a linha continua
      // pendente e volta no próximo intervalo. Quem grita se ela nunca sair é
      // `app.job_atrasado()` (ADR 0029 §4) — mas só sobre o JOB, então o erro
      // aqui precisa aparecer no log de qualquer jeito.
      aoErro('carteiro: nao foi possivel entregar a ancora', erro.message ?? String(erro));
      return entregues;
    }
  };
}

// ---------------------------------------------------------------- o SMTP real
//
// `nodemailer` é a segunda dependência de runtime do repositório, e a
// justificativa é uma linha: falar SMTP na mão é implementar EHLO, STARTTLS e
// AUTH — protocolo de rede, não regra de negócio, e errar nele é não entregar
// em silêncio. Fica isolada aqui e só carrega dentro da função: os testes injetam
// `enviar` e nunca a carregam, do mesmo jeito que os do webhook rodam sem `pg`.
//
// O ADR 0038 deixou o PROVEDOR em aberto de propósito — ele não afeta a
// propriedade, porque a propriedade vem de quem recebe. Trocar de provedor é
// trocar variável de ambiente.
export function configuracaoSmtpDoEnv(env) {
  const faltando = ['LT_SMTP_HOST', 'LT_SMTP_USUARIO', 'LT_SMTP_SENHA', 'LT_SMTP_REMETENTE']
    .filter((k) => !env[k]);
  if (faltando.length > 0) {
    throw new Error(`carteiro: faltam variaveis de SMTP: ${faltando.join(', ')}`);
  }
  const porta = Number(env.LT_SMTP_PORTA ?? 587);
  return {
    host: env.LT_SMTP_HOST,
    port: porta,
    // 465 é TLS implícito; 587 é STARTTLS. Errar isto é conexão que pendura.
    secure: porta === 465,
    auth: { user: env.LT_SMTP_USUARIO, pass: env.LT_SMTP_SENHA },
    remetente: env.LT_SMTP_REMETENTE,
  };
}

export async function criarEnvioSmtp(env) {
  const cfg = configuracaoSmtpDoEnv(env);
  // O pacote está em src/webhook/node_modules; o import nu, daqui de src/jobs, não o acha.
  const nodemailer = createRequire(new URL('../webhook/package.json', import.meta.url))('nodemailer');
  const transporte = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
  });

  return async function enviar({ destinatarios, assunto, corpo }) {
    await transporte.sendMail({
      from: cfg.remetente,
      to: destinatarios.join(', '),
      subject: umaLinha(assunto),
      text: corpoEmTexto(corpo),
    });
  };
}

// Assunto é UMA linha, e isso é defesa, não formatação. CR e LF dentro de um
// cabeçalho de e-mail são separador de cabeçalho: um assunto com `\r\n` vira
// cabeçalho novo (a família de CVEs de CRLF injection do próprio nodemailer,
// GHSA-268h-hp4c-crq3 entre outras).
//
// Hoje o assunto vem de `app.ancora_assunto`, montado de semana, seq e hash —
// nada que um usuário escreva. A limpeza existe porque essa procedência pode
// mudar sem ninguém lembrar deste arquivo, e porque custa uma linha.
export function umaLinha(texto) {
  return String(texto).replace(/[\r\n]+/g, ' ').trim();
}

// Texto puro, não HTML. Quem recebe precisa conseguir ler isto em qualquer
// cliente, em qualquer aparelho, daqui a cinco anos — e o conteúdo que importa
// já está no assunto.
export function corpoEmTexto(corpo) {
  const linhas = [
    `Semana ${corpo.semana} (${corpo.periodo})`,
    '',
    'ANCORA DO AUDIT LOG',
    corpo.audit_hash
      ? `  ultima linha: ${corpo.audit_seq}\n  hash:         ${corpo.audit_hash}`
      : '  o audit log estava vazio nesta semana',
    '',
    'HORAS EXTRAS DA SEMANA',
  ];

  const horas = Array.isArray(corpo.horas_extras) ? corpo.horas_extras : [];
  if (horas.length === 0) {
    linhas.push('  nenhuma hora extra lancada');
  } else {
    for (const h of horas) {
      linhas.push(
        `  ${h.colaborador}: ${h.minutos} min · R$ ${h.valor} ` +
          `(${h.pendentes} pendente(s), ${h.pagas} paga(s))`,
      );
    }
  }

  linhas.push(
    '',
    '--',
    'Nao e preciso fazer nada com este e-mail — so nao apagar.',
    'Ele e a copia fora do sistema que permite conferir, depois, que o',
    'registro nao foi reescrito.',
  );
  return linhas.join('\n');
}
