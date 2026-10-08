import { Moldura } from '../layout/Moldura'
import type { StatusAchado } from '../tipos/dominio'

export type CampoRegistroAchado = 'descricao' | 'data' | 'cliente' | 'observacao'

/** Botão de lista única: o estúdio do achado e o "Guardado onde" têm a mesma forma. */
export type EscolhaAchado = { identificador: string; rotulo: string; selecionado: boolean }

/**
 * Um item ainda em guarda, para o alerta de possível duplicata (spec). `estudio`
 * é o id do estúdio, ou `''` para o achado que não tem um; `data` é `YYYY-MM-DD`,
 * a mesma forma do campo do formulário.
 */
export type AchadoEmGuarda = {
  identificador: string
  estudio: string
  data: string
  rotulo: string
}

export type AchadoApresentado = {
  identificador: string
  codigo: string
  descricao: string
  local: string
  foto?: string
  descricaoFoto: string
  status: StatusAchado
  rotuloStatus: string
  destaque: 'neutro' | 'normal' | 'atencao' | 'urgente'
}

/**
 * O formulário de "Registrar achado". Vem do servidor com `?registrar=1`, e o
 * que ele traz é o ESQUELETO: os estúdios, os lugares e o aviso. O que está
 * sendo digitado é sobreposto pelo App, como o rascunho da justificativa.
 *
 * `foto` aqui é a pré-visualização local do arquivo escolhido — não um endereço
 * assinado. A foto só vira `midia` depois do Guardar, porque ela nasce ligada a
 * um registro que precisa existir antes (ADR 0051 §7, ADR 0053 §1).
 *
 * `data` é `YYYY-MM-DD`, do `<input type="date">`: vazia quer dizer hoje.
 */
export type RegistroAchado = {
  descricao: string
  data: string
  cliente: string
  observacao: string
  foto?: string
  descricaoFoto: string
  estudios: EscolhaAchado[]
  lugares: EscolhaAchado[]
  aviso: string
  podeGuardar: boolean
  /** Tudo que está guardado hoje; quem casa com o estúdio e a data escolhidos vira alerta. */
  emGuarda: AchadoEmGuarda[]
  /** O `YYYY-MM-DD` do servidor: é o que `data` vazia quer dizer. */
  hoje: string
  avisoDuplicata: string
  /** Postos pelo App enquanto o dedo espera: o achado subindo, e por que não subiu. */
  enviando?: boolean
  recusa?: string
}

/**
 * As duas saídas do ciclo de vida (ADR 0054). Mesma forma porque são o mesmo
 * gesto: um campo obrigatório, um aviso que diz o que fica registrado, e a
 * confirmação. Só o que se escreve muda — quem retirou, ou para onde foi.
 *
 * Vêm do servidor pelo `?saida=`, vazias, e o que está sendo digitado é
 * sobreposto pelo App. `podeConfirmar` é calculado lá, como o `podeGuardar`.
 */
export type EntregaAchado = { nomeRetirada: string; podeConfirmar: boolean; aviso: string; recusa?: string }
export type DoacaoAchado = { destino: string; podeConfirmar: boolean; aviso: string; recusa?: string }

export type DetalheAchado = AchadoApresentado & {
  /** A versão que as duas saídas mandam de volta; sobe quando a foto entra. */
  versao: number
  linha: string
  meta: string
  acoes: { identificador: string; rotulo: string; destaque: 'principal' | 'secundario'; desativada?: boolean }[]
  historico: string[]
  entrega?: EntregaAchado
  doacao?: DoacaoAchado
  /**
   * A saída de `aguardando_foto` (ADR 0053 §2) — o item foi registrado e a foto
   * não subiu. Só existe nesse estado: nos outros a foto já entrou, e o
   * write-once recusaria a segunda.
   */
  anexarFoto?: { rotulo: string; enviando?: boolean; recusa?: string }
  /**
   * "Copiar mensagem" e "Baixar foto", para a Helena procurar o dono pelo
   * ManyChat (ADR 0075). Só o Admin recebe, e só com foto e com o item ainda em
   * guarda. `texto` vem pronto do servidor — e o que ele não diz (a observação,
   * o nome do cliente) é tão decidido quanto o que ele diz.
   */
  compartilhar?: {
    rotulo: string
    baixarFoto: string
    texto: string
    aviso: string
    /** Depois do toque em copiar: se o texto chegou à área de transferência. */
    copiada?: { naAreaDeTransferencia: boolean }
  }
}

