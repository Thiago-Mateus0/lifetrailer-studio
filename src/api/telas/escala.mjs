// GET /tela/escala[?visao=calendario|padroes&revisar=<turno>] — spec/escala.md.
//
// Devolve o `DadosEscala` de src/app/src/telas/Escala.tsx: quatro semanas a
// partir da segunda-feira desta semana (o gerador mantém hoje+28, ADR 0029) e
// os padrões que regem amanhã.
//
// ⚠ Estado de interação no padrão: `editando` falso e sem ações por turno. O
// modo de edição é rascunho do cliente: o servidor manda, em cada turno
// editável, o que a troca precisa (`edicao`) e a `equipe` que pode cobrir.
// "Veio" (ADR 0079) é botão do turno, fora do modo de edição: a própria pessoa
// no dia, o Admin em qualquer dia até hoje. Quem confere é a função.
//
// ⚠ A REVISÃO da âncora é recorte, como o formulário dos Achados (`?registrar=1`):
// `?revisar=<turno>` monta a proposta (girar a âncora uma posição) e a lista das
// trocas que ela afeta, lida de app.escala_padrao_afetados. Decidir cada troca é
// rascunho do cliente; o que vai ao banco é a proposta inteira, numa chamada.
//
// ⚠ O domingo extra tem gesto próprio, fora do modo de edição. O botão nasce com
// uma pessoa — você, se for Atendente; senão o primeiro da equipe — e "outra
// pessoa" percorre os Atendentes ativos, como a troca faz no calendário. O
// segundo toque, no "Assumir · <nome>", é que grava (ADR 0060). A fila de rodízio
// do mockup não entrou: escala.md diz que o rodízio é SUGESTÃO, e a regra da fila
// não existe — quem escolhe é quem está na tela.
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { data, hora, iniciais } from './formato.mjs';

const VISOES = ['calendario', 'padroes'];

