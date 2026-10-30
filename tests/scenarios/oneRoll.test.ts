import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../src/engine/config/compile.ts'
import { craplessBubble, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { ProvenanceStatus } from '../../src/engine/config/provenance.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { DICE_CLASSES } from '../../src/engine/core/dice.ts'
import { cents } from '../../src/engine/core/money.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import { scenario } from './dsl.ts'

// One-roll machine facts (rules spec §0.1, §2.4, §3.4, §5.2, §9 #19), played through the table
// reducer. Amounts are cents; every machine starts with $500. Each roll on a machine with a minimum
// total keeps at least that much working on the table.

/** Crapless bubble with the E posted "15 for 1" (14:1), as some machines post props (§3.4). */
function eFifteenForOne(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  const e = input.catalog.e
  if (e?.family !== 'oneRoll') throw new Error('craplessBubble has no E')
  e.pays = { '11': '15 for 1' }
  input.id = 'craplessEFifteenForOne'
  input.provenance['/catalog/e/pays'] = {
    status: 'assumed',
    note: 'A test machine that posts the E "15 for 1", which nets 14:1 (rules spec §0.1, §3.4).',
  }
  return input
}

describe('the field (§3.4)', () => {
  it('Interblock pays 2:1 on 2 [R VA; IB §2.7] and returns the winner [A §9 #19]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/field', 'verified')
      .expectProvenance('/catalog/field/pays', 'reported')
      .expectProvenance('/catalog/field/afterWin', 'assumed')
      .place('field', 500)
      .roll(1, 1)
      .expectSettled(
        { typeId: 'field' },
        {
          outcome: 'win',
          payKey: '2',
          ratioLabel: '2:1',
          winPaid: 1_000,
          credited: 1_500,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([])
      .expectBankroll(51_000)
  })

  it('a live table pays 3:1 on 12 [V WOO-B]: $5 wins $15', () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/field', 'verified')
      .place('field', 500)
      .roll(6, 6)
      .expect({ transition: 'craps' })
      .expectSettled({ typeId: 'field' }, { ratioLabel: '3 to 1', winPaid: 1_500, credited: 2_000 })
      .expectBankroll(51_500)
  })

  it('Shoot To Win re-bets a winning field [V CW §8, §32]: it rides the next roll and loses on 6', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/field', 'verified')
      .place('field', 500)
      .roll(2, 2)
      .expectSettled(
        { typeId: 'field' },
        { winPaid: 500, credited: 500, stakeDisposition: 'stays' },
      )
      .expectBets([['field', null, 500]])
      .expectBankroll(50_000)
      .roll(3, 3)
      .expectSettled({ typeId: 'field' }, { outcome: 'lose', stakeDisposition: 'lost' })
      .expectBets([])
      .expectBankroll(50_000)
  })
})

