import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { DICE_CLASSES, isDoubles, totalOf } from '../engine/core/dice.ts'
import { Fraction } from '../engine/core/rational.ts'
import { advanceRound } from '../engine/round/round.ts'
import { decideBet, requireBet, requireType } from '../engine/bets/registry.ts'
import { betId, type BetInstance } from '../engine/bets/types.ts'
import { cents } from '../engine/core/money.ts'
import {
  COME_OUT,
  ExactError,
  buildChain,
  roundAt,
  solveBetChain,
  type BetChain,
  type BetSpec,
  type Horizon,
  type StartContext,
} from './chain.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

function startIn(
  phase: StartContext['phases'][number]['phase'],
  working: boolean | null = null,
): StartContext {
  return { phases: [{ phase, weight: Fraction.ONE }], carried: false, working, globalOff: null }
}

function chainOf(
  cfg: MachineConfig,
  spec: BetSpec,
  horizon: Horizon,
  start: StartContext = startIn(COME_OUT),
): BetChain {
  return buildChain(spec, start, horizon, cfg)
}

const labelKeys = (chain: BetChain) => chain.labels.map((label) => label.key).sort()

describe('buildChain', () => {
  it('branches every state on the 21 dice classes, weighing 36', () => {
    for (const id of PRESET_IDS) {
      const chain = chainOf(cfgOf(id), { typeId: 'pass', number: null }, 'lifetime')
      for (const node of chain.nodes) {
        expect(node.steps).toHaveLength(21)
        expect(node.steps.reduce((sum, step) => sum + step.weight, 0)).toBe(36)
      }
    }
  })

  it('follows a crapless pass bet over the come-out and its ten points', () => {
    const cfg = cfgOf('craplessBubble')
    const chain = chainOf(cfg, { typeId: 'pass', number: null }, 'decision')
    expect(chain.nodes.map((node) => node.key)).toHaveLength(11)
    expect(labelKeys(chain)).toEqual(
      ['lose:-:lost', 'win:flat:stays', ...cfg.ruleset.points.map((n) => `travel:${n}`)].sort(),
    )
    // From the come-out: the 7 wins (6 ways), everything else travels.
    const start = chain.nodes[chain.starts[0]?.node ?? -1]
    const ways = (kind: string) =>
      start?.steps.filter((s) => s.decision.kind === kind).reduce((n, s) => n + s.weight, 0)
    expect(ways('win')).toBe(6)
    expect(ways('travel')).toBe(30)
    expect(ways('lose')).toBe(0)
  })

  it('ends a decision horizon at the first settlement and a lifetime when the bet comes down', () => {
    const cfg = cfgOf('craplessBubble')
    const place6: BetSpec = { typeId: 'place', number: 6 }
    const first = chainOf(cfg, place6, 'decision')
    for (const node of first.nodes) {
      for (const step of node.steps) {
        const settled = ['win', 'lose', 'push'].includes(step.decision.kind)
        expect(step.to === -1).toBe(settled)
      }
    }
    // Place stays up after a win, so over its lifetime only a loss ends it.
    const life = chainOf(cfg, place6, 'lifetime')
    for (const node of life.nodes) {
      for (const step of node.steps) {
        expect(step.to === -1).toBe(step.decision.kind === 'lose')
      }
    }
  })

  it('tracks no phase for one-roll bets and composites', () => {
    const cfg = cfgOf('craplessBubble')
    for (const typeId of ['field', 'horn', 'any7']) {
      const chain = chainOf(cfg, { typeId, number: null }, 'lifetime')
      expect(chain.group.tracksRound).toBe(false)
      expect(chain.nodes).toHaveLength(1)
      expect(chain.nodes[0]?.key.startsWith('-|')).toBe(true)
    }
  })

  it('decides one-roll bets and composites the same way in every phase (projection none)', () => {
    for (const id of PRESET_IDS) {
      const cfg = cfgOf(id)
      for (const typeId of [...cfg.catalog.keys(), ...cfg.composites.keys()]) {
        const resolved = requireType(cfg, typeId)
        if (resolved.family.projection !== 'none') continue
        const bet = {
          id: betId(1),
          typeId,
          number: null,
          parentId: null,
          amount: cents(100),
          vigHeld: cents(0),
          working: null,
          progress: 0,
          placedAtRoll: 1,
        }
        for (const dice of DICE_CLASSES) {
          const decisions = [
            COME_OUT,
            ...cfg.ruleset.points.map((point) => ({ kind: 'point' as const, point })),
          ].map((phase) => {
            const before = roundAt(phase)
            const ctx = {
              dice,
              total: totalOf(dice),
              isPair: isDoubles(dice),
              before,
              transition: advanceRound(before, dice, cfg.ruleset).transition,
              rules: cfg.ruleset,
              cfg,
              working: true,
              parentDecision: null,
            }
            return JSON.stringify(decideBet(bet, ctx, resolved))
          })
          expect(new Set(decisions).size, `${id} ${typeId} ${dice.d1}-${dice.d2}`).toBe(1)
        }
      }
    }
  })

  it('puts odds behind their parent, which decides them', () => {
    const cfg = cfgOf('craplessBubble')
    const chain = chainOf(
      cfg,
      { typeId: 'passOdds', number: 4 },
      'lifetime',
      startIn({ kind: 'point', point: 4 }),
    )
    expect(chain.group.slots.map((slot) => slot.type.typeId)).toEqual(['pass', 'passOdds'])
    // New for the first roll, then carried: the same bet either way.
    expect(chain.nodes.map((node) => node.table.bets[1]?.placedAtRoll)).toEqual([1, 0])
    for (const node of chain.nodes) {
      for (const step of node.steps) {
        const total = step.dice.d1 + step.dice.d2
        const want = total === 4 ? 'win' : total === 7 ? 'lose' : 'none'
        expect(step.decision.kind, `${step.dice.d1}-${step.dice.d2}`).toBe(want)
      }
    }
    expect(labelKeys(chain)).toEqual(['lose:-:lost', 'win:4:returned'])
  })

  it('returns come odds that are OFF on the come-out when their come bet is decided', () => {
    const cfg = cfgOf('craplessBubble')
    const chain = chainOf(cfg, { typeId: 'comeOdds', number: 5 }, 'decision', startIn(COME_OUT))
    expect(chain.nodes[0]?.working).toBe(false)
    expect(labelKeys(chain)).toContain('push:offReturned:returned')
  })

  it("labels a don't pass bar push, which leaves the bet on the line", () => {
    const chain = chainOf(
      cfgOf('traditionalBubble'),
      { typeId: 'dontPass', number: null },
      'decision',
    )
    expect(labelKeys(chain)).toContain('push:bar:stays')
  })

  it('collects up-front vig again on a winner that stays up, over a lifetime only', () => {
    const recollect = cfgOf('craplessBubble')
    const buy4: BetSpec = { typeId: 'buy', number: 4 }
    expect(labelKeys(chainOf(recollect, buy4, 'lifetime'))).toContain('vig:rearm')
    expect(labelKeys(chainOf(recollect, buy4, 'decision'))).not.toContain('vig:rearm')
    // Commission taken from the win (Shoot To Win), or up front once, is not collected again.
    expect(labelKeys(chainOf(cfgOf('traditionalBubble'), buy4, 'lifetime'))).not.toContain(
      'vig:rearm',
    )
    const once = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.commission = { ...buy.commission, rearm: 'none' }
    })
    expect(labelKeys(chainOf(once, buy4, 'lifetime'))).not.toContain('vig:rearm')
  })

  it("follows Shoot To Win's auto-OFF: a new place bet is OFF on the come-out, ON with a point", () => {
    const cfg = cfgOf('traditionalBubble')
    const comeOut = chainOf(cfg, { typeId: 'place', number: 6 }, 'lifetime', startIn(COME_OUT))
    expect(comeOut.nodes[0]?.working).toBe(false)
    const onPoint = comeOut.nodes.find((node) => node.table.phase.kind === 'point')
    expect(onPoint?.working).toBe(true)
    // After a roll every bet is carried, and carried chips are OFF on the come-out too.
    const carriedComeOut = comeOut.nodes.find(
      (node) => node.table.phase.kind === 'comeOut' && node.table.bets[0]?.placedAtRoll === 0,
    )
    expect(carriedComeOut?.working).toBe(false)
  })

  it('resets toggles after each roll where they last one roll (nextRollOnly)', () => {
    const cfg = variant('craplessBubble', (input) => {
      input.workingToggle = { ...input.workingToggle, scope: 'nextRollOnly', perBet: true }
    })
    const chain = chainOf(cfg, { typeId: 'place', number: 6 }, 'lifetime', startIn(COME_OUT, false))
    expect(chain.nodes[0]?.working).toBe(false)
    expect(chain.nodes.slice(1).every((node) => node.table.bets[0]?.working === null)).toBe(true)
    expect(chain.nodes.slice(1).every((node) => node.working)).toBe(true)
  })

  it("carries Interblock's post-seven-out hold, which only Set bets On (or the point) ends", () => {
    const held: StartContext = { ...startIn(COME_OUT), held: true }
    const place6: BetSpec = { typeId: 'place', number: 6 }
    // Until the player sets bets ON: held on every table it reaches, so never decided.
    const forever = chainOf(cfgOf('craplessBubble'), place6, 'lifetime', held)
    expect(forever.nodes.every((node) => !node.working && node.table.heldOff.length === 1)).toBe(
      true,
    )
    expect(solveBetChain(forever).solution.values.every((row) => row === null)).toBe(true)
    // Where the hold lasts until the point, the machine releases it when one is established.
    const untilPoint = variant('craplessBubble', (input) => {
      input.afterSevenOut.newPlacedOff = {
        types: ['place', 'buy'],
        trigger: 'sevenOut',
        until: 'pointEstablished',
      }
    })
    const released = chainOf(untilPoint, place6, 'lifetime', held)
    expect(released.nodes.some((node) => node.working && node.table.heldOff.length === 0)).toBe(
      true,
    )
    expect(solveBetChain(released).solution.values[0]).not.toBeNull()
  })

  it("applies the machine's actions after a roll: Interblock's lay comes back ON", () => {
    const cfg = cfgOf('strictBubble')
    const chain = chainOf(
      cfg,
      { typeId: 'lay', number: 4 },
      'lifetime',
      startIn({ kind: 'point', point: 6 }, false),
    )
    expect(chain.nodes[0]?.working).toBe(false)
    expect(chain.nodes.some((node) => node.working && node.table.bets[0]?.working === true)).toBe(
      true,
    )
    const solved = solveBetChain(chain)
    expect(solved.solution.values[0]).not.toBeNull()
  })

  it('refuses bets the machine does not offer, bad numbers, bad starts and too many states', () => {
    const crapless = cfgOf('craplessBubble')
    const code = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return error instanceof ExactError ? error.code : 'other'
      }
      return 'none'
    }
    expect(code(() => chainOf(crapless, { typeId: 'dontPass', number: null }, 'decision'))).toBe(
      'NOT_OFFERED',
    )
    expect(code(() => chainOf(crapless, { typeId: 'place', number: null }, 'decision'))).toBe(
      'BAD_SPEC',
    )
    expect(code(() => chainOf(crapless, { typeId: 'field', number: 4 }, 'decision'))).toBe(
      'BAD_SPEC',
    )
    // A pass bet on 4 must be on point 4.
    expect(code(() => chainOf(crapless, { typeId: 'pass', number: 4 }, 'decision'))).toBe(
      'BAD_START',
    )
    expect(
      code(() =>
        buildChain(
          { typeId: 'come', number: null },
          startIn({ kind: 'point', point: 6 }),
          'lifetime',
          crapless,
          2,
        ),
      ),
    ).toBe('MAX_STATES')
  })
})

