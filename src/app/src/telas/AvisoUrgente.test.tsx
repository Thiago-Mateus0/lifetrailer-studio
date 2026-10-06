import { fireEvent as disparar, render as renderizar, screen as tela, within as dentroDe } from '@testing-library/react'
import { describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { AvisoUrgente } from './AvisoUrgente'
import { avisosUrgentesFixture } from './AvisoUrgente.fixture'

descrever('AvisoUrgente', () => {
  testar('mostra título e texto de cada urgente num diálogo modal', () => {
    renderizar(<AvisoUrgente avisos={avisosUrgentesFixture} />)

    const dialogo = tela.getByRole('dialog', { name: 'Aviso urgente' })
    esperar(dialogo).toHaveAttribute('aria-modal', 'true')
    for (const aviso of avisosUrgentesFixture) {
      esperar(dentroDe(dialogo).getByRole('heading', { name: aviso.titulo })).toBeVisible()
    }
    esperar(dialogo).toHaveTextContent(avisosUrgentesFixture[0].texto)
  })

  testar('"Li e entendi" é por aviso; "Depois" é um só', () => {
    const aoConfirmar = vi.fn()
    const aoAdiar = vi.fn()
    renderizar(<AvisoUrgente avisos={avisosUrgentesFixture} aoConfirmar={aoConfirmar} aoAdiar={aoAdiar} />)

    const segundo = tela.getByRole('group', { name: avisosUrgentesFixture[1].titulo })
    disparar.click(dentroDe(segundo).getByRole('button', { name: 'Li e entendi' }))
    esperar(aoConfirmar).toHaveBeenCalledWith(avisosUrgentesFixture[1])

    esperar(tela.getAllByRole('button', { name: 'Depois' })).toHaveLength(1)
    disparar.click(tela.getByRole('button', { name: 'Depois' }))
    esperar(aoAdiar).toHaveBeenCalledOnce()
  })

  testar('a recusa aparece dentro do modal', () => {
    renderizar(<AvisoUrgente avisos={avisosUrgentesFixture} recusa="Este aviso mudou." />)

    esperar(dentroDe(tela.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Este aviso mudou.')
  })
})
