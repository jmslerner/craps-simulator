/**
 * The source-text scanner behind tests/architecture.test.ts.
 *
 * It lexes every file itself instead of asking ESLint or TypeScript, so a file that slips out of a
 * lint glob or a tsconfig include is still checked. The lexer is deliberately small: it only has to
 * keep comments, strings, template text and regex literals from being read as code.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, sep } from 'node:path'

export type TokenKind = 'word' | 'number' | 'string' | 'template' | 'regex' | 'punct'

export interface Token {
  readonly kind: TokenKind
  /**
   * The identifier or punctuator, or a string literal's contents with escapes left as written. A
   * template literal without substitutions is a string too; other template text is left empty.
   */
  readonly text: string
  readonly line: number
}

export interface ImportRef {
  readonly specifier: string
  readonly line: number
}

export interface Usage {
  readonly name: string
  readonly line: number
}

export type Rule =
  | 'layering'
  | 'purity'
  | 'rounding'
  | 'seeded-random'
  | 'src-boundary'
  | 'import-extension'
  | 'oracle-independence'

export interface Violation {
  readonly file: string
  readonly line: number
  readonly rule: Rule
  readonly message: string
}

const WORD = /[A-Za-z_$][\w$]*/y
const NUMBER = /\.?\d[\w.]*/y
/** Words after which `/` starts a regex literal; after any other word it is a division. */
const REGEX_AFTER = new Set([
  ...['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void'],
  ...['throw', 'case', 'do', 'else', 'yield', 'await'],
])

/** Splits source into tokens and drops comments. Positions are kept only as line numbers. */
export function lex(source: string): Token[] {
  const tokens: Token[] = []
  const substitutions: number[] = [] // brace depth outside each open `${`
  let depth = 0
  let line = 1
  let i = source.startsWith('#!') ? Math.max(source.indexOf('\n'), 0) : 0
  const ch = (k: number) => source.charAt(k)
  const push = (kind: TokenKind, text: string, from = line) => {
    tokens.push({ kind, text, line: from })
  }
  const advance = (to: number) => {
    for (; i < to && i < source.length; i++) if (ch(i) === '\n') line++
  }
  const sticky = (pattern: RegExp) => {
    pattern.lastIndex = i
    return pattern.exec(source)?.[0] ?? ''
  }

  // Template text runs to the closing backtick or the next `${`, whose code is lexed normally. A
  // template with no substitutions is a plain string, so import(`./x.ts`) still names its module.
  const readTemplate = (head: boolean) => {
    const from = line
    const start = i
    while (i < source.length) {
      const c = ch(i)
      if (c === '`') {
        push(head ? 'string' : 'template', head ? source.slice(start, i) : '', from)
        i++
        return
      }
      if (c === '$' && ch(i + 1) === '{') {
        i += 2
        substitutions.push(depth)
        depth++
        push('punct', '${')
        return
      }
      advance(i + (c === '\\' ? 2 : 1))
    }
  }

  // An unterminated string ends at the line break, so an apostrophe in JSX text costs one line.
  const readString = (quote: string) => {
    let end = i + 1
    while (end < source.length && ch(end) !== quote && ch(end) !== '\n') {
      end += ch(end) === '\\' ? 2 : 1
    }
    push('string', source.slice(i + 1, end))
    advance(end + 1)
  }

  const readRegex = (): boolean => {
    let end = i + 1
    let inClass = false
    for (; end < source.length; end++) {
      const c = ch(end)
      if (c === '\n') return false
      if (c === '\\') end++
      else if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) break
    }
    if (end >= source.length) return false
    end++
    while (/[a-z]/i.test(ch(end))) end++
    push('regex', source.slice(i, end))
    i = end
    return true
  }

  while (i < source.length) {
    const c = ch(i)
    const next = ch(i + 1)
    if (/\s/.test(c)) {
      advance(i + 1)
    } else if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end < 0 ? source.length : end
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      advance(end < 0 ? source.length : end + 2)
    } else if (c === "'" || c === '"') {
      readString(c)
    } else if (c === '`') {
      i++
      readTemplate(true)
    } else if (c === '}' && substitutions.at(-1) === depth - 1) {
      substitutions.pop()
      depth--
      i++
      readTemplate(false)
    } else if (c === '/' && regexMayStart(tokens.at(-1)) && readRegex()) {
      // readRegex consumed the literal.
    } else if (/[A-Za-z_$]/.test(c)) {
      const word = sticky(WORD)
      push('word', word)
      i += word.length
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(next))) {
      const number = sticky(NUMBER)
      push('number', number)
      i += number.length
    } else {
      if (c === '{') depth++
      else if (c === '}') depth--
      push('punct', c)
      i++
    }
  }
  return tokens
}

