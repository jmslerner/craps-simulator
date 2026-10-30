import type { ReactNode } from 'react'
import { formatCents } from '../../engine/index.ts'
import type { Cents, Fraction, MachineConfig } from '../../engine/index.ts'
import {
  selectNextRoll,
  type BetNeeds,
  type DiceOutcome,
  type NeedTotal,
  type NextRollPreview,
  type NextRollRow,
} from '../state/nextRoll.ts'
import { useGameState } from './context.tsx'
import { netWords, roundEventWords, typeLabel } from './copy.ts'
import { rejectionText } from './rejectionText.ts'

/**
 * The "Next roll" panel (plan §0 #18 lessons; the demo's Next roll section): one row per total
 * with its ways out of 36 as bars and a chance, the player's net if that total rolls, and which
 * bets it wins, loses, moves, returns or advances (a side bet moved on: M11); then "Your bets
 * need", one line per bet with the totals that win it and the totals that take it. Every figure comes from `selectNextRoll`, which
 * dry-runs all 36 dice through the real engine on the shown table; this component computes
 * nothing and words nothing the engine did not say. A total shows two net lines when the dice
 * decide it differently (a hardway's 4-4 against the easy 8s). While a roll animates, the panel
 * keeps the prediction for the table the roll was made on. It reads the game store through
 * context and takes no props, so the design stage can mount it where the layout wants it.
 */

export function NextRollPanel() {
  const cfg = useGameState((state) => state.cfg)
  const preview = useGameState(selectNextRoll)
  if (cfg === null || preview === null) return null
  // Odds ride on their line bet's line ("Pass Line 8 $5 + $10 odds") rather than on their own.
  const needs = preview.needs.filter((need) => !isFoldedOdds(need, preview))
  return (
    <section
      className="next-roll"
      aria-label="What the next roll does"
      data-testid="next-roll"
      data-state-hash={preview.stateHash}
    >
      <div className="next-roll-head">
        <h2 className="next-roll-title">Next roll</h2>
        <p className="next-roll-summary" data-testid="next-roll-summary">
          <Summary preview={preview} cfg={cfg} />
        </p>
      </div>
      {preview.rows.length > 0 && (
        <ol className="next-roll-totals" aria-label="Every total and what it does to your bets">
          {preview.rows.map((row) => (
            <TotalRow key={row.total} row={row} cfg={cfg} />
          ))}
        </ol>
      )}
      <div className="next-roll-needs">
        <h3 className="next-roll-subtitle">Your bets need</h3>
        <ul className="needs" aria-label="What each bet needs">
          {needs.length === 0 ? (
            <li className="need need-empty" data-testid="next-roll-needs-empty">
              {preview.betCount === 0
                ? 'Nothing on the table yet.'
                : 'The machine will say what each bet needs once it can roll.'}
            </li>
          ) : (
            needs.map((need) => (
              <NeedRow key={need.bet.id} need={need} odds={oddsBehind(need, preview)} cfg={cfg} />
            ))
          )}
        </ul>
      </div>
    </section>
  )
}

/** The headline: the machine's refusal, the empty table, or the chances of a win, a loss, no change. */
function Summary({ preview, cfg }: { preview: NextRollPreview; cfg: MachineConfig }) {
  if (preview.refused !== null) {
    return <>The machine won’t roll yet: {rejectionText(preview.refused, cfg)}</>
  }
  if (preview.betCount === 0) return <>No bets yet. Place one to see which totals win it.</>
  const { summary } = preview
  return (
    <>
      <span className="amount-up">Win {pct(summary.winChance)}</span>
      {' · '}
      <span className="amount-down">lose {pct(summary.loseChance)}</span>
      {' · '}no change {pct(summary.evenChance)}
    </>
  )
}

/** A net line of a row: the only outcome, or one of the outcomes the dice tell apart. */
interface NetLine {
  readonly label: string
  readonly outcome: DiceOutcome
}

