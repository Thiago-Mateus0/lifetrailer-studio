// Formatação de apresentação, num lugar só.
//
// Por que no servidor e não no componente: o ADR 0042 §2 diz que o endpoint
// devolve o `Dados<Tela>` que a tela declarou, e esse tipo é de strings prontas
// ('08:12', '17 AGO 2026', '67%'). Espalhar a formatação pelos componentes faria
// cada tela reimplementar o fuso — e o fuso aqui não é detalhe: a competência, a
// janela de posse e o acréscimo noturno são todos definidos em America/Maceio.

export const FUSO = 'America/Maceio';

const horaFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false,
});
const diaFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: 'short', year: 'numeric',
});

export const hora = (quando) => horaFmt.format(quando);

// '17 AGO 2026' — o mockup usa o mês abreviado em caixa alta.
export function data(quando) {
  const partes = Object.fromEntries(
    diaFmt.formatToParts(quando).map((p) => [p.type, p.value]),
  );
  return `${partes.day} ${partes.month.replace('.', '').toUpperCase()} ${partes.year}`;
}

// A data do calendário em Maceió — o "hoje" de toda tela. Não é `new Date()`
// truncado: o servidor pode estar em UTC, e às 22h de Maceió já é o dia seguinte
// lá.
export function hojeEm(quando) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(quando);
}

export function saudacao(quando, nome) {
  const h = Number(hora(quando).slice(0, 2));
  const parte = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return `${parte}, ${nome.split(' ')[0]}`;
}

// As iniciais do canto da Moldura. Duas letras: primeiro e último nome.
export function iniciais(nome) {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? partes.at(-1)[0] : '';
  return (primeira + ultima).toUpperCase();
}

// Denominador zero é 100%: nada pendente é o estado completo, não o vazio.
// '0%' numa lista sem itens leria como "nada feito", que é o oposto.
export const percentual = (feitos, total) =>
  `${total === 0 ? 100 : Math.round((feitos / total) * 100)}%`;

const PAPEL = {
  administrador: 'Admin',
  desenvolvedor: 'Dev',
  atendente: 'Atendente',
};

export const papel = (nivelAcesso) => PAPEL[nivelAcesso] ?? nivelAcesso;

// ADR 0020 §1: 'atendente' | 'admin' | 'sistema'.
//
// ⚠ O Desenvolvedor não tem valor nessa lista de três. Nenhuma policy nem RPC lê
// `app.origem` hoje — o GUC é setado e ninguém consulta —, então mapear para
// 'admin' não muda comportamento nenhum agora. Quando a primeira policy ler,
// isto vira decisão de verdade e precisa de ADR.
export const origemDoPerfil = (nivelAcesso) =>
  nivelAcesso === 'atendente' ? 'atendente' : 'admin';

const decimalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// '7,90' — o número sem símbolo, como o preço da Bomboniere aparece no campo.
export const decimal = (valor) => decimalFmt.format(Number(valor));

// 'R$ 1.250,00'. Espaço comum, não o NBSP do Intl com style currency: o mockup
// e os testes comparam texto, e o NBSP invisível quebraria a comparação.
export const reais = (valor) => `R$ ${decimal(valor)}`;

// Quanto tempo desde um dia, em palavras: 'hoje', 'ontem', 'há 3 dias'.
export function haDias(dias) {
  const n = Number(dias);
  if (n <= 0) return 'hoje';
  if (n === 1) return 'ontem';
  return `há ${n} dias`;
}
