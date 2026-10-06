// GET /tela/home — o início da operação (ADR 0042 §2).
//
// Devolve o `DadosHome` de src/app/src/telas/Home.tsx. O centro da tela é a grade
// da Altegio: uma coluna por estúdio, horário na vertical — porque dois ensaios
// ao mesmo tempo em estúdios diferentes é o dia normal, e um "próximo ensaio"
// único escondia os outros. A lateral é a rotina: comandas, avisos, checklist,
// estoque e os atalhos de consulta.
//
// ⚠ A observação do ensaio que aparece no mockup NÃO é devolvida: não há coluna
// para ela, e nenhum payload real guardado confirma em que campo da Altegio ela
// chega. Não se inventa nome de campo de payload (CLAUDE.md).
import { tituloETexto } from './avisos.mjs';
import { CTE_EU, exigirColaborador } from './colaborador.mjs';
import { data, hora, iniciais, percentual, saudacao } from './formato.mjs';

const CONSULTA = `
with param as (
  select $2::timestamptz as agora,
         ($2::timestamptz at time zone 'America/Maceio')::date as hoje
),
-- O "and c.ativo" do CTE_EU é o que faz a claim de quem foi desativado parar de
-- montar a tela (PR #81).
${CTE_EU},
turno as (
  select * from app.turno_vigente((select agora from param)) limit 1
),
estudios as (
  select id, nome, ordem_exibicao from estudio where ativo
),
-- O expediente do dia da semana: da primeira abertura ao último fim de turno.
-- Domingo só tem o turno 'extra', sem horário próprio — a grade então se ajusta
-- aos ensaios (ver montarAgenda).
expediente as (
  select min(td.hora_inicio) as abre, max(td.hora_fim) as fecha
    from turno_definicao td cross join param p
   where td.turno <> 'extra'
     and td.dia_semana = extract(dow from p.hoje)
     and td.vigencia_inicio <= p.hoje
     and (td.vigencia_fim is null or td.vigencia_fim >= p.hoje)
),
-- Só ensaio: tipo_staff 'nao_operacional' é bloqueio de agenda do Wyll
-- (ADR 0005, segundo balde) e não é sessão de ninguém.
--
-- fim é o fim do ENSAIO (datetime_fim_agendado = início + duração, 0023); o
-- bloqueio da Altegio é o seance_length inteiro, e a diferença é a arrumação.
agenda as (
  select a.id, a.estudio_id, a.cliente_nome, a.servico_titulo,
         a.datetime_inicio_agendado as inicio,
         a.datetime_fim_agendado    as fim,
         a.datetime_inicio_agendado + make_interval(secs => a.seance_length_segundos) as fim_bloqueio,
         a.duracao_nao_tabelada, a.duracao_invalida,
         cm.status as comanda_status, cm.id as comanda_id
    from agendamento a
    cross join param p
    left join comanda cm on cm.agendamento_id = a.id
   where not a.deleted
     and a.tipo_staff = 'operacional'
     and (a.datetime_inicio_agendado at time zone 'America/Maceio')::date = p.hoje
),
-- "abertas" é o estado do sistema, não do dia: uma Comanda de ontem que ficou
-- aberta continua aberta, e esconder isso seria esconder o que pede gesto.
comandas as (
  select count(*) filter (where c.status = 'aberta') as abertas,
         count(*) filter (where c.status in ('fechada','enviada')
                            and (c.fechado_em at time zone 'America/Maceio')::date = p.hoje) as fechadas_hoje
    from param p left join comanda c on true
),
chk as (
  select cd.id,
         case when cd.status_entrada = 'pendente' then 'entrada' else 'saida' end as fase,
         case when cd.status_entrada = 'pendente' then cd.limite_entrada else cd.limite_saida end as limite
    from checklist_dia cd cross join param p
   where cd.data = app.checklist_dia_vigente(p.agora)  -- ADR 0087
),
chk_itens as (
  select ie.id, ie.versao, coalesce(ie.nome_snapshot, ic.nome) as nome,
         coalesce(ie.acao_snapshot, ic.acao) as acao,
         ie.estado, coalesce(ic.ordem, 0) as ordem
    from item_execucao ie
    join chk on chk.id = ie.checklist_dia_id and ie.fase = chk.fase
    left join item_catalogo ic on ic.id = ie.item_catalogo_id
),
-- Criticidade DERIVADA da quantidade contada: 0 urgente · 1 atenção (ADR 0017).
-- conferido_em nulo é neutro — não conferido não é falta (estoque.md:89).
est as (
  select count(*) filter (where conferido_em is not null and quantidade = 0) as zerados,
         count(*) filter (where conferido_em is not null and quantidade = 1) as atencao,
         count(*)                                                            as total
    from item_estoque where ativo
),
avisos as (
  select a.id, a.texto, a.prioridade, a.criado_em, c.nome as autor
    from aviso a join colaborador c on c.id = a.autor_id
   where a.status = 'ativo'
),
-- Sem relógio próprio: o rótulo sai dos estados da fila do ADR 0021.
sinc as (
  select max(processado_em)                         as ultimo,
         count(*) filter (where status = 'pendente') as pendentes,
         count(*) filter (where status = 'parada')   as paradas
    from webhook_evento
)
select
  (select nome         from eu)                                as eu_nome,
  (select nivel_acesso from eu)                                as eu_perfil,
  (select turno from turno)                                    as turno,
  (select abre::text  from expediente)                         as expediente_abre,
  (select fecha::text from expediente)                         as expediente_fecha,
  (select abertas       from comandas)                         as comandas_abertas,
  (select fechadas_hoje from comandas)                         as comandas_fechadas_hoje,
  (select fase   from chk)                                     as checklist_fase,
  (select limite from chk)                                     as checklist_limite,
  (select count(*) from chk_itens)                             as checklist_total,
  (select count(*) from chk_itens
    where estado in ('feito', 'nao_feito_justificado'))     as checklist_feitos,
  (select zerados from est)                                    as estoque_zerados,
  (select atencao from est)                                    as estoque_atencao,
  (select total   from est)                                    as estoque_total,
  (select count(*) from avisos)                                as avisos_total,
  (select ultimo    from sinc)                                 as sinc_ultimo,
  (select pendentes from sinc)                                 as sinc_pendentes,
  (select paradas   from sinc)                                 as sinc_paradas,
  (select count(*) from turno_escalado te cross join param p
    where te.data between date_trunc('week', p.hoje)::date
                      and date_trunc('week', p.hoje)::date + 6) as escala_semana,
  (select count(*) from hora_extra where status = 'pendente')   as horas_pendentes,
  (select count(*) from achado
    where status in ('aguardando_foto','em_posse','pronto_para_doacao')) as achados_guardados,
  (select count(*) from tutorial where status = 'publicado')    as tutoriais,
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by ordem_exibicao, nome)
              from estudios), '[]'::jsonb)                     as estudios,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'estudio', estudio_id, 'inicio', inicio, 'fim', fim, 'fim_bloqueio', fim_bloqueio,
      'cliente', cliente_nome, 'servico', servico_titulo, 'comanda_status', comanda_status,
      'comanda_id', comanda_id, 'duracao_nao_tabelada', duracao_nao_tabelada,
      'duracao_invalida', duracao_invalida)
      order by inicio) from agenda), '[]'::jsonb)              as agenda,
  -- Pendentes primeiro: é o que a pessoa vai tocar.
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'nome', nome, 'acao', acao, 'estado', estado, 'versao', versao) order by (estado <> 'nao_marcado'), ordem, nome)
      from (select * from chk_itens order by (estado <> 'nao_marcado'), ordem limit 4) x),
      '[]'::jsonb)                                             as checklist_itens,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'texto', texto, 'prioridade', prioridade, 'criado_em', criado_em, 'autor', autor)
      order by case prioridade when 'urgente' then 0 else 1 end, criado_em desc)
      from (select * from avisos order by case prioridade when 'urgente' then 0 else 1 end, criado_em desc limit 3) x),
      '[]'::jsonb)                                             as avisos`;

