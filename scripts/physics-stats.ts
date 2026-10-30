/**
 * Tuning report for the headless dice physics: `node scripts/physics-stats.ts --seeds 300`.
 *
 * Plays sessions the way the app will: each throw starts from the previous throw's rest poses, and
 * each session starts from synthesizeRest. Each throw is planned for seeded dice twice: in snap
 * mode (M10a's single-frame switch, the fallback) and in handoff mode, which is how the dome
 * plays it (M10b: the blend over a clear, fast-spinning window). The framing rows read the rests
 * through the dome's camera (src/dome/camera.ts) on the 358×224 desktop canvas: where the read
 * framing puts the top faces, and where M10a's fixed station camera would have. Edit
 * src/physics/core/params.ts and rerun to tune.
 */
import { parseArgs } from 'node:util'
import {
  projectPoint,
  readFraming,
  reservedZones,
  topFaceCorners,
  type CameraPose,
  type CanvasSize,
} from '../src/dome/camera.ts'
import { Fraction } from '../src/engine/core/rational.ts'
import { DIE_FACES, type DieFace } from '../src/physics/core/cube.ts'
import { slowestTurn } from '../src/physics/core/handoff.ts'
import { DEFAULT_PARAMS } from '../src/physics/core/params.ts'
import { buildPlaybackPlan, synthesizeRest, type PlaybackPlan } from '../src/physics/core/plan.ts'
import { createPrng, deriveSeed } from '../src/physics/core/prng.ts'
import { angleBetween } from '../src/physics/core/quat.ts'
import { framePose, touchesAt } from '../src/physics/core/recording.ts'
import { naturalTopFace, type RestState } from '../src/physics/core/restPose.ts'
import { simulateThrow, type ThrowResult } from '../src/physics/core/simulate.ts'
import type { DepthProfile, Depths } from '../src/physics/core/validity.ts'
import { initPhysics } from '../src/physics/core/world.ts'

const USAGE = `Usage: node scripts/physics-stats.ts [--seeds N] [--chain L] [--base S] [--verbose]

Simulates N throws in sessions of L throws, each starting where the last one came to rest, and
prints first-attempt validity, fallback use, exact depths into the floor, the dome and the other
die (at any physics step, and at the 60 Hz frames that are shown), settle times, wall-clock cost,
contacts, how well the face snap hides, and natural top faces.

Options:
  --seeds N    number of throws (default 300)
  --chain L    throws per session (default 10)
  --base S     base seed, a uint32 in decimal or 0x hex (default 1)
  --verbose    list every invalid attempt
  -h, --help   show this help`

const OPTIONS = {
  seeds: { type: 'string', default: '300' },
  chain: { type: 'string', default: '10' },
  base: { type: 'string', default: '1' },
  verbose: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h' },
} as const

interface Sample {
  readonly index: number
  readonly result: ThrowResult
  /** Planned in snap mode. */
  readonly plan: PlaybackPlan
  /** The same recording and dice planned in handoff mode, as the dome plays it. */
  readonly handoff: PlaybackPlan
  readonly ms: number
}

