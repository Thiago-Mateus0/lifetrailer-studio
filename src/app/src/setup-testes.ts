import '@testing-library/jest-dom/vitest'
// O jsdom não tem IndexedDB, e a outbox mora nele (ADR 0011 §4).
import 'fake-indexeddb/auto'
import { cleanup as limpar } from '@testing-library/react'
import { afterEach as aposCadaTeste } from 'vitest'

import { esvaziarParaTeste } from './outbox'

aposCadaTeste(async () => {
  limpar()
  await esvaziarParaTeste()
})
