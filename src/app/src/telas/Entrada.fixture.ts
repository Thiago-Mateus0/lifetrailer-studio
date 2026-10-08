import type { DadosEntrada, TeclaEntrada } from './Entrada'

const pessoas: DadosEntrada['pessoas'] = [
  { identificador: 'thiago', nome: 'Thiago', papel: 'Atendente' },
  { identificador: 'paulo', nome: 'Paulo', papel: 'Atendente' },
  { identificador: 'marcos', nome: 'Marcos', papel: 'Atendente' },
  { identificador: 'helena', nome: 'Helena', papel: 'Admin' },
  { identificador: 'lifetrailer', nome: 'Lifetrailer', papel: 'Sócios' },
]

const teclas: TeclaEntrada[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((rotulo) => ({
    identificador: rotulo,
    rotulo,
    tipo: 'numero' as const,
  })),
  { identificador: 'limpar', rotulo: 'limpar', tipo: 'acao' },
  { identificador: '0', rotulo: '0', tipo: 'numero' },
  { identificador: 'apagar', rotulo: '←', descricao: 'Apagar último dígito', tipo: 'acao' },
]

const pontos = [
  { identificador: 'primeiro', preenchido: false },
  { identificador: 'segundo', preenchido: false },
  { identificador: 'terceiro', preenchido: false },
  { identificador: 'quarto', preenchido: false },
]

export const entradaFixture: DadosEntrada = {
  hora: '08:12',
  logo: new URL('../../../../docs/design/mockups/fase3/logo-lifetrailer-transparent.png', import.meta.url).href,
  local: 'Recepção',
  aparelho: 'Tablet 01',
  data: '17 AGO 2026',
  pessoas,
  exibicao: { etapa: 'quem' },
}

export const entradaVaziaFixture: DadosEntrada = {
  ...entradaFixture,
  pessoas: [],
}

const pinNormal = {
  etapa: 'pin' as const,
  pessoa: pessoas[0],
  situacao: 'normal' as const,
  pontos,
  descricaoPontos: 'Nenhum dígito preenchido',
  mensagem: 'Quatro dígitos',
  teclas,
  dica: '1122',
}

export const entradaPinFixture: DadosEntrada = {
  ...entradaFixture,
  exibicao: pinNormal,
}

export const entradaPinPreenchidoFixture: DadosEntrada = {
  ...entradaFixture,
  exibicao: {
    ...pinNormal,
    pontos: [
      { identificador: 'primeiro', preenchido: true },
      { identificador: 'segundo', preenchido: true },
      { identificador: 'terceiro', preenchido: false },
      { identificador: 'quarto', preenchido: false },
    ],
    descricaoPontos: 'Dois dígitos preenchidos',
  },
}

export const entradaPinIncorretoFixture: DadosEntrada = {
  ...entradaFixture,
  exibicao: {
    ...pinNormal,
    situacao: 'incorreto',
    mensagem: 'PIN incorreto · 2 tentativas restantes',
  },
}

export const entradaBloqueadaFixture: DadosEntrada = {
  ...entradaFixture,
  exibicao: {
    ...pinNormal,
    situacao: 'bloqueado',
    mensagem: 'Bloqueado por 60s',
    teclas: teclas.map((tecla) => ({ ...tecla, desativada: tecla.tipo === 'numero' })),
  },
}

export const entradaAbertaFixture: DadosEntrada = {
  ...entradaFixture,
  exibicao: { etapa: 'aberto', pessoa: pessoas[0] },
}
