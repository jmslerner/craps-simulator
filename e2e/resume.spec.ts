import { expect, test } from '@playwright/test'
import {
  appUrl,
  chip,
  hookState,
  rollAndSettle,
  rollButton,
  sessionHash,
  storedHead,
  waitForSaved,
  zone,
} from './hooks.ts'

/**
 * The §10 M8 persistence specs (plan §8): a reload mid-point restores the identical sessionHash,
 * and a reload during `pendingReveal` reveals the stored dice without re-rolling. The boot URL
 * parameters force a fresh session, so each "reload" is a plain `goto('/')`: exactly a player's
 * refresh, resuming the stored session from IndexedDB.
 */

test('a reload mid-point restores the identical sessionHash', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm8-resume', bankroll: '500', script: '1-1', dice: 'instant' }))
  const credit = page.getByTestId('meter-credit')
  await expect(credit).toHaveText('$500.00')

  // $5 pass, then the scripted 1-1: the point is 2, mid-round with a contract bet up.
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 2')
  await expect(credit).toHaveText('$495.00')

  await waitForSaved(page)
  const before = await sessionHash(page)
  expect(before).not.toBeNull()

  await page.goto('/')
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 2')
  await expect(credit).toHaveText('$495.00')
  expect(await sessionHash(page)).toBe(before)
})

test('a reload during pendingReveal reveals the same dice without re-rolling', async ({ page }) => {
  // 2D dice: the 700 ms tumble holds the view in `rolling` while the roll is already committed
  // to storage with pendingReveal: true (plan §6 roll flow step 2 — persisted BEFORE animation).
  await page.goto(appUrl({ seed: 'm8-reveal', bankroll: '500', script: '4-2', dice: '2d' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()

  await rollButton(page).click()
  // Deterministic wait on stored state, not on the animation: the head says the roll is stored
  // and unrevealed. The tumble outlasts this poll by design; a miss fails loudly here.
  await expect
    .poll(async () => (await storedHead(page))?.pendingReveal ?? false, {
      message: 'the roll was never stored with pendingReveal: true',
    })
    .toBe(true)
  const committed = await hookState(page)
  expect(committed?.committedRolls).toBe(1)
  const dice = committed?.state?.lastRoll?.dice ?? null
  expect(dice?.d1).toBe(4)
  expect(dice?.d2).toBe(2)

  // Reload before the reveal completes.
  await page.goto('/')

  // The stored outcome is revealed instantly: the same dice at rest, and no new roll.
  const view = page.getByTestId('dice-view')
  await expect(view).toHaveAttribute('data-dice', '4-2')
  await expect(view).toHaveAttribute('data-state', 'settled')
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 6')
  const after = await hookState(page)
  expect(after?.committedRolls).toBe(1)
  expect(after?.rollIndex).toBe(committed?.rollIndex)
  expect(after?.state?.lastRoll?.dice).toEqual(dice)
  expect(after?.bankroll).toBe(committed?.bankroll)

  // The flag has done its work: the next reload is an ordinary resume.
  await expect.poll(async () => (await storedHead(page))?.pendingReveal).toBe(false)
})
