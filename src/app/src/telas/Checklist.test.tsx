import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { expect as esperar, test as testar, vi as simulacao } from 'vitest'
import { Checklist } from './Checklist'
import { checklistBloqueadaFixture, checklistFixture, checklistHistoricoFixture, checklistModalComFotoFixture, checklistModalFixture, checklistModalLeituraFixture, checklistVaziaFixture } from './Checklist.fixture'

testar('renderiza checklist cheio com progresso, monitor, salas e itens', () => {
  renderizar(<Checklist dados={checklistFixture} />)
  esperar(tela.getByRole('region', { name: 'Checklist' })).toBeVisible()
  esperar(tela.getByRole('heading', { name: checklistFixture.titulo })).toBeVisible()
  esperar(tela.getByLabelText(`Progresso ${checklistFixture.progresso.tratados} de ${checklistFixture.progresso.total}`)).toBeVisible()
  for (const sala of checklistFixture.colunas.flatMap((coluna) => coluna.salas)) {
    const regiao = tela.getByRole('region', { name: sala.nome })
    esperar(regiao).toHaveTextContent(sala.contagem)
    for (const item of sala.itens) esperar(dentroDe(regiao).getByRole('group', { name: item.nome })).toBeVisible()
  }
  esperar(tela.getByRole('region', { name: 'Monitor das salas' })).toBeVisible()
})

testar('renderiza checklist vazio', () => {
  renderizar(<Checklist dados={checklistVaziaFixture} />)
  esperar(tela.getByRole('region', { name: 'Checklist vazio' })).toHaveTextContent('Catálogo não configurado.')
  esperar(tela.queryByRole('region', { name: 'Monitor das salas' })).not.toBeInTheDocument()
})

testar('renderiza bloqueio de saída e modal de justificativa', () => {
  renderizar(<Checklist dados={checklistBloqueadaFixture} />)
  esperar(tela.getByRole('status', { name: checklistBloqueadaFixture.bloqueio?.titulo })).toHaveTextContent('Faltam 9 itens')
  renderizar(<Checklist dados={checklistModalFixture} />)
  const dialogo = tela.getByRole('dialog', { name: 'Justificar item' })
  esperar(dialogo).toHaveTextContent(checklistModalFixture.modal?.nome ?? '')
  esperar(dentroDe(dialogo).getByRole('img', { name: 'Foto obrigatória' })).toBeVisible()
})

