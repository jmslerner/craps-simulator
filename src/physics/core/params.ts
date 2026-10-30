/**
 * Every physics tunable, in one place. Units: 1 u = one die edge (19 mm), seconds, radians.
 * Starting values come from implementation-plan §7. Tune with `node scripts/physics-stats.ts`.
 * Changing any value changes recordings, so the golden hash in simulate.test.ts must be re-pinned.
 * Recordings carry `paramsFingerprint(params)`, so no plan pairs a recording with other params.
 */
import { createHasher } from './hash.ts'

export interface SurfaceParams {
  readonly friction: number
  readonly restitution: number
}

export interface DieParams extends SurfaceParams {
  /** Half-extent of the inner cuboid; plus the border radius it gives the 0.5 u half-size. */
  readonly halfExtent: number
  readonly borderRadius: number
  readonly linearDamping: number
  readonly angularDamping: number
  /**
   * Soft-CCD prediction distance, u: contacts are predicted this far ahead, so a fast die meets
   * the floor or dome instead of sinking into it for a step. Hard CCD only prevents tunnelling.
   */
  readonly softCcd: number
}

export interface FloorParams extends SurfaceParams {
  /** A fixed slab with its top at y = 0, wider than the dome so the dome's rim sits on it. */
  readonly halfWidth: number
  readonly thickness: number
}

export interface DomeParams extends SurfaceParams {
  /** Inner radius of the hemisphere, centred on the floor centre. */
  readonly radius: number
  /** Trimesh resolution: segments around, rings from the floor to the pole. */
  readonly segments: number
  readonly rings: number
}

/** One impulse burst from under the floor centre: the popper, or the gentler fallback drop. */
export interface KickParams {
  /** Length of the burst, s. */
  readonly duration: number
  /** Upward launch speed at the floor centre, u/s, drawn per die. */
  readonly launchMin: number
  readonly launchMax: number
  /** Radial falloff: a die r from the centre gets launch × (1 − falloff·(r/R)²). */
  readonly falloff: number
  /** Sideways jitter, u/s, uniform over a disc of this radius. */
  readonly lateral: number
  /** Extra speed toward the centre, u/s per u of distance from it. */
  readonly inward: number
  /** Spin, rad/s, about a uniformly random axis. */
  readonly spinMin: number
  readonly spinMax: number
}

export interface SettleParams {
  /** Both dice count as still below these speeds, u/s and rad/s... */
  readonly linear: number
  readonly angular: number
  /** ...once they have stayed below them this long, s (or as soon as both sleep). */
  readonly hold: number
}

export interface ValidityParams {
  readonly maxTiltDeg: number
  /** Centre height of a die lying flat, and how far from it a valid rest may be. */
  readonly restHeight: number
  readonly heightTolerance: number
  /** Latest simulated time at which the dice may come to rest, s. */
  readonly maxSettleTime: number
  /** How far a resting die may press into the dome wall and still count as inside, u. */
  readonly wallTolerance: number
  /**
   * How deep a die may press into the floor, the dome or the other die at any physics step, u, not
   * only at the 60 Hz frames shown. Solver contacts sink a little at impacts; deeper means a die
   * went into or through something. Held at every step, it fails about 1 first throw in 900.
   */
  readonly maxOverlap: number
}

export interface FallbackParams {
  /** Seeded re-pops after an invalid first throw. */
  readonly popRetries: number
  /** Low-energy drops after that, before the analytic hop that is valid by construction. */
  readonly dropTries: number
}

/** The analytic hop: a scripted parabola that lands both dice flat near the centre. */
export interface HopParams {
  readonly airTime: number
  /** Height of the arc above the straight line from take-off to landing, u. */
  readonly apex: number
  /** Whole extra turns each die makes in the air; they hide the face snap. */
  readonly turns: number
  /** Landing distance of each die from the floor centre, u. */
  readonly landing: number
  /**
   * Spare room a die needs from the floor, the dome and the other die before it may tumble, on
   * top of its circumradius, u. Until then it keeps its start orientation.
   */
  readonly margin: number
}

/** Fresh rest poses for first load, restore and fallback (synthesizeRest). */
export interface RestParams {
  /** Dice are placed within this distance of the floor centre, u. */
  readonly spread: number
  /** Minimum distance between the dice centres; √2 keeps footprints apart at any yaw. */
  readonly minSeparation: number
}

export interface SnapParams {
  /**
   * Clearance from the floor, dome and other die for a frame to count as airborne, u; the die
   * must also have touched nothing at any step since the previous frame.
   */
  readonly airborneClearance: number
  /** Slowest turn, rad/s over a frame, that hides a change of drawn face. */
  readonly minTurnRate: number
}

/**
 * The handoff (§7 Face remap, M10b): the drawn cube rotation blends from the start offset to the
 * end offset over a window of frames in which the die is airborne, clear of everything by more
 * than its circumradius and turning fast, so the blend is lost in the tumble and the drawn die,
 * whatever it shows, never meets the floor, the dome or the other die (handoff.ts).
 */
export interface HandoffParams {
  /** The window's length, s: no shorter than `minDuration`, clipped to `maxDuration`. */
  readonly minDuration: number
  readonly maxDuration: number
  /**
   * Spare room the die's bounding ball keeps throughout the window, u: its centre at least the
   * circumradius plus this above the floor and inside the dome's inscribed sphere, and twice the
   * circumradius plus this from the other die's centre. §10's centre-based thresholds (√3/2 +
   * 0.05 and √3 for a unit cube), restated over the die's own circumradius (P1b).
   */
  readonly margin: number
  /** Slowest turn, rad/s over a frame, at any frame of the window. */
  readonly minTurnRate: number
}

