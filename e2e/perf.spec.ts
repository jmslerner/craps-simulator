import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { appUrl, chip, hookState, rollAndSettle, zone } from './hooks.ts'

/**
 * The §10 M14 performance checks, on desktop Chromium (the one engine with the long-task, event
 * timing and heap APIs these read): how fast the table comes up, how long a tap or a roll takes
 * to answer, and that 300 rolls leave no growing heap, DOM or listener count behind. Every figure
 * is attached to the test as an annotation, so a run reports the numbers; the bounds asserted are
 * deliberately loose (this 8 GB machine runs the suite beside other work), set to catch a
 * regression in kind — a leak, a main-thread stall — not to grade a fast run.
 */

/**
 * The web's responsiveness bars: an interaction within 200 ms is "good", over 500 ms "poor"
 * (INP). The run reports the real figures (tens of ms here); the assertion holds the "poor" line,
 * which a loaded e2e run (five browsers at once) must not blur into a false failure.
 */
const TAP_BUDGET_MS = 500
const ROLLS = 300

interface Timing {
  readonly start: number
  readonly duration: number
  readonly name: string
}

/** What the init script records, read back by `page.evaluate`. */
interface PerfProbe {
  longTasks: Timing[]
  events: Timing[]
  firstZone: number | null
  firstBadge: number | null
}

interface ProbeHost {
  __M14_PERF__?: PerfProbe
}

/** Long tasks, event timings and the first zone / badge on screen, from navigation on. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface EntryLike {
      readonly name: string
      readonly startTime: number
      readonly duration: number
    }
    interface ObserverCtor {
      new (callback: (list: { getEntries(): readonly EntryLike[] }) => void): {
        observe(options: { type: string; buffered?: boolean; durationThreshold?: number }): void
      }
    }
    interface MutationCtor {
      new (callback: () => void): {
        observe(target: unknown, options: { childList: boolean; subtree: boolean }): void
        disconnect(): void
      }
    }
    const host = globalThis as unknown as {
      __M14_PERF__?: PerfProbe
      PerformanceObserver: ObserverCtor
      MutationObserver: MutationCtor
      performance: { now(): number }
      document: { querySelector(selector: string): unknown }
    }
    const probe: PerfProbe = { longTasks: [], events: [], firstZone: null, firstBadge: null }
    host.__M14_PERF__ = probe
    const record = (into: Timing[]) => (list: { getEntries(): readonly EntryLike[] }) => {
      for (const entry of list.getEntries()) {
        into.push({ start: entry.startTime, duration: entry.duration, name: entry.name })
      }
    }
    try {
      new host.PerformanceObserver(record(probe.longTasks)).observe({
        type: 'longtask',
        buffered: true,
      })
      new host.PerformanceObserver(record(probe.events)).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      })
    } catch {
      // Not this engine: the figures stay empty and the test says so.
    }
    const watch = new host.MutationObserver(() => {
      if (probe.firstZone === null && host.document.querySelector('[data-zone]') !== null) {
        probe.firstZone = host.performance.now()
      }
      if (probe.firstBadge === null && host.document.querySelector('[data-coach-badge]') !== null) {
        probe.firstBadge = host.performance.now()
        watch.disconnect()
      }
    })
    // The document itself: its root element may not exist yet when this runs.
    watch.observe(host.document, { childList: true, subtree: true })
  })
}

function readProbe(page: Page): Promise<PerfProbe | null> {
  return page.evaluate(() => (globalThis as unknown as ProbeHost).__M14_PERF__ ?? null)
}

const ms = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'n/a' : `${value.toFixed(0)} ms`

/** Chromium alone exposes the long-task, event-timing and heap APIs read here. */
const CHROMIUM_ONLY = 'desktop-chromium'

