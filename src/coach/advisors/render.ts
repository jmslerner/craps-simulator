import {
  edgeWarningParts,
  layoutCostParts,
  layoutSwapsParts,
  minVigParts,
  oddsNotFreeParts,
  oddsParts,
  restructureParts,
  roundingParts,
  sameEventParts,
  sizingParts,
  variantContextParts,
  workingCostParts,
  workingHeldParts,
  workingOffParts,
} from '../content/advisors.ts'
import type { CoachLine, CoachNumber, TemplateParts } from '../types.ts'
import type { Advice } from './advice.ts'

/**
 * Advice as a rendered line (plan §5.3): each `templateId` names a template in
 * `content/advisors.ts`; the advice's `CoachNumber`s and machine words are the only inputs, so no
 * number can reach the screen that was not computed. Missing numbers throw — an advisor that emits
 * a template without its numbers is a bug the tests catch, never a blank in the UI.
 */

export function adviceLine(advice: Advice): CoachLine {
  return { id: advice.id, parts: partsOf(advice) }
}

function partsOf(advice: Advice): TemplateParts {
  const n = numberPicker(advice)
  const w = wordPicker(advice)
  switch (advice.templateId) {
    case 'edge-warning':
      return edgeWarningParts(
        { edge: n('edge'), per: n('per'), base: n('base') },
        { name: w('name'), grade: w('grade') },
      )
    case 'same-event':
      return sameEventParts(
        {
          ownEdge: n('ownEdge'),
          altEdge: n('altEdge'),
          savingPerDecision: n('savingPerDecision'),
        },
        { from: w('from'), to: w('to') },
      )
    case 'restructure':
      return restructureParts(
        { ownEdge: n('ownEdge'), altEdge: n('altEdge') },
        { from: w('from'), to: w('to') },
      )
    case 'sizing':
      return sizingParts(
        {
          stake: n('stake'),
          edge: n('edge'),
          betterAmount: n('betterAmount'),
          betterEdge: n('betterEdge'),
        },
        { name: w('name') },
      )
    case 'odds':
      return oddsParts(
        { flatEdge: n('flatEdge'), withOdds: n('withOdds') },
        { line: w('line'), odds: w('odds') },
      )
    case 'odds-not-free':
      return oddsNotFreeParts({ oddsEdge: n('oddsEdge') }, { odds: w('odds'), number: w('number') })
    case 'rounding':
      return roundingParts(
        {
          stake: n('stake'),
          edge: n('edge'),
          nominalEdge: n('nominalEdge'),
          betterAmount: n('betterAmount'),
          betterEdge: n('betterEdge'),
        },
        { name: w('name') },
      )
    case 'min-vig':
      return minVigParts({ freeFrom: n('freeFrom'), edge: n('edge') })
    case 'variant-context':
      return variantContextParts(
        { crapless: n('crapless'), traditional: n('traditional'), cheap: n('cheap') },
        { name: w('name'), cheap: w('cheap') },
      )
    case 'working-off':
      return workingOffParts({ name: w('name') })
    case 'working-held':
      return workingHeldParts({ count: n('count') })
    case 'working-cost':
      return workingCostParts({ nowHour: n('nowHour'), thenHour: n('thenHour') })
    case 'layout-cost':
      return layoutCostParts({
        perRoll: n('perRoll'),
        hourLow: n('hourLow'),
        hourHigh: n('hourHigh'),
      })
    case 'layout-swaps':
      return layoutSwapsParts({ nowRoll: n('nowRoll'), thenRoll: n('thenRoll') })
    default:
      throw new RangeError(`no template for advice ${advice.templateId}`)
  }
}

function numberPicker(advice: Advice): (key: string) => CoachNumber {
  return (key) => {
    const value = advice.numbers[key]
    if (value === undefined) {
      throw new RangeError(`advice ${advice.id} is missing number "${key}"`)
    }
    return value
  }
}

function wordPicker(advice: Advice): (key: string) => string {
  return (key) => {
    const value = advice.words[key]
    if (value === undefined) {
      throw new RangeError(`advice ${advice.id} is missing word "${key}"`)
    }
    return value
  }
}