export type DadosAchados = {
  hora: string
  data: string
  turno: string
  subtitulo: string
  abas: { identificador: string; rotulo: string; selecionada: boolean }[]
  achados: AchadoApresentado[]
  mensagemVazia: string
  rodape: string
  registro?: RegistroAchado
  selecionado?: DetalheAchado
}

type PropriedadesAchados = {
  dados: DadosAchados
  aoRegistrarAchado?: () => void
  aoSelecionarAba?: (identificador: string) => void
  aoAbrirAchado?: (identificador: string) => void
  aoFecharAchado?: () => void
  aoAlterarRegistro?: (campo: CampoRegistroAchado, valor: string) => void
  aoEscolherFoto?: (arquivo: File) => void
  aoSelecionarEstudio?: (identificador: string) => void
  aoSelecionarLugar?: (identificador: string) => void
  aoAnexarFoto?: (identificador: string, arquivo: File) => void
  aoCopiarMensagemDoAchado?: () => void
  aoCancelarRegistro?: () => void
  aoGuardarAchado?: () => void
  aoAcionarAchado?: (identificador: string, acao: string) => void
  aoAlterarNomeRetirada?: (identificador: string, nome: string) => void
  aoConfirmarEntrega?: (identificador: string) => void
  aoCancelarEntrega?: (identificador: string) => void
  aoAlterarDestino?: (identificador: string, destino: string) => void
  aoConfirmarDoacao?: (identificador: string) => void
  aoCancelarDoacao?: (identificador: string) => void
}

function FotoAchado({ foto, descricao }: { foto?: string; descricao: string }) {
  return foto ? <img className="lt-achados-foto" src={foto} alt={descricao} /> : (
    <span className="lt-achados-foto lt-achados-foto-vazia" role="img" aria-label={descricao}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      <span aria-hidden="true">Foto do item</span>
    </span>
  )
}

/**
 * `capture` abre a câmera direto no tablet; no laptop vira seletor de arquivo.
 * Um só componente porque a foto do registro e a do "Anexar foto" do detalhe
 * são o mesmo gesto — e viram o mesmo `POST /midia` (ADR 0053 §2).
 */
function EscolherFoto({ rotulo, aoEscolher, desativado }: {
  rotulo: string; aoEscolher?: (arquivo: File) => void; desativado?: boolean
}) {
  // O rótulo vai no próprio input: o `<label>` que o envolve tem a miniatura
  // dentro, e o nome dela não é o nome do gesto.
  return <input type="file" aria-label={rotulo} accept="image/jpeg,image/*" capture="environment" disabled={desativado}
    onChange={(evento) => { const arquivo = evento.target.files?.[0]; if (arquivo) aoEscolher?.(arquivo) }} />
}

/**
 * Os itens já guardados que batem com o estúdio e a data escolhidos — o alerta
 * de possível duplicata do spec.
 *
 * **Sem estúdio escolhido não há alerta.** A regra é "mesmo estúdio e data", e
 * sem estúdio não existe o "mesmo": dois guarda-chuvas esquecidos na recepção
 * na mesma tarde são rotina, e um aviso que aparece todo dia é um aviso que
 * ninguém lê no dia que importa.
 */
function duplicatasDe(registro: RegistroAchado) {
  const estudio = registro.estudios.find((e) => e.selecionado)?.identificador
  if (estudio === undefined) return []
  // Campo vazio quer dizer hoje — o mesmo hoje que a RPC vai carimbar.
  const data = registro.data === '' ? registro.hoje : registro.data
  return registro.emGuarda.filter((item) => item.estudio === estudio && item.data === data)
}

