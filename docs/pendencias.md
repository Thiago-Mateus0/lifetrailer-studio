# Pendências

**Defeitos internos: 0 abertos** (fechados em 2026-08-12 — D-A e D-B
decididos pelo Wyll, ver ADR 0013).

Contradição, comportamento indefinido e referência quebrada são bloqueio
absoluto — não convivem com nenhuma fase. Ficam listados aqui riscados, não
apagados: é o mesmo motivo pelo qual ADR não se edita — o que já foi errado
uma vez fica registrado como já foi errado.

| # | Defeito | Estado |
|---|---|---|
| ~~D-A~~ | ~~"Início do bloco" indefinido — duas leituras, R$25 de diferença por ensaio~~ | ✅ decidido — offset 0, ver [ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md) |
| ~~D-B~~ | ~~Classificação de bloco após a meia-noite — a letra do ADR 0008 produz "diurno" às 00h10~~ | ✅ decidido — dia de início, ver [ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md) |
| ~~C1~~ | ~~Matriz 2.0.3 dava audit log ao Dev; contrato 2.0.4 restringia ao Admin~~ | ✅ virou decisão D-C — Opção 3, ambos os arquivos concordam |
| ~~C2~~ | ~~"Tabela de preços não participa do cálculo de extensão" vs. `base = blocos × valor_1h ÷ 2`~~ | ✅ corrigido em `fundacao.md` |

**Pendências** são informação que ainda não chegou. Não fecham por análise e são
adiadas explicitamente, nunca chutadas. Cada uma é marcada pela fase que de fato
bloqueia.

> **Varrição de 2026-08-27.** As 16 pendências abertas e as 7 decorrências do
> ADR 0011 foram fechadas de uma vez, por 12 ADRs (0020 a 0031). A maioria não
> precisava de informação nova — precisava de decisão, e a decisão estava
> represada esperando a stack, que fechou nos ADRs 0011/0016/0018. O que
> **sim** depende de campo saiu da Fase 4 e virou seção de go-live: não trava
> o teclado, trava a data de entrada em operação (ADR 0030).

## 🔴 Bloqueiam a Fase 3 (Design)

Nenhum item hoje. Fase 3 está fechada.

## 🟡 Bloqueiam a Fase 4 (Código)

**Nenhum item aberto.** A Fase 4 pode ser implementada de ponta a ponta com o
que está decidido.

| # | Pendência | Estado |
|---|---|---|
| ~~21~~ | ~~**Hora extra manual — valor, quem lança, estorno.**~~ | ✅ [ADR 0061](adr/0061-hora-extra-manual-e-estorno.md) — blocos de 30 min **começados** × acréscimo noturno vigente na data (a tolerância de 15 min é da cobrança do cliente, não do pagamento); o próprio lança para si e o Admin por qualquer um; o estorno cancela a paga com motivo, guardando `pago_por`, e faz nascer uma cópia pendente. Migration 0065, decidida na issue #133 |
| ~~20~~ | ~~**Tema da interface — os documentos e os mockups discordam.**~~ | ✅ [ADR 0035](adr/0035-tema-claro-e-indigo.md) — o tema é **claro + índigo**, que é o que as 13 telas da Fase 3 já implementam. `ui.md` e `tokens.md` corrigidos; o escuro grafite vai pra `Arquivado`. A troca de tipografia (Inter + Anton) da branch `fontes-inter-anton` **não** entrou junto: o `main` está consistente nas fontes e aquilo é decisão separada |
| ~~3~~ | ~~**Catálogos reais** — itens do Checklist por estúdio, categorias de Lembrete, Fichas Técnicas~~ | ✅ reclassificada — não bloqueia código, bloqueia go-live. [ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) |
| ~~4~~ | ~~Escolha de stack~~ | ✅ **fechada — ADR 0011.** Estava decidida fora do repositório, que é o mesmo que não estar decidida |
| ~~5~~ | ~~**Permissão na camada de dados** — hoje visibilidade, posse e exceções vivem só na aplicação~~ | ✅ RLS na leitura + RPC na escrita (ADR 0011), com a identidade chegando por claim assinada em `set_config` — [ADR 0020](adr/0020-identidade-do-colaborador-no-banco.md) |
| ~~6~~ | ~~**Dado pessoal de clientes** — LGPD~~ | ✅ [ADR 0023](adr/0023-dado-pessoal-de-cliente-e-retencao.md). `cliente_email` sai do schema; audit log nunca recebe dado pessoal literal |
| ~~7~~ | ~~Log de auditoria vs Desenvolvedor (ADR 0010, item 2)~~ | ✅ hash encadeado + âncora semanal fora do alcance do Dev — [ADR 0024](adr/0024-integridade-do-audit-log.md) |
| ~~8~~ | ~~Política de retenção de mídias~~ | ✅ decidida junto com a do PDF e a do snapshot — [ADR 0023](adr/0023-dado-pessoal-de-cliente-e-retencao.md) |
| ~~9~~ | ~~Biblioteca de PDF e layout · WhatsApp (`wa.me` vs API)~~ | ✅ [ADR 0027](adr/0027-pdf-e-entrega-por-whatsapp.md). `wa.me` não anexa arquivo — o caminho é o compartilhamento nativo |
| ~~10~~ | ~~Limite e compressão de fotos no tablet~~ | ✅ [ADR 0026](adr/0026-foto-no-tablet-limite-e-compressao.md) |
| ~~15~~ | ~~Frequência do job gerador da Escala · reconciliação do Bomboniere~~ | ✅ [ADR 0029](adr/0029-cadencia-dos-jobs-agendados.md) |
| ~~16~~ | ~~Autenticação do endpoint de webhook~~ | ✅ **fechada — ADR 0019.** Altegio não suporta segredo em header, HMAC nem allowlist de IP |
| ~~17~~ | ~~**Acréscimo noturno de R$25 sem vigência** — único parâmetro financeiro fora da regra global 4~~ | ✅ [ADR 0025](adr/0025-acrescimo-noturno-com-vigencia.md) — `data/acrescimo-noturno.csv`, com dois casos de teste cobrindo a vigência |
| ~~18~~ | ~~**Backup do Postgres gerenciado**~~ | ✅ [ADR 0028](adr/0028-backup-e-restore.md) — RPO ≤ 1h, cópia no R2 fora da conta do provedor, drill trimestral |

