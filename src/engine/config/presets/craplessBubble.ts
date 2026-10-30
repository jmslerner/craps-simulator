import { deepFreeze } from '../compile.ts'
import type { MachineConfigInput } from '../schema.ts'
import { INTERBLOCK_HOPS, hopProvenance, hopTypes } from './shared.ts'

const ALL_POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const

/** True odds on every crapless point. */
const TRUE_ODDS = {
  '2': '6:1',
  '3': '3:1',
  '4': '2:1',
  '5': '3:2',
  '6': '6:5',
  '8': '6:5',
  '9': '3:2',
  '10': '2:1',
  '11': '3:1',
  '12': '6:1',
}

/** 2x the flat bet on every point (rules spec §4.4). */
const DOUBLE_ODDS = {
  '2': 2,
  '3': 2,
  '4': 2,
  '5': 2,
  '6': 2,
  '8': 2,
  '9': 2,
  '10': 2,
  '11': 2,
  '12': 2,
}

const ODDS_PAYS = {
  status: 'assumed',
  source: 'MD-CL; WOO-CL',
  note: 'True odds, including 6:1 on 2/12 and 3:1 on 3/11, as on live crapless tables. Interblock pays come from its par sheet, which is not public (rules spec §5.2, §9 #4).',
} as const

const ODDS_LIMIT = {
  status: 'reported',
  source: 'VA; LVA-CL',
  note: '2x on all ten points ("mostly double"). The cap shows only in the game\'s odds pop-up (rules spec §9 #4).',
} as const

const BET_STAYS = {
  status: 'assumed',
  note: 'A winning bet stays up (rules spec §5.2); Interblock does not say.',
} as const

const ONE_ROLL_RETURNED = {
  status: 'assumed',
  note: 'One-roll winners are paid and returned; Keep Bets On and Repeat are UI conveniences (rules spec §9 #19).',
} as const

const PROP_PAYS = {
  status: 'reported',
  source: 'IB (game screen)',
  note: 'The screen shows props as "for 1": 5 (seven), 8 (craps), 16 (eleven, 3, easy hops) and 31 (2, 12, hard hops) for 1.',
} as const

const COME_RETURNED = {
  status: 'assumed',
  note: 'A winning come bet is paid and returned; Interblock does not say (rules spec §5.2).',
} as const

const PLACE_2_12 = {
  status: 'assumed',
  source: 'WOO-CL; MD-CL',
  note: '11:2, the better of the two published crapless pays (5:1 per CROWN-CL); the Interblock par sheet is not public (rules spec §9 #4).',
} as const

const PLACE_3_11 = {
  status: 'assumed',
  source: 'WOO-CL; MD-CL',
  note: '11:4, the better of the two published crapless pays (13:5 per CROWN-CL); the Interblock par sheet is not public (rules spec §9 #4).',
} as const

const COME_OUT_ON = {
  status: 'verified',
  source: 'IB §2.6, §3.2; IB221',
  note: 'Place and buy bets work on the come-out unless set OFF (rules spec §0.2 #4).',
} as const

const LUCKY_ROLLER = {
  status: 'verified',
  source: 'IB §6.2',
  note: "Low Rolls 2 to 6, High Rolls 8 to 12, Roll 'Em All all ten, before any 7; offered on every Interblock game, crapless included.",
} as const

const LUCKY_ROLLER_PAYS = {
  status: 'verified',
  source: 'IB §6.2 (game screen); VA; USER photo 2026-10-30',
  note: "30, 30 and 155 to 1: the screen shows Low 31, Roll 'Em All 156 and High 31 for 1 (rules spec §0.2 #10), as the player's own station prints them (research interblock-station-photo-2026-10-30.md).",
} as const

const LUCKY_ROLLER_WINDOW = {
  status: 'verified',
  source: 'IB §6.2, §6.2.1',
  note: 'Only after a 7 or before the first roll of the history cycle; no new bet of a type after it wins until a 7.',
} as const

