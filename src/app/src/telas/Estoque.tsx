import { useState } from 'react'

import { fotoDoCatalogo } from '../fotoDoCatalogo'
import { Moldura } from '../layout/Moldura'

type AbaEstoque = 'conferir' | 'compra' | 'bomboniere'
type CriticidadeEstoque = 'urgente' | 'atencao' | 'normal' | 'neutro'

type FotoEstoque = {
  identificador: string
  nome: string
  foto?: string
  meta: string
}

type InsumoEstoque = FotoEstoque & {
  unidade: string
  quantidade: string
  criticidade: CriticidadeEstoque
  rotuloCriticidade?: string
  /** Só na sessão de Admin (ADR 0071). Vazio é "sem fornecedor": a sentinela não se digita. */
  fornecedor?: string
  versao?: number
  /** Só na sessão de Admin (ADR 0080): o que o "Editar" abre preenchido. */
  ficha?: FichaInsumo
}

/** Os campos do insumo que o Admin cria e edita (ADR 0080). */
export type FichaInsumo = {
  nome: string
  categoria: string
  fornecedor: string
  especificacao: string
  severidade: 'urgente' | 'atencao'
}
/** A ficha aberta: `item` nulo é "Novo insumo". */
export type FichaAberta = FichaInsumo & { item: string | null }
/** Um nome de categoria ou fornecedor sendo trocado em todos os insumos. */
export type Renomeacao = { campo: 'categoria' | 'fornecedor'; de: string; texto: string }

type GrupoEstoque = {
  identificador: string
  nome: string
  /** Só na sessão de Admin: o nome cru que o "Renomear" troca. */
  renomear?: string
  resumo: string
  insumos: InsumoEstoque[]
}

type CompraEstoque = {
  identificador: string
  nome: string
  resumo: string
  /** O pedido pronto pra colar no WhatsApp. */
  mensagem: string
  renomear?: string
  insumos: (FotoEstoque & {
    pedido: string
    quantidade: string
    conferido: string
    criticidade: CriticidadeEstoque
    rotuloCriticidade: string
  })[]
}

type BomboniereEstoque = FotoEstoque & {
  categoria: string
  preco: string
  saldo: string
  criticidade: CriticidadeEstoque
  /** Aberto: `saldo` é o alvo, e `motivo` só é exigido quando ele fica abaixo do atual. */
  ajuste?: { saldo: string; motivo: string }
}

// Contrato de apresentação: agrupamentos, quantidades, rótulos e criticidade já chegam prontos.
export type DadosEstoque = {
  contexto: string
  hora: string
  turno: string
  data: string
  titulo: string
  subtitulo: string
  aba: AbaEstoque
  abas: { identificador: AbaEstoque; rotulo: string }[]
  editando: boolean
  sincronizacao: { rotulo: string; criticidade: CriticidadeEstoque }
  resumo: { identificador: string; texto: string; criticidade: CriticidadeEstoque }[]
  colunas: { identificador: string; grupos: GrupoEstoque[] }[]
  compra: CompraEstoque[]
  bomboniere: BomboniereEstoque[]
  nota: string
  fotoAberta: FotoEstoque | null
  /** Só na sessão de Admin: os nomes que já existem, para não nascer "Atacadao" ao lado de "Atacadão". */
  fornecedores?: string[]
  categorias?: string[]
  fichaAberta?: FichaAberta | null
  renomeacao?: Renomeacao | null
}

type PropriedadesEstoque = {
  dados: DadosEstoque
  /** Recusa da última escrita da tela — a conferência ou o ledger da bomboniere. O rascunho segue aberto atrás dela. */
  recusa?: string | null
  aoSelecionarAba?: (aba: AbaEstoque) => void
  aoEditar?: () => void
  aoCancelar?: () => void
  aoConfirmar?: () => void
  aoDiminuirQuantidade?: (identificador: string) => void
  aoAumentarQuantidade?: (identificador: string) => void
  aoReporAjustar?: (identificador: string) => void
  aoDiminuirSaldo?: (identificador: string) => void
  aoAumentarSaldo?: (identificador: string) => void
  aoConfirmarAjuste?: (identificador: string) => void
  aoAlterarMotivoAjuste?: (identificador: string, motivo: string) => void
  aoAbrirFoto?: (identificador: string) => void
  aoFecharFoto?: () => void
  aoNovoInsumo?: () => void
  aoEditarInsumo?: (identificador: string) => void
  aoAlterarFicha?: (campo: keyof FichaInsumo, valor: string) => void
  aoCancelarFicha?: () => void
  aoSalvarFicha?: () => void
  aoDesativarInsumo?: () => void
  aoRenomear?: (campo: Renomeacao['campo'], de: string) => void
  aoAlterarRenomeacao?: (texto: string) => void
  aoCancelarRenomeacao?: () => void
  aoSalvarRenomeacao?: () => void
}

