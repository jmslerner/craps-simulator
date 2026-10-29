/**
 * An exact solver for absorbing Markov chains (plan §9 item 4), by a different method from the
 * exact analysis in `src/exact` (BFS, self-loop normalization, Tarjan SCCs and elimination per
 * component): one dense Gauss-Jordan elimination over BigInt Fractions on
 *
 *   (I − Q) [N | B | V] = [I | R | r]
 *
 * where Q holds the transient-to-transient chances, R the chances of each absorbing label, and r
 * each reward's expected amount per visit. N = (I − Q)⁻¹ is the fundamental matrix (expected
 * visits), B = N R the absorption chances, and V = N r the expected rewards until absorption. A
 * chain whose transient states can loop forever makes I − Q singular, which this reports.
 *
 * It imports nothing from the engine or the solver it checks, only `Fraction`.
 */
import { Fraction } from '../../src/engine/core/rational.ts'

/** Where a transition goes: another transient state, or an absorbing outcome by label. */
export type DenseTarget = { readonly state: number } | { readonly absorb: string }

export interface DenseTransition {
  readonly p: Fraction
  readonly to: DenseTarget
  /** Amounts collected on this transition, by name (a roll, cash, a working roll). */
  readonly rewards?: Readonly<Record<string, Fraction>>
}

/** An absorbing chain on transient states 0 … size − 1. */
export interface DenseChain {
  readonly size: number
  /** Each transient state's transitions; their chances add up to 1. */
  readonly transitions: readonly (readonly DenseTransition[])[]
}

export interface DenseSolution {
  /** The absorbing labels, in the order first seen. */
  readonly labels: readonly string[]
  /** The reward names, in the order first seen. */
  readonly rewardNames: readonly string[]
  /** N[i][j]: expected visits to state j starting from state i (the start visit included). */
  readonly visits: readonly (readonly Fraction[])[] | null
  /** P(absorbed with each label), from each state. */
  readonly absorption: readonly ReadonlyMap<string, Fraction>[]
  /** E[total of each reward until absorption], from each state. */
  readonly rewards: readonly ReadonlyMap<string, Fraction>[]
}

/**
 * Solves `chain`. `visits` (default true) also inverts I − Q in full for the fundamental matrix;
 * without it only the absorption chances and rewards are solved, which is cheaper.
 */
export function denseSolve(
  chain: DenseChain,
  options: { readonly visits?: boolean } = {},
): DenseSolution {
  const n = chain.size
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('A chain needs a transient state')
  if (chain.transitions.length !== n) throw new RangeError('One transition list per state')
  const labels: string[] = []
  const rewardNames: string[] = []
  for (const [i, out] of chain.transitions.entries()) {
    let total = Fraction.ZERO
    for (const t of out) {
      if (t.p.isNegative() || t.p.compare(Fraction.ONE) > 0) {
        throw new RangeError(`State ${i} has a transition with chance ${t.p}`)
      }
      total = total.add(t.p)
      if ('state' in t.to) {
        const j = t.to.state
        if (!Number.isSafeInteger(j) || j < 0 || j >= n) throw new RangeError(`No state ${j}`)
      } else if (!labels.includes(t.to.absorb)) labels.push(t.to.absorb)
      for (const name of Object.keys(t.rewards ?? {})) {
        if (!rewardNames.includes(name)) rewardNames.push(name)
      }
    }
    if (!total.equals(Fraction.ONE)) throw new RangeError(`State ${i}: chances add up to ${total}`)
  }

  const wantVisits = options.visits ?? true
  const labelAt = n
  const rewardAt = labelAt + labels.length
  const visitsAt = rewardAt + rewardNames.length
  const width = visitsAt + (wantVisits ? n : 0)
  // The augmented matrix [I − Q | R | r | I].
  const m: Fraction[][] = Array.from({ length: n }, (_, i) => {
    const row = Array.from({ length: width }, () => Fraction.ZERO)
    row[i] = Fraction.ONE
    if (wantVisits) row[visitsAt + i] = Fraction.ONE
    for (const t of chain.transitions[i] ?? []) {
      if ('state' in t.to) {
        row[t.to.state] = (row[t.to.state] ?? Fraction.ZERO).sub(t.p)
      } else {
        const col = labelAt + labels.indexOf(t.to.absorb)
        row[col] = (row[col] ?? Fraction.ZERO).add(t.p)
      }
      for (const [name, amount] of Object.entries(t.rewards ?? {})) {
        const at = rewardAt + rewardNames.indexOf(name)
        row[at] = (row[at] ?? Fraction.ZERO).add(t.p.mul(amount))
      }
    }
    return row
  })

  // Gauss-Jordan: for each column, a non-zero pivot scaled to 1, then the column cleared above
  // and below it. Zero entries are skipped, which keeps sparse chains cheap.
  for (let col = 0; col < n; col++) {
    const pivotRow = m.findIndex((row, r) => r >= col && !(row[col] ?? Fraction.ZERO).isZero())
    if (pivotRow < 0) throw new RangeError('I − Q is singular: some states never absorb')
    const swap = m[pivotRow]
    const here = m[col]
    if (swap === undefined || here === undefined) throw new Error('Row out of range')
    m[pivotRow] = here
    m[col] = swap
    const pivot = swap[col] ?? Fraction.ONE
    const live: number[] = []
    for (let j = col; j < width; j++) {
      const entry = swap[j] ?? Fraction.ZERO
      if (entry.isZero()) continue
      swap[j] = entry.div(pivot)
      live.push(j)
    }
    for (let r = 0; r < n; r++) {
      const row = m[r]
      if (r === col || row === undefined) continue
      const factor = row[col] ?? Fraction.ZERO
      if (factor.isZero()) continue
      for (const j of live)
        row[j] = (row[j] ?? Fraction.ZERO).sub(factor.mul(swap[j] ?? Fraction.ZERO))
    }
  }

  const at = (i: number, j: number) => m[i]?.[j] ?? Fraction.ZERO
  return {
    labels,
    rewardNames,
    visits: wantVisits
      ? Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => at(i, visitsAt + j)),
        )
      : null,
    absorption: Array.from(
      { length: n },
      (_, i) => new Map(labels.map((label, k) => [label, at(i, labelAt + k)])),
    ),
    rewards: Array.from(
      { length: n },
      (_, i) => new Map(rewardNames.map((name, k) => [name, at(i, rewardAt + k)])),
    ),
  }
}
