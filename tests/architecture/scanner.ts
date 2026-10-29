/**
 * The source-text scanner behind tests/architecture.test.ts.
 *
 * It lexes every file itself instead of asking ESLint or TypeScript, so a file that slips out of a
 * lint glob or a tsconfig include is still checked. The lexer is deliberately small: it only has to
 * keep comments, strings, template text and regex literals from being read as code. The imports it
 * finds also make the tree's import graph, which oracle independence follows (checkFiles).
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
  /**
   * `import type`, `export type` and `typeof import()`: erased with the types, so they load
   * nothing. `import { type A } from` is not: verbatimModuleSyntax keeps it as `import {} from`.
   */
  readonly typeOnly: boolean
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
  | 'math-value'
  | 'host-value'
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
  const add = (token: Token, typeOnly: boolean) => {
    found.push({ specifier: token.text, line: token.line, typeOnly })
  }
  // `import type { A }`, `import type A`, `import type * as ns` and `export type { A }`, but not a
  // binding named `type`, as in `import type from` or `import type, { a } from`.
  const typeClause = (k: number) => {
    const after = tokens[k + 2]
    return (
      isWord(tokens[k + 1], 'type') &&
      (isPunct(after, '{') ||
        isPunct(after, '*') ||
        (after?.kind === 'word' && after.text !== 'from'))
    )
  }
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
      // `typeof import('./x.ts')` is a type query, erased with the rest of the types.
      if (argument?.kind === 'string') add(argument, isImport && isWord(tokens[k - 1], 'typeof'))
    } else if (isImport && next?.kind === 'string') {
      add(next, false)
    } else if (isImport || (token.text === 'export' && isReExport(k))) {
      const specifier = fromClause(k + 1)
      if (specifier) add(specifier, typeClause(k))
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
    typeOnly: true,
  }))
}

/** Objects that also reach a global such as `Math`, as in `globalThis.Math.random()`. */
const HOSTS: ReadonlySet<string> = new Set(['globalThis', 'window', 'self', 'global'])
const NO_NAMES: ReadonlySet<string> = new Set()

/**
 * References to the given globals, and uses of the given members, written as `Math.random`,
 * `Math?.random`, `Math['random']`, `globalThis.Math.random` or `const { random } = Math`.
 * Property accesses (`state.window`), object keys and type members (`window: ...`) are skipped.
 * There is no scope analysis, so a local that shadows a banned global is reported (rename it).
 *
 * `values` names objects, such as Math, that may be used only through a member. An alias
 * (`const M = Math`), a cast (`<any>Math`, `Math as T`), a wrapper (`[Math]`, `{ Math }`), an
 * argument (`Reflect.get(Math, 'random')`), parentheses or a type (`: Math`; `typeof Math` is the
 * same type) would carry one out of sight of the member checks, so every other use is reported
 * under the object's name, as is every use through a host (`globalThis.Math.sqrt`,
 * `globalThis['Math']`). A destructuring that takes a banned member is reported as that member
 * instead, and `typeof Math` reads no member at all.
 *
 * Given `values`, a host (globalThis, window, self, global) that is not one of the `globals` may
 * likewise be used only to read a member by name: an alias (`const g = globalThis`), an argument
 * (`Reflect.get(globalThis, 'Math')`) or a destructuring (`const { Math: M } = globalThis`) carries
 * what it holds out of sight too. Such a use is reported under the host's name, or, when it
 * destructures one of the `values`, as that value or the banned members it takes. After `typeof`,
 * in an equality test, or declared (`const window = ...`, a local), a host's name is no such use.
 */
