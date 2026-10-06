// GET /tela/avisos[?aba=ativos|sistema|lembretes|arquivados][&escrever=1] — spec/lembretes.md.
//
// Devolve o `DadosAvisos` de src/app/src/telas/Avisos.tsx. "Publicados" e
// "Arquivados" leem `aviso`; "Do sistema" lê `notificacao` (só o Sistema cria;
// o Admin vê todas — spec), e só existe para quem não é Atendente, como no mockup.
// "Lembretes" lê `lembrete` e, para o Administrador, `categoria_lembrete`
// (ADR 0066): os cartões de lembrete viajam na mesma lista dos avisos.
//
// ⚠ Diferenças do mockup:
// - `aviso` não tem título. O título é a primeira linha do texto, e o corpo é o
//   resto — é como `app.aviso_publicar` grava (ADR 0056).
// - Não há "fixado" nem público "Estúdio" (ADR 0058).
// - Não há "restaurar" um arquivado: o ciclo de vida só vai de Ativo a Arquivado.
//
// Estado de interação no padrão: formulário fechado, leituras fechadas. O
// `?escrever=1` é o recorte que abre o formulário, como o `?registrar=1` dos
// Achados: o esqueleto vem daqui, e o que o dedo escreve mora no App.
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { hora, iniciais } from './formato.mjs';

const ABAS = ['ativos', 'sistema', 'lembretes', 'arquivados'];

const CONSULTA = `
with ${CTE_EU.trim()},
-- "Do sistema" não existe para o Atendente: pedida por ele, a aba cai em Ativos
-- aqui, antes de ler notificação de todo mundo.
param as (
  select case when $3::text = 'sistema' and (select nivel_acesso from eu) = 'atendente'
              then 'ativos' else $3::text end as aba,
         ($2::timestamptz at time zone 'America/Maceio')::date as hoje
),
avisos as (
  -- Só a confirmação da edição atual conta: editar volta a pedir (0072).
  select a.id, a.versao, a.texto, a.prioridade, a.status, a.criado_em, c.nome as autor,
         a.snapshot_colaboradores, a.publico, a.pede_confirmacao, a.edicao,
         (select jsonb_agg(jsonb_build_object('nome', s.nome, 'confirmado_em', cl.confirmado_em)
                           order by cl.confirmado_em nulls last, s.nome)
            from colaborador s
            left join confirmacao_leitura cl
                   on cl.comunicado_id = a.id and cl.colaborador_id = s.id and cl.edicao = a.edicao
           where s.id = any (a.snapshot_colaboradores)) as leituras,
         (select cl.confirmado_em from confirmacao_leitura cl, eu
           where cl.comunicado_id = a.id and cl.colaborador_id = eu.id and cl.edicao = a.edicao) as eu_confirmei,
         (select eu.id = any (a.snapshot_colaboradores) from eu) as eu_no_snapshot,
         (select eu.id = a.autor_id from eu) as eu_autor
    from aviso a
    join colaborador c on c.id = a.autor_id
    cross join param p
   where (p.aba = 'ativos' and a.status = 'ativo') or (p.aba = 'arquivados' and a.status = 'arquivado')
),
notificacoes as (
  select n.id, n.texto, n.categoria, n.status, n.exige_confirmacao, n.confirmada_em,
         n.referencia_ativo, n.criado_em, d.nome as destinatario
    from notificacao n
    join colaborador d on d.id = n.destinatario_id
    cross join param p
   where p.aba = 'sistema'
),
-- O Atendente vê o lembrete a partir do dia em que a antecedência manda; o
-- Admin vê todos os abertos, para conferir o que criou (ADR 0066 §3).
lembretes as (
  select l.id, l.versao, l.texto, l.data_alvo, l.status, l.origem, l.antecedencia_snapshot,
         cl.nome as categoria,
         l.data_alvo - coalesce(l.antecedencia_snapshot, 0) as aparece_em
    from lembrete l
    left join categoria_lembrete cl on cl.id = l.categoria_id
    cross join param p
   where p.aba = 'lembretes' and l.status in ('ativo', 'atrasado')
     and ((select nivel_acesso from eu) <> 'atendente'
          or l.data_alvo - coalesce(l.antecedencia_snapshot, 0) <= p.hoje)
),
-- Categoria é do Administrador: só ele cria lembrete (ADR 0066).
categorias as (
  select c.id, c.versao, c.nome, c.antecedencia_padrao, c.ativo
    from categoria_lembrete c
    cross join param p
   where p.aba = 'lembretes' and (select nivel_acesso from eu) = 'administrador'
)
select
  (select nome         from eu) as eu_nome,
  (select nivel_acesso from eu) as eu_perfil,
  -- Quantos recebem, por público: a mesma regra de app.aviso_publicar (0061).
  (select count(*)::int from colaborador where ativo and nivel_acesso in ('administrador', 'atendente')) as ativos_todos,
  (select count(*)::int from colaborador where ativo and nivel_acesso = 'atendente') as ativos_atendentes,
  coalesce((select jsonb_agg(to_jsonb(a)
      order by case a.prioridade when 'urgente' then 0 else 1 end, a.criado_em desc)
    from avisos a), '[]'::jsonb) as avisos,
  coalesce((select jsonb_agg(to_jsonb(n)
      order by case n.status when 'nao_vista' then 0 else 1 end, n.criado_em desc)
    from notificacoes n), '[]'::jsonb) as notificacoes,
  (select hoje::text from param) as hoje,
  coalesce((select jsonb_agg(to_jsonb(l) order by l.data_alvo, l.texto)
    from lembretes l), '[]'::jsonb) as lembretes,
  coalesce((select jsonb_agg(to_jsonb(c) order by c.ativo desc, c.nome)
    from categorias c), '[]'::jsonb) as categorias`;

const diaMesFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
const ddmm = (ts) => diaMesFmt.format(new Date(ts));
const quando = (ts) => `${ddmm(ts)} ${hora(new Date(ts))}`;

// Exportada: a Home mostra o mesmo aviso, e duas regras de "o que é título"
// divergiriam na primeira correção de uma delas.
export function tituloETexto(texto) {
  const corte = texto.indexOf('\n');
  return corte === -1
    ? { titulo: texto, texto: '' }
    : { titulo: texto.slice(0, corte).trim(), texto: texto.slice(corte + 1).trim() };
}

function avisoApresentado(a, perfil, abaAtual) {
  const atendente = ehAtendente(perfil);
  const leituras = a.leituras ?? [];
  const confirmados = leituras.filter((x) => x.confirmado_em !== null);
  const pendentes = leituras.filter((x) => x.confirmado_em === null);
  const ativo = a.status === 'ativo';
  const pede = a.pede_confirmacao;
  const meuPendente = ativo && pede && a.eu_no_snapshot && a.eu_confirmei === null;
  // "Editável pelo autor enquanto Ativo" (0007, ADR 0069).
  const editar = ativo && a.eu_autor ? [{ identificador: 'editar', rotulo: 'Editar', aparencia: 'discreta' }] : [];

  const marcadores = [
    ...(atendente && meuPendente ? [{ rotulo: 'não lido', aparencia: 'nao_lido' }] : []),
    ...(a.prioridade === 'urgente' ? [{ rotulo: 'urgente', aparencia: 'urgente' }] : []),
  ];

  let status = null;
  let acoes = [];
  if (atendente) {
    if (meuPendente) {
      status = { rotulo: 'Pede confirmação', aparencia: 'faixa' };
      acoes = [{ identificador: 'confirmar', rotulo: 'Li e entendi', aparencia: 'principal' }];
    } else if (a.eu_confirmei !== null) {
      status = { rotulo: `Você confirmou ${quando(a.eu_confirmei)}`, aparencia: 'discreta' };
    }
    acoes = [...acoes, ...editar];
  } else {
    status = !pede || leituras.length === 0
      ? { rotulo: 'Sem confirmação', aparencia: 'discreta' }
      : { rotulo: `${confirmados.length} de ${leituras.length} confirmaram`, aparencia: pendentes.length > 0 && ativo ? 'faixa' : 'discreta' };
    acoes = [
      // Quem não é Atendente também está no snapshot, e sem este botão o aviso
      // nunca fecharia a conta de "todos confirmaram".
      ...(meuPendente ? [{ identificador: 'confirmar', rotulo: 'Li e entendi', aparencia: 'principal' }] : []),
      ...(pede && leituras.length > 0 ? [{ identificador: 'leituras', rotulo: 'Ver quem leu', aparencia: 'discreta' }] : []),
      ...editar,
      // Arquivar à mão é válvula do Admin (spec) — o Desenvolvedor não.
      ...(ativo && perfil === 'administrador' ? [{ identificador: 'arquivar', rotulo: 'Arquivar', aparencia: 'discreta' }] : []),
    ];
  }

  return {
    identificador: a.id,
    versao: a.versao,
    tipo: 'equipe',
    ...tituloETexto(a.texto),
    metadados: `${ddmm(a.criado_em)} · ${a.autor} · para ${a.publico === 'atendentes' ? 'atendentes' : 'todos'}${a.edicao > 1 ? ' · editado' : ''}`,
    destaque: atendente && meuPendente && abaAtual === 'ativos',
    marcadores,
    status,
    faltam: !atendente && ativo && pede && pendentes.length > 0 ? `falta: ${pendentes.map((x) => x.nome).join(', ')}` : '',
    acoes,
    leiturasAbertas: false,
    editando: null,
    // O que "Salvar" faz com as leituras (ADR 0069 §4). Sem confirmação, não há
    // leitura a zerar, e a frase mentiria.
    avisoDaEdicao: pede ? 'Salvar volta a pedir confirmação de quem já leu.' : '',
    leituras: leituras.map((x) => `${x.nome} — ${x.confirmado_em === null ? 'sem confirmação' : quando(x.confirmado_em)}`),
  };
}

