import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao } from 'vitest'
import { Home } from './Home'
import { homeFixture, homeVaziaFixture } from './Home.fixture'

testar('renderiza a Home: cabeçalho, grade por estúdio e a rotina ao lado', () => {
  renderizar(<Home dados={homeFixture} />)
  esperar(tela.getByRole('heading', { name: homeFixture.saudacao })).toBeVisible()
  esperar(tela.getByRole('status', { name: 'Sincronização da agenda' })).toHaveTextContent(homeFixture.sincronizacao.rotulo)

  // Uma coluna por estúdio, e cada ensaio na coluna do seu estúdio.
  for (const estudio of homeFixture.agenda.estudios) {
    const coluna = dentroDe(tela.getByRole('list', { name: estudio.nome }))
    const doEstudio = homeFixture.agenda.ensaios.filter((ensaio) => ensaio.estudio === estudio.identificador)
    for (const ensaio of doEstudio) esperar(coluna.getByRole('button', { name: new RegExp(ensaio.cliente) })).toBeVisible()
  }

  esperar(tela.getByRole('region', { name: 'Avisos' })).toHaveTextContent(homeFixture.avisos.itens[0].titulo)
  esperar(tela.getByRole('region', { name: 'Checklist' })).toHaveTextContent(homeFixture.checklist!.percentual)
  esperar(tela.getByRole('navigation', { name: 'Consulta' })).toBeVisible()
})

testar('ensaios simultâneos em estúdios diferentes aparecem todos, cada um na sua coluna', () => {
  renderizar(<Home dados={homeFixture} />)
  const as14 = homeFixture.agenda.ensaios.filter((ensaio) => ensaio.inicio === '14:00')
  esperar(as14.length).toBeGreaterThan(1)
  for (const ensaio of as14) esperar(tela.getByRole('button', { name: new RegExp(`^14:00 a .*${ensaio.cliente}`) })).toBeVisible()
})

// ADR 0081 §4: Comanda por pagar e ensaio acabado fica amarelo; sem Comanda não muda.
testar('ensaio que acabou com a Comanda por pagar fica amarelo; sem Comanda, não', () => {
  const acabou = homeFixture.agenda.ensaios.find((e) => e.terminou && e.comanda.status !== 'sem_comanda')!
  const ensaios = [...homeFixture.agenda.ensaios, { ...homeFixture.agenda.ensaios.find((e) => e.comanda.status === 'sem_comanda')!, identificador: 'sc', cliente: 'Sem Comanda Acabou', terminou: true }]
  renderizar(<Home dados={{ ...homeFixture, agenda: { ...homeFixture.agenda, ensaios } }} />)
  esperar(tela.getByRole('button', { name: new RegExp(acabou.cliente) })).toHaveClass('lt-home-bloco-terminou')
  esperar(tela.getByRole('button', { name: /Sem Comanda Acabou/ })).not.toHaveClass('lt-home-bloco-terminou')
  const andando = homeFixture.agenda.ensaios.find((e) => !e.terminou && e.comanda.status === 'aberta')!
  esperar(tela.getByRole('button', { name: new RegExp(andando.cliente) })).not.toHaveClass('lt-home-bloco-terminou')
})

// ADR 0084: Comanda paga é verde; sem Comanda e pago na Altegio fica sem cor.
testar('Comanda paga fica verde; sem Comanda e pago na Altegio, sem cor', () => {
  const base = homeFixture.agenda.ensaios.find((e) => e.comanda.status === 'sem_comanda')!
  const ensaios = [
    { ...base, identificador: 'p1', cliente: 'Pago Altegio Acabou', terminou: true },
    { ...base, identificador: 'p2', cliente: 'Comanda Paga', terminou: true, comanda: { ...base.comanda, status: 'paga' as const, rotulo: 'Comanda paga', identificador: 'c-p' } },
  ]
  renderizar(<Home dados={{ ...homeFixture, agenda: { ...homeFixture.agenda, ensaios } }} />)
  const altegio = tela.getByRole('button', { name: /Pago Altegio Acabou/ })
  esperar(altegio).not.toHaveClass('lt-home-bloco-pago')
  esperar(altegio).not.toHaveClass('lt-home-bloco-terminou')
  esperar(tela.getByRole('button', { name: /Comanda Paga/ })).toHaveClass('lt-home-bloco-pago')
})

