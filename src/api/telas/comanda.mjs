// GET /tela/comanda[?modo=ativas|historico|enviar&dia=YYYY-MM-DD&status=&busca=&comanda=<id>]
// — spec/comanda.md. Devolve o `DadosComanda` de src/app/src/telas/Comanda.tsx.
//
// `comanda` abre o detalhe; sem ele, só a lista.
//
// ⚠ Comanda aberta de OUTRO atendente vai sem valores nenhum (spec, seção
// Visibilidade): a lista de assunção mostra cliente, estúdio, horário e de quem
// é — quem precisa agir assume primeiro. A omissão é feita aqui, montando a
// resposta, e não no componente: valor que sai do servidor já vazou.
//
// ⚠ Não há link pro audit log: app.audit_log_consultar GRAVA linha de leitura, e
// um GET de tela dispararia registro a cada abertura.
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { data, decimal, FUSO, hojeEm, hora, iniciais, papel, reais } from './formato.mjs';

// `enviar` é a lista "Para enviar" da Helena (ADR 0073 §1): as Fechadas, de
// qualquer dia. Só o Admin vê a aba; o recorte em si não esconde nada que o
// Atendente já não veja.
const MODOS = ['ativas', 'historico', 'enviar'];
const ROTULO_DO_MODO = { ativas: 'Ativas', historico: 'Histórico', enviar: 'Para enviar' };
const STATUS = ['aberta', 'fechada', 'enviada', 'paga', 'cancelada'];

