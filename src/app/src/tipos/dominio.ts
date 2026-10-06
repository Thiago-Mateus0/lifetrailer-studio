// Valores dos CHECK IN em docs/spec/schema.md; sem transições de estado.

// comanda.status
export type StatusComanda = 'aberta' | 'fechada' | 'enviada' | 'cancelada'

// achado.status
export type StatusAchado =
  | 'aguardando_foto'
  | 'em_posse'
  | 'pronto_para_doacao'
  | 'doado'
  | 'devolvido'

// colaborador.nivel_acesso
export type NivelAcesso = 'administrador' | 'desenvolvedor' | 'atendente'

// turno_definicao.turno
export type Turno = 'manha' | 'tarde_noite' | 'extra'
