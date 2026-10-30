import {
  collectSetRemaining,
  collectSetRolled,
  pointRunHits,
  pointRunState,
  uniquePointsMade,
} from '../../engine/index.ts'
import type { CompiledSideBet, PointNumber, SettlementTrace, Total } from '../../engine/index.ts'

/**
 * A side bet's progress as the layout, the inspector and the history show it (plan §0 #11, §10
 * M11): pure over the compiled side bet and the bet's own `progress` field, read back through the
 * engine's encodings (`collectSetRolled`, `uniquePointsMade`, `pointRunState`, the Hot Shooter's
 * roll count). Nothing here decides a rule: which numbers count, what each tier pays and when the
 * bet is paid all come from the compiled config, and the words carry only the machine's own labels
 * and the numbers the dice have shown. The chances and the equity are the coach's (plan §5.4
 * `sideBetProgress`): `coach/sideBetProgress.ts` prices them in the analysis worker and carries
 * them on `InspectorMath.sideBet`, with its lines (`side-stage`, `side-now`, `side-next`,
 * `side-chances`) appended to `InspectorMath.lines`, which `InspectorExtras` renders verbatim.
 */

/** The numbers a side-bet zone draws as pips, lit as the bet collects them; null for a roll counter. */
export function trackOf(type: CompiledSideBet): readonly Total[] | null {
  switch (type.family) {
    case 'collectSet':
      return type.targets
    case 'uniquePointsMade':
      return type.countedPoints
    case 'pointRun':
      return type.points
    case 'handLength':
      return null
  }
}

export interface SideBetProgress {
  /** The numbers on the track the bet has collected: totals rolled, points made, box numbers hit. */
  readonly lit: readonly Total[]
  /** The Lucky Shooter's point, drawn apart from its hits; null for the other families. */
  readonly point: PointNumber | null
  /** The Hot Shooter's rolls counted so far; null for the families that collect numbers. */
  readonly count: number | null
  /** How far along the bet is, in words: "2 and 4 rolled, needs 3, 5 and 6". */
  readonly words: string
}

/** Where a side bet with `progress` stands. `progress` 0 is a fresh bet (or an empty spot). */
export function progressOf(type: CompiledSideBet, progress: number): SideBetProgress {
  switch (type.family) {
    case 'collectSet': {
      const lit = collectSetRolled(progress).filter((total) => type.targets.includes(total))
      const remaining = collectSetRemaining(type, progress)
      const words =
        lit.length === 0
          ? `none of ${listNumbers(type.targets)} rolled yet`
          : `${listNumbers(lit)} rolled, needs ${listNumbers(remaining)}`
      return { lit, point: null, count: null, words }
    }
    case 'uniquePointsMade': {
      const lit = uniquePointsMade(progress).filter((n) => type.countedPoints.includes(n))
      const words =
        lit.length === 0
          ? 'no points made yet'
          : `${lit.length} ${plural(lit.length, 'point')} made (${listNumbers(lit)})`
      return { lit, point: null, count: null, words }
    }
    case 'handLength':
      return {
        lit: [],
        point: null,
        count: progress,
        words: `${progress} ${plural(progress, 'roll')} counted`,
      }
    case 'pointRun': {
      const { point } = pointRunState(progress)
      const lit = pointRunHits(progress)
      if (point === null) return { lit, point, count: null, words: 'no point yet' }
      const hits = `${lit.length} ${plural(lit.length, 'hit')}`
      const words =
        lit.length === 0
          ? `point ${point}, ${hits}`
          : `point ${point}, ${hits} (${listNumbers(lit)})`
      return { lit, point, count: null, words }
    }
  }
}

/** One row of a side bet's pay table, as the inspector lists it. */
export interface PayRow {
  /** The engine's pay key for the row (`SettlementTrace.payKey` on a win), 'set' for a collect set. */
  readonly key: string
  /** What reaches the row, in the machine's terms: "4 points", "16+ rolls", "3 hits". */
  readonly reach: string
  /** The pay as the machine writes it ("24 to 1"), or "stake back" for a 1-for-1 tier. */
  readonly pays: string
  /** The bet stands at or past this row. */
  readonly reached: boolean
  /** The first row above where the bet stands. */
  readonly next: boolean
}

/** The pay table of `type` with the bet's standing marked; `progress` 0 marks only the first row next. */
export function payRows(type: CompiledSideBet, progress: number): readonly PayRow[] {
  switch (type.family) {
    case 'collectSet':
      return [
        {
          key: 'set',
          reach: `all of ${listNumbers(type.targets)}`,
          pays: type.pays.label,
          reached: false,
          next: true,
        },
      ]
    case 'uniquePointsMade': {
      const made = uniquePointsMade(progress).length
      return markNext(
        sortedKeys(type.payTable).map((count) => ({
          key: String(count),
          reach: `${count} ${plural(count, 'point')}`,
          pays: type.payTable.get(count)?.label ?? '',
          reached: count <= made,
          next: false,
        })),
      )
    }
    case 'handLength':
      return markNext(
        type.tiers.map((tier) => ({
          key: String(tier.minRolls),
          reach: `${tier.minRolls}+ ${plural(tier.minRolls, 'roll')}`,
          pays: tier.pays === 'push' ? 'stake back' : tier.pays.label,
          reached: tier.minRolls <= progress,
          next: false,
        })),
      )
    case 'pointRun': {
      const hits = pointRunHits(progress).length
      const others = type.points.length - 1
      return markNext([
        ...sortedKeys(type.payTable).map((count) => ({
          key: String(count),
          reach: `${count} ${plural(count, 'hit')}`,
          pays: type.payTable.get(count)?.label ?? '',
          reached: count <= hits,
          next: false,
        })),
        {
          key: 'top',
          reach: `all ${others} hits, then the point`,
          pays: type.topAward.label,
          reached: false,
          next: false,
        },
      ])
    }
  }
}

