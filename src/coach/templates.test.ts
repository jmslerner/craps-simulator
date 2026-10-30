import { describe, expect, it } from 'vitest'
import { Fraction } from '../engine/core/rational.ts'
import { cents } from '../engine/core/money.ts'
import { formatPart } from './format.ts'
import { coachNumber } from './numbers.ts'
import type { CoachNumberKind, CoachSource, TemplateParts } from './types.ts'
import { commissionStep, paysLine, payoutStep, waysStep } from './content/templates.ts'

const SOURCE: CoachSource = { fn: 'test', args: null, configHash: 'cfg' }
const n = (kind: CoachNumberKind, exact: Fraction | ReturnType<typeof cents>) =>
  coachNumber(kind, exact, SOURCE)

function render(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

describe('templates', () => {
  it('interpolate only CoachNumbers: a pays line renders the machine label verbatim', () => {
    const parts = paysLine({ stake: n('money', cents(500)), win: n('money', cents(583)) }, '7:6')
    expect(render(parts)).toBe('$5.00 × 7:6 = $5.83')
    // Every non-string part is a CoachNumber (or a styled one): raw numbers cannot appear.
    for (const part of parts) {
      if (typeof part === 'string') continue
      expect('kind' in part || 'style' in part).toBe(true)
    }
  })

  it('the ways step skips empty groups', () => {
    const count = (value: number) => n('count', Fraction.of(value))
    const all = render(
      waysStep({
        rolls: count(36),
        win: count(5),
        lose: count(6),
        push: count(0),
        travel: count(0),
        none: count(25),
      }),
    )
    expect(all).toBe('Of 36 rolls: 5 win, 6 lose, 25 change nothing.')
    const line = render(
      waysStep({
        rolls: count(36),
        win: count(8),
        lose: count(4),
        push: count(0),
        travel: count(24),
        none: count(0),
      }),
    )
    expect(line).toBe('Of 36 rolls: 8 win, 4 lose, 24 travel.')
  })

  it('the payout step marks the exact product and the paid amount apart', () => {
    const parts = payoutStep(
      {
        stake: n('money', cents(500)),
        exact: n('money', Fraction.of(1750, 3)),
        paid: n('money', cents(583)),
        vigOnWin: n('money', cents(0)),
      },
      '7:6',
    )
    expect(render(parts)).toBe('$5.00 × 7:6 = $5.833… → pays $5.83.')
  })

  it('the commission step names only the charges that exist', () => {
    expect(
      render(commissionStep({ placement: n('money', cents(0)), rearm: n('money', cents(0)) })),
    ).toBe('')
    expect(
      render(commissionStep({ placement: n('money', cents(25)), rearm: n('money', cents(0)) })),
    ).toBe('Commission up front: $0.25. ')
  })
})
