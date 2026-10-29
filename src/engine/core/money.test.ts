import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ROUNDING_MODES,
  TO_THE_PENNY,
  cents,
  commissionOn,
  dollarsToCents,
  formatCents,
  parseDollars,
  roundCents,
  winnings,
  type Cents,
  type Commission,
  type RatioLike,
  type Rounding,
  type RoundingMode,
} from './money.ts'
import { Fraction } from './rational.ts'

const WHOLE_DOLLARS: Rounding = { mode: 'floor', increment: cents(100) }
const MODES: readonly RoundingMode[] = ['floor', 'ceil', 'halfUp', 'halfEven']

describe('ROUNDING_MODES', () => {
  it('lists exactly the modes roundCents understands, in a fixed order', () => {
    expect(ROUNDING_MODES).toEqual(MODES)
    for (const mode of ROUNDING_MODES) {
      expect(() => roundCents(Fraction.of(1, 2), { mode, increment: cents(1) })).not.toThrow()
    }
  })
})

describe('parseDollars', () => {
  it('reads whole dollars and one or two decimals as exact cents', () => {
    expect(parseDollars('12')).toBe(1200)
    expect(parseDollars('12.5')).toBe(1250)
    expect(parseDollars('12.34')).toBe(1234)
    expect(parseDollars('0')).toBe(0)
    expect(parseDollars('0.01')).toBe(1)
    expect(parseDollars('0.1')).toBe(10)
    expect(parseDollars('007.10')).toBe(710)
  })

  it('stays exact where floats would not (0.29 * 100 is 28.999999999999996)', () => {
    expect(parseDollars('0.29')).toBe(29)
    expect(parseDollars('1.15')).toBe(115)
    expect(parseDollars('4.35')).toBe(435)
  })

  it('accepts the largest safe amount and rejects one cent more', () => {
    expect(parseDollars('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => parseDollars('90071992547409.92')).toThrow(/too large/)
    expect(() => parseDollars('1'.repeat(40))).toThrow(/too large/)
  })

  it('rejects anything that is not plain digits with up to two decimals', () => {
    const bad = ['', ' ', ' 12', '12 ', '-1', '+1', '1.234', '1.', '.5', '1,000', '1e3', '$5']
    const worse = ['5.0.0', 'NaN', 'Infinity', '0x10', '١٢', '12\n', '1_000', '5 00']
    for (const text of [...bad, ...worse]) {
      expect(() => parseDollars(text), JSON.stringify(text)).toThrow(RangeError)
    }
  })

  it('round-trips with formatCents', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (amount) => {
        const shown = formatCents(cents(amount)).replace(/[$,]/g, '')
        expect(parseDollars(shown)).toBe(amount)
      }),
      { seed: 20261028, numRuns: 2000 },
    )
  })
})
/** A net "to 1" ratio; config/ratio.ts turns a machine's wording ("30 for 1") into these. */
const ratio = (num: number, den: number): RatioLike => ({ num: BigInt(num), den: BigInt(den) })
const SEVEN_TO_SIX = ratio(7, 6)
const rounding = (mode: RoundingMode, increment = 1): Rounding => ({
  mode,
  increment: cents(increment),
})

/**
 * Reference for `roundCents`, written separately from it: a binary search brackets num/den
 * between two consecutive multiples of the increment, then exact distances pick the side.
 */
function referenceRound(num: bigint, den: bigint, increment: bigint, mode: RoundingMode): bigint {
  const fits = (k: bigint) => k * increment * den <= num // k increments are at most num/den
  let low = 0n
  let high = 1n
  while (fits(high)) high *= 2n
  while (high - low > 1n) {
    const mid = (low + high) / 2n
    if (fits(mid)) low = mid
    else high = mid
  }
  const below = low * increment
  const above = below + increment
  const toBelow = num - below * den // distances, both scaled by den
  const toAbove = above * den - num
  switch (mode) {
    case 'floor':
      return below
    case 'ceil':
      return toBelow === 0n ? below : above
    case 'halfUp':
      return toAbove <= toBelow ? above : below
    case 'halfEven':
      if (toAbove !== toBelow) return toAbove < toBelow ? above : below
      return low % 2n === 0n ? below : above
  }
}

