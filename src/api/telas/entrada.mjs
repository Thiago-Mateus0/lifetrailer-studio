// GET /tela/entrada — a única tela lida SEM claim, porque é ela que leva à
// claim. Devolve o que o quiosque precisa pra desenhar a lista de quem pode
// entrar: nome e papel de quem está ativo, e se há Aviso Urgente esperando.
//
// ⚠ Sem claim significa sem `set_config`, o que significa que esta consulta não
// pode tocar em nada que chame app.colaborador_atual() — ela estouraria, e
// estourar é o comportamento certo dela (ADR 0020 §1). `colaborador` não tem
// RLS (0011 ligou RLS só nas sete financeiras) e o SELECT é por coluna desde a
// 0034: pin_hash e senha_hash não são legíveis por este role nem se alguém
// pedir. `aviso` e `confirmacao_leitura` também não têm RLS.
import { data, hora, papel } from './formato.mjs';

// Só Atendente: Administrador e Desenvolvedor entram por senha, no computador
// (ADR 0049). Listá-los no tablet contaria quem são a quem só vê o balcão.
//
// A marca do urgente é a regra do `avisos_meus` da Sidebar, filtrada por
// prioridade. Só a marca sai daqui: o texto do aviso fica para depois do PIN,
// porque esta tela é de quem estiver no balcão (ADR 0070 §1).
const CONSULTA = `
select coalesce(jsonb_agg(jsonb_build_object(
         'id', c.id, 'nome', c.nome, 'nivel_acesso', c.nivel_acesso,
         'aviso_urgente', exists (
           select 1 from aviso a
            where a.status = 'ativo' and a.prioridade = 'urgente' and a.pede_confirmacao
              and c.id = any (a.snapshot_colaboradores)
              and not exists (select 1 from confirmacao_leitura cl
                               where cl.comunicado_id = a.id and cl.colaborador_id = c.id
                                 and cl.edicao = a.edicao)))
         order by c.nome), '[]'::jsonb) as pessoas
  from colaborador c
 where c.ativo and c.nivel_acesso = 'atendente'`;

export function montarEntrada(linha, config, agora) {
  return {
    hora: hora(agora),
    data: data(agora),
    local: config.local,
    aparelho: config.dispositivo,
    pessoas: linha.pessoas.map((c) => ({
      identificador: c.id,
      nome: c.nome,
      papel: papel(c.nivel_acesso),
      avisoUrgente: c.aviso_urgente,
    })),
  };
}

export function criarTelaEntrada(pool, config) {
  // A assinatura é a mesma das telas com claim — o roteador chama todas igual.
  // Entrada ignora a sessão porque não há uma: é ela que produz a primeira.
  return async function entrada(_sessao, _parametros, agora = new Date()) {
    const { rows } = await pool.query(CONSULTA);
    return montarEntrada(rows[0], config, agora);
  };
}

export { CONSULTA as CONSULTA_ENTRADA };