function notificacaoApresentada(n) {
  return {
    identificador: n.id,
    // Notificação não tem versão: nada nesta tela a escreve.
    versao: 0,
    tipo: 'sistema',
    ...tituloETexto(n.texto),
    metadados: `${ddmm(n.criado_em)} · gerado pelo sistema · para ${n.destinatario}`,
    destaque: false,
    marcadores: [
      { rotulo: n.categoria, aparencia: 'neutra' },
      ...(n.status === 'nao_vista' ? [{ rotulo: 'não vista', aparencia: 'nao_lido' }] : []),
    ],
    status: n.exige_confirmacao && n.confirmada_em === null
      ? { rotulo: 'Pede confirmação', aparencia: 'faixa' }
      : { rotulo: 'Do sistema', aparencia: 'sistema' },
    faltam: '',
    acoes: n.referencia_ativo === 'hora_extra'
      ? [{ identificador: 'horas_extras', rotulo: 'Ver em Horas extras', aparencia: 'discreta' }]
      : n.referencia_ativo === 'lembrete'
        ? [{ identificador: 'lembretes', rotulo: 'Ver em Lembretes', aparencia: 'discreta' }]
        : [],
    leiturasAbertas: false,
    editando: null,
    avisoDaEdicao: '',
    leituras: [],
  };
}

// `data_alvo` chega como 'AAAA-MM-DD', sem fuso: partir o texto não erra o dia.
const ddmmData = (data) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const dias = (n) => (n === 1 ? '1 dia' : `${n} dias`);
const antecedenciaRotulo = (n) => (n === 0 ? 'no dia' : `${dias(n)} antes`);

// Quem vê conclui, menos o Desenvolvedor (ADR 0067 §1). A lista já chega
// filtrada pela antecedência para o Atendente.
function lembreteApresentado(l, hoje, perfil) {
  const antecedencia = l.antecedencia_snapshot ?? 0;
  let status = null;
  if (l.status === 'atrasado' || l.data_alvo < hoje) status = { rotulo: `Venceu ${ddmmData(l.data_alvo)}`, aparencia: 'faixa' };
  else if (l.data_alvo === hoje) status = { rotulo: 'É hoje', aparencia: 'faixa' };
  // Só o Admin vê o que ainda não apareceu para a equipe.
  else if (l.aparece_em > hoje) status = { rotulo: `Aparece em ${ddmmData(l.aparece_em)}`, aparencia: 'discreta' };

  return {
    identificador: l.id,
    versao: l.versao,
    tipo: 'lembrete',
    ...tituloETexto(l.texto),
    metadados: `para ${ddmmData(l.data_alvo)} · avisa ${antecedenciaRotulo(antecedencia)}`,
    destaque: false,
    marcadores: [{ rotulo: l.categoria ?? 'do sistema', aparencia: 'neutra' }],
    status,
    faltam: '',
    acoes: perfil === 'desenvolvedor' ? [] : [{ identificador: 'concluir', rotulo: 'Concluir', aparencia: 'principal' }],
    leiturasAbertas: false,
    editando: null,
    avisoDaEdicao: '',
    leituras: [],
  };
}

// O esqueleto de "Criar lembrete": só as categorias ativas recebem lembrete
// novo. O que o dedo escolhe mora no App.
function formularioLembreteVazio(l) {
  return {
    texto: '',
    data: '',
    hoje: l.hoje,
    categorias: l.categorias.filter((c) => c.ativo).map((c) => ({
      identificador: c.id, rotulo: c.nome, antecedencia: c.antecedencia_padrao, selecionada: false,
    })),
    antecedencia: '',
    aviso: '',
    podeCriar: false,
  };
}

