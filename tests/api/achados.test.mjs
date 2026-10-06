// GET /tela/achados: a consulta no banco e a montagem do DadosAchados.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSULTA_ACHADOS, montarAchados } from '../../src/api/telas/achados.mjs';
import { bancoDisponivel, JANA, PAULO, rodarTela } from './_banco.mjs';

const semBanco = !bancoDisponivel && 'sem Postgres';

const ACUSTICO = 'bbbbbbbb-0000-0000-0000-000000000001';
const OCULOS = '66666666-0000-0000-0000-000000000001';
const RELOGIO = '66666666-0000-0000-0000-000000000002';
const CHAVEIRO = '66666666-0000-0000-0000-000000000004';

// Guardados: oculos com foto ha 3 dias; relogio sem foto ha 2 dias;
// casaco com foto EXPIRADA. Entregue: chaveiro. Doado: guarda-chuva.
// Datas contadas a partir do INSTANTE do harness (quarta, 08:12), não de now():
// a consulta mede "há quantos dias" contra aquele instante.
const ANTES = (intervalo) => `((app.quarta_recente() + time '08:12') at time zone 'America/Maceio') - interval '${intervalo}'`;

const SEMEAR = `
insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id, enviado_por_id, expirada_em) values
  ('77777777-0000-0000-0000-000000000001', 'https://midia/oculos.jpg', 1, 'image/jpeg', 'achado', '${OCULOS}', '${PAULO}', null),
  ('77777777-0000-0000-0000-000000000002', 'https://midia/casaco.jpg', 1, 'image/jpeg', 'achado', '${OCULOS}', '${PAULO}', now());

insert into achado (id, estudio_id, cliente_nome, descricao, datetime_achado, midia_id,
                    status, registrado_por_id, registrado_em, local_guarda) values
  ('${OCULOS}', '${ACUSTICO}', 'Renata', 'Oculos', ${ANTES('3 days')},
   '77777777-0000-0000-0000-000000000001', 'em_posse', '${PAULO}', ${ANTES('3 days')}, 'Gaveta A/P'),
  ('${RELOGIO}', null, null, 'Relogio', ${ANTES('2 days')},
   null, 'aguardando_foto', '${PAULO}', ${ANTES('2 days')}, null),
  ('66666666-0000-0000-0000-000000000003', null, null, 'Casaco', ${ANTES('1 day')},
   '77777777-0000-0000-0000-000000000002', 'em_posse', '${PAULO}', ${ANTES('1 day')}, 'Com a Jana');

insert into achado (id, descricao, datetime_achado, status, registrado_por_id, retirado_por_nome,
                    devolvido_por_id, devolvido_em) values
  ('${CHAVEIRO}', 'Chaveiro', ${ANTES('5 days')}, 'devolvido', '${PAULO}', 'Carlos', '${PAULO}', now());
insert into achado (descricao, datetime_achado, status, registrado_por_id, destino_doacao, doado_por_id, doado_em) values
  ('Guarda-chuva', ${ANTES('100 days')}, 'doado', '${PAULO}', 'Bazar', '${JANA}', now());
`;

const rodar = (comoQuem, { status = ['aguardando_foto', 'em_posse', 'pronto_para_doacao'], achado = null, extra } = {}) =>
  rodarTela({
    consulta: CONSULTA_ACHADOS, comoQuem, semear: SEMEAR, extra,
    json: ['achados', 'selecionado', 'estudios', 'em_guarda'],
    parametros: [
      ['text[]', `'{${status.join(',')}}'`],
      ['uuid', achado === null ? 'null' : `'${achado}'`],
    ],
  });

const AGORA = new Date();

// O segredo que assina o endereço da foto (ADR 0051 §5). Só a montagem precisa
// dele: quem prova a assinatura é tests/api/midia.test.mjs.
const config = { segredo: 's'.repeat(32) };

test('achados: guardados com dias, sem foto e foto expirada', { skip: semBanco }, () => {
  const d = montarAchados(rodar(PAULO), AGORA, 'guardados', config);

  assert.equal(d.subtitulo, '3 itens guardados');
  assert.deepEqual(d.achados.map((a) => a.descricao), ['Casaco', 'Relogio', 'Oculos']);

  const [casaco, relogio, oculos] = d.achados;
  assert.deepEqual([oculos.rotuloStatus, oculos.local], ['3 dias', 'Acustico']);
  // `foto` é o endereço assinado da rota, não a chave no storage (ADR 0051 §2):
  // o que a tela devolve é o que o `<img src>` usa.
  assert.match(oculos.foto, /^\/midia\/77777777-0000-0000-0000-000000000001\?t=/);
  // Sem foto ha mais de 24h: o alerta do spec vira selo urgente.
  assert.deepEqual([relogio.rotuloStatus, relogio.destaque, relogio.local], ['sem foto', 'urgente', 'Sem estúdio']);
  // Arquivo apagado do storage nao e foto (ADR 0036 §2).
  assert.equal(casaco.foto, undefined);
  assert.equal(d.selecionado, undefined);
});

