import { useEffect, useSyncExternalStore } from 'react'
import { canToggle, cents, formatCents, workingStatus } from '../../engine/index.ts'
import type {
  Action,
  BetInstance,
  MachineConfig,
  PointNumber,
  WorkingSource,
} from '../../engine/index.ts'
import { adviceLine } from '../../coach/advisors/render.ts'
import type { Advice } from '../../coach/advisors/advice.ts'
import { formatPart } from '../../coach/format.ts'
import { coachModeName, gate } from '../../coach/policy.ts'
import type { TemplateParts } from '../../coach/types.ts'
import { useCoachMemory } from '../state/nextStep.ts'
import {
  inspectFor,
  inspectKey,
  requestInspect,
  subscribeAnalysis,
} from '../services/analysisClient.ts'
import {
  maxOddsActionsFor,
  pressActionsFor,
  selectLegalBets,
  selectShown,
} from '../state/gameStore.ts'
import { selectSideBetSpots } from '../state/sideBetSpots.ts'
import { spokenRatio } from './copy.ts'
import { useGameState, useSettingsState, useStores, useUi, type SpotRef } from './context.tsx'
import { Dialog } from './Dialog.tsx'
import { rejectionText } from './rejectionText.ts'
import { SideBetProgress } from './SideBetProgress.tsx'

/**
 * The bet inspector (plan §6): a dialog over one spot, opened by long-press, right-click, INFO
 * mode or the `i` key. Every amount a control offers comes from `legalBets` — the stepper steps by
 * the spot's own increment, the odds stepper by the odds spot's, Max is the `maxOutOdds` macro —
 * and every change goes through the store's dispatch, so the engine answers anything the machine
 * would refuse and the answer is shown inline. The working toggle is per-bet; on machines that
 * only have the global button it stays visible but disabled, saying so. A side bet (M11) takes its
 * spot from `selectSideBetSpots` and adds its progress section (`SideBetProgress`).
 */

