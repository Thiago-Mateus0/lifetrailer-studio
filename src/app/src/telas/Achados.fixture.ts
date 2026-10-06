import type { DadosAchados, DetalheAchado, RegistroAchado } from './Achados'

// Dados de exemplo do mockup, não são fonte de verdade. Os números reais vivem em data/.
// Rótulos, contagens, datas, destaques e permissões já vêm preparados para apresentação.
export const achadosFixture: DadosAchados = {
  hora: '09:40',
  data: '17 AGO 2026',
  turno: 'JA',
  subtitulo: '4 itens guardados',
  abas: [
    { identificador: 'guardados', rotulo: 'Guardados', selecionada: true },
    { identificador: 'entregues', rotulo: 'Entregues', selecionada: false },
    { identificador: 'descartados', rotulo: 'Descartados', selecionada: false },
  ],
  achados: [
    { identificador: 'ac1', codigo: 'AC-104', descricao: 'Carteira preta', local: 'Estúdio 1', descricaoFoto: 'Foto de carteira preta', status: 'em_posse', rotuloStatus: '1 dia', destaque: 'neutro' },
    { identificador: 'ac2', codigo: 'AC-103', descricao: 'Chave com chaveiro de moto', local: 'Estúdio 2', descricaoFoto: 'Foto de chave com chaveiro de moto', status: 'em_posse', rotuloStatus: '3 dias', destaque: 'neutro' },
    { identificador: 'ac3', codigo: 'AC-102', descricao: 'Blusa cinza', local: 'Estúdio 1', descricaoFoto: 'Foto de blusa cinza', status: 'em_posse', rotuloStatus: '14 dias', destaque: 'neutro' },
    { identificador: 'ac4', codigo: 'AC-101', descricao: 'Guarda-chuva azul', local: 'Recepção', descricaoFoto: 'Foto de guarda-chuva azul', status: 'em_posse', rotuloStatus: '16 dias', destaque: 'neutro' },
  ],
  mensagemVazia: 'Nenhum item guardado.',
  rodape: 'A observação existe para não entregar item ao dono errado: pergunte antes de mostrar. Descarte só depois de 90 dias, e fica registrado quem descartou.',
}

export const achadosVazioFixture: DadosAchados = {
  ...achadosFixture,
  subtitulo: '0 itens guardados',
  achados: [],
}

const registro: RegistroAchado = {
  descricao: 'Carteira preta',
  // `YYYY-MM-DD`, do `<input type="date">`: vazia quer dizer hoje (ADR 0053 §3).
  data: '2026-08-17',
  cliente: 'Renata Alves',
  observacao: 'tem uma foto dentro',
  descricaoFoto: 'Foto do novo achado',
  estudios: [
    { identificador: 'es1', rotulo: 'Acustico', selecionado: true },
    { identificador: 'es2', rotulo: 'Branco', selecionado: false },
  ],
  lugares: [
    { identificador: 'Gaveta', rotulo: 'Gaveta', selecionado: true },
  ],
  aviso: 'A foto entra logo depois de guardar. Se ela não subir, o item fica marcado como "sem foto" até você anexar.',
  podeGuardar: true,
  // Um item já guardado no Acustico na mesma data do formulário: é a possível
  // duplicata. O do dia seguinte existe para provar que a data também conta.
  emGuarda: [
    { identificador: 'ac3', estudio: 'es1', data: '2026-08-17', rotulo: 'Blusa cinza · Gaveta A/P' },
    { identificador: 'ac2', estudio: 'es1', data: '2026-08-18', rotulo: 'Chave com chaveiro de moto · Com a Jana' },
    { identificador: 'ac4', estudio: '', data: '2026-08-17', rotulo: 'Guarda-chuva azul' },
  ],
  hoje: '2026-08-17',
  avisoDuplicata: 'Já tem item guardado deste estúdio nesta data. Confira se não é o mesmo antes de registrar de novo.',
}

export const achadosRegistroFixture: DadosAchados = { ...achadosFixture, registro }

export const achadosRegistroVazioFixture: DadosAchados = {
  ...achadosFixture,
  registro: {
    ...registro, descricao: '', data: '', cliente: '', observacao: '',
    estudios: registro.estudios.map((e) => ({ ...e, selecionado: false })),
    lugares: registro.lugares.map((l) => ({ ...l, selecionado: false })),
    podeGuardar: false,
  },
}