function Foto({ item }: { item: FotoEstoque }) {
  const foto = item.foto ?? fotoDoCatalogo(item.nome)
  return foto
    ? <img src={foto} alt={`Foto de ${item.nome}`} />
    : <span className="lt-estoque-sem-foto" role="img" aria-label={`Foto de ${item.nome} indisponível`}>FOTO</span>
}

function Miniatura({ item, aoAbrirFoto }: { item: FotoEstoque; aoAbrirFoto?: (identificador: string) => void }) {
  return <button className="lt-estoque-foto" type="button" aria-label={`Ver foto de ${item.nome}`} onClick={() => aoAbrirFoto?.(item.identificador)}><Foto item={item} /></button>
}

/**
 * Repor e ajustar são o mesmo gesto com sinais opostos, e por isso o mesmo
 * controle. Tirar do saldo é `ajuste`, e o ledger exige motivo nele — então o
 * campo aparece exatamente quando o alvo fica abaixo do saldo de hoje, e o OK
 * espera por ele. Somar é `reposicao`, que não pede nada.
 */
function Ajuste({ item, ajuste, aoDiminuirSaldo, aoAumentarSaldo, aoConfirmarAjuste, aoAlterarMotivoAjuste }: {
  item: BomboniereEstoque
  ajuste: { saldo: string; motivo: string }
} & Pick<PropriedadesEstoque, 'aoDiminuirSaldo' | 'aoAumentarSaldo' | 'aoConfirmarAjuste' | 'aoAlterarMotivoAjuste'>) {
  const exigeMotivo = Number(ajuste.saldo) < Number(item.saldo)
  const campo = `motivo-ajuste-${item.identificador}`
  return <div className="lt-estoque-ajuste" role="group" aria-label={`Ajuste de ${item.nome}`}>
    <div className="lt-estoque-ajuste-contador">
      <button type="button" aria-label={`Diminuir saldo de ${item.nome}`} onClick={() => aoDiminuirSaldo?.(item.identificador)}>−</button>
      <span>{ajuste.saldo}</span>
      <button type="button" aria-label={`Aumentar saldo de ${item.nome}`} onClick={() => aoAumentarSaldo?.(item.identificador)}>+</button>
      <button className="lt-estoque-primario" type="button" disabled={exigeMotivo && ajuste.motivo.trim() === ''} aria-label={`Confirmar ajuste de ${item.nome}`} onClick={() => aoConfirmarAjuste?.(item.identificador)}>OK</button>
    </div>
    {exigeMotivo && <>
      <label htmlFor={campo}>Por que está saindo do saldo?</label>
      <input id={campo} value={ajuste.motivo} autoComplete="off" onChange={(evento) => aoAlterarMotivoAjuste?.(item.identificador, evento.target.value)} />
    </>}
  </div>
}

type AcoesFicha = Pick<PropriedadesEstoque, 'aoAlterarFicha' | 'aoCancelarFicha' | 'aoSalvarFicha' | 'aoDesativarInsumo'>

function Ficha({ ficha, recusa, aoAlterarFicha, aoCancelarFicha, aoSalvarFicha, aoDesativarInsumo }: {
  ficha: FichaAberta
  recusa?: string | null
} & AcoesFicha) {
  // Desativar pede um segundo toque: tira o insumo da conferência e da compra.
  const [desativando, definirDesativando] = useState(false)
  const campo = (nome: keyof FichaInsumo, rotulo: string, lista?: string) => <label>
    {rotulo}
    <input value={ficha[nome]} list={lista} autoComplete="off" onChange={(evento) => aoAlterarFicha?.(nome, evento.target.value)} />
  </label>
  return <div className="lt-estoque-foto-fundo" onClick={aoCancelarFicha}>
    <dialog open className="lt-estoque-ficha" aria-label={ficha.item === null ? 'Novo insumo' : `Editar ${ficha.nome}`}
      onClick={(evento) => evento.stopPropagation()} onKeyDown={(evento) => { if (evento.key === 'Escape') aoCancelarFicha?.() }}>
      <h2>{ficha.item === null ? 'Novo insumo' : 'Editar insumo'}</h2>
      {recusa !== null && recusa !== undefined && <p role="alert" className="lt-estoque-recusa">{recusa}</p>}
      {campo('nome', 'Nome')}
      {campo('categoria', 'Categoria', 'lt-estoque-categorias')}
      <small>Categoria nova nasce com o insumo.</small>
      {campo('fornecedor', 'Fornecedor', 'lt-estoque-fornecedores')}
      {campo('especificacao', 'Como pedir (ex.: 2 fardos)')}
      <fieldset><legend>Importância na lista de compra</legend>
        {(['urgente', 'atencao'] as const).map((valor) => <button key={valor} type="button" aria-pressed={ficha.severidade === valor}
          onClick={() => aoAlterarFicha?.('severidade', valor)}>{valor === 'urgente' ? 'Urgente' : 'Atenção'}</button>)}
      </fieldset>
      <div className="lt-estoque-ficha-acoes">
        {ficha.item !== null && (desativando
          ? <button type="button" className="lt-estoque-perigo" onClick={aoDesativarInsumo}>Confirmar: desativar</button>
          : <button type="button" onClick={() => definirDesativando(true)}>Desativar</button>)}
        <button type="button" onClick={aoCancelarFicha}>Cancelar</button>
        <button className="lt-estoque-primario" type="button" disabled={ficha.nome.trim() === '' || ficha.categoria.trim() === ''} onClick={aoSalvarFicha}>Salvar</button>
      </div>
    </dialog>
  </div>
}

