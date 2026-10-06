// "PINs de acesso" dos Ajustes: o sócio troca o PIN de um Atendente (ADR 0050).
//
// Uma pessoa por vez, na própria linha da lista. O PIN novo é digitado duas
// vezes, só aparece como bolinha e sai da memória ao cancelar, ao concluir e na
// recusa. PIN só existe para Atendente (ADR 0049): Gerente e Desenvolvedor
// entram por senha e nem aparecem aqui.
//
// As regras (sem repetição, sem sequência, nenhum dos quatro últimos) moram no banco,
// migration 0088. As duas primeiras se conferem aqui também só para avisar antes
// do segundo PIN; a terceira só o banco sabe, porque ninguém mais vê PIN nenhum.

import { useEffect, useRef, useState } from 'react'

import { fotoDaEquipe } from '../fotoDaEquipe'
import type { AvisoDeSenha } from './Ajustes'

export type PessoaComPin = { identificador: string; nome: string; papel: string; foto?: string }

const TAMANHO = 4

/** O mesmo de app.pin_problema (0088). `null` = serve; senão, o motivo. */
export function problemaDoPin(pin: string): string | null {
  if (!/^[0-9]{4}$/.test(pin)) return 'O PIN tem 4 dígitos.'
  if (/^(\d)\1{3}$/.test(pin)) return 'Todos os dígitos iguais é fácil de adivinhar. Escolha outro PIN.'
  const passos = [...pin].slice(1).map((d, i) => Number(d) - Number(pin[i]))
  if (passos.every((p) => p === 1) || passos.every((p) => p === -1)) return 'Sequência é fácil de adivinhar. Escolha outro PIN.'
  return null
}

type Etapa = 'novo' | 'repetir' | 'pronto'

const tituloDaEtapa = (etapa: Etapa) => etapa === 'novo' ? 'Digite o PIN novo' : etapa === 'repetir' ? 'Repita o PIN novo' : 'PIN trocado'

function useTrocaDePin(aoTrocar: ((pin: string) => Promise<AvisoDeSenha>) | undefined) {
  const [etapa, definirEtapa] = useState<Etapa>('novo')
  const [novo, definirNovo] = useState('')
  const [repetido, definirRepetido] = useState('')
  const [aviso, definirAviso] = useState<AvisoDeSenha | null>(null)
  const [enviando, definirEnviando] = useState(false)

  async function confirmar(pinNovo: string, pinRepetido: string) {
    if (pinNovo !== pinRepetido) {
      definirRepetido('')
      return definirAviso({ texto: 'Os dois PINs não são iguais. Repita o PIN novo.', erro: true })
    }
    if (!aoTrocar) return
    definirEnviando(true)
    const resposta = await aoTrocar(pinNovo)
    definirEnviando(false)
    // Sai da memória nos dois casos: na recusa, digita de novo desde o começo.
    definirNovo(''); definirRepetido('')
    definirEtapa(resposta.erro ? 'novo' : 'pronto')
    definirAviso(resposta)
  }

  function digitar(valor: string) {
    const limpo = valor.replace(/\D/g, '').slice(0, TAMANHO)
    definirAviso(null)
    if (etapa === 'novo') {
      definirNovo(limpo)
      if (limpo.length < TAMANHO) return
      const problema = problemaDoPin(limpo)
      if (problema) { definirNovo(''); return definirAviso({ texto: problema, erro: true }) }
      definirEtapa('repetir')
    } else if (etapa === 'repetir') {
      definirRepetido(limpo)
      if (limpo.length === TAMANHO) void confirmar(novo, limpo)
    }
  }

  function limpar() {
    definirEtapa('novo'); definirNovo(''); definirRepetido(''); definirAviso(null); definirEnviando(false)
  }

  return { etapa, atual: etapa === 'repetir' ? repetido : novo, aviso, enviando, digitar, limpar }
}

type Troca = ReturnType<typeof useTrocaDePin>

/**
 * As quatro casas, com um campo de senha de verdade por baixo: o teclado do
 * computador digita nele, o do tablet abre numérico, e o navegador não oferece
 * guardar nem completar.
 */
function CasasDoPin({ troca, rotulo }: { troca: Troca; rotulo: string }) {
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => { campo.current?.focus() }, [troca.etapa])
  return <label className={`lt-pin-casas${troca.aviso?.erro ? ' lt-pin-casas-erro' : ''}`}>
    <input ref={campo} type="password" inputMode="numeric" autoComplete="off" maxLength={TAMANHO}
      aria-label={rotulo} value={troca.atual} disabled={troca.enviando}
      onChange={(e) => troca.digitar(e.target.value)} />
    <span className="lt-pin-casas-visual" aria-hidden="true">
      {Array.from({ length: TAMANHO }, (_, i) =>
        <span key={i} className={i < troca.atual.length ? 'lt-pin-cheia' : i === troca.atual.length ? 'lt-pin-vez' : ''} />)}
    </span>
  </label>
}