// Os grupos do bloco Extras, na ordem em que a comanda de papel os lê. `tabela`
// é o que a remoção diz ao banco: bomboniere e item extra são tabelas
// diferentes (0049), e fundo e equipamento são os dois tipos de item_extra.
// A tipagem de item_extra é fechada no banco (check de 0002), então o grupo
// "fora do catálogo" recolhe o que vem sem item de catálogo — e só isso.
const GRUPOS = [
  // Estúdio adicional (ADR 0085): linha de item_extra com estúdio.
  { identificador: 'estudio', titulo: 'Estúdio adicional', tabela: 'item_extra', tipos: ['estudio'] },
  { identificador: 'bomboniere', titulo: 'Bomboniere', tabela: 'bomboniere', tipos: ['bomboniere'] },
  { identificador: 'fundo', titulo: 'Fundos', tabela: 'item_extra', tipos: ['fundo'] },
  { identificador: 'equipamento', titulo: 'Equipamentos', tabela: 'item_extra', tipos: ['equipamento'] },
  { identificador: 'fora', titulo: 'Fora do catálogo', tabela: 'item_extra', tipos: ['fora do catálogo'] },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONSULTA = `
with param as (
  select $2::timestamptz as agora,
         ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         coalesce($3::text, 'ativas') as modo,
         $4::date as dia,
         $5::text as status_filtro,
         nullif(btrim(coalesce($6::text, '')), '') as busca,
         $7::uuid as selecionada
),
${CTE_EU},
comandas as (
  select c.id, c.estudio_id, c.numero_sequencial, c.status, c.origem_criacao, c.versao,
         c.cliente_nome, c.cliente_telefone, c.observacoes,
         c.datetime_inicio_agendado, c.datetime_fim_agendado,
         c.datetime_inicio_praticado, c.datetime_fim_praticado, c.duracao_agendada,
         c.valor_tabela, c.extensao, c.total_a_pagar, c.valor_pre_pago,
         c.pre_pagamento_confirmado, c.valor_a_pagar_agora,
         c.estado_anterior_ao_cancelamento, c.responsavel_atual_id, c.criado_por_id,
         c.forma_pagamento,
         c.assumiu_posse_em, c.fechado_em, c.reaberta_em,
         e.nome as estudio,
         cp.nome as criado_por, rp.nome as responsavel, ap.nome as assumiu_posse_por,
         comp.status as competencia_status,
         (select coalesce(sum(ie.quantidade * ie.preco_snapshot), 0)
            from comanda_item_extra ie where ie.comanda_id = c.id)
       + (select coalesce(sum(cb.quantidade * cb.preco_unitario_snapshot), 0)
            from comanda_bomboniere cb where cb.comanda_id = c.id) as extras_total,
         (select coalesce(sum(a.valor_delta), 0)
            from ajuste_comanda a where a.comanda_id = c.id) as ajustes_total,
         (c.datetime_inicio_agendado at time zone 'America/Maceio')::date as dia,
         -- Faixa de reabertura (spec, Bloco B): contada da data do ENSAIO.
         (($2::timestamptz at time zone 'America/Maceio')::date
           - (c.datetime_inicio_agendado at time zone 'America/Maceio')::date) as dias_do_ensaio
    from comanda c
    join estudio e            on e.id = c.estudio_id
    join colaborador rp       on rp.id = c.responsavel_atual_id
    join competencia comp     on comp.mes_ano = c.competencia_mes_ano
    left join colaborador cp  on cp.id = c.criado_por_id
    left join colaborador ap  on ap.id = c.assumiu_posse_por_id
),
-- Ativas ignora a data e junta o que está em aberto com o dia de hoje; histórico
-- é o recorte de um dia; enviar é toda Fechada. Busca atravessa os três.
visiveis as (
  select x.* from comandas x, param p
   where (p.busca is not null and (x.cliente_nome ilike '%' || p.busca || '%'
                                   or x.estudio ilike '%' || p.busca || '%'))
      or (p.busca is null and p.modo = 'historico' and x.dia = coalesce(p.dia, p.hoje))
      or (p.busca is null and p.modo = 'enviar' and x.status = 'fechada')
      or (p.busca is null and p.modo = 'ativas' and (x.dia = p.hoje or x.status = 'aberta'))
),
linhas_extras as (
  select ie.comanda_id, ie.id, ie.quantidade, ie.preco_snapshot,
         coalesce(ie.descricao, ix.nome) as nome,
         case when ie.estudio_id is not null then 'estudio'
              else coalesce(ix.tipo, 'fora do catálogo') end as tipo
    from comanda_item_extra ie
    left join item_extra ix on ix.id = ie.item_extra_id
),
linhas_bomboniere as (
  select cb.comanda_id, cb.id, cb.quantidade,
         cb.preco_unitario_snapshot as preco_snapshot,
         ib.nome, 'bomboniere' as tipo
    from comanda_bomboniere cb
    join item_bomboniere ib on ib.id = cb.item_id
)
select
  (select id           from eu) as eu_id,
  (select nome         from eu) as eu_nome,
  (select nivel_acesso from eu) as eu_perfil,
  (select count(*) from comandas where status = 'aberta')            as abertas,
  coalesce((select jsonb_agg(to_jsonb(x) - 'cliente_telefone' - 'observacoes'
              order by x.datetime_inicio_agendado desc) from visiveis x
             where (select status_filtro from param) is null
                or x.status = (select status_filtro from param)), '[]'::jsonb) as lista,
  (select to_jsonb(x) from comandas x, param p where x.id = p.selecionada)     as selecionada,
  coalesce((select jsonb_agg(to_jsonb(l) order by l.tipo, l.nome)
              from (select * from linhas_extras union all select * from linhas_bomboniere) l,
                   param p
             where l.comanda_id = p.selecionada), '[]'::jsonb)                 as linhas,
  coalesce((select jsonb_agg(jsonb_build_object(
              'datetime', ce.datetime, 'telefone', ce.telefone_destino, 'por', co.nome)
              order by ce.datetime desc)
              from comanda_envio ce join colaborador co on co.id = ce.enviado_por_id, param p
             where ce.comanda_id = p.selecionada), '[]'::jsonb)                as envios,
  coalesce((select jsonb_agg(jsonb_build_object(
              'valor', a.valor_delta, 'motivo', a.motivo, 'criado_em', a.criado_em,
              'competencia', a.competencia_lancamento)
              order by a.criado_em)
              from ajuste_comanda a, param p where a.comanda_id = p.selecionada), '[]'::jsonb) as ajustes,
  -- O catálogo só viaja quando há Comanda aberta na tela: é o que o seletor de
  -- "adicionar" precisa, e item desativado não entra em linha nova (0049).
  coalesce((select jsonb_agg(to_jsonb(k) order by k.tipo, k.nome)
              from (select ib.id, ib.nome, 'bomboniere' as tipo, ib.preco
                      from item_bomboniere ib where ib.ativo
                     union all
                    select ix.id, ix.nome, ix.tipo, ix.preco_uso_interno
                      from item_extra ix where ix.ativo) k,
                   param p, comandas c
             where c.id = p.selecionada and c.status = 'aberta'), '[]'::jsonb) as catalogo,
  -- Estúdio adicional (ADR 0085): os outros estúdios e as durações da tabela
  -- vigente na data do ensaio. O preço é só para a tela; o banco lê de novo.
  coalesce((select jsonb_agg(jsonb_build_object(
              'id', e.id, 'nome', e.nome,
              'duracoes', (select jsonb_agg(jsonb_build_object('minutos', tp.duracao_minutos, 'preco', tp.valor)
                                            order by tp.duracao_minutos)
                             from tabela_preco tp
                            where tp.estudio_id = e.id
                              and tp.vigencia_inicio <= c.dia
                              and (tp.vigencia_fim is null or tp.vigencia_fim >= c.dia)))
              order by e.ordem_exibicao)
              from estudio e, param p, comandas c
             where c.id = p.selecionada and c.status = 'aberta'
               and e.ativo and e.id <> c.estudio_id
               and exists (select 1 from tabela_preco tp where tp.estudio_id = e.id)), '[]'::jsonb) as estudios`;

const ROTULO = {
  aberta: 'aberta', fechada: 'fechada', enviada: 'enviada', paga: 'paga', cancelada: 'cancelada',
};

// ADR 0086. A ordem é a dos botões.
const FORMAS_DE_PAGAMENTO = [
  { identificador: 'pix', rotulo: 'Pix' },
  { identificador: 'dinheiro', rotulo: 'Dinheiro' },
  { identificador: 'credito', rotulo: 'Crédito' },
  { identificador: 'debito', rotulo: 'Débito' },
];
const ROTULO_DA_FORMA = Object.fromEntries(FORMAS_DE_PAGAMENTO.map((f) => [f.identificador, f.rotulo]));

const hhmm = (ts) => (ts === null || ts === undefined ? '' : hora(new Date(ts)));

// '26/09/2026' — a data da mensagem ao cliente, que não lê '26 SET 2026'.
const dataNumerica = (quando) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
}).format(quando);

