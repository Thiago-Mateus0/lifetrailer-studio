import { useState } from 'react'

import { fotoDoCatalogo } from '../fotoDoCatalogo'
import { Moldura } from '../layout/Moldura'

export type ComandaNaLista = {
  identificador: string
  cliente: string
  estudio: string
  horario: string
  data: string
  numero: string
  origem: string
  status: string
  statusRotulo: string
  responsavel: string
  /** Vazio na lista de assunção: quem não é o responsável não vê valor. */
  total: string
}

export type LinhaExtra = {
  identificador: string
  nome: string
  quantidade: string
  precoUnitario: string
  total: string
  podeRemover: boolean
}

/** Bomboniere · Fundos · Equipamentos · Fora do catálogo, cada um com o seu subtotal. */
export type GrupoDeExtras = {
  identificador: string
  titulo: string
  /** Em que tabela a remoção escreve: `bomboniere` ou `item_extra`. */
  tabela: string
  contagem: string
  subtotal: string
  linhas: LinhaExtra[]
}

export type AcaoComanda = {
  identificador: string
  rotulo: string
  desativada: boolean
  /** Por que está desligada, ou o aviso de quem pode seguir mesmo assim. */
  motivo: string
  /** Só no "Recebi" (ADR 0086): um botão por forma, e o toque já é a escolha. */
  formas?: { identificador: string; rotulo: string }[]
}

export type ItemDoCatalogo = {
  identificador: string
  nome: string
  tipo: string
  preco: string
}

/** O que o gesto precisa levar de volta ao servidor, por ação. */
/** Outro estúdio para a linha de estúdio adicional (ADR 0085), com as durações da tabela. */
export type EstudioAdicional = {
  identificador: string
  nome: string
  duracoes: { minutos: number; preco: string }[]
}
export type LancamentoComanda = {
  catalogo: ItemDoCatalogo[]
  estudios: EstudioAdicional[]
  /** Onde o A terminou: o B começa aí, salvo se o atendente mudar. */
  inicioSugerido: string
  /** Data do ensaio (YYYY-MM-DD), para montar o início do B. */
  data: string
  /** Início do ensaio (HH:MM): início do B antes disso é do dia seguinte. */
  inicioEnsaio: string
}
export type PraticadoComanda = { data: string; inicio: string; fim: string }

export type DetalheComanda = {
  identificador: string
  numero: string
  status: string
  statusRotulo: string
  cliente: string
  estudio: string
  data: string
  horario: string
  responsavel: string
  versao: number
  assuncao: { titulo: string; texto: string; botao: string } | null
  responsabilidade: {
    criadoPor: string
    origem: string
    responsavelAtual: string
    assumiuPosse: string
  } | null
  ensaio: { servico: string; agendado: string; praticado: string; valor: string } | null
  extensao: { titulo: string; detalhe: string[]; total: string } | null
  extras: GrupoDeExtras[]
  resumo: {
    ensaio: string
    extensao: string
    extras: string
    subtotal: string
    prePago: string
    congelado: boolean
    totalOriginal: string
    ajustes: { valor: string; motivo: string; competencia: string }[]
    totalCorrigido: string
    aPagarAgora: string
  } | null
  acoes: AcaoComanda[]
  envios: { quando: string; telefone: string; por: string }[]
  telefoneCliente: string
  lancamento: LancamentoComanda | null
  praticado: PraticadoComanda | null
  envio: { telefone: string } | null
  /** O que o PDF e a mensagem pedem além do que a tela mostra (ADR 0027 §4, ADR 0073 §2). Só o Admin recebe. */
  comprovante: {
    envio: number
    enviadoPor: string
    blocos: { inicio: string; valor: string; acrescimo: string }[]
    /** Acréscimo dos blocos agendados depois do limite noturno (ADR 0082). */
    noturnoAgendado: { rotulo: string; valor: string } | null
    primeiroNome: string
    dataDoEnsaio: string
  } | null
  cancelamento: { titulo: string; reversivel: boolean; texto: string } | null
  observacoes: string
  competenciaTrancada: boolean
}