const LUCKY_ROLLER_ENDS = {
  status: 'verified',
  source: 'IB §6.2',
  note: 'Any 7, including a come-out 7, loses the bet.',
} as const

/**
 * Crapless bubble craps: an Interblock heads-up crapless machine (Interblock Crapless Craps,
 * GV 6.0+), as at MGM Grand, Fontainebleau, Fremont and Red Rock. The default preset.
 */
export const craplessBubble: MachineConfigInput = deepFreeze({
  schemaVersion: 1,
  id: 'craplessBubble',
  name: 'Crapless bubble craps',
  variant: 'crapless',
  rules: {
    naturals: [7],
    craps: [],
    points: [...ALL_POINTS],
    dontBar: null,
    allowPutBets: false,
  },
  money: {
    payoutRounding: { mode: 'floor', increment: 1 },
    startingBankroll: 50_000,
    betIncrement: 100,
  },
  limits: {
    min: 100,
    max: 50_000,
    minTotal: { amount: 500, scope: 'totalRound', countOff: false, countSideBets: false },
  },
  chips: [100, 200, 300, 500, 1_000, 2_500, 5_000, 10_000],
  catalog: {
    pass: {
      family: 'line',
      label: 'Pass Line',
      side: 'do',
      window: 'comeOut',
      pays: '1:1',
      afterWin: 'stay',
    },
    come: {
      family: 'line',
      label: 'Come',
      side: 'do',
      window: 'point',
      pays: '1:1',
      afterWin: 'return',
    },
    passOdds: {
      family: 'odds',
      label: 'Pass Odds',
      parent: 'pass',
      pays: TRUE_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE_ODDS },
    },
    comeOdds: {
      family: 'odds',
      label: 'Come Odds',
      parent: 'come',
      pays: TRUE_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE_ODDS },
      comeOutDefault: 'off',
    },
    place: {
      family: 'numberVsSeven',
      kind: 'place',
      label: 'Place',
      numbers: [...ALL_POINTS],
      pays: {
        '2': '11:2',
        '3': '11:4',
        '4': '9:5',
        '5': '7:5',
        '6': '7:6',
        '8': '7:6',
        '9': '7:5',
        '10': '9:5',
        '11': '11:4',
        '12': '11:2',
      },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    buy: {
      family: 'numberVsSeven',
      kind: 'buy',
      label: 'Buy',
      numbers: [...ALL_POINTS],
      pays: TRUE_ODDS,
      commission: {
        rate: '1:20',
        basis: 'stake',
        timing: 'upfront',
        rounding: { mode: 'ceil', increment: 1 },
        minimum: 0,
        refundOnTakeDown: false,
        rearm: 'recollectFromWin',
      },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    hard: {
      family: 'hardway',
      label: 'Hard Ways',
      numbers: [4, 6, 8, 10],
      pays: { '4': '7:1', '6': '9:1', '8': '9:1', '10': '7:1' },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    field: {
      family: 'oneRoll',
      label: 'Field',
      match: 'total',
      pays: {
        '2': '2:1',
        '3': '1:1',
        '4': '1:1',
        '9': '1:1',
        '10': '1:1',
        '11': '1:1',
        '12': '2:1',
      },
      afterWin: 'return',
    },
    any7: {
      family: 'oneRoll',
      label: 'Seven',
      match: 'total',
      pays: { '7': '5 for 1' },
      afterWin: 'return',
    },
    anyCraps: {
      family: 'oneRoll',
      label: 'Any Craps',
      match: 'total',
      pays: { '2': '8 for 1', '3': '8 for 1', '12': '8 for 1' },
      afterWin: 'return',
    },
    c: {
      family: 'oneRoll',
      label: 'C',
      match: 'total',
      pays: { '2': '8 for 1', '3': '8 for 1', '12': '8 for 1' },
      afterWin: 'return',
    },
    e: {
      family: 'oneRoll',
      label: 'E',
      match: 'total',
      pays: { '11': '16 for 1' },
      afterWin: 'return',
    },
    snakeEyes: {
      family: 'oneRoll',
      label: 'Snake Eyes',
      match: 'total',
      pays: { '2': '31 for 1' },
      afterWin: 'return',
    },
    aceDeuce: {
      family: 'oneRoll',
      label: 'Ace-Deuce',
      match: 'total',
      pays: { '3': '16 for 1' },
      afterWin: 'return',
    },
    yo: {
      family: 'oneRoll',
      label: 'Yo',
      match: 'total',
      pays: { '11': '16 for 1' },
      afterWin: 'return',
    },
    boxcars: {
      family: 'oneRoll',
      label: 'Boxcars',
      match: 'total',
      pays: { '12': '31 for 1' },
      afterWin: 'return',
    },
    ...hopTypes(INTERBLOCK_HOPS, { easy: '16 for 1', hard: '31 for 1' }, 'return'),
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
        { typeId: 'snakeEyes', units: 1 },
        { typeId: 'aceDeuce', units: 1 },
        { typeId: 'yo', units: 1 },
        { typeId: 'boxcars', units: 1 },
      ],
    },
  },
  sideBets: {
    luckyRollerLow: {
      family: 'collectSet',
      label: 'Low Rolls',
      targets: [2, 3, 4, 5, 6],
      pays: '31 for 1',
      endsOn: 'anySeven',
      placement: 'afterSevenOrStart',
    },
    luckyRollerHigh: {
      family: 'collectSet',
      label: 'High Rolls',
      targets: [8, 9, 10, 11, 12],
      pays: '31 for 1',
      endsOn: 'anySeven',
      placement: 'afterSevenOrStart',
    },
    luckyRollerAll: {
      family: 'collectSet',
      label: "Roll 'Em All",
      targets: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
      pays: '156 for 1',
      endsOn: 'anySeven',
      placement: 'afterSevenOrStart',
    },
  },
  workingToggle: {
    global: true,
    perBet: false,
    scope: 'untilChanged',
    types: ['place', 'buy', 'passOdds', 'comeOdds', 'hard'],
  },
  comeOut: { autoOff: null },
  afterSevenOut: {
    newPlacedOff: { types: ['place', 'buy'], trigger: 'sevenOut', until: 'playerOn' },
  },
  layAutoOn: null,
  oddsOffReturnedAtPointMade: true,
  offBets: { consumeCredit: true },
  exclusiveGroups: [],
  excludeLineVsLayBuy: false,
  payLabelStyle: 'for',
  flow: {
    shooter: { mode: 'single' },
    invalidRoll: 'reVibrate',
    puckReset: 0,
    groupButtons: { buttons: ['press', 'across'], condition: 'afterComeOutWithLineOrOneRoll' },
    historyLength: 20,
    macros: ['repeatLastBet', 'double'],
  },
  pace: { rollsPerHour: 120, betWindowSec: null, shooterWindowSec: null },
  provenance: {
    '/variant': {
      status: 'verified',
      source: 'IB §1.3.1, §5.2; G3-MOH',
      note: 'Interblock Crapless Craps (GV 6.0+); on Las Vegas heads-up machines per VA.',
    },
    '/rules': {
      status: 'verified',
      source: 'IB §2.2; WOO-CL; MD-CL',
      note: 'Only 7 wins the come-out; 2, 3, 11 and 12 are points. No don\'t bets, so no bar; Pass "can only be placed before the come-out roll", so no put bets.',
    },
    '/money/payoutRounding': {
      status: 'assumed',
      note: 'Fractional pays are floored to the cent: the conservative choice; no report exists for Interblock (rules spec §4.2, §9 #1).',
    },
    '/money/startingBankroll': { status: 'assumed', note: 'Trainer default; not a machine value.' },
    '/money/betIncrement': {
      status: 'assumed',
      note: 'Whole-dollar bets at a $1 denomination; chip and credit values scale with denomination.',
    },
    '/limits/min': {
      status: 'assumed',
      source: 'VA',
      note: '$1 per bet; machines report $1 to $6 minimums.',
    },
    '/limits/max': {
      status: 'assumed',
      source: 'WSGC-ETG',
      note: '$500 per wager, the Washington tribal ETG cap; casino maximums vary.',
    },
    '/limits/minTotal': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"BETS ARE NOT VALID YET! – Must bet N credits more!"; OFF bets do not satisfy it.',
    },
    '/limits/minTotal/amount': {
      status: 'assumed',
      source: 'VA; G3-MOH',
      note: '$5 total: crapless minimums are reported at $1 to $6, and $5 at Mohegan Sun.',
    },
    '/limits/minTotal/countSideBets': {
      status: 'assumed',
      note: 'Whether side bets count toward the minimum is undocumented (rules spec §9 #11).',
    },
    '/chips': {
      status: 'reported',
      source: 'IB §5.1; USER photo 2026-10-30',
      note: "The player's station shows eight chips at this denomination: $1, $2, $3, $5, $10, $25, $50 and $100 (research interblock-station-photo-2026-10-30.md); IB §5.1 says chip values scale with denomination.",
    },
    '/catalog/pass': {
      status: 'verified',
      source: 'IB §2.2',
      note: 'Placed only before the come-out roll; a contract bet once the point is set.',
    },
    '/catalog/pass/afterWin': {
      status: 'verified',
      source: 'IB §2.1',
      note: 'A resolved winning bet\'s chips are "pushed" to the next round.',
    },
    '/catalog/come': {
      status: 'verified',
      source: 'IB §2.4',
      note: 'Placed after a point is set; a contract bet once it travels.',
    },
    '/catalog/come/window': {
      status: 'assumed',
      source: 'IB §2.4',
      note: 'Taken only in the point phase (rules spec §3.1); the IB §2.4 text also allows a Come bet after the pass point is made (rules spec §9 #26).',
    },
    '/catalog/come/afterWin': COME_RETURNED,
    '/catalog/passOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: 'Behind the Pass Line, by multiplier pop-up or by hand; adjustable until resolved.',
    },
    '/catalog/passOdds/pays': ODDS_PAYS,
    '/catalog/passOdds/limit': ODDS_LIMIT,
    '/catalog/comeOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: 'Behind a come bet on its number.',
    },
    '/catalog/comeOdds/pays': ODDS_PAYS,
    '/catalog/comeOdds/limit': ODDS_LIMIT,
    '/catalog/comeOdds/comeOutDefault': {
      status: 'assumed',
      source: 'WOO-B',
      note: 'Come odds are OFF on the come-out and returned if the come bet is decided, as on live tables; undocumented for Interblock (rules spec §9 #5).',
    },
    '/catalog/place': {
      status: 'verified',
      source: 'IB §2.6',
      note: 'Place bets on all ten points, on any roll.',
    },
    '/catalog/place/pays': {
      status: 'assumed',
      source: 'CW §17; WOO-B',
      note: 'The standard 9:5, 7:5 and 7:6 on 4 to 10, as on Shoot To Win and live tables. Interblock v2.5.1 removed its pay tables, and its par sheet is not public (rules spec §5.2).',
    },
    '/catalog/place/pays/9': {
      status: 'reported',
      source: 'USER photo 2026-10-30',
      note: 'The player\'s station prints "PLACE 12 FOR 5" under NINE: 7:5 (research interblock-station-photo-2026-10-30.md).',
    },
    '/catalog/place/pays/2': PLACE_2_12,
    '/catalog/place/pays/12': PLACE_2_12,
    '/catalog/place/pays/3': PLACE_3_11,
    '/catalog/place/pays/11': PLACE_3_11,
    '/catalog/place/afterWin': BET_STAYS,
    '/catalog/place/comeOutDefault': COME_OUT_ON,
    '/catalog/buy': {
      status: 'verified',
      source: 'IB §2.6',
      note: 'Buy bets on all ten points pay true odds with commission.',
    },
    '/catalog/buy/pays': { status: 'verified', source: 'IB §2.6; WOO-CL', note: 'True odds.' },
    '/catalog/buy/commission': {
      status: 'reported',
      source: 'VA',
      note: '5% of the bet, paid up front: on crapless machines "most require a 5% commission to be paid upfront on all Buy wagers".',
    },
    '/catalog/buy/commission/timing': {
      status: 'verified',
      source: 'IB §3.3',
      note: 'GV6.5 up-front commission pop-up; answering NO removes the bet.',
    },
    '/catalog/buy/commission/rounding': {
      status: 'assumed',
      note: 'A sub-cent commission rounds up to the cent (rules spec §4.2); 5% of a whole-dollar bet never needs it.',
    },
    '/catalog/buy/commission/minimum': {
      status: 'assumed',
      note: 'No minimum: machines charge an exact 5%.',
    },
    '/catalog/buy/commission/refundOnTakeDown': {
      status: 'assumed',
      note: 'Not refunded on take-down: the conservative choice (rules spec §9 #3).',
    },
    '/catalog/buy/commission/rearm': {
      status: 'assumed',
      note: 'Re-collected from the win when a winning buy stays up: the conservative choice, and it decides place vs buy on 5/9 (rules spec §9 #3).',
    },
    '/catalog/buy/afterWin': BET_STAYS,
    '/catalog/buy/comeOutDefault': COME_OUT_ON,
    '/catalog/hard': {
      status: 'verified',
      source: 'IB (Hard Ways bets)',
      note: 'Hard 4, 6, 8 and 10: win on the pair, lose on the easy way or a 7.',
    },
    '/catalog/hard/pays': {
      status: 'assumed',
      source: 'CW §16; WOO-B',
      note: '7:1 on 4/10 and 9:1 on 6/8, the standard pays; the Interblock par sheet is not public.',
    },
    '/catalog/hard/afterWin': BET_STAYS,
    '/catalog/hard/comeOutDefault': {
      status: 'assumed',
      note: 'Hardways work on the come-out unless set OFF; undocumented for Interblock (rules spec §9 #5).',
    },
    '/catalog/field': {
      status: 'verified',
      source: 'IB §2.7',
      note: 'Wins on 2, 3, 4, 9, 10, 11 and 12.',
    },
    '/catalog/field/pays': {
      status: 'reported',
      source: 'VA; IB §2.7',
      note: '2:1 on 2 and 12 ("typically ... a double payout"); pay table EL602 pays 3:1 on 12 in standard craps only.',
    },
    '/catalog/field/pays/2': {
      status: 'verified',
      source: 'VA; IB §2.7; USER photo 2026-10-30',
      note: 'The player\'s station prints the field\'s 2 circled, "PAYS DOUBLE": 2:1 (research interblock-station-photo-2026-10-30.md). Its 12 is out of the photo.',
    },
    '/catalog/field/afterWin': ONE_ROLL_RETURNED,
    '/catalog/any7': {
      status: 'verified',
      source: 'IB (Seven)',
      note: 'The Seven bet: one roll, any 7.',
    },
    '/catalog/any7/pays': PROP_PAYS,
    '/catalog/any7/afterWin': ONE_ROLL_RETURNED,
    '/catalog/anyCraps': {
      status: 'verified',
      source: 'IB (Any Craps)',
      note: 'One roll on 2, 3 or 12.',
    },
    '/catalog/anyCraps/pays': PROP_PAYS,
    '/catalog/anyCraps/afterWin': ONE_ROLL_RETURNED,
    '/catalog/c': {
      status: 'verified',
      source: 'IB §2.9',
      note: 'C (Craps): one roll on 2, 3 or 12.',
    },
    '/catalog/c/pays': PROP_PAYS,
    '/catalog/c/afterWin': ONE_ROLL_RETURNED,
    '/catalog/e': { status: 'verified', source: 'IB §2.9', note: 'E (Eleven): one roll on 11.' },
    '/catalog/e/pays': PROP_PAYS,
    '/catalog/e/afterWin': ONE_ROLL_RETURNED,
    '/catalog/snakeEyes': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 1-1.',
    },
    '/catalog/snakeEyes/pays': PROP_PAYS,
    '/catalog/snakeEyes/afterWin': ONE_ROLL_RETURNED,
    '/catalog/aceDeuce': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 1-2.',
    },
    '/catalog/aceDeuce/pays': PROP_PAYS,
    '/catalog/aceDeuce/afterWin': ONE_ROLL_RETURNED,
    '/catalog/yo': { status: 'verified', source: 'IB (Horn bets)', note: 'Horn single on 5-6.' },
    '/catalog/yo/pays': PROP_PAYS,
    '/catalog/yo/afterWin': ONE_ROLL_RETURNED,
    '/catalog/boxcars': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 6-6.',
    },
    '/catalog/boxcars/pays': PROP_PAYS,
    '/catalog/boxcars/afterWin': ONE_ROLL_RETURNED,
    ...hopProvenance(INTERBLOCK_HOPS, {
      type: {
        status: 'verified',
        source: 'IB (Hop bets)',
        note: '13 easy hops and the hard hops 2-2 to 5-5; 1-1, 1-2, 5-6 and 6-6 are the horn singles.',
      },
      pays: {
        status: 'verified',
        source: 'IB (game screen); USER photo 2026-10-30',
        note: '16 for 1 on an easy hop and 31 for 1 on a hard hop, as the screen shows: the player\'s station prints "31 FOR 1 • HOPPING HARD WAYS" over 2-2 to 5-5 and "16 FOR 1 • HOP BETS" over the 13 easy hops (research interblock-station-photo-2026-10-30.md).',
      },
      afterWin: ONE_ROLL_RETURNED,
    }),
    '/composites': {
      status: 'verified',
      source: 'IB §2.9; IB (Horn bets)',
      note: 'C&E wins on 2, 3, 11 and 12; the Horn field splits the bet equally among the four horn singles.',
    },
    '/sideBets/luckyRollerLow': LUCKY_ROLLER,
    '/sideBets/luckyRollerHigh': LUCKY_ROLLER,
    '/sideBets/luckyRollerAll': LUCKY_ROLLER,
    '/sideBets/luckyRollerLow/pays': LUCKY_ROLLER_PAYS,
    '/sideBets/luckyRollerHigh/pays': LUCKY_ROLLER_PAYS,
    '/sideBets/luckyRollerAll/pays': LUCKY_ROLLER_PAYS,
    '/sideBets/luckyRollerLow/placement': LUCKY_ROLLER_WINDOW,
    '/sideBets/luckyRollerHigh/placement': LUCKY_ROLLER_WINDOW,
    '/sideBets/luckyRollerAll/placement': LUCKY_ROLLER_WINDOW,
    '/sideBets/luckyRollerLow/endsOn': LUCKY_ROLLER_ENDS,
    '/sideBets/luckyRollerHigh/endsOn': LUCKY_ROLLER_ENDS,
    '/sideBets/luckyRollerAll/endsOn': LUCKY_ROLLER_ENDS,
    '/workingToggle': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"Set bets On/Off" covers Place, Buy, Odds and Hard Ways (Lay is not offered in crapless) and stays until changed.',
    },
    '/workingToggle/perBet': {
      status: 'assumed',
      source: 'IB §3.2',
      note: 'IB §3.2 describes only the one Set bets On/Off button; no per-bet toggle is documented.',
    },
    '/comeOut': {
      status: 'verified',
      source: 'IB §2.6, §3.2',
      note: 'No come-out auto-OFF: place and buy bets work on the come-out (rules spec §0.2 #4).',
    },
    '/afterSevenOut': {
      status: 'verified',
      source: 'IB §3.2',
      note: 'After a 7-out, new Place and Buy bets are set OFF until the player taps Set bets On.',
    },
    '/afterSevenOut/newPlacedOff/trigger': {
      status: 'assumed',
      source: 'IB §3.2',
      note: '"After a 7 (7-out) is rolled" is read as a seven-out only, so place and buy bets made after a come-out 7 work; it may be any 7 (rules spec §9 #6).',
    },
    '/afterSevenOut/newPlacedOff/until': {
      status: 'assumed',
      source: 'IB §3.2',
      note: '"Until the player sets bets ON" is a literal reading; it may instead end when the next point is established (rules spec §9 #6).',
    },
    '/layAutoOn': { status: 'verified', source: 'IB §2.6', note: 'Crapless offers no lay bets.' },
    '/oddsOffReturnedAtPointMade': {
      status: 'assumed',
      source: 'IB §3.2',
      note: '"Odds bets are removed when a Point is reestablished" while set OFF, read as: OFF odds are returned when the point is made. The research marks this reading unverified (core.md §5.1).',
    },
    '/offBets': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"All placed bets decrease the Playable credit meter regardless of them being set to on or off."',
    },
    '/exclusiveGroups': {
      status: 'verified',
      source: 'IB §2.6',
      note: 'Place and Buy may share a number "when available"; no lay or don\'t bets to exclude.',
    },
    '/excludeLineVsLayBuy': {
      status: 'verified',
      source: 'IB221',
      note: "The Pass/Don't Pass vs Lay/Buy exclusion needs lay or don't pass, which crapless lacks.",
    },
    '/payLabelStyle': {
      status: 'reported',
      source: 'USER photo 2026-10-30',
      note: 'Display only: the player\'s station prints every pay it shows as "N for M" — place 9 "12 FOR 5", hops "16 FOR 1" and "31 FOR 1", Lucky Roller "31 FOR 1" and "156 FOR 1" (research interblock-station-photo-2026-10-30.md).',
    },
    '/flow/shooter': {
      status: 'verified',
      source: 'IB §1',
      note: 'On a single-player machine the player is always the shooter.',
    },
    '/flow/invalidRoll': {
      status: 'reported',
      source: 'PAT-RFID',
      note: 'An Interblock patent re-vibrates and re-reads misread dice. Cosmetic: the engine never re-rolls.',
    },
    '/flow/puckReset': {
      status: 'verified',
      source: 'IB §4.1.2; IB221',
      note: 'Standard puck behavior (setting 0).',
    },
    '/flow/groupButtons': {
      status: 'verified',
      source: 'IB §3.1.1',
      note: "Crapless offers Press and Across, after the come-out and only with a Pass, Don't Pass, Field or one-roll bet up.",
    },
    '/flow/historyLength': {
      status: 'assumed',
      source: 'IB §5.1',
      note: 'The last-results sidebar length is a setting; 20 is a trainer default.',
    },
    '/flow/macros': {
      status: 'verified',
      source: 'IB §5.1',
      note: 'Repeat Last Bet and Double Bet; Keep Bets On is not in every jurisdiction.',
    },
    '/pace': {
      status: 'reported',
      source: 'G3-MOH; WOV-35576',
      note: 'Self-paced with no bet timer; the shooter window does not apply.',
    },
    '/pace/rollsPerHour': {
      status: 'assumed',
      note: '120 rolls per hour for a self-paced heads-up game; the coach also shows a 60 to 150 range (rules spec §8.3).',
    },
  },
} satisfies MachineConfigInput)
