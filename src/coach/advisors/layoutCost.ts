import { cents, validateAction } from '../../engine/index.ts'
import type { Action } from '../../engine/index.ts'
import { PACE_RANGE, analyzeLayout } from '../../exact/index.ts'
import { coachMoney, coachNumber, sourceOf } from '../numbers.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId } from './advice.ts'

/**
 * Layout-cost awareness (plan §5.4): what the whole layout costs per roll and per hour over the
 * 60–150 pace range (`analyzeLayout`), and — when every bet's same-event twin is cheaper — the
 * alternative layout as a one-tap batch of swaps, dry-run through `validateAction` like any other
 * fix. The meter itself is M9d; this advisor is the words.
 */

export const layoutCost: Advisor = (input): Advice[] => {
  const { cfg, state } = input
  if (state === null || state.bets.length === 0) return []
  const layout = analyzeLayout(state, cfg)
  if (layout.byBet.every((entry) => entry.cost === null)) return []
  const subject = { typeId: 'table', number: null }
  const source = sourceOf('analyzeLayout', { field: 'perRoll' }, cfg)
  const low = layout.perHour[0]
  const high = layout.perHour[layout.perHour.length - 1]
  if (low === undefined || high === undefined) return []
  const out: Advice[] = [
    {
      id: adviceId('layout-cost', subject),
      ruleId: 'layout-cost',
      severity: 'info',
      subject,
      templateId: 'layout-cost',
      numbers: {
        perRoll: coachMoney(layout.perRoll, source),
        hourLow: coachNumber(
          'perHour',
          low.value,
          sourceOf('analyzeLayout', { field: 'perHour', at: PACE_RANGE.low }, cfg),
        ),
        hourHigh: coachNumber(
          'perHour',
          high.value,
          sourceOf('analyzeLayout', { field: 'perHour', at: PACE_RANGE.high }, cfg),
        ),
      },
      words: {},
      impact: layout.perRoll,
    },
  ]

  const alt = layout.alternativeLayout
  if (alt !== null && alt.perRoll.compare(layout.perRoll) < 0 && alt.swaps.length > 0) {
    const actions: Action[] = alt.swaps.flatMap((swap) => [
      { type: 'setAmount', betId: swap.betId, amount: cents(0) },
      {
        type: 'place',
        typeId: swap.to.typeId,
        ...(swap.to.number === null ? {} : { number: swap.to.number }),
        amount: swap.amount,
      },
    ])
    if (validateAction(state, { type: 'batch', actions }, cfg) === null) {
      out.push({
        id: adviceId('layout-swaps', subject),
        ruleId: 'layout-swaps',
        severity: 'tip',
        subject,
        templateId: 'layout-swaps',
        numbers: {
          nowRoll: coachMoney(layout.perRoll, source),
          thenRoll: coachMoney(
            alt.perRoll,
            sourceOf('analyzeLayout', { field: 'alternativeLayout.perRoll' }, cfg),
          ),
        },
        words: {},
        impact: layout.perRoll.sub(alt.perRoll),
        fix: { label: 'Switch to the cheaper layout', actions },
      })
    }
  }
  return out
}
