import { useState } from 'react'

import { Moldura } from '../layout/Moldura'
import {
  AcoesDoTutorial, Categorias, EditorDeTutorial, NovoTutorial,
  type Aviso, type BlocoEditavel, type CategoriaGestao, type EdicaoTutorial,
} from './TreinamentoEdicao'

// Tutorial é texto e foto (spec/treinamento.md e ADR 0026). O mockup da Fase 3
// desenhou "materiais" de vídeo e link, com URL, que não têm coluna no schema e
// estão fora do MVP — a issue #94 decidiu que vale o spec.
//
// Catálogo de consulta, não trilha. Quem escreve é a administração (0089): para
// o Administrador a tela ganha Novo tutorial, Categorias e o editor
// (TreinamentoEdicao.tsx); para o Atendente continua só leitura.
export type BlocoTutorial =
  | { identificador: string; tipo: 'texto'; texto: string }
  | { identificador: string; tipo: 'foto'; foto?: string; descricao: string }

export type TutorialNaLista = {
  identificador: string
  titulo: string
  categoria: string
  /** "atualizado em 12/08/2026" — a data da última alteração é pedida no spec. */
  atualizado: string
  /** Passou do prazo em que um procedimento tende a mudar sem revisão (issue #149). */
  antigo: boolean
  status: string
  blocos: string
  /** O texto dos blocos, para a busca ao digitar. */
  texto: string
  /** Onde a busca achou, quando não foi no título; `marcado` é o que bateu. */
  trecho?: { texto: string; marcado: boolean }[]
}

export type CategoriaTreinamento = {
  identificador: string
  nome: string
  descricao: string | null
  /** "3 tutoriais", na capa da pasta. */
  contagem: string
  /** Primeira foto dos tutoriais da pasta; sem foto, a pasta mostra o ícone. */
  capa?: string
  tutoriais: TutorialNaLista[]
}

export type DadosTreinamento = {
  hora: string
  data: string
  turno: string
  subtitulo: string
  /** O que o servidor já filtrou. O que está sendo digitado é `digitado`. */
  busca: string
  incluirArquivados: boolean
  categorias: CategoriaTreinamento[]
  total: number
  vazioTitulo: string
  vazioDescricao: string
  selecionado: {
    identificador: string
    titulo: string
    categoria: string
    status: string
    atualizado: string
    blocos: BlocoTutorial[]
    /** Só para o Administrador: o que o editor precisa para salvar de volta. */
    edicao?: EdicaoTutorial
  } | null
  podeEditar?: boolean
  /** Só para o Administrador: todas as categorias, desativadas inclusive. */
  gestao?: CategoriaGestao[]
}

type PropriedadesTreinamento = {
  dados: DadosTreinamento
  digitado?: string
  aoDigitarBusca?: (busca: string) => void
  aoLimparBusca?: () => void
  aoAlternarArquivados?: () => void
  aoAbrirTutorial?: (identificador: string) => void
  aoFecharTutorial?: () => void
  /** Devolve o id do tutorial criado, que a tela abre já no editor. */
  aoCriarTutorial?: (categoria: string, titulo: string) => Promise<Aviso & { id?: string }>
  aoSalvarTutorial?: (tutorial: string, versao: number, categoria: string, titulo: string, blocos: BlocoEditavel[]) => Promise<Aviso>
  aoEnviarFotoDoTutorial?: (tutorial: string, arquivo: File) => Promise<{ midiaId: string; foto: string } | Aviso>
  aoMudarStatusDoTutorial?: (tutorial: string, versao: number, status: EdicaoTutorial['status']) => Promise<Aviso>
  aoRestaurarTutorial?: (tutorial: string, versao: number) => Promise<Aviso>
  aoReportarProblema?: (tutorial: string, texto: string) => Promise<Aviso>
  aoCriarCategoria?: (nome: string, descricao: string) => Promise<Aviso>
  aoAlterarCategoria?: (categoria: string, versao: number, nome: string, descricao: string, ativa: boolean) => Promise<Aviso>
  /**
   * O tutorial em edição. Mora no App porque a releitura da tela pode remontar
   * este componente — e o tutorial recém-criado tem de abrir já no editor.
   * Sem as duas props, a tela guarda sozinha (os testes do componente).
   */
  editando?: string | null
  aoDefinirEdicao?: (tutorial: string | null) => void
  /** A pasta (categoria) aberta. No App pelo mesmo motivo de `editando`. */
  pasta?: string | null
  aoAbrirPasta?: (categoria: string | null) => void
}

const semAcao = async (): Promise<Aviso> => ({ texto: 'Indisponível.', erro: true })

type FotoAmpliada = { foto: string; descricao: string }

