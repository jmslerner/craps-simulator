import { Fraction } from '../engine/index.ts'

/**
 * The exact solver for the analysis chains (plan §5.2): expected totals of rewards over a walk on
 * a finite Markov chain that ends when it takes a step to "out" (the bet came down, or the analysis
 * horizon was reached).
 *
 * Every state's steps have whole-number weights out of `scale` (36 for two dice, so the 21 dice
 * classes weigh 1 or 2). Each state earns a reward per roll in each column: the expected count of a
 * settlement label, a roll, a working roll. The expected total from state i is
 *
 *   x_i = r_i + Σ_j P_ij x_j,  i.e.  (scale·I − W) x = scale·r
 *
 * which is solved exactly:
 *
 * 1. **Self-loops** stay on the diagonal (scale − w_ii), so a one-state component is a division.
 * 2. **Tarjan SCC** splits the states into strongly connected components, found sinks first, so
 *    each component is solved after every component it can step into.
 * 3. **Gaussian elimination per component**, fraction-free (Bareiss): the component's matrix is an
 *    integer M-matrix, whose leading principal minors are all positive, so no pivoting is needed
 *    and every division is exact. Values already known outside the component join the right-hand
 *    side over a common denominator, and each result is one `Fraction` (num / (det × lcm)).
 *
 * A state from which the walk can fail to end (it can reach a closed component, such as a bet that
 * is OFF and never switched back ON) has no finite expectation: its value is null.
 */

/** One step out of a state: a weight out of the chain's `scale`, to a state or out (-1). */
export interface Step {
  readonly weight: number
  readonly to: number
}

export interface RewardChain {
  /** The total weight of each state's steps: 36 for two dice. */
  readonly scale: number
  readonly steps: readonly (readonly Step[])[]
  /** Each state's expected reward on its next roll, times `scale`, one entry per column. */
  readonly rewards: readonly (readonly bigint[])[]
  readonly columns: number
}

export interface ChainSolution {
  /**
   * The expected total reward from each state until the walk ends, one value per column; null for
   * a state whose walk may never end.
   */
  readonly values: readonly (readonly Fraction[] | null)[]
}

/** Solves `chain` exactly; see the module comment. */
export function solveChain(chain: RewardChain): ChainSolution {
  const { scale, steps, rewards, columns } = chain
  const n = steps.length
  if (rewards.length !== n) throw new RangeError('One reward row per state is needed')
  const adjacency = steps.map((out, state) => {
    let total = 0
    const next = new Set<number>()
    for (const { weight, to } of out) {
      if (!Number.isSafeInteger(weight) || weight < 0) {
        throw new RangeError(`State ${state} has a bad step weight: ${weight}`)
      }
      if (to < -1 || to >= n || !Number.isInteger(to)) {
        throw new RangeError(`State ${state} steps to a state that does not exist: ${to}`)
      }
      total += weight
      if (to >= 0 && weight > 0) next.add(to)
    }
    if (total !== scale) {
      throw new RangeError(`State ${state}'s steps weigh ${total}, not ${scale}`)
    }
    return [...next]
  })
  for (const [state, row] of rewards.entries()) {
    if (row.length !== columns) throw new RangeError(`State ${state} has ${row.length} rewards`)
  }

  const values: (readonly Fraction[] | null)[] = new Array<readonly Fraction[] | null>(n).fill(null)
  const solved = new Array<boolean>(n).fill(false)
  for (const component of stronglyConnected(adjacency)) {
    const inside = new Set(component)
    let leaves = false
    let endless = false
    for (const state of component) {
      for (const { weight, to } of at(steps, state)) {
        if (weight === 0) continue
        if (to === -1) {
          leaves = true
        } else if (!inside.has(to)) {
          leaves = true
          if (!at(solved, to) || at(values, to) === null) endless = true
        }
      }
    }
    // A closed component never ends, and one that can step into an endless state may not.
    const blockValues = !leaves || endless ? null : solveComponent(chain, component, values)
    for (const [index, state] of component.entries()) {
      values[state] = blockValues === null ? null : at(blockValues, index)
      solved[state] = true
    }
  }
  return { values }
}

/**
 * The values of one component's states, given the values of every state outside it: Bareiss
 * elimination on (scale·I − W_cc) x = scale·r + W_co x_o, one column at a time sharing the matrix.
 */
