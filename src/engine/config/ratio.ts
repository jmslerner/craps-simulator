import { Fraction } from '../core/rational.ts'

/**
 * A payout or rate as an exact net "to 1" ratio in lowest terms: a win pays `stake × num / den`
 * and the stake comes back on top. `label` keeps the form the machine shows, so "30 for 1" is
 * displayed as written while paying 29:1.
 */
export interface Ratio {
  readonly num: bigint
  readonly den: bigint
  readonly label: string
}

/** Two numbers around ":", "to" or "for"; each side is checked separately for a precise error. */
const SHAPE = /^(\S+?)\s*(:|\bto\b|\bfor\b)\s*(\S+)$/i
const USAGE =
  'expected "a:b", "a to b" or "a for b" in whole numbers, e.g. "7:6", "9 to 5" or "30 for 1"'

/**
 * Parses a pay ratio as machines and rule books write it: "7:6", "9 to 5", or "30 for 1".
 * "a for b" returns `a` for every `b` staked, stake included, so it nets (a − b):b: reading
 * "30 for 1" as 30:1 would overpay every win by one unit.
 */
export function parseRatio(text: string): Ratio {
  const match = SHAPE.exec(text.trim())
  if (match === null) throw new RangeError(`Invalid ratio "${text}": ${USAGE}`)
  const [, left = '', operator = '', right = ''] = match
  const first = parseWhole(left, text)
  const second = parseWhole(right, text)
  if (second === 0n) {
    throw new RangeError(`Invalid ratio "${text}": the second number must be greater than zero`)
  }
  const keyword = operator.toLowerCase()
  const net = keyword === 'for' ? first - second : first
  if (net <= 0n) {
    const reason =
      keyword === 'for'
        ? `"${first} for ${second}" returns no more than the stake, so it pays nothing`
        : 'a ratio must be greater than zero'
    throw new RangeError(`Invalid ratio "${text}": ${reason}`)
  }
  const { num, den } = Fraction.of(net, second)
  const label = keyword === ':' ? `${first}:${second}` : `${first} ${keyword} ${second}`
  return { num, den, label }
}

function parseWhole(part: string, text: string): bigint {
  if (/^\d+$/.test(part)) return BigInt(part)
  if (/^[-−]\d/.test(part)) throw new RangeError(`Invalid ratio "${text}": it cannot be negative`)
  if (/^\d*\.\d+$/.test(part)) {
    throw new RangeError(
      `Invalid ratio "${text}": use whole numbers, e.g. "3:2" rather than "1.5:1"`,
    )
  }
  throw new RangeError(`Invalid ratio "${text}": ${USAGE}`)
}