test('achados: as abas Entregues e Doados leem os estados terminais', { skip: semBanco }, () => {
  const entregues = montarAchados(rodar(PAULO, { status: ['devolvido'] }), AGORA, 'entregues', config);
  assert.deepEqual(entregues.achados.map((a) => [a.descricao, a.rotuloStatus]), [['Chaveiro', 'Entregue']]);
  assert.equal(entregues.abas.find((a) => a.selecionada).rotulo, 'Entregues');

  const doados = montarAchados(rodar(PAULO, { status: ['doado'] }), AGORA, 'doados', config);
  assert.deepEqual(doados.achados.map((a) => a.descricao), ['Guarda-chuva']);
});

test('achados: o detalhe diz quem registrou, e o Atendente tem as duas saidas', { skip: semBanco }, () => {
  const atendente = montarAchados(rodar(PAULO, { achado: RELOGIO }), AGORA, 'guardados', config);
  assert.equal(atendente.selecionado.descricao, 'Relogio');
  assert.match(atendente.selecionado.meta, /registrado por Paulo$/);
  assert.equal(atendente.selecionado.linha, 'Cliente não identificado');
  // Qualquer atendente doa qualquer achado (ADR 0068): nenhum botão desativado.
  assert.deepEqual(atendente.selecionado.acoes.map((a) => [a.identificador, a.desativada ?? false]),
    [['entregar', false], ['doar', false]]);
});

test('achados: o detalhe de quem espera foto oferece "Anexar foto", e so ele', { skip: semBanco }, () => {
  // A saida de `aguardando_foto` (ADR 0053 §2): sem ela, um envio que falha
  // deixa o item preso com o alerta de +24h e nenhum caminho de volta.
  const semFoto = montarAchados(rodar(PAULO, { achado: RELOGIO }), AGORA, 'guardados', config);
  assert.equal(semFoto.selecionado.anexarFoto.rotulo, 'Anexar foto');

  // Achado que ja tem foto nao oferece: o write-once recusaria a segunda (LT002).
  const comFoto = montarAchados(rodar(PAULO, { achado: OCULOS }), AGORA, 'guardados', config);
  assert.equal(comFoto.selecionado.anexarFoto, undefined);
});

test('achados: o formulario so existe com ?registrar=1, e traz os estudios ativos', { skip: semBanco }, () => {
  const linha = rodar(PAULO);
  assert.equal(montarAchados(linha, AGORA, 'guardados', config).registro, undefined);

  const { registro } = montarAchados(linha, AGORA, 'guardados', config, true);
  // Estudio e FK, e nao texto: "Estudio 1" digitado nao vira uma (ADR 0053 §3).
  assert.deepEqual(registro.estudios.map((e) => e.rotulo), ['Acustico']);
  // Um lugar so, desde a resposta do Wyll (G11). Os dois achados semeados acima
  // guardam 'Gaveta A/P' e 'Com a Jana' de proposito: sao anteriores a mudanca,
  // e continuam mostrando onde de fato foram guardados — `local_guarda` e texto.
  assert.deepEqual(registro.lugares.map((l) => l.identificador), ['Gaveta']);
  // O esqueleto vem vazio: quem preenche e o rascunho do cliente.
  assert.deepEqual([registro.descricao, registro.data, registro.podeGuardar], ['', '', false]);
});

test('achados: o formulario leva o que ja esta em guarda, com o lugar e a data ISO', { skip: semBanco }, () => {
  // A lista inteira viaja com o esqueleto e o casamento (mesmo estudio e data)
  // e feito na tela: o alerta aparece no toque, e continua aparecendo com a
  // rede ruim — que e quando o mesmo casaco e registrado duas vezes.
  const { registro } = montarAchados(rodar(PAULO), AGORA, 'guardados', config, true);

  // So o que esta em guarda: o Chaveiro entregue e o Guarda-chuva doado ficam
  // fora — item ja entregue nao e duplicata de nada.
  assert.deepEqual(registro.emGuarda.map((a) => a.rotulo),
    ['Casaco · Com a Jana', 'Relogio', 'Oculos · Gaveta A/P']);

  const oculos = registro.emGuarda.find((a) => a.rotulo.startsWith('Oculos'));
  assert.equal(oculos.estudio, ACUSTICO);
  assert.match(oculos.data, /^\d{4}-\d{2}-\d{2}$/);
  // Achado sem estudio vai com string vazia, e nao com null: e o mesmo tipo do
  // botao da tela, que tambem nao tem id quando ninguem escolheu.
  assert.equal(registro.emGuarda.find((a) => a.rotulo === 'Relogio').estudio, '');
  // O `hoje` do servidor e o que a `data` vazia quer dizer.
  assert.match(registro.hoje, /^\d{4}-\d{2}-\d{2}$/);
});

