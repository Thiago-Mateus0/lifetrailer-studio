<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0010, 0027, 0051, 0053, 0054, 0055, 0068, 0075 -->

## ATIVO 7 — ACHADOS E PERDIDOS

### Ciclo de vida
```
[Aguardando foto] ← registro existe sem a foto; alerta se +24h
[Em posse]        ← foto anexada (Midia, write-once)
   ↓ 3 meses da DATA DO ACHADO (alerta 1 semana antes)
[Pronto para doação] ← só aviso de prazo, NÃO trava
   ↓ confirmação + destino obrigatório
[Doado]     ← único estado terminal
[Devolvido] ← a partir de qualquer estado, exceto Doado
```

- Registro tardio: achado com +3 meses nasce Pronto para doação
- **O registro nasce sem foto** (ADR 0053): `app.achado_registrar` cria o item em
  Aguardando foto e a foto sobe em seguida, por `POST /midia`, que é quem move
  para Em posse. A tela exige a foto para guardar; o banco não — sem rede, o
  item fica registrado e marcado como "sem foto" em vez de se perder. O detalhe
  de quem está em Aguardando foto oferece "Anexar foto".
- **O item sai por uma das duas saídas** (ADR 0054): `app.achado_entregar`, que
  exige o **nome de quem retirou**, e `app.achado_doar`, que exige o **destino**.
  As duas saem de qualquer um dos três estados guardados — inclusive de
  Aguardando foto, porque a foto é prova de que o item existiu, não condição para
  ele sair — e nenhuma sai de um terminal. O formulário de cada uma é recorte
  (`?saida=entregar|doar`).
- Um registro por item, com foto própria
- Qualquer Atendente doa qualquer achado — não há item que só o Admin doa (ADR 0068)
- Registro copia `cliente_telefone` e gera Lembrete de contatar o cliente na criação
- **Procurar o dono é da Jana, pelo ManyChat** (ADR 0075): no computador dela, o detalhe
  oferece "Copiar mensagem" e "Baixar foto"; ela cola o texto e anexa a foto na conversa
  do cliente. O tablet não compartilha. Só com foto e com o item ainda em guarda. O texto
  **não** leva a observação (é ela que confere o dono) nem o nome do cliente (ADR 0055 §5).
- Sugestão automática do agendamento pelo estúdio + horário do achado
- **Alerta de possível duplicata** (ADR 0055): no formulário, quando o estúdio e a data
  escolhidos já têm item guardado. Avisa, não trava — e sem estúdio escolhido não há alerta.
- Contador de dias restantes

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

`estudio_id` · `agendamento_id` · `cliente_nome` · `cliente_telefone` · descricao · data/hora_achado · `midia_id` · status · `local_guarda` · `observacao` · `destino_doacao` · registrado por/em · `retirado_por_nome` · devolvido por/em · doado por/em · `versao`

**Índices:** `(status)` · `(estudio_id, data_achado)` · `(data_achado)`

### Pendências
Política de retenção das fotos · notificação automática ao cliente via Altegio (pós-MVP) ·
o agendamento sugerido (e com ele
`cliente_telefone` e o Lembrete de contato) · a lista real de "Guardado onde"
(decorrências do ADR 0053) · desfazer uma entrega feita por engano, e a lista
real de destinos de doação, se houver repetição (decorrências do ADR 0054)

---
