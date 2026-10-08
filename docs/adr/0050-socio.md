# ADR 0050 — Sócio: o Administrador que é dono

**Status:** aceito
**Data:** 2026-09-15
**Fase:** 6
**Decidido por:** Thiago
**Emenda:** [ADR 0049](0049-pin-so-para-atendente.md) e [ADR 0047](0047-login-do-administrador.md) —
ali qualquer Administrador definia PIN e senha de outros e lia o registro de auditoria.
**Toca:** [permissoes.md](../spec/permissoes.md), [ADR 0013](0013-decisoes-wyll-extensao-e-log.md)
(a leitura do Desenvolvedor vira linha), [ADR 0039](0039-conferencia-do-pin-e-bloqueio.md) (desbloqueio).

## Contexto

O domínio tinha três níveis — Administrador, Desenvolvedor, Atendente — e tratava
todo Administrador igual. Na operação real são duas coisas diferentes:

- **Sócios**, os donos: Wyll, Rafael e Paulo.
- **Gerente**: a Helena, que opera a administração do dia a dia.

Os mockups da Fase 3 já apontavam isso ("Admin consulta os PINs, alteração é do
Sócio"), e nenhum ADR tinha decidido.

## Decisão

### 1. Sócio é uma marca no Administrador, não um quarto nível

`colaborador.socio boolean`, só permitido quando `nivel_acesso = 'administrador'`.

O sócio **é** Administrador: passa em tudo que o Administrador passa, sem nenhuma
função mudar. Um quarto `nivel_acesso` obrigaria a reescrever cada conferência de
`'administrador'` para "administrador ou sócio" — e a primeira esquecida tiraria do
dono um poder que a gerente tem.

### 2. O que é só do sócio

| Ação | Sócio | Gerente |
|---|---|---|
| Definir PIN de outra pessoa (`app.pin_definir`) | sim | **não** |
| Definir login e senha (`app.senha_definir`) | sim | **não** |
| Ler o registro de auditoria (`app.audit_log_consultar`) | sim | **não** |
| Desbloquear PIN ou senha de quem errou | sim | sim |
| Pagar hora extra, trancar competência, ajuste de Comanda, tudo o mais | sim | sim |

Desbloquear fica com a gerente de propósito: é operação do turno (alguém errou o
PIN e precisa trabalhar), não dar acesso novo.

O **Desenvolvedor continua lendo** o registro de auditoria, e a leitura dele
continua virando linha (ADR 0013). Ele segue sem definir PIN ou senha.

A conferência é `app.exigir_socio`, que chama `app.exigir_admin` e confere a
marca a mais.

### 3. Cadastrar, desativar e mudar perfil de pessoa

Hoje não existe função para isso — é feito direto no banco por quem tem acesso.
Quando existir, **é do sócio**, pelo mesmo raciocínio de "dar acesso".

## O passo do dia zero

A marca nasce falsa para todos, e definir PIN e senha passa a exigir sócio. Marcar
os donos é passo de quem tem acesso ao banco, uma vez — o comando está no fim da
migration `0047`.

## Alternativas rejeitadas

**`nivel_acesso = 'socio'`.** Mais explícito no nome, e caro e frágil pelo motivo
da seção 1.

**Uma conta compartilhada "Lifetrailer" para os sócios.** É como os mockups
desenharam. O registro de auditoria diria "Lifetrailer fez" e perderia qual dos
três — justamente em dar acesso, que é o que se quer poder atribuir.

**Deixar a gerente ler o registro de auditoria.** Decidido que não: quem opera a
administração não é quem a audita.

## Consequências

- A tela de Ajustes só permite editar para o sócio; a gerente vê a tela restrita.
- `tests/db/_fixtures.psql`: a colaboradora `aaaa…01` passa a ser sócia, porque é
  a atora das funções de dar acesso nos testes antigos.