test('the table comes up fast and taps answer quickly', async ({ page }, info) => {
  test.skip(info.project.name !== CHROMIUM_ONLY, 'Chromium alone exposes these APIs')
  await installProbe(page)
  await page.goto(appUrl({ seed: 'm14-perf', bankroll: '500', dice: 'instant' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  await expect.poll(() => page.locator('[data-coach-badge]').count()).toBeGreaterThan(10)

  const boot = await page.evaluate(() => {
    interface Nav {
      readonly domContentLoadedEventEnd: number
      readonly loadEventEnd: number
    }
    const perf = globalThis as unknown as {
      performance: {
        getEntriesByType(type: string): readonly { name: string; startTime: number }[]
        getEntriesByName(name: string): readonly { startTime: number }[]
      }
    }
    const nav = perf.performance.getEntriesByType('navigation')[0] as unknown as Nav | undefined
    const fcp = perf.performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
    return {
      fcp,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
    }
  })
  const probe = await readProbe(page)
  const longest = Math.max(0, ...(probe?.longTasks ?? []).map((task) => task.duration))
  info.annotations.push({
    type: 'boot',
    description:
      `first contentful paint ${ms(boot.fcp)}, DOMContentLoaded ${ms(boot.domContentLoaded)}, ` +
      `load ${ms(boot.load)}, first zone ${ms(probe?.firstZone)}, coach badges ` +
      `${ms(probe?.firstBadge)}; long tasks: ` +
      ((probe?.longTasks ?? [])
        .map((t) => `${t.duration.toFixed(0)} ms at ${t.start.toFixed(0)}`)
        .join(', ') || 'none'),
  })
  expect(probe?.firstZone ?? Infinity, 'the table renders within 3 s').toBeLessThan(3000)
  expect(longest, 'no main-thread task blocks for half a second').toBeLessThan(500)

  // Taps: chips, a bet on each place number, the pass line; then a roll (instant dice).
  await chip(page, '$5.00').click()
  for (const n of [4, 5, 6, 8, 9, 10]) await zone(page, `place:place:${n}`).click()
  await zone(page, 'line:pass').click()
  await expect(page.getByTestId('meter-bet')).toHaveText('$35.00')
  await rollAndSettle(page)
  // The event timing for the taps: input delay + handler + the next paint, per interaction.
  await expect.poll(async () => (await readProbe(page))?.events.length ?? 0).toBeGreaterThan(0)
  const events = ((await readProbe(page))?.events ?? []).filter((event) =>
    /^(pointerdown|pointerup|click|keydown)$/.test(event.name),
  )
  const worst = Math.max(0, ...events.map((event) => event.duration))
  const sorted = events.map((event) => event.duration).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  info.annotations.push({
    type: 'interaction',
    description:
      `${events.length} input events over 16 ms; median ${ms(median)}, worst ${ms(worst)} ` +
      `(${events.map((e) => `${e.name} ${e.duration.toFixed(0)}`).join(', ')})`,
  })
  expect(worst, 'no tap answers slower than the INP "poor" line').toBeLessThanOrEqual(TAP_BUDGET_MS)
})

/** The page's heap after a full collection, its DOM node and listener counts. */
async function footprint(
  page: Page,
  cdp: CDPSession,
): Promise<{ heap: number; nodes: number; listeners: number; outsideHistory: number }> {
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const counters = await cdp.send('Memory.getDOMCounters')
  // Elements outside the roll history: the table, the panels, the dome; they must not grow.
  const outsideHistory = await page.evaluate(() => {
    const doc = (
      globalThis as unknown as {
        document: { querySelectorAll(selector: string): { readonly length: number } }
      }
    ).document
    return doc.querySelectorAll('*').length - doc.querySelectorAll('.history *').length
  })
  return {
    heap: usedSize,
    nodes: counters.nodes,
    listeners: counters.jsEventListeners,
    outsideHistory,
  }
}

/**
 * The roll history keeps the newest `HISTORY_CAP` (300) rolls (src/ui/state/rollHistory.ts), so it
 * — and only it — grows for the first 300 rolls; past the cap the oldest roll leaves as each new
 * one arrives. The check rolls 300 times and then 30 more: outside the history the listeners stay
 * level and the elements only follow what the table shows, and past the cap the whole page —
 * heap and DOM — holds level.
 */
const PAST_CAP = 30

test(`${ROLLS} rolls leave no growing heap, DOM or listeners`, async ({ page }, info) => {
  test.skip(info.project.name !== CHROMIUM_ONLY, 'Chromium alone exposes these APIs')
  // Each roll holds its reveal for 600 ms (plan §6), so 330 rolls take about five minutes.
  test.setTimeout(12 * 60_000)
  await page.goto(appUrl({ seed: 'm14-memory', bankroll: '5000', dice: 'instant' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$5,000.00')
  await page.waitForFunction(
    () => (globalThis as { __CRAPS_TEST__?: unknown }).__CRAPS_TEST__ !== undefined,
  )
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.enable')
  await chip(page, '$5.00').click()

  type Sample = { roll: number } & Awaited<ReturnType<typeof footprint>>
  const samples: Sample[] = []
  for (let roll = 1; roll <= ROLLS + PAST_CAP; roll++) {
    // The pass line back up on every come-out (the machine's $5 minimum is met by working bets,
    // and a place bet is off on the come-out), and a place 6 that stays up between decisions.
    for (const key of ['line:pass', 'place:place:6']) {
      const spot = zone(page, key)
      if ((await spot.locator('.zone-amount').count()) === 0) {
        await spot.click()
        await expect(spot.locator('.zone-amount')).toHaveCount(1)
      }
    }
    await rollAndSettle(page)
    if (roll === 50 || roll % 100 === 0 || roll === ROLLS + PAST_CAP) {
      samples.push({ roll, ...(await footprint(page, cdp)) })
    }
  }
  expect((await hookState(page))?.rollIndex).toBe(ROLLS + PAST_CAP)
  const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(2)} MB`
  info.annotations.push({
    type: 'memory',
    description: samples
      .map(
        (s) =>
          `roll ${s.roll}: heap ${mb(s.heap)}, ${s.nodes} nodes ` +
          `(${s.outsideHistory} elements outside the history), ${s.listeners} listeners`,
      )
      .join('; '),
  })
  const first = samples[0]
  const atCap = samples.find((s) => s.roll === ROLLS)
  const last = samples[samples.length - 1]
  if (first === undefined || atCap === undefined || last === undefined) {
    throw new Error('missing memory samples')
  }
  // Outside the history nothing builds up: listeners stay exactly level, and the element count
  // only moves with what the table shows at that moment (chips, the Next roll panel's lines).
  const outside = samples.map((s) => s.outsideHistory)
  expect(
    Math.max(...outside) - Math.min(...outside),
    'spread of the elements outside the history',
  ).toBeLessThan(400)
  for (const sample of samples) {
    expect(sample.listeners, `listeners at roll ${sample.roll}`).toBe(first.listeners)
  }
  // Past the cap the history stops growing too: only the session log (bytes a roll) may.
  expect(last.nodes - atCap.nodes, 'DOM nodes past the history cap').toBeLessThan(300)
  expect(last.heap - atCap.heap, 'heap past the history cap').toBeLessThan(1_048_576)
})
