# Roteiro da demo ponta a ponta

Ensaiado em 2026-09-18, rota por rota (app + banco de dev locais), como
Atendente e como Admin/Sócio. Cobre o que o "mapa da demo" (passos 1–8, PRs
#114 a #124) decidiu que entra: **Comanda** (abrir, lançar, fechar, enviar),
**Checklist** (marcar, justificar com foto), **Achados** (registrar com foto,
entregar, doar), **Avisos** (publicar, confirmar), **Escala** (troca, falta,
voltar ao padrão) e **Ajustes** (PIN).

**Fora do recorte, sem escrita:** Horas extras, Treinamento, domingo
extra/âncora da Escala, issue #106, comprovante/PDF da Comanda.

**Resultado do ensaio: nenhum defeito de código encontrado.** Os seis módulos
funcionam ponta a ponta com o que já está em `main`. Não há PR desta rodada —
não havia o que corrigir.

## Antes de começar

1. Banco de dev via Docker: `bash scripts/dev-db.sh docker`. O
   `docker-compose.yml` tem `name: lifetrailer` fixo — sem isso, subir de
   dentro de uma worktree criaria um Postgres novo e vazio.
2. Migrations em dia: `node src/db/migrate.mjs`.
3. ⚠ **pg_cron só dispara enquanto o container está no ar — não recupera
   horário perdido.** Se o Postgres subiu depois do horário de um job diário
   (Checklist gera às 06:00 local, Escala às 05:30, etc.), aquele job **não
   roda hoje**. Sintoma: a tela de Checklist mostra "Checklist de hoje não
   criado". Rodar na mão, uma vez, antes de começar:
   ```
   psql -h 127.0.0.1 -p 5432 -U postgres -d lifetrailer \
     -c "set role lifetrailer_job; select app.job_rodar('checklist_dia');"
   ```
   Troque o nome do job (`escala_gerador`, `ensaio_sem_comanda`,
   `bomboniere_reconciliar`, `aviso_arquivar`) se faltar mais algum —
   `select * from job_agendado;` lista todos. **Em produção o Postgres nunca
   desliga, então isso nunca acontece**; é sintoma de container reiniciado no
   meio do dia, não bug de código.
4. Processo webhook+app, os dois segredos são obrigatórios (ADR 0042 §1):
   ```
   LT_WEBHOOK_TOKEN=<32+ chars> LT_CLAIM_SEGREDO=<32+ chars> node src/webhook/index.mjs
   ```
   Sobe na porta 8787.
5. Front: `npm --prefix src/app run dev` — porta 5173, o proxy já aponta pra
   8787 (`src/app/vite.config.ts`).
6. Tablet: registrar um aparelho novo com
   `node src/db/dispositivo.mjs registrar "<nome>"`. **A chave só aparece uma
   vez** — cole na tela "Registrar este aparelho" assim que abrir o app.

## Credenciais de dev

⚠ Válidas só neste banco de dev. PINs redefinidos neste ensaio pela própria
tela de Ajustes (ver ordem dos toques, passo 1) — troque de novo se quiser
outros.

| Pessoa | Perfil | Entrada | PIN / senha |
|---|---|---|---|
| Marcos | Atendente | tablet (PIN) | `1111` |
| Paulo | Atendente | tablet (PIN) | `2222` |
| Thiago | Atendente | tablet (PIN) | `3333` |
| Wesley | Administrador · Sócio | computador (login) | usuário `wesley`, senha `ensaio-demo-2026` |
| Jana | Administrador · Gerente (não é sócia) | computador (login) | senha redefinida neste ensaio para `ensaio-demo-2026` |
| Wyll / Paulo | Administrador · Sócio | computador (login) | senha não alterada neste ensaio — desconhecida, redefinir por SQL se precisar (`update colaborador set senha_hash = crypt('...', gen_salt('bf', 12)) where login = '...'`) |

Só **sócio** (Wyll, Wesley, Paulo) edita PIN em Ajustes — Jana
(Gerente) vê a tela mas não edita (ADR 0050). Só **Atendente** entra pelo
PIN do tablet.

## Ordem dos toques

1. **Ajustes, como Sócio** (Wesley). Login por senha no computador → Ajustes →
   trocar o PIN de Marcos/Paulo/Thiago → confirmar que o histórico de troca
   registra o nome de quem mudou.
2. **Trocar para o tablet, como Atendente** (Marcos, PIN `1111`). Home mostra a
   agenda do dia com "Criar comanda" nos ensaios sem Comanda.
3. **Comanda**: tocar "Criar comanda" num ensaio → lançar um item do
   Bomboniere → Fechar (confere hora praticada, total) → Enviar.
4. **Checklist**: abrir a fase Entrada → marcar um item → num item impossível
   de fazer, tocar "Justificar", tirar foto, escrever o motivo → confirmar que
   ele entra na contagem dos 100% mesmo sem "feito".
5. **Achados**: "Registrar achado", tirar foto → confirma que aparece em
   "Guardados" com a foto anexada → "Entregar" com o nome de quem retirou.
   Testar também "Doar" com destino, no segundo item.
6. **Avisos**: publicar um aviso pedindo confirmação → trocar de PIN (outro
   Atendente, ex. Paulo) → conferir que aparece como "não lido, pede
   confirmação" → confirmar → voltar ao autor e ver "leituras" com o nome de
   quem já confirmou e quem falta.
7. **Escala, de volta como Sócio**: "Editar escala" num dia futuro → tocar
   "troca" (percorre quem está disponível) → "falta" (deixa "Não atribuído")
   → "Confirmar" → repetir e "voltar ao padrão" no mesmo turno, conferindo que
   volta pro titular original mesmo depois de duas trocas.

## O que o ensaio confirmou, módulo a módulo

- **Ajustes**: só sócio edita; PIN novo funciona no `/sessao` na hora;
  auditoria grava autor e alvo.
- **Comanda**: "Criar comanda" na Home (issue #113/#121) chama
  `comanda_criar` de verdade; lançar Bomboniere soma no subtotal; Fechar
  calcula `numero_sequencial` e a extensão; Enviar troca o status sem exigir
  PDF (fora do recorte).
- **Checklist**: marcar e justificar com foto funcionam; a foto sobe **antes**
  do motivo (ADR 0051 §7) e a versão do item muda nesse upload — front já lê a
  versão certa antes de confirmar.
- **Achados**: as duas saídas (Entregar/Doar) fecham corretamente; item exige
  foto antes de sair de "aguardando_foto".
- **Avisos**: Atendente publica (não é só do Admin); confirmação por outra
  pessoa aparece no rodapé de leituras com nome e hora.
- **Escala**: troca, falta e voltar ao padrão gravam em lote, tudo-ou-nada, e
  "voltar ao padrão" devolve pro titular certo mesmo depois de duas trocas.

## Dados de teste deixados no banco de dev

Criados durante o ensaio e **não revertidos** (ficam como exemplo, no mesmo
espírito da Comanda #34 de sessões anteriores):

- Comanda do ensaio de "mirely evelyn" (10:30–11:30) — aberta, com um item de
  Bomboniere, fechada e enviada.
- Achado "Casaco jeans azul" — entregue a "Mirely Evelyn".
- Achado "Guarda-chuva preto" — doado para "ONG do bairro".
- Aviso "Ensaio da demo" — publicado por Marcos, confirmado por Paulo.
- Dois itens do Checklist de hoje (Acústico) — um marcado feito, outro
  justificado com foto.

A troca e a falta testadas na Escala **foram revertidas** ao padrão antes de
terminar — a agenda de 19 e 21/09 não ficou alterada.