const TURNO_NOME = { manha: 'Turno da manhã', tarde_noite: 'Turno da tarde/noite', extra: 'Turno extra' };

const ROTULO_COMANDA = {
  sem_comanda: 'Sem comanda',
  aberta: 'Comanda aberta',
  fechada: 'Comanda fechada',
  enviada: 'Comanda enviada',
  paga: 'Comanda paga',
  cancelada: 'Comanda cancelada',
};

const diaMesFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// 'HH:MM' do fuso de Maceió para minutos do dia — a conta da grade.
const minutosDe = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Quando o ensaio está perto, o bloco diz: 'agora' durante, 'em N min' na hora
// que antecede. Fora disso a própria grade já diz onde ele está.
function relogioDo(ensaio, agora) {
  const inicio = new Date(ensaio.inicio).getTime();
  const fim = new Date(ensaio.fim).getTime();
  const t = agora.getTime();
  if (t >= inicio && t < fim) return 'agora';
  const faltam = Math.round((inicio - t) / 60_000);
  if (faltam > 0 && faltam <= 60) return `em ${faltam} min`;
  return undefined;
}

// "Criar comanda" é a aresta gerar_manual, que comanda.md:41 bloqueia nesses
// dois casos: o bloco sem botão diz por quê, em vez de oferecer o que o banco
// recusaria.
function comandaDo(a) {
  const status = a.comanda_status ?? 'sem_comanda';
  const bloqueio = a.duracao_nao_tabelada ? 'duração não tabelada'
    : a.duracao_invalida ? 'duração inválida' : null;
  const semComanda = status === 'sem_comanda';
  return {
    status,
    rotulo: semComanda && bloqueio ? `Sem comanda · ${bloqueio}` : ROTULO_COMANDA[status] ?? status,
    identificador: a.comanda_id ?? null,
    podeAbrir: semComanda && bloqueio === null,
  };
}