const selecionado: DetalheAchado = {
  ...achadosFixture.achados[0],
  // A versão que as duas saídas mandam de volta (ADR 0054): ela sobe quando a
  // foto entra, então o número aqui não é 1.
  versao: 4,
  linha: 'Cliente: Renata Alves · Estúdio 1 · gaveta a/p · obs: tem uma foto dentro',
  meta: '16/08 · registrado por Marcos',
  acoes: [
    { identificador: 'entregar', rotulo: 'Entregar', destaque: 'principal' },
    { identificador: 'doar', rotulo: 'Doar', destaque: 'secundario' },
  ],
  historico: ['Registrado 16/08 por Marcos — achado no Estúdio 1'],
}

export const achadosDetalheFixture: DadosAchados = { ...achadosFixture, selecionado }

// O detalhe com foto e item ainda em guarda, visto pela Jana: o único que
// oferece copiar e baixar (ADR 0075). O texto NÃO leva a observação nem o nome
// do cliente.
export const achadosCompartilharFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    // Imagem substituta de exemplo; nenhuma foto de cliente entra no fixture.
    foto: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Crect width="24" height="24" fill="none" stroke="currentColor"/%3E%3C/svg%3E',
    compartilhar: {
      rotulo: 'Copiar mensagem',
      baixarFoto: 'Baixar foto',
      texto: 'Carteira preta — achado 16/08 no Estúdio 1. Está guardado aqui no Lifetrailer Studio. Se for seu, responda esta mensagem que a gente combina a retirada.',
      aviso: 'Cole o texto na conversa do cliente no ManyChat e anexe a foto. Não escreva o detalhe que identifica o item — é ele que confirma o dono na hora da retirada.',
    },
  },
}

// Item registrado cuja foto não subiu: é o único estado que oferece "Anexar
// foto" (ADR 0053 §2).
export const achadosSemFotoFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    descricao: 'Casaco jeans',
    foto: undefined,
    status: 'aguardando_foto',
    rotuloStatus: 'sem foto',
    destaque: 'urgente',
    acoes: [],
    anexarFoto: { rotulo: 'Anexar foto' },
  },
}

export const achadosEntregaFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    entrega: {
      nomeRetirada: 'Renata Alves',
      podeConfirmar: true,
      aviso: 'Fica registrado que Jana entregou hoje 09:40. Confira o detalhe que identifica antes de devolver.',
    },
  },
}

export const achadosEntregaVaziaFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    entrega: {
      nomeRetirada: '',
      podeConfirmar: false,
      aviso: 'Fica registrado que Jana entregou hoje 09:40. Confira o detalhe que identifica antes de devolver.',
    },
  },
}

// A gêmea da entrega (ADR 0054 §3): um campo, um aviso, a confirmação.
export const achadosDoacaoFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    doacao: {
      destino: 'Bazar da Paróquia',
      podeConfirmar: true,
      aviso: 'Fica registrado que Jana doou hoje 09:40. A doação não se desfaz — confira o destino antes de confirmar.',
    },
  },
}

export const achadosDoacaoVaziaFixture: DadosAchados = {
  ...achadosFixture,
  selecionado: {
    ...selecionado,
    doacao: {
      destino: '',
      podeConfirmar: false,
      aviso: 'Fica registrado que Jana doou hoje 09:40. A doação não se desfaz — confira o destino antes de confirmar.',
    },
  },
}

export const achadosEntreguesFixture: DadosAchados = {
  ...achadosFixture,
  abas: [
    { identificador: 'guardados', rotulo: 'Guardados', selecionada: false },
    { identificador: 'entregues', rotulo: 'Entregues', selecionada: true },
    { identificador: 'descartados', rotulo: 'Descartados', selecionada: false },
  ],
  achados: [{
    identificador: 'ac0', codigo: 'AC-098', descricao: 'Óculos de sol', local: 'Estúdio 3',
    // Imagem substituta de exemplo; nenhuma foto de cliente é incorporada ao fixture.
    foto: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath fill="none" stroke="currentColor" d="M3 12h18M3 12a4 4 0 1 0 8 0M13 12a4 4 0 1 0 8 0"/%3E%3C/svg%3E',
    descricaoFoto: 'Foto de óculos de sol', status: 'devolvido', rotuloStatus: 'Entregue', destaque: 'normal',
  }],
  mensagemVazia: 'Nada entregue ainda.',
}