// 'YYYY-MM-DD' em Maceió — o dia do ensaio, que o fechamento reusa.
const diaEm = (ts) => hojeEm(new Date(ts));

const intervalo = (inicio, fim) =>
  inicio === null || fim === null ? '' : `${hora(new Date(inicio))}–${hora(new Date(fim))}`;

// O total de Comanda aberta é recalculado ao vivo; fechar congela (spec, Regras).
const totalDe = (c) =>
  c.status === 'aberta'
    ? Number(c.valor_tabela) + Number(c.extensao?.total ?? 0) + Number(c.extras_total)
    : Number(c.total_a_pagar);

// Aberta de outro atendente: a lista de assunção (spec, Visibilidade). O Admin vê
// tudo; fechada, enviada e cancelada são de todos.
const emAssuncao = (c, linha) =>
  c.status === 'aberta'
    && ehAtendente(linha.eu_perfil)
    && c.responsavel_atual_id !== linha.eu_id;

// '(82) 9••••-0000' — o PDF e o WhatsApp levam o número cheio; a tela não precisa.
// A Altegio manda com o 55 do país: sem tirar, ele aparecia no lugar do DDD.
export function telefoneNaTela(numero) {
  if (!numero) return '';
  let so = String(numero).replace(/\D/g, '');
  if (so.startsWith('55') && (so.length === 12 || so.length === 13)) so = so.slice(2);
  if (so.length < 8) return so;
  return `(${so.slice(0, 2)}) ${so.slice(2, 3)}••••-${so.slice(-4)}`;
}

