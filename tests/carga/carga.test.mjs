// A carga inicial: o parser de CSV e o mapa dos catalogos.
//
// O caminho que escreve no banco tem teste proprio em tests/db — aqui fica o
// que da pra afirmar sem banco: que o CSV vira as linhas certas, e que o mapa
// nao inventa coluna nem tabela.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  catalogos, lerCsv, linhaTurnoDefinicao, conferirVigenciaSemSobreposicao,
} from '../../src/db/carga.mjs';

const RAIZ = new URL('../../', import.meta.url);
const csv = (nome) => lerCsv(readFileSync(new URL(`data/${nome}`, RAIZ), 'utf8'));

// ------------------------------------------------------------------ o parser
test('le cabecalho e celulas, aparando espaco', () => {
  const linhas = lerCsv('a,b , c\n1, 2,3\n');
  assert.deepEqual(linhas, [{ a: '1', b: '2', c: '3' }]);
});

test('celula faltando vira string vazia, nao undefined', () => {
  assert.deepEqual(lerCsv('a,b,c\n1,2\n'), [{ a: '1', b: '2', c: '' }]);
});

test('CRLF nao deixa \\r grudado no ultimo campo', () => {
  assert.deepEqual(lerCsv('a,b\r\n1,2\r\n'), [{ a: '1', b: '2' }]);
});

test('virgula dentro de aspas fica no campo, e aspas dobradas viram uma aspa', () => {
  assert.deepEqual(lerCsv('nome,dias\n"Luzes, tomadas","seg,qua,sex"\n"Diz ""oi""",todos\n'), [
    { nome: 'Luzes, tomadas', dias: 'seg,qua,sex' },
    { nome: 'Diz "oi"', dias: 'todos' },
  ]);
});

test('arquivo so com cabecalho devolve lista vazia', () => {
  assert.deepEqual(lerCsv('a,b\n'), []);
});

// --------------------------------------------------- os catalogos, um a um
test('estudio sai das linhas Estudio de staff-altegio.csv, e so delas', () => {
  const cat = catalogos.find((c) => c.tabela === 'estudio');
  const linhas = cat.linhas();
  const noCsv = csv('staff-altegio.csv').filter((l) => l.tipo === 'Estudio');
  assert.equal(linhas.length, noCsv.length);
  // Regra 1 da casa: a contagem sai do CSV, nunca de numero escrito aqui.
  assert.ok(linhas.every((l) => l.nome && l.staff_id && l.ordem_exibicao));
});

test('staff_altegio traduz o tipo do CSV para o vocabulario do CHECK', () => {
  const cat = catalogos.find((c) => c.tabela === 'staff_altegio');
  const tipos = new Set(cat.linhas().map((l) => l.tipo));
  // constraint staff_altegio_tipo_check: tipo in ('estudio','pessoa')
  for (const t of tipos) assert.ok(['estudio', 'pessoa'].includes(t), `tipo invalido: ${t}`);
});

test('staff_altegio leva uma linha por linha do CSV — pessoas inclusive', () => {
  const cat = catalogos.find((c) => c.tabela === 'staff_altegio');
  assert.equal(cat.linhas().length, csv('staff-altegio.csv').length);
});

test('tabela_preco leva todas as linhas de precos.csv', () => {
  const cat = catalogos.find((c) => c.tabela === 'tabela_preco');
  assert.equal(cat.linhas().length, csv('precos.csv').length);
});

test('vigencia_fim vazia vira null, nao string vazia', () => {
  const cat = catalogos.find((c) => c.tabela === 'tabela_preco');
  const abertas = cat.linhas().filter((l) => l.vigencia_fim === null);
  assert.ok(abertas.length > 0, 'precos.csv tem vigencia aberta');
  assert.ok(cat.linhas().every((l) => l.vigencia_fim === null || /^\d{4}-\d{2}-\d{2}$/.test(l.vigencia_fim)));
});

test('parametro_buffer existe no mapa — sem ele nenhum agendamento entra', () => {
  const cat = catalogos.find((c) => c.tabela === 'parametro_buffer');
  assert.ok(cat, 'app.buffer_vigente levanta LT003 se a tabela estiver vazia');
  assert.equal(cat.linhas().length, csv('parametro-buffer.csv').length);
});

