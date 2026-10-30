import { expect, test, type Locator } from '@playwright/test'
import { appUrl, chip, openCoach, zone } from './hooks.ts'

/**
 * The §10 M9c advice check, UI half: on a machine whose buy vig is taken from the win
 * (traditionalBubble), a placed Place 4 offers "Switch to Buy 4" in the inspector, the one-tap
 * switch converts the bet through a single batch, and the layout meter (M9d) drops. (The money and
 * claim checks live in the coach audit harness.)
 */

test('Place 4 on an on-win preset offers Switch to Buy; the tap converts and the meter drops', async ({
  page,
}) => {
  await page.goto(
    appUrl({ seed: 'm9c-advice', preset: 'traditionalBubble', dice: 'instant', bankroll: '500' }),
  )
  await chip(page, '$5.00').click()
  const place4 = zone(page, 'place:place:4')
  await place4.click()
  await place4.click()
  await place4.click()
  await expect(place4.locator('.zone-amount')).toHaveText('$15')

  // The meter prices the standing place before the switch (worker round trip, hence the wait).
  const headline = page.getByTestId('meter-per-roll')
  await expect(headline).toContainText('a roll')
  const costBefore = await meterDollars(headline)

  // INFO mode, then a tap, opens the inspector (the designed touch path on every project).
  await page.getByRole('button', { name: 'Info' }).click()
  await place4.click()

  const dialog = page.getByRole('dialog')
  const fix = dialog.getByTestId('advice-fix-same-event')
  await expect(fix).toHaveText('Switch to Buy 4')
  await fix.click()

  // The bet converted: same stake, now on the buy strip; the place cell is empty again.
  await expect(zone(page, 'buy:buy:4').locator('.zone-amount')).toHaveText('$15')
  await expect(place4.locator('.zone-amount')).toHaveCount(0)

  // …and the meter drops: the buy stands cheaper a roll here, as the advice claimed (§10 M9c).
  await expect
    .poll(() => meterDollars(headline), { message: 'the meter re-prices the converted layout' })
    .toBeLessThan(costBefore)
})

/** The headline's dollar figure, parsed only so the drop can be compared, never re-shown. */
async function meterDollars(headline: Locator): Promise<number> {
  const text = (await headline.textContent()) ?? ''
  const figure = /\$([0-9,]+\.[0-9]{2})/.exec(text)?.[1]
  if (figure === undefined) throw new Error(`no dollar figure in the meter headline: "${text}"`)
  return Number(figure.replace(/,/g, ''))
}

test('the guide states what a 7 would do, and No thanks dismisses the idea for good', async ({
  page,
}) => {
  await page.goto(appUrl({ seed: 'm9c-seven', dice: 'instant', bankroll: '500' }))
  const bar = page.getByTestId('next-step')
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await zone(page, 'place:place:6').click()

  // The come-out roll step names the 7's full effect, computed by the engine (plan §0 #18). On
  // the e2e machine the winning pass RETURNS its stake (`/catalog/pass/afterWin` pinned to
  // `return`, M4 → M8 hand-off), so the engine's own line shows the return and a flat net.
  await expect(bar.locator('.guide-text')).toHaveText(
    'Roll the dice to set the point for your Pass Line. ' +
      'A seven now: wins you $5.00, takes $5.00, returns $5.00 — net $0.00.',
  )

  // The optional idea (Bets Off for the come-out) is dismissible by id and stays gone. The
  // guide's detail is in the Coach drawer (plan §0 #28), collapsed on narrow screens.
  await openCoach(page)
  await expect(bar.getByTestId('guide-alt')).toHaveText('Bets Off for the come-out')
  await bar.getByTestId('guide-dismiss').click()
  await expect(bar.getByTestId('guide-alt')).toBeDisabled()
  await expect(bar.getByTestId('guide-dismiss')).toBeDisabled()
})
