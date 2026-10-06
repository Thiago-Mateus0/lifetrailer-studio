import type { DadosAvisos } from './Avisos'

// Dados de exemplo extraídos do mockup; não são fonte de verdade.
// Os números reais vivem em data/. Rótulos, contagens e permissões já vêm prontos.
export const avisosFixture: DadosAvisos = {
  hora: '09:40',
  iniciais: 'JA',
  subtitulo: 'O que a equipe precisa saber, e quem já confirmou. Alertas do sistema ficam na aba ao lado.',
  podeEscrever: true,
  rotuloEscrever: 'Escrever aviso',
  abas: [
    { identificador: 'ativos', rotulo: 'Publicados', selecionada: true },
    { identificador: 'sistema', rotulo: 'Do sistema', selecionada: false },
    { identificador: 'arquivados', rotulo: 'Arquivados', selecionada: false },
  ],
  formulario: null,
  formularioLembrete: null,
  categorias: null,
  avisos: [
    {
      identificador: 'a1',
      versao: 1,
      tipo: 'equipe',
      titulo: 'Fundo infinito branco em manutenção até 25/08',
      texto: 'O ciclorama do Estúdio 2 está sendo repintado. Ensaios que pediam fundo branco vão para o Estúdio 1 até lá.',
      metadados: '15/08 · Jana · para todos',
      destaque: false,
      marcadores: [{ rotulo: 'urgente', aparencia: 'urgente' }],
      status: { rotulo: '1 de 3 confirmaram', aparencia: 'faixa' },
      faltam: 'falta: Marcos, Paulo',
      acoes: [
        { identificador: 'leituras', rotulo: 'Ver quem leu', aparencia: 'discreta' },
        { identificador: 'editar', rotulo: 'Editar', aparencia: 'discreta' },
        { identificador: 'arquivar', rotulo: 'Arquivar', aparencia: 'discreta' },
      ],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: 'Salvar volta a pedir confirmação de quem já leu.',
      leituras: ['Thiago — 15/08 17:40', 'Marcos — sem confirmação', 'Paulo — sem confirmação'],
    },
    {
      identificador: 'a2',
      versao: 2,
      tipo: 'equipe',
      titulo: 'Domingo abre 11h a partir de setembro',
      texto: 'A escala de domingo passa a começar às 11h. Quem abre chega 10h15 para o Checklist.',
      metadados: '12/08 · Jana · para todos',
      destaque: false,
      marcadores: [],
      status: { rotulo: '3 de 3 confirmaram', aparencia: 'discreta' },
      faltam: '',
      acoes: [
        { identificador: 'leituras', rotulo: 'Ver quem leu', aparencia: 'discreta' },
        { identificador: 'arquivar', rotulo: 'Arquivar', aparencia: 'discreta' },
      ],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: 'Salvar volta a pedir confirmação de quem já leu.',
      leituras: ['Marcos — 12/08 08:05', 'Thiago — 12/08 08:31', 'Paulo — 13/08 14:22'],
    },
    {
      identificador: 'a3',
      versao: 1,
      tipo: 'equipe',
      titulo: 'Aluguel de flash agora é com a Foto Rental',
      texto: 'Pedidos de equipamento extra passam para a Foto Rental, entrega terça e sábado. A LumiTech saiu da lista de fornecedores no Estoque.',
      metadados: '10/08 · Jana · para todos',
      destaque: false,
      marcadores: [],
      status: { rotulo: 'Sem confirmação', aparencia: 'discreta' },
      faltam: '',
      acoes: [{ identificador: 'arquivar', rotulo: 'Arquivar', aparencia: 'discreta' }],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
  ],
  mensagemVazia: 'Nenhum aviso ativo.',
  rodape: 'Confirmação de leitura é registro, não cobrança: fica com nome e horário e serve para saber quem ainda não viu antes do turno começar. Arquivar não apaga.',
}

export const avisosVaziosFixture: DadosAvisos = { ...avisosFixture, avisos: [] }

export const avisosEscrevendoFixture: DadosAvisos = {
  ...avisosFixture,
  formulario: {
    titulo: 'Domingo abre 11h a partir de setembro',
    texto: 'A escala de domingo passa a começar às 11h. Quem abre chega 10h15 para o Checklist.',
    publicos: [
      { identificador: 'todos', rotulo: 'Todos', selecionado: true, pessoas: 4 },
      { identificador: 'atendentes', rotulo: 'Atendentes', selecionado: false, pessoas: 2 },
    ],
    pedeConfirmacao: true,
    urgente: false,
    aviso: 'Vai para as 4 pessoas da equipe e fica em destaque até cada uma confirmar.',
    podePublicar: true,
  },
}

// A autora editando o próprio aviso, com o título já trocado.
export const avisosEditandoFixture: DadosAvisos = {
  ...avisosFixture,
  avisos: [{
    ...avisosFixture.avisos[0],
    editando: {
      titulo: 'Fundo infinito branco em manutenção até 28/08',
      texto: avisosFixture.avisos[0].texto,
      podeSalvar: true,
    },
  }, avisosFixture.avisos[1]],
}

export const avisosLeiturasFixture: DadosAvisos = {
  ...avisosFixture,
  avisos: [{
    ...avisosFixture.avisos[0],
    leiturasAbertas: true,
    acoes: [
      { identificador: 'leituras', rotulo: 'Fechar leituras', aparencia: 'discreta' },
      { identificador: 'arquivar', rotulo: 'Arquivar', aparencia: 'discreta' },
    ],
  }],
}

export const avisosAtendenteFixture: DadosAvisos = {
  ...avisosFixture,
  iniciais: 'EL',
  subtitulo: 'Leia e confirme. O que pede confirmação fica em destaque até você marcar.',
  abas: [
    { identificador: 'ativos', rotulo: 'Ativos', selecionada: true },
    { identificador: 'arquivados', rotulo: 'Arquivados', selecionada: false },
  ],
  avisos: [
    {
      ...avisosFixture.avisos[0],
      destaque: true,
      marcadores: [{ rotulo: 'não lido', aparencia: 'nao_lido' }, { rotulo: 'urgente', aparencia: 'urgente' }],
      status: { rotulo: 'Pede confirmação', aparencia: 'faixa' },
      faltam: '',
      acoes: [{ identificador: 'confirmar', rotulo: 'Li e entendi', aparencia: 'principal' }],
    },
    {
      ...avisosFixture.avisos[1],
      status: { rotulo: 'Você confirmou 12/08 08:05', aparencia: 'discreta' },
      acoes: [],
    },
    { ...avisosFixture.avisos[2], status: null, acoes: [] },
  ],
  rodape: 'Confirmar leitura registra seu nome e o horário. Se um aviso mudar depois de publicado, ele volta a pedir confirmação.',
}

export const avisosSistemaFixture: DadosAvisos = {
  ...avisosFixture,
  abas: [
    { identificador: 'ativos', rotulo: 'Publicados', selecionada: false },
    { identificador: 'sistema', rotulo: 'Do sistema', selecionada: true },
    { identificador: 'arquivados', rotulo: 'Arquivados', selecionada: false },
  ],
  avisos: [
    {
      identificador: 's1',
      versao: 0,
      tipo: 'sistema',
      titulo: 'Comanda #1049 fechada com acréscimo e sem hora extra',
      texto: 'A verificação periódica criou o registro da extra e avisou você. Confira o valor em Horas extras.',
      metadados: '16/08 · gerado pelo sistema',
      destaque: false,
      marcadores: [{ rotulo: 'rede de segurança', aparencia: 'neutra' }],
      status: { rotulo: 'Do sistema', aparencia: 'sistema' },
      faltam: '',
      acoes: [
        { identificador: 'horas_extras', rotulo: 'Ver em Horas extras', aparencia: 'discreta' },
        { identificador: 'resolver', rotulo: 'Resolver', aparencia: 'selecao' },
      ],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
    {
      identificador: 's2',
      versao: 0,
      tipo: 'sistema',
      titulo: 'Extra de 14/08 sem colaborador na escala',
      texto: 'O turno não tinha ninguém escalado, então a extra caiu para quem executou o Fechar. Confirme se é o certo.',
      metadados: '14/08 · gerado pelo sistema',
      destaque: false,
      marcadores: [{ rotulo: 'sem destinatário', aparencia: 'neutra' }],
      status: { rotulo: 'Do sistema', aparencia: 'sistema' },
      faltam: '',
      acoes: [
        { identificador: 'horas_extras', rotulo: 'Ver em Horas extras', aparencia: 'discreta' },
        { identificador: 'resolver', rotulo: 'Resolver', aparencia: 'selecao' },
      ],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
    {
      identificador: 's3',
      versao: 0,
      tipo: 'sistema',
      titulo: 'Refechamento da #1015 gerou valor acima do pago',
      texto: 'A extra anterior foi cancelada e uma nova criada. A diferença se acerta por fora.',
      metadados: '13/08 · gerado pelo sistema',
      destaque: false,
      marcadores: [{ rotulo: 'valor maior', aparencia: 'neutra' }],
      status: { rotulo: 'Do sistema', aparencia: 'sistema' },
      faltam: '',
      acoes: [
        { identificador: 'horas_extras', rotulo: 'Ver em Horas extras', aparencia: 'discreta' },
        { identificador: 'resolver', rotulo: 'Resolver', aparencia: 'selecao' },
      ],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
  ],
  mensagemVazia: 'Nenhum aviso do sistema pendente.',
}

export const avisosArquivadosFixture: DadosAvisos = {
  ...avisosFixture,
  abas: [
    { identificador: 'ativos', rotulo: 'Publicados', selecionada: false },
    { identificador: 'sistema', rotulo: 'Do sistema', selecionada: false },
    { identificador: 'arquivados', rotulo: 'Arquivados', selecionada: true },
  ],
  avisos: [{
    ...avisosFixture.avisos[2],
    acoes: [{ identificador: 'restaurar', rotulo: 'Restaurar', aparencia: 'discreta' }],
  }],
  mensagemVazia: 'Nenhum aviso arquivado.',
}

// ADR 0066: a aba Lembretes do Administrador, com "Criar lembrete" aberto e o
// quadro Categorias com uma linha em edição.
export const avisosLembretesFixture: DadosAvisos = {
  ...avisosFixture,
  rotuloEscrever: 'Criar lembrete',
  abas: [
    { identificador: 'ativos', rotulo: 'Publicados', selecionada: false },
    { identificador: 'sistema', rotulo: 'Do sistema', selecionada: false },
    { identificador: 'lembretes', rotulo: 'Lembretes', selecionada: true },
    { identificador: 'arquivados', rotulo: 'Arquivados', selecionada: false },
  ],
  formularioLembrete: {
    texto: 'Pagar a gráfica',
    data: '2026-10-05',
    hoje: '2026-09-24',
    categorias: [
      { identificador: 'c1', rotulo: 'Pagamento de fornecedor', antecedencia: 3, selecionada: true },
      { identificador: 'c2', rotulo: 'Manutenção', antecedencia: 7, selecionada: false },
    ],
    antecedencia: '3',
    aviso: 'Aparece para a equipe em 02/10.',
    podeCriar: true,
  },
  categorias: {
    itens: [
      { identificador: 'c1', versao: 1, nome: 'Pagamento de fornecedor', antecedencia: 3, ativo: true, detalhe: 'avisa 3 dias antes', edicao: null },
      { identificador: 'c2', versao: 2, nome: 'Manutenção', antecedencia: 7, ativo: true, detalhe: 'avisa 7 dias antes', edicao: { nome: 'Manutenção', antecedencia: '5', podeSalvar: true } },
      { identificador: 'c3', versao: 3, nome: 'Contato', antecedencia: 1, ativo: false, detalhe: 'avisa 1 dia antes · desativada', edicao: null },
    ],
    novoNome: '',
    novaAntecedencia: '',
    podeCriar: false,
    mensagemVazia: 'Nenhuma categoria ainda. Crie a primeira quando um lembrete precisar dela.',
  },
  avisos: [
    {
      identificador: 'l1',
      versao: 1,
      tipo: 'lembrete',
      titulo: 'Pagar a gráfica',
      texto: 'Boleto na gaveta do balcão.',
      metadados: 'para 26/09 · avisa 3 dias antes',
      destaque: false,
      marcadores: [{ rotulo: 'Pagamento de fornecedor', aparencia: 'neutra' }],
      status: null,
      faltam: '',
      acoes: [{ identificador: 'concluir', rotulo: 'Concluir', aparencia: 'principal' }],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
    {
      identificador: 'l2',
      versao: 1,
      tipo: 'lembrete',
      titulo: 'Trocar o fundo do Acústico',
      texto: 'Pedir orçamento antes.',
      metadados: 'para 10/10 · avisa 7 dias antes',
      destaque: false,
      marcadores: [{ rotulo: 'Manutenção', aparencia: 'neutra' }],
      status: { rotulo: 'Aparece em 03/10', aparencia: 'discreta' },
      faltam: '',
      acoes: [{ identificador: 'concluir', rotulo: 'Concluir', aparencia: 'principal' }],
      leiturasAbertas: false,
      editando: null,
      avisoDaEdicao: '',
      leituras: [],
    },
  ],
  mensagemVazia: 'Nenhum lembrete aberto.',
  rodape: 'Cada lembrete aparece para a equipe a partir da antecedência, contada da data dele.',
}