function Bloco({ bloco, aoAmpliar }: { bloco: BlocoTutorial; aoAmpliar: (foto: FotoAmpliada) => void }) {
  if (bloco.tipo === 'texto') {
    return <p className="lt-treinamento-bloco-texto">{bloco.texto}</p>
  }
  const foto = bloco.foto
  return (
    <figure className="lt-treinamento-bloco-foto">
      {foto
        ? <button className="lt-treinamento-ampliar" type="button" aria-label={`Ampliar foto: ${bloco.descricao}`} onClick={() => aoAmpliar({ foto, descricao: bloco.descricao })}>
          <img src={foto} alt={bloco.descricao} />
        </button>
        : <span className="lt-treinamento-sem-foto" role="img" aria-label={bloco.descricao}>FOTO</span>}
    </figure>
  )
}

// Spec: "Atendente consulta e pode reportar problema". O Admin edita direto.
function Reportar({ aoEnviar }: { aoEnviar: (texto: string) => Promise<Aviso> }) {
  const [aberto, definirAberto] = useState(false)
  const [texto, definirTexto] = useState('')
  const [enviando, definirEnviando] = useState(false)
  const [aviso, definirAviso] = useState<Aviso | null>(null)

  if (aviso !== null && !aviso.erro) return <p className="lt-treinamento-ok" role="status">{aviso.texto}</p>
  if (!aberto) {
    return <button className="lt-treinamento-botao lt-treinamento-reportar" type="button" onClick={() => definirAberto(true)}>Reportar problema</button>
  }
  return (
    <form className="lt-treinamento-reporte" aria-label="Reportar problema" onSubmit={async (evento) => {
      evento.preventDefault()
      definirEnviando(true)
      definirAviso(await aoEnviar(texto))
      definirEnviando(false)
    }}>
      <label className="lt-treinamento-campo"><span>O que está errado neste tutorial?</span>
        <textarea value={texto} placeholder="Ex.: a foto ainda mostra o tripé antigo" onChange={(evento) => definirTexto(evento.target.value)} /></label>
      {aviso?.erro && <p className="lt-treinamento-recusa" role="alert">{aviso.texto}</p>}
      <div className="lt-treinamento-opcoes">
        <button className="lt-treinamento-botao" type="button" onClick={() => { definirAberto(false); definirAviso(null) }}>Cancelar</button>
        <button className="lt-treinamento-botao lt-treinamento-acao" type="submit" disabled={texto.trim() === '' || enviando}>Enviar para a administração</button>
      </div>
    </form>
  )
}

