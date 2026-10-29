/**
 * A small deterministic 64-bit hash over 32-bit words (cyrb53's mixing, two lanes), for golden
 * recording hashes and params fingerprints. Not cryptographic; it only has to notice changes.
 */
export interface Hasher {
  /** Mixes in one word; only its low 32 bits count. */
  mix(word: number): void
  /** Mixes in every bit of a number, as the two words of its IEEE double, low word first. */
  mixFloat(value: number): void
  /** 16 hex digits for everything mixed so far. */
  digest(): string
}

export function createHasher(): Hasher {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  const bits = new DataView(new ArrayBuffer(8))
  const mix = (word: number) => {
    h1 = Math.imul(h1 ^ word, 2654435761)
    h2 = Math.imul(h2 ^ word, 1597334677)
  }
  return {
    mix,
    mixFloat(value) {
      bits.setFloat64(0, value, true)
      mix(bits.getUint32(0, true))
      mix(bits.getUint32(4, true))
    },
    digest() {
      let a = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
      a ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
      let b = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
      b ^= Math.imul(a ^ (a >>> 13), 3266489909)
      return hex(b) + hex(a)
    },
  }
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}