describe('props and hops (§3.4)', () => {
  it('"15 for 1" pays 14:1 net: $1 on the E wins $14 and the $1 comes back', () => {
    scenario(eFifteenForOne())
      .expectProvenance('/catalog/e/pays', 'assumed')
      .place('pass', 500)
      .roll(4, 4)
      .place('e', 100)
      .roll(5, 6)
      .expectSettled(
        { typeId: 'e' },
        { ratioLabel: '15 for 1', winExact: '1400', winPaid: 1_400, credited: 1_500 },
      )
      .expectBankroll(50_900)
  })

  it('Interblock posts "for 1": $1 on Seven wins $4, on Boxcars $30 [R IB game screen]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/any7/pays', 'reported')
      .expectProvenance('/catalog/boxcars/pays', 'reported')
      .place('pass', 500)
      .roll(4, 4)
      .place('any7', 100)
      .place('boxcars', 100)
      .roll(6, 6)
      .expectSettled({ typeId: 'boxcars' }, { ratioLabel: '31 for 1', winPaid: 3_000 })
      .expectSettled({ typeId: 'any7' }, { outcome: 'lose' })
      .place('any7', 100)
      .roll(4, 3)
      .expectSettled({ typeId: 'any7' }, { ratioLabel: '5 for 1', winPaid: 400, credited: 500 })
  })

  it('hop 1-2 matches both orders and hop 3-3 only its pair [V CW §28; STWO §7.1]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/hop12', 'verified')
      .expectProvenance('/catalog/hop33', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('hop12', 100)
      .roll(2, 1)
      .expectSettled(
        { typeId: 'hop12' },
        { ratioLabel: '15 to 1', winPaid: 1_500, stakeDisposition: 'stays' },
      )
      .roll(1, 2)
      .expectSettled({ typeId: 'hop12' }, { winPaid: 1_500 })
      .takeDown({ typeId: 'hop12' })
      .place('hop33', 100)
      .roll(2, 4)
      .expectSettled({ typeId: 'hop33' }, { outcome: 'lose' })
      .place('hop33', 100)
      .roll(3, 3)
      .expectSettled({ typeId: 'hop33' }, { ratioLabel: '30 to 1', winPaid: 3_000 })
      .expectBets([
        ['pass', 8, 500],
        ['hop33', null, 100],
      ])
      .expectBankroll(55_300)
  })

  it('Interblock has no 1-2 hop [V IB]: the Ace-Deuce horn single takes 1-2 and 2-1', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/aceDeuce', 'verified')
      .expectReject('NOT_OFFERED', (a) => a.place('hop12', 100), { typeId: 'hop12' })
      .expectReject('NOT_OFFERED', (a) => a.place('hop56', 100), { typeId: 'hop56' })
      .place('pass', 500)
      .roll(4, 4)
      .place('aceDeuce', 100)
      .roll(2, 1)
      .expectSettled({ typeId: 'aceDeuce' }, { ratioLabel: '16 for 1', winPaid: 1_500 })
      .place('aceDeuce', 100)
      .roll(1, 2)
      .expectSettled({ typeId: 'aceDeuce' }, { winPaid: 1_500 })
  })
})

describe('one-roll bets always work (§2.4)', () => {
  it('Set bets Off leaves them working, and a single one-roll bet cannot be switched OFF', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .roll(4, 4)
      .setGlobalWorking(true)
      .place('field', 500)
      .expectBet({ typeId: 'field' }, { working: true })
      .roll(1, 2)
      .expectSettled({ typeId: 'field' }, { outcome: 'win', winPaid: 500 })
    scenario('traditionalBubble')
      .place('field', 500)
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'field' }, false), {
        typeId: 'field',
        scope: 'bet',
      })
  })

  it('take no number, add to the bet already on the spot, and come down after their roll', () => {
    scenario('craplessBubble')
      .expectReject('BAD_PARAMS', (a) => a.place('field', 500, { number: 6 }), { field: 'number' })
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'field', parentId: 'b1' as BetId, amount: cents(500) },
        { field: 'parentId' },
      )
      .place('field', 300)
      .place('field', 200)
      .expectBets([['field', null, 500]])
      .roll(3, 3)
      .expectSettled({ typeId: 'field' }, { outcome: 'lose', stake: 500 })
      .expectBets([])
      .expectBankroll(49_500)
  })
})

/** Net per unit by winning total (§3.4); every other roll loses. */
type NetByTotal = Readonly<Record<number, number>>

const FIELD_2_2: NetByTotal = { 2: 2, 3: 1, 4: 1, 9: 1, 10: 1, 11: 1, 12: 2 }
const FIELD_2_3: NetByTotal = { ...FIELD_2_2, 12: 3 }
const PROPS: readonly NetByTotal[] = [
  { 7: 4 },
  { 2: 7, 3: 7, 12: 7 },
  { 2: 7, 3: 7, 12: 7 },
  { 11: 15 },
  { 2: 30 },
  { 3: 15 },
  { 11: 15 },
  { 12: 30 },
]

/**
 * One-roll bets and hops per machine (§3.4, §5.2): any 7, any craps, C, E and the four horn
 * singles everywhere; hops: Shoot To Win and live tables all 15 easy and 6 hard, Interblock 13 easy
 * (no 1-2 or 5-6) and the hard 2-2 to 5-5, with 1-1, 1-2, 5-6 and 6-6 on the horn singles.
 */
const OFFER: Readonly<
  Record<
    PresetId,
    { field: NetByTotal; hops: 'all' | 'interblock'; ok: [string, ProvenanceStatus][] }
  >
