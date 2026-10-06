import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { Entrada } from './Entrada'
import {
  entradaAbertaFixture,
  entradaBloqueadaFixture,
  entradaFixture,
  entradaPinFixture,
  entradaPinIncorretoFixture,
  entradaPinPreenchidoFixture,
  entradaVaziaFixture,
} from './Entrada.fixture'

descrever('Entrada', () => {
  testar('renderiza a seleção com os blocos de dados do fixture', () => {
    renderizar(<Entrada dados={entradaFixture} />)

    esperar(tela.getByRole('heading', { name: 'Quem está entrando?' })).toBeInTheDocument()
    esperar(tela.getByRole('img', { name: 'Lifetrailer Studio' })).toHaveAttribute('src', entradaFixture.logo)
    const pessoas = tela.getByRole('group', { name: 'Pessoas disponíveis' })
    for (const pessoa of entradaFixture.pessoas) {
      const escolha = dentroDe(pessoas).getByRole('button', { name: `${pessoa.nome} ${pessoa.papel}` })
      esperar(escolha).toHaveTextContent(pessoa.nome)
      esperar(escolha).toHaveTextContent(pessoa.papel)
    }
    const rodape = tela.getByText(`${entradaFixture.local} · ${entradaFixture.aparelho} · ${entradaFixture.data}`)
    esperar(rodape).toBeInTheDocument()
  })

  testar('quem tem arquivo em imagens/equipe aparece com a foto; quem não tem, com o marcador', () => {
    const { container } = renderizar(<Entrada dados={{ ...entradaFixture, pessoas: [
      { identificador: 'e', nome: 'Marcos', papel: 'Atendente' },
      { identificador: 'x', nome: 'Pessoa Sem Foto', papel: 'Atendente' },
    ] }} />)

    const [comFoto, semFoto] = container.querySelectorAll('.lt-entrada-avatar')
    esperar(comFoto.querySelector('img')?.getAttribute('src')).toMatch(/marcos/)
    esperar(semFoto.querySelector('img')).toBeNull()
    esperar(semFoto).toHaveTextContent('Foto')
  })

  testar.each([
    ['seleção', entradaFixture],
    ['vazio', entradaVaziaFixture],
    ['PIN', entradaPinFixture],
    ['PIN incorreto', entradaPinIncorretoFixture],
    ['bloqueio', entradaBloqueadaFixture],
    ['turno aberto', entradaAbertaFixture],
  ])('mantém o contexto Entrada na Moldura em %s', (_, dados) => {
    renderizar(<Entrada dados={dados} />)

    const faixa = tela.getByRole('banner', { name: 'Identificação da tela' })
    esperar(faixa.textContent?.split('·').map((parte) => parte.trim())).toEqual(['LIFETRAILER', 'Entrada', dados.hora])
  })

  testar('mostra o vazio sem pessoas nem teclado', () => {
    renderizar(<Entrada dados={entradaVaziaFixture} />)

    esperar(tela.getByText('Nenhuma pessoa disponível para entrar.')).toBeInTheDocument()
    esperar(tela.queryByRole('group', { name: 'Pessoas disponíveis' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('group', { name: 'Teclado do PIN' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('button')).not.toBeInTheDocument()
  })

  testar.each([
    ['normal', entradaPinFixture],
    ['preenchido', entradaPinPreenchidoFixture],
    ['incorreto', entradaPinIncorretoFixture],
    ['bloqueado', entradaBloqueadaFixture],
  ])('renderiza pessoa, pontos, mensagem, teclado e dica do PIN %s', (_, dados) => {
    if (dados.exibicao.etapa !== 'pin') throw new Error('O fixture precisa representar o PIN')
    const pin = dados.exibicao
    renderizar(<Entrada dados={dados} />)

    esperar(tela.getByRole('heading', { name: pin.pessoa.nome })).toBeInTheDocument()
    const pontos = tela.getByRole('img', { name: pin.descricaoPontos })
    esperar(pontos.children).toHaveLength(pin.pontos.length)
    esperar(pontos.querySelectorAll('.lt-entrada-ponto-preenchido')).toHaveLength(pin.pontos.filter((ponto) => ponto.preenchido).length)
    esperar(tela.getByRole('status')).toHaveTextContent(pin.mensagem)
    const teclado = tela.getByRole('group', { name: 'Teclado do PIN' })
    esperar(dentroDe(teclado).getAllByRole('button')).toHaveLength(pin.teclas.length)
    for (const tecla of pin.teclas) {
      const botao = dentroDe(teclado).getByRole('button', { name: tecla.descricao ?? tecla.rotulo })
      esperar(botao).toHaveTextContent(tecla.rotulo)
      if (tecla.desativada) esperar(botao).toBeDisabled()
      else esperar(botao).toBeEnabled()
    }
    esperar(tela.getByText(`DEMO · PIN ${pin.dica}`)).toBeInTheDocument()
  })

  testar('mostra a confirmação com a pessoa recebida', () => {
    if (entradaAbertaFixture.exibicao.etapa !== 'aberto') throw new Error('O fixture precisa representar o turno aberto')
    renderizar(<Entrada dados={entradaAbertaFixture} />)

    esperar(tela.getByRole('heading', { name: `Turno aberto, ${entradaAbertaFixture.exibicao.pessoa.nome}` })).toBeInTheDocument()
    esperar(tela.getByText('Levando você para o Início…')).toBeInTheDocument()
    esperar(tela.getByRole('button', { name: 'Entrar agora' })).toBeInTheDocument()
  })

  testar('notifica a escolha sem abrir uma sessão nem mudar a etapa', () => {
    const aoEscolherPessoa = vi.fn()
    const pessoa = entradaFixture.pessoas[0]
    renderizar(<Entrada dados={entradaFixture} aoEscolherPessoa={aoEscolherPessoa} />)

    dispararEvento.click(tela.getByRole('button', { name: `${pessoa.nome} ${pessoa.papel}` }))

    esperar(aoEscolherPessoa).toHaveBeenCalledWith(pessoa.identificador)
    esperar(tela.getByRole('heading', { name: 'Quem está entrando?' })).toBeInTheDocument()
    esperar(tela.queryByRole('group', { name: 'Teclado do PIN' })).not.toBeInTheDocument()
  })

  // ADR 0070 §1: a marca diz que há urgente esperando, sem dizer o que é.
  testar('marca o cartão de quem tem Aviso Urgente sem confirmar, e só o dele', () => {
    const [marcada, ...outras] = entradaFixture.pessoas
    renderizar(<Entrada dados={{ ...entradaFixture, pessoas: [{ ...marcada, avisoUrgente: true }, ...outras] }} />)

    const pessoas = tela.getByRole('group', { name: 'Pessoas disponíveis' })
    const cartao = dentroDe(pessoas).getByRole('button', { name: `${marcada.nome} ${marcada.papel} · aviso urgente` })
    esperar(dentroDe(cartao).getByText('Aviso urgente')).toBeVisible()
    esperar(dentroDe(pessoas).getAllByText('Aviso urgente')).toHaveLength(1)
  })
})