function itemDaLista(c, linha) {
  const assuncao = emAssuncao(c, linha);
  return {
    identificador: c.id,
    cliente: c.cliente_nome,
    estudio: c.estudio.toUpperCase(),
    horario: intervalo(c.datetime_inicio_agendado, c.datetime_fim_agendado),
    data: data(new Date(c.datetime_inicio_agendado)),
    numero: c.numero_sequencial === null ? '' : `#${c.numero_sequencial}`,
    origem: c.origem_criacao === 'manual' ? 'manual' : 'sistema',
    status: assuncao ? 'assuncao' : c.status,
    statusRotulo: assuncao ? 'aguardando assunção' : ROTULO[c.status],
    responsavel: c.responsavel,
    // Sem valor na lista de assunção: o total é o que a assunção protege.
    total: assuncao ? '' : reais(totalDe(c)),
  };
}

// Desde a 0090 (ADR 0082) blocos_noturnos e acrescimo_noturno são da Comanda
// inteira; o que é do agendado vem em agendado_*. A extensão é a diferença.
const noturnoAgendado = (e) => ({
  blocos: Number(e?.agendado_blocos_noturnos ?? 0),
  acrescimo: Number(e?.agendado_acrescimo_noturno ?? 0),
});

function extensaoDe(c) {
  const e = c.extensao;
  if (e === null || e === undefined || Number(e.total ?? 0) === 0) return null;
  const ag = noturnoAgendado(e);
  const noturnos = Number(e.blocos_noturnos ?? 0) - ag.blocos;
  const acrescimo = Number(e.acrescimo_noturno ?? 0) - ag.acrescimo;
  return {
    titulo: Number(e.blocos ?? 0) > 0 ? 'Extensão calculada' : 'Acréscimo noturno',
    detalhe: [
      ...(Number(e.blocos ?? 0) > 0 ? [
        `${e.minutos_reais} min além do agendado`,
        `${e.blocos} ${e.blocos === 1 ? 'bloco' : 'blocos'} de 30 min`,
        acrescimo > 0 ? `${noturnos} noturno(s) · acréscimo ${decimal(acrescimo)}` : 'sem noturno',
      ] : []),
      ag.blocos > 0
        ? `${ag.blocos} ${ag.blocos === 1 ? 'bloco agendado' : 'blocos agendados'} depois do limite noturno · acréscimo ${decimal(ag.acrescimo)}`
        : '',
    ].filter(Boolean),
    total: reais(e.total),
  };
}

// A linha do PDF para o noturno do agendado: começa no primeiro bloco noturno.
export function linhaNoturnoAgendado(extensao) {
  const ag = noturnoAgendado(extensao);
  if (ag.blocos === 0) return null;
  return {
    rotulo: `${ag.blocos} ${ag.blocos === 1 ? 'bloco' : 'blocos'} de 30 min a partir das ${hora(new Date(extensao.agendado_inicio_noturno))}`,
    valor: reais(ag.acrescimo),
  };
}

// Centavos repartidos em `n` partes que somam o todo: o resto vai para as
// primeiras, e nenhuma linha do PDF inventa ou perde um centavo.
function repartir(valor, n) {
  const total = Math.round(Number(valor ?? 0) * 100);
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
}

