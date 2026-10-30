import { expect, type Page } from '@playwright/test'

/**
 * Shared plumbing for the M8 specs (plan §6 test hooks, §10 M8). e2e/ compiles with Node types
 * only (tsconfig.node.json), so the page globals the `evaluate` callbacks touch are declared here,
 * shaped exactly as the specs read them. Dice are scripted only through the boot URL
 * (`?script=1-1,3-3`) or `queueDice`, which feed the engine's one scripted-dice door
 * (`rollWindow(ws, cfg, dice)`): every assertion is against real engine output. All waits are on
 * state — the hook, the stored session head or visible text — never sleeps (flake policy).
 */

/** What `__CRAPS_TEST__.getState()` returns, as the specs read it. */
export interface HookState {
  readonly phase: 'betting' | 'rolling' | 'revealing' | null
  readonly bankroll: number | null
  readonly rollIndex: number | null
  readonly pendingActions: number
  readonly committedRolls: number
  readonly machineId: string | null
  readonly state: {
    readonly lastRoll: { readonly dice: { readonly d1: number; readonly d2: number } } | null
  } | null
}

/** The stored `session:<id>:head` flags (plan §8), via the hook's `storedHead()`. */
export interface StoredHead {
  readonly pendingReveal: boolean
  readonly windowCount: number
  readonly stateHash: string
}

/** `analyze`'s answer (plan §10 M9a): the badge text a zone must render, character for character. */
export interface ZoneBadgeProbe {
  readonly badge: string
  readonly grade: string
  readonly amount: number
}

/** One die as the 3D readout reads it off its mesh (src/ui/services/testHooks.ts). */
export interface DieReadout {
  readonly visible: boolean
  /** Pips counted on the texture of the face whose normal points most nearly up. */
  readonly face: number
  readonly up: number
  /** That face's corners on the canvas, CSS px from its top-left. */
  readonly corners: readonly (readonly [number, number])[]
}

/** `domeReadout()`: the 3D dice as drawn, read independently of the dome's remap tables. */
export interface DomeReadout {
  readonly state: 'idle' | 'playing' | 'settled'
  /** The last frame drawn was at rest (no throw playing, the camera arrived). */
  readonly still: boolean
  /** The body drawing the engine's d1. */
  readonly d1Body: 0 | 1
  readonly canvas: { readonly width: number; readonly height: number }
  readonly dice: readonly [DieReadout, DieReadout]
}

interface CrapsTestHook {
  getState(): HookState
  sessionHash(): string | null
  queueDice(dice: string): boolean
  storedHead(): Promise<StoredHead | null>
  analyze(typeId: string, number?: number | null): ZoneBadgeProbe | null
  domeReadout(): DomeReadout | null
}

declare global {
  // Installed by src/ui/services/testHooks.ts, in --mode e2e builds only.
  const __CRAPS_TEST__: CrapsTestHook | undefined
  // The one DOM read the specs make (no DOM lib in this tsconfig).
  const document: {
    readonly documentElement: { readonly scrollWidth: number; readonly clientWidth: number }
  }
}

/** A boot URL with test parameters; every spec passes at least `seed`, so the boot is forced. */
export function appUrl(params: Readonly<Record<string, string>>): string {
  return `/?${new URLSearchParams(params).toString()}`
}

/*
 * The readers below return null, rather than throw a ReferenceError, while the hook is not yet
 * installed (the boot installs it once the table is in the store), so a poll simply retries.
 */

export function hookState(page: Page): Promise<HookState | null> {
  return page.evaluate(() =>
    typeof __CRAPS_TEST__ === 'undefined' ? null : __CRAPS_TEST__.getState(),
  )
}

export function sessionHash(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    typeof __CRAPS_TEST__ === 'undefined' ? null : __CRAPS_TEST__.sessionHash(),
  )
}

/** The 3D dice as drawn; null while no 3D renderer is live. */
export function domeReadout(page: Page): Promise<DomeReadout | null> {
  return page.evaluate(() =>
    typeof __CRAPS_TEST__ === 'undefined' ? null : __CRAPS_TEST__.domeReadout(),
  )
}

export function storedHead(page: Page): Promise<StoredHead | null> {
  return page.evaluate(() =>
    typeof __CRAPS_TEST__ === 'undefined' ? null : __CRAPS_TEST__.storedHead(),
  )
}

/** Waits until the stored head holds exactly the live table, so a reload must restore it. */
export async function waitForSaved(page: Page): Promise<void> {
  const live = await sessionHash(page)
  expect(live).not.toBeNull()
  await expect
    .poll(async () => (await storedHead(page))?.stateHash ?? null, {
      message: 'the stored session head never caught up with the live table',
    })
    .toBe(live)
}

/**
 * Opens the Coach drawer (plan §0 #28) where it is collapsed — under 1400 px wide by default, so on
 * the phone projects, chromium-3d and the 375 px checks — and waits until it shows. A drawer that is
 * already open (docked from 1400 px) is left as it is.
 */
export async function openCoach(page: Page): Promise<void> {
  const toggle = page.getByTestId('coach-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.locator('#coach-drawer')).toBeVisible()
}

/**
 * Closes the Coach drawer where an open drawer covers the felt: a bottom sheet under 1000 px wide.
 * From 1000 px an open drawer docks beside the felt and stays open.
 */
export async function closeCoachSheet(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0
  const toggle = page.getByTestId('coach-toggle')
  if (width >= 1000 || (await toggle.getAttribute('aria-expanded')) !== 'true') return
  await page.getByRole('button', { name: 'Close the coach' }).click()
  await expect(page.locator('#coach-drawer')).toBeHidden()
}

/** The ROLL button; `exact` keeps the guide's "Or just roll" out of the match. */
export function rollButton(page: Page) {
  return page.getByRole('button', { name: 'ROLL', exact: true })
}

/** The chip-rail button for a rack chip, by its aria-label ("$5.00 chip…"). */
export function chip(page: Page, label: '$1.00' | '$5.00' | '$10.00') {
  return page.getByRole('button', { name: new RegExp(`\\${label.replace('.', '\\.')} chip`) })
}

export function zone(page: Page, key: string) {
  return page.locator(`[data-zone="${key}"]`)
}

/**
 * Clicks ROLL and waits for the roll to commit and the betting window to reopen: rollIndex
 * advances by one and the phase returns to `betting` after the reveal hold.
 */
export async function rollAndSettle(page: Page): Promise<void> {
  const before = (await hookState(page))?.rollIndex ?? 0
  await rollButton(page).click()
  await expect
    .poll(
      async () => {
        const state = await hookState(page)
        return state === null ? null : { phase: state.phase, rollIndex: state.rollIndex }
      },
      { message: `roll ${before + 1} never settled back to betting` },
    )
    .toEqual({ phase: 'betting', rollIndex: before + 1 })
}
