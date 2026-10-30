import { deepFreeze } from '../compile.ts'
import type { MachineConfigInput } from '../schema.ts'
import { ALL_HOPS, hopProvenance, hopTypes } from './shared.ts'

const BOX_NUMBERS = [4, 5, 6, 8, 9, 10] as const

const TAKE_ODDS = {
  '4': '2 to 1',
  '5': '3 to 2',
  '6': '6 to 5',
  '8': '6 to 5',
  '9': '3 to 2',
  '10': '2 to 1',
}
const LAY_ODDS = {
  '4': '1 to 2',
  '5': '2 to 3',
  '6': '5 to 6',
  '8': '5 to 6',
  '9': '2 to 3',
  '10': '1 to 2',
}
/** 3x on 4/10, 4x on 5/9, 5x on 6/8: every maximum odds win is 6x the flat bet. */
const THREE_FOUR_FIVE = { '4': 3, '5': 4, '6': 5, '8': 5, '9': 4, '10': 3 }
/** The don't side may lay 6x the flat bet on every point, which wins 3x, 4x or 5x. */
const SIX_TIMES = { '4': 6, '5': 6, '6': 6, '8': 6, '9': 6, '10': 6 }
/** Odds units that pay whole dollars (rules spec §3.1): take $1/$2/$5, lay $2/$3/$6. */
const TAKE_UNITS = { '4': 100, '5': 200, '6': 500, '8': 500, '9': 200, '10': 100 }
const LAY_UNITS = { '4': 200, '5': 300, '6': 600, '8': 600, '9': 300, '10': 200 }

/** Harrah's Philadelphia: 5% rounded down to whole dollars, $1 minimum, refunded on take-down. */
const LIVE_VIG = {
  rate: '1:20',
  rounding: { mode: 'floor', increment: 100 },
  minimum: 100,
} as const

const DEALER_KEEPS_IT_UP = {
  status: 'assumed',
  note: 'A winning bet stays up unless the player asks for it down.',
} as const

const ONE_ROLL_RETURNED = {
  status: 'assumed',
  note: 'One-roll winners are paid and the bet is returned.',
} as const

const PROPS = {
  status: 'verified',
  source: 'MD-C; HAR-PA; WOO-HE',
  note: 'Posted "to 1": any 7 4 to 1, craps 7 to 1, 3 and 11 15 to 1, 2 and 12 30 to 1.',
} as const

const ODDS_UNITS = {
  status: 'assumed',
  note: 'Odds go in the units that pay whole dollars (rules spec §3.1): take $1 on 4/10, $2 on 5/9 and $5 on 6/8; lay $2, $3 and $6. Other amounts would be paid short, and a $1 lay on 4 would win $0, so the table takes multiples only.',
} as const

const COMPOSITE_UNITS = {
  status: 'assumed',
  note: 'A dealer books a whole-dollar unit on each number: the horn in $4s, C&E in $2s, horn high and the world in $5s, so a $1 horn is refused rather than paid in quarters (rules spec §9 #27).',
} as const

/**
 * A generous live table: 3-4-5x odds, 3:1 on the field's 12, dealer-paid in whole dollars. The
 * reference for "on a live table this pays …" comparisons.
 */