function regexMayStart(prev: Token | undefined): boolean {
  if (prev === undefined) return true
  if (prev.kind === 'punct') return prev.text !== ')' && prev.text !== ']'
  return prev.kind === 'word' && REGEX_AFTER.has(prev.text)
}

const isPunct = (token: Token | undefined, text: string) =>
  token?.kind === 'punct' && token.text === text
const isWord = (token: Token | undefined, text: string) =>
  token?.kind === 'word' && token.text === text

/** Tokens that end an import or export clause before any `from`. */
const CLAUSE_STOP = new Set([';', '(', ')', '=', '.'])
const CLAUSE_STOP_WORDS = new Set(['import', 'export', 'const', 'let', 'var', 'function', 'class'])

/**
 * Module specifiers from static, side-effect, type-only and dynamic imports, `export ... from`
 * and `require()`, written as strings or as templates without substitutions. Specifiers built at
 * run time cannot be resolved and are not reported.
 */
export function findImports(tokens: readonly Token[]): ImportRef[] {
  const found: ImportRef[] = []
  const add = (token: Token) => found.push({ specifier: token.text, line: token.line })
  const fromClause = (start: number) => {
    for (let j = start; j < tokens.length; j++) {
      const token = tokens[j]!
      if (token.kind === 'string' && isWord(tokens[j - 1], 'from')) return token
      if (token.kind === 'punct' && CLAUSE_STOP.has(token.text)) return undefined
      if (token.kind === 'word' && CLAUSE_STOP_WORDS.has(token.text)) return undefined
    }
    return undefined
  }
  const isReExport = (k: number) => {
    const at = isWord(tokens[k + 1], 'type') ? k + 2 : k + 1
    return isPunct(tokens[at], '{') || isPunct(tokens[at], '*')
  }

  tokens.forEach((token, k) => {
    if (token.kind !== 'word' || isPunct(tokens[k - 1], '.')) return
    const next = tokens[k + 1]
    const argument = tokens[k + 2]
    const isImport = token.text === 'import'
    if ((isImport || token.text === 'require') && isPunct(next, '(')) {
      if (argument?.kind === 'string') add(argument)
    } else if (isImport && next?.kind === 'string') {
      add(next)
    } else if (isImport || (token.text === 'export' && isReExport(k))) {
      const specifier = fromClause(k + 1)
      if (specifier) add(specifier)
    }
  })
  return found
}

const REFERENCE = /^[ \t]*\/\/\/[ \t]*<reference\s+(?:path|types|lib)\s*=\s*["']([^"']*)["']/gm

/** Triple-slash directives, which pull ambient types (DOM, Node) into whatever program reads them. */
export function findReferences(source: string): ImportRef[] {
  return [...source.matchAll(REFERENCE)].map((match) => ({
    specifier: match[1] ?? '',
    line: source.slice(0, match.index).split('\n').length,
  }))
}

/** Objects that also reach a global such as `Math`, as in `globalThis.Math.random()`. */
const HOSTS = new Set(['globalThis', 'window', 'self', 'global'])

/**
 * References to the given globals, and uses of the given members, written as `Math.random`,
 * `Math['random']`, `globalThis.Math.random` or `const { random } = Math`.
 * Property accesses (`state.window`), object keys and type members (`window: ...`) are skipped.
 * There is no scope analysis, so a local that shadows a banned global is reported (rename it), and
 * an alias such as `const M = Math` is not followed.
 */
