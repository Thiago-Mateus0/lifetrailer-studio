import { Moldura } from '../layout/Moldura'

type FaseChecklist = 'entrada' | 'saida'
export type ItemChecklist = { identificador: string; versao: number; nome: string; tratado: boolean; justificado: boolean; hora: string; podeTratar: boolean; podeJustificar: boolean }
type SalaChecklist = { identificador: string; nome: string; tag?: string; contagem: string; itens: ItemChecklist[] }
type MonitorChecklist = { identificador: string; nome: string; contagem: string; percentual: string; ultimaAtualizacao: string; corBarra: string }

/**
 * O histórico do Admin (spec: seletor de data). Nulo para Atendente. `dias` são
 * os últimos com checklist; `hoje` é o teto do seletor — futuro bloqueado. Dia
 * que não é o vigente abre `somenteLeitura`: nada se marca nem se conclui.
 */
export type HistoricoChecklist = {
  hoje: string
  selecionada: string
  somenteLeitura: boolean
  dias: { identificador: string; rotulo: string; situacao: string; selecionado: boolean }[]
}

export type DadosChecklist = {
  hora: string
  turno: string
  data: string
  fase: FaseChecklist
  // O dia que a fase conclui, com a versão que a RPC exige de volta. Nulo
  // quando o checklist de hoje não foi criado — não há o que concluir.
  dia: { identificador: string; versao: number } | null
  fases: { identificador: FaseChecklist; rotulo: string; selecionada: boolean }[]
  titulo: string
  subtitulo: string
  perfil: string
  historico: HistoricoChecklist | null
  perfis: { identificador: string; rotulo: string; selecionado: boolean }[]
  sincronizacao: { rotulo: string; criticidade: 'normal' | 'atencao' | 'urgente' }
  progresso: { tratados: string; total: string; percentual: string; corBarra: string }
  erroConcluir: { titulo: string; texto: string; exemplos: string[] } | null
  monitor: MonitorChecklist[]
  bloqueio: { titulo: string; texto: string; botao?: string } | null
  colunas: { identificador: string; salas: SalaChecklist[] }[]
  nota: string
  modal: ModalChecklist | null
}

/**
 * O modal da justificativa. Vem montado do servidor (`?item=` na busca da tela),
 * porque `foto` é um endereço ASSINADO e assinar é do processo, não da tela.
 *
 * Dois modos, e quem os separa é o estado do item: por tratar abre pra escrever;
 * já justificado abre pra ler, com "Remover justificativa" de única ação.
 * `identificador` e `versao` viajam porque as duas RPC exigem a versão de volta —
 * e ela sobe quando a FOTO entra, não só no confirmar.
 */
export type ModalChecklist = {
  identificador: string
  versao: number
  modo: string
  nome: string
  foto?: string
  fotoRotulo: string
  texto: string
  meta: string
  editavel: boolean
  /** Falso no histórico: a justificativa de um dia passado só se lê. */
  podeRemover?: boolean
  aberto: boolean
  /** Postos pelo App enquanto o dedo espera: a foto subindo, e por que ela não subiu. */
  enviando?: boolean
  recusa?: string
  /** A foto deste item está na fila do tablet: o motivo já pode ir (ADR 0072 §9). */
  fotoNaFila?: boolean
}

type PropriedadesChecklist = {
  dados: DadosChecklist
  aoSelecionarFase?: (fase: FaseChecklist) => void
  aoSelecionarPerfil?: (perfil: string) => void
  aoVerSaida?: () => void
  aoVerEntrada?: () => void
  aoConcluir?: () => void
  aoTratarItem?: (item: ItemChecklist) => void
  aoVerJustificativa?: (identificador: string) => void
  aoJustificar?: (identificador: string) => void
  aoIrParaEntrada?: () => void
  aoAlterarTexto?: (texto: string) => void
  aoFecharModal?: () => void
  aoConfirmarJustificativa?: () => void
  aoRemoverJustificativa?: () => void
  aoEscolherFoto?: (arquivo: File) => void
  /** Um dia do histórico; `null` volta ao dia vigente. */
  aoSelecionarDia?: (data: string | null) => void
}

function Historico({ historico, aoSelecionarDia }: { historico: HistoricoChecklist; aoSelecionarDia?: (data: string | null) => void }) {
  return <section className="lt-checklist-historico" aria-label="Histórico do checklist">
    <div className="lt-checklist-historico-cabecalho">
      <strong>Histórico</strong>
      <label>Outro dia<input type="date" max={historico.hoje} value={historico.selecionada} onChange={(evento) => { if (evento.target.value) aoSelecionarDia?.(evento.target.value) }} /></label>
      {historico.somenteLeitura && <button type="button" onClick={() => aoSelecionarDia?.(null)}>Voltar ao checklist atual</button>}
    </div>
    {historico.dias.length > 0 && <div className="lt-checklist-historico-dias" role="group" aria-label="Dias do checklist">{historico.dias.map((dia) => <button key={dia.identificador} type="button" aria-pressed={dia.selecionado} onClick={() => aoSelecionarDia?.(dia.identificador)}><span>{dia.rotulo}</span><small>{dia.situacao}</small></button>)}</div>}
    {historico.somenteLeitura && <p role="status">Dia do histórico: só leitura.</p>}
  </section>
}

