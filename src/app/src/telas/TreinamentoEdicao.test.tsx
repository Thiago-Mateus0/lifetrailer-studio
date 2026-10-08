import { fireEvent as dispararEvento, render as renderizar, screen as tela, waitFor as aguardar, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao } from 'vitest'

import { Treinamento } from './Treinamento'
import {
  treinamentoAbertoFixture, treinamentoAdminAbertoFixture, treinamentoAdminFixture,
  treinamentoAdminRascunhoFixture, treinamentoFixture,
} from './Treinamento.fixture'

const ok = (texto = 'ok') => simulacao.fn().mockResolvedValue({ texto, erro: false })

testar('o Atendente não vê nada de escrita', () => {
  renderizar(<Treinamento dados={treinamentoAbertoFixture} />)
  esperar(tela.queryByRole('button', { name: 'Editar' })).toBeNull()
  esperar(tela.queryByRole('button', { name: 'Publicar' })).toBeNull()
  renderizar(<Treinamento dados={treinamentoFixture} />)
  esperar(tela.queryByRole('button', { name: 'Novo tutorial' })).toBeNull()
  esperar(tela.queryByRole('button', { name: 'Categorias' })).toBeNull()
})

testar('o Admin vê o rascunho marcado na lista', () => {
  renderizar(<Treinamento dados={treinamentoAdminFixture} pasta="cat-equipamento" />)
  esperar(tela.getByText('Rascunho · só a administração vê')).toBeVisible()
})

testar('novo tutorial: cria na categoria escolhida e abre no editor', async () => {
  const aoCriarTutorial = simulacao.fn().mockResolvedValue({ texto: 'Rascunho criado.', erro: false, id: 'tut-novo' })
  const aoAbrirTutorial = simulacao.fn()
  renderizar(<Treinamento dados={treinamentoAdminFixture} aoCriarTutorial={aoCriarTutorial} aoAbrirTutorial={aoAbrirTutorial} />)

  dispararEvento.click(tela.getByRole('button', { name: 'Novo tutorial' }))
  const painel = dentroDe(tela.getByRole('dialog', { name: 'Novo tutorial' }))
  // Categoria desativada não é opção para tutorial novo.
  esperar(painel.queryByRole('option', { name: 'Câmeras antigas' })).toBeNull()
  dispararEvento.change(painel.getByLabelText('Categoria'), { target: { value: 'cat-atendimento' } })
  dispararEvento.change(painel.getByLabelText('Título'), { target: { value: 'Receber pelo portão' } })
  dispararEvento.click(painel.getByRole('button', { name: 'Criar e editar' }))

  await aguardar(() => esperar(aoAbrirTutorial).toHaveBeenCalledWith('tut-novo'))
  esperar(aoCriarTutorial).toHaveBeenCalledWith('cat-atendimento', 'Receber pelo portão')
})

