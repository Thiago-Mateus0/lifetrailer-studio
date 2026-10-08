export type AvisoUrgenteApresentado = {
  identificador: string
  versao: number
  titulo: string
  texto: string
}

type PropriedadesAvisoUrgente = {
  avisos: AvisoUrgenteApresentado[]
  recusa?: string | null
  aoConfirmar?: (aviso: AvisoUrgenteApresentado) => void
  aoAdiar?: () => void
}

/**
 * O Aviso Urgente na primeira troca de tela depois do PIN (ADR 0070 §2). Sem
 * fechar no fundo: o "Depois" é o gesto de adiar, e tocar fora sem querer não
 * deveria contar como ele.
 */
export function AvisoUrgente({ avisos, recusa, aoConfirmar, aoAdiar }: PropriedadesAvisoUrgente) {
  return <div className="lt-checklist-sobreposicao" role="presentation">
    <section className="lt-checklist-modal lt-aviso-urgente" role="dialog" aria-modal="true" aria-label="Aviso urgente">
      <div className="lt-checklist-modal-cabecalho"><span className="lt-aviso-urgente-marca">Aviso urgente</span></div>
      <div className="lt-checklist-modal-conteudo">
        {recusa && <p className="lt-checklist-modal-recusa" role="alert">{recusa}</p>}
        {avisos.map((aviso) => <div key={aviso.identificador} className="lt-aviso-urgente-item" role="group" aria-label={aviso.titulo}>
          <h2>{aviso.titulo}</h2>
          {aviso.texto !== '' && <p>{aviso.texto}</p>}
          <button className="lt-checklist-principal" type="button" onClick={() => aoConfirmar?.(aviso)}>Li e entendi</button>
        </div>)}
      </div>
      <div className="lt-checklist-modal-acoes"><button type="button" onClick={aoAdiar}>Depois</button></div>
    </section>
  </div>
}
