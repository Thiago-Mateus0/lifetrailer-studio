// O Laço 2 da reconciliação: quem pergunta à Altegio e entrega a resposta ao banco.
//
// ADR 0003 decidiu o laço; o ADR 0040 decidiu a forma exata da guarda, depois
// de ver a API responder. A guarda tem quatro degraus e está partida em dois
// lugares de propósito:
//
//   aqui        degrau 0  janela válida ANTES de virar URL
//               degrau 1  transporte / HTTP ≠ 200
//               degrau 2  success e o tipo de `data`
//               degrau 3  meta.total_count vs. o que veio
//   no banco    degrau 4  vazio total com agendamentos locais na janela
//
// O degrau 4 desce pro banco porque precisa contar os locais, e contar-decidir-
// escrever daqui seriam três chamadas separadas — regra inviolável 5. Aqui só
// existe o relógio, a rede e a validação do que a rede devolveu.
//
// ⚠ Este arquivo NÃO decide cancelar nada. Ele entrega uma lista de ids
// presentes; quem cancela é app.reconciliacao_laco2, numa transação.

// As DUAS janelas do ADR 0003, que pede frequência decrescente:
//
//   "Janela hoje + 7 dias, com frequência decrescente: dias 0–1 a cada 15 min,
//    dias 2–7 uma vez pela manhã."
//
// Até aqui o laço pedia os 7 dias a cada 15 min. Não era erro de efeito — o
// resultado é o mesmo —, mas são chamadas a mais à Altegio e, o que pesa mais,
// janela maior por ciclo é mais superfície para um cancelamento errado: tudo o
// que entra no conjunto local e não vem na resposta é ausência, e ausência
// cancela (ADR 0045).
export const JANELA_DIAS = 7;
export const JANELA_CURTA_DIAS = 1;

// ⚠ A HORA DA VARREDURA LONGA NÃO ESTÁ EM ADR NENHUM. O ADR 0003 diz "uma vez
// pela manhã" e para aí; o ADR 0029, que fixa horário de job, não cobre esta
// reconciliação. 06:30 segue o critério dos outros: depois do gerador da Escala
// (05:30) e do cron do Checklist (06:00), antes do turno da manhã começar
// (08:00) — assim qualquer cancelamento aparece antes de a equipe chegar.
// **Número a confirmar com o Thiago**, como foi a tolerância de 1h do vigia.
export const HORA_VARREDURA = 6;
export const MINUTO_VARREDURA = 30;

// O mesmo do vigia e do carteiro. ADR 0003 pede 15 min nos dias 0–1.
export const INTERVALO_PADRAO_MS = 900_000;

// Página grande de propósito: o volume real é de dezenas de ensaios por semana,
// então uma página costuma bastar. O degrau 3 existe pro dia em que não bastar.
export const POR_PAGINA = 100;

// Teto de páginas. Sem ele, um `total_count` errado da API vira laço infinito.
export const MAX_PAGINAS = 20;

// O nome em `job_agendado` (migration 0040). É por ele que o vigia enxerga este
// laço: `app.job_atrasado()` lê a última execução `ok` deste nome.
export const NOME_DO_JOB = 'reconciliacao';

const BASE = 'https://api.alteg.io/api/v1';

// ⚠ ADR 0040 §4: a Altegio aceita start_date malformado EM SILÊNCIO — responde
// 200, success:true, e devolve uma janela que não é a pedida. Uma resposta
// assim passa pelos degraus 1, 2 e 3 sem tropeçar. Por isso a validação é
// nossa, e lança: data malformada é defeito nosso, e defeito nosso não vira
// chamada de rede.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validarJanela(inicio, fim) {
  if (!ISO.test(inicio) || !ISO.test(fim)) {
    throw new Error(`janela inválida: ${inicio}..${fim} — esperado YYYY-MM-DD`);
  }
  if (inicio > fim) {
    throw new Error(`janela invertida: ${inicio}..${fim}`);
  }
  return { inicio, fim };
}