export function findUsages(
  tokens: readonly Token[],
  globals: ReadonlySet<string>,
  members: ReadonlySet<string>,
): Usage[] {
  const found: Usage[] = []
  tokens.forEach((token, k) => {
    if (token.kind !== 'word') return
    const viaHost = isHostMember(tokens, k)
    if (!viaHost && isPropertyName(tokens, k)) return
    const member = memberName(tokens, k)
    if (member !== undefined && members.has(`${token.text}.${member}`)) {
      found.push({ name: `${token.text}.${member}`, line: token.line })
      return
    }
    if (member === undefined) {
      for (const key of destructuredKeys(tokens, viaHost ? k - 2 : k)) {
        const name = `${token.text}.${key.text}`
        if (members.has(name)) found.push({ name, line: key.line })
      }
    }
    if (!viaHost && globals.has(token.text)) found.push({ name: token.text, line: token.line })
  })
  return found
}

/**
 * Uses of the given methods on any value, such as `share.toFixed(2)` or `f['toNumber']()`. The
 * scanner cannot see types, so, like the lint rule, it goes by the method name alone.
 */
export function findMethodUses(tokens: readonly Token[], methods: ReadonlySet<string>): Usage[] {
  const found: Usage[] = []
  tokens.forEach((token, k) => {
    if (!methods.has(token.text)) return
    const dotted = token.kind === 'word' && isPunct(tokens[k - 1], '.') && !isSpread(tokens, k)
    const computed =
      token.kind === 'string' &&
      isPunct(tokens[k - 1], '[') &&
      isPunct(tokens[k + 1], ']') &&
      !regexMayStart(tokens[k - 2])
    if (dotted || computed) found.push({ name: token.text, line: token.line })
  })
  return found
}

const isSpread = (tokens: readonly Token[], k: number) =>
  isPunct(tokens[k - 2], '.') && isPunct(tokens[k - 3], '.')

function isPropertyName(tokens: readonly Token[], k: number): boolean {
  const prev = tokens[k - 1]
  if (isPunct(prev, '.') && !isSpread(tokens, k)) return true
  const next = tokens[k + 1]
  const keyLike = isPunct(next, ':') || (isPunct(next, '?') && isPunct(tokens[k + 2], ':'))
  return keyLike && !isPunct(prev, '?') && !isWord(prev, 'case')
}

/** `Math` in `globalThis.Math`: still the global, not a property of some other value. */
function isHostMember(tokens: readonly Token[], k: number): boolean {
  const host = tokens[k - 2]
  return (
    isPunct(tokens[k - 1], '.') &&
    host?.kind === 'word' &&
    HOSTS.has(host.text) &&
    !isPunct(tokens[k - 3], '.')
  )
}

function memberName(tokens: readonly Token[], k: number): string | undefined {
  const [a, b, c] = [tokens[k + 1], tokens[k + 2], tokens[k + 3]]
  if (isPunct(a, '.') && b?.kind === 'word') return b.text
  if (isPunct(a, '?') && isPunct(b, '.') && c?.kind === 'word') return c.text
  if (isPunct(a, '[') && b?.kind === 'string' && isPunct(c, ']')) return b.text
  return undefined
}

const OPENERS = new Set(['{', '(', '['])
const CLOSERS = new Set(['}', ')', ']'])
const DECLARATIONS = new Set(['const', 'let', 'var'])

/**
 * The keys of an object pattern assigned from the expression that starts at `start`: `random` and
 * `floor` in `const { random, floor: f } = Math`, also with a type annotation, as a computed
 * `['random']` key, or in `({ random } = Math)`. Keys of nested patterns are not included.
 */
function destructuredKeys(tokens: readonly Token[], start: number): Token[] {
  if (!isPunct(tokens[start - 1], '=')) return []
  const close = patternEnd(tokens, start - 2)
  const open = close === undefined ? undefined : matchingOpen(tokens, close)
  if (close === undefined || open === undefined || !opensPattern(tokens[open - 1])) return []
  const keys: Token[] = []
  let nesting = 0
  for (let j = open + 1; j < close; j++) {
    const token = tokens[j]!
    if (nesting === 0 && (j === open + 1 || isPunct(tokens[j - 1], ','))) {
      const computed =
        isPunct(token, '[') && isPunct(tokens[j + 2], ']') ? tokens[j + 1] : undefined
      const key = computed ?? token
      if (key.kind === 'word' || key.kind === 'string') keys.push(key)
    }
    if (token.kind === 'punct' && OPENERS.has(token.text)) nesting++
    else if (token.kind === 'punct' && CLOSERS.has(token.text)) nesting--
  }
  return keys
}