function Aviso({ aviso }: { aviso: AvisoDeSenha | null }) {
  if (!aviso) return null
  return <p role={aviso.erro ? 'alert' : 'status'} className={aviso.erro ? 'lt-ajustes-recusa' : 'lt-ajustes-ok'}>{aviso.texto}</p>
}

const ORDEM: Etapa[] = ['novo', 'repetir', 'pronto']

function Linha({ pessoa, aberta, aoAbrir, aoFechar, aoTrocar }: {
  pessoa: PessoaComPin; aberta: boolean; aoAbrir: () => void; aoFechar: () => void
  aoTrocar?: (colaboradorId: string, pin: string) => Promise<AvisoDeSenha>
}) {
  const troca = useTrocaDePin(aoTrocar ? (pin) => aoTrocar(pessoa.identificador, pin) : undefined)
  const fechar = () => { troca.limpar(); aoFechar() }
  // Outra linha abriu: esta esquece o que foi digitado.
  useEffect(() => { if (!aberta) troca.limpar() }, [aberta])

  const passo = (etapa: Etapa, n: number, nome: string) => {
    const feito = troca.etapa === 'pronto' || ORDEM.indexOf(troca.etapa) > ORDEM.indexOf(etapa)
    const estado = feito ? 'feito' : troca.etapa === etapa ? 'atual' : ''
    return <li className={estado && `lt-pin-passo-${estado}`} aria-current={estado === 'atual' ? 'step' : undefined}>
      <span>{estado === 'feito' ? '✓' : n}</span>{nome}
    </li>
  }

  const foto = pessoa.foto ?? fotoDaEquipe(pessoa.nome)
  return <div className={`lt-pin-linha${aberta ? ' lt-pin-aberta' : ''}`} role="group" aria-label={pessoa.nome}>
    <div className="lt-pin-topo">
      <span className="lt-pin-foto">{foto ? <img src={foto} alt={`Foto de ${pessoa.nome}`} /> : pessoa.nome.slice(0, 1)}</span>
      <span className="lt-pin-nome"><strong>{pessoa.nome}</strong><small>{pessoa.papel}</small></span>
      <span className="lt-pin-mascara" role="img" aria-label="PIN definido"><span /><span /><span /><span /></span>
      {aberta
        ? <button type="button" className="lt-pin-link" onClick={fechar}>{troca.etapa === 'pronto' ? 'Fechar' : 'Cancelar'}</button>
        : <button type="button" className="lt-pin-trocar" aria-label={`Trocar PIN de ${pessoa.nome}`} onClick={aoAbrir}>Trocar PIN</button>}
    </div>
    {aberta && <div className="lt-pin-troca">
      <ol className="lt-pin-passos" aria-label="Passos">{passo('novo', 1, 'PIN novo')}{passo('repetir', 2, 'Repetir')}{passo('pronto', 3, 'Pronto')}</ol>
      {troca.etapa === 'pronto'
        ? <Aviso aviso={troca.aviso} />
        : <div className="lt-pin-campo">
          <CasasDoPin troca={troca} rotulo={`${tituloDaEtapa(troca.etapa)} de ${pessoa.nome}`} />
          <div>
            <strong>{tituloDaEtapa(troca.etapa)}</strong>
            <small>{troca.etapa === 'novo' ? 'Sem dígitos iguais, sem sequência, e diferente dos quatro últimos.' : 'Para conferir que não houve erro de digitação.'}</small>
          </div>
          <Aviso aviso={troca.aviso} />
        </div>}
    </div>}
  </div>
}

export function PinsDeAcesso({ pessoas, aoTrocar }: {
  pessoas: PessoaComPin[]
  aoTrocar?: (colaboradorId: string, pin: string) => Promise<AvisoDeSenha>
}) {
  const [aberta, abrir] = useState<string | null>(null)
  return <section className="lt-ajustes-card" aria-label="PINs de acesso">
    <div className="lt-ajustes-card-cabecalho"><h2>PINs de acesso</h2><span className="lt-pin-selo">Atendentes · {pessoas.length}</span></div>
    <p className="lt-ajustes-explicacao">Só Atendente entra por PIN; Gerente e Desenvolvedor entram por senha. O PIN novo vale no próximo acesso, e a troca fica no Histórico de PIN — o PIN em si ninguém vê, nem o sistema.</p>
    {pessoas.length
      ? <div className="lt-pin-lista">{pessoas.map((p) => <Linha key={p.identificador} pessoa={p} aberta={aberta === p.identificador}
        aoAbrir={() => abrir(p.identificador)} aoFechar={() => abrir(null)} aoTrocar={aoTrocar} />)}</div>
      : <p className="lt-vazio">Nenhum Atendente cadastrado.</p>}
  </section>
}
