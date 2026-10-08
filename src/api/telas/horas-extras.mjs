// GET /tela/horas[?aba=pendentes|pagas|canceladas&periodo=mes|q1|q2] — spec/horas-extras.md.
//
// Devolve o `DadosHorasExtras` de src/app/src/telas/HorasExtras.tsx, no mês
// corrente de Maceió. Só lê: o valor é o congelado na linha (cópia do acréscimo
// da Comanda) e nunca é recalculado aqui.
//
// ⚠ Estado de interação no padrão: sem `lancamento`, histórico fechado, nenhum
// cancelamento aberto.
//
// ⚠ O Atendente vê só as dele. Isto é conveniência da consulta, não defesa: a
// policy de leitura de hora_extra é `using (true)` (0011), e quem nega pagar,
// cancelar e estornar é `app.exigir_admin` dentro da RPC (0063, 0065).
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { data, hora, iniciais, reais } from './formato.mjs';

const ABAS = { pendentes: 'pendente', pagas: 'paga', canceladas: 'cancelada' };
const PERIODOS = ['mes', 'q1', 'q2'];

const CONSULTA = `
with param as (
  select ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         date_trunc('month', ($2::timestamptz at time zone 'America/Maceio'))::date as mes,
         $3::text as status,
         $4::text as periodo
),
${CTE_EU},
faixa as (
  select case p.periodo when 'q2' then p.mes + 15 else p.mes end as de,
         case p.periodo when 'q1' then p.mes + 14
                        else (p.mes + interval '1 month' - interval '1 day')::date end as ate
    from param p
),
-- Quem o ator pode escolher no lançamento manual: o próprio para si, o Admin
-- por qualquer um (ADR 0061 §2). O Desenvolvedor não lança por outros, então
-- cai no mesmo ramo do Atendente.
destinatarios as (
  select c.id, c.nome, c.id = (select id from eu) as eu
    from colaborador c
   where c.ativo
     and (c.id = (select id from eu) or (select nivel_acesso from eu) = 'administrador')
),
-- Os ensaios a que o lançamento manual pode ligar (ADR 0083): o banco aceita o
-- do dia ou da véspera; a tela filtra pela data digitada. A janela cobre o
-- mês corrente e o anterior, que é até onde a Helena corrige.
ensaios as (
  select a.id, a.datetime_inicio_agendado, a.datetime_fim_agendado, a.cliente_nome,
         (a.datetime_inicio_agendado at time zone 'America/Maceio')::date as dia,
         cm.numero_sequencial as comanda
    from agendamento a
    cross join param p
    left join comanda cm on cm.id = a.comanda_id
   where not a.deleted
     and a.datetime_inicio_agendado >= ((p.mes - interval '1 month') at time zone 'America/Maceio')
     and a.datetime_inicio_agendado <  ((p.hoje + 2) at time zone 'America/Maceio')
),
registros as (
  select he.id, he.data, extract(dow from he.data)::int as dow,
         he.datetime_inicio, he.datetime_fim, he.origem, he.status, he.versao,
         he.blocos_noturnos, he.valor, he.valor_hora_snapshot, he.cruzou_janela,
         c.nome as colaborador,
         coalesce(cm.numero_sequencial, cma.numero_sequencial) as comanda,
         coalesce(cm.cliente_nome, ag.cliente_nome) as cliente,
         ag.datetime_inicio_agendado as ensaio_inicio, ag.datetime_fim_agendado as ensaio_fim,
         he.sem_ensaio_motivo,
         cr.nome as criado_por,
         he.pago_em, pg.nome as pago_por,
         he.cancelada_em, cn.nome as cancelada_por, he.cancelada_motivo
    from hora_extra he
    cross join param p
    cross join faixa f
    join colaborador c        on c.id = he.colaborador_id
    left join comanda cm      on cm.id = he.comanda_id
    left join agendamento ag  on ag.id = he.agendamento_id
    left join comanda cma     on cma.id = ag.comanda_id
    left join colaborador cr  on cr.id = he.criado_por_id
    left join colaborador pg  on pg.id = he.pago_por_id
    left join colaborador cn  on cn.id = he.cancelada_por_id
   where he.status = p.status
     and he.data between f.de and f.ate
     and ((select nivel_acesso from eu) <> 'atendente' or he.colaborador_id = (select id from eu))
)
select
  (select nome         from eu)                   as eu_nome,
  (select nivel_acesso from eu)                   as eu_perfil,
  (select mes::text from param)                   as mes,
  -- O predicado de app.acrescimo_noturno_vigente (0014), escrito aqui: a função
  -- é interna das RPC e o role da app não tem execute nela.
  (select an.valor from acrescimo_noturno an, param p
    where an.vigencia_inicio <= p.hoje and (an.vigencia_fim is null or an.vigencia_fim >= p.hoje)
    order by an.vigencia_inicio desc limit 1)     as acrescimo_vigente,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.data desc, r.datetime_inicio desc)
              from registros r), '[]'::jsonb)     as registros,
  coalesce((select jsonb_agg(to_jsonb(e) order by e.datetime_inicio_agendado)
              from ensaios e), '[]'::jsonb)       as ensaios,
  -- O próprio ator primeiro e marcado: a claim não leva o id do colaborador
  -- para o tablet, então quem diz "este é você" é a consulta.
  coalesce((select jsonb_agg(jsonb_build_object(
                     'identificador', d.id, 'rotulo', d.nome, 'eu', d.eu)
                             order by d.eu desc, d.nome)
              from destinatarios d), '[]'::jsonb) as destinatarios`;

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
  'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const ROTULO_STATUS = { pendente: 'Pendente', paga: 'Paga', cancelada: 'Cancelada' };
