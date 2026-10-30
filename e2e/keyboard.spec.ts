import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { appUrl, hookState, zone } from './hooks.ts'

/**
 * The §10 M14 keyboard-only session, on the three desktop browsers: nothing here clicks or taps.
 * New game from its dialog (a different buy-in picked with the arrow keys), a side bet, the pass
 * line, a roll, odds behind the point, the inspector (opened in INFO mode, a bet added from it,
 * Show math opened, Escape back to the zone), a roll from the ROLL button, the coach's three modes,
 * and the roll history, scrolled from the keyboard. Every control is reached with Tab — or with
 * the app's own keys (plan §6: 1–6 chips, R roll, I info) where a player would use them — and
 * every focused control must show the focus ring. Dice are scripted through the e2e hook only
 * (the engine's scripted-dice door), never by a click.
 *
 * Safari moves Tab only between text fields until "Press Tab to highlight each item" is on;
 * Option+Tab is its full keyboard navigation, so the WebKit project presses that.
 */

const DESKTOPS = new Set(['desktop-chromium', 'desktop-firefox', 'desktop-webkit'])
/** More than every control on the screen, so a missing control fails instead of looping. */
const MAX_TABS = 220

/** An element as the focus checks read it (e2e/ compiles without the DOM lib). */
interface FocusLike {
  readonly ownerDocument: { readonly activeElement: unknown }
}
interface StyleHost {
  getComputedStyle(element: unknown): { outlineStyle: string; outlineWidth: string }
}

function tabKey(info: TestInfo): string {
  return info.project.name === 'desktop-webkit' ? 'Alt+Tab' : 'Tab'
}

function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const el = element as unknown as FocusLike
    return el.ownerDocument.activeElement === element
  })
}

/** An element as the order check reads it: where it sits against the focused element. */
interface OrderLike {
  readonly ownerDocument: {
    readonly activeElement: { compareDocumentPosition(other: unknown): number } | null
    readonly body: unknown
  }
}

/** `Node.DOCUMENT_POSITION_FOLLOWING`. */
const FOLLOWING = 4

/**
 * Presses Tab until `target` has focus: forward when it comes after the focused element in the
 * page, back (Shift) when it comes before — a player never wraps round the whole page (Firefox's
 * Tab leaves the page for the browser's own toolbar there). `direction` overrides the choice.
 */
async function tabTo(
  page: Page,
  info: TestInfo,
  target: Locator,
  direction?: 'forward' | 'back',
): Promise<void> {
  const way =
    direction ??
    (await target.evaluate((element, following) => {
      const doc = (element as unknown as OrderLike).ownerDocument
      const active = doc.activeElement
      if (active === null || active === doc.body) return 'forward'
      return (active.compareDocumentPosition(element) & following) !== 0 ? 'forward' : 'back'
    }, FOLLOWING))
  const key = way === 'back' ? `Shift+${tabKey(info)}` : tabKey(info)
  for (let presses = 0; presses < MAX_TABS; presses++) {
    if (await isFocused(target)) return
    await page.keyboard.press(key)
  }
  throw new Error(`${String(target)} never took focus in ${MAX_TABS} presses of ${key}`)
}

/** The focused control draws a visible ring (WCAG 2.4.7): a solid outline, at least 2 px. */
async function expectFocusRing(target: Locator): Promise<void> {
  await expect(target).toBeFocused()
  const ring = await target.evaluate((element) => {
    const style = (globalThis as unknown as StyleHost).getComputedStyle(element)
    return { style: style.outlineStyle, width: style.outlineWidth }
  })
  expect(ring.style, `${String(target)} has no focus ring`).not.toBe('none')
  expect(
    Number.parseFloat(ring.width),
    `${String(target)} focus ring width`,
  ).toBeGreaterThanOrEqual(2)
}

/** Waits for the roll in flight to settle back to betting at `rollIndex`. */
async function settledAt(page: Page, rollIndex: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await hookState(page)
        return state === null ? null : { phase: state.phase, rollIndex: state.rollIndex }
      },
      { message: `roll ${rollIndex} never settled back to betting` },
    )
    .toEqual({ phase: 'betting', rollIndex })
}

