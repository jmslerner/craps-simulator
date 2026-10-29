import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { builtinModules } from 'node:module'
import tseslint from 'typescript-eslint'

// Core code must run unchanged in the browser, in workers, in Vitest and under `node scripts/*.ts`.
// tests/architecture.test.ts enforces the same rules from source text, independently of lint.
const CORE_DIRS = ['src/engine', 'src/exact', 'src/coach', 'src/sim', 'src/physics/core']
const ROUNDING_DIRS = ['src/engine', 'src/exact', 'src/coach']
const ROUNDING_HOMES = ['src/engine/core/money.ts', 'src/engine/core/rational.ts']
const TESTS = ['**/*.test.ts']

/** @type {(dirs: string[]) => string[]} */
const filesIn = (dirs) => dirs.map((dir) => `${dir}/**/*.{ts,tsx}`)
/** @type {(text: string) => string} */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Node's type stripping and the bundler both need a relative import to name its file. This is the
// IMPORTABLE list from tests/architecture/scanner.ts: TypeScript modules, then asset types.
const IMPORTABLE = [
  'tsx?',
  ...['css', 'json', 'wasm', 'svg', 'png', 'jpe?g', 'gif', 'webp', 'avif', 'ico', 'glb', 'gltf'],
  ...['hdr', 'ktx2', 'woff2?', 'ttf', 'otf', 'mp3', 'ogg', 'wav', 'mp4', 'webm', 'txt'],
  ...['glsl', 'vert', 'frag', 'wgsl'],
]
const extensions = {
  regex: `^(?:\\.\\.?(?:/|$)|/)(?!.*\\.(?:${IMPORTABLE.join('|')})(?:\\?.*)?$)`,
  caseSensitive: true,
  message: 'Name the file: relative and root imports end in .ts, .tsx or an asset extension.',
}

const LIBRARIES = 'Core code must not depend on UI, rendering or storage libraries.'
const libraryPaths = ['react', 'react-dom', 'three', 'zustand', 'idb-keyval'].map((name) => ({
  name,
  message: LIBRARIES,
}))
const libraryGroup = {
  group: ['react/*', 'react-dom/*', 'three/*', '@react-three/*', 'zustand/*', 'idb-keyval/*'],
  message: LIBRARIES,
}
const shells = {
  regex: '^(?:\\.\\.?/(?:[^/]+/)*|/src/)(?:ui|dome|persistence|workers)(?:/|$)',
  message: 'Core code must not import the ui, dome, persistence or workers shells.',
}
const nodeModules = builtinModules.filter((name) => !name.startsWith('node:')).map(escapeRegex)
const nodeBuiltins = {
  regex: `^(?:node:|(?:${nodeModules.join('|')})(?:/|$))`,
  caseSensitive: true,
  message: 'Core code must not use Node APIs: it also runs in browsers and workers.',
}

const LAYERING = 'layers run engine → exact → coach → ui, and sim uses only engine and exact'

/**
 * @typedef {object} Layer
 * @property {string} dir
 * @property {string[]} [bans] the other layers it must not import
 * @property {string[]} [packages] set for a self-contained layer: the only packages it may import
 */

/**
 * The core layers: engine → exact → coach → ui, with sim on engine and exact, while engine/core
 * and physics/core import only themselves. Lint sees only specifier text, so it assumes normalized
 * paths and flat engine/core and physics/core directories; the architecture test resolves paths.
 * @type {Layer[]}
 */
const LAYERS = [
  { dir: 'src/engine', bans: ['exact', 'coach', 'sim', 'physics'] },
  { dir: 'src/exact', bans: ['coach', 'sim', 'physics'] },
  { dir: 'src/coach', bans: ['sim', 'physics'] },
  { dir: 'src/sim', bans: ['coach', 'physics'] },
  // After src/engine, so these options replace the engine's for engine/core files.
  { dir: 'src/engine/core', packages: [] },
  { dir: 'src/physics/core', packages: ['@dimforge/rapier3d-deterministic-compat'] },
]

