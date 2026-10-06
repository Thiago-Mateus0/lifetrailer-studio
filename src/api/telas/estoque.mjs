// GET /tela/estoque[?aba=conferir|compra|bomboniere] — spec/estoque.md.
//
// Devolve o `DadosEstoque` de src/app/src/telas/Estoque.tsx. As três abas saem
// da mesma consulta: são poucos itens (o catálogo inteiro cabe numa tela), e a
// contagem da aba Compra aparece no rótulo dela mesmo com outra aba aberta.
//
// ⚠ Estado de interação no padrão: `editando` falso, `fotoAberta` nula, nenhum
// `ajuste` aberto. `foto` fica ausente — item de estoque não tem mídia no schema.
import { CTE_EU, exigirColaborador } from './colaborador.mjs';
import { data, decimal, haDias, hora, iniciais, reais } from './formato.mjs';

const ABAS = ['conferir', 'compra', 'bomboniere'];
const SENTINELA = 'SEM_NOME_PENDENCIA';

const CONSULTA = `
with param as (
  select ($2::timestamptz at time zone 'America/Maceio')::date as hoje
),
${CTE_EU}
select
  (select nome         from eu) as eu_nome,
  (select nivel_acesso from eu) as eu_perfil,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'nome', i.nome, 'categoria', i.categoria, 'severidade', i.severidade,
      'fornecedor', i.fornecedor, 'especificacao', i.especificacao_compra,
      'quantidade', i.quantidade, 'versao', i.versao,
      -- Nulo é "não conferido neste ciclo", que não é quantidade 0 (estoque.md:89).
      'dias', case when i.conferido_em is null then null
                   else p.hoje - (i.conferido_em at time zone 'America/Maceio')::date end)
      order by i.categoria, i.nome)
    from item_estoque i cross join param p where i.ativo), '[]'::jsonb) as insumos,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'nome', b.nome, 'categoria', b.categoria, 'preco', b.preco,
      'saldo', b.saldo_materializado) order by b.categoria, b.nome)
    from item_bomboniere b where b.ativo), '[]'::jsonb) as bomboniere,
  -- Sugestões do campo de fornecedor (ADR 0071 §4). Só a sessão de Admin edita,
  -- então só ela recebe; nulo é o sinal de que a tela não oferece o gesto.
  case when (select nivel_acesso from eu) = 'administrador' then
    coalesce((select jsonb_agg(f order by f)
                from (select distinct fornecedor as f from item_estoque
                       where fornecedor is not null and fornecedor <> 'SEM_NOME_PENDENCIA') s),
             '[]'::jsonb)
  end as fornecedores,
  -- Sugestões do campo de categoria no "Novo insumo" (ADR 0080), só pro Admin.
  case when (select nivel_acesso from eu) = 'administrador' then
    coalesce((select jsonb_agg(c order by c)
                from (select distinct categoria as c from item_estoque where ativo) s), '[]'::jsonb)
  end as categorias`;

// Criticidade derivada da quantidade contada (ADR 0017). `severidade` NÃO decide
// cor: só desempata a ordem da lista de compra.
function criticidade(insumo) {
  if (insumo.dias === null) return 'neutro';
  if (insumo.quantidade === 0) return 'urgente';
  if (insumo.quantidade === 1) return 'atencao';
  return 'normal';
}

const ROTULO_CRITICIDADE = { urgente: 'urgente', atencao: 'atenção' };

// O schema não tem unidade (a 0005 tirou `tipo_contagem`); ela está escrita
// dentro de `especificacao_compra` ("2 sacos", "1L"). Tirar o número é ler o
// que já está lá, não inventar um campo.
const unidadeDe = (especificacao) => (especificacao ?? '').replace(/^\s*[\d.,]+\s*/, '').trim();

