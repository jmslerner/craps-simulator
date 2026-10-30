// Setup for the ui Vitest project (jsdom). Living in src/ui puts the jest-dom matcher types in
// the app program, which type-checks the ui, dome and persistence tests.
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// `findBy*` and `waitFor` wait 1 s by default. Several tests wait on the real analysis handler,
// whose crapless catalog (side bets included, M11) takes about 0.8 s alone and longer under a
// loaded run; a 4 s ceiling stays under the 5 s test timeout and costs nothing when the answer
// comes early. It is not a performance gate: the exact perf tests time the catalog.
configure({ asyncUtilTimeout: 4000 })

// Testing Library only auto-cleans when Vitest globals are on, and they are off here.
afterEach(() => {
  cleanup()
})