// Regra global 2: toda lógica de data usa America/Maceio. `en-CA` porque é o
// locale que formata como YYYY-MM-DD sem montar a string na mão.
const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Maceio',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function janelaDeHoje(agora = new Date(), dias = JANELA_DIAS) {
  const inicio = FORMATO.format(agora);
  const fim = FORMATO.format(new Date(agora.getTime() + dias * 86_400_000));
  return validarJanela(inicio, fim);
}

// Hora local de Maceió em minutos desde a meia-noite. Mesma razão do FORMATO
// acima: a decisão é de negócio, e regra global 2 não admite UTC aqui.
const RELOGIO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Maceio', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function minutosDoDiaEm(agora = new Date()) {
  const [h, m] = RELOGIO.format(agora).split(':');
  return Number(h) * 60 + Number(m);
}

// Já passou da hora da varredura longa, no dia local?
export const passouDaVarredura = (agora = new Date()) =>
  minutosDoDiaEm(agora) >= HORA_VARREDURA * 60 + MINUTO_VARREDURA;

export function lerConfigAltegio(env = process.env) {
  const faltando = ['LT_ALTEGIO_PARTNER_TOKEN', 'LT_ALTEGIO_USER_TOKEN', 'LT_ALTEGIO_COMPANY_ID']
    .filter((n) => !(env[n] ?? '').trim());

  // Falha no boot é de propósito, como em webhook/config.mjs: subir sem
  // credencial de leitura é subir com a reconciliação morta em silêncio — e o
  // ADR 0003 inteiro existe porque silêncio é o modo de falha caro aqui.
  if (faltando.length > 0) {
    throw new Error(
      `credencial de leitura da Altegio ausente: ${faltando.join(', ')}. ` +
        'Ver ADR 0040 §5 — LT_WEBHOOK_TOKEN não serve, é o segredo do path de entrada.',
    );
  }

  const companyId = Number(env.LT_ALTEGIO_COMPANY_ID);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error(`LT_ALTEGIO_COMPANY_ID precisa ser inteiro positivo, veio ${JSON.stringify(env.LT_ALTEGIO_COMPANY_ID)}`);
  }

  return {
    partnerToken: env.LT_ALTEGIO_PARTNER_TOKEN.trim(),
    userToken: env.LT_ALTEGIO_USER_TOKEN.trim(),
    companyId,
  };
}

// ⚠ ADR 0040 §2: `meta` vem OBJETO quando carrega conteúdo e ARRAY VAZIO quando
// não. Tipar como objeto quebraria na primeira resposta vazia — por isso a
// leitura é defensiva e devolve null quando não há número.
export function totalDeclarado(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null;
  return Number.isInteger(meta.total_count) ? meta.total_count : null;
}

