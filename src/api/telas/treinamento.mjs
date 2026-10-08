// GET /tela/treinamento[?busca=&arquivados=1&tutorial=<id>] — spec/treinamento.md.
//
// Catálogo de consulta, não trilha: o spec decidiu que não há rastreio de quem
// leu o quê, então abrir um tutorial não escreve nada.
//
// ⚠ O mockup da Fase 3 desenhou "materiais" de vídeo e link, com URL. O spec e o
// ADR 0026 decidiram outra coisa — tutorial em blocos de texto e foto, vídeo
// fora do MVP — e não existe coluna de URL em tutorial nem em bloco_tutorial.
// Quem manda é o spec (issue #94, opção A); esta tela é a do spec.
//
// ⚠ Estado de interação no padrão: nenhum tutorial aberto, busca vazia.
import { enderecoDaMidia, UUID } from '../midia.mjs';
import { CTE_EU, exigirColaborador } from './colaborador.mjs';
import { data, hora, iniciais } from './formato.mjs';

const CONSULTA = `
with param as (
  select ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         nullif(btrim($3::text), '')                           as busca,
         $4::uuid                                              as tutorial,
         coalesce($5::boolean, false)                          as arquivados
),
${CTE_EU},
-- Só Administrador escreve (spec; 0089), e só ele vê Rascunho.
adm as (select coalesce((select nivel_acesso = 'administrador' from eu), false) as admin),
-- Para o Atendente, Rascunho nunca aparece: a busca cobre Publicados, e o filtro
-- só acrescenta Arquivados (spec). Categoria desativada leva os tutoriais junto.
visiveis as (
  select t.id, t.titulo, t.status, t.ordem,
         coalesce(t.atualizado_em, t.publicado_em, t.criado_em) as atualizado_em,
         c.id as categoria_id, c.nome as categoria, c.descricao as categoria_descricao,
         c.ordem as categoria_ordem,
         (select count(*) from bloco_tutorial b where b.tutorial_id = t.id) as blocos,
         -- O texto vai junto para a busca ao digitar, que filtra no tablet.
         (select string_agg(b.conteudo_texto, ' ' order by b.ordem) from bloco_tutorial b
           where b.tutorial_id = t.id and b.tipo = 'texto') as texto,
         (select m.id from bloco_tutorial b join midia m on m.id = b.midia_id
           where b.tutorial_id = t.id and m.expirada_em is null
           order by b.ordem limit 1) as primeira_foto
    from tutorial t
    join categoria_treinamento c on c.id = t.categoria_id
   cross join param p
   cross join adm
   where c.ativo
     and (t.status = 'publicado' or (p.arquivados and t.status = 'arquivado')
          or (adm.admin and t.status = 'rascunho'))
     -- Mesmo predicado do indice de busca da 0009; sem busca, nao filtra.
     and (p.busca is null
          or to_tsvector('portuguese', t.titulo) @@ plainto_tsquery('portuguese', p.busca))
),
categorias as (
  select v.categoria_id as id, v.categoria as nome, v.categoria_descricao as descricao,
         v.categoria_ordem as ordem,
         -- Capa da pasta: a primeira foto do primeiro tutorial que tem foto.
         -- Sai dos visíveis, então o Atendente nunca vê foto de rascunho.
         (array_agg(v.primeira_foto order by v.ordem, v.titulo)
            filter (where v.primeira_foto is not null))[1] as capa,
         jsonb_agg(jsonb_build_object(
           'id', v.id, 'titulo', v.titulo, 'status', v.status,
           'atualizado_em', v.atualizado_em, 'blocos', v.blocos, 'texto', v.texto)
           order by v.ordem, v.titulo) as tutoriais
    from visiveis v
   group by v.categoria_id, v.categoria, v.categoria_descricao, v.categoria_ordem
),
-- O detalhe ignora a busca: quem abriu um tutorial e depois digitou nao deve
-- ver o painel sumir debaixo do dedo. Mas respeita a categoria ativa e o status.
aberto as (
  select t.id, t.titulo, t.status, t.versao, t.categoria_id,
         t.conteudo_versao_anterior is not null as pode_restaurar,
         coalesce(t.atualizado_em, t.publicado_em, t.criado_em) as atualizado_em,
         c.nome as categoria, a.nome as atualizado_por
    from tutorial t
    join categoria_treinamento c on c.id = t.categoria_id
    left join colaborador a on a.id = coalesce(t.atualizado_por_id, t.criado_por_id)
   cross join param p
   cross join adm
   where t.id = p.tutorial
     and ((c.ativo and (t.status = 'publicado' or (p.arquivados and t.status = 'arquivado')))
          -- O Admin abre qualquer um para editar, inclusive de categoria desativada.
          or adm.admin)
),
-- As categorias para o Admin escolher e cuidar: todas, com versao.
gestao as (
  select c.id, c.nome, c.descricao, c.ativo, c.versao, c.ordem,
         (select count(*) from tutorial t where t.categoria_id = c.id and t.status = 'publicado') as publicados
    from categoria_treinamento c, adm
   where adm.admin
),
blocos as (
  select b.id, b.ordem, b.tipo, b.conteudo_texto,
         -- Midia expirada nao e foto: o registro diz que o arquivo sumiu
         -- (ADR 0036 §2), como nos Achados.
         case when m.expirada_em is null then m.id end as midia_id
    from bloco_tutorial b
    join aberto t on t.id = b.tutorial_id
    left join midia m on m.id = b.midia_id
)
select
  (select nome         from eu)                    as eu_nome,
  (select nivel_acesso from eu)                    as eu_perfil,
  coalesce((select jsonb_agg(to_jsonb(c) order by c.ordem, c.nome)
              from categorias c), '[]'::jsonb)     as categorias,
  (select admin from adm)                          as admin,
  coalesce((select jsonb_agg(to_jsonb(g) order by g.ordem, g.nome)
              from gestao g), '[]'::jsonb)         as gestao,
  (select to_jsonb(a) from aberto a)               as aberto,
  coalesce((select jsonb_agg(to_jsonb(b) order by b.ordem)
              from blocos b), '[]'::jsonb)         as blocos`;

