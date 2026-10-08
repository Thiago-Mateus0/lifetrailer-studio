import type { ReactNode as ConteudoReact } from 'react'

import { Moldura } from '../layout/Moldura'

export type ItemSidebar = {
  identificador: string
  codigo: string
  rotulo: string
  contador?: number
  destaque?: 'urgente' | 'atencao'
  subitens?: { identificador: string; rotulo: string }[]
}

export type DadosSidebar = {
  contexto: string
  hora: string
  logo: string
  descricao: string
  expandida: boolean
  ativo: string
  grupoAberto?: string
  itens: ItemSidebar[]
  totalUrgencias: number
  urgencias: { identificador: string; titulo: string; detalhe: string }[]
  usuario: { nome: string; iniciais: string; papel: string } | null
}

type PropriedadesSidebar = {
  dados: DadosSidebar
  children?: ConteudoReact
  aoAlternarMenu?: () => void
  aoFecharMenu?: () => void
  aoAlternarGrupo?: (identificador: string) => void
  aoNavegar?: (identificador: string) => void
}

export function Sidebar({
  dados,
  children: conteudo,
  aoAlternarMenu,
  aoFecharMenu,
  aoAlternarGrupo,
  aoNavegar,
}: PropriedadesSidebar) {
  return (
    <div
      className={`lt-tela lt-sidebar ${dados.expandida ? 'lt-sidebar-expandida' : 'lt-sidebar-recolhida'}`}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && dados.expandida) aoFecharMenu?.()
      }}
    >
      {dados.expandida && (
        <button className="lt-sidebar-fundo" aria-label="Fechar menu" onClick={aoFecharMenu} type="button" />
      )}
      <aside className="lt-sidebar-reserva">
        <nav className="lt-sidebar-painel" aria-label="Menu principal">
          <div className="lt-sidebar-cabecalho">
            <button className="lt-sidebar-logo" aria-label="Ir para o início" onClick={() => aoNavegar?.('inicio')} type="button">
              <img src={dados.logo} alt="Lifetrailer Studio" />
            </button>
            <small className="lt-sidebar-descricao" hidden={!dados.expandida}>{dados.descricao}</small>
            <button
              className="lt-sidebar-alternar"
              aria-label={dados.expandida ? 'Recolher menu' : 'Abrir menu'}
              aria-expanded={dados.expandida}
              aria-controls="lt-sidebar-itens"
              onClick={aoAlternarMenu}
              type="button"
            >
              <span aria-hidden="true"><i /><i /><i /></span>
            </button>
          </div>

          <div className="lt-sidebar-itens" id="lt-sidebar-itens" hidden={!dados.expandida}>
            {dados.itens.length === 0 ? (
              <p className="lt-vazio">Nenhum módulo disponível neste menu.</p>
            ) : dados.itens.map((item) => {
              const temSubitens = Boolean(item.subitens?.length)
              const aberto = temSubitens && dados.grupoAberto === item.identificador

              return (
                <div key={item.identificador}>
                  <button
                    className={`lt-sidebar-item ${dados.ativo === item.identificador ? 'lt-sidebar-item-ativo' : ''}`}
                    aria-current={dados.ativo === item.identificador ? 'page' : undefined}
                    aria-expanded={temSubitens ? aberto : undefined}
                    onClick={() => temSubitens ? aoAlternarGrupo?.(item.identificador) : aoNavegar?.(item.identificador)}
                    type="button"
                  >
                    <span className="lt-sidebar-rotulo"><span className="lt-sidebar-codigo" aria-hidden="true">{item.codigo}</span>{item.rotulo}</span>
                    <span className="lt-sidebar-indicadores">
                      {item.contador !== undefined && <span className={`lt-sidebar-contador lt-sidebar-contador-${item.destaque ?? 'urgente'}`}>{item.contador}</span>}
                      {temSubitens && <span className={`lt-sidebar-seta ${aberto ? 'lt-sidebar-seta-aberta' : ''}`} aria-hidden="true">›</span>}
                    </span>
                  </button>
                  {aberto && <div className="lt-sidebar-subitens">
                    {item.subitens?.map((subitem) => (
                      <button key={subitem.identificador} onClick={() => aoNavegar?.(subitem.identificador)} type="button">{subitem.rotulo}</button>
                    ))}
                  </div>}
                </div>
              )
            })}
          </div>

          <section className={dados.urgencias.length ? 'lt-sidebar-urgencias' : 'lt-sidebar-sem-urgencias'} aria-label="Urgências" hidden={!dados.expandida}>
            {dados.urgencias.length ? <>
              <h2>Urgente <span className="lt-sidebar-contador lt-sidebar-contador-urgente">{dados.totalUrgencias}</span></h2>
              {dados.urgencias.map((urgencia) => (
                <div className="lt-sidebar-urgencia" key={urgencia.identificador}>
                  {urgencia.titulo}<span>{urgencia.detalhe}</span>
                </div>
              ))}
            </> : <p className="lt-vazio">Nenhuma urgência agora.</p>}
          </section>

          <button className="lt-sidebar-perfil" hidden={!dados.expandida} onClick={() => aoNavegar?.('entrada')} type="button">
            <span className="lt-sidebar-avatar" aria-hidden="true">{dados.usuario?.iniciais ?? '—'}</span>
            <span><b>{dados.usuario?.nome ?? 'Ninguém autenticado'}</b>{' '}<small>{dados.usuario?.papel ?? 'Entre com seu PIN'}</small></span>
          </button>
        </nav>
      </aside>
      <Moldura contexto={dados.contexto} hora={dados.hora} turno={dados.usuario?.iniciais}>
        {conteudo}
      </Moldura>
    </div>
  )
}
