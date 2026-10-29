/**
 * A fresh session seed from the platform CSPRNG, as 16 hex digits. It lives in the ui shell
 * because core code may not touch `crypto`: the engine only ever sees this string, through
 * `seedRng`, so any session can be replayed from its seed.
 */
export function newSessionSeed(): string {
  const words = crypto.getRandomValues(new Uint32Array(2))
  return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')
}