function montarAgenda(l, agora) {
  const ensaios = l.agenda.map((a) => {
    const relogio = relogioDo(a, agora);
    return {
      identificador: a.id,
      estudio: a.estudio,
      inicio: hora(new Date(a.inicio)),
      fim: hora(new Date(a.fim)),
      fimBloqueio: hora(new Date(a.fim_bloqueio)),
      cliente: a.cliente,
      servico: a.servico,
      ...(relogio ? { relogio } : {}),
      terminou: new Date(a.fim).getTime() <= agora.getTime(),
      comanda: comandaDo(a),
    };
  });

  // A grade vai do expediente do dia, alargada para caber qualquer ensaio fora
  // dele (e é só o ensaio que define o domingo, que não tem horário de turno).
  // Hora cheia nas duas pontas: a grade é lida de hora em hora.
  const inicios = ensaios.map((e) => minutosDe(e.inicio));
  const fins = ensaios.map((e) => {
    const m = minutosDe(e.fimBloqueio);
    // Bloqueio que passa da meia-noite volta no relógio; a grade fecha no fim do dia.
    return m < minutosDe(e.inicio) ? 24 * 60 : m;
  });
  const abre = Math.floor(Math.min(
    l.expediente_abre ? minutosDe(l.expediente_abre) : 8 * 60, ...inicios) / 60) * 60;
  const fecha = Math.min(24 * 60, Math.ceil(Math.max(
    l.expediente_fecha ? minutosDe(l.expediente_fecha) : 18 * 60, ...fins) / 60) * 60);

  const agoraMin = minutosDe(hora(agora));
  const ocupados = new Set(ensaios.map((e) => e.estudio)).size;

  return {
    resumo: ensaios.length === 0
      ? 'Nenhum ensaio hoje'
      : `${plural(ensaios.length, 'ensaio', 'ensaios')} · ${plural(ocupados, 'estúdio ocupado', 'estúdios ocupados')}`,
    estudios: l.estudios.map((e) => ({ identificador: e.id, nome: e.nome })),
    abre: hhmm(abre),
    fecha: fecha === 24 * 60 ? '24:00' : hhmm(fecha),
    agora: agoraMin >= abre && agoraMin <= fecha ? hora(agora) : null,
    ensaios,
  };
}

function montarChecklist(l) {
  if (l.checklist_fase === null) return null;
  const total = Number(l.checklist_total);
  const feitos = Number(l.checklist_feitos);
  const faltam = total - feitos;
  return {
    titulo: `Checklist de ${l.checklist_fase === 'saida' ? 'saída' : 'entrada'}`,
    progresso: total === 0
      ? 'Catálogo não configurado' // ADR 0030: nunca lista vazia sem dizer por quê
      : `${feitos} de ${total} itens`
        + (l.checklist_limite === null ? '' : ` · limite ${hora(new Date(l.checklist_limite))}`),
    percentual: total === 0 ? '0%' : percentual(feitos, total),
    criticidade: faltam === 0 ? 'normal' : l.checklist_fase === 'entrada' ? 'urgente' : 'atencao',
    itens: l.checklist_itens.map((i) => ({
      identificador: i.id,
      versao: i.versao,
      texto: [i.nome ?? 'Item sem nome', i.acao].filter(Boolean).join(' · '),
      marcado: i.estado === 'feito' || i.estado === 'nao_feito_justificado',
      // Justificado (com ou sem a foto ainda) só muda pelo modal da tela do Checklist.
      podeTratar: i.estado === 'nao_marcado' || i.estado === 'feito',
    })),
  };
}

