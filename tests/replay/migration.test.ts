import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hashJson } from '../../src/engine/core/hash.ts'
import { ENGINE_VERSION } from '../../src/engine/version.ts'
import { SESSION_LOG_VERSION, parseSessionLog } from '../../src/engine/session/serialize.ts'
import {
  describeImportError,
  importFileText,
  sessionFileText,
} from '../../src/persistence/exchange.ts'
import {
  SESSION_LOG_HISTORY,
  TABLE_STATE_VERSION,
  migrate,
  migrateHead,
} from '../../src/persistence/migrations.ts'

/**
 * The migration fixture (plan §8, §10 M12; the M11 → M12 hand-off): the pinned crapless-200 log
 * (format 1, engine 4, tables v1) must still import to the table it recorded, through the same
 * migrate → parse → replay path a player's file takes. No stored shape has changed since version
 * 1, so its migration is a no-op; when a shape does change, the step that migrates it joins
 * `src/persistence/migrations.ts` and this fixture, unchanged, must still import to this hash.
 */

const FIXTURE = new URL('./fixtures/crapless-200.json', import.meta.url)
/** The fixture's final table hash, as `tests/replay/replay.test.ts` pins it. */
const RECORDED_HASH = '8f1aa84f7baeca3a'

const text = () => readFileSync(FIXTURE, 'utf8')

describe('the crapless-200 migration fixture', () => {
  it('is at the current shape versions: format 1, tables v1', () => {
    const data = JSON.parse(text()) as { version: number; header: { engineVersion: number } }
    expect(data.version).toBe(SESSION_LOG_VERSION)
    expect(data.version).toBe(1)
    expect(data.header.engineVersion).toBe(ENGINE_VERSION)
  })

  it('migrates with no step and parses to the same log', () => {
    const data: unknown = JSON.parse(text())
    const migrated = migrate(data, SESSION_LOG_HISTORY)
    expect(migrated.ok && migrated.applied).toEqual([])
    expect(migrated.ok && migrated.data).toBe(data)
    const parsed = parseSessionLog(JSON.stringify(migrated.ok ? migrated.data : null))
    expect(parsed.ok && parsed.log.finalStateHash).toBe(RECORDED_HASH)
  })

  it('imports through the player’s path to its recorded hash, and exports back to the same log', () => {
    const result = importFileText(text())
    if (!result.ok) throw new Error(describeImportError(result.error))
    const { file } = result
    if (file.kind !== 'session') throw new Error(`read as ${file.kind}`)
    expect(hashJson(file.session.state)).toBe(RECORDED_HASH)
    expect(file.rolls).toBe(200)
    expect(file.notice).toBeNull()
    expect(JSON.parse(sessionFileText(file.session))).toEqual(JSON.parse(text()))
  })

  it('stores tables the head migration passes through unchanged', () => {
    const result = importFileText(text())
    if (!result.ok || result.file.kind !== 'session') throw new Error('the fixture did not import')
    const { session } = result.file
    expect(session.state.v).toBe(TABLE_STATE_VERSION)
    const head = { id: 'fixture', windowStart: session.windowStart, state: session.state }
    expect(migrateHead(head)).toEqual({ ok: true, head, applied: [] })
  })
})
