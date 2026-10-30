import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cents, legalBets, validateAction } from '../../engine/index.ts'
import type { GameState } from '../state/gameStore.ts'
import { CRAPLESS, dice } from '../test/game.ts'
import { testStores } from '../test/renderApp.tsx'
import { StoresProvider } from './context.tsx'
import { NextRollPanel } from './NextRollPanel.tsx'
import { rejectionText } from './rejectionText.ts'

/**
 * The Next roll panel (plan §0 #18 lessons): the demo's structure — rows with ways bars and a
 * chance, the net coloured, who wins and loses, a needs list — with every figure the engine's own
 * (the amounts below are the engine's settlement of the same table, pinned in nextRoll.test.ts).
 * The panel is rendered on its own over the test stores, as the design stage will mount it.
 */

function renderPanel(options: { start?: boolean; seed?: string } = {}) {
  const stores = testStores()
  if (options.start !== false) {
    stores.game.getState().startGame(CRAPLESS, options.seed ?? 'next-roll-panel')
  }
  const rendered = render(
    <StoresProvider value={stores}>
      <NextRollPanel />
    </StoresProvider>,
  )
  const run = (play: (state: GameState) => void): void => {
    act(() => {
      play(stores.game.getState())
    })
  }
  const roll = (d1: number, d2: number): void => {
    run((state) => {
      const outcome = state.beginRoll(dice(d1, d2))
      if (!outcome.ok) throw new Error(`test roll refused: ${outcome.rejection.code}`)
      stores.game.getState().reveal()
      stores.game.getState().finishReveal()
    })
  }
  return { ...rendered, stores, run, roll }
}

/** Pass $5, place 8 $6, hard 8 $1, field $5 on the come-out. */
function betComeOutTable(state: GameState): void {
  state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
  state.dispatch({ type: 'place', typeId: 'place', number: 8, amount: cents(600) })
  state.dispatch({ type: 'place', typeId: 'hard', number: 8, amount: cents(100) })
  state.dispatch({ type: 'place', typeId: 'field', amount: cents(500) })
}

function rowFor(total: number): HTMLElement {
  const row = screen
    .getAllByTestId('next-roll-row')
    .find((element) => element.getAttribute('data-total') === String(total))
  if (row === undefined) throw new Error(`no row for ${total}`)
  return row
}

function needFor(label: string): HTMLElement {
  const need = screen
    .getAllByTestId('next-roll-need')
    .find((element) => element.querySelector('.nlabel')?.textContent?.startsWith(label))
  if (need === undefined) throw new Error(`no needs line starting "${label}"`)
  return need
}

const chipTexts = (scope: HTMLElement, kind: string): string[] =>
  [...scope.querySelectorAll(`[data-chip="${kind}"]`)].map((chip) => chip.textContent ?? '')

