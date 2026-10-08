import { useState } from 'react'
import type { NivelAcesso } from '../tipos/dominio'
import { Moldura } from '../layout/Moldura'
import { PinsDeAcesso, problemaDoPin } from './TrocaDePin'

type PessoaAjustes = { identificador: string; nome: string; papel: string; nivel: NivelAcesso; foto?: string }
type PerfilAjustes = { identificador: string; papel: string; acesso: string }
type AuditoriaAjustes = { identificador: string; alvo: string; por: string; quando: string }
type AcessoAjustes = { identificador: string; nome: string; login: string }
export type AvisoDeSenha = { texto: string; erro: boolean }
type MembroAjustes = { identificador: string; nome: string; papel: string; ativo: boolean; versao: number; souEu: boolean }

export type DadosAjustes = {
  hora: string
  turno: string
  subtitulo: string
  podeEditar: boolean
  pessoas: PessoaAjustes[]
  /** Quem entra por senha troca a própria (issue #220). */
  minhaSenha: boolean
  /** Só para o sócio: quem tem senha e pode ter a dela redefinida. */
  acessos: AcessoAjustes[]
  /** Só para o sócio (issue #216): todo mundo, inclusive quem está desativado. */
  equipe: MembroAjustes[]
  perfis: PerfilAjustes[]
  auditoria: AuditoriaAjustes[]
  rotuloPines: string
  rotuloPinesAparencia: 'normal' | 'sucesso'
  mensagemPermissao: string
  mensagemAuditoriaVazia: string
  rodape: string
}

type PropriedadesAjustes = {
  dados: DadosAjustes
  aoIrParaEntrada?: () => void
  /** Devolvem o que mostrar embaixo do botão. */
  aoTrocarMinhaSenha?: (atual: string, nova: string) => Promise<AvisoDeSenha>
  aoRedefinirSenha?: (colaboradorId: string, login: string, senha: string) => Promise<AvisoDeSenha>
  aoCadastrarColaborador?: (nome: string, nivel: string, socio: boolean, pin: string | null) => Promise<AvisoDeSenha>
  aoDefinirAtivo?: (colaboradorId: string, ativo: boolean, versao: number) => Promise<AvisoDeSenha>
  /** Um Atendente por vez; devolve o que mostrar na linha dele. */
  aoTrocarPin?: (colaboradorId: string, pin: string) => Promise<AvisoDeSenha>
}

// O que a pessoa escolhe na tela, e o que o banco guarda: sócio e gerente são
// os dois Administradores (ADR 0050).
const NIVEIS = [
  { identificador: 'atendente', rotulo: 'Atendente', nivel: 'atendente', socio: false },
  { identificador: 'gerente', rotulo: 'Gerente', nivel: 'administrador', socio: false },
  { identificador: 'socio', rotulo: 'Sócio', nivel: 'administrador', socio: true },
  { identificador: 'desenvolvedor', rotulo: 'Desenvolvedor', nivel: 'desenvolvedor', socio: false },
]

