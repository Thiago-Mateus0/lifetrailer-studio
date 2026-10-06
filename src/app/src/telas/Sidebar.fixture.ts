import type { DadosSidebar } from './Sidebar'

// Exemplos de apresentação de Sidebar.dc.html; não representam permissões reais.
export const sidebarFixture: DadosSidebar = {
  contexto: 'Menu',
  hora: '14:42',
  logo: new URL('../../../../docs/design/mockups/fase3/logo-lifetrailer-dark.png', import.meta.url).href,
  descricao: 'Gestão operacional',
  expandida: true,
  ativo: 'comanda',
  grupoAberto: 'checklist',
  itens: [
    { identificador: 'inicio', codigo: 'IN', rotulo: 'Início' },
    { identificador: 'comanda', codigo: 'CM', rotulo: 'Comanda' },
    { identificador: 'checklist', codigo: 'CK', rotulo: 'Checklist', contador: 4, destaque: 'urgente', subitens: [
      { identificador: 'checklist-entrada', rotulo: 'Entrada' },
      { identificador: 'checklist-saida', rotulo: 'Saída' },
    ] },
    { identificador: 'estoque', codigo: 'ES', rotulo: 'Estoque', contador: 3, destaque: 'urgente', subitens: [
      { identificador: 'estoque-conferir', rotulo: 'Conferir' },
      { identificador: 'estoque-compra', rotulo: 'Compra' },
      { identificador: 'estoque-bomboniere', rotulo: 'Bomboniere' },
    ] },
    { identificador: 'escala', codigo: 'EC', rotulo: 'Escala' },
    { identificador: 'horas', codigo: 'HE', rotulo: 'Horas extras', subitens: [
      { identificador: 'horas-pendentes', rotulo: 'Pendentes' },
      { identificador: 'horas-pagas', rotulo: 'Pagas' },
      { identificador: 'horas-canceladas', rotulo: 'Canceladas' },
    ] },
    { identificador: 'avisos', codigo: 'AV', rotulo: 'Avisos', contador: 3, destaque: 'atencao', subitens: [
      { identificador: 'avisos-ativos', rotulo: 'Ativos' },
      { identificador: 'avisos-sistema', rotulo: 'Do sistema' },
      { identificador: 'avisos-lembretes', rotulo: 'Lembretes' },
      { identificador: 'avisos-arquivados', rotulo: 'Arquivados' },
    ] },
    { identificador: 'achados', codigo: 'AC', rotulo: 'Achados', subitens: [
      { identificador: 'achados-guardados', rotulo: 'Guardados' },
      { identificador: 'achados-entregues', rotulo: 'Entregues' },
      { identificador: 'achados-descartados', rotulo: 'Descartados' },
    ] },
    { identificador: 'treinamento', codigo: 'TR', rotulo: 'Treinamento' },
    { identificador: 'ajustes', codigo: 'AJ', rotulo: 'Ajustes', subitens: [
      { identificador: 'ajustes-pins', rotulo: 'PINs de acesso' },
      { identificador: 'ajustes-perfis', rotulo: 'Perfis e acessos' },
    ] },
  ],
  totalUrgencias: 2,
  urgencias: [
    { identificador: 'checklist', titulo: 'Checklist de entrada', detalhe: '4 itens · limite 10:00' },
    { identificador: 'estoque', titulo: 'Estoque acabando', detalhe: 'propés · papel higiênico' },
  ],
  usuario: { nome: 'Jana', iniciais: 'JA', papel: 'Admin · acesso total' },
}

export const sidebarVaziaFixture: DadosSidebar = {
  ...sidebarFixture,
  ativo: '',
  grupoAberto: undefined,
  itens: [],
  totalUrgencias: 0,
  urgencias: [],
  usuario: null,
}

export const sidebarRecolhidaFixture: DadosSidebar = { ...sidebarFixture, expandida: false }