const CONSULTA = `
with param as (
  select ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         ($2::timestamptz at time zone 'America/Maceio')::date + 1 as amanha,
         date_trunc('week', ($2::timestamptz at time zone 'America/Maceio')::date)::date as inicio,
         $3::text as revisar
),
${CTE_EU},
dias as (
  select g::date as data from param p, generate_series(p.inicio, p.inicio + 27, interval '1 day') g
),
-- O horário que vale é o do snapshot quando existe (turno alterado guarda o
-- dele); senão o da definição vigente naquele dia da semana.
turnos as (
  select te.id, te.versao, te.data, te.turno, te.tipo_registro,
         te.colaborador_id, te.substituido_colaborador_id, te.presenca_colaborador_id,
         c.nome as colaborador, s.nome as substituido,
         coalesce(te.hora_inicio_snapshot, td.hora_inicio)    as inicio,
         coalesce(te.hora_fim_snapshot, td.hora_fim) as fim
    from turno_escalado te
    join dias d on d.data = te.data
    left join colaborador c on c.id = te.colaborador_id
    left join colaborador s on s.id = te.substituido_colaborador_id
    left join lateral (
      select td.hora_inicio, td.hora_fim from turno_definicao td
       where td.turno = te.turno and td.dia_semana = extract(dow from te.data)
         and td.vigencia_inicio <= te.data and (td.vigencia_fim is null or td.vigencia_fim >= te.data)
       order by td.vigencia_inicio desc limit 1) td on true
),
-- O padrao que rege AMANHA, nao o de hoje: e ele que a revisao altera (0062),
-- e depois de uma revisao os dois sao diferentes. Hoje ja esta congelado.
padroes as (
  select pe.turno, pe.tipo_atribuicao, pe.versao, pe.vigencia_inicio, pe.dias_aplicaveis,
         pe.ancora_data, pe.colaboradores as ids, a.nome as ancora_nome,
         -- "Inverter a ancora" e mover o dono dela uma posicao no array: com duas
         -- pessoas da a inversao do mockup; com tres, gira um dia. E o unico
         -- gesto que a tela dos Padroes oferece — trocar o array nao tem campo.
         pe.colaboradores[(coalesce(array_position(pe.colaboradores, pe.ancora_colaborador_id), 1)
                           % cardinality(pe.colaboradores)) + 1] as ancora_proxima,
         (select nome from colaborador c
           where c.id = pe.colaboradores[(coalesce(array_position(pe.colaboradores,
                                                                  pe.ancora_colaborador_id), 1)
                                          % cardinality(pe.colaboradores)) + 1]) as ancora_proxima_nome,
         (select jsonb_agg(c.nome order by array_position(pe.colaboradores, c.id))
            from colaborador c where c.id = any (pe.colaboradores)) as colaboradores,
         (select jsonb_agg(jsonb_build_object('dia', td.dia_semana, 'inicio', td.hora_inicio,
                                              'fim', td.hora_fim) order by td.dia_semana)
            from turno_definicao td
           where td.turno = pe.turno and td.dia_semana = any (pe.dias_aplicaveis)
             and td.vigencia_inicio <= p.amanha
             and (td.vigencia_fim is null or td.vigencia_fim >= p.amanha)) as horarios
    from padrao_escala pe
    cross join param p
    left join colaborador a on a.id = pe.ancora_colaborador_id
   where pe.vigencia_inicio <= p.amanha and (pe.vigencia_fim is null or pe.vigencia_fim >= p.amanha)
),
-- A revisao so existe pra quem pode revisar, so no padrao alternado e so com
-- mais de uma pessoa no array: o servidor nao monta o que ele mesmo recusaria
-- (com uma pessoa so, girar a ancora nao muda nada e a funcao levanta LT003).
revisao as (
  select pd.* from padroes pd, param p, eu
   where pd.turno = p.revisar and pd.tipo_atribuicao = 'alternado_diario'
     and cardinality(pd.ids) > 1
     and eu.nivel_acesso in ('administrador', 'desenvolvedor')
),
afetados as (
  select a.* from revisao r
   cross join lateral app.escala_padrao_afetados(r.turno, r.ids, r.ancora_data, r.ancora_proxima) a
)
select
  (select id::text     from eu)    as eu_id,
  (select nome         from eu)    as eu_nome,
  (select nivel_acesso from eu)    as eu_perfil,
  -- Texto, não date: o driver pg converte date em Date na meia-noite LOCAL do
  -- processo, e num servidor em UTC isso muda o dia.
  (select hoje::text   from param) as hoje,
  (select inicio::text from param) as inicio,
  coalesce((select jsonb_agg(to_jsonb(t) order by t.data, t.turno) from turnos t), '[]'::jsonb) as turnos,
  coalesce((select jsonb_agg(to_jsonb(pd) order by pd.turno) from padroes pd), '[]'::jsonb)     as padroes,
  -- Quem pode cobrir um turno numa troca (0060): Atendente ativo.
  coalesce((select jsonb_agg(jsonb_build_object('identificador', c.id, 'nome', c.nome) order by c.nome)
              from colaborador c where c.ativo and c.nivel_acesso = 'atendente'), '[]'::jsonb) as equipe,
  -- Nulo quando a revisao nao foi pedida OU nao e desta pessoa: a lista vazia
  -- de afetadas e outra coisa — e uma revisao que pode ser confirmada direto.
  (select turno from revisao) as revisao_turno,
  coalesce((select jsonb_agg(jsonb_build_object(
      'turno_id', a.turno_id, 'versao', a.versao, 'data', a.data::text,
      'tipo_registro', a.tipo_registro,
      'colaborador',   (select nome from colaborador c where c.id = a.colaborador_id),
      'titular_atual', (select nome from colaborador c where c.id = a.titular_atual),
      'titular_novo',  (select nome from colaborador c where c.id = a.titular_novo))
      order by a.data) from afetados a), '[]'::jsonb) as afetados`;

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const SEMANA_TITULO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const ROTULO_TURNO = { manha: 'Manhã', tarde_noite: 'Tarde/noite', extra: 'Extra domingo' };
const ORDEM_TURNO = { manha: 0, tarde_noite: 1, extra: 2 };

