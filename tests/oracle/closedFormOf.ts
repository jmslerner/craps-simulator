/**
 * The closed form of a machine's bets (plan §9 item 3): `closedForm.ts` takes plain parameters,
 * and this reads them for one bet from the plain `MachineConfigInput` through `machineFacts.ts`
 * (its pays, per-number payout rounding, commission and after-win rule). The reconciliation
 * compares the result with `analyzeBet` and with the dispatch chain, preset by preset.
 *
 * An oracle module: written from the rules spec, with no engine rule code (see machineFacts.ts).
 */
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  hardway,
  lineBet,
  numberBet,
  oddsBet,
  oneRoll,
  type CfBet,
  type CfCommission,
} from './closedForm.ts'
import {
  diceKey,
  oneRollPay,
  payoutRoundingOf,
  typeFacts,
  type CommissionFacts,
  type MachineFacts,
} from './machineFacts.ts'

/** One bet of a machine: its type, its number (or, for odds, the parent's point) and stake. */
export interface MachineBet {
  readonly typeId: string
  readonly number: number | null
  /** In cents. */
  readonly amount: number
}

/**
 * Every bet the machine offers, at `amount`: line bets and one-roll bets once, number bets and
 * hardways on each number, odds on each point of the variant.
 */
export function machineBets(facts: MachineFacts, amount: number): MachineBet[] {
  return [...facts.types.values()].flatMap((type): MachineBet[] => {
    switch (type.family) {
      case 'line':
      case 'oneRoll':
      case 'composite':
        return [{ typeId: type.id, number: null, amount }]
      case 'odds':
        return facts.points.map((n) => ({ typeId: type.id, number: n, amount }))
      case 'numberVsSeven':
      case 'hardway':
        return type.numbers.map((n) => ({ typeId: type.id, number: n, amount }))
    }
  })
}

/**
 * The closed form of `bet` on this machine, or null where the closed form does not model it: odds
 * behind come and don't come bets that are OFF on the come-out, which are returned (a push) when
 * their bet is decided there. Every other bet is decided only on rolls it works, each one the same
 * against the others (rules spec §1.2, §2.2), so when it is OFF does not change its price.
 */
export function closedFormOf(facts: MachineFacts, bet: MachineBet): CfBet | null {
  const type = typeFacts(facts, bet.typeId)
  const rounding = payoutRoundingOf(type, bet.number)
  const stake = bet.amount
  switch (type.family) {
    case 'line':
      return lineBet({
        variant: facts.variant,
        side: type.side,
        dontBar: facts.dontBar,
        pays: type.pays,
        stake,
        rounding,
        afterWin: type.afterWin,
      })
    case 'odds': {
      const parent = typeFacts(facts, type.parent)
      if (parent.family !== 'line') throw new RangeError(`${type.parent} is not a line bet`)
      if (parent.window === 'point' && type.comeOutDefault !== 'on') return null
      return oddsBet({
        number: numberOf(bet),
        side: type.parentSide === 'do' ? 'take' : 'lay',
        pays: type.pays.get(numberOf(bet)),
        stake,
        rounding,
      })
    }
    case 'numberVsSeven': {
      const n = numberOf(bet)
      const pays = type.pays.get(n)
      if (pays === undefined) throw new RangeError(`${type.id} has no pay on ${n}`)
      const commission = type.commission.get(n)
      return numberBet({
        number: n,
        winsOn: type.winsOn,
        pays,
        stake,
        rounding,
        commission: commission === undefined ? null : cfCommission(commission),
        afterWin: type.afterWin,
      })
    }
    case 'hardway': {
      const n = numberOf(bet)
      const pays = type.pays.get(n)
      if (pays === undefined || (n !== 4 && n !== 6 && n !== 8 && n !== 10)) {
        throw new RangeError(`${type.id} has no hard ${n}`)
      }
      return hardway({ number: n, pays, stake, rounding, afterWin: type.afterWin })
    }
    case 'oneRoll':
      return oneRoll({
        net: (d1, d2) => oneRollPay(type, d1, d2) ?? Fraction.ONE.neg(),
        stake,
        rounding,
        afterWin: type.afterWin,
      })
    case 'composite':
      return oneRoll({
        net: (d1, d2) => {
          const net = type.netByDice.get(diceKey(d1, d2))
          if (net === undefined) throw new RangeError(`${type.id} has no net on ${d1}-${d2}`)
          return net
        },
        stake,
        rounding,
        afterWin: type.afterWin,
      })
  }
}

function cfCommission(c: CommissionFacts): CfCommission {
  return {
    rate: c.rate,
    basis: c.basis,
    timing: c.timing,
    rounding: c.rounding,
    minimum: c.minimum,
    refundOnTakeDown: c.refundOnTakeDown,
    rearm: c.rearm,
  }
}

function numberOf(bet: MachineBet): number {
  if (bet.number === null) throw new RangeError(`${bet.typeId} needs a number`)
  return bet.number
}