// -------------------------------------------------- turnos: o CSV agrupa dias
test('seg-sex vira uma linha por dia da semana', () => {
  const cat = catalogos.find((c) => c.tabela === 'turno_definicao');
  const linhas = cat.linhas();
  const noCsv = csv('turnos.csv');
  // Uma linha `seg-sex` no CSV é cinco no banco; `sab` e `dom`, uma cada.
  const esperado = noCsv.reduce((n, l) => n + ({ 'seg-sex': 5, sab: 1, dom: 1 })[l.dia_semana], 0);
  assert.equal(linhas.length, esperado);
  assert.deepEqual([...new Set(linhas.map((l) => l.dia_semana))].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6]);
});

test('o turno vira o vocabulario do CHECK', () => {
  const cat = catalogos.find((c) => c.tabela === 'turno_definicao');
  for (const l of cat.linhas()) {
    assert.ok(['manha', 'tarde_noite', 'extra'].includes(l.turno), `turno invalido: ${l.turno}`);
  }
});

test('`primeiro_ensaio` vira NULO — a regra de fundacao.md:151, nao uma hora', () => {
  const cat = catalogos.find((c) => c.tabela === 'turno_definicao');
  const dom = cat.linhas().find((l) => l.dia_semana === 0);
  assert.equal(dom.turno, 'extra');
  assert.equal(dom.janela_posse_inicio, null, 'a janela abre no primeiro ensaio do dia');
  assert.equal(dom.hora_inicio, null, 'o turno tambem comeca la');
  // fundacao.md:163 — "Domingo: hora_fim_calculo NAO se aplica".
  assert.equal(dom.hora_fim_calculo, null, 'e o acrescimo vale o dia inteiro');
});

// Antes da migration 0068 o carregador gravava `hora_fim` dentro de
// `hora_fim_calculo` quando esta vinha vazia — a Manha — so para passar no
// CHECK de 0038. As duas colunas existem no banco agora, e cada valor do CSV
// viaja para a sua (issue #143).
test('na Manha, hora_fim vai para hora_fim e hora_fim_calculo fica vazia', () => {
  const cat = catalogos.find((c) => c.tabela === 'turno_definicao');
  const manha = cat.linhas().find((l) => l.turno === 'manha');
  const noCsv = csv('turnos.csv').find((l) => l.turno === 'Manha');

  assert.equal(noCsv.hora_fim_calculo, '', 'o CSV realmente deixa vazio');
  assert.equal(manha.hora_fim, noCsv.hora_fim, 'o fim do turno vai para hora_fim');
  assert.equal(manha.hora_fim_calculo, null, 'e a Manha nao ganha limite de acrescimo inventado');
});

// tarde_noite tem os dois, e hoje coincidem no CSV. O teste guarda que cada um
// sai da SUA coluna — com valores iguais, ler a coluna errada passaria.
test('em tarde_noite cada valor sai da coluna correspondente do CSV', () => {
  const cat = catalogos.find((c) => c.tabela === 'turno_definicao');
  const noite = cat.linhas().find((l) => l.turno === 'tarde_noite');
  const noCsv = csv('turnos.csv').find((l) => l.turno === 'Tarde-noite');

  assert.equal(noite.hora_fim, noCsv.hora_fim);
  assert.equal(noite.hora_fim_calculo, noCsv.hora_fim_calculo);
});

test('dia_semana fora do vocabulario levanta, nao vira sinonimo', () => {
  // Se alguem acrescentar `qua` ao CSV achando que e sinonimo de seg-sex, o
  // erro tem de aparecer na carga — nao virar linha faltando em silencio.
  const linha = { ...csv('turnos.csv')[0], dia_semana: 'qua' };
  assert.throws(() => linhaTurnoDefinicao(linha), /dia_semana desconhecido/);
});

test('turno fora do vocabulario levanta, nao vira sinonimo', () => {
  const linha = { ...csv('turnos.csv')[0], turno: 'Madrugada' };
  assert.throws(() => linhaTurnoDefinicao(linha), /turno desconhecido/);
});

test('hora fora do formato HH:MM levanta', () => {
  const linha = { ...csv('turnos.csv')[0], hora_inicio: '8h' };
  assert.throws(() => linhaTurnoDefinicao(linha), /hora invalida/);
});