function FotoChecklist({ foto, rotulo }: { foto?: string; rotulo: string }) {
  return foto ? <img src={foto} alt={rotulo} /> : <span className="lt-checklist-sem-foto" role="img" aria-label={rotulo}>FOTO</span>
}

/**
 * A foto vem antes do motivo (ADR 0051 §7): anexada no servidor ou guardada na
 * fila do tablet, é ela que destrava o "Confirmar justificativa". Com a foto só
 * na fila, o item fica pendente de anexo até ela subir (ADR 0072 §9).
 */
function ModalJustificativa({
  modal, aoAlterarTexto, aoEscolherFoto, aoFecharModal, aoConfirmarJustificativa, aoRemoverJustificativa,
}: { modal: ModalChecklist } & Pick<PropriedadesChecklist,
  'aoAlterarTexto' | 'aoEscolherFoto' | 'aoFecharModal' | 'aoConfirmarJustificativa' | 'aoRemoverJustificativa'>) {
  const temFoto = modal.foto !== undefined || modal.fotoNaFila === true
  const rotulo = modal.foto === undefined && modal.fotoNaFila ? 'guardada no tablet' : modal.fotoRotulo
  return <div className="lt-checklist-sobreposicao" role="presentation" onClick={aoFecharModal}>
    <section className="lt-checklist-modal" role="dialog" aria-modal="true" aria-label={modal.modo} onClick={(evento) => evento.stopPropagation()}>
      <div className="lt-checklist-modal-cabecalho"><span>{modal.modo}</span><h2>{modal.nome}</h2></div>
      <div className="lt-checklist-modal-conteudo">
        <label>Foto {rotulo}<div className="lt-checklist-modal-foto"><FotoChecklist foto={modal.foto} rotulo={`Foto ${rotulo}`} /></div></label>
        {modal.editavel && !temFoto && <label className="lt-checklist-modal-camera">{modal.enviando ? 'Enviando a foto…' : 'Tirar foto'}
          {/* `capture` abre a câmera direto no tablet; no laptop vira seletor de arquivo. */}
          <input type="file" accept="image/jpeg,image/*" capture="environment" disabled={modal.enviando} onChange={(evento) => { const arquivo = evento.target.files?.[0]; if (arquivo) aoEscolherFoto?.(arquivo) }} /></label>}
        {modal.recusa && <p className="lt-checklist-modal-recusa" role="alert">{modal.recusa}</p>}
        {modal.editavel ? <label>Motivo<textarea value={modal.texto} onChange={(evento) => aoAlterarTexto?.(evento.target.value)} /></label> : <div><b>Motivo</b><p>{modal.texto}</p><small>{modal.meta}</small></div>}
      </div>
      <div className="lt-checklist-modal-acoes">{modal.editavel ? <><button type="button" onClick={aoFecharModal}>Cancelar</button><button className="lt-checklist-principal" type="button" disabled={!temFoto || modal.enviando} onClick={aoConfirmarJustificativa}>Confirmar justificativa</button></> : <>{modal.podeRemover !== false && <button type="button" onClick={aoRemoverJustificativa}>Remover justificativa</button>}<button type="button" onClick={aoFecharModal}>Fechar</button></>}</div>
    </section>
  </div>
}

