/// <reference types="vite/client" />
import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'
import ts from 'typescript'
import fonteHorasExtras from './HorasExtras.tsx?raw'
import fonteEscala from './Escala.tsx?raw'
import { HorasExtras, type CampoLancamentoExtra, type DadosHorasExtras } from './HorasExtras'
import { horasExtrasAtendenteFixture, horasExtrasCanceladasFixture, horasExtrasCancelamentoFixture, horasExtrasCancelamentoVazioFixture, horasExtrasFixture, horasExtrasHistoricoFixture, horasExtrasLancamentoFixture, horasExtrasLancamentoVazioFixture, horasExtrasPagasFixture, horasExtrasVazioFixture } from './HorasExtras.fixture'

const nomeRegistro = (extra: DadosHorasExtras['registros'][number]) => `${extra.colaborador} · ${extra.data} · ${extra.identificador}`

descrever('Horas extras', () => {
  testar('renderiza o fixture cheio com assinatura, totais, registros e avisos completos', () => {
    renderizar(<HorasExtras dados={horasExtrasFixture} />)
    esperar(tela.getByRole('heading', { name: 'Horas extras' })).toBeInTheDocument()
    esperar(tela.getByRole('banner').textContent?.split('·').map((parte) => parte.trim())).toEqual(['LIFETRAILER', 'Horas extras', horasExtrasFixture.data, horasExtrasFixture.turno, horasExtrasFixture.hora])
    const totais = tela.getByRole('list', { name: 'Totais pendentes por colaborador' })
    esperar(dentroDe(totais).getAllByRole('listitem')).toHaveLength(horasExtrasFixture.totais.length)
    for (const total of horasExtrasFixture.totais) {
      const cartao = dentroDe(totais).getByText(total.colaborador).closest('li')!
      esperar(cartao).toHaveTextContent(total.detalhe)
      esperar(cartao.querySelector('strong')?.textContent).toBe(total.valor)
    }
    const lista = tela.getByRole('list', { name: 'Lançamentos de horas extras' })
    for (const extra of horasExtrasFixture.registros) {
      const registro = dentroDe(lista).getByRole('listitem', { name: nomeRegistro(extra) })
      esperar(registro).toHaveTextContent(extra.intervalo)
      esperar(registro).toHaveTextContent(extra.detalhe)
      esperar(registro).toHaveTextContent(extra.blocos)
      esperar(registro).toHaveTextContent(extra.status)
      esperar(registro.querySelector('.lt-horas-extras-valor strong')?.textContent).toBe(extra.valor)
      for (const aviso of extra.avisos) esperar(registro).toHaveTextContent(aviso.texto)
      esperar(dentroDe(registro).getByRole('button', { name: 'Histórico' })).toHaveAttribute('aria-expanded', 'false')
    }
    esperar(tela.getByText(horasExtrasFixture.rodape)).toBeInTheDocument()
  })

  testar('renderiza o período vazio sem lançamentos ou cartões de colaborador', () => {
    renderizar(<HorasExtras dados={horasExtrasVazioFixture} />)
    const vazio = tela.getByRole('region', { name: 'Nenhuma hora extra nesta aba' })
    esperar(dentroDe(vazio).getByRole('heading', { name: horasExtrasVazioFixture.vazioTitulo })).toBeInTheDocument()
    esperar(vazio).toHaveTextContent(horasExtrasVazioFixture.vazioDescricao)
    esperar(tela.queryByRole('list', { name: 'Lançamentos de horas extras' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('list', { name: 'Totais pendentes por colaborador' })).not.toBeInTheDocument()
    esperar(tela.getByText(horasExtrasVazioFixture.totalPeriodo).textContent).toBe(horasExtrasVazioFixture.totalPeriodo)
  })

  testar('aoLancar é disparado sem abrir um formulário local', () => {
    const aoLancar = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasFixture} aoLancar={aoLancar} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Lançar manual' }))
    esperar(aoLancar).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.queryByRole('form')).not.toBeInTheDocument()
  })

  testar('aoCancelarLancamento atende as duas ações sem fechar o formulário recebido', () => {
    const aoCancelarLancamento = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasLancamentoFixture} aoCancelarLancamento={aoCancelarLancamento} />)
    const formulario = tela.getByRole('form', { name: 'Lançar hora extra manual' })
    dispararEvento.click(dentroDe(formulario).getByRole('button', { name: 'Cancelar' }))
    esperar(aoCancelarLancamento).toHaveBeenCalledExactlyOnceWith()
    aoCancelarLancamento.mockClear()
    dispararEvento.click(tela.getByRole('button', { name: 'Lançar manual' }))
    esperar(aoCancelarLancamento).toHaveBeenCalledExactlyOnceWith()
    esperar(formulario).toBeInTheDocument()
  })

  testar('aoAlterarLancamento recebe todos os campos e preserva valores controlados', () => {
    const aoAlterarLancamento = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasLancamentoFixture} aoAlterarLancamento={aoAlterarLancamento} />)
    const formulario = tela.getByRole('form', { name: 'Lançar hora extra manual' })
    // `type=date`/`type=time` abrem o seletor nativo do tablet e devolvem valor
    // em formato fixo — e não têm papel de textbox, então o acesso é pelo rótulo.
    const campos: [string, CampoLancamentoExtra, string][] = [
      ['Data', 'data', '2026-08-18'], ['Início', 'inicio', '08:15'], ['Fim', 'fim', '09:45'],
    ]
    for (const [rotulo, campo, digitado] of campos) {
      const entrada = dentroDe(formulario).getByLabelText(rotulo)
      dispararEvento.change(entrada, { target: { value: digitado } })
      esperar(aoAlterarLancamento).toHaveBeenLastCalledWith(campo, digitado)
      esperar(entrada).toHaveValue(horasExtrasLancamentoFixture.lancamento![campo])
    }
    esperar(dentroDe(formulario).getByRole('status')).toHaveTextContent(horasExtrasLancamentoFixture.lancamento!.aviso)
  })

  testar('aoSelecionarDestinatario recebe o identificador sem resolver posse nem seleção local', () => {
    const aoSelecionarDestinatario = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasLancamentoFixture} aoSelecionarDestinatario={aoSelecionarDestinatario} />)
    const grupo = tela.getByRole('group', { name: 'Destinatário' })
    for (const pessoa of horasExtrasLancamentoFixture.lancamento!.destinatarios) {
      const botao = dentroDe(grupo).getByRole('button', { name: pessoa.rotulo })
      dispararEvento.click(botao)
      esperar(aoSelecionarDestinatario).toHaveBeenLastCalledWith(pessoa.identificador)
      esperar(botao).toHaveAttribute('aria-pressed', String(pessoa.selecionado))
    }
  })

  testar('aoEnviarLancamento respeita podeEnviar inclusive no submit direto', () => {
    const aoEnviarLancamento = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<HorasExtras dados={horasExtrasLancamentoVazioFixture} aoEnviarLancamento={aoEnviarLancamento} />)
    esperar(tela.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()
    dispararEvento.submit(tela.getByRole('form', { name: 'Lançar hora extra manual' }))
    esperar(aoEnviarLancamento).not.toHaveBeenCalled()
    renderizarNovamente(<HorasExtras dados={horasExtrasLancamentoFixture} aoEnviarLancamento={aoEnviarLancamento} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Enviar para aprovação' }))
    esperar(aoEnviarLancamento).toHaveBeenCalledExactlyOnceWith()
    esperar(tela.getByRole('form', { name: 'Lançar hora extra manual' })).toBeInTheDocument()
  })

  testar('aoSelecionarAba recebe cada aba sem filtrar ou alterar status localmente', () => {
    const aoSelecionarAba = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasFixture} aoSelecionarAba={aoSelecionarAba} />)
    const grupo = tela.getByRole('group', { name: 'Situação das horas extras' })
    for (const aba of horasExtrasFixture.abas) {
      const botao = dentroDe(grupo).getByRole('button', { name: aba.rotulo })
      dispararEvento.click(botao)
      esperar(aoSelecionarAba).toHaveBeenLastCalledWith(aba.identificador)
      esperar(botao).toHaveAttribute('aria-pressed', String(aba.selecionada))
    }
    for (const extra of horasExtrasFixture.registros) esperar(tela.getByRole('listitem', { name: nomeRegistro(extra) })).toHaveTextContent(extra.status)
  })

  testar('aoSelecionarPeriodo recebe cada período sem recalcular os totais', () => {
    const aoSelecionarPeriodo = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasFixture} aoSelecionarPeriodo={aoSelecionarPeriodo} />)
    for (const periodo of horasExtrasFixture.periodos) {
      const botao = tela.getByRole('button', { name: periodo.rotulo })
      dispararEvento.click(botao)
      esperar(aoSelecionarPeriodo).toHaveBeenLastCalledWith(periodo.identificador)
      esperar(botao).toHaveAttribute('aria-pressed', String(periodo.selecionado))
      esperar(tela.getByText(horasExtrasFixture.totalPeriodo).textContent).toBe(horasExtrasFixture.totalPeriodo)
    }
  })

  testar('aoAcionarExtra encaminha pagar, cancelar e estornar com identificador e ação', () => {
    const aoAcionarExtra = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<HorasExtras dados={horasExtrasFixture} aoAcionarExtra={aoAcionarExtra} />)
    for (const dados of [horasExtrasFixture, horasExtrasPagasFixture]) {
      renderizarNovamente(<HorasExtras dados={dados} aoAcionarExtra={aoAcionarExtra} />)
      for (const extra of dados.registros) {
        const registro = tela.getByRole('listitem', { name: nomeRegistro(extra) })
        for (const acao of extra.acoes) {
          dispararEvento.click(dentroDe(registro).getByRole('button', { name: acao.rotulo }))
          esperar(aoAcionarExtra).toHaveBeenLastCalledWith(extra.identificador, acao.identificador)
          esperar(registro).toHaveTextContent(extra.status)
        }
      }
    }
  })

  testar('aoAlternarHistorico recebe o registro ao abrir e ocultar sem mutação local', () => {
    const aoAlternarHistorico = vi.fn()
    const { rerender: renderizarNovamente } = renderizar(<HorasExtras dados={horasExtrasFixture} aoAlternarHistorico={aoAlternarHistorico} />)
    for (const dados of [horasExtrasFixture, horasExtrasHistoricoFixture]) {
      renderizarNovamente(<HorasExtras dados={dados} aoAlternarHistorico={aoAlternarHistorico} />)
      for (const extra of dados.registros) {
        const registro = tela.getByRole('listitem', { name: nomeRegistro(extra) })
        const botao = dentroDe(registro).getByRole('button', { name: extra.historicoAberto ? 'Ocultar histórico' : 'Histórico' })
        dispararEvento.click(botao)
        esperar(aoAlternarHistorico).toHaveBeenLastCalledWith(extra.identificador)
        esperar(botao).toHaveAttribute('aria-expanded', String(extra.historicoAberto))
        if (extra.historicoAberto) {
          const historico = dentroDe(registro).getByRole('region', { name: `Histórico de ${extra.identificador}` })
          for (const evento of extra.historico) esperar(historico).toHaveTextContent(evento)
        }
      }
    }
  })

  testar('aoAlterarMotivoCancelamento recebe o identificador e motivo sem liberar confirmação', () => {
    const aoAlterarMotivoCancelamento = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasCancelamentoVazioFixture} aoAlterarMotivoCancelamento={aoAlterarMotivoCancelamento} />)
    const extra = horasExtrasCancelamentoVazioFixture.registros[0]
    const entrada = tela.getByRole('textbox', { name: 'Motivo do cancelamento' })
    dispararEvento.change(entrada, { target: { value: 'Motivo informado' } })
    esperar(aoAlterarMotivoCancelamento).toHaveBeenCalledExactlyOnceWith(extra.identificador, 'Motivo informado')
    esperar(entrada).toHaveValue(extra.cancelamento!.motivo)
    esperar(entrada).toHaveAttribute('aria-invalid', 'true')
    esperar(tela.getByRole('alert')).toHaveTextContent(extra.cancelamento!.erro!)
    esperar(tela.getByRole('button', { name: 'Cancelar a extra' })).toBeDisabled()
  })

  testar('aoVoltarCancelamento recebe o identificador e mantém a confirmação controlada', () => {
    const aoVoltarCancelamento = vi.fn()
    renderizar(<HorasExtras dados={horasExtrasCancelamentoFixture} aoVoltarCancelamento={aoVoltarCancelamento} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Voltar' }))
    esperar(aoVoltarCancelamento).toHaveBeenCalledExactlyOnceWith(horasExtrasCancelamentoFixture.registros[0].identificador)
    esperar(tela.getByRole('textbox', { name: 'Motivo do cancelamento' })).toBeInTheDocument()
  })

  testar('aoConfirmarCancelamento respeita a permissão recebida e encaminha o identificador', () => {
    const aoConfirmarCancelamento = vi.fn()
    const extra = horasExtrasCancelamentoFixture.registros[0]
    const { rerender: renderizarNovamente } = renderizar(<HorasExtras dados={horasExtrasCancelamentoVazioFixture} aoConfirmarCancelamento={aoConfirmarCancelamento} />)
    dispararEvento.submit(tela.getByRole('form', { name: `Cancelar ${extra.identificador}` }))
    esperar(aoConfirmarCancelamento).not.toHaveBeenCalled()
    renderizarNovamente(<HorasExtras dados={horasExtrasCancelamentoFixture} aoConfirmarCancelamento={aoConfirmarCancelamento} />)
    dispararEvento.click(tela.getByRole('button', { name: 'Cancelar a extra' }))
    esperar(aoConfirmarCancelamento).toHaveBeenCalledExactlyOnceWith(extra.identificador)
    esperar(tela.getByRole('listitem', { name: nomeRegistro(extra) })).toHaveTextContent(extra.status)
  })

  testar('apresenta pagas, canceladas e atendente conforme as ações e registros recebidos', () => {
    const { rerender: renderizarNovamente } = renderizar(<HorasExtras dados={horasExtrasPagasFixture} />)
    esperar(tela.getByRole('button', { name: 'Estornar' })).toBeInTheDocument()
    renderizarNovamente(<HorasExtras dados={horasExtrasCanceladasFixture} />)
    esperar(tela.getByRole('listitem', { name: nomeRegistro(horasExtrasCanceladasFixture.registros[0]) })).toHaveTextContent('Cancelada')
    esperar(tela.queryByRole('button', { name: 'Estornar' })).not.toBeInTheDocument()
    renderizarNovamente(<HorasExtras dados={{ ...horasExtrasAtendenteFixture, podeLancar: false }} />)
    esperar(tela.queryByRole('button', { name: 'Marcar paga' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('button', { name: 'Lançar manual' })).not.toBeInTheDocument()
    for (const extra of horasExtrasAtendenteFixture.registros) esperar(tela.getByRole('listitem', { name: nomeRegistro(extra) })).toBeInTheDocument()
  })

  testar('todos os valores monetários são exibidos exatamente como recebidos, inclusive após novas props', () => {
    const { rerender: renderizarNovamente, container: recipiente } = renderizar(<HorasExtras dados={horasExtrasHistoricoFixture} />)
    for (const versao of ['primeira', 'segunda']) {
      // Sentinelas opacas: conversão numérica, formatação, soma, prefixo ou valor fixo falham.
      const dados: DadosHorasExtras = {
        ...horasExtrasHistoricoFixture, totalPeriodo: `${versao}: total recebido`, rodape: `${versao}: rodapé recebido`,
        totais: horasExtrasFixture.totais.map((total) => ({ ...total, valor: `${versao}: total de ${total.colaborador}` })),
        registros: horasExtrasHistoricoFixture.registros.map((extra) => ({ ...extra, valor: `${versao}: valor de ${extra.identificador}`, valorHora: `${versao}: hora de ${extra.identificador}`, acrescimoNoturno: `${versao}: acréscimo de ${extra.identificador}`, referencia: extra.referencia ? { ...extra.referencia, precoEnsaio: `${versao}: preço recebido` } : undefined })),
      }
      renderizarNovamente(<HorasExtras dados={dados} />)
      for (const valor of [dados.totalPeriodo, ...dados.totais.map((total) => total.valor), ...dados.registros.flatMap((extra) => [extra.valor, extra.valorHora, extra.acrescimoNoturno, ...(extra.referencia ? [extra.referencia.precoEnsaio] : [])])]) {
        esperar(tela.getByText(valor).textContent).toBe(valor)
      }
      esperar(recipiente.textContent).not.toMatch(/R\$|[0-9]+[.,][0-9]{2}/)
    }
  })

  testar('componentes não contêm dinheiro, aritmética, formatação ou chamadas que construam valores em runtime', () => {
    for (const [nome, fonte] of [['HorasExtras.tsx', fonteHorasExtras], ['Escala.tsx', fonteEscala]]) {
      esperar(fonte).not.toMatch(/R\$|[0-9]+[.,][0-9]{2}/)
      const arquivo = ts.createSourceFile(nome, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const proibidos: string[] = []
      function visitar(no: ts.Node) {
        if (ts.isImportDeclaration(no) && no.moduleSpecifier.getText(arquivo) !== "'../layout/Moldura'" && !(nome === 'Escala.tsx' && no.importClause?.isTypeOnly && no.moduleSpecifier.getText(arquivo) === "'../tipos/dominio'")) proibidos.push(no.getText(arquivo))
        if (ts.isNewExpression(no) || ts.isTaggedTemplateExpression(no) || ts.isPrefixUnaryExpression(no) && no.operator !== ts.SyntaxKind.ExclamationToken || ts.isPostfixUnaryExpression(no)) proibidos.push(no.getText(arquivo))
        if (ts.isBinaryExpression(no) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken].includes(no.operatorToken.kind)) proibidos.push(no.getText(arquivo))
        if (ts.isCallExpression(no)) {
          const chamada = no.expression
          const permitida = ts.isIdentifier(chamada) && (chamada.text === 'Boolean' || /^ao[A-Z]/.test(chamada.text)) || ts.isPropertyAccessExpression(chamada) && ['map', 'preventDefault'].includes(chamada.name.text)
          if (!permitida) proibidos.push(no.getText(arquivo))
        }
        ts.forEachChild(no, visitar)
      }
      visitar(arquivo)
      esperar(proibidos, nome).toEqual([])
    }
  })

  testar('valores, acréscimos, preço base e totais dos fixtures conferem com os CSVs', async () => {
    // APIs nativas somente no teste, sem acrescentar dependências ao app.
    const { readFileSync: lerArquivo } = await vi.importActual<{ readFileSync: (caminho: URL, formato: 'utf8') => string }>('node:fs')
    const origem = import.meta.url
    const acrescimosCsv = lerArquivo(new URL('../../../../data/acrescimo-noturno.csv', origem), 'utf8')
    const precosCsv = lerArquivo(new URL('../../../../data/precos.csv', origem), 'utf8')
    const linhaAcrescimo = acrescimosCsv.trim().split(/\r?\n/).slice(1).find((linha) => linha.split(',')[1] === '2026-08-10')!
    const linhaPreco = precosCsv.trim().split(/\r?\n/).slice(1).find((linha) => {
      const [estudio, duracao, , inicio] = linha.split(',')
      return estudio === 'Acustico' && duracao === '60' && inicio === '2026-08-10'
    })!
    esperar(linhaAcrescimo).toBeDefined()
    esperar(linhaPreco).toBeDefined()
    const bloco = Number(linhaAcrescimo.split(',')[0])
    const dinheiro = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor).replace(/\u00a0/g, ' ')
    for (const dados of [horasExtrasFixture, horasExtrasVazioFixture, horasExtrasHistoricoFixture, horasExtrasLancamentoFixture, horasExtrasLancamentoVazioFixture, horasExtrasCancelamentoFixture, horasExtrasCancelamentoVazioFixture, horasExtrasPagasFixture, horasExtrasCanceladasFixture, horasExtrasAtendenteFixture]) {
      for (const extra of dados.registros) {
        esperar(extra.valorHora).toBe(dinheiro(bloco))
        esperar(extra.valor).toBe(dinheiro(Number.parseInt(extra.blocos) * bloco))
        esperar(extra.acrescimoNoturno).toBe(extra.valor)
        if (extra.referencia) esperar(extra.referencia.precoEnsaio).toBe(dinheiro(Number(linhaPreco.split(',')[2])))
      }
      // Pagas/canceladas mantêm o resumo dos pendentes do mesmo período.
      const pendentes = dados === horasExtrasPagasFixture || dados === horasExtrasCanceladasFixture ? horasExtrasFixture.registros : dados.registros
      const total = pendentes.reduce((soma, extra) => soma + Number.parseInt(extra.blocos) * bloco, 0)
      esperar(dados.totalPeriodo).toBe(dinheiro(total))
      for (const resumo of dados.totais) {
        const soma = pendentes.filter((extra) => extra.colaborador === resumo.colaborador).reduce((valor, extra) => valor + Number.parseInt(extra.blocos) * bloco, 0)
        esperar(resumo.valor).toBe(dinheiro(soma))
      }
    }
  })
})
