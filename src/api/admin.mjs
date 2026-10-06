// O token do Administrador (ADR 0047 §4): quem é, com que perfil, até quando.
//
// Mesma mecânica HS256 da claim do Atendente — as primitivas vêm de claim.mjs,
// não copiadas — e CAMPOS diferentes de propósito. Um token não passa pelo
// verificador do outro: a claim do Atendente exige `turno_id`, que o Admin não
// tem, e este exige `tipo`, que a claim não tem. O `tipo` é conferido
// explicitamente mesmo assim: defesa que depende de um campo estar faltando por
// acidente não é defesa.
import { abrirPayload, assinarPayload } from './claim.mjs';

export const NOME_COOKIE = 'lt_admin';
export const TIPO = 'admin';

// 12 horas, e não a virada de turno: o Admin não tem turno. A regra global 9
// governa a operação do estúdio, não a sessão de quem administra (ADR 0047 §4).
export const DURACAO_SEGUNDOS = 12 * 60 * 60;

const CAMPOS = ['colaborador_id', 'perfil', 'exp', 'tipo'];

export function assinarAdmin(dados, segredo) {
  const token = { ...dados, tipo: TIPO };
  for (const campo of CAMPOS) {
    if (token[campo] === undefined || token[campo] === null) {
      throw new Error(`token de admin sem ${campo} — os campos são os do ADR 0047 §4`);
    }
  }
  return assinarPayload(token, segredo);
}

// { ok: true, admin } ou { ok: false, motivo }. Nunca levanta, pela mesma razão
// do verificar() da claim: um throw aqui viraria 500 e contaria ao cliente que
// ele achou um caminho diferente.
export function verificarAdmin(token, segredo, agora = Date.now) {
  const aberto = abrirPayload(token, segredo);
  if (!aberto.ok) return aberto;
  const admin = aberto.payload;

  for (const campo of CAMPOS) {
    if (admin[campo] === undefined || admin[campo] === null) {
      return { ok: false, motivo: 'malformada' };
    }
  }

  // Uma claim de Atendente assinada com o MESMO segredo não vira sessão de
  // Admin aqui, e é esta linha que garante isso — não o acaso de faltar campo.
  if (admin.tipo !== TIPO) return { ok: false, motivo: 'malformada' };

  // Administrador ou Desenvolvedor (ADR 0049). O perfil vem do banco
  // (app.admin_autenticar já recusa os outros), e conferir de novo custa uma linha.
  if (admin.perfil !== 'administrador' && admin.perfil !== 'desenvolvedor') {
    return { ok: false, motivo: 'malformada' };
  }

  if (typeof admin.exp !== 'number' || !Number.isFinite(admin.exp)) {
    return { ok: false, motivo: 'malformada' };
  }
  if (admin.exp * 1000 <= agora()) return { ok: false, motivo: 'expirada' };

  return { ok: true, admin };
}

// Leitura simples do cabeçalho `cookie`. O valor é base64url, então não há
// escape a desfazer — e um parser genérico aqui seria superfície sem dono.
export function lerCookie(cabecalho, nome) {
  if (typeof cabecalho !== 'string' || cabecalho === '') return null;
  for (const parte of cabecalho.split(';')) {
    const corte = parte.indexOf('=');
    if (corte === -1) continue;
    if (parte.slice(0, corte).trim() === nome) return parte.slice(corte + 1).trim();
  }
  return null;
}

// HttpOnly: o JavaScript da página nunca lê o token.
// SameSite=Strict: nenhuma requisição vinda de outro site carrega o cookie — é
//   a defesa contra CSRF sem precisar de um segundo token.
// Secure: ligado por padrão; desligar é explícito e só para dev sem TLS.
export function cookieDeSessao(token, { seguro = true, duracaoSegundos = DURACAO_SEGUNDOS } = {}) {
  const partes = [
    `${NOME_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${duracaoSegundos}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

// Max-Age=0 apaga. O valor vai vazio para não deixar o token antigo no
// histórico do navegador nem em log de proxy.
export function cookieApagado({ seguro = true } = {}) {
  const partes = [`${NOME_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}
