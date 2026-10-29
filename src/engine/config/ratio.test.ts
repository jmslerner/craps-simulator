import { describe, expect, it } from 'vitest'
import { parseRatio } from './ratio.ts'

describe('parseRatio', () => {
  it('reads "a:b" and "a to b" as net pays', () => {
    expect(parseRatio('7:6')).toEqual({ num: 7n, den: 6n, label: '7:6' })
    expect(parseRatio('9 to 5')).toEqual({ num: 9n, den: 5n, label: '9 to 5' })
    expect(parseRatio('1:20')).toEqual({ num: 1n, den: 20n, label: '1:20' }) // 5% vig
    expect(parseRatio('11:2')).toEqual({ num: 11n, den: 2n, label: '11:2' })
  })

  it('reads "a for b" as (a - b):b, keeping the label', () => {
    expect(parseRatio('30 for 1')).toEqual({ num: 29n, den: 1n, label: '30 for 1' })
    expect(parseRatio('15 for 1')).toEqual({ num: 14n, den: 1n, label: '15 for 1' })
    expect(parseRatio('6 for 5')).toEqual({ num: 1n, den: 5n, label: '6 for 5' })
  })

  it('reduces to lowest terms but labels the ratio as written', () => {
    expect(parseRatio('10:2')).toEqual({ num: 5n, den: 1n, label: '10:2' })
    expect(parseRatio('12 for 2')).toEqual({ num: 5n, den: 1n, label: '12 for 2' })
  })

  it('tolerates spacing, letter case and leading zeros', () => {
    expect(parseRatio('  9  TO  5 ')).toEqual({ num: 9n, den: 5n, label: '9 to 5' })
    expect(parseRatio('7 : 6')).toEqual({ num: 7n, den: 6n, label: '7:6' })
    expect(parseRatio('30 For 01')).toEqual({ num: 29n, den: 1n, label: '30 for 1' })
  })

  it('keeps big numbers exact', () => {
    const big = parseRatio('9007199254740993:2')
    expect(big.num).toBe(9007199254740993n)
    expect(big.den).toBe(2n)
  })

  it('rejects ratios that pay nothing or less', () => {
    expect(() => parseRatio('0:1')).toThrow(/must be greater than zero/)
    expect(() => parseRatio('0 to 5')).toThrow(/must be greater than zero/)
    expect(() => parseRatio('1 for 1')).toThrow(/returns no more than the stake/)
    expect(() => parseRatio('1 for 2')).toThrow(/returns no more than the stake/)
  })

  it('rejects a zero second number', () => {
    expect(() => parseRatio('7:0')).toThrow(/second number must be greater than zero/)
    expect(() => parseRatio('5 for 0')).toThrow(/second number must be greater than zero/)
  })

  it('rejects negative numbers', () => {
    for (const text of ['-3:2', '3:-2', '-30 for 1', '−7:6']) {
      expect(() => parseRatio(text)).toThrow(/cannot be negative/)
    }
  })

  it('rejects decimals, pointing at the whole-number form', () => {
    expect(() => parseRatio('1.5:1')).toThrow(/use whole numbers/)
    expect(() => parseRatio('9 to 2.5')).toThrow(/use whole numbers/)
  })

  it('rejects anything else, saying what it expected', () => {
    const shapes = ['', '   ', '7', '7:', ':6', '7:6:5', '7/6', '9to5', '7 or 6', '7 to 6 for 1']
    const words = ['x for 1', '30 for', 'to 1', 'seven to six', '1e3:1']
    for (const text of [...shapes, ...words]) {
      expect(() => parseRatio(text), text).toThrow(/expected "a:b", "a to b" or "a for b"/)
    }
  })

  it('throws RangeError, quoting the input', () => {
    expect(() => parseRatio('abc')).toThrow(RangeError)
    expect(() => parseRatio('abc')).toThrow('Invalid ratio "abc"')
  })
})
