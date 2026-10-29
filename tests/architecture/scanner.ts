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
  /** The identifier or punctuator, or a string literal's contents with escapes left as written. */
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
  'layering' | 'purity' | 'rounding' | 'seeded-random' | 'src-boundary' | 'oracle-independence'

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

  // Template text runs to the closing backtick or the next `${`, whose code is lexed normally.
  const readTemplate = () => {
    const from = line
    while (i < source.length) {
      const c = ch(i)
      if (c === '`') {
        i++
        push('template', '', from)
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
      readTemplate()
    } else if (c === '}' && substitutions.at(-1) === depth - 1) {
      substitutions.pop()
      depth--
      i++
      readTemplate()
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
 * and `require()`. Specifiers built at run time cannot be resolved and are not reported.
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

/**
 * References to the given globals, and member uses such as `Math.random` or `Math['random']`.
 * Property accesses (`state.window`), object keys and type members (`window: ...`) are skipped.
 * There is no scope analysis, so a local that shadows a banned global is reported: rename it.
 */
export function findUsages(
  tokens: readonly Token[],
  globals: ReadonlySet<string>,
  members: ReadonlySet<string>,
): Usage[] {
  const found: Usage[] = []
  tokens.forEach((token, k) => {
    if (token.kind !== 'word' || isPropertyName(tokens, k)) return
    const member = memberName(tokens, k)
    const qualified = `${token.text}.${member ?? ''}`
    if (member !== undefined && members.has(qualified)) {
      found.push({ name: qualified, line: token.line })
    } else if (globals.has(token.text)) {
      found.push({ name: token.text, line: token.line })
    }
  })
  return found
}

function isPropertyName(tokens: readonly Token[], k: number): boolean {
  const prev = tokens[k - 1]
  const isSpread = isPunct(tokens[k - 2], '.') && isPunct(tokens[k - 3], '.')
  if (isPunct(prev, '.') && !isSpread) return true
  const next = tokens[k + 1]
  const keyLike = isPunct(next, ':') || (isPunct(next, '?') && isPunct(tokens[k + 2], ':'))
  return keyLike && !isPunct(prev, '?') && !isWord(prev, 'case')
}

function memberName(tokens: readonly Token[], k: number): string | undefined {
  const [a, b, c] = [tokens[k + 1], tokens[k + 2], tokens[k + 3]]
  if (isPunct(a, '.') && b?.kind === 'word') return b.text
  if (isPunct(a, '?') && isPunct(b, '.') && c?.kind === 'word') return c.text
  if (isPunct(a, '[') && b?.kind === 'string' && isPunct(c, ']')) return b.text
  return undefined
}

type Layer = 'engine' | 'exact' | 'coach' | 'sim' | 'physics/core'

/** The import graph from CLAUDE.md: engine → exact → coach → ui; sim and physics/core apart. */
const LAYERS: Record<Layer, { readonly imports: readonly Layer[]; readonly packages: string[] }> = {
  engine: { imports: ['engine'], packages: ['zod'] },
  exact: { imports: ['engine', 'exact'], packages: [] },
  coach: { imports: ['engine', 'exact', 'coach'], packages: [] },
  sim: { imports: ['engine', 'exact', 'sim'], packages: [] },
  'physics/core': {
    imports: ['physics/core'],
    packages: ['@dimforge/rapier3d-deterministic-compat'],
  },
}
const LAYER_ORDER: readonly Layer[] = ['physics/core', 'engine', 'exact', 'coach', 'sim']
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
const ROUNDING = ['Math.floor', 'Math.round', 'Math.ceil']
const ROUNDING_LAYERS: readonly Layer[] = ['engine', 'exact', 'coach']
const ROUNDING_HOMES = new Set(['src/engine/core/money.ts', 'src/engine/core/rational.ts'])
/** Shared rule code an oracle must not import; the engine barrel re-exports it. */
const ORACLE_FORBIDDEN_DIRS = ['src/engine/bets', 'src/engine/round', 'src/engine/settle']
const ORACLE_FORBIDDEN_FILES = new Set(['src/engine', 'src/engine/index.ts'])

const TEST_FILE = /\.test\.tsx?$/
const SOURCE_FILE = /\.[cm]?tsx?$/

function layerOf(path: string): Layer | undefined {
  return LAYER_ORDER.find((layer) => path.startsWith(`src/${layer}/`))
}

/** Repo-relative target of a relative or root-absolute specifier; undefined for packages. */
function resolveSpecifier(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(file), specifier))
  }
  if (specifier.startsWith('/')) return posix.normalize(specifier.slice(1))
  return undefined
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return (specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]) ?? specifier
}

/**
 * Checks one file. `file` is repo-relative with forward slashes, e.g. `src/engine/core/dice.ts`.
 * Core tests (`*.test.ts`) run under Node: they keep the import rules and the Math.random ban
 * (randomized tests use pinned seeds), but may use Node APIs and time themselves.
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

  if (layer !== undefined) {
    const allowed = LAYERS[layer]
    for (const { specifier, line } of imports) {
      const target = resolveSpecifier(file, specifier)
      if (target !== undefined) {
        const targetLayer = layerOf(target)
        if (targetLayer === undefined || !allowed.imports.includes(targetLayer)) {
          const dirs = allowed.imports.map((name) => `src/${name}`).join(', ')
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

  if (file.startsWith('tests/oracle/')) {
    for (const { specifier, line } of imports) {
      const target = resolveSpecifier(file, specifier)
      if (target === undefined) continue
      const shared =
        ORACLE_FORBIDDEN_FILES.has(target) ||
        ORACLE_FORBIDDEN_DIRS.some((dir) => target === dir || target.startsWith(`${dir}/`))
      if (shared) {
        report(line, 'oracle-independence', `oracles must not import shared rule code: ${target}`)
      }
    }
    for (const { line } of findUsages(tokens, NO_GLOBALS, new Set([RANDOM]))) {
      report(line, 'seeded-random', 'Math.random: draw from a seeded RNG so failures reproduce')
    }
  }
  return violations
}

export function formatViolation(violation: Violation): string {
  return `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`
}

/** Scans every TypeScript file under `dirs` (repo-relative) and returns sorted paths too. */
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
