import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao, vi } from 'vitest'

import { Estoque, type DadosEstoque } from './Estoque'
import {
  estoqueAdminFixture, estoqueAjustandoFixture, estoqueBomboniereFixture, estoqueCompraFixture,
  estoqueEditandoFixture, estoqueFixture, estoqueFotoFixture, estoqueTirandoDoSaldoFixture,
  estoqueVazioFixture,
} from './Estoque.fixture'

// Os testes esperam o marcador "indisponível", então não podem depender de quais
// fotos existem de verdade na pasta do catálogo (ADR 0065).
vi.mock('../fotoDoCatalogo', () => ({ fotoDoCatalogo: () => undefined }))

testar('renderiza a conferência completa com grupos, fotos, quantidades e criticidades recebidas', () => {
  renderizar(<Estoque dados={estoqueFixture} />)

  const estoque = dentroDe(tela.getByRole('region', { name: 'Estoque' }))
  esperar(estoque.getByRole('heading', { name: estoqueFixture.titulo })).toBeVisible()
  esperar(estoque.getByText(estoqueFixture.subtitulo)).toBeVisible()
  esperar(estoque.getByText(estoqueFixture.data)).toBeVisible()
  esperar(estoque.getByRole('status', { name: 'Sincronização do estoque' })).toHaveTextContent(estoqueFixture.sincronizacao.rotulo)
  const resumo = dentroDe(estoque.getByRole('group', { name: 'Resumo da conferência' }))
  for (const item of estoqueFixture.resumo) esperar(resumo.getByText(item.texto)).toBeVisible()
  for (const coluna of estoqueFixture.colunas) {
    for (const grupo of coluna.grupos) {
      const categoria = dentroDe(estoque.getByRole('region', { name: `Insumos de ${grupo.nome}` }))
      esperar(categoria.getByRole('heading', { name: grupo.nome })).toBeVisible()
      esperar(categoria.getByText(grupo.resumo)).toBeVisible()
      for (const insumo of grupo.insumos) {
        const item = dentroDe(categoria.getByRole('group', { name: insumo.nome }))
        esperar(item.getByText(insumo.meta)).toBeVisible()
        esperar(item.getByRole('button', { name: `Ver foto de ${insumo.nome}` })).toBeVisible()
        esperar(item.getByRole('img', { name: `Foto de ${insumo.nome} indisponível` })).toBeVisible()
        esperar(item.getByRole('group', { name: `Quantidade de ${insumo.nome}` })).toHaveTextContent(insumo.quantidade)
        if (insumo.rotuloCriticidade) esperar(item.getByText(insumo.rotuloCriticidade)).toBeVisible()
      }
    }
  }
  esperar(estoque.queryByRole('button', { name: /Aumentar quantidade/ })).not.toBeInTheDocument()
})

testar.each([estoqueFixture, estoqueCompraFixture, estoqueBomboniereFixture, estoqueVazioFixture])('mantém a identificação recebida para $contexto', (dados) => {
  renderizar(<Estoque dados={dados} />)
  const identificacao = tela.getByRole('banner', { name: 'Identificação da tela' })
  esperar(identificacao).toHaveTextContent(dados.contexto)
  esperar(identificacao).toHaveTextContent(dados.turno)
  esperar(identificacao).toHaveTextContent(dados.hora)
  const abas = dentroDe(tela.getByRole('group', { name: 'Visualização do estoque' }))
  for (const aba of dados.abas) esperar(abas.getByRole('button', { name: aba.rotulo })).toHaveAttribute('aria-pressed', String(aba.identificador === dados.aba))
})

testar.each([
  ['conferir', 'Conferência de insumos', 'Nenhum insumo para conferir.'],
  ['compra', 'Compra de insumos', 'Nenhum insumo para comprar.'],
  ['bomboniere', 'Estoque da bomboniere', 'Nenhum item na bomboniere.'],
] as const)('renderiza estado vazio na aba %s', (aba, regiao, mensagem) => {
  renderizar(<Estoque dados={{ ...estoqueVazioFixture, aba }} />)
  esperar(dentroDe(tela.getByRole('region', { name: regiao })).getByText(mensagem)).toBeVisible()
  esperar(tela.queryByRole('button', { name: /Ver foto de/ })).not.toBeInTheDocument()
  esperar(tela.queryByRole('table', { name: 'Itens da bomboniere' })).not.toBeInTheDocument()
})

