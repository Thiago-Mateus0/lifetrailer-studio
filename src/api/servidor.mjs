// O roteador do lado-app: /tela/<nome>, /sessao e /rpc/<nome> (ADR 0042).
//
// Não é um segundo serviço. É montado no mesmo servidor HTTP do receptor do
// webhook (ADR 0042 §1), que é quem já mantém o pool e já carrega os segredos
// LT_*. Este módulo não abre porta nenhuma: devolve um manipulador.
//
// ⚠ O que este arquivo NÃO decide, porque o ADR 0042 deixou aberto: formato de
// erro e paginação. O `{ erro }` abaixo é o mínimo pro front distinguir os
// casos, não um contrato assumido.
import { randomUUID } from 'node:crypto';

import { ipDe } from '../webhook/servidor.mjs';
import {
  cookieApagado, cookieDeSessao, DURACAO_SEGUNDOS, lerCookie, NOME_COOKIE, verificarAdmin,
} from './admin.mjs';
import { verificar } from './claim.mjs';
import {
  chaveDoComprovante, conferirLink, envioDoComprovante, ID_COMPROVANTE, idDoComprovante,
  linkDoComprovante, MIME_PDF, PAGINA_VENCIDO, TETO_PDF,
} from './comprovante.mjs';
import { soDigitos } from './manychat.mjs';
import {
  ATIVOS, COMPRESSAO, chaveDaMidia, enderecoConfere, enderecoDaMidia, lerBytes, MIME, tipoDe, UUID,
} from './midia.mjs';
import { montarArgumentos, RPCS } from './rpcs.mjs';
import { origemDoPerfil } from './telas/formato.mjs';

const CORPO_MAX = 64 * 1024;

// A chave do tablet viaja neste cabeçalho (ADR 0048). Cabeçalho e não cookie
// pela mesma razão da claim (ADR 0042 §4): quem monta a requisição é o app, e
// cookie iria junto de qualquer página aberta no mesmo navegador.
export const CABECALHO_DISPOSITIVO = 'x-lt-dispositivo';

const SEM_DISPOSITIVO = { erro: 'dispositivo nao registrado' };

async function lerCorpo(req) {
  const partes = [];
  let bytes = 0;
  for await (const pedaco of req) {
    bytes += pedaco.length;
    if (bytes > CORPO_MAX) return { erro: 'corpo grande demais' };
    partes.push(pedaco);
  }
  if (bytes === 0) return { valor: {} };
  try {
    return { valor: JSON.parse(Buffer.concat(partes).toString('utf8')) };
  } catch {
    return { erro: 'corpo nao e JSON' };
  }
}

// Devolve `true` de propósito: quem chama responde `return responder(...)`, e o
// `true` é o "eu tratei esta requisição" que o servidor do webhook lê.
function responder(res, codigo, corpo, cabecalhos = {}) {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', ...cabecalhos });
  res.end(JSON.stringify(corpo));
  return true;
}

// A claim viaja em cabeçalho, não em cookie (ADR 0042 §4): o tablet guarda um
// lote — uma claim por colaborador escalado — e quem está na frente dele muda
// várias vezes por turno. Cookie é do dispositivo; a claim é da pessoa.
function sessaoDaRequisicao(req, segredo, agora) {
  const cabecalho = req.headers.authorization ?? '';

  if (cabecalho.startsWith('Bearer ')) {
    const r = verificar(cabecalho.slice('Bearer '.length), segredo, agora);
    if (!r.ok) return r;

    return {
      ok: true,
      viaCookie: false,
      claim: r.claim,
      sessao: {
        colaboradorId: r.claim.colaborador_id,
        origem: origemDoPerfil(r.claim.perfil),
      },
    };
  }

  // Cookie é do Admin (ADR 0047 §4). Só é consultado quando NÃO veio Bearer:
  // um navegador com cookie não deve conseguir escolher qual identidade usar.
  const doCookie = lerCookie(req.headers.cookie, NOME_COOKIE);
  if (doCookie !== null) {
    const r = verificarAdmin(doCookie, segredo, agora);
    if (!r.ok) return r;

    return {
      ok: true,
      viaCookie: true,
      // `origem_claim` não é campo do token do Admin, e é preenchido aqui:
      // ele descreve COMO a identidade foi estabelecida (ADR 0020 §3), e a do
      // Admin é sempre "o servidor conferiu a senha agora" — nunca lote offline.
      claim: {
        colaborador_id: r.admin.colaborador_id,
        perfil: r.admin.perfil,
        origem_claim: 'online',
      },
      sessao: {
        colaboradorId: r.admin.colaborador_id,
        origem: origemDoPerfil(r.admin.perfil),
      },
    };
  }

  return { ok: false, motivo: 'ausente' };
}

