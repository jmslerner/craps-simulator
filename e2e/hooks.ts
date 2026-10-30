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

interface CrapsTestHook {
  getState(): HookState
  sessionHash(): string | null
  queueDice(dice: string): boolean
  storedHead(): Promise<StoredHead | null>
  analyze(typeId: string, number?: number | null): ZoneBadgeProbe | null
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

export function hookState(page: Page): Promise<HookState | null> {
  return page.evaluate(() => __CRAPS_TEST__?.getState() ?? null)
}

export function sessionHash(page: Page): Promise<string | null> {
  return page.evaluate(() => __CRAPS_TEST__?.sessionHash() ?? null)
}

export function storedHead(page: Page): Promise<StoredHead | null> {
  return page.evaluate(() => __CRAPS_TEST__?.storedHead() ?? null)
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