const ROTULO_STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' };

const dataFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', year: 'numeric',
});

const quando = (ts) => (ts === null || ts === undefined ? 'sem data' : dataFmt.format(new Date(ts)));

// "Destaque para tutoriais antigos" (spec) — o spec pede o destaque e não diz a
// partir de quando. 180 dias, decidido na issue #149: meio ano é o intervalo em
// que um procedimento de estúdio muda sem ninguém revisar o texto (equipamento
// novo, fornecedor novo, layout novo). Mais curto marcaria tutorial que só está
// certo, e o destaque viraria ruído que ninguém olha.
export const DIAS_ATE_ENVELHECER = 180;

const DIA_MS = 24 * 60 * 60 * 1000;

// Sem data não é antigo: é desconhecido, e dizer "antigo" seria afirmar o que
// não se sabe. A lista já mostra "sem data" nesse caso.
function envelheceu(ts, agora) {
  if (ts === null || ts === undefined) return false;
  return (agora.getTime() - new Date(ts).getTime()) / DIA_MS > DIAS_ATE_ENVELHECER;
}

const contarBlocos = (n) => `${n} ${Number(n) === 1 ? 'bloco' : 'blocos'}`;

function apresentarBloco(b, endereco) {
  if (b.tipo === 'foto') {
    return {
      identificador: b.id,
      tipo: 'foto',
      ...(b.midia_id ? { foto: endereco(b.midia_id) } : {}),
      // Sem alt próprio no schema: o que existe é o tipo do bloco e a ordem.
      descricao: b.midia_id ? `Foto do passo ${b.ordem}` : `Foto do passo ${b.ordem}, indisponível`,
    };
  }
  return { identificador: b.id, tipo: 'texto', texto: b.conteudo_texto };
}

