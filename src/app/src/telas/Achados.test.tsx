import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { Achados, type CampoRegistroAchado } from './Achados'
import {
  achadosCompartilharFixture, achadosDetalheFixture, achadosDoacaoFixture, achadosDoacaoVaziaFixture,
  achadosEntreguesFixture, achadosEntregaFixture, achadosEntregaVaziaFixture,
  achadosFixture, achadosRegistroFixture,
  achadosRegistroVazioFixture, achadosSemFotoFixture, achadosVazioFixture,
} from './Achados.fixture'

descrever('Achados', () => {
  testar('renderiza o fixture completo com regiões, filtros, cartões e fotos nomeados', () => {
    renderizar(<Achados dados={achadosFixture} />)

    const regiao = tela.getByRole('region', { name: 'Achados e perdidos' })
    esperar(dentroDe(regiao).getByRole('heading', { name: 'Achados e perdidos' })).toBeInTheDocument()
    esperar(dentroDe(regiao).getByText(achadosFixture.subtitulo)).toBeInTheDocument()
    const filtros = dentroDe(regiao).getByRole('group', { name: 'Ações e filtros de achados' })
    esperar(dentroDe(filtros).getByRole('button', { name: 'Registrar achado' })).toHaveAttribute('aria-expanded', 'false')
    const abas = dentroDe(filtros).getByRole('group', { name: 'Situação dos achados' })
    for (const aba of achadosFixture.abas) {
      esperar(dentroDe(abas).getByRole('button', { name: aba.rotulo })).toHaveAttribute('aria-pressed', String(aba.selecionada))
    }
    const lista = dentroDe(regiao).getByRole('list', { name: 'Itens achados' })
    esperar(dentroDe(lista).getAllByRole('listitem')).toHaveLength(achadosFixture.achados.length)
    for (const achado of achadosFixture.achados) {
      const cartao = dentroDe(lista).getByRole('button', { name: `Abrir ${achado.descricao}, ${achado.codigo}` })
      esperar(cartao).toHaveAttribute('data-status', achado.status)
      esperar(cartao).toHaveTextContent(achado.rotuloStatus)
      esperar(cartao).toHaveTextContent(`${achado.codigo} · ${achado.local}`)
      esperar(dentroDe(cartao).getByRole('img', { name: achado.descricaoFoto })).toBeInTheDocument()
    }
    esperar(dentroDe(regiao).getByText(achadosFixture.rodape)).toBeInTheDocument()
  })

  testar.each([
    ['lista', achadosFixture], ['vazio', achadosVazioFixture], ['registro', achadosRegistroFixture],
    ['detalhe', achadosDetalheFixture], ['entrega', achadosEntregaFixture],
    ['doacao', achadosDoacaoFixture],
  ])('preserva a assinatura da Moldura em %s', (_, dados) => {
    renderizar(<Achados dados={dados} />)

    const assinatura = tela.getByRole('banner', { name: 'Identificação da tela' })
    esperar(assinatura.textContent?.split('·').map((parte) => parte.trim())).toEqual(['LIFETRAILER', 'Achados', dados.data, dados.turno, dados.hora])
  })

  testar('mostra o estado vazio com ação de registrar e sem cartões', () => {
    const aoRegistrarAchado = vi.fn()
    renderizar(<Achados dados={achadosVazioFixture} aoRegistrarAchado={aoRegistrarAchado} />)

    const vazio = tela.getByRole('region', { name: 'Nenhum achado nesta aba' })
    esperar(dentroDe(vazio).getByText(achadosVazioFixture.mensagemVazia)).toBeInTheDocument()
    esperar(tela.queryByRole('list', { name: 'Itens achados' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('img')).not.toBeInTheDocument()
    dispararEvento.click(dentroDe(vazio).getByRole('button', { name: 'Registrar achado' }))
    esperar(aoRegistrarAchado).toHaveBeenCalledOnce()
    esperar(tela.queryByRole('form', { name: 'Registrar achado' })).not.toBeInTheDocument()
  })

  testar('emite registro, troca de aba e abertura sem alterar os dados recebidos', () => {
    const aoRegistrarAchado = vi.fn()
    const aoSelecionarAba = vi.fn()
    const aoAbrirAchado = vi.fn()
    renderizar(<Achados dados={achadosFixture} aoRegistrarAchado={aoRegistrarAchado} aoSelecionarAba={aoSelecionarAba} aoAbrirAchado={aoAbrirAchado} />)

    dispararEvento.click(tela.getByRole('button', { name: 'Registrar achado' }))
    esperar(aoRegistrarAchado).toHaveBeenCalledOnce()
    for (const aba of achadosFixture.abas) {
      const botao = tela.getByRole('button', { name: aba.rotulo })
      dispararEvento.click(botao)
      esperar(aoSelecionarAba).toHaveBeenLastCalledWith(aba.identificador)
      esperar(botao).toHaveAttribute('aria-pressed', String(aba.selecionada))
    }
    for (const achado of achadosFixture.achados) {
      dispararEvento.click(tela.getByRole('button', { name: `Abrir ${achado.descricao}, ${achado.codigo}` }))
      esperar(aoAbrirAchado).toHaveBeenLastCalledWith(achado.identificador)
    }
    esperar(tela.queryByRole('dialog')).not.toBeInTheDocument()
    esperar(tela.queryByRole('form')).not.toBeInTheDocument()
  })

  testar('renderiza os campos controlados e emite todas as ações do registro', () => {
    const registro = achadosRegistroFixture.registro
    if (!registro) throw new Error('O fixture precisa conter o registro')
    const aoAlterarRegistro = vi.fn()
    const aoEscolherFoto = vi.fn()
    const aoSelecionarEstudio = vi.fn()
    const aoSelecionarLugar = vi.fn()
    const aoCancelarRegistro = vi.fn()
    const aoGuardarAchado = vi.fn()
    renderizar(<Achados dados={achadosRegistroFixture} aoAlterarRegistro={aoAlterarRegistro} aoEscolherFoto={aoEscolherFoto} aoSelecionarEstudio={aoSelecionarEstudio} aoSelecionarLugar={aoSelecionarLugar} aoCancelarRegistro={aoCancelarRegistro} aoGuardarAchado={aoGuardarAchado} />)

    const formulario = tela.getByRole('form', { name: 'Registrar achado' })
    esperar(dentroDe(formulario).getByRole('heading', { name: 'Registrar achado' })).toBeInTheDocument()
    esperar(dentroDe(formulario).getByRole('img', { name: registro.descricaoFoto })).toBeInTheDocument()
    const campos: { nome: string; campo: CampoRegistroAchado }[] = [
      { nome: 'O que é', campo: 'descricao' },
      { nome: 'Nome do cliente — opcional', campo: 'cliente' },
      { nome: 'Observação — opcional', campo: 'observacao' },
    ]
    for (const { nome, campo } of campos) {
      const entrada = dentroDe(formulario).getByRole('textbox', { name: nome })
      esperar(entrada).toHaveValue(registro[campo])
      dispararEvento.change(entrada, { target: { value: 'Valor informado' } })
      esperar(aoAlterarRegistro).toHaveBeenLastCalledWith(campo, 'Valor informado')
      esperar(entrada).toHaveValue(registro[campo])
    }
    // `type="date"` não é textbox: o seletor nativo do tablet vale mais que um
    // `dd/mm` digitado, e o servidor deixa de precisar de um parser (ADR 0053 §3).
    const dataDoAchado = dentroDe(formulario).getByLabelText('Data')
    esperar(dataDoAchado).toHaveValue(registro.data)
    dispararEvento.change(dataDoAchado, { target: { value: '2026-09-01' } })
    esperar(aoAlterarRegistro).toHaveBeenLastCalledWith('data', '2026-09-01')

    // A foto é escolhida aqui e só sobe depois do Guardar (ADR 0053 §1).
    const escolherFoto = dentroDe(formulario).getByLabelText('Selecionar foto do achado')
    const arquivo = new File(['x'], 'casaco.jpg', { type: 'image/jpeg' })
    dispararEvento.change(escolherFoto, { target: { files: [arquivo] } })
    esperar(aoEscolherFoto).toHaveBeenCalledExactlyOnceWith(arquivo)

    for (const [nome, lista, aoSelecionar] of [
      ['Estúdio — opcional', registro.estudios, aoSelecionarEstudio],
      ['Guardado onde', registro.lugares, aoSelecionarLugar],
    ] as const) {
      const grupo = dentroDe(formulario).getByRole('group', { name: nome })
      for (const escolha of lista) {
        const botao = dentroDe(grupo).getByRole('button', { name: escolha.rotulo })
        esperar(botao).toHaveAttribute('aria-pressed', String(escolha.selecionado))
        dispararEvento.click(botao)
        esperar(aoSelecionar).toHaveBeenLastCalledWith(escolha.identificador)
        esperar(botao).toHaveAttribute('aria-pressed', String(escolha.selecionado))
      }
    }
    esperar(dentroDe(formulario).getByRole('status', { name: 'Orientação para guardar o achado' })).toHaveTextContent(registro.aviso)
    dispararEvento.click(dentroDe(formulario).getByRole('button', { name: 'Cancelar' }))
    esperar(aoCancelarRegistro).toHaveBeenCalledOnce()
    dispararEvento.click(dentroDe(formulario).getByRole('button', { name: 'Guardar' }))
    esperar(aoGuardarAchado).toHaveBeenCalledOnce()
    esperar(formulario).toBeInTheDocument()
  })

  testar('respeita a permissão de guardar recebida, inclusive na submissão do formulário', () => {
    const aoGuardarAchado = vi.fn()
    renderizar(<Achados dados={achadosRegistroVazioFixture} aoGuardarAchado={aoGuardarAchado} />)

    esperar(tela.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    dispararEvento.submit(tela.getByRole('form', { name: 'Registrar achado' }))
    esperar(aoGuardarAchado).not.toHaveBeenCalled()
  })

  testar('o achado sem foto oferece "Anexar foto", e só ele', () => {
    const aoAnexarFoto = vi.fn()
    const { unmount: desmontar } = renderizar(<Achados dados={achadosSemFotoFixture} aoAnexarFoto={aoAnexarFoto} />)

    const arquivo = new File(['x'], 'casaco.jpg', { type: 'image/jpeg' })
    dispararEvento.change(tela.getByLabelText('Anexar foto'), { target: { files: [arquivo] } })
    esperar(aoAnexarFoto).toHaveBeenCalledExactlyOnceWith(achadosSemFotoFixture.selecionado?.identificador, arquivo)
    desmontar()

    // O detalhe de um achado que JÁ tem foto não oferece o gesto: o write-once
    // do ADR 0051 §7 recusaria a segunda com LT002.
    renderizar(<Achados dados={achadosDetalheFixture} />)
    esperar(tela.queryByLabelText('Anexar foto')).not.toBeInTheDocument()
  })

  descrever('alerta de possível duplicata', () => {
    const registro = achadosRegistroFixture.registro
    if (!registro) throw new Error('O fixture precisa conter o formulário')
    const ALERTA = 'Itens já guardados deste estúdio nesta data'

    testar('avisa quando o estúdio e a data escolhidos já têm item guardado', () => {
      renderizar(<Achados dados={achadosRegistroFixture} />)

      const lista = tela.getByRole('list', { name: ALERTA })
      esperar(dentroDe(lista).getAllByRole('listitem').map((i) => i.textContent))
        .toEqual(['Blusa cinza · Gaveta A/P'])
      esperar(tela.getByText(registro.avisoDuplicata)).toBeInTheDocument()
      // Alerta, não trava: quem decide se é o mesmo casaco é quem está com ele
      // na mão.
      esperar(tela.getByRole('button', { name: 'Guardar' })).toBeEnabled()
    })

    testar('outra data no mesmo estúdio não é duplicata', () => {
      renderizar(<Achados dados={{ ...achadosRegistroFixture, registro: { ...registro, data: '2026-08-19' } }} />)
      esperar(tela.queryByRole('list', { name: ALERTA })).not.toBeInTheDocument()
    })

    testar('data vazia quer dizer o hoje do servidor, e ele também casa', () => {
      renderizar(<Achados dados={{ ...achadosRegistroFixture, registro: { ...registro, data: '' } }} />)
      esperar(tela.getByRole('list', { name: ALERTA })).toBeInTheDocument()
    })

    testar('sem estúdio escolhido não há alerta, mesmo com item guardado na data', () => {
      // A regra é "mesmo estúdio e data". O guarda-chuva do fixture está na
      // mesma data e sem estúdio — e um aviso que aparece todo dia é um aviso
      // que ninguém lê no dia que importa.
      const semEstudio = { ...registro, estudios: registro.estudios.map((e) => ({ ...e, selecionado: false })) }
      renderizar(<Achados dados={{ ...achadosRegistroFixture, registro: semEstudio }} />)
      esperar(tela.queryByRole('list', { name: ALERTA })).not.toBeInTheDocument()
    })
  })

  descrever('procurar o dono pelo ManyChat (ADR 0075)', () => {
    testar('o detalhe com foto e em guarda oferece copiar e baixar, com o aviso colado', () => {
      const compartilhar = achadosCompartilharFixture.selecionado?.compartilhar
      if (!compartilhar) throw new Error('O fixture precisa conter o compartilhamento')
      const aoCopiar = vi.fn()
      renderizar(<Achados dados={achadosCompartilharFixture} aoCopiarMensagemDoAchado={aoCopiar} />)

      dispararEvento.click(tela.getByRole('button', { name: compartilhar.rotulo }))
      esperar(aoCopiar).toHaveBeenCalledOnce()
      esperar(tela.getByRole('link', { name: compartilhar.baixarFoto })).toBeInTheDocument()
      esperar(tela.getByText(compartilhar.aviso)).toBeInTheDocument()
      // O que o texto NÃO diz é tão decidido quanto o que ele diz: a observação
      // é o que confere o dono, e o nome do cliente é de um terceiro.
      esperar(compartilhar.texto).not.toContain('tem uma foto dentro')
      esperar(compartilhar.texto).not.toContain('Renata')
    })

    testar('achado sem foto não oferece o botão', () => {
      // Sem foto não há o que identifique o item do outro lado.
      renderizar(<Achados dados={achadosSemFotoFixture} />)
      esperar(tela.queryByRole('button', { name: 'Copiar mensagem' })).not.toBeInTheDocument()
    })
  })

  testar('renderiza o detalhe e emite as ações e todas as formas de fechamento', () => {
    const selecionado = achadosDetalheFixture.selecionado
    if (!selecionado) throw new Error('O fixture precisa conter um achado selecionado')
    const aoAcionarAchado = vi.fn()
    const aoFecharAchado = vi.fn()
    renderizar(<Achados dados={achadosDetalheFixture} aoAcionarAchado={aoAcionarAchado} aoFecharAchado={aoFecharAchado} />)

    const detalhe = tela.getByRole('dialog', { name: `Detalhes de ${selecionado.descricao}` })
    esperar(detalhe).toHaveAttribute('aria-modal', 'true')
    esperar(dentroDe(detalhe).getByRole('heading', { name: selecionado.descricao })).toBeInTheDocument()
    esperar(dentroDe(detalhe).getByRole('img', { name: selecionado.descricaoFoto })).toBeInTheDocument()
    esperar(dentroDe(detalhe).getByText(selecionado.rotuloStatus)).toBeInTheDocument()
    esperar(dentroDe(detalhe).getByText(selecionado.linha)).toBeInTheDocument()
    esperar(dentroDe(detalhe).getByText(selecionado.meta)).toBeInTheDocument()
    const historico = dentroDe(detalhe).getByRole('region', { name: 'Histórico do achado' })
    const registros = dentroDe(historico).getByRole('list', { name: 'Registros do achado' })
    for (const linha of selecionado.historico) esperar(dentroDe(registros).getByText(linha)).toBeInTheDocument()
    const acoes = dentroDe(detalhe).getByRole('group', { name: 'Ações do achado' })
    for (const acao of selecionado.acoes) {
      dispararEvento.click(dentroDe(acoes).getByRole('button', { name: acao.rotulo }))
      esperar(aoAcionarAchado).toHaveBeenLastCalledWith(selecionado.identificador, acao.identificador)
    }
    const fechar = dentroDe(detalhe).getByRole('button', { name: 'Fechar achado' })
    esperar(fechar).toHaveFocus()
    dispararEvento.click(fechar)
    esperar(aoFecharAchado).toHaveBeenCalledOnce()
    aoFecharAchado.mockClear()
    dispararEvento.click(tela.getByRole('button', { name: 'Fechar detalhe do achado' }))
    esperar(aoFecharAchado).toHaveBeenCalledOnce()
    aoFecharAchado.mockClear()
    dispararEvento.keyDown(detalhe, { key: 'Escape' })
    esperar(aoFecharAchado).toHaveBeenCalledOnce()
    esperar(detalhe).toBeInTheDocument()
  })

  testar('mantém a navegação por teclado dentro do detalhe', () => {
    const selecionado = achadosDetalheFixture.selecionado
    if (!selecionado) throw new Error('O fixture precisa conter um achado selecionado')
    renderizar(<Achados dados={achadosDetalheFixture} />)

    const detalhe = tela.getByRole('dialog', { name: `Detalhes de ${selecionado.descricao}` })
    const fechar = dentroDe(detalhe).getByRole('button', { name: 'Fechar achado' })
    // O último controle do detalhe é a segunda ação: todo guardado oferece as
    // duas saídas (ADR 0054 §2), e é nela que o laço de foco dá a volta.
    const doar = dentroDe(detalhe).getByRole('button', { name: 'Doar' })
    dispararEvento.keyDown(fechar, { key: 'Tab', shiftKey: true })
    esperar(doar).toHaveFocus()
    dispararEvento.keyDown(doar, { key: 'Tab' })
    esperar(fechar).toHaveFocus()
  })

  testar('renderiza a entrega controlada e emite alteração, confirmação e cancelamento', () => {
    const selecionado = achadosEntregaFixture.selecionado
    if (!selecionado?.entrega) throw new Error('O fixture precisa conter a entrega')
    const aoAlterarNomeRetirada = vi.fn()
    const aoConfirmarEntrega = vi.fn()
    const aoCancelarEntrega = vi.fn()
    renderizar(<Achados dados={achadosEntregaFixture} aoAlterarNomeRetirada={aoAlterarNomeRetirada} aoConfirmarEntrega={aoConfirmarEntrega} aoCancelarEntrega={aoCancelarEntrega} />)

    const entrega = tela.getByRole('form', { name: 'Entrega do achado' })
    const nome = dentroDe(entrega).getByRole('textbox', { name: 'Entregue para quem' })
    esperar(nome).toHaveValue(selecionado.entrega.nomeRetirada)
    esperar(dentroDe(entrega).getByText(selecionado.entrega.aviso)).toBeInTheDocument()
    dispararEvento.change(nome, { target: { value: 'Nome informado' } })
    esperar(aoAlterarNomeRetirada).toHaveBeenCalledWith(selecionado.identificador, 'Nome informado')
    esperar(nome).toHaveValue(selecionado.entrega.nomeRetirada)
    dispararEvento.click(dentroDe(entrega).getByRole('button', { name: 'Confirmar entrega' }))
    esperar(aoConfirmarEntrega).toHaveBeenCalledWith(selecionado.identificador)
    dispararEvento.click(dentroDe(entrega).getByRole('button', { name: 'Cancelar' }))
    esperar(aoCancelarEntrega).toHaveBeenCalledWith(selecionado.identificador)
    esperar(entrega).toBeInTheDocument()
  })

  testar('respeita a permissão de confirmar recebida sem validar o nome na tela', () => {
    const aoConfirmarEntrega = vi.fn()
    renderizar(<Achados dados={achadosEntregaVaziaFixture} aoConfirmarEntrega={aoConfirmarEntrega} />)

    esperar(tela.getByRole('textbox', { name: 'Entregue para quem' })).toHaveValue('')
    esperar(tela.getByRole('button', { name: 'Confirmar entrega' })).toBeDisabled()
    dispararEvento.submit(tela.getByRole('form', { name: 'Entrega do achado' }))
    esperar(aoConfirmarEntrega).not.toHaveBeenCalled()
  })

  testar('renderiza a doação controlada e emite alteração, confirmação e cancelamento', () => {
    const selecionado = achadosDoacaoFixture.selecionado
    if (!selecionado?.doacao) throw new Error('O fixture precisa conter a doação')
    const aoAlterarDestino = vi.fn()
    const aoConfirmarDoacao = vi.fn()
    const aoCancelarDoacao = vi.fn()
    renderizar(<Achados dados={achadosDoacaoFixture} aoAlterarDestino={aoAlterarDestino} aoConfirmarDoacao={aoConfirmarDoacao} aoCancelarDoacao={aoCancelarDoacao} />)

    const doacao = tela.getByRole('form', { name: 'Doação do achado' })
    const destino = dentroDe(doacao).getByRole('textbox', { name: 'Destino da doação' })
    esperar(destino).toHaveValue(selecionado.doacao.destino)
    esperar(dentroDe(doacao).getByText(selecionado.doacao.aviso)).toBeInTheDocument()
    dispararEvento.change(destino, { target: { value: 'Outro destino' } })
    esperar(aoAlterarDestino).toHaveBeenCalledWith(selecionado.identificador, 'Outro destino')
    // Campo controlado: o valor só muda quando os dados voltam com ele.
    esperar(destino).toHaveValue(selecionado.doacao.destino)
    dispararEvento.click(dentroDe(doacao).getByRole('button', { name: 'Confirmar doação' }))
    esperar(aoConfirmarDoacao).toHaveBeenCalledWith(selecionado.identificador)
    dispararEvento.click(dentroDe(doacao).getByRole('button', { name: 'Cancelar' }))
    esperar(aoCancelarDoacao).toHaveBeenCalledWith(selecionado.identificador)
    esperar(doacao).toBeInTheDocument()
  })

  testar('sem destino não dá para confirmar a doação, nem pela submissão', () => {
    const aoConfirmarDoacao = vi.fn()
    renderizar(<Achados dados={achadosDoacaoVaziaFixture} aoConfirmarDoacao={aoConfirmarDoacao} />)

    esperar(tela.getByRole('textbox', { name: 'Destino da doação' })).toHaveValue('')
    esperar(tela.getByRole('button', { name: 'Confirmar doação' })).toBeDisabled()
    dispararEvento.submit(tela.getByRole('form', { name: 'Doação do achado' }))
    esperar(aoConfirmarDoacao).not.toHaveBeenCalled()
  })

  testar('apresenta foto recebida e rótulo visual sem converter o enum de domínio', () => {
    const achado = achadosEntreguesFixture.achados[0]
    renderizar(<Achados dados={achadosEntreguesFixture} />)

    const cartao = tela.getByRole('button', { name: `Abrir ${achado.descricao}, ${achado.codigo}` })
    esperar(cartao).toHaveAttribute('data-status', achado.status)
    esperar(cartao).toHaveTextContent(achado.rotuloStatus)
    esperar(dentroDe(cartao).getByRole('img', { name: achado.descricaoFoto })).toHaveAttribute('src', achado.foto)
    esperar(tela.getByRole('button', { name: 'Entregues' })).toHaveAttribute('aria-pressed', 'true')
    esperar(tela.getByText(achadosEntreguesFixture.subtitulo)).toBeInTheDocument()
  })
})
