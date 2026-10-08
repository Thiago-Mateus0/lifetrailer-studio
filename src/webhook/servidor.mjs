// Receptor do webhook da Altegio.
//
// Faz três coisas e para: verifica a origem (ADR 0019), registra a requisição
// bruta (ADR 0012) e enfileira o evento (ADR 0011). Não lê `attendance`, não
// classifica `staff_id`, não resolve idempotência, não dispara cascata — isso é
// do processador, sobre a fila.
//
// Por que responder 200 sem processar: a Altegio é push sem confirmação e não
// reenvia. Um payload que o parser não entende não pode se perder na porta; ele
// já está gravado, e o Laço 1 da reconciliação é a rede de segurança pro que a
// porta nunca chegou a receber (integracao-altegio.md, "Sem fila de retry").
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { PREFIXO_LOG, PREFIXO_ROTA } from './config.mjs';

// Nunca entram na tabela append-only: credencial gravada com retenção
// permanente é credencial que não se rotaciona mais.
const CABECALHOS_OMITIDOS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

// Comparação em tempo constante sobre o digest: o token tem tamanho variável, e
// timingSafeEqual exige buffers do mesmo tamanho — comparar o sha256 evita
// vazar o comprimento junto.
const digerir = (s) => createHash('sha256').update(s, 'utf8').digest();

export function tokenConfere(recebido, esperado) {
  return timingSafeEqual(digerir(recebido), digerir(esperado));
}

// O token É o segredo (ADR 0019). O caminho vai pro banco redigido; ver o
// comentário de webhook_requisicao em 0022. A query string é descartada: não
// tem uso e é um lugar a mais onde o token pode aparecer copiado.
export function redigirCaminho(url) {
  const caminho = url.split('?')[0];
  if (!caminho.startsWith(PREFIXO_ROTA)) return caminho;
  // Tudo depois do prefixo some, não só o primeiro segmento: em
  // `/webhook/altegio//<TOKEN>` o primeiro segmento é vazio e o token real
  // passava inteiro pro log append-only (revisão de 2026-10-06).
  return PREFIXO_ROTA + '<token>';
}

// Janela fixa por IP. Não é moldagem de tráfego — são dezenas de eventos por
// dia; é o que impede que um laço de POST forjado encha uma tabela que, por
// decisão de domínio, ninguém pode apagar depois.
export function criarLimitador({ limitePorJanela, janelaMs }, agora = Date.now) {
  const janelas = new Map();

  return function permitir(ip) {
    const t = agora();
    const janela = janelas.get(ip);

    if (janela === undefined || t - janela.inicio >= janelaMs) {
      janelas.set(ip, { inicio: t, contagem: 1, jaRegistrou: false });
      // Sem isto o Map cresce com o número de IPs que já bateram na porta.
      if (janelas.size > 10_000) {
        for (const [chave, j] of janelas) if (t - j.inicio >= janelaMs) janelas.delete(chave);
      }
      return { permitido: true, registrar: false };
    }

    janela.contagem += 1;
    if (janela.contagem <= limitePorJanela) return { permitido: true, registrar: false };

    // Uma linha de log por janela, não uma por requisição recusada: o log é
    // append-only, e quem está em laço é justamente quem foi barrado.
    const registrar = !janela.jaRegistrou;
    janela.jaRegistrou = true;
    return { permitido: false, registrar };
  };
}

