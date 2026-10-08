import { useEffect, useRef, useState } from 'react'

import { Moldura } from '../layout/Moldura'

type Criticidade = 'urgente' | 'atencao' | 'normal'

export type StatusComandaHome = 'sem_comanda' | 'aberta' | 'fechada' | 'enviada' | 'paga' | 'cancelada'

export type EnsaioHome = {
  identificador: string
  /** Identificador do estúdio: é a coluna em que o bloco cai. */
  estudio: string
  inicio: string
  fim: string
  /** Fim do bloqueio na Altegio: o trecho entre `fim` e ele é a arrumação da sala. */
  fimBloqueio: string
  cliente: string
  servico: string
  /** 'em 25 min' ou 'agora' — só para o que está perto; o resto a grade já diz. */
  relogio?: string
  /** O fim do ensaio já passou (sem contar a arrumação): Comanda por pagar fica amarela. */
  terminou: boolean
  comanda: {
    status: StatusComandaHome
    rotulo: string
    /** A Comanda do ensaio, quando existe — inclusive cancelada. */
    identificador: string | null
    /** Sem Comanda e com duração que a tabela cobre: é quando o painel oferece "Criar comanda". */
    podeAbrir: boolean
  }
  observacao?: string
}

type AvisoHome = { identificador: string; titulo: string; texto: string; meta: string; urgente: boolean }
export type ItemChecklistHome = { identificador: string; versao: number; texto: string; marcado: boolean; podeTratar: boolean }
type ConsultaHome = { identificador: string; nome: string; nota: string; destaque?: string }

export type DadosHome = {
  hora: string
  turno: string
  data: string
  saudacao: string
  turnoResumo: string
  sincronizacao: { rotulo: string; hora: string }
  /** A grade da Altegio: uma coluna por estúdio, horário na vertical. */
  agenda: {
    resumo: string
    estudios: { identificador: string; nome: string }[]
    /** Primeira e última hora da grade, 'HH:MM', do expediente do dia. */
    abre: string
    fecha: string
    /** Hora atual quando é hoje e está dentro da grade; senão nulo. */
    agora: string | null
    ensaios: EnsaioHome[]
  }
  comandas: { abertas: string; fechadasHoje: string }
  avisos: { contador: string; itens: AvisoHome[] }
  checklist: {
    titulo: string
    progresso: string
    percentual: string
    criticidade: Criticidade
    itens: ItemChecklistHome[]
  } | null
  estoque: { resumo: string; criticidade: Criticidade } | null
  consultas: ConsultaHome[]
  rodape: string
}

type PropriedadesHome = {
  dados: DadosHome
  /** Recusa da última escrita feita da Home, no texto de quem opera. */
  recusa?: string | null
  /** "Ver comanda", no painel do ensaio que já tem uma (recebe o identificador da Comanda). */
  aoAbrirComandaDoEnsaio?: (comanda: string) => void
  /** "Criar comanda", no painel: cria a Comanda do ensaio (recebe o identificador do ensaio). */
  aoCriarComanda?: (identificador: string) => void
  aoAbrirComandas?: () => void
  aoAbrirAvisos?: () => void
  aoAbrirChecklist?: () => void
  aoAlternarItemChecklist?: (item: ItemChecklistHome) => void
  aoAbrirEstoque?: () => void
  aoAbrirConsulta?: (identificador: string) => void
}

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Comanda que existe e ainda não foi paga (ADR 0081 §4).
const POR_PAGAR: StatusComandaHome[] = ['aberta', 'fechada', 'enviada']

// ADR 0084: verde só para Comanda paga; pago na Altegio sem Comanda não ganha cor.
const corDoFim = (ensaio: EnsaioHome) => {
  if (ensaio.comanda.status === 'paga') return ' lt-home-bloco-pago'
  return ensaio.terminou && POR_PAGAR.includes(ensaio.comanda.status) ? ' lt-home-bloco-terminou' : ''
}

