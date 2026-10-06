import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao, vi } from 'vitest'
import { Comanda } from './Comanda'
import { comandaAssuncaoFixture, comandaDetalheFixture, comandaFixture, comandaTrancadaFixture, comandaVaziaFixture } from './Comanda.fixture'

// Na pasta de fotos só o Biscoito tem arquivo. `vi.mock` pelo nome, sem apelido:
// é o nome que o Vitest procura pra içar o mock acima dos imports.
vi.mock('../fotoDoCatalogo', () => ({
  fotoDoCatalogo: (nome: string) => (nome === 'Biscoito' ? '/fotos/biscoito.jpg' : undefined),
}))

testar('a lista mostra cliente, situação e total, e abre a comanda no toque', () => {
  const abrir = simulacao.fn()
  renderizar(<Comanda dados={comandaFixture} aoAbrirComanda={abrir} />)

  const lista = tela.getByRole('list', { name: 'Comandas do recorte' })
  esperar(lista).toHaveTextContent('Renata Alves')
  esperar(lista).toHaveTextContent('R$ 140,40')
  dispararEvento.click(dentroDe(lista).getAllByRole('button')[0])
  esperar(abrir).toHaveBeenCalled()
})

testar('comanda de outro atendente aparece sem valor na lista', () => {
  renderizar(<Comanda dados={comandaFixture} />)
  const [, outra] = tela.getAllByRole('listitem')

  esperar(outra).toHaveTextContent('aguardando assunção')
  esperar(outra).toHaveTextContent('Responsável: Paulo')
  esperar(outra).not.toHaveTextContent('R$')
})

testar('o detalhe agrupa os extras por tipo, com subtotal, e diz o que fechar vai disparar', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} />)

  // Um grupo por tipo, cada um com o seu subtotal: é o que deixa conferir o
  // resumo sem somar as linhas na cabeça.
  const bomboniere = tela.getByRole('list', { name: 'Itens lançados — Bomboniere' })
  esperar(bomboniere).toHaveTextContent('Biscoito')
  esperar(bomboniere).toHaveTextContent('2 × 6,70')
  esperar(tela.getByRole('heading', { name: /Bomboniere/ })).toHaveTextContent('R$ 13,40')
  esperar(tela.getByRole('list', { name: 'Itens lançados — Fundos' })).toHaveTextContent('Fundo Branco')
  esperar(tela.getByRole('heading', { name: /Fundos/ })).toHaveTextContent('R$ 30,00')
  esperar(tela.getByRole('region', { name: 'Resumo de valores' })).toHaveTextContent('R$ 140,40')
  esperar(tela.getByRole('button', { name: 'Fechar comanda' })).toBeEnabled()
  esperar(tela.getByText(/baixa no bomboniere/)).toBeVisible()
})

testar('competência trancada não deixa fechar, e diz por quê', () => {
  renderizar(<Comanda dados={comandaTrancadaFixture} />)
  esperar(tela.getByRole('button', { name: 'Fechar comanda' })).toBeDisabled()
  esperar(tela.getByText('Competência trancada.')).toBeVisible()
})

testar('o detalhe em assunção não desenha valor nenhum e oferece assumir', () => {
  const assumir = simulacao.fn()
  renderizar(<Comanda dados={comandaAssuncaoFixture} aoAssumir={assumir} />)

  esperar(tela.queryByRole('region', { name: 'Resumo de valores' })).not.toBeInTheDocument()
  esperar(tela.queryByText(/R\$/)).not.toBeInTheDocument()
  dispararEvento.click(tela.getByRole('button', { name: 'Assumir comanda' }))
  esperar(assumir).toHaveBeenCalledWith('c-2', 1)
})

testar('sem comanda no recorte, diz o que está vazio', () => {
  renderizar(<Comanda dados={comandaVaziaFixture} />)
  esperar(tela.getByText('Nenhuma comanda neste recorte.')).toBeVisible()
})

testar('adicionar do catálogo: aba, cartão, quantidade e Lançar mandam o item, sem preço', () => {
  const lancar = simulacao.fn()
  renderizar(<Comanda dados={comandaDetalheFixture} aoLancarLinha={lancar} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Bomboniere/ }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Biscoito/ }))
  esperar(dentroDe(form).getByRole('button', { name: 'Menos um' })).toBeDisabled()
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Mais um' }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Mais um' }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Lançar' }))

  esperar(lancar).toHaveBeenCalledWith(
    comandaDetalheFixture.selecionada,
    { tipo: 'bomboniere', item: 'k-1', descricao: '', quantidade: 3, preco: '' },
  )
})

testar('cartão do catálogo mostra a foto do item quando ela existe, e só o texto quando não', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Bomboniere/ }))
  esperar(dentroDe(form).getByRole('button', { name: /Biscoito/ }).querySelector('img')).toHaveAttribute('src', '/fotos/biscoito.jpg')
  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Fundos/ }))
  esperar(dentroDe(form).getByRole('button', { name: /Fundo Branco/ }).querySelector('img')).toBeNull()
})

// Fundo e equipamento são os dois tipos de item_extra: a aba separa o que a
// atendente procura, a tabela em que a linha cai continua a mesma.
testar('as abas separam o catálogo por categoria, e fundo cai em item_extra', () => {
  const lancar = simulacao.fn()
  renderizar(<Comanda dados={comandaDetalheFixture} aoLancarLinha={lancar} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Bomboniere/ }))
  esperar(dentroDe(form).getByRole('button', { name: /Bomboniere/ })).toHaveAttribute('aria-pressed', 'true')
  esperar(dentroDe(form).queryByRole('button', { name: /Fundo Branco/ })).toBeNull()

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Fundos/ }))
  esperar(dentroDe(form).queryByRole('button', { name: /Biscoito/ })).toBeNull()
  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Fundo Branco/ }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Lançar' }))

  esperar(lancar.mock.calls[0][1]).toEqual({ tipo: 'item_extra', item: 'k-2', descricao: '', quantidade: 1, preco: '' })
})