testar('exibe a compra agrupada com pedido, contagem e data preparados', () => {
  renderizar(<Estoque dados={estoqueCompraFixture} />)
  for (const fornecedor of estoqueCompraFixture.compra) {
    const compra = dentroDe(tela.getByRole('region', { name: `Compra de ${fornecedor.nome}` }))
    esperar(compra.getByText(fornecedor.resumo)).toBeVisible()
    for (const insumo of fornecedor.insumos) {
      const item = dentroDe(compra.getByRole('group', { name: insumo.nome }))
      if (insumo.pedido) esperar(item.getByText(insumo.pedido)).toBeVisible()
      esperar(item.getByText(insumo.quantidade)).toBeVisible()
      esperar(item.getByText(insumo.conferido)).toBeVisible()
      esperar(item.getByText(insumo.rotuloCriticidade)).toBeVisible()
      esperar(item.getByRole('img', { name: `Foto de ${insumo.nome} indisponível` })).toBeVisible()
    }
  }
  esperar(tela.getByText(estoqueCompraFixture.nota)).toBeVisible()
})

testar('renderiza os preços e saldos da bomboniere sem formatar ou calcular', () => {
  renderizar(<Estoque dados={estoqueBomboniereFixture} />)
  const tabela = dentroDe(tela.getByRole('table', { name: 'Itens da bomboniere' }))
  for (const item of estoqueBomboniereFixture.bomboniere) {
    const linha = dentroDe(tabela.getByRole('row', { name: new RegExp(item.nome) }))
    esperar(linha.getByRole('cell', { name: item.categoria })).toBeVisible()
    esperar(linha.getByRole('cell', { name: item.preco })).toBeVisible()
    esperar(linha.getByRole('cell', { name: item.saldo })).toBeVisible()
    esperar(linha.getByRole('img', { name: `Foto de ${item.nome} indisponível` })).toBeVisible()
    esperar(linha.getByRole('button', { name: `Repor ou ajustar ${item.nome}` })).toBeVisible()
  }
})

