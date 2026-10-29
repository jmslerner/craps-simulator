import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { DICE_CLASSES, isDoubles, totalOf } from '../engine/core/dice.ts'
import { Fraction } from '../engine/core/rational.ts'
import { advanceRound } from '../engine/round/round.ts'
import { decideBet, requireType } from '../engine/bets/registry.ts'
import { betId } from '../engine/bets/types.ts'
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
