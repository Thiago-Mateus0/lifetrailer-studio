// Worker da fila do webhook.
//
// Faz três coisas e para: reclama eventos pendentes, chama a RPC que aplica um
// evento, e traduz o erro que voltar em `classe_erro`. Não interpreta payload —
// isso é da RPC, e é de propósito: parsing, efeito e marcação do evento têm de
// ser a MESMA transação (regra inviolável 5). Um worker que lesse o payload
// aqui e escrevesse em três chamadas deixaria estado inconsistente no meio.
//
// O worker não decide espaçamento nem desistência: ele CLASSIFICA e entrega a
// classe ao banco. O backoff do ADR 0021 §1 (1min · 5min · 15min · 1h · 6h), a
// passagem do evento esgotado para `parada` e as ações da bandeja moram em
// `app.webhook_evento_falhou` (0024) — operação multi-passo é PL/pgSQL, e a
// classe é a única coisa que só quem viu o erro do driver sabe dizer.
//
// O role é lifetrailer_job, não lifetrailer_app: aplicar evento de webhook é
// escrita com autoria nula, e a fronteira disso é o role, nunca um parâmetro
// (ADR 0020 §1, issue #15). O quiosque não tem esta porta.
import { fileURLToPath } from 'node:url';

import { inteiro } from './config.mjs';
import {
  criarBackup,
  criarDespejo,
  criarGravadorR2,
  lerConfigBackup,
  INTERVALO_PADRAO_MS as BACKUP_INTERVALO_MS,
} from '../jobs/backup.mjs';
import {
  criarCarteiro,
  criarEnvioSmtp,
  destinatariosDoEnv,
  INTERVALO_PADRAO_MS as CARTEIRO_INTERVALO_MS,
} from '../jobs/carteiro.mjs';
import {
  criarClienteAltegio,
  criarReconciliador,
  lerConfigAltegio,
  INTERVALO_PADRAO_MS as RECONCILIADOR_INTERVALO_MS,
} from '../jobs/reconciliador.mjs';
import { criarVigia, INTERVALO_PADRAO_MS } from '../jobs/vigia.mjs';

// ADR 0021 §1 — a classe decide o destino, e a decisão é sempre a mesma:
// retentar o que pode passar, parar o que vai continuar errado. Retentar
// `invalida` com backoff é um laço infinito que queima o crédito de notificação
// compartilhado, inclusive o dos alertas de dinheiro.
//
// Os códigos LT são a legenda de 0014_rpc_helpers.sql.
export const CLASSE_POR_ERRCODE = {
  // versão obsoleta: outra transação mexeu na linha; a próxima leitura já pega
  // a versão nova. É a definição de transitória.
  LT001: 'transitoria',
  // aresta inexistente / payload que o motor não reconhece — não converge.
  LT002: 'invalida',
  // guarda de negócio recusou — não converge sem alguém corrigir a causa.
  LT003: 'invalida',
  // competência trancada é literalmente o exemplo de `caducou` do ADR 0021:
  // "o mundo mudou e a operação não vale mais".
  LT004: 'caducou',
  // identidade / permissão — não converge retentando.
  LT005: 'invalida',
};

// Prefixos de SQLSTATE do próprio Postgres. Só o que é claramente permanente
// vira `invalida`; o resto cai no padrão transitório, que é o lado seguro: um
// erro desconhecido esgota o backoff e aparece na bandeja de qualquer jeito,
// enquanto classificar de menos manda pra bandeja um banco que só reiniciou.
const PREFIXO_PERMANENTE = ['22', '23'];   // dado inválido · violação de constraint

// ⚠ A exceção dentro do prefixo `23`, e por que ela importa a partir do 0024.
// `reclamar` foi desenhada para vários workers (`for update skip locked`), e
// dois eventos `create` do mesmo `data.id` NÃO se serializam: nenhum dos dois
// acha linha em `agendamento` para travar, os dois chegam ao insert, e o
// perdedor leva 23505 do índice único de `altegio_record_id`. É uma corrida
// perdida, não um payload errado — na retentativa seguinte ele encontra a linha
// e segue pelo caminho de update.
//
// Antes do 0024 classificar isso de `invalida` era inofensivo: o evento ficava
// `pendente` e voltava sozinho. Agora `invalida` vai DIRETO pra bandeja, sem
// retentar — o backoff é que dá tempo do vencedor terminar. Classificar errado
// aqui passou a custar uma ida do Admin à tela por corrida de worker.
const TRANSITORIO_APESAR_DO_PREFIXO = new Set([
  '23505',   // unique_violation — a corrida de dois `create` do mesmo data.id
  '40001',   // serialization_failure
  '40P01',   // deadlock_detected
]);

export function classificarErro(erro) {
  const codigo = erro?.code;
  if (typeof codigo !== 'string' || codigo.length === 0) return 'transitoria';
  if (Object.hasOwn(CLASSE_POR_ERRCODE, codigo)) return CLASSE_POR_ERRCODE[codigo];
  if (TRANSITORIO_APESAR_DO_PREFIXO.has(codigo)) return 'transitoria';
  if (PREFIXO_PERMANENTE.some((p) => codigo.startsWith(p))) return 'invalida';
  return 'transitoria';
}