export function BetInspector({ spot: ref }: { spot: SpotRef }) {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const legal = useGameState(selectLegalBets)
  const sideLegal = useGameState(selectSideBetSpots)
  const rejection = useGameState((state) => state.rejection)

  if (cfg === null || shown === null || legal === null) return null

  const side = cfg.sideBets.get(ref.typeId) ?? null
  const pool = side === null ? legal : (sideLegal ?? [])
  const spot =
    pool.find(
      (s) =>
        s.typeId === ref.typeId &&
        (ref.number === null ? true : s.number === ref.number) &&
        (ref.parentId === null ? true : s.parentId === ref.parentId),
    ) ?? null
  const bet = spot?.betId == null ? null : (shown.bets.find((b) => b.id === spot.betId) ?? null)
  const type = cfg.catalog.get(ref.typeId) ?? cfg.composites.get(ref.typeId) ?? side
  const label = type?.label ?? ref.typeId
  const name = ref.number === null ? label : `${label} ${ref.number}`
  const zoneTag = `inspector:${ref.typeId}:${ref.number ?? ''}`

  const send = (action: Action): void => {
    game.getState().dispatch(action, zoneTag)
  }

  const step = spot === null || spot.canAdd !== null ? null : spot.minAdd
  const working = bet === null ? null : workingStatus(bet, shown, cfg)
  const toggleable = bet !== null && canToggle(bet, shown, cfg)
  const press = bet === null ? [] : pressActionsFor(game.getState(), bet.id)
  const pressAction = press[0]
  const payLabel = payOf(cfg, ref, bet)

  // Odds behind this bet: the line's odds type, its spot and any odds bet already up.
  const oddsId = cfg.oddsFor.get(ref.typeId) ?? null
  const oddsSpot =
    oddsId === null || bet === null
      ? null
      : (legal.find((s) => s.typeId === oddsId && s.parentId === bet.id) ?? null)
  const oddsBet =
    oddsSpot?.betId == null ? null : (shown.bets.find((b) => b.id === oddsSpot.betId) ?? null)
  const isOdds = type !== null && type.family === 'odds'
  const maxOdds =
    bet === null ? [] : maxOddsActionsFor(game.getState(), isOdds ? bet.parentId : bet.id)
  const maxAction = maxOdds[0]

  const inlineRejection =
    rejection !== null && rejection.zone === zoneTag ? rejectionText(rejection, cfg) : null

  const reduce = (): void => {
    if (bet !== null && step !== null) {
      send({ type: 'setAmount', betId: bet.id, amount: cents(bet.amount - step) })
    }
  }

  const add = (): void => {
    if (spot === null || step === null) return
    if (bet !== null) {
      send({ type: 'setAmount', betId: bet.id, amount: cents(bet.amount + step) })
    } else if (spot.number !== null) {
      send({ type: 'place', typeId: ref.typeId, number: spot.number, amount: step })
    } else if (spot.parentId !== null) {
      send({ type: 'place', typeId: ref.typeId, parentId: spot.parentId, amount: step })
    } else {
      send({ type: 'place', typeId: ref.typeId, amount: step })
    }
  }

  return (
    <Dialog titleId="inspector-title" onClose={ui.closeInspector} className="inspector">
      <h2 id="inspector-title" className="dialog-title">
        {name}
      </h2>
      <p className="inspector-line">
        {bet === null ? 'No bet here yet.' : `On the table: ${formatCents(bet.amount)}`}
        {payLabel !== null && (
          <span className="inspector-pays"> · pays {spokenRatio(payLabel)}</span>
        )}
        {working !== null && (
          <span className="inspector-working">
            {' '}
            · {working.working ? 'working' : 'OFF'} ({workingWords(working.source)})
          </span>
        )}
      </p>

      <div className="inspector-stepper" role="group" aria-label={`${name} amount`}>
        <button
          type="button"
          onClick={reduce}
          disabled={bet === null || step === null}
          aria-label={`Reduce ${name}`}
        >
          −
        </button>
        <span className="inspector-amount">{formatCents(cents(bet?.amount ?? 0))}</span>
        <button
          type="button"
          onClick={add}
          disabled={step === null}
          aria-label={`Add ${step === null ? 'to' : formatCents(step) + ' to'} ${name}`}
        >
          +
        </button>
      </div>

      <div className="inspector-actions">
        <button
          type="button"
          disabled={pressAction === undefined}
          onClick={() => (pressAction === undefined ? undefined : send(pressAction))}
        >
          Press
        </button>
        <button type="button" disabled={bet === null || step === null} onClick={reduce}>
          Reduce
        </button>
        <button
          type="button"
          disabled={bet === null}
          onClick={() =>
            bet === null ? undefined : send({ type: 'setAmount', betId: bet.id, amount: cents(0) })
          }
        >
          Take down
        </button>
        <button
          type="button"
          disabled={!toggleable}
          title={
            toggleable
              ? undefined
              : side !== null
                ? 'A side bet always plays; it cannot be switched off.'
                : 'This machine has no per-bet switch; use the Set bets On/Off button.'
          }
          onClick={() =>
            bet !== null && working !== null
              ? send({ type: 'setWorking', betId: bet.id, working: !working.working })
              : undefined
          }
        >
          {working?.working === false ? 'Set working' : 'Set OFF'}
        </button>
      </div>

      {oddsId !== null && bet !== null && (
        <div className="inspector-odds" role="group" aria-label={`Odds behind ${name}`}>
          <span className="inspector-odds-label">
            Odds: {formatCents(cents(oddsBet?.amount ?? 0))}
          </span>
          <button
            type="button"
            disabled={oddsBet === null || oddsSpot === null}
            onClick={() =>
              oddsBet !== null && oddsSpot !== null
                ? send({
                    type: 'setAmount',
                    betId: oddsBet.id,
                    amount: cents(oddsBet.amount - oddsSpot.minAdd),
                  })
                : undefined
            }
            aria-label={`Reduce odds behind ${name}`}
          >
            −
          </button>
          <button
            type="button"
            disabled={oddsSpot === null || oddsSpot.canAdd !== null}
            onClick={() => {
              if (oddsSpot === null || oddsSpot.canAdd !== null) return
              if (oddsBet === null) {
                send({ type: 'place', typeId: oddsId, parentId: bet.id, amount: oddsSpot.minAdd })
              } else {
                send({
                  type: 'setAmount',
                  betId: oddsBet.id,
                  amount: cents(oddsBet.amount + oddsSpot.minAdd),
                })
              }
            }}
            aria-label={`Add odds behind ${name}`}
          >
            +
          </button>
          <button
            type="button"
            disabled={maxAction === undefined}
            onClick={() => (maxAction === undefined ? undefined : send(maxAction))}
          >
            Max
          </button>
        </div>
      )}

      {inlineRejection !== null && (
        <p className="inspector-rejection" role="status">
          {inlineRejection}
        </p>
      )}

      {side !== null && (
        <SideBetProgress side={side} bet={bet} spot={spot} phase={shown.round.phase} cfg={cfg} />
      )}

      <InspectorExtras spot={ref} />

      <button type="button" className="dialog-close" onClick={ui.closeInspector}>
        Close
      </button>
    </Dialog>
  )
}