function Equipe({ equipe, aoCadastrar, aoDefinirAtivo }: { equipe: MembroAjustes[]; aoCadastrar?: PropriedadesAjustes['aoCadastrarColaborador']; aoDefinirAtivo?: PropriedadesAjustes['aoDefinirAtivo'] }) {
  const [confirmando, definirConfirmando] = useState<string | null>(null)
  const [nome, definirNome] = useState('')
  const [nivel, definirNivel] = useState('atendente')
  const [pin, definirPin] = useState('')
  const [aviso, definirAviso] = useState<AvisoDeSenha | null>(null)
  const escolhido = NIVEIS.find((n) => n.identificador === nivel)!

  async function mudar(membro: MembroAjustes, ativo: boolean) {
    definirConfirmando(null)
    if (aoDefinirAtivo) definirAviso(await aoDefinirAtivo(membro.identificador, ativo, membro.versao))
  }

  async function cadastrar() {
    if (nome.trim() === '') return definirAviso({ texto: 'Preencha o nome.', erro: true })
    const problema = escolhido.nivel === 'atendente' ? problemaDoPin(pin) : null
    if (problema) return definirAviso({ texto: problema, erro: true })
    if (!aoCadastrar) return
    const resposta = await aoCadastrar(nome.trim(), escolhido.nivel, escolhido.socio, escolhido.nivel === 'atendente' ? pin : null)
    if (!resposta.erro) { definirNome(''); definirPin('') }
    definirAviso(resposta)
  }

  return <section className="lt-ajustes-card lt-ajustes-equipe" aria-label="Equipe">
    <h2>Equipe</h2>
    <div className="lt-ajustes-membros">{equipe.map((membro) => <div key={membro.identificador} role="group" aria-label={membro.nome} className={membro.ativo ? '' : 'lt-ajustes-inativo'}>
      <span><strong>{membro.nome}</strong><small>{membro.papel}{membro.ativo ? '' : ' · desativado'}</small></span>
      {!membro.souEu && (membro.ativo
        ? confirmando === membro.identificador
          ? <span className="lt-ajustes-confirmar"><small>Perde o acesso, e os turnos futuros dessa pessoa ficam sem ninguém.</small><button type="button" onClick={() => void mudar(membro, false)}>Confirmar desativar</button><button type="button" onClick={() => definirConfirmando(null)}>Cancelar</button></span>
          : <button type="button" onClick={() => definirConfirmando(membro.identificador)}>Desativar</button>
        : <button type="button" onClick={() => void mudar(membro, true)}>Reativar</button>)}
    </div>)}</div>
    <div className="lt-ajustes-senha">
      <label><span>Nome</span><input value={nome} onChange={(e) => definirNome(e.target.value)} /></label>
      <label><span>Nível</span><select value={nivel} onChange={(e) => definirNivel(e.target.value)}>{NIVEIS.map((n) => <option key={n.identificador} value={n.identificador}>{n.rotulo}</option>)}</select></label>
      {escolhido.nivel === 'atendente' && <label><span>PIN</span><input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => definirPin(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>}
      {escolhido.nivel !== 'atendente' && <p className="lt-ajustes-explicacao">Entra por login e senha: defina em Senha de login depois de cadastrar.</p>}
      {aviso && <p role={aviso.erro ? 'alert' : 'status'} className={aviso.erro ? 'lt-ajustes-recusa' : 'lt-ajustes-ok'}>{aviso.texto}</p>}
      <div className="lt-ajustes-salvar"><button className="lt-ajustes-principal" type="button" onClick={() => void cadastrar()}>Cadastrar</button></div>
    </div>
  </section>
}

// O mesmo mínimo de app.senha_definir: conferir aqui só poupa a viagem.
const MINIMO_DA_SENHA = 12

function MinhaSenha({ aoTrocar }: { aoTrocar?: PropriedadesAjustes['aoTrocarMinhaSenha'] }) {
  const [atual, definirAtual] = useState('')
  const [nova, definirNova] = useState('')
  const [repetida, definirRepetida] = useState('')
  const [aviso, definirAviso] = useState<AvisoDeSenha | null>(null)

  async function trocar() {
    if (nova.length < MINIMO_DA_SENHA) return definirAviso({ texto: `A senha nova precisa de pelo menos ${MINIMO_DA_SENHA} caracteres.`, erro: true })
    if (nova !== repetida) return definirAviso({ texto: 'As duas senhas novas não são iguais.', erro: true })
    if (!aoTrocar) return
    const resposta = await aoTrocar(atual, nova)
    if (!resposta.erro) { definirAtual(''); definirNova(''); definirRepetida('') }
    definirAviso(resposta)
  }

  return <section className="lt-ajustes-card lt-ajustes-senha" aria-label="Minha senha">
    <h2>Minha senha</h2>
    <label><span>Senha atual</span><input type="password" autoComplete="current-password" value={atual} onChange={(e) => definirAtual(e.target.value)} /></label>
    <label><span>Senha nova</span><input type="password" autoComplete="new-password" value={nova} onChange={(e) => definirNova(e.target.value)} /></label>
    <label><span>Repita a senha nova</span><input type="password" autoComplete="new-password" value={repetida} onChange={(e) => definirRepetida(e.target.value)} /></label>
    {aviso && <p role={aviso.erro ? 'alert' : 'status'} className={aviso.erro ? 'lt-ajustes-recusa' : 'lt-ajustes-ok'}>{aviso.texto}</p>}
    <div className="lt-ajustes-salvar"><button className="lt-ajustes-principal" type="button" onClick={() => void trocar()}>Trocar senha</button></div>
  </section>
}

function SenhaDeLogin({ acessos, aoRedefinir }: { acessos: AcessoAjustes[]; aoRedefinir?: PropriedadesAjustes['aoRedefinirSenha'] }) {
  const [pessoa, definirPessoa] = useState('')
  const [login, definirLogin] = useState('')
  const [senha, definirSenha] = useState('')
  const [aviso, definirAviso] = useState<AvisoDeSenha | null>(null)

  async function redefinir() {
    if (pessoa === '' || login.trim() === '') return definirAviso({ texto: 'Escolha a pessoa e preencha o login.', erro: true })
    if (senha.length < MINIMO_DA_SENHA) return definirAviso({ texto: `A senha precisa de pelo menos ${MINIMO_DA_SENHA} caracteres.`, erro: true })
    if (!aoRedefinir) return
    const resposta = await aoRedefinir(pessoa, login.trim(), senha)
    if (!resposta.erro) definirSenha('')
    definirAviso(resposta)
  }

  return <section className="lt-ajustes-card lt-ajustes-senha" aria-label="Senha de login">
    <h2>Senha de login</h2>
    <p className="lt-ajustes-explicacao">Para quem esqueceu a senha. Passe a senha nova à pessoa, e ela troca em Minha senha.</p>
    <label><span>Pessoa</span><select value={pessoa} onChange={(e) => { definirPessoa(e.target.value); definirLogin(acessos.find((a) => a.identificador === e.target.value)?.login ?? '') }}>
      <option value="">Escolha</option>
      {acessos.map((a) => <option key={a.identificador} value={a.identificador}>{a.nome}</option>)}
    </select></label>
    <label><span>Login</span><input value={login} autoComplete="off" onChange={(e) => definirLogin(e.target.value)} /></label>
    <label><span>Senha nova</span><input type="password" autoComplete="new-password" value={senha} onChange={(e) => definirSenha(e.target.value)} /></label>
    {aviso && <p role={aviso.erro ? 'alert' : 'status'} className={aviso.erro ? 'lt-ajustes-recusa' : 'lt-ajustes-ok'}>{aviso.texto}</p>}
    <div className="lt-ajustes-salvar"><button className="lt-ajustes-principal" type="button" onClick={() => void redefinir()}>Redefinir senha</button></div>
  </section>
}

type Secao = 'equipe' | 'pins' | 'senhas' | 'perfis' | 'historico' | 'sobre'

// Traço de cada ícone, no viewBox 24 do Entrada e do Achados.
const SECOES: { id: Secao; rotulo: string; grupo: string; tracos: string[] }[] = [
  { id: 'equipe', rotulo: 'Equipe', grupo: 'Pessoas', tracos: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'] },
  { id: 'pins', rotulo: 'PINs de acesso', grupo: 'Pessoas', tracos: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'] },
  { id: 'senhas', rotulo: 'Senhas', grupo: 'Acesso', tracos: ['M7.5 11a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M10.7 12.3l9.8-9.8M17 6l3 3M14 9l2 2'] },
  { id: 'perfis', rotulo: 'Perfis e acessos', grupo: 'Acesso', tracos: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'] },
  { id: 'historico', rotulo: 'Histórico de PIN', grupo: 'Registro', tracos: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'] },
  { id: 'sobre', rotulo: 'Sobre este tablet', grupo: 'Registro', tracos: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'] },
]

// O rodapé é montado em src/api/telas/ajustes.mjs como "local · dispositivo · vX".
const ROTULOS_DO_SOBRE = ['Local', 'Dispositivo', 'Versão']

export function Ajustes({ dados, aoIrParaEntrada, aoTrocarMinhaSenha, aoRedefinirSenha, aoCadastrarColaborador, aoDefinirAtivo, aoTrocarPin }: PropriedadesAjustes) {
  const secoes = SECOES.filter((s) => s.id !== 'equipe' || dados.equipe.length > 0).filter((s) => s.id !== 'senhas' || dados.minhaSenha || dados.acessos.length > 0)
  const [escolhida, escolher] = useState<Secao>(secoes[0]?.id ?? 'pins')
  const aberta = secoes.find((s) => s.id === escolhida) ?? secoes[0]
  const grupos = [...new Set(secoes.map((s) => s.grupo))]

  function conteudo(secao: Secao) {
    switch (secao) {
      case 'equipe': return <Equipe equipe={dados.equipe} aoCadastrar={aoCadastrarColaborador} aoDefinirAtivo={aoDefinirAtivo} />
      // PIN só de Atendente (ADR 0049); o banco recusa o resto (0088).
      case 'pins': return <PinsDeAcesso pessoas={dados.pessoas.filter((p) => p.nivel === 'atendente')} aoTrocar={aoTrocarPin} />
      case 'senhas': return <div className="lt-ajustes-pilha">{dados.minhaSenha && <MinhaSenha aoTrocar={aoTrocarMinhaSenha} />}{dados.acessos.length > 0 && <SenhaDeLogin acessos={dados.acessos} aoRedefinir={aoRedefinirSenha} />}</div>
      case 'perfis': return <section className="lt-ajustes-card" aria-label="Perfis e acessos"><h2>Perfis e acessos</h2>{dados.perfis.length ? <div className="lt-ajustes-perfis">{dados.perfis.map((perfil) => <div key={perfil.identificador}><span>{perfil.papel}</span><small>{perfil.acesso}</small></div>)}</div> : <p className="lt-vazio">Nenhum perfil cadastrado.</p>}</section>
      case 'historico': return <section className="lt-ajustes-card lt-ajustes-lista" aria-label="Histórico de PIN"><h2>Histórico de PIN</h2>{dados.auditoria.length ? <div>{dados.auditoria.map((registro) => <div key={registro.identificador}><span>PIN de {registro.alvo} · por {registro.por}</span><small>{registro.quando}</small></div>)}</div> : <p className="lt-vazio">{dados.mensagemAuditoriaVazia}</p>}</section>
      case 'sobre': return <section className="lt-ajustes-card lt-ajustes-lista" aria-label="Sobre este tablet"><h2>Sobre este tablet</h2><div>{dados.rodape.split(' · ').map((valor, i) => <div key={i}><span>{ROTULOS_DO_SOBRE[i] ?? ''}</span><strong>{valor}</strong></div>)}</div></section>
    }
  }

  return <div className="lt-tela lt-ajustes">
    <Moldura contexto="Ajustes" hora={dados.hora} turno={dados.turno}>
      <section className="lt-ajustes-pagina" aria-label="Ajustes">
        {!dados.podeEditar ? <section className="lt-ajustes-restrito" aria-label="Acesso restrito"><h1>Acesso restrito</h1><p>{dados.mensagemPermissao}</p><button type="button" onClick={aoIrParaEntrada}>Ir para a entrada</button></section> : null}
        {!dados.podeEditar && dados.minhaSenha && <div className="lt-ajustes-restrito-senha"><MinhaSenha aoTrocar={aoTrocarMinhaSenha} /></div>}
        {dados.podeEditar && <div className="lt-ajustes-corpo">
          <nav className="lt-ajustes-menu" aria-label="Seções dos ajustes">
            <header><h1>Ajustes</h1><p>{dados.subtitulo}</p></header>
            {grupos.map((grupo) => <div key={grupo} className="lt-ajustes-grupo"><small>{grupo}</small>{secoes.filter((s) => s.grupo === grupo).map((s) => <button key={s.id} type="button" className={`lt-ajustes-item lt-ajustes-item-${s.id}`} aria-current={s.id === aberta.id ? 'page' : undefined} onClick={() => escolher(s.id)}>
              <span className="lt-ajustes-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{s.tracos.map((d) => <path key={d} d={d} />)}</svg></span>
              <span>{s.rotulo}</span>
            </button>)}</div>)}
          </nav>
          <div className="lt-ajustes-secao">{conteudo(aberta.id)}</div>
        </div>}
      </section>
    </Moldura>
  </div>
}
