# ADR 0067 — Quem vê o lembrete conclui; Atrasado é a data vencida; o alerta ao Admin sai uma vez

**Status:** Proposto
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** — (espera o Thiago na PR)
**Toca:** [ADR 0066](0066-criar-lembrete-e-categoria.md) (decorrência 1),
[ADR 0029](0029-cadencia-dos-jobs-agendados.md) §2 e §4,
[`lembretes.md`](../spec/lembretes.md)

## Contexto

O spec fixa a máquina do lembrete (`Ativo → Atrasado → Concluído`) e diz
"Atrasado há +3 dias alerta o Admin". Não diz quem conclui, em que dia o
lembrete vira Atrasado, como contar os "+3 dias" nem quantas vezes o alerta
sai. O ADR 0066 deixou isso como decorrência 1.

## Decisão

1. **Quem vê conclui.** O Administrador conclui qualquer lembrete aberto, até o
   que a equipe ainda não vê. O Atendente conclui o que já aparece para ele, ou
   seja, a partir de `data_alvo − antecedência` (ADR 0066 §3). O Desenvolvedor
   não conclui, porque a lista é da operação (ADR 0043 §1). Concluir grava
   quem e quando, e Concluído não volta.
2. **Atrasado é a data já ter passado em Maceió.** O próprio dia do lembrete
   ainda é Ativo. Quem marca é um job diário às 05:10, com tolerância de 36 h,
   pelo critério do ADR 0029: um dia de atraso na marca não custa nada, e
   rodando antes do Checklist das 6h o turno já abre com o Atrasado em
   destaque. Ativo pode ir direto a Concluído.
3. **O alerta sai com 3 dias de atraso ou mais, e uma vez por lembrete.** Os
   dias contam da data do lembrete, não de quando o job marcou: job parado não
   adia o alerta. "Uma vez" é mais estrito que o "um por dia" do ADR 0029 §2,
   porque o lembrete continua em destaque na aba e o alerta diário sobre ele é
   o que o spec chama de treinar a equipe a ignorar o canal. A notificação vai
   para cada Administrador ativo, na categoria `lembrete`, sem pedir
   confirmação.

## Alternativas rejeitadas

**Só o Admin conclui.** O lembrete aparece para a equipe justamente para ela
agir ("Pagar a gráfica", "Ligar para a Ana"). Se só o Admin pudesse fechar, o
Atendente faria a tarefa e o lembrete continuaria aberto até a Jana passar pela
aba.

**Atrasado no próprio dia.** A data é o prazo. Quem cria "pagar dia 26" conta
com o dia 26 inteiro.

**Alerta todo dia enquanto estiver Atrasado.** É o padrão do ADR 0029 §2 para
divergência que persiste. Aqui o item já fica visível na aba, com a faixa
"Venceu dd/mm", então o alerta repetido só gasta crédito de notificação.

## Consequências

- A migration 0070 cria `app.lembrete_concluir`,
  `app.lembrete_marcar_atrasados` e a entrada `lembrete_atrasar` em
  `job_agendado`. `node src/db/agendar-jobs.mjs` agenda o job no `pg_cron`.
- O cartão de lembrete ganha "Concluir" para quem pode concluir.
- O job também marca o lembrete de origem Sistema (decorrência 2 do ADR 0066)
  quando ele existir, sem mudança.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0066.1 | Concluir o lembrete, e o job que marca Atrasado e alerta o Admin | seções 1 a 3 |