async function main(args: string[]): Promise<number> {
  let options
  try {
    options = parseArgs({ args, options: OPTIONS }).values
  } catch (error) {
    console.error(`physics-stats: ${error instanceof Error ? error.message : String(error)}`)
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const count = positiveInt(options.seeds)
  const chain = positiveInt(options.chain)
  const base = uint32(options.base)
  if (count === undefined || chain === undefined) {
    console.error('physics-stats: --seeds and --chain must be positive integers')
    return 2
  }
  if (base === undefined) {
    console.error('physics-stats: --base must be a uint32, 0 to 4294967295 (0xffffffff)')
    return 2
  }

  await initPhysics()
  const samples: Sample[] = []
  // The engine's dice, drawn here only so each throw can be planned as the app would.
  const dice = createPrng(deriveSeed(base, 2 * count))
  const roll = (): DieFace => DIE_FACES[Math.floor(dice.next() * 6)] ?? 1
  let rest: RestState = synthesizeRest(base, [1, 1])
  for (let index = 0; index < count; index++) {
    if (index % chain === 0) rest = synthesizeRest(deriveSeed(base, index), [1, 1])
    const seed = deriveSeed(base, count + index)
    const began = performance.now()
    const result = simulateThrow(seed, rest)
    const ms = performance.now() - began
    // From the rest the throw started from: the one asked for, unless it could not start one.
    const dice = { d1: roll(), d2: roll() }
    const plan = buildPlaybackPlan(result.recording, dice, result.rest, 'snap')
    const handoff = buildPlaybackPlan(result.recording, dice, result.rest, 'handoff')
    samples.push({ index, result, plan, handoff, ms })
    rest = plan.rest
  }
  report(samples, chain, options.verbose)
  return 0
}

function report(samples: readonly Sample[], chain: number, verbose: boolean): void {
  const n = samples.length
  const attempts = samples.flatMap((sample) => sample.result.attempts)
  const firsts = samples.flatMap((sample) => sample.result.attempts.slice(0, 1))
  const firstValid = firsts.filter((attempt) => attempt.validity.valid).length
  const reasons = new Map<string, number>()
  for (const reason of attempts.flatMap((attempt) => attempt.validity.reasons)) {
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  const endedAs = (source: string) =>
    samples.filter((sample) => sample.result.recording.source === source).length
  const retried = samples.filter((sample) => sample.result.attempts.length > 1).length
  const restarted = samples.filter((sample) => !sample.result.start.valid).length
  const physicsAttempts = attempts.filter((attempt) => attempt.source !== 'hop').length
  // A first attempt that never settled counts as infinitely late.
  const settle = sorted(
    firsts.map((attempt) => (attempt.settleTime < 0 ? Infinity : attempt.settleTime)),
  )
  const totalMs = samples.reduce((sum, sample) => sum + sample.ms, 0)
  const throwMs = sorted(samples.map((sample) => sample.ms))
  const lowerApex = sorted(firsts.map((attempt) => Math.min(...attempt.apex)))

  // Exact depths of every attempt, the shown recordings among them: the deepest at any physics
  // step, which checkRecording holds to maxOverlap, then what the 60 Hz frames show.
  const depthRows = (surface: keyof DepthProfile, label: string): [string, string][] => {
    const of = (key: keyof Depths) => attempts.map((attempt) => attempt.depths[surface][key])
    const step = sorted(of('step'))
    const frame = sorted(of('frame'))
    const sustained = Math.max(...of('sustained'))
    const atRest = Math.max(...of('atRest').filter(Number.isFinite))
    return [
      [label, `per step: deepest ${u(Math.max(...step))} (p99 ${u(quantile(step, 0.99))})`],
      [
        '  per 60 Hz frame',
        `deepest ${u(Math.max(...frame))} (p99 ${u(quantile(frame, 0.99))}), ` +
          `sustained ${u(sustained)}, at rest ${u(atRest)}`,
      ],
    ]
  }

  // Contacts of the shown recordings: how much of each throw each die spends touching something.
  let touchingSteps = 0
  let steps = 0
  for (const { result } of samples) {
    const rec = result.recording
    for (let step = 0; step < rec.contacts.length; step++) {
      for (const die of [0, 1] as const) if (touchesAt(rec, step, die) !== 0) touchingSteps++
    }
    steps += 2 * rec.contacts.length
  }

  // The face snap: how often it is hidden, and how fast the die turns where it switches.
  const switches = samples.flatMap(({ plan }) =>
    plan.tracks.flatMap((track, die) => {
      if (track.startOffset === track.endOffset) return []
      const rec = plan.recording
      const before = framePose(rec, track.switchFrame - 1, die === 0 ? 0 : 1).q
      const turn = angleBetween(before, framePose(rec, track.switchFrame, die === 0 ? 0 : 1).q)
      return [{ hidden: track.hidden, turnRate: turn * rec.frameRate }]
    }),
  )
  const hidden = switches.filter((change) => change.hidden).length
  const turnRates = sorted(switches.map((change) => change.turnRate))

  // The handoff (the dome's mode): of the dice that change face, how many blend over a window,
  // how many fall back to a hidden snap, and how many to the soft cut; the windows' lengths and
  // the slowest turn inside them.
  const changing = samples.flatMap(({ handoff }) =>
    handoff.tracks.flatMap((track, die) =>
      track.startOffset === track.endOffset
        ? []
        : [{ track, die: (die === 0 ? 0 : 1) as 0 | 1, handoff }],
    ),
  )
  const blended = changing.filter(({ track }) => track.handoff !== null)
  const snapped = changing.filter(({ track }) => track.handoff === null && track.hidden).length
  const softCut = changing.filter(({ track }) => track.handoff === null && !track.hidden).length
  const windowMs = sorted(
    blended.map(({ track, handoff }) =>
      track.handoff === null
        ? 0
        : ((track.handoff.to - track.handoff.from) / handoff.recording.frameRate) * 1000,
    ),
  )
  const windowTurn = sorted(
    blended.map(({ track, die, handoff }) =>
      track.handoff === null ? Infinity : slowestTurn(handoff.recording, die, track.handoff),
    ),
  )

  // Framing: the top faces at rest on the desktop canvas, by the dome's read framing and by
  // M10a's station camera, against the overlays' reserved zones.
  const framing = (cameraFor: (plan: PlaybackPlan) => CameraPose) => {
    let off = 0
    let covered = 0
    const faces: number[] = []
    for (const { handoff } of samples) {
      const pose = cameraFor(handoff)
      for (const { pose: body } of handoff.rest) {
        const corners = topFaceCorners(body).map((corner) => projectPoint(pose, CANVAS, corner))
        const xs = corners.map(([x]) => x)
        const ys = corners.map(([, y]) => y)
        const box = {
          left: Math.min(...xs),
          top: Math.min(...ys),
          right: Math.max(...xs),
          bottom: Math.max(...ys),
        }
        const outside =
          box.left < 0 || box.top < 0 || box.right > CANVAS.width || box.bottom > CANVAS.height
        if (outside) off++
        else if (reservedZones(CANVAS).some((zone) => overlaps(box, zone))) covered++
        let area = 0
        corners.forEach(([x1, y1], k) => {
          const [x2, y2] = corners[(k + 1) % corners.length] ?? [0, 0]
          area += x1 * y2 - x2 * y1
        })
        faces.push(Math.sqrt(Math.abs(area) / 2))
      }
    }
    const sizes = sorted(faces)
    return (
      `off canvas ${off}, under an overlay ${covered} of ${faces.length} top faces; ` +
      `face p5 ${px(quantile(sizes, 0.05))}, p50 ${px(quantile(sizes, 0.5))}`
    )
  }

  // What the physics rolled, before the remap draws the engine's dice on top.
  const faces = new Map(DIE_FACES.map((face) => [face, 0]))
  for (const pose of samples.flatMap((sample) => sample.result.recording.finalPoses)) {
    const face = naturalTopFace(pose.q)
    faces.set(face, (faces.get(face) ?? 0) + 1)
  }
  const expected = (2 * n) / 6
  const chi2 = [...faces.values()].reduce((sum, k) => sum + (k - expected) ** 2 / expected, 0)

  const { pop, dome, timestep, solverIterations, contact } = DEFAULT_PARAMS
  const physics = `${hz(1 / timestep)}, ${solverIterations} solver iterations`
  const turns = [turnRates[0] ?? NaN, quantile(turnRates, 0.05), quantile(turnRates, 0.5)]
  const rows: [string, string][] = [
    ['throws', `${n} in sessions of ${chain}`],
    ['physics', `${physics}, contacts ${hz(contact.frequency)}`],
    ['popper', `${pop.launchMin}-${pop.launchMax} u/s, spin ${pop.spinMin}-${pop.spinMax} rad/s`],
    ['first attempt valid', `${firstValid}/${n} (${pct(firstValid, n)})`],
    ['invalid reasons', [...reasons].map(([r, k]) => `${r} ${k}`).join(', ') || 'none'],
    ['throws retried', `${retried}, in ${attempts.length} attempts`],
    ['fresh start poses', `${restarted} (rests no valid throw could start from)`],
    ['ended as', `pop ${endedAs('pop')}, drop ${endedAs('drop')}, hop ${endedAs('hop')}`],
    [
      'apex, first attempt',
      `lower die min ${u(lowerApex[0] ?? NaN)}, p5 ${u(quantile(lowerApex, 0.05))}`,
    ],
    ...depthRows('floor', 'depth into floor'),
    ...depthRows('dome', `depth into dome (R ${dome.radius})`),
    ...depthRows('dice', 'depth into other die'),
    ['settle, simulated', `p50 ${sec(quantile(settle, 0.5))}, p95 ${sec(quantile(settle, 0.95))}`],
    ['wall clock per throw', `mean ${ms(totalMs / n)}, p95 ${ms(quantile(throwMs, 0.95))}`],
    ['per physics attempt', `mean ${ms(totalMs / physicsAttempts)}`],
    ['touching something', `${pct(touchingSteps, steps)} of die-steps`],
    ['face snap hidden', `${hidden}/${switches.length} switches (${pct(hidden, switches.length)})`],
    ['  turn rate there', `min ${rate(turns[0])}, p5 ${rate(turns[1])}, p50 ${rate(turns[2])}`],
    [
      'handoff (dome)',
      `${blended.length}/${changing.length} changing dice blend ` +
        `(${pct(blended.length, changing.length)}), ${snapped} hidden snaps, ${softCut} soft cuts`,
    ],
    [
      '  window',
      `${ms(windowMs[0] ?? NaN)}–${ms(windowMs.at(-1) ?? NaN)} (p50 ${ms(quantile(windowMs, 0.5))}), ` +
        `slowest turn min ${rate(windowTurn[0])}, p50 ${rate(quantile(windowTurn, 0.5))}`,
    ],
    ['framing, read (dome)', framing((plan) => readFraming(restBodies(plan), CANVAS))],
    ['framing, M10a station', framing(() => M10A_STATION)],
    ['natural top faces', [...faces].map(([face, k]) => `${face}:${k}`).join(' ')],
    ['  uniformity', `χ² ${chi2.toFixed(2)} on 5 dof (p = .05 at 11.07)`],
  ]
  for (const [label, value] of rows) console.log(`${label.padEnd(26)}${value}`)

  if (!verbose) return
  for (const { index, result } of samples) {
    result.attempts.forEach((attempt, k) => {
      if (attempt.validity.valid) return
      const why = attempt.validity.reasons.join('+')
      console.log(`  throw ${index} attempt ${k} (${attempt.source}, seed ${attempt.seed}): ${why}`)
    })
  }
}

/** The desktop canvas (1440 px wide page, 360 px dome column, 1 px border), 16:10. */
const CANVAS: CanvasSize = { width: 358, height: 223.75 }
/** M10a's fixed station camera, for comparison: [0, 5.8, 8.6] looking at (0, 0.3, 0). */
const M10A_STATION: CameraPose = { position: [0, 5.8, 8.6], target: [0, 0.3, 0] }

function restBodies(plan: PlaybackPlan) {
  return [plan.rest[0].pose, plan.rest[1].pose] as const
}

function overlaps(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

function quantile(ascending: readonly number[], q: number): number {
  if (ascending.length === 0) return Number.NaN
  return (
    ascending[Math.min(ascending.length - 1, Math.ceil(q * ascending.length) - 1)] ?? Number.NaN
  )
}

function positiveInt(text: string): number | undefined {
  const value = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** A seed as the physics takes it: a whole number from 0 to 0xffffffff, decimal or 0x hex. */
function uint32(text: string): number | undefined {
  const value = Number(text)
  const digits = /^(?:\d+|0x[0-9a-f]+)$/i.test(text)
  return digits && Number.isSafeInteger(value) && value <= 0xffffffff ? value : undefined
}

/** k/n as an exact percentage with one decimal, rounded half away from zero. */
const pct = (k: number, n: number) => (n === 0 ? 'n/a' : `${Fraction.of(k, n).formatPercent(1)}%`)
const sec = (s: number) => (Number.isFinite(s) ? `${s.toFixed(2)} s` : 'never')
const ms = (value: number) => `${value.toFixed(1)} ms`
const u = (value: number) => `${value.toFixed(3)} u`
const hz = (value: number) => `${value.toFixed(0)} Hz`
const px = (value: number) => `${value.toFixed(1)} px`
const rate = (value = NaN) => `${value.toFixed(1)} rad/s`

process.exitCode = await main(process.argv.slice(2))
