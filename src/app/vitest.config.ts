import { defineConfig as definirConfiguracao, mergeConfig as mesclarConfiguracoes } from 'vitest/config'

import configuracaoVite from './vite.config'

export default mesclarConfiguracoes(
  configuracaoVite,
  definirConfiguracao({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setup-testes.ts'],
    },
  }),
)