function Renomear({ renomeacao, lista, aoAlterarRenomeacao, aoCancelarRenomeacao, aoSalvarRenomeacao }: {
  renomeacao: Renomeacao
  lista: string
} & Pick<PropriedadesEstoque, 'aoAlterarRenomeacao' | 'aoCancelarRenomeacao' | 'aoSalvarRenomeacao'>) {
  return <div className="lt-estoque-fornecedor-edicao" role="group" aria-label={`Renomear ${renomeacao.de}`}>
    <label>Novo nome<input value={renomeacao.texto} list={lista} autoComplete="off" onChange={(evento) => aoAlterarRenomeacao?.(evento.target.value)} /></label>
    <small>Muda em todos os insumos. Um nome que já existe junta os dois grupos.</small>
    <button type="button" onClick={aoCancelarRenomeacao}>Cancelar</button>
    <button className="lt-estoque-primario" type="button" disabled={renomeacao.texto.trim() === '' || renomeacao.texto.trim() === renomeacao.de} onClick={aoSalvarRenomeacao}>Salvar</button>
  </div>
}

function CopiarLista({ fornecedor }: { fornecedor: CompraEstoque }) {
  const [copiada, definirCopiada] = useState(false)
  return <button className="lt-estoque-repor" type="button" aria-label={`Copiar lista de ${fornecedor.nome}`}
    onClick={() => { void navigator.clipboard?.writeText(fornecedor.mensagem).then(() => definirCopiada(true)) }}>
    {copiada ? 'Copiada ✓' : 'Copiar lista'}</button>
}