test('achados: "Copiar mensagem" e "Baixar foto" so para o Admin, so com foto, so em guarda', { skip: semBanco }, () => {
  const comFoto = montarAchados(rodar(JANA, { achado: OCULOS }), AGORA, 'guardados', config).selecionado;
  assert.equal(comFoto.compartilhar.rotulo, 'Copiar mensagem');
  assert.equal(comFoto.compartilhar.baixarFoto, 'Baixar foto');
  assert.match(comFoto.compartilhar.texto, /^Oculos — achado \d{2}\/\d{2} no Acustico\./);
  // O que o texto NAO diz e decisao: a observacao e o que confere o dono na
  // retirada, e o nome do cliente e de um terceiro numa conversa que pode ser
  // com a pessoa errada.
  assert.ok(!comFoto.compartilhar.texto.includes('Renata'));

  // O tablet nao manda nada ao cliente: quem procura o dono e a Jana (ADR 0075).
  assert.equal(montarAchados(rodar(PAULO, { achado: OCULOS }), AGORA, 'guardados', config).selecionado.compartilhar, undefined);

  // Sem foto nao ha o que identifique o item do outro lado.
  const semFoto = montarAchados(rodar(JANA, { achado: RELOGIO }), AGORA, 'guardados', config).selecionado;
  assert.equal(semFoto.compartilhar, undefined);

  // Item ja entregue nao tem dono a procurar.
  const entregue = rodar(JANA, {
    status: ['devolvido'],
    extra: `update achado set status = 'devolvido', devolvido_por_id = '${PAULO}', devolvido_em = now() where id = '${OCULOS}';`,
    achado: OCULOS,
  });
  assert.equal(montarAchados(entregue, AGORA, 'entregues', config).selecionado.compartilhar, undefined);
});

test('achados: estudio desativado fica fora do formulario', { skip: semBanco }, () => {
  const linha = rodar(PAULO, { extra: `update estudio set ativo = false where id = '${ACUSTICO}';` });
  assert.deepEqual(montarAchados(linha, AGORA, 'guardados', config, true).registro.estudios, []);
});

// ------------------------------------------- as duas saídas (ADR 0054)
// O formulário de saída é recorte, como o de registro: `?saida=` junto do
// `?achado=`. O esqueleto — o aviso, quem assina, a hora — é do servidor.
test('achados: ?saida=entregar monta o formulário, vazio e com o aviso do servidor', { skip: semBanco }, () => {
  const linha = rodar(PAULO, { achado: OCULOS });
  assert.equal(montarAchados(linha, AGORA, 'guardados', config).selecionado.entrega, undefined);

  const { selecionado } = montarAchados(linha, AGORA, 'guardados', config, false, 'entregar');
  assert.deepEqual([selecionado.entrega.nomeRetirada, selecionado.entrega.podeConfirmar], ['', false]);
  // Quem vai assinar sai da claim, não do que o cliente mandar.
  assert.match(selecionado.entrega.aviso, /^Fica registrado que Paulo entregou hoje /);
  assert.equal(selecionado.doacao, undefined);
  // A versão que a RPC recebe de volta vem no detalhe, e não de contagem local.
  assert.equal(selecionado.versao, 1);
});

test('achados: ?saida=doar monta a gêmea, com o aviso de que não se desfaz', { skip: semBanco }, () => {
  const { selecionado } = montarAchados(rodar(PAULO, { achado: OCULOS }), AGORA, 'guardados', config, false, 'doar');
  assert.deepEqual([selecionado.doacao.destino, selecionado.doacao.podeConfirmar], ['', false]);
  assert.match(selecionado.doacao.aviso, /não se desfaz/);
  assert.equal(selecionado.entrega, undefined);
});

test('achados: ?saida=doar abre para o Atendente em qualquer achado guardado', { skip: semBanco }, () => {
  // Sem trava de perfil na doação (ADR 0068): o recorte abre igual para quem
  // atende e para quem administra.
  for (const quem of [PAULO, JANA]) {
    const { selecionado } = montarAchados(rodar(quem, { achado: RELOGIO }), AGORA, 'guardados', config, false, 'doar');
    assert.equal(selecionado.doacao.destino, '');
  }
});

test('achados: achado que ja saiu nao abre formulario de saida nenhum', { skip: semBanco }, () => {
  const linha = rodar(PAULO, { status: ['devolvido'], achado: CHAVEIRO });
  for (const saida of ['entregar', 'doar']) {
    const { selecionado } = montarAchados(linha, AGORA, 'entregues', config, false, saida);
    assert.deepEqual([selecionado.acoes, selecionado.entrega, selecionado.doacao], [[], undefined, undefined]);
  }
});

test('achados: claim de desativado nao monta a tela', { skip: semBanco }, () => {
  const l = rodar(PAULO, { extra: `update colaborador set ativo = false where id = '${PAULO}';` });
  assert.throws(() => montarAchados(l, AGORA, 'guardados', config), (e) => e.code === 'LT_SEM_COLABORADOR');
});
