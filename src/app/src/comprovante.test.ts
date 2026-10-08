import { describe as descrever, expect as esperar, test as testar } from 'vitest'

import { FONTES, arquivoDoComprovante, lerEstudioCsv, mensagemDoComprovante, montarPdf, secoesDoComprovante } from './comprovante'
import { detalheFechadaFixture } from './telas/Comanda.fixture'
import estudioCsv from '../../../data/estudio.csv?raw'

// 21 SET 2026, 11:20 em Maceió.
const AGORA = new Date('2026-09-21T14:20:00Z')

descrever('secoesDoComprovante', () => {
  const secoes = secoesDoComprovante(detalheFechadaFixture, AGORA)

  testar('cabeçalho da comanda de papel: Nº sem cerquilha, com o Nº do envio', () => {
    esperar([secoes.numero, secoes.envio]).toEqual(['12', 'ENVIO 1'])
  })

  testar('campos da comanda de papel, na ordem dela', () => {
    esperar(secoes.campos).toEqual({
      cliente: 'Conceição Araújo',
      data: '07 AGO 2026',
      estudio: 'Acústico',
      agendado: 'DE 19:00   ÀS 20:00',
      praticado: 'DE 19:00   ÀS 21:10',
      atendente: 'Marcos',
    })
  })

  testar('extras numa lista só: ensaio, um bloco de extensão por linha, extras grupo a grupo', () => {
    esperar(secoes.linhas).toEqual([
      ['Ensaio · 60 min', 'R$ 97,00'],
      ['Extensão · bloco das 20:00', 'R$ 48,50'],
      ['Extensão · bloco das 20:30', 'R$ 48,50'],
      ['Extensão · bloco das 21:00 (inclui 10,00 noturno)', 'R$ 58,50'],
      ['Bomboniere · Biscoito × 2', 'R$ 13,40'],
      ['Fundos · Fundo Branco × 1', 'R$ 30,00'],
    ])
  })

  testar('o total repete o resumo que o banco congelou, sem recalcular', () => {
    esperar(secoes.total).toEqual([
      ['Subtotal', 'R$ 295,90'],
      ['Pago antecipado', '−50,00'],
      ['TOTAL A PAGAR', 'R$ 245,90'],
    ])
  })

  testar('ajuste e total corrigido entram antes do que se paga', () => {
    const corrigida = {
      ...detalheFechadaFixture,
      resumo: {
        ...detalheFechadaFixture.resumo!,
        ajustes: [{ valor: '−20,00', motivo: 'cortesia', competencia: 'SET 2026' }],
        totalCorrigido: 'R$ 275,90', aPagarAgora: 'R$ 225,90',
      },
    }

    esperar(secoesDoComprovante(corrigida, AGORA).total).toEqual([
      ['Subtotal', 'R$ 295,90'],
      ['Ajuste — cortesia', '−20,00'],
      ['Total corrigido', 'R$ 275,90'],
      ['Pago antecipado', '−50,00'],
      ['TOTAL A PAGAR', 'R$ 225,90'],
    ])
  })

  testar('sem ensaio, o horário agendado vem da comanda e o praticado fica em branco', () => {
    const semEnsaio = secoesDoComprovante({ ...detalheFechadaFixture, ensaio: null }, AGORA)

    esperar([semEnsaio.campos.agendado, semEnsaio.campos.praticado]).toEqual(['DE 19:00   ÀS 20:00', ''])
    esperar(semEnsaio.linhas[0][0]).toBe('Extensão · bloco das 20:00')
  })

  testar('rodapé com data e hora do envio, quem enviou e a versão', () => {
    esperar(secoes.rodape).toBe('Enviado em 21 SET 2026, 11:20 por Marcos · versão 1')
  })

  testar('Pix, razão social e CNPJ saem de data/estudio.csv (ADR 0064)', () => {
    const estudio = lerEstudioCsv('razao_social,cnpj,chave_pix\nEstúdio Exemplo LTDA,00.000.000/0000-00,00.000.000/0000-00\n')
    const comPix = secoesDoComprovante(detalheFechadaFixture, AGORA, estudio)

    esperar(comPix.pagamento).toBe('PIX 00.000.000/0000-00 · Estúdio Exemplo LTDA · CNPJ 00.000.000/0000-00')
    esperar(secoesDoComprovante(detalheFechadaFixture, AGORA, null).pagamento).toBe('')
  })

  testar('razão social com vírgula vai entre aspas e não quebra a coluna', () => {
    esperar(lerEstudioCsv('razao_social,cnpj,chave_pix\n"Silva, Souza e Lima",00.000.000/0000-00,00.000.000/0000-00\n')).toEqual({
      razaoSocial: 'Silva, Souza e Lima',
      cnpj: '00.000.000/0000-00',
      chavePix: '00.000.000/0000-00',
    })
  })

  testar('data/estudio.csv tem só o cabeçalho, ou uma linha com os três campos preenchidos', () => {
    const linhas = estudioCsv.trim().split(/\r?\n/)

    esperar(linhas[0]).toBe('razao_social,cnpj,chave_pix')
    esperar(linhas.length).toBeLessThanOrEqual(2)
    if (linhas.length === 2) {
      const estudio = lerEstudioCsv(estudioCsv)
      esperar(estudio && Object.values(estudio).every((campo) => campo !== '')).toBe(true)
    }
    esperar(lerEstudioCsv(estudioCsv)).toEqual(linhas.length === 2 ? esperar.any(Object) : null)
  })

  testar('só nome do cliente: telefone não entra no documento (ADR 0027 §5)', () => {
    esperar(JSON.stringify(secoes)).not.toContain('99999')
  })
})