export function criarClienteAltegio({ config, buscar = fetch }) {
  const cabecalhos = {
    Accept: 'application/vnd.api.v2+json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.partnerToken}, User ${config.userToken}`,
  };

  // Devolve os registros da janela inteira, ou lança. Nunca devolve lista
  // parcial: uma lista parcial daqui vira cancelamento no banco.
  //
  // Os registros inteiros, e não só os ids, porque o Laço 1 (ADR 0041) precisa
  // do payload cru pra montar o evento — e é o MESMO conjunto que o Laço 2 usa
  // pra decidir ausência. Duas chamadas à API dariam duas fotos diferentes.
  return async function recordsDaJanela(inicio, fim) {
    validarJanela(inicio, fim);

    // Map e não array: id repetido entre páginas contaria pro total e faria
    // uma resposta truncada parecer completa.
    const porId = new Map();
    let total = null;

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const url =
        `${BASE}/records/${config.companyId}` +
        `?start_date=${inicio}&end_date=${fim}&page=${pagina}&count=${POR_PAGINA}`;

      const r = await buscar(url, { headers: cabecalhos });

      // ------------------------------------------------- degrau 1: transporte
      if (r.status !== 200) {
        throw new Error(`altegio: HTTP ${r.status} em ${inicio}..${fim} (página ${pagina})`);
      }

      const corpo = await r.json();

      // --------------------------------------------------- degrau 2: envelope
      // Erro nunca chega como lista vazia: success:false vem com data:null.
      // É essa assimetria que separa "não tem nada" de "não deu pra perguntar".
      if (corpo?.success !== true) {
        const msg = totalDeclarado(corpo?.meta) === null ? (corpo?.meta?.message ?? '(sem mensagem)') : '';
        throw new Error(`altegio: success=${JSON.stringify(corpo?.success)} — ${msg}`);
      }
      if (!Array.isArray(corpo.data)) {
        throw new Error(`altegio: data não é array (veio ${typeof corpo.data})`);
      }

      if (total === null) total = totalDeclarado(corpo.meta);

      for (const registro of corpo.data) {
        // Number(null) é 0 e Number.isInteger(0) é true: um `id` ausente
        // entraria como record 0 e todo o resto da janela viraria ausência.
        // Por isso o teste é do tipo, não do valor convertido.
        const id = registro?.id;
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
          throw new Error(`altegio: registro sem id inteiro positivo em ${inicio}..${fim}`);
        }
        if (!porId.has(id)) porId.set(id, registro);
      }

      // ⚠ Sem `total_count` não há como conferir completude, e a resposta com
      // registros fica indistinguível de uma truncada. Assumir "completa" aqui
      // desligava o degrau 3 exatamente na condição em que ele não pode se
      // verificar — e o que não veio, no laço 2, é cancelamento (issue #83).
      //
      // Falhar custa um ciclo: o próximo tenta em 15 min e o laço 2 é
      // idempotente. Assumir custa Comanda cancelada por engano.
      if (corpo.data.length > 0 && total === null) {
        throw new Error(
          `altegio: resposta sem meta.total_count em ${inicio}..${fim} — não dá para conferir completude`,
        );
      }

      // Página vazia encerra: ou acabou, ou o degrau 3 abaixo vai reprovar.
      if (corpo.data.length === 0 || porId.size >= total) break;
    }

    // ------------------------------------------------- degrau 3: completude
    // `meta.total_count` é a janela inteira; `data` é uma página. Sem esta
    // conferência, todo agendamento além da última página lida é ausência — e
    // ausência, no laço 2, é cancelamento.
    if (total !== null && porId.size !== total) {
      throw new Error(
        `altegio: resposta parcial em ${inicio}..${fim} — total_count=${total}, lidos=${porId.size}`,
      );
    }

    return [...porId.values()];
  };
}

