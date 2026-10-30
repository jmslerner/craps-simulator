import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, hookState, rollAndSettle, sessionHash, waitForSaved, zone } from './hooks.ts'

/**
 * The §10 M12 acceptance in the browser: the machine editor shows provenance chips (assumed ones
 * visible) and inline errors; the player-advantage edit "place 6 pays 7:5" is blocked; 2/12 odds
 * at 11:2 are flagged "not free" at 7.14%; Match My Machine makes a machine the next game plays;
 * a game saved to a file loads back to the same hash after a new game cleared it, and survives a
 * reload; a corrupt file is refused and changes nothing. Every wait is on state, never a sleep.
 */

/** The sanity check solves every bet of the machine: generous on a phone or a loaded machine. */
const CHECKED = { timeout: 45_000 }

function field(page: Page, pointer: string) {
  return page.locator(`[data-pointer="${pointer}"]`)
}

function fieldInput(page: Page, pointer: string) {
  return field(page, pointer).locator('input').first()
}

/** Opens one of the editor's sections by its id ("catalog/place", "money"). */
async function openSection(page: Page, id: string): Promise<void> {
  const button = page.locator(`[data-section="${id}"] .ed-section-title button`)
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

/**
 * New game replaced a session that rolled: M13 shows its summary once the New game dialog has
 * closed. Wait for it and close it, so the table is free for the next step.
 */
async function closeEndedSummary(page: Page): Promise<void> {
  const summary = page.getByRole('dialog', { name: 'Session ended' })
  await expect(summary).toBeVisible()
  await summary.getByRole('button', { name: 'Close' }).click()
  await expect(summary).toHaveCount(0)
}

test('the editor gates sanity inline: 7:5 on place 6 blocks, 11:2 odds on 2 are not free at 7.14%', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto(appUrl({ seed: 'm12-editor', dice: 'instant' }))
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('button', { name: 'Edit a copy…' }).click()
  const status = page.getByTestId('editor-status')
  await expect(status).toHaveText('Every bet checks out: ready to save.', CHECKED)
  const save = page.getByRole('button', { name: 'Save machine' })
  await expect(save).toBeEnabled()

  // Provenance chips on every field; place 6's pay is assumed (no public par sheet).
  await openSection(page, 'catalog/place')
  await expect(field(page, '/catalog/place/pays/6').locator('[data-chip]')).toContainText('assumed')
  expect(await page.locator('[data-chip="assumed"]').count()).toBeGreaterThan(5)

  // An inline zod error: a pay that is not a ratio.
  await fieldInput(page, '/catalog/place/pays/6').fill('seven to six')
  await expect(field(page, '/catalog/place/pays/6')).toContainText('Invalid ratio "seven to six"')
  await expect(status).toHaveText('1 problem to fix before saving.')
  await expect(save).toBeDisabled()

  // The player-advantage edit: blocked, with the edge the solver computed.
  await fieldInput(page, '/catalog/place/pays/6').fill('7:5')
  await expect(status).toHaveText('1 problem to fix before saving.', CHECKED)
  await expect(
    field(page, '/catalog/place/pays/6').locator('[data-issue="playerAdvantage"]'),
  ).toContainText('Place 6 favours the player: house edge -9.09% at $1.00', CHECKED)
  await expect(save).toBeDisabled()

  // Back to the machine's own pay; then 11:2 on the 2: not free, a warning that still saves.
  await fieldInput(page, '/catalog/place/pays/6').fill('7:6')
  await expect(status).toHaveText('Every bet checks out: ready to save.', CHECKED)
  await openSection(page, 'catalog/passOdds')
  await fieldInput(page, '/catalog/passOdds/pays/2').fill('11:2')
  await expect(status).toHaveText('Ready to save, with 1 warning.', CHECKED)
  await expect(
    field(page, '/catalog/passOdds/pays/2').locator('[data-issue="notFree"]'),
  ).toHaveText(
    'Pass Odds 2 is not free: odds that pay below true odds carry a house edge of 7.14%.',
  )
  await expect(field(page, '/catalog/passOdds/pays/2').locator('[data-chip]')).toContainText(
    'yours',
  )
  await expect(save).toBeEnabled()

  // Saved, it joins the player's machines.
  await save.click()
  const dialog = page.getByRole('dialog', { name: 'New game' })
  const mine = dialog.getByRole('group', { name: 'Your machines' })
  await expect(mine.getByRole('radio', { name: /My Crapless bubble craps/ })).toBeChecked()

  // The page never scrolls sideways, the editor's grids included.
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
})

