# ADRs — Architecture Decision Records

Uma decisão por arquivo. **Nunca editar um ADR aceito.**

Mudou de ideia? Escreva o próximo com status `Aceito — revoga NNNN`, e marque o
anterior como `Revogado por NNNN`. O histórico é a trilha — mesmo princípio do
audit log do sistema.

Formato: Contexto · Decisão · Alternativas rejeitadas · Consequências.
"Alternativas rejeitadas" é obrigatório: sem ele, daqui a seis meses ninguém
sabe se a opção óbvia foi considerada ou esquecida.

| # | Decisão | Status |
|---|---|---|
| 0001 | Posse e autoria da Comanda são campos distintos | Aceito |
| 0002 | Competência tranca no dia 5; correção vira ajuste | Aceito |
| 0003 | Reconciliação compara estado nos dois sentidos | Aceito |
| 0004 | Agendamento manual de emergência é acionado pelo atendente | Aceito |
| 0005 | staff_id classificado em três baldes | Aceito |
| 0006 | Agendamento manual é promovido, não substituído | Aceito |
| 0007 | Varredura detecta ensaio que ocorreu sem Comanda | Aceito — rejeição de criação automática restrita por 0014, não revertida |
| 0008 | Acréscimo por bloco; tabela de preços é a política | Aceito — D-B esclarecida por 0013; valor do bloco revogado por 0078 |
| 0009 | Revoga Q1 da Fase 2.9 | Aceito — revoga Q1 |
| 0010 | Riscos aceitos e comunicados aos sócios | Aceito — revisar quando o Wyll decidir |
| 0011 | Stack: Postgres/Supabase, SPA com outbox, escrita financeira por RPC | Aceito |
| 0012 | Endpoint de webhook sem verificação de origem | Aceito — mecanismo definido pelo 0019 |
| 0013 | Decisões do Wyll: offset de bloco, virada de dia, leitura do audit log | Aceito |
| 0014 | Comanda automática para ensaio não pago online | Aceito |
| 0015 | Catálogo de preço fixo para Fundos e Equipamentos | Aceito |
| 0016 | Sai do Supabase, fica com Postgres self hosted | Aceito — hospedagem do banco revogada por 0018 |
| 0017 | Estoque volta a contar por item | Aceito |
| 0018 | Volta a Postgres gerenciado; resto do 0016 continua | Aceito — revoga parte do 0016 |
| 0019 | Token na URL fecha a pendência 16 (Altegio não suporta segredo/HMAC/IP) | Aceito |
| 0020 | Identidade do colaborador no banco: claim assinada, lote por turno | Aceito — fecha pend. 2 e 5, decorr. 11.1 e 11.6 |
| 0021 | Fila e outbox: o que falha vai pra bandeja visível | Aceito — fecha decorr. 11.4 e 11.7 |
| 0022 | PWA atualiza em ponto seguro, com rollback automático | Aceito — fecha decorr. 11.5 |
| 0023 | Dado pessoal de cliente: escopo, retenção e anonimização | Aceito — fecha pend. 6 e 8, decorr. 11.2 |
| 0024 | Audit log com hash encadeado e âncora externa | Aceito — fecha pend. 7 |
| 0025 | Acréscimo noturno com vigência em `data/` | Aceito — fecha pend. 17 |
| 0026 | Foto no tablet: 1600px, JPEG, EXIF fora, teto por fila | Aceito — fecha pend. 10 |
| 0027 | PDF pelo compartilhamento nativo; Cloud API fora | Aceito — fecha pend. 9 |
| 0028 | Backup: requisito do sistema, cópia fora do alcance do Dev | Aceito — fecha pend. 18, decorr. 11.3 |
| 0029 | Cadência dos jobs agendados; cron em UTC | Aceito — fecha pend. 15 |
| 0030 | Catálogo de conteúdo bloqueia go-live, não código | Aceito — fecha pend. 3, 12 e 13 |
| 0031 | Bonificação é seção de Horas Extras, não ativo novo | Aceito — fecha pend. 1 |
| 0032 | Catálogo do Checklist vira carga inicial em `data/` | Aceito — revoga a seção 2 do 0030; fecha G1 |
| 0033 | Não haverá alerta genérico de "ação fora do padrão" | Aceito — fecha pend. 19 |
| 0034 | FSM canônica da Comanda é a do banco; forks arquivadas | Aceito |
| 0035 | Tema da interface é claro + índigo; escuro grafite arquivado | Aceito — fecha pend. 20; borda, borda fraca e fundo de seleção revogados por 0062 |
| 0036 | Forma física da anonimização (emenda ao 0023 §5) | Aceito — fecha issue #44 |
| 0037 | `staff_altegio.ativo` é estado, não rótulo — quarto balde | Aceito — fecha issue #32 (perguntas 2 e 3) |
| 0038 | O canal da âncora do audit log é a caixa de entrada do Wyll | Aceito — fecha issue #37 |
| 0039 | Quem confere o PIN é o banco; o que protege é o bloqueio | Aceito — completa o 0020 §2 |
| 0040 | Envelope `{success,data,meta}` da Altegio; guarda do Laço 2 em 4 degraus | Aceito — completa o 0003; fecha issue #36 |
| 0041 | O evento da reconciliação entra na fila do webhook; `webhook_evento.origem` | Aceito — completa o 0003 (Laço 1) |
| 0042 | Fronteira do app: leitura por tela (`Dados<Tela>`), escrita por RPC com allow-list | Aceito — completa o 0011 §5 |
| 0043 | Categoria de Lembrete nasce na tela do Admin, não em CSV | Aceito — fecha G2 |
| 0044 | Nome de fornecedor é passo de go-live, não pendência | Aceito — reclassifica G5; §2 revogada por 0071 |
| 0045 | A cascata de exclusão não atravessa competência trancada | Aceito — completa o 0002 |
| 0046 | Abrir sessão não exige estar escalado no turno | Aceito — completa o 0020 §2 |
| 0047 | Administrador entra por login + senha, com cookie assinado | Aceito — completa o 0016 |
| 0048 | O tablet se identifica por uma chave própria, conferida no banco | Aceito — completa o 0039 §4 |
| 0049 | PIN só para Atendente; Administrador e Desenvolvedor entram por senha | Aceito — emenda o 0047 |
| 0050 | Sócio: o Administrador que é dono | Aceito — emenda o 0049 |
| 0051 | Rota de mídia: bytes crus no corpo, disco atrás de interface, mídia nasce ligada ao registro | Aceito — completa o 0026; fecha issue #108 |
| 0052 | Remover a justificativa desfaz o tratamento, não a prova | Aceito — completa o 0051 §7; a decorrência 0051-2 continua aberta |
| 0053 | Registrar achado: o item nasce primeiro, a foto é o segundo passo do mesmo gesto | Aceito — completa o 0051 §7 |
| 0054 | "Entregar" e "Doar": duas saídas, dois formulários, uma trava | Aceito — fecha a decorrência 0053.3; §5 revogada por 0068 |
| 0055 | Duplicata é aviso na tela; o compartilhamento manda a foto e cala o que confere o dono | Aceito — fecha a decorrência 0053-4; completa o 0027 §2 |
| 0056 | Publicar aviso: o título é a primeira linha, o autor nasce confirmado, e o que não tem decisão fica travado | Aceito — completa o spec de Lembretes; §5 e parte da §2 revogadas por 0058 |
| 0057 | Troca e falta na Escala: uma confirmação, o titular guardado, contrapartida na mesma lista | Aceito — completa Troca/Ausência do spec da Escala |
| 0058 | Aviso: para quem vai, se pede confirmação, e sem "fixar no topo" | Aceito — revoga a §5 e parte da §2 do 0056; fecha a issue #122 |
| 0059 | A falta afetada entra na revisão da âncora, com os mesmos dois botões da troca | Aceito — completa "Alterar a âncora OU o array" do spec da Escala; fecha a issue #131 |
| 0060 | Quem faz o domingo extra sai do botão do dia, e não de uma fila de rodízio | Aceito — completa "Acionar domingo extra" do spec da Escala; fecha a issue #138 |
| 0061 | Hora extra manual: a mesma régua da automática, e o estorno que não apaga o pagamento | Aceito — completa o lançamento manual e o estorno do spec de Horas extras; fecha a issue #133 e a pendência 21 |
| 0062 | Borda, borda fraca e fundo de seleção sobem um tom; o resto do tema claro fica | Aceito — revoga três valores do §1 do 0035; fecha a issue #127 |
| 0064 | Pix e CNPJ no rodapé do comprovante, vindos de `data/estudio.csv`; equipamentos e numeração do papel ficam fora | Aceito — amplia o 0027 §4; fecha a pendência 22 e a issue #163 |
| 0065 | Foto de catálogo é `.jpg` fixo no build, achado pelo nome do item; `scripts/fotos-catalogo.mjs` lista o que falta | Proposto |
| 0066 | O Admin cria o lembrete na aba Lembretes; o lembrete guarda a categoria e pode ter antecedência própria | Proposto — é a tela que o 0043 pede |
| 0067 | Quem vê o lembrete conclui; Atrasado é a data vencida; o alerta ao Admin sai uma vez, com 3 dias de atraso | Proposto — fecha a decorrência 1 do 0066 |
| 0071 | O Admin preenche e corrige o fornecedor pelo app; depois da carga, quem manda no campo é a tabela | Aceito — revoga a §2 do 0044 |
| 0073 | O comprovante da Comanda é enviado pela Jana, à mão, pelo ManyChat, com um link de 30 dias; o tablet fecha, não envia | Aceito — revoga §1–§3 do 0027; fecha a issue #194 |
| 0075 | Quem procura o dono do achado é a Jana: "Copiar mensagem" e "Baixar foto" no computador dela; o tablet não compartilha | Proposto — revoga o §4 do 0055; fecha a decorrência 0073.1 e a issue #204 |
| 0076 | O botão "Enviar" da Jana manda o link do comprovante pela API do ManyChat; se a API não confirmar, cai no "Copiar mensagem" | Proposto — revoga o §5 do 0073 |
| 0077 | `attendance: 2` ("cliente confirmou") é lido como 0, aguardando | Proposto |
| 0078 | A extensão é a diferença entre pacotes; entre linhas, proporcional | Aceito — revoga o passo 3 da extensão em fundacao.md; fecha a issue #223 |
| 0072 | Fila de mídia: primeiro cliente da outbox, item pendente de anexo no Checklist, foto sobe com a claim de quem a tirou | Aceito — fecha a decorrência 0051.1 |
| 0068 | Achado não tem "item de valor": qualquer Atendente doa qualquer achado | Aceito — revoga o 0054 §5; fecha a decorrência 0053.1 |
| 0069 | Editar aviso: o autor troca título e texto enquanto Ativo, e editar volta a pedir confirmação | Aceito — fecha a decorrência 0056.2 |
| 0070 | Aviso Urgente: marca na Entrada, modal na primeira troca de tela | Aceito |
| 0074 | O dump não se apaga por Bucket Lock, não por token; retenção por prefixo | Proposto — muda o mecanismo do §2 do 0028; fecha a issue #202 |
| 0081 | Comanda "Paga": quem recebeu o valor marca "Recebi", depois de Fechada ou Enviada | Aceito — cor do §4 revogada por 0084; guarda da Enviada e "fora" da forma revogados por 0086 |
| 0082 | Ensaio agendado depois do limite noturno cobra o acréscimo e gera a hora extra, ligada à Comanda | Aceito — estende 0008 ao agendado |
| 0083 | Hora extra manual ligada ao ensaio, ou "Sem ensaio" com motivo (alerta o Admin) | Aceito — complementa 0061 |
| 0082 | Foto da equipe é arquivo fixo no build, achada pelo nome (estende o 0065) | Proposto |
| 0084 | Cor da agenda: Comanda paga é verde; pago na Altegio sem Comanda fica sem cor | Aceito — revoga a linha "laranja" do 0081 §4 |
| 0086 | "Recebi" pede a forma de pagamento (Pix, Dinheiro, Crédito, Débito) e vale para qualquer Atendente | Aceito — revoga a guarda da Enviada e o "fora" da forma no 0081 |
| 0087 | O checklist do dia vai até a saída concluir (madrugada) e o Admin tem histórico só de leitura | Proposto |
| 0088 | Sábado é um turno só, 8h–18h, do revezamento; a manhã fixa vale de segunda a sexta | Proposto |

### Decorrência de ADR, e como ela fecha

ADR aceito não se edita — então uma "decorrência aberta" declarada dentro de um
ADR **não** é riscada lá dentro quando alguém finalmente a decide. Quem fecha é o
ADR que decidiu: ele declara o id numa tabela sob o título
`## Decorrências fechadas`, e `scripts/gerar-pendencias.py` para de contar o
item. O original fica intacto, e a trilha aponta pra frente.
