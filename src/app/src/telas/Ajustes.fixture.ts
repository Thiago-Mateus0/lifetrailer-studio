import type { DadosAjustes } from './Ajustes'

// Exemplo de apresentação do mockup Ajustes; não é fonte de verdade: PINs e auditoria reais vivem em data/.
export const ajustesFixture: DadosAjustes = {
  hora: '08:12', turno: 'JA', subtitulo: 'Administrador · consulta os PINs, alteração é do Sócio', podeEditar: true,
  pessoas: [{ identificador: 'jana', nome: 'Jana', papel: 'Sócia', nivel: 'administrador' }, { identificador: 'wyll', nome: 'Wyll', papel: 'Admin', nivel: 'administrador' }, { identificador: 'bia', nome: 'Bia', papel: 'Atendente', nivel: 'atendente' }],
  perfis: [{ identificador: 'socio', papel: 'Sócio', acesso: 'tudo + PINs' }, { identificador: 'admin', papel: 'Admin', acesso: 'aprova, tranca, configura' }, { identificador: 'atendente', papel: 'Atendente', acesso: 'opera o turno' }],
  auditoria: [{ identificador: 'log1', alvo: 'Bia', por: 'Jana', quando: 'ontem · 17:42' }], equipe: [{ identificador: 'jana', nome: 'Jana', papel: 'Sócia', ativo: true, versao: 1, souEu: true }, { identificador: 'bia', nome: 'Bia', papel: 'Atendente', ativo: true, versao: 4, souEu: false }, { identificador: 'caio', nome: 'Caio', papel: 'Atendente', ativo: false, versao: 2, souEu: false }], minhaSenha: true, acessos: [{ identificador: 'jana', nome: 'Jana', login: 'jana' }, { identificador: 'wyll', nome: 'Wyll', login: 'wyll' }], rotuloPines: 'somente leitura', rotuloPinesAparencia: 'normal', mensagemPermissao: 'Ajustes é exclusivo dos perfis com permissão de Admin. Entre com o PIN da Jana ou do Lifetrailer.', mensagemAuditoriaVazia: 'Nenhuma alteração registrada neste aparelho.', rodape: 'Recepção · Tablet 01 · v0.9.3',
}

export const ajustesVaziaFixture: DadosAjustes = { ...ajustesFixture, pessoas: [], perfis: [], auditoria: [] }
export const ajustesRestritaFixture: DadosAjustes = { ...ajustesFixture, podeEditar: false, subtitulo: '', rotuloPines: '', pessoas: [], acessos: [], equipe: [], minhaSenha: false }
export const ajustesGerenteFixture: DadosAjustes = { ...ajustesRestritaFixture, minhaSenha: true }
