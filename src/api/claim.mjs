// A claim assinada do ADR 0020 §2: quem age, com que perfil, em que turno, e
// até quando. Assinar é do Node; QUEM É quem responde é o banco, em
// app.sessao_abrir (0034) — ver o ⚠ no topo daquela migration.
//
// HS256 com node:crypto. O formato é o do JWT compacto porque é o que a próxima
// pessoa reconhece, mas isto não é um verificador de JWT: aceita UM algoritmo, e
// o campo `alg` que vem no token nunca escolhe nada. Ler `alg` do próprio token
// para decidir como verificá-lo é a falha clássica (`alg: none`), e a defesa não
// é uma lista de algoritmos permitidos — é não perguntar.
import { createHmac, timingSafeEqual } from 'node:crypto';

const paraB64url = (bruto) => Buffer.from(bruto).toString('base64url');

// Cabeçalho constante: não é lido na verificação, existe pro token ser
// reconhecível por quem abrir o DevTools.
const CABECALHO = paraB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

// `dispositivo_id` (ADR 0048): a claim vale só no aparelho que conferiu o PIN.
// Sem ele, uma claim copiada do tablet servia de qualquer lugar até a virada.
const CAMPOS = ['colaborador_id', 'perfil', 'turno_id', 'exp', 'origem_claim', 'dispositivo_id'];

const assinatura = (material, segredo) =>
  paraB64url(createHmac('sha256', segredo).update(material).digest());

// ---------------------------------------------------------------- primitivas
// Exportadas porque o token do Admin (ADR 0047 §4) usa exatamente a mesma
// mecânica e só muda os CAMPOS exigidos. Duas implementações da comparação em
// tempo constante seria uma que alguém corrige e outra que fica para trás.
export function assinarPayload(payload, segredo) {
  const material = `${CABECALHO}.${paraB64url(JSON.stringify(payload))}`;
  return `${material}.${assinatura(material, segredo)}`;
}

// Confere a assinatura e devolve o payload cru, sem opinião sobre os campos —
// quem sabe quais campos exigir é quem chama. { ok: false, motivo } nunca levanta.
export function abrirPayload(token, segredo) {
  if (typeof token !== 'string') return { ok: false, motivo: 'ausente' };

  const partes = token.split('.');
  if (partes.length !== 3) return { ok: false, motivo: 'malformada' };

  const material = `${partes[0]}.${partes[1]}`;
  const esperada = Buffer.from(assinatura(material, segredo), 'utf8');
  const recebida = Buffer.from(partes[2], 'utf8');

  // timingSafeEqual exige o mesmo tamanho; tamanho diferente já é assinatura
  // errada, e comparar antes evita o throw.
  if (recebida.length !== esperada.length) return { ok: false, motivo: 'assinatura' };
  if (!timingSafeEqual(recebida, esperada)) return { ok: false, motivo: 'assinatura' };

  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (payload === null || typeof payload !== 'object') {
      return { ok: false, motivo: 'malformada' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, motivo: 'malformada' };
  }
}

export function assinar(claim, segredo) {
  for (const campo of CAMPOS) {
    if (claim[campo] === undefined || claim[campo] === null) {
      throw new Error(`claim sem ${campo} — os campos são os do ADR 0020 §2`);
    }
  }
  return assinarPayload(claim, segredo);
}

// Devolve { ok: true, claim } ou { ok: false, motivo }. Nunca levanta: a
// resposta a uma claim ruim é 401, e um throw aqui viraria 500 — que conta ao
// cliente que ele achou um caminho diferente.
export function verificar(token, segredo, agora = Date.now) {
  const aberto = abrirPayload(token, segredo);
  if (!aberto.ok) return aberto;
  const claim = aberto.payload;

  for (const campo of CAMPOS) {
    if (claim[campo] === undefined || claim[campo] === null) {
      return { ok: false, motivo: 'malformada' };
    }
  }

  // `exp` é a virada de turno seguinte, em segundos (ADR 0020 §2 — a mesma
  // fronteira da regra global 9, não um TTL com relógio próprio).
  if (typeof claim.exp !== 'number' || !Number.isFinite(claim.exp)) {
    return { ok: false, motivo: 'malformada' };
  }
  if (claim.exp * 1000 <= agora()) return { ok: false, motivo: 'expirada' };

  // O ADR 0020 §3 exige que a escrita saiba se o servidor conferiu o PIN agora
  // ou se confiou no lote da manhã. Valor fora dos dois é claim forjada por
  // quem tem o segredo — ou bug nosso; nenhum dos dois vira 'online' calado.
  if (claim.origem_claim !== 'online' && claim.origem_claim !== 'lote_offline') {
    return { ok: false, motivo: 'malformada' };
  }

  return { ok: true, claim };
}
