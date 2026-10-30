import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { settledDiceMode } from './dicePath.ts'
import {
  appUrl,
  chip,
  closeCoachSheet,
  openCoach,
  rollAndSettle,
  rollButton,
  zone,
} from './hooks.ts'

/**
 * The §10 M14 accessibility audit: axe-core over every screen and state a player reaches, on all
 * five browser/device projects — the table at the come-out and mid-hand (zones with their coach
 * badges, the next-step guide, the roll history and its recap, the "Next roll" panel), the bet
 * inspector with Show math open, a side bet's inspector, the coach in each mode with the cheat
 * sheet open, the tap modes and an engine refusal in the reason strip, the dialogs (New game and
 * Add credit, their error states included), the dice dome in its default 3D mode (whichever path
 * the browser takes: the live dome, or the 2D fallback without WebGL), the phone bottom sheets,
 * and whatever further dialogs the page can open (the M12 machine editor and the M13 session
 * summary, found by role, so the spec covers them once they land). Since the machine design (plan
 * §0 #28) the guide's detail, the roll history, "Next roll" and the coach's panels live in the
 * Coach drawer, docked from 1400 px and a bottom sheet on phones: the audits that cover them open
 * it first, and the felt is tapped with a phone's sheet closed.
 *
 * The bar is zero serious or critical violations under axe's default rule set (WCAG 2.0 and 2.1
 * A/AA plus best practices) with WCAG 2.2's target-size rule (24 px targets) switched on too.
 * Moderate and minor findings are attached to the test as
 * annotations, so a run shows them without failing on them. Before each audit the viewport grows
 * to the page's full height, so every element is on screen for the colour-contrast rule (axe can
 * only mark off-screen text "incomplete"). All waits are on state, never sleeps.
 */

const BLOCKING = new Set(['serious', 'critical'])
const PHONES = new Set(['pixel7', 'iphone15'])
/** The tallest viewport an audit grows to; the machine screen is far shorter. */
const MAX_AUDIT_HEIGHT = 4000

interface Finding {
  readonly id: string
  readonly impact: string
  readonly help: string
  readonly targets: readonly string[]
}

/** The page's full height, for the audit viewport. e2e/ has no DOM lib; this is the one read. */
interface ScrollRoot {
  readonly documentElement: { readonly scrollHeight: number }
}

/**
 * Runs axe over the page as it stands and fails on any serious or critical violation; every
 * finding is recorded as an annotation (`a11y <label>`), so the report shows what was checked.
 */
async function audit(page: Page, info: TestInfo, label: string): Promise<void> {
  const viewport = page.viewportSize()
  if (viewport !== null) {
    const full = await page.evaluate(
      () =>
        (globalThis as unknown as { document: ScrollRoot }).document.documentElement.scrollHeight,
    )
    const height = Math.min(Math.max(full, viewport.height), MAX_AUDIT_HEIGHT)
    if (height !== viewport.height) await page.setViewportSize({ ...viewport, height })
  }
  // WCAG 2.2's target-size rule is off in axe's defaults; the trainer is a touch app, so on.
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .analyze()
  if (viewport !== null) await page.setViewportSize(viewport)

  const findings: Finding[] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
  info.annotations.push({
    type: `a11y ${label}`,
    description:
      findings.length === 0
        ? `clean (${results.passes.length} rules passed)`
        : findings
            .map((f) => `${f.impact} ${f.id} ×${f.targets.length}: ${f.targets.slice(0, 3)}`)
            .join('; '),
  })
  const blocking = findings.filter((finding) => BLOCKING.has(finding.impact))
  expect(blocking, `${label}: serious or critical axe violations`).toEqual([])
}

/** A fresh table on the e2e crapless machine; `dice` defaults to 2D so nothing waits on WebGL. */
async function boot(page: Page, params: Readonly<Record<string, string>> = {}): Promise<void> {
  await page.goto(appUrl({ seed: 'm14-a11y', bankroll: '500', dice: '2d', ...params }))
  await expect(page.getByTestId('meter-credit')).toHaveText(`$${params.bankroll ?? '500'}.00`)
}

