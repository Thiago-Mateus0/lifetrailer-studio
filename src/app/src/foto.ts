// O compressor do tablet (ADR 0026 §1–§3).
//
// Um módulo só, e não a rotina copiada em três telas: é o que aquele ADR exige,
// e é a indireção que paga aluguel — o Checklist e os Achados tiram a mesma
// foto, e mudar o tamanho num lugar só é o ponto de ter versão declarada.
//
// O que ele faz, na ordem: aplica a orientação do EXIF aos PIXELS, joga o resto
// do EXIF fora, reduz pro lado máximo e reencoda em JPEG descendo a qualidade
// até caber. GPS e número de série do aparelho não sobrevivem ao desenho no
// canvas — que é o jeito mais barato de cumprir o §2, porque o canvas não
// carrega metadado nenhum pra frente.
//
// O teto de 1 MB existe nos dois lados: aqui, e no servidor (`midia.mjs`), que é
// o lado que o cliente não contorna.

/** Vai em `midia.origem_compressao` pelo `compressao=` da rota (ADR 0026). */
export const VERSAO_COMPRESSAO = 'lt1'

/** JPEG: o que precisa abrir daqui a cinco anos abre em JPEG (ADR 0026 §3). */
export const MIME_FOTO = 'image/jpeg'

/** 1600px no maior lado. Lê rótulo e mancha; acima disso não muda decisão nenhuma. */
export const LADO_MAX = 1600

export const ALVO_BYTES = 400 * 1024
export const TETO_BYTES = 1024 * 1024

/** "q0.72 descendo em passos até 0.55" (ADR 0026 §1). */
export const QUALIDADES = [0.72, 0.66, 0.6, 0.55]

/**
 * A foto não serve e outra tem de ser tirada. É recusa esperada, não falha:
 * o que estoura 1 MB depois de 1600px e q0.55 é foto de tela ou de documento.
 */
export class FotoRecusada extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'FotoRecusada'
  }
}

/** Só REDUZ: foto pequena sobe do jeito que saiu, sem ampliar pixel nenhum. */
export function medida(largura: number, altura: number) {
  const maior = Math.max(largura, altura)
  if (maior <= LADO_MAX) return { largura, altura }
  const fator = LADO_MAX / maior
  return { largura: Math.round(largura * fator), altura: Math.round(altura * fator) }
}

/**
 * Desce a escada de qualidade e para na primeira que couber no alvo. Nenhuma
 * coube: vale a última — e se nem ela couber no teto, a foto é recusada.
 *
 * `codificar` vem de fora porque é ele que precisa do canvas; o que está aqui é
 * a regra, e a regra é o que se testa.
 */
export async function melhorQualidade(codificar: (qualidade: number) => Promise<Blob>) {
  let ultima: Blob | null = null
  for (const qualidade of QUALIDADES) {
    ultima = await codificar(qualidade)
    if (ultima.size <= ALVO_BYTES) return ultima
  }
  if (ultima === null || ultima.size > TETO_BYTES) {
    throw new FotoRecusada('Esta foto é pesada demais. Tire outra, mais de perto.')
  }
  return ultima
}

/** O arquivo da câmera vira o JPEG que sobe. Recusa o que não couber. */
export async function comprimirFoto(arquivo: Blob): Promise<Blob> {
  // `from-image` aplica a orientação aos pixels (ADR 0026 §2). Sem isso, a foto
  // de retrato sobe deitada — o EXIF que a endireitava é o que estamos jogando
  // fora.
  const imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
  const { largura, altura } = medida(imagem.width, imagem.height)

  const quadro = document.createElement('canvas')
  quadro.width = largura
  quadro.height = altura
  const pincel = quadro.getContext('2d')
  if (pincel === null) throw new FotoRecusada('Este aparelho não conseguiu preparar a foto.')
  pincel.drawImage(imagem, 0, 0, largura, altura)
  imagem.close()

  return melhorQualidade(
    (qualidade) =>
      new Promise<Blob>((resolver, recusar) =>
        quadro.toBlob(
          (saida) => (saida === null ? recusar(new FotoRecusada('Não deu para preparar a foto.')) : resolver(saida)),
          MIME_FOTO,
          qualidade,
        ),
      ),
  )
}
