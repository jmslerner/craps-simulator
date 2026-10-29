import { issue, type ConfigIssue } from './issues.ts'
import type { MachineConfigInput } from './schema.ts'

/**
 * Where each machine value comes from. A config's `provenance` maps JSON pointers (RFC 6901) to
 * entries; an entry describes its pointer and everything below it, and the deepest entry wins.
 * A value no entry covers is treated as assumed.
 *
 * - `verified`: official text, or two or more independent sources.
 * - `reported`: one credible or forum source.
 * - `assumed`: no source; a conservative default, explained in `note`.
 */
export type ProvenanceStatus = 'verified' | 'reported' | 'assumed'
export type ProvenanceEntry = MachineConfigInput['provenance'][string]
export type Provenance = Readonly<Record<string, ProvenanceEntry>>

/**
 * Source keys that provenance may cite, from the rules spec's source table
 * (docs/rules/rules-spec.md). A citation is a key, optionally followed by a location such as
 * "CW §17". `USER` is the player's own observation of a machine.
 */
export const SOURCES: Readonly<Record<string, string>> = Object.freeze({
  CW: 'https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf',
  STWO: 'https://wsgc.wa.gov/sites/default/files/2025-04/3195%20Craps%20Shoot%20to%20Win%20ETG%20Approval%20Letter%20signed_0.pdf',
  IB: 'https://wsgc.wa.gov/sites/default/files/2025-02/Craps_Crapless_Craps_Easy_Craps_game_description_Washington-specific_v2.5.1_0.pdf',
  IB221:
    'https://wsgc.wa.gov/sites/default/files/2024-03/Craps%20-%20Game%20Description_WA-specific_v2.2.1.pdf',
  IBLS: 'https://wsgc.wa.gov/sites/default/files/2024-03/Lucky%20Shooter%20Special%20Bet%20Description_WA-specific_v1.5.1.pdf',
  RTW: 'https://wsgc.wa.gov/sites/default/files/2025-02/DESC_RollToWinCraps_NO_ODDS_WA_Overview_v1.1.pdf',
  'WSGC-ETG': 'https://wsgc.wa.gov/tribal-partnerships/tribal-electronic-table-games',
  NV14: 'https://www.gaming.nv.gov/contentassets/d6342a488e944e6aa02337fa9d3c94e5/regulation-14-as-of-08-26.pdf',
  'NV-SS':
    'https://www.gaming.nv.gov/contentassets/3a632692f87340bf9890a9784fd3f1aa/super-shooter-craps-side-bet.pdf',
  PA623c: 'https://pacodeandbulletin.gov/secure/pacode/data/058/chapter623c/058_0623c.pdf',
  MA: 'https://massgaming.com/wp-content/uploads/RULES-Automated-Craps-2-1-18.pdf',
  'MD-C':
    'https://www.mdgaming.com/wp-content/uploads/2026/04/Craps-Standard-Rules-Version-1.5-accessible.pdf',
  'MD-CL':
    'https://www.mdgaming.com/wp-content/uploads/2026/04/Crapless-Craps-Standard-Rules-Version-1.1-accessible.pdf',
  'CROWN-CL':
    'https://www.crownperth.com.au/getmedia/2f173189-0e81-4059-893b-ff3e45a8f128/crown-perth-gaming-crapless-craps-rules.pdf',
  CYP: 'https://cypressbayou-casino.treepl.co/play-casino-table-games/crapless-craps',
  'HAR-PA': 'https://www.caesars.com/content/dam/ccr/Gaming/tableGames/Craps-RackCard-Philly.pdf',
  'GALAXY-WA':
    'https://wsgc.wa.gov/sites/default/files/2023-11/Bonus%20Craps%20Modification-Progressive.pdf',
  NJ: 'https://nj.gov/oag/ge/docs/TempRegs/bonuscrapstext.pdf',
  'WOO-B': 'https://wizardofodds.com/games/craps/basics/',
  'WOO-HE': 'https://wizardofodds.com/games/craps/appendix/2/',
  'WOO-CL': 'https://wizardofodds.com/games/crapless-craps/',
  'WOO-K': 'https://wizardofodds.com/ask-the-wizard/table-games/',
  'WOO-SYS': 'https://wizardofodds.com/ask-the-wizard/craps/betting-systems/',
  'WOO-FIRE': 'https://wizardofodds.com/games/craps/side-bets/fire-bet/',
  'WOO-BONUS': 'https://wizardofodds.com/games/craps/side-bets/bonus-craps/',
  WIKI: 'https://en.wikipedia.org/wiki/Craps',
  'LVA-CL': 'https://www.lasvegasadvisor.com/question/crapless-craps/',
  'LVA-RENO': 'https://www.lasvegasadvisor.com/question/reno-dont-bets/',
  'LVA-RND': 'https://www.lasvegasadvisor.com/question/rounding-down-6-5-blackjack/',
  'LVA-PTS': 'https://www.lasvegasadvisor.com/question/etgs-player-points/',
  VA: 'https://vegasadvantage.com/electronic-table-games/',
  'VV-STW':
    'https://www.casino.org/vitalvegas/the-casino-game-were-loving-right-now-shoot-to-win-craps/',
  'VV-DTG': 'https://www.casino.org/vitalvegas/hybrid-stadium-craps-rolls-into-downtown-grand/',
  SHRT: 'https://blog.seminolehardrocktampa.com/?p=755',
  'G3-MOH': 'https://g3newswire.com/interblock-installs-crapless-craps-at-mohegan-sun/',
  TCA: 'https://topclassactions.com/lawsuit-settlements/closed-settlements/isle-of-capri-fan-club-loyalty-program-class-action-settlement',
  'GGB-RATE':
    'https://ggbmagazine.com/article/player-rating-errors-you-are-probably-making-in-craps',
  'PAT-RFID': 'https://patents.google.com/patent/US10417466',
  USER: '',
})

