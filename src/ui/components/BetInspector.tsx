import { canToggle, cents, formatCents, workingStatus } from '../../engine/index.ts'
import type {
  Action,
  BetInstance,
  MachineConfig,
  PointNumber,
  WorkingSource,
} from '../../engine/index.ts'
import {
  maxOddsActionsFor,
  pressActionsFor,
  selectLegalBets,
  selectShown,
} from '../state/gameStore.ts'
import { spokenRatio } from './copy.ts'
import { useGameState, useStores, useUi, type SpotRef } from './context.tsx'
import { Dialog } from './Dialog.tsx'
import { rejectionText } from './rejectionText.ts'

/**
 * The bet inspector (plan §6): a dialog over one spot, opened by long-press, right-click, INFO
 * mode or the `i` key. Every amount a control offers comes from `legalBets` — the stepper steps by
 * the spot's own increment, the odds stepper by the odds spot's, Max is the `maxOutOdds` macro —
 * and every change goes through the store's dispatch, so the engine answers anything the machine
 * would refuse and the answer is shown inline. The working toggle is per-bet; on machines that
 * only have the global button it stays visible but disabled, saying so.
 */

export function BetInspector({ spot: ref }: { spot: SpotRef }) {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const legal = useGameState(selectLegalBets)
  const rejection = useGameState((state) => state.rejection)

  if (cfg === null || shown === null || legal === null) return null

  const spot =
    legal.find(
      (s) =>
        s.typeId === ref.typeId &&
        (ref.number === null ? true : s.number === ref.number) &&
        (ref.parentId === null ? true : s.parentId === ref.parentId),
    ) ?? null
  const bet = spot?.betId == null ? null : (shown.bets.find((b) => b.id === spot.betId) ?? null)
  const type = cfg.catalog.get(ref.typeId) ?? cfg.composites.get(ref.typeId) ?? null
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

      <InspectorExtras spot={ref} />

      <button type="button" className="dialog-close" onClick={ui.closeInspector}>
        Close
      </button>
    </Dialog>
  )
}

/**
 * M9 EXTENSION POINT (plan §10 M9a, M9c): "Show math" and the cheaper-alternative buttons mount
 * here, fed by the analysis worker's `CoachNumber`s. M8 renders nothing — no number may appear
 * here that `src/exact` did not compute.
 */
export function InspectorExtras(props: { spot: SpotRef }) {
  void props
  return null
}

/** The pay the machine shows for this spot, as written; null where it varies or is composite. */
function payOf(cfg: MachineConfig, ref: SpotRef, bet: BetInstance | null): string | null {
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
