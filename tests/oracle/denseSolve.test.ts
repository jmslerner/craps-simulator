import { describe, expect, it } from 'vitest'
import { Fraction } from '../../src/engine/core/rational.ts'
import { denseSolve, type DenseChain, type DenseTransition } from './denseSolve.ts'

const f = (num: number, den = 1) => Fraction.of(num, den)
const text = (map: ReadonlyMap<string, Fraction> | undefined) =>
  Object.fromEntries([...(map ?? new Map<string, Fraction>())].map(([k, v]) => [k, v.toString()]))
const toState = (state: number, p: Fraction, rewards?: Record<string, Fraction>) =>
  ({ p, to: { state }, ...(rewards ? { rewards } : {}) }) as DenseTransition
const toLabel = (absorb: string, p: Fraction, rewards?: Record<string, Fraction>) =>
  ({ p, to: { absorb }, ...(rewards ? { rewards } : {}) }) as DenseTransition

/** The pass line from the come-out, as a chain: the come-out, then each point against 7. */
function passChain(points: readonly number[], naturals: readonly number[]): DenseChain {
  const ways = (n: number) => 6 - Math.abs(n - 7)
  const roll = { rolls: f(1) }
  const comeOut: DenseTransition[] = []
  for (let total = 2; total <= 12; total++) {
    const p = f(ways(total), 36)
    const index = points.indexOf(total)
    if (index >= 0) comeOut.push(toState(index + 1, p, roll))
    else if (naturals.includes(total)) comeOut.push(toLabel('win', p, { ...roll, net: f(1) }))
    else comeOut.push(toLabel('lose', p, { ...roll, net: f(-1) }))
  }
  const onPoint = points.map((n, i): DenseTransition[] => [
    toLabel('win', f(ways(n), 36), { ...roll, net: f(1) }),
    toLabel('lose', f(6, 36), { ...roll, net: f(-1) }),
    toState(i + 1, f(30 - ways(n), 36), roll),
  ])
  return { size: points.length + 1, transitions: [comeOut, ...onPoint] }
}

describe('denseSolve on hand-solved chains', () => {
  it("a fair gambler's ruin on 1 and 2 of 3: absorption, steps and the fundamental matrix", () => {
    const step = { steps: f(1) }
    const chain: DenseChain = {
      size: 2,
      transitions: [
        [toLabel('lose', f(1, 2), step), toState(1, f(1, 2), step)],
        [toState(0, f(1, 2), step), toLabel('win', f(1, 2), step)],
      ],
    }
    const solved = denseSolve(chain)
    expect(solved.labels).toEqual(['lose', 'win'])
    expect(text(solved.absorption[0])).toEqual({ lose: '2/3', win: '1/3' })
    expect(text(solved.absorption[1])).toEqual({ lose: '1/3', win: '2/3' })
    expect(text(solved.rewards[0])).toEqual({ steps: '2' })
    expect(solved.visits?.map((row) => row.map(String))).toEqual([
      ['4/3', '2/3'],
      ['2/3', '4/3'],
    ])
  })

  it('a self-loop: place 6 against 7 in 36/11 rolls, won 5/11 of the time', () => {
    const roll = { rolls: f(1) }
    const solved = denseSolve({
      size: 1,
      transitions: [
        [
          toLabel('win', f(5, 36), { ...roll, cash: f(7, 6) }),
          toLabel('lose', f(6, 36), { ...roll, cash: f(-1) }),
          toState(0, f(25, 36), roll),
        ],
      ],
    })
    expect(text(solved.absorption[0])).toEqual({ win: '5/11', lose: '6/11' })
    expect(text(solved.rewards[0])).toEqual({ rolls: '36/11', cash: '-1/66' })
    expect(solved.visits?.[0]?.[0]?.toString()).toBe('36/11')
  })

  it('the pass line: 7/495 and 557/165 rolls traditional, 373/6930 and 9613/2310 crapless', () => {
    const traditional = denseSolve(passChain([4, 5, 6, 8, 9, 10], [7, 11]), { visits: false })
    expect(traditional.visits).toBeNull()
    expect(text(traditional.rewards[0])).toEqual({ rolls: '557/165', net: '-7/495' })
    expect(text(traditional.absorption[0])).toEqual({ win: '244/495', lose: '251/495' })
    const crapless = denseSolve(passChain([2, 3, 4, 5, 6, 8, 9, 10, 11, 12], [7]))
    expect(text(crapless.rewards[0])).toEqual({ rolls: '9613/2310', net: '-373/6930' })
    // From point 2 the pass wins 1/7 of the time, in 36/7 rolls.
    expect(text(crapless.absorption[1])).toEqual({ win: '1/7', lose: '6/7' })
    expect(crapless.rewards[1]?.get('rolls')?.toString()).toBe('36/7')
    // Visits from the come-out: point 2 is set with 1/36 and held 36/7 rolls on average.
    expect(crapless.visits?.[0]?.[1]?.toString()).toBe('1/7')
    expect(crapless.visits?.[0]?.[0]?.toString()).toBe('1')
  })

  it('rolls per hand: the chain absorbed only by the seven-out (rules spec §1.3)', () => {
    const ways = (n: number) => 6 - Math.abs(n - 7)
    const hand = (points: readonly number[]): DenseChain => {
      const roll = { rolls: f(1) }
      const comeOut: DenseTransition[] = [
        toState(0, f(36 - points.reduce((sum, n) => sum + ways(n), 0), 36), roll),
        ...points.map((n, i) => toState(i + 1, f(ways(n), 36), roll)),
      ]
      const onPoint = points.map((n, i): DenseTransition[] => [
        toState(0, f(ways(n), 36), roll),
        toLabel('sevenOut', f(6, 36), roll),
        toState(i + 1, f(30 - ways(n), 36), roll),
      ])
      return { size: points.length + 1, transitions: [comeOut, ...onPoint] }
    }
    const traditional = denseSolve(hand([4, 5, 6, 8, 9, 10]), { visits: false })
    expect(traditional.rewards[0]?.get('rolls')?.toString()).toBe('1671/196')
    const crapless = denseSolve(hand([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]), { visits: false })
    expect(crapless.rewards[0]?.get('rolls')?.toString()).toBe('57678/7303')
  })

  it('rejects chains that are not absorbing or not stochastic', () => {
    const loop: DenseChain = {
      size: 2,
      transitions: [[toState(1, f(1))], [toState(0, f(1))]],
    }
    expect(() => denseSolve(loop)).toThrow(/singular/)
    expect(() => denseSolve({ size: 1, transitions: [[toLabel('win', f(1, 2))]] })).toThrow(
      /add up to 1\/2/,
    )
    expect(() => denseSolve({ size: 1, transitions: [[toState(3, f(1))]] })).toThrow(/No state 3/)
    expect(() =>
      denseSolve({ size: 1, transitions: [[toLabel('a', f(3, 2)), toLabel('b', f(-1, 2))]] }),
    ).toThrow(/chance/)
    expect(() => denseSolve({ size: 0, transitions: [] })).toThrow(/transient/)
  })

  it('stays exact on a nearly sticky state', () => {
    // State 0 leaves with chance 10⁻⁶, so it is visited 10⁶ times on average, then state 1 once.
    const tiny = f(1, 1_000_000)
    const solved = denseSolve({
      size: 2,
      transitions: [
        [toState(0, Fraction.ONE.sub(tiny), { t: f(1) }), toState(1, tiny, { t: f(1) })],
        [toLabel('done', f(1), { t: f(1) })],
      ],
    })
    expect(solved.rewards[0]?.get('t')?.toString()).toBe('1000001')
  })
})
