/**
 * The popper: a short upward impulse burst from under the floor centre, as on a bubble craps
 * machine. The same model with gentler numbers is the fallback drop.
 */
import type { KickParams } from './params.ts'
import { inDisc, onSphere, type Prng } from './prng.ts'
import type { Vec3 } from './quat.ts'
import type { DicePoses, Pose } from './restPose.ts'

/** The total velocity change a burst gives one die, spread evenly over the burst's steps. */
export interface Kick {
  /** u/s */
  readonly linear: Vec3
  /** rad/s */
  readonly angular: Vec3
}

/** Draws both dice's kicks, die 0 first, so a seed always gives the same pair. */
export function drawKicks(
  prng: Prng,
  start: DicePoses,
  kick: KickParams,
  domeRadius: number,
): [Kick, Kick] {
  return [drawKick(prng, start[0], kick, domeRadius), drawKick(prng, start[1], kick, domeRadius)]
}

function drawKick(prng: Prng, pose: Pose, kick: KickParams, domeRadius: number): Kick {
  const [x, , z] = pose.p
  const r = Math.min(Math.sqrt(x * x + z * z), domeRadius)
  // Radial falloff: the burst comes from the centre, so a die near the wall gets less of it.
  const falloff = Math.max(0, 1 - kick.falloff * (r / domeRadius) ** 2)
  const launch = prng.range(kick.launchMin, kick.launchMax) * falloff
  const [jx, jz] = inDisc(prng)
  const axis = onSphere(prng)
  const spin = prng.range(kick.spinMin, kick.spinMax)
  return {
    linear: [jx * kick.lateral - x * kick.inward, launch, jz * kick.lateral - z * kick.inward],
    angular: [axis[0] * spin, axis[1] * spin, axis[2] * spin],
  }
}

/** The burst's length in physics steps, at least one. */
export function burstSteps(kick: KickParams, timestep: number): number {
  return Math.max(1, Math.round(kick.duration / timestep))
}
