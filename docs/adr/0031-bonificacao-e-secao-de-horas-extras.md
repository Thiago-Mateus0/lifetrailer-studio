# ADR 0031 — Bonificação é seção dentro de Horas Extras, não um nono ativo

- **Status:** Aceito — fecha a pendência 1.
- **Data:** 2026-08-27
- **Fase:** 4 — decisão de forma, aplicação prevista para 2027
- **Decidido por:** Thiago

## Contexto

A bonificação da equipe não tem dono em nenhum dos 8 ativos. A `pendencias.md`
registrava a pergunta — *vira ativo 9 ou seção dentro de Horas Extras* — e
concluía: *"muda quais telas existem, mas não precisa saber qual agora"*, com
aplicação confirmada só para 2027.

"Não precisa saber agora" estava certo enquanto a Fase 4 não tinha começado.
Agora tem, e o inventário de telas passa a ser decisão de arquitetura de
navegação: a Sidebar dos mockups lista ativos, e um nono item ali não é um
detalhe que se acrescenta depois sem mexer no resto.

Decidir a **forma** agora não antecipa nada sobre a **regra** — quanto, para
quem, com que critério. Isso continua sendo do Wyll, em 2027, e nada aqui
supõe uma resposta.

## Decisão

**Bonificação é uma seção dentro do Ativo 5 — Horas Extras.** Não é ativo novo,
não entra na Sidebar como item próprio.

Os três motivos são estruturais, não de conveniência:

1. **Mesmo destinatário e mesma chave.** Bonificação é valor devido a um
   Colaborador numa competência. É a definição do que Horas Extras já faz.
2. **Mesma trava.** O ADR-0002 tranca competência no dia 5 e correção vira
   ajuste. Bonificação lançada depois do dia 5 precisa exatamente da mesma
   máquina — e um ativo separado teria que reimplementá-la, ou pior,
   implementá-la um pouco diferente.
3. **Mesma conferência.** O ADR-0011 pôs o export semanal de horas extras à
   Helena como parte da entrega, e o ADR-0024 pendurou a âncora do audit log
   nele. Bonificação fora desse relatório é dinheiro saindo por um caminho que
   a conferência não enxerga — e a conferência existe justamente por causa do
   item 2 do ADR-0010.

O ativo separado só se justificaria se a bonificação tivesse ciclo de vida
próprio — aprovação em várias etapas, meta acumulada ao longo do tempo,
destinatário que não é colaborador. Nada disso está sobre a mesa, e se um dia
estiver, é ADR novo revogando este, que é o custo certo de estar errado aqui.

## Alternativas rejeitadas

**Ativo 9, com tela e menu próprios.** Duplica competência, trava, audit log e
relatório — quatro peças que já existem e que o ADR-0002 exige que se comportem
igual. Ganha destaque visual e paga com quatro cópias de regra financeira, que
é a coisa que este projeto mais evita.

**Deixar em aberto até 2027, como estava.** Defensável até a Fase 4 começar. A
partir dela, o inventário de telas é decisão de agora, e a pendência voltaria a
ser feita sob pressão de cronograma — que é o pior momento pra decidir forma.

**Bonificação como tipo de lançamento dentro de `HoraExtra`**, sem seção
própria. Mais econômico ainda, e mistura duas coisas que a Helena precisa
distinguir num relatório: hora trabalhada a mais é obrigação, bonificação é
decisão. Compartilhar o ativo, sim; compartilhar a linha, não.

## Consequências

- Fecha a pendência 1.
- **A Sidebar continua com 8 ativos.** O mockup da Fase 3 não muda.
- **`docs/spec/horas-extras.md` reserva a seção**, sem regra dentro. Uma linha
  dizendo que a bonificação mora ali quando existir — pra que em 2027 ninguém
  refaça esta discussão do zero.
- **Nenhuma tabela é criada agora.** A entidade nasce quando a regra existir;
  o que está decidido é onde ela nasce.
- **A regra continua com o Wyll**, prevista para 2027. Este ADR não a antecipa
  e não a limita: qualquer critério de bonificação cabe na forma escolhida.
