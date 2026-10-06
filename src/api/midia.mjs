// As peças da rota de mídia (ADR 0051). O roteamento em si é do servidor.mjs,
// que é quem já tem `responder`, a sessão da requisição e a chave do aparelho.
//
// Aqui fica o que não é HTTP: o teto, o tipo aceito, a chave no storage e o
// endereço assinado que a tela devolve.
import { abrirPayload, assinarPayload } from './claim.mjs';

// ADR 0026 §3: JPEG, não WebP nem AVIF — o que precisa abrir daqui a cinco anos
// abre em JPEG.
export const MIME = 'image/jpeg';

// ADR 0026 §1: "se ainda passar de 1 MB, recusa e pede outra foto". O cliente
// comprime pra ≤400 KB; este é o teto que ele não contorna.
export const TETO_BYTES = 1024 * 1024;

// Os ativos que recebem foto hoje (ADR 0051 §7), mais `tutorial` (0089: a foto
// do bloco sobe para o tutorial, e só o Admin envia). `colaborador` está fora de
// propósito: nenhuma tela oferece trocar a foto de alguém. A autoridade é a
// função do banco; esta lista existe pra não gravar bytes por um pedido que o
// banco vai recusar.
export const ATIVOS = ['item_execucao', 'achado', 'tutorial'];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A versão do algoritmo de compressão (ADR 0026), como o cliente a declara.
// Curta e sem pontuação exótica: é procedência que vai pro banco, não texto
// livre.
export const COMPRESSAO = /^[a-z0-9.-]{1,32}$/;

// 30 minutos (ADR 0051 §5): o payload de uma tela fica aberto no quiosque entre
// gestos, e todo gesto refaz a busca. Mais curto quebra a foto de um modal
// aberto há dez minutos; mais longo é prazo sem uso.
export const ENDERECO_SEGUNDOS = 30 * 60;

// `<ano>/<mês>/<id>.jpg`. Pasta por mês porque a retenção do ADR 0023 apaga por
// competência, e um diretório por mês é a forma mais barata de "apague o que
// venceu". O mês é o de Maceió (regra global 2), não o do servidor.
export function chaveDaMidia(id, quando) {
  const [ano, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Maceio', year: 'numeric', month: '2-digit',
  }).format(quando).split('-');
  return `${ano}/${mes}/${id}.jpg`;
}

// O endereço que o `<img src>` usa. Assinado porque `<img>` não manda
// cabeçalho: nem `Authorization` (do Atendente) nem, de outro site, o cookie do
// Admin. Mesma mecânica HS256 da claim — `assinarPayload`, não uma segunda
// implementação de HMAC.
export function enderecoDaMidia(id, segredo, agora = Date.now) {
  const token = assinarPayload(
    { midia_id: id, exp: Math.floor(agora() / 1000) + ENDERECO_SEGUNDOS },
    segredo,
  );
  return `/midia/${id}?t=${token}`;
}

// O `midia_id` do token é conferido contra o id do caminho: sem isso, um token
// válido de uma foto serviria pra buscar qualquer outra.
export function enderecoConfere(id, token, segredo, agora = Date.now) {
  const aberto = abrirPayload(token, segredo);
  if (!aberto.ok) return false;

  const { midia_id: midiaId, exp } = aberto.payload;
  if (midiaId !== id) return false;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return false;
  return exp * 1000 > agora();
}

// Lê o corpo binário até o teto. Diferente do lerCorpo do servidor.mjs em duas
// coisas: não faz JSON.parse, e para de acumular no teto em vez de seguir
// lendo — o que chega aqui é foto, e foto grande demais é recusada, não guardada
// pra inspeção.
export async function lerBytes(req, teto = TETO_BYTES) {
  const partes = [];
  let bytes = 0;
  for await (const pedaco of req) {
    bytes += pedaco.length;
    if (bytes > teto) return { erro: 'foto grande demais' };
    partes.push(pedaco);
  }
  if (bytes === 0) return { erro: 'foto sem bytes' };
  return { bytes: Buffer.concat(partes) };
}

// O `content-type` sem os parâmetros (`image/jpeg; charset=...`).
export const tipoDe = (req) => (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
