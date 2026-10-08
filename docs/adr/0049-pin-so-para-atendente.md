# ADR 0049 — PIN só para Atendente; Administrador e Desenvolvedor entram por senha

**Status:** aceito
**Data:** 2026-09-14
**Fase:** 6
**Decidido por:** Thiago (issue #80)
**Emenda:** [ADR 0047](0047-login-do-administrador.md) — ele deu senha só ao
Administrador e deixou, de propósito, o PIN aberto a todos até a senha existir (§5).
**Toca:** [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) §4,
[ADR 0048](0048-identidade-do-dispositivo.md).

## Contexto

O ADR 0047 criou o login por senha do Administrador e não fechou o PIN para ele,
porque sem senha cadastrada a Helena ficaria sem entrada. Ficaram duas perguntas na
#80: **onde a Helena administra**, e **como entra o Desenvolvedor** — `admin_autenticar`
só aceitava `administrador`, então fechar o PIN a todo não-atendente trancava o
Desenvolvedor fora.

## Decisão

1. **A Helena administra só pelo computador dela.** O tablet é do Atendente: a
   Entrada lista só atendentes, e `app.sessao_abrir` confere PIN só de
   `nivel_acesso = 'atendente'`. PIN certo de Administrador ou Desenvolvedor dá a
   **mesma** resposta de PIN errado, e a tentativa é gravada.
2. **O Desenvolvedor entra por login e senha, pelo mesmo caminho do Administrador.**
   `app.admin_autenticar` aceita os dois perfis; o token do cookie carrega o perfil
   de verdade. O que cada um pode fazer continua decidido por quem confere o perfil
   (`app.exigir_admin` recusa o Desenvolvedor) — entrar por senha não dá poder de Admin.
3. **Definir senha continua só do Administrador**, inclusive a do Desenvolvedor.
4. **A regra está no banco e no Node.** `/sessao` recusa claim de quem não é
   atendente mesmo se a função um dia regredir — as duas barreiras do ADR 0042 §3.

## A ordem do deploy (continua o §5 do 0047)

No banco novo, **antes** de abrir o sistema, gravar a senha da Helena e a do
Desenvolvedor por quem tem acesso ao banco — o comando está na migration `0044`,
trocando `nivel_acesso` e nome para cada um. Sem isso nenhum dos dois entra: o PIN
já não vale para eles.

## Alternativas rejeitadas

**Desenvolvedor só pelo acesso direto ao banco.** Funciona para manutenção e
impede conferir a aplicação como ela é usada — que é justamente o trabalho dele.

**Desenvolvedor continua por PIN no tablet.** Quatro dígitos num aparelho
compartilhado valendo acesso técnico. É o problema que a #80 abriu.

**Administrador também no tablet, por senha.** Pedido que não existe hoje: a Helena
administra do computador. Se mudar, é tela de login no tablet, não PIN de volta.

## Consequências

- Fecha a #80.
- O Desenvolvedor passa a ter linha em `tentativa_senha` e o mesmo bloqueio por
  erro do Administrador.
- Colaborador que muda de perfil para Administrador perde o PIN como caminho na
  hora; precisa de senha antes.