export type DadosComanda = {
  hora: string
  data: string
  turno: string
  perfil: string
  perfis: { identificador: string; rotulo: string; selecionado: boolean }[]
  sincronizacao: { rotulo: string; criticidade: string }
  titulo: string
  abertas: string
  busca: string
  modos: { identificador: string; rotulo: string; selecionado: boolean }[]
  filtros: { identificador: string; rotulo: string }[]
  lista: ComandaNaLista[]
  vazio: string
  selecionada: DetalheComanda | null
}

type PropriedadesComanda = {
  dados: DadosComanda
  aoSelecionarModo?: (identificador: string) => void
  aoFiltrarStatus?: (identificador: string) => void
  aoBuscar?: (texto: string) => void
  aoAbrirComanda?: (identificador: string) => void
  aoFecharDetalhe?: () => void
  aoAcionar?: (acao: string, comanda: DetalheComanda, praticado: PraticadoComanda | null, forma?: string) => void
  aoAssumir?: (identificador: string, versao: number) => void
  aoLancarLinha?: (comanda: DetalheComanda, linha: LinhaNova) => void
  aoLancarEstudio?: (comanda: DetalheComanda, estudio: EstudioNovo, lancamento: LancamentoComanda) => void
  aoRemoverLinha?: (comanda: DetalheComanda, identificador: string, tipo: string) => void
  /** Recusa da última ação, para a tela dizer o que houve sem inventar texto. */
  recusa?: string | null
  /** A mensagem do "Copiar mensagem", à vista para copiar à mão se a área de transferência recusou. */
  copiada?: { texto: string; naAreaDeTransferencia: boolean } | null
}

/** Estúdio adicional: o preço é da tabela, então só vai estúdio, início e duração. */
export type EstudioNovo = { estudio: string; inicio: string; duracao: number }

/** O que o formulário de adicionar monta. `item` nulo é item fora do catálogo. */
export type LinhaNova = {
  tipo: string
  item: string | null
  descricao: string
  quantidade: number
  preco: string
}

function Resumo({ resumo }: { resumo: NonNullable<DetalheComanda['resumo']> }) {
  return (
    <section className="lt-comanda-resumo" aria-label="Resumo de valores">
      <dl>
        <div><dt>Ensaio</dt><dd>{resumo.ensaio}</dd></div>
        {resumo.extensao !== '' && <div><dt>Extensão</dt><dd>{resumo.extensao}</dd></div>}
        <div><dt>Extras</dt><dd>{resumo.extras}</dd></div>
        <div className="lt-comanda-subtotal"><dt>Subtotal</dt><dd>{resumo.subtotal}</dd></div>
        {resumo.prePago !== '' && <div><dt>Pago antecipado</dt><dd>{resumo.prePago}</dd></div>}
      </dl>
      {resumo.ajustes.length > 0 && (
        <dl className="lt-comanda-ajustes" aria-label="Ajustes lançados">
          <div><dt>Total original {resumo.congelado ? '(congelado)' : ''}</dt><dd>{resumo.totalOriginal}</dd></div>
          {resumo.ajustes.map((ajuste, indice) => (
            <div key={indice}><dt>Ajuste — {ajuste.motivo}</dt><dd>{ajuste.valor}</dd></div>
          ))}
          <div><dt>Total corrigido</dt><dd>{resumo.totalCorrigido}</dd></div>
        </dl>
      )}
      <p className="lt-comanda-pagar"><span>A pagar agora</span><strong>{resumo.aPagarAgora}</strong></p>
      {/* O relatório de competência mostra o original; a correção aparece no mês
          em que foi feita (spec, Entidades de competência). */}
      {resumo.ajustes.length > 0 && (
        <p className="lt-comanda-nota">O relatório de competência mostra o original — a correção aparece rastreável na competência em que foi feita.</p>
      )}
    </section>
  )
}

// Os `tipo` do catálogo (tela de comanda.mjs). "fora" é o item de preço digitado.
const CATEGORIAS = [
  { tipo: 'bomboniere', titulo: 'Bomboniere' },
  { tipo: 'fundo', titulo: 'Fundos' },
  { tipo: 'equipamento', titulo: 'Equipamentos' },
]

function Quantidade({ valor, aoMudar }: { valor: number; aoMudar: (valor: number) => void }) {
  return (
    <span className="lt-comanda-passos">
      <button type="button" aria-label="Menos um" disabled={valor <= 1} onClick={() => aoMudar(valor - 1)}>−</button>
      <output aria-label="Quantidade">{valor}</output>
      <button type="button" aria-label="Mais um" onClick={() => aoMudar(valor + 1)}>+</button>
    </span>
  )
}

