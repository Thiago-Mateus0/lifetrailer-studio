import type { DadosEstoque } from './Estoque'

// Dados de exemplo de Estoque.dc.html, não são fonte de verdade; os números reais vivem em data/.
// Criticidade, contagens, rótulos, agrupamento e ordem já estão preparados para apresentação.
// ADR 0030: os itens da categoria ilustrativa Gata pertencem a Estúdio.
export const estoqueFixture: DadosEstoque = {
  contexto: 'Estoque · Conferência',
  hora: '14:42',
  turno: 'JA',
  data: '07 AGO 2026',
  titulo: 'Estoque de insumos',
  subtitulo: 'Informe quanto tem. O sistema decide o que é urgente.',
  aba: 'conferir',
  abas: [{ identificador: 'conferir', rotulo: 'Conferir' }, { identificador: 'compra', rotulo: 'Compra · 5' }, { identificador: 'bomboniere', rotulo: 'Bomboniere' }],
  editando: false,
  sincronizacao: { rotulo: 'sem conexão', criticidade: 'urgente' },
  resumo: [
    {"identificador": "conferidos", "texto": "9 de 52 conferidos", "criticidade": "normal"},
    {"identificador": "zerados", "texto": "2 zerados", "criticidade": "urgente"},
    {"identificador": "atencao", "texto": "3 na última unidade", "criticidade": "atencao"},
    {"identificador": "nao-conferidos", "texto": "43 não conferidos", "criticidade": "neutro"},
  ],
  colunas: [
    { identificador: "esquerda", grupos: [
      { identificador: "Limpeza", nome: "Limpeza", resumo: "3 para comprar", insumos: [
        {"identificador": "limpeza:Propés", "nome": "Propés", "meta": "conferido ontem", "unidade": "sacos", "quantidade": "0", "criticidade": "urgente", "rotuloCriticidade": "urgente"},
        {"identificador": "limpeza:Esponja piso", "nome": "Esponja piso", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Papel toalha", "nome": "Papel toalha", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Papel higiênico", "nome": "Papel higiênico", "meta": "conferido há 2 dias", "unidade": "un", "quantidade": "1", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
        {"identificador": "limpeza:CIF", "nome": "CIF", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Vanish", "nome": "Vanish", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Desinfetante", "nome": "Desinfetante", "meta": "conferido ontem", "unidade": "L", "quantidade": "3", "criticidade": "normal"},
        {"identificador": "limpeza:Água sanitária", "nome": "Água sanitária", "meta": "não conferido", "unidade": "L", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Sabonete líquido mãos", "nome": "Sabonete líquido mãos", "meta": "não conferido", "unidade": "L", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Papel H. Premium", "nome": "Papel H. Premium", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Esponja pratos", "nome": "Esponja pratos", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Limpa laminado", "nome": "Limpa laminado", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Tinta piso branco", "nome": "Tinta piso branco", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Tintas Quintal", "nome": "Tintas Quintal", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Detergente", "nome": "Detergente", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Lustra móveis", "nome": "Lustra móveis", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Pastilha adesiva", "nome": "Pastilha adesiva", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Limpa vidros", "nome": "Limpa vidros", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Algodão", "nome": "Algodão", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Sabão em pedra", "nome": "Sabão em pedra", "meta": "conferido há 4 dias", "unidade": "un", "quantidade": "1", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
        {"identificador": "limpeza:Lenço umedecido", "nome": "Lenço umedecido", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Sabão em pó", "nome": "Sabão em pó", "meta": "não conferido", "unidade": "kg", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Freeco", "nome": "Freeco", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Fita crepe/durex/auto", "nome": "Fita crepe/durex/auto", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "limpeza:Odorizador", "nome": "Odorizador", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
      ] },
    ] },
    { identificador: "direita", grupos: [
      { identificador: "Estúdio", nome: "Estúdio", resumo: "2 para comprar", insumos: [
        {"identificador": "estudio:Ração gata", "nome": "Ração gata", "meta": "conferido hoje", "unidade": "kg", "quantidade": "0", "criticidade": "urgente", "rotuloCriticidade": "urgente"},
        {"identificador": "estudio:Areia gata", "nome": "Areia gata", "meta": "conferido hoje", "unidade": "kg", "quantidade": "2", "criticidade": "normal"},
        {"identificador": "estudio:Saco lixo 15L branco", "nome": "Saco lixo 15L branco", "meta": "não conferido", "unidade": "pacotes", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Saco lixo 30L azul", "nome": "Saco lixo 30L azul", "meta": "não conferido", "unidade": "pacotes", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Saco lixo 50L preto", "nome": "Saco lixo 50L preto", "meta": "conferido hoje", "unidade": "pacotes", "quantidade": "1", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
        {"identificador": "estudio:Saco lixo 200L preto", "nome": "Saco lixo 200L preto", "meta": "não conferido", "unidade": "pacotes", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Fundos fotográficos", "nome": "Fundos fotográficos", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Copo 180ml", "nome": "Copo 180ml", "meta": "não conferido", "unidade": "sacos", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Veja banheiro", "nome": "Veja banheiro", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Álcool gel", "nome": "Álcool gel", "meta": "conferido há 3 dias", "unidade": "un", "quantidade": "4", "criticidade": "normal"},
        {"identificador": "estudio:Álcool 70%", "nome": "Álcool 70%", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Aromas estúdios", "nome": "Aromas estúdios", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Cotonete", "nome": "Cotonete", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Panos", "nome": "Panos", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Balinhas", "nome": "Balinhas", "meta": "não conferido", "unidade": "sacos", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "estudio:Refil filtro de água", "nome": "Refil filtro de água", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
      ] },
      { identificador: "Café", nome: "Café", resumo: "10 não conferidos", insumos: [
        {"identificador": "cafe:Café grão", "nome": "Café grão", "meta": "conferido ontem", "unidade": "kg", "quantidade": "2", "criticidade": "normal"},
        {"identificador": "cafe:Café moído", "nome": "Café moído", "meta": "não conferido", "unidade": "kg", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Açúcar", "nome": "Açúcar", "meta": "não conferido", "unidade": "kg", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Açúcar sachê", "nome": "Açúcar sachê", "meta": "não conferido", "unidade": "caixas", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Adoçante sachê", "nome": "Adoçante sachê", "meta": "não conferido", "unidade": "caixas", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Filtro café 102", "nome": "Filtro café 102", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Filtro V60", "nome": "Filtro V60", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Copo to go 100ml", "nome": "Copo to go 100ml", "meta": "não conferido", "unidade": "sacos", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Copo to go 200ml", "nome": "Copo to go 200ml", "meta": "não conferido", "unidade": "sacos", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Filtro máquina espresso", "nome": "Filtro máquina espresso", "meta": "não conferido", "unidade": "un", "quantidade": "—", "criticidade": "neutro"},
        {"identificador": "cafe:Mexedor", "nome": "Mexedor", "meta": "não conferido", "unidade": "caixas", "quantidade": "—", "criticidade": "neutro"},
      ] },
    ] },
  ],
  compra: [{ identificador: 'pendente', nome: 'Sem fornecedor definido', resumo: '5 itens',
    mensagem: 'Pedido · Sem fornecedor definido\n• Propés — 2 sacos', insumos: [
    {"identificador": "limpeza:Propés", "nome": "Propés", "meta": "Limpeza · sacos", "pedido": "· pedir 2 sacos", "quantidade": "0 sacos", "conferido": "ontem", "criticidade": "urgente", "rotuloCriticidade": "urgente"},
    {"identificador": "estudio:Ração gata", "nome": "Ração gata", "meta": "Estúdio · kg", "pedido": "· pedir 1 kg", "quantidade": "0 kg", "conferido": "hoje", "criticidade": "urgente", "rotuloCriticidade": "urgente"},
    {"identificador": "limpeza:Papel higiênico", "nome": "Papel higiênico", "meta": "Limpeza · un", "pedido": "· pedir 3 un", "quantidade": "1 un", "conferido": "há 2 dias", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
    {"identificador": "estudio:Saco lixo 50L preto", "nome": "Saco lixo 50L preto", "meta": "Estúdio · pacotes", "pedido": "", "quantidade": "1 pacotes", "conferido": "hoje", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
    {"identificador": "limpeza:Sabão em pedra", "nome": "Sabão em pedra", "meta": "Limpeza · un", "pedido": "· pedir 1 un", "quantidade": "1 un", "conferido": "há 4 dias", "criticidade": "atencao", "rotuloCriticidade": "atenção"},
  ] }],
  bomboniere: [
    {"identificador": "bomboniere-doritos-32g", "nome": "Doritos 32g", "meta": "Salgadinhos · R$ 7,90", "categoria": "Salgadinhos", "preco": "7,90", "saldo": "14", "criticidade": "normal"},
    {"identificador": "bomboniere-amendoim", "nome": "Amendoim", "meta": "Salgadinhos · R$ 6,50", "categoria": "Salgadinhos", "preco": "6,50", "saldo": "18", "criticidade": "normal"},
    {"identificador": "bomboniere--gua-sem-g-s-500ml", "nome": "Água sem gás 500ml", "meta": "Bebidas · R$ 3,50", "categoria": "Bebidas", "preco": "3,50", "saldo": "22", "criticidade": "normal"},
    {"identificador": "bomboniere--gua-com-g-s-500ml", "nome": "Água com gás 500ml", "meta": "Bebidas · R$ 4,00", "categoria": "Bebidas", "preco": "4,00", "saldo": "12", "criticidade": "normal"},
    {"identificador": "bomboniere-refrigerante-lata", "nome": "Refrigerante lata", "meta": "Bebidas · R$ 6,00", "categoria": "Bebidas", "preco": "6,00", "saldo": "-2", "criticidade": "urgente"},
    {"identificador": "bomboniere-suco-caixinha", "nome": "Suco caixinha", "meta": "Bebidas · R$ 5,50", "categoria": "Bebidas", "preco": "5,50", "saldo": "6", "criticidade": "normal"},
    {"identificador": "bomboniere-chocolate-ao-leite", "nome": "Chocolate ao leite", "meta": "Doces · R$ 8,50", "categoria": "Doces", "preco": "8,50", "saldo": "9", "criticidade": "normal"},
    {"identificador": "bomboniere-bala-de-goma", "nome": "Bala de goma", "meta": "Doces · R$ 5,00", "categoria": "Doces", "preco": "5,00", "saldo": "30", "criticidade": "normal"},
  ],
  nota: '',
  fotoAberta: null,
}

export const estoqueVazioFixture: DadosEstoque = {
  ...estoqueFixture,
  abas: [{ identificador: 'conferir', rotulo: 'Conferir' }, { identificador: 'compra', rotulo: 'Compra' }, { identificador: 'bomboniere', rotulo: 'Bomboniere' }],
  resumo: [
    { identificador: 'conferidos', texto: '0 de 0 conferidos', criticidade: 'normal' },
    { identificador: 'zerados', texto: '0 zerados', criticidade: 'urgente' },
    { identificador: 'atencao', texto: '0 na última unidade', criticidade: 'atencao' },
    { identificador: 'nao-conferidos', texto: '0 não conferidos', criticidade: 'neutro' },
  ],
  colunas: [],
  compra: [],
  bomboniere: [],
}

export const estoqueEditandoFixture: DadosEstoque = { ...estoqueFixture, editando: true }

export const estoqueCompraFixture: DadosEstoque = {
  ...estoqueFixture,
  aba: 'compra',
  contexto: 'Estoque · Lista de compra',
  titulo: 'Lista de compra',
  subtitulo: 'Por fornecedor, como a compra é feita.',
  nota: 'A quantidade sai da conferência do turno; a data mostra quando foi vista.',
}

export const estoqueBomboniereFixture: DadosEstoque = {
  ...estoqueFixture,
  aba: 'bomboniere',
  contexto: 'Estoque · Bomboniere',
  titulo: 'Bomboniere',
  subtitulo: 'Saldo dá baixa automática ao fechar a Comanda.',
  nota: 'Saldo negativo é permitido — fechar nunca bloqueia por falta.',
}

// Alvo ACIMA do saldo: é reposição, e reposição não pede motivo.
export const estoqueAjustandoFixture: DadosEstoque = {
  ...estoqueBomboniereFixture,
  bomboniere: [
    { ...estoqueBomboniereFixture.bomboniere[0], ajuste: { saldo: '14', motivo: '' } },
    ...estoqueBomboniereFixture.bomboniere.slice(1),
  ],
}

// Alvo ABAIXO do saldo: é ajuste, e o ledger exige motivo nele (migration 0053).
export const estoqueTirandoDoSaldoFixture: DadosEstoque = {
  ...estoqueBomboniereFixture,
  bomboniere: [
    { ...estoqueBomboniereFixture.bomboniere[0], ajuste: { saldo: '1', motivo: '' } },
    ...estoqueBomboniereFixture.bomboniere.slice(1),
  ],
}

export const estoqueFotoFixture: DadosEstoque = {
  ...estoqueFixture,
  fotoAberta: { identificador: 'limpeza:Propés', nome: 'Propés', meta: 'Limpeza · sacos' },
}

// Sessão de Admin (ADR 0071, 0080): cada insumo traz a ficha e a versão, cada
// grupo o "Renomear", e a tela recebe os nomes que já existem para sugerir.
export const estoqueAdminFixture: DadosEstoque = {
  ...estoqueFixture,
  fornecedores: ['Atacadão', 'Percarbonato'],
  categorias: ['Estúdio', 'Limpeza'],
  colunas: estoqueFixture.colunas.map((coluna) => ({
    ...coluna,
    grupos: coluna.grupos.map((grupo) => ({
      ...grupo,
      renomear: grupo.nome,
      insumos: grupo.insumos.map((insumo, i) => {
        const fornecedor = i === 0 ? 'Percarbonato' : ''
        return { ...insumo, fornecedor, versao: 3,
          ficha: { nome: insumo.nome, categoria: grupo.nome, fornecedor, especificacao: '', severidade: 'atencao' as const } }
      }),
    })),
  })),
}