function linesOf(row: NextRollRow): NetLine[] {
  if (row.hardSplit !== undefined) {
    const { hard, easy } = row.hardSplit
    return [
      { label: pairLabel(hard), outcome: hard },
      { label: 'easy', outcome: easy },
    ]
  }
  if (row.outcomes.length > 1) {
    return row.outcomes.map((outcome) => ({ label: pairLabel(outcome), outcome }))
  }
  const only = row.outcomes[0]
  return only === undefined ? [] : [{ label: '', outcome: only }]
}

/** The unordered pairs an outcome's dice make, as the player says them: "4+4", "1+4, 2+3". */
function pairLabel(outcome: DiceOutcome): string {
  const pairs = new Set<string>()
  for (const roll of outcome.dice) {
    const low = roll.d1 <= roll.d2 ? roll.d1 : roll.d2
    const high = roll.d1 <= roll.d2 ? roll.d2 : roll.d1
    pairs.add(`${low}+${high}`)
  }
  return [...pairs].join(', ')
}

function TotalRow({ row, cfg }: { row: NextRollRow; cfg: MachineConfig }) {
  const lines = linesOf(row)
  const nets = lines.map((line) => line.outcome.net)
  const tone = nets.every((net) => net > 0) ? ' win' : nets.every((net) => net < 0) ? ' lose' : ''
  const split = row.hardSplit !== undefined ? 'hard' : row.outcomes.length > 1 ? 'dice' : undefined
  return (
    <li
      className={`trow${tone}`}
      data-testid="next-roll-row"
      data-total={row.total}
      data-ways={row.ways}
      data-net={row.net}
      data-split={split}
    >
      <span className={`tnum${row.total === 7 ? ' seven' : ''}`}>{row.total}</span>
      <span className="tways">
        <span className="bars" aria-hidden="true">
          {Array.from({ length: row.ways }, (_, index) => (
            <i key={index} />
          ))}
        </span>
        <span className="sr-only">{row.ways} of 36 ways, </span>
        <span className="tchance">{pct(row.chance)}</span>
      </span>
      <span className="tnet">
        {lines.map((line) => (
          <span
            key={line.label}
            className={`tnet-line${toneOf(line.outcome.net)}`}
            data-net-line={line.label === '' ? 'all' : line.label}
          >
            {line.label !== '' && <small>{line.label} </small>}
            <span className="sr-only">{netWords(line.outcome.net)}</span>
            <span aria-hidden="true">
              {line.outcome.net === 0 ? '–' : signedCents(line.outcome.net)}
            </span>
          </span>
        ))}
      </span>
      <span className="twho">
        {lines.map((line) => {
          const who = whoLine(line.outcome, cfg)
          if (who === '') return null
          return (
            <span key={line.label} className="twho-line">
              {line.label === '' ? who : `${line.label}: ${who}`}
            </span>
          )
        })}
      </span>
    </li>
  )
}

/** "The point is 8 · Place 8 +$7.00 · Hard 8 -$1.00 · Come moves to 8": the round, then each bet. */
function whoLine(outcome: DiceOutcome, cfg: MachineConfig): string {
  const parts: string[] = []
  const round = roundEventWords(outcome.roundEvent)
  if (round !== null) parts.push(round)
  for (const bet of outcome.bets) {
    const name = betName(cfg, bet.typeId, bet.number)
    switch (bet.fate) {
      case 'win':
      case 'lose':
        parts.push(`${name} ${signedCents(bet.net)}`)
        break
      case 'travel':
        parts.push(`${name} moves to ${bet.travelTo}`)
        break
      case 'returned':
        parts.push(`${name} back`)
        break
      case 'push':
        parts.push(`${name} pushes`)
        break
      case 'progress':
        parts.push(`${name} advances`)
        break
      case 'none':
      case 'off':
        break
    }
  }
  const line = parts.join(' · ')
  return line === '' ? '' : line.charAt(0).toUpperCase() + line.slice(1)
}

