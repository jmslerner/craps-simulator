import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  Fraction,
  PRESETS,
  cents,
  compileConfig,
  dispatchBetting,
  makeRoll,
  newSession,
  rollWindow,
  type Action,
  type MachineConfig,
  type WindowedSession,
} from '../../engine/index.ts'
import { formatPart } from '../format.ts'
import { coachMoney, sourceOf } from '../numbers.ts'
import type { CoachLine } from '../types.ts'
import { formatSignedMoney, trendOf } from './format.ts'
import { createSessionSummarizer, summarizeLog } from './index.ts'
import { mayHaveTwin, sameEventSwitch } from './leaks.ts'
import { groupOf, typeLabel } from './summary.ts'

/**
 * The session summary's coach layer (plan §5.7, §10 M13): its words, its numbers' sources and
 * provenance, the leak finder, and signed money. The account itself is tested in
 * src/exact/summary.test.ts, the identity over random sessions in
 * tests/properties/sessionSummary.prop.test.ts and the golden fixture in
 * tests/golden/sessionSummary.test.ts.
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)
const text = (line: CoachLine): string => line.parts.map((part) => formatPart(part)).join('')

function play(cfg: MachineConfig, steps: readonly (Action | [number, number])[]): WindowedSession {
  let session = newSession(cfg, 'coach-summary')
  for (const step of steps) {
    if (Array.isArray(step)) {
      const rolled = rollWindow(session, cfg, makeRoll(step[0], step[1]))
      if (!rolled.ok) throw new Error(`roll refused: ${rolled.rejection.code}`)
      session = rolled.session
    } else {
      const result = dispatchBetting(session, step, cfg)
      if (!result.ok) throw new Error(`refused: ${result.rejection.code}`)
      session = result.session
    }
  }
  return session
}

describe('the session summary words', () => {
  it('carry no typed-in number: no digit in any string literal, no %, $ amount or ratio', () => {
    // The content lint's strict rules (tests/content-lint.test.ts) for coach/content, applied here.
    const source = readFileSync(new URL('./content.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const literals = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0])
    expect(literals.length).toBeGreaterThan(20)
    for (const literal of literals) expect(literal, literal).not.toMatch(/[0-9０-９]/)
    expect(source).not.toMatch(/\d\s*%|\$\s*\d|\d+\s*(?::|to|for)\s*\d+|[％＄﹩]/)
  })

  it('reads a fresh session plainly: nothing bet, no leaks, nothing to switch', () => {
    const session = newSession(CRAPLESS, 'fresh')
    const summary = summarizeLog(session.header, [], [], CRAPLESS)
    expect(text(summary.facts)).toBe('Crapless bubble craps · 0 rolls · 0 seven-outs')
    expect(summary.byFamily).toEqual([])
    expect(summary.noBets).not.toBeNull()
    expect(summary.noLeaks).not.toBeNull()
    expect(summary.noFocus).not.toBeNull()
    expect(formatSignedMoney(summary.resultCash)).toBe('$0.00')
    expect(text(summary.depositsNote)).toBe('$500.00 to start')
    expect(text(summary.equityNote)).toBe('no bets are up, so this is the cash result')
  })

  it('traces every number to the account and marks what rests on assumed machine values', () => {
    const session = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
      [2, 2],
      [2, 2],
    ])
    const summary = summarizeLog(session.header, session.committed, session.pending, CRAPLESS)
    for (const n of [summary.expected, summary.luck, summary.resultEquity, summary.deposits]) {
      expect(n.source.fn).toBe('accountSession')
      expect(n.source.configHash).toBe(CRAPLESS.configHash)
    }
    expect(summary.leaks[0]?.cost.source.fn).toBe('sessionLeaks')
    expect(summary.focus[0]?.perHour.source.fn).toBe('perHourAt')
    // Crapless odds pays and the machine's pace are assumed (rules spec §5.2).
    expect(summary.assumedPaths).toContain('/pace/rollsPerHour')
    expect(summary.expected.assumedPaths.length).toBeGreaterThan(0)
  })

  it('builds the same summary window by window as in one pass', () => {
    const session = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      [3, 3],
      { type: 'place', typeId: 'place', number: 8, amount: cents(600) },
      [4, 4],
      [3, 4],
    ])
    const summarizer = createSessionSummarizer(session.header, CRAPLESS)
    for (const record of session.committed) summarizer.addWindow(record)
    expect(summarizer.windows).toBe(3)
    expect(summarizer.lastHash).toBe(session.committed.at(-1)?.hashAfter)
    expect(summarizer.summarize(session.pending)).toEqual(
      summarizeLog(session.header, session.committed, session.pending, CRAPLESS),
    )
  })
})

describe('same-event leaks', () => {
  it('finds the coach’s same-event twin and its saving per decision', () => {
    // Crapless place 4 pays 9:5 and loses 100/3¢ a $5 decision; buy 4 loses only its 25¢ vig.
    const twin = sameEventSwitch(
      { typeId: 'place', number: 4 },
      cents(500),
      'numberVsSeven',
      CRAPLESS,
    )
    expect(twin?.to).toEqual({ typeId: 'buy', number: 4 })
    expect(twin?.perDecision.equals(Fraction.of(25, 3))).toBe(true)
    // Buy 5 with up-front vig collected again costs more than place 5 at 7:5 (plan §5.4's flip).
    const buy5 = sameEventSwitch(
      { typeId: 'buy', number: 5 },
      cents(500),
      'numberVsSeven',
      CRAPLESS,
    )
    expect(buy5?.to).toEqual({ typeId: 'place', number: 5 })
    // Place 6 at 7:6 is already the cheapest bet on the 6; line bets and odds have no twin.
    expect(
      sameEventSwitch({ typeId: 'place', number: 6 }, cents(600), 'numberVsSeven', CRAPLESS),
    ).toBeNull()
    expect(
      sameEventSwitch({ typeId: 'pass', number: null }, cents(500), 'line', CRAPLESS),
    ).toBeNull()
    expect(mayHaveTwin('odds')).toBe(false)
    expect(mayHaveTwin('composite')).toBe(true)
  })

  it('groups a leak by the pair of bets and names the numbers, costliest first', () => {
    const session = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
      { type: 'place', typeId: 'place', number: 10, amount: cents(500) },
      [2, 3],
      [2, 2],
      [4, 6],
      [3, 4],
    ])
    const summary = summarizeLog(session.header, session.committed, session.pending, CRAPLESS)
    expect(summary.leaks.map((leak) => leak.line.id)).toEqual(['leak:place>buy'])
    // The 4 won once, the 10 won once, and the seven-out took both: four decisions.
    expect(text(summary.leaks[0]?.line ?? { id: '', parts: [] })).toBe(
      'Place 4/10 instead of Buy: ≈ -$0.33 over 4 decisions',
    )
    expect(summary.focus).toHaveLength(1)
    // 100/3¢ over 4 rolls is 25/3¢ a roll: exactly $10 an hour at the machine's 120 rolls.
    expect(text(summary.focus[0]?.line ?? { id: '', parts: [] })).toBe(
      'Switch Place 4/10 to Buy: saves $10.00/hr at this machine’s 120 rolls an hour ' +
        '($5.00/hr at 60, $12.50/hr at 150).',
    )
  })
})

describe('summary helpers', () => {
  it('signs money: a gain with +, a loss with -, even plainly', () => {
    const source = sourceOf('test', {}, CRAPLESS)
    expect(formatSignedMoney(coachMoney(cents(7000), source))).toBe('+$70.00')
    expect(formatSignedMoney(coachMoney(Fraction.of(2000, 3), source))).toBe('≈ +$6.67')
    expect(formatSignedMoney(coachMoney(Fraction.of(-2000, 3), source))).toBe('≈ -$6.67')
    expect(formatSignedMoney(coachMoney(cents(0), source))).toBe('$0.00')
    expect(trendOf(coachMoney(cents(-1), source))).toBe('down')
    expect(trendOf(coachMoney(cents(0), source))).toBe('even')
  })

  it('groups the families for display and names every kind of bet', () => {
    expect(groupOf('composite')).toBe('oneRoll')
    expect(groupOf('handLength')).toBe('side')
    expect(groupOf('numberVsSeven')).toBe('number')
    expect(typeLabel(CRAPLESS, 'luckyRollerAll')).toBe("Roll 'Em All")
    expect(typeLabel(CRAPLESS, 'horn')).toBe('Horn')
  })
})