function solveComponent(
  chain: RewardChain,
  component: readonly number[],
  known: readonly (readonly Fraction[] | null)[],
): Fraction[][] {
  const { scale, steps, rewards, columns } = chain
  const k = component.length
  const local = new Map(component.map((state, index) => [state, index]))
  const matrix: bigint[][] = component.map(() => new Array<bigint>(k).fill(0n))
  // Steps out of the component, per row: the weight and the known values of their targets.
  const outside: { readonly weight: bigint; readonly values: readonly Fraction[] }[][] = []
  for (const [row, state] of component.entries()) {
    const line = at(matrix, row)
    line[row] = BigInt(scale)
    const exits: { readonly weight: bigint; readonly values: readonly Fraction[] }[] = []
    for (const { weight, to } of at(steps, state)) {
      if (weight === 0 || to === -1) continue
      const column = local.get(to)
      if (column === undefined) {
        const values = at(known, to)
        if (values === null) throw new Error('A component was solved before its successors')
        exits.push({ weight: BigInt(weight), values })
      } else {
        line[column] = at(line, column) - BigInt(weight)
      }
    }
    outside.push(exits)
  }
  // Per column, the right-hand side over a common denominator `scaleBy`.
  const scaleBy: bigint[] = []
  const rhs: bigint[][] = component.map(() => new Array<bigint>(columns).fill(0n))
  for (let column = 0; column < columns; column++) {
    let common = 1n
    for (const exits of outside) {
      for (const { values } of exits) common = lcm(common, at(values, column).den)
    }
    scaleBy.push(common)
    for (const [row, state] of component.entries()) {
      let total = at(at(rewards, state), column) * common
      for (const { weight, values } of at(outside, row)) {
        const value = at(values, column)
        total += weight * value.num * (common / value.den)
      }
      at(rhs, row)[column] = total
    }
  }
  const { det, solution } = bareiss(matrix, rhs)
  return solution.map((row) =>
    row.map((value, column) => Fraction.of(value, det * at(scaleBy, column))),
  )
}

/**
 * Solves A·x = b exactly for an integer matrix A whose leading principal minors are all non-zero
 * (true of the M-matrices here), by fraction-free (Bareiss) elimination and fraction-free back
 * substitution. Returns det(A) and det(A)·x, which are integers by Cramer's rule, so every division
 * below is exact.
 */
export function bareiss(
  a: readonly (readonly bigint[])[],
  b: readonly (readonly bigint[])[],
): { readonly det: bigint; readonly solution: bigint[][] } {
  const n = a.length
  const m = at(b, 0).length
  const rows = a.map((row, i) => {
    if (row.length !== n) throw new RangeError('The matrix must be square')
    return [...row, ...at(b, i)]
  })
  let previous = 1n
  for (let k = 0; k < n; k++) {
    const pivotRow = at(rows, k)
    const pivot = at(pivotRow, k)
    if (pivot === 0n) throw new RangeError('A leading principal minor is zero')
    for (let i = k + 1; i < n; i++) {
      const row = at(rows, i)
      const factor = at(row, k)
      for (let j = k + 1; j < n + m; j++) {
        row[j] = exactDiv(pivot * at(row, j) - factor * at(pivotRow, j), previous)
      }
      row[k] = 0n
    }
    previous = pivot
  }
  const det = at(at(rows, n - 1), n - 1)
  const solution: bigint[][] = new Array<bigint[]>(n)
  for (let k = n - 1; k >= 0; k--) {
    const row = at(rows, k)
    const scaled = new Array<bigint>(m)
    for (let c = 0; c < m; c++) {
      let total = det * at(row, n + c)
      for (let j = k + 1; j < n; j++) total -= at(row, j) * at(at(solution, j), c)
      scaled[c] = exactDiv(total, at(row, k))
    }
    solution[k] = scaled
  }
  return { det, solution }
}

/**
 * Tarjan's strongly connected components, iteratively, in the order Tarjan finds them: every
 * component comes after all the components it has an edge into (sinks first).
 */
export function stronglyConnected(adjacency: readonly (readonly number[])[]): number[][] {
  const n = adjacency.length
  const index = new Array<number>(n).fill(-1)
  const low = new Array<number>(n).fill(0)
  const onStack = new Array<boolean>(n).fill(false)
  const stack: number[] = []
  const components: number[][] = []
  let counter = 0
  const visit = (state: number) => {
    index[state] = counter
    low[state] = counter
    counter += 1
    stack.push(state)
    onStack[state] = true
  }
  for (let root = 0; root < n; root++) {
    if (at(index, root) !== -1) continue
    visit(root)
    const work: { readonly state: number; next: number }[] = [{ state: root, next: 0 }]
    while (work.length > 0) {
      const frame = at(work, work.length - 1)
      const edges = at(adjacency, frame.state)
      if (frame.next < edges.length) {
        const target = at(edges, frame.next)
        frame.next += 1
        if (at(index, target) === -1) {
          visit(target)
          work.push({ state: target, next: 0 })
        } else if (at(onStack, target)) {
          low[frame.state] = Math.min(at(low, frame.state), at(index, target))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent !== undefined) {
        low[parent.state] = Math.min(at(low, parent.state), at(low, frame.state))
      }
      if (at(low, frame.state) === at(index, frame.state)) {
        const component: number[] = []
        for (;;) {
          const member = stack.pop()
          if (member === undefined) throw new Error('Tarjan stack underflow')
          onStack[member] = false
          component.push(member)
          if (member === frame.state) break
        }
        components.push(component)
      }
    }
  }
  return components
}

/** `values[index]`, which must exist: the arrays here are dense, so a miss is a bug. */
export function at<T>(values: readonly T[], index: number): T {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) {
    throw new RangeError(`Index ${index} is out of range (length ${values.length})`)
  }
  return values[index] as T
}

function exactDiv(numerator: bigint, divisor: bigint): bigint {
  const quotient = numerator / divisor
  if (quotient * divisor !== numerator) throw new Error('Bareiss division was not exact')
  return quotient
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b
}
