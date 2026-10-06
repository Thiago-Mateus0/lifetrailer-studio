#!/usr/bin/env node
// Carga inicial dos catálogos: leva `data/*.csv` para as tabelas que precisam
// estar povoadas antes de o sistema processar um único agendamento.
//
// Sem dependência: fala com o banco via psql, como o migrate.mjs. Node 22.
//
//   node src/db/carga.mjs             aplica o que falta
//   node src/db/carga.mjs --conferir  só mostra o que faria, não escreve
//
// POR QUE SCRIPT, E NÃO MIGRATION. Migration é append-only e numerada: um
// `insert` de catálogo dentro dela congelaria um retrato no histórico e não
// poderia ser reexecutado em ambiente novo. Catálogo precisa entrar em três
// lugares — banco de dev, CI, e o gerenciado antes do go-live — e nos três a
// pergunta é a mesma: "o que ainda não está lá?".
//
// ⚠ CARGA INICIAL TEM VALIDADE DE UMA VEZ SÓ. O ADR 0032 é explícito: "depois
// do go-live, quem manda é a tabela — o Admin edita na tela, e o CSV não é
// reexecutado nem reconciliado". Por isso este script INSERE o que falta e
// NUNCA atualiza o que existe. Linha divergente é erro, não oportunidade de
// sincronizar: sobrescrever silenciosamente é o cenário de duas fontes
// disputando a verdade que o ADR 0030 rejeitou.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DADOS = join(RAIZ, 'data');

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '127.0.0.1',
  PGPORT: process.env.PGPORT ?? '5432',
  PGUSER: process.env.PGUSER ?? 'postgres',
  PGDATABASE: process.env.PGDATABASE ?? 'lifetrailer',
};

// ------------------------------------------------------------------- CSV
// Os arquivos de `data/` são simples, mas não tanto quanto este parser supunha:
// checklist-itens.csv tem `"Luzes, tomadas"` e `"seg,qua,sex"`, e insumos.csv
// põe nomes entre aspas. Dividir na vírgula quebrava essas linhas em colunas
// erradas sem erro nenhum. Aspas duplas agrupam; `""` dentro delas é uma aspa.
// Sem quebra de linha dentro de campo — nenhum arquivo da casa tem.
function celulasDe(linha) {
  const celulas = [];
  let atual = '';
  let entreAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (entreAspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else if (ch === '"') entreAspas = false;
      else atual += ch;
    } else if (ch === '"') entreAspas = true;
    else if (ch === ',') { celulas.push(atual); atual = ''; }
    else atual += ch;
  }
  celulas.push(atual);
  return celulas;
}

export function lerCsv(texto) {
  const linhas = texto.trim().split(/\r?\n/);
  const cabecalho = celulasDe(linhas[0]).map((c) => c.trim());
  return linhas.slice(1).map((linha) => {
    const celulas = celulasDe(linha);
    return Object.fromEntries(cabecalho.map((c, i) => [c, (celulas[i] ?? '').trim()]));
  });
}

const csv = (nome) => lerCsv(readFileSync(join(DADOS, nome), 'utf8'));

// Uma linha de turnos.csv (`seg-sex`) vira uma por dia da semana. Função
// própria — não closure inline — pra dar pra testar dia_semana/turno fora do
// vocabulário sem precisar ler o arquivo do disco (tests/carga/carga.test.mjs).
export function linhaTurnoDefinicao(l) {
  const dias = { 'seg-sex': [1, 2, 3, 4, 5], sab: [6], dom: [0] }[l.dia_semana];
  if (!dias) throw new Error(`turnos.csv: dia_semana desconhecido "${l.dia_semana}"`);
  const turno = { Manha: 'manha', 'Tarde-noite': 'tarde_noite', Extra: 'extra' }[l.turno];
  if (!turno) throw new Error(`turnos.csv: turno desconhecido "${l.turno}"`);
  // `primeiro_ensaio` nao e hora: e a regra de fundacao.md:151, e no banco
  // ela e o NULO. Qualquer outro texto nao-hora e erro, nao sinonimo.
  const hora = (v) => {
    if (v === '' || v === 'primeiro_ensaio') return null;
    if (!/^\d{2}:\d{2}$/.test(v)) throw new Error(`turnos.csv: hora invalida "${v}"`);
    return v;
  };
  return dias.map((d) => ({
    dia_semana: d,
    turno,
    hora_inicio: hora(l.hora_inicio),
    hora_fim: hora(l.hora_fim),
    hora_fim_calculo: hora(l.hora_fim_calculo),
    janela_posse_inicio: hora(l.janela_posse_inicio),
    janela_posse_fim: hora(l.janela_posse_fim),
    vigencia_inicio: l.vigencia_inicio,
    vigencia_fim: l.vigencia_fim || null,
  }));
}