export function Estoque({
  dados, recusa, aoSelecionarAba, aoEditar, aoCancelar, aoConfirmar,
  aoDiminuirQuantidade, aoAumentarQuantidade,
  aoReporAjustar, aoDiminuirSaldo, aoAumentarSaldo, aoConfirmarAjuste, aoAlterarMotivoAjuste,
  aoAbrirFoto, aoFecharFoto,
  aoNovoInsumo, aoEditarInsumo, aoAlterarFicha, aoCancelarFicha, aoSalvarFicha, aoDesativarInsumo,
  aoRenomear, aoAlterarRenomeacao, aoCancelarRenomeacao, aoSalvarRenomeacao,
}: PropriedadesEstoque) {
  const admin = dados.fornecedores !== undefined
  const renomeando = (campo: Renomeacao['campo'], de: string | undefined) =>
    dados.renomeacao?.campo === campo && dados.renomeacao.de === de ? dados.renomeacao : undefined
  const renomearAcoes = { aoAlterarRenomeacao, aoCancelarRenomeacao, aoSalvarRenomeacao }
  return <div className="lt-tela lt-estoque">
    <Moldura contexto={dados.contexto} hora={dados.hora} turno={dados.turno}>
      <section className="lt-estoque-pagina" aria-label="Estoque">
        <div className="lt-estoque-contexto">
          <span>{dados.data}</span>
          <span role="status" aria-label="Sincronização do estoque" className={`lt-estoque-sincronizacao lt-estoque-${dados.sincronizacao.criticidade}`}><i aria-hidden="true" />{dados.sincronizacao.rotulo}</span>
        </div>
        <div className="lt-estoque-cabecalho">
          <div><h1>{dados.titulo}</h1><p>{dados.subtitulo}</p></div>
          <div className="lt-estoque-acoes" role="group" aria-label="Ações do estoque">
            {dados.aba === 'conferir' && (dados.editando ? <>
              <button type="button" onClick={aoCancelar}>Cancelar</button>
              <button className="lt-estoque-primario" type="button" onClick={aoConfirmar}>Confirmar</button>
            </> : <>
              {admin && <button type="button" onClick={aoNovoInsumo}>Novo insumo</button>}
              <button type="button" onClick={aoEditar}>Editar quantidades</button>
            </>)}
            <div className="lt-estoque-abas" role="group" aria-label="Visualização do estoque">
              {dados.abas.map((aba) => <button key={aba.identificador} type="button" aria-pressed={dados.aba === aba.identificador} onClick={() => aoSelecionarAba?.(aba.identificador)}>{aba.rotulo}</button>)}
            </div>
          </div>
        </div>
        {recusa !== null && recusa !== undefined && !dados.fichaAberta && <p role="alert" className="lt-estoque-recusa">{recusa}</p>}

        {dados.aba === 'conferir' && <section aria-label="Conferência de insumos">
          <div className="lt-estoque-resumo" role="group" aria-label="Resumo da conferência">
            {dados.resumo.map((item) => <span key={item.identificador} className={`lt-estoque-${item.criticidade}`}>{item.texto}</span>)}
          </div>
          {dados.colunas.length ? <div className="lt-estoque-colunas">
            {dados.colunas.map((coluna) => <div key={coluna.identificador}>
              {coluna.grupos.map((grupo) => <section key={grupo.identificador} className="lt-estoque-grupo" aria-label={`Insumos de ${grupo.nome}`}>
                <div className="lt-estoque-grupo-cabecalho"><h2>{grupo.nome}</h2><span>{grupo.resumo}</span>
                  {grupo.renomear !== undefined && !dados.editando && !renomeando('categoria', grupo.renomear) &&
                    <button className="lt-estoque-repor" type="button" aria-label={`Renomear categoria ${grupo.nome}`} onClick={() => aoRenomear?.('categoria', grupo.renomear!)}>Renomear</button>}</div>
                {renomeando('categoria', grupo.renomear) && <Renomear renomeacao={dados.renomeacao!} lista="lt-estoque-categorias" {...renomearAcoes} />}
                {grupo.insumos.length ? grupo.insumos.map((insumo) => <div key={insumo.identificador} className={`lt-estoque-insumo lt-estoque-${insumo.criticidade}`} role="group" aria-label={insumo.nome}>
                  <i className="lt-estoque-marca" aria-hidden="true" />
                  <Miniatura item={insumo} aoAbrirFoto={aoAbrirFoto} />
                  <span className="lt-estoque-identidade">{insumo.nome} <small>{insumo.unidade}</small><small className="lt-estoque-meta">{insumo.meta}</small>
                    {insumo.fornecedor !== undefined && <small className="lt-estoque-meta">{insumo.fornecedor || 'sem fornecedor'}</small>}</span>
                  {insumo.ficha !== undefined && !dados.editando &&
                    <button className="lt-estoque-repor" type="button" aria-label={`Editar ${insumo.nome}`} onClick={() => aoEditarInsumo?.(insumo.identificador)}>Editar</button>}
                  {insumo.rotuloCriticidade && <span className="lt-estoque-criticidade">{insumo.rotuloCriticidade}</span>}
                  <div className="lt-estoque-quantidade" role="group" aria-label={`Quantidade de ${insumo.nome}`}>
                    {dados.editando && <button type="button" aria-label={`Diminuir quantidade de ${insumo.nome}`} onClick={() => aoDiminuirQuantidade?.(insumo.identificador)}>−</button>}
                    <span>{insumo.quantidade}</span>
                    {dados.editando && <button type="button" aria-label={`Aumentar quantidade de ${insumo.nome}`} onClick={() => aoAumentarQuantidade?.(insumo.identificador)}>+</button>}
                  </div>
                </div>) : <p className="lt-vazio">Nenhum insumo nesta categoria.</p>}
              </section>)}
            </div>)}
          </div> : <p className="lt-vazio">Nenhum insumo para conferir.</p>}
        </section>}
        {dados.fornecedores && <datalist id="lt-estoque-fornecedores">
          {dados.fornecedores.map((nome) => <option key={nome} value={nome} />)}
        </datalist>}
        {dados.categorias && <datalist id="lt-estoque-categorias">
          {dados.categorias.map((nome) => <option key={nome} value={nome} />)}
        </datalist>}

        {dados.aba === 'compra' && <section aria-label="Compra de insumos">
          {dados.compra.length ? dados.compra.map((fornecedor) => <section key={fornecedor.identificador} className="lt-estoque-grupo" aria-label={`Compra de ${fornecedor.nome}`}>
            <div className="lt-estoque-grupo-cabecalho"><h2>{fornecedor.nome}</h2><span>{fornecedor.resumo}</span>
              <CopiarLista fornecedor={fornecedor} />
              {fornecedor.renomear !== undefined && !renomeando('fornecedor', fornecedor.renomear) &&
                <button className="lt-estoque-repor" type="button" aria-label={`Renomear fornecedor ${fornecedor.nome}`} onClick={() => aoRenomear?.('fornecedor', fornecedor.renomear!)}>Renomear</button>}</div>
            {renomeando('fornecedor', fornecedor.renomear) && <Renomear renomeacao={dados.renomeacao!} lista="lt-estoque-fornecedores" {...renomearAcoes} />}
            {fornecedor.insumos.length ? fornecedor.insumos.map((insumo) => <div key={insumo.identificador} role="group" aria-label={insumo.nome}>
              <div className={`lt-estoque-insumo lt-estoque-compra-insumo lt-estoque-${insumo.criticidade}`}>
                <i className="lt-estoque-marca" aria-hidden="true" />
                <Miniatura item={insumo} aoAbrirFoto={aoAbrirFoto} />
                <span className="lt-estoque-identidade">{insumo.nome} <span className="lt-estoque-pedido">{insumo.pedido}</span></span>
                <span className="lt-estoque-criticidade">{insumo.rotuloCriticidade}</span>
                <span className="lt-estoque-compra-quantidade">{insumo.quantidade}</span>
                <span className="lt-estoque-conferido">{insumo.conferido}</span>
              </div>
            </div>) : <p className="lt-vazio">Nenhum insumo para comprar deste fornecedor.</p>}
          </section>) : <p className="lt-vazio">Nenhum insumo para comprar.</p>}
        </section>}

        {dados.aba === 'bomboniere' && <section aria-label="Estoque da bomboniere">
          {dados.bomboniere.length ? <div className="lt-estoque-tabela"><table aria-label="Itens da bomboniere">
            <thead><tr><th scope="col">Item</th><th scope="col">Categoria</th><th scope="col">Preço</th><th scope="col">Saldo</th><th scope="col">Ações</th></tr></thead>
            <tbody>{dados.bomboniere.map((item) => <tr key={item.identificador}>
              <th scope="row"><span className="lt-estoque-bomboniere-nome"><Miniatura item={item} aoAbrirFoto={aoAbrirFoto} />{item.nome}</span></th>
              <td>{item.categoria}</td><td>{item.preco}</td><td className={`lt-estoque-${item.criticidade}`}>{item.saldo}</td>
              <td>{item.ajuste ? <Ajuste item={item} ajuste={item.ajuste} {...{ aoDiminuirSaldo, aoAumentarSaldo, aoConfirmarAjuste, aoAlterarMotivoAjuste }} /> : <button className="lt-estoque-repor" type="button" aria-label={`Repor ou ajustar ${item.nome}`} onClick={() => aoReporAjustar?.(item.identificador)}>Repor / ajustar</button>}</td>
            </tr>)}</tbody>
          </table></div> : <p className="lt-vazio">Nenhum item na bomboniere.</p>}
        </section>}
        {dados.nota && <p className="lt-estoque-nota">{dados.nota}</p>}
      </section>
    </Moldura>
    {dados.fichaAberta && <Ficha key={dados.fichaAberta.item ?? 'novo'} ficha={dados.fichaAberta} recusa={recusa} {...{ aoAlterarFicha, aoCancelarFicha, aoSalvarFicha, aoDesativarInsumo }} />}
    {dados.fotoAberta && <div className="lt-estoque-foto-fundo" onClick={aoFecharFoto}>
      <dialog open className="lt-estoque-foto-aberta" aria-label={`Foto de ${dados.fotoAberta.nome}`} onClick={(evento) => evento.stopPropagation()} onKeyDown={(evento) => { if (evento.key === 'Escape') aoFecharFoto?.() }}>
        <div className="lt-estoque-foto-ampliada"><Foto item={dados.fotoAberta} /></div>
        <div className="lt-estoque-foto-rodape"><div><strong>{dados.fotoAberta.nome}</strong><small>{dados.fotoAberta.meta}</small></div><button type="button" onClick={aoFecharFoto}>Fechar</button></div>
      </dialog>
    </div>}
  </div>
}
