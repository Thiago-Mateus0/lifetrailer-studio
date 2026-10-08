// GET /tela/sidebar — o menu lateral fixo (spec/ui.md, "Estrutura").
//
// Devolve o `DadosSidebar` que src/app/src/telas/Sidebar.tsx declara, menos o
// `logo` (asset do bundle). `expandida`, `ativo` e `grupoAberto` são estado de
// interação: o servidor manda o padrão e o cliente sobrepõe, como na Home.
//
// Contador só onde há gesto a fazer — é o que o badge promete. "Comandas
// abertas" não ganha contador: aberta é o estado normal do turno, não pendência.
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { tituloETexto } from './avisos.mjs';
import { hora, iniciais, papel } from './formato.mjs';

const CONSULTA = `
with param as (
  select $2::timestamptz as agora,
         ($2::timestamptz at time zone 'America/Maceio')::date as hoje
),
${CTE_EU},
-- Mesma regra da Home: enquanto a entrada não conclui, a fase do dia é a entrada.
chk as (
  select cd.id,
         case when cd.status_entrada = 'pendente' then 'entrada' else 'saida' end as fase,
         case when cd.status_entrada = 'pendente' then cd.limite_entrada else cd.limite_saida end as limite
    from checklist_dia cd cross join param p
   where cd.data = app.checklist_dia_vigente(p.agora)  -- ADR 0087
),
-- Criticidade derivada da quantidade contada (estoque.md:20, ADR 0017).
-- Item não conferido não é falta por omissão (estoque.md:89).
zerados as (
  select nome from item_estoque
   where ativo and conferido_em is not null and quantidade = 0
),
-- Aviso ativo que pede a confirmação de quem está logado: estava no snapshot
-- da criação e ainda não confirmou (0007, confirmacao_leitura). O que não pede
-- confirmação não conta (0061), e a confirmação de antes de uma edição também
-- não (0072).
avisos_meus as (
  select a.id, a.versao, a.texto, a.prioridade, a.criado_em
    from aviso a, eu
   where a.status = 'ativo'
     and a.pede_confirmacao
     and eu.id = any (a.snapshot_colaboradores)
     and not exists (select 1 from confirmacao_leitura cl
                      where cl.comunicado_id = a.id and cl.colaborador_id = eu.id
                        and cl.edicao = a.edicao)
)
select
  (select nome         from eu)                                     as eu_nome,
  (select nivel_acesso from eu)                                     as eu_perfil,
  (select fase   from chk)                                          as checklist_fase,
  (select limite from chk)                                          as checklist_limite,
  (select count(*) from item_execucao ie join chk on chk.id = ie.checklist_dia_id
    where ie.fase = chk.fase
      and ie.estado not in ('feito', 'nao_feito_justificado'))     as checklist_pendentes,
  (select count(*) from zerados)                                    as estoque_zerados,
  (select count(*) from item_estoque
    where ativo and conferido_em is not null and quantidade = 1)    as estoque_atencao,
  coalesce((select jsonb_agg(nome order by nome)
              from (select nome from zerados order by nome limit 3) z), '[]'::jsonb)
                                                                    as estoque_zerados_nomes,
  (select count(*) from avisos_meus)                                as avisos_pendentes,
  (select count(*) from avisos_meus where prioridade = 'urgente')   as avisos_urgentes,
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'versao', versao, 'texto', texto)
                             order by criado_em, id)
              from avisos_meus where prioridade = 'urgente'), '[]'::jsonb)
                                                                    as avisos_urgentes_lista,
  (select count(*) from hora_extra where status = 'pendente')       as horas_pendentes`;

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function contador(n, destaque) {
  return n > 0 ? { contador: n, destaque } : {};
}