export function Checklist({
  dados, aoSelecionarFase, aoSelecionarPerfil, aoVerSaida, aoVerEntrada, aoConcluir,
  aoTratarItem, aoVerJustificativa, aoJustificar, aoIrParaEntrada, aoAlterarTexto,
  aoFecharModal, aoConfirmarJustificativa, aoRemoverJustificativa, aoEscolherFoto, aoSelecionarDia,
}: PropriedadesChecklist) {
  return <div className="lt-tela lt-checklist">
    <Moldura contexto={`Checklist ${dados.fase}`} hora={dados.hora} turno={dados.turno}>
      <section className="lt-checklist-pagina" aria-label="Checklist">
        <div className="lt-checklist-contexto"><div className="lt-checklist-fases" role="group" aria-label="Fases do checklist">{dados.fases.map((fase) => <button key={fase.identificador} type="button" aria-pressed={fase.selecionada} onClick={() => aoSelecionarFase?.(fase.identificador)}>{fase.rotulo}</button>)}</div><div className="lt-checklist-perfis" role="group" aria-label="Perfis do checklist">{dados.perfis.map((perfil) => <button key={perfil.identificador} type="button" aria-pressed={perfil.selecionado} onClick={() => aoSelecionarPerfil?.(perfil.identificador)}>{perfil.rotulo}</button>)}</div></div>
        {dados.historico && <Historico historico={dados.historico} aoSelecionarDia={aoSelecionarDia} />}
        <div className="lt-checklist-identificacao"><span>{dados.data}</span><span role="status" aria-label="Sincronização do checklist" className={`lt-checklist-${dados.sincronizacao.criticidade}`}><i aria-hidden="true" />{dados.sincronizacao.rotulo}</span></div>
        <div className="lt-checklist-cabecalho"><div><h1>{dados.titulo}</h1><p>{dados.subtitulo}</p></div><div className="lt-checklist-acoes" role="group" aria-label="Ações do checklist"><button type="button" onClick={dados.fase === 'entrada' ? aoVerSaida : aoVerEntrada}>{dados.fase === 'entrada' ? 'Ver saída' : 'Ver entrada'}</button><button className={dados.progresso.tratados === dados.progresso.total ? 'lt-checklist-concluido' : 'lt-checklist-principal'} type="button" disabled={dados.dia === null} onClick={aoConcluir}>{dados.progresso.tratados === dados.progresso.total ? `${dados.fase === 'entrada' ? 'Entrada' : 'Saída'} concluída ✓` : `Concluir ${dados.fase === 'entrada' ? 'entrada' : 'saída'}`}</button></div></div>
        <div className="lt-checklist-progresso" aria-label={`Progresso ${dados.progresso.tratados} de ${dados.progresso.total}`}><div><span style={{ width: dados.progresso.percentual, background: dados.progresso.corBarra }} /></div><strong>{dados.progresso.tratados}/{dados.progresso.total}</strong></div>
        {dados.erroConcluir && <section className="lt-checklist-erro" role="alert" aria-label={dados.erroConcluir.titulo}><strong>{dados.erroConcluir.titulo}</strong><p>{dados.erroConcluir.texto}</p>{dados.erroConcluir.exemplos.map((exemplo) => <span key={exemplo}>{exemplo}</span>)}</section>}
        {dados.monitor.length > 0 && <section className="lt-checklist-monitor" aria-label="Monitor das salas">{dados.monitor.map((sala) => <article key={sala.identificador}><div><strong>{sala.nome}</strong><span>{sala.contagem}</span></div><div className="lt-checklist-monitor-barra"><span style={{ width: sala.percentual, background: sala.corBarra }} /></div><small>{sala.ultimaAtualizacao}</small></article>)}</section>}
        {dados.bloqueio && <section className="lt-checklist-bloqueio" role="status" aria-label={dados.bloqueio.titulo}><strong>{dados.bloqueio.titulo}</strong><p>{dados.bloqueio.texto}</p>{dados.bloqueio.botao && <button type="button" onClick={aoIrParaEntrada}>{dados.bloqueio.botao}</button>}</section>}
        {dados.colunas.length ? <div className="lt-checklist-colunas">{dados.colunas.map((coluna) => <div key={coluna.identificador}>{coluna.salas.map((sala) => <section key={sala.identificador} className="lt-checklist-sala" aria-label={sala.nome}><div className="lt-checklist-sala-cabecalho"><h2>{sala.nome}</h2>{sala.tag && <span>{sala.tag}</span>}<small>{sala.contagem}</small></div>{sala.itens.length ? sala.itens.map((item) => <div key={item.identificador} className={`lt-checklist-item ${item.tratado ? 'lt-checklist-item-tratado' : ''}`} role="group" aria-label={item.nome}><button type="button" aria-pressed={item.tratado} disabled={!item.podeTratar} onClick={() => aoTratarItem?.(item)}><i aria-hidden="true">{item.tratado ? '✓' : ''}</i><span>{item.nome}</span>{item.hora && <small>{item.hora}</small>}</button>{item.justificado ? <button type="button" className="lt-checklist-link" onClick={() => aoVerJustificativa?.(item.identificador)}>ver</button> : item.podeJustificar && <button type="button" className="lt-checklist-justificar" onClick={() => aoJustificar?.(item.identificador)}>justificar</button>}</div>) : <p className="lt-vazio">Nenhum item nesta sala.</p>}</section>)}</div>)}</div> : !dados.bloqueio && <section className="lt-checklist-vazio" aria-label="Checklist vazio"><p>Catálogo não configurado.</p></section>}
        <p className="lt-checklist-nota">{dados.nota}</p>
      </section>
    </Moldura>
    {dados.modal?.aberto && <ModalJustificativa modal={dados.modal} aoAlterarTexto={aoAlterarTexto} aoEscolherFoto={aoEscolherFoto} aoFecharModal={aoFecharModal} aoConfirmarJustificativa={aoConfirmarJustificativa} aoRemoverJustificativa={aoRemoverJustificativa} />}
  </div>
}
