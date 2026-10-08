// GET /tela/ajustes — PINs de acesso, perfis e o histórico de troca de PIN.
//
// Devolve o `DadosAjustes` de src/app/src/telas/Ajustes.tsx.
//
// Quem edita é o Administrador: app.pin_definir chama exigir_admin (0034), e
// "Redefinição de PIN por Admin, com log" (spec/ui.md). Para qualquer outro
// perfil a tela é a de acesso restrito e não lê pessoa nenhuma.
//
// ⚠ Diferenças do mockup:
// - O PIN atual nunca é mostrado nem sabido: a 0034 revogou `select` em
//   pin_hash. A tela desenha a máscara sozinha.
// - Não existe perfil "Sócio". Os perfis são os três de nivel_acesso, com o
//   acesso resumido da matriz de permissoes.md.
// - O histórico vem de app.audit_log_consultar, a única leitura do log para o
//   role da app, e só para o Administrador: a mesma função GRAVA uma linha
//   quando o Desenvolvedor consulta (permissoes.md:32), e um GET de tela não
//   pode escrever no log a cada vez que alguém abre a página.
import { enderecoDaMidia } from '../midia.mjs';
import { CTE_EU, exigirColaborador } from './colaborador.mjs';
import { hora, iniciais, papel } from './formato.mjs';

const CONSULTA = `
with ${CTE_EU.trim()},
-- ADR 0050: dar acesso é do sócio. A gerente é Administradora e recebe a tela
-- restrita — não lê pessoa nenhuma, como qualquer outro perfil.
eu_socio as (
  select c.socio from colaborador c, eu where c.id = eu.id
)
select
  (select nome         from eu) as eu_nome,
  (select nivel_acesso from eu) as eu_perfil,
  coalesce((select socio from eu_socio), false) as eu_socio,
  $2::timestamptz as agora,
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'nivel', c.nivel_acesso, 'socio', c.socio, 'login', c.login,
      -- O ID, não a url: ela é a chave no storage (ADR 0051 §2).
      'foto_id', case when m.expirada_em is null then m.id end)
      order by case c.nivel_acesso when 'atendente' then 1 else 0 end, c.nome)
    from colaborador c left join midia m on m.id = c.foto_midia_id
   where c.ativo and coalesce((select socio from eu_socio), false)), '[]'::jsonb) as pessoas,
  -- Issue #216: a equipe inteira, com quem está desativado, para o sócio reativar.
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'nivel', c.nivel_acesso, 'socio', c.socio,
      'ativo', c.ativo, 'versao', c.versao, 'eu', c.id = (select id from eu))
      order by c.nome)
    from colaborador c
   where coalesce((select socio from eu_socio), false)), '[]'::jsonb) as equipe`;

// Janela do histórico. É apresentação, não regra: a tela mostra "as últimas"
// alterações, e o log inteiro continua lá.
const DIAS_DE_HISTORICO = 30;

const CONSULTA_HISTORICO = `
select alvo.nome as alvo, autor.nome as por, l.ts_servidor as quando
  from app.audit_log_consultar($2::timestamptz - make_interval(days => $3::int), $2::timestamptz, $1::uuid) l
  left join colaborador alvo  on alvo.id = l.registro_id
  left join colaborador autor on autor.id = l.autor_id
 where l.acao = 'pin_definido'
 order by l.ts_servidor desc
 limit 10`;

const PERFIS = [
  { identificador: 'socio', papel: 'Sócio', acesso: 'tudo, mais dar acesso e ler o registro de auditoria' },
  { identificador: 'administrador', papel: 'Gerente', acesso: 'aprova, paga, tranca competência, desbloqueia PIN' },
  { identificador: 'desenvolvedor', papel: 'Desenvolvedor', acesso: 'configura e faz as ações técnicas' },
  { identificador: 'atendente', papel: 'Atendente', acesso: 'opera o turno' },
];

const diaMesFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });

export function montarAjustes(linha, historico, agora, config) {
  exigirColaborador(linha);
  const l = linha;
  const podeEditar = l.eu_perfil === 'administrador' && l.eu_socio === true;
  const rodape = `${config.local} · ${config.dispositivo} · v${config.versao}`;

  return {
    hora: hora(agora),
    turno: iniciais(l.eu_nome),
    subtitulo: podeEditar ? 'Sócio · a troca de PIN fica registrada no histórico' : '',
    podeEditar,
    pessoas: l.pessoas.map((p) => ({
      identificador: p.id,
      nome: p.nome,
      papel: p.socio ? 'Sócio' : p.nivel === 'administrador' ? 'Gerente' : papel(p.nivel),
      nivel: p.nivel,
      ...(p.foto_id ? { foto: enderecoDaMidia(p.foto_id, config.segredo, () => agora.getTime()) } : {}),
    })),
    // Issue #220: trocar a própria é de quem entra por senha; redefinir a de
    // outra pessoa é do sócio, só para quem tem senha (Atendente entra por PIN).
    minhaSenha: l.eu_perfil === 'administrador' || l.eu_perfil === 'desenvolvedor',
    acessos: l.pessoas.filter((p) => p.nivel !== 'atendente').map((p) => ({
      identificador: p.id,
      nome: p.nome,
      login: p.login ?? '',
    })),
    equipe: (l.equipe ?? []).map((p) => ({
      identificador: p.id,
      nome: p.nome,
      papel: p.socio ? 'Sócio' : p.nivel === 'administrador' ? 'Gerente' : papel(p.nivel),
      ativo: p.ativo,
      versao: p.versao,
      souEu: p.eu,
    })),
    perfis: PERFIS,
    auditoria: historico.map((h, i) => ({
      identificador: String(i),
      alvo: h.alvo ?? '—',
      por: h.por ?? 'sistema',
      quando: `${diaMesFmt.format(new Date(h.quando))} · ${hora(new Date(h.quando))}`,
    })),
    rotuloPines: podeEditar ? 'editável' : '',
    rotuloPinesAparencia: 'normal',
    mensagemPermissao: 'Trocar PIN e dar acesso é dos sócios. Peça a um sócio.',
    mensagemAuditoriaVazia: `Nenhuma troca de PIN nos últimos ${DIAS_DE_HISTORICO} dias.`,
    rodape,
  };
}

export function criarTelaAjustes(comSessao, config) {
  return async function ajustes(sessao, _parametros, agora = new Date()) {
    const { linha, historico } = await comSessao(sessao, async (cliente) => {
      const { rows } = await cliente.query(CONSULTA, [sessao.colaboradorId, agora.toISOString()]);
      // O histórico sai do audit log, que só o sócio lê (ADR 0050).
      if (rows[0]?.eu_socio !== true) return { linha: rows[0], historico: [] };
      const h = await cliente.query(CONSULTA_HISTORICO, [
        sessao.colaboradorId, agora.toISOString(), DIAS_DE_HISTORICO,
      ]);
      return { linha: rows[0], historico: h.rows };
    });
    return montarAjustes(linha, historico, agora, config);
  };
}

export { CONSULTA as CONSULTA_AJUSTES, CONSULTA_HISTORICO as CONSULTA_HISTORICO_AJUSTES, DIAS_DE_HISTORICO };
