import type { Rng } from '../../engine/core/rng.ts'

/**
 * Unpredictable generator backed by the platform CSPRNG, for normal play.
 * It lives in the ui shell because core code may not touch `crypto`; M1 turns it into
 * `newSessionSeed()`, so the engine only ever sees a seed.
 */
export function createCryptoRng(): Rng {
  const buffer = new Uint32Array(64)
  let index = buffer.length
  return {
    nextUint32() {
      if (index >= buffer.length) {
        globalThis.crypto.getRandomValues(buffer)
        index = 0
      }
      return buffer[index++] ?? 0
    },
  }
}
