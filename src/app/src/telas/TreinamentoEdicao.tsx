// A escrita do Treinamento, só para o Administrador (migration 0089).
//
// O editor trabalha numa cópia local do tutorial e manda a lista inteira de
// blocos no Salvar: adicionar, mudar, remover e reordenar bloco são o mesmo
// gesto, e nada vai ao banco pela metade. Cancelar descarta a cópia.
//
// Foto de bloco sobe na hora (ativo 'tutorial'), comprimida como as outras
// (ADR 0026), e só vira parte do tutorial quando ele é salvo.

import { useState } from 'react'

export type Aviso = { texto: string; erro: boolean }

export type BlocoEditavel =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'foto'; midiaId: string | null; foto?: string }

export type EdicaoTutorial = {
  versao: number
  status: 'rascunho' | 'publicado' | 'arquivado'
  categoria: string
  podeRestaurar: boolean
  blocos: BlocoEditavel[]
}

export type CategoriaGestao = {
  identificador: string
  nome: string
  descricao: string
  ativa: boolean
  versao: number
  publicados: number
}

function AvisoDaEdicao({ aviso }: { aviso: Aviso | null }) {
  if (aviso === null) return null
  return <p role={aviso.erro ? 'alert' : 'status'} className={aviso.erro ? 'lt-treinamento-recusa' : 'lt-treinamento-ok'}>{aviso.texto}</p>
}

// ------------------------------------------------------------------ ações
/** As transições do spec, e só elas: o banco recusa o resto (0089). */
const TRANSICOES: Record<EdicaoTutorial['status'], { status: EdicaoTutorial['status']; rotulo: string; principal?: boolean }[]> = {
  rascunho: [{ status: 'publicado', rotulo: 'Publicar', principal: true }],
  publicado: [{ status: 'rascunho', rotulo: 'Despublicar' }, { status: 'arquivado', rotulo: 'Arquivar' }],
  arquivado: [],
}

export function AcoesDoTutorial({ titulo, edicao, aoEditar, aoMudarStatus, aoRestaurar }: {
  titulo: string
  edicao: EdicaoTutorial
  aoEditar: () => void
  aoMudarStatus: (status: EdicaoTutorial['status']) => Promise<Aviso>
  aoRestaurar: () => Promise<Aviso>
}) {
  const [aviso, definirAviso] = useState<Aviso | null>(null)
  const [ocupado, definirOcupado] = useState(false)
  const agir = async (acao: () => Promise<Aviso>) => {
    definirOcupado(true)
    definirAviso(await acao())
    definirOcupado(false)
  }
  const arquivado = edicao.status === 'arquivado'

  return <div className="lt-treinamento-acoes" role="group" aria-label={`Ações de ${titulo}`}>
    {!arquivado && <button className="lt-treinamento-botao" type="button" disabled={ocupado} onClick={aoEditar}>Editar</button>}
    {TRANSICOES[edicao.status].map((t) => (
      <button key={t.status} className={`lt-treinamento-botao${t.principal ? ' lt-treinamento-acao' : ''}`} type="button" disabled={ocupado}
        onClick={() => void agir(() => aoMudarStatus(t.status))}>{t.rotulo}</button>
    ))}
    {!arquivado && edicao.podeRestaurar && <button className="lt-treinamento-botao" type="button" disabled={ocupado} onClick={() => void agir(aoRestaurar)}>Restaurar versão anterior</button>}
    {arquivado && <p className="lt-treinamento-nota">Arquivado não se edita.</p>}
    <AvisoDaEdicao aviso={aviso} />
  </div>
}