// Uma linha por bloco (ADR 0027 §4), a partir do que o fechamento congelou —
// `extensao` guarda só os agregados. O bloco b começa em fim_agendado + b×30
// (D-A, ADR 0013), e o corte noturno de extensao_calcular (0050) é um limite
// fixo sobre inícios crescentes: os noturnos são sempre os últimos.
// ⚠ 30 repete o literal da 0050 de propósito, como lá.
export function blocosDaExtensao(extensao, fimAgendado) {
  const blocos = Number(extensao?.blocos ?? 0);
  if (blocos === 0) return [];
  const ag = noturnoAgendado(extensao);
  const noturnos = Number(extensao.blocos_noturnos ?? 0) - ag.blocos;
  const base = repartir(extensao.base, blocos);
  const acrescimo = repartir(Number(extensao.acrescimo_noturno ?? 0) - ag.acrescimo, noturnos);
  const primeiroNoturno = blocos - noturnos;

  return base.map((centavos, b) => {
    const extra = b >= primeiroNoturno ? acrescimo[b - primeiroNoturno] : 0;
    return {
      inicio: hora(new Date(new Date(fimAgendado).getTime() + b * 30 * 60_000)),
      valor: reais((centavos + extra) / 100),
      acrescimo: b >= primeiroNoturno ? `inclui ${decimal(extra / 100)} noturno` : '',
    };
  });
}

// O que cada ação exige, e por quê — a tela desenha o botão desligado com o motivo
// em vez de esconder, que é o que o mockup faz.
function acoesDe(c, linha, trancada, envioAutomatico) {
  const meu = c.responsavel_atual_id === linha.eu_id;
  const admin = !ehAtendente(linha.eu_perfil);
  const acoes = [];

  if (c.status === 'aberta') {
    // O horário praticado é campo da tela (sugerido a partir do agendado), não
    // trava do servidor: quem decide se está preenchido é quem está digitando.
    acoes.push({
      identificador: 'fechar',
      rotulo: 'Fechar comanda',
      desativada: trancada,
      motivo: trancada
        ? 'Competência trancada.'
        : 'Congela o total, dá baixa no bomboniere e registra a hora extra do turno.',
    });
  }
  // O comprovante é da Helena, no computador (ADR 0073 §1): o tablet fecha e não
  // envia. "Já mandei por fora" é a aresta `enviar` que já existe; copiar e baixar não
  // mexem na FSM.
  // Enviar vem primeiro (ADR 0076 §3) e só existe com a chave do ManyChat no
  // servidor: sem ela, a tela é a do manual.
  if (admin && envioAutomatico && c.status === 'fechada') {
    acoes.push({
      identificador: 'enviar_manychat',
      rotulo: 'Enviar',
      desativada: false,
      motivo: 'Manda a mensagem com o link do PDF pelo ManyChat. Se não der, a tela diz por quê.',
    });
  }
  if (admin && (c.status === 'fechada' || c.status === 'enviada')) {
    acoes.push({
      identificador: 'copiar',
      rotulo: 'Copiar mensagem',
      desativada: false,
      motivo: c.status === 'fechada'
        ? 'Copia o texto com o link do PDF (vale 30 dias) para colar na conversa do cliente no ManyChat.'
        : 'Link novo para o mesmo PDF, para quando o anterior venceu.',
    });
    acoes.push({ identificador: 'baixar', rotulo: 'Baixar PDF', desativada: false, motivo: '' });
  }
  if (admin && c.status === 'fechada') {
    acoes.push({
      identificador: 'enviar',
      // Chamava "Enviei", e ao lado do "Enviar" foi lido como o botão que manda.
      rotulo: 'Já mandei por fora',
      desativada: false,
      motivo: 'Não manda nada: só marca como enviada. Toque depois de colar a mensagem ou o PDF no ManyChat.',
    });
  }
  if (c.status === 'fechada' || c.status === 'enviada') {
    // Reabrir é ação financeira: exige ser o responsável (spec, Bloco B). D+3 em
    // diante ainda reabre, mas alerta o Admin — por isso não desativa, avisa.
    acoes.push({
      identificador: 'reabrir',
      rotulo: 'Reabrir comanda',
      desativada: trancada || !(meu || admin),
      motivo: trancada
        ? 'Competência trancada: a correção é por Ajuste.'
        : !(meu || admin)
          ? 'Só o responsável atual reabre.'
          : Number(c.dias_do_ensaio) >= 3
            ? 'Passou de D+2: reabrir alerta o Admin e registra o total anterior.'
            : '',
    });
  }
  // "Recebi" é de qualquer um, nas duas (ADR 0086); a forma é o próprio toque.
  if (c.status === 'fechada' || c.status === 'enviada') {
    acoes.push({
      identificador: 'receber',
      rotulo: 'Recebi',
      desativada: false,
      motivo: 'O cliente pagou o que faltava. Toque na forma de pagamento.',
      formas: FORMAS_DE_PAGAMENTO,
    });
  }
  if (c.status === 'paga') {
    acoes.push({
      identificador: 'desfazer_recebimento',
      rotulo: 'Desfazer Recebi',
      desativada: !admin,
      motivo: admin ? 'Volta para antes do pagamento e apaga a forma.' : 'Só o Admin desfaz.',
    });
  }
  return acoes;
}

