import { Moldura } from '../layout/Moldura'

type AcaoAviso = {
  identificador: 'leituras' | 'arquivar' | 'restaurar' | 'confirmar' | 'editar' | 'horas_extras' | 'lembretes' | 'resolver' | 'concluir'
  rotulo: string
  aparencia: 'discreta' | 'principal' | 'selecao'
}

type AvisoApresentado = {
  identificador: string
  /** A que confirmar e arquivar mandam: quem leu uma versão velha leva LT001. */
  versao: number
  /** Na aba Lembretes, os cartões são lembretes (ADR 0066), no mesmo desenho. */
  tipo: 'equipe' | 'sistema' | 'lembrete'
  titulo: string
  texto: string
  metadados: string
  destaque: boolean
  marcadores: { rotulo: string; aparencia: 'neutra' | 'urgente' | 'nao_lido' }[]
  status: { rotulo: string; aparencia: 'discreta' | 'faixa' | 'sistema' } | null
  faltam: string
  acoes: AcaoAviso[]
  leiturasAbertas: boolean
  /** O aviso em edição pela autora (ADR 0069): o que o dedo já mudou. Nulo é só leitura. */
  editando: { titulo: string; texto: string; podeSalvar: boolean } | null
  /** O que "Salvar" faz com as leituras; vazio quando o aviso não pede confirmação. */
  avisoDaEdicao: string
  leituras: string[]
}

type FormularioAviso = {
  titulo: string
  texto: string
  /** Quantas pessoas ativas cada público alcança hoje (ADR 0058). */
  publicos: { identificador: string; rotulo: string; selecionado: boolean; pessoas: number }[]
  pedeConfirmacao: boolean
  urgente: boolean
  aviso: string
  podePublicar: boolean
}

/** "Criar lembrete" (ADR 0066). A categoria sugere a antecedência; o Admin pode trocar. */
type FormularioLembrete = {
  texto: string
  /** AAAA-MM-DD, como o campo de data devolve. */
  data: string
  /** O menor dia aceito: lembrete nasce ativo, não atrasado. */
  hoje: string
  categorias: { identificador: string; rotulo: string; antecedencia: number; selecionada: boolean }[]
  /** Em dias; texto porque é o que a caixa guarda enquanto o dedo digita. */
  antecedencia: string
  aviso: string
  podeCriar: boolean
}

type CategoriaApresentada = {
  identificador: string
  versao: number
  nome: string
  antecedencia: number
  ativo: boolean
  detalhe: string
  /** A linha em edição: o que o dedo já mudou. Nula é só leitura. */
  edicao: { nome: string; antecedencia: string; podeSalvar: boolean } | null
}

/** O quadro Categorias, só do Administrador (ADR 0043: a categoria nasce aqui). */
type PainelCategorias = {
  itens: CategoriaApresentada[]
  novoNome: string
  novaAntecedencia: string
  podeCriar: boolean
  mensagemVazia: string
}

export type AcaoCategoria = 'editar' | 'salvar' | 'cancelar' | 'ativar' | 'desativar'

export type AcaoEdicaoAviso = 'salvar' | 'cancelar'

export type DadosAvisos = {
  hora: string
  iniciais: string
  subtitulo: string
  podeEscrever: boolean
  rotuloEscrever: string
  abas: { identificador: string; rotulo: string; selecionada: boolean }[]
  formulario: FormularioAviso | null
  formularioLembrete: FormularioLembrete | null
  categorias: PainelCategorias | null
  avisos: AvisoApresentado[]
  mensagemVazia: string
  rodape: string
}

type PropriedadesAvisos = {
  dados: DadosAvisos
  /** A recusa da última escrita (publicar, confirmar, arquivar), em português de balcão. */
  recusa?: string | null
  aoSelecionarAba?: (identificador: string) => void
  aoAlternarEscrita?: () => void
  aoAlterarTitulo?: (titulo: string) => void
  aoAlterarTexto?: (texto: string) => void
  aoSelecionarPublico?: (identificador: string) => void
  aoAlternarConfirmacao?: () => void
  aoAlternarUrgencia?: () => void
  aoPublicar?: () => void
  aoAcionarAviso?: (identificador: string, acao: AcaoAviso['identificador']) => void
  aoAlterarEdicaoAviso?: (mudanca: { titulo?: string; texto?: string }) => void
  aoAcionarEdicaoAviso?: (identificador: string, acao: AcaoEdicaoAviso) => void
  aoAlterarLembrete?: (mudanca: { texto?: string; data?: string; categoria?: string; antecedencia?: string }) => void
  aoCriarLembrete?: () => void
  aoAlterarNovaCategoria?: (mudanca: { nome?: string; antecedencia?: string }) => void
  aoCriarCategoria?: () => void
  aoAlterarEdicaoCategoria?: (mudanca: { nome?: string; antecedencia?: string }) => void
  aoAcionarCategoria?: (identificador: string, acao: AcaoCategoria) => void
}

