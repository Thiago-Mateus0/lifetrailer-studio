# ADR 0025 — Acréscimo noturno vira parâmetro versionado em `data/`; tolerância e bloco continuam sendo código

- **Status:** Aceito — fecha a pendência 17.
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

A regra global 4 manda todo parâmetro financeiro carregar `vigencia_inicio` /
`vigencia_fim`, e manda todo cálculo consultar o parâmetro vigente **na data do
evento**. Preço, turno e valor da hora extra obedecem — vivem em
`data/precos.csv` e `data/turnos.csv`, e o `tests/runner.py` resolve a vigência
na data do ensaio, com comentário explicando por quê.

O acréscimo noturno por bloco não obedece. Está escrito literalmente na spec e
literalmente no runner:

```python
ACRESCIMO_POR_BLOCO = 25.00
```

No dia em que virar outro valor, todo relatório de competência antiga passa a
recalcular com o valor novo — silenciosamente, e justamente no cálculo que o
ADR-0002 exige que seja reproduzível. É o único parâmetro financeiro fora da
regra, e o `docs/decisoes-abertas.md` já anotava isso como "menor, mas anotado".

**Achado junto, da mesma família.** O runner também traz o limite noturno
literal:

```python
LIMITE = {"seg": "23:00", ..., "sab": "18:00", "dom": None}
```

Esses horários já existem em `data/turnos.csv`, na coluna `hora_fim_calculo`,
**com vigência**. O runner tem uma segunda cópia deles, sem vigência. Duas
cópias de um número que decide dinheiro é exatamente o defeito da pendência 17,
só que pior: aqui a fonte correta já existe e está sendo ignorada.

## Decisão

### 1. `data/acrescimo-noturno.csv`, no formato dos outros

```
valor,vigencia_inicio,vigencia_fim
25.00,2026-08-10,
```

Mesma forma de `precos.csv`: linha aberta é a vigente, correção fecha a linha
anterior e abre outra. Sem coluna `estudio` e sem coluna `dia_semana` — o
acréscimo é global hoje, e coluna que existe só pra um futuro hipotético é
convite pra preencher errado.

`vigencia_inicio` igual à de `precos.csv`, porque é a mesma tabela publicada.

### 2. O limite noturno é lido de `data/turnos.csv`

O runner deixa de ter a tabela `LIMITE` e passa a derivar de
`hora_fim_calculo`, resolvendo a vigência na data do ensaio, igual ao preço.

**Com guarda nos dois sentidos**, e ela importa mais que a leitura. "Sem limite"
é a codificação de *domingo, acréscimo o dia inteiro* — então qualquer dia que
perca seu `hora_fim_calculo` passa a ser cobrado como domingo. Sem erro, sem
teste falhando: só uma diferença de dinheiro que ninguém vê.

O gabarito é `DIA_INTEIRO = {"dom"}`, que fica **no código**, porque "domingo tem
acréscimo o dia inteiro" é regra do ADR-0008, não dado de configuração. Contra
ele, as duas direções levantam erro:

- dia que deveria ter limite e não tem no CSV;
- dia declarado como dia inteiro que **ganhou** limite no CSV.

É a **primeira** que pega o caso sutil: perder só a linha `sab,Tarde-noite`
mantém o sábado presente no arquivo — a linha `sab,Manha` continua lá — e ainda
assim sem limite, que é o que faria o dia inteiro virar noturno. A segunda pega
o inverso, um domingo que ganhou limite.

**Multiplicidade é a terceira dimensão**, e `_unica_vigente` a confere por
**(dia, turno)**, não por dia. O turno é o que distingue duas linhas do mesmo
dia — `Manha` não tem limite por desenho, e por isso vem com
`hora_fim_calculo` vazio. Conferir por dia obrigaria a descartar as linhas de
limite vazio antes de contar, e aí a sobreposição em que a linha nova **zera**
o limite ficaria invisível: sobraria uma linha só, a contagem não veria nada, e
o dia seguiria cobrando pelo limite velho — exatamente o silêncio que esta
seção existe pra fechar.

Por último, `dia_semana` fora do vocabulário (`seg-sex` ou um dia da semana)
levanta em vez de ser descartado. Uma linha que não se aplica a dia nenhum some
calada e leva junto a mudança de limite que pretendia fazer — era o único
caminho *fail-open* entre estas guardas.

### 3. Tolerância e tamanho do bloco continuam em código, de propósito

`TOLERANCIA_MIN = 15` e `BLOCO_MIN = 30` **não** vão para CSV, e a decisão é
deliberada, não esquecimento.

Os dois não são parâmetros: são a forma da regra. Toda a tabela de
arredondamento da spec (`0–14 → não cobra`, `15–44 → 1 bloco`, `45–74 → 2
blocos`…) é construída em cima deles, e as duas leituras do D-A discutiam
*onde* o bloco começa justamente porque o bloco de 30 minutos é a unidade que o
sistema inteiro usa. Mudar um dos dois não é atualizar um preço — é revogar o
ADR-0008 e refazer as tabelas publicadas.

Colocar os dois num CSV comunicaria o contrário: que dá pra ajustar por
configuração, sem ADR. A vigência serve pro que muda com o tempo mantendo a
regra; não serve pra trocar a regra.

## Alternativas rejeitadas

**`data/parametros-financeiros.csv` genérico**, com coluna `parametro` e todos
os valores dentro. Junta numa tabela só coisas que se comportam de maneira
diferente — preço muda por decisão comercial, bloco muda por revogação de ADR —
e torna a distinção da seção 3 invisível. Quem abre um arquivo chamado
"parâmetros financeiros" assume que tudo ali é parametrizável.

**Manter o R$25 na spec e só documentar melhor.** É a situação atual. Não
resolve nada: o problema não é o leitor não saber, é o cálculo de competência
antiga usar o valor de hoje.

**Coluna de acréscimo dentro de `precos.csv`.** O acréscimo não varia por
estúdio nem por duração, que são as duas dimensões daquele arquivo. Repetir o
mesmo 25.00 em cinquenta linhas é cinquenta lugares pra errar quando virar 30.

**Manter `LIMITE` duplicado no runner "porque funciona".** Funciona hoje e
diverge no dia em que o horário do sábado mudar em `turnos.csv` — e a
divergência aparece como diferença de dinheiro, não como erro.

## Consequências

- Fecha a pendência 17.
- **`tests/runner.py` passa a ler dois CSVs a mais.** Os casos de
  `tests/*.yaml` continuam valendo sem alteração — os números não mudam, porque
  o valor vigente é o mesmo 25.00 que estava no código. Se algum caso mudasse
  de resultado, seria sinal de que a leitura está errada.
- **`docs/spec/fundacao.md` para de citar R$25 literal** e passa a apontar pro
  CSV, como já faz com preço — regra 1 da casa.
- **A implementação da Fase 4 lê da mesma fonte.** A função PL/pgSQL que calcula
  extensão resolve o acréscimo vigente na data do ensaio; o CSV é o que semeia a
  tabela, e a tabela carrega as mesmas colunas de vigência.
- **`hora_fim_calculo` de `turnos.csv` vira dado carregado**, não só
  documentação. Editar aquela coluna passa a mudar cobrança — fica anotado na
  spec de fundação.
- Um caso de teste novo cobre a vigência: mesmo ensaio, duas datas, valores de
  acréscimo diferentes. Sem ele, a leitura por vigência não está verificada —
  regra 4 da casa, que existe porque dez testes passando na mesma interpretação
  não provam nada.