/**
 * no-restricted-imports options for one layer. The base rule also covers `import type`,
 * `export ... from` and TypeScript's `import x = require()`; the syntax ban below covers the rest.
 * @param {Layer} layer
 * @param {boolean} shipped false for the layer's tests, which may also use test tools and Node
 */
function importRestrictions({ dir, bans = [], packages }, shipped) {
  if (packages) {
    const allowed = [...packages, ...(shipped ? [] : ['vitest', 'fast-check'])]
    const others = allowed.map((name) => `|${escapeRegex(name)}(?:/|$)`).join('')
    const names = [...allowed, ...(shipped ? [] : ['node:*'])].join(', ')
    const message = `${dir} may import only its own files${names ? ` and ${names}` : ''}.`
    return {
      patterns: [
        extensions,
        { regex: '^(?:\\.\\.(?:/|$)|/)', message },
        { regex: `^(?![./]${others}${shipped ? '' : '|node:'})`, caseSensitive: true, message },
      ],
    }
  }
  const layers = {
    regex: `^(?:(?:\\./)?(?:\\.\\./)+|/src/)(?:${bans.join('|')})(?:/|$)`,
    message: `${dir} may not import src/${bans.join(', src/')}: ${LAYERING}.`,
  }
  return {
    paths: libraryPaths,
    patterns: [extensions, libraryGroup, shells, layers, ...(shipped ? [nodeBuiltins] : [])],
  }
}

/** @type {(layer: Layer) => import('eslint').Linter.Config[]} */
const importBlocks = (layer) => [
  {
    // The layer's tests too: they must not pull in other layers or shells either.
    files: filesIn([layer.dir]),
    rules: { 'no-restricted-imports': ['error', importRestrictions(layer, false)] },
  },
  {
    files: filesIn([layer.dir]),
    ignores: TESTS,
    rules: { 'no-restricted-imports': ['error', importRestrictions(layer, true)] },
  },
]

/** Module references that no-restricted-imports cannot see. */
const importForms = [
  {
    selector: 'ImportExpression',
    message: 'Core code is synchronous: import statically, so the import rules can check it.',
  },
  {
    selector: 'TSImportType',
    message: 'Use `import type` instead of an import() type, so the import rules can check it.',
  },
]

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
  ...restrict(
    [
      'process',
      'Buffer',
      'globalThis',
      'global',
      'self',
      'require',
      'module',
      'exports',
      '__dirname',
      '__filename',
    ],
    'Core code must not use Node or host globals.',
  ),
]

const mathRandom = {
  object: 'Math',
  property: 'random',
  message: 'Dice come only from seeded engine RNG state, so tests and replays reproduce.',
}
const dateNow = { object: 'Date', property: 'now', message: 'Core code must not read the clock.' }
const mathRounding = ['floor', 'round', 'ceil', 'trunc'].map((property) => ({
  object: 'Math',
  property,
  message: 'Round money only in engine/core/{money,rational}.ts, with an explicit Rounding.',
}))
// Without types, lint cannot tell a Number from a Fraction, so these are banned on any value.
const floatFormatting = ['toFixed', 'toPrecision', 'toNumber'].map((property) => ({
  property,
  message: 'Keep money and percentages exact: format with formatCents or Fraction.formatPercent.',
}))

// The bans above see `Math.random`, `Math?.floor` and `Math['round']`, but not a member reached
// through Math passed around as a value: an alias, a cast, a wrapper, Reflect.get, parentheses, or
// a host such as `globalThis.Math`. So wherever they apply, Math may appear only as the object of a
// member read with a fixed name, or after typeof, as the architecture test also checks from source
// text. Names called Math, such as object keys, are fine; the type is `typeof Math`, not `Math`.
const MATH_VALUE =
  'Read Math only through a fixed member, such as Math.sqrt, so the bans see it. ' +
  'Its type is typeof Math.'
