import { describe, expect, it } from 'vitest'
import { REJECTION_CODES } from '../../engine/index.ts'
import type { Rejection, RejectionCode } from '../../engine/index.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { isAmountProblem, rejectionText } from './rejectionText.ts'

const cfg = COMPILED_PRESETS.craplessBubble

/** Details shaped like the engine's own call sites (`bets/validate.ts`, `bets/limits.ts`). */
const SAMPLES: Readonly<Record<RejectionCode, Rejection['details']>> = {
  NOT_OFFERED: { typeId: 'lay' },
  BAD_PARAMS: { typeId: 'place', field: 'number' },
  WRONG_PHASE: { typeId: 'pass', phase: 'point', window: 'comeOut' },
  WINDOW_CLOSED: { reason: 'The dice are rolling' },
  BELOW_MIN: { typeId: 'place', amount: 50, min: 100 },
  ABOVE_MAX: { typeId: 'place', held: 0, added: 60_000, max: 50_000 },
  BAD_INCREMENT: { typeId: 'place', amount: 150, increment: 100 },
  TABLE_MAX: { total: 60_000, tableMax: 50_000 },
  INSUFFICIENT_CREDIT: { needed: 600, available: 250 },
  CONTRACT_BET: { typeId: 'pass', betId: 'b1', change: 'remove' },
  NO_PARENT: { typeId: 'passOdds', parent: 'pass', parentId: '' },
  PARENT_NOT_ON_POINT: { typeId: 'passOdds', parentId: 'b1' },
  ODDS_LIMIT: { typeId: 'passOdds', betId: 'b2', amount: 1_500, max: 1_000 },
  EXCLUSIVE_CONFLICT: { typeId: 'buy', conflictsWith: 'place', betId: 'b1', scope: 'sameNumber' },
  BET_NOT_FOUND: { betId: 'b9' },
  NOT_TOGGLEABLE: { typeId: 'pass', betId: 'b1', scope: 'bet' },
  BELOW_MIN_TOTAL: { scope: 'totalRound', min: 500, total: 100, short: 400 },
}

describe('rejectionText', () => {
  it('words every rejection code the engine can raise', () => {
    for (const code of REJECTION_CODES) {
      const line = rejectionText({ code, details: SAMPLES[code] }, cfg)
      expect(line.length, code).toBeGreaterThan(10)
      expect(line, code).not.toContain(code) // player wording, never the raw code
      expect(line, code).not.toContain('undefined')
    }
  })

  it('still words every code when the details are missing', () => {
    for (const code of REJECTION_CODES) {
      const line = rejectionText({ code, details: {} }, cfg)
      expect(line.length, code).toBeGreaterThan(10)
      expect(line, code).not.toContain('undefined')
    }
  })

  it('shows BELOW_MIN_TOTAL as Interblock words it, with the short amount in credits', () => {
    const line = rejectionText({ code: 'BELOW_MIN_TOTAL', details: SAMPLES.BELOW_MIN_TOTAL }, cfg)
    expect(line).toContain('BETS ARE NOT VALID YET!')
    expect(line).toContain('$4.00') // details.short, via formatCents
    expect(line).toContain('(4 credits)') // short ÷ the credit value (M4 → M8 hand-off)
  })

  it('shows a per-bet minimum with the bet that is short', () => {
    const line = rejectionText(
      {
        code: 'BELOW_MIN_TOTAL',
        details: { scope: 'perBet', min: 500, typeId: 'place', amount: 100, short: 400 },
      },
      cfg,
    )
    expect(line).toContain('$5.00')
    expect(line).toContain('Place')
    expect(line).toContain('$4.00')
  })

  it('tells a bet the machine lists but the trainer does not model from one it lacks', () => {
    // Lucky Roller is on the machine (cfg.sideBets) but unmodelled until M11 (plan §0 #23).
    const listed = rejectionText(
      { code: 'NOT_OFFERED', details: { typeId: 'luckyRollerLow' } },
      cfg,
    )
    expect(listed).toContain('Low Rolls')
    expect(listed).toContain('does not model')
    expect(listed).not.toContain('not available on this machine')
    // A lay bet is not in the crapless config at all: that one the machine truly lacks.
    const missing = rejectionText({ code: 'NOT_OFFERED', details: SAMPLES.NOT_OFFERED }, cfg)
    expect(missing).toContain('is not available on this machine')
  })

  it('names the bet with the machine label, not the type id', () => {
    const line = rejectionText({ code: 'CONTRACT_BET', details: SAMPLES.CONTRACT_BET }, cfg)
    expect(line).toContain('Pass Line')
    expect(line).toContain('contract')
    expect(line).not.toContain('pass ')
  })

  it('words the three contract changes separately', () => {
    const at = (change: string) =>
      rejectionText({ code: 'CONTRACT_BET', details: { typeId: 'pass', change } }, cfg)
    expect(at('remove')).toContain('stays up')
    expect(at('decrease')).toContain('reduced')
    expect(at('increase')).toContain('added to')
  })

  it('tells a rolling window from a rebet lock', () => {
    const rolling = rejectionText({ code: 'WINDOW_CLOSED', details: {} }, cfg)
    expect(rolling).toContain('rolling')
    const rebet = rejectionText(
      {
        code: 'WINDOW_CLOSED',
        details: { typeId: 'pass', reason: 'rebetAfterRemove', until: 'nextComeOut' },
      },
      cfg,
    )
    expect(rebet).toContain('come-out')
  })

  it('formats the machine amounts with formatCents', () => {
    expect(rejectionText({ code: 'BELOW_MIN', details: SAMPLES.BELOW_MIN }, cfg)).toContain('$1.00')
    expect(rejectionText({ code: 'ODDS_LIMIT', details: SAMPLES.ODDS_LIMIT }, cfg)).toContain(
      '$10.00',
    )
    expect(
      rejectionText({ code: 'INSUFFICIENT_CREDIT', details: SAMPLES.INSUFFICIENT_CREDIT }, cfg),
    ).toContain('$6.00')
  })

  it('words the ledger ceiling differently from a bet maximum', () => {
    const ledger = rejectionText(
      { code: 'ABOVE_MAX', details: { scope: 'ledger', field: 'amount', max: 1 } },
      cfg,
    )
    expect(ledger).toContain('credit')
    const bet = rejectionText({ code: 'ABOVE_MAX', details: SAMPLES.ABOVE_MAX }, cfg)
    expect(bet).toContain('$500.00')
  })

  it('names the conflicting bet on an exclusive spot', () => {
    const line = rejectionText(
      { code: 'EXCLUSIVE_CONFLICT', details: SAMPLES.EXCLUSIVE_CONFLICT },
      cfg,
    )
    expect(line).toContain('Buy')
    expect(line).toContain('Place')
  })

  it('keeps isAmountProblem to the limit and credit codes', () => {
    expect(isAmountProblem('BELOW_MIN')).toBe(true)
    expect(isAmountProblem('INSUFFICIENT_CREDIT')).toBe(true)
    expect(isAmountProblem('CONTRACT_BET')).toBe(false)
    expect(isAmountProblem('NOT_OFFERED')).toBe(false)
  })
})
