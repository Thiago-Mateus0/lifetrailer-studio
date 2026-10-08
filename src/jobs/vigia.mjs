// O vigia dos jobs agendados: quem grita quando um job para de rodar.
//
// ADR 0029 §4 — "Ausência de execução é o alerta: se o gerador da Escala não
// registrar execução em 36h, alerta." E, na mesma seção: **o alerta por
// ausência não pode morar no próprio `pg_cron`, senão morre junto com ele.**
// Por isso este código está aqui, no processo Node que já roda contínuo pro
// webhook, e não numa quinta entrada de cron.
//
// A decisão de QUEM está atrasado é do banco (`app.job_atrasado`, que lê a
// tolerância de cada job) e o alerta com dedup por dia é `app.job_alertar_
// ausencia`. Aqui só existe o relógio: uma chamada a cada intervalo. Regra
// inviolável 5 — a decisão multi-passo fica no PL/pgSQL, não em três chamadas
// daqui.

// Intervalo padrão de 15 min. Não precisa ser fino: a menor tolerância que faz
// sentido no ADR 0029 é de horas, e conferir de minuto em minuto só gastaria
// conexão pra reler a mesma resposta.
export const INTERVALO_PADRAO_MS = 900_000;

export function criarVigia({
  pool,
  intervaloMs = INTERVALO_PADRAO_MS,
  aoErro = console.error,
  agora = () => Date.now(),
}) {
  // Zero e não `agora()`: um job morto no fim de semana tem de alertar assim
  // que o processo sobe, não 15 min depois.
  let proxima = 0;

  return async function vigiar() {
    if (agora() < proxima) return null;
    // Empurra ANTES de chamar: se o banco estiver fora, a próxima tentativa é
    // no ritmo normal e não a cada volta do laço do webhook (5s).
    proxima = agora() + intervaloMs;

    try {
      const { rows } = await pool.query('select app.job_alertar_ausencia() as alertados');
      return Number(rows[0]?.alertados ?? 0);
    } catch (erro) {
      aoErro('vigia: nao foi possivel conferir os jobs atrasados', erro.message ?? String(erro));
      return null;
    }
  };
}