// Item sem foto fica só com o texto, como antes: as fotos chegam aos poucos.
function FotoDoItem({ nome }: { nome: string }) {
  const foto = fotoDoCatalogo(nome)
  return foto === undefined ? null : <img className="lt-comanda-cartao-foto" src={foto} alt="" />
}

const duracaoNaTela = (minutos: number) =>
  `${Math.floor(minutos / 60)}h${minutos % 60 === 0 ? '' : String(minutos % 60).padStart(2, '0')}`

function Lancar({ lancamento, aoLancar, aoLancarEstudio }: {
  lancamento: LancamentoComanda
  aoLancar: (linha: LinhaNova) => void
  aoLancarEstudio: (estudio: EstudioNovo) => void
}) {
  // Nula = lista fechada. Com fotos, uma categoria aberta ocupa a tela do tablet.
  const [aba, definirAba] = useState<string | null>(null)
  const [escolhido, definirEscolhido] = useState<ItemDoCatalogo | null>(null)
  const [quantidade, definirQuantidade] = useState(1)
  const [descricao, definirDescricao] = useState('')
  const [preco, definirPreco] = useState('')
  const [estudio, definirEstudio] = useState<EstudioAdicional | null>(null)
  const [duracao, definirDuracao] = useState<number | null>(null)
  const [inicio, definirInicio] = useState(lancamento.inicioSugerido)

  const recomecar = (novaAba: string | null) => {
    definirAba(novaAba); definirEscolhido(null); definirQuantidade(1); definirDescricao(''); definirPreco('')
    definirEstudio(null); definirDuracao(null); definirInicio(lancamento.inicioSugerido)
  }
  // Tocar na categoria aberta fecha a lista.
  const alternar = (categoria: string) => recomecar(aba === categoria ? null : categoria)
  const fora = aba === 'fora'
  const outroEstudio = aba === 'estudio'
  const pronto = outroEstudio ? estudio !== null && duracao !== null && /^\d{2}:\d{2}$/.test(inicio)
    : fora ? descricao.trim() !== '' && preco.trim() !== '' : escolhido !== null

  return (
    <form
      className="lt-comanda-lancar"
      aria-label="Adicionar item à comanda"
      onSubmit={(evento) => {
        evento.preventDefault()
        if (!pronto) return
        if (outroEstudio) {
          aoLancarEstudio({ estudio: estudio!.identificador, inicio, duracao: duracao! })
          recomecar(null)
          return
        }
        // Um item por Lançar: cada chamada leva a `versao` da Comanda, e uma
        // segunda em sequência chegaria com a versão velha.
        aoLancar(fora
          ? { tipo: 'item_extra', item: null, descricao: descricao.trim(), quantidade, preco }
          // Bomboniere e item extra são tabelas diferentes; fundo e
          // equipamento são os dois tipos de item_extra.
          : { tipo: escolhido!.tipo === 'bomboniere' ? 'bomboniere' : 'item_extra', item: escolhido!.identificador, descricao: '', quantidade, preco: '' })
        recomecar(aba)
      }}
    >
      <div className="lt-comanda-abas" role="group" aria-label="Categoria">
        {CATEGORIAS.map((categoria) => (
          <button key={categoria.tipo} type="button" aria-pressed={aba === categoria.tipo} onClick={() => alternar(categoria.tipo)}>
            {categoria.titulo} <small>{lancamento.catalogo.filter((item) => item.tipo === categoria.tipo).length}</small>
          </button>
        ))}
        {/* Válvula de escape do spec: o quadro do estúdio pede item novo, e uso
            externo é negociado — os dois entram por aqui, com preço digitado. */}
        <button type="button" className="lt-comanda-aba-fora" aria-pressed={fora} onClick={() => alternar('fora')}>
          + Fora do catálogo
        </button>
        {/* Cliente que termina aqui e pega horas em outro estúdio (ADR 0085). */}
        {lancamento.estudios.length > 0 && (
          <button type="button" className="lt-comanda-aba-fora" aria-pressed={outroEstudio} onClick={() => alternar('estudio')}>
            + Outro estúdio
          </button>
        )}
      </div>

      {outroEstudio ? (
        <div className="lt-comanda-estudio">
          <div role="group" aria-label="Estúdio" className="lt-comanda-abas">
            {lancamento.estudios.map((e) => (
              <button key={e.identificador} type="button" aria-pressed={estudio?.identificador === e.identificador}
                onClick={() => { definirEstudio(e); definirDuracao(null) }}>
                {e.nome}
              </button>
            ))}
          </div>
          {estudio !== null && (
            <div role="group" aria-label="Duração" className="lt-comanda-abas">
              {estudio.duracoes.map((d) => (
                <button key={d.minutos} type="button" aria-pressed={duracao === d.minutos} onClick={() => definirDuracao(d.minutos)}>
                  {duracaoNaTela(d.minutos)} <small>R$ {d.preco}</small>
                </button>
              ))}
            </div>
          )}
          <label>
            <span>Início</span>
            <input type="time" value={inicio} onChange={(evento) => definirInicio(evento.target.value)} />
          </label>
          <p className="lt-comanda-nota">Preço do pacote do estúdio na tabela. Depois do limite noturno, soma o acréscimo. Não marca o horário na Altegio.</p>
          <button type="submit" className="lt-comanda-lancar-botao" disabled={!pronto}>Lançar</button>
        </div>
      ) : fora ? (
        <div className="lt-comanda-fora">
          <label>
            <span>Descrição</span>
            <input type="text" value={descricao} placeholder="ex. beca americana" onChange={(evento) => definirDescricao(evento.target.value)} />
          </label>
          <span className="lt-comanda-fora-quantidade">
            <span>Quantidade</span>
            <Quantidade valor={quantidade} aoMudar={definirQuantidade} />
          </span>
          <label>
            <span>Preço</span>
            <input type="text" inputMode="decimal" value={preco} placeholder="0,00" onChange={(evento) => definirPreco(evento.target.value)} />
          </label>
          <button type="submit" className="lt-comanda-lancar-botao" disabled={!pronto}>Lançar</button>
        </div>
      ) : aba !== null && (
        <div className="lt-comanda-cartoes">
          {lancamento.catalogo.filter((item) => item.tipo === aba).map((item) => (
            escolhido?.identificador === item.identificador ? (
              <div key={item.identificador} className="lt-comanda-cartao" aria-current="true">
                <FotoDoItem nome={item.nome} />
                <span><strong>{item.nome}</strong> <small>R$ {item.preco} cada</small></span>
                <span className="lt-comanda-cartao-escolha">
                  <Quantidade valor={quantidade} aoMudar={definirQuantidade} />
                  <button type="submit" className="lt-comanda-lancar-botao">Lançar</button>
                </span>
              </div>
            ) : (
              <button
                key={item.identificador} type="button" className="lt-comanda-cartao"
                onClick={() => { definirEscolhido(item); definirQuantidade(1) }}
              >
                <FotoDoItem nome={item.nome} />
                <span>{item.nome}</span>
                <small>R$ {item.preco}</small>
              </button>
            )
          ))}
        </div>
      )}
    </form>
  )
}