testar('o bloco diz o estado da Comanda e o que está perto', () => {
  renderizar(<Home dados={homeFixture} />)
  const agora = homeFixture.agenda.ensaios.find((ensaio) => ensaio.relogio === 'agora')!
  const bloco = tela.getByRole('button', { name: new RegExp(agora.cliente) })
  esperar(bloco).toHaveTextContent('agora')
  esperar(bloco).toHaveTextContent(agora.comanda.rotulo)
  esperar(bloco).toHaveClass(`lt-home-bloco-${agora.comanda.status}`)
  esperar(bloco).toHaveTextContent(`arrumação até ${agora.fimBloqueio}`)
})

testar('a linha de agora só aparece quando há hora dentro da grade', () => {
  const { container, unmount } = renderizar(<Home dados={homeFixture} />)
  esperar(container.querySelector('.lt-home-grade-agora')).toHaveTextContent(homeFixture.agenda.agora!)
  unmount()
  const { container: semAgora } = renderizar(<Home dados={{ ...homeFixture, agenda: { ...homeFixture.agenda, agora: null } }} />)
  esperar(semAgora.querySelector('.lt-home-grade-agora')).toBeNull()
})

testar('renderiza os vazios recebidos', () => {
  renderizar(<Home dados={homeVaziaFixture} />)
  esperar(tela.getByText('Nenhum ensaio na agenda de hoje.')).toBeVisible()
  esperar(tela.getByText('Nenhum aviso ativo.')).toBeVisible()
  esperar(tela.getByText('Checklist de hoje não criado.')).toBeVisible()
})

testar('emite as ações da grade e da lateral', () => {
  const callbacks = { ensaio: simulacao.fn(), comandas: simulacao.fn(), avisos: simulacao.fn(), checklist: simulacao.fn(), item: simulacao.fn(), estoque: simulacao.fn(), consulta: simulacao.fn() }
  renderizar(<Home dados={homeFixture} aoAbrirComandaDoEnsaio={callbacks.ensaio} aoAbrirComandas={callbacks.comandas} aoAbrirAvisos={callbacks.avisos} aoAbrirChecklist={callbacks.checklist} aoAlternarItemChecklist={callbacks.item} aoAbrirEstoque={callbacks.estoque} aoAbrirConsulta={callbacks.consulta} />)
  const ensaio = homeFixture.agenda.ensaios[1]
  dispararEvento.click(dentroDe(abrirPainel(ensaio)).getByRole('button', { name: 'Ver comanda' })); esperar(callbacks.ensaio).toHaveBeenCalledWith(ensaio.comanda.identificador)
  dispararEvento.click(tela.getByRole('button', { name: /abertas/ })); esperar(callbacks.comandas).toHaveBeenCalledOnce()
  dispararEvento.click(dentroDe(tela.getByRole('region', { name: 'Avisos' })).getByRole('button', { name: /Ver todos/ })); esperar(callbacks.avisos).toHaveBeenCalledOnce()
  const checklist = dentroDe(tela.getByRole('region', { name: 'Checklist' }))
  dispararEvento.click(checklist.getByRole('button', { name: 'Abrir' })); esperar(callbacks.checklist).toHaveBeenCalledOnce()
  const item = homeFixture.checklist!.itens[0]
  dispararEvento.click(checklist.getByRole('button', { name: item.texto })); esperar(callbacks.item).toHaveBeenCalledWith(item)
  dispararEvento.click(tela.getByRole('button', { name: /^Estoque/ })); esperar(callbacks.estoque).toHaveBeenCalledOnce()
  dispararEvento.click(dentroDe(tela.getByRole('navigation', { name: 'Consulta' })).getByRole('button', { name: /Escala/ })); esperar(callbacks.consulta).toHaveBeenCalledWith('escala')
})

// O toque no bloco só abre o painel do ensaio: criar Comanda (#113, aresta
// gerar_manual) é uma segunda escolha, dentro dele — nunca o primeiro toque.
const nomeDoEstudio = (ensaio: (typeof homeFixture.agenda.ensaios)[number]) =>
  homeFixture.agenda.estudios.find((e) => e.identificador === ensaio.estudio)!.nome