/** Altura de meia hora na grade. Com 34px, o turno inteiro cabe rolando e um ensaio de 1h mostra 3 linhas. */
const PX_MEIA_HORA = 34
const pixels = (hhmm: string, abre: string) => ((minutos(hhmm) - minutos(abre)) / 30) * PX_MEIA_HORA

function GradeAgenda({ agenda, aoEscolher }: {
  agenda: DadosHome['agenda']
  aoEscolher: (ensaio: EnsaioHome) => void
}) {
  const rolagem = useRef<HTMLDivElement>(null)
  const altura = pixels(agenda.fecha, agenda.abre)
  const marcas: string[] = []
  for (let m = minutos(agenda.abre); m <= minutos(agenda.fecha); m += 30) {
    marcas.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }

  // Abre rolado para uma hora antes de agora: é o que o turno precisa ver primeiro.
  useEffect(() => {
    if (rolagem.current === null || agenda.agora === null) return
    rolagem.current.scrollTop = Math.max(0, pixels(agenda.agora, agenda.abre) - 2 * PX_MEIA_HORA)
  }, [agenda.agora, agenda.abre])

  return (
    <div className="lt-home-grade" style={{ ['--lt-home-colunas' as string]: agenda.estudios.length }}>
      <div className="lt-home-grade-estudios" aria-hidden="true">
        <span />
        {agenda.estudios.map((estudio) => <b key={estudio.identificador}>{estudio.nome}</b>)}
      </div>
      <div className="lt-home-grade-rolagem" ref={rolagem}>
        <div className="lt-home-grade-corpo" style={{ height: altura }}>
          <div className="lt-home-grade-horas" aria-hidden="true">
            {marcas.map((marca) => <span key={marca} style={{ top: pixels(marca, agenda.abre) }} className={marca.endsWith(':00') ? 'lt-home-hora-cheia' : ''}>{marca.endsWith(':00') ? marca : ''}</span>)}
          </div>
          {agenda.estudios.map((estudio) => (
            <ul key={estudio.identificador} className="lt-home-grade-coluna" aria-label={estudio.nome}>
              {agenda.ensaios.filter((ensaio) => ensaio.estudio === estudio.identificador).map((ensaio) => {
                const topo = pixels(ensaio.inicio, agenda.abre)
                const corpo = pixels(ensaio.fim, agenda.abre) - topo
                const arrumacao = pixels(ensaio.fimBloqueio, agenda.abre) - pixels(ensaio.fim, agenda.abre)
                return (
                  <li key={ensaio.identificador} style={{ top: topo, height: corpo + arrumacao, ['--lt-home-corpo' as string]: `${corpo}px` }}>
                    <button
                      type="button"
                      className={`lt-home-bloco lt-home-bloco-${ensaio.comanda.status}${corDoFim(ensaio)}`}
                      aria-label={`${ensaio.inicio} a ${ensaio.fim}, ${estudio.nome}: ${ensaio.cliente}. ${ensaio.comanda.rotulo}`}
                      onClick={() => aoEscolher(ensaio)}
                    >
                      <span className="lt-home-bloco-ensaio" style={{ height: corpo }}>
                        <span className="lt-home-bloco-topo">
                          <time>{ensaio.inicio}–{ensaio.fim}</time>
                          {ensaio.relogio && <em>{ensaio.relogio}</em>}
                        </span>
                        <b>{ensaio.cliente}</b>
                        <small>{ensaio.servico}</small>
                        {ensaio.observacao && <small className="lt-home-bloco-obs">“{ensaio.observacao}”</small>}
                        <small className="lt-home-bloco-status">{ensaio.comanda.rotulo}</small>
                      </span>
                      {arrumacao > 0 && <span className="lt-home-bloco-arrumacao" style={{ height: arrumacao }}>arrumação até {ensaio.fimBloqueio}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ))}
          {agenda.agora !== null && <div className="lt-home-grade-agora" style={{ top: pixels(agenda.agora, agenda.abre) }}><time>{agenda.agora}</time></div>}
        </div>
      </div>
    </div>
  )
}

function PainelDoEnsaio({ ensaio, estudio, aoFechar, aoVer, aoCriar }: {
  ensaio: EnsaioHome
  estudio: string
  aoFechar: () => void
  aoVer?: (identificador: string) => void
  aoCriar?: (identificador: string) => void
}) {
  const comanda = ensaio.comanda.identificador
  return <div className="lt-home-sobreposicao">
    <button type="button" className="lt-home-fundo" aria-label="Fechar painel do ensaio" tabIndex={-1} onClick={aoFechar} />
    <section className="lt-home-painel" role="dialog" aria-modal="true" aria-label={`Ensaio de ${ensaio.cliente}`}
      onKeyDown={(evento) => { if (evento.key === 'Escape') { evento.stopPropagation(); aoFechar() } }}>
      <header>
        <time>{ensaio.inicio}–{ensaio.fim}</time>
        <span>{estudio}</span>
      </header>
      <h2>{ensaio.cliente}</h2>
      <p>{ensaio.servico}</p>
      {ensaio.observacao && <p className="lt-home-painel-obs">“{ensaio.observacao}”</p>}
      <p className={`lt-home-painel-status lt-home-painel-status-${ensaio.comanda.status}`}>{ensaio.comanda.rotulo}</p>
      <footer>
        <button type="button" autoFocus onClick={aoFechar}>Fechar</button>
        {comanda !== null && <button type="button" className="lt-home-painel-acao" onClick={() => { aoFechar(); aoVer?.(comanda) }}>Ver comanda</button>}
        {ensaio.comanda.podeAbrir && <button type="button" className="lt-home-painel-acao" onClick={() => { aoFechar(); aoCriar?.(ensaio.identificador) }}>Criar comanda</button>}
      </footer>
    </section>
  </div>
}

export function Home({
  dados, recusa, aoAbrirComandaDoEnsaio, aoCriarComanda, aoAbrirComandas,
  aoAbrirAvisos, aoAbrirChecklist, aoAlternarItemChecklist, aoAbrirEstoque, aoAbrirConsulta,
}: PropriedadesHome) {
  // Guarda o identificador, não o ensaio: a Home relida mostra o estado novo da Comanda.
  const [escolhido, definirEscolhido] = useState<string | null>(null)
  const ensaio = dados.agenda.ensaios.find((e) => e.identificador === escolhido)
  return <div className="lt-tela lt-home">
    <Moldura contexto="Início" hora={dados.hora} turno={dados.turno}>
      <section className="lt-home-pagina" aria-label="Início">
        <header className="lt-home-cabecalho">
          <div>
            <h1>{dados.saudacao}</h1>
            <p>{dados.turnoResumo}</p>
          </div>
          <div className="lt-home-contexto">
            <span>{dados.data}</span>
            <span role="status" aria-label="Sincronização da agenda" className="lt-home-sincronizacao"><i aria-hidden="true" />Altegio {dados.sincronizacao.hora} · {dados.sincronizacao.rotulo}</span>
          </div>
        </header>

        <div className="lt-home-colunas">
          <section className="lt-home-agenda" aria-label="Agenda de hoje">
            <div className="lt-home-cartao-cabecalho">
              <h2>Agenda de hoje</h2>
              <span className="lt-home-agenda-resumo">{dados.agenda.resumo}</span>
            </div>
            {dados.agenda.estudios.length === 0
              ? <p className="lt-vazio">Nenhum estúdio cadastrado.</p>
              : <>
                  {recusa !== null && recusa !== undefined && <p role="alert" className="lt-home-recusa">{recusa}</p>}
                  <GradeAgenda agenda={dados.agenda} aoEscolher={(e) => definirEscolhido(e.identificador)} />
                  {dados.agenda.ensaios.length === 0 && <p className="lt-vazio">Nenhum ensaio na agenda de hoje.</p>}
                  <div className="lt-home-legenda" aria-label="Legenda">
                    <span className="lt-home-legenda-sem_comanda">sem comanda</span>
                    <span className="lt-home-legenda-aberta">comanda, ensaio acontecendo</span>
                    <span className="lt-home-legenda-terminou">ensaio acabou, falta pagar</span>
                    <span className="lt-home-legenda-pago">comanda paga</span>
                    <span className="lt-home-legenda-arrumacao">arrumação da sala</span>
                  </div>
                </>}
          </section>

          <aside className="lt-home-lateral" aria-label="Rotina do turno">
            <button type="button" className="lt-home-comandas" onClick={aoAbrirComandas}>
              <span><b>{dados.comandas.abertas}</b> abertas</span>
              <span><b>{dados.comandas.fechadasHoje}</b> fechadas hoje</span>
              <span className="lt-home-seta" aria-hidden="true">→</span>
            </button>

            <section className="lt-home-cartao" aria-label="Avisos">
              <div className="lt-home-cartao-cabecalho">
                <h2>Avisos</h2>
                <button type="button" onClick={aoAbrirAvisos}>Ver todos · {dados.avisos.contador}</button>
              </div>
              {dados.avisos.itens.length ? <ul className="lt-home-avisos">
                {dados.avisos.itens.map((aviso) => <li key={aviso.identificador} className={aviso.urgente ? 'lt-home-aviso-urgente' : ''}>
                  <small>{aviso.meta}</small>
                  <b>{aviso.titulo}</b>
                  {aviso.texto && <span>{aviso.texto}</span>}
                </li>)}
              </ul> : <p className="lt-vazio">Nenhum aviso ativo.</p>}
            </section>

            {dados.checklist ? <section className="lt-home-cartao" aria-label="Checklist">
              <div className="lt-home-cartao-cabecalho">
                <h2>{dados.checklist.titulo}</h2>
                <button type="button" onClick={aoAbrirChecklist}>Abrir</button>
              </div>
              <div className="lt-home-progresso">
                <div className="lt-home-barra"><span className={`lt-home-barra-${dados.checklist.criticidade}`} style={{ width: dados.checklist.percentual }} /></div>
                <strong>{dados.checklist.percentual}</strong>
              </div>
              <small className="lt-home-progresso-nota">{dados.checklist.progresso}</small>
              <ul className="lt-home-checklist">
                {dados.checklist.itens.map((item) => <li key={item.identificador}>
                  <button type="button" aria-pressed={item.marcado} disabled={!item.podeTratar} onClick={() => aoAlternarItemChecklist?.(item)}>
                    <i aria-hidden="true" /><span>{item.texto}</span>
                  </button>
                </li>)}
              </ul>
            </section> : <section className="lt-home-cartao" aria-label="Checklist"><p className="lt-vazio">Checklist de hoje não criado.</p></section>}

            {dados.estoque && <button type="button" className={`lt-home-estoque lt-home-estoque-${dados.estoque.criticidade}`} onClick={aoAbrirEstoque}>
              <span>Estoque</span><span>{dados.estoque.resumo}</span>
            </button>}

            {dados.consultas.length > 0 && <nav className="lt-home-consultas" aria-label="Consulta">
              {dados.consultas.map((consulta) => <button key={consulta.identificador} type="button" onClick={() => aoAbrirConsulta?.(consulta.identificador)}>
                <span>{consulta.nome}</span>
                <small>{consulta.nota}{consulta.destaque && <b>{consulta.destaque}</b>}</small>
              </button>)}
            </nav>}
          </aside>
        </div>
        <footer>{dados.rodape}</footer>
      </section>
    </Moldura>
    {ensaio && <PainelDoEnsaio ensaio={ensaio}
      estudio={dados.agenda.estudios.find((e) => e.identificador === ensaio.estudio)?.nome ?? ''}
      aoFechar={() => definirEscolhido(null)} aoVer={aoAbrirComandaDoEnsaio} aoCriar={aoCriarComanda} />}
  </div>
}
