import { useEffect, useState } from 'react'

// O tablet fica com o app aberto dias a fio, e o JS carregado não muda com o
// deploy: a tela velha continua falando com a API nova e leva 400 em campo que
// ela não conhece (o "campo ausente: forma_pagamento" de 02/10).
declare const __VERSAO_DO_APP__: string

export const VERSAO_DO_APP = __VERSAO_DO_APP__

const INTERVALO = 5 * 60_000

/** A versão publicada no servidor, ou nulo se não deu pra saber (dev, rede caída). */
export async function versaoPublicada(): Promise<string | null> {
  try {
    const resposta = await fetch('/versao.json', { cache: 'no-store' })
    if (!resposta.ok) return null
    const corpo = (await resposta.json()) as { versao?: unknown }
    return typeof corpo.versao === 'string' ? corpo.versao : null
  } catch {
    return null
  }
}

/**
 * Uma recarga sozinha por bundle. Se o navegador devolver o mesmo bundle do
 * cache, a segunda vez só avisa — senão a Entrada pisca recarregando sem parar.
 */
export function podeRecarregarSozinho(): boolean {
  const chave = `lt-recarregou-${VERSAO_DO_APP}`
  try {
    if (sessionStorage.getItem(chave) !== null) return false
    sessionStorage.setItem(chave, '1')
    return true
  } catch {
    return false
  }
}

/** Verdadeiro quando o servidor já publicou outra versão do app. */
export function useVersaoNova(): boolean {
  const [nova, definirNova] = useState(false)

  useEffect(() => {
    if (nova) return
    const conferir = () => {
      void versaoPublicada().then((versao) => {
        if (versao !== null && versao !== VERSAO_DO_APP) definirNova(true)
      })
    }
    conferir()
    window.addEventListener('online', conferir)
    const relogio = window.setInterval(conferir, INTERVALO)
    return () => {
      window.removeEventListener('online', conferir)
      window.clearInterval(relogio)
    }
  }, [nova])

  return nova
}
