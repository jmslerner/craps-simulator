import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, PRESETS, cents, hashJson, serializeSession } from '../engine/index.ts'
import type { MachineConfigInput, WindowedSession } from '../engine/index.ts'
import { MAX_BATCH_DEPTH } from '../engine/session/window.ts'
import { bet, placePass, placeSix, playRolls, roll, testSession } from '../ui/test/game.ts'
import {
  describeImportError,
  exportFileName,
  importFileText,
  machineFileText,
  sessionFileText,
  settingsFileText,
} from './exchange.ts'
import { DEFAULT_SETTINGS } from './settings.ts'

/**
 * Export and import (plan §8, §10 M12): a game, a machine or the settings out to a file and back.
 * The acceptance: export, clear, import gives the same hash; a corrupt file is refused as a
 * result, never a throw.
 */

/** A game with committed rolls, a deposit and an open window. */
function played(seed: string): WindowedSession {
  let session = playRolls(placePass(testSession(seed)), 12)
  session = bet(session, { type: 'deposit', amount: cents(10_000) })
  return placeSix(session)
}

function imported(text: string) {
  const result = importFileText(text)
  if (!result.ok) throw new Error(describeImportError(result.error))
  return result.file
}

describe('a game file', () => {
  it('exports and imports to the very same session: export, clear, import gives the same hash', () => {
    const session = played('exchange-round-trip')
    const text = sessionFileText(session)
    const file = imported(text)
    if (file.kind !== 'session') throw new Error(`read as ${file.kind}`)
    expect(hashJson(file.session.state)).toBe(hashJson(session.state))
    expect(file.session.committed).toStrictEqual(session.committed)
    expect(file.session.pending).toStrictEqual(session.pending)
    expect(file.session.header).toStrictEqual(session.header)
    expect(file.cfg.configHash).toBe(session.header.configHash)
    expect(file.rolls).toBe(12)
    expect(file.notice).toBeNull()
    // And it writes back to the same text.
    expect(sessionFileText(file.session)).toBe(text)
  })

  it('refuses a file whose table hash was edited, as a result', () => {
    const session = roll(placePass(testSession('exchange-tamper')), [1, 1]).session
    const log = JSON.parse(serializeSession(session)) as Record<string, unknown>
    const forged = { ...log, finalStateHash: '0123456789abcdef' }
    const result = importFileText(JSON.stringify(forged))
    expect(result.ok === false && result.error.kind).toBe('replay')
    expect(result.ok === false && describeImportError(result.error)).toContain('does not replay')
  })

  it('refuses a changed stake: the replay no longer reaches the recorded hashes', () => {
    const session = roll(placePass(testSession('exchange-stake')), [3, 4]).session
    const text = serializeSession(session).replace('"amount":500', '"amount":600')
    const result = importFileText(text)
    expect(result.ok).toBe(false)
  })

  it('checks a game from another engine version and carries it on when it plays the same', () => {
    const session = roll(placePass(testSession('exchange-version')), [1, 1]).session
    const log = JSON.parse(serializeSession(session)) as { header: { engineVersion: number } }
    log.header.engineVersion = ENGINE_VERSION - 1
    const file = imported(JSON.stringify(log))
    if (file.kind !== 'session') throw new Error(`read as ${file.kind}`)
    expect(file.notice).toEqual({
      kind: 'engineVersion',
      from: ENGINE_VERSION - 1,
      to: ENGINE_VERSION,
    })
    expect(file.session.header.engineVersion).toBe(ENGINE_VERSION)
    expect(hashJson(file.session.state)).toBe(hashJson(session.state))
  })

  it('refuses a batch nested past MAX_BATCH_DEPTH before replaying it', () => {
    const session = placePass(testSession('exchange-deep'))
    let action: unknown = { type: 'deposit', amount: 100 }
    for (let depth = 0; depth <= MAX_BATCH_DEPTH; depth++)
      action = { type: 'batch', actions: [action] }
    const log = JSON.parse(serializeSession(session)) as { pending: unknown[] }
    log.pending = [action]
    const result = importFileText(JSON.stringify(log))
    expect(result).toEqual({
      ok: false,
      error: { kind: 'batchDepth', where: 'pending[0]', max: MAX_BATCH_DEPTH },
    })
  })

  it('refuses a newer log version rather than misreading it', () => {
    const log = JSON.parse(serializeSession(testSession('exchange-newer'))) as Record<
      string,
      unknown
    >
    const result = importFileText(JSON.stringify({ ...log, version: 2 }))
    expect(result.ok === false && result.error.kind).toBe('migration')
    expect(result.ok === false && describeImportError(result.error)).toContain('newer trainer')
  })
})

