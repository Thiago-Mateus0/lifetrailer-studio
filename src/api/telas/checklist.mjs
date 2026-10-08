// GET /tela/checklist[?fase=entrada|saida] — o Checklist do dia (spec/checklist.md).
//
// Devolve o `DadosChecklist` de src/app/src/telas/Checklist.tsx. Sem `fase`, a
// tela abre na fase que o dia está vivendo: entrada enquanto ela não conclui.
//
// ⚠ `modal` só existe com `?item=<uuid>` na busca: o modal da justificativa é
// recorte, como o detalhe da Comanda e o do Achado, e não estado guardado no
// cliente. Tem de ser assim porque a foto dele é um endereço ASSINADO (ADR 0051
// §5), e assinar exige o segredo do processo. `erroConcluir` continua nulo: esse
// é estado de interação de verdade. `perfis` tem só o perfil de quem está
// logado — o seletor do mockup era demonstração das duas visões, e trocar de
// perfil aqui é trocar de pessoa, que é a Entrada.
//
// ⚠ Dia sem `checklist_dia` (o cron das 06h não rodou) a tela diz que o
// checklist do dia não foi criado, em vez de fingir "catálogo não configurado".
import { enderecoDaMidia, UUID } from '../midia.mjs';
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { data, hojeEm, hora, iniciais, papel, percentual } from './formato.mjs';

