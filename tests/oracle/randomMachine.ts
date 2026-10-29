/**
 * Random machine variants for the closed-form fuzz (plan §9 item 3: "a fast-check run over random
 * configs (pay ratios, commission basis/timing/rounding/minimum/rearm, amounts)"). An arbitrary
 * edits a preset's plain config, staying inside what config validation accepts (rules spec
 * §5.3): commission taken from wins is never refunded or re-collected, and the parts of a
 * composite keep one rounding and one after-win rule.
 *
 * An oracle module: plain data in and out, no engine code (fast-check only builds the edits).
 */
import fc from 'fast-check'
import type { CommissionInput, MachineConfigInput } from '../../src/engine/config/schema.ts'

type Rounding = CommissionInput['rounding']
type Edit = (input: MachineConfigInput) => void

const ROUNDING_MODES = ['floor', 'ceil', 'halfUp', 'halfEven'] as const

export const roundingArb: fc.Arbitrary<Rounding> = fc.record({
  mode: fc.constantFrom(...ROUNDING_MODES),
  increment: fc.constantFrom(1, 5, 25, 100),
})

/** Any commission rule validation accepts. */
export const commissionArb: fc.Arbitrary<CommissionInput> = fc
  .record({
    rate: fc.constantFrom('1:20', '1:25', '1:10', '3:100'),
    basis: fc.constantFrom('stake' as const, 'win' as const),
    timing: fc.constantFrom('upfront' as const, 'onWin' as const),
    rounding: roundingArb,
    minimum: fc.constantFrom(0, 1, 25, 100),
    refundOnTakeDown: fc.boolean(),
    rearm: fc.constantFrom(
      'recollectFromWin' as const,
      'recollectFromCredit' as const,
      'none' as const,
    ),
  })
  .map((c) => (c.timing === 'onWin' ? { ...c, refundOnTakeDown: false, rearm: 'none' } : c))

/**
 * Edits for one machine: commission on buy and lay, payout rounding on the number bets, the
 * hardways and the one-roll bets (all of them alike, so composites stay valid), per-number
 * rounding on place 6 and 8, and the after-win rules.
 */
export const editArb: fc.Arbitrary<Edit> = fc
  .record({
    buy: commissionArb,
    lay: commissionArb,
    place: fc.option(roundingArb),
    placeByNumber: fc.option(roundingArb),
    hard: fc.option(roundingArb),
    oneRoll: fc.option(roundingArb),
    numberAfterWin: fc.constantFrom('stay' as const, 'return' as const),
    oneRollAfterWin: fc.constantFrom('stay' as const, 'return' as const),
    odds: fc.option(roundingArb),
  })
  .map((e): Edit => (input) => {
    for (const type of Object.values(input.catalog)) {
      switch (type.family) {
        case 'numberVsSeven':
          if (type.kind === 'buy') type.commission = e.buy
          if (type.kind === 'lay') type.commission = e.lay
          if (type.kind === 'buy' || type.kind === 'lay') delete type.commissionByNumber
          if (type.kind === 'place' && e.place !== null) type.payoutRounding = e.place
          if (type.kind === 'place' && e.placeByNumber !== null) {
            Object.assign(type, {
              payoutRoundingByNumber: { '6': e.placeByNumber, '8': e.placeByNumber },
            })
          }
          type.afterWin = e.numberAfterWin
          break
        case 'hardway':
          if (e.hard !== null) type.payoutRounding = e.hard
          type.afterWin = e.numberAfterWin
          break
        case 'oneRoll':
          if (e.oneRoll !== null) type.payoutRounding = e.oneRoll
          type.afterWin = e.oneRollAfterWin
          break
        case 'odds':
          if (e.odds !== null) type.payoutRounding = e.odds
          break
        case 'line':
          break
      }
    }
  })

/** A deep, editable copy of `input` with `edit` applied. */
export function edited(input: MachineConfigInput, edit: Edit): MachineConfigInput {
  const copy = structuredClone(input) as MachineConfigInput
  edit(copy)
  return copy
}