describe('corrupt files are refused as results, never thrown', () => {
  const cases: readonly [string, string, string][] = [
    ['empty', '', 'empty'],
    ['not JSON', '{"format": "bubble-craps-session",', 'json'],
    ['an array', '[1, 2]', 'notObject'],
    ['no format', '{"version": 1}', 'unknownFormat'],
    ['another format', '{"format": "spreadsheet"}', 'unknownFormat'],
    ['a prototype key', '{"format":"bubble-craps-session","__proto__":{"x":1}}', 'key'],
    [
      'deep nesting',
      `{"format":"bubble-craps-session","x":${'['.repeat(5_000)}${']'.repeat(5_000)}}`,
      'depth',
    ],
    ['a game with no windows', '{"format":"bubble-craps-session","version":1}', 'shape'],
    [
      'a machine file with junk',
      '{"format":"bubble-craps-machine","version":1,"machines":[{"schemaVersion":1}]}',
      'config',
    ],
    [
      'a machine file with none',
      '{"format":"bubble-craps-machine","version":1,"machines":[]}',
      'shape',
    ],
    [
      'settings that are not an object',
      '{"format":"bubble-craps-settings","version":1,"settings":7}',
      'shape',
    ],
  ]
  it.each(cases)('%s', (_name, text, kind) => {
    const result = importFileText(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe(kind)
    expect(describeImportError(result.error).length).toBeGreaterThan(10)
  })
})

describe('a machine file', () => {
  it('round-trips machines, each validated in full', () => {
    const machines: MachineConfigInput[] = [PRESETS.craplessBubble, PRESETS.traditionalLive345]
    const file = imported(machineFileText(machines))
    expect(file.kind === 'machines' && file.machines).toEqual(machines)
  })

  it('names the machine and the field a config fails at', () => {
    const broken = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
    const place = broken.catalog['place']
    if (place?.family !== 'numberVsSeven') throw new Error('no place')
    place.pays = { ...place.pays, '6': 'seven to six' }
    const result = importFileText(machineFileText([PRESETS.craplessBubble, broken]))
    expect(result.ok === false && result.error.kind).toBe('config')
    const words = result.ok ? '' : describeImportError(result.error)
    expect(words).toContain('Machine 2 is not a valid machine')
    expect(words).toContain('/catalog/place/pays/6')
  })
})

describe('a settings file', () => {
  it('carries every setting, the 3D quality pin included', () => {
    const settings = { ...DEFAULT_SETTINGS, diceMode: '2d' as const, domeQuality: 'low' as const }
    const file = imported(settingsFileText(settings))
    expect(file.kind === 'settings' && file.settings).toStrictEqual(settings)
  })

  it('reads junk fields as their defaults, as a load does', () => {
    const text = JSON.stringify({
      format: 'bubble-craps-settings',
      version: 1,
      settings: { diceMode: 'hologram', domeQuality: 'medium', coachMode: 7 },
    })
    const file = imported(text)
    expect(file.kind === 'settings' && file.settings).toMatchObject({
      diceMode: DEFAULT_SETTINGS.diceMode,
      domeQuality: 'medium',
      coachMode: DEFAULT_SETTINGS.coachMode,
    })
  })
})

describe('file names', () => {
  it('are safe on every system', () => {
    expect(exportFileName('session', 'a1b2c3d4')).toBe('bubble-craps-session-a1b2c3d4.json')
    expect(exportFileName('machine', 'My Machine / Red Rock!')).toBe(
      'bubble-craps-machine-My-Machine-Red-Rock.json',
    )
    expect(exportFileName('settings')).toBe('bubble-craps-settings.json')
  })
})
