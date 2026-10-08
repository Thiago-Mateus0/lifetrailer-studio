import { Moldura } from '../layout/Moldura'
import type { Turno } from '../tipos/dominio'

type AcaoEscala = { identificador: string; rotulo: string; selecionada?: boolean; desativada?: boolean }
type DestaqueEscala = 'padrao' | 'troca' | 'extra' | 'ausencia' | 'presente'
/**
 * O que o rascunho da edição precisa para trocar sem ir ao servidor. Só vem
 * em turno que o modo de edição oferece (dia futuro, fora do domingo extra).
 * `titular` é quem o padrão escalava — a troca cobre ele.
 */
export type EdicaoTurno = {
  identificador: string
  versao: number
  tipo: 'padrao' | 'troca' | 'ausencia'
  atual: string | null
  titular: string | null
  titularNome: string | null
}
/** O domingo extra acionado, pro "Desfazer" saber em que turno e versão mexe. */
export type ExtraDoDomingo = { identificador: string; versao: number }
/** Quem o botão "Assumir" escala por padrão no domingo livre. */
export type AssumirDomingo = { identificador: string; nome: string }
export type DiaEscala = {
  data: string
  rotulo: string
  numero: string
  hoje: boolean
  turnos: {
    turno: Turno
    rotulo: string
    horario: string
    colaborador: string
    destaque: DestaqueEscala
    selo?: string
    nota?: string
    acoes: AcaoEscala[]
    edicao?: EdicaoTurno
    /** "Marcar que veio" (ADR 0079): o turno e quem a tela mostra nele. */
    presenca?: { identificador: string; colaborador: string; veio: boolean }
  }[]
  mensagem?: string
  acao?: AcaoEscala
  /** "outra pessoa": percorre a equipe sem gravar. O `acao` é que grava. */
  alternativa?: AcaoEscala
  extra?: ExtraDoDomingo
  assumir?: AssumirDomingo
}
export type DadosEscala = {
  hora: string
  data: string
  turno: string
  subtitulo: string
  visao: 'calendario' | 'padroes'
  podeEditar: boolean
  editando: boolean
  podeConfirmar: boolean
  resumo: string
  sugestoes: string
  periodo: string
  janela: string
  diasSemana: string[]
  dias: DiaEscala[]
  legenda: { destaque: DestaqueEscala; rotulo: string }[]
  mensagemVazia: string
  rodape: string
  avisoEdicao: string
  /** Quem pode cobrir um turno numa troca: Atendente ativo. */
  equipe: { identificador: string; nome: string }[]
  padroes: {
    turno: Turno
    rotulo: string
    tipo: string
    versao: string
    colaboradores: string
    dias: string
    horario: string
    ancora?: string
    nota?: string
    podeRevisar: boolean
  }[]
  /**
   * "Alterar âncora ou colaboradores" (migration 0062). O servidor manda a
   * proposta — girar a âncora uma posição — e as trocas que ela afeta; decidir
   * cada uma é rascunho do cliente, como o modo de edição do calendário.
   */
  revisao?: {
    descricao: string
    afetadas: { identificador: string; versao: number; rotulo: string; registrada: string; depois: string; acoes: AcaoEscala[] }[]
    status: string
    podeConfirmar: boolean
    /** O corpo do Confirmar, menos as decisões. */
    alteracao: {
      turno: Turno
      versao: number
      colaboradores: string[]
      ancoraData: string
      ancoraColaborador: string
    }
  }
}

type PropriedadesEscala = {
  dados: DadosEscala
  recusa?: string | null
  aoSelecionarVisao?: (visao: DadosEscala['visao']) => void
  aoEditar?: () => void
  aoCancelarEdicao?: () => void
  aoConfirmarEdicao?: () => void
  aoAcionarTurno?: (data: string, turno: Turno, acao: string) => void
  aoAcionarDia?: (data: string, acao: string) => void
  aoRevisarPadrao?: (turno: Turno) => void
  aoDecidirTroca?: (identificador: string, acao: string) => void
  aoCancelarRevisao?: () => void
  aoConfirmarRevisao?: () => void
}