const TEXTOS = {
  conferir: {
    contexto: 'Estoque · Conferência',
    titulo: 'Estoque de insumos',
    subtitulo: 'Informe quanto tem. O sistema decide o que é urgente.',
    nota: '',
  },
  compra: {
    contexto: 'Estoque · Lista de compra',
    titulo: 'Lista de compra',
    subtitulo: 'Por fornecedor, como a compra é feita.',
    nota: 'A quantidade sai da conferência do turno; a data mostra quando foi vista.',
  },
  bomboniere: {
    contexto: 'Estoque · Bomboniere',
    titulo: 'Bomboniere',
    subtitulo: 'Saldo dá baixa automática ao fechar a Comanda.',
    nota: 'Saldo negativo é permitido — fechar nunca bloqueia por falta.',
  },
};

// Duas colunas equilibradas pelo número de itens: o grupo maior entra na coluna
// mais curta. Mantém a ordem alfabética das categorias dentro de cada coluna.
function emColunas(grupos) {
  const colunas = [
    { identificador: 'esquerda', grupos: [], itens: 0 },
    { identificador: 'direita', grupos: [], itens: 0 },
  ];
  for (const g of [...grupos].sort((a, b) => b.insumos.length - a.insumos.length)) {
    const alvo = colunas[0].itens <= colunas[1].itens ? colunas[0] : colunas[1];
    alvo.grupos.push(g);
    alvo.itens += g.insumos.length;
  }
  return colunas
    .filter((c) => c.grupos.length > 0)
    .map(({ identificador, grupos: gs }) => ({
      identificador,
      grupos: gs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    }));
}

