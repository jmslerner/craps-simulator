import { deepFreeze } from '../compile.ts'
import type { MachineConfigInput } from '../schema.ts'
import { INTERBLOCK_HOPS, hopProvenance, hopTypes } from './shared.ts'

const BOX_NUMBERS = [4, 5, 6, 8, 9, 10] as const

const TAKE_ODDS = { '4': '2:1', '5': '3:2', '6': '6:5', '8': '6:5', '9': '3:2', '10': '2:1' }
const LAY_ODDS = { '4': '1:2', '5': '2:3', '6': '5:6', '8': '5:6', '9': '2:3', '10': '1:2' }
const DOUBLE = { '4': 2, '5': 2, '6': 2, '8': 2, '9': 2, '10': 2 }

/** Interblock GV6.5: 5% charged up front, not refunded, re-collected when a winner stays up. */
const UPFRONT = {
  rate: '1:20',
  timing: 'upfront',
  rounding: { mode: 'ceil', increment: 1 },
  minimum: 0,
  refundOnTakeDown: false,
  rearm: 'recollectFromWin',
} as const

const ASSUMED_PAYS = {
  status: 'assumed',
  source: 'CW; WOO-B',
  note: 'The standard pays; Interblock pay tables are per par sheet and not public.',
} as const

const STAYS = {
  status: 'assumed',
  note: 'A winning bet stays up (rules spec §5.2); Interblock does not say.',
} as const

const RETURNED = {
  status: 'assumed',
  note: 'Paid and returned; Keep Bets On and Repeat are UI conveniences (rules spec §9 #19).',
} as const

const COME_OUT_ON = {
  status: 'assumed',
  note: 'Works on the come-out unless set OFF; undocumented for Interblock (rules spec §9 #5).',
} as const

const PROP_PAYS = {
  status: 'reported',
  source: 'IB (game screen)',
  note: 'The screen shows props as "for 1": 5 (seven), 8 (craps), 16 (eleven, 3, easy hops) and 31 (2, 12, hard hops) for 1.',
} as const

const VIG_ASSUMED = {
  status: 'assumed',
  note: 'Up-front vig is not refunded and is re-collected when a winner stays up: the conservative choice (rules spec §9 #3). A sub-cent charge rounds up to the cent; no minimum.',
} as const

const SAME_NUMBER = {
  status: 'assumed',
  source: 'IB §2.6',
  note: '"The Buy/Place bets are excluding bets from the Lay bet" does not say where; reading it as the same number is assumed, as for Shoot To Win (rules spec §5.2).',
} as const

const LUCKY_ROLLER = {
  status: 'verified',
  source: 'IB §6.2',
  note: "Low Rolls 2 to 6, High Rolls 8 to 12, Roll 'Em All all ten, before any 7; placed only after a 7 or at the start of the history cycle.",
} as const

const LUCKY_ROLLER_PAYS = {
  status: 'assumed',
  source: 'GALAXY-WA; WOO-BONUS',
  note: '30, 30 and 150 to 1, the common live pay table, shown in Interblock\'s "for 1" style (rules spec §5.2).',
} as const

const LUCKY_SHOOTER_TABLE = {
  status: 'reported',
  source: 'IBLS; PA623c',
  note: "Pay table D, the one Interblock's own screenshots show (research sidebets.md §2) and one of PA §623c.2(e)'s four regulated tables: 5 hits then the point 500, 5 hits 100, 4 hits 10, 3 hits 5, 2 hits 2 for 1; fewer hits lose (rules spec §6.3; plan §0 #11). Las Vegas machine tables are unverified.",
} as const

/**
 * A strict machine: Interblock GV6.5 traditional craps with 2x odds and up-front commission on buy
 * and lay. The conservative reading of every Interblock unknown.
 */