// O bloco Extras por grupo, e não uma lista corrida: o quadro do estúdio separa
// fundo de equipamento, o Bomboniere é outra tabela, e o subtotal por grupo é o
// que deixa conferir o resumo sem somar linha por linha. Grupo vazio não
// aparece. A soma é a mesma que `app.comanda_total` faz no banco — aqui ela só
// é mostrada repartida, nunca é a fonte do total.
function extrasAgrupados(linhas, podeRemover) {
  return GRUPOS.map((grupo) => {
    const doGrupo = linhas.filter((l) => grupo.tipos.includes(l.tipo));
    const itens = doGrupo.reduce((n, l) => n + Number(l.quantidade), 0);
    return {
      identificador: grupo.identificador,
      titulo: grupo.titulo,
      tabela: grupo.tabela,
      contagem: `${itens} ${itens === 1 ? 'item' : 'itens'}`,
      subtotal: reais(doGrupo.reduce((t, l) => t + Number(l.quantidade) * Number(l.preco_snapshot), 0)),
      linhas: doGrupo.map((l) => ({
        identificador: l.id,
        nome: l.nome,
        quantidade: String(l.quantidade),
        precoUnitario: decimal(l.preco_snapshot),
        total: reais(Number(l.quantidade) * Number(l.preco_snapshot)),
        // Linha lançada só sai enquanto a Comanda está aberta.
        podeRemover,
      })),
    };
  }).filter((grupo) => grupo.linhas.length > 0);
}