const DESTAQUE = { padrao: 'padrao', troca: 'troca', extra_domingo: 'extra', ausencia: 'ausencia' };

// Datas do banco chegam como 'YYYY-MM-DD'; montar a Date em UTC evita que o fuso
// do servidor mude o dia da semana.
const diaUtc = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const somarDias = (d, n) => new Date(d.getTime() + n * 86_400_000);
const iso = (d) => d.toISOString().slice(0, 10);
const ddmmaaaa = (valor) => { const [a, m, d] = valor.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

// '08:00:00' → '08'; '09:30:00' → '09:30'. É o horário curto do calendário.
const horaCurta = (t) => (t.slice(3, 5) === '00' ? t.slice(0, 2) : t.slice(0, 5));

function diasAplicaveis(dias) {
  const ordenados = [...dias].sort((a, b) => a - b);
  const seguidos = ordenados.every((d, i) => i === 0 || d === ordenados[i - 1] + 1);
  if (ordenados.length > 2 && seguidos) {
    return `${SEMANA_TITULO[ordenados[0]]} a ${SEMANA[ordenados.at(-1)]}`;
  }
  return ordenados.map((d) => SEMANA[d]).join(', ');
}

// O horário mais comum é a regra; o dia que foge dela vira exceção escrita.
// '14:00 – 23:00 · sábado até 18:00'.
function horarioDoPadrao(horarios) {
  if (!horarios?.length) return 'horário não definido';
  const contagem = new Map();
  for (const h of horarios) {
    const chave = `${h.inicio}|${h.fim}`;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  const [regra] = [...contagem].sort((a, b) => b[1] - a[1])[0];
  const [inicio, fim] = regra.split('|');
  const excecoes = horarios
    .filter((h) => `${h.inicio}|${h.fim}` !== regra)
    .map((h) => (h.inicio === inicio ? `${SEMANA[h.dia]} até ${h.fim.slice(0, 5)}` : `${SEMANA[h.dia]} ${h.inicio.slice(0, 5)} – ${h.fim.slice(0, 5)}`));
  return [`${inicio.slice(0, 5)} – ${fim.slice(0, 5)}`, ...excecoes].join(' · ');
}

// O que o rascunho da edição precisa para trocar sem ida ao servidor. Só dia
// futuro e fora do domingo extra: é o que o modo de edição oferece (mockup;
// hoje e passado são do Admin no banco, e não têm botão).
function edicaoDoTurno(t, hoje) {
  if (t.turno === 'extra' || t.data.slice(0, 10) <= hoje) return undefined;
  if (!['padrao', 'troca', 'ausencia'].includes(t.tipo_registro)) return undefined;
  const padrao = t.tipo_registro === 'padrao';
  return {
    identificador: t.id,
    versao: t.versao,
    tipo: t.tipo_registro,
    atual: t.colaborador_id ?? null,
    titular: (padrao ? t.colaborador_id : t.substituido_colaborador_id) ?? null,
    titularNome: (padrao ? t.colaborador : t.substituido) ?? null,
  };
}

// A marca é de quem veio: depois de uma troca, quem cobre não a herda (0085).
function presencaDoTurno(t, hoje, eu) {
  if (t.colaborador_id === null || t.data.slice(0, 10) > hoje) return undefined;
  const veio = t.presenca_colaborador_id === t.colaborador_id;
  const pode = eu.perfil === 'administrador' || (eu.id === t.colaborador_id && t.data.slice(0, 10) === hoje);
  if (!pode && !veio) return undefined;
  return {
    acao: { identificador: 'veio', rotulo: veio ? 'veio ✓' : 'marcar que veio', selecionada: veio, ...(pode ? {} : { desativada: true }) },
    presenca: { identificador: t.id, colaborador: t.colaborador_id, veio },
  };
}

function turnoApresentado(t, hoje, eu) {
  const destaque = DESTAQUE[t.tipo_registro] ?? 'padrao';
  const edicao = edicaoDoTurno(t, hoje);
  const presenca = presencaDoTurno(t, hoje, eu);
  const base = {
    turno: t.turno,
    rotulo: ROTULO_TURNO[t.turno] ?? t.turno,
    horario: t.inicio && t.fim ? `${horaCurta(t.inicio)}–${horaCurta(t.fim)}` : '—',
    // Turno sem atribuição é permitido (0004) e alerta o Admin: dizer isso na tela.
    colaborador: t.colaborador ?? 'Não atribuído',
    destaque,
    acoes: presenca ? [presenca.acao] : [],
    ...(edicao ? { edicao } : {}),
    ...(presenca ? { presenca: presenca.presenca } : {}),
  };
  if (destaque === 'troca') return { ...base, selo: 'troca', ...(t.substituido ? { nota: `cobre ${t.substituido}` } : {}) };
  if (destaque === 'ausencia') return { ...base, selo: 'ausência', ...(t.substituido ? { nota: `${t.substituido} ausente` } : {}) };
  if (destaque === 'extra') return { ...base, selo: 'extra' };
  return base;
}

const ddmm = (valor) => valor.slice(8, 10) + '/' + valor.slice(5, 7);
const primeiroNome = (nome) => nome.split(' ')[0];

// A revisão da âncora (migrations 0062 e 0064). `descricao` diz o que a proposta
// muda, `afetadas` é a lista que exige decisão e `alteracao` é o corpo que o
// Confirmar manda de volta — o cliente só acrescenta a decisão de cada uma.
//
// Troca e falta afetadas recebem os mesmos dois botões (ADR 0059): a falta tem o
// mesmo problema da troca, e "manter" nela é deixar o turno do titular NOVO vago.
function montarRevisao(l) {
  const turno = l.revisao_turno;
  if (turno === null || turno === undefined) return undefined;
  const padrao = (l.padroes ?? []).find((p) => p.turno === turno);
  if (padrao === undefined) return undefined;

  const afetados = l.afetados ?? [];
  const rotuloTurno = ROTULO_TURNO[turno] ?? turno;

  return {
    descricao: `A âncora de ${ddmmaaaa(padrao.ancora_data)} passa de ${padrao.ancora_nome} para `
      + `${padrao.ancora_proxima_nome}, valendo de amanhã. Isso troca todos os dias futuros de uma `
      + 'vez, e as trocas registradas abaixo passariam a cobrir a pessoa errada.',
    afetadas: afetados.map((a) => {
      const falta = a.tipo_registro === 'ausencia';
      const novo = a.titular_novo ?? 'ninguém';
      return {
        identificador: a.turno_id,
        versao: a.versao,
        rotulo: `${ddmm(a.data)} · ${rotuloTurno}`,
        registrada: falta
          ? `registrada: falta de ${a.titular_atual}`
          : `registrada: ${a.colaborador ?? 'Não atribuído'} cobre ${a.titular_atual}`,
        // Manter a falta deixa o turno vago, e vago passa a ser o do titular
        // novo: dizer isso aqui é o que evita a Jana manter sem perceber.
        depois: falta
          ? `com a nova âncora: quem fica sem cobertura passa a ser ${novo}`
          : `com a nova âncora: o titular passa a ser ${novo}`,
        acoes: [
          { identificador: 'manter', rotulo: falta ? 'Manter a falta' : 'Manter a troca' },
          { identificador: 'padrao', rotulo: 'Voltar ao padrão' },
        ],
      };
    }),
    status: afetados.length === 0
      ? 'Nenhuma troca ou falta afetada.'
      : `0 de ${afetados.length} revisadas`,
    podeConfirmar: false,
    // O que o banco precisa receber de volta. Só o dono da âncora muda: o array
    // e a data dela vão como estão, porque a tela não tem campo para os dois.
    alteracao: {
      turno,
      versao: padrao.versao,
      colaboradores: padrao.ids,
      ancoraData: padrao.ancora_data,
      ancoraColaborador: padrao.ancora_proxima,
    },
  };
}

export function montarEscala(linha, agora, visao = 'calendario') {
  exigirColaborador(linha);
  const l = linha;
  const atendente = ehAtendente(l.eu_perfil);

  const inicio = diaUtc(l.inicio);
  const hoje = l.hoje.slice(0, 10);
  const fim = somarDias(inicio, 27);

  // Quem o botão do domingo escala por padrão: você, se for da equipe do balcão;
  // senão a primeira pessoa dela. Trocar é com "outra pessoa", no cliente.
  const equipe = l.equipe ?? [];
  const assumeDomingo = equipe.find((p) => p.identificador === l.eu_id) ?? equipe[0];

  const porDia = new Map();
  for (const t of l.turnos) {
    const chave = t.data.slice(0, 10);
    if (!porDia.has(chave)) porDia.set(chave, []);
    porDia.get(chave).push(t);
  }

  let domingosLivres = 0;
  const dias = Array.from({ length: 28 }, (_, i) => {
    const d = somarDias(inicio, i);
    const chave = iso(d);
    const dow = d.getUTCDay();
    const turnos = (porDia.get(chave) ?? [])
      .sort((a, b) => ORDEM_TURNO[a.turno] - ORDEM_TURNO[b.turno])
      .map((t) => turnoApresentado(t, hoje, { id: l.eu_id, perfil: l.eu_perfil }));

    // Domingo não tem turno padrão: é extra, e só existe se alguém assumir.
    const domingoLivre = dow === 0 && turnos.length === 0;
    if (domingoLivre && chave >= hoje) domingosLivres += 1;

    // Hoje e passado são do Admin (0062); dentro da janela de 28 dias, que é a
    // que este calendário desenha, o futuro é de qualquer colaborador.
    const futuro = chave > hoje;
    const podeDomingo = futuro || !atendente;
    const extra = (porDia.get(chave) ?? []).find((t) => t.turno === 'extra');

    return {
      data: chave,
      rotulo: `${SEMANA[dow]}, ${chave}`,
      numero: chave.slice(8, 10),
      hoje: chave === hoje,
      turnos,
      ...(domingoLivre ? { mensagem: 'domingo extra disponível' } : {}),
      // Domingo que já passou não ganha botão: materializar extra no passado é
      // acerto de Admin no banco, não gesto de balcão.
      ...(domingoLivre && chave >= hoje && podeDomingo && assumeDomingo !== undefined
        ? {
            acao: { identificador: 'assumir', rotulo: `Assumir · ${primeiroNome(assumeDomingo.nome)}` },
            assumir: assumeDomingo,
            ...(equipe.length > 1
              ? { alternativa: { identificador: 'outra', rotulo: 'outra pessoa' } }
              : {}),
          }
        : {}),
      ...(extra !== undefined && podeDomingo
        ? {
            acao: { identificador: 'desfazer', rotulo: 'Desfazer' },
            extra: { identificador: extra.id, versao: extra.versao },
          }
        : {}),
    };
  });

  const registros = l.turnos.map((t) => t.tipo_registro);
  const contar = (tipo) => registros.filter((r) => r === tipo).length;
  const trocas = contar('troca');
  const ausencias = contar('ausencia');
  const extras = contar('extra_domingo');
  const materializados = porDia.size;

  const mesDia = (d) => `${String(d.getUTCDate()).padStart(2, '0')} ${MESES[d.getUTCMonth()]}`;

  const revisao = montarRevisao(l);

  return {
    hora: hora(agora),
    data: data(agora),
    turno: iniciais(l.eu_nome),
    subtitulo: 'Dias materializados. Trocas, extras e ausências ficam preservados.',
    visao: VISOES.includes(visao) ? visao : 'calendario',
    // "Qualquer dia alterável por Admin ou Atendente" — exceção declarada
    // (permissoes.md). Quem nega hoje e passado é app.escala_alterar.
    podeEditar: true,
    editando: false,
    podeConfirmar: false,
    resumo: materializados === 0
      ? 'Sem escala carregada'
      : `${trocas} troca${trocas === 1 ? '' : 's'} · ${ausencias} ausência${ausencias === 1 ? '' : 's'} · ${extras} extra${extras === 1 ? '' : 's'}`,
    sugestoes: domingosLivres === 0 ? '' : `${domingosLivres} domingo${domingosLivres === 1 ? '' : 's'} disponíve${domingosLivres === 1 ? 'l' : 'is'}`,
    periodo: `${mesDia(inicio)} – ${mesDia(fim)} ${fim.getUTCFullYear()}`,
    janela: materializados === 0 ? 'Sem dias materializados' : `${materializados} de 28 dias materializados`,
    diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'],
    dias: materializados === 0 ? [] : dias,
    legenda: [
      { destaque: 'padrao', rotulo: 'padrão' },
      { destaque: 'troca', rotulo: 'troca' },
      { destaque: 'extra', rotulo: 'extra domingo' },
      { destaque: 'ausencia', rotulo: 'ausência' },
    ],
    mensagemVazia: 'Nenhuma escala disponível neste período.',
    rodape: materializados === 0 ? '' : 'Passado e hoje ficam congelados. O gerador preserva os dias com troca, extra ou ausência.',
    avisoEdicao: 'Modo de edição: dias passados e hoje estão congelados. Marcar troca escala outra pessoa da equipe. Nada é salvo até confirmar.',
    equipe,
    padroes: l.padroes.map((p) => ({
      turno: p.turno,
      rotulo: ROTULO_TURNO[p.turno] ?? p.turno,
      tipo: p.tipo_atribuicao === 'fixo' ? 'Fixo' : 'Alternado diário',
      versao: `v${p.versao} · desde ${ddmmaaaa(p.vigencia_inicio)}`,
      colaboradores: (p.colaboradores ?? []).join(' · '),
      dias: diasAplicaveis(p.dias_aplicaveis),
      horario: horarioDoPadrao(p.horarios),
      ...(p.tipo_atribuicao === 'alternado_diario'
        ? {
            ancora: `${ddmmaaaa(p.ancora_data)} · ${p.ancora_nome}`,
            nota: 'A contagem inclui o domingo. A inversão acontece a cada semana.',
          }
        : {}),
      // Mexer na âncora é configurar o sistema, que não é do Atendente
      // (permissoes.md); e só o alternado tem âncora que mude alguma coisa.
      podeRevisar: !atendente && p.tipo_atribuicao === 'alternado_diario' && p.ids.length > 1,
    })),
    ...(revisao === undefined ? {} : { revisao }),
  };
}

export function criarTelaEscala(comSessao) {
  return async function escala(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    // Turno fora da lista volta a null, como a visão volta a 'calendario':
    // parâmetro é recorte da tela, não caminho pra escolher linha no banco.
    const pedido = parametros.get('revisar');
    const revisar = Object.hasOwn(ROTULO_TURNO, pedido ?? '') ? pedido : null;

    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA,
        [sessao.colaboradorId, agora.toISOString(), revisar]);
      return rows[0];
    });
    return montarEscala(linha, agora, parametros.get('visao') ?? undefined);
  };
}

export { CONSULTA as CONSULTA_ESCALA };