// ----------------------------------------------------------------- editor
export function EditorDeTutorial({ titulo: tituloInicial, edicao, categorias, aoSalvar, aoEnviarFoto, aoCancelar }: {
  titulo: string
  edicao: EdicaoTutorial
  categorias: CategoriaGestao[]
  aoSalvar: (titulo: string, categoria: string, blocos: BlocoEditavel[]) => Promise<Aviso>
  aoEnviarFoto: (arquivo: File) => Promise<{ midiaId: string; foto: string } | Aviso>
  aoCancelar: () => void
}) {
  const [titulo, definirTitulo] = useState(tituloInicial)
  const [categoria, definirCategoria] = useState(edicao.categoria)
  const [blocos, definirBlocos] = useState<BlocoEditavel[]>(edicao.blocos)
  const [aviso, definirAviso] = useState<Aviso | null>(null)
  const [ocupado, definirOcupado] = useState(false)

  // A categoria atual fica na lista mesmo desativada: o tutorial pode ficar onde está.
  const opcoes = categorias.filter((c) => c.ativa || c.identificador === edicao.categoria)

  const trocar = (i: number, bloco: BlocoEditavel) => definirBlocos((atual) => atual.map((b, j) => (j === i ? bloco : b)))
  const remover = (i: number) => definirBlocos((atual) => atual.filter((_, j) => j !== i))
  const mover = (i: number, passo: -1 | 1) => definirBlocos((atual) => {
    const j = i + passo
    if (j < 0 || j >= atual.length) return atual
    const novo = [...atual]
    ;[novo[i], novo[j]] = [novo[j], novo[i]]
    return novo
  })

  async function adicionarFoto(arquivo: File | undefined) {
    if (!arquivo) return
    definirOcupado(true)
    definirAviso(null)
    const r = await aoEnviarFoto(arquivo)
    definirOcupado(false)
    if ('erro' in r) return definirAviso(r)
    definirBlocos((atual) => [...atual, { tipo: 'foto', midiaId: r.midiaId, foto: r.foto }])
  }

  async function salvar() {
    if (titulo.trim() === '') return definirAviso({ texto: 'O tutorial precisa de título.', erro: true })
    if (blocos.some((b) => b.tipo === 'texto' && b.texto.trim() === '')) {
      return definirAviso({ texto: 'Há um bloco de texto vazio. Escreva ou remova.', erro: true })
    }
    if (blocos.some((b) => b.tipo === 'foto' && b.midiaId === null)) {
      return definirAviso({ texto: 'Há uma foto que não está mais disponível. Remova o bloco.', erro: true })
    }
    definirOcupado(true)
    const r = await aoSalvar(titulo.trim(), categoria, blocos)
    definirOcupado(false)
    definirAviso(r)
  }

  return <div className="lt-treinamento-editor" role="group" aria-label="Editar tutorial">
    <label className="lt-treinamento-campo"><span>Título</span><input value={titulo} onChange={(e) => definirTitulo(e.target.value)} /></label>
    <label className="lt-treinamento-campo"><span>Categoria</span>
      <select value={categoria} onChange={(e) => definirCategoria(e.target.value)}>
        {opcoes.map((c) => <option key={c.identificador} value={c.identificador}>{c.nome}{c.ativa ? '' : ' (desativada)'}</option>)}
      </select>
    </label>

    <ol className="lt-treinamento-editor-blocos" aria-label="Blocos">
      {blocos.map((bloco, i) => (
        <li key={i} className="lt-treinamento-editor-bloco" aria-label={`Bloco ${i + 1}`}>
          <span className="lt-treinamento-editor-numero" aria-hidden="true">{i + 1}</span>
          <div className="lt-treinamento-editor-corpo">
            {bloco.tipo === 'texto'
              ? <textarea aria-label={`Texto do bloco ${i + 1}`} rows={3} value={bloco.texto} onChange={(e) => trocar(i, { tipo: 'texto', texto: e.target.value })} />
              : bloco.foto
                ? <img src={bloco.foto} alt={`Foto do bloco ${i + 1}`} />
                : <span className="lt-treinamento-sem-foto" role="img" aria-label={`Foto do bloco ${i + 1}, indisponível`}>FOTO</span>}
          </div>
          <div className="lt-treinamento-editor-controles">
            <button type="button" aria-label={`Subir bloco ${i + 1}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
            <button type="button" aria-label={`Descer bloco ${i + 1}`} disabled={i === blocos.length - 1} onClick={() => mover(i, 1)}>↓</button>
            <button type="button" aria-label={`Remover bloco ${i + 1}`} onClick={() => remover(i)}>✕</button>
          </div>
        </li>
      ))}
    </ol>
    {blocos.length === 0 && <p className="lt-treinamento-nota">Sem blocos ainda. Publicar exige ao menos um.</p>}

    <div className="lt-treinamento-opcoes">
      <button className="lt-treinamento-botao" type="button" disabled={ocupado} onClick={() => definirBlocos((atual) => [...atual, { tipo: 'texto', texto: '' }])}>+ Texto</button>
      <label className={`lt-treinamento-botao lt-treinamento-arquivo${ocupado ? ' lt-treinamento-desativado' : ''}`}>
        + Foto
        <input type="file" accept="image/*" aria-label="Adicionar foto" disabled={ocupado} onChange={(e) => { void adicionarFoto(e.target.files?.[0]); e.target.value = '' }} />
      </label>
    </div>

    <AvisoDaEdicao aviso={aviso} />
    <div className="lt-treinamento-editor-rodape">
      <button className="lt-treinamento-botao" type="button" disabled={ocupado} onClick={aoCancelar}>Cancelar</button>
      <button className="lt-treinamento-botao lt-treinamento-acao" type="button" disabled={ocupado} onClick={() => void salvar()}>Salvar</button>
    </div>
  </div>
}

// ------------------------------------------------------------ novo tutorial
export function NovoTutorial({ categorias, aoCriar }: {
  categorias: CategoriaGestao[]
  aoCriar: (categoria: string, titulo: string) => Promise<Aviso>
}) {
  const ativas = categorias.filter((c) => c.ativa)
  const [categoria, definirCategoria] = useState(ativas[0]?.identificador ?? '')
  const [titulo, definirTitulo] = useState('')
  const [aviso, definirAviso] = useState<Aviso | null>(null)

  if (ativas.length === 0) {
    return <p className="lt-treinamento-nota">Crie uma categoria antes: todo tutorial mora numa. Use o botão Categorias.</p>
  }

  async function criar() {
    if (titulo.trim() === '') return definirAviso({ texto: 'O tutorial precisa de título.', erro: true })
    definirAviso(await aoCriar(categoria, titulo.trim()))
  }

  return <form className="lt-treinamento-editor" aria-label="Novo tutorial" onSubmit={(e) => { e.preventDefault(); void criar() }}>
    <label className="lt-treinamento-campo"><span>Categoria</span>
      <select value={categoria} onChange={(e) => definirCategoria(e.target.value)}>
        {ativas.map((c) => <option key={c.identificador} value={c.identificador}>{c.nome}</option>)}
      </select>
    </label>
    <label className="lt-treinamento-campo"><span>Título</span><input value={titulo} onChange={(e) => definirTitulo(e.target.value)} placeholder="ex.: Ligar a mesa de som" /></label>
    <p className="lt-treinamento-nota">Nasce como Rascunho: só a administração vê até publicar.</p>
    <AvisoDaEdicao aviso={aviso} />
    <div className="lt-treinamento-editor-rodape"><button className="lt-treinamento-botao lt-treinamento-acao" type="submit">Criar e editar</button></div>
  </form>
}

// --------------------------------------------------------------- categorias
function LinhaDeCategoria({ categoria, aoAlterar }: {
  categoria: CategoriaGestao
  aoAlterar: (nome: string, descricao: string, ativa: boolean) => Promise<Aviso>
}) {
  const [editando, definirEditando] = useState(false)
  const [nome, definirNome] = useState(categoria.nome)
  const [descricao, definirDescricao] = useState(categoria.descricao)
  const [aviso, definirAviso] = useState<Aviso | null>(null)

  async function salvar(ativa: boolean) {
    const r = await aoAlterar(nome.trim(), descricao.trim(), ativa)
    definirAviso(r.erro ? r : null)
    if (!r.erro) definirEditando(false)
  }

  return <li className={`lt-treinamento-cat${categoria.ativa ? '' : ' lt-treinamento-cat-inativa'}`} aria-label={categoria.nome}>
    {editando
      ? <div className="lt-treinamento-cat-edicao">
        <label className="lt-treinamento-campo"><span>Nome</span><input value={nome} onChange={(e) => definirNome(e.target.value)} /></label>
        <label className="lt-treinamento-campo"><span>Descrição</span><input value={descricao} onChange={(e) => definirDescricao(e.target.value)} /></label>
        <div className="lt-treinamento-opcoes">
          <button className="lt-treinamento-botao" type="button" onClick={() => { definirEditando(false); definirNome(categoria.nome); definirDescricao(categoria.descricao) }}>Cancelar</button>
          <button className="lt-treinamento-botao lt-treinamento-acao" type="button" onClick={() => void salvar(categoria.ativa)}>Salvar</button>
        </div>
      </div>
      : <div className="lt-treinamento-cat-linha">
        <span><strong>{categoria.nome}</strong><small>{categoria.ativa ? `${categoria.publicados} publicado(s)` : 'desativada'}{categoria.descricao ? ` · ${categoria.descricao}` : ''}</small></span>
        <div className="lt-treinamento-opcoes">
          <button className="lt-treinamento-botao" type="button" onClick={() => definirEditando(true)}>Renomear</button>
          <button className="lt-treinamento-botao" type="button" onClick={() => void salvar(!categoria.ativa)}>{categoria.ativa ? 'Desativar' : 'Reativar'}</button>
        </div>
      </div>}
    <AvisoDaEdicao aviso={aviso} />
  </li>
}

export function Categorias({ categorias, aoCriar, aoAlterar }: {
  categorias: CategoriaGestao[]
  aoCriar: (nome: string, descricao: string) => Promise<Aviso>
  aoAlterar: (categoria: CategoriaGestao, nome: string, descricao: string, ativa: boolean) => Promise<Aviso>
}) {
  const [nome, definirNome] = useState('')
  const [descricao, definirDescricao] = useState('')
  const [aviso, definirAviso] = useState<Aviso | null>(null)

  async function criar() {
    if (nome.trim() === '') return definirAviso({ texto: 'A categoria precisa de nome.', erro: true })
    const r = await aoCriar(nome.trim(), descricao.trim())
    definirAviso(r)
    if (!r.erro) { definirNome(''); definirDescricao('') }
  }

  return <div className="lt-treinamento-editor">
    {categorias.length > 0 && <ul className="lt-treinamento-cats" aria-label="Categorias">
      {categorias.map((c) => <LinhaDeCategoria key={`${c.identificador}-${c.versao}`} categoria={c}
        aoAlterar={(n, d, a) => aoAlterar(c, n, d, a)} />)}
    </ul>}
    <form className="lt-treinamento-cat-nova" aria-label="Criar uma categoria" onSubmit={(e) => { e.preventDefault(); void criar() }}>
      <label className="lt-treinamento-campo"><span>Nova categoria</span><input value={nome} onChange={(e) => definirNome(e.target.value)} placeholder="ex.: Fichas Técnicas" /></label>
      <label className="lt-treinamento-campo"><span>Descrição (opcional)</span><input value={descricao} onChange={(e) => definirDescricao(e.target.value)} /></label>
      <AvisoDaEdicao aviso={aviso} />
      <div className="lt-treinamento-editor-rodape"><button className="lt-treinamento-botao lt-treinamento-acao" type="submit">Criar categoria</button></div>
    </form>
  </div>
}
