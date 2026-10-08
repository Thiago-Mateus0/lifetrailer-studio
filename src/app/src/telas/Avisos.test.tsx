import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { Avisos } from './Avisos'
import {
  avisosArquivadosFixture,
  avisosAtendenteFixture,
  avisosEditandoFixture,
  avisosEscrevendoFixture,
  avisosFixture,
  avisosLeiturasFixture,
  avisosLembretesFixture,
  avisosSistemaFixture,
  avisosVaziosFixture,
} from './Avisos.fixture'

descrever('Avisos', () => {
  testar.each([
    ['publicados', avisosFixture],
    ['atendente', avisosAtendenteFixture],
    ['sistema', avisosSistemaFixture],
    ['arquivados', avisosArquivadosFixture],
    ['lembretes', avisosLembretesFixture],
  ])('renderiza o fixture cheio de %s com regiões e controles nomeados', (_, dados) => {
    renderizar(<Avisos dados={dados} />)

    esperar(tela.getByRole('region', { name: 'Avisos' })).toBeInTheDocument()
    esperar(tela.getByRole('heading', { name: 'Avisos' })).toBeInTheDocument()
    esperar(tela.getByText(dados.subtitulo)).toBeInTheDocument()
    esperar(tela.getByText(dados.rodape)).toBeInTheDocument()
    const faixa = tela.getByRole('banner', { name: 'Identificação da tela' })
    esperar(faixa.textContent?.split('·').map((parte) => parte.trim())).toEqual(['LIFETRAILER', 'Avisos', dados.iniciais, dados.hora])
    esperar(tela.getByRole('group', { name: 'Controles dos avisos' })).toBeInTheDocument()
    const abas = tela.getByRole('group', { name: 'Abas dos avisos' })
    for (const aba of dados.abas) {
      esperar(dentroDe(abas).getByRole('button', { name: aba.rotulo })).toHaveAttribute('aria-pressed', String(aba.selecionada))
    }
    const lista = tela.getByRole('region', { name: 'Lista de avisos' })
    esperar(dentroDe(lista).getAllByRole('article')).toHaveLength(dados.avisos.length)
    for (const aviso of dados.avisos) {
      const cartao = dentroDe(lista).getByRole('article', { name: aviso.titulo })
      esperar(dentroDe(cartao).getByRole('heading', { name: aviso.titulo })).toBeInTheDocument()
      esperar(dentroDe(cartao).getByText(aviso.texto)).toBeInTheDocument()
      esperar(dentroDe(cartao).getByText(aviso.metadados)).toBeInTheDocument()
      for (const marcador of aviso.marcadores) esperar(dentroDe(cartao).getByText(marcador.rotulo)).toBeInTheDocument()
      if (aviso.status) esperar(dentroDe(cartao).getByRole('status', { name: `Situação de ${aviso.titulo}` })).toHaveTextContent(aviso.status.rotulo)
      else esperar(dentroDe(cartao).queryByRole('status')).not.toBeInTheDocument()
      if (aviso.faltam) esperar(dentroDe(cartao).getByText(aviso.faltam)).toBeInTheDocument()
      if (aviso.acoes.length) {
        const acoes = dentroDe(cartao).getByRole('group', { name: `Ações de ${aviso.titulo}` })
        for (const acao of aviso.acoes) esperar(dentroDe(acoes).getByRole('button', { name: acao.rotulo })).toBeInTheDocument()
      } else esperar(dentroDe(cartao).queryByRole('button')).not.toBeInTheDocument()
    }
    for (const botao of tela.getAllByRole('button')) esperar(botao).toHaveAccessibleName()
  })

  testar('mostra o vazio recebido sem cartões nem imagens decorativas', () => {
    renderizar(<Avisos dados={avisosVaziosFixture} />)

    const lista = tela.getByRole('region', { name: 'Lista de avisos' })
    esperar(dentroDe(lista).getByText(avisosVaziosFixture.mensagemVazia)).toBeInTheDocument()
    esperar(dentroDe(lista).queryByRole('article')).not.toBeInTheDocument()
    esperar(dentroDe(lista).queryByRole('img')).not.toBeInTheDocument()
    esperar(tela.getByRole('button', { name: 'Escrever aviso' })).toBeInTheDocument()
  })

  testar('respeita a permissão de escrita recebida', () => {
    renderizar(<Avisos dados={{ ...avisosVaziosFixture, podeEscrever: false }} />)

    esperar(tela.queryByRole('button', { name: 'Escrever aviso' })).not.toBeInTheDocument()
    esperar(tela.queryByRole('form', { name: 'Escrever aviso' })).not.toBeInTheDocument()
  })

  testar('notifica a troca de aba e a escrita sem alterar a apresentação', () => {
    const aoSelecionarAba = vi.fn()
    const aoAlternarEscrita = vi.fn()
    renderizar(<Avisos dados={avisosFixture} aoSelecionarAba={aoSelecionarAba} aoAlternarEscrita={aoAlternarEscrita} />)

    for (const aba of avisosFixture.abas) {
      dispararEvento.click(tela.getByRole('button', { name: aba.rotulo }))
      esperar(aoSelecionarAba).toHaveBeenLastCalledWith(aba.identificador)
      esperar(tela.getByRole('button', { name: aba.rotulo })).toHaveAttribute('aria-pressed', String(aba.selecionada))
    }
    dispararEvento.click(tela.getByRole('button', { name: 'Escrever aviso' }))

    esperar(aoAlternarEscrita).toHaveBeenCalledOnce()
    esperar(tela.getByRole('button', { name: 'Escrever aviso' })).toHaveAttribute('aria-expanded', 'false')
    esperar(tela.queryByRole('form', { name: 'Escrever aviso' })).not.toBeInTheDocument()
    esperar(tela.getAllByRole('article')).toHaveLength(avisosFixture.avisos.length)
  })

  testar.each([
    ['publicados', avisosFixture],
    ['leituras abertas', avisosLeiturasFixture],
    ['atendente', avisosAtendenteFixture],
    ['sistema', avisosSistemaFixture],
    ['arquivados', avisosArquivadosFixture],
  ])('encaminha todas as ações de %s sem mutar os avisos', (_, dados) => {
    const aoAcionarAviso = vi.fn()
    renderizar(<Avisos dados={dados} aoAcionarAviso={aoAcionarAviso} />)

    for (const aviso of dados.avisos) {
      const cartao = tela.getByRole('article', { name: aviso.titulo })
      for (const acao of aviso.acoes) {
        dispararEvento.click(dentroDe(cartao).getByRole('button', { name: acao.rotulo }))
        esperar(aoAcionarAviso).toHaveBeenLastCalledWith(aviso.identificador, acao.identificador)
        esperar(tela.getByRole('article', { name: aviso.titulo })).toBeInTheDocument()
      }
      if (aviso.status) esperar(dentroDe(cartao).getByRole('status', { name: `Situação de ${aviso.titulo}` })).toHaveTextContent(aviso.status.rotulo)
      const leituras = dentroDe(cartao).queryByRole('list', { name: `Leituras de ${aviso.titulo}` })
      if (aviso.leiturasAbertas) esperar(leituras).toBeInTheDocument()
      else esperar(leituras).not.toBeInTheDocument()
    }
  })

  testar('exibe as leituras prontas recebidas e o controle de fechamento', () => {
    renderizar(<Avisos dados={avisosLeiturasFixture} />)
    const aviso = avisosLeiturasFixture.avisos[0]

    const leituras = tela.getByRole('list', { name: `Leituras de ${aviso.titulo}` })
    esperar(dentroDe(leituras).getAllByRole('listitem').map((item) => item.textContent)).toEqual(aviso.leituras)
    esperar(tela.getByRole('button', { name: 'Fechar leituras' })).toHaveAttribute('aria-expanded', 'true')
  })

  testar('renderiza o formulário controlado e encaminha todos os callbacks de edição', () => {
    const formulario = avisosEscrevendoFixture.formulario
    if (!formulario) throw new Error('O fixture precisa representar a escrita de um aviso')
    const aoAlterarTitulo = vi.fn()
    const aoAlterarTexto = vi.fn()
    const aoSelecionarPublico = vi.fn()
    const aoAlternarConfirmacao = vi.fn()
    const aoAlternarUrgencia = vi.fn()
    const aoAlternarEscrita = vi.fn()
    const aoPublicar = vi.fn()
    renderizar(<Avisos
      dados={avisosEscrevendoFixture}
      aoAlterarTitulo={aoAlterarTitulo}
      aoAlterarTexto={aoAlterarTexto}
      aoSelecionarPublico={aoSelecionarPublico}
      aoAlternarConfirmacao={aoAlternarConfirmacao}
      aoAlternarUrgencia={aoAlternarUrgencia}
      aoAlternarEscrita={aoAlternarEscrita}
      aoPublicar={aoPublicar}
    />)

    const escrita = tela.getByRole('form', { name: 'Escrever aviso' })
    esperar(tela.getByRole('button', { name: 'Escrever aviso' })).toHaveAttribute('aria-expanded', 'true')
    esperar(dentroDe(escrita).getByText(formulario.aviso)).toBeInTheDocument()
    const titulo = dentroDe(escrita).getByRole('textbox', { name: 'Título' })
    const texto = dentroDe(escrita).getByRole('textbox', { name: 'Texto' })
    esperar(titulo).toHaveValue(formulario.titulo)
    esperar(texto).toHaveValue(formulario.texto)
    dispararEvento.change(titulo, { target: { value: avisosFixture.avisos[0].titulo } })
    dispararEvento.change(texto, { target: { value: avisosFixture.avisos[0].texto } })
    esperar(aoAlterarTitulo).toHaveBeenCalledWith(avisosFixture.avisos[0].titulo)
    esperar(aoAlterarTexto).toHaveBeenCalledWith(avisosFixture.avisos[0].texto)
    esperar(titulo).toHaveValue(formulario.titulo)
    esperar(texto).toHaveValue(formulario.texto)

    const publicos = dentroDe(escrita).getByRole('group', { name: 'Para quem' })
    for (const publico of formulario.publicos) {
      const botao = dentroDe(publicos).getByRole('button', { name: publico.rotulo })
      esperar(botao).toHaveAttribute('aria-pressed', String(publico.selecionado))
      dispararEvento.click(botao)
      esperar(aoSelecionarPublico).toHaveBeenLastCalledWith(publico.identificador)
      esperar(botao).toHaveAttribute('aria-pressed', String(publico.selecionado))
    }

    const opcoes = dentroDe(escrita).getByRole('group', { name: 'Opções do aviso' })
    for (const [rotulo, selecionado, callback] of [
      ['Pedir confirmação de leitura', formulario.pedeConfirmacao, aoAlternarConfirmacao],
      ['Marcar como urgente', formulario.urgente, aoAlternarUrgencia],
    ] as const) {
      const botao = dentroDe(opcoes).getByRole('button', { name: rotulo })
      dispararEvento.click(botao)
      esperar(callback).toHaveBeenCalledOnce()
      esperar(botao).toHaveAttribute('aria-pressed', String(selecionado))
    }

    const publicacao = dentroDe(escrita).getByRole('group', { name: 'Publicação do aviso' })
    dispararEvento.click(dentroDe(publicacao).getByRole('button', { name: 'Publicar' }))
    dispararEvento.click(dentroDe(publicacao).getByRole('button', { name: 'Cancelar' }))
    esperar(aoPublicar).toHaveBeenCalledOnce()
    esperar(aoAlternarEscrita).toHaveBeenCalledOnce()
    esperar(tela.getByRole('form', { name: 'Escrever aviso' })).toBeInTheDocument()
    for (const botao of tela.getAllByRole('button')) esperar(botao).toHaveAccessibleName()
  })

  // ADR 0058: "Fixar no topo" não existe, e "Estúdio" também não.
  testar('o formulário não oferece fixar no topo', () => {
    renderizar(<Avisos dados={avisosEscrevendoFixture} />)
    const escrita = tela.getByRole('form', { name: 'Escrever aviso' })
    esperar(dentroDe(escrita).queryByRole('button', { name: 'Fixar no topo' })).toBeNull()
    esperar(dentroDe(escrita).queryByRole('button', { name: 'Estúdio' })).toBeNull()
  })

  testar('mostra a recusa da última escrita, e nada quando não há', () => {
    const { rerender: redesenhar } = renderizar(<Avisos dados={avisosFixture} />)
    esperar(tela.queryByRole('alert')).not.toBeInTheDocument()

    redesenhar(<Avisos dados={avisosFixture} recusa="Este aviso já foi arquivado." />)
    esperar(tela.getByRole('alert')).toHaveTextContent('Este aviso já foi arquivado.')
  })

  testar('respeita podePublicar recebido mesmo com campos preenchidos', () => {
    const formulario = avisosEscrevendoFixture.formulario
    if (!formulario) throw new Error('O fixture precisa representar a escrita de um aviso')
    const aoPublicar = vi.fn()
    renderizar(<Avisos dados={{ ...avisosEscrevendoFixture, formulario: { ...formulario, podePublicar: false } }} aoPublicar={aoPublicar} />)

    const publicar = tela.getByRole('button', { name: 'Publicar' })
    esperar(publicar).toBeDisabled()
    dispararEvento.click(publicar)
    dispararEvento.submit(tela.getByRole('form', { name: 'Escrever aviso' }))
    esperar(aoPublicar).not.toHaveBeenCalled()
  })

  // ADR 0069 -----------------------------------------------------------------
  testar('editar: o cartão vira título e texto controlados, avisa das leituras e esconde as outras ações', () => {
    const aviso = avisosEditandoFixture.avisos[0]
    const editando = aviso.editando!
    const aoAlterarEdicaoAviso = vi.fn()
    const aoAcionarEdicaoAviso = vi.fn()
    renderizar(<Avisos dados={avisosEditandoFixture} aoAlterarEdicaoAviso={aoAlterarEdicaoAviso} aoAcionarEdicaoAviso={aoAcionarEdicaoAviso} />)

    const cartao = tela.getByRole('article', { name: aviso.titulo })
    const edicao = dentroDe(cartao).getByRole('form', { name: `Editar ${aviso.titulo}` })
    esperar(dentroDe(edicao).getByText('Salvar volta a pedir confirmação de quem já leu.')).toBeInTheDocument()
    esperar(dentroDe(cartao).queryByRole('group', { name: `Ações de ${aviso.titulo}` })).toBeNull()
    // O outro cartão segue só leitura.
    esperar(tela.getByRole('group', { name: `Ações de ${avisosEditandoFixture.avisos[1].titulo}` })).toBeInTheDocument()

    const titulo = dentroDe(edicao).getByRole('textbox', { name: 'Título' })
    const texto = dentroDe(edicao).getByRole('textbox', { name: 'Texto' })
    esperar(titulo).toHaveValue(editando.titulo)
    esperar(texto).toHaveValue(editando.texto)
    dispararEvento.change(titulo, { target: { value: 'Outro título' } })
    dispararEvento.change(texto, { target: { value: 'Outro texto' } })
    esperar(aoAlterarEdicaoAviso).toHaveBeenCalledWith({ titulo: 'Outro título' })
    esperar(aoAlterarEdicaoAviso).toHaveBeenCalledWith({ texto: 'Outro texto' })
    esperar(titulo).toHaveValue(editando.titulo)

    const acoes = dentroDe(edicao).getByRole('group', { name: `Edição de ${aviso.titulo}` })
    dispararEvento.click(dentroDe(acoes).getByRole('button', { name: 'Salvar' }))
    dispararEvento.click(dentroDe(acoes).getByRole('button', { name: 'Cancelar' }))
    esperar(aoAcionarEdicaoAviso).toHaveBeenNthCalledWith(1, aviso.identificador, 'salvar')
    esperar(aoAcionarEdicaoAviso).toHaveBeenNthCalledWith(2, aviso.identificador, 'cancelar')
  })

  testar('editar: sem podeSalvar, nem o botão nem o Enter salvam', () => {
    const aviso = avisosEditandoFixture.avisos[0]
    const aoAcionarEdicaoAviso = vi.fn()
    renderizar(<Avisos
      dados={{ ...avisosEditandoFixture, avisos: [{ ...aviso, editando: { ...aviso.editando!, podeSalvar: false } }] }}
      aoAcionarEdicaoAviso={aoAcionarEdicaoAviso}
    />)

    const salvar = tela.getByRole('button', { name: 'Salvar' })
    esperar(salvar).toBeDisabled()
    dispararEvento.click(salvar)
    dispararEvento.submit(tela.getByRole('form', { name: `Editar ${aviso.titulo}` }))
    esperar(aoAcionarEdicaoAviso).not.toHaveBeenCalled()
  })

  // ADR 0066 -----------------------------------------------------------------
  testar('"Criar lembrete" é controlado e encaminha texto, data, categoria e antecedência', () => {
    const formulario = avisosLembretesFixture.formularioLembrete
    if (!formulario) throw new Error('O fixture precisa representar a criação de um lembrete')
    const aoAlterarLembrete = vi.fn()
    const aoCriarLembrete = vi.fn()
    const aoAlternarEscrita = vi.fn()
    renderizar(<Avisos dados={avisosLembretesFixture} aoAlterarLembrete={aoAlterarLembrete} aoCriarLembrete={aoCriarLembrete} aoAlternarEscrita={aoAlternarEscrita} />)

    esperar(tela.getByRole('button', { name: 'Criar lembrete' })).toHaveAttribute('aria-expanded', 'true')
    const criacao = tela.getByRole('form', { name: 'Criar lembrete' })
    esperar(dentroDe(criacao).getByText(formulario.aviso)).toBeInTheDocument()
    const texto = dentroDe(criacao).getByRole('textbox', { name: 'O que lembrar' })
    esperar(texto).toHaveValue(formulario.texto)
    dispararEvento.change(texto, { target: { value: 'Ligar para a Ana' } })
    esperar(aoAlterarLembrete).toHaveBeenLastCalledWith({ texto: 'Ligar para a Ana' })
    const data = dentroDe(criacao).getByLabelText('Data')
    esperar(data).toHaveAttribute('min', formulario.hoje)
    dispararEvento.change(data, { target: { value: '2026-10-09' } })
    esperar(aoAlterarLembrete).toHaveBeenLastCalledWith({ data: '2026-10-09' })

    const categorias = dentroDe(criacao).getByRole('group', { name: 'Categoria' })
    for (const categoria of formulario.categorias) {
      const botao = dentroDe(categorias).getByRole('button', { name: categoria.rotulo })
      esperar(botao).toHaveAttribute('aria-pressed', String(categoria.selecionada))
      dispararEvento.click(botao)
      esperar(aoAlterarLembrete).toHaveBeenLastCalledWith({ categoria: categoria.identificador })
    }
    const antecedencia = dentroDe(criacao).getByRole('textbox', { name: 'Avisar quantos dias antes' })
    esperar(antecedencia).toHaveValue(formulario.antecedencia)
    dispararEvento.change(antecedencia, { target: { value: '5 dias' } })
    esperar(aoAlterarLembrete).toHaveBeenLastCalledWith({ antecedencia: '5' })

    const acoes = dentroDe(criacao).getByRole('group', { name: 'Criação do lembrete' })
    dispararEvento.click(dentroDe(acoes).getByRole('button', { name: 'Criar' }))
    dispararEvento.click(dentroDe(acoes).getByRole('button', { name: 'Cancelar' }))
    esperar(aoCriarLembrete).toHaveBeenCalledOnce()
    esperar(aoAlternarEscrita).toHaveBeenCalledOnce()
  })

  testar('sem categoria ativa, o formulário diz onde criar uma e não deixa criar', () => {
    const formulario = avisosLembretesFixture.formularioLembrete!
    const aoCriarLembrete = vi.fn()
    renderizar(<Avisos dados={{ ...avisosLembretesFixture, formularioLembrete: { ...formulario, categorias: [], podeCriar: false } }} aoCriarLembrete={aoCriarLembrete} />)

    const criacao = tela.getByRole('form', { name: 'Criar lembrete' })
    esperar(dentroDe(criacao).getByText(/Crie uma no quadro Categorias/)).toBeInTheDocument()
    esperar(dentroDe(criacao).getByRole('button', { name: 'Criar' })).toBeDisabled()
    dispararEvento.submit(criacao)
    esperar(aoCriarLembrete).not.toHaveBeenCalled()
  })

  testar('o quadro Categorias lista, edita, desativa, reativa e cria', () => {
    const aoAcionarCategoria = vi.fn()
    const aoAlterarEdicaoCategoria = vi.fn()
    const aoAlterarNovaCategoria = vi.fn()
    const aoCriarCategoria = vi.fn()
    renderizar(<Avisos
      dados={avisosLembretesFixture}
      aoAcionarCategoria={aoAcionarCategoria}
      aoAlterarEdicaoCategoria={aoAlterarEdicaoCategoria}
      aoAlterarNovaCategoria={aoAlterarNovaCategoria}
      aoCriarCategoria={aoCriarCategoria}
    />)

    const quadro = tela.getByRole('region', { name: 'Categorias de lembrete' })
    const [pagamento, manutencao, contato] = dentroDe(quadro).getAllByRole('listitem')
    esperar(pagamento).toHaveTextContent('avisa 3 dias antes')
    dispararEvento.click(dentroDe(pagamento).getByRole('button', { name: 'Editar' }))
    esperar(aoAcionarCategoria).toHaveBeenLastCalledWith('c1', 'editar')
    dispararEvento.click(dentroDe(pagamento).getByRole('button', { name: 'Desativar' }))
    esperar(aoAcionarCategoria).toHaveBeenLastCalledWith('c1', 'desativar')
    dispararEvento.click(dentroDe(contato).getByRole('button', { name: 'Reativar' }))
    esperar(aoAcionarCategoria).toHaveBeenLastCalledWith('c3', 'ativar')

    esperar(dentroDe(manutencao).getByRole('textbox', { name: 'Dias antes de Manutenção' })).toHaveValue('5')
    dispararEvento.change(dentroDe(manutencao).getByRole('textbox', { name: 'Nome de Manutenção' }), { target: { value: 'Manutenção do estúdio' } })
    esperar(aoAlterarEdicaoCategoria).toHaveBeenLastCalledWith({ nome: 'Manutenção do estúdio' })
    dispararEvento.click(dentroDe(manutencao).getByRole('button', { name: 'Salvar' }))
    esperar(aoAcionarCategoria).toHaveBeenLastCalledWith('c2', 'salvar')

    const nova = dentroDe(quadro).getByRole('group', { name: 'Nova categoria' })
    esperar(dentroDe(nova).getByRole('button', { name: 'Criar categoria' })).toBeDisabled()
    dispararEvento.change(dentroDe(nova).getByRole('textbox', { name: 'Nome da nova categoria' }), { target: { value: 'Contrato' } })
    esperar(aoAlterarNovaCategoria).toHaveBeenLastCalledWith({ nome: 'Contrato' })
    dispararEvento.change(dentroDe(nova).getByRole('textbox', { name: 'Dias antes da nova categoria' }), { target: { value: '2' } })
    esperar(aoAlterarNovaCategoria).toHaveBeenLastCalledWith({ antecedencia: '2' })
    esperar(aoCriarCategoria).not.toHaveBeenCalled()
  })

  testar('catálogo vazio diz que é o começo, não que falta configurar (ADR 0043)', () => {
    renderizar(<Avisos dados={{ ...avisosLembretesFixture, categorias: { ...avisosLembretesFixture.categorias!, itens: [] } }} />)
    esperar(tela.getByText(avisosLembretesFixture.categorias!.mensagemVazia)).toBeInTheDocument()
    esperar(tela.queryByText(/não configurado/)).toBeNull()
  })
})