/** How Rapier resolves contacts, and when a recording flags one. */
export interface ContactParams {
  /**
   * Contact stiffness as a natural frequency, Hz. A resting die sinks about g/(2πf)², so
   * Rapier's default of 30 Hz, meant for metre-sized bodies under 9.81 m/s², lets it sink
   * 0.015 u; 300 Hz keeps it under 0.002 u.
   */
  readonly frequency: number
  /** Gauss-Seidel passes inside each solver iteration. */
  readonly pgsIterations: number
  /** Penetration the solver leaves uncorrected, u (Rapier's normalised value; length unit 1). */
  readonly allowedError: number
  /** CCD substeps per step: more lets a fast die meet two surfaces in one step. */
  readonly ccdSubsteps: number
  /** Rapier's contact skin on each die, u: colliders touch this far apart. */
  readonly skin: number
  /** A recording flags a die as touching a surface while its gap to it is at most this, u. */
  readonly touchGap: number
}

export interface PhysicsParams {
  /** Gravity along y, u/s²: 9.81 m/s² over a 19 mm edge. */
  readonly gravity: number
  /** Physics step, s. */
  readonly timestep: number
  /** Rapier's constraint-solver iterations per step (World.numSolverIterations). */
  readonly solverIterations: number
  readonly contact: ContactParams
  /** Physics steps per recorded frame: 480 Hz stepping recorded at 60 Hz. */
  readonly stepsPerFrame: number
  readonly die: DieParams
  readonly floor: FloorParams
  readonly dome: DomeParams
  readonly pop: KickParams
  readonly drop: KickParams
  readonly settle: SettleParams
  readonly validity: ValidityParams
  readonly fallback: FallbackParams
  readonly hop: HopParams
  readonly rest: RestParams
  readonly snap: SnapParams
  readonly handoff: HandoffParams
}

export const DEFAULT_PARAMS: PhysicsParams = {
  gravity: -516,
  // 480 Hz rather than the plan's 240 Hz, and stiffer contacts than Rapier's default: at 240 Hz
  // and 30 Hz, dice sat 0.03 u into the floor at rest and overlapped by up to 0.18 u in sustained
  // contact (6000 throws). Now, per 60 Hz frame, 0.002 u at rest and at most 0.036 u in sustained
  // contact (`physics-stats --seeds 6000`, base 1, sessions of 10; bases 2 and 3 gave 0.024 and
  // 0.023 u), and about 5 ms per throw in Node.
  timestep: 1 / 480,
  solverIterations: 8,
  contact: {
    frequency: 300,
    pgsIterations: 1,
    allowedError: 0.001,
    ccdSubsteps: 1,
    skin: 0,
    touchGap: 0.005,
  },
  stepsPerFrame: 8,
  die: {
    halfExtent: 0.42,
    borderRadius: 0.08,
    friction: 0.4,
    restitution: 0.35,
    linearDamping: 0,
    angularDamping: 0,
    softCcd: 0.25,
  },
  floor: { halfWidth: 8, thickness: 1, friction: 0.6, restitution: 0.25 },
  dome: { radius: 7.5, segments: 48, rings: 16, friction: 0.25, restitution: 0.45 },
  pop: {
    duration: 0.07,
    launchMin: 70,
    launchMax: 95,
    falloff: 0.3,
    lateral: 15,
    inward: 0,
    spinMin: 15,
    spinMax: 35,
  },
  drop: {
    duration: 0.07,
    launchMin: 35,
    launchMax: 45,
    falloff: 0,
    lateral: 3,
    inward: 4,
    spinMin: 6,
    spinMax: 14,
  },
  settle: { linear: 0.05, angular: 0.1, hold: 0.3 },
  validity: {
    maxTiltDeg: 4,
    restHeight: 0.5,
    heightTolerance: 0.03,
    maxSettleTime: 4.5,
    wallTolerance: 0.05,
    maxOverlap: 0.1,
  },
  fallback: { popRetries: 8, dropTries: 4 },
  hop: { airTime: 0.5, apex: 2.5, turns: 2, landing: 1, margin: 0.05 },
  rest: { spread: 2.5, minSeparation: 1.6 },
  snap: { airborneClearance: 0.05, minTurnRate: 6 },
  handoff: { minDuration: 0.1, maxDuration: 0.25, margin: 0.05, minTurnRate: 12 },
}

const fingerprints = new WeakMap<PhysicsParams, string>()

/**
 * A 16-hex-digit hash of every value in `params`, keys sorted, so equal params always agree.
 * Recordings carry it, and buildPlaybackPlan refuses a recording made with other params.
 */
export function paramsFingerprint(params: PhysicsParams): string {
  const cached = fingerprints.get(params)
  if (cached !== undefined) return cached
  const hasher = createHasher()
  const text = canonicalJson(params)
  for (let i = 0; i < text.length; i++) hasher.mix(text.charCodeAt(i))
  const fingerprint = hasher.digest()
  fingerprints.set(params, fingerprint)
  return fingerprint
}

/** JSON with object keys sorted at every level; numbers print the same in every JS engine. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const fields = entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}