export function findUsages(
  tokens: readonly Token[],
  globals: ReadonlySet<string>,
  members: ReadonlySet<string>,
  values: ReadonlySet<string> = NO_NAMES,
): Usage[] {
  const found: Usage[] = []
  // A host is guarded wherever values are: they are what it carries.
  const guarded = (name: string) => values.size > 0 && HOSTS.has(name) && !globals.has(name)
  tokens.forEach((token, k) => {
    // `globalThis['Math']`, or a host read from a host: `globalThis['self']`.
    if (token.kind === 'string' && (values.has(token.text) || guarded(token.text))) {
      if (isHostIndex(tokens, k)) found.push({ name: token.text, line: token.line })
    }
    if (token.kind !== 'word') return
    if (guarded(token.text)) {
      found.push(...hostUses(tokens, k, members, values))
      return
    }
    const host = hostOf(tokens, k)
    const viaHost = host !== undefined
    if (!viaHost && isPropertyName(tokens, k)) return
    const member = memberName(tokens, k)
    if (member !== undefined && members.has(`${token.text}.${member}`)) {
      found.push({ name: `${token.text}.${member}`, line: token.line })
      return
    }
    if (member === undefined) {
      // Where the expression starts: at the host, for `globalThis.Math`.
      const start = host ?? k
      const banned = takenMembers(tokens, destructuredKeys(tokens, start), token.text, members)
      found.push(...banned)
      // `typeof Math` reads nothing; Math through a host is reported however it is used.
      const typeQuery = !viaHost && isWord(tokens[start - 1], 'typeof')
      if (values.has(token.text) && banned.length === 0 && !typeQuery) {
        found.push({ name: token.text, line: token.line })
      }
    } else if (viaHost && values.has(token.text)) {
      // An allowed member, but read through a host: `globalThis.Math.sqrt`.
      found.push({ name: token.text, line: token.line })
    }
    if (!viaHost && globals.has(token.text)) found.push({ name: token.text, line: token.line })
  })
  return found
}

/**
 * How the guarded host at `k` is used, if not to read a member by name: see findUsages. A host
 * read from another host (`globalThis.self`) is reported too, as nothing needs the longer way.
 */
function hostUses(
  tokens: readonly Token[],
  k: number,
  members: ReadonlySet<string>,
  values: ReadonlySet<string>,
): Usage[] {
  const host = tokens[k]
  if (host === undefined) return []
  const use = [{ name: host.text, line: host.line }]
  if (hostOf(tokens, k) !== undefined) return use
  if (isPropertyName(tokens, k) || memberName(tokens, k) !== undefined) return []
  const prev = tokens[k - 1]
  const declared = prev?.kind === 'word' && (DECLARATIONS.has(prev.text) || prev.text === 'declare')
  if (declared || isWord(prev, 'typeof') || isCompared(tokens, k)) return []
  const pattern = patternFrom(tokens, k)
  const taken =
    pattern === undefined
      ? []
      : keysIn(tokens, pattern).filter((j) => values.has(tokens[j]?.text ?? ''))
  return taken.length > 0 ? taken.flatMap((key) => takenFromHost(tokens, key, members)) : use
}

/**
 * What a destructuring takes from the host's value whose key is at `key`, as Math in
 * `const { Math: { random } } = globalThis`: the banned members of its own pattern, if it has one
 * and takes any, or else the value itself.
 */
function takenFromHost(tokens: readonly Token[], key: number, members: ReadonlySet<string>) {
  const name = tokens[key]
  if (name === undefined) return []
  // The `:` after the key, or after the `]` of a computed `['Math']` key.
  const colon = isPunct(tokens[key + 1], ']') ? key + 2 : key + 1
  const close = isPunct(tokens[colon], ':') ? matchingClose(tokens, colon + 1) : undefined
  const banned =
    close === undefined
      ? []
      : takenMembers(tokens, keysIn(tokens, { open: colon + 1, close }), name.text, members)
  return banned.length > 0 ? banned : [{ name: name.text, line: name.line }]
}

/** The banned members of `object` among the keys at `keys`: `random` in `{ random } = Math`. */
function takenMembers(
  tokens: readonly Token[],
  keys: readonly number[],
  object: string,
  members: ReadonlySet<string>,
): Usage[] {
  return keys
    .map((j) => tokens[j])
    .filter((key) => key !== undefined)
    .map((key) => ({ name: `${object}.${key.text}`, line: key.line }))
    .filter(({ name }) => members.has(name))
}

