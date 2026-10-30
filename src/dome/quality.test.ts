import { describe, expect, it } from 'vitest'
import {
  createFrameMonitor,
  createQualityStore,
  defaultTier,
  isQualityChoice,
  lowerTier,
  lowestTier,
  MONITOR,
  QUALITY_KEY,
  TIER_ORDER,
  TIERS,
  type QualityChoice,
} from './quality.ts'

/**
 * The quality tiers (plan §7): the device-class default, the frame-time monitor's verdict over
 * 60 frames, the drop it causes and its persistence per device, and the player's pin, which turns
 * the monitor off.
 */

function memoryStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  'getItem' | 'setItem'
> & {
  readonly kept: Map<string, string>
} {
  const kept = new Map(Object.entries(initial))
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value)
    },
  }
}

describe('the tiers', () => {
  it('are ordered best first and spend less as they go down', () => {
    expect(TIER_ORDER).toStrictEqual(['high', 'medium', 'low'])
    expect(TIERS.high.antialias && TIERS.medium.antialias && !TIERS.low.antialias).toBe(true)
    expect(TIERS.high.shadows && TIERS.medium.shadows && !TIERS.low.shadows).toBe(true)
    expect(TIERS.high.dpr).toStrictEqual([1, 2])
    expect(TIERS.medium.dpr).toStrictEqual([1, 1.5])
    expect(TIERS.low.dpr).toBe(1)
    expect(TIERS.high.segments.die).toBeGreaterThan(TIERS.low.segments.die)
    expect(TIERS.high.segments.dome[0]).toBeGreaterThan(TIERS.medium.segments.dome[0])
    expect(TIERS.medium.segments.dome[0]).toBeGreaterThan(TIERS.low.segments.dome[0])
  })

  it('step down one at a time and compare', () => {
    expect(lowerTier('high')).toBe('medium')
    expect(lowerTier('medium')).toBe('low')
    expect(lowerTier('low')).toBeNull()
    expect(lowestTier('high', 'low')).toBe('low')
    expect(lowestTier('medium', 'high')).toBe('medium')
    expect(isQualityChoice('auto') && isQualityChoice('low') && !isQualityChoice('ultra')).toBe(
      true,
    )
  })

  it('default to medium when forced (software WebGL) or without matchMedia', () => {
    expect(defaultTier(true)).toBe('medium')
    // jsdom's matchMedia is absent, so the device class cannot be read: medium.
    expect(defaultTier(false)).toBe('medium')
  })
})

describe('the frame monitor', () => {
  const run = (monitor: ReturnType<typeof createFrameMonitor>, dts: number[], from = 1000) => {
    let now = from
    const verdicts: boolean[] = []
    monitor.frame(now)
    for (const dt of dts) {
      now += dt
      verdicts.push(monitor.frame(now))
    }
    return verdicts
  }

  it('drops after the warm-up and 60 frames whose median exceeds 22 ms', () => {
    const monitor = createFrameMonitor()
    const verdicts = run(
      monitor,
      Array.from({ length: MONITOR.warmup + MONITOR.frames }, () => 25),
    )
    expect(verdicts.slice(0, -1).every((v) => !v)).toBe(true)
    expect(verdicts.at(-1)).toBe(true)
    // The window empties after a verdict.
    expect(monitor.samples).toHaveLength(0)
  })

  it('does not drop for a median at or under 22 ms, even with a few hitches', () => {
    const monitor = createFrameMonitor()
    const dts = Array.from({ length: MONITOR.warmup + MONITOR.frames }, (_, k) =>
      k % 10 === 0 ? 300 : 16,
    )
    expect(run(monitor, dts).some((v) => v)).toBe(false)
    expect(monitor.samples).toHaveLength(0)
  })

  it('keeps its samples across throws but not the gap between them', () => {
    const monitor = createFrameMonitor()
    // Throw 1: 5 warm-up frames and 30 slow ones.
    run(
      monitor,
      Array.from({ length: MONITOR.warmup + 30 }, () => 30),
    )
    expect(monitor.samples).toHaveLength(30)
    monitor.reset()
    // A long pause while the player bets is not a frame; the warm-up applies again.
    const verdicts = run(
      monitor,
      Array.from({ length: MONITOR.warmup + 30 }, () => 30),
      60_000,
    )
    expect(monitor.samples).toHaveLength(0)
    expect(verdicts.filter((v) => v)).toHaveLength(1)
    expect(verdicts.at(-1)).toBe(true)
  })

  it('ignores a clock that runs backwards', () => {
    const monitor = createFrameMonitor()
    monitor.frame(1000)
    monitor.frame(900)
    expect(monitor.samples).toHaveLength(0)
  })
})

