import type { BlocoTutorial, DadosTreinamento } from './Treinamento'

// Dados de exemplo no modelo do spec: tutorial em blocos de texto e foto. As
// Fichas Técnicas de verdade ainda não foram migradas (G3 de pendencias.md — o
// ADR 0030 diz que isso bloqueia o go-live, não o código).
const blocos: BlocoTutorial[] = [
  { identificador: 'b-1', tipo: 'texto', texto: 'Monte o tripé com as pernas abertas até o primeiro encaixe. A coluna central fica baixa: subir a coluna é o que derruba o conjunto.' },
  { identificador: 'b-2', tipo: 'foto', foto: '/midia/f1?t=exemplo', descricao: 'Foto do passo 2' },
  { identificador: 'b-3', tipo: 'texto', texto: 'Prenda o softbox pela haste, nunca pelo tecido. O anel de baioneta gira até travar com um clique.' },
  // Mídia expirada: o registro fica, o arquivo não (ADR 0036 §2).
  { identificador: 'b-4', tipo: 'foto', descricao: 'Foto do passo 4, indisponível' },
]

const equipamento = {
  identificador: 'cat-equipamento',
  nome: 'Equipamento',
  descricao: 'Montagem, guarda e conferência do que fica no estúdio.',
  contagem: '2 tutoriais',
  tutoriais: [
    { identificador: 'tut-softbox', titulo: 'Como armar o softbox', categoria: 'Equipamento', atualizado: 'atualizado em 12/08/2026', antigo: false, status: 'Publicado', blocos: '4 blocos', texto: 'Monte o tripé com as pernas abertas até o primeiro encaixe. Prenda o softbox pela haste, nunca pelo tecido. O difusor entra por último.' },
    { identificador: 'tut-tripe', titulo: 'Tripé: abrir, travar e guardar', categoria: 'Equipamento', atualizado: 'atualizado em 03/07/2026', antigo: false, status: 'Publicado', blocos: '6 blocos', texto: 'Abra as pernas até a trava e baixe a coluna central.' },
  ],
}

const atendimento = {
  identificador: 'cat-atendimento',
  nome: 'Atendimento',
  descricao: null,
  contagem: '1 tutorial',
  tutoriais: [
    { identificador: 'tut-recepcao', titulo: 'Receber o cliente do primeiro ensaio', categoria: 'Atendimento', atualizado: 'atualizado em 28/08/2026', antigo: false, status: 'Publicado', blocos: '1 bloco', texto: 'Confirme o nome na agenda e ofereça água antes do ensaio.' },
  ],
}

export const treinamentoFixture: DadosTreinamento = {
  hora: '09:40',
  data: '17 AGO 2026',
  turno: 'TH',
  subtitulo: 'Os tutoriais publicados, por categoria. Texto e foto — quem escreve é a administração.',
  busca: '',
  incluirArquivados: false,
  categorias: [equipamento, atendimento],
  total: 3,
  vazioTitulo: 'Nenhum tutorial publicado',
  vazioDescricao: 'Quando a administração publicar o primeiro tutorial, ele aparece aqui.',
  selecionado: null,
}

export const treinamentoAbertoFixture: DadosTreinamento = {
  ...treinamentoFixture,
  selecionado: {
    identificador: 'tut-softbox',
    titulo: 'Como armar o softbox',
    categoria: 'Equipamento',
    status: 'Publicado',
    atualizado: 'atualizado em 12/08/2026 por Helena',
    blocos,
  },
}

export const treinamentoSemBlocosFixture: DadosTreinamento = {
  ...treinamentoAbertoFixture,
  selecionado: { ...treinamentoAbertoFixture.selecionado!, blocos: [] },
}

export const treinamentoVazioFixture: DadosTreinamento = {
  ...treinamentoFixture,
  busca: 'refletor',
  categorias: [],
  total: 0,
  vazioTitulo: 'Nada encontrado',
  vazioDescricao: 'Nenhum título publicado bate com essa busca. Tente outra palavra, ou inclua os arquivados.',
}

export const treinamentoArquivadosFixture: DadosTreinamento = {
  ...treinamentoFixture,
  incluirArquivados: true,
  categorias: [{
    ...equipamento,
    tutoriais: [
      ...equipamento.tutoriais,
      { identificador: 'tut-antigo', titulo: 'Fundo infinito de papel', categoria: 'Equipamento', atualizado: 'atualizado em 14/02/2026', antigo: true, status: 'Arquivado', blocos: '3 blocos', texto: '' },
    ],
  }, atendimento],
  total: 4,
}

// ------------------------------------------------ a visão do Administrador (0089)
export const gestaoFixture = [
  { identificador: 'cat-equipamento', nome: 'Equipamento', descricao: 'Montagem, guarda e conferência do que fica no estúdio.', ativa: true, versao: 2, publicados: 2 },
  { identificador: 'cat-atendimento', nome: 'Atendimento', descricao: '', ativa: true, versao: 1, publicados: 1 },
  { identificador: 'cat-velha', nome: 'Câmeras antigas', descricao: '', ativa: false, versao: 4, publicados: 0 },
]

export const treinamentoAdminFixture: DadosTreinamento = {
  ...treinamentoFixture,
  subtitulo: 'Os tutoriais por categoria, rascunhos inclusive. Só a administração vê os rascunhos.',
  podeEditar: true,
  gestao: gestaoFixture,
  categorias: [{
    ...equipamento,
    tutoriais: [...equipamento.tutoriais,
      { identificador: 'tut-mesa', titulo: 'Ligar a mesa de som', categoria: 'Equipamento', atualizado: 'atualizado em 01/10/2026', antigo: false, status: 'Rascunho', blocos: '1 bloco', texto: '' }],
  }, atendimento],
  total: 4,
}

export const treinamentoAdminAbertoFixture: DadosTreinamento = {
  ...treinamentoAdminFixture,
  selecionado: {
    ...treinamentoAbertoFixture.selecionado!,
    edicao: {
      versao: 5,
      status: 'publicado',
      categoria: 'cat-equipamento',
      podeRestaurar: true,
      blocos: [
        { tipo: 'texto', texto: 'Monte o tripé.' },
        { tipo: 'foto', midiaId: 'm-1', foto: '/midia/m-1?t=x' },
        { tipo: 'texto', texto: 'Prenda o softbox pela haste.' },
      ],
    },
  },
}

export const treinamentoAdminRascunhoFixture: DadosTreinamento = {
  ...treinamentoAdminAbertoFixture,
  selecionado: {
    ...treinamentoAdminAbertoFixture.selecionado!,
    identificador: 'tut-mesa',
    titulo: 'Ligar a mesa de som',
    status: 'Rascunho',
    edicao: { versao: 2, status: 'rascunho', categoria: 'cat-equipamento', podeRestaurar: false, blocos: [{ tipo: 'texto', texto: 'Liga o estabilizador.' }] },
  },
}