testar('emite a navegação e a abertura da edição sem alterar a aba ou os dados', () => {
  const aoSelecionarAba = simulacao.fn()
  const aoEditar = simulacao.fn()
  renderizar(<Estoque dados={estoqueFixture} aoSelecionarAba={aoSelecionarAba} aoEditar={aoEditar} />)
  for (const aba of estoqueFixture.abas) {
    dispararEvento.click(tela.getByRole('button', { name: aba.rotulo }))
    esperar(aoSelecionarAba).toHaveBeenLastCalledWith(aba.identificador)
  }
  dispararEvento.click(tela.getByRole('button', { name: 'Editar quantidades' }))
  esperar(aoEditar).toHaveBeenCalledOnce()
  esperar(tela.getByRole('region', { name: 'Conferência de insumos' })).toBeVisible()
  esperar(tela.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
})

testar('emite os comandos de contagem, cancelamento e confirmação sem aplicar quantidades', () => {
  const aoDiminuirQuantidade = simulacao.fn()
  const aoAumentarQuantidade = simulacao.fn()
  const aoCancelar = simulacao.fn()
  const aoConfirmar = simulacao.fn()
  const insumo = estoqueEditandoFixture.colunas[0].grupos[0].insumos[0]
  renderizar(<Estoque dados={estoqueEditandoFixture} aoDiminuirQuantidade={aoDiminuirQuantidade} aoAumentarQuantidade={aoAumentarQuantidade} aoCancelar={aoCancelar} aoConfirmar={aoConfirmar} />)

  dispararEvento.click(tela.getByRole('button', { name: `Diminuir quantidade de ${insumo.nome}` }))
  dispararEvento.click(tela.getByRole('button', { name: `Aumentar quantidade de ${insumo.nome}` }))
  dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Confirmar' }))
  esperar(aoDiminuirQuantidade).toHaveBeenCalledExactlyOnceWith(insumo.identificador)
  esperar(aoAumentarQuantidade).toHaveBeenCalledExactlyOnceWith(insumo.identificador)
  esperar(aoCancelar).toHaveBeenCalledOnce()
  esperar(aoConfirmar).toHaveBeenCalledOnce()
  esperar(tela.getByRole('group', { name: `Quantidade de ${insumo.nome}` })).toHaveTextContent(insumo.quantidade)
  esperar(tela.getByRole('button', { name: 'Confirmar' })).toBeVisible()
})

// O seletor de fornecedor saiu da tela (issue #110): `carga.mjs` reescreve
// `item_estoque.fornecedor` a cada execução, e o que o app gravasse ali ela
// desfaria em silêncio. O agrupamento continua; o botão que editava, não.
testar('a compra não oferece botão de trocar o fornecedor de um insumo', () => {
  renderizar(<Estoque dados={estoqueCompraFixture} />)
  for (const fornecedor of estoqueCompraFixture.compra) {
    for (const insumo of fornecedor.insumos) {
      esperar(tela.queryByRole('group', { name: `Fornecedor de ${insumo.nome}` })).not.toBeInTheDocument()
    }
  }
})

testar('emite a abertura e os comandos do ajuste sem alterar o saldo', () => {
  const aoReporAjustar = simulacao.fn()
  const aoDiminuirSaldo = simulacao.fn()
  const aoAumentarSaldo = simulacao.fn()
  const aoConfirmarAjuste = simulacao.fn()
  const item = estoqueBomboniereFixture.bomboniere[0]
  const { rerender: renderizarNovamente } = renderizar(<Estoque dados={estoqueBomboniereFixture} aoReporAjustar={aoReporAjustar} />)
  dispararEvento.click(tela.getByRole('button', { name: `Repor ou ajustar ${item.nome}` }))
  esperar(aoReporAjustar).toHaveBeenCalledExactlyOnceWith(item.identificador)
  esperar(tela.queryByRole('group', { name: `Ajuste de ${item.nome}` })).not.toBeInTheDocument()

  renderizarNovamente(<Estoque dados={estoqueAjustandoFixture} aoDiminuirSaldo={aoDiminuirSaldo} aoAumentarSaldo={aoAumentarSaldo} aoConfirmarAjuste={aoConfirmarAjuste} />)
  dispararEvento.click(tela.getByRole('button', { name: `Diminuir saldo de ${item.nome}` }))
  dispararEvento.click(tela.getByRole('button', { name: `Aumentar saldo de ${item.nome}` }))
  dispararEvento.click(tela.getByRole('button', { name: `Confirmar ajuste de ${item.nome}` }))
  esperar(aoDiminuirSaldo).toHaveBeenCalledExactlyOnceWith(item.identificador)
  esperar(aoAumentarSaldo).toHaveBeenCalledExactlyOnceWith(item.identificador)
  esperar(aoConfirmarAjuste).toHaveBeenCalledExactlyOnceWith(item.identificador)
  esperar(tela.getByRole('group', { name: `Ajuste de ${item.nome}` })).toHaveTextContent(estoqueAjustandoFixture.bomboniere[0].ajuste?.saldo ?? '')
})

testar.each([
  ['conferência', estoqueFixture, estoqueFixture.colunas[0].grupos[0].insumos[0]],
  ['compra', estoqueCompraFixture, estoqueCompraFixture.compra[0].insumos[0]],
  ['bomboniere', estoqueBomboniereFixture, estoqueBomboniereFixture.bomboniere[0]],
] as const)('emite a foto solicitada na %s', (_, dados, item) => {
  const aoAbrirFoto = simulacao.fn()
  renderizar(<Estoque dados={dados} aoAbrirFoto={aoAbrirFoto} />)
  dispararEvento.click(tela.getByRole('button', { name: `Ver foto de ${item.nome}` }))
  esperar(aoAbrirFoto).toHaveBeenCalledExactlyOnceWith(item.identificador)
  esperar(tela.queryByRole('dialog')).not.toBeInTheDocument()
})

testar('renderiza a foto ampliada e emite fechamento por botão e Escape', () => {
  const aoFecharFoto = simulacao.fn()
  const foto = estoqueFotoFixture.fotoAberta
  if (!foto) throw new Error('O fixture precisa ter a foto aberta')
  renderizar(<Estoque dados={estoqueFotoFixture} aoFecharFoto={aoFecharFoto} />)
  const dialogo = tela.getByRole('dialog', { name: `Foto de ${foto.nome}` })
  esperar(dentroDe(dialogo).getByRole('img', { name: `Foto de ${foto.nome} indisponível` })).toBeVisible()
  esperar(dentroDe(dialogo).getByText(foto.meta)).toBeVisible()
  dispararEvento.click(dentroDe(dialogo).getByRole('button', { name: 'Fechar' }))
  esperar(aoFecharFoto).toHaveBeenCalledOnce()
  aoFecharFoto.mockClear()
  dispararEvento.keyDown(dialogo, { key: 'Escape' })
  esperar(aoFecharFoto).toHaveBeenCalledOnce()
  esperar(dialogo).toBeVisible()
})

testar('usa a criticidade recebida mesmo quando a quantidade não a sugere', () => {
  const insumo = estoqueFixture.colunas[0].grupos[0].insumos[0]
  const dados: DadosEstoque = {
    ...estoqueFixture,
    colunas: [{ identificador: 'exemplo', grupos: [{
      ...estoqueFixture.colunas[0].grupos[0],
      insumos: [{ ...insumo, criticidade: 'normal', rotuloCriticidade: undefined }],
    }] }],
  }
  renderizar(<Estoque dados={dados} />)
  const item = tela.getByRole('group', { name: insumo.nome })
  esperar(item).toHaveClass('lt-estoque-normal')
  esperar(dentroDe(item).queryByText(insumo.rotuloCriticidade ?? '')).not.toBeInTheDocument()
  esperar(dentroDe(item).getByRole('group', { name: `Quantidade de ${insumo.nome}` })).toHaveTextContent(insumo.quantidade)
  for (const resumo of dados.resumo) esperar(tela.getByText(resumo.texto)).toBeVisible()
})

// O ledger exige motivo em `ajuste` e não pede nada em `reposicao` (migration
// 0053). A tela mostra o campo exatamente quando o alvo desce abaixo do saldo.
testar('somar ao saldo é reposição, e reposição não pede motivo', () => {
  renderizar(<Estoque dados={estoqueAjustandoFixture} />)
  const item = estoqueAjustandoFixture.bomboniere[0]
  esperar(tela.queryByLabelText('Por que está saindo do saldo?')).not.toBeInTheDocument()
  esperar(tela.getByRole('button', { name: `Confirmar ajuste de ${item.nome}` })).toBeEnabled()
})

testar('tirar do saldo pede motivo, e o OK espera por ele', () => {
  const aoAlterarMotivoAjuste = simulacao.fn()
  const item = estoqueTirandoDoSaldoFixture.bomboniere[0]
  const { rerender: renderizarNovamente } = renderizar(
    <Estoque dados={estoqueTirandoDoSaldoFixture} aoAlterarMotivoAjuste={aoAlterarMotivoAjuste} />)

  const campo = tela.getByLabelText('Por que está saindo do saldo?')
  esperar(tela.getByRole('button', { name: `Confirmar ajuste de ${item.nome}` })).toBeDisabled()

  dispararEvento.change(campo, { target: { value: 'vencido' } })
  esperar(aoAlterarMotivoAjuste).toHaveBeenCalledExactlyOnceWith(item.identificador, 'vencido')

  // O motivo é estado de quem chama, como todo o resto da tela: com ele
  // preenchido, o OK abre.
  const comMotivo = {
    ...estoqueTirandoDoSaldoFixture,
    bomboniere: [{ ...item, ajuste: { saldo: '1', motivo: 'vencido' } },
      ...estoqueTirandoDoSaldoFixture.bomboniere.slice(1)],
  }
  renderizarNovamente(<Estoque dados={comMotivo} />)
  esperar(tela.getByRole('button', { name: `Confirmar ajuste de ${item.nome}` })).toBeEnabled()
})

// ADR 0071 §1 e 0080: só o Admin mexe no catálogo. O que decide é o servidor
// mandar a ficha; a tela não sabe perfil.
testar('o Atendente não vê Novo insumo, Editar, Renomear nem as sugestões', () => {
  const { container } = renderizar(<Estoque dados={estoqueFixture} />)
  esperar(tela.queryByRole('button', { name: 'Novo insumo' })).not.toBeInTheDocument()
  esperar(tela.queryByRole('button', { name: /^Editar (?!quantidades)/ })).not.toBeInTheDocument()
  esperar(tela.queryByRole('button', { name: /^Renomear/ })).not.toBeInTheDocument()
  esperar(container.querySelector('datalist')).toBeNull()
})

testar('o Admin vê o fornecedor de cada insumo, Novo insumo, Editar, Renomear e as sugestões', () => {
  const aoEditarInsumo = simulacao.fn()
  const aoNovoInsumo = simulacao.fn()
  const aoRenomear = simulacao.fn()
  const { container } = renderizar(<Estoque dados={estoqueAdminFixture} {...{ aoEditarInsumo, aoNovoInsumo, aoRenomear }} />)
  const grupo = estoqueAdminFixture.colunas[0].grupos[0]
  const [primeiro, segundo] = grupo.insumos

  esperar(dentroDe(tela.getByRole('group', { name: primeiro.nome })).getByText('Percarbonato')).toBeVisible()
  esperar(dentroDe(tela.getByRole('group', { name: segundo.nome })).getByText('sem fornecedor')).toBeVisible()
  esperar([...container.querySelectorAll('#lt-estoque-fornecedores option')].map((o) => o.getAttribute('value')))
    .toEqual(estoqueAdminFixture.fornecedores)
  esperar([...container.querySelectorAll('#lt-estoque-categorias option')].map((o) => o.getAttribute('value')))
    .toEqual(estoqueAdminFixture.categorias)

  dispararEvento.click(tela.getByRole('button', { name: `Editar ${primeiro.nome}` }))
  esperar(aoEditarInsumo).toHaveBeenCalledExactlyOnceWith(primeiro.identificador)
  dispararEvento.click(tela.getByRole('button', { name: 'Novo insumo' }))
  esperar(aoNovoInsumo).toHaveBeenCalledOnce()
  dispararEvento.click(tela.getByRole('button', { name: `Renomear categoria ${grupo.nome}` }))
  esperar(aoRenomear).toHaveBeenCalledExactlyOnceWith('categoria', grupo.nome)
})

testar('editando quantidades, Editar e Renomear somem', () => {
  renderizar(<Estoque dados={{ ...estoqueAdminFixture, editando: true }} />)
  esperar(tela.queryByRole('button', { name: /^Editar (?!quantidades)/ })).not.toBeInTheDocument()
  esperar(tela.queryByRole('button', { name: /^Renomear/ })).not.toBeInTheDocument()
})

testar('a ficha emite cada campo, a importância, o salvar e o desativar em dois toques', () => {
  const aoAlterarFicha = simulacao.fn()
  const aoSalvarFicha = simulacao.fn()
  const aoDesativarInsumo = simulacao.fn()
  const insumo = estoqueAdminFixture.colunas[0].grupos[0].insumos[0]
  renderizar(<Estoque dados={{ ...estoqueAdminFixture, fichaAberta: { ...insumo.ficha!, item: insumo.identificador } }}
    {...{ aoAlterarFicha, aoSalvarFicha, aoDesativarInsumo }} />)

  const ficha = dentroDe(tela.getByRole('dialog', { name: `Editar ${insumo.nome}` }))
  esperar(ficha.getByLabelText('Categoria')).toHaveAttribute('list', 'lt-estoque-categorias')
  dispararEvento.change(ficha.getByLabelText('Fornecedor'), { target: { value: 'Atacadão' } })
  esperar(aoAlterarFicha).toHaveBeenCalledExactlyOnceWith('fornecedor', 'Atacadão')
  dispararEvento.click(ficha.getByRole('button', { name: 'Urgente' }))
  esperar(aoAlterarFicha).toHaveBeenLastCalledWith('severidade', 'urgente')

  dispararEvento.click(ficha.getByRole('button', { name: 'Desativar' }))
  esperar(aoDesativarInsumo).not.toHaveBeenCalled()
  dispararEvento.click(ficha.getByRole('button', { name: 'Confirmar: desativar' }))
  esperar(aoDesativarInsumo).toHaveBeenCalledOnce()
  dispararEvento.click(ficha.getByRole('button', { name: 'Salvar' }))
  esperar(aoSalvarFicha).toHaveBeenCalledOnce()
})

testar('o Novo insumo não tem Desativar e só salva com nome e categoria', () => {
  renderizar(<Estoque dados={{ ...estoqueAdminFixture,
    fichaAberta: { item: null, nome: 'Sal', categoria: ' ', fornecedor: '', especificacao: '', severidade: 'atencao' } }} />)
  const ficha = dentroDe(tela.getByRole('dialog', { name: 'Novo insumo' }))
  esperar(ficha.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()
  esperar(ficha.getByRole('button', { name: 'Salvar' })).toBeDisabled()
})

testar('Copiar lista põe o pedido do fornecedor na área de transferência', async () => {
  const escrever = simulacao.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true })
  renderizar(<Estoque dados={estoqueCompraFixture} />)
  const [fornecedor] = estoqueCompraFixture.compra
  dispararEvento.click(tela.getByRole('button', { name: `Copiar lista de ${fornecedor.nome}` }))
  esperar(escrever).toHaveBeenCalledExactlyOnceWith(fornecedor.mensagem)
  esperar(await tela.findByText('Copiada ✓')).toBeVisible()
})
