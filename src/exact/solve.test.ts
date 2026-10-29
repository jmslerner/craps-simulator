import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Fraction } from '../engine/core/rational.ts'
import { bareiss, solveChain, stronglyConnected, type RewardChain } from './solve.ts'

/** A dense exact Gauss–Jordan solve of A x = b with fractions, for comparison. */
function denseSolve(a: Fraction[][], b: Fraction[][]): Fraction[][] {
  const n = a.length
  const rows = a.map((row, i) => [...row, ...(b[i] ?? [])])
  for (let k = 0; k < n; k++) {
    const pivotIndex = rows.findIndex((row, i) => i >= k && !(row[k] ?? Fraction.ZERO).isZero())
    if (pivotIndex === -1) throw new Error('singular')
    const pivotRow = rows[pivotIndex] ?? []
    rows[pivotIndex] = rows[k] ?? []
    rows[k] = pivotRow
    const pivot = pivotRow[k] ?? Fraction.ONE
    for (let j = 0; j < pivotRow.length; j++)
      pivotRow[j] = (pivotRow[j] ?? Fraction.ZERO).div(pivot)
    for (let i = 0; i < n; i++) {
      if (i === k) continue
      const row = rows[i] ?? []
      const factor = row[k] ?? Fraction.ZERO
      if (factor.isZero()) continue
      for (let j = 0; j < row.length; j++) {
        row[j] = (row[j] ?? Fraction.ZERO).sub(factor.mul(pivotRow[j] ?? Fraction.ZERO))
      }
    }
  }
  return rows.map((row) => row.slice(n))
}

describe('bareiss', () => {
  it('solves an integer system exactly and returns the determinant', () => {
    const a = [
      [4n, -1n, 0n],
      [-1n, 4n, -1n],
      [0n, -1n, 4n],
    ]
    const b = [[1n], [2n], [3n]]
    const { det, solution } = bareiss(a, b)
    expect(det).toBe(56n)
    const expected = denseSolve(
      a.map((row) => row.map((v) => Fraction.of(v))),
      b.map((row) => row.map((v) => Fraction.of(v))),
    )
    const actual = solution.map((row) => row.map((v) => Fraction.of(v, det).toString()))
    expect(actual).toEqual(expected.map((row) => row.map((v) => v.toString())))
  })

  it('refuses a matrix with a zero leading minor', () => {
    expect(() =>
      bareiss(
        [
          [0n, 1n],
          [1n, 0n],
        ],
        [[1n], [1n]],
      ),
    ).toThrow(RangeError)
  })
})

describe('stronglyConnected', () => {
  it('finds components sinks first', () => {
    // 0 → 1 ⇄ 2 → 3; 3 is a sink, {1, 2} a cycle.
    const components = stronglyConnected([[1], [2], [1, 3], []])
    const sorted = components.map((c) => [...c].sort((x, y) => x - y))
    expect(sorted).toEqual([[3], [1, 2], [0]])
  })
})

describe('solveChain', () => {
  it('normalizes a self-loop: a state that ends with probability 1/6 a roll lasts 6 rolls', () => {
    const { values } = solveChain({
      scale: 36,
      steps: [
        [
          { weight: 30, to: 0 },
          { weight: 6, to: -1 },
        ],
      ],
      rewards: [[36n]],
      columns: 1,
    })
    expect(values[0]?.[0]?.toString()).toBe('6')
  })

  it('gives null to a closed component and to every state that can reach one', () => {
    const { values } = solveChain({
      scale: 2,
      steps: [
        [
          { weight: 1, to: 1 },
          { weight: 1, to: -1 },
        ],
        [{ weight: 2, to: 1 }],
        [{ weight: 2, to: -1 }],
      ],
      rewards: [[2n], [2n], [2n]],
      columns: 1,
    })
    expect(values[0]).toBeNull()
    expect(values[1]).toBeNull()
    expect(values[2]?.[0]?.toString()).toBe('1')
  })

  it('rejects steps that do not weigh the scale, and targets that do not exist', () => {
    const chain = (steps: RewardChain['steps']): RewardChain => ({
      scale: 36,
      steps,
      rewards: steps.map(() => [0n]),
      columns: 1,
    })
    expect(() => solveChain(chain([[{ weight: 35, to: -1 }]]))).toThrow(/weigh 35/)
    expect(() => solveChain(chain([[{ weight: 36, to: 4 }]]))).toThrow(/does not exist/)
  })

  it('matches a dense exact solve on random absorbing chains (pinned seed)', () => {
    const chainArb = fc.integer({ min: 1, max: 7 }).chain((n) =>
      fc.record({
        n: fc.constant(n),
        rows: fc.array(
          fc.record({
            weights: fc.array(fc.integer({ min: 0, max: 5 }), {
              minLength: n + 1,
              maxLength: n + 1,
            }),
            reward: fc.integer({ min: -20, max: 20 }),
          }),
          { minLength: n, maxLength: n },
        ),
      }),
    )
    fc.assert(
      fc.property(chainArb, ({ n, rows }) => {
        // Every state leaks to "out" (the last weight, at least 1), so the chain is absorbing.
        const scale = 64
        const steps = rows.map(({ weights }) => {
          const raw = weights.map((w, i) => (i === n ? w + 1 : w))
          const total = raw.reduce((x, y) => x + y, 0)
          // Scale up to `scale`, putting the rounding remainder on "out".
          const scaled = raw.map((w) => (w * scale - ((w * scale) % total)) / total)
          const used = scaled.slice(0, n).reduce((x, y) => x + y, 0)
          return [
            ...scaled.slice(0, n).map((weight, to) => ({ weight, to })),
            { weight: scale - used, to: -1 },
          ]
        })
        const rewards = rows.map(({ reward }) => [BigInt(reward * scale), BigInt(scale)])
        const { values } = solveChain({ scale, steps, rewards, columns: 2 })
        // Dense: (I − P) x = r.
        const a = steps.map((out, i) =>
          Array.from({ length: n }, (_, j) => {
            const w = out.find((s) => s.to === j)?.weight ?? 0
            return Fraction.of(i === j ? scale - w : -w, scale)
          }),
        )
        const b = rows.map(({ reward }) => [Fraction.of(reward), Fraction.ONE])
        const dense = denseSolve(a, b)
        for (let i = 0; i < n; i++) {
          const got = values[i]
          if (got === null || got === undefined) return false
          if (!got[0]?.equals(dense[i]?.[0] ?? Fraction.ZERO)) return false
          if (!got[1]?.equals(dense[i]?.[1] ?? Fraction.ZERO)) return false
        }
        return true
      }),
      { seed: 20261028, numRuns: 300 },
    )
  })
})
