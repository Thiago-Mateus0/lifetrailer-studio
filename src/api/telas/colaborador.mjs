// Quem a claim descreve, e se essa pessoa ainda existe.
//
// Toda tela com claim lê o colaborador pela mesma razão que a Home passou a ler
// na PR #81: a claim vale até a virada do turno, e quem foi desativado hoje
// continuaria lendo a operação até lá. Nas escritas quem barra é
// app.exigir_ator (0014); na leitura, é o `and c.ativo` desta consulta.
//
// ⚠ Sem crase nos comentários de SQL: eles moram dentro de template literal.
export const CTE_EU = `
eu as (
  select c.id, c.nome, c.nivel_acesso
    from colaborador c
   where c.id = $1::uuid and c.ativo
)`;

// A claim diz quem é, mas quem confere se a pessoa ainda existe é a consulta.
// O servidor traduz este código em 401, que manda o tablet de volta pra Entrada.
export function exigirColaborador(linha) {
  if (linha === undefined || linha.eu_nome === null || linha.eu_nome === undefined) {
    const erro = new Error('colaborador da claim nao esta ativo');
    erro.code = 'LT_SEM_COLABORADOR';
    throw erro;
  }
}

export const ehAtendente = (nivelAcesso) => nivelAcesso === 'atendente';