export function montarEstoque(linha, agora, aba = 'conferir') {
  exigirColaborador(linha);
  const l = linha;
  const abaAtual = ABAS.includes(aba) ? aba : 'conferir';
  const admin = Array.isArray(l.fornecedores);

  const insumos = l.insumos.map((i) => ({ ...i, criticidade: criticidade(i), unidade: unidadeDe(i.especificacao) }));
  const conferidos = insumos.filter((i) => i.dias !== null);
  const zerados = insumos.filter((i) => i.criticidade === 'urgente').length;
  const atencao = insumos.filter((i) => i.criticidade === 'atencao').length;
  const paraComprar = insumos.filter((i) => i.criticidade === 'urgente' || i.criticidade === 'atencao');

  const categorias = new Map();
  for (const i of insumos) {
    if (!categorias.has(i.categoria)) categorias.set(i.categoria, []);
    categorias.get(i.categoria).push(i);
  }
  const grupos = [...categorias].map(([nome, itens]) => {
    const comprar = itens.filter((i) => i.criticidade === 'urgente' || i.criticidade === 'atencao').length;
    const naoConferidos = itens.filter((i) => i.dias === null).length;
    return {
      identificador: nome,
      nome,
      ...(admin ? { renomear: nome } : {}),
      resumo: comprar > 0 ? `${comprar} para comprar`
        : naoConferidos > 0 ? `${naoConferidos} não conferido${naoConferidos === 1 ? '' : 's'}`
          : 'tudo conferido',
      insumos: itens.map((i) => ({
        identificador: i.id,
        nome: i.nome,
        meta: i.dias === null ? 'não conferido' : `conferido ${haDias(i.dias)}`,
        unidade: i.unidade,
        quantidade: i.dias === null ? '—' : String(i.quantidade),
        criticidade: i.criticidade,
        ...(ROTULO_CRITICIDADE[i.criticidade] ? { rotuloCriticidade: ROTULO_CRITICIDADE[i.criticidade] } : {}),
        // O campo abre vazio na sentinela: ela não se digita (ADR 0071 §4).
        ...(admin ? {
          fornecedor: i.fornecedor === SENTINELA ? '' : i.fornecedor ?? '',
          versao: i.versao,
          ficha: {
            nome: i.nome,
            categoria: i.categoria,
            fornecedor: i.fornecedor === SENTINELA ? '' : i.fornecedor ?? '',
            especificacao: i.especificacao ?? '',
            severidade: i.severidade,
          },
        } : {}),
      })),
    };
  });

  // Fornecedor cru, sentinela incluída: o ADR 0044 §3 quer a tela dizendo a
  // quem compra que aquele grupo ainda não tem dono. Quem dá o nome é o Admin,
  // pela aba Conferir (ADR 0071); a carga não volta a mexer no campo.
  const porFornecedor = new Map();
  for (const i of paraComprar) {
    const chave = i.fornecedor ?? 'Sem fornecedor';
    if (!porFornecedor.has(chave)) porFornecedor.set(chave, []);
    porFornecedor.get(chave).push(i);
  }
  const ordemCompra = (a, b) => a.quantidade - b.quantidade
    || (a.severidade === b.severidade ? 0 : a.severidade === 'urgente' ? -1 : 1)
    || a.nome.localeCompare(b.nome, 'pt-BR');

  const compra = [...porFornecedor]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([nome, itens]) => ({
      identificador: nome,
      nome,
      resumo: `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`,
      // "Copiar lista" (ADR 0080): o pedido pronto pra colar no WhatsApp.
      mensagem: [`Pedido · ${nome}`, ...itens.sort(ordemCompra)
        .map((i) => `• ${i.nome}${i.especificacao ? ` — ${i.especificacao}` : ''}`)].join('\n'),
      // Grupo sem fornecedor nenhum (nulo) não tem nome pra trocar.
      ...(admin && itens[0].fornecedor !== null ? { renomear: nome } : {}),
      insumos: itens.sort(ordemCompra).map((i) => ({
        identificador: i.id,
        nome: i.nome,
        meta: [i.categoria, i.unidade].filter(Boolean).join(' · '),
        pedido: i.especificacao ? `· pedir ${i.especificacao}` : '',
        quantidade: [String(i.quantidade), i.unidade].filter(Boolean).join(' '),
        conferido: haDias(i.dias),
        criticidade: i.criticidade,
        rotuloCriticidade: ROTULO_CRITICIDADE[i.criticidade],
      })),
    }));

  const textos = TEXTOS[abaAtual];

  return {
    contexto: textos.contexto,
    hora: hora(agora),
    turno: iniciais(l.eu_nome),
    data: data(agora),
    titulo: textos.titulo,
    subtitulo: textos.subtitulo,
    aba: abaAtual,
    abas: [
      { identificador: 'conferir', rotulo: 'Conferir' },
      { identificador: 'compra', rotulo: paraComprar.length > 0 ? `Compra · ${paraComprar.length}` : 'Compra' },
      { identificador: 'bomboniere', rotulo: 'Bomboniere' },
    ],
    editando: false,
    // Sem fila offline (ADR 0011 §4): a resposta chegou, então é o banco de agora.
    sincronizacao: { rotulo: 'sincronizado', criticidade: 'normal' },
    resumo: [
      { identificador: 'conferidos', texto: `${conferidos.length} de ${insumos.length} conferidos`, criticidade: 'normal' },
      { identificador: 'zerados', texto: `${zerados} zerado${zerados === 1 ? '' : 's'}`, criticidade: 'urgente' },
      { identificador: 'atencao', texto: `${atencao} na última unidade`, criticidade: 'atencao' },
      { identificador: 'nao-conferidos', texto: `${insumos.length - conferidos.length} não conferidos`, criticidade: 'neutro' },
    ],
    colunas: emColunas(grupos),
    compra,
    bomboniere: l.bomboniere.map((b) => ({
      identificador: b.id,
      nome: b.nome,
      meta: `${b.categoria} · ${reais(b.preco)}`,
      categoria: b.categoria,
      preco: decimal(b.preco),
      saldo: String(b.saldo),
      // Saldo negativo é venda sem lastro: urgente direto (estoque.md, ADR 0017).
      criticidade: Number(b.saldo) < 0 ? 'urgente' : 'normal',
    })),
    nota: textos.nota,
    fotoAberta: null,
    ...(admin ? { fornecedores: l.fornecedores, categorias: l.categorias } : {}),
  };
}

export function criarTelaEstoque(comSessao) {
  return async function estoque(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [sessao.colaboradorId, agora.toISOString()]);
      return rows[0];
    });
    return montarEstoque(linha, agora, parametros.get('aba') ?? undefined);
  };
}

export { CONSULTA as CONSULTA_ESTOQUE };
