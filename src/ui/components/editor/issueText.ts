import type { MachineConfig, MachineConfigInput } from '../../../engine/index.ts'
import { assumedPaths, type SanityIssue } from '../../../exact/index.ts'
import { formatPart } from '../../../coach/format.ts'
import { coachMoney, coachPercent, sourceOf } from '../../../coach/numbers.ts'
import type { TemplatePart } from '../../../coach/types.ts'
import { typeLabel } from './fields.ts'

/**
 * The sanity check's findings in words (plan §4.4, §10 M12). Every number is a `CoachNumber`
 * built from the issue `src/exact` returned — the edge and the stake it shows at, traced to
 * `checkBet` with its bet and the machine's hash, carrying the assumed values it rests on — and
 * formatted the way the coach formats it: never a typed-in figure.
 */

export interface IssueLine {
  readonly severity: 'error' | 'warning'
  readonly code: SanityIssue['code']
  readonly parts: readonly TemplatePart[]
}

/** The bet an issue is about, as the layout names it: "Place 6", "Pass Odds 2", "Fire Bet". */
export function specLabel(draft: MachineConfigInput, issue: SanityIssue): string {
  const label = typeLabel(draft, issue.spec.typeId)
  return issue.spec.number === null ? label : `${label} ${issue.spec.number}`
}

export function sanityLine(
  issue: SanityIssue,
  cfg: MachineConfig,
  draft: MachineConfigInput,
): IssueLine {
  const label = specLabel(draft, issue)
  const source = sourceOf('checkBet', { spec: issue.spec }, cfg)
  const assumed = assumedPaths(issue.spec, cfg)
  const edge = issue.edge === null ? null : coachPercent(issue.edge, source, assumed)
  const at = issue.amount === null ? null : coachMoney(issue.amount, source, assumed)
  const atParts: TemplatePart[] = at === null ? [] : [' at ', at]
  const edgeParts: TemplatePart[] = edge === null ? [] : [edge]
  const base = { severity: issue.severity, code: issue.code }
  switch (issue.code) {
    case 'playerAdvantage':
      return {
        ...base,
        parts: [
          `${label} favours the player: house edge `,
          ...edgeParts,
          ...atParts,
          '. A casino never offers that — almost certainly a data-entry error, so the machine cannot be saved.',
        ],
      }
    case 'playerEven':
      return {
        ...base,
        parts: [
          `${label} is dead even: house edge `,
          ...edgeParts,
          ...atParts,
          '. Almost certainly a "for 1" pay typed as "to 1", so the machine cannot be saved.',
        ],
      }
    case 'highEdge':
      return {
        ...base,
        parts: [
          `${label}: house edge `,
          ...edgeParts,
          ...atParts,
          ", far above any real bet's. Check its pays.",
        ],
      }
    case 'notFree':
      return {
        ...base,
        parts: [
          `${label} is not free: odds that pay below true odds carry a house edge of `,
          ...edgeParts,
          '.',
        ],
      }
    case 'payDrops':
      return { ...base, parts: [`${label} ${issue.message}.`] }
    case 'unanalysable':
      return { ...base, parts: [`${label} could not be analysed: ${issue.message}.`] }
  }
}

/** An issue line as plain text, for an accessible summary and tests. */
export function lineText(line: IssueLine): string {
  return line.parts.map((part) => formatPart(part)).join('')
}

/**
 * Where a sanity issue shows in the editor: at the pay it is about when the issue names one (a
 * side bet's table for one that pays less for more progress), else at the bet itself.
 */
export function sanityPointer(issue: SanityIssue, draft: MachineConfigInput): string {
  const { typeId, number } = issue.spec
  const root = Object.hasOwn(draft.catalog, typeId)
    ? `/catalog/${typeId}`
    : Object.hasOwn(draft.sideBets, typeId)
      ? `/sideBets/${typeId}`
      : `/composites/${typeId}`
  if (issue.code === 'payDrops') {
    return issue.paths.find((path) => /\/(payTable|tiers)$/.test(path)) ?? root
  }
  if (number !== null && issue.paths.includes(`${root}/pays/${number}`)) {
    return `${root}/pays/${number}`
  }
  if (issue.paths.includes(`${root}/pays`)) return `${root}/pays`
  return root
}
