# ADR 0023 — Dado pessoal de cliente: o que se guarda, por quanto tempo, e o que nunca entra no audit log

- **Status:** Aceito — fecha as pendências 6 e 8 e a decorrência 2 do
  [ADR 0011](0011-stack.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

Três pendências que só fazem sentido juntas. A 6 pedia "definir o
anonimizável"; a 8 pedia política de retenção de mídias; e o próprio ADR-0011
registrou que o PDF arquivado *"coloca nome e telefone de cliente em arquivo
binário — entra no escopo da pendência 6, que precisa decidir retenção dos PDFs
junto com a das mídias"* (decorrência 11.2). Decidir uma sem as outras deixa
buraco.

**Onde há dado pessoal de cliente hoje, pelos specs:**

| Onde | Campos |
|---|---|
| `Agendamento` | `cliente_nome`, `cliente_telefone`, `cliente_email` — copiados de `client.name` / `client.phone` / `client.email` |
| `Comanda` | `cliente_nome`, `cliente_telefone`, e `envios{telefone_destino}` |
| `Achados` | `cliente_nome`, `cliente_telefone`, `retirado_por_nome`, foto do pertence |
| PDF arquivado | nome e telefone impressos, um arquivo **por envio** (ADR-0011) |
| Checklist / Achados | mídia de justificativa e de registro |

**Correção de premissa.** A `pendencias.md` afirmava que *"o prazo 'antes de
existir dado real' já passou"*, porque `data/` tem dado real. Tem — de **staff
e preços**. Dado de **cliente** ainda não existe em lugar nenhum: ele entra
quando o webhook da Altegio ligar. O prazo não passou; ele vence no go-live, e
esta decisão chega antes dele, que era o ponto.

**O e-mail é o caso mais fácil.** `docs/spec/integracao-altegio.md` diz que do
CRM copiamos *"nome, telefone e e-mail"*, e `cliente_email` está no schema do
`Agendamento`. Só que **nenhum ativo lê esse campo** — nenhuma tela, nenhum
relatório, nenhuma regra. É dado pessoal copiado, guardado e retido sem que
ninguém tenha pedido.

## Decisão

### 1. Minimização: `cliente_email` sai do schema

O campo é removido do `Agendamento` e a linha correspondente sai da spec de
integração. Nenhum ativo o lê, e o canal de entrega decidido é WhatsApp
(ADR-0027) — não há caminho previsto em que o e-mail seja usado.

Dado que não se copia é dado que não precisa ser protegido, retido,
anonimizado, nem explicado a um titular que pergunte. É a única mitigação de
custo negativo que existe: remove trabalho em vez de acrescentar.

Reabre por ADR se um dia existir envio por e-mail. O custo de voltar a copiar é
uma coluna; o de ter copiado por três anos sem uso é uma base de e-mails sob
custódia que ninguém sabia que existia.

### 2. `cliente_id` passa a existir, e é ele que circula

Todo lugar que hoje só tem nome e telefone ganha `cliente_id`:
`client.id` da Altegio quando o payload trouxer; na ausência, **um identificador
aleatório** (UUIDv4), gravado numa tabela `ClienteChave` que liga
`cliente_id` ↔ telefone normalizado.

**Aleatório, e não hash do telefone.** Hash com salt do sistema parece a opção
óbvia e é a errada aqui: celular brasileiro é um espaço de ~10⁹–10¹⁰ candidatos,
e o salt mora no mesmo sistema que o Dev opera — quem tem os dois enumera o
espaço inteiro e recupera o telefone de cada `cliente_id`. Isso colidiria de
frente com as seções 3 e 5: a seção 3 mantém `cliente_id` no audit log de
retenção **permanente**, e a seção 5 anula `cliente_telefone` mas conserva o
`cliente_id`. Um derivado reversível ali dentro é o telefone sobrevivendo pra
sempre no único lugar de onde nada sai — exatamente a cópia que a seção 3
existe pra impedir, só que escrita numa codificação que dá a impressão de ser
segura.

Com id aleatório, a ligação de volta existe **só** na `ClienteChave`, que é uma
tabela comum: sujeita a prazo, a `DELETE`, e ao mesmo job da seção 5. Apagada a
linha, o `cliente_id` no audit log vira pseudônimo sem volta — que é o que
pseudonimizar deveria significar.

Nome e telefone continuam sendo **snapshot** onde já eram — a Comanda antiga
tem que reproduzir o que foi cobrado de quem, e isso o ADR-0002 já exige. O que
muda é que passa a existir uma chave estável para pseudonimizar depois **sem
perder a ligação entre registros do mesmo cliente**. Sem ela, anonimizar é
destruir.

### 3. O audit log nunca recebe dado pessoal literal

Regra nova, e é a que mais importa:

> Nenhum campo de dado pessoal de cliente entra em `valor_anterior` /
> `valor_novo` nem no snapshot do audit log. Entra a referência —
> ativo, id do registro, e `cliente_id`.

O audit log é append-only e de **retenção permanente** (2.0.4), e nem Admin nem
Dev apagam linha. Escrever telefone ali é criar uma cópia do dado pessoal que
**nenhuma política de retenção alcança** — a regra 4 da casa e a anonimização
da seção 5 passariam a valer para o sistema inteiro menos para o único lugar de
onde nada sai. As duas regras não podem ser verdade ao mesmo tempo, e a que
cede é a que estava implícita.

A linha do log carrega `campos_pessoais_omitidos: true`. Quem precisa do valor
antigo de um campo pessoal lê o histórico da própria entidade — que é o que
está sujeito a prazo.

### 4. Retenção, por tipo

| O quê | Prazo | Por quê |
|---|---|---|
| Foto de justificativa do Checklist | **12 meses** | Existe pra resolver disputa sobre o estado do estúdio, que aparece dentro de um ciclo. Também alimenta a métrica de taxa de justificativa (Ativo 2), que é anual |
| Foto de Achados, **com** desfecho | **90 dias** após devolver ou doar | Depois do desfecho ela só prova o desfecho, e o registro textual já prova |
| Foto de Achados, **sem** desfecho | **12 meses**, depois vira sem foto | Item não reclamado |
| PDF arquivado, por envio | **5 anos** | É a prova do que o cliente recebeu. Sem ele, o `AjusteComanda` não tem contra o que ser conferido (ADR-0011) |
| Snapshot de nome/telefone na Comanda | **5 anos**, depois pseudonimizado | Registro financeiro |
| Linha da `ClienteChave` | **5 anos** após a última Comanda daquele cliente | É a única volta de `cliente_id` pro telefone. Enquanto existe, o pseudônimo é reversível — por desenho, e por isso tem prazo |
| Audit log | **permanente** | Regra 4 da casa — e por isso a seção 3 existe |

Cinco anos é o horizonte que cobre prescrição de cobrança e guarda fiscal;
abaixo disso o registro financeiro deixa de servir pro que ele existe. **Isto é
desenho de sistema, não parecer jurídico** — o número final é do Wyll confirmar
com quem cuida da contabilidade. O que esta decisão fixa é que o prazo existe,
é um só, e vale para o PDF e para o snapshot juntos.

### 5. Anonimização é job, não botão

`pg_cron` mensal, sobre competência fechada há mais de 5 anos:

- `cliente_nome` → `Cliente #<cliente_id>`
- `cliente_telefone` → nulo
- `envios{telefone_destino}` → nulo
- linha da `ClienteChave` → apagada, se não houver Comanda mais nova daquele
  cliente. É o passo que fecha a volta: sem ela, `cliente_id` continua sendo
  telefone pra quem tem a tabela, e os outros três passos só teriam mudado onde
  o telefone está guardado
- bytes do PDF → apagados; a linha de `envios` **fica**, com data, autor e o
  fato de que o arquivo expirou

Valores, sequencial, autoria e datas **não mudam** — o relatório de competência
de cinco anos atrás continua reproduzindo os mesmos números. É pseudonimização
de identidade, não apagamento de registro contábil.

Mídia vencida é apagada do R2 pelo mesmo job; a linha de `Midia` fica com
`expirada_em`. Referência que aponta pra arquivo que não existe mais é
referência quebrada — e referência quebrada é bloqueio absoluto por regra da
casa. O registro tem que dizer que o arquivo expirou, não fingir que ainda
está lá.

### 6. Pedido de eliminação pelo titular

Processo, não funcionalidade: o Admin roda a anonimização da seção 5 para um
`cliente_id`, fora do prazo. O que **não** sai é o registro financeiro — valor,
data, sequencial e competência ficam, pseudonimizados. Guarda de registro
fiscal e contábil é obrigação legal própria, e não cai por pedido.

Não existe botão de excluir cliente na tela do Atendente. Excluir registro já é
"Não" para todo perfil na matriz 2.0.3, e este ADR não abre exceção.

## Alternativas rejeitadas

**Não guardar telefone, buscar na Altegio quando precisar.** Elegante e quebra
a reprodutibilidade que o ADR-0002 exige: a Comanda de dois anos atrás
precisa mostrar pra quem foi enviada, e a Altegio é source of truth do
agendamento, não arquivo histórico do que o Lifetrailer enviou. Também acopla
a leitura de uma Comanda antiga à disponibilidade de uma API externa.

**Anonimizar tudo agressivamente, tipo 12 meses.** Destrói a defesa numa
disputa de cobrança, que é o caso em que o registro mais importa — e disputa
sobre valor é justamente o que costuma aparecer tarde.

**Guardar tudo pra sempre, "por segurança".** É a posição que parece prudente e
é a mais exposta: cada ano a mais é mais dado pessoal sob custódia de um estúdio
sem equipe de segurança, sem nenhum ganho depois que o prazo de disputa passou.

**Deixar o audit log carregar dado pessoal e criar exceção de expurgo pra ele.**
Rejeitado com força: quebra o append-only, que é a única propriedade que faz o
audit log valer alguma coisa contra o cenário do ADR-0010. Mais fácil não
colocar do que inventar uma tesoura autorizada.

**Cifrar o dado pessoal no lugar de anonimizar.** Move o problema pra gestão de
chave. E a chave estaria na mão de quem o ADR-0010 declara como risco aceito —
o Dev com acesso ao banco. Cifra que não muda quem consegue ler não é
mitigação.

**`cliente_id` como hash do telefone com salt.** Era a primeira redação desta
decisão, e dispensa tabela de mapeamento: a chave sai do próprio telefone, é
estável de graça e não precisa de lookup. O problema é que o espaço de celulares
brasileiros é pequeno demais pra hash servir de pseudônimo — enumerar ~10⁹–10¹⁰
candidatos com o salt em mãos é minutos, e o salt está no mesmo sistema. Como a
seção 3 leva `cliente_id` pro log permanente, o resultado é telefone recuperável
pra sempre no lugar de onde nada sai.

**HMAC com chave fora do banco, em vez de hash com salt.** Melhora contra quem
só tem o dump: sem a chave, o espaço não é enumerável. Não melhora contra o
adversário deste ADR — a chave mora no processo que o Dev opera, então quem é
risco aceito no ADR-0010 continua conseguindo reverter. Segura o caso menos
grave e deixa passar o que motivou a decisão; um id aleatório custa o mesmo e
não depende de segredo nenhum continuar secreto.

## Consequências

- Fecha as pendências 6 e 8 e a decorrência 11.2.
- **`cliente_id` entra no schema** de `Agendamento`, `Comanda` e `Achados`,
  junto com a primeira migração. Não substitui os snapshots.
- **Entidade `ClienteChave` entra no schema** (`cliente_id`, telefone
  normalizado, `criado_em`), pra quando a Altegio não mandar `client.id`. É a
  única tabela que reverte o pseudônimo: fica fora do audit log, entra na
  tabela de retenção da seção 4, e o job da seção 5 apaga a linha. Custa um
  lookup por agendamento sem `client.id` — o preço de o `cliente_id` não ser
  o telefone numa codificação diferente.
- **`cliente_email` sai de `docs/spec/fundacao.md` e a linha do CRM sai de
  `docs/spec/integracao-altegio.md`** — corrigidos junto com este ADR.
- **`docs/spec/audit-log.md` ganha a regra da seção 3** e o campo
  `campos_pessoais_omitidos`.
- **Entidade `Midia` ganha `expira_em` e `expirada_em`.** O prazo é gravado na
  criação, a partir do tipo — não recalculado depois, pra que mudar a política
  não reescreva o passado, mesma lógica de vigência da regra global 4.
- **O job de anonimização é irreversível e roda sobre dinheiro.** Vai pra
  produção com dry-run obrigatório: primeira execução de cada mês só relata o
  que faria, e o Admin libera. Roda de verdade a partir da confirmação.
- **A limpeza da outbox local** (ADR-0021) herda o prazo mais curto desta
  tabela: item descarregado no IndexedDB do tablet sai em 30 dias. Tablet
  compartilhado não é arquivo.
- O prazo de 5 anos precisa de confirmação contábil antes do go-live. Vai pra
  `pendencias.md` como item de go-live, não como pendência de código: o
  mecanismo não muda se o número mudar, porque o prazo é dado de configuração
  e não literal no código.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0011.2 | Retenção dos PDFs arquivados | 5 anos, junto com o snapshot da Comanda — seção 4 |
