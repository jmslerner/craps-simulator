import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig } from '../config/compile.ts'
import { PRESETS, PRESET_IDS } from '../config/presets/index.ts'
import { hashJson } from '../core/hash.ts'
import { cents } from '../core/money.ts'
import { betId } from '../bets/types.ts'
import type { Action } from '../table/actions.ts'
import { ENGINE_VERSION } from '../version.ts'
import {
  SESSION_LOG_FORMAT,
  SESSION_LOG_VERSION,
  deserializeSession,
  parseSessionLog,
  serializeSession,
  sessionFromLog,
  toSessionLog,
  type LoadResult,
} from './serialize.ts'
import {
  MAX_BATCH_DEPTH,
  dispatchBetting,
  newSession,
  rollWindow,
  type WindowedSession,
} from './window.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

/** A short crapless session with a deposit, scripted and drawn dice, and an open window. */
function session(): WindowedSession {
  let current = newSession(crapless, 'serialize')
  const step = (result: ReturnType<typeof dispatchBetting> | ReturnType<typeof rollWindow>) => {
    if (!result.ok) throw new Error(`refused ${JSON.stringify(result.rejection)}`)
    current = result.session
  }
  step(dispatchBetting(current, { type: 'deposit', amount: cents(5_000) }, crapless))
  step(dispatchBetting(current, { type: 'place', typeId: 'pass', amount: cents(1_000) }, crapless))
  step(rollWindow(current, crapless, { d1: 5, d2: 5 }))
  step(
    dispatchBetting(
      current,
      { type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(2_000) },
      crapless,
    ),
  )
  step(rollWindow(current, crapless))
  step(dispatchBetting(current, { type: 'place', typeId: 'field', amount: cents(300) }, crapless))
  return current
}

function loaded(result: LoadResult): WindowedSession {
  if (!result.ok) throw new Error(`does not load: ${JSON.stringify(result.error)}`)
  return result.session
}

/** The session's log as plain data, to edit. */
function logData(of: WindowedSession): Record<string, unknown> {
  return JSON.parse(serializeSession(of)) as Record<string, unknown>
}