describe('cents', () => {
  it('brands safe integers', () => {
    expect(cents(583)).toBe(583)
    expect(cents(-150)).toBe(-150)
    expect(cents(0)).toBe(0)
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects anything that is not whole cents', () => {
    for (const bad of [1.5, 0.1 + 0.2, Number.NaN, Infinity, 2 ** 53]) {
      expect(() => cents(bad)).toThrow(RangeError)
    }
  })
})

describe('winnings', () => {
  it('pays to the penny like a bubble machine', () => {
    const pays = (stake: number, num: number, den: number) =>
      winnings(cents(stake), ratio(num, den), TO_THE_PENNY)
    expect(pays(500, 7, 6)).toBe(583) // $5 place 6 -> $5.83
    expect(pays(1200, 7, 6)).toBe(1400)
    expect(pays(1000, 9, 5)).toBe(1800)
    expect(pays(500, 7, 5)).toBe(700)
    expect(pays(500, 11, 2)).toBe(2750) // crapless place 2/12
    expect(pays(500, 11, 4)).toBe(1375) // crapless place 3/11
    expect(pays(500, 3, 2)).toBe(750)
    expect(pays(100, 29, 1)).toBe(2900) // "30 for 1" includes the stake, so it nets 29:1
  })

  it('drops the remainder like a live table paying whole dollars', () => {
    expect(winnings(cents(500), SEVEN_TO_SIX, WHOLE_DOLLARS)).toBe(500)
    expect(winnings(cents(1000), SEVEN_TO_SIX, WHOLE_DOLLARS)).toBe(1100)
  })

  it('rounds place 6 up where a machine does (STW: $1 -> $1.17, $2 -> $2.34)', () => {
    expect(winnings(cents(100), SEVEN_TO_SIX, rounding('ceil'))).toBe(117)
    expect(winnings(cents(200), SEVEN_TO_SIX, rounding('ceil'))).toBe(234)
    expect(winnings(cents(100), SEVEN_TO_SIX, TO_THE_PENNY)).toBe(116)
  })

  it('accepts a Fraction as the pay ratio', () => {
    expect(winnings(cents(600), Fraction.of(7, 6), TO_THE_PENNY)).toBe(700)
  })

  it('rejects negative amounts and fractional stakes', () => {
    expect(() => roundCents(Fraction.of(-1), TO_THE_PENNY)).toThrow(RangeError)
    expect(() => winnings(1.5 as Cents, ratio(1, 1), TO_THE_PENNY)).toThrow(RangeError)
  })
})