// -------------------------------------------------------- vigencia sem sobreposicao
// Espelha `_unica_vigente` de tests/runner.py (ADR 0025): duas linhas do CSV
// vigentes na MESMA chave (menos a vigencia) e na mesma data é o defeito do
// padrão "a correção fecha a linha anterior e abre outra" quando alguém
// esquece de fechar. O motor de carga só confere "essa linha já existe?" por
// chave — nunca "essas linhas se contradizem?" — e como `vigencia_inicio` faz
// parte da chave, duas vigências sobrepostas são chaves DIFERENTES: as duas
// entrariam, silenciosamente. Roda antes de qualquer insert, pro catálogo
// inteiro — não dá pra decidir "que linha vale" à toa (ADR 0025, mesmo motivo
// dos resolvedores de app.*_vigente, 0066).
export function conferirVigenciaSemSobreposicao(cat, linhas) {
  if (!cat.chave.includes('vigencia_inicio')) return;
  const dimensoes = cat.chave.filter((c) => c !== 'vigencia_inicio');
  // `estudio_id` não existe na linha antes do SQL resolver pelo nome (`bruto`)
  // — quem já está lá é `estudio`. Sem o fallback, todo `estudio_id` viraria
  // `undefined` e a agrupação juntaria estúdios DIFERENTES, achando
  // sobreposição onde não há nenhuma.
  const campo = (linha, c) => (linha[c] !== undefined ? linha[c] : linha[c.replace(/_id$/, '')]);
  const grupos = new Map();
  for (const linha of linhas) {
    const chave = dimensoes.map((c) => campo(linha, c)).join('\u0000');
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(linha);
  }
  for (const [chave, grupo] of grupos) {
    const ordenado = [...grupo].sort((a, b) => a.vigencia_inicio.localeCompare(b.vigencia_inicio));
    for (let i = 1; i < ordenado.length; i += 1) {
      const anterior = ordenado[i - 1];
      const atual = ordenado[i];
      if (anterior.vigencia_fim === null || anterior.vigencia_fim >= atual.vigencia_inicio) {
        throw new Error(
          `${cat.tabela}: vigencia sobreposta${chave ? ` para ${dimensoes.join('/')}=${chave}` : ''} — `
          + `${anterior.vigencia_inicio}..${anterior.vigencia_fim ?? '(aberta)'} e `
          + `${atual.vigencia_inicio}..${atual.vigencia_fim ?? '(aberta)'}. `
          + 'A linha nova abriu sem fechar a anterior — ADR 0025.');
      }
    }
  }
}

