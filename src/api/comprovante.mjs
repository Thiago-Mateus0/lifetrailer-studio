// As peças da rota do comprovante (ADR 0073 §3–§4). O roteamento é do
// servidor.mjs, como o da mídia.
//
// Não há tabela de comprovante: o id é derivado do estado da Comanda no
// instante em que a Helena copia a mensagem — `<comanda>-<nº do envio>-<fechado_em>`.
// É o que faz "copiar de novo" achar o mesmo arquivo (ADR 0073 §3–§4):
//   - Fechada e Enviada logo depois do mesmo envio dão o mesmo id, porque
//     `enviar` grava o envio e o PDF daquele envio já levava o número dele;
//   - reabrir e fechar de novo muda `fechado_em`, e o valor pode ter mudado;
//   - Enviada reaberta para Fechada pede o envio seguinte.
import { abrirPayload, assinarPayload } from './claim.mjs';

export const MIME_PDF = 'application/pdf';

// Com as quatro fontes (Oswald e Barlow) e a logo embutidas (comprovante.ts),
// uma página dá perto de 500 KB. O teto é folga para mais páginas, não um alvo.
export const TETO_PDF = 2 * 1024 * 1024;

// 30 dias (ADR 0073 §3): quem confere o comprovante quando chega a fatura do
// cartão ainda abre.
export const LINK_SEGUNDOS = 30 * 24 * 60 * 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const ID_COMPROVANTE = new RegExp(`^(${UUID})-([1-9][0-9]{0,3})-([0-9]{1,12})$`);

/**
 * Qual envio o PDF desta Comanda representa. Fechada: o próximo. Enviada: o
 * último, que já saiu. `null` para o resto — Aberta não tem total congelado, e
 * Cancelada não se envia.
 */
export function envioDoComprovante(status, envios) {
  if (status === 'fechada') return envios + 1;
  if (status === 'enviada' && envios > 0) return envios;
  return null;
}

export function idDoComprovante(comandaId, envio, fechadoEm) {
  return `${comandaId.toLowerCase()}-${envio}-${Math.floor(new Date(fechadoEm).getTime() / 1000)}`;
}

// `comprovante/<ano>/<mês>/<id>.pdf`, o mês do fechamento em Maceió: a
// retenção do ADR 0023 apaga por competência, como na mídia. A chave sai do id
// sozinho, então o GET não precisa do banco.
export function chaveDoComprovante(id) {
  const partes = ID_COMPROVANTE.exec(id);
  if (partes === null) throw new Error(`comprovante: id malformado: ${id}`);
  const [ano, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Maceio', year: 'numeric', month: '2-digit',
  }).format(new Date(Number(partes[3]) * 1000)).split('-');
  return `comprovante/${ano}/${mes}/${id}.pdf`;
}

export function linkDoComprovante(id, segredo, agora = Date.now) {
  const token = assinarPayload(
    { comprovante_id: id, exp: Math.floor(agora() / 1000) + LINK_SEGUNDOS },
    segredo,
  );
  return `/comprovante/${id}?t=${token}`;
}

/**
 * `ok`, `vencido` ou `invalido`. Vencido só com assinatura boa e id certo: é o
 * único caso em que dizer "peça de novo" ajuda alguém.
 */
export function conferirLink(id, token, segredo, agora = Date.now) {
  const aberto = abrirPayload(token, segredo);
  if (!aberto.ok) return 'invalido';
  const { comprovante_id: doToken, exp } = aberto.payload;
  if (doToken !== id) return 'invalido';
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'invalido';
  return exp * 1000 > agora() ? 'ok' : 'vencido';
}

// O cliente abre no celular, fora do app: HTML curto, sem o front.
export const PAGINA_VENCIDO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link vencido — Lifetrailer Studio</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1 style="font-size: 1.25rem">Este link venceu.</h1>
<p>Peça o comprovante de novo ao estúdio.</p>
<p style="color: #666">Lifetrailer Studio</p>
</body></html>
`;