/**
 * The `}` closing the object pattern that ends at or before `before`, the token ahead of an `=`.
 * A type annotation in between is skipped, even one that is itself an object type literal.
 */
function patternEnd(tokens: readonly Token[], before: number): number | undefined {
  if (isPunct(tokens[before], '}')) {
    const open = matchingOpen(tokens, before)
    if (open !== undefined && !isPunct(tokens[open - 1], ':')) return before
  }
  // Walk back over the annotation to the `:` that follows the pattern.
  let nesting = 0
  for (let j = before; j >= 0; j--) {
    const token = tokens[j]!
    if (token.kind === 'word' && DECLARATIONS.has(token.text)) return undefined
    if (token.kind !== 'punct') continue
    if (token.text === '>' && isPunct(tokens[j - 1], '=')) {
      j-- // `=>` in a function type
    } else if (CLOSERS.has(token.text) || token.text === '>') {
      nesting++
    } else if (OPENERS.has(token.text) || token.text === '<') {
      if (--nesting < 0) return undefined
    } else if (nesting === 0 && token.text === ':') {
      return isPunct(tokens[j - 1], '}') ? j - 1 : undefined
    } else if (nesting === 0 && [';', ',', '='].includes(token.text)) {
      return undefined
    }
  }
  return undefined
}

/** What a destructuring pattern can follow: a declaration, a parameter list, or a list item. */
const opensPattern = (token: Token | undefined) =>
  (token?.kind === 'word' && DECLARATIONS.has(token.text)) ||
  isPunct(token, '(') ||
  isPunct(token, ',')

/** The `{` matched by the `}` at `close`. The `}` ending a `${` substitution is never a token. */
function matchingOpen(tokens: readonly Token[], close: number): number | undefined {
  let depth = 0
  for (let j = close; j >= 0; j--) {
    if (isPunct(tokens[j], '}')) depth++
    else if (isPunct(tokens[j], '{') && --depth === 0) return j
  }
  return undefined
}

type Layer = 'engine/core' | 'engine' | 'exact' | 'coach' | 'sim' | 'physics/core'

/**
 * The import graph from CLAUDE.md: engine → exact → coach → ui, with sim on engine and exact.
 * engine/core is the base the rest of the engine stands on, so it imports only itself, and
 * physics/core stands apart with Rapier.
 */
const LAYERS: Record<Layer, { readonly imports: readonly Layer[]; readonly packages: string[] }> = {
  'engine/core': { imports: ['engine/core'], packages: [] },
  engine: { imports: ['engine/core', 'engine'], packages: ['zod'] },
  exact: { imports: ['engine/core', 'engine', 'exact'], packages: [] },
  coach: { imports: ['engine/core', 'engine', 'exact', 'coach'], packages: [] },
  sim: { imports: ['engine/core', 'engine', 'exact', 'sim'], packages: [] },
  'physics/core': {
    imports: ['physics/core'],
    packages: ['@dimforge/rapier3d-deterministic-compat'],
  },
}
/** Most specific first, so `src/engine/core/x.ts` is in engine/core, not engine. */
const LAYER_ORDER: readonly Layer[] = [
  'engine/core',
  'physics/core',
  'engine',
  'exact',
  'coach',
  'sim',
]
const TEST_PACKAGES = new Set(['vitest', 'fast-check'])

const DOM = 'core code is pure: no DOM or storage APIs'
const TIMERS = 'core code is synchronous and pure: no timers'
const CLOCK = 'core code must not read the clock'
const HOST = 'core code must not use Node or host globals'
const PURITY_REASONS = new Map<string, string>([
  ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB'].map(
    (name) => [name, DOM] as const,
  ),
  ...['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate'].map(
    (name) => [name, TIMERS] as const,
  ),
  ...['queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
    (name) => [name, TIMERS] as const,
  ),
  ['Date', CLOCK],
  ['performance', CLOCK],
  ['crypto', 'dice come only from engine RNG state; seeds are made in the ui shell'],
  ...['process', 'Buffer', 'globalThis'].map((name) => [name, HOST] as const),
])
const PURITY_GLOBALS: ReadonlySet<string> = new Set(PURITY_REASONS.keys())
const NO_GLOBALS: ReadonlySet<string> = new Set()
const RANDOM = 'Math.random'
const ROUNDING = ['Math.floor', 'Math.round', 'Math.ceil', 'Math.trunc']
/** Number#toFixed and #toPrecision, and Fraction#toNumber, all turn exact amounts into floats. */
const FLOAT_METHODS: ReadonlySet<string> = new Set(['toFixed', 'toPrecision', 'toNumber'])
const ROUNDING_LAYERS: readonly Layer[] = ['engine/core', 'engine', 'exact', 'coach']
const ROUNDING_HOMES = new Set(['src/engine/core/money.ts', 'src/engine/core/rational.ts'])

