import { describe, expect, it } from 'vitest'
import {
  TO_THE_PENNY,
  commissionOn,
  dollarsToCents,
  formatCents,
  ratio,
  roundCents,
  winnings,
  type Commission,
} from './money.ts'
import { Fraction } from './rational.ts'

const WHOLE_DOLLARS = { mode: 'floor', increment: 100 } as const

describe('winnings', () => {
  it('pays to the penny like a bubble machine', () => {
    expect(winnings(500, ratio(7, 6), TO_THE_PENNY)).toBe(583) // $5 place 6 -> $5.83
    expect(winnings(1200, ratio(7, 6), TO_THE_PENNY)).toBe(1400)
    expect(winnings(1000, ratio(9, 5), TO_THE_PENNY)).toBe(1800)
    expect(winnings(500, ratio(7, 5), TO_THE_PENNY)).toBe(700)
    expect(winnings(500, ratio(11, 2), TO_THE_PENNY)).toBe(2750) // crapless place 2/12
    expect(winnings(500, ratio(11, 4), TO_THE_PENNY)).toBe(1375) // crapless place 3/11
    expect(winnings(500, ratio(3, 2), TO_THE_PENNY)).toBe(750)
  })

  it('drops the remainder like a live table paying whole dollars', () => {
    expect(winnings(500, ratio(7, 6), WHOLE_DOLLARS)).toBe(500)
    expect(winnings(1000, ratio(7, 6), WHOLE_DOLLARS)).toBe(1100)
  })

  it('rounds halves up in nearest mode', () => {
    expect(roundCents(Fraction.of(1, 2), { mode: 'nearest', increment: 1 })).toBe(1)
    expect(roundCents(Fraction.of(1750, 3), { mode: 'nearest', increment: 1 })).toBe(583)
    expect(roundCents(Fraction.of(150), { mode: 'nearest', increment: 100 })).toBe(200)
  })

  it('rejects negative amounts and fractional stakes', () => {
    expect(() => roundCents(Fraction.of(-1), TO_THE_PENNY)).toThrow(RangeError)
    expect(() => winnings(1.5, ratio(1, 1), TO_THE_PENNY)).toThrow(RangeError)
  })
})

describe('commissionOn', () => {
  const machineVig: Commission = { rate: ratio(1, 20), rounding: TO_THE_PENNY, minimum: 0 }
  const liveVig: Commission = { rate: ratio(1, 20), rounding: WHOLE_DOLLARS, minimum: 100 }

  it('charges exact 5% on a machine', () => {
    expect(commissionOn(2000, machineVig)).toBe(100)
    expect(commissionOn(2500, machineVig)).toBe(125)
    expect(commissionOn(500, machineVig)).toBe(25)
    expect(commissionOn(0, machineVig)).toBe(0)
  })

  it('applies live-table rounding and the $1 minimum', () => {
    expect(commissionOn(2500, liveVig)).toBe(100)
    expect(commissionOn(500, liveVig)).toBe(100)
    expect(commissionOn(4000, liveVig)).toBe(200)
  })
})

describe('formatting and parsing', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(583)).toBe('$5.83')
    expect(formatCents(-150)).toBe('-$1.50')
    expect(formatCents(123_456_789)).toBe('$1,234,567.89')
    expect(formatCents(1200, { trimWholeDollars: true })).toBe('$12')
    expect(formatCents(1250, { trimWholeDollars: true })).toBe('$12.50')
  })

  it('parses dollars to cents exactly', () => {
    expect(dollarsToCents(12.34)).toBe(1234)
    expect(dollarsToCents(0.1 + 0.2)).toBe(30)
    expect(() => dollarsToCents(1.234)).toThrow(RangeError)
  })
})
