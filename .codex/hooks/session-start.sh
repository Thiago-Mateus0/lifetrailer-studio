#!/usr/bin/env bash
# Ponteiro — o hook de verdade é .claude/hooks/session-start.sh.
#
# Este arquivo já foi uma CÓPIA byte a byte daquele. Cópia entre os dois agentes
# garante drift: quem editar um não sabe que o outro existe, e a divergência
# aparece como "funciona pro Claude, não funciona pro Codex" horas depois. É a
# mesma razão pela qual o AGENTS.md deixou de ser cópia do CLAUDE.md (PR #23).
#
# O hook real já é idempotente e já sai sozinho fora do ambiente remoto
# (CLAUDE_CODE_REMOTE), então não há nada de específico do Codex pra preservar
# aqui. Se um dia houver, este arquivo vira o lugar do que é SÓ do Codex — e
# continua delegando o resto.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "$REPO/.claude/hooks/session-start.sh" "$@"