testar('emite fase, perfil, conclusão, item, justificativa e modal', () => {
  const cb = { fase: simulacao.fn(), perfil: simulacao.fn(), saida: simulacao.fn(), entrada: simulacao.fn(), concluir: simulacao.fn(), tratar: simulacao.fn(), ver: simulacao.fn(), justificar: simulacao.fn(), texto: simulacao.fn(), fechar: simulacao.fn(), confirmar: simulacao.fn(), remover: simulacao.fn(), ir: simulacao.fn() }
  renderizar(<Checklist dados={checklistModalFixture} aoSelecionarFase={cb.fase} aoSelecionarPerfil={cb.perfil} aoVerSaida={cb.saida} aoVerEntrada={cb.entrada} aoConcluir={cb.concluir} aoTratarItem={cb.tratar} aoVerJustificativa={cb.ver} aoJustificar={cb.justificar} aoAlterarTexto={cb.texto} aoFecharModal={cb.fechar} aoConfirmarJustificativa={cb.confirmar} aoRemoverJustificativa={cb.remover} aoIrParaEntrada={cb.ir} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Saída' })); esperar(cb.fase).toHaveBeenCalledWith('saida')
  dispararEvento.click(tela.getByRole('button', { name: 'Admin' })); esperar(cb.perfil).toHaveBeenCalledWith('administrador')
  dispararEvento.click(tela.getByRole('button', { name: 'Ver saída' })); esperar(cb.saida).toHaveBeenCalledOnce()
  dispararEvento.click(tela.getByRole('button', { name: 'Concluir entrada' })); esperar(cb.concluir).toHaveBeenCalledOnce()
  const item = checklistFixture.colunas[0].salas[0].itens[1]
  dispararEvento.click(tela.getByRole('button', { name: item.nome })); esperar(cb.tratar).toHaveBeenCalledWith(item)
  const grupoItem = tela.getByRole('group', { name: item.nome })
  dispararEvento.click(dentroDe(grupoItem).getByRole('button', { name: 'justificar' })); esperar(cb.justificar).toHaveBeenCalled()
  dispararEvento.change(tela.getByRole('textbox'), { target: { value: 'motivo' } }); esperar(cb.texto).toHaveBeenCalledWith('motivo')
  dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' })); esperar(cb.fechar).toHaveBeenCalledOnce()
})

// A ordem do ADR 0051 §7: sem foto não há o que confirmar, e o banco recusaria
// com LT003. O botão desligado é a mesma regra, um passo antes.
testar('sem foto, o Confirmar fica desligado e a câmera aparece', () => {
  const cb = { foto: simulacao.fn(), confirmar: simulacao.fn() }
  renderizar(<Checklist dados={checklistModalFixture} aoEscolherFoto={cb.foto} aoConfirmarJustificativa={cb.confirmar} />)

  esperar(tela.getByRole('button', { name: 'Confirmar justificativa' })).toBeDisabled()

  const arquivo = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
  dispararEvento.change(tela.getByLabelText('Tirar foto'), { target: { files: [arquivo] } })
  esperar(cb.foto).toHaveBeenCalledWith(arquivo)
})

testar('com a foto anexada o Confirmar acende, e a câmera some', () => {
  const cb = simulacao.fn()
  renderizar(<Checklist dados={checklistModalComFotoFixture} aoConfirmarJustificativa={cb} />)

  esperar(tela.queryByLabelText('Tirar foto')).toBeNull()
  dispararEvento.click(tela.getByRole('button', { name: 'Confirmar justificativa' }))
  esperar(cb).toHaveBeenCalledOnce()
})

testar('a foto subindo trava a câmera, e a recusa aparece no lugar do silêncio', () => {
  const { modal } = checklistModalFixture
  renderizar(<Checklist dados={{ ...checklistModalFixture, modal: { ...modal!, enviando: true } }} />)
  esperar(tela.getByLabelText('Enviando a foto…')).toBeDisabled()

  renderizar(<Checklist dados={{ ...checklistModalFixture, modal: { ...modal!, recusa: 'Esta foto é pesada demais.' } }} />)
  esperar(tela.getAllByRole('alert')[0]).toHaveTextContent('Esta foto é pesada demais.')
})

// Item já justificado abre pra LER: o motivo, quem justificou, e o botão que
// desfaz. Remover devolve o item a nao_marcado sem tirar a foto (ADR 0052).
testar('o modal de leitura mostra o motivo e oferece remover', () => {
  const cb = { remover: simulacao.fn(), fechar: simulacao.fn() }
  renderizar(<Checklist dados={checklistModalLeituraFixture} aoRemoverJustificativa={cb.remover} aoFecharModal={cb.fechar} />)

  const dialogo = tela.getByRole('dialog', { name: 'Justificativa' })
  esperar(dialogo).toHaveTextContent('Cano estourado, chamei o encanador')
  esperar(dialogo).toHaveTextContent('por Jana às 08:03')
  // Sem caixa de texto: o que está escrito não se edita, remove-se.
  esperar(dentroDe(dialogo).queryByRole('textbox')).toBeNull()

  dispararEvento.click(dentroDe(dialogo).getByRole('button', { name: 'Remover justificativa' }))
  esperar(cb.remover).toHaveBeenCalledOnce()
})

testar('bloqueio sem salas não diz "catálogo não configurado" — o motivo é o bloqueio', () => {
  renderizar(<Checklist dados={{ ...checklistVaziaFixture, bloqueio: { titulo: 'Checklist de hoje não criado', texto: 'Avise o Admin.' } }} />)
  esperar(tela.getByRole('status', { name: 'Checklist de hoje não criado' })).toBeVisible()
  esperar(tela.queryByText('Catálogo não configurado.')).toBeNull()
})

// ADR 0072 §9: a foto guardada na fila do tablet basta para o motivo ir. O item
// fica pendente de anexo no banco até ela subir.
testar('com a foto na fila, o Confirmar liga e a câmera some', () => {
  const cb = simulacao.fn()
  const dados = { ...checklistModalFixture, modal: { ...checklistModalFixture.modal!, fotoNaFila: true } }
  renderizar(<Checklist dados={dados} aoConfirmarJustificativa={cb} />)

  esperar(tela.queryByLabelText('Tirar foto')).not.toBeInTheDocument()
  esperar(tela.getByRole('img', { name: 'Foto guardada no tablet' })).toBeVisible()
  dispararEvento.click(tela.getByRole('button', { name: 'Confirmar justificativa' }))
  esperar(cb).toHaveBeenCalledOnce()
})

testar('histórico do admin: escolher dia, voltar ao atual, e justificativa só de leitura', () => {
  const aoSelecionarDia = simulacao.fn()
  renderizar(<Checklist dados={checklistHistoricoFixture} aoSelecionarDia={aoSelecionarDia} />)
  const historico = tela.getByRole('region', { name: 'Histórico do checklist' })
  esperar(dentroDe(historico).getByRole('button', { name: /sex 07\/08/ })).toHaveAttribute('aria-pressed', 'true')
  dispararEvento.click(dentroDe(historico).getByRole('button', { name: /sáb 08\/08/ }))
  esperar(aoSelecionarDia).toHaveBeenLastCalledWith('2026-08-08')
  dispararEvento.click(dentroDe(historico).getByRole('button', { name: 'Voltar ao checklist atual' }))
  esperar(aoSelecionarDia).toHaveBeenLastCalledWith(null)
  esperar(tela.queryByRole('button', { name: 'Remover justificativa' })).not.toBeInTheDocument()
})

testar('atendente não vê histórico', () => {
  renderizar(<Checklist dados={checklistFixture} />)
  esperar(tela.queryByRole('region', { name: 'Histórico do checklist' })).not.toBeInTheDocument()
})