export function Treinamento({
  dados,
  digitado,
  aoDigitarBusca,
  aoLimparBusca,
  aoAlternarArquivados,
  aoAbrirTutorial,
  aoFecharTutorial,
  aoCriarTutorial,
  aoSalvarTutorial,
  aoEnviarFotoDoTutorial,
  aoMudarStatusDoTutorial,
  aoRestaurarTutorial,
  aoReportarProblema,
  aoCriarCategoria,
  aoAlterarCategoria,
  editando: editandoDoApp,
  aoDefinirEdicao,
  pasta: pastaDoApp,
  aoAbrirPasta,
}: PropriedadesTreinamento) {
  const aberto = dados.selecionado
  const busca = digitado ?? dados.busca
  const gestao = dados.gestao ?? []
  // O tutorial em edição (id) e o painel aberto. Editar não é recorte: a cópia
  // em edição não vai ao servidor até Salvar.
  const [editandoLocal, definirEditandoLocal] = useState<string | null>(null)
  const editando = editandoDoApp !== undefined ? editandoDoApp : editandoLocal
  const definirEditando = aoDefinirEdicao ?? definirEditandoLocal
  const [painel, definirPainel] = useState<'novo' | 'categorias' | null>(null)
  const [ampliada, definirAmpliada] = useState<FotoAmpliada | null>(null)
  // Uma pasta por categoria; buscando, o resultado vem de todas.
  const [pastaLocal, definirPastaLocal] = useState<string | null>(null)
  const pasta = pastaDoApp !== undefined ? pastaDoApp : pastaLocal
  const abrirPasta = aoAbrirPasta ?? definirPastaLocal
  const procurando = busca.trim() !== ''
  const pastaAberta = procurando ? undefined : dados.categorias.find((c) => c.identificador === pasta)
  const emEdicao = aberto !== null && aberto.edicao !== undefined && editando === aberto.identificador
  const fecharTutorial = () => { definirEditando(null); definirAmpliada(null); aoFecharTutorial?.() }

  return (
    <div className="lt-tela lt-treinamento">
      <div inert={aberto !== null || painel !== null}>
        <Moldura contexto="Treinamento" hora={dados.hora} turno={dados.turno}>
          <section className="lt-treinamento-pagina" aria-label="Treinamento">
            <form className="lt-treinamento-busca" aria-label="Buscar tutorial" onSubmit={(evento) => evento.preventDefault()}>
              <label className="lt-treinamento-campo"><span>Buscar</span><input type="search" value={busca} placeholder="palavra do título ou do texto" onChange={(evento) => aoDigitarBusca?.(evento.target.value)} /></label>
              <div className="lt-treinamento-opcoes">
                {busca !== '' && <button className="lt-treinamento-botao" type="button" onClick={() => aoLimparBusca?.()}>Limpar</button>}
                <button className={`lt-treinamento-botao${dados.incluirArquivados ? ' lt-treinamento-selecionado' : ''}`} type="button" aria-pressed={dados.incluirArquivados} onClick={() => aoAlternarArquivados?.()}>Incluir arquivados</button>
              </div>
            </form>

            <div className="lt-treinamento-cabecalho">
              <div>
                <h1>Treinamento</h1>
                <p className="lt-treinamento-descricao">{dados.subtitulo}</p>
              </div>
              {dados.podeEditar && <div className="lt-treinamento-opcoes">
                <button className="lt-treinamento-botao" type="button" onClick={() => definirPainel('categorias')}>Categorias</button>
                <button className="lt-treinamento-botao lt-treinamento-acao" type="button" onClick={() => definirPainel('novo')}>Novo tutorial</button>
              </div>}
            </div>

            {dados.total === 0
              ? <section className="lt-treinamento-vazio" aria-label="Nenhum tutorial"><h2>{dados.vazioTitulo}</h2><p>{dados.vazioDescricao}</p></section>
              : !procurando && pastaAberta === undefined
                ? <ul className="lt-treinamento-pastas" aria-label="Pastas">
                  {dados.categorias.map((categoria) => (
                    <li key={categoria.identificador}>
                      <button className="lt-treinamento-pasta" type="button" onClick={() => abrirPasta(categoria.identificador)}>
                        {categoria.capa
                          ? <img className="lt-treinamento-capa" src={categoria.capa} alt="" />
                          : <span className="lt-treinamento-capa lt-treinamento-capa-vazia"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></svg></span>}
                        <span className="lt-treinamento-titulo">{categoria.nome}</span>
                        {categoria.descricao !== null && categoria.descricao !== '' && <span className="lt-treinamento-pasta-descricao">{categoria.descricao}</span>}
                        <span className="lt-treinamento-meta">{categoria.contagem}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                : <>
                  {pastaAberta !== undefined && <button className="lt-treinamento-botao lt-treinamento-voltar" type="button" onClick={() => abrirPasta(null)}>← Pastas</button>}
                  {(pastaAberta !== undefined ? [pastaAberta] : dados.categorias).map((categoria) => (
                <section key={categoria.identificador} className="lt-treinamento-categoria" aria-label={categoria.nome}>
                  <h2>{categoria.nome}</h2>
                  {categoria.descricao !== null && <p className="lt-treinamento-descricao">{categoria.descricao}</p>}
                  <div className="lt-treinamento-grade">
                    {categoria.tutoriais.map((tutorial) => (
                      <button key={tutorial.identificador} className={`lt-treinamento-material${tutorial.antigo ? ' lt-treinamento-material-antigo' : ''}`} type="button" onClick={() => aoAbrirTutorial?.(tutorial.identificador)}>
                        <span className="lt-treinamento-titulo">{tutorial.titulo}</span>
                        {tutorial.trecho && <span className="lt-treinamento-trecho">…{tutorial.trecho.map((parte, i) => parte.marcado ? <mark key={i}>{parte.texto}</mark> : parte.texto)}…</span>}
                        <span className="lt-treinamento-meta">{tutorial.blocos} · {tutorial.atualizado}{tutorial.status === 'Arquivado' ? ' · arquivado' : ''}</span>
                        {tutorial.status === 'Rascunho' && <span className="lt-treinamento-rascunho">Rascunho · só a administração vê</span>}
                        {tutorial.antigo && <span className="lt-treinamento-antigo">revisar — sem atualização há mais de 6 meses</span>}
                      </button>
                    ))}
                  </div>
                </section>
                  ))}
                </>}
          </section>
        </Moldura>
      </div>

      {aberto !== null && (
        <div className="lt-treinamento-sobreposicao">
          <button className="lt-treinamento-fundo" type="button" aria-label="Fechar tutorial" onClick={fecharTutorial} />
          <section className="lt-treinamento-dialogo lt-treinamento-dialogo-leitura" role="dialog" aria-modal="true" aria-label={aberto.titulo} inert={ampliada !== null}>
            <div className="lt-treinamento-dialogo-cabecalho">
              <div className="lt-treinamento-dialogo-titulo">
                <h2>{aberto.titulo}</h2>
                <span className="lt-treinamento-tipo">{aberto.categoria}</span>
              </div>
              <button className="lt-treinamento-fechar" type="button" aria-label="Fechar" onClick={fecharTutorial}>✕</button>
            </div>
            <div className="lt-treinamento-dialogo-conteudo">
              {emEdicao && aberto.edicao
                ? <EditorDeTutorial key={`${aberto.identificador}-${aberto.edicao.versao}`}
                  titulo={aberto.titulo} edicao={aberto.edicao} categorias={gestao}
                  aoCancelar={() => definirEditando(null)}
                  aoEnviarFoto={(arquivo) => aoEnviarFotoDoTutorial?.(aberto.identificador, arquivo) ?? semAcao()}
                  aoSalvar={async (titulo, categoria, blocos) => {
                    const r = await (aoSalvarTutorial?.(aberto.identificador, aberto.edicao!.versao, categoria, titulo, blocos) ?? semAcao())
                    if (!r.erro) definirEditando(null)
                    return r
                  }} />
                : <>
                  {aberto.edicao && <AcoesDoTutorial titulo={aberto.titulo} edicao={aberto.edicao}
                    aoEditar={() => definirEditando(aberto.identificador)}
                    aoMudarStatus={(status) => aoMudarStatusDoTutorial?.(aberto.identificador, aberto.edicao!.versao, status) ?? semAcao()}
                    aoRestaurar={() => aoRestaurarTutorial?.(aberto.identificador, aberto.edicao!.versao) ?? semAcao()} />}
                  {aberto.blocos.length === 0
                    ? <p className="lt-treinamento-nota">Este tutorial ainda não tem blocos.</p>
                    : <div className="lt-treinamento-blocos">{aberto.blocos.map((bloco) => <Bloco key={bloco.identificador} bloco={bloco} aoAmpliar={definirAmpliada} />)}</div>}
                  <div className="lt-treinamento-rodape">
                    <p className="lt-treinamento-meta">{aberto.atualizado} · {aberto.status}</p>
                    {!aberto.edicao && <Reportar key={aberto.identificador} aoEnviar={(texto) => aoReportarProblema?.(aberto.identificador, texto) ?? semAcao()} />}
                  </div>
                </>}
            </div>
          </section>
        </div>
      )}

      {ampliada !== null && (
        <div className="lt-treinamento-sobreposicao lt-treinamento-foto-cheia" role="dialog" aria-modal="true" aria-label={`Foto: ${ampliada.descricao}`}>
          <button className="lt-treinamento-fundo" type="button" aria-label="Fechar foto" onClick={() => definirAmpliada(null)} />
          <img src={ampliada.foto} alt={ampliada.descricao} />
          <button className="lt-treinamento-fechar" type="button" aria-label="Fechar" onClick={() => definirAmpliada(null)}>✕</button>
        </div>
      )}

      {painel !== null && (
        <div className="lt-treinamento-sobreposicao">
          <button className="lt-treinamento-fundo" type="button" aria-label="Fechar painel" onClick={() => definirPainel(null)} />
          <section className="lt-treinamento-dialogo" role="dialog" aria-modal="true" aria-label={painel === 'novo' ? 'Novo tutorial' : 'Categorias'}>
            <div className="lt-treinamento-dialogo-cabecalho">
              <div className="lt-treinamento-dialogo-titulo"><h2>{painel === 'novo' ? 'Novo tutorial' : 'Categorias'}</h2></div>
              <button className="lt-treinamento-fechar" type="button" aria-label="Fechar" onClick={() => definirPainel(null)}>✕</button>
            </div>
            <div className="lt-treinamento-dialogo-conteudo">
              {painel === 'novo'
                ? <NovoTutorial categorias={gestao} aoCriar={async (categoria, titulo) => {
                  const r: Aviso & { id?: string } = await (aoCriarTutorial?.(categoria, titulo) ?? semAcao())
                  if (!r.erro && r.id) {
                    // O tutorial novo abre direto no editor.
                    definirPainel(null)
                    definirEditando(r.id)
                    aoAbrirTutorial?.(r.id)
                  }
                  return r
                }} />
                : <Categorias categorias={gestao}
                  aoCriar={(nome, descricao) => aoCriarCategoria?.(nome, descricao) ?? semAcao()}
                  aoAlterar={(c, nome, descricao, ativa) => aoAlterarCategoria?.(c.identificador, c.versao, nome, descricao, ativa) ?? semAcao()} />}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
