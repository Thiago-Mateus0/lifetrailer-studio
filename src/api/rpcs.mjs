// A allow-list do ADR 0042 §3: quais das funções de `app.` o front alcança, e
// com que forma de argumento.
//
// ⚠ Esta lista é o ponto de aplicação, e é por isso que o servidor não pode ser
// um proxy burro. Sem ela, app.reconciliacao_laco2 e
// app.competencia_trancar_automatica — funções de job, com `revoke` deliberado
// do role da app — passariam a depender só de o `grant` estar certo. Duas
// barreiras que falham de formas diferentes valem mais que uma.
//
// Cresce um gesto de cada vez: entra aqui a RPC que uma tela existente de fato
// dispara, quando ela é ligada. Não se povoa por antecipação — uma função
// alcançável que nenhuma tela chama é superfície sem dono.
//
// Forma de cada entrada:
//   argumentos  ordem e tipo da assinatura no banco (o cast é explícito porque
//               parâmetro sem tipo deixa a resolução de sobrecarga ambígua)
//   doCliente   os únicos nomes que o corpo da requisição pode preencher
//   fixos       valor que o servidor crava — o cliente não escolhe
//   daClaim     preenchido a partir da claim verificada, nunca do corpo
export const RPCS = {
  // A agenda da Home, item sem Comanda: "Criar comanda". É a linha 1 da FSM
  // (gerar_manual) — a única aresta de criação que tem ator. `gerar_automatico`
  // não entra: é da RPC do job, e o ADR 0014 exige autoria NULA nela, o que este
  // caminho nunca produz porque sempre carimba o ator da claim.
  comanda_criar: {
    argumentos: [
      ['p_agendamento_id', 'uuid'],
      ['p_evento', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_agendamento_id: 'agendamento_id' },
    fixos: { p_evento: 'gerar_manual' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // As arestas que uma PESSOA percorre (receber e desfazer: ADR 0081/0086). `cancelar_reversivel`,
  // `descancelar` e `excluir` ficam de fora porque o gatilho delas é a Altegio
  // (webhook e reconciliação), não um dedo no tablet — e `excluir` é terminal.
  // É por isso que o evento é `opcoes` e não `doCliente` puro: a lista é o
  // ponto de aplicação, e sem ela a rota daria acesso à FSM inteira.
  comanda_transicionar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_evento', 'text'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_datetime_fim_praticado', 'timestamptz'],
      ['p_datetime_inicio_praticado', 'timestamptz'],
      ['p_telefone_destino', 'text'],
      ['p_motivo', 'text'],
      ['p_origem_claim', 'text'],
      ['p_forma_pagamento', 'text'],
    ],
    doCliente: {
      p_id: 'comanda_id',
      p_evento: 'evento',
      p_versao_esperada: 'versao',
      p_datetime_fim_praticado: 'fim_praticado',
      p_datetime_inicio_praticado: 'inicio_praticado',
      p_telefone_destino: 'telefone',
      p_forma_pagamento: 'forma_pagamento',
    },
    opcoes: { p_evento: ['fechar', 'enviar', 'reabrir', 'receber', 'desfazer_recebimento'] },
    // Motivo é da trança forçada, que é caminho de Admin no banco, não daqui.
    fixos: { p_motivo: null },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Bomboniere, fundo e equipamento (migration 0049). O preço do catálogo é
  // lido no banco; `preco` só é usado no item fora do catálogo.
  comanda_linha_lancar: {
    argumentos: [
      ['p_comanda_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_tipo', 'text'],
      ['p_item_id', 'uuid'],
      ['p_descricao', 'text'],
      ['p_quantidade', 'int'],
      ['p_preco', 'numeric'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_comanda_id: 'comanda_id',
      p_versao_esperada: 'versao',
      p_tipo: 'tipo',
      p_item_id: 'item_id',
      p_descricao: 'descricao',
      p_quantidade: 'quantidade',
      p_preco: 'preco',
    },
    opcoes: { p_tipo: ['bomboniere', 'item_extra'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Estúdio adicional (ADR 0085, migration 0092). O preço vem da tabela do B
  // no banco; a tela manda só estúdio, início e duração. Sai pelo remover comum
  // (tipo item_extra).
  comanda_estudio_lancar: {
    argumentos: [
      ['p_comanda_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_estudio_id', 'uuid'],
      ['p_inicio', 'timestamptz'],
      ['p_duracao_minutos', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_comanda_id: 'comanda_id',
      p_versao_esperada: 'versao',
      p_estudio_id: 'estudio_id',
      p_inicio: 'inicio',
      p_duracao_minutos: 'duracao_minutos',
    },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  comanda_linha_remover: {
    argumentos: [
      ['p_comanda_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_tipo', 'text'],
      ['p_linha_id', 'uuid'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_comanda_id: 'comanda_id',
      p_versao_esperada: 'versao',
      p_tipo: 'tipo',
      p_linha_id: 'linha_id',
    },
    opcoes: { p_tipo: ['bomboniere', 'item_extra'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  comanda_assumir_posse: {
    argumentos: [
      ['p_comanda_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_comanda_id: 'comanda_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // ------------------------------------------------------------- Checklist
  // Tocar no item, da tela do Checklist e do cartão da Home. `estado` continua
  // fechado em feito/nao_marcado: `nao_feito_justificado` exige foto e sai pelo
  // modal, com as duas entradas abaixo (migrations 0051 e 0056).
  checklist_item_marcar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_estado', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao', p_estado: 'estado' },
    opcoes: { p_estado: ['feito', 'nao_marcado'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // O modal da justificativa, depois que a foto subiu (migration 0056). A foto
  // NÃO vem aqui: ela entra pela rota `/midia`, que tem corpo binário e anexa
  // `justificativa_midia_id` sozinha (ADR 0051 §7). Esta RPC só lê que a foto
  // está lá e move o estado — por isso `versao` é a de DEPOIS do envio, e a
  // tela é relida entre os dois gestos.
  checklist_item_justificar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_texto', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao', p_texto: 'texto' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Remover justificativa" do mesmo modal. Desfaz o tratamento e reabre a fase;
  // a foto fica anexada (ADR 0052) — não há campo nenhum a oferecer.
  checklist_item_justificativa_remover: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Concluir entrada" / "Concluir saída". Quem confere os 100% é o banco: a
  // tela só desenha o botão, e duas pessoas na mesma fase é caso normal.
  checklist_fase_concluir: {
    argumentos: [
      ['p_dia_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_fase', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_dia_id: 'dia_id', p_versao_esperada: 'versao', p_fase: 'fase' },
    opcoes: { p_fase: ['entrada', 'saida'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // --------------------------------------------------------------- Estoque
  // "Editar quantidades → Confirmar": a passada inteira numa chamada só
  // (migration 0052). `itens` é a lista do que o dedo mexeu — o servidor não
  // completa o catálogo, porque item não contado não é item com zero.
  //
  // Sem `versao`: o spec manda a última gravação valer, sem merge. É a única
  // entrada desta lista que não carrega versão esperada, e é de propósito.
  estoque_conferir: {
    argumentos: [
      ['p_itens', 'jsonb'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_itens: 'itens' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // O Admin dá nome ou corrige o fornecedor de um insumo (migration 0074, ADR
  // 0071). Quem não é Admin leva LT005 no banco, não aqui.
  estoque_fornecedor_alterar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_fornecedor', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao', p_fornecedor: 'fornecedor' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // O catálogo de insumos pelo app (migration 0086, ADR 0080). Só o Admin: quem
  // não é leva LT005 no banco, não aqui.
  estoque_insumo_criar: {
    argumentos: [
      ['p_nome', 'text'],
      ['p_categoria', 'text'],
      ['p_fornecedor', 'text'],
      ['p_especificacao', 'text'],
      ['p_severidade', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_nome: 'nome', p_categoria: 'categoria', p_fornecedor: 'fornecedor',
      p_especificacao: 'especificacao', p_severidade: 'severidade' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  estoque_insumo_alterar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_nome', 'text'],
      ['p_categoria', 'text'],
      ['p_fornecedor', 'text'],
      ['p_especificacao', 'text'],
      ['p_severidade', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao', p_nome: 'nome', p_categoria: 'categoria',
      p_fornecedor: 'fornecedor', p_especificacao: 'especificacao', p_severidade: 'severidade' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  estoque_insumo_desativar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  estoque_renomear: {
    argumentos: [
      ['p_campo', 'text'],
      ['p_de', 'text'],
      ['p_para', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_campo: 'campo', p_de: 'de', p_para: 'para' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Repor / ajustar" da Bomboniere (migration 0053). O cliente manda o DELTA,
  // e é o sinal dele que escolhe entre repor e ajustar — não há `tipo` no corpo
  // porque não há escolha a oferecer: ninguém repõe menos três.
  //
  // Sem `versao` pelo mesmo motivo que a conferência: delta soma, e uma baixa
  // de Comanda no meio não contradiz "chegaram 5 unidades".
  bomboniere_movimentar: {
    argumentos: [
      ['p_item_id', 'uuid'],
      ['p_delta', 'int'],
      ['p_motivo', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_item_id: 'item_id', p_delta: 'delta', p_motivo: 'motivo' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // ----------------------------------------------------------------- Escala
  // "Editar escala → Confirmar" (migration 0060): troca, falta e voltar ao
  // padrão, a lista inteira numa chamada. A `versao` viaja DENTRO de cada item,
  // porque cada turno tem a sua.
  escala_alterar: {
    argumentos: [
      ['p_alteracoes', 'jsonb'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_alteracoes: 'alteracoes' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Domingo extra (migration 0062). Quem faz o extra vem do CORPO: o botao do dia
  // percorre os Atendentes ativos e o segundo toque grava (ADR 0060). Ator e
  // escalado sao pessoas diferentes de proposito — a Helena aciona, o Atendente
  // faz. Quem confere que o escalado e Atendente ativo, e que hoje e passado sao
  // do Admin, e a propria funcao; a lista nao le linha nenhuma pra saber disso.
  escala_domingo_acionar: {
    argumentos: [
      ['p_data', 'date'],
      ['p_colaborador_id', 'uuid'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_data: 'data', p_colaborador_id: 'colaborador_id' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Desfazer" no domingo acionado. Quem confere hoje, passado e a janela de 28
  // dias e o banco; a tela so deixa de desenhar o botao quando ja sabe que nao.
  escala_domingo_desfazer: {
    argumentos: [
      ['p_turno_id', 'uuid'],
      ['p_versao', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_turno_id: 'turno_id', p_versao: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Marcar que veio" (ADR 0079). `colaborador_id` e quem a tela mostrava: se
  // uma troca entrou no meio, o banco recusa em vez de marcar outra pessoa.
  escala_presenca_marcar: {
    argumentos: [
      ['p_turno_id', 'uuid'],
      ['p_colaborador_id', 'uuid'],
      ['p_presente', 'boolean'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_turno_id: 'turno_id', p_colaborador_id: 'colaborador_id', p_presente: 'presente' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Confirmar nova ancora" (migration 0062), da visao Padroes. Vai a proposta
  // inteira — array, ancora e uma decisao por troca afetada —, porque o banco
  // confere que as decisoes sao exatamente as trocas que a proposta afeta.
  //
  // `p_colaboradores` e `p_ancora_*` viajam pelo corpo, e nao ha o que cravar:
  // o array e a ancora sao justamente o que a revisao altera. Quem recusa
  // Atendente, pessoa inativa e ancora fora do array e a propria funcao.
  escala_padrao_revisar: {
    argumentos: [
      ['p_turno', 'text'],
      ['p_versao', 'int'],
      ['p_colaboradores', 'uuid[]'],
      ['p_ancora_data', 'date'],
      ['p_ancora_colaborador_id', 'uuid'],
      ['p_decisoes', 'jsonb'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_turno: 'turno',
      p_versao: 'versao',
      p_colaboradores: 'colaboradores',
      p_ancora_data: 'ancora_data',
      p_ancora_colaborador_id: 'ancora_colaborador_id',
      p_decisoes: 'decisoes',
    },
    opcoes: { p_turno: ['manha', 'tarde_noite', 'extra'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // ---------------------------------------------------------------- Achados
  // "Registrar achado" (migration 0057). O achado nasce SEM foto: a foto é a
  // segunda chamada do mesmo gesto, e vai pela rota `/midia`, que anexa e move
  // `aguardando_foto` -> `em_posse` (ADR 0053 §1). Quem exige a foto é a tela;
  // esta função não a recebe, para que uma rede que cai no meio deixe o item
  // registrado e sinalizado em vez de perdido.
  //
  // Sem `versao`: não há registro anterior a contradizer — é o nascimento.
  achado_registrar: {
    argumentos: [
      ['p_descricao', 'text'],
      ['p_estudio_id', 'uuid'],
      ['p_data_achado', 'date'],
      ['p_cliente_nome', 'text'],
      ['p_observacao', 'text'],
      ['p_local_guarda', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_descricao: 'descricao',
      p_estudio_id: 'estudio_id',
      p_data_achado: 'data_achado',
      p_cliente_nome: 'cliente_nome',
      p_observacao: 'observacao',
      p_local_guarda: 'local_guarda',
    },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // As duas SAIDAS do ciclo de vida (migration 0058). Duas entradas e nao uma
  // com `opcoes: { evento: [...] }` porque as arestas nao compartilham payload:
  // uma exige o nome de quem retirou, a outra o destino da doacao (ADR 0054 §1).
  // Com elas, todo gesto que a tela dos Achados desenha passa a disparar.
  achado_entregar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_retirado_por', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'achado_id', p_versao_esperada: 'versao', p_retirado_por: 'retirado_por' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  achado_doar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_destino', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'achado_id', p_versao_esperada: 'versao', p_destino: 'destino' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // ----------------------------------------------------------------- Avisos
  // O formulário "Escrever aviso" (migrations 0059 e 0061). "Fixar no topo"
  // não existe (ADR 0058).
  aviso_publicar: {
    argumentos: [
      ['p_titulo', 'text'],
      ['p_texto', 'text'],
      ['p_prioridade', 'text'],
      ['p_publico', 'text'],
      ['p_pede_confirmacao', 'boolean'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_titulo: 'titulo', p_texto: 'texto', p_prioridade: 'prioridade',
      p_publico: 'publico', p_pede_confirmacao: 'pede_confirmacao',
    },
    opcoes: {
      p_prioridade: ['normal', 'urgente'],
      p_publico: ['todos', 'atendentes'],
      p_pede_confirmacao: [true, false],
    },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Li e entendi". A versão é a do texto que a pessoa leu.
  aviso_confirmar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'aviso_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Editar" (migration 0072). Só o autor passa — quem confere é o banco,
  // porque a allow-list não lê a linha.
  aviso_editar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_titulo', 'text'],
      ['p_texto', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'aviso_id', p_versao_esperada: 'versao', p_titulo: 'titulo', p_texto: 'texto' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Arquivar". Só o Administrador passa — quem confere é o banco.
  aviso_arquivar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'aviso_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // -------------------------------------------------------------- Lembretes
  // A aba Lembretes (migration 0069, ADR 0066). Os três são só do
  // Administrador — quem confere é o banco (`exigir_admin`).
  categoria_lembrete_criar: {
    argumentos: [
      ['p_nome', 'text'],
      ['p_antecedencia', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_nome: 'nome', p_antecedencia: 'antecedencia' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  categoria_lembrete_alterar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_nome', 'text'],
      ['p_antecedencia', 'int'],
      ['p_ativo', 'boolean'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_id: 'categoria_id', p_versao_esperada: 'versao',
      p_nome: 'nome', p_antecedencia: 'antecedencia', p_ativo: 'ativo',
    },
    opcoes: { p_ativo: [true, false] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Antecedência nula é "a da categoria" (ADR 0066 §2).
  lembrete_criar: {
    argumentos: [
      ['p_texto', 'text'],
      ['p_data_alvo', 'date'],
      ['p_categoria_id', 'uuid'],
      ['p_antecedencia', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_texto: 'texto', p_data_alvo: 'data', p_categoria_id: 'categoria_id', p_antecedencia: 'antecedencia',
    },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // "Concluir" (migration 0070). Quem vê conclui — quem confere é o banco
  // (ADR 0067 §1).
  lembrete_concluir: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'lembrete_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // A fila de fotos do tablet bateu o teto (ADR 0072 §8). Qualquer claim: quem
  // bate no teto é quem está no balcão.
  midia_fila_cheia: {
    argumentos: [
      ['p_fotos', 'int'],
      ['p_bytes', 'bigint'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_fotos: 'fotos', p_bytes: 'bytes' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // ---------------------------------------------------------------- Ajustes
  // "Salvar PINs" (migration 0054). A lista inteira numa chamada: o botão é um
  // só, e a tela tem uma caixa por pessoa.
  //
  // ⚠ Única entrada desta lista SEM `p_origem_claim`: quem define PIN é o
  // sócio, que entra por senha (ADR 0049) e cuja sessão é cookie, não claim de
  // tablet. A função não tem esse argumento — não existe lote offline de PIN.
  pin_definir_lote: {
    argumentos: [
      ['p_pines', 'jsonb'],
      ['p_ator_id', 'uuid'],
    ],
    doCliente: { p_pines: 'pines' },
    daClaim: { p_ator_id: 'colaborador_id' },
  },

  // Senha pelo app (issue #220, migration 0082). As duas vêm da sessão de
  // senha, que não tem origem_claim, como o lote de PIN acima.
  // Redefinir a de outra pessoa é do sócio: quem recusa é app.exigir_socio.
  senha_definir: {
    argumentos: [
      ['p_colaborador_id', 'uuid'],
      ['p_login', 'text'],
      ['p_senha', 'text'],
      ['p_ator_id', 'uuid'],
    ],
    doCliente: { p_colaborador_id: 'colaborador_id', p_login: 'login', p_senha: 'senha' },
    daClaim: { p_ator_id: 'colaborador_id' },
  },

  senha_trocar_propria: {
    argumentos: [
      ['p_senha_atual', 'text'],
      ['p_senha_nova', 'text'],
      ['p_ator_id', 'uuid'],
    ],
    doCliente: { p_senha_atual: 'senha_atual', p_senha_nova: 'senha_nova' },
    daClaim: { p_ator_id: 'colaborador_id' },
  },

  // Equipe pelo app (issue #216, migration 0083): cadastrar, desativar e
  // reativar. Quem recusa quem não é sócio é app.exigir_socio.
  colaborador_criar: {
    argumentos: [
      ['p_nome', 'text'],
      ['p_nivel', 'text'],
      ['p_socio', 'boolean'],
      ['p_pin', 'text'],
      ['p_ator_id', 'uuid'],
    ],
    doCliente: { p_nome: 'nome', p_nivel: 'nivel', p_socio: 'socio', p_pin: 'pin' },
    daClaim: { p_ator_id: 'colaborador_id' },
  },

  colaborador_ativo_definir: {
    argumentos: [
      ['p_colaborador_id', 'uuid'],
      ['p_ativo', 'boolean'],
      ['p_versao', 'int'],
      ['p_ator_id', 'uuid'],
    ],
    doCliente: { p_colaborador_id: 'colaborador_id', p_ativo: 'ativo', p_versao: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id' },
  },

  // ----------------------------------------------------------- Horas extras
  // Os quatro gestos da tela (migrations 0063 e 0065). O ADR 0061 fechou
  // dizendo que a tela seguia só de leitura "porque nada disto está na
  // allow-list"; é esta entrada que muda isso.
  //
  // ⚠ Nenhuma delas confere perfil aqui: `app.exigir_admin` é a primeira linha
  // de pagar, cancelar e estornar, e o lançamento por outra pessoa é barrado
  // dentro de `hora_extra_lancar`. A allow-list não lê a linha, então não tem
  // como saber de quem ela é.

  // Lançamento manual (ADR 0061 §1 e §2). Desde a 0091 (ADR 0083) leva o
  // ensaio OU o motivo de não ter ensaio; o outro vai como `null` explícito.
  // Sem `versao` — é o nascimento da linha.
  hora_extra_lancar: {
    argumentos: [
      ['p_colaborador_id', 'uuid'],
      ['p_datetime_inicio', 'timestamptz'],
      ['p_datetime_fim', 'timestamptz'],
      ['p_agendamento_id', 'uuid'],
      ['p_sem_ensaio_motivo', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: {
      p_colaborador_id: 'colaborador_id',
      p_datetime_inicio: 'inicio',
      p_datetime_fim: 'fim',
      p_agendamento_id: 'ensaio_id',
      p_sem_ensaio_motivo: 'sem_ensaio_motivo',
    },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  hora_extra_pagar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'hora_extra_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  hora_extra_cancelar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_motivo', 'text'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'hora_extra_id', p_versao_esperada: 'versao', p_motivo: 'motivo' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Só sobre paga: a original vira cancelada guardando o pagamento, e nasce uma
  // cópia pendente (ADR 0061 §3).
  hora_extra_estornar: {
    argumentos: [
      ['p_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_motivo', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_id: 'hora_extra_id', p_versao_esperada: 'versao', p_motivo: 'motivo' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },

  // Treinamento pelo app (migration 0089). Só Administrador: quem não é leva
  // LT005 no banco, não aqui. Salvar manda o tutorial inteiro — os blocos são
  // a lista nova, não uma alteração por bloco.
  treinamento_categoria_criar: {
    argumentos: [
      ['p_nome', 'text'],
      ['p_descricao', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_nome: 'nome', p_descricao: 'descricao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  treinamento_categoria_alterar: {
    argumentos: [
      ['p_categoria_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_nome', 'text'],
      ['p_descricao', 'text'],
      ['p_ativo', 'boolean'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_categoria_id: 'categoria_id', p_versao_esperada: 'versao', p_nome: 'nome',
      p_descricao: 'descricao', p_ativo: 'ativa' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  tutorial_criar: {
    argumentos: [
      ['p_categoria_id', 'uuid'],
      ['p_titulo', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_categoria_id: 'categoria_id', p_titulo: 'titulo' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  tutorial_salvar: {
    argumentos: [
      ['p_tutorial_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_categoria_id', 'uuid'],
      ['p_titulo', 'text'],
      ['p_blocos', 'jsonb'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_tutorial_id: 'tutorial_id', p_versao_esperada: 'versao', p_categoria_id: 'categoria_id',
      p_titulo: 'titulo', p_blocos: 'blocos' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  tutorial_restaurar: {
    argumentos: [
      ['p_tutorial_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_tutorial_id: 'tutorial_id', p_versao_esperada: 'versao' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  tutorial_status_definir: {
    argumentos: [
      ['p_tutorial_id', 'uuid'],
      ['p_versao_esperada', 'int'],
      ['p_status', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_tutorial_id: 'tutorial_id', p_versao_esperada: 'versao', p_status: 'status' },
    opcoes: { p_status: ['rascunho', 'publicado', 'arquivado'] },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
  // Qualquer colaborador reporta; vira aviso para a administração (0096).
  tutorial_reportar: {
    argumentos: [
      ['p_tutorial_id', 'uuid'],
      ['p_texto', 'text'],
      ['p_ator_id', 'uuid'],
      ['p_origem_claim', 'text'],
    ],
    doCliente: { p_tutorial_id: 'tutorial_id', p_texto: 'texto' },
    daClaim: { p_ator_id: 'colaborador_id', p_origem_claim: 'origem_claim' },
  },
};

// Monta a lista posicional de argumentos, ou diz qual campo falta. Recusar aqui
// é 400: o corpo não serve. Recusa do banco é outra coisa e vem depois.
export function montarArgumentos(rpc, corpo, claim) {
  const valores = [];
  const casts = [];

  for (const [nome, tipo] of rpc.argumentos) {
    let valor;

    if (Object.hasOwn(rpc.fixos ?? {}, nome)) {
      valor = rpc.fixos[nome];
    } else if (Object.hasOwn(rpc.daClaim ?? {}, nome)) {
      valor = claim[rpc.daClaim[nome]];
    } else if (Object.hasOwn(rpc.doCliente ?? {}, nome)) {
      const campo = rpc.doCliente[nome];
      // `null` explícito é um valor; ausente é campo faltando. Tratar os dois
      // igual deixaria o cliente omitir um argumento e receber o default.
      if (corpo === null || typeof corpo !== 'object' || !Object.hasOwn(corpo, campo)) {
        return { ok: false, motivo: `campo ausente: ${campo}` };
      }
      valor = corpo[campo];

      // Valor fora da lista é corpo ruim, não permissão: quem pede `excluir`
      // por esta rota está pedindo uma aresta que a rota não tem.
      const permitidos = rpc.opcoes?.[nome];
      if (permitidos !== undefined && !permitidos.includes(valor)) {
        return { ok: false, motivo: `valor nao permitido em ${campo}` };
      }
    } else {
      // Argumento na assinatura que ninguém preenche é entrada mal escrita, não
      // requisição ruim. Estoura no boot do teste, não em produção calada.
      throw new Error(`allow-list: ${nome} não tem origem declarada`);
    }

    // `pg` manda todo parâmetro como texto, e um array JS vira literal de array
    // do Postgres (`{...}`) — que `::jsonb` recusa. Quem pede jsonb recebe JSON.
    valores.push(tipo === 'jsonb' ? JSON.stringify(valor ?? null) : valor);
    casts.push(`$${valores.length}::${tipo}`);
  }

  return { ok: true, valores, casts };
}