const PALAVRA = { pendente: ['pendente', 'pendentes'], paga: ['paga', 'pagas'], cancelada: ['cancelada', 'canceladas'] };

const VAZIO = {
  pendente: 'Nada pendente',
  paga: 'Nada pago neste período',
  cancelada: 'Nada cancelado neste período',
};

const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaMesFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
const quando = (ts) => `${diaMesFmt.format(new Date(ts))} ${hora(new Date(ts))}`;

// Estornar é só sobre paga; desfazer uma pendente é cancelar (ADR 0061 §3).
// Cancelada não tem saída pela tela: quem a revive é o descancelamento em
// cascata do refechamento, que não é gesto de dedo.
function acoesDe(status, ehAdmin) {
  if (!ehAdmin) return [];
  if (status === 'pendente') {
    return [
      { identificador: 'pagar', rotulo: 'Marcar paga', principal: true },
      { identificador: 'cancelar', rotulo: 'Cancelar' },
    ];
  }
  if (status === 'paga') return [{ identificador: 'estornar', rotulo: 'Estornar' }];
  return [];
}

function historico(r) {
  const linhas = [r.origem === 'manual'
    ? `Lançada por ${r.criado_por ?? 'alguém sem registro'}`
    : 'Criada pelo sistema no fechamento da comanda'];
  if (r.pago_em) linhas.push(`Paga por ${r.pago_por ?? '—'} · ${quando(r.pago_em)}`);
  if (r.cancelada_em) {
    linhas.push(`Cancelada ${r.cancelada_por ? `por ${r.cancelada_por}` : 'pelo sistema'} · ${quando(r.cancelada_em)}`
      + (r.cancelada_motivo ? ` · motivo: ${r.cancelada_motivo}` : ''));
  }
  return linhas;
}

// De onde a hora extra veio, para a Helena conferir (ADR 0083): a comanda e o
// cliente; na manual, também o horário do ensaio. Manual antiga não tem nada.
function detalheDe(r) {
  const ensaio = r.ensaio_inicio
    ? `Ensaio ${hora(new Date(r.ensaio_inicio))}–${hora(new Date(r.ensaio_fim))}`
    : '';
  const partes = [
    ensaio,
    r.cliente ?? '',
    r.comanda !== null ? `Comanda #${r.comanda}` : (ensaio ? 'sem comanda' : ''),
  ].filter(Boolean);
  if (partes.length > 0) return partes.join(' · ');
  return r.sem_ensaio_motivo ? 'Sem ensaio' : 'Lançamento manual';
}

const rotuloDoEnsaio = (e) => [
  `${hora(new Date(e.datetime_inicio_agendado))}–${hora(new Date(e.datetime_fim_agendado))}`,
  e.cliente_nome,
  e.comanda !== null ? `Comanda #${e.comanda}` : 'sem comanda',
].join(' · ');

