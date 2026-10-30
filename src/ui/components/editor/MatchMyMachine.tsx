import { useMemo, useState } from 'react'
import { PRESETS, PRESET_IDS } from '../../../engine/index.ts'
import type { MachineConfigInput, PresetId, Variant } from '../../../engine/index.ts'
import {
  BUY_VIG_CHOICES,
  COME_OUT_CHOICES,
  FIELD_CHOICES,
  ODDS_CAP_CHOICES,
  ODDS_GROUPS,
  answersOf,
  applyAnswers,
  nearestPreset,
  sideBetLibrary,
  type MatchAnswers,
} from './quickSetup.ts'
import './editor.css'

/**
 * Match My Machine (plan §10 M12): the five questions, answered at the machine, then a review
 * of the config they make in the machine editor. The answers start as the picked machine's (or
 * the first of the chosen kind); the nearest built-in machine — the one already matching the most
 * answers — is shown as the answers change, and it is the copy the answers are applied to.
 */

export interface MatchMyMachineProps {
  /** The machine picked in the New game list: the starting answers when it is a preset. */
  readonly prefer: PresetId | null
  onReview(input: MachineConfigInput, base: PresetId): void
  onBack(): void
}

function firstOf(variant: Variant, prefer: PresetId | null): PresetId {
  if (prefer !== null && PRESETS[prefer].variant === variant) return prefer
  const first = PRESET_IDS.find((id) => PRESETS[id].variant === variant)
  if (first === undefined) throw new Error(`No built-in machine is ${variant}`)
  return first
}

/** The caps offered, with the machine's own when it is not one of them. */
function capChoices(current: number | undefined): number[] {
  const choices = new Set([...ODDS_CAP_CHOICES, ...(current === undefined ? [] : [current])])
  return [...choices].sort((a, b) => a - b)
}

export function MatchMyMachine({ prefer, onReview, onBack }: MatchMyMachineProps) {
  const [variant, setVariant] = useState<Variant>(
    prefer === null ? 'crapless' : PRESETS[prefer].variant,
  )
  const [answers, setAnswers] = useState<MatchAnswers>(() =>
    answersOf(PRESETS[firstOf(variant, prefer)]),
  )
  const nearest = useMemo(() => nearestPreset(variant, answers, prefer), [variant, answers, prefer])
  const library = useMemo(() => sideBetLibrary(variant), [variant])
  const update = (change: Partial<MatchAnswers>) =>
    setAnswers((current) => ({ ...current, ...change }))

  const pickVariant = (next: Variant): void => {
    setVariant(next)
    setAnswers(answersOf(PRESETS[firstOf(next, prefer)]))
  }

  return (
    <div className="ed match" data-testid="match-my-machine">
      <h2 id="new-game-title" className="dialog-title" tabIndex={-1}>
        Match my machine
      </h2>
      <p className="ed-intro">
        Five questions you can answer at the machine. The answers change a copy of the closest
        built-in machine; you review it in the editor before saving.
      </p>
      <fieldset className="match-q">
        <legend>Your machine is</legend>
        {(['crapless', 'traditional'] as const).map((kind) => (
          <label key={kind} className="match-choice">
            <input
              type="radio"
              name="match-variant"
              checked={variant === kind}
              onChange={() => pickVariant(kind)}
            />
            {kind === 'crapless'
              ? 'Crapless (2, 3, 11 and 12 are points)'
              : 'Traditional (2, 3 and 12 lose on the come-out)'}
          </label>
        ))}
      </fieldset>
      <fieldset className="match-q">
        <legend>1. When does it take the buy vig?</legend>
        {BUY_VIG_CHOICES.map((choice) => (
          <label key={choice.value} className="match-choice">
            <input
              type="radio"
              name="match-buy-vig"
              checked={answers.buyVig === choice.value}
              onChange={() => update({ buyVig: choice.value })}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="match-q">
        <legend>2. Place and buy bets on the come-out are</legend>
        {COME_OUT_CHOICES.map((choice) => (
          <label key={choice.value} className="match-choice">
            <input
              type="radio"
              name="match-come-out"
              checked={answers.comeOut === choice.value}
              onChange={() => update({ comeOut: choice.value })}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="match-q">
        <legend>3. How much odds does it take behind the line?</legend>
        {ODDS_GROUPS[variant].map((group) => (
          <label key={group.key} className="match-odds">
            <span>On {group.points.join(' and ')}</span>
            <select
              value={answers.oddsCaps[group.key] ?? ''}
              onChange={(event) =>
                update({
                  oddsCaps: { ...answers.oddsCaps, [group.key]: Number(event.target.value) },
                })
              }
            >
              {capChoices(answers.oddsCaps[group.key]).map((cap) => (
                <option key={cap} value={cap}>
                  {cap}× the line bet
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <fieldset className="match-q">
        <legend>4. The field pays on 2 and 12</legend>
        {FIELD_CHOICES.map((choice) => (
          <label key={choice.value} className="match-choice">
            <input
              type="radio"
              name="match-field"
              checked={answers.field === choice.value}
              onChange={() => update({ field: choice.value })}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="match-q">
        <legend>5. Which side bets does it show?</legend>
        {library.map((bet) => (
          <label key={bet.id} className="match-choice">
            <input
              type="checkbox"
              checked={answers.sideBets.includes(bet.id)}
              onChange={(event) =>
                update({
                  sideBets: event.target.checked
                    ? [...answers.sideBets, bet.id]
                    : answers.sideBets.filter((id) => id !== bet.id),
                })
              }
            />
            {bet.label}
          </label>
        ))}
      </fieldset>
      <p className="match-nearest" role="status" data-testid="match-nearest">
        Closest built-in machine: <strong>{PRESETS[nearest.id].name}</strong>, already matching{' '}
        {nearest.matched} of 5 answers.
      </p>
      <div className="dialog-buttons">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onReview(applyAnswers(nearest.id, answers), nearest.id)}
        >
          Review in the editor
        </button>
      </div>
    </div>
  )
}
