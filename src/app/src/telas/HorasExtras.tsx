import { Moldura } from '../layout/Moldura'

// O valor sai da régua da automática (ADR 0061 §1). O motivo é só o de não ter
// ensaio ligado (ADR 0083): com ensaio, não há o que explicar.
export type CampoLancamentoExtra = 'data' | 'inicio' | 'fim' | 'motivo'
export type HoraExtraApresentada = {
  identificador: string
  versao: number
  data: string
  intervalo: string
  colaborador: string
  origem: string
  detalhe: string
  valor: string
  blocos: string
  status: string
  destaque: 'pendente' | 'paga' | 'cancelada'
  acoes: { identificador: string; rotulo: string; principal?: boolean; desativada?: boolean }[]
  avisos: { texto: string; destaque: 'atencao' | 'neutro' }[]
  historicoAberto: boolean
  historico: string[]
  referencia?: { descricao: string; precoEnsaio: string }
  valorHora: string
  acrescimoNoturno: string
  // Mesma caixa de motivo serve a cancelar e a estornar — o que muda é o rótulo.
  cancelamento?: { motivo: string; erro?: string; podeConfirmar: boolean; rotulo?: string; confirmar?: string }
}
export type DadosHorasExtras = {
  hora: string
  data: string
  turno: string
  subtitulo: string
  podeLancar: boolean
  /** Por quem o ator pode lançar: só ele, ou a equipe ativa se for Admin. */
  destinatarios: { identificador: string; rotulo: string; eu: boolean }[]
  /** Ensaios a que o lançamento manual pode ligar, com o dia de cada um (ADR 0083). */
  ensaios: { identificador: string; data: string; rotulo: string; inicio: string; fim: string }[]
  abas: { identificador: string; rotulo: string; selecionada: boolean }[]
  periodos: { identificador: string; rotulo: string; selecionado: boolean }[]
  totalPeriodo: string
  totais: { colaborador: string; valor: string; detalhe: string }[]
  registros: HoraExtraApresentada[]
  vazioTitulo: string
  vazioDescricao: string
  rodape: string
  lancamento?: {
    data: string
    inicio: string
    fim: string
    destinatarios: { identificador: string; rotulo: string; selecionado: boolean }[]
    /** Os que encostam no horário digitado, mais o escolhido em "Outro ensaio". */
    ensaios: EnsaioDoLancamento[]
    /** Há horário e nenhum ensaio encosta nele. */
    nenhumPerto: boolean
    /** O resto do dia e da véspera, atrás da busca; `restantes` é o que não coube. */
    outros: { aberto: boolean; busca: string; ensaios: EnsaioDoLancamento[]; restantes: number; semResultado: boolean }
    semEnsaio: boolean
    motivo: string
    aviso: string
    podeEnviar: boolean
  }
}
type EnsaioDoLancamento = { identificador: string; rotulo: string; selecionado: boolean }
type PropriedadesHorasExtras = {
  dados: DadosHorasExtras
  /** A recusa da última escrita (pagar, cancelar, estornar, lançar). */
  recusa?: string | null
  aoLancar?: () => void
  aoCancelarLancamento?: () => void
  aoAlterarLancamento?: (campo: CampoLancamentoExtra, valor: string) => void
  aoSelecionarDestinatario?: (identificador: string) => void
  /** `null` é "Sem ensaio", que pede o motivo. */
  aoSelecionarEnsaio?: (identificador: string | null) => void
  aoAlternarOutrosEnsaios?: () => void
  aoBuscarEnsaio?: (texto: string) => void
  aoEnviarLancamento?: () => void
  aoSelecionarAba?: (identificador: string) => void
  aoSelecionarPeriodo?: (identificador: string) => void
  aoAcionarExtra?: (identificador: string, acao: string) => void
  aoAlternarHistorico?: (identificador: string) => void
  aoAlterarMotivoCancelamento?: (identificador: string, motivo: string) => void
  aoVoltarCancelamento?: (identificador: string) => void
  aoConfirmarCancelamento?: (identificador: string) => void
}

