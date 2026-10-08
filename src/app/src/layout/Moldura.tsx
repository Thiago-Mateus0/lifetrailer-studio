import { Fragment as Fragmento, type ReactNode as NoReact } from 'react'

import '../tokens.css'

type PropriedadesMoldura = {
  contexto: string
  sala?: string
  /** Iniciais de quem compõe o turno. */
  turno?: string
  hora: string
  children: NoReact
}

export function Moldura({ contexto, sala, turno, hora, children: conteudo }: PropriedadesMoldura) {
  const partes = [contexto, sala, turno].filter((parte) => parte?.trim())

  return (
    <div className="lt-moldura">
      <header className="lt-assinatura" aria-label="Identificação da tela">
        <span className="lt-assinatura-marca">LIFETRAILER</span>
        {partes.map((parte, indice) => (
          <Fragmento key={indice}>
            <span className="lt-assinatura-separador" aria-hidden="true">·</span>
            <span>{parte}</span>
          </Fragmento>
        ))}
        <span className="lt-assinatura-separador" aria-hidden="true">·</span>
        <time dateTime={hora}>{hora}</time>
      </header>
      <main className="lt-moldura-conteudo">{conteudo}</main>
    </div>
  )
}