export function montarSidebar(linha, agora) {
  exigirColaborador(linha);
  const l = linha;

  const atendente = ehAtendente(l.eu_perfil);
  const checklistPendentes = Number(l.checklist_pendentes);
  const zerados = Number(l.estoque_zerados);
  const atencao = Number(l.estoque_atencao);
  const avisosPendentes = Number(l.avisos_pendentes);
  const avisosUrgentes = Number(l.avisos_urgentes);
  const horasPendentes = Number(l.horas_pendentes);

  // Mesma criticidade da rotina da Home: entrada pendente é urgente, saída é atenção.
  const checklistDestaque = l.checklist_fase === 'entrada' ? 'urgente' : 'atencao';

  const itens = [
    { identificador: 'inicio', codigo: 'IN', rotulo: 'Início' },
    { identificador: 'comanda', codigo: 'CM', rotulo: 'Comanda' },
    {
      identificador: 'checklist', codigo: 'CK', rotulo: 'Checklist',
      ...contador(checklistPendentes, checklistDestaque),
      subitens: [
        { identificador: 'checklist-entrada', rotulo: 'Entrada' },
        { identificador: 'checklist-saida', rotulo: 'Saída' },
      ],
    },
    {
      identificador: 'estoque', codigo: 'ES', rotulo: 'Estoque',
      ...contador(zerados + atencao, zerados > 0 ? 'urgente' : 'atencao'),
      subitens: [
        { identificador: 'estoque-conferir', rotulo: 'Conferir' },
        { identificador: 'estoque-compra', rotulo: 'Compra' },
        { identificador: 'estoque-bomboniere', rotulo: 'Bomboniere' },
      ],
    },
    { identificador: 'escala', codigo: 'EC', rotulo: 'Escala' },
    {
      identificador: 'horas', codigo: 'HE', rotulo: 'Horas extras',
      // Pagar é do Admin (permissoes.md): o badge é pendência de quem paga. Para
      // o Atendente o número existiria sem gesto nenhum a fazer.
      ...(atendente ? {} : contador(horasPendentes, 'atencao')),
      subitens: [
        { identificador: 'horas-pendentes', rotulo: 'Pendentes' },
        { identificador: 'horas-pagas', rotulo: 'Pagas' },
        { identificador: 'horas-canceladas', rotulo: 'Canceladas' },
      ],
    },
    {
      identificador: 'avisos', codigo: 'AV', rotulo: 'Avisos',
      ...contador(avisosPendentes, avisosUrgentes > 0 ? 'urgente' : 'atencao'),
      subitens: atendente
        ? [
            { identificador: 'avisos-ativos', rotulo: 'Ativos' },
            { identificador: 'avisos-lembretes', rotulo: 'Lembretes' },
            { identificador: 'avisos-arquivados', rotulo: 'Arquivados' },
          ]
        : [
            { identificador: 'avisos-ativos', rotulo: 'Ativos' },
            { identificador: 'avisos-sistema', rotulo: 'Do sistema' },
            { identificador: 'avisos-lembretes', rotulo: 'Lembretes' },
            { identificador: 'avisos-arquivados', rotulo: 'Arquivados' },
          ],
    },
    {
      identificador: 'achados', codigo: 'AC', rotulo: 'Achados',
      subitens: [
        { identificador: 'achados-guardados', rotulo: 'Guardados' },
        { identificador: 'achados-entregues', rotulo: 'Entregues' },
        // Doação, não descarte: é o estado terminal do ciclo de vida (spec/achados.md).
        { identificador: 'achados-doados', rotulo: 'Doados' },
      ],
    },
    { identificador: 'treinamento', codigo: 'TR', rotulo: 'Treinamento' },
    // "Configurar sistema" não é do Atendente (permissoes.md). Esconder o item
    // é conveniência; quem nega é o banco.
    ...(atendente ? [] : [{ identificador: 'ajustes', codigo: 'AJ', rotulo: 'Ajustes' }]),
  ];

  // A faixa de urgentes reúne severidade Urgente de qualquer ativo (spec/ui.md).
  const urgencias = [];
  if (l.checklist_fase === 'entrada' && checklistPendentes > 0) {
    urgencias.push({
      identificador: 'checklist',
      titulo: 'Checklist de entrada',
      detalhe: plural(checklistPendentes, 'item', 'itens')
        + (l.checklist_limite === null ? '' : ` · limite ${hora(new Date(l.checklist_limite))}`),
    });
  }
  if (zerados > 0) {
    urgencias.push({
      identificador: 'estoque',
      titulo: 'Estoque zerado',
      detalhe: l.estoque_zerados_nomes.join(' · ')
        + (zerados > l.estoque_zerados_nomes.length ? ` · +${zerados - l.estoque_zerados_nomes.length}` : ''),
    });
  }
  if (avisosUrgentes > 0) {
    urgencias.push({
      identificador: 'avisos',
      titulo: 'Aviso urgente',
      detalhe: `${avisosUrgentes} sem a sua confirmação`,
    });
  }

  return {
    contexto: 'Menu',
    hora: hora(agora),
    descricao: 'Gestão operacional',
    expandida: false,
    ativo: 'inicio',
    itens,
    totalUrgencias: urgencias.length,
    urgencias,
    // O modal da próxima navegação (ADR 0070 §2). Vem com o menu porque o menu
    // já é relido a cada troca de tela: o modal não custa ida à rede.
    avisosUrgentes: l.avisos_urgentes_lista.map((a) => ({
      identificador: a.id,
      versao: a.versao,
      ...tituloETexto(a.texto),
    })),
    usuario: {
      nome: l.eu_nome,
      iniciais: iniciais(l.eu_nome),
      papel: papel(l.eu_perfil),
    },
  };
}

export function criarTelaSidebar(comSessao) {
  return async function sidebar(sessao, _parametros, agora = new Date()) {
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [sessao.colaboradorId, agora.toISOString()]);
      return rows[0];
    });
    return montarSidebar(linha, agora);
  };
}

export { CONSULTA as CONSULTA_SIDEBAR };