const sql = (texto) => {
  const r = spawnSync('psql', ['--no-psqlrc', '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', texto], {
    env, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
};

const aspas = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// ---------------------------------------------------------------- catálogos
// Cada catálogo diz: de onde vem, o que identifica uma linha (a chave que
// decide "já está lá?"), e como a linha do CSV vira valores.
//
// `estudio` não tem CSV próprio: ele é derivado das linhas `Estudio` de
// staff-altegio.csv, que é onde a operação de fato define quais salas existem.
export const catalogos = [
  {
    tabela: 'estudio',
    colunas: ['nome', 'staff_id', 'ordem_exibicao'],
    chave: ['staff_id'],
    linhas: () => csv('staff-altegio.csv')
      .filter((l) => l.tipo === 'Estudio')
      .map((l) => ({ nome: l.estudio, staff_id: l.staff_id, ordem_exibicao: l.ordem_exibicao })),
  },
  {
    tabela: 'staff_altegio',
    colunas: ['company_id', 'staff_id', 'tipo', 'estudio_id', 'rotulo', 'ativo'],
    chave: ['company_id', 'staff_id'],
    // estudio_id é resolvido no SQL, pelo nome — o CSV não conhece uuid.
    bruto: {
      estudio_id: (l) => (l.tipo === 'estudio'
        ? `(select id from estudio where nome = ${aspas(l.estudio)})`
        : 'null::uuid'),
    },
    linhas: () => csv('staff-altegio.csv').map((l) => ({
      company_id: l.company_id,
      staff_id: l.staff_id,
      tipo: l.tipo === 'Estudio' ? 'estudio' : 'pessoa',
      rotulo: l.rotulo,
      ativo: l.ativo,
      estudio: l.estudio,
    })),
  },
  {
    tabela: 'tabela_preco',
    colunas: ['estudio_id', 'duracao_minutos', 'valor', 'vigencia_inicio', 'vigencia_fim'],
    chave: ['estudio_id', 'duracao_minutos', 'vigencia_inicio'],
    bruto: { estudio_id: (l) => `(select id from estudio where nome = ${aspas(l.estudio)})` },
    linhas: () => csv('precos.csv').map((l) => ({
      duracao_minutos: l.duracao_min,
      valor: l.valor,
      vigencia_inicio: l.vigencia_inicio,
      vigencia_fim: l.vigencia_fim || null,
      estudio: l.estudio,
    })),
  },
  {
    tabela: 'acrescimo_noturno',
    colunas: ['valor', 'vigencia_inicio', 'vigencia_fim'],
    chave: ['vigencia_inicio'],
    linhas: () => csv('acrescimo-noturno.csv').map((l) => ({
      valor: l.valor, vigencia_inicio: l.vigencia_inicio, vigencia_fim: l.vigencia_fim || null,
    })),
  },
  {
    // Sem turno_definicao, app.comanda_criar recusa por falta de responsavel:
    // nao ha janela de posse pra ninguem deter (comanda.md Bloco A).
    //
    // ⚠ Tres colunas do schema nao existem no CSV com esse nome, e cada uma
    // tem motivo proprio — ver a issue #68:
    //
    //   dia_semana        o CSV agrupa ('seg-sex'); o banco e uma linha por dia
    //   primeiro_ensaio   vira NULO, que a migration 0038 definiu como
    //                     "comeca no primeiro ensaio do dia"
    //
    // `hora_fim` e `hora_fim_calculo` viajam cada uma para a sua coluna desde a
    // migration 0068 (issue #143). Antes o carregador gravava `hora_fim` dentro
    // de `hora_fim_calculo` quando esta vinha vazia — a Manha — so para passar
    // no CHECK, e com isso o fim do turno e o limite do acrescimo viraram o
    // mesmo campo. Vazio na Manha agora fica vazio, que e o que o CSV diz.
    tabela: 'turno_definicao',
    colunas: ['dia_semana', 'turno', 'hora_inicio', 'hora_fim', 'hora_fim_calculo',
              'janela_posse_inicio', 'janela_posse_fim', 'vigencia_inicio', 'vigencia_fim'],
    chave: ['dia_semana', 'turno', 'vigencia_inicio'],
    linhas: () => csv('turnos.csv').flatMap(linhaTurnoDefinicao),
  },
  {
    // O catalogo de venda da Comanda (G4). Veio do quadro fisico "Recarregue
    // suas baterias!", fotografado — o mesmo caminho do Checklist no ADR 0032.
    //
    // ⚠ `preco` aqui e o preco de HOJE, e a Comanda NAO o le na venda: ela
    // copia como `preco_snapshot` na linha (comanda.md:134, "linhas lancadas
    // nunca recalculam"). Trocar o preco na tela depois nao mexe em Comanda
    // nenhuma ja lancada — que e exatamente o que se quer.
    //
    // As duas categorias sao as duas paginas do quadro. Nao ha taxonomia mais
    // fina no artefato fisico, e inventar uma aqui seria decidir por quem
    // opera. `saldo_materializado` fica no default 0: saldo e do ledger
    // (movimento_estoque), nunca de carga (ADR 0017).
    tabela: 'item_bomboniere',
    colunas: ['nome', 'categoria', 'preco', 'ativo'],
    chave: ['nome'],
    linhas: () => csv('bomboniere.csv').map((l) => ({
      nome: l.nome, categoria: l.categoria, preco: l.preco, ativo: l.ativo,
    })),
  },
  {
    // Fundos e equipamentos do quadro físico do estúdio. Mesma mecânica de
    // preço do Bomboniere (snapshot na Comanda), sem estoque: fundo e
    // equipamento são reutilizados, não consumidos.
    //
    // ⚠ O CSV escreve 'Fundo'/'Equipamento' e a tabela aceita minúsculo
    // (constraint de 0002).
    tabela: 'item_extra',
    colunas: ['nome', 'tipo', 'preco_uso_interno', 'ativo'],
    chave: ['nome'],
    linhas: () => csv('fundos-equipamentos.csv').map((l) => ({
      nome: l.nome, tipo: l.tipo.toLowerCase(),
      preco_uso_interno: l.preco_uso_interno, ativo: l.ativo,
    })),
  },
  {
    // O catálogo do Checklist (ADR 0032: carga inicial, depois quem manda é a
    // tabela). Seção vazia é Geral — `secao_estudio_id` nulo (0003).
    //
    // ⚠ dias_aplicaveis: o CSV escreve 'todos' ou a lista de dias ('seg,qua,sex');
    // o banco é int[] no padrão do extract(dow): 0 = domingo. 'todos' inclui o
    // domingo, porque domingo com extra também tem checklist — quem decide se o
    // domingo tem expediente é a Escala, não o item.
    tabela: 'item_catalogo',
    colunas: ['nome', 'acao', 'secao_estudio_id', 'fase', 'dias_aplicaveis', 'horario_referencia', 'ordem', 'ativo'],
    chave: ['secao_estudio_id', 'fase', 'nome'],
    bruto: {
      secao_estudio_id: (l) => (l.secao === ''
        ? 'null::uuid'
        : `(select id from estudio where nome = ${aspas(l.secao)})`),
    },
    linhas: () => csv('checklist-itens.csv').map((l) => {
      const fase = { Entrada: 'entrada', Saida: 'saida', Ambas: 'ambas' }[l.fase];
      if (!fase) throw new Error(`checklist-itens.csv: fase desconhecida "${l.fase}"`);
      const DIA = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
      const dias = l.dias_aplicaveis === 'todos'
        ? [0, 1, 2, 3, 4, 5, 6]
        : l.dias_aplicaveis.split(',').map((d) => {
          if (!(d.trim() in DIA)) throw new Error(`checklist-itens.csv: dia desconhecido "${d}"`);
          return DIA[d.trim()];
        });
      return {
        nome: l.nome,
        acao: l.acao,
        secao: l.secao,
        fase,
        dias_aplicaveis: `{${dias.join(',')}}`,
        horario_referencia: l.horario_referencia || null,
        ordem: l.ordem,
        ativo: l.ativo,
      };
    }),
  },
  {
    // Os insumos (Ativo 3). `quantidade` nasce 0 com `conferido_em` nulo, que é
    // o estado "não conferido neste ciclo" — e NÃO é zerado (estoque.md:89). A
    // primeira contagem de verdade é a da equipe.
    //
    // `severidade` só ordena a lista de compra (ADR 0017); `fornecedor` entra cru,
    // sentinela SEM_NOME_PENDENCIA incluída (ADR 0044 §3). `ordem_quadro` não tem
    // coluna: a lista ordena por categoria e nome.
    tabela: 'item_estoque',
    colunas: ['nome', 'categoria', 'severidade', 'fornecedor', 'especificacao_compra', 'quantidade', 'ativo'],
    chave: ['nome'],
    linhas: () => csv('insumos.csv').map((l) => {
      const severidade = { Urgente: 'urgente', Atencao: 'atencao' }[l.severidade];
      if (!severidade) throw new Error(`insumos.csv: severidade desconhecida "${l.severidade}"`);
      return {
        nome: l.nome,
        categoria: l.categoria,
        severidade,
        fornecedor: l.fornecedor || null,
        especificacao_compra: l.especificacao_compra || null,
        quantidade: 0,
        ativo: l.ativo,
      };
    }),
  },
  {
    // Sem este, app.buffer_vigente levanta LT003 e nenhum agendamento entra
    // (fundacao.md:117 — "parâmetro global único, versionado com vigência").
    tabela: 'parametro_buffer',
    colunas: ['minutos', 'vigencia_inicio', 'vigencia_fim'],
    chave: ['vigencia_inicio'],
    linhas: () => csv('parametro-buffer.csv').map((l) => ({
      minutos: l.minutos, vigencia_inicio: l.vigencia_inicio, vigencia_fim: l.vigencia_fim || null,
    })),
  },
];

// O tipo de cada coluna, lido do catalogo do proprio banco. Sem isto a
// comparacao e entre TEXTOS crus, e '08:00' do CSV nunca bate com o
// '08:00:00' que um `time` devolve — toda reexecucao legitima seria acusada
// de divergencia. Os dois lados tem de passar pela mesma normalizacao.
const tiposPorTabela = new Map();
function tiposDe(cat) {
  if (!tiposPorTabela.has(cat.tabela)) {
    // format_type e nao information_schema.data_type: para coluna de lista
    // (item_catalogo.dias_aplicaveis) o data_type diz so 'ARRAY', que nao serve
    // de cast; format_type diz 'integer[]'.
    const bruto = sql(`select coalesce(json_object_agg(attname, format_type(atttypid, atttypmod)), '{}')
                         from pg_attribute
                        where attrelid = ${aspas(`public.${cat.tabela}`)}::regclass
                          and attnum > 0 and not attisdropped`);
    tiposPorTabela.set(cat.tabela, JSON.parse(bruto));
  }
  return tiposPorTabela.get(cat.tabela);
}

const alvoDe = (cat, linha) => (c) => {
  const expr = cat.bruto?.[c] ? cat.bruto[c](linha) : aspas(linha[c]);
  const tipo = tiposDe(cat)[c];
  return tipo ? `(${expr})::${tipo}` : expr;
};

// Compara o que o CSV diz com o que a tabela tem, para a linha daquela chave.
// json_build_array e nao concatenacao: valor com separador dentro nao confunde.
function conferir(cat, linha) {
  const alvo = alvoDe(cat, linha);
  const onde = cat.chave.map((c) => `${c} is not distinct from ${alvo(c)}`).join(' and ');
  const lista = (f) => `json_build_array(${cat.colunas.map((c) => `(${f(c)})::text`).join(', ')})`;

  const atualBruto = sql(`select ${lista((c) => c)} from ${cat.tabela} where ${onde}`);
  if (atualBruto === '') return { estado: 'ausente' };

  const atual = JSON.parse(atualBruto);
  const esperado = JSON.parse(sql(`select ${lista(alvo)}`));

  const difs = cat.colunas
    .map((c, i) => (atual[i] === esperado[i] ? null : `${c}: banco=${atual[i]} csv=${esperado[i]}`))
    .filter(Boolean);

  return difs.length === 0 ? { estado: 'igual' } : { estado: 'divergente', difs };
}

function inserir(cat, linha) {
  const alvo = alvoDe(cat, linha);
  sql(`insert into ${cat.tabela} (${cat.colunas.join(', ')})
       select ${cat.colunas.map(alvo).join(', ')}`);
}

// ------------------------------------------------------------------- main
// Só roda quando chamado direto. Importar este módulo (o teste importa, pra
// conferir o mapa dos catálogos sem banco) não pode disparar a carga — foi o
// que reprovou o job "Webhook, jobs e domínio", que roda sem Postgres.
export function carregar({ conferirApenas = false, saida = console } = {}) {
let inseridos = 0;
let iguais = 0;
const divergencias = [];

for (const cat of catalogos) {
  const linhas = cat.linhas();
  conferirVigenciaSemSobreposicao(cat, linhas);
  let n = 0;
  for (const linha of linhas) {
    const r = conferir(cat, linha);
    if (r.estado === 'igual') { iguais += 1; continue; }
    if (r.estado === 'divergente') {
      const id = cat.chave.map((c) => linha[c] ?? linha.estudio).join('/');
      divergencias.push(`${cat.tabela} ${id} — ${r.difs.join(' · ')}`);
      continue;
    }
    if (!conferirApenas) inserir(cat, linha);
    n += 1; inseridos += 1;
  }
  const verbo = conferirApenas ? 'a inserir' : 'inseridas';
  saida.log(`carga: ${cat.tabela.padEnd(18)} ${String(n).padStart(3)} ${verbo} - ${linhas.length} no CSV`);
}

if (divergencias.length > 0) {
  // Falha alto, como o resto da casa. Divergência significa que alguém editou
  // a tabela depois da carga — e o ADR 0032 diz que, a partir daí, quem manda
  // é a tabela. Sobrescrever seria a carga apagando decisão do Admin.
  saida.error(`\ncarga: ${divergencias.length} linha(s) divergem entre CSV e banco. NADA foi sobrescrito.`);
  for (const d of divergencias) saida.error(`  ${d}`);
  saida.error('\nCarga inicial vale uma vez so (ADR 0032). Se a tabela mudou de proposito,');
  saida.error('o CSV esta velho; se nao, alguem editou o que nao devia. Resolver na mao.');
  return { inseridos, iguais, divergencias };
}

const nota = conferirApenas ? ' - nada foi escrito' : '';
saida.log(`\ncarga: ${inseridos} inserida(s), ${iguais} ja igual(is)${nota}.`);
return { inseridos, iguais, divergencias };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = carregar({ conferirApenas: process.argv.includes('--conferir') });
  if (r.divergencias.length > 0) process.exit(1);
}