/** Waits until the analysis worker's badges are on the zones (coach mode on). */
async function badgesIn(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('[data-coach-badge]').count(), { message: 'no coach badges' })
    .toBeGreaterThan(10)
}

/** Opens the inspector on a zone the way every project can: INFO mode, then a tap. */
async function inspect(page: Page, target: Locator): Promise<Locator> {
  const info = page.getByRole('button', { name: 'Info' })
  await info.click()
  await target.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** Closes whatever dialog is open with Escape, and waits until it is gone. */
async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('the table at the come-out: zones with their badges, the guide and the empty history', async ({
  page,
}, info) => {
  await boot(page)
  await badgesIn(page)
  await expect(page.getByTestId('guide-go')).toBeVisible()
  await audit(page, info, 'come-out')
  await openCoach(page)
  await expect(page.getByTestId('next-step')).toBeVisible()
  await audit(page, info, 'come-out with the Coach drawer open')
})

test('a hand in play: point, odds, a place bet, the recap and the Next roll panel', async ({
  page,
}, info) => {
  await boot(page, { script: '2-2,3-3' })
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page) // the point is 4
  await zone(page, 'odds:passOdds').click()
  await zone(page, 'place:place:6').click()
  await rollAndSettle(page) // 3-3: the place 6 wins, with its recap math
  await expect(page.locator('.history-newest')).toContainText('Place 6 won')
  await badgesIn(page)
  await audit(page, info, 'mid-hand')
  await openCoach(page)
  await audit(page, info, 'mid-hand with the history and Next roll')
})

test('the bet inspector with Show math open, and a side bet’s inspector', async ({
  page,
}, info) => {
  await boot(page)
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:6').click()
  const dialog = await inspect(page, zone(page, 'place:place:6'))
  await dialog.getByText('Show math').click()
  await expect(dialog.locator('[data-coach-step]').first()).toBeVisible()
  await audit(page, info, 'inspector')
  await closeDialog(page)

  // A Low Rolls bet, then its inspector: the progress section and the pay table.
  await page.getByRole('button', { name: 'Info' }).click() // back to bet mode
  await chip(page, '$1.00').click()
  await openSideBets(page)
  const low = page.locator('[data-zone="sideBet:luckyRollerLow"]:visible')
  await low.click()
  await expect(low.locator('.zone-amount')).toHaveText('$1')
  // Right-click opens it on every project (the open sheet covers the tray's Info on phones).
  await low.click({ button: 'right' })
  const side = page.getByRole('dialog')
  await expect(side).toContainText('Low Rolls')
  await audit(page, info, 'side-bet inspector')
})

