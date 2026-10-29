/**
 * When a throw is over (§7 Settled): both dice below the speed limits for the hold time, or both
 * asleep. Counted in physics steps rather than seconds, so the answer is exact and deterministic.
 */
import type { SettleParams } from './params.ts'

export interface Velocity {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** One die is still when both its linear and angular speeds are under the limits. */
export function isStill(linvel: Velocity, angvel: Velocity, settle: SettleParams): boolean {
  const v2 = linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z
  const w2 = angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z
  return v2 < settle.linear * settle.linear && w2 < settle.angular * settle.angular
}

export interface SettleTracker {
  /** Feeds the state after `step`; true from the step at which the dice count as settled. */
  observe(step: number, still: boolean, asleep: boolean): boolean
  /** The step at which the dice came to rest for good, or -1 while they have not. */
  restStep(): number
}

export function createSettleTracker(settle: SettleParams, timestep: number): SettleTracker {
  const holdSteps = Math.round(settle.hold / timestep)
  let since = -1
  let settled = false
  return {
    observe(step, still, asleep) {
      if (settled) return true
      if (!still && !asleep) {
        since = -1
        return false
      }
      if (since < 0) since = step
      settled = asleep || step - since >= holdSteps
      return settled
    },
    restStep: () => (settled ? since : -1),
  }
}