function NeedRow({
  need,
  odds,
  cfg,
}: {
  need: BetNeeds
  odds: BetNeeds | null
  cfg: MachineConfig
}) {
  const amount = (value: Cents) => formatCents(value, { trimWholeDollars: true })
  const label = `${betName(cfg, need.bet.typeId, need.bet.number)} ${amount(need.bet.amount)}${
    odds === null ? '' : ` + ${amount(odds.bet.amount)} odds`
  }`
  const details: ReactNode[] = []
  if (!need.working) {
    details.push(
      <span key="off" className="noff">
        off for this roll
      </span>,
    )
  } else {
    if (need.losesOn.length > 0) {
      details.push(
        <span key="lose">
          loses on {need.losesOn.length >= 7 ? 'every other total' : chips(need.losesOn, 'lose')}
        </span>,
      )
    }
    if (need.movesOn.length > 0) {
      details.push(
        <span key="move">
          {need.movesOn.length >= 7 ? (
            'any other total moves it to that number'
          ) : (
            <>moves on {chips(need.movesOn, 'move')}</>
          )}
        </span>,
      )
    }
    if (need.returnsOn.length > 0) {
      details.push(<span key="return">returned on {chips(need.returnsOn, 'return')}</span>)
    }
    if (need.advancesOn.length > 0) {
      details.push(
        <span key="advance">
          {need.advancesOn.length >= 7 ? (
            'every other total advances it'
          ) : (
            <>advances on {chips(need.advancesOn, 'advance')}</>
          )}
        </span>,
      )
    }
    if (details.length === 0 && need.winsOn.length === 0) {
      details.push(<span key="none">no action on this roll</span>)
    }
  }
  if (odds !== null && !odds.working) {
    details.push(
      <span key="odds-off" className="noff">
        odds off this roll
        {odds.returnsOn.length > 0 && <>, back on {chips(odds.returnsOn, 'return')}</>}
      </span>,
    )
  }
  return (
    <li
      className={`need${need.working ? '' : ' need-off'}`}
      data-testid="next-roll-need"
      data-bet={need.bet.id}
      data-working={need.working ? 'true' : 'false'}
    >
      <span className="nlabel">{label}</span>
      <span className="nwin">
        {need.winsOn.length > 0 && (
          <>
            <span className="sr-only">wins on </span>
            {chips(need.winsOn, 'win')}
          </>
        )}
      </span>
      <span className="nlose">{separate(details)}</span>
    </li>
  )
}

/** Odds whose line bet is on the table ride on its line. */
function isFoldedOdds(need: BetNeeds, preview: NextRollPreview): boolean {
  const parent = need.bet.parentId
  return parent !== null && preview.needs.some((other) => other.bet.id === parent)
}

function oddsBehind(need: BetNeeds, preview: NextRollPreview): BetNeeds | null {
  return preview.needs.find((other) => other.bet.parentId === need.bet.id) ?? null
}

type ChipKind = 'win' | 'lose' | 'move' | 'return' | 'advance'

/** Number chips, a space between them so the text reads as a list without styling. */
function chips(needs: readonly NeedTotal[], kind: ChipKind): ReactNode {
  return separate(
    needs.map((need) => (
      <b
        key={`${need.total}-${need.way}-${need.dice?.d1 ?? ''}-${need.dice?.d2 ?? ''}`}
        className={`n ${kind}${need.total === 7 ? ' seven' : ''}`}
        data-chip={kind}
      >
        {needText(need)}
      </b>
    )),
  )
}

function needText(need: NeedTotal): string {
  switch (need.way) {
    case 'any':
      return `${need.total}`
    case 'easy':
      return `easy ${need.total}`
    case 'hard':
    case 'dice':
      return need.dice === null ? `${need.total}` : `${need.dice.d1}+${need.dice.d2}`
  }
}

function separate(nodes: readonly ReactNode[], separator = ' '): ReactNode {
  return nodes.flatMap((node, index) => (index === 0 ? [node] : [separator, node]))
}

/** The machine's name for a bet on its number: "Place 8", "Pass Line 8", "Field". */
function betName(cfg: MachineConfig, typeId: string, number: number | null): string {
  const label = typeLabel(cfg, typeId)
  return number === null ? label : `${label} ${number}`
}

function pct(chance: Fraction): string {
  return `${chance.formatPercent(0)}%`
}

function toneOf(net: Cents): string {
  return net > 0 ? ' amount-up' : net < 0 ? ' amount-down' : ''
}

function signedCents(amount: Cents): string {
  return amount > 0 ? `+${formatCents(amount)}` : formatCents(amount)
}