export function Achados({
  dados, aoRegistrarAchado, aoSelecionarAba, aoAbrirAchado, aoFecharAchado,
  aoAlterarRegistro, aoEscolherFoto, aoSelecionarEstudio, aoSelecionarLugar, aoCancelarRegistro,
  aoGuardarAchado, aoAcionarAchado, aoAnexarFoto, aoCopiarMensagemDoAchado,
  aoAlterarNomeRetirada, aoConfirmarEntrega, aoCancelarEntrega,
  aoAlterarDestino, aoConfirmarDoacao, aoCancelarDoacao,
}: PropriedadesAchados) {
  const registro = dados.registro
  const selecionado = dados.selecionado
  const duplicatas = registro ? duplicatasDe(registro) : []

  return (
    <div className="lt-tela lt-achados">
      <div inert={Boolean(selecionado)}>
        <Moldura contexto="Achados" sala={dados.data} turno={dados.turno} hora={dados.hora}>
          <section aria-label="Achados e perdidos">
            <div className="lt-achados-cabecalho">
              <div><h1>Achados e perdidos</h1><p>{dados.subtitulo}</p></div>
              <div className="lt-achados-filtros" role="group" aria-label="Ações e filtros de achados">
                <button type="button" className={registro ? 'lt-achados-secundario' : 'lt-achados-principal'} aria-expanded={Boolean(registro)} onClick={aoRegistrarAchado}>Registrar achado</button>
                <span className="lt-achados-separador" aria-hidden="true" />
                <div role="group" aria-label="Situação dos achados" className="lt-achados-abas">
                  {dados.abas.map((aba) => <button key={aba.identificador} type="button" className="lt-achados-aba" aria-pressed={aba.selecionada} onClick={() => aoSelecionarAba?.(aba.identificador)}>{aba.rotulo}</button>)}
                </div>
              </div>
            </div>

            {registro && <form className="lt-achados-registro" aria-label="Registrar achado" onSubmit={(evento) => { evento.preventDefault(); if (registro.podeGuardar) aoGuardarAchado?.() }}>
              <h2>Registrar achado</h2>
              <div className="lt-achados-registro-conteudo">
                <div className="lt-achados-registro-principal">
                  {/* A foto é escolhida aqui e só sobe DEPOIS do Guardar: ela nasce
                      ligada a um achado que ainda não existe (ADR 0053 §1). */}
                  <label className="lt-achados-escolher-foto">
                    <FotoAchado foto={registro.foto} descricao={registro.descricaoFoto} />
                    <EscolherFoto rotulo="Selecionar foto do achado" aoEscolher={aoEscolherFoto} desativado={registro.enviando} />
                  </label>
                  <div className="lt-achados-campos">
                    <label>O que é<input type="text" value={registro.descricao} placeholder="ex. carteira preta" onChange={(evento) => aoAlterarRegistro?.('descricao', evento.target.value)} /></label>
                    {/* `type="date"` abre o seletor nativo no tablet, e poupa um
                        parser de `dd/mm` no servidor. Vazia quer dizer hoje. */}
                    <label>Data<input type="date" value={registro.data} onChange={(evento) => aoAlterarRegistro?.('data', evento.target.value)} /></label>
                    <label><span>Nome do cliente <small>— opcional</small></span><input type="text" value={registro.cliente} placeholder="se souber quem é" onChange={(evento) => aoAlterarRegistro?.('cliente', evento.target.value)} /></label>
                  </div>
                </div>
                <p className="lt-achados-aviso-foto">A foto entra assim que o item for guardado.</p>
                <label className="lt-achados-observacao"><span>Observação <small>— opcional</small></span><input type="text" value={registro.observacao} placeholder="algo que identifica o item" onChange={(evento) => aoAlterarRegistro?.('observacao', evento.target.value)} /></label>
                {/* Estúdio é FK, não texto: "Estúdio 1" digitado não vira uma. */}
                <fieldset className="lt-achados-lugares"><legend>Estúdio <small>— opcional</small></legend>
                  {registro.estudios.map((e) => <button key={e.identificador} type="button" className={e.selecionado ? 'lt-achados-secundario' : ''} aria-pressed={e.selecionado} onClick={() => aoSelecionarEstudio?.(e.identificador)}>{e.rotulo}</button>)}
                </fieldset>
                <fieldset className="lt-achados-lugares"><legend>Guardado onde</legend>
                  {registro.lugares.map((lugar) => <button key={lugar.identificador} type="button" className={lugar.selecionado ? 'lt-achados-secundario' : ''} aria-pressed={lugar.selecionado} onClick={() => aoSelecionarLugar?.(lugar.identificador)}>{lugar.rotulo}</button>)}
                </fieldset>
                {/* Alerta, não trava: dois itens do mesmo estúdio no mesmo dia
                    acontecem. Quem decide se é o mesmo casaco é quem está com
                    ele na mão — por isso o `Guardar` continua liberado. */}
                {duplicatas.length > 0 && <div className="lt-achados-duplicata" role="status">
                  <p>{registro.avisoDuplicata}</p>
                  <ul aria-label="Itens já guardados deste estúdio nesta data">
                    {duplicatas.map((item) => <li key={item.identificador}>{item.rotulo}</li>)}
                  </ul>
                </div>}
                {registro.recusa && <p className="lt-achados-recusa" role="alert">{registro.recusa}</p>}
                <div className="lt-achados-registro-rodape">
                  <p role="status" aria-label="Orientação para guardar o achado">{registro.aviso}</p>
                  <div className="lt-achados-botoes"><button type="button" onClick={aoCancelarRegistro}>Cancelar</button><button type="submit" className="lt-achados-principal" disabled={!registro.podeGuardar || registro.enviando}>{registro.enviando ? 'Guardando…' : 'Guardar'}</button></div>
                </div>
              </div>
            </form>}

            {dados.achados.length ? <ul className="lt-achados-lista" aria-label="Itens achados">
              {dados.achados.map((achado) => <li key={achado.identificador}>
                <button type="button" className={`lt-achados-cartao lt-achados-cartao-${achado.destaque}`} aria-label={`Abrir ${achado.descricao}, ${achado.codigo}`} data-status={achado.status} onClick={() => aoAbrirAchado?.(achado.identificador)}>
                  <span className="lt-achados-cartao-imagem"><FotoAchado foto={achado.foto} descricao={achado.descricaoFoto} /><span className={`lt-achados-status lt-achados-status-${achado.destaque}`}>{achado.rotuloStatus}</span></span>
                  <span className="lt-achados-cartao-texto"><strong>{achado.descricao}</strong><small>{achado.codigo} · {achado.local}</small></span>
                </button>
              </li>)}
            </ul> : <section className="lt-achados-vazio" aria-label="Nenhum achado nesta aba"><p className="lt-vazio">{dados.mensagemVazia}</p><button type="button" className="lt-achados-principal" onClick={aoRegistrarAchado}>Registrar achado</button></section>}
            <p className="lt-achados-rodape">{dados.rodape}</p>
          </section>
        </Moldura>
      </div>

      {selecionado && <div className="lt-achados-sobreposicao">
        <button type="button" className="lt-achados-fundo" aria-label="Fechar detalhe do achado" tabIndex={-1} onClick={aoFecharAchado} />
        <section className="lt-achados-detalhe" role="dialog" aria-modal="true" aria-label={`Detalhes de ${selecionado.descricao}`} onKeyDown={(evento) => {
          if (evento.key === 'Escape') { evento.stopPropagation(); aoFecharAchado?.() }
          if (evento.key === 'Tab') {
            const controles = evento.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled), input:not(:disabled)')
            const primeiro = controles[0]
            const ultimo = controles[controles.length - 1]
            if (evento.shiftKey && evento.target === primeiro) { evento.preventDefault(); ultimo?.focus() }
            else if (!evento.shiftKey && evento.target === ultimo) { evento.preventDefault(); primeiro?.focus() }
          }
        }}>
          <div className="lt-achados-detalhe-imagem">
            <FotoAchado foto={selecionado.foto} descricao={selecionado.descricaoFoto} />
            <button type="button" className="lt-achados-fechar" aria-label="Fechar achado" autoFocus onClick={aoFecharAchado}>✕</button>
            <span className={`lt-achados-status lt-achados-status-${selecionado.destaque}`}>{selecionado.rotuloStatus}</span>
          </div>
          <div className="lt-achados-detalhe-conteudo">
            <div className="lt-achados-detalhe-titulo"><h2>{selecionado.descricao}</h2><span>{selecionado.codigo}</span></div>
            <p className="lt-achados-linha">{selecionado.linha}</p><p className="lt-achados-meta">{selecionado.meta}</p>
            {/* O item foi registrado e a foto não subiu: é daqui que ela entra,
                e é ela que move `aguardando_foto` -> `em_posse` (ADR 0053 §2). */}
            {selecionado.anexarFoto && <div className="lt-achados-anexar">
              <label className="lt-achados-principal">
                {selecionado.anexarFoto.enviando ? 'Enviando a foto…' : selecionado.anexarFoto.rotulo}
                <EscolherFoto rotulo={selecionado.anexarFoto.rotulo} desativado={selecionado.anexarFoto.enviando}
                  aoEscolher={(arquivo) => aoAnexarFoto?.(selecionado.identificador, arquivo)} />
              </label>
              {selecionado.anexarFoto.recusa && <p className="lt-achados-recusa" role="alert">{selecionado.anexarFoto.recusa}</p>}
            </div>}
            {/* O gesto de procurar o dono, da Helena. O aviso fica colado nele
                porque a mesma foto que acha o dono certo entrega o item ao
                errado se a observação for junto. */}
            {selecionado.compartilhar && <div className="lt-achados-compartilhar">
              <div className="lt-achados-botoes">
                <button type="button" onClick={aoCopiarMensagemDoAchado}>{selecionado.compartilhar.rotulo}</button>
                {/* O mesmo endereço assinado do <img>: a foto vai como anexo, não como link (ADR 0075 §2). */}
                <a className="lt-achados-baixar" href={selecionado.foto} download>{selecionado.compartilhar.baixarFoto}</a>
              </div>
              <p>{selecionado.compartilhar.aviso}</p>
              {selecionado.compartilhar.copiada && <section aria-label="Mensagem para o cliente" role="status">
                <h3>{selecionado.compartilhar.copiada.naAreaDeTransferencia ? 'Mensagem copiada' : 'Copie a mensagem'}</h3>
                <textarea readOnly value={selecionado.compartilhar.texto} rows={3} aria-label="Mensagem"
                  onFocus={(evento) => evento.target.select()} />
              </section>}
            </div>}
            {selecionado.acoes.length > 0 && <div className="lt-achados-botoes lt-achados-acoes" role="group" aria-label="Ações do achado">
              {selecionado.acoes.map((acao) => <button key={acao.identificador} type="button" className={`lt-achados-${acao.destaque}`} disabled={acao.desativada} onClick={() => aoAcionarAchado?.(selecionado.identificador, acao.identificador)}>{acao.rotulo}</button>)}
            </div>}
            {selecionado.entrega && <form className="lt-achados-entrega" aria-label="Entrega do achado" onSubmit={(evento) => { evento.preventDefault(); if (selecionado.entrega?.podeConfirmar) aoConfirmarEntrega?.(selecionado.identificador) }}>
              <div className="lt-achados-entrega-campos">
                <label>Entregue para quem<input type="text" placeholder="nome de quem retirou" value={selecionado.entrega.nomeRetirada} onChange={(evento) => aoAlterarNomeRetirada?.(selecionado.identificador, evento.target.value)} /></label>
                <button type="submit" className="lt-achados-principal" disabled={!selecionado.entrega.podeConfirmar}>Confirmar entrega</button>
                <button type="button" onClick={() => aoCancelarEntrega?.(selecionado.identificador)}>Cancelar</button>
              </div>
              {selecionado.entrega.recusa && <p className="lt-achados-recusa" role="alert">{selecionado.entrega.recusa}</p>}
              <p>{selecionado.entrega.aviso}</p>
            </form>}
            {/* A gêmea da entrega. Digitar o destino é a confirmação que o spec
                pede — não há um "tem certeza?" em cima (ADR 0054 §6). */}
            {selecionado.doacao && <form className="lt-achados-entrega" aria-label="Doação do achado" onSubmit={(evento) => { evento.preventDefault(); if (selecionado.doacao?.podeConfirmar) aoConfirmarDoacao?.(selecionado.identificador) }}>
              <div className="lt-achados-entrega-campos">
                <label>Destino da doação<input type="text" placeholder="para onde o item foi" value={selecionado.doacao.destino} onChange={(evento) => aoAlterarDestino?.(selecionado.identificador, evento.target.value)} /></label>
                <button type="submit" className="lt-achados-principal" disabled={!selecionado.doacao.podeConfirmar}>Confirmar doação</button>
                <button type="button" onClick={() => aoCancelarDoacao?.(selecionado.identificador)}>Cancelar</button>
              </div>
              {selecionado.doacao.recusa && <p className="lt-achados-recusa" role="alert">{selecionado.doacao.recusa}</p>}
              <p>{selecionado.doacao.aviso}</p>
            </form>}
            <section className="lt-achados-historico" aria-label="Histórico do achado"><h3>Histórico</h3>
              {selecionado.historico.length ? <ul aria-label="Registros do achado">{selecionado.historico.map((registroHistorico, indice) => <li key={indice}>{registroHistorico}</li>)}</ul> : <p className="lt-vazio">Nenhum registro no histórico deste achado.</p>}
            </section>
          </div>
        </section>
      </div>}
    </div>
  )
}