/** The objects that hold the globals: `globalThis.Math` is Math. */
const HOST = '/^(?:globalThis|window|self|global)$/'
/** Nodes whose `key` is a name, not a value: object and class members, interface members. */
const KEYED = [
  'Property',
  'PropertyDefinition',
  'MethodDefinition',
  'TSPropertySignature',
  'TSMethodSignature',
]
const KEY = `:matches(${KEYED.join(', ')})[computed=false] > Identifier.key`
/** A computed member with a fixed name: `['name']` or `` [`name`] ``. */
const FIXED_NAME =
  "[property.type='Literal'], [property.type='TemplateLiteral'][property.expressions.length=0]"
/** @type {(name: string) => string} A host's member `name`, quoted or a regex, however written. */
const hostMember = (name) =>
  `MemberExpression[object.type='Identifier'][object.name=${HOST}]:matches(` +
  `[computed=false][property.name=${name}], [property.value=${name}], ` +
  `[property.expressions.length=0][property.quasis.0.value.cooked=${name}])`
const MATH_NAMES = [
  'MemberExpression > Identifier.object',
  'MemberExpression[computed=false] > Identifier.property',
  KEY,
  'TSTypeQuery > Identifier.exprName',
  "UnaryExpression[operator='typeof'] > Identifier.argument",
  // A type query of a member, `typeof Math.sqrt`, or a qualified name, `NS.Math`.
  'TSQualifiedName > Identifier.left',
  `TSQualifiedName:not([left.name=${HOST}]) > Identifier.right`,
]
/**
 * The Math rule where `bans` are the banned Math members: Math as a value, Math through a host
 * (`globalThis.Math.random`, `self['Math'][name]`), and type queries of a banned member, such as
 * `typeof Math.random`, which no-restricted-properties does not see.
 * @param {{ property: string, message: string }[]} bans
 * @returns {{ selector: string, message: string }[]}
 */
const mathValue = (bans) => [
  { selector: `Identifier[name='Math']:not(${MATH_NAMES.join(', ')})`, message: MATH_VALUE },
  {
    selector: `MemberExpression[computed=true][object.name='Math']:not(${FIXED_NAME})`,
    message: MATH_VALUE,
  },
  { selector: hostMember("'Math'"), message: MATH_VALUE },
  ...bans.map(({ property, message }) => ({
    selector: `TSQualifiedName[left.name='Math'][right.name='${property}']`,
    message,
  })),
]

// A host passed on (`const g = globalThis`, `Reflect.get(globalThis, 'Math')`) or destructured
// (`const { Math: M } = globalThis`) carries Math out of sight of every rule above. Shipped core
// bans the hosts outright (coreGlobals); in tests, where Math has the same rules, a host may only
// read a member by name. Its typeof, an equality test and a local of the same name, declared as
// `const window = ...`, are not uses of the host.
const HOST_VALUE =
  'Use globalThis, window, self or global only to read a member by name, such as ' +
  'globalThis.structuredClone: passed on, they carry Math out of sight of its bans.'
const EQUALITY = ['==', '===', '!=', '!=='].map((op) => `[operator='${op}']`).join(', ')
const HOST_NAMES = [
  `MemberExpression:matches([computed=false], ${FIXED_NAME}) > Identifier.object`,
  'MemberExpression[computed=false] > Identifier.property',
  KEY,
  'TSTypeQuery > Identifier.exprName',
  "UnaryExpression[operator='typeof'] > Identifier.argument",
  'TSQualifiedName > Identifier.left',
  `TSQualifiedName:not([left.name=${HOST}]) > Identifier.right`,
  'VariableDeclarator > Identifier.id',
  'TSModuleDeclaration > Identifier.id',
  `BinaryExpression:matches(${EQUALITY}) > Identifier`,
]
const hostValue = [
  { selector: `Identifier[name=${HOST}]:not(${HOST_NAMES.join(', ')})`, message: HOST_VALUE },
  // A host read from a host, as `globalThis.self`: name the host itself.
  { selector: hostMember(HOST), message: HOST_VALUE },
]