test('the coach in each mode, with the cheat sheet open and the guide hidden', async ({
  page,
}, info) => {
  await boot(page)
  await badgesIn(page)
  await openCoach(page)
  await page.getByRole('button', { name: /Cheat sheet/ }).click()
  await expect(page.getByTestId('sheet-rows')).toBeVisible()
  await audit(page, info, 'coach on + cheat sheet')

  await page.getByRole('button', { name: 'Coach quiet' }).click()
  await expect(page.getByRole('button', { name: 'Coach quiet' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await audit(page, info, 'coach quiet')

  await page.getByRole('button', { name: 'Coach off' }).click()
  await page.getByRole('button', { name: 'Guide' }).click()
  await expect(page.getByTestId('next-step')).toHaveCount(0)
  await audit(page, info, 'coach off, guide hidden')
})

test('the tap modes and an engine refusal in the reason strip', async ({ page }, info) => {
  await boot(page)
  // REMOVE mode with nothing on the zone: the machine's own "no bet there" answers in words.
  await page.getByRole('button', { name: 'Remove' }).click()
  await zone(page, 'line:pass').click({ force: true })
  await expect(page.getByTestId('reason-strip')).not.toHaveText('')
  await audit(page, info, 'remove mode + refusal')
  await page.getByRole('button', { name: 'Remove' }).click()

  // ROLL with nothing on the table: refused under the machine's minimum, in words.
  await rollButton(page).click()
  await expect(page.getByTestId('reason-strip')).not.toHaveText('')
  await page.getByRole('button', { name: 'Info' }).click()
  await audit(page, info, 'info mode + roll refusal')
})

test('the New game and Add credit dialogs, with their error states', async ({ page }, info) => {
  await boot(page)
  await page.getByRole('button', { name: 'New game' }).click()
  const newGame = page.getByRole('dialog', { name: 'New game' })
  await expect(newGame).toBeVisible()
  await audit(page, info, 'new game')
  await newGame.getByLabel('Whole dollars').fill('abc')
  await newGame.getByRole('button', { name: 'Start' }).click()
  await expect(newGame.getByRole('alert')).toBeVisible()
  await audit(page, info, 'new game error')
  await closeDialog(page)

  await page.getByRole('button', { name: '+ Add credit' }).click()
  const credit = page.getByRole('dialog', { name: /credit/i })
  await expect(credit).toBeVisible()
  await audit(page, info, 'add credit')
  await credit.getByLabel('Whole dollars').fill('0')
  await credit.getByRole('button', { name: 'Add credit' }).click()
  await expect(credit.getByRole('alert')).toBeVisible()
  await audit(page, info, 'add credit error')
})

test('the dice dome in its default 3D mode, live or fallen back to 2D', async ({ page }, info) => {
  // 3D is the default (plan §0 #27): no dice parameter. A browser without WebGL shows 2D.
  await page.goto(appUrl({ seed: 'm14-a11y-dome', bankroll: '500' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  const mode = await settledDiceMode(page)
  info.annotations.push({ type: 'dice path', description: mode })
  await audit(page, info, `dome (${mode})`)

  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await rollButton(page).click()
  await expect
    .poll(async () => (await page.locator('.history-roll').count()) > 0, { timeout: 60_000 })
    .toBe(true)
  await expect(rollButton(page)).toBeVisible({ timeout: 60_000 })
  await audit(page, info, `dome after a roll (${mode})`)
})

test('phones: every bottom sheet', async ({ page }, info) => {
  test.skip(!PHONES.has(info.project.name), 'the bottom sheets are the phone layout (§6)')
  await boot(page)
  await badgesIn(page)
  for (const name of ['Hardways', 'Hop bets', 'Side bets']) {
    await page.getByRole('tab', { name }).click()
    await expect(page.locator('.bottom-sheet .panel-title')).toHaveText(name)
    await audit(page, info, `sheet ${name}`)
    await page.locator('.bottom-sheet .sheet-close').click()
    await expect(page.locator('.bottom-sheet')).toHaveCount(0)
  }
  // The Coach drawer is a bottom sheet of its own there.
  await openCoach(page)
  await audit(page, info, 'sheet Coach')
  await closeCoachSheet(page)
})

test('phones at 375 px: the machine felt, its sheets and the Coach sheet', async ({
  page,
}, info) => {
  // The narrowest phone the layout is held to (plan §6; the phone spec's width), on the station's
  // palette (plan §0 #28): the felt with its badges, each station tab's sheet, the Coach sheet.
  test.skip(!PHONES.has(info.project.name), 'the 375 px layout is the phone layout (§6)')
  await page.setViewportSize({ width: 375, height: 720 })
  await boot(page)
  await badgesIn(page)
  await audit(page, info, '375 px felt')
  for (const name of ['Hardways', 'Hop bets', 'Side bets']) {
    await page.getByRole('tab', { name }).click()
    await expect(page.locator('.bottom-sheet .panel-title')).toHaveText(name)
    await audit(page, info, `375 px sheet ${name}`)
    await page.locator('.bottom-sheet .sheet-close').click()
    await expect(page.locator('.bottom-sheet')).toHaveCount(0)
  }
  await openCoach(page)
  await audit(page, info, '375 px sheet Coach')
  await closeCoachSheet(page)
})

/**
 * Every further dialog the page can open, found by role: the buttons that open a dialog from the
 * table (New game, Add credit, and any later one such as a session summary), then each button
 * inside the New game dialog that opens another dialog or view (the M12 machine editor and its
 * import/export). Each one found is audited and named in the annotations.
 */
test('every dialog the page can open, the machine editor and session summary included', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await boot(page, { script: '3-4' })
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page) // one decided roll, so a summary has something to show
  // The session summary's control is in the Coach drawer (plan §0 #28).
  await openCoach(page)
  const opened: string[] = []

  // Table-level openers: any button outside the felt and the chip tray whose press shows a dialog.
  const candidates = page.locator(
    'header button:visible, .coach button:visible, .machine > section:not(.table) button:visible',
  )
  const names = await namesOf(candidates)
  for (const name of names) {
    if (SKIP_OPENERS.test(name)) continue
    const button = page.getByRole('button', { name, exact: true }).first()
    if (!(await button.isVisible()) || !(await button.isEnabled())) continue
    await button.click()
    const dialog = page.getByRole('dialog')
    if ((await dialog.count()) === 0) continue
    opened.push(name)
    await audit(page, info, `dialog from "${name}"`)
    if (/new game/i.test(name)) await auditInsideNewGame(page, info, opened)
    await escapeTo(page, 'none')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  info.annotations.push({ type: 'dialogs audited', description: opened.join(' | ') })
  expect(opened).toEqual(expect.arrayContaining(['New game', '+ Add credit']))
})

/**
 * Buttons that change the game or the page rather than open a view: never pressed by the dialog
 * search. "Coach" and "Close the coach" fold the Coach drawer the search is reading.
 */
const SKIP_OPENERS =
  /^(Coach( (on|off|quiet))?$|Close the coach|Guide|Go|Hide|No thanks|Got it|Dismiss|2D|3D|Retry)/i

/** Which view is up: how many dialogs are open and the top one's first heading. */
async function viewOf(page: Page): Promise<string> {
  const dialogs = page.getByRole('dialog')
  const count = await dialogs.count()
  if (count === 0) return 'none'
  const heading = dialogs.last().getByRole('heading').first()
  const title = (await heading.count()) === 0 ? '' : ((await heading.textContent()) ?? '')
  return `${count}|${title.trim()}`
}

/** Escape until the view is `target` again, or every dialog is closed (at most four presses). */
async function escapeTo(page: Page, target: string): Promise<void> {
  for (let presses = 0; presses < 4; presses++) {
    const now = await viewOf(page)
    if (now === target || now === 'none') return
    await page.keyboard.press('Escape')
    await expect.poll(() => viewOf(page)).not.toBe(now)
  }
}

/**
 * Inside New game: every button that is not the dialog's own choice (Start, Cancel) and opens
 * another view — a nested dialog, or new content under a new heading, such as the machine
 * editor's views — is audited there, then left with Escape. A button that opens no view (a
 * download) is passed by.
 */
async function auditInsideNewGame(page: Page, info: TestInfo, opened: string[]): Promise<void> {
  const home = await viewOf(page)
  const names = await namesOf(page.getByRole('dialog').last().locator('button:visible'))
  for (const name of names) {
    if (/^(Start|Cancel|Close)$/i.test(name)) continue
    if ((await viewOf(page)) === 'none') {
      await page.getByRole('button', { name: 'New game', exact: true }).click()
    }
    if ((await viewOf(page)) !== home) continue
    const button = page.getByRole('dialog').last().getByRole('button', { name, exact: true })
    if (!(await button.isVisible()) || !(await button.isEnabled())) continue
    await button.click()
    if ((await viewOf(page)) === home) continue
    // A lazily loaded view shows "Loading…" first; audit it once it has drawn, named.
    const view = page.getByRole('dialog').last()
    await expect(view.getByText('Loading…')).toHaveCount(0, { timeout: 15_000 })
    await expect(view).toHaveAccessibleName(/\S/)
    opened.push(`New game › ${name}`)
    await audit(page, info, `New game › "${name}"`)
    await escapeTo(page, home)
  }
}

/** The accessible names of the buttons a locator matches, deduplicated, in page order. */
async function namesOf(buttons: Locator): Promise<string[]> {
  const names: string[] = []
  for (const button of await buttons.all()) {
    const label = (await button.getAttribute('aria-label')) ?? (await button.innerText())
    const name = label.trim().replace(/\s+/g, ' ')
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** The side-bet panel: open on desktop, behind the "Side bets" tab (a bottom sheet) on phones. */
async function openSideBets(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Side bets' })
  if (!(await tab.isVisible())) return
  if (!(await page.locator('.bottom-sheet').isVisible())) await tab.click()
  await expect(page.locator('.bottom-sheet')).toBeVisible()
}