test('Match My Machine makes the machine the next game plays', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(appUrl({ seed: 'm12-match', dice: 'instant' }))
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('button', { name: 'Match my machine…' }).click()
  await page.getByRole('radio', { name: /Taken out of the win/ }).check()
  await page.getByRole('radio', { name: /Double on 2, triple on 12/ }).check()
  await expect(page.getByTestId('match-nearest')).toHaveText(
    'Closest built-in machine: Crapless bubble craps, already matching 3 of 5 answers.',
  )
  await page.getByRole('button', { name: 'Review in the editor' }).click()
  await expect(page.getByTestId('editor-status')).toHaveText(/ready to save/, CHECKED)
  await openSection(page, 'catalog/field')
  await expect(field(page, '/catalog/field/pays/12').locator('[data-chip]')).toContainText('yours')
  await page.getByRole('button', { name: 'Save machine' }).click()

  const dialog = page.getByRole('dialog', { name: 'New game' })
  await expect(
    dialog.getByRole('radio', { name: /My machine \(from Crapless bubble craps\)/ }),
  ).toBeChecked()
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: 'New game' })).toHaveCount(0)
  await expect
    .poll(async () => (await hookState(page))?.machineId)
    .toBe('my-machine-from-crapless-bubble-craps')
})

test('a game saved to a file loads back to the same hash after a new game; a corrupt file is refused', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto(
    appUrl({ seed: 'm12-files', bankroll: '500', script: '2-2,3-3', dice: 'instant' }),
  )
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page) // point 4
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:6').click()
  await chip(page, '$1.00').click()
  await zone(page, 'place:place:6').click()
  await rollAndSettle(page) // 3-3: place 6 pays $7
  const exported = await sessionHash(page)
  expect(exported).not.toBeNull()

  // Save the game to a file.
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('button', { name: 'Save or load files…' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save this game to a file' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^bubble-craps-session-.*\.json$/)
  const text = await readFile(await download.path(), 'utf8')

  // Clear: a new game replaces it.
  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click()
  await page
    .getByRole('dialog', { name: 'New game' })
    .getByRole('button', { name: 'Start' })
    .click()
  await expect.poll(() => sessionHash(page)).not.toBe(exported)
  await closeEndedSummary(page)

  // A corrupt file is refused; the game in play is untouched.
  const fresh = await sessionHash(page)
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('button', { name: 'Save or load files…' }).click()
  const input = page.getByTestId('files-input')
  await input.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text.slice(0, text.length / 2)),
  })
  await expect(page.getByRole('alert')).toHaveText('Not loaded: The file is not valid JSON.')
  expect(await sessionHash(page)).toBe(fresh)

  // Import: the very game that was exported.
  await input.setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await page.getByRole('button', { name: 'Load this game' }).click()
  await expect.poll(() => sessionHash(page)).toBe(exported)
  await expect(page.getByTestId('meter-credit')).toHaveText('$496.00') // 500 − 5 − 6 + 7

  // Stored as the active game: a reload resumes it.
  await waitForSaved(page)
  await page.goto('/')
  await expect(page.getByTestId('meter-credit')).toHaveText('$496.00')
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')
  expect(await sessionHash(page)).toBe(exported)
})

/** Serious and critical axe findings in the open dialog, WCAG 2.2's target size included. */
async function blockingFindings(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .options({ rules: { 'target-size': { enabled: true } } })
    .analyze()
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    )
}

test('the machine views pass axe with no serious finding', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(appUrl({ seed: 'm12-axe', dice: 'instant' }))
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('button', { name: 'Match my machine…' }).click()
  await expect(page.getByTestId('match-my-machine')).toBeVisible()
  expect(await blockingFindings(page)).toEqual([])

  await page.getByRole('button', { name: 'Review in the editor' }).click()
  await expect(page.getByTestId('editor-status')).toHaveText(/ready to save/, CHECKED)
  await openSection(page, 'catalog/place')
  await openSection(page, 'money')
  await fieldInput(page, '/catalog/place/pays/6').fill('7:5')
  await expect(page.getByTestId('editor-status')).toHaveText(/problem/, CHECKED)
  expect(await blockingFindings(page)).toEqual([])

  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Save or load files…' }).click()
  await expect(page.getByTestId('files-panel')).toBeVisible()
  expect(await blockingFindings(page)).toEqual([])
})