// Oracle modules (tests/oracle/**, not their tests) are written from the rules spec alone, so they
// must not use the engine's rule code, nor its config code (ratio parsing, presets, compile) or
// money rounding: from src/engine/config they take types only, and from src/engine/core they import
// only rational.ts and dice.ts. The architecture test also follows their imports through other
// modules. Lint sees only each import's own text, so it also bans the test helpers known to reach
// the reducer: the scenario DSL and the property helpers.
const DISPATCH_CHAIN = 'tests/oracle/dispatchChain.ts'
const ORACLE = 'Oracle modules are written from the rules spec: they must not use shared rule code.'
const ORACLE_CONFIG =
  'Oracle modules read machine data from the plain config JSON with their own ratio parsing: ' +
  'take only types from src/engine/config, with import type.'
const ORACLE_CORE =
  'Oracle modules may import from src/engine/core only rational.ts and dice.ts: they round money ' +
  'themselves (import type is fine).'
const RULE_DIRS = ['bets', 'round', 'settle', 'table', 'session'].map((dir) => `src/engine/${dir}`)
// Relative or root specifiers: for a directory and its files, and for one file, Vite query or not.
/** @type {(path: string) => string} */
const inDir = (path) => `^(?:(?:\\.\\.?/)+|/)${path}(?:/|$)`
/** @type {(path: string) => string} */
const isFile = (path) => `^(?:(?:\\.\\.?/)+|/)${path}(?:\\?.*)?$`
const oracleImports = [
  extensions,
  ...['src/exact', ...RULE_DIRS].map((dir) => ({ regex: inDir(dir), message: ORACLE })),
  // The engine barrel, the rulesets (the engine's rule constants) and the helpers that drive it.
  { regex: isFile('src/engine(?:/|/index\\.ts)?'), message: ORACLE },
  { regex: isFile('src/engine/config/rulesets\\.ts'), message: ORACLE },
  { regex: inDir('(?:tests/)?(?:scenarios|properties)'), message: ORACLE },
  // The rest of the config, and of engine/core beyond rational.ts and dice.ts, at run time.
  {
    regex: inDir('src/engine/config(?!/rulesets\\.ts(?:\\?.*)?$)'),
    allowTypeImports: true,
    message: ORACLE_CONFIG,
  },
  {
    regex: inDir('src/engine/core(?!/(?:rational|dice)\\.ts(?:\\?.*)?$)'),
    allowTypeImports: true,
    message: ORACLE_CORE,
  },
]

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
    // The core layers below repeat this pattern, because flat config replaces rule options.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [extensions] }] },
  },
  ...LAYERS.flatMap(importBlocks),
  {
    // Applies to core tests and everything under tests/ too: randomized tests use pinned seeds.
    files: [...filesIn(CORE_DIRS), 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', mathRandom],
      'no-restricted-syntax': ['error', ...mathValue([mathRandom]), ...hostValue],
    },
  },
  {
    // Shipped core code only; core tests run under Node and may time themselves.
    files: filesIn(CORE_DIRS),
    ignores: TESTS,
    rules: {
      'no-restricted-globals': ['error', ...coreGlobals],
      'no-restricted-properties': ['error', mathRandom, dateNow],
      'no-restricted-syntax': ['error', ...importForms, ...mathValue([mathRandom])],
    },
  },
  {
    // Flat config replaces rule options, so this block repeats the core properties above.
    files: filesIn(ROUNDING_DIRS),
    ignores: [...TESTS, ...ROUNDING_HOMES],
    rules: {
      'no-restricted-properties': [
        'error',
        mathRandom,
        dateNow,
        ...mathRounding,
        ...floatFormatting,
      ],
      'no-restricted-syntax': [
        'error',
        ...importForms,
        ...mathValue([mathRandom, ...mathRounding]),
      ],
    },
  },
  {
    files: ['tests/oracle/**/*.{ts,tsx}'],
    ignores: [...TESTS, DISPATCH_CHAIN],
    rules: {
      'no-restricted-imports': ['error', { patterns: oracleImports }],
      // `import { type A } from` still loads its module; only `import type` is erased.
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    // The dispatch chain drives the real reducer, but must not use the solver it checks.
    files: [DISPATCH_CHAIN],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            extensions,
            { regex: inDir('src/exact'), message: 'The dispatch chain must not use the solver.' },
          ],
        },
      ],
    },
  },
])
