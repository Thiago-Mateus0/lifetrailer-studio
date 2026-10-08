import { act, fireEvent as disparar, render as renderizar } from '@testing-library/react'
import { afterEach as depoisDeCada, beforeEach as antesDeCada, describe as descrever, expect as esperar, test as testar, vi } from 'vitest'

import { INTERVALO_SALAS_MS, SalasDoEstudio } from './SalasDoEstudio'

const acesa = (container: HTMLElement) => container.querySelector('.lt-login-sala-acesa')?.getAttribute('data-sala')
const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

descrever('SalasDoEstudio', () => {
  antesDeCada(() => { vi.useFakeTimers() })
  depoisDeCada(() => { vi.useRealTimers() })

  testar('mostra os cinco estúdios e reveza sozinho', () => {
    const { container } = renderizar(<SalasDoEstudio parado={false} />)
    esperar(container.querySelectorAll('.lt-login-sala')).toHaveLength(5)
    esperar(acesa(container)).toBe('Acústico')
    passar(INTERVALO_SALAS_MS)
    esperar(acesa(container)).toBe('Branco')
  })

  testar('para enquanto alguém digita', () => {
    const { container, rerender } = renderizar(<SalasDoEstudio parado={false} />)
    rerender(<SalasDoEstudio parado />)
    passar(INTERVALO_SALAS_MS * 3)
    esperar(acesa(container)).toBe('Acústico')
    rerender(<SalasDoEstudio parado={false} />)
    passar(INTERVALO_SALAS_MS)
    esperar(acesa(container)).toBe('Branco')
  })

  testar('o mouse escolhe a sala e segura o revezamento', () => {
    const { container } = renderizar(<SalasDoEstudio parado={false} />)
    disparar.pointerEnter(container.querySelector('[data-sala="Loft"]')!)
    esperar(acesa(container)).toBe('Loft')
    passar(INTERVALO_SALAS_MS * 2)
    esperar(acesa(container)).toBe('Loft')
    disparar.pointerLeave(container.querySelector('.lt-login-salas')!)
    passar(INTERVALO_SALAS_MS)
    esperar(acesa(container)).toBe('Quintal')
  })
})
