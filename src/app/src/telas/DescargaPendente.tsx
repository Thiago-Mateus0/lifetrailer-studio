import { useEffect, useState } from 'react'

export type FotoNaFila = {
  identificador: string
  /** "Foto do Checklist", "Foto de achado". */
  rotulo: string
  /** Em português de balcão: "Esperando a internet", "Não subiu". */
  situacao: string
  erro: string | null
  podeReenviar: boolean
}

type PropriedadesDescargaPendente = {
  fotos: FotoNaFila[]
  aberta: boolean
  aoAlternar?: () => void
  aoReenviar?: (identificador: string) => void
  /** Os bytes da foto, que moram no tablet. Nulo quando já saíram. */
  carregarFoto?: (identificador: string) => Promise<Blob | null>
}

/**
 * A bandeja "Descarga pendente" da fila de fotos (ADR 0072 §7). Fica no tablet
 * porque a fila mora nele: o servidor não vê o que está aqui. Só "Reenviar":
 * descartar foto é apagar prova, e isso ainda não tem dono (decorrência 72.1).
 */
export function DescargaPendente({ fotos, aberta, aoAlternar, aoReenviar, carregarFoto }: PropriedadesDescargaPendente) {
  const paradas = fotos.filter((foto) => foto.podeReenviar).length
  const resumo = `${fotos.length} ${fotos.length === 1 ? 'foto esperando' : 'fotos esperando'} para subir`

  return <>
    <button type="button" className={`lt-descarga-aviso${paradas > 0 ? ' lt-descarga-aviso-parada' : ''}`} aria-expanded={aberta} onClick={aoAlternar}>
      {resumo}
    </button>
    {aberta && <div className="lt-checklist-sobreposicao" role="presentation" onClick={aoAlternar}>
      <section className="lt-checklist-modal lt-descarga" role="dialog" aria-modal="true" aria-label="Descarga pendente" onClick={(evento) => evento.stopPropagation()}>
        <div className="lt-checklist-modal-cabecalho">
          <span>Descarga pendente</span>
          <h2>{resumo}</h2>
        </div>
        <ul className="lt-checklist-modal-conteudo">
          {fotos.map((foto) => <li key={foto.identificador} aria-label={foto.rotulo}>
            <Miniatura identificador={foto.identificador} carregar={carregarFoto} />
            <div>
              <strong>{foto.rotulo}</strong>
              <small>{foto.situacao}</small>
              {foto.erro !== null && <p>{foto.erro}</p>}
            </div>
            {foto.podeReenviar && <button type="button" onClick={() => aoReenviar?.(foto.identificador)}>Reenviar</button>}
          </li>)}
        </ul>
        <div className="lt-checklist-modal-acoes"><button type="button" onClick={aoAlternar}>Fechar</button></div>
      </section>
    </div>}
  </>
}

// Quem reenvia vê a foto antes (ADR 0021 §3). O `blob:` é devolvido ao sair,
// porque o quiosque fica aberto o turno inteiro.
function Miniatura({ identificador, carregar }: { identificador: string; carregar?: (id: string) => Promise<Blob | null> }) {
  const [endereco, definirEndereco] = useState<string | null>(null)

  useEffect(() => {
    if (carregar === undefined) return
    let criado: string | null = null
    let vivo = true
    void carregar(identificador).then((blob) => {
      if (!vivo || blob === null) return
      try {
        criado = URL.createObjectURL(blob)
        definirEndereco(criado)
      } catch { /* sem suporte a blob:, fica sem miniatura */ }
    })
    return () => {
      vivo = false
      if (criado !== null) try { URL.revokeObjectURL(criado) } catch { /* nada a devolver */ }
    }
  }, [identificador, carregar])

  return <div className="lt-descarga-miniatura">{endereco !== null && <img src={endereco} alt="" />}</div>
}