// ------------------------------------------------- vigencia sem sobreposicao
// ADR 0025 / issue #106: o motor de carga confere "essa linha já existe?" por
// chave — nunca "essas linhas se contradizem?". Sem esta guarda, duas linhas
// de vigência sobreposta (a correção que esqueceu de fechar a anterior)
// entrariam as duas, silenciosamente — o mesmo defeito que `_unica_vigente`
// fecha do lado do runner de domínio.
test('vigencia sobreposta na mesma chave levanta', () => {
  const cat = { tabela: 'tabela_preco', chave: ['estudio_id', 'duracao_minutos', 'vigencia_inicio'] };
  const linhas = [
    { estudio: 'Acustico', duracao_minutos: 60, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-06-30' },
    { estudio: 'Acustico', duracao_minutos: 60, vigencia_inicio: '2026-06-01', vigencia_fim: null },
  ];
  assert.throws(() => conferirVigenciaSemSobreposicao(cat, linhas), /vigencia sobreposta/);
});

test('vigencia aberta seguida de outra linha na mesma chave levanta', () => {
  // A vigencia aberta (`vigencia_fim` null) cobre "daqui pra sempre": qualquer
  // linha nova na mesma chave sobrepoe, mesmo comecando bem depois.
  const cat = { tabela: 'acrescimo_noturno', chave: ['vigencia_inicio'] };
  const linhas = [
    { vigencia_inicio: '2026-01-01', vigencia_fim: null },
    { vigencia_inicio: '2026-06-01', vigencia_fim: null },
  ];
  assert.throws(() => conferirVigenciaSemSobreposicao(cat, linhas), /vigencia sobreposta/);
});

test('vigencia sem sobreposicao (fecha antes da proxima abrir) nao levanta', () => {
  const cat = { tabela: 'tabela_preco', chave: ['estudio_id', 'duracao_minutos', 'vigencia_inicio'] };
  const linhas = [
    { estudio: 'Acustico', duracao_minutos: 60, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-05-31' },
    { estudio: 'Acustico', duracao_minutos: 60, vigencia_inicio: '2026-06-01', vigencia_fim: null },
  ];
  conferirVigenciaSemSobreposicao(cat, linhas);
});

test('vigencia sobreposta so conta dentro da MESMA chave — chaves diferentes nao se misturam', () => {
  // duracao_minutos diferente e outra chave: nao e sobreposicao, mesmo com as
  // mesmas datas — e a mesma distincao que estudio_id/duracao_minutos faz
  // hoje pra Acustico 60min e Branco 60min nao colidirem entre si.
  const cat = { tabela: 'tabela_preco', chave: ['estudio_id', 'duracao_minutos', 'vigencia_inicio'] };
  const linhas = [
    { estudio: 'Acustico', duracao_minutos: 60, vigencia_inicio: '2026-08-10', vigencia_fim: null },
    { estudio: 'Branco', duracao_minutos: 60, vigencia_inicio: '2026-08-10', vigencia_fim: null },
    { estudio: 'Acustico', duracao_minutos: 90, vigencia_inicio: '2026-08-10', vigencia_fim: null },
  ];
  conferirVigenciaSemSobreposicao(cat, linhas);
});

test('todo catalogo com vigencia real (data/) passa sem sobreposicao', () => {
  for (const cat of catalogos) {
    conferirVigenciaSemSobreposicao(cat, cat.linhas());
  }
});

// ------------------------------------------------------------------ item_extra
const fundos = () => catalogos.find((c) => c.tabela === 'item_extra');

test('item_extra leva todas as linhas de fundos-equipamentos.csv', () => {
  assert.equal(fundos().linhas().length, csv('fundos-equipamentos.csv').length);
});

// A constraint de 0002 so aceita minusculo, e o CSV escreve 'Fundo'. Sem a
// conversao a carga inteira estoura — e estoura na primeira linha, longe daqui.
test('o tipo chega minusculo, como o CHECK de comanda exige', () => {
  const tipos = new Set(fundos().linhas().map((l) => l.tipo));
  assert.deepEqual([...tipos].sort(), ['equipamento', 'fundo']);
});

// ------------------------------------------------------------- item_bomboniere
const bomboniere = () => catalogos.find((c) => c.tabela === 'item_bomboniere');

test('item_bomboniere leva todas as linhas de bomboniere.csv', () => {
  assert.equal(bomboniere().linhas().length, csv('bomboniere.csv').length);
});

// O CHECK do banco nao restringe categoria, entao um erro de digitacao viraria
// uma terceira categoria silenciosa na tela da Comanda. As duas sao as duas
// paginas do quadro fisico; categoria nova e decisao, nao digitacao.
test('so existem as duas categorias do quadro', () => {
  const categorias = new Set(bomboniere().linhas().map((l) => l.categoria));
  assert.deepEqual([...categorias].sort(), ['Bebidas', 'Snacks']);
});

// A chave da carga e o nome. Nome repetido faria a segunda linha ser vista como
// "ja esta la" e sumir sem aviso — o CSV diria 25 e o banco teria 24.
test('nenhum nome repetido — a chave da carga e o nome', () => {
  const nomes = bomboniere().linhas().map((l) => l.nome);
  assert.equal(new Set(nomes).size, nomes.length);
});

// `preco` vai pra numeric(10,2). Texto que nao e numero so falharia no psql, com
// a mensagem do Postgres e sem dizer qual linha do CSV.
test('todo preco e numero positivo com no maximo dois decimais', () => {
  for (const l of bomboniere().linhas()) {
    assert.match(l.preco, /^\d+\.\d{2}$/, `${l.nome}: preco "${l.preco}"`);
    assert.ok(Number(l.preco) > 0, `${l.nome}: preco precisa ser positivo`);
  }
});

// O parser agora trata aspas, mas o bomboniere.csv continua sem elas: um nome
// com virgula sem aspas partiria a linha e o preco iria pra coluna errada,
// calado. Este teste e o guarda desse arquivo.
test('nenhum campo tem virgula ou aspas — o parser nao as trata', () => {
  for (const l of csv('bomboniere.csv')) {
    for (const [coluna, valor] of Object.entries(l)) {
      assert.ok(!/[",]/.test(valor), `${l.nome}: ${coluna} tem virgula ou aspas`);
    }
  }
});

// ------------------------------------------------------------- a forma do mapa
test('toda chave de um catalogo esta entre as colunas dele', () => {
  for (const cat of catalogos) {
    for (const c of cat.chave) {
      assert.ok(cat.colunas.includes(c), `${cat.tabela}: chave ${c} fora de colunas`);
    }
  }
});

test('coluna sem valor no CSV tem resolvedor em `bruto`', () => {
  // estudio_id nao existe no CSV: e resolvido por subconsulta pelo nome. Se
  // alguem acrescentar coluna assim e esquecer o resolvedor, o insert manda
  // `null` em silencio — que e como um FK obrigatorio vira erro obscuro.
  for (const cat of catalogos) {
    const amostra = cat.linhas()[0];
    for (const c of cat.colunas) {
      const temValor = amostra[c] !== undefined;
      const temResolvedor = Boolean(cat.bruto?.[c]);
      assert.ok(temValor || temResolvedor, `${cat.tabela}.${c} sem valor nem resolvedor`);
    }
  }
});

// ----------------------------------------------------- checklist e insumos
test('item_catalogo: fase no vocabulario do banco, dias no padrao do dow, secao vazia e Geral', () => {
  const cat = catalogos.find((c) => c.tabela === 'item_catalogo');
  const linhas = cat.linhas();
  assert.equal(linhas.length, csv('checklist-itens.csv').length);
  assert.ok(linhas.every((l) => ['entrada', 'saida', 'ambas'].includes(l.fase)));

  const luzes = linhas.find((l) => l.nome === 'Luzes, tomadas');
  assert.ok(luzes, 'o nome com virgula chega inteiro');
  assert.equal(luzes.dias_aplicaveis, '{0,1,2,3,4,5,6}');

  const lixo = linhas.find((l) => l.nome === 'Lixo');
  assert.deepEqual([lixo.secao, lixo.dias_aplicaveis, lixo.horario_referencia], ['', '{1,3,5}', '18:00']);
});

test('item_estoque: nasce nao conferido, com severidade em minusculas', () => {
  const cat = catalogos.find((c) => c.tabela === 'item_estoque');
  const linhas = cat.linhas();
  assert.equal(linhas.length, csv('insumos.csv').length);
  assert.ok(linhas.every((l) => l.quantidade === 0));
  assert.ok(linhas.every((l) => ['urgente', 'atencao'].includes(l.severidade)));
  assert.ok(linhas.every((l) => !l.nome.includes('"')), 'as aspas do CSV nao entram no nome');
});
