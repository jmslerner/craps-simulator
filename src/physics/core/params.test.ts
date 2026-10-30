import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, paramsFingerprint, type PhysicsParams } from './params.ts'

/** A deep copy with its object keys in reverse order, which must not change the fingerprint. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([k, v]) => [k, reversed(v)]),
  )
}

describe('paramsFingerprint', () => {
  const fingerprint = paramsFingerprint(DEFAULT_PARAMS)

  it('is 16 hex digits that depend on the values, not on key order or object identity', () => {
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(paramsFingerprint(structuredClone(DEFAULT_PARAMS))).toBe(fingerprint)
    expect(paramsFingerprint(reversed(DEFAULT_PARAMS) as PhysicsParams)).toBe(fingerprint)
  })

  it('changes with any single value, however deep', () => {
    const changed: PhysicsParams[] = [
      { ...DEFAULT_PARAMS, timestep: 1 / 240 },
      { ...DEFAULT_PARAMS, contact: { ...DEFAULT_PARAMS.contact, frequency: 301 } },
      { ...DEFAULT_PARAMS, die: { ...DEFAULT_PARAMS.die, borderRadius: 0.0800001 } },
      { ...DEFAULT_PARAMS, snap: { ...DEFAULT_PARAMS.snap, minTurnRate: 7 } },
      { ...DEFAULT_PARAMS, hop: { ...DEFAULT_PARAMS.hop, margin: 0.06 } },
    ]
    const prints = changed.map(paramsFingerprint)
    expect(new Set([fingerprint, ...prints]).size).toBe(changed.length + 1)
  })

  it('pins the defaults: re-pin this and the golden recording hash after tuning', () => {
    // M10b added `handoff`; the frames every seed produces are unchanged by it.
    expect(fingerprint).toBe('234fff9278848888')
  })
})
