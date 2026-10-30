import { describe, expect, it } from 'vitest'
import { pointRunProgress, totalBit } from '../../engine/index.ts'
import type { CompiledSideBet } from '../../engine/index.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import {
  countingNote,
  listNumbers,
  payRows,
  progressOf,
  settledWords,
  topPayLabel,
  trackOf,
} from './sideBetProgress.ts'

/**
 * The side-bet progress views (plan §10 M11), read back from the engine's own `progress`
 * encodings on the four presets' side bets: Lucky Roller (crapless), the Hot Shooter Jackpot
 * (Shoot To Win), the Lucky Shooter (strict) and the Fire Bet (the live table). Every label here
 * is the machine's from the preset, so a preset edit shows up as a failing expectation.
 */

function side(presetId: keyof typeof COMPILED_PRESETS, typeId: string): CompiledSideBet {
  const type = COMPILED_PRESETS[presetId].sideBets.get(typeId)
  if (type === undefined) throw new Error(`${presetId} has no side bet ${typeId}`)
  return type
}

const low = side('craplessBubble', 'luckyRollerLow')
const all = side('craplessBubble', 'luckyRollerAll')
const hot = side('traditionalBubble', 'hotShooter')
const shooter = side('strictBubble', 'luckyShooter')
const fire = side('traditionalLive345', 'fire')

describe('trackOf', () => {
  it('lists the numbers a collecting bet draws as pips, and none for the roll counter', () => {
    expect(trackOf(low)).toStrictEqual([2, 3, 4, 5, 6])
    expect(trackOf(all)).toStrictEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
    expect(trackOf(fire)).toStrictEqual([4, 5, 6, 8, 9, 10])
    expect(trackOf(shooter)).toStrictEqual([4, 5, 6, 8, 9, 10])
    expect(trackOf(hot)).toBeNull()
  })
})

describe('progressOf', () => {
  it('reads a collect set’s rolled totals from its mask', () => {
    expect(progressOf(low, 0)).toStrictEqual({
      lit: [],
      point: null,
      count: null,
      words: 'none of 2, 3, 4, 5 and 6 rolled yet',
    })
    const twoAndFour = totalBit(2) | totalBit(4)
    expect(progressOf(low, twoAndFour)).toStrictEqual({
      lit: [2, 4],
      point: null,
      count: null,
      words: '2 and 4 rolled, needs 3, 5 and 6',
    })
  })

  it('reads the Fire Bet’s points made', () => {
    expect(progressOf(fire, 0).words).toBe('no points made yet')
    const made = progressOf(fire, totalBit(6) | totalBit(8))
    expect(made.lit).toStrictEqual([6, 8])
    expect(made.words).toBe('2 points made (6 and 8)')
    expect(progressOf(fire, totalBit(10)).words).toBe('1 point made (10)')
  })

  it('reads the Hot Shooter’s roll count', () => {
    expect(progressOf(hot, 12)).toStrictEqual({
      lit: [],
      point: null,
      count: 12,
      words: '12 rolls counted',
    })
    expect(progressOf(hot, 1).words).toBe('1 roll counted')
  })

  it('reads the Lucky Shooter’s point and hits', () => {
    expect(progressOf(shooter, pointRunProgress(null, 0)).words).toBe('no point yet')
    const onSix = progressOf(shooter, pointRunProgress(6, 0))
    expect(onSix.point).toBe(6)
    expect(onSix.lit).toStrictEqual([])
    expect(onSix.words).toBe('point 6, 0 hits')
    const oneHit = progressOf(shooter, pointRunProgress(6, totalBit(4)))
    expect(oneHit.lit).toStrictEqual([4])
    expect(oneHit.words).toBe('point 6, 1 hit (4)')
  })
})