descrever('montarPdf', () => {
  testar('uma página, com a fonte embutida', () => {
    const pdf = montarPdf(detalheFechadaFixture, AGORA)

    esperar(pdf.getNumberOfPages()).toBe(1)
    // Sem fonte embutida a acentuação quebra (ADR 0011): o arquivo carrega a TTF.
    esperar(pdf.output()).toContain('/FontFile2')
  })

  testar('todo caractere do comprovante existe em cada fonte embutida', () => {
    // O "−" dos valores negativos não existe em toda fonte: sem glifo, o sinal
    // some do PDF em silêncio e o desconto vira cobrança.
    const comNomeDeFora = { ...detalheFechadaFixture, cliente: 'Łukasz Nováček' }
    const pdf = montarPdf(comNomeDeFora, AGORA)
    const caracteres = new Set(JSON.stringify(secoesDoComprovante(comNomeDeFora, AGORA)))

    for (const [familia, espessura] of Object.values(FONTES)) {
      const fonte = pdf.setFont(familia, espessura).getFont() as unknown as {
        metadata: { cmap: { unicode: { codeMap: Record<number, number> } } }
      }
      const faltando = [...caracteres].filter((c) => !fonte.metadata.cmap.unicode.codeMap[c.codePointAt(0)!])
      esperar(faltando).toEqual([])
    }
  })

  testar('observação longa ganha pautas e continua em uma página', () => {
    const comObservacao = { ...detalheFechadaFixture, observacoes: 'Cliente pediu o fundo branco de novo. '.repeat(8) }

    esperar(montarPdf(comObservacao, AGORA).getNumberOfPages()).toBe(1)
  })

  testar('bomboniere longa passa para a segunda página sem quebrar', () => {
    const grupo = detalheFechadaFixture.extras[0]
    const linha = grupo.linhas[0]
    const muitos = {
      ...detalheFechadaFixture,
      extras: [{ ...grupo, linhas: Array.from({ length: 60 }, (_, i) => ({ ...linha, identificador: `l-${i}` })) }],
    }

    esperar(montarPdf(muitos, AGORA).getNumberOfPages()).toBeGreaterThan(1)
  })
})

testar('o arquivo é PDF e o nome diz a comanda e o envio', () => {
  const arquivo = arquivoDoComprovante(detalheFechadaFixture, AGORA)

  esperar(arquivo.type).toBe('application/pdf')
  esperar(arquivo.name).toBe('comprovante-12-envio-1.pdf')
})

testar('a mensagem leva o primeiro nome, a data do ensaio e o link (ADR 0073 §2)', () => {
  esperar(mensagemDoComprovante(detalheFechadaFixture, 'https://lt.exemplo/comprovante/x?t=y')).toBe(
    'Olá, Conceição! Aqui está o comprovante do seu ensaio no Lifetrailer Studio em 07/08/2026: https://lt.exemplo/comprovante/x?t=y',
  )
})