/** Só dígitos: antecedência é número inteiro de dias. */
const soDigitos = (valor: string) => valor.replace(/\D/g, '').slice(0, 3)


export function Avisos({
  dados, recusa = null, aoSelecionarAba, aoAlternarEscrita, aoAlterarTitulo, aoAlterarTexto,
  aoSelecionarPublico, aoAlternarConfirmacao, aoAlternarUrgencia,
  aoPublicar, aoAcionarAviso, aoAlterarEdicaoAviso, aoAcionarEdicaoAviso, aoAlterarLembrete, aoCriarLembrete, aoAlterarNovaCategoria,
  aoCriarCategoria, aoAlterarEdicaoCategoria, aoAcionarCategoria,
}: PropriedadesAvisos) {
  const formulario = dados.formulario
  const lembrete = dados.formularioLembrete
  const categorias = dados.categorias
  const escrevendo = formulario !== null || lembrete !== null

  return (
    <div className="lt-tela lt-avisos">
      <Moldura contexto="Avisos" hora={dados.hora} turno={dados.iniciais}>
        <section className="lt-avisos-pagina" aria-label="Avisos">
          <div className="lt-avisos-cabecalho">
            <div><h1>Avisos</h1><p className="lt-avisos-subtitulo">{dados.subtitulo}</p></div>
            <div className="lt-avisos-controles" role="group" aria-label="Controles dos avisos">
              {dados.podeEscrever && <>
                <button type="button" className={escrevendo ? 'lt-avisos-selecao' : 'lt-avisos-principal'} aria-expanded={escrevendo} onClick={aoAlternarEscrita}>{dados.rotuloEscrever}</button>
                <span className="lt-avisos-divisor" aria-hidden="true" />
              </>}
              <div className="lt-avisos-abas" role="group" aria-label="Abas dos avisos">
                {dados.abas.map((aba) => <button key={aba.identificador} type="button" aria-pressed={aba.selecionada} onClick={() => aoSelecionarAba?.(aba.identificador)}>{aba.rotulo}</button>)}
              </div>
            </div>
          </div>

          {recusa !== null && <p role="alert" className="lt-avisos-recusa">{recusa}</p>}

          {formulario && <form className="lt-avisos-formulario" aria-label="Escrever aviso" onSubmit={(evento) => { evento.preventDefault(); if (formulario.podePublicar) aoPublicar?.() }}>
            <h2>Escrever aviso</h2>
            <div className="lt-avisos-campos">
              <label>Título<input type="text" value={formulario.titulo} onChange={(evento) => aoAlterarTitulo?.(evento.target.value)} placeholder="uma linha, direto ao ponto" /></label>
              <label>Texto<textarea rows={3} value={formulario.texto} onChange={(evento) => aoAlterarTexto?.(evento.target.value)} placeholder="o que muda, a partir de quando" /></label>
              <fieldset><legend>Para quem</legend><div className="lt-avisos-opcoes">
                {formulario.publicos.map((publico) => <button key={publico.identificador} type="button" aria-pressed={publico.selecionado} onClick={() => aoSelecionarPublico?.(publico.identificador)}>{publico.rotulo}</button>)}
              </div></fieldset>
              <div className="lt-avisos-opcoes lt-avisos-preferencias" role="group" aria-label="Opções do aviso">
                <button type="button" aria-pressed={formulario.pedeConfirmacao} onClick={aoAlternarConfirmacao}>Pedir confirmação de leitura</button>
                <button type="button" className="lt-avisos-urgencia" aria-pressed={formulario.urgente} onClick={aoAlternarUrgencia}>Marcar como urgente</button>
              </div>
              <div className="lt-avisos-publicacao">
                <p className="lt-avisos-orientacao">{formulario.aviso}</p>
                <div className="lt-avisos-acoes" role="group" aria-label="Publicação do aviso">
                  <button type="button" onClick={aoAlternarEscrita}>Cancelar</button>
                  <button type="submit" className="lt-avisos-principal" disabled={!formulario.podePublicar}>Publicar</button>
                </div>
              </div>
            </div>
          </form>}

          {lembrete && <form className="lt-avisos-formulario" aria-label="Criar lembrete" onSubmit={(evento) => { evento.preventDefault(); if (lembrete.podeCriar) aoCriarLembrete?.() }}>
            <h2>Criar lembrete</h2>
            <div className="lt-avisos-campos">
              <label>O que lembrar<textarea rows={2} value={lembrete.texto} onChange={(evento) => aoAlterarLembrete?.({ texto: evento.target.value })} placeholder="a primeira linha é o que a lista mostra" /></label>
              <label>Data<input type="date" min={lembrete.hoje} value={lembrete.data} onChange={(evento) => aoAlterarLembrete?.({ data: evento.target.value })} /></label>
              <fieldset><legend>Categoria</legend>
                {lembrete.categorias.length
                  ? <div className="lt-avisos-opcoes">{lembrete.categorias.map((categoria) => <button key={categoria.identificador} type="button" aria-pressed={categoria.selecionada} onClick={() => aoAlterarLembrete?.({ categoria: categoria.identificador })}>{categoria.rotulo}</button>)}</div>
                  : <p className="lt-vazio">Nenhuma categoria ativa. Crie uma no quadro Categorias, abaixo.</p>}
              </fieldset>
              <label>Avisar quantos dias antes<input type="text" inputMode="numeric" value={lembrete.antecedencia} onChange={(evento) => aoAlterarLembrete?.({ antecedencia: soDigitos(evento.target.value) })} placeholder="vem da categoria" /></label>
              <div className="lt-avisos-publicacao">
                <p className="lt-avisos-orientacao">{lembrete.aviso}</p>
                <div className="lt-avisos-acoes" role="group" aria-label="Criação do lembrete">
                  <button type="button" onClick={aoAlternarEscrita}>Cancelar</button>
                  <button type="submit" className="lt-avisos-principal" disabled={!lembrete.podeCriar}>Criar</button>
                </div>
              </div>
            </div>
          </form>}

          {categorias && <section className="lt-avisos-formulario lt-avisos-categorias" aria-label="Categorias de lembrete">
            <h2>Categorias</h2>
            <div className="lt-avisos-campos">
              {categorias.itens.length ? <ul className="lt-avisos-categorias-lista">
                {categorias.itens.map((categoria) => <li key={categoria.identificador} aria-label={categoria.nome}>
                  {categoria.edicao
                    ? <>
                        <input type="text" aria-label={`Nome de ${categoria.nome}`} value={categoria.edicao.nome} onChange={(evento) => aoAlterarEdicaoCategoria?.({ nome: evento.target.value })} />
                        <input type="text" inputMode="numeric" aria-label={`Dias antes de ${categoria.nome}`} value={categoria.edicao.antecedencia} onChange={(evento) => aoAlterarEdicaoCategoria?.({ antecedencia: soDigitos(evento.target.value) })} />
                        <div className="lt-avisos-acoes" role="group" aria-label={`Edição de ${categoria.nome}`}>
                          <button type="button" onClick={() => aoAcionarCategoria?.(categoria.identificador, 'cancelar')}>Cancelar</button>
                          <button type="button" className="lt-avisos-principal" disabled={!categoria.edicao.podeSalvar} onClick={() => aoAcionarCategoria?.(categoria.identificador, 'salvar')}>Salvar</button>
                        </div>
                      </>
                    : <>
                        <span className="lt-avisos-categoria-nome"><strong>{categoria.nome}</strong><small>{categoria.detalhe}</small></span>
                        <div className="lt-avisos-acoes" role="group" aria-label={`Ações de ${categoria.nome}`}>
                          <button type="button" className="lt-avisos-discreta" onClick={() => aoAcionarCategoria?.(categoria.identificador, 'editar')}>Editar</button>
                          <button type="button" className="lt-avisos-discreta" onClick={() => aoAcionarCategoria?.(categoria.identificador, categoria.ativo ? 'desativar' : 'ativar')}>{categoria.ativo ? 'Desativar' : 'Reativar'}</button>
                        </div>
                      </>}
                </li>)}
              </ul> : <p className="lt-vazio">{categorias.mensagemVazia}</p>}
              <div className="lt-avisos-nova-categoria" role="group" aria-label="Nova categoria">
                <input type="text" aria-label="Nome da nova categoria" value={categorias.novoNome} onChange={(evento) => aoAlterarNovaCategoria?.({ nome: evento.target.value })} placeholder="nome da categoria" />
                <input type="text" inputMode="numeric" aria-label="Dias antes da nova categoria" value={categorias.novaAntecedencia} onChange={(evento) => aoAlterarNovaCategoria?.({ antecedencia: soDigitos(evento.target.value) })} placeholder="dias antes" />
                <button type="button" className="lt-avisos-principal" disabled={!categorias.podeCriar} onClick={aoCriarCategoria}>Criar categoria</button>
              </div>
            </div>
          </section>}

          <section className="lt-avisos-lista" aria-label="Lista de avisos">
            {dados.avisos.length ? dados.avisos.map((aviso) => <article key={aviso.identificador} aria-label={aviso.titulo} className={`lt-avisos-cartao lt-avisos-${aviso.tipo} ${aviso.destaque ? 'lt-avisos-destaque' : ''}`}>
              <div className="lt-avisos-corpo">
                <span className="lt-avisos-marca" aria-hidden="true" />
                <div className="lt-avisos-conteudo">
                  <div className="lt-avisos-titulo">
                    {aviso.marcadores.map((marcador) => <span key={marcador.rotulo} className={`lt-avisos-marcador lt-avisos-marcador-${marcador.aparencia}`}>{marcador.rotulo}</span>)}
                    <h2>{aviso.titulo}</h2>
                  </div>
                  {aviso.editando
                    ? <form className="lt-avisos-edicao" aria-label={`Editar ${aviso.titulo}`} onSubmit={(evento) => { evento.preventDefault(); if (aviso.editando?.podeSalvar) aoAcionarEdicaoAviso?.(aviso.identificador, 'salvar') }}>
                        <label>Título<input type="text" value={aviso.editando.titulo} onChange={(evento) => aoAlterarEdicaoAviso?.({ titulo: evento.target.value })} /></label>
                        <label>Texto<textarea rows={3} value={aviso.editando.texto} onChange={(evento) => aoAlterarEdicaoAviso?.({ texto: evento.target.value })} /></label>
                        <div className="lt-avisos-publicacao">
                          <p className="lt-avisos-orientacao">{aviso.avisoDaEdicao}</p>
                          <div className="lt-avisos-acoes" role="group" aria-label={`Edição de ${aviso.titulo}`}>
                            <button type="button" onClick={() => aoAcionarEdicaoAviso?.(aviso.identificador, 'cancelar')}>Cancelar</button>
                            <button type="submit" className="lt-avisos-principal" disabled={!aviso.editando.podeSalvar}>Salvar</button>
                          </div>
                        </div>
                      </form>
                    : <p className="lt-avisos-texto">{aviso.texto}</p>}
                  <p className="lt-avisos-metadados">{aviso.metadados}</p>
                  {aviso.faltam && <p className="lt-avisos-faltam">{aviso.faltam}</p>}
                </div>
                <div className="lt-avisos-lateral">
                  {aviso.status && <span role="status" aria-label={`Situação de ${aviso.titulo}`} className={`lt-avisos-status lt-avisos-status-${aviso.status.aparencia}`}>{aviso.status.rotulo}</span>}
                  {aviso.acoes.length > 0 && aviso.editando === null && <div className="lt-avisos-acoes" role="group" aria-label={`Ações de ${aviso.titulo}`}>
                    {aviso.acoes.map((acao) => <button key={acao.identificador} type="button" className={`lt-avisos-${acao.aparencia}`} aria-expanded={acao.identificador === 'leituras' ? aviso.leiturasAbertas : undefined} onClick={() => aoAcionarAviso?.(aviso.identificador, acao.identificador)}>{acao.rotulo}</button>)}
                  </div>}
                </div>
              </div>
              {aviso.leiturasAbertas && <ul className="lt-avisos-leituras" aria-label={`Leituras de ${aviso.titulo}`}>
                {aviso.leituras.map((leitura) => <li key={leitura}>{leitura}</li>)}
              </ul>}
            </article>) : <p className="lt-vazio">{dados.mensagemVazia}</p>}
          </section>
          <p className="lt-avisos-rodape">{dados.rodape}</p>
        </section>
      </Moldura>
    </div>
  )
}