/**
 * What an oracle module must not import: shared rule code cannot catch its own bugs. The reducer
 * (`table`) and the session layer that drives it run that rule code too.
 */
const ORACLE_FORBIDDEN_DIRS = [
  'src/exact',
  'src/engine/bets',
  'src/engine/round',
  'src/engine/settle',
  'src/engine/table',
  'src/engine/session',
]
/** The engine barrel re-exports the rules, and the rulesets hold the engine's own rule constants. */
const ORACLE_FORBIDDEN_FILES = [
  'src/engine',
  'src/engine/index.ts',
  'src/engine/config/rulesets.ts',
]
/**
 * The dispatch-chain oracle drives the real reducer, so it may import the engine's rule code. It
 * still must not import the solver it is compared with.
 */
const DISPATCH_CHAIN = 'tests/oracle/dispatchChain.ts'
const DISPATCH_CHAIN_FORBIDDEN_DIRS = ['src/exact']

const TEST_FILE = /\.test\.tsx?$/
const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const RELATIVE = /^\.\.?(?:\/|$)/
/**
 * What a relative or root import may end in: a TypeScript module, or an asset Vite can import. A
 * list rather than "any extension", so `./physics.worker` cannot pass for `./physics.worker.ts`.
 * eslint.config.js keeps the same list.
 */
const IMPORTABLE =
  /\.(?:tsx?|css|json|wasm|svg|png|jpe?g|gif|webp|avif|ico|glb|gltf|hdr|ktx2|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|txt|glsl|vert|frag|wgsl)$/

function layerOf(path: string): Layer | undefined {
  return LAYER_ORDER.find((layer) => path.startsWith(`src/${layer}/`))
}

/** `src/engine, src/exact` for engine/core, engine and exact: a sub-layer goes without saying. */
function describeLayers(layers: readonly Layer[]): string {
  return layers
    .filter((name) => !layers.some((other) => name.startsWith(`${other}/`)))
    .map((name) => `src/${name}`)
    .join(', ')
}

/** Drops a Vite query such as `?worker` or `?url`, which names no file. */
const withoutQuery = (specifier: string) => specifier.replace(/\?.*$/, '')

const isPathSpecifier = (specifier: string) => RELATIVE.test(specifier) || specifier.startsWith('/')

/** Repo-relative target of a relative or root-absolute specifier; undefined for packages. */
function resolveSpecifier(file: string, specifier: string): string | undefined {
  const path = withoutQuery(specifier)
  if (RELATIVE.test(path)) return posix.normalize(posix.join(posix.dirname(file), path))
  if (path.startsWith('/')) return posix.normalize(path.slice(1))
  return undefined
}

const within = (target: string, dirs: readonly string[]) =>
  dirs.some((dir) => target === dir || target.startsWith(`${dir}/`))

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return (specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]) ?? specifier
}

/**
 * Checks one file. `file` is repo-relative with forward slashes, e.g. `src/engine/core/dice.ts`.
 * Core tests (`*.test.ts`) run under Node: they keep the import rules and the Math.random ban
 * (randomized tests use pinned seeds), but may use Node APIs, time themselves and round freely.
 * Everything under `tests/` keeps the Math.random ban as well.
 */