// Os botões em painéis pelo que fazem. Ação que o servidor mandar e não
// estiver aqui cai em "Comanda", para nunca sumir da tela.
const PAINEIS = [
  { titulo: 'Pagamento', acoes: ['receber', 'desfazer_recebimento'] },
  { titulo: 'Comprovante', acoes: ['enviar_manychat', 'copiar', 'baixar', 'enviar'] },
  { titulo: 'Comanda', acoes: ['fechar', 'reabrir'] },
]
const AGRUPADAS = new Set(PAINEIS.flatMap((painel) => painel.acoes))
const SECUNDARIAS = new Set(['copiar', 'baixar', 'enviar', 'reabrir', 'desfazer_recebimento'])

function Detalhe({
  detalhe, aoFecharDetalhe, aoAcionar, aoAssumir, aoLancarLinha, aoLancarEstudio, aoRemoverLinha, recusa, copiada,
}: { detalhe: DetalheComanda } & Pick<PropriedadesComanda, 'aoFecharDetalhe' | 'aoAcionar' | 'aoAssumir' | 'aoLancarLinha' | 'aoLancarEstudio' | 'aoRemoverLinha' | 'recusa' | 'copiada'>) {
  const [praticado, definirPraticado] = useState<PraticadoComanda | null>(detalhe.praticado)

  return (
    <section className="lt-comanda-detalhe" aria-label={`Comanda de ${detalhe.cliente}`}>
      <div className="lt-comanda-detalhe-topo">
        <button type="button" className="lt-comanda-voltar" onClick={aoFecharDetalhe}>← Voltar para Comandas</button>
        <span className={`lt-comanda-selo lt-comanda-selo-${detalhe.status}`}>{detalhe.statusRotulo}</span>
      </div>

      <h1>Comanda {detalhe.numero}</h1>
      <p className="lt-comanda-linha">{detalhe.cliente} · {detalhe.estudio} · {detalhe.data} · {detalhe.horario}</p>

      {detalhe.assuncao !== null ? (
        <section className="lt-comanda-assuncao" aria-label="Comanda de outro atendente">
          <h2>{detalhe.assuncao.titulo}</h2>
          <p>Responsável: {detalhe.responsavel}</p>
          <p>{detalhe.assuncao.texto}</p>
          <button type="button" className="lt-comanda-principal" onClick={() => aoAssumir?.(detalhe.identificador, detalhe.versao)}>
            {detalhe.assuncao.botao}
          </button>
        </section>
      ) : (
        <>
          {detalhe.responsabilidade !== null && (
            <section className="lt-comanda-bloco" aria-label="Responsabilidade">
              <h2>Responsabilidade</h2>
              <dl>
                <div><dt>Criado por</dt><dd>{detalhe.responsabilidade.criadoPor} · imutável</dd></div>
                <div><dt>Origem da criação</dt><dd>{detalhe.responsabilidade.origem}</dd></div>
                <div><dt>Responsável atual</dt><dd>{detalhe.responsabilidade.responsavelAtual}</dd></div>
                {detalhe.responsabilidade.assumiuPosse !== '' && (
                  <div><dt>Assumiu a posse</dt><dd>{detalhe.responsabilidade.assumiuPosse}</dd></div>
                )}
              </dl>
            </section>
          )}

          {detalhe.ensaio !== null && (
            <section className="lt-comanda-bloco" aria-label="Ensaio">
              <h2>Ensaio</h2>
              <dl>
                <div><dt>Serviço contratado</dt><dd>{detalhe.ensaio.servico}</dd></div>
                <div><dt>Agendado</dt><dd>{detalhe.ensaio.agendado}</dd></div>
                <div><dt>Praticado</dt><dd>{detalhe.ensaio.praticado}</dd></div>
                <div><dt>Valor do ensaio</dt><dd>{detalhe.ensaio.valor}</dd></div>
              </dl>
              {detalhe.extensao !== null && (
                <div className="lt-comanda-extensao">
                  <h3>{detalhe.extensao.titulo}</h3>
                  <ul>{detalhe.extensao.detalhe.map((parte, indice) => <li key={indice}>{parte}</li>)}</ul>
                  {/* O mesmo dinheiro reaparece no resumo. Sem dizer isso aqui,
                      ler a tela de cima a baixo dá a impressão de cobrança dobrada. */}
                  <p><span>Total da extensão <small>entra uma vez no resumo</small></span><strong>{detalhe.extensao.total}</strong></p>
                </div>
              )}
            </section>
          )}

          <section className="lt-comanda-bloco" aria-label="Extras">
            <h2>Extras</h2>
            {/* A hora além do agendado NÃO entra aqui: ela é a Extensão, calculada
                no fechamento e mostrada no bloco do Ensaio. Dizer o contrário
                fazia procurar no lugar errado quando a conta não parecia bater. */}
            <p className="lt-comanda-nota">Fundos, equipamentos e bomboniere, como no quadro do estúdio. As horas além do agendado entram como Extensão, no bloco do Ensaio.</p>
            <div className="lt-comanda-extras-corpo">
              {detalhe.lancamento !== null && (
                <Lancar
                  lancamento={detalhe.lancamento}
                  aoLancar={(linha) => aoLancarLinha?.(detalhe, linha)}
                  aoLancarEstudio={(novo) => aoLancarEstudio?.(detalhe, novo, detalhe.lancamento!)}
                />
              )}
              <div className="lt-comanda-lancados">
                {detalhe.extras.length > 0 ? (
                  detalhe.extras.map((grupo) => (
                    <div className="lt-comanda-grupo" key={grupo.identificador}>
                      <h3>
                        <span>{grupo.titulo}</span>
                        <small>{grupo.contagem}</small>
                        <strong>{grupo.subtotal}</strong>
                      </h3>
                      <ul className="lt-comanda-extras" aria-label={`Itens lançados — ${grupo.titulo}`}>
                        {grupo.linhas.map((extra) => (
                          <li key={extra.identificador}>
                            <span className="lt-comanda-extra-nome">{extra.nome}</span>
                            <span className="lt-comanda-extra-conta">{extra.quantidade} × {extra.precoUnitario}</span>
                            <strong>{extra.total}</strong>
                            {/* A célula existe mesmo sem botão: sem ela a coluna do
                                valor desalinha na Comanda fechada, que não remove. */}
                            <span className="lt-comanda-extra-acao">
                              {extra.podeRemover && (
                                <button
                                  type="button" aria-label={`Remover ${extra.nome}`}
                                  onClick={() => aoRemoverLinha?.(detalhe, extra.identificador, grupo.tabela)}
                                >✕</button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : <p className="lt-vazio">Nada lançado nesta comanda.</p>}
              </div>
            </div>
          </section>

          {detalhe.resumo !== null && <Resumo resumo={detalhe.resumo} />}

          {detalhe.cancelamento !== null && (
            <section className="lt-comanda-cancelamento" aria-label={detalhe.cancelamento.titulo}>
              <h2>{detalhe.cancelamento.titulo}</h2>
              <p>{detalhe.cancelamento.texto}</p>
            </section>
          )}

          {detalhe.envios.length > 0 && (
            <section className="lt-comanda-bloco" aria-label="Envios">
              <h2>Envios</h2>
              <ul>{detalhe.envios.map((envio, indice) => (
                <li key={indice}>Enviado para {envio.telefone} em {envio.quando}, por {envio.por}</li>
              ))}</ul>
            </section>
          )}

          {praticado !== null && (
            <section className="lt-comanda-praticado" aria-label="Horário praticado">
              <h2>Horário praticado</h2>
              {/* Fechar congela o total a partir daqui: a extensão sai da
                  diferença entre praticado e agendado. */}
              <label>
                <span>Início</span>
                <input type="time" value={praticado.inicio} onChange={(evento) => definirPraticado({ ...praticado, inicio: evento.target.value })} />
              </label>
              <label>
                <span>Fim</span>
                <input type="time" value={praticado.fim} onChange={(evento) => definirPraticado({ ...praticado, fim: evento.target.value })} />
              </label>
            </section>
          )}

          {recusa !== null && recusa !== undefined && <p role="alert" className="lt-comanda-recusa">{recusa}</p>}

          {copiada !== null && copiada !== undefined && (
            <section className="lt-comanda-bloco" aria-label="Mensagem para o cliente" role="status">
              <h2>{copiada.naAreaDeTransferencia ? 'Mensagem copiada' : 'Copie a mensagem'}</h2>
              <p className="lt-comanda-nota">Cole na conversa do cliente no ManyChat e envie. Depois, toque em Já mandei por fora.</p>
              <textarea readOnly value={copiada.texto} rows={3} aria-label="Mensagem" onFocus={(evento) => evento.target.select()} />
            </section>
          )}

          {detalhe.acoes.length > 0 && (
            <div className="lt-comanda-acoes" role="group" aria-label="Ações da comanda">
              {PAINEIS.map((painel) => {
                const doPainel = detalhe.acoes.filter((acao) => painel.acoes.includes(acao.identificador)
                  || (painel.titulo === 'Comanda' && !AGRUPADAS.has(acao.identificador)))
                if (doPainel.length === 0) return null
                return (
                  <section key={painel.titulo} className="lt-comanda-painel" aria-label={painel.titulo}>
                    <h2>{painel.titulo}</h2>
                    {doPainel.map((acao) => (
                      <div key={acao.identificador} className="lt-comanda-acao">
                        {acao.formas !== undefined ? (
                          <div className="lt-comanda-formas" role="group" aria-label={acao.rotulo}>
                            {acao.formas.map((forma) => (
                              <button
                                key={forma.identificador}
                                type="button"
                                className="lt-comanda-principal"
                                disabled={acao.desativada}
                                onClick={() => aoAcionar?.(acao.identificador, detalhe, praticado, forma.identificador)}
                              >
                                {forma.rotulo}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={SECUNDARIAS.has(acao.identificador) ? 'lt-comanda-secundaria' : 'lt-comanda-principal'}
                            // Fechar sem horário praticado o banco recusa (LT003): a
                            // tela não oferece o toque que ela sabe que vai falhar.
                            disabled={acao.desativada || (acao.identificador === 'fechar' && praticado?.fim === '')}
                            onClick={() => aoAcionar?.(acao.identificador, detalhe, praticado)}
                          >
                            {acao.rotulo}
                          </button>
                        )}
                        {acao.motivo !== '' && <small>{acao.motivo}</small>}
                      </div>
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function Comanda({
  dados, aoSelecionarModo, aoFiltrarStatus, aoBuscar, aoAbrirComanda,
  aoFecharDetalhe, aoAcionar, aoAssumir, aoLancarLinha, aoLancarEstudio, aoRemoverLinha, recusa, copiada,
}: PropriedadesComanda) {
  const detalhe = dados.selecionada
  // O campo guarda o que foi digitado: `dados.busca` só chega com a lista nova,
  // e preso a ele o campo voltaria letras enquanto ela não vem.
  const [digitado, definirDigitado] = useState(dados.busca)

  return (
    <div className="lt-tela lt-comanda">
      <Moldura contexto={dados.titulo} sala={dados.data} turno={dados.turno} hora={dados.hora}>
        {detalhe !== null ? (
          <Detalhe
            // A `versao` na chave zera o formulário quando a Comanda muda: o
            // horário meio digitado não sobrevive a um lançamento de outra
            // pessoa, que é justamente quando ele deixou de valer.
            key={`${detalhe.identificador}-${detalhe.versao}`}
            detalhe={detalhe}
            aoFecharDetalhe={aoFecharDetalhe}
            aoAcionar={aoAcionar}
            aoAssumir={aoAssumir}
            aoLancarLinha={aoLancarLinha}
            aoLancarEstudio={aoLancarEstudio}
            aoRemoverLinha={aoRemoverLinha}
            recusa={recusa}
            copiada={copiada}
          />
        ) : (
          <section aria-label="Comandas">
            <div className="lt-comanda-cabecalho">
              <div>
                <h1>{dados.titulo}</h1>
                <p>{dados.abertas} em aberto</p>
              </div>
              <div className="lt-comanda-filtros" role="group" aria-label="Recorte das comandas">
                {dados.modos.map((modo) => (
                  <button key={modo.identificador} type="button" aria-pressed={modo.selecionado} onClick={() => aoSelecionarModo?.(modo.identificador)}>
                    {modo.rotulo}
                  </button>
                ))}
                <label className="lt-comanda-busca">
                  <span>Buscar</span>
                  <input type="search" value={digitado} placeholder="cliente ou estúdio" onChange={(evento) => { definirDigitado(evento.target.value); aoBuscar?.(evento.target.value) }} />
                </label>
              </div>
            </div>

            <div className="lt-comanda-status" role="group" aria-label="Filtrar por situação">
              {dados.filtros.map((filtro) => (
                <button key={filtro.identificador} type="button" onClick={() => aoFiltrarStatus?.(filtro.identificador)}>
                  {filtro.rotulo}
                </button>
              ))}
            </div>

            {dados.lista.length > 0 ? (
              <ul className="lt-comanda-lista" aria-label="Comandas do recorte">
                {dados.lista.map((comanda) => (
                  <li key={comanda.identificador}>
                    <button type="button" data-status={comanda.status} onClick={() => aoAbrirComanda?.(comanda.identificador)}>
                      <span className="lt-comanda-item-topo">
                        <strong>{comanda.cliente}</strong>
                        <span className={`lt-comanda-selo lt-comanda-selo-${comanda.status}`}>{comanda.statusRotulo}</span>
                      </span>
                      <span className="lt-comanda-item-meta">{comanda.estudio} · {comanda.horario} · {comanda.origem}</span>
                      <span className="lt-comanda-item-rodape">
                        <small>{comanda.numero !== '' ? comanda.numero : `Responsável: ${comanda.responsavel}`}</small>
                        <strong>{comanda.total}</strong>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="lt-vazio">{dados.vazio}</p>}
          </section>
        )}
      </Moldura>
    </div>
  )
}