/**
 * The coach's inspector content (plan §10 M9a; M9c adds the alternatives here). Everything shown
 * comes from the analysis worker's `InspectorMath` — the bet priced at the player's own amount,
 * the equity of a bet already on the table, and the "Show math" derivation — rendered verbatim
 * through `formatPart`: no number appears here that `src/exact` did not compute. The props shape
 * (`{ spot: SpotRef }`) is the M8 contract and stays.
 *
 * **Coach mode (plan §5.6):** Off renders nothing here — the inspector keeps the machine's own
 * facts above (amount, pay, working), and every coach line goes. Quiet and Coach show the priced
 * lines and Show math (the player asked, by opening the inspector) and route the advice through
 * the gate: what it would toast or feed is listed, what it hides or demotes to badge-only is not —
 * so Quiet lists only the strong same-event switch and the 9%+ warning, and a retired advice
 * ("Don't show", one tap: `retireAdvice`) or a for-fun bet type stays off this list for the run.
 *
 * **Side bets (plan §5.4 `sideBetProgress`, M11):** for a side bet on the table the worker's
 * `InspectorMath.sideBet` (`coach/sideBetProgress.ts`) adds its lines to `math.lines` — where it
 * stands, what settling now assures, the next tier with the exact chance of reaching it, the
 * chance of any win and the rolls left — so they render here like every other coach line, below
 * the machine facts of `SideBetProgress`.
 */