describe('side-bet chains (M11)', () => {
  const crapless = cfgOf('craplessBubble')
  const traditional = cfgOf('traditionalBubble')
  const strict = cfgOf('strictBubble')
  const live = cfgOf('traditionalLive345')
  const side = (typeId: string): BetSpec => ({ typeId, number: null })
  const code = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      return error instanceof ExactError ? error.code : 'other'
    }
    return 'none'
  }
  const progressOf = (chain: BetChain) =>
    chain.nodes.map((node) => node.table.bets[chain.group.subject]?.progress ?? -1)

  it('resolves each side-bet family on no number, and refuses one the machine lacks', () => {
    const offered: readonly [MachineConfig, string][] = [
      [crapless, 'luckyRollerLow'],
      [traditional, 'hotShooter'],
      [strict, 'luckyShooter'],
      [live, 'fire'],
    ]
    for (const [cfg, typeId] of offered) {
      const chain = chainOf(cfg, side(typeId), 'decision')
      expect(chain.group.slots, typeId).toHaveLength(1)
      expect(chain.nodes.length, typeId).toBeGreaterThan(1)
    }
    expect(code(() => chainOf(crapless, { typeId: 'luckyRollerLow', number: 6 }, 'decision'))).toBe(
      'BAD_SPEC',
    )
    expect(code(() => chainOf(crapless, side('fire'), 'decision'))).toBe('NOT_OFFERED')
    expect(code(() => chainOf(crapless, side('hotShooter'), 'decision'))).toBe('NOT_OFFERED')
  })

  it('keys a Lucky Roller that any 7 ends on its mask alone: 2^targets states, no phase', () => {
    // Low Rolls: 32 masks less the full set (paid at once), plus the fresh bet before its first
    // roll (a non-target roll carries it with nothing collected): 32 states, none with a phase.
    const low = chainOf(crapless, side('luckyRollerLow'), 'decision')
    expect(low.group.tracksRound).toBe(false)
    expect(low.nodes).toHaveLength(32)
    expect(low.nodes.every((node) => node.key.startsWith('-|'))).toBe(true)
    expect(labelKeys(low)).toEqual(['lose:-:lost', 'win:set:returned'])
    // Roll 'Em All: every total but 7 is a target, so a carried bet always has progress: 1,023.
    const all = chainOf(crapless, side('luckyRollerAll'), 'decision')
    expect(all.nodes).toHaveLength(1023)
    expect(new Set(progressOf(all)).size).toBe(1023)
    // Its first state: the 7 loses 6 ways, every other roll (30 ways) progresses, nothing wins.
    const start = all.nodes[all.starts[0]?.node ?? -1]
    const ways = (kind: string) =>
      start?.steps.filter((s) => s.decision.kind === kind).reduce((n, s) => n + s.weight, 0)
    expect([ways('lose'), ways('progress'), ways('win')]).toEqual([6, 30, 0])
  })

  it('reads a Lucky Roller that ends on any 7 the same way in every phase, as `followsRound` says', () => {
    // The projection `followsRound` makes for collectSet/anySeven rests on this: decide() must not
    // read the round's phase or transition. Checked on every such type of every preset, for the
    // masks that matter and every dice class.
    let checked = 0
    for (const id of PRESET_IDS) {
      const cfg = cfgOf(id)
      for (const type of cfg.sideBets.values()) {
        if (type.family !== 'collectSet' || type.endsOn !== 'anySeven') continue
        const resolved = requireBet(cfg, type.typeId)
        const full = type.targets.reduce((mask, total) => mask | (1 << total), 0)
        const masks = [0, 1 << (type.targets[0] ?? 2), full & ~(1 << (type.targets.at(-1) ?? 12))]
        for (const progress of masks) {
          const bet: BetInstance = {
            id: betId(1),
            typeId: type.typeId,
            number: null,
            parentId: null,
            amount: cents(100),
            vigHeld: cents(0),
            working: null,
            progress,
            placedAtRoll: 0,
          }
          for (const dice of DICE_CLASSES) {
            const decisions = [
              COME_OUT,
              ...cfg.ruleset.points.map((point) => ({ kind: 'point' as const, point })),
            ].map((phase) => {
              const before = roundAt(phase)
              return decideBet(
                bet,
                {
                  dice,
                  total: totalOf(dice),
                  isPair: isDoubles(dice),
                  before,
                  transition: advanceRound(before, dice, cfg.ruleset).transition,
                  rules: cfg.ruleset,
                  cfg,
                  working: true,
                  parentDecision: null,
                },
                resolved,
              )
            })
            for (const decision of decisions) expect(decision).toEqual(decisions[0])
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('lumps the Hot Shooter count at its top tier, so the chain is finite: 351 states', () => {
    const chain = chainOf(traditional, side('hotShooter'), 'decision')
    expect(chain.group.tracksRound).toBe(true)
    const top = Math.max(...progressOf(chain))
    expect(top).toBe(50)
    // Counts 1–50 in each of the 7 phases, plus the fresh bet on its first come-out.
    expect(chain.nodes).toHaveLength(351)
    // From the lumped count a seven-out pays the top tier, exactly as a count of 50 does.
    const settles = (progress: number) =>
      chain.nodes
        .filter((node) => node.table.bets[0]?.progress === progress)
        .filter((node) => node.table.phase.kind === 'point')
        .flatMap((node) => node.steps.filter((step) => step.decision.kind === 'win'))
        .map((step) => (step.decision.kind === 'win' ? step.decision.payKey : ''))
    expect(new Set(settles(50))).toEqual(new Set(['50']))
    expect(labelKeys(chain)).toEqual(
      [
        'lose:-:lost',
        'push:zeroNet:returned',
        'win:16:returned',
        'win:24:returned',
        'win:32:returned',
        'win:40:returned',
        'win:45:returned',
        'win:50:returned',
      ].sort(),
    )
  })

  it('follows the Lucky Shooter through its come-out pushes and the Fire Bet through the hand', () => {
    const shooter = chainOf(strict, side('luckyShooter'), 'lifetime')
    expect(shooter.group.tracksRound).toBe(true)
    // Before the point: new or carried, nothing hit; then 6 points × 32 hit masks.
    expect(shooter.nodes).toHaveLength(194)
    const start = shooter.nodes[shooter.starts[0]?.node ?? -1]
    const ways = (kind: string) =>
      start?.steps.filter((s) => s.decision.kind === kind).reduce((n, s) => n + s.weight, 0)
    // 2, 3 and 12 lose (4 ways), 7 and 11 push and stay up (8 ways), a box number sets the point.
    expect([ways('lose'), ways('push'), ways('progress')]).toEqual([4, 8, 24])
    const pushes = start?.steps.filter((s) => s.decision.kind === 'push') ?? []
    expect(pushes.every((step) => step.to !== -1)).toBe(true)
    // The push leaves the bet up and decides nothing (rules spec §0.1, §6.3; EXACT_VERSION 3): it
    // carries no label, and at the decision horizon too the chain runs on to a resolved wager.
    expect(pushes.every((step) => step.labels.length === 0)).toBe(true)
    expect(shooter.labels.map((label) => label.key)).not.toContain('push:bar:stays')
    const once = chainOf(strict, side('luckyShooter'), 'decision')
    const first = once.nodes[once.starts[0]?.node ?? -1]
    const firstPushes = first?.steps.filter((s) => s.decision.kind === 'push') ?? []
    // 7 (three dice classes) and 11 (one): 8 ways out of 36, none ending the decision.
    expect(firstPushes.reduce((n, step) => n + step.weight, 0)).toBe(8)
    expect(firstPushes.every((step) => step.to !== -1 && step.labels.length === 0)).toBe(true)
    // A main-game tie is still a decision: the don't pass bar 12 ends its first decision.
    const dontPass = chainOf(strict, { typeId: 'dontPass', number: null }, 'decision')
    const comeOut = dontPass.nodes[dontPass.starts[0]?.node ?? -1]
    const bar = comeOut?.steps.find((step) => step.decision.kind === 'push')
    expect([bar?.to, bar?.labels.length]).toEqual([-1, 1])
    const fire = chainOf(live, side('fire'), 'decision')
    // 64 masks of points made in each of the 7 phases, plus the fresh bet.
    expect(fire.nodes).toHaveLength(449)
  })

  it('starts a side bet from its progress, new or carried, and refuses progress no bet could have', () => {
    const carried: StartContext = {
      ...startIn(COME_OUT),
      carried: true,
      progress: (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5),
    }
    const chain = buildChain(side('luckyRollerLow'), carried, 'decision', crapless)
    const start = chain.nodes[chain.starts[0]?.node ?? -1]
    expect(start?.table.bets[0]?.progress).toBe(carried.progress)
    // One target left (the 6, 5 ways) against the 7 (6 ways); every other roll changes nothing.
    const ways = (kind: string) =>
      start?.steps.filter((s) => s.decision.kind === kind).reduce((n, s) => n + s.weight, 0)
    expect([ways('win'), ways('lose'), ways('none')]).toEqual([5, 6, 25])
    // A new bet may start with progress: a Hot Shooter placed on a later come-out carries the
    // hand's rolls (rules spec §2.6), and no side-bet decision reads whether it was carried.
    const later = buildChain(
      side('hotShooter'),
      { ...startIn(COME_OUT), progress: 2 },
      'decision',
      traditional,
    )
    expect(later.nodes[later.starts[0]?.node ?? -1]?.table.bets[0]?.progress).toBe(2)
    // The families' own invariants still refuse progress no bet could have: a 7 among the totals
    // a Low Rolls bet has collected.
    expect(
      code(() =>
        buildChain(side('luckyRollerLow'), { ...carried, progress: 1 << 7 }, 'decision', crapless),
      ),
    ).toBe('BAD_START')
  })

  it("lumps a definition-C count one roll later: C leaves two of the hand's rolls out", () => {
    const input = structuredClone(PRESETS.traditionalBubble) as MachineConfigInput
    const hot = input.sideBets.hotShooter
    if (hot?.family !== 'handLength') throw new Error('no Hot Shooter')
    hot.countDefinition = 'exceptComeOutAndSevenOut'
    const chain = chainOf(compileConfig(input), side('hotShooter'), 'decision')
    // A seven-out after 51 rolls of the hand counts 50 under C: the top tier from there on.
    expect(Math.max(...progressOf(chain))).toBe(51)
  })
})