function detalheDe(linha, envioAutomatico) {
  const c = linha.selecionada;
  if (c === null || c === undefined) return null;

  const trancada = c.competencia_status === 'trancada';
  const cabecalho = {
    identificador: c.id,
    numero: c.numero_sequencial === null ? 'sem número' : `#${c.numero_sequencial}`,
    status: c.status,
    statusRotulo: c.forma_pagamento
      ? `${ROTULO[c.status]} · ${ROTULO_DA_FORMA[c.forma_pagamento]}`
      : ROTULO[c.status],
    cliente: c.cliente_nome,
    estudio: c.estudio,
    data: data(new Date(c.datetime_inicio_agendado)),
    horario: intervalo(c.datetime_inicio_agendado, c.datetime_fim_agendado),
    responsavel: c.responsavel,
    versao: c.versao,
  };

  if (emAssuncao(c, linha)) {
    return {
      ...cabecalho,
      assuncao: {
        titulo: 'Comanda de outro atendente',
        texto: 'Sem valores, sem bomboniere, sem ação até assumir. A posse foi entregue pelo que a Escala diz — se você está no estúdio agora, assuma.',
        botao: 'Assumir comanda',
      },
      responsabilidade: null, ensaio: null, extensao: null, extras: [],
      resumo: null, acoes: [], envios: [], cancelamento: null, observacoes: '',
      telefoneCliente: '', competenciaTrancada: trancada,
      lancamento: null, praticado: null, envio: null, comprovante: null,
    };
  }

  const extras = extrasAgrupados(linha.linhas, c.status === 'aberta');
  const comprovante = !ehAtendente(linha.eu_perfil)
    && (c.status === 'fechada' || (c.status === 'enviada' && linha.envios.length > 0));

  const extensao = extensaoDe(c);
  const total = totalDe(c);
  const prePago = Number(c.valor_pre_pago ?? 0);
  const ajustes = linha.ajustes.map((a) => ({
    valor: `${Number(a.valor) < 0 ? '−' : '+'}${decimal(Math.abs(Number(a.valor)))}`,
    motivo: a.motivo,
    competencia: data(new Date(a.competencia)),
  }));
  const corrigido = total + Number(c.ajustes_total);

  return {
    ...cabecalho,
    assuncao: null,
    responsabilidade: {
      criadoPor: c.criado_por === null ? '— (Sistema)' : c.criado_por,
      origem: c.origem_criacao === 'manual' ? 'Manual' : 'Sistema',
      responsavelAtual: c.responsavel,
      assumiuPosse: c.assumiu_posse_em === null
        ? ''
        : `${c.assumiu_posse_por} em ${data(new Date(c.assumiu_posse_em))}, ${hora(new Date(c.assumiu_posse_em))}`,
    },
    ensaio: {
      servico: `${c.duracao_agendada} min`,
      agendado: intervalo(c.datetime_inicio_agendado, c.datetime_fim_agendado),
      praticado: intervalo(c.datetime_inicio_praticado, c.datetime_fim_praticado) || 'não registrado',
      valor: reais(c.valor_tabela),
    },
    extensao,
    extras,
    resumo: {
      ensaio: reais(c.valor_tabela),
      extensao: extensao === null ? '' : extensao.total,
      extras: reais(c.extras_total),
      subtotal: reais(total),
      prePago: prePago === 0 ? '' : `−${decimal(prePago)}`,
      congelado: c.status !== 'aberta',
      totalOriginal: reais(total),
      ajustes,
      totalCorrigido: ajustes.length === 0 ? '' : reais(corrigido),
      aPagarAgora: reais(Math.max(total - prePago, 0)),
    },
    acoes: acoesDe(c, linha, trancada, envioAutomatico),
    // O que cada ação precisa levar de volta. Só existe quando a ação existe:
    // tela sem `lancamento` é tela sem o que lançar.
    lancamento: c.status === 'aberta' ? {
      catalogo: linha.catalogo.map((i) => ({
        identificador: i.id, nome: i.nome, tipo: i.tipo, preco: decimal(i.preco),
      })),
      // O B começa, por padrão, onde o A terminou.
      estudios: (linha.estudios ?? []).map((e) => ({
        identificador: e.id,
        nome: e.nome,
        duracoes: (e.duracoes ?? []).map((d) => ({ minutos: d.minutos, preco: decimal(d.preco) })),
      })),
      inicioSugerido: hhmm(c.datetime_fim_praticado ?? c.datetime_fim_agendado),
      inicioEnsaio: hhmm(c.datetime_inicio_agendado),
      data: diaEm(c.datetime_inicio_agendado),
    } : null,
    praticado: c.status === 'aberta' ? {
      // A data do ensaio, não a de hoje: Comanda aberta ontem fecha com o
      // horário de ontem. O horário vai como hora local e o banco resolve em
      // America/Maceio (regra global 2).
      data: diaEm(c.datetime_inicio_agendado),
      inicio: hhmm(c.datetime_inicio_praticado ?? c.datetime_inicio_agendado),
      fim: hhmm(c.datetime_fim_praticado ?? c.datetime_fim_agendado),
    } : null,
    // O número cheio, que o "Enviei" grava em comanda_envio — a tela mostra o
    // mascarado. Só para o Admin: o tablet não envia (ADR 0073 §1).
    envio: comprovante ? { telefone: c.cliente_telefone ?? '' } : null,
    // O que o PDF e a mensagem pedem além do que a tela mostra (ADR 0027 §4,
    // ADR 0073 §2). Fechada: o PDF é do envio seguinte, por quem está na
    // sessão. Enviada: é o do último envio, que já saiu — o mesmo número que a
    // rota /comprovante usa para achar o arquivo.
    comprovante: comprovante ? {
      envio: c.status === 'fechada' ? linha.envios.length + 1 : linha.envios.length,
      enviadoPor: c.status === 'fechada' ? linha.eu_nome : (linha.envios[0]?.por ?? linha.eu_nome),
      blocos: blocosDaExtensao(c.extensao, c.datetime_fim_agendado),
      noturnoAgendado: linhaNoturnoAgendado(c.extensao),
      primeiroNome: String(c.cliente_nome ?? '').trim().split(/\s+/)[0] ?? '',
      dataDoEnsaio: dataNumerica(new Date(c.datetime_inicio_agendado)),
    } : null,
    envios: linha.envios.map((e) => ({
      quando: `${data(new Date(e.datetime))}, ${hora(new Date(e.datetime))}`,
      telefone: telefoneNaTela(e.telefone),
      por: e.por,
    })),
    telefoneCliente: telefoneNaTela(c.cliente_telefone),
    cancelamento: c.status !== 'cancelada' ? null : {
      titulo: 'Cancelamento',
      reversivel: c.estado_anterior_ao_cancelamento !== null,
      texto: c.estado_anterior_ao_cancelamento === null
        ? 'Agendamento excluído na Altegio: cancelamento terminal, não volta.'
        : `Cliente não compareceu (attendance −1). Estado anterior salvo como ${ROTULO[c.estado_anterior_ao_cancelamento]} — se a Altegio reverter, a Comanda volta sozinha.`,
    },
    observacoes: c.observacoes ?? '',
    competenciaTrancada: trancada,
  };
}

