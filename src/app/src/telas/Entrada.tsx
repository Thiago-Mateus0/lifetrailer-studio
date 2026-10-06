import { fotoDaEquipe } from '../fotoDaEquipe'
import { Moldura } from '../layout/Moldura'

export type PessoaEntrada = {
  identificador: string
  nome: string
  papel: string
  foto?: string
  // Há Aviso Urgente esperando a confirmação dela. Só a marca: o texto fica
  // para depois do PIN (ADR 0070 §1).
  avisoUrgente?: boolean
}

export type TeclaEntrada = {
  identificador: string
  rotulo: string
  descricao?: string
  tipo: 'numero' | 'acao'
  desativada?: boolean
}

type ExibicaoEntrada =
  | { etapa: 'quem' }
  | {
      etapa: 'pin'
      pessoa: PessoaEntrada
      situacao: 'normal' | 'incorreto' | 'bloqueado' | 'sem_turno'
      pontos: { identificador: string; preenchido: boolean }[]
      descricaoPontos: string
      mensagem: string
      teclas: TeclaEntrada[]
      dica: string
    }
  | { etapa: 'aberto'; pessoa: PessoaEntrada }

export type DadosEntrada = {
  hora: string
  logo: string
  local: string
  aparelho: string
  data: string
  pessoas: PessoaEntrada[]
  exibicao: ExibicaoEntrada
}

type PropriedadesEntrada = {
  dados: DadosEntrada
  aoEscolherPessoa?: (identificador: string) => void
  aoVoltar?: () => void
  aoTeclar?: (identificador: string) => void
  aoEntrar?: () => void
}

function FotoEntrada({ pessoa }: { pessoa: PessoaEntrada }) {
  const foto = pessoa.foto ?? fotoDaEquipe(pessoa.nome)
  return (
    <span className="lt-entrada-avatar" aria-hidden="true">
      {foto ? <img src={foto} alt="" /> : <>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span>Foto</span>
      </>}
    </span>
  )
}

export function Entrada({ dados, aoEscolherPessoa, aoVoltar, aoTeclar, aoEntrar }: PropriedadesEntrada) {
  const exibicao = dados.exibicao

  return (
    <div className="lt-entrada lt-tela">
      <Moldura contexto="Entrada" hora={dados.hora}>
        <section className="lt-entrada-pagina" aria-label="Entrada no estúdio">
          <img className="lt-entrada-logo" src={dados.logo} alt="Lifetrailer Studio" />
          <div className="lt-entrada-conteudo">
            {exibicao.etapa === 'quem' && <div className="lt-entrada-escolha">
              <h1>Quem está entrando?</h1>
              {dados.pessoas.length ? <>
                <div className="lt-entrada-pessoas" role="group" aria-label="Pessoas disponíveis">
                  {dados.pessoas.map((pessoa) => (
                    <button key={pessoa.identificador} type="button" className="lt-entrada-pessoa" aria-label={`${pessoa.nome} ${pessoa.papel}${pessoa.avisoUrgente ? ' · aviso urgente' : ''}`} onClick={() => aoEscolherPessoa?.(pessoa.identificador)}>
                      <FotoEntrada pessoa={pessoa} />
                      <span className="lt-entrada-identidade"><span>{pessoa.nome}</span><small>{pessoa.papel}</small></span>
                      {pessoa.avisoUrgente && <span className="lt-entrada-aviso-urgente">Aviso urgente</span>}
                    </button>
                  ))}
                </div>
              </> : <p className="lt-vazio">Nenhuma pessoa disponível para entrar.</p>}
            </div>}

            {exibicao.etapa === 'pin' && <div className={`lt-entrada-pin lt-entrada-pin-${exibicao.situacao}`}>
              <button type="button" className="lt-entrada-voltar" onClick={aoVoltar}>← Trocar de pessoa</button>
              <FotoEntrada pessoa={exibicao.pessoa} />
              <h1>{exibicao.pessoa.nome}</h1>
              <p className="lt-entrada-instrucao">Digite seu PIN</p>
              <div className="lt-entrada-pontos" role="img" aria-label={exibicao.descricaoPontos}>
                {exibicao.pontos.map((ponto) => <span key={ponto.identificador} className={ponto.preenchido ? 'lt-entrada-ponto-preenchido' : ''} aria-hidden="true" />)}
              </div>
              <p className="lt-entrada-mensagem" role="status">{exibicao.mensagem}</p>
              <div className="lt-entrada-teclado" role="group" aria-label="Teclado do PIN">
                {exibicao.teclas.map((tecla) => <button key={tecla.identificador} type="button" className={`lt-entrada-tecla lt-entrada-tecla-${tecla.tipo} ${tecla.identificador === 'apagar' ? 'lt-entrada-tecla-apagar' : ''}`} disabled={tecla.desativada} aria-label={tecla.descricao} onClick={() => aoTeclar?.(tecla.identificador)}>{tecla.rotulo}</button>)}
              </div>
              {exibicao.dica !== '' && <p className="lt-entrada-dica">DEMO · PIN {exibicao.dica}</p>}
            </div>}

            {exibicao.etapa === 'aberto' && <div className="lt-entrada-aberto">
              <FotoEntrada pessoa={exibicao.pessoa} />
              <div><h1>Turno aberto, {exibicao.pessoa.nome}</h1><p>Levando você para o Início…</p></div>
              <button type="button" className="lt-entrada-entrar" onClick={aoEntrar}>Entrar agora</button>
            </div>}
          </div>
          <footer className="lt-entrada-rodape">{dados.local} · {dados.aparelho} · {dados.data}</footer>
        </section>
      </Moldura>
    </div>
  )
}