/** The machine's top pay for the bet, as written: the zone's one-line summary of the table. */
export function topPayLabel(type: CompiledSideBet): string {
  const rows = payRows(type, 0)
  return rows[rows.length - 1]?.pays ?? ''
}

/** How the machine counts, from the config, where a family has a counting rule worth saying. */
export function countingNote(type: CompiledSideBet): string | null {
  switch (type.family) {
    case 'handLength':
      switch (type.countDefinition) {
        case 'allRolls':
          return 'Every roll counts, the seven-out included.'
        case 'exceptSevenOut':
          return 'Every roll counts except the seven-out.'
        case 'exceptComeOutAndSevenOut':
          return 'Neither the first come-out roll nor the seven-out counts.'
      }
      break
    case 'collectSet':
      return type.endsOn === 'anySeven'
        ? 'Any 7 loses it, a come-out 7 included.'
        : 'Only a seven-out loses it; a come-out 7 does nothing.'
    case 'uniquePointsMade':
      return type.payImmediatelyAt === null
        ? 'Paid at the seven-out for the points made.'
        : `Paid at the seven-out, or at once at ${type.payImmediatelyAt} points.`
    case 'pointRun':
      return type.repeatEndsBet
        ? 'A box number rolled twice settles the bet.'
        : 'A box number rolled twice changes nothing.'
  }
  return null
}

/**
 * What to say beside a side bet's settlement in the history, from its trace and the progress it
 * carried into the roll: "4 points made", "had 2 and 4, needed 3, 5 and 6"; null when the outcome
 * line already says everything.
 */
export function settledWords(
  type: CompiledSideBet,
  trace: Pick<SettlementTrace, 'outcome' | 'payKey' | 'pushReason'>,
  progressBefore: number,
): string | null {
  const before = progressOf(type, progressBefore)
  if (trace.outcome === 'win') {
    switch (type.family) {
      case 'collectSet':
        return `all of ${listNumbers(type.targets)} rolled`
      case 'uniquePointsMade':
        return trace.payKey === null
          ? null
          : `${trace.payKey} ${plural(trace.payKey, 'point')} made`
      case 'handLength':
        return trace.payKey === null ? null : `${trace.payKey}+ rolls`
      case 'pointRun':
        return trace.payKey === 'top'
          ? `all ${type.points.length - 1} hits, then the point`
          : trace.payKey === null
            ? null
            : `${trace.payKey} ${plural(trace.payKey, 'hit')}`
    }
  }
  if (trace.outcome === 'lose') {
    switch (type.family) {
      case 'collectSet':
        return before.lit.length === 0
          ? 'nothing rolled'
          : `had ${listNumbers(before.lit)}, needed ${listNumbers(
              collectSetRemaining(type, progressBefore),
            )}`
      case 'uniquePointsMade':
        return before.words
      case 'handLength': {
        const first = type.tiers[0]
        return first === undefined ? before.words : `under ${first.minRolls} rolls`
      }
      case 'pointRun':
        return before.point === null ? 'lost on the come-out' : before.words
    }
  }
  // A push: the Hot Shooter's 1-for-1 tier, or the Lucky Shooter's come-out 7 or 11.
  if (trace.pushReason === 'zeroNet' && type.family === 'handLength') {
    const tier = type.tiers.find((t) => t.pays === 'push')
    return tier === undefined ? 'stake back' : `${tier.minRolls}+ rolls, stake back`
  }
  if (trace.pushReason === 'bar') return 'stays up for the next come-out'
  return null
}

/** "2", "2 and 4", "2, 4 and 6". */
export function listNumbers(numbers: readonly number[]): string {
  if (numbers.length === 0) return ''
  if (numbers.length === 1) return String(numbers[0])
  const head = numbers.slice(0, -1).join(', ')
  return `${head} and ${numbers[numbers.length - 1]}`
}

// ---------------------------------------------------------------------------------------------

function plural(count: number | string, word: string): string {
  return String(count) === '1' ? word : `${word}s`
}

function sortedKeys(table: ReadonlyMap<number, unknown>): number[] {
  return [...table.keys()].sort((a, b) => a - b)
}

/** Marks the first row the bet has not reached as the next one. */
function markNext(rows: readonly PayRow[]): readonly PayRow[] {
  const index = rows.findIndex((row) => !row.reached)
  return rows.map((row, i) => (i === index ? { ...row, next: true } : row))
}