### Decorrências do ADR 0011

Sete itens declarados abertos dentro do ADR 0011 e invisíveis nesta lista até
agora — só apareciam em `scripts/gerar-pendencias.py`. Todos fechados.

| # | Decorrência | Fechada por |
|---|---|---|
| ~~11.1~~ | ~~Mecanismo da claim de `colaborador_id`~~ | ✅ [ADR 0020](adr/0020-identidade-do-colaborador-no-banco.md) |
| ~~11.2~~ | ~~Retenção dos PDFs arquivados~~ | ✅ [ADR 0023](adr/0023-dado-pessoal-de-cliente-e-retencao.md) |
| ~~11.3~~ | ~~Política de pausa do projeto Supabase por inatividade~~ | ✅ obsoleta desde o ADR 0016 — [ADR 0028](adr/0028-backup-e-restore.md) converte o que restava em critério de contratação |
| ~~11.4~~ | ~~Reprocessamento da fila de webhook~~ | ✅ [ADR 0021](adr/0021-fila-e-outbox-destino-do-que-falha.md) |
| ~~11.5~~ | ~~Estratégia de atualização do PWA no quiosque~~ | ✅ [ADR 0022](adr/0022-atualizacao-do-pwa-no-quiosque.md) |
| ~~11.6~~ | ~~Troca de perfil com o tablet offline~~ | ✅ [ADR 0020](adr/0020-identidade-do-colaborador-no-banco.md) |
| ~~11.7~~ | ~~Destino da escrita rejeitada na outbox~~ | ✅ [ADR 0021](adr/0021-fila-e-outbox-destino-do-que-falha.md) |

ADR aceito não se edita, então essas linhas **continuam abertas dentro do ADR
0011**. Quem as fecha é o ADR que decidiu, declarando o id numa tabela
`## Decorrências fechadas` — e `scripts/gerar-pendencias.py` para de contar.

## 🚦 Bloqueiam o go-live (não o código)

Seção nova ([ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md)).
Existem dois portões, e juntar os dois num só fazia levantamento de campo
parecer bloqueio de implementação. Nada aqui impede escrever código: o schema
está fechado desde a Fase 2, e o conteúdo entra pela tela de configuração do
Admin.

Módulo com catálogo vazio mostra **"catálogo não configurado"** — nunca lista
vazia. Fase sem item fecharia 100% por vacuidade, e o dia fecharia limpo sem
ninguém conferir nada.

Só entra aqui **informação que ainda não chegou**. Passo de procedimento já
decidido não é pendência — mora no ADR que o decidiu, e está listado logo
abaixo desta tabela.