export function criarProcessador({ pool, limite = 10, aoErro = console.error }) {
  return async function processarLote() {
    const reclamados = await pool.query(
      'select app.webhook_evento_reclamar($1) as id',
      [limite],
    );

    const contagem = { reclamados: reclamados.rows.length, processados: 0, ignorados: 0, falhas: 0 };

    for (const { id } of reclamados.rows) {
      try {
        const { rows } = await pool.query(
          'select status from app.agendamento_aplicar_evento($1)',
          [id],
        );
        // A RPC já marcou o evento — 'processado' ou 'ignorado' (evento fora de
        // ordem, 2.0.5). O worker não carimba nada em caso de sucesso.
        if (rows[0]?.status === 'ignorado') contagem.ignorados += 1;
        else contagem.processados += 1;
      } catch (erro) {
        contagem.falhas += 1;
        const classe = classificarErro(erro);
        aoErro(`webhook: evento ${id} falhou (${erro.code ?? 'sem codigo'}, ${classe})`, erro.message);
        try {
          await pool.query('select app.webhook_evento_falhou($1, $2, $3, $4)', [
            id,
            classe,
            erro.code ?? null,
            erro.message ?? String(erro),
          ]);
        } catch (erroAoMarcar) {
          // Banco fora no meio do lote: o evento continua pendente e o lease
          // vence sozinho. Nada some — é a garantia da fila (ADR 0021).
          aoErro('webhook: nao foi possivel registrar a falha do evento', erroAoMarcar);
        }
      }
    }

    return contagem;
  };
}

// ------------------------------------------------------------------- o role
// O role do worker é fronteira de privilégio, não configuração de ambiente
// (ADR 0020 §1, issue #15) — por isso ele não sai de `PGUSER`.
//
// `PGUSER` no processo é do RECEPTOR, que roda como `lifetrailer_app` na mesma
// máquina, no mesmo unit e com o mesmo `.env`. Deixá-lo mandar aqui rebaixa o
// worker em silêncio: todo `webhook_evento_reclamar` volta 42501, e esse erro
// estoura na chamada que reclama a fila — FORA do try por evento —, então não
// passa por classificarErro, não vira `classe_erro` e não chega à bandeja. Vira
// uma linha de console a cada 5s, para sempre, com a fila parada e ninguém
// avisado (issue #31).
export const ROLE_DO_WORKER = 'lifetrailer_job';

// A saída para quem precisa mesmo trocar o role (rodar o worker como dono num
// banco de teste, por exemplo) é uma variável PRÓPRIA, que não colide com a do
// receptor. Ausente, o role é o do worker — nunca o do ambiente.
export function envDoPool(env) {
  return {
    ...env,
    PGUSER: env.LT_WEBHOOK_PGUSER || ROLE_DO_WORKER,
    PGPASSWORD: env.LT_WEBHOOK_PGPASSWORD || env.PGPASSWORD,
  };
}

// ------------------------------------------------------------ reconciliação
// ADR 0003 / 0040 / 0041. ⚠ Os dois laços existiam, testados, e NINGUÉM os
// ligava: `criarReconciliador` não era chamado em lugar nenhum do processo. A
// rede de segurança contra webhook perdido estava escrita e desligada — o
// modo de falha exato que o ADR 0003 existe pra evitar, e sem nada gritando.
//
// Sem credencial da Altegio o processo NÃO cai, pela mesma razão do carteiro:
// aplicar a fila do webhook é o caminho principal, e parar ele por falta da
// rede de segurança troca um problema por outro maior. Mas também não pode
// ficar calado depois do boot — um aviso só na subida vira silêncio no dia
// seguinte. Por isso a função de reserva grita a cada intervalo, como o
// carteiro sem destinatário.
export function montarReconciliador({
  env,
  pool,
  buscar,
  aoErro = console.error,
  agora = () => Date.now(),
}) {
  const intervaloMs = inteiro(env.LT_RECONCILIACAO_INTERVALO_MS, RECONCILIADOR_INTERVALO_MS, 'LT_RECONCILIACAO_INTERVALO_MS');

  let config;
  try {
    config = lerConfigAltegio(env);
  } catch (erro) {
    let proxima = 0;
    return async function semCredencial() {
      if (agora() < proxima) return null;
      proxima = agora() + intervaloMs;
      aoErro('reconciliador: os dois lacos do ADR 0003 NAO estao rodando —', erro.message);
      return null;
    };
  }

  const recordsDaJanela = criarClienteAltegio(buscar ? { config, buscar } : { config });
  return criarReconciliador({ pool, recordsDaJanela, intervaloMs, aoErro, agora });
}

