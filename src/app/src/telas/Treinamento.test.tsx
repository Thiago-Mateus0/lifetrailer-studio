import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { Treinamento } from './Treinamento'
import {
  treinamentoAbertoFixture,
  treinamentoArquivadosFixture,
  treinamentoFixture,
  treinamentoSemBlocosFixture,
  treinamentoVazioFixture,
} from './Treinamento.fixture'

descrever('Treinamento', () => {
  testar('mostra uma pasta por categoria, e a pasta abre os tutoriais dela', () => {
    renderizar(<Treinamento dados={treinamentoFixture} />)

    const pagina = tela.getByRole('region', { name: 'Treinamento' })
    esperar(dentroDe(pagina).getByRole('heading', { name: 'Treinamento' })).toBeInTheDocument()
    esperar(dentroDe(pagina).getByText(treinamentoFixture.subtitulo)).toBeInTheDocument()
    const pastas = dentroDe(tela.getByRole('list', { name: 'Pastas' }))
    for (const categoria of treinamentoFixture.categorias) {
      esperar(pastas.getByRole('button', { name: new RegExp(categoria.nome) })).toHaveTextContent(categoria.contagem)
    }
    esperar(tela.queryByRole('button', { name: /Como armar o softbox/ })).toBeNull()

    const [equipamento] = treinamentoFixture.categorias
    dispararEvento.click(pastas.getByRole('button', { name: /^Equipamento/ }))
    const secao = dentroDe(tela.getByRole('region', { name: equipamento.nome }))
    for (const tutorial of equipamento.tutoriais) {
      const cartao = secao.getByRole('button', { name: new RegExp(tutorial.titulo) })
      esperar(cartao).toHaveTextContent(tutorial.blocos)
      esperar(cartao).toHaveTextContent(tutorial.atualizado)
    }
    esperar(tela.queryByRole('region', { name: 'Atendimento' })).toBeNull()

    dispararEvento.click(tela.getByRole('button', { name: '← Pastas' }))
    esperar(tela.getByRole('list', { name: 'Pastas' })).toBeInTheDocument()
  })

  testar('pasta com foto mostra a capa; sem foto, o ícone', () => {
    const [equipamento, atendimento] = treinamentoFixture.categorias
    const { container } = renderizar(<Treinamento dados={{ ...treinamentoFixture, categorias: [{ ...equipamento, capa: '/midia/f1?t=x' }, atendimento] }} />)
    const capas = [...container.querySelectorAll('.lt-treinamento-pasta .lt-treinamento-capa')]
    esperar(capas[0].tagName).toBe('IMG')
    esperar(capas[0]).toHaveAttribute('src', '/midia/f1?t=x')
    esperar(capas[1].tagName).toBe('SPAN')
  })

  testar('buscando, o resultado vem de todas as pastas', () => {
    renderizar(<Treinamento dados={treinamentoFixture} digitado="a" pasta="cat-equipamento" />)
    esperar(tela.getByRole('region', { name: 'Equipamento' })).toBeInTheDocument()
    esperar(tela.getByRole('region', { name: 'Atendimento' })).toBeInTheDocument()
    esperar(tela.queryByRole('button', { name: '← Pastas' })).toBeNull()
  })

  // Issue #170: a busca vem antes de tudo, inclusive do título.
  testar('a busca é a primeira coisa da página', () => {
    renderizar(<Treinamento dados={treinamentoFixture} />)

    const pagina = tela.getByRole('region', { name: 'Treinamento' })
    esperar(pagina.firstElementChild).toBe(tela.getByRole('form', { name: 'Buscar tutorial' }))
  })

  // O mockup da Fase 3 desenhou vídeo e link; o spec e o ADR 0026 decidiram
  // texto e foto, e a issue #94 escolheu o spec. Sem este teste a URL volta.
  testar('não oferece vídeo nem link em lugar nenhum', () => {
    renderizar(<Treinamento dados={treinamentoAbertoFixture} />)

    esperar(tela.queryByRole('link')).not.toBeInTheDocument()
    esperar(tela.queryByText(/https?:\/\//)).not.toBeInTheDocument()
    esperar(tela.queryByRole('button', { name: /v[ií]deo/i })).not.toBeInTheDocument()
  })

  testar.each([
    ['catálogo', treinamentoFixture],
    ['vazio', treinamentoVazioFixture],
    ['arquivados', treinamentoArquivadosFixture],
  ])('preserva a assinatura na Moldura em %s', (_, dados) => {
    renderizar(<Treinamento dados={dados} />)

    const faixa = tela.getByRole('banner', { name: 'Identificação da tela' })
    esperar(faixa.textContent?.split('·').map((parte) => parte.trim()))
      .toEqual(['LIFETRAILER', 'Treinamento', dados.turno, dados.hora])
  })

  testar('sem nada publicado, diz isso em vez de mostrar categoria vazia', () => {
    renderizar(<Treinamento dados={treinamentoVazioFixture} />)

    const vazio = dentroDe(tela.getByRole('region', { name: 'Nenhum tutorial' }))
    esperar(vazio.getByRole('heading', { name: treinamentoVazioFixture.vazioTitulo })).toBeInTheDocument()
    esperar(vazio.getByText(treinamentoVazioFixture.vazioDescricao)).toBeInTheDocument()
  })

  testar('abrir um tutorial avisa quem é, e fechar avisa de volta', () => {
    const aoAbrirTutorial = vi.fn()
    renderizar(<Treinamento dados={treinamentoFixture} pasta="cat-equipamento" aoAbrirTutorial={aoAbrirTutorial} />)

    dispararEvento.click(tela.getByRole('button', { name: /Como armar o softbox/ }))
    esperar(aoAbrirTutorial).toHaveBeenCalledExactlyOnceWith('tut-softbox')

    const aoFecharTutorial = vi.fn()
    renderizar(<Treinamento dados={treinamentoAbertoFixture} aoFecharTutorial={aoFecharTutorial} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Fechar' }))
    esperar(aoFecharTutorial).toHaveBeenCalledExactlyOnceWith()
  })

  testar('o tutorial aberto mostra os blocos na ordem, com texto e foto', () => {
    renderizar(<Treinamento dados={treinamentoAbertoFixture} />)

    const dialogo = dentroDe(tela.getByRole('dialog', { name: 'Como armar o softbox' }))
    esperar(dialogo.getByRole('heading', { name: 'Como armar o softbox' })).toBeInTheDocument()
    esperar(dialogo.getByText('Equipamento')).toBeInTheDocument()
    // O rodapé junta "atualizado em …" e o status na mesma linha.
    esperar(tela.getByRole('dialog')).toHaveTextContent(treinamentoAbertoFixture.selecionado!.atualizado)

    esperar(dialogo.getByText(/Monte o tripé/)).toBeInTheDocument()
    esperar(dialogo.getByRole('img', { name: 'Foto do passo 2' })).toBeInTheDocument()
    // Mídia expirada continua sendo um bloco: o registro diz que o arquivo sumiu.
    esperar(dialogo.getByRole('img', { name: 'Foto do passo 4, indisponível' })).toBeInTheDocument()
  })

  testar('tocar na foto abre ela na tela inteira, e fechar volta ao tutorial', () => {
    renderizar(<Treinamento dados={treinamentoAbertoFixture} />)

    dispararEvento.click(tela.getByRole('button', { name: 'Ampliar foto: Foto do passo 2' }))
    const cheia = dentroDe(tela.getByRole('dialog', { name: 'Foto: Foto do passo 2' }))
    esperar(cheia.getByRole('img', { name: 'Foto do passo 2' })).toHaveAttribute('src', '/midia/f1?t=exemplo')
    // O tutorial atrás não recebe toque enquanto a foto está aberta.
    esperar(tela.getByRole('dialog', { name: 'Como armar o softbox', hidden: true })).toHaveAttribute('inert')

    dispararEvento.click(cheia.getByRole('button', { name: 'Fechar' }))
    esperar(tela.queryByRole('dialog', { name: 'Foto: Foto do passo 2' })).not.toBeInTheDocument()
    esperar(tela.getByRole('dialog', { name: 'Como armar o softbox' })).not.toHaveAttribute('inert')
  })

  testar('tutorial sem bloco diz isso, em vez de um diálogo vazio', () => {
    renderizar(<Treinamento dados={treinamentoSemBlocosFixture} />)

    esperar(dentroDe(tela.getByRole('dialog')).getByText('Este tutorial ainda não tem blocos.'))
      .toBeInTheDocument()
  })

  testar('a lista atrás do diálogo fica inerte', () => {
    const { container } = renderizar(<Treinamento dados={treinamentoAbertoFixture} />)

    esperar(container.querySelector('[inert]')).not.toBeNull()
  })

  testar('a busca vai a cada letra, sem botão "Buscar", e o que foi digitado fica na caixa', () => {
    const aoDigitarBusca = vi.fn()
    renderizar(<Treinamento dados={treinamentoFixture} digitado="softbox" aoDigitarBusca={aoDigitarBusca} />)

    const formulario = dentroDe(tela.getByRole('form', { name: 'Buscar tutorial' }))
    const campo = formulario.getByLabelText('Buscar')
    esperar(campo).toHaveValue('softbox')
    dispararEvento.change(campo, { target: { value: 'tripé' } })
    esperar(aoDigitarBusca).toHaveBeenLastCalledWith('tripé')
    esperar(formulario.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument()
  })

  testar('"Limpar" só existe quando há algo digitado', () => {
    const aoLimparBusca = vi.fn()
    renderizar(<Treinamento dados={treinamentoFixture} aoLimparBusca={aoLimparBusca} />)
    esperar(tela.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument()

    renderizar(<Treinamento dados={treinamentoFixture} digitado="softbox" aoLimparBusca={aoLimparBusca} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Limpar' }))
    esperar(aoLimparBusca).toHaveBeenCalledExactlyOnceWith()
  })

  testar('achado só no texto mostra o trecho, com o termo marcado', () => {
    const dados = {
      ...treinamentoFixture,
      categorias: [{ ...treinamentoFixture.categorias[0], tutoriais: [{
        ...treinamentoFixture.categorias[0].tutoriais[0],
        trecho: [{ texto: 'O ', marcado: false }, { texto: 'difusor', marcado: true }, { texto: ' entra por último.', marcado: false }],
      }] }],
    }
    renderizar(<Treinamento dados={dados} pasta="cat-equipamento" />)
    esperar(tela.getByText('difusor').tagName).toBe('MARK')
  })

  testar('o atendente reporta problema com texto, e vê a confirmação', async () => {
    const aoReportarProblema = vi.fn(async () => ({ texto: 'Aviso enviado. A administração vai revisar o tutorial.', erro: false }))
    renderizar(<Treinamento dados={treinamentoAbertoFixture} aoReportarProblema={aoReportarProblema} />)

    dispararEvento.click(tela.getByRole('button', { name: 'Reportar problema' }))
    const form = dentroDe(tela.getByRole('form', { name: 'Reportar problema' }))
    esperar(form.getByRole('button', { name: 'Enviar para a administração' })).toBeDisabled()
    dispararEvento.change(form.getByLabelText('O que está errado neste tutorial?'), { target: { value: 'foto velha' } })
    dispararEvento.click(form.getByRole('button', { name: 'Enviar para a administração' }))

    esperar(await tela.findByRole('status')).toHaveTextContent('Aviso enviado')
    esperar(aoReportarProblema).toHaveBeenCalledExactlyOnceWith('tut-softbox', 'foto velha')
  })

  testar('"Incluir arquivados" mostra em que estado está', () => {
    const aoAlternarArquivados = vi.fn()
    renderizar(<Treinamento dados={treinamentoFixture} aoAlternarArquivados={aoAlternarArquivados} />)
    esperar(tela.getByRole('button', { name: 'Incluir arquivados' })).toHaveAttribute('aria-pressed', 'false')

    dispararEvento.click(tela.getByRole('button', { name: 'Incluir arquivados' }))
    esperar(aoAlternarArquivados).toHaveBeenCalledExactlyOnceWith()
  })

  // "Destaque para tutoriais antigos" (spec · issue #149). Cor sozinha não
  // serve: quem não distingue tom precisa do texto, e é o texto que o teste
  // procura.
  testar('tutorial vencido diz por que está marcado, não só muda de cor', () => {
    renderizar(<Treinamento dados={treinamentoArquivadosFixture} pasta="cat-equipamento" />)

    const vencido = tela.getByRole('button', { name: /Fundo infinito de papel/ })
    esperar(vencido).toHaveTextContent('revisar — sem atualização há mais de 6 meses')
    esperar(vencido.className).toContain('lt-treinamento-material-antigo')
  })

  testar('tutorial em dia não ganha marca nenhuma', () => {
    renderizar(<Treinamento dados={treinamentoFixture} pasta="cat-equipamento" />)

    const emDia = tela.getByRole('button', { name: /Como armar o softbox/ })
    esperar(emDia).not.toHaveTextContent('revisar')
    esperar(emDia.className).not.toContain('lt-treinamento-material-antigo')
  })

  testar('com arquivados ligados, o cartão arquivado se identifica', () => {
    renderizar(<Treinamento dados={treinamentoArquivadosFixture} pasta="cat-equipamento" />)

    esperar(tela.getByRole('button', { name: 'Incluir arquivados' })).toHaveAttribute('aria-pressed', 'true')
    esperar(tela.getByRole('button', { name: /Fundo infinito de papel/ })).toHaveTextContent('arquivado')
  })
})
