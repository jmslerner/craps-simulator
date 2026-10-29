/**
 * Every physics tunable, in one place. Units: 1 u = one die edge (19 mm), seconds, radians.
 * Starting values come from implementation-plan §7; tune them with `node scripts/physics-stats.ts`.
 * Changing any value changes recordings, so the golden hash in simulate.test.ts must be re-pinned.
 */
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
}

export interface FloorParams extends SurfaceParams {
  /** A fixed cylinder with its top at y = 0, wider than the dome so its rim is always floored. */
  readonly radius: number
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
}

/** Fresh rest poses for first load, restore and fallback (synthesizeRest). */
export interface RestParams {
  /** Dice are placed within this distance of the floor centre, u. */
  readonly spread: number
  /** Minimum distance between the two dice centres; √2 stops footprints overlapping at any yaw. */
  readonly minSeparation: number
}

export interface SnapParams {
  /** Clearance from the floor, dome and other die for a frame to count as airborne, u. */
  readonly airborneClearance: number
}

export interface PhysicsParams {
  /** Gravity along y, u/s²: 9.81 m/s² over a 19 mm edge. */
  readonly gravity: number
  /** Physics step, s. */
  readonly timestep: number
  readonly solverIterations: number
  /** Physics steps per recorded frame: 240 Hz stepping recorded at 60 Hz. */
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
}

export const DEFAULT_PARAMS: PhysicsParams = {
  gravity: -516,
  timestep: 1 / 240,
  solverIterations: 8,
  stepsPerFrame: 4,
  die: {
    halfExtent: 0.42,
    borderRadius: 0.08,
    friction: 0.4,
    restitution: 0.35,
    linearDamping: 0,
    angularDamping: 0,
  },
  floor: { radius: 8, thickness: 1, friction: 0.6, restitution: 0.25 },
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
  },
  fallback: { popRetries: 8, dropTries: 4 },
  hop: { airTime: 0.5, apex: 2.5, turns: 2, landing: 1 },
  rest: { spread: 2.5, minSeparation: 1.6 },
  snap: { airborneClearance: 0.05 },
}