export function HorasExtras({ dados, recusa = null, aoLancar, aoCancelarLancamento, aoAlterarLancamento, aoSelecionarDestinatario, aoSelecionarEnsaio, aoAlternarOutrosEnsaios, aoBuscarEnsaio, aoEnviarLancamento, aoSelecionarAba, aoSelecionarPeriodo, aoAcionarExtra, aoAlternarHistorico, aoAlterarMotivoCancelamento, aoVoltarCancelamento, aoConfirmarCancelamento }: PropriedadesHorasExtras) {
  const lancamento = dados.lancamento
  const botaoDeEnsaio = (ensaio: EnsaioDoLancamento) => <button key={ensaio.identificador} type="button" aria-pressed={ensaio.selecionado} onClick={() => aoSelecionarEnsaio?.(ensaio.identificador)}>{ensaio.rotulo}</button>

  return <div className="lt-tela lt-horas-extras">
    <Moldura contexto="Horas extras" sala={dados.data} turno={dados.turno} hora={dados.hora}>
      <section className="lt-horas-extras-pagina" aria-label="Horas extras">
        <div className="lt-horas-extras-cabecalho">
          <div><h1>Horas extras</h1><p>{dados.subtitulo}</p></div>
          <div className="lt-horas-extras-acoes">
            {dados.podeLancar && <button type="button" aria-expanded={Boolean(lancamento)} onClick={() => lancamento ? aoCancelarLancamento?.() : aoLancar?.()}>Lançar manual</button>}
            <div className="lt-horas-extras-acoes" role="group" aria-label="Situação das horas extras">{dados.abas.map((aba) => <button key={aba.identificador} type="button" aria-pressed={aba.selecionada} onClick={() => aoSelecionarAba?.(aba.identificador)}>{aba.rotulo}</button>)}</div>
          </div>
        </div>
        {recusa !== null && <p role="alert" className="lt-horas-extras-recusa">{recusa}</p>}
        {dados.podeLancar && lancamento && <form className="lt-horas-extras-lancamento" aria-label="Lançar hora extra manual" onSubmit={(evento) => { evento.preventDefault(); if (lancamento.podeEnviar) aoEnviarLancamento?.() }}>
          <h2>Lançar hora extra manual</h2>
          <div className="lt-horas-extras-formulario">
            <div className="lt-horas-extras-campos">
              <label>Data<input type="date" value={lancamento.data} onChange={(evento) => aoAlterarLancamento?.('data', evento.target.value)} /></label>
              <label>Início<input type="time" value={lancamento.inicio} onChange={(evento) => aoAlterarLancamento?.('inicio', evento.target.value)} /></label>
              <label>Fim<input type="time" value={lancamento.fim} onChange={(evento) => aoAlterarLancamento?.('fim', evento.target.value)} /></label>
            </div>
            {lancamento.destinatarios.length > 0 && <fieldset><legend>Destinatário</legend><div className="lt-horas-extras-acoes">{lancamento.destinatarios.map((pessoa) => <button key={pessoa.identificador} type="button" aria-pressed={pessoa.selecionado} onClick={() => aoSelecionarDestinatario?.(pessoa.identificador)}>{pessoa.rotulo}</button>)}</div></fieldset>}
            {lancamento.data !== '' && <fieldset><legend>Ensaio</legend>
              {lancamento.ensaios.length > 0 && <p className="lt-horas-extras-perto">Perto do horário da hora extra</p>}
              {lancamento.nenhumPerto && <p className="lt-horas-extras-nenhum">Nenhum ensaio encosta nesse horário. Escolha outro ou marque "Sem ensaio".</p>}
              {lancamento.ensaios.length > 0 && <div className="lt-horas-extras-ensaios">{lancamento.ensaios.map(botaoDeEnsaio)}</div>}
              <div className="lt-horas-extras-acoes"><button type="button" aria-expanded={lancamento.outros.aberto} onClick={() => aoAlternarOutrosEnsaios?.()}>{lancamento.outros.aberto ? 'Fechar busca' : 'Outro ensaio…'}</button><button type="button" aria-pressed={lancamento.semEnsaio} onClick={() => aoSelecionarEnsaio?.(null)}>Sem ensaio</button></div>
              {lancamento.outros.aberto && <div className="lt-horas-extras-busca">
                <input type="search" aria-label="Buscar ensaio" placeholder="Buscar por cliente, comanda ou horário" value={lancamento.outros.busca} onChange={(evento) => aoBuscarEnsaio?.(evento.target.value)} />
                {lancamento.outros.ensaios.length > 0 && <div className="lt-horas-extras-ensaios">{lancamento.outros.ensaios.map(botaoDeEnsaio)}</div>}
                {lancamento.outros.restantes > 0 && <p>Mais {lancamento.outros.restantes}: digite para encontrar.</p>}
                {lancamento.outros.semResultado && <p>Nenhum ensaio com esse cliente, comanda ou horário.</p>}
              </div>}
              {lancamento.semEnsaio && <label>Motivo<input type="text" value={lancamento.motivo} placeholder="Ex.: arrumação do estúdio depois do último ensaio" onChange={(evento) => aoAlterarLancamento?.('motivo', evento.target.value)} /></label>}
            </fieldset>}
            <div className="lt-horas-extras-formulario-rodape"><p role="status">{lancamento.aviso}</p><div className="lt-horas-extras-acoes"><button type="button" onClick={() => aoCancelarLancamento?.()}>Cancelar</button><button type="submit" className="lt-horas-extras-principal" disabled={!lancamento.podeEnviar}>Enviar para aprovação</button></div></div>
          </div>
        </form>}
        <div className="lt-horas-extras-periodo"><div className="lt-horas-extras-acoes" role="group" aria-label="Período"><span>Período</span>{dados.periodos.map((periodo) => <button key={periodo.identificador} type="button" aria-pressed={periodo.selecionado} onClick={() => aoSelecionarPeriodo?.(periodo.identificador)}>{periodo.rotulo}</button>)}</div><p><strong>{dados.totalPeriodo}</strong> pendentes no período</p></div>
        {dados.totais.length > 0 && <ul className="lt-horas-extras-totais" aria-label="Totais pendentes por colaborador">{dados.totais.map((total) => <li key={total.colaborador}><span>{total.colaborador}</span><strong>{total.valor}</strong><small>{total.detalhe}</small></li>)}</ul>}
        {dados.registros.length ? <ul className="lt-horas-extras-lista" aria-label="Lançamentos de horas extras">{dados.registros.map((extra) => <li key={extra.identificador} className={`lt-horas-extras-registro lt-horas-extras-${extra.destaque}`} aria-label={`${extra.colaborador} · ${extra.data} · ${extra.identificador}`}>
          <div className="lt-horas-extras-linha"><div className="lt-horas-extras-data"><span>{extra.data}</span><small>{extra.intervalo}</small></div><div className="lt-horas-extras-pessoa"><strong>{extra.colaborador}</strong> <span className="lt-horas-extras-origem">{extra.origem}</span><p>{extra.detalhe}</p></div><div className="lt-horas-extras-valor"><strong>{extra.valor}</strong><small>{extra.blocos}</small></div><span className="lt-horas-extras-status">{extra.status}</span>
            <div className="lt-horas-extras-acoes">{extra.acoes.map((acao) => <button key={acao.identificador} type="button" className={acao.principal ? 'lt-horas-extras-principal' : undefined} disabled={acao.desativada} onClick={() => aoAcionarExtra?.(extra.identificador, acao.identificador)}>{acao.rotulo}</button>)}</div>
          </div>
          {extra.avisos.length > 0 && <ul className="lt-horas-extras-avisos" aria-label={`Avisos de ${extra.identificador}`}>{extra.avisos.map((aviso) => <li key={aviso.texto} className={`lt-horas-extras-aviso-${aviso.destaque}`}>{aviso.texto}</li>)}</ul>}
          <div className="lt-horas-extras-detalhe"><button type="button" aria-expanded={extra.historicoAberto} aria-controls={`historico-${extra.identificador}`} onClick={() => aoAlternarHistorico?.(extra.identificador)}>{extra.historicoAberto ? 'Ocultar histórico' : 'Histórico'}</button>
            {extra.historicoAberto && <section id={`historico-${extra.identificador}`} className="lt-horas-extras-historico" aria-label={`Histórico de ${extra.identificador}`}>
              <dl><div><dt>Valor da hora</dt><dd>{extra.valorHora}</dd></div><div><dt>Acréscimo noturno</dt><dd>{extra.acrescimoNoturno}</dd></div>{extra.referencia && <div><dt>{extra.referencia.descricao}</dt><dd>{extra.referencia.precoEnsaio}</dd></div>}</dl>
              {extra.historico.length ? <ul>{extra.historico.map((registro, indice) => <li key={indice}>{registro}</li>)}</ul> : <p>Nenhum registro no histórico.</p>}
            </section>}
          </div>
          {extra.cancelamento && <form className="lt-horas-extras-cancelamento" aria-label={`Cancelar ${extra.identificador}`} onSubmit={(evento) => { evento.preventDefault(); if (extra.cancelamento?.podeConfirmar) aoConfirmarCancelamento?.(extra.identificador) }}>
            <label>{extra.cancelamento.rotulo ?? 'Motivo do cancelamento'}<input value={extra.cancelamento.motivo} aria-invalid={Boolean(extra.cancelamento.erro)} aria-describedby={extra.cancelamento.erro ? `erro-${extra.identificador}` : undefined} onChange={(evento) => aoAlterarMotivoCancelamento?.(extra.identificador, evento.target.value)} /></label><button type="button" onClick={() => aoVoltarCancelamento?.(extra.identificador)}>Voltar</button><button type="submit" disabled={!extra.cancelamento.podeConfirmar}>{extra.cancelamento.confirmar ?? 'Cancelar a extra'}</button>
            {extra.cancelamento.erro && <p id={`erro-${extra.identificador}`} role="alert">{extra.cancelamento.erro}</p>}
          </form>}
        </li>)}</ul> : <section className="lt-horas-extras-vazio" aria-label="Nenhuma hora extra nesta aba"><h2>{dados.vazioTitulo}</h2><p>{dados.vazioDescricao}</p></section>}
        <p className="lt-horas-extras-rodape">{dados.rodape}</p>
      </section>
    </Moldura>
  </div>
}
