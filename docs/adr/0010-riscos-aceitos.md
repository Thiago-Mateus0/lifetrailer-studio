# ADR 0010 — Riscos aceitos e comunicados aos sócios

- **Status:** Aceito — item 1 deixou de bloquear a Fase 3 em 2026-08-12
  (ver nota no fim da seção Decisão). Demais itens seguem vigentes.
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco G
- **Decidido por:** Thiago; item 1 pendente do Wyll

## Contexto

A diretriz de segurança do Wyll manda desenhar assumindo um futuro colaborador mal-intencionado. Alguns pontos do desenho não atendem a essa diretriz e a decisão é registrá-los como risco aceito, não como lacuna.

O arquivo de `staff_id` revelou que **conta compartilhada é o hábito instalado da operação**: "Recrutas" são três pessoas numa conta, e Wyll/Helena partilham outra. O desenho de PIN por perfil não preenche um vazio — contraria uma prática.

## Decisão

**1. PIN em dispositivo compartilhado.** A atribuição é coerente, não inforjável. O ADR 0001 removeu a *razão prática* para compartilhar PIN, mas nada impede o compartilhamento voluntário. Tornar a autoria probatória exige hardware (tag NFC por pessoa, viável em Android).
→ **Pendente de decisão do Wyll**, como autor da diretriz: atribuição probatória ou informativa? Bloqueia a Fase 3.

> **Nota — 2026-08-12:** O fluxo em si foi definido por Thiago — tela com os 3
> perfis, PIN uma vez no início do turno, sessão até a virada (ver ADR 0011).
> A escolha entre probatória e informativa segue sem decisão, mas Thiago
> registrou que **não é problema da equipe atual** e que não há gatilho para
> decidir agora. Isso é exatamente o padrão dos itens 2-4 abaixo: risco aceito
> e comunicado, revisado quando um gatilho concreto aparecer (equipe crescer,
> desconfiança real) — não uma incógnita bloqueando o design. **Deixa de
> bloquear a Fase 3.** Ver `docs/pendencias.md`.

**2. Desenvolvedor com acesso ao banco.** Ações do Dev direto no banco não passam pelo audit log da aplicação, e Thiago é Dev e Atendente ao mesmo tempo. Mitigação organizacional recomendada: export periódico de horas extras chegando à Helena por canal que o Dev não controla, conferível contra os horários da própria Altegio.

**3. Devolução em Achados sem verificação.** Registra apenas o nome de quem retirou, digitado pelo atendente. Correção disponível: exigir Admin na devolução de itens de valor.

**4. Um tablet para cinco estúdios.** Confirmado. Consequência: com dois ensaios simultâneos o aparelho viaja e a troca de perfil é frequente — a lista de assunção do ADR 0001 é usada com regularidade, não em exceção. A Fase 3 deve otimizar o caminho de troca de perfil.

## Alternativas rejeitadas

**Tratar como pendências abertas.** Rejeitado: pendência sugere que fecha com trabalho. Estas fecham com decisão de negócio ou compra de hardware — precisam estar visíveis aos sócios como escolha, não escondidas como dívida técnica.

## Consequências

- Log append-only não vale nada quando quem faz deploy decide o que entra no log. Essa é a formulação honesta do item 2, e ela precisa chegar aos sócios em português, não em jargão.
- O item 1 bloqueava a Fase 3 até 2026-08-12; deixou de bloquear pela nota acima. Nenhum item deste ADR trava a Fase 3 hoje.