testar('editar: muda texto, reordena, remove e salva a lista inteira', async () => {
  const aoSalvarTutorial = ok('Tutorial salvo.')
  renderizar(<Treinamento dados={treinamentoAdminAbertoFixture} aoSalvarTutorial={aoSalvarTutorial} />)

  dispararEvento.click(tela.getByRole('button', { name: 'Editar' }))
  dispararEvento.change(tela.getByLabelText('Texto do bloco 1'), { target: { value: 'Monte o tripé baixo.' } })
  dispararEvento.click(tela.getByRole('button', { name: 'Descer bloco 1' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Remover bloco 3' }))
  dispararEvento.click(tela.getByRole('button', { name: '+ Texto' }))
  dispararEvento.change(tela.getByLabelText('Texto do bloco 3'), { target: { value: 'Guarde a bolsa.' } })
  dispararEvento.click(tela.getByRole('button', { name: 'Salvar' }))

  await aguardar(() => esperar(aoSalvarTutorial).toHaveBeenCalledOnce())
  esperar(aoSalvarTutorial).toHaveBeenCalledWith('tut-softbox', 5, 'cat-equipamento', 'Como armar o softbox', [
    { tipo: 'foto', midiaId: 'm-1', foto: '/midia/m-1?t=x' },
    { tipo: 'texto', texto: 'Monte o tripé baixo.' },
    { tipo: 'texto', texto: 'Guarde a bolsa.' },
  ])
})

testar('editar: bloco de texto vazio não sai da tela', () => {
  const aoSalvarTutorial = ok()
  renderizar(<Treinamento dados={treinamentoAdminAbertoFixture} aoSalvarTutorial={aoSalvarTutorial} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Editar' }))
  dispararEvento.click(tela.getByRole('button', { name: '+ Texto' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Salvar' }))
  esperar(tela.getByRole('alert')).toHaveTextContent('bloco de texto vazio')
  esperar(aoSalvarTutorial).not.toHaveBeenCalled()
})

testar('editar: Cancelar descarta e volta para a leitura', () => {
  const aoSalvarTutorial = ok()
  renderizar(<Treinamento dados={treinamentoAdminAbertoFixture} aoSalvarTutorial={aoSalvarTutorial} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Editar' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Remover bloco 1' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' }))
  esperar(tela.getByRole('button', { name: 'Editar' })).toBeVisible()
  esperar(aoSalvarTutorial).not.toHaveBeenCalled()
})

testar('foto: sobe na hora e entra como bloco', async () => {
  const aoEnviarFotoDoTutorial = simulacao.fn().mockResolvedValue({ midiaId: 'm-9', foto: 'blob:x' })
  const aoSalvarTutorial = ok()
  renderizar(<Treinamento dados={treinamentoAdminRascunhoFixture} aoEnviarFotoDoTutorial={aoEnviarFotoDoTutorial} aoSalvarTutorial={aoSalvarTutorial} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Editar' }))

  const arquivo = new File(['x'], 'mesa.jpg', { type: 'image/jpeg' })
  dispararEvento.change(tela.getByLabelText('Adicionar foto'), { target: { files: [arquivo] } })
  esperar(await tela.findByRole('img', { name: 'Foto do bloco 2' })).toBeVisible()
  esperar(aoEnviarFotoDoTutorial).toHaveBeenCalledWith('tut-mesa', arquivo)

  dispararEvento.click(tela.getByRole('button', { name: 'Salvar' }))
  await aguardar(() => esperar(aoSalvarTutorial).toHaveBeenCalled())
  esperar(aoSalvarTutorial.mock.calls[0][4]).toEqual([
    { tipo: 'texto', texto: 'Liga o estabilizador.' },
    { tipo: 'foto', midiaId: 'm-9', foto: 'blob:x' },
  ])
})

testar('as transições do spec: Rascunho só publica; Publicado despublica ou arquiva', async () => {
  const aoMudarStatusDoTutorial = ok('Publicado: a equipe já vê.')
  renderizar(<Treinamento dados={treinamentoAdminRascunhoFixture} aoMudarStatusDoTutorial={aoMudarStatusDoTutorial} />)
  esperar(tela.queryByRole('button', { name: 'Arquivar' })).toBeNull()
  dispararEvento.click(tela.getByRole('button', { name: 'Publicar' }))
  esperar(await tela.findByRole('status')).toHaveTextContent('Publicado')
  esperar(aoMudarStatusDoTutorial).toHaveBeenCalledWith('tut-mesa', 2, 'publicado')

  renderizar(<Treinamento dados={treinamentoAdminAbertoFixture} />)
  const acoes = dentroDe(tela.getAllByRole('group', { name: 'Ações de Como armar o softbox' }).at(-1)!)
  esperar(acoes.getByRole('button', { name: 'Despublicar' })).toBeVisible()
  esperar(acoes.getByRole('button', { name: 'Arquivar' })).toBeVisible()
  esperar(acoes.getByRole('button', { name: 'Restaurar versão anterior' })).toBeVisible()
})

testar('recusa do banco aparece na própria ação', async () => {
  const aoMudarStatusDoTutorial = simulacao.fn().mockResolvedValue({ texto: 'publicar exige ao menos um bloco', erro: true })
  renderizar(<Treinamento dados={treinamentoAdminRascunhoFixture} aoMudarStatusDoTutorial={aoMudarStatusDoTutorial} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Publicar' }))
  esperar(await tela.findByRole('alert')).toHaveTextContent('publicar exige ao menos um bloco')
})

testar('categorias: cria, renomeia e desativa', async () => {
  const aoCriarCategoria = ok('Categoria criada.')
  const aoAlterarCategoria = ok('Categoria salva.')
  renderizar(<Treinamento dados={treinamentoAdminFixture} aoCriarCategoria={aoCriarCategoria} aoAlterarCategoria={aoAlterarCategoria} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Categorias' }))
  const painel = dentroDe(tela.getByRole('dialog', { name: 'Categorias' }))

  dispararEvento.change(painel.getByLabelText('Nova categoria'), { target: { value: 'Fichas Técnicas' } })
  dispararEvento.click(painel.getByRole('button', { name: 'Criar categoria' }))
  await aguardar(() => esperar(aoCriarCategoria).toHaveBeenCalledWith('Fichas Técnicas', ''))

  const atendimento = dentroDe(painel.getByRole('listitem', { name: 'Atendimento' }))
  dispararEvento.click(atendimento.getByRole('button', { name: 'Desativar' }))
  await aguardar(() => esperar(aoAlterarCategoria).toHaveBeenCalledWith('cat-atendimento', 1, 'Atendimento', '', false))

  const velha = dentroDe(painel.getByRole('listitem', { name: 'Câmeras antigas' }))
  esperar(velha.getByRole('button', { name: 'Reativar' })).toBeVisible()
})