export function montarHorasExtras(linha, agora, aba = 'pendentes', periodo = 'mes') {
  exigirColaborador(linha);
  const l = linha;
  const abaAtual = Object.hasOwn(ABAS, aba) ? aba : 'pendentes';
  const status = ABAS[abaAtual];
  const periodoAtual = PERIODOS.includes(periodo) ? periodo : 'mes';
  const atendente = ehAtendente(l.eu_perfil);
  // Pagar e cancelar: só Admin. O Desenvolvedor não — é ação de negócio (spec).
  const ehAdmin = l.eu_perfil === 'administrador';

  const mes = new Date(`${l.mes}T00:00:00Z`);
  const ultimoDia = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0)).getUTCDate();
  const abrev = MESES[mes.getUTCMonth()].slice(0, 3).toLowerCase();

  const registros = l.registros.map((r) => ({
    identificador: r.id,
    versao: r.versao,
    // Domingo é extra desde o início do ensaio (spec): vale dizer na linha.
    data: r.dow === 0 ? `${ddmm(r.data)} · domingo` : ddmm(r.data),
    intervalo: `${hora(new Date(r.datetime_inicio))} – ${hora(new Date(r.datetime_fim))}`,
    colaborador: r.colaborador,
    origem: r.origem === 'manual' ? 'Manual' : 'Sistema',
    detalhe: detalheDe(r),
    valor: reais(r.valor),
    blocos: `${r.blocos_noturnos} ${r.blocos_noturnos === 1 ? 'bloco' : 'blocos'}`,
    status: ROTULO_STATUS[r.status],
    destaque: r.status,
    acoes: acoesDe(r.status, ehAdmin),
    avisos: [
      ...(r.cruzou_janela
        ? [{ texto: 'cruzou janela de posse · conferir com a administração', destaque: 'atencao' }]
        : []),
      ...(r.sem_ensaio_motivo
        ? [{ texto: `sem ensaio ligado · motivo: ${r.sem_ensaio_motivo}`, destaque: 'atencao' }]
        : []),
    ],
    historicoAberto: false,
    historico: historico(r),
    valorHora: reais(r.valor_hora_snapshot),
    acrescimoNoturno: reais(r.valor),
  }));

  const porPessoa = new Map();
  for (const r of l.registros) {
    const atual = porPessoa.get(r.colaborador) ?? { soma: 0, n: 0 };
    porPessoa.set(r.colaborador, { soma: atual.soma + Number(r.valor), n: atual.n + 1 });
  }
  const [um, varios] = PALAVRA[status];
  const totais = [...porPessoa].map(([colaborador, { soma, n }]) => ({
    colaborador,
    valor: reais(soma),
    detalhe: `${n} ${n === 1 ? `extra ${um}` : `extras ${varios}`}`,
  }));

  return {
    hora: hora(agora),
    data: data(agora),
    turno: iniciais(l.eu_nome),
    subtitulo: atendente
      ? 'Suas horas extras. A Helena paga por fora e marca cada uma individualmente.'
      : 'Criadas no fechamento da comanda ou lançadas à mão. Pagar e cancelar são ações suas.',
    // Lançamento manual é do colaborador (spec: "colaborador lança").
    podeLancar: true,
    destinatarios: l.destinatarios,
    ensaios: (l.ensaios ?? []).map((e) => ({
      identificador: e.id, data: e.dia, rotulo: rotuloDoEnsaio(e),
      // O app sugere o ensaio que encosta no horário digitado.
      inicio: hora(new Date(e.datetime_inicio_agendado)), fim: hora(new Date(e.datetime_fim_agendado)),
    })),
    abas: Object.keys(ABAS).map((a) => ({
      identificador: a, rotulo: a[0].toUpperCase() + a.slice(1), selecionada: a === abaAtual,
    })),
    periodos: [
      { identificador: 'mes', rotulo: MESES[mes.getUTCMonth()], selecionado: periodoAtual === 'mes' },
      { identificador: 'q1', rotulo: `1 – 15 ${abrev}`, selecionado: periodoAtual === 'q1' },
      { identificador: 'q2', rotulo: `16 – ${ultimoDia} ${abrev}`, selecionado: periodoAtual === 'q2' },
    ],
    totalPeriodo: reais(l.registros.reduce((s, r) => s + Number(r.valor), 0)),
    totais,
    registros,
    vazioTitulo: VAZIO[status],
    vazioDescricao: atendente && status === 'pendente'
      ? 'Você não tem hora extra esperando pagamento.'
      : 'Nenhum registro neste recorte.',
    rodape: l.acrescimo_vigente === null
      ? 'O valor é cópia do acréscimo da comanda e nunca é recalculado. Refechamento cancela e cria nova, notificando as pessoas envolvidas.'
      : `O valor é cópia do acréscimo da comanda (${reais(l.acrescimo_vigente)} por bloco noturno) e nunca é recalculado. Refechamento cancela e cria nova, notificando as pessoas envolvidas.`,
  };
}

export function criarTelaHorasExtras(comSessao) {
  return async function horasExtras(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const aba = Object.hasOwn(ABAS, parametros.get('aba') ?? '') ? parametros.get('aba') : 'pendentes';
    const periodo = PERIODOS.includes(parametros.get('periodo')) ? parametros.get('periodo') : 'mes';
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [
        sessao.colaboradorId, agora.toISOString(), ABAS[aba], periodo,
      ]);
      return rows[0];
    });
    return montarHorasExtras(linha, agora, aba, periodo);
  };
}

export { CONSULTA as CONSULTA_HORAS_EXTRAS };