export const strictBubble: MachineConfigInput = deepFreeze({
  schemaVersion: 1,
  id: 'strictBubble',
  name: 'Strict machine',
  variant: 'traditional',
  rules: {
    naturals: [7, 11],
    craps: [2, 3, 12],
    points: [...BOX_NUMBERS],
    dontBar: 12,
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
  chips: [100, 500, 1_000, 2_500, 5_000, 10_000],
  catalog: {
    pass: {
      family: 'line',
      label: 'Pass Line',
      side: 'do',
      window: 'comeOut',
      pays: '1:1',
      afterWin: 'stay',
    },
    dontPass: {
      family: 'line',
      label: "Don't Pass",
      side: 'dont',
      window: 'comeOut',
      pays: '1:1',
      afterWin: 'stay',
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    },
    come: {
      family: 'line',
      label: 'Come',
      side: 'do',
      window: 'point',
      pays: '1:1',
      afterWin: 'return',
    },
    dontCome: {
      family: 'line',
      label: "Don't Come",
      side: 'dont',
      window: 'point',
      pays: '1:1',
      afterWin: 'return',
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    },
    passOdds: {
      family: 'odds',
      label: 'Pass Odds',
      parent: 'pass',
      pays: TAKE_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE },
    },
    comeOdds: {
      family: 'odds',
      label: 'Come Odds',
      parent: 'come',
      pays: TAKE_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE },
      comeOutDefault: 'off',
    },
    dontPassOdds: {
      family: 'odds',
      label: "Don't Pass Odds",
      parent: 'dontPass',
      pays: LAY_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE },
    },
    dontComeOdds: {
      family: 'odds',
      label: "Don't Come Odds",
      parent: 'dontCome',
      pays: LAY_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE },
      comeOutDefault: 'on',
    },
    place: {
      family: 'numberVsSeven',
      kind: 'place',
      label: 'Place',
      numbers: [...BOX_NUMBERS],
      pays: { '4': '9:5', '5': '7:5', '6': '7:6', '8': '7:6', '9': '7:5', '10': '9:5' },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    buy: {
      family: 'numberVsSeven',
      kind: 'buy',
      label: 'Buy',
      numbers: [...BOX_NUMBERS],
      pays: TAKE_ODDS,
      commission: { basis: 'stake', ...UPFRONT },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    lay: {
      family: 'numberVsSeven',
      kind: 'lay',
      label: 'Lay',
      numbers: [...BOX_NUMBERS],
      pays: LAY_ODDS,
      commission: { basis: 'win', ...UPFRONT },
      afterWin: 'stay',
      comeOutDefault: 'on',
    },
    big: {
      family: 'numberVsSeven',
      kind: 'big',
      label: 'Big',
      numbers: [6, 8],
      pays: { '6': '1:1', '8': '1:1' },
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
      pays: '151 for 1',
      endsOn: 'anySeven',
      placement: 'afterSevenOrStart',
    },
    luckyShooter: {
      family: 'pointRun',
      label: 'Lucky Shooter',
      points: [...BOX_NUMBERS],
      payTable: { '2': '2 for 1', '3': '5 for 1', '4': '10 for 1', '5': '100 for 1' },
      topAward: '500 for 1',
      repeatEndsBet: true,
      placement: 'beforePoint',
      removableBeforePoint: true,
    },
  },
  workingToggle: {
    global: true,
    perBet: false,
    scope: 'untilChanged',
    types: ['place', 'lay', 'buy', 'passOdds', 'comeOdds', 'dontPassOdds', 'dontComeOdds', 'hard'],
  },
  comeOut: { autoOff: null },
  afterSevenOut: {
    newPlacedOff: { types: ['place', 'buy'], trigger: 'sevenOut', until: 'playerOn' },
  },
  layAutoOn: { afterPointMade: true, afterSeven: true },
  oddsOffReturnedAtPointMade: true,
  offBets: { consumeCredit: true },
  exclusiveGroups: [
    { types: ['pass', 'dontPass'], scope: 'global' },
    { types: ['come', 'dontCome'], scope: 'global' },
    { types: ['place', 'lay'], scope: 'sameNumber' },
    { types: ['buy', 'lay'], scope: 'sameNumber' },
  ],
  excludeLineVsLayBuy: true,
  payLabelStyle: 'asWritten',
  flow: {
    shooter: { mode: 'single' },
    invalidRoll: 'reVibrate',
    puckReset: 0,
    groupButtons: {
      buttons: ['press', 'across', 'inside', 'outside'],
      condition: 'afterComeOutWithLineOrOneRoll',
    },
    historyLength: 20,
    macros: ['repeatLastBet', 'double'],
  },
  pace: { rollsPerHour: 120, betWindowSec: null, shooterWindowSec: null },
  provenance: {
    '/variant': {
      status: 'verified',
      source: 'IB §1.3',
      note: 'Interblock standard Craps, GV6.5 with up-front commission (IB §3.3).',
    },
    '/rules': {
      status: 'verified',
      source: 'IB §2.2, §2.3',
      note: 'Win on 7 or 11, lose on 2, 3 or 12; Don\'t Pass pushes on 12. Pass "can only be placed before the come-out roll", so no put bets.',
    },
    '/money/payoutRounding': {
      status: 'assumed',
      note: 'Fractional pays are floored to the cent: the conservative choice (rules spec §4.2, §9 #1).',
    },
    '/money/startingBankroll': { status: 'assumed', note: 'Trainer default; not a machine value.' },
    '/money/betIncrement': { status: 'assumed', note: 'Whole-dollar bets at a $1 denomination.' },
    '/limits/min': { status: 'assumed', source: 'VA', note: '$1 per bet.' },
    '/limits/max': {
      status: 'assumed',
      source: 'WSGC-ETG',
      note: '$500 per wager, the Washington tribal ETG cap.',
    },
    '/limits/minTotal': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"BETS ARE NOT VALID YET!" until the active bets reach the minimum; OFF bets do not count.',
    },
    '/limits/minTotal/amount': { status: 'assumed', source: 'VA', note: '$5 total.' },
    '/limits/minTotal/countSideBets': {
      status: 'assumed',
      note: 'Whether side bets count toward the minimum is undocumented (rules spec §9 #11).',
    },
    '/chips': {
      status: 'assumed',
      source: 'IB §5.1',
      note: 'Seven chips scaled by denomination on the machine; these values are a trainer default.',
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
    '/catalog/dontPass': {
      status: 'verified',
      source: 'IB §2.3',
      note: 'Pushes on 12. Once taken down or reduced it "cannot be placed again until the next game cycle"; the contract-bet table conflicts, and the text wins (rules spec §0.2 #5).',
    },
    '/catalog/dontPass/afterWin': STAYS,
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
    '/catalog/come/afterWin': RETURNED,
    '/catalog/dontCome': {
      status: 'verified',
      source: 'IB §2.5',
      note: 'Standard craps only; pushes on 12.',
    },
    '/catalog/dontCome/afterWin': RETURNED,
    '/catalog/dontCome/onNumber': {
      status: 'assumed',
      source: 'IB §2.3',
      note: "Treated like Don't Pass: reduce or remove, no re-bet until the next cycle.",
    },
    '/catalog/dontCome/rebetAfterRemove': {
      status: 'assumed',
      source: 'IB §2.3',
      note: "Treated like Don't Pass.",
    },
    '/catalog/passOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: 'Behind the Pass Line, by multiplier pop-up or by hand; adjustable until resolved.',
    },
    '/catalog/passOdds/pays': ASSUMED_PAYS,
    '/catalog/passOdds/limit': {
      status: 'reported',
      source: 'VA',
      note: '2x the flat bet ("mostly double"); the machine offers multipliers in a pop-up.',
    },
    '/catalog/comeOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: 'Behind a come bet on its number.',
    },
    '/catalog/comeOdds/pays': ASSUMED_PAYS,
    '/catalog/comeOdds/limit': {
      status: 'reported',
      source: 'VA',
      note: '2x the flat bet.',
    },
    '/catalog/comeOdds/comeOutDefault': {
      status: 'assumed',
      source: 'WOO-B',
      note: 'OFF on the come-out and returned if the come bet is decided, as on live tables (rules spec §9 #5).',
    },
    '/catalog/dontPassOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: "Lay odds behind Don't Pass.",
    },
    '/catalog/dontPassOdds/pays': ASSUMED_PAYS,
    '/catalog/dontPassOdds/limit': {
      status: 'assumed',
      note: 'A 2x cap on the lay itself (stake basis), the stricter of the two readings.',
    },
    '/catalog/dontComeOdds': {
      status: 'verified',
      source: 'IB (Odds bets)',
      note: "Lay odds behind a don't come bet on its number.",
    },
    '/catalog/dontComeOdds/pays': ASSUMED_PAYS,
    '/catalog/dontComeOdds/limit': {
      status: 'assumed',
      note: 'A 2x cap on the lay itself (stake basis), the stricter of the two readings.',
    },
    '/catalog/dontComeOdds/comeOutDefault': {
      status: 'assumed',
      source: 'WOO-B',
      note: "Don't come odds work on the come-out, as on live tables.",
    },
    '/catalog/place': {
      status: 'verified',
      source: 'IB §2.6',
      note: 'Place bets work on the come-out unless set OFF (rules spec §0.2 #4).',
    },
    '/catalog/place/pays': ASSUMED_PAYS,
    '/catalog/place/afterWin': STAYS,
    '/catalog/buy': {
      status: 'verified',
      source: 'IB §2.6, §3.3',
      note: 'True odds; GV6.5 charges the commission up front through a YES/NO pop-up.',
    },
    '/catalog/buy/commission': {
      status: 'reported',
      source: 'VA',
      note: '5% of the bet: "some installations now require a 5% commission to be paid upfront on all Buy wagers".',
    },
    '/catalog/buy/commission/timing': {
      status: 'verified',
      source: 'IB §3.3',
      note: 'Paid up front; declining removes the bet.',
    },
    '/catalog/buy/commission/rounding': VIG_ASSUMED,
    '/catalog/buy/commission/minimum': VIG_ASSUMED,
    '/catalog/buy/commission/refundOnTakeDown': VIG_ASSUMED,
    '/catalog/buy/commission/rearm': VIG_ASSUMED,
    '/catalog/buy/afterWin': STAYS,
    '/catalog/lay': {
      status: 'verified',
      source: 'IB §2.6, §3.3',
      note: 'Standard craps only; excludes place and buy on its number.',
    },
    '/catalog/lay/pays': ASSUMED_PAYS,
    '/catalog/lay/commission': {
      status: 'reported',
      source: 'IB §3.3',
      note: 'Up front, 5% of the potential win: the pop-up for a $2 lay on 4 asks $0.05.',
    },
    '/catalog/lay/commission/rounding': VIG_ASSUMED,
    '/catalog/lay/commission/minimum': VIG_ASSUMED,
    '/catalog/lay/commission/refundOnTakeDown': VIG_ASSUMED,
    '/catalog/lay/commission/rearm': VIG_ASSUMED,
    '/catalog/lay/afterWin': STAYS,
    '/catalog/lay/comeOutDefault': {
      status: 'verified',
      source: 'IB §3.2',
      note: 'Lay bets work, and come back ON by themselves after a point is made or a 7.',
    },
    '/catalog/big': {
      status: 'verified',
      source: 'IB §2.8.1',
      note: 'Big 6 and Big 8, standard craps only, on any roll.',
    },
    '/catalog/big/pays': {
      status: 'assumed',
      source: 'CW §7',
      note: '1:1, as on Shoot To Win; the Interblock pay table is not public.',
    },
    '/catalog/big/afterWin': STAYS,
    '/catalog/big/comeOutDefault': COME_OUT_ON,
    '/catalog/hard': {
      status: 'verified',
      source: 'IB (Hard Ways bets)',
      note: 'Hard 4, 6, 8 and 10: win on the pair, lose on the easy way or a 7.',
    },
    '/catalog/hard/pays': ASSUMED_PAYS,
    '/catalog/hard/afterWin': STAYS,
    '/catalog/hard/comeOutDefault': COME_OUT_ON,
    '/catalog/field': {
      status: 'verified',
      source: 'IB §2.7',
      note: '2:1 on 2 and 12 by default; pay table EL602 pays 3:1 on 12.',
    },
    '/catalog/field/afterWin': RETURNED,
    '/catalog/any7': {
      status: 'verified',
      source: 'IB (Seven)',
      note: 'The Seven bet: one roll, any 7.',
    },
    '/catalog/any7/pays': PROP_PAYS,
    '/catalog/any7/afterWin': RETURNED,
    '/catalog/anyCraps': {
      status: 'verified',
      source: 'IB (Any Craps)',
      note: 'One roll on 2, 3 or 12.',
    },
    '/catalog/anyCraps/pays': PROP_PAYS,
    '/catalog/anyCraps/afterWin': RETURNED,
    '/catalog/c': {
      status: 'verified',
      source: 'IB §2.9',
      note: 'C (Craps): one roll on 2, 3 or 12.',
    },
    '/catalog/c/pays': PROP_PAYS,
    '/catalog/c/afterWin': RETURNED,
    '/catalog/e': { status: 'verified', source: 'IB §2.9', note: 'E (Eleven): one roll on 11.' },
    '/catalog/e/pays': PROP_PAYS,
    '/catalog/e/afterWin': RETURNED,
    '/catalog/snakeEyes': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 1-1.',
    },
    '/catalog/snakeEyes/pays': PROP_PAYS,
    '/catalog/snakeEyes/afterWin': RETURNED,
    '/catalog/aceDeuce': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 1-2.',
    },
    '/catalog/aceDeuce/pays': PROP_PAYS,
    '/catalog/aceDeuce/afterWin': RETURNED,
    '/catalog/yo': { status: 'verified', source: 'IB (Horn bets)', note: 'Horn single on 5-6.' },
    '/catalog/yo/pays': PROP_PAYS,
    '/catalog/yo/afterWin': RETURNED,
    '/catalog/boxcars': {
      status: 'verified',
      source: 'IB (Horn bets)',
      note: 'Horn single on 6-6.',
    },
    '/catalog/boxcars/pays': PROP_PAYS,
    '/catalog/boxcars/afterWin': RETURNED,
    ...hopProvenance(INTERBLOCK_HOPS, {
      type: {
        status: 'verified',
        source: 'IB (Hop bets)',
        note: '13 easy hops and the hard hops 2-2 to 5-5; 1-1, 1-2, 5-6 and 6-6 are the horn singles.',
      },
      pays: {
        status: 'reported',
        source: 'IB (game screen)',
        note: '16 for 1 on an easy hop and 31 for 1 on a hard hop, as the screen shows.',
      },
      afterWin: RETURNED,
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
    '/sideBets/luckyShooter': {
      status: 'verified',
      source: 'IB §6.1; IBLS; PA623c',
      note: 'Placed before the point; a contract bet once the point is set. A come-out 7 or 11 pushes and the bet stays (rules spec §0.2 #8); 2, 3 or 12 loses.',
    },
    '/sideBets/luckyShooter/payTable': LUCKY_SHOOTER_TABLE,
    '/sideBets/luckyShooter/topAward': LUCKY_SHOOTER_TABLE,
    '/sideBets/luckyShooter/repeatEndsBet': {
      status: 'assumed',
      source: 'PA623c; MD-C',
      note: 'A repeated box number settles the bet, as in PA and MD; Interblock is silent (rules spec §9 #12).',
    },
    '/sideBets/luckyShooter/removableBeforePoint': {
      status: 'assumed',
      note: 'Removable until the point is set (rules spec §9 #12).',
    },
    '/workingToggle': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"Set bets On/Off" covers Place, Lay, Buy, Odds and Hard Ways and stays until changed.',
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
      note: '"Until the player sets bets ON" is a literal reading (rules spec §9 #6).',
    },
    '/layAutoOn': {
      status: 'verified',
      source: 'IB §3.2',
      note: '"Lay bets become enabled after a Point is reestablished or a 7 is rolled."',
    },
    '/oddsOffReturnedAtPointMade': {
      status: 'assumed',
      source: 'IB §3.2',
      note: '"Odds bets are removed when a Point is reestablished" while set OFF, read as: OFF odds are returned when the point is made. The research marks this reading unverified (core.md §5.1).',
    },
    '/offBets': {
      status: 'verified',
      source: 'IB §3.2',
      note: 'OFF bets still use Playable credit.',
    },
    '/exclusiveGroups': {
      status: 'verified',
      source: 'IB §2.3, §2.5, §2.6',
      note: "Pass vs Don't Pass and Come vs Don't Come; Buy and Place exclude Lay. Place and Buy may share a number.",
    },
    '/exclusiveGroups/2/scope': SAME_NUMBER,
    '/exclusiveGroups/3/scope': SAME_NUMBER,
    '/excludeLineVsLayBuy': {
      status: 'assumed',
      source: 'IB221',
      note: 'The "Exclude bets on Pass/Don\'t Pass – Lay/Buy" setting exists (a Pass blocks Lay on the point; a Don\'t Pass blocks Buy); ON is assumed for the strict machine.',
    },
    '/payLabelStyle': {
      status: 'assumed',
      note: 'Display only: each ratio is shown as written.',
    },
    '/flow/shooter': {
      status: 'verified',
      source: 'IB §1',
      note: 'On a single-player machine the player is always the shooter.',
    },
    '/flow/invalidRoll': {
      status: 'reported',
      source: 'PAT-RFID',
      note: 'Re-vibrate and re-read on a misread; cosmetic here.',
    },
    '/flow/puckReset': {
      status: 'verified',
      source: 'IB §4.1.2; IB221',
      note: 'Standard puck behavior (setting 0).',
    },
    '/flow/groupButtons': {
      status: 'verified',
      source: 'IB §3.1.1',
      note: "Press, Across, Inside and Outside, after the come-out and only with a Pass, Don't Pass, Field or one-roll bet up.",
    },
    '/flow/historyLength': {
      status: 'assumed',
      source: 'IB §5.1',
      note: 'The last-results sidebar length is a setting; 20 is a trainer default.',
    },
    '/flow/macros': {
      status: 'verified',
      source: 'IB §5.1',
      note: 'Repeat Last Bet and Double Bet.',
    },
    '/pace': {
      status: 'reported',
      source: 'G3-MOH',
      note: 'Self-paced heads-up play with no bet timer.',
    },
    '/pace/rollsPerHour': {
      status: 'assumed',
      note: '120 rolls per hour; the coach also shows a 60 to 150 range (rules spec §8.3).',
    },
  },
} satisfies MachineConfigInput)