/** Sources the research rejected (rules spec §9 #23); a value must never rest on them. */
const REJECTED_SOURCES: ReadonlySet<string> = new Set(['CRAPSEE', 'TZ'])

/** Wizard of Vegas forum threads are cited by number, e.g. "WOV-11344". */
const FORUM_THREAD = /^WOV-(\d+)$/

/**
 * The URL behind a source key, or null for an unknown key or a user observation. The forum finds a
 * thread by the number before its title slug, so any slug works; a bare number opens a thread list.
 */
export function sourceUrl(key: string): string | null {
  const thread = FORUM_THREAD.exec(key)
  if (thread !== null) return `https://wizardofvegas.com/forum/gambling/craps/${thread[1]}-thread/`
  const url = Object.hasOwn(SOURCES, key) ? SOURCES[key] : undefined
  return url === undefined || url === '' ? null : url
}

/**
 * Problems with a `source` string: citations separated by ";", each starting with a known source
 * key ("CW §17; WOO-B"). Returns one message per bad citation.
 */
export function citationIssues(source: string): string[] {
  return source.split(';').flatMap((part) => {
    const citation = part.trim()
    const key = /^[A-Za-z0-9-]+/.exec(citation)?.[0] ?? ''
    if (citation === '') return ['a citation is empty; separate citations with ";"']
    if (REJECTED_SOURCES.has(key)) return [`${key} is a rejected source (rules spec §9 #23)`]
    if (FORUM_THREAD.test(key) || Object.hasOwn(SOURCES, key)) return []
    return [`"${citation}" does not start with a known source key, such as CW, IB or WOO-B`]
  })
}

const POINTER = /^(\/([^~/]|~[01])*)+$/

/** True for a non-empty RFC 6901 JSON pointer, such as "/catalog/place/pays/6". */
export function isJsonPointer(text: string): boolean {
  return POINTER.test(text)
}