describe('the Next roll panel', () => {
  it('renders nothing before a game starts', () => {
    const { container } = renderPanel({ start: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('on an empty crapless table says the machine will not roll yet, in the machine’s words', () => {
    const { stores } = renderPanel()
    const refusal = validateAction(
      stores.game.getState().session!.state,
      { type: 'roll' },
      CRAPLESS,
    )
    expect(refusal?.code).toBe('BELOW_MIN_TOTAL')
    const summary = screen.getByTestId('next-roll-summary')
    expect(summary).toHaveTextContent('The machine won’t roll yet:')
    expect(summary).toHaveTextContent(rejectionText(refusal!, CRAPLESS))
    expect(screen.queryAllByTestId('next-roll-row')).toHaveLength(0)
    expect(screen.getByTestId('next-roll-needs-empty')).toHaveTextContent(
      'Nothing on the table yet.',
    )
    expect(screen.getByRole('region', { name: 'What the next roll does' })).toBeInTheDocument()
  })

  it('lists every total with its ways bars, chance, net and who wins or loses', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    const rows = screen.getAllByTestId('next-roll-row')
    expect(rows.map((row) => row.getAttribute('data-total'))).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ])
    expect(screen.getByRole('list', { name: 'Every total and what it does to your bets' })).toBe(
      rows[0]?.parentElement,
    )
    const seven = rowFor(7)
    expect(seven).toHaveClass('lose')
    expect(seven.getAttribute('data-net')).toBe('-700')
    expect(seven.getAttribute('data-ways')).toBe('6')
    expect(seven.querySelectorAll('.bars i')).toHaveLength(6)
    expect(seven.querySelector('.tchance')).toHaveTextContent('17%')
    expect(seven.querySelector('.tnum')).toHaveClass('seven')
    expect(seven.querySelector('.tnet')).toHaveTextContent('you lost $7.00')
    expect(seven.querySelector('.tnet')).toHaveTextContent('-$7.00')
    expect(seven.querySelector('.twho')).toHaveTextContent(
      '7 wins the come-out · Pass Line +$5.00 · Place 8 -$6.00 · Hard Ways 8 -$1.00 · Field -$5.00',
    )
    const two = rowFor(2)
    expect(two).toHaveClass('win')
    expect(two.querySelectorAll('.bars i')).toHaveLength(1)
    expect(two.querySelector('.tchance')).toHaveTextContent('3%')
    expect(two.querySelector('.tnet')).toHaveTextContent('+$10.00')
    expect(two.querySelector('.twho')).toHaveTextContent(
      'The point is 2 · Pass Line moves to 2 · Field +$10.00',
    )
    expect(screen.getByTestId('next-roll-summary')).toHaveTextContent(
      'Win 58% · lose 42% · no change 0%',
    )
  })

  it('shows the 8 split into its hard and easy ways, each with its own net and line', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    const eight = rowFor(8)
    expect(eight.getAttribute('data-split')).toBe('hard')
    expect(eight.getAttribute('data-net')).toBe('100')
    const lines = [...eight.querySelectorAll('[data-net-line]')]
    expect(lines.map((line) => line.getAttribute('data-net-line'))).toEqual(['4+4', 'easy'])
    const shown = (line: Element | undefined) => [
      line?.querySelector('small')?.textContent?.trim(),
      line?.querySelector('[aria-hidden="true"]')?.textContent,
      line?.querySelector('.sr-only')?.textContent,
    ]
    expect(shown(lines[0])).toEqual(['4+4', '+$11.00', 'you won $11.00'])
    expect(shown(lines[1])).toEqual(['easy', '+$1.00', 'you won $1.00'])
    expect(lines[0]).toHaveClass('amount-up')
    const who = [...eight.querySelectorAll('.twho-line')].map((line) => line.textContent)
    expect(who[0]).toContain(
      '4+4: The point is 8 · Pass Line moves to 8 · Place 8 +$7.00 · Hard Ways 8 +$9.00',
    )
    expect(who[1]).toContain(
      'easy: The point is 8 · Pass Line moves to 8 · Place 8 +$7.00 · Hard Ways 8 -$1.00',
    )
    // A total no bet reads has a single line.
    expect(rowFor(6).hasAttribute('data-split')).toBe(false)
    expect(rowFor(6).querySelectorAll('[data-net-line]')).toHaveLength(1)
  })

  it('tells each bet what it needs: hard and easy chips where the dice matter', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    expect(screen.getAllByTestId('next-roll-need')).toHaveLength(4)
    const hard = needFor('Hard Ways 8 $1')
    expect(chipTexts(hard, 'win')).toEqual(['4+4'])
    expect(chipTexts(hard, 'lose')).toEqual(['7', 'easy 8'])
    expect(hard).toHaveTextContent('loses on 7 easy 8')
    const field = needFor('Field $5')
    expect(chipTexts(field, 'win')).toEqual(['2', '3', '4', '9', '10', '11', '12'])
    expect(chipTexts(field, 'lose')).toEqual(['5', '6', '7', '8'])
    const pass = needFor('Pass Line $5')
    expect(chipTexts(pass, 'win')).toEqual(['7'])
    expect(pass).toHaveTextContent('any other total moves it to that number')
    expect(within(pass).queryByText('loses on')).toBeNull()
    expect(screen.getByRole('list', { name: 'What each bet needs' })).toBeInTheDocument()
  })

  it('folds odds onto their line bet once the point is set', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    app.roll(4, 4) // the point is 8
    app.run((state) => {
      const odds = legalBets(state.session!.state, CRAPLESS).find(
        (spot) => spot.typeId === 'passOdds',
      )
      if (odds === null || odds === undefined || odds.parentId === null)
        throw new Error('no odds spot')
      state.dispatch({
        type: 'place',
        typeId: 'passOdds',
        parentId: odds.parentId,
        amount: cents(1000),
      })
    })
    const needs = screen.getAllByTestId('next-roll-need')
    // The field went with the 8; the odds ride on the line: pass (with odds), place 8, hard 8.
    expect(needs).toHaveLength(3)
    expect(needs.map((need) => need.getAttribute('data-bet'))).toEqual(['b1', 'b2', 'b3'])
    const pass = needFor('Pass Line 8 $5 + $10 odds')
    expect(chipTexts(pass, 'win')).toEqual(['8'])
    expect(chipTexts(pass, 'lose')).toEqual(['7'])
    const eight = rowFor(8)
    // Easy 8: pass +$5, odds +$12 (6:5 on $10), place 8 +$7, hard 8 -$1.
    expect(eight.getAttribute('data-net')).toBe('2300')
    expect(eight.querySelector('[data-net-line="easy"] [aria-hidden="true"]')?.textContent).toBe(
      '+$23.00',
    )
    expect(eight.querySelector('[data-net-line="4+4"] [aria-hidden="true"]')?.textContent).toBe(
      '+$33.00',
    )
    expect(eight.querySelector('.twho')).toHaveTextContent('Point 8 made')
    expect(rowFor(7).querySelector('.twho')).toHaveTextContent('Seven-out · Pass Line 8 -$5.00')
  })

  it('marks bets that are off and keeps them out of the nets', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    app.run((state) => {
      state.dispatch({ type: 'setGlobalWorking', off: true })
    })
    const place = needFor('Place 8 $6')
    expect(place.getAttribute('data-working')).toBe('false')
    expect(place).toHaveClass('need-off')
    expect(place).toHaveTextContent('off for this roll')
    expect(chipTexts(place, 'win')).toEqual([])
    // The 7 now wins the line and takes only the field: +$5 - $5.
    expect(rowFor(7).getAttribute('data-net')).toBe('0')
    expect(rowFor(7).querySelector('.tnet')).toHaveTextContent('no change')
    expect(rowFor(8).hasAttribute('data-split')).toBe(false)
  })

  it('keeps the pre-roll prediction while the dice are rolling, then follows the new table', () => {
    const app = renderPanel()
    app.run(betComeOutTable)
    const before = screen.getByTestId('next-roll').getAttribute('data-state-hash')
    app.run((state) => {
      const outcome = state.beginRoll(dice(3, 4))
      if (!outcome.ok) throw new Error('refused')
    })
    expect(screen.getByTestId('next-roll').getAttribute('data-state-hash')).toBe(before)
    expect(rowFor(7).getAttribute('data-net')).toBe('-700')
    app.run((state) => {
      state.reveal()
      state.finishReveal()
    })
    expect(screen.getByTestId('next-roll').getAttribute('data-state-hash')).not.toBe(before)
    // After the natural the line stays up alone: a 7 wins $5 and nothing is taken.
    expect(rowFor(7).getAttribute('data-net')).toBe('500')
    expect(screen.getAllByTestId('next-roll-need')).toHaveLength(1)
  })

  it('shows a side bet the roll moves on as advancing, never "no action" (M11 audit)', () => {
    const app = renderPanel({ seed: 'next-roll-panel-side' })
    app.run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
      state.dispatch({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    })
    const low = needFor('Low Rolls $1')
    expect(chipTexts(low, 'advance')).toEqual(['2', '3', '4', '5', '6'])
    expect(chipTexts(low, 'lose')).toEqual(['7'])
    expect(low).not.toHaveTextContent('no action on this roll')
    expect(rowFor(4).querySelector('.twho')).toHaveTextContent('Low Rolls advances')
    expect(rowFor(9).querySelector('.twho')).not.toHaveTextContent('Low Rolls')
  })
})
