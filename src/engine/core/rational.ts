/**
 * Exact rational arithmetic on BigInt.
 *
 * The coach's house edges and win probabilities are computed with this so they
 * match the textbook values exactly instead of drifting through floating point.
 * Values are always normalized: the denominator is positive and gcd(num, den) = 1.
 */
export class Fraction {
  readonly num: bigint
  readonly den: bigint

  private constructor(num: bigint, den: bigint) {
    this.num = num
    this.den = den
  }

  static of(num: bigint | number, den: bigint | number = 1n): Fraction {
    const n = toBigInt(num)
    const d = toBigInt(den)
    if (d === 0n) throw new RangeError('Fraction denominator cannot be zero')
    const sign = d < 0n ? -1n : 1n
    const divisor = gcd(abs(n), abs(d))
    return new Fraction((sign * n) / divisor, (sign * d) / divisor)
  }

  static readonly ZERO = new Fraction(0n, 1n)
  static readonly ONE = new Fraction(1n, 1n)

  static sum(values: Iterable<Fraction>): Fraction {
    let total = Fraction.ZERO
    for (const value of values) total = total.add(value)
    return total
  }

  add(other: Fraction): Fraction {
    return Fraction.of(this.num * other.den + other.num * this.den, this.den * other.den)
  }

  sub(other: Fraction): Fraction {
    return Fraction.of(this.num * other.den - other.num * this.den, this.den * other.den)
  }

  mul(other: Fraction): Fraction {
    return Fraction.of(this.num * other.num, this.den * other.den)
  }

  div(other: Fraction): Fraction {
    if (other.num === 0n) throw new RangeError('Division by zero')
    return Fraction.of(this.num * other.den, this.den * other.num)
  }

  neg(): Fraction {
    return new Fraction(-this.num, this.den)
  }

  compare(other: Fraction): -1 | 0 | 1 {
    const diff = this.num * other.den - other.num * this.den
    return diff < 0n ? -1 : diff > 0n ? 1 : 0
  }

  equals(other: Fraction): boolean {
    return this.num === other.num && this.den === other.den
  }

  isZero(): boolean {
    return this.num === 0n
  }

  isNegative(): boolean {
    return this.num < 0n
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den)
  }

  toString(): string {
    return this.den === 1n ? `${this.num}` : `${this.num}/${this.den}`
  }
}

function toBigInt(value: bigint | number): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Fraction parts must be safe integers, got ${value}`)
  }
  return BigInt(value)
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a === 0n ? 1n : a
}