export function Escala({ dados, recusa, aoSelecionarVisao, aoEditar, aoCancelarEdicao, aoConfirmarEdicao, aoAcionarTurno, aoAcionarDia, aoRevisarPadrao, aoDecidirTroca, aoCancelarRevisao, aoConfirmarRevisao }: PropriedadesEscala) {
  const revisao = dados.revisao

  return <div className="lt-tela lt-escala">
    <Moldura contexto="Escala" sala={dados.data} turno={dados.turno} hora={dados.hora}>
      <section className="lt-escala-pagina" aria-label="Escala">
        <div className="lt-escala-cabecalho">
          <div><h1>Escala</h1><p>{dados.subtitulo}</p></div>
          <div className="lt-escala-acoes">
            {dados.podeEditar && (dados.editando ? <>
              <button type="button" onClick={() => aoCancelarEdicao?.()}>Cancelar</button>
              <button type="button" className="lt-escala-principal" disabled={!dados.podeConfirmar} onClick={() => aoConfirmarEdicao?.()}>Confirmar</button>
            </> : <button type="button" onClick={() => aoEditar?.()}>Editar escala</button>)}
            <div className="lt-escala-acoes" role="group" aria-label="Visualização da escala">
              <button type="button" aria-pressed={dados.visao === 'calendario'} onClick={() => aoSelecionarVisao?.('calendario')}>Calendário</button>
              <button type="button" aria-pressed={dados.visao === 'padroes'} onClick={() => aoSelecionarVisao?.('padroes')}>Padrões</button>
            </div>
          </div>
        </div>
        {recusa !== null && recusa !== undefined && <p role="alert" className="lt-escala-recusa">{recusa}</p>}
        {dados.visao === 'calendario' ? <>
          <p className="lt-escala-resumo" role="status">{dados.resumo}<span>{dados.sugestoes}</span></p>
          {dados.dias.length ? <div className="lt-escala-calendario" role="region" aria-label="Calendário de turnos" tabIndex={0}>
            <div className="lt-escala-periodo"><h2>{dados.periodo}</h2><span>{dados.janela}</span></div>
            <div className="lt-escala-semana" aria-hidden="true">{dados.diasSemana.map((dia) => <span key={dia}>{dia}</span>)}</div>
            <ol className="lt-escala-grade" aria-label="Dias da escala">
              {dados.dias.map((dia) => <li key={dia.data} className="lt-escala-dia" aria-label={dia.rotulo} aria-current={dia.hoje ? 'date' : undefined}>
                <div className="lt-escala-numero"><time dateTime={dia.data}>{dia.numero}</time>{dia.hoje && <small>hoje</small>}</div>
                {dia.turnos.map((turno) => <div key={turno.turno} className={`lt-escala-turno lt-escala-${turno.destaque}`} role="group" aria-label={turno.rotulo}>
                  <small>{turno.horario}</small><strong>{turno.colaborador}</strong>
                  {turno.selo && <span className="lt-escala-selo">{turno.selo}</span>}
                  {turno.nota && <small>{turno.nota}</small>}
                  {turno.acoes.map((acao) => <button key={acao.identificador} type="button" aria-pressed={acao.selecionada} disabled={acao.desativada} onClick={() => aoAcionarTurno?.(dia.data, turno.turno, acao.identificador)}>{acao.rotulo}</button>)}
                </div>)}
                {dia.mensagem && <p className="lt-escala-dia-vazio">{dia.mensagem}</p>}
                {dia.acao && <button type="button" disabled={dia.acao.desativada} onClick={() => aoAcionarDia?.(dia.data, dia.acao!.identificador)}>{dia.acao.rotulo}</button>}
                {dia.alternativa && <button type="button" className="lt-escala-alternativa" disabled={dia.alternativa.desativada} onClick={() => aoAcionarDia?.(dia.data, dia.alternativa!.identificador)}>{dia.alternativa.rotulo}</button>}
              </li>)}
            </ol>
          </div> : <p className="lt-vazio">{dados.mensagemVazia}</p>}
          <ul className="lt-escala-legenda" aria-label="Legenda da escala">{dados.legenda.map((item) => <li key={item.destaque} className={`lt-escala-${item.destaque}`}>{item.rotulo}</li>)}</ul>
          {dados.editando && <p className="lt-escala-aviso">{dados.avisoEdicao}</p>}
        </> : <section aria-label="Padrões de escala">
          {dados.padroes.length ? dados.padroes.map((padrao) => <article key={padrao.turno} className="lt-escala-cartao-padrao" aria-label={padrao.rotulo}>
            <header><h2>{padrao.rotulo} <span>{padrao.tipo}</span></h2><small>{padrao.versao}</small></header>
            <dl><div><dt>Colaboradores</dt><dd>{padrao.colaboradores}</dd></div><div><dt>Dias aplicáveis</dt><dd>{padrao.dias}</dd></div><div><dt>Horário</dt><dd>{padrao.horario}</dd></div>
              {padrao.ancora && <div><dt>Âncora de alternância</dt><dd>{padrao.ancora}</dd></div>}
            </dl>
            {padrao.nota && <p>{padrao.nota}</p>}
            {padrao.podeRevisar && <button type="button" onClick={() => aoRevisarPadrao?.(padrao.turno)}>Alterar âncora ou colaboradores</button>}
          </article>) : <p className="lt-vazio">{dados.mensagemVazia}</p>}
          {revisao && <section className="lt-escala-revisao" aria-label="Revisão obrigatória antes de confirmar">
            <h2>Revisão obrigatória antes de confirmar</h2><p>{revisao.descricao}</p>
            {revisao.afetadas.map((troca) => <div key={troca.identificador} className="lt-escala-troca-afetada" role="group" aria-label={troca.rotulo}>
              <h3>{troca.rotulo}</h3><p>{troca.registrada}</p><p>{troca.depois}</p>
              <div className="lt-escala-acoes">{troca.acoes.map((acao) => <button key={acao.identificador} type="button" aria-pressed={acao.selecionada} disabled={acao.desativada} onClick={() => aoDecidirTroca?.(troca.identificador, acao.identificador)}>{acao.rotulo}</button>)}</div>
            </div>)}
            <div className="lt-escala-acoes"><button type="button" onClick={() => aoCancelarRevisao?.()}>Cancelar revisão</button><button type="button" className="lt-escala-principal" disabled={!revisao.podeConfirmar} onClick={() => aoConfirmarRevisao?.()}>Confirmar nova âncora</button><span role="status">{revisao.status}</span></div>
          </section>}
        </section>}
        <p className="lt-escala-rodape">{dados.rodape}</p>
      </section>
    </Moldura>
  </div>
}