describe('the session log', () => {
  it('round-trips exactly: JSON back to an equal session, which writes the same JSON', () => {
    const original = session()
    const text = serializeSession(original)
    const back = loaded(deserializeSession(text))
    expect(back).toStrictEqual(original)
    expect(serializeSession(back)).toBe(text)
    // Indented JSON reads back the same.
    expect(loaded(deserializeSession(serializeSession(original, 2)))).toStrictEqual(original)
  })

  it('round-trips a new session on every preset', () => {
    for (const id of PRESET_IDS) {
      const fresh = newSession(compileConfig(PRESETS[id]), `fresh ${id}`)
      const text = serializeSession(fresh)
      expect(loaded(deserializeSession(text)), id).toStrictEqual(fresh)
    }
  })

  it('writes its format and version, header, windows, open window and final hash', () => {
    const original = session()
    const log = toSessionLog(original)
    expect(Object.keys(log)).toEqual([
      'format',
      'version',
      'header',
      'windows',
      'pending',
      'finalStateHash',
    ])
    expect(log).toMatchObject({
      format: SESSION_LOG_FORMAT,
      version: SESSION_LOG_VERSION,
      header: { engineVersion: ENGINE_VERSION, configHash: crapless.configHash, seed: 'serialize' },
      finalStateHash: hashJson(original.state),
    })
    expect(log.windows).toBe(original.committed)
    expect(log.pending).toBe(original.pending)
    expect(log.windows.map((w) => w.roll)).toStrictEqual([
      { type: 'roll', dice: { d1: 5, d2: 5 } },
      { type: 'roll' },
    ])
  })

  it('refuses text that is not JSON', () => {
    const result = deserializeSession('{"format": ')
    expect(result.ok ? null : result.error.kind).toBe('json')
  })

  it('refuses another format or version, unknown keys and malformed parts, with paths', () => {
    const data = logData(session())
    const issues = (edit: (log: Record<string, unknown>) => void): readonly string[] => {
      const copy = structuredClone(data)
      edit(copy)
      const result = parseSessionLog(JSON.stringify(copy))
      return result.ok || result.error.kind !== 'format' ? [] : result.error.issues
    }
    expect(issues((log) => (log.format = 'something else'))[0]).toMatch(/^format: /)
    expect(issues((log) => (log.version = 2))[0]).toMatch(/^version: /)
    expect(issues((log) => (log.extra = true))[0]).toMatch(/^\/: Unrecognized key/)
    expect(issues((log) => (log.finalStateHash = 'ABC'))[0]).toMatch(/^finalStateHash: /)
    expect(
      issues((log) => {
        const header = log.header as Record<string, unknown>
        header.engineVersion = 0
      })[0],
    ).toMatch(/^header\.engineVersion: /)
    expect(
      issues((log) => {
        const windows = log.windows as Record<string, unknown>[]
        const first = windows[0]
        if (first !== undefined) first.roll = { type: 'roll', dice: { d1: 7, d2: 1 } }
      })[0],
    ).toMatch(/^windows\.0\.roll\.dice\.d1: /)
    expect(issues((log) => (log.pending = [3]))[0]).toMatch(/^pending\.0: must be an action object/)
    expect(issues((log) => (log.header = null))[0]).toMatch(/^header: /)
  })

  it('loads a log whose config has a junk pay ratio as a config error, never a throw', () => {
    const data = logData(session())
    const header = data.header as {
      config: { catalog: Record<string, { pays?: Record<string, string> }> }
    }
    const c = header.config.catalog.c
    if (c?.pays === undefined) throw new Error('no c bet in the header config')
    c.pays['2'] = '1:0'
    const result = deserializeSession(JSON.stringify(data))
    expect(result.ok ? null : result.error).toMatchObject({
      kind: 'replay',
      failure: { kind: 'config' },
    })
  })

  it('refuses a log that does not replay, saying where', () => {
    const data = logData(session())
    const edited = structuredClone(data)
    edited.finalStateHash = '0000000000000000'
    const result = deserializeSession(JSON.stringify(edited))
    expect(result.ok ? null : result.error).toEqual({
      kind: 'replay',
      failure: {
        kind: 'hash',
        window: 2,
        logged: '0000000000000000',
        replayed: data.finalStateHash,
      },
    })
    const tampered = structuredClone(data)
    const windows = tampered.windows as { hashAfter: string }[]
    const first = windows[0]
    if (first !== undefined) first.hashAfter = 'ffffffffffffffff'
    const failure = deserializeSession(JSON.stringify(tampered))
    expect(failure.ok ? null : failure.error).toMatchObject({
      kind: 'replay',
      failure: { kind: 'hash', window: 0 },
    })
  })

  it('refuses a log nested too deep to write back, as an error, never a throw (M5/M6 audit)', () => {
    const base = session()
    const nest = (depth: number): Action => {
      let action: Action = { type: 'deposit', amount: cents(100) }
      for (let i = 0; i < depth; i++) action = { type: 'batch', actions: [action] }
      return action
    }
    const open = base.committed.length
    const malformed = {
      kind: 'replay',
      failure: {
        kind: 'malformed',
        where: `windows[${open}].actions[0]`,
        reason: `a batch nested deeper than ${MAX_BATCH_DEPTH}, which no log can hold`,
      },
    }
    // One past the cap, through the JSON text.
    const data = logData(base)
    data.pending = [nest(MAX_BATCH_DEPTH + 1)]
    const result = deserializeSession(JSON.stringify(data))
    expect(result.ok ? null : result.error).toEqual(malformed)
    // The audit's depth, as a crafted in-memory log: serializeSession could never write this, and
    // loading it answers with the same failure instead of overflowing any call stack later.
    const monster = { ...toSessionLog(base), pending: [nest(20_000)] }
    const deep = sessionFromLog(monster)
    expect(deep.ok ? null : deep.error).toEqual(malformed)
  })

  it('loads a log from another engine version only to check it, and then as this version’s', () => {
    const original = session()
    const data = logData(original)
    const header = data.header as Record<string, unknown>
    header.engineVersion = ENGINE_VERSION + 1
    const text = JSON.stringify(data)
    const refused = deserializeSession(text)
    expect(refused.ok ? null : refused.error).toEqual({
      kind: 'replay',
      failure: { kind: 'engineVersion', logged: ENGINE_VERSION + 1, current: ENGINE_VERSION },
    })
    const checked = loaded(deserializeSession(text, { anyEngineVersion: true }))
    expect(checked).toStrictEqual(original)
  })

  it('reads the log apart from replaying it', () => {
    const original = session()
    const parsed = parseSessionLog(serializeSession(original))
    if (!parsed.ok) throw new Error('does not parse')
    expect(parsed.log.windows).toHaveLength(2)
    expect(loaded(sessionFromLog(parsed.log))).toStrictEqual(original)
  })

  it('refuses junk in an imported log as an error, never a throw', () => {
    const data = logData(session())
    const junk = fc.oneof(
      fc.jsonValue(),
      fc.record({
        type: fc.constantFrom('place', 'setAmount', 'setWorking', 'setGlobalWorking', 'deposit'),
        typeId: fc.constantFrom('pass', 'passOdds', 'place', 'field', 'horn', '__proto__'),
        number: fc.jsonValue(),
        parentId: fc.jsonValue(),
        betId: fc.jsonValue(),
        amount: fc.oneof(fc.integer(), fc.double(), fc.jsonValue()),
        working: fc.jsonValue(),
        off: fc.jsonValue(),
      }),
    )
    let refused = 0
    fc.assert(
      fc.property(fc.array(junk, { minLength: 1, maxLength: 4 }), fc.boolean(), (actions, nest) => {
        const copy = structuredClone(data)
        copy.pending = nest ? [{ type: 'batch', actions }] : actions
        const result = deserializeSession(JSON.stringify(copy))
        if (!result.ok) refused++
      }),
      { seed: 20261028, numRuns: 300 },
    )
    expect(refused).toBeGreaterThan(250)
  })
})