describe('the quality store', () => {
  it('starts on the device tier, drops one tier at a time and remembers the drop', () => {
    const storage = memoryStorage()
    const quality = createQualityStore({ storage, device: 'high' })
    expect(quality.getState()).toMatchObject({ device: 'high', measured: null, override: 'auto' })
    expect(quality.getState().tier).toBe('high')
    expect(quality.getState().drop()).toBe(true)
    expect(quality.getState().tier).toBe('medium')
    expect(JSON.parse(storage.kept.get(QUALITY_KEY) ?? '')).toStrictEqual({ measured: 'medium' })
    expect(quality.getState().drop()).toBe(true)
    expect(quality.getState().tier).toBe('low')
    expect(quality.getState().drop()).toBe(false)
    expect(quality.getState().tier).toBe('low')
    // The next visit on this device starts where the monitor left it.
    const again = createQualityStore({ storage, device: 'high' })
    expect(again.getState().tier).toBe('low')
    expect(again.getState().measured).toBe('low')
  })

  it('never lifts a device above its own class, whatever it measured', () => {
    const storage = memoryStorage({ [QUALITY_KEY]: '{"override":"auto","measured":"medium"}' })
    const quality = createQualityStore({ storage, device: 'low' })
    expect(quality.getState().tier).toBe('low')
  })

  it('a pin wins, turns the monitor off and is kept; auto gives the measured tier back', () => {
    const storage = memoryStorage()
    const written: string[] = []
    let kept: QualityChoice = 'auto'
    const pin = {
      read: () => kept,
      write: (choice: QualityChoice) => {
        written.push(choice)
        kept = choice
      },
    }
    const quality = createQualityStore({ storage, device: 'medium', pin })
    quality.getState().drop()
    expect(quality.getState().tier).toBe('low')
    quality.getState().setOverride('high')
    expect(quality.getState().tier).toBe('high')
    expect(quality.getState().drop()).toBe(false)
    expect(quality.getState().tier).toBe('high')
    // The pin is the player's setting; the device key keeps only what the monitor measured.
    expect(written).toStrictEqual(['high'])
    expect(JSON.parse(storage.kept.get(QUALITY_KEY) ?? '')).toStrictEqual({ measured: 'low' })
    // The next visit reads the pin back from the setting.
    expect(createQualityStore({ storage, device: 'medium', pin }).getState()).toMatchObject({
      override: 'high',
      tier: 'high',
    })
    // Setting the same pin again writes nothing; auto gives the measured tier back.
    quality.getState().setOverride('high')
    expect(written).toStrictEqual(['high'])
    quality.getState().setOverride('auto')
    expect(quality.getState().tier).toBe('low')
    expect(written).toStrictEqual(['high', 'auto'])
  })

  it('ignores the pin an older dome blob kept: the setting holds it now', () => {
    const storage = memoryStorage({ [QUALITY_KEY]: '{"override":"low","measured":"medium"}' })
    const quality = createQualityStore({ storage, device: 'high' })
    expect(quality.getState()).toMatchObject({
      override: 'auto',
      measured: 'medium',
      tier: 'medium',
    })
  })

  it('shrugs off junk in storage and works without any', () => {
    for (const junk of ['nonsense', '{"override":"ultra","measured":7}', '[]', 'null']) {
      const quality = createQualityStore({
        storage: memoryStorage({ [QUALITY_KEY]: junk }),
        device: 'high',
      })
      expect(quality.getState()).toMatchObject({ override: 'auto', measured: null, tier: 'high' })
    }
    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    const quality = createQualityStore({ storage: throwing, device: 'high' })
    expect(quality.getState().drop()).toBe(true)
    expect(quality.getState().tier).toBe('medium')
    const memoryOnly = createQualityStore({ storage: null, device: 'medium' })
    memoryOnly.getState().setOverride('low')
    expect(memoryOnly.getState().tier).toBe('low')
  })
})