/** The word at `k` is compared with `==`, `===`, `!=` or `!==`, which yield only a boolean. */
function isCompared(tokens: readonly Token[], k: number): boolean {
  const before =
    isPunct(tokens[k - 1], '=') && (isPunct(tokens[k - 2], '=') || isPunct(tokens[k - 2], '!'))
  const after =
    (isPunct(tokens[k + 1], '=') || isPunct(tokens[k + 1], '!')) && isPunct(tokens[k + 2], '=')
  return before || after
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

/**
 * Where the host is when the word at `k` is read from one, as `Math` in `globalThis.Math` or
 * `self?.Math`: still the global, not a property of some other value.
 */
function hostOf(tokens: readonly Token[], k: number): number | undefined {
  if (!isPunct(tokens[k - 1], '.')) return undefined
  const at = isPunct(tokens[k - 2], '?') ? k - 3 : k - 2
  return isHost(tokens, at) ? at : undefined
}

const isHost = (tokens: readonly Token[], k: number) => {
  const host = tokens[k]
  return host?.kind === 'word' && HOSTS.has(host.text) && !isPunct(tokens[k - 1], '.')
}

/** The string at `k` is a computed member of a host: `'Math'` in `globalThis['Math']`. */
function isHostIndex(tokens: readonly Token[], k: number): boolean {
  if (!isPunct(tokens[k - 1], '[') || !isPunct(tokens[k + 1], ']')) return false
  const optional = isPunct(tokens[k - 2], '.') && isPunct(tokens[k - 3], '?')
  return isHost(tokens, optional ? k - 4 : k - 2)
}

/** The member read right after the word at `k`: `.m`, `?.m`, `['m']` or `?.['m']`. */
function memberName(tokens: readonly Token[], k: number): string | undefined {
  const optional = isPunct(tokens[k + 1], '?') && isPunct(tokens[k + 2], '.')
  const at = optional ? k + 3 : k + 1
  const [a, b, c] = [tokens[at], tokens[at + 1], tokens[at + 2]]
  if (optional && a?.kind === 'word') return a.text
  if (!optional && isPunct(a, '.') && b?.kind === 'word') return b.text
  if (isPunct(a, '[') && b?.kind === 'string' && isPunct(c, ']')) return b.text
  return undefined
}

const OPENERS = new Set(['{', '(', '['])
const CLOSERS = new Set(['}', ')', ']'])
const DECLARATIONS = new Set(['const', 'let', 'var'])

/** An object pattern's braces, as token indexes. */
interface Pattern {
  readonly open: number
  readonly close: number
}

/**
 * The object pattern assigned from the expression that starts at `start`: `{ random, floor: f }`
 * in `const { random, floor: f } = Math`, also with a type annotation, as a parameter's default
 * or in `({ random } = Math)`.
 */
function patternFrom(tokens: readonly Token[], start: number): Pattern | undefined {
  if (!isPunct(tokens[start - 1], '=')) return undefined
  const close = patternEnd(tokens, start - 2)
  const open = close === undefined ? undefined : matchingOpen(tokens, close)
  if (close === undefined || open === undefined || !opensPattern(tokens[open - 1])) return undefined
  return { open, close }
}

/**
 * The indexes of a pattern's own keys, such as `random` and `floor` in `{ random, floor: f }`: a
 * computed `['random']` key by its string. Keys of nested patterns are not included.
 */
function keysIn(tokens: readonly Token[], { open, close }: Pattern): number[] {
  const keys: number[] = []
  let nesting = 0
  for (let j = open + 1; j < close; j++) {
    const token = tokens[j]
    if (token === undefined) break
    if (nesting === 0 && (j === open + 1 || isPunct(tokens[j - 1], ','))) {
      const at = isPunct(token, '[') && isPunct(tokens[j + 2], ']') ? j + 1 : j
      const key = tokens[at]
      if (key?.kind === 'word' || key?.kind === 'string') keys.push(at)
    }
    if (token.kind === 'punct' && OPENERS.has(token.text)) nesting++
    else if (token.kind === 'punct' && CLOSERS.has(token.text)) nesting--
  }
  return keys
}

/** The keys of the object pattern assigned from the expression at `start` (see patternFrom). */
function destructuredKeys(tokens: readonly Token[], start: number): number[] {
  const pattern = patternFrom(tokens, start)
  return pattern === undefined ? [] : keysIn(tokens, pattern)
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

/** The `}` that closes the `{` at `open`, if `open` is one. */
function matchingClose(tokens: readonly Token[], open: number): number | undefined {
  if (!isPunct(tokens[open], '{')) return undefined
  let depth = 0
  for (let j = open; j < tokens.length; j++) {
    if (isPunct(tokens[j], '{')) depth++
    else if (isPunct(tokens[j], '}') && --depth === 0) return j
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
  ...['process', 'Buffer', 'globalThis', 'global', 'self'].map((name) => [name, HOST] as const),
])
const PURITY_GLOBALS: ReadonlySet<string> = new Set(PURITY_REASONS.keys())
const NO_GLOBALS: ReadonlySet<string> = new Set()
const RANDOM = 'Math.random'
const ROUNDING = ['Math.floor', 'Math.round', 'Math.ceil', 'Math.trunc']
/** Number#toFixed and #toPrecision, and Fraction#toNumber, all turn exact amounts into floats. */
const FLOAT_METHODS: ReadonlySet<string> = new Set(['toFixed', 'toPrecision', 'toNumber'])
const ROUNDING_LAYERS: readonly Layer[] = ['engine/core', 'engine', 'exact', 'coach']
const ROUNDING_HOMES = new Set(['src/engine/core/money.ts', 'src/engine/core/rational.ts'])

/** A directory or file that oracle modules must not use, and how reports say so. */
interface OracleArea {
  /** The directory or file, which reports name; each is reported once per oracle module. */
  readonly path: string
  /** Whether every module inside the directory `path` is in the area, not only `path` itself. */
  readonly dir: boolean
  /** Whether a direct `import type` breaks the rule too, although types load nothing. */
  readonly types: boolean
  /** Message stems for a direct import and for a module reached through others. */
  readonly imports: string
  readonly reaches: string
}

const RULE_CODE = {
  types: true,
  imports: 'oracles must not import shared rule code',
  reaches: 'oracles must not reach shared rule code',
}
/**
 * What an oracle module must not use, directly or through other modules (checkReach). Shared rule
 * code cannot catch its own bugs: the rules, the reducer (`table`) and the session layer that
 * drives them, the engine barrel, which re-exports them, and the rulesets, the engine's own rule
 * constants. Oracles also parse ratios, read machine data and round money themselves, so of the
 * rest of the config they take types only (`import type`), and they must not load money.ts.
 */
const ORACLE_AREAS: readonly OracleArea[] = [
  ...['src/engine', 'src/engine/index.ts', 'src/engine/config/rulesets.ts'].map((path) => ({
    path,
    dir: false,
    ...RULE_CODE,
  })),
  ...[
    'src/exact',
    'src/engine/bets',
    'src/engine/round',
    'src/engine/settle',
    'src/engine/table',
    'src/engine/session',
  ].map((path) => ({ path, dir: true, ...RULE_CODE })),
  {
    path: 'src/engine/config',
    dir: true,
    types: false,
    imports: 'oracles may take only types from src/engine/config, with import type',
    reaches: 'oracles must not reach src/engine/config at run time',
  },
  {
    path: 'src/engine/core/money.ts',
    dir: false,
    types: false,
    imports: 'oracles round money themselves: they must not import src/engine/core/money.ts',
    reaches: 'oracles round money themselves: they must not reach src/engine/core/money.ts',
  },
]
/**
 * Of src/engine/core, oracles may load rational.ts and dice.ts and what those load (but never
 * money.ts, an area of its own), nothing else: every import into engine/core from outside it, at
 * any depth, must be of one of these two.
 */
const ENGINE_CORE = 'src/engine/core'
const CORE_ENTRIES = ['src/engine/core/rational.ts', 'src/engine/core/dice.ts']
const CORE_ENTRY = {
  dir: false,
  types: false,
  imports: 'oracles may import from src/engine/core only rational.ts and dice.ts',
  reaches: 'oracles may reach src/engine/core only through rational.ts and dice.ts',
}
/**
 * The dispatch-chain oracle drives the real reducer, so it may import the engine's rule code. It
 * still must not import the solver it is compared with, directly or through other modules.
 */
const DISPATCH_CHAIN = 'tests/oracle/dispatchChain.ts'
const DISPATCH_CHAIN_AREA: OracleArea = {
  path: 'src/exact',
  dir: true,
  types: true,
  imports: 'the dispatch chain must not import the solver it checks',
  reaches: 'the dispatch chain must not reach the solver it checks',
}

/** Objects that may be used only through a member: see findUsages. */
const VALUE_ONLY: ReadonlySet<string> = new Set(['Math'])
const MATH_VALUE =
  'Math used as a value or a type: read each member directly, so the member bans see it ' +
  '(its type is typeof Math)'
const hostValue = (host: string) =>
  `${host} used other than to read a member by name (${host}.x): it carries Math out of sight`

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

/**
 * Whether `target` is `path`, or inside it, compared as macOS loads files: whatever the case. A
 * forbidden path must not pass for allowed in another case, as `src/Engine/round/round.ts` would.
 */
function isAt(target: string, path: string, dir = false): boolean {
  const [t, p] = [target.toLowerCase(), path.toLowerCase()]
  return t === p || (dir && t.startsWith(`${p}/`))
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return (specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]) ?? specifier
}

/**
 * Checks one file. `file` is repo-relative with forward slashes, e.g. `src/engine/core/dice.ts`.
 * Core tests (`*.test.ts`) run under Node: they keep the import rules and the Math.random ban
 * (randomized tests use pinned seeds), but may use Node APIs, time themselves and round freely.
 * Everything under `tests/` keeps the Math.random ban as well. What an oracle module reaches
 * through other modules needs the whole tree: see checkFiles.
 */
export function checkSource(file: string, source: string): Violation[] {
  return analyze(file, source).violations
}

/** A runtime import from one file of another, resolved to the imported file's path. */
interface Edge {
  readonly target: string
  readonly line: number
}

function analyze(file: string, source: string): { violations: Violation[]; edges: Edge[] } {
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
    const globals = isTest ? NO_GLOBALS : PURITY_GLOBALS
    for (const { name, line } of findUsages(tokens, globals, members, VALUE_ONLY)) {
      if (name === RANDOM) {
        report(line, 'seeded-random', 'Math.random: draw from seeded engine RNG so runs reproduce')
      } else if (ROUNDING.includes(name)) {
        report(line, 'rounding', `${name}: round money only in engine/core/{money,rational}.ts`)
      } else if (VALUE_ONLY.has(name)) {
        report(line, 'math-value', MATH_VALUE)
      } else if (globals.has(name)) {
        report(line, 'purity', `${name}: ${PURITY_REASONS.get(name) ?? 'banned in core code'}`)
      } else {
        report(line, 'host-value', hostValue(name))
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
  // `import type` counts here only for rule code; what is reached through other modules is
  // checked across the tree, by checkFiles.
  const oracle = oracleRule(file)
  if (oracle !== undefined) {
    for (const { specifier, line, typeOnly } of imports) {
      const target = resolveSpecifier(file, specifier)
      const area =
        target === undefined ? undefined : (oracle.areaOf(target) ?? oracle.entryOf(target))
      if (area !== undefined && (area.types || !typeOnly)) {
        report(line, 'oracle-independence', `${area.imports}: ${target}`)
      }
    }
  }
  // Randomized tests use pinned seeds, so every failure reproduces: the oracles, scenarios,
  // properties, golden values and the slow suite alike.
  if (file.startsWith('tests/')) {
    for (const { name, line } of findUsages(tokens, NO_GLOBALS, new Set([RANDOM]), VALUE_ONLY)) {
      if (name === RANDOM) {
        report(line, 'seeded-random', 'Math.random: draw from a seeded RNG so failures reproduce')
      } else if (VALUE_ONLY.has(name)) {
        report(line, 'math-value', MATH_VALUE)
      } else {
        report(line, 'host-value', hostValue(name))
      }
    }
  }

  const edges: Edge[] = []
  for (const { specifier, line, typeOnly } of imports) {
    const target = typeOnly ? undefined : resolveSpecifier(file, specifier)
    if (target !== undefined) edges.push({ target, line })
  }
  return { violations, edges }
}

interface OracleRule {
  /** The forbidden area that `target` lies in, if any. */
  readonly areaOf: (target: string) => OracleArea | undefined
  /**
   * For an import of `target` from outside src/engine/core: the area of the engine/core module it
   * enters there, if it may not (see CORE_ENTRIES).
   */
  readonly entryOf: (target: string) => OracleArea | undefined
}

/**
 * The rule for an oracle module, any source file under tests/oracle/ other than its tests. The
 * directory is matched whatever its case, which only makes more files oracles.
 */
function oracleRule(file: string): OracleRule | undefined {
  if (!isAt(file, 'tests/oracle', true) || TEST_FILE.test(file)) return undefined
  if (file === DISPATCH_CHAIN) {
    return {
      areaOf: (target) => (isAt(target, 'src/exact', true) ? DISPATCH_CHAIN_AREA : undefined),
      entryOf: () => undefined,
    }
  }
  const areaOf = (target: string) =>
    ORACLE_AREAS.find((area) => !area.dir && isAt(target, area.path)) ??
    ORACLE_AREAS.find((area) => area.dir && isAt(target, area.path, true))
  return {
    areaOf,
    entryOf: (target) =>
      isAt(target, ENGINE_CORE, true) &&
      !CORE_ENTRIES.some((path) => isAt(target, path)) &&
      areaOf(target) === undefined
        ? { path: target.toLowerCase(), ...CORE_ENTRY }
        : undefined,
  }
}

/**
 * What an oracle module reaches at run time through the modules it imports, at any depth. Each
 * forbidden area is reported once, with the shortest chain of runtime imports that reaches it, at
 * the oracle's import that starts the chain; so is each engine/core module entered other than
 * through rational.ts or dice.ts. A direct import is checkSource's to report, and `import type` and
 * `export type` edges are erased, so they lead nowhere.
 */
function checkReach(file: string, graph: ReadonlyMap<string, readonly Edge[]>): Violation[] {
  const oracle = oracleRule(file)
  if (oracle === undefined) return []
  const violations: Violation[] = []
  const reported = new Set<string>()
  const report = (area: OracleArea | undefined, path: readonly string[], line: number) => {
    if (area === undefined || reported.has(area.path)) return
    reported.add(area.path)
    if (path.length > 2) {
      const message = `${area.reaches}: ${path.join(' → ')}`
      violations.push({ file, line, rule: 'oracle-independence', message })
    }
  }
  // Breadth first, so the first chain found to any module is a shortest one; seen modules are not
  // queued again, which also ends cycles.
  const chains = new Map<string, { path: readonly string[]; line: number }>([
    [file, { path: [file], line: 0 }],
  ])
  const queue = [file]
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i] ?? file
    const { path, line } = chains.get(from) ?? { path: [from], line: 0 }
    for (const edge of graph.get(from) ?? []) {
      const reach = { path: [...path, edge.target], line: from === file ? edge.line : line }
      // Every import into engine/core counts, not only the first to reach a module there.
      if (!isAt(from, ENGINE_CORE, true))
        report(oracle.entryOf(edge.target), reach.path, reach.line)
      if (chains.has(edge.target)) continue
      chains.set(edge.target, reach)
      queue.push(edge.target)
      report(oracle.areaOf(edge.target), reach.path, reach.line)
    }
  }
  return violations
}

/**
 * Checks files together: each one on its own (checkSource), then, for each oracle module, what it
 * reaches through the others (checkReach). `sources` maps repo-relative paths to source text; a
 * file's violations come in its order, followed by those of the next.
 */
export function checkFiles(sources: ReadonlyMap<string, string>): Violation[] {
  const analyses = [...sources].map(([file, source]) => ({ file, ...analyze(file, source) }))
  // An import loads its file whatever the case it is written in, as on macOS, so each edge leads
  // to the file by the file's own name.
  const named = new Map([...sources.keys()].map((file) => [file.toLowerCase(), file]))
  const graph = new Map(
    analyses.map(({ file, edges }) => [
      file,
      edges.map((edge) => ({
        ...edge,
        target: named.get(edge.target.toLowerCase()) ?? edge.target,
      })),
    ]),
  )
  return analyses.flatMap(({ file, violations }) => [...violations, ...checkReach(file, graph)])
}

export function formatViolation(violation: Violation): string {
  return `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`
}

/** Every TypeScript and JavaScript file under `dirs` (repo-relative), by sorted path. */
export function readSources(root: string, dirs: readonly string[]): Map<string, string> {
  const files = dirs
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
        .filter((entry) => SOURCE_FILE.test(entry))
        .map((entry) => posix.join(dir, entry.split(sep).join('/'))),
    )
    .sort()
  return new Map(files.map((file) => [file, readFileSync(join(root, file), 'utf8')]))
}

/** Scans every TypeScript and JavaScript file under `dirs` (repo-relative); returns sorted paths. */
export function scanTree(
  root: string,
  dirs: readonly string[],
): { files: string[]; violations: Violation[] } {
  const sources = readSources(root, dirs)
  return { files: [...sources.keys()], violations: checkFiles(sources) }
}