// Com fotos, a lista de uma categoria ocupa a tela do tablet inteira: ela abre
// quando a atendente escolhe a categoria e fecha tocando nela de novo.
testar('a lista do catálogo começa fechada, abre na categoria e fecha tocando nela de novo', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })
  const bomboniere = dentroDe(form).getByRole('button', { name: /Bomboniere/ })

  esperar(bomboniere).toHaveAttribute('aria-pressed', 'false')
  esperar(dentroDe(form).queryByRole('button', { name: /Biscoito/ })).toBeNull()

  dispararEvento.click(bomboniere)
  esperar(dentroDe(form).getByRole('button', { name: /Biscoito/ })).toBeVisible()

  dispararEvento.click(bomboniere)
  esperar(bomboniere).toHaveAttribute('aria-pressed', 'false')
  esperar(dentroDe(form).queryByRole('button', { name: /Biscoito/ })).toBeNull()
})

testar('depois de lançar, a lista da categoria continua aberta para o próximo item', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} aoLancarLinha={simulacao.fn()} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Bomboniere/ }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Biscoito/ }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Lançar' }))
  esperar(dentroDe(form).getByRole('button', { name: /Biscoito/ })).toBeVisible()
})

testar('sem cartão escolhido não há o que lançar', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })
  esperar(dentroDe(form).queryByRole('button', { name: 'Lançar' })).toBeNull()
})

// O preço só é digitável fora do catálogo: dentro dele quem manda é o catálogo,
// e a migration 0049 ignora o que a chamada mandar.
testar('fora do catálogo pede descrição e preço, e só então lança', () => {
  const lancar = simulacao.fn()
  renderizar(<Comanda dados={comandaDetalheFixture} aoLancarLinha={lancar} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Fora do catálogo/ }))
  esperar(dentroDe(form).getByRole('button', { name: 'Lançar' })).toBeDisabled()
  dispararEvento.change(dentroDe(form).getByLabelText('Descrição'), { target: { value: 'Beca americana' } })
  esperar(dentroDe(form).getByRole('button', { name: 'Lançar' })).toBeDisabled()
  dispararEvento.change(dentroDe(form).getByLabelText('Preço'), { target: { value: '150,00' } })
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Lançar' }))

  esperar(lancar.mock.calls[0][1]).toEqual({
    tipo: 'item_extra', item: null, descricao: 'Beca americana', quantidade: 1, preco: '150,00',
  })
})

// Estúdio adicional (ADR 0085): a tela manda estúdio, início e duração; o preço
// é o da tabela, lido no banco.
testar('outro estúdio pede estúdio e duração, começa onde o A terminou, e lança', () => {
  const lancarEstudio = simulacao.fn()
  renderizar(<Comanda dados={comandaDetalheFixture} aoLancarEstudio={lancarEstudio} />)
  const form = tela.getByRole('form', { name: 'Adicionar item à comanda' })

  dispararEvento.click(dentroDe(form).getByRole('button', { name: /Outro estúdio/ }))
  esperar(dentroDe(form).getByLabelText('Início')).toHaveValue('10:00')
  esperar(dentroDe(form).getByRole('button', { name: 'Lançar' })).toBeDisabled()
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Branco' }))
  esperar(dentroDe(form).getByRole('button', { name: 'Lançar' })).toBeDisabled()
  dispararEvento.click(dentroDe(form).getByRole('button', { name: /1h30/ }))
  dispararEvento.click(dentroDe(form).getByRole('button', { name: 'Lançar' }))

  esperar(lancarEstudio.mock.calls[0][1]).toEqual({ estudio: 'e-2', inicio: '10:00', duracao: 90 })
})

testar('fechar leva o horário praticado que está na tela', () => {
  const acionar = simulacao.fn()
  renderizar(<Comanda dados={comandaDetalheFixture} aoAcionar={acionar} />)

  dispararEvento.change(tela.getByLabelText('Fim'), { target: { value: '10:50' } })
  dispararEvento.click(tela.getByRole('button', { name: 'Fechar comanda' }))

  esperar(acionar).toHaveBeenCalledWith('fechar', comandaDetalheFixture.selecionada, {
    data: '2026-08-07', inicio: '09:00', fim: '10:50',
  })
})

testar('Recebi é um botão por forma, e o toque leva a forma (ADR 0086)', () => {
  const acionar = simulacao.fn()
  const selecionada = {
    ...comandaDetalheFixture.selecionada!,
    acoes: [{
      identificador: 'receber', rotulo: 'Recebi', desativada: false, motivo: '',
      formas: [{ identificador: 'pix', rotulo: 'Pix' }, { identificador: 'debito', rotulo: 'Débito' }],
    }],
  }
  renderizar(<Comanda dados={{ ...comandaDetalheFixture, selecionada }} aoAcionar={acionar} />)

  dispararEvento.click(dentroDe(tela.getByRole('group', { name: 'Recebi' })).getByRole('button', { name: 'Débito' }))

  esperar(acionar).toHaveBeenCalledWith('receber', selecionada, esperar.anything(), 'debito')
})

testar('a recusa da última escrita aparece como alerta', () => {
  renderizar(<Comanda dados={comandaDetalheFixture} recusa="Esta comanda mudou enquanto você olhava." />)
  esperar(tela.getByRole('alert')).toHaveTextContent('mudou enquanto você olhava')
})
