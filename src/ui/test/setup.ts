// Setup for the ui Vitest project (jsdom). Living in src/ui puts the jest-dom matcher types in
// the app program, which type-checks the ui, dome and persistence tests.
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when Vitest globals are on, and they are off here.
afterEach(() => {
  cleanup()
})
