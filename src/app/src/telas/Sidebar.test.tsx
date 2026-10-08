import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao } from 'vitest'

import { Sidebar } from './Sidebar'
import { sidebarFixture, sidebarRecolhidaFixture, sidebarVaziaFixture } from './Sidebar.fixture'

testar('renderiza menu, contadores, urgências e perfil com os dados do fixture', () => {
  renderizar(<Sidebar dados={sidebarFixture} />)
  const menu = dentroDe(tela.getByRole('navigation', { name: 'Menu principal' }))

  esperar(menu.getByRole('img', { name: 'Lifetrailer Studio' })).toHaveAttribute('src', sidebarFixture.logo)
  esperar(menu.getByText(sidebarFixture.descricao)).toBeVisible()
  for (const item of sidebarFixture.itens) {
    const botao = menu.getByRole('button', { name: new RegExp(item.rotulo) })
    esperar(botao).toBeVisible()
    if (item.contador !== undefined) esperar(botao).toHaveTextContent(String(item.contador))
  }
  const urgencias = tela.getByRole('region', { name: 'Urgências' })
  esperar(urgencias).toHaveTextContent(String(sidebarFixture.totalUrgencias))
  for (const urgencia of sidebarFixture.urgencias) {
    esperar(urgencias).toHaveTextContent(urgencia.titulo)
    esperar(urgencias).toHaveTextContent(urgencia.detalhe)
  }
  const perfil = menu.getByRole('button', { name: /Helena/ })
  esperar(perfil).toHaveTextContent(sidebarFixture.usuario!.papel)
  esperar(perfil).toHaveTextContent(sidebarFixture.usuario!.iniciais)
})

testar('inclui o contexto e a hora na Moldura e recebe o conteúdo da tela', () => {
  renderizar(<Sidebar dados={sidebarFixture}><h1>Conteúdo da tela</h1></Sidebar>)
  esperar(tela.getByRole('banner')).toHaveTextContent(sidebarFixture.contexto)
  esperar(tela.getByRole('banner')).toHaveTextContent(sidebarFixture.hora)
  esperar(tela.getByRole('main')).toContainElement(tela.getByRole('heading', { name: 'Conteúdo da tela' }))
})

testar('explica a ausência de módulos, urgências e usuário no fixture vazio', () => {
  renderizar(<Sidebar dados={sidebarVaziaFixture} />)
  esperar(tela.getByText('Nenhum módulo disponível neste menu.')).toBeVisible()
  esperar(tela.getByText('Nenhuma urgência agora.')).toBeVisible()
  esperar(tela.getByRole('button', { name: 'Ninguém autenticado Entre com seu PIN' })).toBeVisible()
  esperar(tela.queryByText(sidebarFixture.urgencias[0].titulo)).not.toBeInTheDocument()
})

testar('recolhe o menu sem deixar controles ocultos acessíveis', () => {
  renderizar(<Sidebar dados={sidebarRecolhidaFixture} />)
  esperar(tela.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false')
  esperar(tela.queryByRole('button', { name: 'Comanda' })).not.toBeInTheDocument()
  esperar(tela.queryByRole('region', { name: 'Urgências' })).not.toBeInTheDocument()
})

testar('mostra o grupo recebido e comunica ações ao componente pai', () => {
  const aoNavegar = simulacao.fn()
  const aoAlternarGrupo = simulacao.fn()
  const aoAlternarMenu = simulacao.fn()
  const aoFecharMenu = simulacao.fn()
  renderizar(<Sidebar dados={sidebarFixture} aoNavegar={aoNavegar} aoAlternarGrupo={aoAlternarGrupo} aoAlternarMenu={aoAlternarMenu} aoFecharMenu={aoFecharMenu} />)
  const checklist = tela.getByRole('button', { name: /Checklist/ })
  esperar(checklist).toHaveAttribute('aria-expanded', 'true')
  dispararEvento.click(tela.getByRole('button', { name: 'Entrada' }))
  esperar(aoNavegar).toHaveBeenCalledWith('checklist-entrada')
  dispararEvento.click(checklist)
  esperar(aoAlternarGrupo).toHaveBeenCalledWith('checklist')
  dispararEvento.click(tela.getByRole('button', { name: 'Recolher menu' }))
  esperar(aoAlternarMenu).toHaveBeenCalledOnce()
  dispararEvento.keyDown(checklist, { key: 'Escape' })
  esperar(aoFecharMenu).toHaveBeenCalledOnce()
})
