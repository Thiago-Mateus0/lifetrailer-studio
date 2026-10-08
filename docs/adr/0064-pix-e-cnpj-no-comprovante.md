# ADR 0064 — Pix e CNPJ entram no comprovante; conferência de equipamentos e numeração do papel ficam fora

**Status:** Aceito — amplia o rodapé do [ADR 0027](0027-pdf-e-entrega-por-whatsapp.md) §4; fecha a pendência 22
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** Thiago (issue #163: 1A, 2B, 3A)

## Contexto

O PDF da Comanda copia a forma da comanda de papel (#161). A de papel tem três
coisas que o sistema não tem: conferência de equipamentos (entrada/saída), a
chave Pix com a razão social e o CNPJ no rodapé, e a numeração de quatro dígitos
herdada do talão. O #161 deixou as três de fora para não improvisar (regra 6).

O rodapé do ADR 0027 §4 lista data e hora do envio, quem enviou e a versão. Ele
não prevê dado de cobrança, porque ali o PDF é comprovante. Só que o cliente às
vezes paga depois de receber o PDF, e aí precisa saber para onde pagar.

## Decisão

1. **Pix, razão social e CNPJ entram no rodapé**, em toda página, acima da
   linha de envio. Os três moram em `data/estudio.csv`
   (`razao_social,cnpj,chave_pix`), porque número não se escreve no código.
2. **O CSV vai no bundle do app, não passa pelo banco.** O PDF é gerado no
   tablet, que pode estar offline (ADR 0027 §1). Se o dado viesse pela API, a
   rede entraria no caminho crítico. O CSV só muda se o estúdio trocar de CNPJ,
   e aí vai com o próximo deploy.
3. **Com o CSV só com o cabeçalho, o rodapé sai sem a linha de Pix.** O teste do
   front aceita o arquivo só com o cabeçalho ou com uma linha de três campos
   preenchidos. Linha pela metade ou vírgula na razão social quebram o teste.
4. **A conferência de equipamentos fica fora da Comanda.** Conferir equipamento
   faz parte de abrir e fechar o estúdio, e o cliente não precisa disso no
   comprovante. Continua no papel ou vai para o Checklist.
5. **A numeração do sistema fica como está:** começa no Nº 1 e sai sem zero à
   esquerda. Enquanto o papel circular, as duas numerações convivem. Assim, `12`
   não se confunde com o `0012` do papel.

## Alternativas rejeitadas

**Pix e CNPJ num catálogo do banco, lidos pela tela.** Isso segue o padrão dos
outros catálogos de `data/`, mas exige rede para gerar um PDF que hoje sai
offline. Para três valores que quase nunca mudam, a tabela, a carga e o campo na
montagem da tela custam mais do que resolvem.

**Deixar Pix e CNPJ fora.** Serviria se o cliente pagasse sempre no balcão. Não
é o caso (issue #163, item 2).

**Conferência de equipamentos na Comanda.** Seria uma tabela nova, uma lista de
itens em CSV e mais um passo para a atendente em todo ensaio, só para o registro
chegar ao PDF de um cliente que não confere equipamento.

**Continuar a numeração do papel.** Seria uma migration na sequência da Comanda.
Enquanto o talão circular, os dois números poderiam colidir, e não haveria como
saber de qual série um número veio.

## Consequências

- **Passo de go-live:** preencher a linha de `data/estudio.csv` com a razão
  social, o CNPJ e a chave Pix, iguais aos da comanda de papel. Antes disso o
  comprovante sai sem a linha, e não aparece erro.
- O ADR 0027 §5 continua valendo: o dado que entra é do estúdio, não do cliente.