export function montarTreinamento(linha, agora, config, busca = '', arquivados = false) {
  exigirColaborador(linha);
  const l = linha;
  const admin = l.admin === true;
  const endereco = (id) => enderecoDaMidia(id, config.segredo, () => agora.getTime());

  const categorias = l.categorias.map((c) => ({
    identificador: c.id,
    nome: c.nome,
    descricao: c.descricao,
    contagem: `${c.tutoriais.length} ${c.tutoriais.length === 1 ? 'tutorial' : 'tutoriais'}`,
    ...(c.capa ? { capa: endereco(c.capa) } : {}),
    tutoriais: c.tutoriais.map((t) => ({
      identificador: t.id,
      titulo: t.titulo,
      categoria: c.nome,
      atualizado: `atualizado em ${quando(t.atualizado_em)}`,
      antigo: envelheceu(t.atualizado_em, agora),
      status: ROTULO_STATUS[t.status] ?? t.status,
      blocos: contarBlocos(t.blocos),
      texto: t.texto ?? '',
    })),
  }));

  const total = categorias.reduce((s, c) => s + c.tutoriais.length, 0);
  const procurando = busca.trim() !== '';

  return {
    hora: hora(agora),
    data: data(agora),
    turno: iniciais(l.eu_nome),
    subtitulo: admin
      ? 'Os tutoriais por categoria, rascunhos inclusive. Só a administração vê os rascunhos.'
      : 'Os tutoriais publicados, por categoria. Texto e foto — quem escreve é a administração.',
    busca,
    incluirArquivados: arquivados,
    categorias,
    vazioTitulo: procurando ? 'Nada encontrado' : 'Nenhum tutorial publicado',
    vazioDescricao: procurando
      ? 'Nenhum título publicado bate com essa busca. Tente outra palavra, ou inclua os arquivados.'
      : 'Quando a administração publicar o primeiro tutorial, ele aparece aqui.',
    total,
    selecionado: l.aberto === null ? null : {
      identificador: l.aberto.id,
      titulo: l.aberto.titulo,
      categoria: l.aberto.categoria,
      status: ROTULO_STATUS[l.aberto.status] ?? l.aberto.status,
      atualizado: `atualizado em ${quando(l.aberto.atualizado_em)}`
        + (l.aberto.atualizado_por ? ` por ${l.aberto.atualizado_por}` : ''),
      blocos: l.blocos.map((b) => apresentarBloco(b, endereco)),
      // O que o editor precisa para salvar de volta (0089). Só para o Admin.
      ...(admin ? {
        edicao: {
          versao: l.aberto.versao,
          status: l.aberto.status,
          categoria: l.aberto.categoria_id,
          podeRestaurar: l.aberto.pode_restaurar,
          blocos: l.blocos.map((b) => (b.tipo === 'foto'
            ? { tipo: 'foto', midiaId: b.midia_id, ...(b.midia_id ? { foto: endereco(b.midia_id) } : {}) }
            : { tipo: 'texto', texto: b.conteudo_texto })),
        },
      } : {}),
    },
    podeEditar: admin,
    gestao: admin ? l.gestao.map((c) => ({
      identificador: c.id,
      nome: c.nome,
      descricao: c.descricao ?? '',
      ativa: c.ativo,
      versao: c.versao,
      publicados: Number(c.publicados),
    })) : [],
  };
}

export function criarTelaTreinamento(comSessao, config) {
  return async function treinamento(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const busca = parametros.get('busca') ?? '';
    const arquivados = parametros.get('arquivados') === '1';
    const tutorial = UUID.test(parametros.get('tutorial') ?? '') ? parametros.get('tutorial') : null;
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [
        sessao.colaboradorId, agora.toISOString(), busca, tutorial, arquivados,
      ]);
      return rows[0];
    });
    return montarTreinamento(linha, agora, config, busca, arquivados);
  };
}

export { CONSULTA as CONSULTA_TREINAMENTO };