export function criarReconciliador({
  pool,
  recordsDaJanela,
  intervaloMs = INTERVALO_PADRAO_MS,
  aoErro = console.error,
  agora = () => Date.now(),
}) {
  // Zero e não `agora()`: se o processo subiu depois de uma parada, a primeira
  // reconciliação é agora, não daqui a 15 min.
  let proxima = 0;

  // O dia local em que a varredura de 7 dias já rodou com sucesso. Em memória de
  // propósito: reiniciar o processo custa uma chamada a mais à Altegio, e o
  // laço 2 é idempotente — muito mais barato que uma tabela de estado para
  // responder "já varri hoje?".
  let diaDaUltimaVarredura = null;

  // Cada ciclo que RODOU vira uma linha em execucao_job — `ok` ou `falhou`. É o
  // que põe este laço sob o vigia (ADR 0029 §4): sem a linha, a reconciliação
  // parada e a reconciliação que nunca existiu são indistinguíveis.
  //
  // ⚠ O registro nunca derruba o ciclo. Se o banco estiver fora, o laço já
  // falhou por outro motivo e o log diz; se só o registro falhar, perder uma
  // linha de execução é muito menos grave que perder o resultado dos laços.
  async function registrar(inicioCiclo, resultado, detalhe, erroTexto) {
    try {
      await pool.query(
        'select app.job_registrar_execucao($1, $2::timestamptz, $3, $4::jsonb, $5)',
        [NOME_DO_JOB, inicioCiclo, resultado, detalhe === null ? null : JSON.stringify(detalhe), erroTexto],
      );
    } catch (erro) {
      aoErro('reconciliador: nao consegui registrar a execucao —', erro.message ?? String(erro));
    }
  }

  return async function reconciliar() {
    if (agora() < proxima) return null;
    // Empurra ANTES de chamar, como o vigia: a Altegio fora do ar não pode
    // virar uma tentativa por volta do laço do webhook.
    proxima = agora() + intervaloMs;
    const inicioCiclo = new Date(agora()).toISOString();

    try {
      const instante = new Date(agora());
      const diaLocal = FORMATO.format(instante);

      // ADR 0003: dias 0–1 a cada 15 min; dias 2–7 uma vez pela manhã. A longa
      // roda no primeiro ciclo depois da hora, e só se ainda não rodou hoje.
      const longa = passouDaVarredura(instante) && diaDaUltimaVarredura !== diaLocal;
      const { inicio, fim } = janelaDeHoje(instante, longa ? JANELA_DIAS : JANELA_CURTA_DIAS);

      const registros = await recordsDaJanela(inicio, fim);

      // LAÇO 1 primeiro (ADR 0003). Ele só ENFILEIRA; quem aplica é o worker
      // do webhook, depois. Isso não atrapalha o laço 2 logo abaixo: um
      // registro que o laço 1 acabou de enfileirar e ainda não virou
      // Agendamento não está no conjunto local, então não há como o laço 2
      // lê-lo como ausente.
      const laco1 = await pool.query('select app.reconciliacao_laco1($1::jsonb) as r', [
        JSON.stringify(registros),
      ]);

      // LAÇO 2. A janela vai como DATA e a conversão de fuso acontece dentro
      // do banco (migration 0037). Não há cast aqui de propósito: converter no
      // cliente foi o bug de 09/09/2026 — a sessão do `pg` roda em UTC, então
      // `'2026-09-09'::date::timestamptz` virava 08/09 21:00 em Maceió e a
      // janela local abria três horas antes da pedida à API. Ensaio começando
      // entre 21h e meia-noite da véspera era lido como ausente e cancelado.
      const laco2 = await pool.query(
        'select app.reconciliacao_laco2($1::date, $2::date, $3::bigint[]) as r',
        [inicio, fim, registros.map((r) => r.id)],
      );

      // ⚠ Só aqui, e não na decisão: varredura que FALHOU não pode contar como
      // feita, senão um erro da API às 06:30 adia os dias 2–7 para o dia
      // seguinte. Falhando, o ciclo de 15 min tenta de novo.
      if (longa) diaDaUltimaVarredura = diaLocal;

      const resultado = {
        laco1: laco1.rows[0].r,
        laco2: laco2.rows[0].r,
        // Vai pro detalhe de `execucao_job`: sem isto não dá pra responder
        // "a varredura dos dias 2–7 rodou hoje?" olhando o registro.
        janela: { inicio, fim, longa },
      };
      await registrar(inicioCiclo, 'ok', resultado, null);
      return resultado;
    } catch (erro) {
      // Toda falha de guarda cai aqui e o ciclo seguinte tenta de novo. O laço
      // 2 é idempotente: pular execuções é seguro, cancelar errado não é.
      aoErro('reconciliador: nao rodou neste ciclo —', erro.message ?? String(erro));
      // ADR 0003: "Falha, vazio ou parcial → laço 2 não roda + alerta". O
      // alerta não sai aqui — sai do vigia, quando as falhas passarem da
      // tolerância. Uma falha isolada da Altegio não merece notificação; a
      // rede de segurança desligada por uma hora merece (ADR 0033).
      await registrar(inicioCiclo, 'falhou', null, erro.message ?? String(erro));
      return null;
    }
  };
}
