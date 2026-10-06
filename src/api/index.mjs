// Monta o lado-app e devolve o manipulador que o servidor do webhook chama
// quando o caminho não é dele (ADR 0042 §1 — um processo, não dois).
import { criarLimitador } from '../webhook/servidor.mjs';
import { assinarAdmin } from './admin.mjs';
import { armazenamentoEmDisco } from './armazenamento.mjs';
import { lerConfigApp } from './config.mjs';
import { criarManychat } from './manychat.mjs';
import { assinar } from './claim.mjs';
import { criarAtendenteApp } from './servidor.mjs';
import {
  comCache, criarAberturaDeSessao, criarAutenticacaoAdmin, criarConferenciaDeDispositivo,
  criarLeituraDeMidia, criarSessaoDeBanco,
} from './transacao.mjs';
import { criarTelaAchados } from './telas/achados.mjs';
import { criarTelaAjustes } from './telas/ajustes.mjs';
import { criarTelaAvisos } from './telas/avisos.mjs';
import { criarTelaChecklist } from './telas/checklist.mjs';
import { criarTelaComanda } from './telas/comanda.mjs';
import { criarTelaEntrada } from './telas/entrada.mjs';
import { criarTelaEscala } from './telas/escala.mjs';
import { criarTelaEstoque } from './telas/estoque.mjs';
import { criarTelaHome } from './telas/home.mjs';
import { criarTelaHorasExtras } from './telas/horas-extras.mjs';
import { criarTelaSidebar } from './telas/sidebar.mjs';
import { criarTelaTreinamento } from './telas/treinamento.mjs';

export function montarApp({ pool, env = process.env, aoErro = console.error }) {
  const config = lerConfigApp(env);
  const comSessao = criarSessaoDeBanco(pool);
  const manychat = config.manychatToken === '' ? null : criarManychat({ token: config.manychatToken });

  // O mesmo limitador do webhook, com janela própria: lá ele protege a tabela
  // append-only de log; aqui impede que uma origem só trave a equipe inteira
  // pelo bloqueio por colaborador do ADR 0039 §3 (issue #78). Só /sessao passa
  // por ele — o quiosque legítimo bate em /tela e /rpc o turno inteiro.
  const limitar = criarLimitador({
    limitePorJanela: config.limiteSessao,
    janelaMs: config.janelaSessaoMs,
  });

  // O registro de telas é a lista do ADR 0042 §2: uma entrada por tela, uma
  // consulta cada.
  const telas = {
    entrada: { semClaim: true, ler: criarTelaEntrada(pool, config) },
    home: { ler: criarTelaHome(comSessao, config) },
    sidebar: { ler: criarTelaSidebar(comSessao) },
    checklist: { ler: criarTelaChecklist(comSessao, config) },
    comanda: { ler: criarTelaComanda(comSessao, { envioAutomatico: manychat !== null }) },
    estoque: { ler: criarTelaEstoque(comSessao) },
    escala: { ler: criarTelaEscala(comSessao) },
    horas: { ler: criarTelaHorasExtras(comSessao) },
    achados: { ler: criarTelaAchados(comSessao, config) },
    avisos: { ler: criarTelaAvisos(comSessao) },
    ajustes: { ler: criarTelaAjustes(comSessao, config) },
    // A decisão que faltava saiu na issue #94: vale o spec, e o vídeo/link do
    // mockup foi desenhado além do escopo. Esta é a tela do spec.
    treinamento: { ler: criarTelaTreinamento(comSessao, config) },
  };

  return criarAtendenteApp({
    config,
    assinarClaim: (claim) => assinar(claim, config.segredo),
    abrirSessao: criarAberturaDeSessao(pool),
    autenticarAdmin: criarAutenticacaoAdmin(pool),
    assinarAdmin: (dados) => assinarAdmin(dados, config.segredo),
    conferirDispositivo: comCache(criarConferenciaDeDispositivo(pool)),
    telas,
    comSessao,
    // A rota de mídia (ADR 0051). Disco em dev; o R2 implementa os mesmos dois
    // métodos quando a credencial existir, e nada aqui muda além desta linha.
    armazenamento: armazenamentoEmDisco(config.midiaDir),
    lerMidia: criarLeituraDeMidia(pool),
    manychat,
    limitar,
    aoErro,
  });
}