export function InspectorExtras({ spot: ref }: { spot: SpotRef }) {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const legal = useGameState(selectLegalBets)
  const sideLegal = useGameState(selectSideBetSpots)
  const coachMode = useSettingsState((state) => coachModeName(state.coachMode))
  const memory = useCoachMemory((state) => state.memory)
  const retire = useCoachMemory((state) => state.retireAdvice)
  const silenceType = useCoachMemory((state) => state.markForFun)

  // A side bet's spot is listed by `selectSideBetSpots` (M11), the main game's by `selectLegalBets`.
  const pool = cfg !== null && cfg.sideBets.has(ref.typeId) ? sideLegal : legal
  const spot =
    pool?.find(
      (s) =>
        s.typeId === ref.typeId &&
        (ref.number === null ? true : s.number === ref.number) &&
        (ref.parentId === null ? true : s.parentId === ref.parentId),
    ) ?? null
  const bet =
    spot?.betId == null || shown === null
      ? null
      : (shown.bets.find((b) => b.id === spot.betId) ?? null)
  // The analysis prices the zone's own spec; an odds spot takes its number from the bet behind it.
  const isOdds = cfg?.catalog.get(ref.typeId)?.family === 'odds'
  const specNumber = (ref.number ??
    (isOdds ? (bet?.number ?? spot?.number ?? null) : null)) as PointNumber | null
  const amount =
    bet !== null ? bet.amount : spot !== null && spot.canAdd === null ? spot.minAdd : null
  const betId = bet?.id ?? null

  const ready = cfg !== null && shown !== null && amount !== null && amount > 0
  const key = ready
    ? inspectKey(cfg, { typeId: ref.typeId, number: specNumber }, amount, betId, shown)
    : null

  useEffect(() => {
    if (cfg === null || shown === null || amount === null || amount <= 0) return
    if (coachMode === 'off') return
    requestInspect(cfg, { typeId: ref.typeId, number: specNumber }, amount, shown, betId)
  }, [cfg, shown, amount, betId, ref.typeId, specNumber, coachMode])

  const math = useSyncExternalStore(subscribeAnalysis, () =>
    key === null ? null : inspectFor(key),
  )
  if (math === null || shown === null || coachMode === 'off') return null

  // The advisors' say on this spot (plan §5.4, §10 M9c), routed by the gate for the mode and the
  // player's memory: the toast and feed surfaces are listed here, badge-only and hidden are not.
  const routed = gate(math.advice, coachMode, memory, shown.round.rollIndex)
  const advice = [...(routed.toast === null ? [] : [routed.toast]), ...routed.feed]
  const applyFix = (item: Advice): void => {
    if (item.fix === undefined) return
    const result = game
      .getState()
      .dispatch({ type: 'batch', actions: [...item.fix.actions] }, `advice:${item.ruleId}`)
    if (result.ok) ui.announce(`${item.fix.label}: done.`)
  }

  return (
    <section className="inspector-coach" aria-label="Coach analysis">
      {math.lines.map((line) => (
        <p key={line.id} className="coach-line" data-coach-line={line.id}>
          {renderParts(line.parts)}
        </p>
      ))}
      {math.steps.length > 0 && (
        <details className="coach-math">
          <summary>Show math</summary>
          <ol>
            {math.steps.map((step) => (
              <li key={step.id} data-coach-step={step.id}>
                {renderParts(step.parts)}
              </li>
            ))}
          </ol>
        </details>
      )}
      {advice.length > 0 && (
        <ul className="coach-advice" aria-label="Coach advice">
          {advice.map((item) => (
            <li key={item.id} className="advice-row" data-advice={item.ruleId}>
              <span className="advice-text">{renderParts(adviceLine(item).parts)}</span>
              {item.assumed !== undefined && item.assumed.length > 0 && (
                <span className="coach-assumed" title={item.assumed.join('; ')}>
                  assumed
                </span>
              )}
              {item.fix !== undefined && (
                <button
                  type="button"
                  className="advice-fix"
                  data-testid={`advice-fix-${item.ruleId}`}
                  onClick={() => applyFix(item)}
                >
                  {item.fix.label}
                </button>
              )}
              <button
                type="button"
                className="advice-mute"
                aria-label={`Don't show this ${item.ruleId} advice again`}
                onClick={() => {
                  retire(item.id)
                  ui.announce('That advice will not be shown again.')
                }}
              >
                Don&apos;t show
              </button>
              <button
                type="button"
                className="advice-mute"
                aria-label="Silence advice for this bet: it's for fun"
                onClick={() => silenceType(item.subject.typeId)}
              >
                It&apos;s for fun
              </button>
            </li>
          ))}
        </ul>
      )}
      {math.assumedPaths.length > 0 && (
        <p className="coach-assumed" title={math.assumedPaths.join(', ')}>
          Uses assumed machine values
        </p>
      )}
    </section>
  )
}

/** Template parts as plain text: words verbatim, every number formatted from its `CoachNumber`. */
function renderParts(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

/**
 * The pay the machine shows for this spot, as written; null where it varies or is composite. A
 * side bet with one pay (a collect set) shows it; the others list their table in `SideBetProgress`.
 */
function payOf(cfg: MachineConfig, ref: SpotRef, bet: BetInstance | null): string | null {
  const side = cfg.sideBets.get(ref.typeId)
  if (side !== undefined) return side.family === 'collectSet' ? side.pays.label : null
  const type = cfg.catalog.get(ref.typeId)
  if (type === undefined) return null
  const n = (ref.number ?? bet?.number ?? null) as PointNumber | null
  switch (type.family) {
    case 'line':
      return type.pays.label
    case 'odds':
    case 'numberVsSeven':
      return n === null ? null : (type.pays.get(n)?.label ?? null)
    case 'hardway':
      return n === 4 || n === 6 || n === 8 || n === 10 ? (type.pays.get(n)?.label ?? null) : null
    case 'oneRoll': {
      const labels = new Set([...type.pays.values()].map((ratio) => ratio.label))
      return labels.size === 1 ? ([...labels][0] ?? null) : null
    }
  }
}

function workingWords(source: WorkingSource): string {
  switch (source) {
    case 'always':
      return 'always works'
    case 'machine':
      return 'machine rule'
    case 'bet':
      return 'your setting'
    case 'afterSevenOut':
      return 'held after the seven-out'
    case 'button':
      return 'the bets on/off button'
    case 'machineDefault':
    case 'default':
      return 'machine default'
  }
}
