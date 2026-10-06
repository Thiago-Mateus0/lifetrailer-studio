import { fireEvent as dispararEvento, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi as simulacao } from 'vitest'

import { PinsDeAcesso, problemaDoPin } from './TrocaDePin'

const BIA = { identificador: 'bia', nome: 'Bia', papel: 'Atendente' }
const MARCOS = { identificador: 'marcos', nome: 'Marcos', papel: 'Atendente' }

const campo = (texto: RegExp) => tela.getByLabelText(texto) as HTMLInputElement
const digitar = (texto: RegExp, pin: string) => dispararEvento.change(campo(texto), { target: { value: pin } })

function abrirBia(aoTrocar = simulacao.fn().mockResolvedValue({ texto: 'PIN de Bia trocado.', erro: false })) {
  renderizar(<PinsDeAcesso pessoas={[BIA, MARCOS]} aoTrocar={aoTrocar} />)
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Bia' }))
  return aoTrocar
}

descrever('problemaDoPin — o mesmo de app.pin_problema (0088)', () => {
  testar.each(['4713', '1212', '9012', '0918'])('%s serve', (pin) => esperar(problemaDoPin(pin)).toBeNull())
  testar.each(['0000', '7777'])('%s: dígitos iguais', (pin) => esperar(problemaDoPin(pin)).toMatch(/iguais/))
  testar.each(['0123', '1234', '6789', '4321', '3210'])('%s: sequência', (pin) => esperar(problemaDoPin(pin)).toMatch(/Sequência/))
  testar.each(['', '123', '12a4', '12345'])('"%s": formato', (pin) => esperar(problemaDoPin(pin)).toMatch(/4 dígitos/))
})

testar('o PIN é campo de senha: não aparece, e o navegador não guarda', () => {
  abrirBia()
  const entrada = campo(/Digite o PIN novo de Bia/)
  esperar(entrada.type).toBe('password')
  esperar(entrada.autocomplete).toBe('off')
  esperar(entrada.inputMode).toBe('numeric')
  esperar(tela.queryByRole('textbox')).toBeNull()
})

testar('digita, repete e troca — uma chamada, com a pessoa e o PIN', async () => {
  const aoTrocar = abrirBia()

  digitar(/Digite o PIN novo de Bia/, '4721')
  esperar(campo(/Repita o PIN novo de Bia/).value).toBe('')
  digitar(/Repita o PIN novo de Bia/, '4721')

  esperar(await tela.findByRole('status')).toHaveTextContent('PIN de Bia trocado.')
  esperar(aoTrocar).toHaveBeenCalledOnce()
  esperar(aoTrocar).toHaveBeenCalledWith('bia', '4721')
  esperar(tela.queryByLabelText(/PIN novo de Bia/)).toBeNull()
})

testar('PIN fácil é recusado no primeiro passo, sem chamar o banco', () => {
  const aoTrocar = abrirBia()

  digitar(/Digite o PIN novo de Bia/, '1234')

  esperar(tela.getByRole('alert')).toHaveTextContent('Sequência é fácil de adivinhar')
  esperar(campo(/Digite o PIN novo de Bia/).value).toBe('')
  esperar(aoTrocar).not.toHaveBeenCalled()
})

testar('os dois PINs diferentes: não troca, e pede para repetir', () => {
  const aoTrocar = abrirBia()

  digitar(/Digite o PIN novo de Bia/, '4721')
  digitar(/Repita o PIN novo de Bia/, '4722')

  esperar(tela.getByRole('alert')).toHaveTextContent('Os dois PINs não são iguais')
  esperar(campo(/Repita o PIN novo de Bia/).value).toBe('')
  esperar(aoTrocar).not.toHaveBeenCalled()
})

testar('recusa do banco (igual ao atual) mostra o motivo e volta ao começo, sem o PIN na memória', async () => {
  abrirBia(simulacao.fn().mockResolvedValue({ texto: 'O PIN novo é igual ao atual. Escolha outro PIN.', erro: true }))

  digitar(/Digite o PIN novo de Bia/, '4721')
  digitar(/Repita o PIN novo de Bia/, '4721')

  esperar(await tela.findByRole('alert')).toHaveTextContent('igual ao atual')
  esperar(campo(/Digite o PIN novo de Bia/).value).toBe('')
})

testar('cancelar esquece o que foi digitado; abrir outra linha também', () => {
  abrirBia()
  digitar(/Digite o PIN novo de Bia/, '47')
  dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Bia' }))
  esperar(campo(/Digite o PIN novo de Bia/).value).toBe('')

  digitar(/Digite o PIN novo de Bia/, '4721')
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Marcos' }))
  esperar(tela.queryByLabelText(/PIN novo de Bia/)).toBeNull()
  dispararEvento.click(tela.getByRole('button', { name: 'Cancelar' }))
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Bia' }))
  esperar(campo(/Digite o PIN novo de Bia/).value).toBe('')
})

testar('uma linha aberta por vez', () => {
  abrirBia()
  dispararEvento.click(tela.getByRole('button', { name: 'Trocar PIN de Marcos' }))
  esperar(dentroDe(tela.getByRole('group', { name: 'Bia' })).queryByRole('button', { name: 'Cancelar' })).toBeNull()
  esperar(campo(/Digite o PIN novo de Marcos/)).toBeVisible()
})