describe('payRows and topPayLabel', () => {
  it('lists the Fire Bet’s table with the standing marked', () => {
    const fresh = payRows(fire, 0)
    expect(fresh.map((row) => [row.reach, row.pays, row.reached, row.next])).toStrictEqual([
      ['4 points', '24 to 1', false, true],
      ['5 points', '249 to 1', false, false],
      ['6 points', '999 to 1', false, false],
    ])
    const four = payRows(fire, totalBit(4) | totalBit(5) | totalBit(6) | totalBit(8))
    expect(four.map((row) => [row.key, row.reached, row.next])).toStrictEqual([
      ['4', true, false],
      ['5', false, true],
      ['6', false, false],
    ])
    expect(topPayLabel(fire)).toBe('999 to 1')
  })

  it('lists the Hot Shooter’s tiers, the 1-for-1 tier as stake back', () => {
    const rows = payRows(hot, 20)
    expect(rows.map((row) => [row.reach, row.pays])).toStrictEqual([
      ['8+ rolls', 'stake back'],
      ['16+ rolls', '3 for 1'],
      ['24+ rolls', '5 for 1'],
      ['32+ rolls', '7 for 1'],
      ['40+ rolls', '12 for 1'],
      ['45+ rolls', '30 for 1'],
      ['50+ rolls', '100 for 1'],
    ])
    expect(rows.filter((row) => row.reached).map((row) => row.key)).toStrictEqual(['8', '16'])
    expect(rows.find((row) => row.next)?.key).toBe('24')
    expect(topPayLabel(hot)).toBe('100 for 1')
  })

  it('lists the Lucky Shooter’s hits and the top award', () => {
    const rows = payRows(shooter, pointRunProgress(6, totalBit(4) | totalBit(5)))
    expect(rows.map((row) => [row.reach, row.pays, row.reached, row.next])).toStrictEqual([
      ['2 hits', '2 for 1', true, false],
      ['3 hits', '5 for 1', false, true],
      ['4 hits', '10 for 1', false, false],
      ['5 hits', '100 for 1', false, false],
      ['all 5 hits, then the point', '500 for 1', false, false],
    ])
    expect(topPayLabel(shooter)).toBe('500 for 1')
  })

  it('a collect set has the one row, always next', () => {
    expect(payRows(low, totalBit(2))).toStrictEqual([
      {
        key: 'set',
        reach: 'all of 2, 3, 4, 5 and 6',
        pays: '31 for 1',
        reached: false,
        next: true,
      },
    ])
    expect(topPayLabel(low)).toBe('31 for 1')
  })
})

describe('countingNote', () => {
  it('says how each machine counts, from its config', () => {
    expect(countingNote(low)).toBe('Any 7 loses it, a come-out 7 included.')
    expect(countingNote(hot)).toBe('Every roll counts, the seven-out included.')
    expect(countingNote(fire)).toBe('Paid at the seven-out for the points made.')
    expect(countingNote(shooter)).toBe('A box number rolled twice settles the bet.')
  })
})

describe('settledWords', () => {
  const win = (payKey: string) => ({ outcome: 'win' as const, payKey, pushReason: null })
  const lose = { outcome: 'lose' as const, payKey: null, pushReason: null }

  it('says what a collect set had when it lost, and that the set came in when it won', () => {
    expect(settledWords(low, lose, totalBit(2) | totalBit(4))).toBe(
      'had 2 and 4, needed 3, 5 and 6',
    )
    expect(settledWords(low, lose, 0)).toBe('nothing rolled')
    expect(settledWords(low, win('set'), totalBit(2))).toBe('all of 2, 3, 4, 5 and 6 rolled')
  })

  it('names the tier a Fire Bet or Hot Shooter paid, from the trace’s pay key', () => {
    expect(settledWords(fire, win('4'), 0)).toBe('4 points made')
    expect(settledWords(fire, lose, totalBit(4) | totalBit(9))).toBe('2 points made (4 and 9)')
    expect(settledWords(hot, win('16'), 17)).toBe('16+ rolls')
    expect(settledWords(hot, lose, 5)).toBe('under 8 rolls')
    expect(settledWords(hot, { outcome: 'push', payKey: null, pushReason: 'zeroNet' }, 9)).toBe(
      '8+ rolls, stake back',
    )
  })

  it('words the Lucky Shooter’s outcomes', () => {
    expect(settledWords(shooter, win('top'), pointRunProgress(6, 0))).toBe(
      'all 5 hits, then the point',
    )
    expect(settledWords(shooter, win('3'), pointRunProgress(6, 0))).toBe('3 hits')
    expect(settledWords(shooter, lose, pointRunProgress(null, 0))).toBe('lost on the come-out')
    expect(settledWords(shooter, lose, pointRunProgress(8, totalBit(4)))).toBe('point 8, 1 hit (4)')
    expect(settledWords(shooter, { outcome: 'push', payKey: null, pushReason: 'bar' }, 0)).toBe(
      'stays up for the next come-out',
    )
  })
})

describe('listNumbers', () => {
  it('joins with commas and "and"', () => {
    expect(listNumbers([])).toBe('')
    expect(listNumbers([2])).toBe('2')
    expect(listNumbers([2, 4])).toBe('2 and 4')
    expect(listNumbers([2, 4, 6])).toBe('2, 4 and 6')
  })
})
