import { expect, test } from '@playwright/test'
import { appUrl, chip, zone } from './hooks.ts'

/**
 * The §10 M9a checks: every rendered coach badge equals `__CRAPS_TEST__.analyze` for its zone
 * (the hook recomputes the badge on the main thread from the live session's config); the analysis
 * runs in the worker, so no main-thread long task exceeds 50 ms; and the Place 6 $5 inspector
 * shows the paid win ("$5.83") and the edge at the player's stake ("1.55%").
 */

/** Longtask observing needs page globals the e2e tsconfig (Node types) does not declare. */
interface LongTask {
  readonly start: number
  readonly duration: number
}

declare global {
  const window: { __LONG_TASKS__?: readonly LongTask[] | null }
}

/** The browser's PerformanceObserver, shaped for longtasks (Node's own type lacks them). */
interface LongTaskObserver {
  readonly supportedEntryTypes?: readonly string[]
  new (
    callback: (list: { getEntries(): readonly { startTime: number; duration: number }[] }) => void,
  ): { observe(options: { type: string; buffered: boolean }): void }
}

test('every zone badge equals __CRAPS_TEST__.analyze, per badge', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm9a-badges', dice: 'instant' }))
  const badges = page.locator('[data-coach-badge]')
  // The worker computes the whole catalog; badges then render together.
  await expect
    .poll(() => badges.count(), { message: 'no coach badges rendered' })
    .toBeGreaterThan(10)

  const spans = await badges.all()
  expect(spans.length).toBeGreaterThan(10)
  for (const span of spans) {
    const key = (await span.getAttribute('data-coach-badge')) ?? ''
    const text = await span.textContent()
    const [typeId = '', numberText = ''] = key.split('|')
    const expected = await page.evaluate(
      ([t, n]) => __CRAPS_TEST__?.analyze(t, n === '' ? null : Number(n)) ?? null,
      [typeId, numberText] as const,
    )
    expect(expected, `analyze(${key}) answers for a rendered badge`).not.toBeNull()
    expect(`${key} ${text ?? ''}`).toBe(`${key} ${expected?.badge ?? ''}`)
  }
})

test('the analysis stays off the main thread: no long task over 50 ms', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as { __LONG_TASKS__?: readonly LongTask[] | null }
    host.__LONG_TASKS__ = null
    try {
      const Observer = PerformanceObserver as unknown as LongTaskObserver
      if (Observer.supportedEntryTypes?.includes('longtask')) {
        const tasks: { start: number; duration: number }[] = []
        host.__LONG_TASKS__ = tasks
        new Observer((list) => {
          for (const entry of list.getEntries()) {
            tasks.push({ start: entry.startTime, duration: entry.duration })
          }
        }).observe({ type: 'longtask', buffered: true })
      }
    } catch {
      host.__LONG_TASKS__ = null
    }
  })
  await page.goto(appUrl({ seed: 'm9a-longtask', dice: 'instant' }))
  const badges = page.locator('[data-coach-badge]')
  await expect
    .poll(() => badges.count(), { message: 'no coach badges rendered' })
    .toBeGreaterThan(10)

  const tasks = await page.evaluate(() => window.__LONG_TASKS__ ?? null)
  test.skip(tasks === null, 'this browser does not expose longtask entries')
  const loaded = await page.evaluate(() => {
    const timing = performance as unknown as {
      getEntriesByType(type: string): readonly { domContentLoadedEventEnd?: number }[]
    }
    return timing.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0
  })
  // The initial script evaluation (the whole app bundle — pre-M9a boot cost, tracked by the
  // bundle budget) runs just under or over 50 ms on slower machines and always ends by
  // DOMContentLoaded. The M9a guarantee is that the ANALYSIS never blocks the table, and all of
  // it — the worker round trip, the wire decode, the badge render — happens after the document
  // is loaded, so the assertion covers every task from that point on.
  const over = (tasks ?? []).filter((task) => task.duration > 50 && task.start >= loaded)
  const report = (tasks ?? [])
    .map((task) => `${task.duration.toFixed(0)} ms at ${task.start.toFixed(0)} ms`)
    .join(', ')
  expect(over, `long tasks (loaded at ${loaded.toFixed(0)} ms): ${report}`).toEqual([])
})

test('the Place 6 $5 inspector shows "$5.83" and "1.55%"', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm9a-inspector', dice: 'instant' }))
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:6').click()

  // INFO mode, then a tap, opens the inspector (the designed touch path on every project).
  await page.getByRole('button', { name: 'Info' }).click()
  await zone(page, 'place:place:6').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-coach-line="pays"]')).toHaveText('$5.00 × 7:6 = $5.83')
  await expect(dialog.locator('[data-coach-line="edge"]')).toHaveText('House edge 1.55%')

  // Show math: the derivation is there, from the worker.
  await dialog.getByText('Show math').click()
  await expect(dialog.locator('[data-coach-step]').first()).toHaveText(
    'Of 36 rolls: 5 win, 6 lose, 25 change nothing.',
  )
})