// Exportada porque o lado-app usa a MESMA leitura (ADR 0042 §1: um processo,
// uma porta). Copiar as quatro linhas pro outro arquivo garantiria divergência
// no dia em que alguém corrigir só um dos dois.
export function ipDe(req, confiaProxy) {
  if (confiaProxy) {
    const encaminhado = req.headers['x-forwarded-for'];
    if (typeof encaminhado === 'string' && encaminhado.length > 0) {
      return encaminhado.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress ?? null;
}

function cabecalhosPara(req) {
  const saida = {};
  for (const [nome, valor] of Object.entries(req.headers)) {
    if (CABECALHOS_OMITIDOS.has(nome)) continue;
    saida[nome] = Array.isArray(valor) ? valor.join(', ') : valor;
  }
  return saida;
}

// Lê até o teto e para de acumular. O prefixo lido continua indo pro log: um
// corpo grande demais é evidência do mesmo jeito, e sem ele a linha de
// `corpo_grande` não diz nada sobre o que chegou.
async function lerCorpo(req, maxBytes) {
  const partes = [];
  let bytes = 0;
  let excedeu = false;

  for await (const pedaco of req) {
    bytes += pedaco.length;
    if (bytes > maxBytes) {
      excedeu = true;
      break;
    }
    partes.push(pedaco);
  }

  return { texto: Buffer.concat(partes).toString('utf8'), bytes, excedeu };
}

const RESPOSTAS = {
  aceita: [200, '{"ok":true}'],
  // 404 e não 401: quem errou o token não recebe confirmação de que o endpoint
  // existe. O segredo está no path, então a rota inteira é o segredo.
  token_invalido: [404, '{"erro":"nao encontrado"}'],
  rota_desconhecida: [404, '{"erro":"nao encontrado"}'],
  metodo_invalido: [405, '{"erro":"metodo nao permitido"}'],
  corpo_grande: [413, '{"erro":"corpo grande demais"}'],
  excesso: [429, '{"erro":"excesso de requisicoes"}'],
};

async function decidir(req, config, limitador) {
  const caminho = (req.url ?? '/').split('?')[0];
  const ip = ipDe(req, config.confiaProxy);

  // O que não aponta pro webhook não vira linha: varredura de internet é
  // constante, e a tabela é append-only e de retenção permanente. É um
  // estreitamento deliberado do "toda requisição recebida" do ADR 0012 — o que
  // ele protege é o evento perdido na porta do webhook, não o scanner.
  const registravel = caminho.startsWith(PREFIXO_LOG);

  const { permitido, registrar } = limitador(ip ?? 'desconhecido');
  if (!permitido) {
    return { resultado: 'excesso', registrar: registravel && registrar, ip, corpo: null, bytes: 0 };
  }

  if (!caminho.startsWith(PREFIXO_ROTA)) {
    return { resultado: 'rota_desconhecida', registrar: registravel, ip, corpo: null, bytes: 0 };
  }

  const tokenRecebido = caminho.slice(PREFIXO_ROTA.length).split('/')[0];
  if (tokenRecebido.length === 0 || !tokenConfere(tokenRecebido, config.token)) {
    return { resultado: 'token_invalido', registrar: registravel, ip, corpo: null, bytes: 0 };
  }

  if (req.method !== 'POST') {
    return { resultado: 'metodo_invalido', registrar: true, ip, corpo: null, bytes: 0 };
  }

  const { texto, bytes, excedeu } = await lerCorpo(req, config.corpoMaxBytes);
  return {
    resultado: excedeu ? 'corpo_grande' : 'aceita',
    registrar: true,
    ip,
    corpo: texto,
    bytes,
  };
}

// `atenderApp` é o lado-app do ADR 0042 §1: mesmo processo, mesma porta, mesmo
// pool. Ele vem antes da decisão do webhook e é consultado só para caminhos que
// não são do webhook — sem ele, tudo aqui responde exatamente como antes.
//
// Fora do limitador de propósito: a janela por IP existe pra proteger a tabela
// append-only de log, e o quiosque legítimo bate nestas rotas o turno inteiro.
// Quem limita tentativa de PIN é app.pin_bloqueado (ADR 0039), no banco.
export function criarServidor({ config, ingerir, atenderApp = null, aoErro = console.error }) {
  const limitador = criarLimitador(config);

  return http.createServer((req, res) => {
    (async () => {
      const caminho = (req.url ?? '/').split('?')[0];
      if (atenderApp !== null && !caminho.startsWith(PREFIXO_LOG)) {
        if (await atenderApp(req, res)) return;
      }

      const decisao = await decidir(req, config, limitador);

      if (decisao.registrar) {
        await ingerir({
          ipOrigem: decisao.ip,
          metodo: req.method ?? '',
          caminho: redigirCaminho(req.url ?? '/'),
          cabecalhos: cabecalhosPara(req),
          corpoBruto: decisao.corpo,
          corpoBytes: decisao.bytes,
          resultado: decisao.resultado,
        });
      }

      const [codigo, corpo] = RESPOSTAS[decisao.resultado];
      res.writeHead(codigo, { 'content-type': 'application/json' });
      res.end(corpo);
    })().catch((erro) => {
      // Falhou a gravação = o evento não está em lugar nenhum. Não responder 200
      // seria mentir menos, mas a Altegio não reenvia de qualquer jeito; o que
      // recupera é o Laço 1 da reconciliação. Aqui só não se finge sucesso.
      aoErro('webhook: falha ao atender requisicao', erro);
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"erro":"indisponivel"}');
      } else {
        res.end();
      }
    });
  });
}