export function checkSource(file: string, source: string): Violation[] {
  const tokens = lex(source)
  const imports = findImports(tokens)
  const violations: Violation[] = []
  const report = (line: number, rule: Rule, message: string) => {
    violations.push({ file, line, rule, message })
  }
  const isTest = TEST_FILE.test(file)
  const layer = layerOf(file)

  // Node's type stripping and the bundler both need the file's own name; neither guesses it.
  if (file.startsWith('src/') || file.startsWith('tests/')) {
    for (const { specifier, line } of imports) {
      if (isPathSpecifier(specifier) && !IMPORTABLE.test(withoutQuery(specifier))) {
        report(line, 'import-extension', `'${specifier}' must end in .ts, .tsx or an asset type`)
      }
    }
  }

  if (layer !== undefined) {
    const allowed = LAYERS[layer]
    for (const { specifier, line } of imports) {
      const target = resolveSpecifier(file, specifier)
      if (target !== undefined) {
        const targetLayer = layerOf(target)
        if (targetLayer === undefined || !allowed.imports.includes(targetLayer)) {
          const dirs = describeLayers(allowed.imports)
          report(line, 'layering', `src/${layer} may import only ${dirs}, not ${target}`)
        }
        continue
      }
      const name = packageName(specifier)
      const testTool = isTest && (TEST_PACKAGES.has(name) || specifier.startsWith('node:'))
      if (!allowed.packages.includes(name) && !testTool) {
        report(line, 'layering', `src/${layer} may not import the package '${name}'`)
      }
    }

    const roundingBanned = !isTest && ROUNDING_LAYERS.includes(layer) && !ROUNDING_HOMES.has(file)
    const members = new Set([RANDOM, ...(roundingBanned ? ROUNDING : [])])
    const usages = findUsages(tokens, isTest ? NO_GLOBALS : PURITY_GLOBALS, members)
    for (const { name, line } of usages) {
      if (name === RANDOM) {
        report(line, 'seeded-random', 'Math.random: draw from seeded engine RNG so runs reproduce')
      } else if (ROUNDING.includes(name)) {
        report(line, 'rounding', `${name}: round money only in engine/core/{money,rational}.ts`)
      } else {
        report(line, 'purity', `${name}: ${PURITY_REASONS.get(name) ?? 'banned in core code'}`)
      }
    }
    if (roundingBanned) {
      for (const { name, line } of findMethodUses(tokens, FLOAT_METHODS)) {
        report(line, 'rounding', `.${name}(): keep amounts exact; use formatCents or formatPercent`)
      }
    }
    if (!isTest) {
      for (const { specifier, line } of findReferences(source)) {
        report(line, 'purity', `/// <reference> to '${specifier}' pulls ambient types into core`)
      }
    }
  } else if (file.startsWith('src/')) {
    for (const { specifier, line } of imports) {
      const target = resolveSpecifier(file, specifier)
      if (target !== undefined && !target.startsWith('src/')) {
        report(line, 'src-boundary', `src/ must not import from outside src/: ${target}`)
      }
    }
  }

  // Oracle tests compare an oracle with the engine, so only the oracle modules are restricted.
  if (file.startsWith('tests/oracle/') && !isTest) {
    const chain = file === DISPATCH_CHAIN
    for (const { specifier, line } of imports) {
      const target = resolveSpecifier(file, specifier)
      if (target === undefined) continue
      if (chain && within(target, DISPATCH_CHAIN_FORBIDDEN_DIRS)) {
        const message = `the dispatch chain must not import the solver it checks: ${target}`
        report(line, 'oracle-independence', message)
      } else if (
        !chain &&
        (ORACLE_FORBIDDEN_FILES.includes(target) || within(target, ORACLE_FORBIDDEN_DIRS))
      ) {
        report(line, 'oracle-independence', `oracles must not import shared rule code: ${target}`)
      }
    }
  }
  // Randomized tests use pinned seeds, so every failure reproduces: the oracles, scenarios,
  // properties, golden values and the slow suite alike.
  if (file.startsWith('tests/')) {
    for (const { line } of findUsages(tokens, NO_GLOBALS, new Set([RANDOM]))) {
      report(line, 'seeded-random', 'Math.random: draw from a seeded RNG so failures reproduce')
    }
  }
  return violations
}

export function formatViolation(violation: Violation): string {
  return `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`
}

/** Scans every TypeScript and JavaScript file under `dirs` (repo-relative); returns sorted paths. */
export function scanTree(
  root: string,
  dirs: readonly string[],
): { files: string[]; violations: Violation[] } {
  const files = dirs
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
        .filter((entry) => SOURCE_FILE.test(entry))
        .map((entry) => posix.join(dir, entry.split(sep).join('/'))),
    )
    .sort()
  const violations = files.flatMap((file) =>
    checkSource(file, readFileSync(join(root, file), 'utf8')),
  )
  return { files, violations }
}