export function montarComanda(linha, agora, { modo = 'ativas', busca = '', envioAutomatico = false } = {}) {
  exigirColaborador(linha);
  const escolhido = MODOS.includes(modo) ? modo : 'ativas';
  const lista = linha.lista.map((c) => itemDaLista(c, linha));

  return {
    hora: hora(agora),
    data: data(agora),
    turno: iniciais(linha.eu_nome),
    perfil: linha.eu_perfil,
    perfis: [{ identificador: linha.eu_perfil, rotulo: papel(linha.eu_perfil), selecionado: true }],
    sincronizacao: { rotulo: 'sincronizado', criticidade: 'normal' },
    titulo: 'Comandas',
    abertas: String(linha.abertas),
    busca,
    modos: MODOS.filter((m) => m !== 'enviar' || !ehAtendente(linha.eu_perfil)).map((m) => ({
      identificador: m,
      rotulo: ROTULO_DO_MODO[m],
      selecionado: m === escolhido,
    })),
    filtros: ['todas', ...STATUS].map((s) => ({
      identificador: s, rotulo: s === 'todas' ? 'todas' : ROTULO[s],
    })),
    lista,
    vazio: lista.length === 0 ? 'Nenhuma comanda neste recorte.' : '',
    selecionada: detalheDe(linha, envioAutomatico),
  };
}

export function criarTelaComanda(comSessao, { envioAutomatico = false } = {}) {
  return async function comanda(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const modo = parametros.get('modo');
    const dia = parametros.get('dia');
    const status = parametros.get('status');
    const busca = parametros.get('busca') ?? '';
    const selecionada = parametros.get('comanda');

    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [
        sessao.colaboradorId,
        agora.toISOString(),
        MODOS.includes(modo) ? modo : null,
        /^\d{4}-\d{2}-\d{2}$/.test(dia ?? '') ? dia : null,
        STATUS.includes(status) ? status : null,
        busca,
        UUID.test(selecionada ?? '') ? selecionada : null,
      ]);
      return rows[0];
    });

    return montarComanda(linha, agora, {
      modo: MODOS.includes(modo) ? modo : 'ativas',
      busca,
      envioAutomatico,
    });
  };
}

export { CONSULTA as CONSULTA_COMANDA };