> = {
  craplessBubble: {
    field: FIELD_2_2,
    hops: 'interblock',
    ok: [
      ['/catalog/field', 'verified'],
      ['/catalog/field/pays', 'reported'],
      ['/catalog/any7/pays', 'reported'],
      ['/catalog/snakeEyes', 'verified'],
      ['/catalog/hop13', 'verified'],
      ['/catalog/hop13/pays', 'reported'],
      ['/catalog/hop55', 'verified'],
      ['/catalog/hop55/afterWin', 'assumed'],
    ],
  },
  // The high-limit machine shares craplessBubble's catalog object, so the same set and pays.
  craplessBubbleHighLimit: {
    field: FIELD_2_2,
    hops: 'interblock',
    ok: [
      ['/catalog/field', 'verified'],
      ['/catalog/field/pays', 'reported'],
      ['/catalog/any7/pays', 'reported'],
      ['/catalog/snakeEyes', 'verified'],
      ['/catalog/hop13', 'verified'],
      ['/catalog/hop13/pays', 'reported'],
      ['/catalog/hop55', 'verified'],
      ['/catalog/hop55/afterWin', 'assumed'],
    ],
  },
  traditionalBubble: {
    field: FIELD_2_2,
    hops: 'all',
    ok: [
      ['/catalog/field', 'verified'],
      ['/catalog/any7', 'verified'],
      ['/catalog/horn12', 'verified'],
      ['/catalog/hop12', 'verified'],
      ['/catalog/hop66/pays', 'verified'],
      ['/catalog/hop66/afterWin', 'verified'],
    ],
  },
  strictBubble: {
    field: FIELD_2_2,
    hops: 'interblock',
    ok: [
      ['/catalog/field', 'verified'],
      ['/catalog/field/afterWin', 'assumed'],
      ['/catalog/boxcars/pays', 'reported'],
      ['/catalog/hop46', 'verified'],
      ['/catalog/hop46/pays', 'reported'],
    ],
  },
  traditionalLive345: {
    field: FIELD_2_3,
    hops: 'all',
    ok: [
      ['/catalog/field', 'verified'],
      ['/catalog/aces', 'verified'],
      ['/catalog/hop12', 'assumed'],
      ['/catalog/hop12/pays', 'verified'],
    ],
  },
}

/** A one-roll bet as the rolls it wins, low face first, and its net on each: "1-1=+30 2-6=+1 …". */
function signature(winners: ReadonlyMap<string, string>): string {
  return [...winners].map(([dice, net]) => `${dice}=${net}`).join(' ')
}

function expectedSignatures(id: PresetId): string[] {
  const { field, hops } = OFFER[id]
  const byTotal = (table: NetByTotal) =>
    signature(
      new Map(
        DICE_CLASSES.filter(({ d1, d2 }) => table[d1 + d2] !== undefined).map(({ d1, d2 }) => [
          `${d1}-${d2}`,
          `+${table[d1 + d2]}`,
        ]),
      ),
    )
  const horn = ['1-1', '1-2', '5-6', '6-6']
  const hopList = DICE_CLASSES.map(({ d1, d2 }) => `${d1}-${d2}`).filter(
    (combo) => hops === 'all' || !horn.includes(combo),
  )
  return [
    byTotal(field),
    ...PROPS.map(byTotal),
    ...hopList.map((combo) => signature(new Map([[combo, combo[0] === combo[2] ? '+30' : '+15']]))),
  ].sort()
}

function actualSignatures(cfg: MachineConfig): string[] {
  return [...cfg.catalog.values()]
    .flatMap((type) => (type.family === 'oneRoll' ? [type] : []))
    .map((type) =>
      signature(
        new Map(
          DICE_CLASSES.flatMap(({ d1, d2 }) => {
            const pay = type.pays.get(type.match === 'total' ? String(d1 + d2) : `${d1}-${d2}`)
            return pay === undefined ? [] : [[`${d1}-${d2}`, `+${pay.num}`] as const]
          }),
        ),
      ),
    )
    .sort()
}

describe("each machine's one-roll bets and hops (§3.4, §5.2)", () => {
  it.each(PRESET_IDS)('%s offers exactly its machine’s set, at its pays', (id) => {
    const s = scenario(id)
    for (const [pointer, status] of OFFER[id].ok) s.expectProvenance(pointer, status)
    expect(actualSignatures(s.cfg)).toEqual(expectedSignatures(id))
    const hops = [...s.cfg.catalog.values()].filter(
      (type) => type.family === 'oneRoll' && type.match === 'dice',
    )
    expect(hops.length).toBe(OFFER[id].hops === 'all' ? 21 : 17)
  })
})
