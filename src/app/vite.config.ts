import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// As rotas do ADR 0042 são servidas pelo processo Node do webhook (§1), que em
// dev sobe na 8787. Sem este desvio o `fetch('/tela/home')` bateria no próprio
// Vite e voltaria o index.html — que falha como "JSON inválido", três camadas
// longe da causa.
const API = process.env.LT_APP_API ?? 'http://127.0.0.1:8787'

// A logo vem de docs/design/, fora de src/app: sem isto o dev server responde 403
// ("outside of Vite serving allow list"). O build não tem essa restrição.
const RAIZ_DO_REPO = fileURLToPath(new URL('../..', import.meta.url))

// Uma por build. Vai dentro do bundle e em dist/versao.json; o app compara as
// duas pra saber que o deploy trocou o código debaixo dele (src/versao.ts).
const VERSAO = new Date().toISOString()

export default defineConfig({
  define: { __VERSAO_DO_APP__: JSON.stringify(VERSAO) },
  plugins: [
    react(),
    {
      name: 'versao-do-app',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'versao.json', source: JSON.stringify({ versao: VERSAO }) })
      },
    },
  ],
  server: {
    fs: { allow: [RAIZ_DO_REPO] },
    proxy: Object.fromEntries(['/tela', '/sessao', '/rpc', '/midia', '/comprovante', '/admin/sessao'].map((rota) => [rota, API])),
  },
})
