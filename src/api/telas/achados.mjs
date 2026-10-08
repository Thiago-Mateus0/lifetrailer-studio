// GET /tela/achados[?aba=guardados|entregues|doados&achado=<id>&saida=entregar|doar]
// — spec/achados.md.
//
// Devolve o `DadosAchados` de src/app/src/telas/Achados.tsx. `achado` abre o
// detalhe de um item (é o `selecionado` do tipo); sem ele, só a lista.
//
// ⚠ Três diferenças do mockup, todas por falta de dado ou por vocabulário:
// - A aba "Descartados" é **Doados**: o ciclo de vida não tem descarte, tem
//   doação com destino obrigatório (regra inviolável 7).
// - `codigo` ("AC-104") não existe no schema. No lugar vai a data do achado,
//   que é o que distingue dois itens parecidos na lista.
// - "Guardado onde" (gaveta, com a Helena) e a observação não têm coluna; o
//   detalhe não os mostra.
//
// ⚠ O formulário de SAÍDA (`entrega` ou `doacao`) também é recorte: `?saida=`
// junto do `?achado=`, no mesmo desenho (ADR 0054 §6). Qualquer um que opera
// doa qualquer achado (ADR 0068). Daqui o formulário sai vazio e com `podeConfirmar` falso — o nome e o destino
// que estão sendo digitados são sobrepostos no cliente.
//
// ⚠ `registro` só existe com `?registrar=1` na busca: o formulário é recorte,
// como o modal do Checklist (`?item=`), e não estado inventado no cliente. Aqui
// não há endereço assinado a proteger — o que manda é ser a mesma forma, e o
// esqueleto dele (lugares, estúdios, aviso) é conteúdo do servidor. O que está
// sendo digitado é sobreposto no cliente (ADR 0053).
import { enderecoDaMidia } from '../midia.mjs';
import { CTE_EU, ehAtendente, exigirColaborador } from './colaborador.mjs';
import { data, hojeEm, hora, iniciais } from './formato.mjs';

