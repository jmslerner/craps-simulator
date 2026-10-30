import type { Cents, Fraction, PointNumber } from '../engine/index.ts'

/**
 * The coach's number type (plan §5.3): every number the coach shows is a `CoachNumber`, computed
 * in `src/exact` and traced to the exact function and arguments that produced it, so the audit
 * harness (M9c) can recompute each one from its `source` and the UI can mark what rests on
 * assumed machine values. Raw numbers never reach templates: `TemplatePart` admits strings and
 * `CoachNumber`s only, and the content lint (`tests/content-lint.test.ts`) rejects literal
 * percentages, dollar amounts and ratios in `coach/content/**`.
 */

export type CoachNumberKind =
  'percent' | 'money' | 'probability' | 'ratio' | 'rolls' | 'perHour' | 'count'

/** Where a number came from: the `src/exact` function, its JSON-safe arguments, and the config. */
export interface CoachSource {
  readonly fn: string
  /** The call's arguments, plain JSON, so the audit harness can replay the call. */
  readonly args: unknown
  readonly configHash: string
}

export interface CoachNumber {
  readonly kind: CoachNumberKind
  /** Money is a `Cents` integer when the machine pays it, an exact `Fraction` of cents otherwise. */
  readonly exact: Fraction | Cents
  readonly source: CoachSource
  /** Config pointers with `assumed` provenance that this number rests on. */
  readonly assumedPaths: readonly string[]
}

/**
 * One piece of coach copy: literal words, a number, or a number with a named display style
 * (`exact` shows money unrounded, "$5.833…"). Templates return these; the UI only formats.
 */
export type TemplatePart =
  string | CoachNumber | { readonly n: CoachNumber; readonly style: 'exact' }

export type TemplateParts = readonly TemplatePart[]

/** One rendered line of coach content: an id for tests and styling, and its parts. */
export interface CoachLine {
  readonly id: string
  readonly parts: TemplateParts
}

/** The edge grades (plan §5.4 edgeWarning), thresholds in `policy.ts`. */
export type Grade = 'excellent' | 'good' | 'fair' | 'poor' | 'awful'

/** A zone's coach badge (plan §5.5 surface 2): the bet's edge at its exact unit, graded. */
export interface ZoneBadge {
  readonly typeId: string
  readonly number: PointNumber | null
  /** The stake the edge is priced at: the bet's exact unit (`CatalogRow.amount`). */
  readonly amount: Cents
  readonly edge: CoachNumber
  readonly grade: Grade
}

/** The lookup key a zone uses to find its badge: `typeId|number`. */
export function badgeKey(typeId: string, number: number | null): string {
  return `${typeId}|${number ?? ''}`
}