export const traditionalLive345: MachineConfigInput = deepFreeze({
  schemaVersion: 1,
  id: 'traditionalLive345',
  name: 'Generous live table',
  variant: 'traditional',
  rules: {
    naturals: [7, 11],
    craps: [2, 3, 12],
    points: [...BOX_NUMBERS],
    dontBar: 12,
    allowPutBets: true,
  },
  money: {
    payoutRounding: { mode: 'floor', increment: 100 },
    startingBankroll: 50_000,
    betIncrement: 100,
  },
  limits: {
    min: 100,
    max: 500_000,
    perType: {
      pass: { min: 1_000 },
      come: { min: 1_000 },
      dontPass: { min: 1_000 },
      dontCome: { min: 1_000 },
      passOdds: { max: 2_500_000, incrementByNumber: TAKE_UNITS },
      comeOdds: { max: 2_500_000, incrementByNumber: TAKE_UNITS },
      dontPassOdds: { max: 3_000_000, incrementByNumber: LAY_UNITS },
      dontComeOdds: { max: 3_000_000, incrementByNumber: LAY_UNITS },
      ce: { min: 200, increment: 200 },
      horn: { min: 400, increment: 400 },
      hornHigh2: { min: 500, increment: 500 },
      hornHigh3: { min: 500, increment: 500 },
      hornHigh11: { min: 500, increment: 500 },
      hornHigh12: { min: 500, increment: 500 },
      world: { min: 500, increment: 500 },
      fire: { max: 500 },
      place: { min: 500 },
      buy: { min: 2_000 },
      lay: { min: 2_400, minByNumber: { '4': 4_000, '5': 3_000, '9': 3_000, '10': 4_000 } },
    },
    minTotal: null,
  },
  chips: [100, 500, 2_500, 10_000, 50_000],
  catalog: {
    pass: {
      family: 'line',
      label: 'Pass Line',
      side: 'do',
      window: 'comeOut',
      pays: '1 to 1',
      afterWin: 'stay',
    },
    dontPass: {
      family: 'line',
      label: "Don't Pass Bar 12",
      side: 'dont',
      window: 'comeOut',
      pays: '1 to 1',
      afterWin: 'stay',
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    },
    come: {
      family: 'line',
      label: 'Come',
      side: 'do',
      window: 'point',
      pays: '1 to 1',
      afterWin: 'return',
    },
    dontCome: {
      family: 'line',
      label: "Don't Come Bar 12",
      side: 'dont',
      window: 'point',
      pays: '1 to 1',
      afterWin: 'return',
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    },
    passOdds: {
      family: 'odds',
      label: 'Odds',
      parent: 'pass',
      pays: TAKE_ODDS,
      limit: { basis: 'stake', multiple: THREE_FOUR_FIVE },
    },
    comeOdds: {
      family: 'odds',
      label: 'Come Odds',
      parent: 'come',
      pays: TAKE_ODDS,
      limit: { basis: 'stake', multiple: THREE_FOUR_FIVE },
      comeOutDefault: 'off',
    },
    dontPassOdds: {
      family: 'odds',
      label: 'Lay Odds',
      parent: 'dontPass',
      pays: LAY_ODDS,
      limit: { basis: 'stake', multiple: SIX_TIMES },
    },
    dontComeOdds: {
      family: 'odds',
      label: "Don't Come Odds",
      parent: 'dontCome',
      pays: LAY_ODDS,
      limit: { basis: 'stake', multiple: SIX_TIMES },
      comeOutDefault: 'on',
    },
    place: {
      family: 'numberVsSeven',
      kind: 'place',
      label: 'Place',
      numbers: [...BOX_NUMBERS],
      pays: {
        '4': '9 to 5',
        '5': '7 to 5',
        '6': '7 to 6',
        '8': '7 to 6',
        '9': '7 to 5',
        '10': '9 to 5',
      },
      afterWin: 'stay',
      comeOutDefault: 'off',
    },
    buy: {
      family: 'numberVsSeven',
      kind: 'buy',
      label: 'Buy',
      numbers: [...BOX_NUMBERS],
      pays: TAKE_ODDS,
      commission: {
        ...LIVE_VIG,
        basis: 'stake',
        timing: 'upfront',
        refundOnTakeDown: true,
        rearm: 'recollectFromWin',
      },
      commissionByNumber: {
        '4': {
          ...LIVE_VIG,
          basis: 'stake',
          timing: 'onWin',
          refundOnTakeDown: false,
          rearm: 'none',
        },
        '10': {
          ...LIVE_VIG,
          basis: 'stake',
          timing: 'onWin',
          refundOnTakeDown: false,
          rearm: 'none',
        },
      },
      afterWin: 'stay',
      comeOutDefault: 'off',
    },
    lay: {
      family: 'numberVsSeven',
      kind: 'lay',
      label: 'Lay',
      numbers: [...BOX_NUMBERS],
      pays: LAY_ODDS,
      commission: {
        ...LIVE_VIG,
        basis: 'win',
        timing: 'upfront',
        refundOnTakeDown: true,
        rearm: 'recollectFromWin',
      },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    placeToLose: {
      family: 'numberVsSeven',
      kind: 'placeToLose',
      label: 'Place To Lose',
      numbers: [...BOX_NUMBERS],
      pays: {
        '4': '5 to 11',
        '5': '5 to 8',
        '6': '4 to 5',
        '8': '4 to 5',
        '9': '5 to 8',
        '10': '5 to 11',
      },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    big: {
      family: 'numberVsSeven',
      kind: 'big',
      label: 'Big',
      numbers: [6, 8],
      pays: { '6': '1 to 1', '8': '1 to 1' },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    hard: {
      family: 'hardway',
      label: 'Hardways',
      numbers: [4, 6, 8, 10],
      pays: { '4': '7 to 1', '6': '9 to 1', '8': '9 to 1', '10': '7 to 1' },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    field: {
      family: 'oneRoll',
      label: 'Field',
      match: 'total',
      pays: {
        '2': '2 to 1',
        '3': '1 to 1',
        '4': '1 to 1',
        '9': '1 to 1',
        '10': '1 to 1',
        '11': '1 to 1',
        '12': '3 to 1',
      },
      afterWin: 'return',
    },
    any7: {
      family: 'oneRoll',
      label: 'Any Seven',
      match: 'total',
      pays: { '7': '4 to 1' },
      afterWin: 'return',
    },
    anyCraps: {
      family: 'oneRoll',
      label: 'Any Craps',
      match: 'total',
      pays: { '2': '7 to 1', '3': '7 to 1', '12': '7 to 1' },
      afterWin: 'return',
    },
    c: {
      family: 'oneRoll',
      label: 'C',
      match: 'total',
      pays: { '2': '7 to 1', '3': '7 to 1', '12': '7 to 1' },
      afterWin: 'return',
    },
    e: {
      family: 'oneRoll',
      label: 'E',
      match: 'total',
      pays: { '11': '15 to 1' },
      afterWin: 'return',
    },
    aces: {
      family: 'oneRoll',
      label: 'Aces',
      match: 'total',
      pays: { '2': '30 to 1' },
      afterWin: 'return',
    },
    aceDeuce: {
      family: 'oneRoll',
      label: 'Ace-Deuce',
      match: 'total',
      pays: { '3': '15 to 1' },
      afterWin: 'return',
    },
    yo: {
      family: 'oneRoll',
      label: 'Yo',
      match: 'total',
      pays: { '11': '15 to 1' },
      afterWin: 'return',
    },
    boxcars: {
      family: 'oneRoll',
      label: 'Boxcars',
      match: 'total',
      pays: { '12': '30 to 1' },
      afterWin: 'return',
    },
    ...hopTypes(ALL_HOPS, { easy: '15 to 1', hard: '30 to 1' }, 'return'),
  },
  composites: {
    ce: {
      label: 'C & E',
      parts: [
        { typeId: 'c', units: 1 },
        { typeId: 'e', units: 1 },
      ],
    },
    horn: {
      label: 'Horn',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 1 },
      ],
    },
    hornHigh2: {
      label: 'Horn High Aces',
      parts: [
        { typeId: 'aces', units: 2 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 1 },
      ],
    },
    hornHigh3: {
      label: 'Horn High Ace-Deuce',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'aceDeuce', units: 2 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 1 },
      ],
    },
    hornHigh11: {
      label: 'Horn High Yo',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 2 },
        { typeId: 'boxcars', units: 1 },
      ],
    },
    hornHigh12: {
      label: 'Horn High Boxcars',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 2 },
      ],
    },
    world: {
      label: 'World',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 1 },
        { typeId: 'any7', units: 1 },
      ],
    },
  },
  sideBets: {
    fire: {
      family: 'uniquePointsMade',
      label: 'Fire Bet',
      countedPoints: [...BOX_NUMBERS],
      payTable: { '4': '24 to 1', '5': '249 to 1', '6': '999 to 1' },
      payImmediatelyAt: null,
      placement: 'newHand',
    },
  },
  workingToggle: {
    global: false,
    perBet: true,
    scope: 'untilChanged',
    types: [
      'place',
      'buy',
      'lay',
      'placeToLose',
      'big',
      'hard',
      'passOdds',
      'comeOdds',
      'dontPassOdds',
      'dontComeOdds',
    ],
  },
  comeOut: { autoOff: null },
  afterSevenOut: { newPlacedOff: null },
  layAutoOn: null,
  oddsOffReturnedAtPointMade: false,
  offBets: { consumeCredit: true },
  exclusiveGroups: [],
  excludeLineVsLayBuy: false,
  payLabelStyle: 'asWritten',
  flow: {
    shooter: { mode: 'community' },
    invalidRoll: 'noRoll',
    puckReset: 0,
    groupButtons: { buttons: [], condition: 'always' },
    historyLength: 0,
    macros: [],
  },
  pace: { rollsPerHour: 144, betWindowSec: null, shooterWindowSec: null },
  provenance: {
    '/variant': {
      status: 'verified',
      source: 'WOO-B; MD-C',
      note: 'A dealer-run traditional table.',
    },
    '/rules': {
      status: 'verified',
      source: 'WOO-B; MD-C; HAR-PA',
      note: "Win on 7 or 11, lose on 2, 3 or 12; don't bets bar 12.",
    },
    '/rules/allowPutBets': {
      status: 'reported',
      source: 'WOO-B',
      note: 'Some casinos take a flat pass or come bet after the point (a put bet).',
    },
    '/money/payoutRounding': {
      status: 'verified',
      source: 'LVA-RND; HAR-PA',
      note: 'Pays round down to whole dollars ("keep the change"): $5 on the 6 pays $5.',
    },
    '/money/startingBankroll': { status: 'assumed', note: 'Trainer default; not a table value.' },
    '/money/betIncrement': {
      status: 'verified',
      source: 'WOO-B',
      note: 'Whole-dollar chips; bettors use $5 and $6 units to be paid in full.',
    },
    '/limits': {
      status: 'assumed',
      note: '$10 line minimum and $5,000 maximum; odds may exceed the table maximum (3-4-5x of $5,000; lays up to 6x). Props from $1.',
    },
    '/limits/perType/passOdds/incrementByNumber': ODDS_UNITS,
    '/limits/perType/comeOdds/incrementByNumber': ODDS_UNITS,
    '/limits/perType/dontPassOdds/incrementByNumber': ODDS_UNITS,
    '/limits/perType/dontComeOdds/incrementByNumber': ODDS_UNITS,
    '/limits/perType/ce': COMPOSITE_UNITS,
    '/limits/perType/horn': COMPOSITE_UNITS,
    '/limits/perType/hornHigh2': COMPOSITE_UNITS,
    '/limits/perType/hornHigh3': COMPOSITE_UNITS,
    '/limits/perType/hornHigh11': COMPOSITE_UNITS,
    '/limits/perType/hornHigh12': COMPOSITE_UNITS,
    '/limits/perType/world': COMPOSITE_UNITS,
    '/limits/perType/fire': {
      status: 'reported',
      source: 'MD-C',
      note: 'Maryland posts the Fire Bet at $1 to $5 in $1 units, the only limits researched (research sidebets.md §5); a Las Vegas table posts its own.',
    },
    '/limits/perType/place': {
      status: 'assumed',
      note: 'Place bets from $5, the live grid ($5 on 4, 5, 9 and 10; $6 on 6 and 8, research spec.md): a $5 place 6 is taken and paid $5, keeping the change (LVA-RND), while a $1 place 4 paid $1 at 9 to 5 would cost 33.33%. A $10 table may post higher place minimums (M12, impl4 item 18).',
    },
    '/limits/perType/buy': {
      status: 'verified',
      source: 'HAR-PA',
      note: 'Minimum buy $20, where the 5% commission is a whole $1 (rules spec §4.3, LIVE minimums).',
    },
    '/limits/perType/lay': {
      status: 'verified',
      source: 'HAR-PA',
      note: 'A lay must win at least $20 (rules spec §4.3, LIVE minimums): $40 on 4 and 10 at 1 to 2, $30 on 5 and 9 at 2 to 3, $24 on 6 and 8 at 5 to 6 (the type minimum).',
    },
    '/chips': { status: 'assumed', note: 'Standard $1, $5, $25, $100 and $500 chips.' },
    '/catalog/pass': {
      status: 'verified',
      source: 'WOO-B; MD-C',
      note: 'A contract bet once the point is set: never reduced or removed.',
    },
    '/catalog/pass/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/dontPass': {
      status: 'verified',
      source: 'MD-C; HAR-PA',
      note: 'May be reduced or removed after the point, never replaced or increased (rules spec §0.2 #5).',
    },
    '/catalog/dontPass/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/come': {
      status: 'verified',
      source: 'WOO-B; MD-C',
      note: 'Placed in the point phase; a contract bet once it travels.',
    },
    '/catalog/come/afterWin': {
      status: 'assumed',
      note: 'A winning come bet is paid and returned with its odds.',
    },
    '/catalog/dontCome': {
      status: 'verified',
      source: 'MD-C',
      note: 'May be reduced or removed once on a number, not replaced or increased.',
    },
    '/catalog/dontCome/afterWin': {
      status: 'assumed',
      note: "A winning don't come bet is paid and returned with its odds.",
    },
    '/catalog/passOdds': {
      status: 'verified',
      source: 'WOO-B',
      note: 'True odds; 3x on 4/10, 4x on 5/9, 5x on 6/8 ("most casinos allow ... 3-4-5X Odds").',
    },
    '/catalog/comeOdds': {
      status: 'verified',
      source: 'WOO-B',
      note: 'As pass odds; OFF on the come-out and returned if the come bet is decided.',
    },
    '/catalog/dontPassOdds': {
      status: 'verified',
      source: 'WOO-B',
      note: 'True odds; "you can Lay up to 6X the Don\'t Pass bet after any Point".',
    },
    '/catalog/dontComeOdds': {
      status: 'verified',
      source: 'WOO-B',
      note: "As lay odds on Don't Pass; working on the come-out.",
    },
    '/catalog/place': {
      status: 'verified',
      source: 'WOO-B; MD-C',
      note: 'Standard pays; OFF on the come-out unless called on.',
    },
    '/catalog/place/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/buy': {
      status: 'verified',
      source: 'HAR-PA; WOO-B',
      note: 'True odds, OFF on the come-out. 5% of the bet charged when placed, rounded down to whole dollars with a $1 minimum, refunded if taken down and paid again on each win.',
    },
    '/catalog/buy/commissionByNumber': {
      status: 'reported',
      source: 'WOO-B',
      note: '"At some casinos, the commission on the 4 and 10 is charged only on a win."',
    },
    '/catalog/buy/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/lay': {
      status: 'verified',
      source: 'HAR-PA; WOO-B',
      note: 'True odds, working on the come-out. 5% of the win charged when placed, rounded down with a $1 minimum, refunded if taken down, paid again on each win.',
    },
    '/catalog/lay/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/placeToLose': {
      status: 'verified',
      source: 'MD-C',
      note: '5 to 11, 5 to 8 and 4 to 5.',
    },
    '/catalog/placeToLose/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/placeToLose/comeOutDefault': {
      status: 'reported',
      source: 'WOO-B',
      note: 'Working on the come-out per WoO ("not 100% sure"); Maryland makes it inactive unless called on.',
    },
    '/catalog/big': {
      status: 'verified',
      source: 'WOO-B; WIKI',
      note: 'Big 6 and Big 8 pay even money.',
    },
    '/catalog/big/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/big/comeOutDefault': {
      status: 'reported',
      source: 'WIKI',
      note: '"Big 6 and 8 bets always work."',
    },
    '/catalog/hard': {
      status: 'verified',
      source: 'WOO-B; HAR-PA',
      note: '7 to 1 and 9 to 1; working on the come-out in Las Vegas (OFF in Atlantic City and Maryland).',
    },
    '/catalog/hard/afterWin': DEALER_KEEPS_IT_UP,
    '/catalog/field': {
      status: 'verified',
      source: 'WOO-B',
      note: '2 to 1 on 2 and 3 to 1 on 12, as at most Las Vegas tables.',
    },
    '/catalog/field/afterWin': ONE_ROLL_RETURNED,
    '/catalog/any7': PROPS,
    '/catalog/any7/afterWin': ONE_ROLL_RETURNED,
    '/catalog/anyCraps': PROPS,
    '/catalog/anyCraps/afterWin': ONE_ROLL_RETURNED,
    '/catalog/c': PROPS,
    '/catalog/c/afterWin': ONE_ROLL_RETURNED,
    '/catalog/e': PROPS,
    '/catalog/e/afterWin': ONE_ROLL_RETURNED,
    '/catalog/aces': PROPS,
    '/catalog/aces/afterWin': ONE_ROLL_RETURNED,
    '/catalog/aceDeuce': PROPS,
    '/catalog/aceDeuce/afterWin': ONE_ROLL_RETURNED,
    '/catalog/yo': PROPS,
    '/catalog/yo/afterWin': ONE_ROLL_RETURNED,
    '/catalog/boxcars': PROPS,
    '/catalog/boxcars/afterWin': ONE_ROLL_RETURNED,
    ...hopProvenance(ALL_HOPS, {
      type: {
        status: 'assumed',
        note: 'A live table books all 21 hops; a winning hop is paid and returned.',
      },
      pays: {
        status: 'verified',
        source: 'MD-CL; WOO-HE',
        note: '15 to 1 on an easy hop and 30 to 1 on a hard hop.',
      },
    }),
    '/composites': {
      status: 'verified',
      source: 'MD-C; MD-CL; WIKI',
      note: 'Horn: a unit on each of 2, 3, 11 and 12. Horn high: a fifth unit on one of them. World: the horn plus Any Seven, so a 7 pushes.',
    },
    '/sideBets/fire': {
      status: 'reported',
      source: 'WOO-FIRE; MD-C',
      note: 'Pay table A, 24, 249 and 999 to 1 for 4, 5 and 6 unique points, settled at the seven-out (MD); an optional live side bet.',
    },
    '/workingToggle': {
      status: 'verified',
      source: 'WOO-B',
      note: 'Each bet is called on or off with the dealer; there is no all-bets button.',
    },
    '/comeOut': {
      status: 'verified',
      source: 'WOO-B',
      note: 'No machine auto-OFF on a live table.',
    },
    '/afterSevenOut': {
      status: 'verified',
      source: 'WOO-B',
      note: 'No machine rule after a seven-out on a live table.',
    },
    '/layAutoOn': { status: 'verified', source: 'WOO-B', note: 'Lays stay as called.' },
    '/oddsOffReturnedAtPointMade': {
      status: 'assumed',
      note: 'Odds called off stay up until called on or taken down.',
    },
    '/offBets': { status: 'assumed', note: 'Chips called off are still on the table.' },
    '/exclusiveGroups': {
      status: 'assumed',
      note: "No exclusions: a live table lets a player bet both ways (doey-don't).",
    },
    '/excludeLineVsLayBuy': { status: 'assumed', note: 'No such exclusion on a live table.' },
    '/payLabelStyle': {
      status: 'assumed',
      note: 'Display only: ratios are shown as posted ("to 1").',
    },
    '/flow': {
      status: 'assumed',
      note: 'A rotating shooter, "no roll" for an invalid throw, and no buttons, macros or history panel.',
    },
    '/pace/rollsPerHour': {
      status: 'reported',
      source: 'WOO-K',
      note: 'About 144 rolls per hour with five players (Kilby).',
    },
    '/pace/betWindowSec': { status: 'assumed', note: 'Dealer-paced: no bet timer.' },
    '/pace/shooterWindowSec': { status: 'assumed', note: 'Dealer-paced: no shooter timer.' },
  },
} satisfies MachineConfigInput)
