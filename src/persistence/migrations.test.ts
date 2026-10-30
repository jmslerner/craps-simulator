import { describe, expect, it } from 'vitest'
import { SESSION_LOG_VERSION, newTable } from '../engine/index.ts'
import { CRAPLESS } from '../ui/test/game.ts'
import {
  MACHINE_CONFIG_HISTORY,
  SESSION_LOG_HISTORY,
  TABLE_STATE_HISTORY,
  TABLE_STATE_VERSION,
  describeMigrationError,
  migrate,
  migrateHead,
  type ShapeHistory,
} from './migrations.ts'

/**
 * The migration mechanism (plan §8, M12). No stored shape has changed since version 1, so the
 * real histories have no steps; the mechanism is proven on a synthetic history with two, and the
 * real ones on today's shapes (the replay fixture's own test is tests/replay/migration.test.ts).
 */

/** A made-up shape at version 3: v1 named the bankroll `credit`, v2 had no `currency`. */
const SYNTHETIC: ShapeHistory = {
  shape: 'test record',
  current: 3,
  versionKey: 'version',
  steps: [
    {
      from: 2,
      change: 'adds currency',
      migrate: (data) => ({ ...data, currency: 'USD' }),
    },
    {
      from: 1,
      change: 'renames credit to bankroll',
      migrate: ({ credit, ...rest }) => ({ ...rest, bankroll: credit }),
    },
  ],
}

describe('migrate', () => {
  it('runs every step in order from the data’s version, without touching the input', () => {
    const v1 = Object.freeze({ version: 1, credit: 500 })
    const result = migrate(v1, SYNTHETIC)
    expect(result).toEqual({
      ok: true,
      data: { version: 3, bankroll: 500, currency: 'USD' },
      from: 1,
      to: 3,
      applied: ['renames credit to bankroll', 'adds currency'],
    })
    expect(v1).toEqual({ version: 1, credit: 500 })
    expect(migrate({ version: 2, bankroll: 5 }, SYNTHETIC)).toMatchObject({
      ok: true,
      data: { version: 3, bankroll: 5, currency: 'USD' },
      applied: ['adds currency'],
    })
  })

  it('passes current data through as it is', () => {
    const current = { version: 3, bankroll: 1, currency: 'USD' }
    const result = migrate(current, SYNTHETIC)
    expect(result.ok && result.data).toBe(current)
    expect(result.ok && result.applied).toEqual([])
  })

  it('refuses a newer version, a missing one, a gap in the history and a failing step', () => {
    expect(migrate({ version: 4 }, SYNTHETIC)).toEqual({
      ok: false,
      error: { kind: 'newer', shape: 'test record', version: 4, current: 3 },
    })
    for (const junk of [{}, { version: '1' }, { version: 0 }, { version: 1.5 }]) {
      expect(migrate(junk, SYNTHETIC)).toEqual({
        ok: false,
        error: { kind: 'noVersion', shape: 'test record' },
      })
    }
    expect(migrate([1], SYNTHETIC)).toEqual({
      ok: false,
      error: { kind: 'notObject', shape: 'test record' },
    })
    const gappy: ShapeHistory = { ...SYNTHETIC, steps: SYNTHETIC.steps.slice(0, 1) }
    expect(migrate({ version: 1, credit: 1 }, gappy)).toEqual({
      ok: false,
      error: { kind: 'gap', shape: 'test record', version: 1 },
    })
    const failing: ShapeHistory = {
      ...SYNTHETIC,
      steps: [
        ...SYNTHETIC.steps.slice(0, 1),
        {
          from: 1,
          change: 'throws',
          migrate: () => {
            throw new Error('no credit')
          },
        },
      ],
    }
    expect(migrate({ version: 1 }, failing)).toEqual({
      ok: false,
      error: { kind: 'failed', shape: 'test record', version: 1, message: 'no credit' },
    })
  })

  it('words every error for the player', () => {
    expect(
      describeMigrationError({ kind: 'newer', shape: 'session log', version: 2, current: 1 }),
    ).toBe(
      'This session log is version 2, made by a newer trainer (this one reads up to version 1).',
    )
    expect(describeMigrationError({ kind: 'noVersion', shape: 'machine file' })).toContain(
      'has no version',
    )
  })
})

describe('the real histories (no shape has changed since version 1)', () => {
  it('are at version 1 with no steps', () => {
    for (const history of [SESSION_LOG_HISTORY, TABLE_STATE_HISTORY, MACHINE_CONFIG_HISTORY]) {
      expect(history.current, history.shape).toBe(1)
      expect(history.steps, history.shape).toEqual([])
    }
    expect(SESSION_LOG_HISTORY.current).toBe(SESSION_LOG_VERSION)
  })

  it('tracks the table’s own shape version: TableState.v', () => {
    const table = newTable(CRAPLESS, 'migration')
    expect(table.v).toBe(TABLE_STATE_VERSION)
    const result = migrate(table, TABLE_STATE_HISTORY)
    expect(result.ok && result.data).toBe(table)
  })

  it('migrates a stored head’s two tables, refusing a newer one', () => {
    const table = newTable(CRAPLESS, 'head')
    const head = { id: 'h', windowStart: table, state: table }
    expect(migrateHead(head)).toEqual({ ok: true, head, applied: [] })
    const newer = { ...head, state: { ...table, v: 2 } }
    expect(migrateHead(newer)).toEqual({
      ok: false,
      error: { kind: 'newer', shape: 'stored table', version: 2, current: 1 },
    })
    // Junk passes on untouched, for the head's own schema to refuse.
    expect(migrateHead('junk')).toEqual({ ok: true, head: 'junk', applied: [] })
    // With a history that has a step, both tables are migrated and the steps recorded.
    const tables: ShapeHistory = {
      shape: 'stored table',
      current: 2,
      versionKey: 'v',
      steps: [{ from: 1, change: 'adds tag', migrate: (data) => ({ ...data, tag: 'x' }) }],
    }
    const stepped = migrateHead(head, tables)
    expect(stepped.ok && stepped.applied).toEqual(['windowStart: adds tag', 'state: adds tag'])
    expect(stepped.ok && stepped.head).toMatchObject({ state: { v: 2, tag: 'x' } })
  })
})