| # | Informação que falta | Dono | Como chega |
|---|---|---|---|
| ~~G1~~ | ~~**Itens do Checklist por estúdio** (Entrada e Saída)~~ | — | ✅ quadro físico fotografado e transcrito em `data/checklist-itens.csv` — [ADR 0032](adr/0032-catalogo-do-checklist-vira-carga-inicial.md) |
| ~~G2~~ | ~~**Categorias de Lembrete com antecedências**~~ | — | ✅ [ADR 0043](adr/0043-categoria-de-lembrete-nasce-na-tela.md) — não há artefato pra fotografar, e uma reunião de levantamento produziria lista plausível, não verdadeira. A categoria nasce na tela, quando o primeiro Lembrete precisa dela |
| G3 | **Fichas Técnicas** — migração pro Treinamento | Jana | O documento externo já existe. Basta ele |
| ~~G4~~ | ~~**Catálogo do Bomboniere** — os itens de venda da Comanda~~ | — | ✅ quadro "Recarregue suas baterias!" fotografado e transcrito em `data/bomboniere.csv`, que entra pela carga inicial. Mesmo caminho do [ADR 0032](adr/0032-catalogo-do-checklist-vira-carga-inicial.md), que já o previu para os quatro restantes — decisão nova não era necessária |
| ~~G7~~ | ~~**Prazo de guarda contábil**~~ | ✅ **confirmado em 2026-09-23 pelo Wyll: 5 anos.** É o que o ADR 0023 já assumia e o que `app.anonimizar_vencidas` (`0031_anonimizacao.sql`) já aplica — **nenhuma mudança de código.** O prazo continua literal na função, então uma revisão futura do número é migration |
| G8 | **Cobertura do plano do banco** — PITR e instância sempre ligada. Não cobrindo, o `pg_dump` horário do ADR 0028 é obrigatório antes de produção | Thiago | Painel do provedor, na hora de contratar — ver achado abaixo |
| ~~G11~~ | ~~**A lista de "Guardado onde" dos Achados**~~ | ✅ **respondido em 2026-09-23 pelo Wyll: só "Gaveta".** Não há segundo lugar — "Gaveta A/P" e "Com a Jana" eram do mockup da Fase 3. Constante trocada em `src/api/telas/achados.mjs`; sem migration, porque a coluna guarda texto e achado antigo continua mostrando onde foi guardado |
| ~~G10~~ | ~~**Conta de integração própria na Altegio**~~ | ✅ **respondido em 2026-09-24 pelo Thiago: quem conectou o app foi o Wyll, com a conta da empresa.** A premissa estava errada: o `LT_ALTEGIO_USER_TOKEN` não sai de uma conexão da Jana nem de login pessoal, então não depende do vínculo de uma pessoa. **Nenhuma mudança de token ou de código.** O `LT_ALTEGIO_PARTNER_TOKEN` é outra credencial, da conta de desenvolvedor que publicou o app, e não entrava nesta pendência |

**G1 mostrou o padrão, e o G2 mostrou o limite dele.** Quatro das cinco
pendências de catálogo são coisa que já existe impressa ou em uso na operação:
não é informação que precisa ser criada, é informação que precisa ser
fotografada — foi assim que G1 e G4 fecharam. A quinta não tem artefato, e a
resposta ali não foi fabricar um: foi deixar o uso escrever
([ADR 0043](adr/0043-categoria-de-lembrete-nasce-na-tela.md)).

> **Achado parcial sobre G8 (2026-08-27).** O DigitalOcean Managed PostgreSQL
> oferece backup diário com PITR, janela de **7 dias**, via arquivamento de WAL,
> sem custo adicional — mas **PITR é atrelado ao tier**: o material disponível
> indica que só os planos acima do básico o suportam. Isso não fecha o item, e
> muda o que ele pergunta: deixa de ser *"o provedor oferece?"* e passa a ser
> *"qual tier estamos contratando?"*. Na prática vira restrição de contratação —
> **não contratar o tier básico** —, exatamente a forma que o
> [ADR 0028](adr/0028-backup-e-restore.md) §1 previu.
>
> ⚠ Levantado por busca; a documentação oficial estava bloqueada pelo proxy de
> saída deste ambiente, então é fonte secundária. Confirmar no painel antes de
> contratar — e o ADR 0028 já cobre o caso de não confirmar: `pg_dump` horário
> obrigatório.

### Passos de go-live — decididos, não pendentes

Não contam como pendência (regra da casa: pendência é informação que não
chegou; isto é trabalho que não foi feito). Cada um mora no ADR que o decidiu:

| Passo | Onde está decidido |
|---|---|
| Data de morte de cada controle físico — registrada **antes** de o módulo entrar em operação, sobreposição máxima de 7 dias | [ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) §6 (era a pendência 12, depois G6) |
| Restore drill com `verificar_cadeia()` como gabarito, antes de dado real | [ADR 0028](adr/0028-backup-e-restore.md) §3 (era G9) |
| Nome dos fornecedores preenchido pela Jana no app, até a linha "Insumos ainda sem fornecedor" de `app.prontidao()` zerar — a sentinela `SEM_NOME_PENDENCIA` marca a lacuna até lá | [ADR 0044](adr/0044-fornecedor-sem-rotulo-e-passo-de-go-live.md) (era G5) · caminho pelo app: [ADR 0071](adr/0071-fornecedor-editado-pelo-admin.md) |
| Consulta de prontidão: conta linha em cada catálogo e lista o que está zerado | [ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) §4 |
| Rotação do token do webhook e do segredo da claim — runbook único | [ADR 0019](adr/0019-token-na-url-do-webhook.md) · [ADR 0020](adr/0020-identidade-do-colaborador-no-banco.md) |
| ~~Razão social, CNPJ e chave Pix preenchidos em `data/estudio.csv`~~ ✅ preenchidos em 2026-09-26 pelo Thiago; a chave Pix é o próprio CNPJ | [ADR 0064](adr/0064-pix-e-cnpj-no-comprovante.md) |

## 🟢 Não bloqueiam nada

| # | Pendência | Estado |
|---|---|---|
| 23 | **Treinamento: Rascunho → Arquivado, e o que sai de Arquivado** — o desenho do ciclo de vida em `spec/treinamento.md` só tem Rascunho → Publicado → Arquivado e o despublicar. Não diz se Rascunho que não vai ser usado arquiva direto, nem se Arquivado volta (a Rascunho? a Publicado?) | Aberta. Até decidir, a 0089 recusa as duas (LT002): Rascunho só sai publicando, Arquivado não sai |
| ~~22~~ | ~~**O que a comanda de papel tem e o sistema não** — conferência de equipamentos, Pix e CNPJ, numeração~~ | ✅ [ADR 0064](adr/0064-pix-e-cnpj-no-comprovante.md): Pix e CNPJ entram no rodapé; equipamentos e numeração ficam como estão |
| ~~1~~ | ~~**Bonificação da equipe** — vira ativo 9 ou seção dentro de Horas Extras~~ | ✅ seção dentro de Horas Extras — [ADR 0031](adr/0031-bonificacao-e-secao-de-horas-extras.md). A **regra** continua com o Wyll, prevista para 2027; o que foi decidido é a forma |
| ~~2~~ | ~~**Grau de reforço do PIN** (ADR 0010, item 1)~~ | ✅ continua informativo, não probatório — [ADR 0020](adr/0020-identidade-do-colaborador-no-banco.md). O reforço offline saiu de graça: a claim do lote é cifrada com chave derivada do PIN. Gatilhos que reabrem seguem os do ADR 0010, e a resposta seria segundo fator, não PIN mais longo |
| ~~11~~ | ~~Prazos de escalonamento da criticidade do Estoque~~ | ✅ obsoleta — o ADR 0017 tirou "dias desde marcado" da fórmula. Criticidade deriva da quantidade contada; não há prazo a configurar |
| ~~12~~ | ~~Data de desativação dos controles físicos, por ativo~~ | ✅ decidida — [ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) §6. Virou passo de go-live, não pendência |
| ~~13~~ | ~~23 insumos sem fornecedor · categoria "Bomboniere/Outros" em branco~~ | ✅ a parte de campo virou **G5**; "Bomboniere/Outros" e "Gata" **não vão existir** ([ADR 0030](adr/0030-catalogo-de-conteudo-bloqueia-go-live.md)). ⚠ O "23" era número literal em texto — o CSV diz outro. Regra 1 da casa, quebrada dentro da própria lista de pendências |
| ~~14~~ | ~~Correções no PDF da Fase 1~~ | ✅ não se corrige. O PDF da Fase 1 é documento histórico, superado por `docs/spec/` e `docs/adr/`, e não é citado por nada além desta linha. Corrigir criaria uma segunda fonte concorrendo com a spec |
| ~~19~~ | ~~**Alerta genérico de ação fora do padrão** no audit log~~ | ✅ **não se constrói** — [ADR 0033](adr/0033-sem-alerta-generico-de-anomalia.md). Sem baseline pra aprender padrão, e alerta sem ação queima o canal compartilhado. O ADR lista os alertas específicos que o sistema tem |

### Fora do MVP — decidido, nunca foi pendência

Estavam listados como pendência por engano: as duas já eram decisão registrada
na spec, não informação faltando.

| O quê | Onde está decidido |
|---|---|
| Alexa via Alexa Skills Kit para Lembretes | `docs/spec/lembretes.md` — pós-MVP, e não é MCP |
| Vídeo no Treinamento | `docs/spec/treinamento.md` — *"texto e foto apenas. Vídeo fora do MVP"* |

## Encerradas
Payload da Altegio · mapeamento `staff_id` · catálogo de insumos · âncora da
alternância · Fase 2.9 · os 5 defeitos internos do Rev 7 · as 16 pendências
numeradas e as 7 decorrências do ADR 0011 (varrição de 2026-08-27, ADRs 0020 a
0031).