test('a whole session from the keyboard alone', async ({ page }, info) => {
  test.skip(!DESKTOPS.has(info.project.name), 'a keyboard session is a desktop session')
  test.setTimeout(120_000)
  await page.goto(appUrl({ seed: 'm14-keyboard', bankroll: '500', dice: 'instant' }))
  const credit = page.getByTestId('meter-credit')
  await expect(credit).toHaveText('$500.00')
  // The hook is installed once the boot has stored the session (e2e builds only).
  await page.waitForFunction(
    () => (globalThis as { __CRAPS_TEST__?: unknown }).__CRAPS_TEST__ !== undefined,
  )

  // New game: open it from the top bar, pick the next buy-in with an arrow key, Start.
  const newGame = page.getByRole('button', { name: 'New game' })
  await tabTo(page, info, newGame)
  await expectFocusRing(newGame)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'New game' })
  await expect(dialog).toBeVisible()
  const bankroll = dialog.getByRole('group', { name: 'Starting bankroll' })
  const picked = bankroll.getByRole('radio', { checked: true })
  await expect(picked).toBeFocused() // focus lands on the checked buy-in
  // The checked choice's label ("$300"): the radio sits inside its label.
  const checkedLabel = async (): Promise<string> =>
    (
      await picked.evaluate((element) => {
        const el = element as unknown as { parentElement: { textContent: string | null } | null }
        return el.parentElement?.textContent ?? ''
      })
    ).trim()
  const before = await checkedLabel()
  await page.keyboard.press('ArrowDown')
  await expect.poll(checkedLabel).not.toBe(before)
  // Past the last amount the arrow reaches "Custom"; one more wraps round to the first amount.
  if ((await checkedLabel()) === 'Custom') await page.keyboard.press('ArrowDown')
  const pickedLabel = await checkedLabel()
  expect(pickedLabel).toMatch(/^\$[\d,]+$/)
  // Forward to Start, across the "Whole dollars" field: focus alone no longer picks Custom there
  // (M12, as in Add credit), so the buy-in chosen by arrow key is the one that starts.
  await tabTo(page, info, dialog.getByRole('button', { name: 'Start' }), 'forward')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(credit).toHaveText(`${pickedLabel}.00`)
  await expect(newGame).toBeFocused() // focus comes back to the opener
  await expect(page.getByTestId('announcer')).toContainText('New game started')

  // Add credit, forward through the dialog: an amount by arrow key, Tab past the custom field.
  const addCredit = page.getByRole('button', { name: '+ Add credit' })
  await tabTo(page, info, addCredit)
  await page.keyboard.press('Enter')
  const deposit = page.getByRole('dialog', { name: 'Add credit' })
  await expect(deposit).toBeVisible()
  const amount = deposit.getByRole('radio', { checked: true })
  await expect(amount).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const added = (
    await amount.evaluate((element) => {
      const el = element as unknown as { parentElement: { textContent: string | null } | null }
      return el.parentElement?.textContent ?? ''
    })
  ).trim()
  expect(added).toMatch(/^\$[\d,]+$/)
  await tabTo(page, info, deposit.getByRole('button', { name: 'Add credit' }))
  await page.keyboard.press('Enter')
  await expect(deposit).toHaveCount(0)
  await expect(page.getByTestId('announcer')).toContainText(`Added ${added}.00 credit.`)
  await expect(addCredit).toBeFocused()

  // Script the next rolls through the engine's dice door: 2-2 sets the point 4, 3-3 rolls a 6.
  await expect
    .poll(() => page.evaluate(() => __CRAPS_TEST__?.queueDice('2-2,3-3') ?? false))
    .toBe(true)

  // A side bet before the first roll, with the $1 chip (key 1).
  await page.keyboard.press('1')
  const low = page.locator('[data-zone="sideBet:luckyRollerLow"]')
  await tabTo(page, info, low)
  await expectFocusRing(low)
  await page.keyboard.press('Enter')
  await expect(low.locator('.zone-amount')).toHaveText('$1')

  // The pass line with the $5 chip (key 2).
  // The station's rack is $1 $2 $3 $5 … (plan §0 #28): the $5 chip is key 4.
  await page.keyboard.press('4')
  await expect(page.getByRole('button', { name: /^\$5\.00 chip, in hand/ })).toBeVisible()
  const pass = zone(page, 'line:pass')
  await tabTo(page, info, pass)
  await page.keyboard.press('Enter')
  await expect(pass.locator('.zone-amount')).toHaveText('$5')

  // R rolls: the point is 4.
  await page.keyboard.press('r')
  await settledAt(page, 1)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')

  // Odds behind the pass line.
  const odds = zone(page, 'odds:passOdds')
  await tabTo(page, info, odds)
  await page.keyboard.press('Enter')
  await expect(odds.locator('.zone-amount')).toHaveText('$5')

  // The inspector: I turns INFO on, Enter on Place 6 opens it, + adds the chip from inside it.
  const place6 = zone(page, 'place:place:6')
  await tabTo(page, info, place6)
  await page.keyboard.press('i')
  await expect(page.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  const inspector = page.getByRole('dialog', { name: 'Place 6' })
  await expect(inspector).toBeVisible()
  const add = inspector.getByRole('button', { name: /^Add \$[\d.]+ to Place 6/ })
  await tabTo(page, info, add)
  await expectFocusRing(add)
  await page.keyboard.press('Enter')
  await expect(inspector).toContainText('On the table: $')
  const showMath = inspector.getByText('Show math')
  await tabTo(page, info, showMath)
  await page.keyboard.press('Enter')
  await expect(inspector.locator('[data-coach-step]').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inspector).toHaveCount(0)
  await expect(place6).toBeFocused() // back on the zone it was opened from
  await page.keyboard.press('i')
  await expect(page.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'false')

  // ROLL by its button: 3-3 pays the place 6.
  const roll = page.getByRole('button', { name: 'ROLL', exact: true })
  await tabTo(page, info, roll)
  await expectFocusRing(roll)
  await page.keyboard.press('Enter')
  await settledAt(page, 2)
  await expect(page.locator('.history-newest')).toContainText('Place 6 won')

  // The coach's three modes, each announced; Quiet hides the good badges, Off hides them all.
  const modes = page.getByTestId('coach-mode')
  for (const [name, badges] of [
    ['Coach quiet', 'fewer'],
    ['Coach off', 'none'],
    ['Coach on', 'all'],
  ] as const) {
    const button = modes.getByRole('button', { name })
    await tabTo(page, info, button)
    await expectFocusRing(button)
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('announcer')).toContainText(name)
    const count = page.locator('[data-coach-badge]')
    if (badges === 'none') await expect(count).toHaveCount(0)
    else await expect.poll(() => count.count()).toBeGreaterThan(0)
  }

  // The roll history takes focus and scrolls from the keyboard; both rolls are in it.
  const history = page.getByRole('region', { name: 'Roll history' })
  await tabTo(page, info, history)
  await expectFocusRing(history)
  await page.keyboard.press('End')
  await expect(history.locator('.history-roll')).toHaveCount(2)
  await expect(history).toContainText('rolled 2 and 2')
  await expect(history).toContainText('rolled 3 and 3')
})