function painelCategorias(l) {
  return {
    itens: l.categorias.map((c) => ({
      identificador: c.id,
      versao: c.versao,
      nome: c.nome,
      antecedencia: c.antecedencia_padrao,
      ativo: c.ativo,
      detalhe: `avisa ${antecedenciaRotulo(c.antecedencia_padrao)}${c.ativo ? '' : ' · desativada'}`,
      edicao: null,
    })),
    novoNome: '',
    novaAntecedencia: '',
    podeCriar: false,
    // Vazio aqui é a verdade, não falta de configuração (ADR 0043 §2).
    mensagemVazia: 'Nenhuma categoria ainda. Crie a primeira quando um lembrete precisar dela.',
  };
}

const VAZIA = {
  ativos: 'Nenhum aviso ativo.',
  sistema: 'Nenhum aviso do sistema.',
  lembretes: 'Nenhum lembrete aberto.',
  arquivados: 'Nenhum aviso arquivado.',
};

// O esqueleto de "Escrever aviso": todos e pedindo confirmação é o padrão
// (ADR 0058). Quantas pessoas cada público alcança vem daqui; a frase que diz
// isso é do App, porque depende do que o dedo escolheu.
function formularioVazio(l) {
  return {
    titulo: '',
    texto: '',
    publicos: [
      { identificador: 'todos', rotulo: 'Todos', selecionado: true, pessoas: Number(l.ativos_todos) },
      { identificador: 'atendentes', rotulo: 'Atendentes', selecionado: false, pessoas: Number(l.ativos_atendentes) },
    ],
    pedeConfirmacao: true,
    urgente: false,
    aviso: '',
    podePublicar: false,
  };
}

export function montarAvisos(linha, agora, aba = 'ativos', escrever = false) {
  exigirColaborador(linha);
  const l = linha;
  const atendente = ehAtendente(l.eu_perfil);
  const abas = atendente ? ['ativos', 'lembretes', 'arquivados'] : ABAS;
  const abaAtual = abas.includes(aba) ? aba : 'ativos';
  const lembretes = abaAtual === 'lembretes';
  // "Admin ou Sistema" cria lembrete (spec) — o Desenvolvedor não.
  const admin = l.eu_perfil === 'administrador';

  return {
    hora: hora(agora),
    iniciais: iniciais(l.eu_nome),
    subtitulo: atendente
      ? 'Leia e confirme. O que pede confirmação fica em destaque até você marcar.'
      : 'O que a equipe precisa saber, e quem já confirmou. Alertas do sistema ficam na aba ao lado.',
    // Aviso: qualquer um cria (spec). Lembrete: só o Administrador.
    podeEscrever: lembretes ? admin : true,
    rotuloEscrever: lembretes ? 'Criar lembrete' : 'Escrever aviso',
    abas: abas.map((a) => ({
      identificador: a,
      rotulo: { ativos: atendente ? 'Ativos' : 'Publicados', sistema: 'Do sistema', lembretes: 'Lembretes', arquivados: 'Arquivados' }[a],
      selecionada: a === abaAtual,
    })),
    formulario: escrever && !lembretes ? formularioVazio(l) : null,
    formularioLembrete: escrever && lembretes && admin ? formularioLembreteVazio(l) : null,
    categorias: lembretes && admin ? painelCategorias(l) : null,
    avisos: abaAtual === 'sistema'
      ? l.notificacoes.map(notificacaoApresentada)
      : lembretes
        ? l.lembretes.map((x) => lembreteApresentado(x, l.hoje, l.eu_perfil))
        : l.avisos.map((a) => avisoApresentado(a, l.eu_perfil, abaAtual)),
    mensagemVazia: VAZIA[abaAtual],
    rodape: lembretes
      ? 'Cada lembrete aparece para a equipe a partir da antecedência, contada da data dele.'
      : atendente
        ? 'Confirmar leitura registra seu nome e o horário.'
        : 'Confirmação de leitura é registro, não cobrança: fica com nome e horário e serve para saber quem ainda não viu antes do turno começar. Arquivar não apaga.',
  };
}

export function criarTelaAvisos(comSessao) {
  return async function avisos(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const aba = ABAS.includes(parametros.get('aba')) ? parametros.get('aba') : 'ativos';
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [sessao.colaboradorId, agora.toISOString(), aba]);
      return rows[0];
    });
    return montarAvisos(linha, agora, aba, parametros.get('escrever') === '1');
  };
}

export { CONSULTA as CONSULTA_AVISOS };