/** The JSON pointer for a path of keys: ["catalog", "place", "pays", "6"] -> "/catalog/place/pays/6". */
export function toPointer(path: readonly (string | number)[]): string {
  return path.map((key) => `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')
}

/** The keys of a JSON pointer, unescaped. Throws if `pointer` is not one. */
export function parsePointer(pointer: string): string[] {
  if (!isJsonPointer(pointer)) throw new RangeError(`"${pointer}" is not a JSON pointer`)
  return pointer
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'))
}

/** The value `pointer` names inside `root`, if it names one. */
export function resolvePointer(
  root: unknown,
  pointer: string,
): { found: true; value: unknown } | { found: false } {
  let current: unknown = root
  for (const key of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length) return { found: false }
      current = current[Number(key)]
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return { found: false }
    }
  }
  return { found: true, value: current }
}

/** The entry that governs `pointer`, and where it is recorded: the deepest one at or above it. */
export interface GoverningEntry {
  readonly pointer: string
  readonly entry: ProvenanceEntry
}

export function governingEntry(provenance: Provenance, pointer: string): GoverningEntry | null {
  for (let at = pointer; at !== ''; at = at.slice(0, at.lastIndexOf('/'))) {
    const entry = Object.hasOwn(provenance, at) ? provenance[at] : undefined
    if (entry !== undefined) return { pointer: at, entry }
  }
  return null
}

/** How well `pointer`'s value is backed. Values no entry covers count as assumed. */
export function statusAt(provenance: Provenance, pointer: string): ProvenanceStatus {
  return governingEntry(provenance, pointer)?.entry.status ?? 'assumed'
}

/** An assumed value: its pointer, why it was chosen, and any source that informed it. */
export interface Assumption {
  readonly pointer: string
  readonly note: string
  readonly source: string | null
}

/**
 * Every `assumed` provenance entry, sorted by pointer. These are the values a player should check
 * on their own machine; coach numbers that depend on them carry an "assumed" chip. Presets cover
 * every value with an entry (a test checks this), so for them this is the complete list.
 */
export function listAssumptions(cfg: { readonly provenance: Provenance }): readonly Assumption[] {
  return Object.keys(cfg.provenance)
    .sort()
    .flatMap((pointer) => {
      const entry = cfg.provenance[pointer]
      if (entry?.status !== 'assumed') return []
      return [{ pointer, note: entry.note, source: entry.source ?? null }]
    })
}

/**
 * The pointer of every leaf in a JSON value: primitives, null, and empty arrays or objects. Keys
 * are visited in insertion order.
 */
export function leafPointers(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value)
  if (entries.length === 0) return [prefix]
  return entries.flatMap(([key, item]) => leafPointers(item, prefix + toPointer([key])))
}

/** Bookkeeping fields that describe the config rather than a machine. */
const UNTRACKED = ['/schemaVersion', '/id', '/name', '/provenance']

/** Leaves of `input` that no provenance entry covers; these are silently assumed. */
export function uncoveredPointers(input: MachineConfigInput): string[] {
  return leafPointers(input).filter(
    (pointer) =>
      !UNTRACKED.some((root) => pointer === root || pointer.startsWith(`${root}/`)) &&
      governingEntry(input.provenance, pointer) === null,
  )
}

/**
 * `input.provenance` without the entries whose pointer names nothing, for an editor that has just
 * deleted values. A stale entry would otherwise vouch for whatever is later added at its pointer.
 */
export function pruneProvenance(input: MachineConfigInput): MachineConfigInput['provenance'] {
  return Object.fromEntries(
    Object.entries(input.provenance).filter(([pointer]) => resolvePointer(input, pointer).found),
  )
}

/** Provenance keys that point at nothing in the config, or into the provenance itself. */
export function provenanceIssues(input: MachineConfigInput): ConfigIssue[] {
  return Object.keys(input.provenance).flatMap((pointer) => {
    if (!isJsonPointer(pointer)) return [] // the schema reports the key itself
    if (pointer === '/provenance' || pointer.startsWith('/provenance/')) {
      return [issue(['provenance', pointer], 'provenance cannot describe itself')]
    }
    if (!resolvePointer(input, pointer).found) {
      return [issue(['provenance', pointer], `${pointer} does not name a value in this config`)]
    }
    return []
  })
}
