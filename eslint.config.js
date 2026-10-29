import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Core code must run unchanged in the browser, in workers, in Vitest and under `node scripts/*.ts`.
// tests/architecture.test.ts enforces the same rules from source text, independently of lint.
const CORE_DIRS = ['src/engine', 'src/exact', 'src/coach', 'src/sim', 'src/physics/core']
const ROUNDING_DIRS = ['src/engine', 'src/exact', 'src/coach']
const TESTS = ['**/*.test.ts']

const coreImports = {
  paths: ['react', 'react-dom', 'three', 'zustand', 'idb-keyval'].map((name) => ({
    name,
    message: 'Core code must not depend on UI, rendering or storage libraries.',
  })),
  patterns: [
    {
      group: ['react/*', 'react-dom/*', 'three/*', '@react-three/*', 'zustand/*', 'idb-keyval/*'],
      message: 'Core code must not depend on UI, rendering or storage libraries.',
    },
    {
      regex: '^\\.\\.?/(?:[^/]+/)*(?:ui|dome|persistence|workers)(?:/|$)',
      message: 'Core code must not import the ui, dome, persistence or workers shells.',
    },
  ],
}

/** @type {(names: string[], message: string) => { name: string; message: string }[]} */
const restrict = (names, message) => names.map((name) => ({ name, message }))
const coreGlobals = [
  ...restrict(
    ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB'],
    'Core code is pure: no DOM or storage APIs.',
  ),
  ...restrict(
    [
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'setImmediate',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
    'Core code is synchronous and pure: no timers.',
  ),
  ...restrict(['Date', 'performance'], 'Core code must not read the clock.'),
  ...restrict(['crypto'], 'Dice come only from engine RNG state; seeds are made in the ui shell.'),
  ...restrict(['process', 'Buffer', 'globalThis'], 'Core code must not use Node or host globals.'),
]

const mathRandom = {
  object: 'Math',
  property: 'random',
  message: 'Dice come only from seeded engine RNG state, so tests and replays reproduce.',
}
const dateNow = { object: 'Date', property: 'now', message: 'Core code must not read the clock.' }
const mathRounding = ['floor', 'round', 'ceil'].map((property) => ({
  object: 'Math',
  property,
  message: 'Round money only in engine/core/{money,rational}.ts, with an explicit Rounding.',
}))

export default defineConfig([
  globalIgnores(['dist', 'dist-e2e', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // Typed rules. The project service resolves each file through the references in tsconfig.json.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Applies to core tests too: they must not pull in shells, and must use pinned seeds.
    files: CORE_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
    rules: {
      'no-restricted-imports': ['error', coreImports],
      'no-restricted-properties': ['error', mathRandom],
    },
  },
  {
    // Shipped core code only; core tests run under Node and may time themselves.
    files: CORE_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
    ignores: TESTS,
    rules: {
      'no-restricted-globals': ['error', ...coreGlobals],
      'no-restricted-properties': ['error', mathRandom, dateNow],
    },
  },
  {
    // Flat config replaces rule options, so this block repeats the core properties above.
    files: ROUNDING_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
    ignores: [...TESTS, 'src/engine/core/money.ts', 'src/engine/core/rational.ts'],
    rules: {
      'no-restricted-properties': ['error', mathRandom, dateNow, ...mathRounding],
    },
  },
])