function montarEstoque(l) {
  if (Number(l.estoque_total) === 0) return null;
  const zerados = Number(l.estoque_zerados);
  const atencao = Number(l.estoque_atencao);
  return {
    resumo: zerados + atencao === 0
      ? 'nada em falta'
      : [zerados > 0 ? plural(zerados, 'zerado', 'zerados') : null,
        atencao > 0 ? `${atencao} na última unidade` : null].filter(Boolean).join(' · '),
    criticidade: zerados > 0 ? 'urgente' : atencao > 0 ? 'atencao' : 'normal',
  };
}

function quandoDoAviso(criadoEm, agora) {
  const d = new Date(criadoEm);
  const dia = diaMesFmt.format(d);
  const rotulo = dia === diaMesFmt.format(agora) ? 'hoje'
    : dia === diaMesFmt.format(new Date(agora.getTime() - 86_400_000)) ? 'ontem' : dia;
  return `${rotulo} ${hora(d)}`;
}

function rotuloSincronizacao(l) {
  if (Number(l.sinc_paradas) > 0) return 'bandeja travada';
  if (Number(l.sinc_pendentes) > 0) return 'processando';
  if (l.sinc_ultimo === null) return 'sem eventos';
  return 'sincronizado';
}

export function montarHome(linha, agora, config) {
  exigirColaborador(linha);
  const l = linha;
  const agenda = montarAgenda(l, agora);
  const total = agenda.ensaios.length;
  const horasPendentes = Number(l.horas_pendentes);

  return {
    hora: hora(agora),
    turno: iniciais(l.eu_nome),
    data: data(agora),
    saudacao: saudacao(agora, l.eu_nome),
    turnoResumo: `${l.eu_perfil === 'atendente' ? (TURNO_NOME[l.turno] ?? 'Fora de turno') : 'Visão de toda a operação'} · ${plural(total, 'ensaio', 'ensaios')} hoje`,
    sincronizacao: {
      rotulo: rotuloSincronizacao(l),
      hora: l.sinc_ultimo === null ? '--:--' : hora(new Date(l.sinc_ultimo)),
    },
    agenda,
    comandas: { abertas: String(l.comandas_abertas), fechadasHoje: String(l.comandas_fechadas_hoje) },
    avisos: {
      contador: String(l.avisos_total),
      itens: l.avisos.map((a) => ({
        identificador: a.id,
        ...tituloETexto(a.texto),
        meta: `${a.autor} · ${quandoDoAviso(a.criado_em, agora)}`,
        urgente: a.prioridade === 'urgente',
      })),
    },
    checklist: montarChecklist(l),
    estoque: montarEstoque(l),
    consultas: [
      { identificador: 'escala', nome: 'Escala', nota: `${l.escala_semana} na semana` },
      {
        identificador: 'horas', nome: 'Horas extras',
        nota: plural(horasPendentes, 'pendente', 'pendentes'),
        // O badge só existe quando há o que resolver.
        ...(horasPendentes > 0 ? { destaque: String(horasPendentes) } : {}),
      },
      { identificador: 'achados', nome: 'Achados', nota: `${l.achados_guardados} guardados` },
      // "vídeos" no mockup antigo, mas vídeo está fora do MVP (spec/treinamento.md).
      { identificador: 'treinamento', nome: 'Treinamento', nota: `${l.tutoriais} tutoriais` },
    ],
    rodape: `${config.local} · ${config.dispositivo} · v${config.versao}`,
  };
}

export function criarTelaHome(comSessao, config) {
  return async function home(sessao, _parametros, agora = new Date()) {
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [sessao.colaboradorId, agora.toISOString()]);
      return rows[0];
    });
    return montarHome(linha, agora, config);
  };
}

export { CONSULTA as CONSULTA_HOME };