const ABAS = {
  guardados: ['aguardando_foto', 'em_posse', 'pronto_para_doacao'],
  entregues: ['devolvido'],
  doados: ['doado'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// As duas saídas do ciclo de vida, e os dois identificadores de `acoes`.
const SAIDAS = ['entregar', 'doar'];

const CONSULTA = `
with param as (
  select ($2::timestamptz at time zone 'America/Maceio')::date as hoje,
         $2::timestamptz as agora,
         $3::text[] as status,
         $4::uuid as achado
),
${CTE_EU},
achados as (
  select a.id, a.descricao, a.status, a.cliente_nome, a.destino_doacao, a.versao,
         a.retirado_por_nome, a.datetime_achado, a.registrado_em, a.devolvido_em, a.doado_em,
         e.nome as estudio,
         -- Mídia expirada não é foto: o registro diz que o arquivo sumiu (ADR 0036 §2).
         -- Sai o ID, não a url: ela é a chave no storage (ADR 0051 §2), e o
         -- endereço que o <img src> usa é assinado aqui em cima.
         case when m.expirada_em is null then m.id end as foto_id,
         p.hoje - (a.datetime_achado at time zone 'America/Maceio')::date as dias,
         extract(epoch from p.agora - a.registrado_em) / 3600 as horas_desde_registro,
         rp.nome as registrado_por, dv.nome as devolvido_por, dd.nome as doado_por
    from achado a
    cross join param p
    left join estudio e      on e.id = a.estudio_id
    left join midia m        on m.id = a.midia_id
    left join colaborador rp on rp.id = a.registrado_por_id
    left join colaborador dv on dv.id = a.devolvido_por_id
    left join colaborador dd on dd.id = a.doado_por_id
)
select
  (select nome from eu) as eu_nome,
  (select nivel_acesso from eu) as eu_perfil,
  (select count(*) from achados where status = any (array['aguardando_foto','em_posse','pronto_para_doacao'])) as guardados,
  coalesce((select jsonb_agg(to_jsonb(x) order by x.datetime_achado desc)
              from achados x, param p where x.status = any (p.status)), '[]'::jsonb) as achados,
  (select to_jsonb(x) from achados x, param p where x.id = p.achado) as selecionado,
  -- Os estúdios do formulário. O estudio_id é FK, e um campo onde se digita
  -- "Estúdio 1" não tem como virar uma (ADR 0053 §3).
  coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome) order by e.ordem_exibicao)
              from estudio e where e.ativo), '[]'::jsonb) as estudios,
  -- O que já está em guarda, para o alerta de possível duplicata (spec). Sai da
  -- tabela e não da CTE acima porque precisa do local_guarda — que é o que diz
  -- onde conferir — e da data em ISO, que é como o campo de data do formulário
  -- fala. Só viaja com ?registrar=1: a montagem o põe dentro do registro.
  --
  -- Sem janela de tempo: o casamento é por data exata, e o registro tardio
  -- alcança qualquer dia. São as mesmas linhas que a aba Guardados já mostra.
  coalesce((select jsonb_agg(jsonb_build_object(
                     'identificador', g.id,
                     'estudio', coalesce(g.estudio_id::text, ''),
                     'data', to_char(g.datetime_achado at time zone 'America/Maceio', 'YYYY-MM-DD'),
                     'rotulo', g.descricao || coalesce(' · ' || g.local_guarda, ''))
                   order by g.datetime_achado desc)
              from achado g
             where g.status = any (array['aguardando_foto','em_posse','pronto_para_doacao'])),
           '[]'::jsonb) as em_guarda`;

const diaMesFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
const ddmm = (ts) => diaMesFmt.format(new Date(ts));

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Status, rótulo do selo e cor. O prazo de doação é 3 meses da DATA DO ACHADO,
// com alerta uma semana antes (spec) — por isso 'atencao' a partir de ~83 dias.
function apresentacaoDoStatus(a) {
  switch (a.status) {
    case 'aguardando_foto':
      // Sem foto há mais de 24h gera alerta (spec): o selo acompanha.
      return { rotuloStatus: 'sem foto', destaque: Number(a.horas_desde_registro) > 24 ? 'urgente' : 'atencao' };
    case 'em_posse':
      return { rotuloStatus: plural(Number(a.dias), 'dia', 'dias'), destaque: Number(a.dias) >= 83 ? 'atencao' : 'neutro' };
    case 'pronto_para_doacao':
      return { rotuloStatus: 'pronto para doação', destaque: 'atencao' };
    case 'devolvido':
      return { rotuloStatus: 'Entregue', destaque: 'normal' };
    default:
      return { rotuloStatus: 'Doado', destaque: 'neutro' };
  }
}

// `endereco` assina o endereço de uma foto (ADR 0051 §5). Vem de fora porque
// assinar exige o segredo do processo, e a tela não é lugar de segredo.
function apresentar(a, endereco) {
  return {
    identificador: a.id,
    codigo: `achado ${ddmm(a.datetime_achado)}`,
    descricao: a.descricao,
    local: a.estudio ?? 'Sem estúdio',
    ...(a.foto_id ? { foto: endereco(a.foto_id) } : {}),
    descricaoFoto: a.foto_id ? `Foto de ${a.descricao}` : `${a.descricao}, sem foto`,
    status: a.status,
    ...apresentacaoDoStatus(a),
  };
}

// O aviso de cada saída: quem vai assinar, e a que horas. É conteúdo do
// servidor porque é o servidor que sabe as duas coisas — o cliente só sobrepõe
// o que o dedo escreve.
function saidaAberta(saida, a, eu, agora) {
  if (saida === 'entregar') {
    return {
      entrega: {
        nomeRetirada: '',
        podeConfirmar: false,
        aviso: `Fica registrado que ${eu} entregou hoje ${hora(agora)}.`
          + ' Confira o detalhe que identifica antes de devolver.',
      },
    };
  }
  return {
    doacao: {
      destino: '',
      podeConfirmar: false,
      // Sem "tem certeza?": digitar o destino É a confirmação que o spec pede
      // (ADR 0054 §6). O que o aviso faz é dizer que não tem volta.
      aviso: `Fica registrado que ${eu} doou hoje ${hora(agora)}.`
        + ' A doação não se desfaz — confira o destino antes de confirmar.',
    },
  };
}

// O texto que a Helena cola no ManyChat (ADR 0075). Escrito aqui, e não no cliente, porque é
// conteúdo — e porque o que ele NÃO diz é decisão: nem a `observacao`, que é o
// detalhe guardado para conferir o dono, nem o `cliente_nome`, que é o nome de
// um terceiro numa conversa que pode ser com a pessoa errada.
function textoDoCompartilhamento(a) {
  return `${a.descricao} — achado ${ddmm(a.datetime_achado)}`
    + (a.estudio ? ` no ${a.estudio}` : '')
    + '. Está guardado aqui no Lifetrailer Studio.'
    + ' Se for seu, responda esta mensagem que a gente combina a retirada.';
}

function detalhe(a, endereco, saida, eu, agora, admin) {
  const guardado = ABAS.guardados.includes(a.status);
  // Doar antes do prazo não trava — o Pronto para doação é aviso —, então as
  // duas saídas existem para todo guardado.
  const podeSair = guardado && saida !== null;

  const historico = [`Registrado ${ddmm(a.registrado_em)} por ${a.registrado_por ?? '—'}`
    + (a.estudio ? ` — achado no ${a.estudio}` : '')];
  if (a.devolvido_em) {
    historico.push(`Entregue ${ddmm(a.devolvido_em)} ${hora(new Date(a.devolvido_em))} por ${a.devolvido_por ?? '—'}`
      + (a.retirado_por_nome ? ` a ${a.retirado_por_nome}` : ''));
  }
  if (a.doado_em) {
    historico.push(`Doado ${ddmm(a.doado_em)} por ${a.doado_por ?? '—'} · destino: ${a.destino_doacao}`);
  }

  return {
    ...apresentar(a, endereco),
    // A `versao` que as duas saídas mandam de volta. Ela sobe quando a foto
    // entra (migration 0055) — por isso a tela é relida entre os gestos.
    versao: Number(a.versao),
    linha: [
      a.cliente_nome ? `Cliente: ${a.cliente_nome}` : 'Cliente não identificado',
      a.estudio,
    ].filter(Boolean).join(' · '),
    meta: `${ddmm(a.datetime_achado)} · registrado por ${a.registrado_por ?? '—'}`,
    acoes: guardado
      ? [
          { identificador: 'entregar', rotulo: 'Entregar', destaque: 'principal' },
          { identificador: 'doar', rotulo: 'Doar', destaque: 'secundario' },
        ]
      : [],
    historico,
    ...(podeSair ? saidaAberta(saida, a, eu, agora) : {}),
    // A saída de `aguardando_foto` (ADR 0053 §2). Só aqui: em qualquer outro
    // estado a foto já entrou, e o write-once do ADR 0051 §7 recusaria a
    // segunda com LT002 — botão que promete o que não cumpre é pior que botão
    // que não existe.
    ...(a.status === 'aguardando_foto' ? { anexarFoto: { rotulo: 'Anexar foto' } } : {}),
    // Procurar o dono é da Helena, pelo ManyChat (ADR 0075): o tablet não
    // oferece. Só com foto e só com o item ainda em guarda: sem foto não há o
    // que identifique, e item já entregue ou doado não tem dono a procurar.
    ...(admin && a.foto_id && guardado ? {
      compartilhar: {
        rotulo: 'Copiar mensagem',
        baixarFoto: 'Baixar foto',
        texto: textoDoCompartilhamento(a),
        aviso: 'Cole o texto na conversa do cliente no ManyChat e anexe a foto. Não escreva o detalhe'
          + ' que identifica o item — é ele que confirma o dono na hora da retirada.',
      },
    } : {}),
  };
}

// Os lugares do "Guardado onde". Constante da tela, como as abas: uma tabela de
// catálogo para um valor seria catálogo sem dono (ADR 0042 §3).
//
// ⚠ A lista é UMA só, e isso é a resposta do Wyll (G11, 2026-09-23): no estúdio
// item achado vai para a gaveta, e não há segundo lugar. "Gaveta A/P" e "Com a
// Helena" vinham do mockup da Fase 3, não da operação — com a lista errada o item
// era guardado num lugar e registrado em outro.
//
// Achados antigos continuam mostrando o lugar em que foram guardados:
// `local_guarda` é texto na tabela, e esta lista só governa o que se oferece
// daqui pra frente.
const LUGARES = [
  { identificador: 'Gaveta', rotulo: 'Gaveta' },
];

// O ESQUELETO do formulário: o que o servidor sabe e o dedo não digita. Os
// campos vão vazios e `podeGuardar` falso — quem os preenche é o rascunho do
// cliente, sobreposto na hora de desenhar (ADR 0053).
function registroVazio(estudios, emGuarda, hoje) {
  return {
    descricao: '',
    // Vazia: o dia é do relógio do tablet, e a tela o preenche. O servidor não
    // tem como saber que "hoje" o dedo quis dizer.
    data: '',
    cliente: '',
    observacao: '',
    descricaoFoto: 'Foto do novo achado',
    estudios: estudios.map((e) => ({ identificador: e.id, rotulo: e.nome, selecionado: false })),
    lugares: LUGARES.map((l) => ({ ...l, selecionado: false })),
    aviso: 'A foto entra logo depois de guardar. Se ela não subir, o item fica marcado como "sem foto" até você anexar.',
    podeGuardar: false,
    // O alerta de possível duplicata (spec). A lista inteira viaja com o
    // esqueleto e o casamento é feito na tela: assim o aviso aparece no toque,
    // e continua aparecendo com a rede ruim — que é quando o mesmo casaco é
    // registrado duas vezes.
    emGuarda,
    // O "hoje" do servidor, que é o mesmo relógio que a RPC vai carimbar quando
    // a data vier vazia. O do tablet poderia discordar, e o alerta apontaria
    // para o dia errado.
    hoje,
    avisoDuplicata: 'Já tem item guardado deste estúdio nesta data. Confira se não é o mesmo antes de registrar de novo.',
  };
}

const VAZIA = {
  guardados: 'Nenhum item guardado.',
  entregues: 'Nada entregue ainda.',
  doados: 'Nada doado ainda.',
};

export function montarAchados(linha, agora, aba = 'guardados', config, registrar = false, saida = null) {
  exigirColaborador(linha);
  const l = linha;
  const abaAtual = Object.hasOwn(ABAS, aba) ? aba : 'guardados';
  const guardados = Number(l.guardados);
  const endereco = (id) => enderecoDaMidia(id, config.segredo, () => agora.getTime());

  return {
    hora: hora(agora),
    data: data(agora),
    turno: iniciais(l.eu_nome),
    subtitulo: plural(guardados, 'item guardado', 'itens guardados'),
    abas: Object.keys(ABAS).map((a) => ({
      identificador: a, rotulo: a[0].toUpperCase() + a.slice(1), selecionada: a === abaAtual,
    })),
    achados: l.achados.map((a) => apresentar(a, endereco)),
    mensagemVazia: VAZIA[abaAtual],
    // ⚠ "a partir de", e não "só depois de": o prazo de 3 meses avisa e não
    // tranca (spec, e ADR 0054 §2). O rodapé dizia o contrário do que a tela faz.
    rodape: 'Para não entregar ao dono errado, pergunte o que identifica o item antes de mostrar. A doação pede destino registrado, e o prazo de 3 meses avisa — não tranca.',
    ...(registrar ? { registro: registroVazio(l.estudios, l.em_guarda, hojeEm(agora)) } : {}),
    ...(l.selecionado
      ? { selecionado: detalhe(l.selecionado, endereco, saida, l.eu_nome, agora, !ehAtendente(l.eu_perfil)) }
      : {}),
  };
}

export function criarTelaAchados(comSessao, config) {
  return async function achados(sessao, parametros = new URLSearchParams(), agora = new Date()) {
    const aba = Object.hasOwn(ABAS, parametros.get('aba') ?? '') ? parametros.get('aba') : 'guardados';
    const achado = UUID.test(parametros.get('achado') ?? '') ? parametros.get('achado') : null;
    // Abrir o formulário é recorte, como abrir o detalhe: `?registrar=1`.
    const registrar = parametros.get('registrar') === '1';
    const saida = SAIDAS.includes(parametros.get('saida')) ? parametros.get('saida') : null;
    const linha = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [
        sessao.colaboradorId, agora.toISOString(), ABAS[aba], achado,
      ]);
      return rows[0];
    });
    return montarAchados(linha, agora, aba, config, registrar, saida);
  };
}

export { CONSULTA as CONSULTA_ACHADOS };