describe('roundCents', () => {
  it('rounds halves up in halfUp mode', () => {
    expect(roundCents(Fraction.of(1, 2), rounding('halfUp'))).toBe(1)
    expect(roundCents(Fraction.of(1750, 3), rounding('halfUp'))).toBe(583)
    expect(roundCents(Fraction.of(150), rounding('halfUp', 100))).toBe(200)
  })

  it('rounds halves to an even number of increments in halfEven mode', () => {
    expect(roundCents(Fraction.of(1, 2), rounding('halfEven'))).toBe(0)
    expect(roundCents(Fraction.of(3, 2), rounding('halfEven'))).toBe(2)
    expect(roundCents(Fraction.of(150), rounding('halfEven', 100))).toBe(200)
    expect(roundCents(Fraction.of(250), rounding('halfEven', 100))).toBe(200)
    expect(roundCents(Fraction.of(251), rounding('halfEven', 100))).toBe(300)
  })

  it('leaves exact multiples alone in every mode', () => {
    for (const mode of MODES) expect(roundCents(Fraction.of(1200), rounding(mode, 100))).toBe(1200)
  })

  it('rejects bad increments, unknown modes and results beyond safe integers', () => {
    const half = Fraction.of(1, 2)
    expect(() => roundCents(half, { mode: 'floor', increment: 0 as Cents })).toThrow(RangeError)
    expect(() => roundCents(half, { mode: 'floor', increment: 1.5 as Cents })).toThrow(RangeError)
    const nearest = { mode: 'nearest', increment: cents(1) } as unknown as Rounding
    expect(() => roundCents(half, nearest)).toThrow(/Unknown rounding mode: nearest/)
    expect(() => roundCents(Fraction.of(2n ** 60n), TO_THE_PENNY)).toThrow(RangeError)
  })

  it('matches the bigint reference on every grid fraction, increment and mode', () => {
    const dens = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 20n, 36n]
    const increments = [1n, 2n, 5n, 25n, 100n]
    const mismatches: string[] = []
    let checked = 0
    for (const increment of increments) {
      for (const den of dens) {
        // Every numerator up to three increments past zero: each remainder, at several multiples.
        for (let num = 0n; num <= 3n * increment * den; num++) {
          const exact = Fraction.of(num, den)
          for (const mode of MODES) {
            const actual = BigInt(roundCents(exact, rounding(mode, Number(increment))))
            const expected = referenceRound(num, den, increment, mode)
            if (actual !== expected) {
              mismatches.push(`${num}/${den} by ${increment} ${mode}: ${actual}, want ${expected}`)
            }
            checked++
          }
        }
      }
    }
    expect(mismatches).toEqual([])
    expect(checked).toBe(214_144)
  })

  it('matches the bigint reference on large random amounts', () => {
    fc.assert(
      fc.property(
        fc.bigInt(0n, 2n ** 50n),
        fc.bigInt(1n, 1_000_000n),
        fc.constantFrom(1n, 5n, 25n, 100n, 500n),
        fc.constantFrom(...MODES),
        (num, den, increment, mode) => {
          const actual = roundCents(Fraction.of(num, den), rounding(mode, Number(increment)))
          expect(BigInt(actual)).toBe(referenceRound(num, den, increment, mode))
        },
      ),
      { seed: 20261028, numRuns: 2000 },
    )
  })
})

describe('commissionOn', () => {
  const machineVig: Commission = {
    rate: ratio(1, 20),
    rounding: TO_THE_PENNY,
    minimum: cents(0),
  }
  const liveVig: Commission = {
    rate: ratio(1, 20),
    rounding: WHOLE_DOLLARS,
    minimum: cents(100),
  }

  it('charges exact 5% on a machine', () => {
    expect(commissionOn(cents(2000), machineVig)).toBe(100)
    expect(commissionOn(cents(2500), machineVig)).toBe(125)
    expect(commissionOn(cents(500), machineVig)).toBe(25)
    expect(commissionOn(cents(0), machineVig)).toBe(0)
  })

  it('applies live-table rounding and the $1 minimum', () => {
    expect(commissionOn(cents(2500), liveVig)).toBe(100)
    expect(commissionOn(cents(500), liveVig)).toBe(100)
    expect(commissionOn(cents(4000), liveVig)).toBe(200)
  })

  it('rounds a sub-cent vig up where the machine does ($1 lay on 4: 2.5¢ -> 3¢)', () => {
    expect(commissionOn(cents(50), { ...machineVig, rounding: rounding('ceil') })).toBe(3)
    expect(commissionOn(cents(50), machineVig)).toBe(2)
  })
})

describe('formatting and parsing', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(cents(583))).toBe('$5.83')
    expect(formatCents(cents(-150))).toBe('-$1.50')
    expect(formatCents(cents(123_456_789))).toBe('$1,234,567.89')
    expect(formatCents(cents(1200), { trimWholeDollars: true })).toBe('$12')
    expect(formatCents(cents(1250), { trimWholeDollars: true })).toBe('$12.50')
  })

  it('parses dollars to cents exactly', () => {
    expect(dollarsToCents(12.34)).toBe(1234)
    expect(dollarsToCents(0.1 + 0.2)).toBe(30)
    expect(() => dollarsToCents(1.234)).toThrow(RangeError)
  })
})
