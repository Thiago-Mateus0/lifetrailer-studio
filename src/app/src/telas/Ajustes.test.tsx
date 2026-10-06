import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao } from 'vitest'
import { Ajustes } from './Ajustes'
import { ajustesFixture, ajustesGerenteFixture, ajustesRestritaFixture, ajustesVaziaFixture } from './Ajustes.fixture'

const abrir = (secao: string) => dispararEvento.click(dentroDe(tela.getByRole('navigation', { name: 'Seções dos ajustes' })).getByRole('button', { name: secao }))

testar('abre na Equipe, não no PIN, e mostra uma seção por vez', () => {
  renderizar(<Ajustes dados={ajustesFixture} />)
  esperar(tela.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
  esperar(tela.getByRole('button', { name: 'Equipe' })).toHaveAttribute('aria-current', 'page')
  esperar(tela.getByRole('region', { name: 'Equipe' })).toBeVisible()
  esperar(tela.queryByRole('region', { name: 'PINs de acesso' })).toBeNull()

  abrir('PINs de acesso')
  esperar(tela.getByRole('button', { name: 'PINs de acesso' })).toHaveAttribute('aria-current', 'page')
  esperar(tela.queryByRole('region', { name: 'Equipe' })).toBeNull()
})

testar('cada seção mostra o seu: PINs só de Atendente, perfis, histórico e o tablet', () => {
  renderizar(<Ajustes dados={ajustesFixture} />)
  abrir('PINs de acesso')
  const pines = dentroDe(tela.getByRole('region', { name: 'PINs de acesso' }))
  // ADR 0049: quem entra por senha não tem PIN, então nem aparece aqui.
  for (const pessoa of ajustesFixture.pessoas) {
    if (pessoa.nivel === 'atendente') esperar(pines.getByRole('button', { name: `Trocar PIN de ${pessoa.nome}` })).toBeVisible()
    else esperar(pines.queryByRole('group', { name: pessoa.nome })).toBeNull()
  }
  abrir('Perfis e acessos')
  esperar(tela.getByRole('region', { name: 'Perfis e acessos' })).toHaveTextContent(ajustesFixture.perfis[0].papel)
  abrir('Histórico de PIN')
  esperar(tela.getByRole('region', { name: 'Histórico de PIN' })).toHaveTextContent(ajustesFixture.auditoria[0].alvo)
  abrir('Sobre este tablet')
  const sobre = tela.getByRole('region', { name: 'Sobre este tablet' })
  for (const parte of ajustesFixture.rodape.split(' · ')) esperar(sobre).toHaveTextContent(parte)
})

testar('renderiza vazios e acesso restrito', () => {
  renderizar(<Ajustes dados={ajustesVaziaFixture} />)
  abrir('PINs de acesso'); esperar(tela.getByText('Nenhum Atendente cadastrado.')).toBeVisible()
  abrir('Perfis e acessos'); esperar(tela.getByText('Nenhum perfil cadastrado.')).toBeVisible()
  abrir('Histórico de PIN'); esperar(tela.getByText(ajustesVaziaFixture.mensagemAuditoriaVazia)).toBeVisible()
  renderizar(<Ajustes dados={ajustesRestritaFixture} />)
  esperar(tela.getByRole('region', { name: 'Acesso restrito' })).toHaveTextContent(ajustesRestritaFixture.mensagemPermissao)
  esperar(tela.getByRole('button', { name: 'Ir para a entrada' })).toBeVisible()
})

testar('a troca de PIN chega com a pessoa e o PIN; a entrada continua no restrito', async () => {
  const aoTrocarPin = simulacao.fn().mockResolvedValue({ texto: 'PIN de Bia trocado.', erro: false }); const aoIrParaEntrada = simulacao.fn()
  renderizar(<Ajustes dados={ajustesFixture} aoTrocarPin={aoTrocarPin} aoIrParaEntrada={aoIrParaEntrada} />)
  abrir('PINs de acesso')
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Bia' }))
  dispararEvento.change(tela.getByLabelText('Digite o PIN novo de Bia'), { target: { value: '4721' } })
  dispararEvento.change(tela.getByLabelText('Repita o PIN novo de Bia'), { target: { value: '4721' } })
  esperar(await tela.findByRole('status')).toHaveTextContent('PIN de Bia trocado.')
  esperar(aoTrocarPin).toHaveBeenCalledWith('bia', '4721')
  renderizar(<Ajustes dados={ajustesRestritaFixture} aoIrParaEntrada={aoIrParaEntrada} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Ir para a entrada' })); esperar(aoIrParaEntrada).toHaveBeenCalledOnce()
})

// Issue #220. A gerente recebe a tela restrita e ainda assim troca a própria senha.
testar('minha senha: a tela restrita também deixa trocar a própria, e manda atual e nova', async () => {
  const trocar = simulacao.fn().mockResolvedValue({ texto: 'Senha trocada.', erro: false })
  renderizar(<Ajustes dados={ajustesGerenteFixture} aoTrocarMinhaSenha={trocar} />)
  const caixa = dentroDe(tela.getByRole('region', { name: 'Minha senha' }))

  dispararEvento.change(caixa.getByLabelText('Senha atual'), { target: { value: 'a-senha-de-hoje' } })
  dispararEvento.change(caixa.getByLabelText('Senha nova'), { target: { value: 'a-senha-de-amanha' } })
  dispararEvento.change(caixa.getByLabelText('Repita a senha nova'), { target: { value: 'a-senha-de-amanha' } })
  dispararEvento.click(caixa.getByRole('button', { name: 'Trocar senha' }))

  esperar(trocar).toHaveBeenCalledWith('a-senha-de-hoje', 'a-senha-de-amanha')
  esperar(await caixa.findByText('Senha trocada.')).toBeVisible()
  esperar(caixa.getByLabelText('Senha atual')).toHaveValue('')
})

testar('minha senha: nova curta ou diferente da repetida nem sai da tela', () => {
  const trocar = simulacao.fn()
  renderizar(<Ajustes dados={ajustesGerenteFixture} aoTrocarMinhaSenha={trocar} />)
  const caixa = dentroDe(tela.getByRole('region', { name: 'Minha senha' }))

  dispararEvento.change(caixa.getByLabelText('Senha atual'), { target: { value: 'a-senha-de-hoje' } })
  dispararEvento.change(caixa.getByLabelText('Senha nova'), { target: { value: 'curta' } })
  dispararEvento.change(caixa.getByLabelText('Repita a senha nova'), { target: { value: 'curta' } })
  dispararEvento.click(caixa.getByRole('button', { name: 'Trocar senha' }))
  esperar(caixa.getByRole('alert')).toHaveTextContent('pelo menos 12')

  dispararEvento.change(caixa.getByLabelText('Senha nova'), { target: { value: 'a-senha-de-amanha' } })
  dispararEvento.change(caixa.getByLabelText('Repita a senha nova'), { target: { value: 'outra-senha-qualquer' } })
  dispararEvento.click(caixa.getByRole('button', { name: 'Trocar senha' }))
  esperar(caixa.getByRole('alert')).toHaveTextContent('não são iguais')
  esperar(trocar).not.toHaveBeenCalled()
})

testar('quem não entra por senha não vê a caixa de senha', () => {
  renderizar(<Ajustes dados={ajustesRestritaFixture} />)
  esperar(tela.queryByRole('region', { name: 'Minha senha' })).toBeNull()
  esperar(tela.queryByRole('region', { name: 'Senha de login' })).toBeNull()
})

testar('senha de login: o sócio escolhe a pessoa, o login vem preenchido e vai com a senha nova', () => {
  const redefinir = simulacao.fn().mockResolvedValue({ texto: 'Senha de Wyll redefinida.', erro: false })
  renderizar(<Ajustes dados={ajustesFixture} aoRedefinirSenha={redefinir} />)
  abrir('Senhas')
  const caixa = dentroDe(tela.getByRole('region', { name: 'Senha de login' }))

  dispararEvento.change(caixa.getByLabelText('Pessoa'), { target: { value: 'wyll' } })
  esperar(caixa.getByLabelText('Login')).toHaveValue('wyll')
  dispararEvento.change(caixa.getByLabelText('Senha nova'), { target: { value: 'senha-provisoria-1' } })
  dispararEvento.click(caixa.getByRole('button', { name: 'Redefinir senha' }))

  esperar(redefinir).toHaveBeenCalledWith('wyll', 'wyll', 'senha-provisoria-1')
})

// Issue #216. Desativar solta os turnos futuros da pessoa: pede um segundo toque.
testar('equipe: desativar pede confirmação e manda pessoa, estado e versão', async () => {
  const definir = simulacao.fn().mockResolvedValue({ texto: 'Bia desativada.', erro: false })
  renderizar(<Ajustes dados={ajustesFixture} aoDefinirAtivo={definir} />)
  const equipe = dentroDe(tela.getByRole('region', { name: 'Equipe' }))
  const bia = dentroDe(equipe.getByRole('group', { name: 'Bia' }))

  dispararEvento.click(bia.getByRole('button', { name: 'Desativar' }))
  esperar(definir).not.toHaveBeenCalled()
  esperar(bia.getByText(/turnos futuros/)).toBeVisible()
  dispararEvento.click(bia.getByRole('button', { name: 'Confirmar desativar' }))
  esperar(definir).toHaveBeenCalledWith('bia', false, 4)
  esperar(await equipe.findByText('Bia desativada.')).toBeVisible()
})

testar('equipe: quem está desativado tem Reativar, e o próprio sócio não tem botão', () => {
  const definir = simulacao.fn().mockResolvedValue({ texto: 'ok', erro: false })
  renderizar(<Ajustes dados={ajustesFixture} aoDefinirAtivo={definir} />)
  const equipe = dentroDe(tela.getByRole('region', { name: 'Equipe' }))

  dispararEvento.click(dentroDe(equipe.getByRole('group', { name: 'Caio' })).getByRole('button', { name: 'Reativar' }))
  esperar(definir).toHaveBeenCalledWith('caio', true, 2)
  esperar(dentroDe(equipe.getByRole('group', { name: 'Jana' })).queryByRole('button')).toBeNull()
})

testar('equipe: cadastrar Atendente pede PIN; Gerente vai sem PIN', () => {
  const cadastrar = simulacao.fn().mockResolvedValue({ texto: 'Cadastrado.', erro: false })
  renderizar(<Ajustes dados={ajustesFixture} aoCadastrarColaborador={cadastrar} />)
  const equipe = dentroDe(tela.getByRole('region', { name: 'Equipe' }))

  dispararEvento.change(equipe.getByLabelText('Nome'), { target: { value: 'Duda' } })
  dispararEvento.change(equipe.getByLabelText('Nível'), { target: { value: 'atendente' } })
  // PIN fácil não sai da tela (0088 recusa no banco também), e o campo é de senha.
  esperar((equipe.getByLabelText('PIN') as HTMLInputElement).type).toBe('password')
  dispararEvento.change(equipe.getByLabelText('PIN'), { target: { value: '4321' } })
  dispararEvento.click(equipe.getByRole('button', { name: 'Cadastrar' }))
  esperar(equipe.getByRole('alert')).toHaveTextContent('Sequência')
  esperar(cadastrar).not.toHaveBeenCalled()
  dispararEvento.change(equipe.getByLabelText('PIN'), { target: { value: '4721' } })
  dispararEvento.click(equipe.getByRole('button', { name: 'Cadastrar' }))
  esperar(cadastrar).toHaveBeenLastCalledWith('Duda', 'atendente', false, '4721')

  dispararEvento.change(equipe.getByLabelText('Nome'), { target: { value: 'Rafa' } })
  dispararEvento.change(equipe.getByLabelText('Nível'), { target: { value: 'gerente' } })
  esperar(equipe.queryByLabelText('PIN')).toBeNull()
  dispararEvento.click(equipe.getByRole('button', { name: 'Cadastrar' }))
  esperar(cadastrar).toHaveBeenLastCalledWith('Rafa', 'administrador', false, null)
})

testar('equipe: só o sócio vê o quadro', () => {
  renderizar(<Ajustes dados={ajustesGerenteFixture} />)
  esperar(tela.queryByRole('region', { name: 'Equipe' })).toBeNull()
})