// ------------------------------------------------------------------- backup
// ADR 0028 §2. Mesmo desenho do reconciliador: sem credencial o processo sobe e
// grita a cada hora, porque parar o webhook por falta do backup é trocar um
// problema por outro maior. O vigia também pega (o job está registrado ativo).
export function montarBackup({ env, pool, aoErro = console.error, agora = () => Date.now() }) {
  let config;
  try {
    config = lerConfigBackup(env);
  } catch (erro) {
    let proxima = 0;
    return async function semCredencial() {
      if (agora() < proxima) return null;
      proxima = agora() + 3_600_000;
      aoErro('backup: o pg_dump para o R2 NAO esta rodando (ADR 0028 §2) —', erro.message);
      return null;
    };
  }

  return criarBackup({
    pool,
    despejar: criarDespejo(config),
    gravar: criarGravadorR2(config),
    intervaloMs: inteiro(env.LT_BACKUP_INTERVALO_MS, BACKUP_INTERVALO_MS, 'LT_BACKUP_INTERVALO_MS'),
    aoErro,
    agora,
  });
}

// ----------------------------------------------------------------- processo
// LT_WEBHOOK_INTERVALO_MS entre passadas. Não é fila de alta vazão: são dezenas
// de eventos por dia, e o Laço 1 da reconciliação é a rede de segurança.
export async function main(env = process.env) {
  // import dinamico: db.mjs puxa `pg`, e os testes deste arquivo rodam sem
  // banco e sem dependencia instalada — mesmo desenho de servidor.mjs.
  const { criarPool } = await import('./db.mjs');
  const pool = criarPool(envDoPool(env));
  const intervalo = inteiro(env.LT_WEBHOOK_INTERVALO_MS, 5_000, 'LT_WEBHOOK_INTERVALO_MS');
  const limite = inteiro(env.LT_WEBHOOK_LOTE, 10, 'LT_WEBHOOK_LOTE');
  const processarLote = criarProcessador({ pool, limite });

  // ADR 0029 §4: o alerta por ausência de job pega carona neste processo
  // justamente porque ele não é o pg_cron — um alerta que mora dentro do
  // agendador morre junto com o agendador. O vigia tem relógio próprio e só
  // consulta o banco a cada LT_JOB_VIGIA_MS.
  const vigiar = criarVigia({
    pool,
    intervaloMs: inteiro(env.LT_JOB_VIGIA_MS, INTERVALO_PADRAO_MS, 'LT_JOB_VIGIA_MS'),
  });

  // ADR 0038: a ancora sai daqui pela mesma razao que o vigia mora aqui — este
  // e o processo que ja roda continuo e nao e o pg_cron. O job SQL grava a
  // linha; o carteiro poe na rua.
  //
  // Se o SMTP nao estiver configurado o processo NAO deixa de subir: o webhook
  // e a fila continuam funcionando, e a falta da ancora vira um erro repetido
  // no log em vez de derrubar a operacao inteira. Nao publicar a ancora e
  // grave; parar de receber agendamento e pior.
  let entregarAncora = async () => null;
  try {
    const enviar = await criarEnvioSmtp(env);
    entregarAncora = criarCarteiro({
      pool,
      enviar,
      destinatarios: destinatariosDoEnv(env),
      intervaloMs: inteiro(env.LT_ANCORA_INTERVALO_MS, CARTEIRO_INTERVALO_MS, 'LT_ANCORA_INTERVALO_MS'),
    });
  } catch (erro) {
    console.error(
      'carteiro: SMTP nao configurado — a ancora do audit log NAO vai sair (ADR 0038):',
      erro.message,
    );
  }

  // O pool é o do worker (lifetrailer_job), que é quem tem execute nas duas
  // funções dos laços (0036, 0037) — não o do app.
  const reconciliar = montarReconciliador({ env, pool });
  const fazerBackup = montarBackup({ env, pool });

  let rodando = true;
  for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.on(sinal, () => {
      rodando = false;
    });
  }

  console.log(`webhook: processador ativo (lote ${limite}, intervalo ${intervalo}ms)`);
  while (rodando) {
    try {
      const c = await processarLote();
      if (c.reclamados > 0) {
        console.log(
          `webhook: ${c.processados} processado(s), ${c.ignorados} ignorado(s), ${c.falhas} falha(s)`,
        );
      }
    } catch (erro) {
      // Falha ao reclamar: banco fora. Espera o próximo ciclo.
      console.error('webhook: falha ao reclamar a fila', erro.message);
    }

    const alertados = await vigiar();
    if (alertados) console.log(`vigia: ${alertados} job(s) atrasado(s) alertado(s)`);

    const entregues = await entregarAncora();
    if (entregues) console.log(`carteiro: ${entregues} ancora(s) publicada(s)`);

    const reconciliado = await reconciliar();
    if (reconciliado) {
      console.log(
        `reconciliador: laco 1 ${JSON.stringify(reconciliado.laco1)} · laco 2 ${JSON.stringify(reconciliado.laco2)}`,
      );
    }

    const copia = await fazerBackup();
    if (copia?.resultado === 'ok') console.log(`backup: ${copia.bytes} bytes em ${copia.gravadas.join(', ')}`);

    await new Promise((ok) => setTimeout(ok, intervalo));
  }

  await pool.end();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