const FASES = ['entrada', 'saida'];
// '2026-02-30' passa na regex e estoura no cast do Postgres: confere a volta.
function dataValida(texto) {
  const d = new Date(`${texto}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(d.getTime())
    && d.toISOString().slice(0, 10) === texto;
}

// Meio-dia em Maceió: o dia do calendário como instante, sem risco de o fuso
// empurrar pra véspera.
const diaDe = (texto) => new Date(`${texto}T12:00:00-03:00`);
const semanaFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', weekday: 'short' });

// 'qui 01/10' — curto, pra caber na faixa do histórico.
function rotuloDoDia(texto) {
  const [, mes, dia] = texto.split('-');
  return `${semanaFmt.format(diaDe(texto)).replace('.', '')} ${dia}/${mes}`;
}

const situacaoDoDia = (d) =>
  d.saida === 'concluida' ? 'concluído'
    : d.entrada === 'concluida' ? 'saída pendente' : 'entrada pendente';

const CONSULTA = `
with param as (
  select $2::timestamptz as agora,
         ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         $3::text as fase_pedida,
         $4::uuid as item_pedido,
         $5::date as data_pedida,
         app.checklist_dia_vigente($2::timestamptz) as vigente
),
${CTE_EU},
-- O dia pedido só vale pra quem não é atendente, e nunca no futuro (spec:
-- seletor de data). Sem pedido, o dia vigente: o de ontem enquanto a saída dele
-- estiver pendente e o de hoje não nasceu (ADR 0087).
alvo as (
  select case when p.data_pedida is not null and p.data_pedida <= p.hoje
               and (select nivel_acesso from eu) <> 'atendente'
              then p.data_pedida else p.vigente end as data
    from param p
),
dia as (
  select cd.* from checklist_dia cd, alvo where cd.data = alvo.data
),
-- Os últimos dias com checklist, pro histórico do Admin. Atendente não recebe.
historico as (
  select cd.data, cd.status_entrada, cd.status_saida
    from checklist_dia cd, param p
   where cd.data <= p.hoje and (select nivel_acesso from eu) <> 'atendente'
   order by cd.data desc
   limit 14
),
fase as (
  select coalesce(
           (select fase_pedida from param where fase_pedida in ('entrada','saida')),
           (select case when status_entrada = 'pendente' then 'entrada' else 'saida' end from dia),
           'entrada') as fase
),
-- O snapshot vence o catálogo: o item executado guarda o nome que tinha quando
-- o dia nasceu, e renomear no catálogo não reescreve o passado.
itens as (
  select ie.id, ie.fase, ie.estado, ie.marcado_em, ie.versao, ie.justificativa_texto,
         -- Mídia expirada não é foto: o registro diz que o arquivo sumiu
         -- (ADR 0036 §2), e o modal mostra o quadro vazio em vez de um endereço
         -- que responderia 410.
         case when mj.expirada_em is null then mj.id end as foto_id,
         cm.nome                                        as quem,
         coalesce(ie.nome_snapshot, ic.nome)            as nome,
         coalesce(ie.acao_snapshot, ic.acao)            as acao,
         coalesce(ic.secao_estudio_id::text, 'geral')   as sala_id,
         coalesce(ie.secao_snapshot, e.nome, 'Geral')   as sala,
         -- Geral por último: seção NULL é a de fora dos estúdios (0003).
         coalesce(e.ordem_exibicao, 2147483647)         as sala_ordem,
         ic.ordem
    from item_execucao ie
    join dia on dia.id = ie.checklist_dia_id
    join item_catalogo ic on ic.id = ie.item_catalogo_id
    left join estudio e on e.id = ic.secao_estudio_id
    left join midia mj on mj.id = ie.justificativa_midia_id
    left join colaborador cm on cm.id = ie.marcado_por_id
),
-- O item do modal. Item feito fica de fora: o modal não tem o que oferecer pra
-- ele — quem desfaz o feito é o toque, e a RPC recusaria com LT002.
selecionado as (
  select i.* from itens i, param p
   where i.id = p.item_pedido
     and i.fase = (select fase from fase)
     and i.estado in ('nao_marcado', 'nao_feito_pendente_anexo', 'nao_feito_justificado')
)
select
  (select nome         from eu)                       as eu_nome,
  (select nivel_acesso from eu)                       as eu_perfil,
  (select id             from dia)                    as dia_id,
  (select versao         from dia)                    as dia_versao,
  (select status_entrada from dia)                    as status_entrada,
  (select status_saida   from dia)                    as status_saida,
  (select limite_entrada from dia)                    as limite_entrada,
  (select limite_saida   from dia)                    as limite_saida,
  (select fase from fase)                             as fase,
  (select count(*) from itens
    where fase = 'entrada' and estado not in ('feito', 'nao_feito_justificado')) as entrada_pendentes,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'estado', estado, 'marcado_em', marcado_em, 'versao', versao, 'nome', nome, 'acao', acao,
      'sala_id', sala_id, 'sala', sala) order by sala_ordem, sala, ordem, nome)
      from itens where fase = (select fase from fase)), '[]'::jsonb) as itens,
  (select to_jsonb(s) from selecionado s)             as selecionado,
  (select data::text from alvo)                       as data_alvo,
  (select vigente::text from param)                   as data_vigente,
  (select jsonb_agg(jsonb_build_object('data', data, 'entrada', status_entrada, 'saida', status_saida)
                    order by data desc) from historico) as historico`;

// O pendente de anexo tem motivo e não tem foto: não conta (ADR 0072 §9).
const tratado = (estado) => estado === 'feito' || estado === 'nao_feito_justificado';
const justificou = (estado) => estado === 'nao_feito_justificado' || estado === 'nao_feito_pendente_anexo';

// O nome do item é o do snapshot mais a ação, e sai igual na lista e no modal.
const nomeDoItem = (i) => (i.acao ? `${i.nome} · ${i.acao}` : i.nome);

// O modal da justificativa (spec/checklist.md: foto obrigatória, texto opcional).
//
// ⚠ Dois modos, e o que os separa é o estado do item, não um parâmetro: item por
// tratar abre pra escrever (a foto sobe pela rota de mídia antes do motivo,
// ADR 0051 §7); item já justificado abre pra ler, com "Remover justificativa"
// como única ação — que devolve o item a `nao_marcado` sem tirar a foto
// (ADR 0052).
function modalDe(i, endereco, somenteLeitura) {
  const justificado = justificou(i.estado);
  return {
    identificador: i.id,
    // A versão vai junto porque as duas RPC do modal a exigem de volta — e ela
    // sobe quando a FOTO entra, não só quando o motivo é confirmado.
    versao: Number(i.versao),
    aberto: true,
    modo: justificado ? 'Justificativa' : 'Justificar item',
    nome: nomeDoItem(i),
    ...(i.foto_id ? { foto: endereco(i.foto_id) } : {}),
    fotoRotulo: i.foto_id ? 'anexada' : justificado ? 'a caminho' : 'obrigatória',
    texto: i.justificativa_texto ?? '',
    meta: justificado && i.marcado_em ? `por ${i.quem} às ${hora(new Date(i.marcado_em))}` : '',
    editavel: !justificado,
    podeRemover: !somenteLeitura,
  };
}

function barra(tratados, total) {
  return tratados === 0 || total === 0 ? 'var(--lt-borda-fraca)' : 'var(--lt-texto-forte)';
}

function salasDe(itens) {
  const salas = new Map();
  for (const i of itens) {
    if (!salas.has(i.sala_id)) salas.set(i.sala_id, { identificador: i.sala_id, nome: i.sala, itens: [] });
    salas.get(i.sala_id).itens.push(i);
  }
  return [...salas.values()];
}

export function montarChecklist(linha, agora, config) {
  exigirColaborador(linha);
  const l = linha;
  const fase = FASES.includes(l.fase) ? l.fase : 'entrada';
  const nomeFase = fase === 'entrada' ? 'entrada' : 'saída';
  const semDia = l.dia_id === null;
  // Dia do histórico: só se olha. O dia vigente (inclusive o de ontem de
  // madrugada) é o único em que se toca.
  const somenteLeitura = l.data_alvo !== l.data_vigente;
  const quando = diaDe(l.data_alvo);

  const itens = l.itens;
  const tratados = itens.filter((i) => tratado(i.estado)).length;
  const salas = salasDe(itens);

  // A saída só libera quando a entrada conclui (spec: "Entrada Concluída → libera").
  const entradaPendente = l.status_entrada === 'pendente';
  const faltamEntrada = Number(l.entrada_pendentes);
  const saidaBloqueada = !semDia && !somenteLeitura && fase === 'saida' && entradaPendente;
  const travado = saidaBloqueada || somenteLeitura;

  const limite = fase === 'entrada' ? l.limite_entrada : l.limite_saida;
  // Assinar exige o segredo do processo, que não é assunto de tela (ADR 0051 §5).
  const endereco = (id) => enderecoDaMidia(id, config.segredo, () => agora.getTime());

  let bloqueio = null;
  if (semDia && somenteLeitura) {
    bloqueio = { titulo: 'Não houve expediente', texto: 'Este dia não tem checklist no sistema.' };
  } else if (semDia) {
    bloqueio = {
      titulo: 'Checklist de hoje não criado',
      texto: 'O checklist do dia ainda não existe no sistema. Avise o Admin.',
    };
  } else if (saidaBloqueada) {
    bloqueio = {
      titulo: 'Saída bloqueada',
      texto: `Conclua a entrada primeiro. Faltam ${faltamEntrada} ${faltamEntrada === 1 ? 'item' : 'itens'} (ou justificativa) para liberar a saída.`,
      botao: 'Ir para entrada',
    };
  }

  const salasApresentadas = salas.map((s) => {
    const feitos = s.itens.filter((i) => tratado(i.estado)).length;
    return {
      identificador: s.identificador,
      nome: s.nome,
      contagem: `${feitos}/${s.itens.length}`,
      itens: s.itens.map((i) => {
        const justificado = justificou(i.estado);
        return {
          identificador: i.id,
          versao: i.versao,
          nome: nomeDoItem(i),
          tratado: tratado(i.estado),
          justificado,
          hora: i.estado === 'feito' && i.marcado_em ? hora(new Date(i.marcado_em))
            : i.estado === 'nao_feito_pendente_anexo' ? 'foto a caminho' : '',
          // Item justificado sai pela justificativa ("ver" → remover), não pelo toque.
          podeTratar: !travado && !justificado,
          podeJustificar: !travado && i.estado === 'nao_marcado',
        };
      }),
      ultima: s.itens.reduce((max, i) => (i.marcado_em && (!max || i.marcado_em > max) ? i.marcado_em : max), null),
      feitos,
    };
  });

  return {
    hora: hora(agora),
    turno: iniciais(l.eu_nome),
    data: data(quando),
    fase,
    // O dia e a versão dele vão pra tela porque quem conclui a fase precisa
    // mandar os dois de volta (0051). Dia inexistente é `null`, e aí não há o
    // que concluir.
    // No histórico também é nulo: dia passado não se conclui daqui.
    dia: semDia || somenteLeitura ? null : { identificador: l.dia_id, versao: Number(l.dia_versao) },
    fases: FASES.map((f) => ({
      identificador: f, rotulo: f === 'entrada' ? 'Entrada' : 'Saída', selecionada: f === fase,
    })),
    titulo: `Checklist de ${nomeFase}`,
    subtitulo: [
      data(quando),
      limite ? `limite ${hora(new Date(limite))}` : null,
      fase === 'entrada' && !somenteLeitura ? 'saída libera ao concluir' : null,
    ].filter(Boolean).join(' · '),
    perfil: l.eu_perfil,
    historico: ehAtendente(l.eu_perfil) ? null : {
      hoje: hojeEm(agora),
      selecionada: l.data_alvo,
      somenteLeitura,
      dias: (l.historico ?? []).map((d) => ({
        identificador: d.data,
        rotulo: rotuloDoDia(d.data),
        situacao: situacaoDoDia(d),
        selecionado: d.data === l.data_alvo,
      })),
    },
    perfis: [{ identificador: l.eu_perfil, rotulo: papel(l.eu_perfil), selecionado: true }],
    // Não há fila offline ainda (ADR 0011 §4): se esta resposta chegou, o que
    // ela mostra é o que o banco tem agora.
    sincronizacao: { rotulo: 'sincronizado', criticidade: 'normal' },
    progresso: {
      tratados: String(tratados),
      total: String(itens.length),
      percentual: itens.length === 0 ? '0%' : percentual(tratados, itens.length),
      corBarra: barra(tratados, itens.length),
    },
    erroConcluir: null,
    monitor: salasApresentadas.map((s) => ({
      identificador: s.identificador,
      nome: s.nome,
      contagem: s.contagem,
      percentual: percentual(s.feitos, s.itens.length),
      ultimaAtualizacao: s.ultima ? `última marcação ${hora(new Date(s.ultima))}` : 'nenhuma marcação ainda',
      corBarra: barra(s.feitos, s.itens.length),
    })),
    bloqueio,
    // Duas colunas, salas alternadas: é a distribuição do mockup, e mantém a
    // ordem de exibição dos estúdios lida de cima pra baixo, esquerda primeiro.
    // Bloqueada, a saída continua visível (o mockup mostra o que vem depois) e
    // só os toques ficam desligados.
    colunas: salasApresentadas.length === 0
      ? []
      : [0, 1].map((c) => ({
          identificador: c === 0 ? 'a' : 'b',
          salas: salasApresentadas
            .filter((_, indice) => indice % 2 === c)
            .map(({ ultima: _u, feitos: _f, ...sala }) => sala),
        })).filter((coluna) => coluna.salas.length > 0),
    nota: 'Item impossível de fazer é justificado com foto obrigatória (texto opcional) e conta para os 100%. “Marcar todos” exige confirmação e fica sinalizado no histórico como lote.',
    // Saída bloqueada não abre modal: os toques dela estão desligados, e a RPC
    // recusaria com LT002 de qualquer jeito. No histórico só abre o de leitura.
    modal: l.selecionado === null || saidaBloqueada
      || (somenteLeitura && !justificou(l.selecionado.estado))
      ? null : modalDe(l.selecionado, endereco, somenteLeitura),
  };
}

export function criarTelaChecklist(comSessao, config) {
  return async function checklist(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const fase = parametros.get('fase');
    const item = parametros.get('item');
    const dataPedida = parametros.get('data');
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [
        sessao.colaboradorId, agora.toISOString(), FASES.includes(fase) ? fase : null,
        UUID.test(item ?? '') ? item : null,
        dataValida(dataPedida ?? '') ? dataPedida : null,
      ]);
      return rows[0];
    });
    return montarChecklist(linha, agora, config);
  };
}

export { CONSULTA as CONSULTA_CHECKLIST };
