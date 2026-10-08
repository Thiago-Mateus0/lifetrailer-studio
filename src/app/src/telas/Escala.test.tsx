import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'
import { Escala } from './Escala'
import { escalaAtendenteFixture, escalaEdicaoFixture, escalaExtraFixture, escalaFixture, escalaPadroesFixture, escalaRevisadaFixture, escalaRevisaoFixture, escalaVaziaFixture } from './Escala.fixture'

descrever('Escala', () => {
  testar('renderiza o fixture cheio, assinatura, todos os dias, turnos, avisos e legenda', () => {
    renderizar(<Escala dados={escalaFixture} />)
    esperar(tela.getByRole('heading', { name: 'Escala' })).toBeInTheDocument()
    esperar(tela.getByRole('banner').textContent?.split('·').map((parte) => parte.trim())).toEqual(['LIFETRAILER', 'Escala', escalaFixture.data, escalaFixture.turno, escalaFixture.hora])
    esperar(tela.getByRole('status')).toHaveTextContent(escalaFixture.resumo)
    esperar(tela.getByRole('status')).toHaveTextContent(escalaFixture.sugestoes)
    esperar(tela.getByRole('heading', { name: escalaFixture.periodo })).toBeInTheDocument()
    const lista = tela.getByRole('list', { name: 'Dias da escala' })
    esperar(dentroDe(lista).getAllByRole('listitem')).toHaveLength(escalaFixture.dias.length)
    for (const dia of escalaFixture.dias) {
      const celula = dentroDe(lista).getByRole('listitem', { name: dia.rotulo })
      if (dia.hoje) esperar(celula).toHaveAttribute('aria-current', 'date')
      for (const turno of dia.turnos) {
        const grupo = dentroDe(celula).getByRole('group', { name: turno.rotulo })
        esperar(grupo).toHaveTextContent(turno.colaborador)
        esperar(grupo).toHaveTextContent(turno.horario)
        if (turno.selo) esperar(grupo).toHaveTextContent(turno.selo)
        if (turno.nota) esperar(grupo).toHaveTextContent(turno.nota)
      }
      if (dia.mensagem) esperar(celula).toHaveTextContent(dia.mensagem)
    }
    const legenda = tela.getByRole('list', { name: 'Legenda da escala' })
    for (const item of escalaFixture.legenda) esperar(legenda).toHaveTextContent(item.rotulo)
    esperar(tela.getByText(escalaFixture.rodape)).toBeInTheDocument()
  })

  testar('renderiza sem escala e sem padrões no estado vazio', () => {
    const { rerender: renderizarNovamente } = renderizar(<Escala dados={escalaVaziaFixture} />)
    esperar(tela.getByText(escalaVaziaFixture.mensagemVazia)).toBeInTheDocument()
    esperar(tela.queryByRole('list', { name: 'Dias da escala' })).not.toBeInTheDocument()
    renderizarNovamente(<Escala dados={{ ...escalaVaziaFixture, visao: 'padroes' }} />)
    esperar(tela.getByText(escalaVaziaFixture.mensagemVazia)).toBeInTheDocument()
    esperar(tela.queryByRole('article')).not.toBeInTheDocument()
  })

  testar('aoSelecionarVisao recebe cada visão e não troca a tela por conta própria', () => {
    const aoSelecionarVisao = vi.fn()
    renderizar(<Escala dados={escalaFixture} aoSelecionarVisao={aoSelecionarVisao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Calendário' }))
    esperar(aoSelecionarVisao).toHaveBeenLastCalledWith('calendario')
    dispararEvento.click(tela.getByRole('button', { name: 'Padrões' }))
    esperar(aoSelecionarVisao).toHaveBeenLastCalledWith('padroes')
    esperar(tela.getByRole('button', { name: 'Calendário' })).toHaveAttribute('aria-pressed', 'true')
    esperar(tela.getByRole('region', { name: 'Calendário de turnos' })).toBeInTheDocument()
  })

  testar('aoEditar é disparado sem entrar em edição local', () => {
    const aoEditar = vi.fn()
    renderizar(<Escala dados={escalaFixture} aoEditar={aoEditar} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Editar escala' }))
    esperar(aoEditar).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })

  testar('aoCancelarEdicao é disparado sem descartar os dados apresentados', () => {
    const aoCancelarEdicao = vi.fn()
    renderizar(<Escala dados={escalaEdicaoFixture} aoCancelarEdicao={aoCancelarEdicao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' }))
    esperar(aoCancelarEdicao).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.getByText(escalaEdicaoFixture.avisoEdicao)).toBeInTheDocument()
  })

  testar('aoConfirmarEdicao respeita a permissão recebida', () => {
    const aoConfirmarEdicao = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<Escala dados={{ ...escalaEdicaoFixture, podeConfirmar: false }} aoConfirmarEdicao={aoConfirmarEdicao} />)
    const confirmar = tela.getByRole('button', { name: 'Confirmar' })
    esperar(confirmar).toBeDisabled()
    dispararEvento.click(confirmar)
    esperar(aoConfirmarEdicao).not.toHaveBeenCalled()
    renderizarNovamente(<Escala dados={escalaEdicaoFixture} aoConfirmarEdicao={aoConfirmarEdicao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Confirmar' }))
    esperar(aoConfirmarEdicao).toHaveBeenCalledExactlyOnceWith()
  })

  testar('aoAcionarTurno recebe data, Turno canônico e ação sem alterar a escala', () => {
    const aoAcionarTurno = vi.fn()
    renderizar(<Escala dados={escalaEdicaoFixture} aoAcionarTurno={aoAcionarTurno} />)
    for (const dia of escalaEdicaoFixture.dias) {
      const celula = tela.getByRole('listitem', { name: dia.rotulo })
      for (const turno of dia.turnos) {
        const grupo = dentroDe(celula).getByRole('group', { name: turno.rotulo })
        for (const acao of turno.acoes) {
          const botao = dentroDe(grupo).getByRole('button', { name: acao.rotulo })
          dispararEvento.click(botao)
          esperar(aoAcionarTurno).toHaveBeenLastCalledWith(dia.data, turno.turno, acao.identificador)
          esperar(botao).toHaveAttribute('aria-pressed', String(acao.selecionada))
          esperar(grupo).toHaveTextContent(turno.colaborador)
        }
      }
    }
  })

  testar('aoAcionarDia encaminha presença, domingo extra e desfazer', () => {
    const aoAcionarDia = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<Escala dados={escalaFixture} aoAcionarDia={aoAcionarDia} />)
    for (const dia of escalaFixture.dias) {
      if (!dia.acao) continue
      const celula = tela.getByRole('listitem', { name: dia.rotulo })
      dispararEvento.click(dentroDe(celula).getByRole('button', { name: dia.acao.rotulo }))
      esperar(aoAcionarDia).toHaveBeenLastCalledWith(dia.data, dia.acao.identificador)
    }
    renderizarNovamente(<Escala dados={escalaExtraFixture} aoAcionarDia={aoAcionarDia} />)
    const extra = escalaExtraFixture.dias.find((dia) => dia.acao?.identificador === 'desfazer')!
    const celula = tela.getByRole('listitem', { name: extra.rotulo })
    esperar(dentroDe(celula).getByRole('group', { name: 'Extra domingo' })).toHaveTextContent(extra.turnos[0].colaborador)
    dispararEvento.click(dentroDe(celula).getByRole('button', { name: 'Desfazer' }))
    esperar(aoAcionarDia).toHaveBeenLastCalledWith(extra.data, 'desfazer')
    esperar(dentroDe(celula).getByRole('group', { name: 'Extra domingo' })).toBeInTheDocument()
  })

  testar('aoRevisarPadrao recebe o turno dos padrões apresentados', () => {
    const aoRevisarPadrao = vi.fn()
    renderizar(<Escala dados={escalaPadroesFixture} aoRevisarPadrao={aoRevisarPadrao} />)
    for (const padrao of escalaPadroesFixture.padroes) {
      const cartao = tela.getByRole('article', { name: padrao.rotulo })
      esperar(cartao).toHaveTextContent(padrao.colaboradores)
      esperar(cartao).toHaveTextContent(padrao.horario)
      esperar(cartao).toHaveTextContent(padrao.versao)
      if (padrao.podeRevisar) {
        dispararEvento.click(dentroDe(cartao).getByRole('button', { name: 'Alterar âncora ou colaboradores' }))
        esperar(aoRevisarPadrao).toHaveBeenCalledExactlyOnceWith(padrao.turno)
      }
    }
    esperar(tela.queryByRole('region', { name: 'Revisão obrigatória antes de confirmar' })).not.toBeInTheDocument()
  })

  testar('aoDecidirTroca encaminha ambas as decisões sem decidir ou liberar confirmação local', () => {
    const aoDecidirTroca = vi.fn()
    renderizar(<Escala dados={escalaRevisaoFixture} aoDecidirTroca={aoDecidirTroca} />)
    for (const troca of escalaRevisaoFixture.revisao!.afetadas) {
      const grupo = tela.getByRole('group', { name: troca.rotulo })
      esperar(grupo).toHaveTextContent(troca.registrada)
      esperar(grupo).toHaveTextContent(troca.depois)
      for (const acao of troca.acoes) {
        const botao = dentroDe(grupo).getByRole('button', { name: acao.rotulo })
        dispararEvento.click(botao)
        esperar(aoDecidirTroca).toHaveBeenLastCalledWith(troca.identificador, acao.identificador)
        esperar(botao).toHaveAttribute('aria-pressed', 'false')
      }
    }
    esperar(tela.getByRole('button', { name: 'Confirmar nova âncora' })).toBeDisabled()
  })

  testar('aoCancelarRevisao encaminha o cancelamento sem fechar a revisão', () => {
    const aoCancelarRevisao = vi.fn()
    renderizar(<Escala dados={escalaRevisaoFixture} aoCancelarRevisao={aoCancelarRevisao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Cancelar revisão' }))
    esperar(aoCancelarRevisao).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.getByRole('region', { name: 'Revisão obrigatória antes de confirmar' })).toBeInTheDocument()
  })

  testar('aoConfirmarRevisao só é disparado quando o fixture permite', () => {
    const aoConfirmarRevisao = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<Escala dados={escalaRevisaoFixture} aoConfirmarRevisao={aoConfirmarRevisao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Confirmar nova âncora' }))
    esperar(aoConfirmarRevisao).not.toHaveBeenCalled()
    renderizarNovamente(<Escala dados={escalaRevisadaFixture} aoConfirmarRevisao={aoConfirmarRevisao} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Confirmar nova âncora' }))
    esperar(aoConfirmarRevisao).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.getByRole('status')).toHaveTextContent(escalaRevisadaFixture.revisao!.status)
  })

  testar('oculta edição e revisão quando as permissões de apresentação não são recebidas', () => {
    const { rerender: renderizarNovamente } = renderizar(<Escala dados={escalaAtendenteFixture} />)
    esperar(tela.queryByRole('button', { name: 'Editar escala' })).not.toBeInTheDocument()
    renderizarNovamente(<Escala dados={{ ...escalaAtendenteFixture, visao: 'padroes' }} />)
    esperar(tela.queryByRole('button', { name: 'Alterar âncora ou colaboradores' })).not.toBeInTheDocument()
  })
})