const abrirPainel = (ensaio: (typeof homeFixture.agenda.ensaios)[number]) => {
  dispararEvento.click(tela.getByRole('button', { name: new RegExp(ensaio.cliente) }))
  return tela.getByRole('dialog', { name: `Ensaio de ${ensaio.cliente}` })
}

testar('a grade não tem "Criar comanda" solto: o toque no bloco abre o painel e não grava nada', () => {
  const criar = simulacao.fn()
  const navegar = simulacao.fn()
  renderizar(<Home dados={homeFixture} aoCriarComanda={criar} aoAbrirComandaDoEnsaio={navegar} />)
  esperar(tela.queryByRole('button', { name: /^Criar comanda/ })).toBeNull()
  const ensaio = homeFixture.agenda.ensaios.find((e) => e.comanda.podeAbrir && e.observacao)!
  const painel = abrirPainel(ensaio)
  for (const texto of [`${ensaio.inicio}–${ensaio.fim}`, nomeDoEstudio(ensaio), ensaio.servico, ensaio.observacao!, ensaio.comanda.rotulo]) {
    esperar(painel).toHaveTextContent(texto)
  }
  esperar(criar).not.toHaveBeenCalled()
  esperar(navegar).not.toHaveBeenCalled()
})

testar('"Criar comanda" no painel só no ensaio sem Comanda que o banco deixa gerar', () => {
  renderizar(<Home dados={homeFixture} />)
  esperar(homeFixture.agenda.ensaios.some((e) => e.comanda.podeAbrir)).toBe(true)
  esperar(homeFixture.agenda.ensaios.some((e) => e.comanda.status === 'sem_comanda' && !e.comanda.podeAbrir)).toBe(true)
  for (const ensaio of homeFixture.agenda.ensaios) {
    const painel = dentroDe(abrirPainel(ensaio))
    esperar(painel.queryByRole('button', { name: 'Criar comanda' }) !== null).toBe(ensaio.comanda.podeAbrir)
    esperar(painel.queryByRole('button', { name: 'Ver comanda' }) !== null).toBe(ensaio.comanda.identificador !== null)
    dispararEvento.click(painel.getByRole('button', { name: 'Fechar' }))
  }
})

testar('"Criar comanda" pede a criação; "Ver comanda" leva à Comanda; os dois fecham o painel', () => {
  const criar = simulacao.fn()
  const navegar = simulacao.fn()
  renderizar(<Home dados={homeFixture} aoCriarComanda={criar} aoAbrirComandaDoEnsaio={navegar} />)
  const semComanda = homeFixture.agenda.ensaios.find((e) => e.comanda.podeAbrir)!
  dispararEvento.click(dentroDe(abrirPainel(semComanda)).getByRole('button', { name: 'Criar comanda' }))
  esperar(criar).toHaveBeenCalledWith(semComanda.identificador)
  esperar(tela.queryByRole('dialog')).toBeNull()
  const comComanda = homeFixture.agenda.ensaios.find((e) => e.comanda.identificador !== null)!
  dispararEvento.click(dentroDe(abrirPainel(comComanda)).getByRole('button', { name: 'Ver comanda' }))
  esperar(navegar).toHaveBeenCalledWith(comComanda.comanda.identificador)
  esperar(tela.queryByRole('dialog')).toBeNull()
  esperar(criar).toHaveBeenCalledOnce()
})

testar('Esc e o fundo fecham o painel sem fazer nada', () => {
  const criar = simulacao.fn()
  renderizar(<Home dados={homeFixture} aoCriarComanda={criar} />)
  const ensaio = homeFixture.agenda.ensaios.find((e) => e.comanda.podeAbrir)!
  dispararEvento.keyDown(abrirPainel(ensaio), { key: 'Escape' })
  esperar(tela.queryByRole('dialog')).toBeNull()
  abrirPainel(ensaio)
  dispararEvento.click(tela.getByRole('button', { name: 'Fechar painel do ensaio' }))
  esperar(tela.queryByRole('dialog')).toBeNull()
  esperar(criar).not.toHaveBeenCalled()
})

testar('a recusa de uma escrita da Home aparece na própria Home', () => {
  renderizar(<Home dados={homeFixture} recusa="A competência deste mês está trancada." />)
  esperar(tela.getByRole('alert')).toHaveTextContent('A competência deste mês está trancada.')
})
