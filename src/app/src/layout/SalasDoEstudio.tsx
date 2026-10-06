/// <reference types="vite/client" />
import { useEffect, useState } from 'react'

import acustico from '../imagens/estudios/acustico.jpg'
import branco from '../imagens/estudios/branco.jpg'
import luzNatural from '../imagens/estudios/luz-natural.jpg'
import loft from '../imagens/estudios/loft.jpg'
import quintal from '../imagens/estudios/quintal.jpg'

// Fotos do cadastro de cada estúdio no Altegio, copiadas pro build: trocar a foto
// lá não troca esta. Rótulos como em data/staff-altegio.csv.
const SALAS = [
  { numero: 'Estúdio 1', nome: 'Acústico', foto: acustico },
  { numero: 'Estúdio 2', nome: 'Branco', foto: branco },
  { numero: 'Estúdio 3', nome: 'Luz Natural', foto: luzNatural },
  { numero: 'Estúdio 4', nome: 'Loft', foto: loft },
  { numero: 'Estúdio 5', nome: 'Quintal', foto: quintal },
]

export const INTERVALO_SALAS_MS = 5000

/**
 * Fundo do login: uma coluna por estúdio. A sala sob o mouse se abre; sem mouse,
 * elas se revezam — menos enquanto `parado`, que é alguém digitando.
 */
export function SalasDoEstudio({ parado }: { parado: boolean }) {
  const [acesa, definirAcesa] = useState(0)
  const [comMouse, definirComMouse] = useState(false)
  const semMovimento = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (parado || comMouse || semMovimento) return
    const relogio = setInterval(() => definirAcesa((sala) => (sala + 1) % SALAS.length), INTERVALO_SALAS_MS)
    return () => clearInterval(relogio)
  }, [parado, comMouse, semMovimento])

  return (
    <div className="lt-login-salas" aria-hidden="true" onPointerLeave={() => definirComMouse(false)}>
      {SALAS.map((sala, indice) => (
        <div
          key={sala.nome}
          className={indice === acesa ? 'lt-login-sala lt-login-sala-acesa' : 'lt-login-sala'}
          data-sala={sala.nome}
          onPointerEnter={() => {
            definirComMouse(true)
            definirAcesa(indice)
          }}
        >
          <img src={sala.foto} alt="" />
          <span><small>{sala.numero}</small><b>{sala.nome}</b></span>
        </div>
      ))}
    </div>
  )
}
