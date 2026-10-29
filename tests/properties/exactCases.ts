import fc from 'fast-check'
import { ConfigError, compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import type { Cents } from '../../src/engine/core/money.ts'
import {
  catalogSpecs,
  legalAmounts,
  toWire,
  type BetAnalysis,
  type BetSpec,
  type Toggles,
} from '../../src/exact/index.ts'

/**
 * Shared generators for the exact solver's properties (plan §9 item 6): the standing-cost identity
 * and config-path invariance. The quick subsets in tests/properties and the full runs in
 * tests/slow use the same cases.
 */

export interface StandingCase {
  readonly cfg: MachineConfig
  readonly spec: BetSpec
  readonly amount: Cents
  readonly toggles: Toggles
}

const TOGGLES: readonly Toggles[] = [
  {},
  { globalOff: false },
  { globalOff: true },
  { working: true },
  { working: false },
]

const amountsCache = new Map<string, Cents[]>()

/** The first `count` legal stakes of `spec`, cached. */
export function firstAmounts(spec: BetSpec, cfg: MachineConfig, count = 30): Cents[] {
  const key = `${cfg.configHash}|${spec.typeId}|${String(spec.number)}|${count}`
  let amounts = amountsCache.get(key)
  if (amounts === undefined) {
    amounts = legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, count)
    amountsCache.set(key, amounts)
  }
  return amounts
}

/** A bet on one of `configs`, at one of its first legal stakes, with some toggles. */
export function standingCases(configs: readonly MachineConfig[]): fc.Arbitrary<StandingCase> {
  return fc
    .constantFrom(...configs)
    .chain((cfg) =>
      fc.record({ cfg: fc.constant(cfg), spec: fc.constantFrom(...catalogSpecs(cfg)) }),
    )
    .chain(({ cfg, spec }) => {
      const amounts = firstAmounts(spec, cfg)
      return fc.record({
        cfg: fc.constant(cfg),
        spec: fc.constant(spec),
        amount: amounts.length === 0 ? fc.constant(cfg.limits.min) : fc.constantFrom(...amounts),
        toggles: fc.constantFrom(...TOGGLES),
      })
    })
}

/** A change to one value of a config: its JSON pointer, and the edit. */
export interface Mutation {
  readonly pointer: string
  readonly apply: (input: MachineConfigInput) => void
}

/** Values whose change would also change the variant, which a valid config cannot do alone. */
const FIXED = [
  '/schemaVersion',
  '/variant',
  '/rules/naturals',
  '/rules/craps',
  '/rules/points',
  '/provenance',
]

/** The other values of each enum the schema allows, by key name. */
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  afterWin: ['stay', 'return'],
  comeOutDefault: ['on', 'off'],
  mode: ['floor', 'ceil', 'halfUp', 'halfEven'],
  basis: ['stake', 'win'],
  timing: ['upfront', 'onWin'],
  rearm: ['recollectFromWin', 'recollectFromCredit', 'none'],
  scope: ['untilChanged', 'nextRollOnly', 'totalRound', 'perBet', 'global', 'sameNumber'],
  match: ['total', 'dice'],
  onNumber: ['locked', 'reduceRemove'],
  rebetAfterRemove: ['allowed', 'nextCycle'],
  until: ['playerOn', 'pointEstablished'],
  trigger: ['sevenOut', 'anySeven'],
  payLabelStyle: ['asWritten', 'to', 'for'],
  invalidRoll: ['reshoot', 'reVibrate', 'void', 'attendant', 'noRoll'],
}

const RATIO = /^(\d+)(\s*(?::|to|for)\s*)(\d+)$/

/**
 * Every single-value change of `input` worth trying: flip a boolean, step a number, bump a pay
 * ratio, cycle an enum, rename a label, shorten a list, set a nullable rule. Some give invalid
 * configs; callers compile and skip those.
 */
export function mutationsOf(input: MachineConfigInput): Mutation[] {
  const mutations: Mutation[] = []
  const visit = (value: unknown, path: readonly string[]) => {
    const pointer = `/${path.join('/')}`
    if (FIXED.some((fixed) => pointer === fixed || pointer.startsWith(`${fixed}/`))) return
    const key = path.at(-1) ?? ''
    const set = (next: (current: unknown) => unknown) =>
      mutations.push({
        pointer,
        apply: (target) => {
          let parent: Record<string, unknown> = target as unknown as Record<string, unknown>
          for (const step of path.slice(0, -1)) parent = parent[step] as Record<string, unknown>
          parent[key] = next(parent[key])
        },
      })
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every((item) => typeof item !== 'object' || item === null)) {
        set((current) => (current as unknown[]).slice(0, -1))
        return
      }
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [child, item] of Object.entries(value)) visit(item, [...path, child])
      return
    }
    if (typeof value === 'boolean') set(() => !value)
    else if (typeof value === 'number')
      set(() => value + (value >= 100 && value % 100 === 0 ? 100 : 1))
    else if (typeof value === 'string') {
      const ratio = RATIO.exec(value)
      const options = ENUMS[key]
      if (ratio !== null) {
        set(() => `${Number(ratio[1]) + 1}${ratio[2] ?? ':'}${ratio[3] ?? '1'}`)
      } else if (options !== undefined && options.includes(value)) {
        for (const other of options) if (other !== value) set(() => other)
      } else {
        set(() => `${value}x`)
      }
    } else if (value === null && pointer === '/comeOut/autoOff') {
      set(() => ({ carried: ['hard'], newlyPlaced: [], reOnAt: 'pointEstablished' }))
    } else if (value === null && pointer === '/layAutoOn') {
      set(() => ({ afterPointMade: true, afterSeven: true }))
    }
  }
  visit(input, [])
  return mutations
}

/** Whether two JSON pointers overlap: equal, or one inside the other. */
export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** An analysis as comparable text, without its assumed chips (provenance is not a rule value). */
export function analysisFingerprint(analysis: BetAnalysis): string {
  return JSON.stringify(toWire({ ...analysis, assumedPaths: [] }))
}

/**
 * `input` with `apply` made to a copy, provenance pruned; null when that is no valid config. The
 * copy goes through JSON, so values the preset shares (one true-odds table for odds and buy) become
 * separate, and a change at one pointer changes nothing else.
 */
export function mutated(
  input: MachineConfigInput,
  apply: (input: MachineConfigInput) => void,
): MachineConfig | null {
  const copy = JSON.parse(JSON.stringify(input)) as MachineConfigInput
  apply(copy)
  copy.provenance = pruneProvenance(copy)
  try {
    return compileConfig(copy)
  } catch (error) {
    if (error instanceof ConfigError) return null
    throw error
  }
}