// Recusa do domínio não é erro do servidor. As RPC levantam LT002..LT005 pra
// dizer "essa transição não existe", "esse agendamento já tem Comanda" — texto
// escrito pra quem opera. 28000 é o GUC faltando (ADR 0020 §1) e não deveria
// alcançar o cliente: se alcançou, é bug nosso, e vira 500 pra aparecer no log.
function traduzirErroDoBanco(erro) {
  const codigo = erro?.code ?? '';
  if (codigo.startsWith('LT')) return { codigo: 409, corpo: { erro: erro.message, code: codigo } };
  return null;
}

export function criarAtendenteApp({
  config, assinarClaim, abrirSessao, telas, comSessao,
  // Do Admin (ADR 0047). Ausentes, /admin/sessao responde 404 — é o que acontece
  // em teste que não monta essa metade, e é melhor que um 500 sem explicação.
  autenticarAdmin = null, assinarAdmin = null,
  // A conferência da chave do tablet (ADR 0048). Sem ela montada, nenhum
  // aparelho confere — a porta fecha em vez de abrir.
  conferirDispositivo = async () => ({ ok: false }),
  // A rota de mídia (ADR 0051). Ausentes, /midia responde 404 — o mesmo
  // desenho do login de Admin: teste que não monta essa metade não recebe 500.
  armazenamento = null, lerMidia = null,
  // O cliente do ManyChat (ADR 0076). Ausente — sem LT_MANYCHAT_TOKEN —, o
  // Enviar responde "não está ligado" e a Helena segue pelo manual.
  manychat = null,
  // Padrão permissivo: quem monta sem limitador tem o comportamento de antes.
  // Quem monta de verdade (index.mjs) sempre passa um.
  limitar = () => ({ permitido: true }),
  aoErro = console.error, agora = Date.now,
}) {
  // Devolve true quando tratou a requisição; false deixa o chamador seguir com
  // o 404 dele. Assim montar o app não muda o que o webhook responde.
  async function aparelhoDa(req) {
    const chave = req.headers[CABECALHO_DISPOSITIVO];
    if (typeof chave !== 'string' || chave === '') return { ok: false };
    return conferirDispositivo(chave);
  }

  // A claim do Atendente só vale no aparelho que conferiu o PIN. O cookie do
  // Admin não passa por aqui: ele entra pelo computador, não pelo tablet (ADR 0049).
  async function claimNoAparelhoCerto(req, s) {
    if (s.viaCookie) return true;
    const aparelho = await aparelhoDa(req);
    return aparelho.ok && aparelho.id === s.claim.dispositivo_id;
  }

  return async function atender(req, res) {
    const caminho = (req.url ?? '/').split('?')[0];

    // --------------------------------------------------- /admin/sessao (0047)
    // Entra por login + senha; sai apagando o cookie. A senha é conferida no
    // banco (app.admin_autenticar) pela razão do ADR 0039 §1: o hash não sai de
    // lá, e a 0034 revogou `select` nele justamente pra isso.
    if (caminho === '/admin/sessao') {
      if (autenticarAdmin === null || assinarAdmin === null) {
        return responder(res, 404, { erro: 'login de admin nao montado' });
      }

      if (req.method === 'DELETE') {
        return responder(res, 200, { ok: true },
          { 'set-cookie': cookieApagado({ seguro: config.cookieSeguro }) });
      }
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      // Mesmo limitador do /sessao: é a mesma porta e o mesmo tipo de
      // adivinhação, e o bloqueio do banco é por conta, não por origem.
      const ipAdmin = ipDe(req, config.confiaProxy);
      if (!limitar(ipAdmin ?? 'desconhecido').permitido) {
        return responder(res, 429, { erro: 'excesso de tentativas' });
      }

      const corpoAdmin = await lerCorpo(req);
      if (corpoAdmin.erro) return responder(res, 400, { erro: corpoAdmin.erro });

      const { login, senha } = corpoAdmin.valor;
      if (typeof login !== 'string' || typeof senha !== 'string') {
        return responder(res, 400, { erro: 'login e senha sao obrigatorios' });
      }

      const a = await autenticarAdmin({ login, senha, ip: ipAdmin });
      if (!a.ok) return responder(res, 401, { erro: a.motivo });

      const exp = Math.floor(agora() / 1000) + DURACAO_SEGUNDOS;
      const token = assinarAdmin({
        colaborador_id: a.colaborador_id,
        perfil: a.perfil,
        exp,
      });

      // O token vai SÓ no cookie, nunca no corpo: HttpOnly não serve de nada se
      // a resposta entrega o mesmo valor para o JavaScript da página ler.
      return responder(res, 200, { nome: a.nome, perfil: a.perfil, exp },
        { 'set-cookie': cookieDeSessao(token, { seguro: config.cookieSeguro }) });
    }

    // ---------------------------------------------------------- POST /sessao
    // Pré-claim: é este caminho que produz a claim. Não seta GUC e não toca em
    // nada além de app.sessao_abrir, que confere o PIN, registra a tentativa e
    // decide o bloqueio numa transação só (ADR 0039 / migration 0034).
    if (caminho === '/sessao') {
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      const ip = ipDe(req, config.confiaProxy);

      // ⚠ Este limite NÃO substitui o app.pin_bloqueado (ADR 0039 §3), que
      // continua sendo quem contém adivinhação de PIN. Ele existe porque aquele
      // bloqueio é POR COLABORADOR: com a lista que /tela/entrada devolve sem
      // claim, uma origem só queima 5 PINs errados de cada pessoa e trava a
      // equipe inteira — a "operação parada" que o §4 daquele ADR classificou
      // como o incidente maior, alcançável de fora. Vem ANTES de ler o corpo:
      // requisição recusada não merece parsing.
      if (!limitar(ip ?? 'desconhecido').permitido) {
        return responder(res, 429, { erro: 'excesso de tentativas' });
      }

      // Sem a chave do tablet nem se confere PIN (ADR 0048): é isto que impede
      // quem alcança a porta de travar a equipe errando PIN (issue #78).
      const aparelho = await aparelhoDa(req);
      if (!aparelho.ok) return responder(res, 401, SEM_DISPOSITIVO);

      const corpo = await lerCorpo(req);
      if (corpo.erro) return responder(res, 400, { erro: corpo.erro });

      const { colaborador_id: colaboradorId, pin } = corpo.valor;
      if (typeof colaboradorId !== 'string' || typeof pin !== 'string') {
        return responder(res, 400, { erro: 'colaborador_id e pin sao obrigatorios' });
      }

      // O nome do aparelho vai pra tentativa_pin: é o que o ADR 0039 §4 prometeu
      // pra investigar, e antes era uma constante do processo (issue #77).
      const r = await abrirSessao({ colaboradorId, pin, dispositivo: aparelho.nome, ip });
      if (!r.ok) return responder(res, 401, { erro: r.motivo });

      // O banco já recusa PIN de quem não é atendente (0046). Conferir de novo
      // aqui é a segunda barreira do ADR 0042 §3: se a função um dia regredir,
      // o Admin continua sem claim de tablet.
      if (r.perfil !== 'atendente') return responder(res, 401, { erro: 'pin_invalido' });

      // O `exp` da claim é a virada de turno seguinte, que o banco devolveu.
      // Segundos, não milissegundos: é o que o JWT usa e o que verificar() lê.
      return responder(res, 200, {
        claim: assinarClaim({
          colaborador_id: r.colaborador_id,
          perfil: r.perfil,
          turno_id: r.turno_id,
          exp: Math.floor(new Date(r.exp).getTime() / 1000),
          // O lote offline do ADR 0020 §3 ainda não existe; toda claim emitida
          // aqui é 'online' porque o servidor conferiu o PIN agora mesmo.
          origem_claim: 'online',
          dispositivo_id: aparelho.id,
        }),
        nome: r.nome,
        perfil: r.perfil,
        exp: r.exp,
      });
    }

    // ------------------------------------------------------ GET /tela/<nome>
    if (caminho.startsWith('/tela/')) {
      if (req.method !== 'GET') return responder(res, 405, { erro: 'metodo nao permitido' });

      const nome = caminho.slice('/tela/'.length);
      const tela = telas[nome];
      // A aba, a fase, o período: qual recorte da tela o dedo escolheu. Cada tela
      // lê só os nomes que conhece e recusa valor fora da lista dela voltando ao
      // padrão — parâmetro não é caminho pra escolher SQL.
      const parametros = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      if (tela === undefined) return responder(res, 404, { erro: 'tela nao existe' });

      // Entrada é a única lida sem claim — é ela que leva à claim. Mas não sem
      // aparelho: a lista da equipe só sai para o tablet registrado (#78).
      let sessao = null;
      if (tela.semClaim) {
        if (!(await aparelhoDa(req)).ok) return responder(res, 401, SEM_DISPOSITIVO);
      } else {
        const s = sessaoDaRequisicao(req, config.segredo, agora);
        if (!s.ok) return responder(res, 401, { erro: `claim ${s.motivo}` });
        if (!(await claimNoAparelhoCerto(req, s))) return responder(res, 401, SEM_DISPOSITIVO);
        sessao = s.sessao;
      }

      try {
        return responder(res, 200, await tela.ler(sessao, parametros));
      } catch (erro) {
        // Colaborador desativado entre o login e agora: a claim ainda assina,
        // mas não há mais quem ela descreve. É 401, não 500 — o gesto certo é
        // voltar pra Entrada, e o front só sabe isso pelo código.
        if (erro?.code === 'LT_SEM_COLABORADOR') {
          return responder(res, 401, { erro: 'colaborador nao esta mais ativo' });
        }
        aoErro(`tela ${nome}: falhou`, erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
    }

    // ------------------------------------------------------- POST /rpc/<nome>
    if (caminho.startsWith('/rpc/')) {
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      const nome = caminho.slice('/rpc/'.length);
      const rpc = RPCS[nome];
      // Fora da allow-list é 404 e não 403: a lista é o que existe pro app, e
      // dizer "existe, mas você não pode" descreveria o banco pra quem perguntou.
      if (rpc === undefined) return responder(res, 404, { erro: 'rpc nao alcancavel' });

      const s = sessaoDaRequisicao(req, config.segredo, agora);
      if (!s.ok) return responder(res, 401, { erro: `claim ${s.motivo}` });
      if (!(await claimNoAparelhoCerto(req, s))) return responder(res, 401, SEM_DISPOSITIVO);

      const corpo = await lerCorpo(req);
      if (corpo.erro) return responder(res, 400, { erro: corpo.erro });

      const args = montarArgumentos(rpc, corpo.valor, s.claim);
      if (!args.ok) return responder(res, 400, { erro: args.motivo });

      try {
        const linha = await comSessao(s.sessao, async (cliente) => {
          const { rows } = await cliente.query(
            `select * from app.${nome}(${args.casts.join(', ')})`, args.valores);
          return rows[0] ?? null;
        });
        return responder(res, 200, { resultado: linha });
      } catch (erro) {
        const traduzido = traduzirErroDoBanco(erro);
        if (traduzido) return responder(res, traduzido.codigo, traduzido.corpo);
        aoErro(`rpc ${nome}: falhou`, erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
    }

    // ------------------------------------------------------------ POST /midia
    // A única rota de corpo binário (ADR 0051 §6): os bytes do JPEG vão no
    // corpo e os metadados na query string, pra não precisar de um parser de
    // multipart — dependência nova, ou parsing de protocolo à mão, pra
    // transportar um arquivo e dois campos curtos.
    if (caminho === '/midia') {
      if (armazenamento === null) return responder(res, 404, { erro: 'rota de midia nao montada' });
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      // Quem alcança a tela alcança a foto (ADR 0051 §4): claim de Atendente ou
      // cookie de Admin, sem guarda de perfil nova. Quem está no balcão é quem
      // vê a sala suja e quem acha o casaco.
      const s = sessaoDaRequisicao(req, config.segredo, agora);
      if (!s.ok) return responder(res, 401, { erro: `claim ${s.motivo}` });
      if (!(await claimNoAparelhoCerto(req, s))) return responder(res, 401, SEM_DISPOSITIVO);

      if (tipoDe(req) !== MIME) {
        return responder(res, 415, { erro: `so ${MIME} entra` });
      }

      const p = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const ativo = p.get('ativo') ?? '';
      const registro = p.get('registro') ?? '';
      const compressao = p.get('compressao');
      // O id vem da fila do tablet (ADR 0072 §3): é ele que torna o reenvio
      // idempotente. Sem ele, o servidor gera um, como antes.
      const idDoTablet = p.get('id');

      // Recusado ANTES de ler o corpo: pedido que o banco vai rejeitar não
      // merece bytes gravados no storage nem megabyte lido da rede.
      if (!ATIVOS.includes(ativo)) return responder(res, 400, { erro: 'ativo nao recebe foto' });
      if (!UUID.test(registro)) return responder(res, 400, { erro: 'registro nao e uuid' });
      if (compressao !== null && !COMPRESSAO.test(compressao)) {
        return responder(res, 400, { erro: 'compressao malformada' });
      }
      if (idDoTablet !== null && !UUID.test(idDoTablet)) return responder(res, 400, { erro: 'id nao e uuid' });

      const corpo = await lerBytes(req);
      // 413 e não 400: o pedido está certo, a foto é que não cabe. É o teto do
      // ADR 0026 §1 aplicado do lado que o cliente não contorna, e a mensagem é
      // o que a tela mostra pedindo outra foto.
      if (corpo.erro) return responder(res, 413, { erro: corpo.erro });

      // O id nasce aqui porque a CHAVE o contém, e os bytes vão pro storage
      // ANTES da linha existir (ADR 0051 §8): falha de storage perde a foto, e
      // na ordem inversa deixaria linha apontando pra arquivo que não existe —
      // a referência quebrada que o ADR 0036 §2 proíbe.
      const id = idDoTablet?.toLowerCase() ?? randomUUID();
      const chave = chaveDaMidia(id, new Date(agora()));

      try {
        // Reenvio de uma foto cujos bytes já chegaram: o storage é write-once,
        // e a linha, se existir, sai idêntica do `midia_registrar`.
        const jaGuardada = idDoTablet !== null && (await armazenamento.ler(chave)) !== null;
        if (!jaGuardada) await armazenamento.guardar(chave, corpo.bytes);
      } catch (erro) {
        aoErro('midia: falhou ao gravar no storage', erro);
        return responder(res, 503, { erro: 'nao foi possivel guardar a foto' });
      }

      try {
        const linha = await comSessao(s.sessao, async (cliente) => {
          const { rows } = await cliente.query(
            `select * from app.midia_registrar($1::uuid, $2::text, $3::uuid, $4::text,
                                               $5::int, $6::text, $7::text, $8::uuid, $9::text)`,
            [id, ativo, registro, chave, corpo.bytes.length, MIME, compressao,
              s.claim.colaborador_id, s.claim.origem_claim],
          );
          return rows[0];
        });

        // O endereço assinado vem na resposta pra tela poder mostrar a foto que
        // acabou de subir sem refazer a busca da tela inteira.
        return responder(res, 201, {
          midia_id: linha.id,
          endereco: enderecoDaMidia(linha.id, config.segredo, agora),
          bytes: linha.tamanho_bytes,
        });
      } catch (erro) {
        // Recusa do domínio (write-once, registro que não existe) deixa o
        // arquivo órfão no storage. É o preço escrito no ADR 0051 §8: arquivo
        // que ninguém referencia é lixo barato; referência quebrada é mentira.
        const traduzido = traduzirErroDoBanco(erro);
        if (traduzido) return responder(res, traduzido.codigo, traduzido.corpo);
        aoErro('midia: falhou ao registrar', erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
    }

    // ------------------------------------------------------ GET /midia/<id>
    // Sem claim e sem aparelho, de propósito: `<img src>` não manda cabeçalho
    // nenhum. Quem autoriza é o token assinado que a tela colocou no endereço
    // (ADR 0051 §5), e ele vale 30 minutos pra UMA mídia.
    if (caminho.startsWith('/midia/')) {
      if (armazenamento === null || lerMidia === null) {
        return responder(res, 404, { erro: 'rota de midia nao montada' });
      }
      if (req.method !== 'GET') return responder(res, 405, { erro: 'metodo nao permitido' });

      const id = caminho.slice('/midia/'.length);
      const token = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('t') ?? '';
      if (!UUID.test(id) || !enderecoConfere(id, token, config.segredo, agora)) {
        return responder(res, 401, { erro: 'endereco invalido ou vencido' });
      }

      try {
        const linha = await lerMidia(id);
        if (linha === null) return responder(res, 404, { erro: 'midia nao existe' });
        // 410 e não 404: a linha diz que o arquivo EXPIROU, em vez de fingir
        // que nunca existiu (ADR 0036 §2).
        if (linha.expirada_em !== null) return responder(res, 410, { erro: 'a foto expirou' });

        const bytes = await armazenamento.ler(linha.url);
        if (bytes === null) {
          // Linha viva apontando pra arquivo que não está lá é a referência
          // quebrada do ADR 0036 §2 — bug nosso, não estado previsto. 500 pra
          // aparecer no log em vez de virar "foto some às vezes".
          aoErro(`midia ${id}: a linha existe e o arquivo nao esta no storage (${linha.url})`);
          return responder(res, 500, { erro: 'falha interna' });
        }

        // `immutable` porque mídia é write-once: o mesmo id nunca devolve outros
        // bytes. `private` porque isto é foto de operação, não asset público — e
        // o max-age acompanha o prazo do endereço.
        res.writeHead(200, {
          'content-type': linha.mime,
          'content-length': bytes.length,
          'cache-control': 'private, max-age=1800, immutable',
        });
        res.end(bytes);
        return true;
      } catch (erro) {
        aoErro(`midia ${id}: falhou ao servir`, erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
    }

    // ------------------------------------------------------ POST /comprovante
    // O PDF que a Helena gerou no navegador (ADR 0073 §2). Só o cookie do Admin:
    // quem envia o comprovante é ela, e o tablet não oferece o gesto (§1).
    if (caminho === '/comprovante') {
      if (armazenamento === null) return responder(res, 404, { erro: 'rota de comprovante nao montada' });
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      const s = sessaoDaRequisicao(req, config.segredo, agora);
      if (!s.ok) return responder(res, 401, { erro: `claim ${s.motivo}` });
      if (!s.viaCookie) return responder(res, 403, { erro: 'o comprovante e enviado pelo Admin' });

      if (tipoDe(req) !== MIME_PDF) return responder(res, 415, { erro: `so ${MIME_PDF} entra` });
      const comandaId = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('comanda') ?? '';
      if (!UUID.test(comandaId)) return responder(res, 400, { erro: 'comanda nao e uuid' });

      let estado;
      try {
        estado = await comSessao(s.sessao, async (cliente) => {
          const { rows } = await cliente.query(
            `select c.status, c.fechado_em,
                    (select count(*)::int from comanda_envio e where e.comanda_id = c.id) as envios
               from comanda c where c.id = $1::uuid`, [comandaId]);
          return rows[0] ?? null;
        });
      } catch (erro) {
        aoErro('comprovante: falhou ao ler a comanda', erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
      if (estado === null) return responder(res, 404, { erro: 'comanda nao existe' });
      const envio = envioDoComprovante(estado.status, estado.envios);
      if (envio === null || estado.fechado_em === null) {
        return responder(res, 409, { erro: 'so comanda fechada ou enviada tem comprovante' });
      }

      const corpo = await lerBytes(req, TETO_PDF);
      if (corpo.erro) return responder(res, 413, { erro: 'o PDF nao cabe' });
      if (corpo.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return responder(res, 415, { erro: 'o corpo nao e PDF' });
      }

      const id = idDoComprovante(comandaId, envio, estado.fechado_em);
      const chave = chaveDoComprovante(id);
      try {
        // Copiar de novo reaproveita o arquivo (ADR 0073 §4): o guardado é o que
        // o cliente pode já ter aberto, e o storage é write-once.
        if ((await armazenamento.ler(chave)) === null) await armazenamento.guardar(chave, corpo.bytes);
      } catch (erro) {
        aoErro('comprovante: falhou ao gravar no storage', erro);
        return responder(res, 503, { erro: 'nao foi possivel guardar o comprovante' });
      }

      return responder(res, 201, { comprovante_id: id, envio, link: linkDoComprovante(id, config.segredo, agora) });
    }

    // ------------------------------------------------ POST /comprovante/enviar
    // O Enviar da Helena (ADR 0076). O texto chega pronto do navegador, que já fez
    // o POST /comprovante e tem o link. Qualquer "não deu" é 200 com
    // `enviado: false` e o motivo: a tela cai no manual, não num erro.
    if (caminho === '/comprovante/enviar') {
      if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo nao permitido' });

      const s = sessaoDaRequisicao(req, config.segredo, agora);
      if (!s.ok) return responder(res, 401, { erro: `claim ${s.motivo}` });
      if (!s.viaCookie) return responder(res, 403, { erro: 'o comprovante e enviado pelo Admin' });

      const corpo = await lerCorpo(req);
      if (corpo.erro) return responder(res, 400, { erro: corpo.erro });
      const { comanda_id: comandaId, versao, texto } = corpo.valor;
      if (typeof comandaId !== 'string' || !UUID.test(comandaId)) {
        return responder(res, 400, { erro: 'comanda nao e uuid' });
      }
      if (!Number.isInteger(versao)) return responder(res, 400, { erro: 'versao nao e inteiro' });
      if (typeof texto !== 'string' || texto.trim() === '' || texto.length > 1000) {
        return responder(res, 400, { erro: 'texto vazio ou grande demais' });
      }

      if (manychat === null) {
        return responder(res, 200, { enviado: false, motivo: 'O envio automático não está ligado neste servidor.' });
      }

      let c;
      try {
        c = await comSessao(s.sessao, async (cliente) => {
          const { rows } = await cliente.query(
            'select status, versao, cliente_telefone from comanda where id = $1::uuid', [comandaId]);
          return rows[0] ?? null;
        });
      } catch (erro) {
        aoErro('comprovante/enviar: falhou ao ler a comanda', erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
      if (c === null) return responder(res, 404, { erro: 'comanda nao existe' });
      if (c.status !== 'fechada') return responder(res, 409, { erro: 'so comanda fechada se envia' });

      const telefone = soDigitos(c.cliente_telefone);
      if (telefone === '') {
        return responder(res, 200, { enviado: false, motivo: 'A comanda não tem o telefone do cliente.' });
      }

      // Um contato só (§2): mandar o comprovante para a pessoa errada é pior
      // do que a Helena colar a mensagem.
      let saiu;
      try {
        const contatos = await manychat.acharContatos(telefone);
        if (contatos.length === 0) {
          return responder(res, 200, {
            enviado: false,
            motivo: 'O ManyChat não achou o cliente por este número. Ele entra quando mandar mensagem ao estúdio.',
          });
        }
        if (contatos.length > 1) {
          return responder(res, 200, { enviado: false, motivo: 'Há mais de um contato no ManyChat com este número.' });
        }
        saiu = await manychat.enviarTexto(contatos[0], texto);
      } catch (erro) {
        aoErro('comprovante/enviar: o ManyChat falhou', erro);
        return responder(res, 200, { enviado: false, motivo: 'O ManyChat não respondeu.' });
      }
      if (!saiu.ok) {
        return responder(res, 200, {
          enviado: false,
          motivo: 'O cliente não mandou mensagem ao estúdio nas últimas 24h, e fora desse prazo o WhatsApp não deixa '
            + `o ManyChat mandar sozinho (resposta do ManyChat: ${saiu.mensagem}).`,
        });
      }

      // Enviada só depois do `success` (§4), e pela mesma aresta do "Já mandei por fora".
      try {
        const linha = await comSessao(s.sessao, async (cliente) => {
          const { rows } = await cliente.query(
            `select * from app.comanda_transicionar($1::uuid, $2::text, $3::int, $4::uuid,
                                                    $5::timestamptz, $6::timestamptz, $7::text, $8::text, $9::text)`,
            [comandaId, 'enviar', versao, s.claim.colaborador_id, null, null, telefone, null, s.claim.origem_claim],
          );
          return rows[0];
        });
        return responder(res, 200, { enviado: true, registrado: true, resultado: linha });
      } catch (erro) {
        if (traduzirErroDoBanco(erro) === null) aoErro('comprovante/enviar: saiu e nao registrou', erro);
        return responder(res, 200, {
          enviado: true,
          registrado: false,
          motivo: 'A mensagem saiu, mas o envio não foi registrado. Confira a comanda e toque em Já mandei por fora.',
        });
      }
    }

    // ------------------------------------------------ GET /comprovante/<id>
    // Pública: quem abre é o cliente, no celular. Quem autoriza é o token, que
    // vale 30 dias (ADR 0073 §3).
    if (caminho.startsWith('/comprovante/')) {
      if (armazenamento === null) return responder(res, 404, { erro: 'rota de comprovante nao montada' });
      if (req.method !== 'GET') return responder(res, 405, { erro: 'metodo nao permitido' });

      const id = caminho.slice('/comprovante/'.length);
      const token = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('t') ?? '';
      const link = ID_COMPROVANTE.test(id) ? conferirLink(id, token, config.segredo, agora) : 'invalido';
      if (link === 'invalido') return responder(res, 404, { erro: 'comprovante nao encontrado' });
      if (link === 'vencido') {
        res.writeHead(410, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(PAGINA_VENCIDO);
        return true;
      }

      try {
        const bytes = await armazenamento.ler(chaveDoComprovante(id));
        if (bytes === null) {
          // Link assinado por nós para um arquivo que não está lá: o POST só
          // assina depois de gravar. Bug nosso, não estado previsto.
          aoErro(`comprovante ${id}: o link e valido e o arquivo nao esta no storage`);
          return responder(res, 500, { erro: 'falha interna' });
        }
        res.writeHead(200, {
          'content-type': MIME_PDF,
          'content-length': bytes.length,
          'content-disposition': 'inline; filename="comprovante-lifetrailer.pdf"',
          'cache-control': 'private, no-store',
        });
        res.end(bytes);
        return true;
      } catch (erro) {
        aoErro(`comprovante ${id}: falhou ao servir`, erro);
        return responder(res, 500, { erro: 'falha interna' });
      }
    }

    return false;
  };
}
