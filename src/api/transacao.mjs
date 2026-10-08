// A transação em que toda leitura e toda escrita do app acontecem.
//
// ⚠ O ponto inteiro deste arquivo é o terceiro argumento do set_config. `true`
// é LOCAL: morre no COMMIT. Sem ele o valor vaza para a próxima requisição que
// pegar a mesma conexão do pool, e o vazamento é silencioso — a query devolve
// dado de outra pessoa sem erro nenhum (ADR 0020 §1).
//
// Por isso nenhum caminho do servidor recebe um cliente do pool direto: quem
// quer falar com o banco passa por aqui, e aqui o GUC é sempre setado.

export function criarSessaoDeBanco(pool) {
  // `origem` é 'atendente' | 'admin' | 'sistema' (ADR 0020 §1). Vem do perfil da
  // claim, não do corpo da requisição.
  return async function comSessao({ colaboradorId, origem }, corpo) {
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(
        `select set_config('app.colaborador_id', $1, true),
                set_config('app.origem',         $2, true),
                -- Regra global 2: o fuso da operacao e America/Maceio. Vale
                -- para o que chega SEM fuso: o fim praticado que a Comanda
                -- manda como hora local. As consultas de tela nao dependem
                -- disto, porque todas dizem at time zone na mao.
                set_config('timezone', 'America/Maceio', true)`,
        [colaboradorId, origem],
      );
      const saida = await corpo(cliente);
      await cliente.query('commit');
      return saida;
    } catch (erro) {
      // Rollback pode falhar junto (conexão morta). O erro que interessa é o
      // primeiro; engolir o segundo aqui evita mascarar a causa.
      await cliente.query('rollback').catch(() => {});
      throw erro;
    } finally {
      cliente.release();
    }
  };
}

// A abertura de sessão é o único caminho que roda ANTES de existir identidade:
// é ela que descobre quem é. Não seta GUC nenhum, e por isso não pode tocar em
// nada além de app.sessao_abrir — que é SECURITY DEFINER e se defende sozinha.
export function criarAberturaDeSessao(pool) {
  // `ip` entra em tentativa_pin junto do dispositivo (migration 0043). O ADR
  // 0039 §4 prometeu que a tentativa serve pra investigar, e `dispositivo` é uma
  // constante do processo: sem o IP, toda tentativa tem a mesma cara — a do
  // tablet — inclusive a que veio de fora (issue #77).
  return async function abrirSessao({ colaboradorId, pin, dispositivo, ip = null }) {
    const { rows } = await pool.query(
      'select app.sessao_abrir($1::uuid, $2::text, $3::text, $4::inet) as resultado',
      [colaboradorId, pin, dispositivo, ip],
    );
    return rows[0].resultado;
  };
}

// A autenticação do Admin, irmã da abertura de sessão do Atendente: também roda
// ANTES de existir identidade, e por isso também não seta GUC nenhum. Só toca em
// app.admin_autenticar, que é SECURITY DEFINER e se defende sozinha (ADR 0047).
export function criarAutenticacaoAdmin(pool) {
  return async function autenticarAdmin({ login, senha, ip = null }) {
    const { rows } = await pool.query(
      'select app.admin_autenticar($1::text, $2::text, $3::inet) as resultado',
      [login, senha, ip],
    );
    return rows[0].resultado;
  };
}

// A chave do tablet (ADR 0048). Roda antes de existir identidade, como a
// abertura de sessão, e só toca em app.dispositivo_conferir — que é SECURITY
// DEFINER e compara hash: a chave nunca é gravada nem lida em claro.
export function criarConferenciaDeDispositivo(pool) {
  return async function conferirDispositivo(chave) {
    const { rows } = await pool.query('select app.dispositivo_conferir($1::text) as r', [chave]);
    return rows[0].r;
  };
}

// A leitura de uma linha de `midia` pra servir os bytes (ADR 0051 §5).
//
// Sem GUC, como a tela de Entrada: quem autoriza é o token assinado do endereço,
// que o `<img src>` manda na query string porque não manda cabeçalho nenhum.
// Esta consulta toca só em `midia`, que não tem RLS (0011 ligou RLS nas sete
// financeiras) e não chama app.colaborador_atual() — se um dia chamar, estoura,
// que é o comportamento certo dela (ADR 0020 §1).
export function criarLeituraDeMidia(pool) {
  return async function lerMidia(id) {
    const { rows } = await pool.query(
      'select url, mime, expirada_em from midia where id = $1::uuid', [id]);
    return rows[0] ?? null;
  };
}

// Cache curto das conferências que DERAM CERTO. O tablet bate em /tela e /rpc o
// turno inteiro, e cada requisição passaria pelo banco só pra confirmar a mesma
// chave. O preço é explícito: revogar um aparelho leva até `validadeMs` para
// valer. Recusa não entra no cache — chave errada é sempre conferida de novo.
export function comCache(conferir, { validadeMs = 60_000, agora = Date.now } = {}) {
  const lembradas = new Map();
  return async function conferirComCache(chave) {
    const lembrada = lembradas.get(chave);
    if (lembrada !== undefined && lembrada.ate > agora()) return lembrada.r;
    const r = await conferir(chave);
    if (r?.ok) lembradas.set(chave, { r, ate: agora() + validadeMs });
    else lembradas.delete(chave);
    return r;
  };
}
