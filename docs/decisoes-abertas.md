# Decisões abertas

**As três decisões abaixo foram tomadas em 2026-08-12.** Este documento deixou
de estar em aberto — fica como registro do raciocínio que levou até a decisão
final, arquivada em [ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md). Os
valores em reais e os exemplos abaixo continuam corretos; o que mudou é que
cada seção agora tem uma resposta.

| | Decisão | Quem decidiu | Resultado |
|---|---|---|---|
| ~~**D-A**~~ | ~~Em que minuto começa a contar o acréscimo noturno~~ | Wyll | ✅ Opção 1 — offset 0 |
| ~~**D-B**~~ | ~~Ensaio que vira o dia: o acréscimo continua?~~ | Wyll | ✅ Opção 1 — dia de início |
| ~~**D-C**~~ | ~~O Desenvolvedor pode ler o log de auditoria?~~ | Wyll | ✅ Opção 3 — lê, com registro |

---

## D-A · Em que minuto começa o primeiro bloco cobrável — ✅ DECIDIDO

### O que se pergunta

Quando um cliente passa do horário, os primeiros 14 minutos são cortesia. A
partir dos 15, cobra-se em blocos de 30 minutos. Depois das 23h (18h no sábado),
cada bloco tem R$25 de acréscimo noturno.

A pergunta: **um bloco "começa" no horário em que o ensaio deveria ter acabado,
ou 15 minutos depois, quando a cobrança realmente começa?**

### Por que importa

Exemplo real, Acústico, terça. Ensaio marcado até **22h20**, cliente sai às
**23h20** — uma hora a mais.

```
Cobrança pelos blocos:  2 blocos × R$48,50  =  R$ 97,00   (idêntico nas duas)

Opção 1 — bloco começa às 22h20
  blocos às 22h20 e 22h50, ambos antes das 23h  →  acréscimo R$  0,00
  TOTAL                                                    R$ 97,00

Opção 2 — bloco começa às 22h35 (15 min de cortesia primeiro)
  blocos às 22h35 e 23h05, o segundo depois das 23h  →  acréscimo R$ 25,00
  TOTAL                                                       R$ 122,00
```

**Diferença: R$25 por ensaio afetado.** Sempre nessa direção — a Opção 1 nunca
cobra mais que a Opção 2.

Afeta ensaios que terminam nos 15 minutos antes do limite. Como as sessões são
agendadas para acabar perto das 23h, não é caso raro. Dá para medir na Altegio:
quantos ensaios do último trimestre terminaram entre 22h45 e 23h.

### Como está hoje

Os documentos dizem as duas coisas em lugares diferentes. A tabela de faixas
implica a Opção 2; a fórmula escrita e o cálculo existente fazem a Opção 1.
Ninguém percebeu porque **nenhum dos dez casos de teste separava as duas** — os
dez passavam de qualquer jeito.

### Decidido: Opção 1 — bloco começa no fim do agendamento

Justificativa do Wyll, mais precisa que a recomendação original: a partir do
limite noturno não existe cortesia de 15 minutos. A tolerância decide **se**
cobra; não desloca **onde** a contagem noturna começa.

### Como foi aplicado

`OFFSET_BLOCO = 0` em `tests/runner.py`. Casos EXT-11 e EXT-12 têm expectativa
única — deixaram de reportar as duas leituras. Ver
[ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md).

---

## D-B · Ensaio que atravessa a meia-noite — ✅ DECIDIDO

### O que se pergunta

Sexta, ensaio marcado até **23h40**, cliente sai às **00h40** de sábado. O
segundo bloco começa às **00h10 de sábado**.

O limite noturno de sexta é 23h. O de sábado é 18h. **Qual vale para um bloco
que começa às 00h10?**

### Por que importa

```
Opção 1 — vale o limite do dia em que o ensaio começou (sexta, 23h)
  os dois blocos estão depois das 23h  →  acréscimo R$ 50,00
  TOTAL                                             R$ 147,00

Opção 2 — vale o limite do dia do calendário (sábado, 18h)
  bloco das 00h10 é ANTES das 18h de sábado  →  conta como DIURNO
  só um bloco noturno                        →  acréscimo R$ 25,00
  TOTAL                                                  R$ 122,00
```

A Opção 2 é a letra do que está escrito hoje no ADR 0008 (*"cada bloco segue o
dia-calendário em que começa"*). E ela produz um resultado estranho: **um bloco
às 00h10 da madrugada cobrado como horário diurno**, porque tecnicamente é
"antes das 18h de sábado".

O caso do domingo é pior. Domingo tem acréscimo o dia inteiro. Ensaio de domingo
23h40 → 00h40 de segunda: pela Opção 2, o bloco da segunda cai antes das 23h e
vira diurno, no meio da madrugada.

### Decidido: Opção 1 — pertence ao dia em que começou

Confirmado também pela operação: ensaio que atravessa a meia-noite é raro, e
quando acontece estende no máximo 2-3h — não chega perto das 6h, quando a
`janela_posse` de tarde/noite muda de dono. Sem conflito com a virada de
turno.

### Como foi aplicado

`REGRA_POS_MEIA_NOITE = "dia_de_inicio"` em `tests/runner.py`. Casos EXT-13 e
EXT-14 têm expectativa única. A frase ambígua do ADR 0008 foi marcada como
substituída — ADR aceito não se edita — ver
[ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md).

---

## D-C · O Desenvolvedor pode consultar o log de auditoria? — ✅ DECIDIDO

### O que se pergunta

O log de auditoria registra tudo que cada pessoa fez no sistema. Dois documentos
discordam desde o Rev 7.1: a matriz de permissões diz que o Desenvolvedor
consulta; o contrato do log diz que a consulta é só do Admin.

### Por que importa

O ADR 0010 já registra, como risco aceito, que o Desenvolvedor tem acesso direto
ao banco e que hoje **Thiago é Desenvolvedor e Atendente ao mesmo tempo**. A
mitigação proposta é um relatório de horas extras chegando à Helena por um canal
que o Desenvolvedor não controla.

Essa mitigação enfraquece se o Desenvolvedor consulta o log livremente: ele
passa a ver exatamente o que apareceria numa conferência.

Não é acusação a ninguém. É a diretriz do Wyll aplicada — desenhar assumindo um
futuro colaborador mal-intencionado, não a equipe atual.

### Opções

| | Quem consulta | Efeito |
|---|---|---|
| 1 | Só Admin (Helena e sócios) | Mais coerente com a diretriz. Dev depura por logs técnicos, sem o log de negócio |
| 2 | Admin e Desenvolvedor | Mais prático para investigar problema relatado pela equipe |
| 3 | Admin sempre · Dev com registro | Dev consulta, e a consulta entra no próprio log, visível ao Admin |

### Decidido: Opção 3 — Admin sempre, Dev com registro

Preserva a capacidade de depurar sem criar ponto cego: a consulta do Dev vira
`consulta_audit_log_dev` no próprio log, visível ao Admin.

### Como foi aplicado

`docs/spec/permissoes.md` (2.0.3) e `docs/spec/audit-log.md` (2.0.4)
atualizados — os dois concordam agora. Ver
[ADR 0013](adr/0013-decisoes-wyll-extensao-e-log.md).

---

## Menor, mas anotado

~~**R$25 do acréscimo noturno não tem vigência.**~~ ✅ **Fechado** — o valor saiu
do código para `data/acrescimo-noturno.csv`, com vigência resolvida na data do
ensaio como todo parâmetro financeiro manda a regra global 4. Ver
[ADR 0025](adr/0025-acrescimo-noturno-com-vigencia.md); era a pendência 17.
