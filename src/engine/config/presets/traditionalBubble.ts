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
const DOUBLE = { '4': 2, '5': 2, '6': 2, '8': 2, '9': 2, '10': 2 }

/** "5% of the BET amount is deducted from the win" (buy) / "of the WIN pay amount" (lay). */
const ON_WIN = { timing: 'onWin', minimum: 0, refundOnTakeDown: false, rearm: 'none' } as const
const CENT_UP = { mode: 'ceil', increment: 1 } as const

const RIDES = {
  status: 'verified',
  source: 'CW §32',
  note: 'A winning bet stays up for the following rolls unless cancelled before bet time ends.',
} as const

const AUTO_OFF = {
  status: 'verified',
  source: 'CW §4',
  note: 'Carried COME ODDS, PLACE, BUY, HARDWAYS and BIG 6/8 chips go OFF at the come-out and back ON when the point is established. New chips placed for the come-out are assumed OFF too (rules spec §9 #7).',
} as const

const COME_OUT_ON = {
  status: 'assumed',
  source: 'CW §4',
  note: 'Not on the come-out auto-OFF list, so it works (rules spec §0.2 #2).',
} as const

const DONT_RIDES = {
  status: 'verified',
  source: 'CW §30',
  note: 'A don\'t bet that wins on its first roll rides "until a loss or a point is established".',
} as const

const CENT_ROUNDING = {
  status: 'assumed',
  note: 'A sub-cent commission rounds up to the cent (rules spec §0.2 #3); only a lay can produce one.',
} as const

const HORN_SINGLE = {
  status: 'verified',
  source: 'CW §25e, §32',
  note: 'A horn number bet on its own: 30 to 1 on 2 and 12, 15 to 1 on 3 and 11.',
} as const

const LUCKY_ROLLER = {
  status: 'verified',
  source: 'STWO §7.3',
  note: "Low = 2 to 6, High = 8 to 12, Roll 'Em All = all ten, before any 7; placed when no wager of the same type is active.",
} as const

const LUCKY_ROLLER_PAYS = {
  status: 'assumed',
  source: 'IB §6.2',
  note: 'Shoot To Win values are on the par sheet; the Interblock 30/30/155 to 1 is assumed (rules spec §9 #13).',
} as const

/**
 * Typical Vegas bubble craps: the Shoot To Win community dome (Aruze, now Interblock), as at
 * Circa and Downtown Grand, configured like the Clearwater (WA) rule card.
 */
export const traditionalBubble: MachineConfigInput = deepFreeze({
  schemaVersion: 1,
  id: 'traditionalBubble',
  name: 'Typical Vegas bubble craps',
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
    perType: { hotShooter: { min: 100, max: 100_000 } },
    minTotal: { amount: 300, scope: 'totalRound', countOff: false, countSideBets: false },
  },
  chips: [100, 500, 1_000, 2_500, 5_000, 10_000],
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
      label: "Don't Pass",
      side: 'dont',
      window: 'comeOut',
      pays: '1 to 1',
      afterWin: 'stayIfFirstRoll',
      onNumber: 'locked',
      rebetAfterRemove: 'allowed',
    },
    come: {
      family: 'line',
      label: 'Come',
      side: 'do',
      window: 'point',
      pays: '1 to 1',
      afterWin: 'stayIf11',
    },
    dontCome: {
      family: 'line',
      label: "Don't Come",
      side: 'dont',
      window: 'point',
      pays: '1 to 1',
      afterWin: 'stayIfFirstRoll',
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'allowed',
    },
    passOdds: {
      family: 'odds',
      label: 'Odds',
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
      label: "Don't Odds",
      parent: 'dontPass',
      pays: LAY_ODDS,
      limit: { basis: 'stake', multiple: DOUBLE },
    },
    dontComeOdds: {
      family: 'odds',
      label: "Don't Come Odds",
      parent: 'dontCome',
      pays: LAY_ODDS,
      limit: { basis: 'win', multiple: DOUBLE },
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
      payoutRounding: CENT_UP,
      afterWin: 'stay',
      comeOutDefault: 'off',
    },
    buy: {
      family: 'numberVsSeven',
      kind: 'buy',
      label: 'Buy',
      numbers: [...BOX_NUMBERS],
      pays: TAKE_ODDS,
      commission: { rate: '1:20', basis: 'stake', rounding: CENT_UP, ...ON_WIN },
      afterWin: 'stay',
      comeOutDefault: 'off',
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
    lay: {
      family: 'numberVsSeven',
      kind: 'lay',
      label: 'Lay',
      numbers: [...BOX_NUMBERS],
      pays: LAY_ODDS,
      commission: { rate: '1:20', basis: 'win', rounding: CENT_UP, ...ON_WIN },
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
      comeOutDefault: 'off',
    },
    hard: {
      family: 'hardway',
      label: 'Hardways',
      numbers: [4, 6, 8, 10],
      pays: { '4': '7 to 1', '6': '9 to 1', '8': '9 to 1', '10': '7 to 1' },
      afterWin: 'stay',
      comeOutDefault: 'off',
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
        '12': '2 to 1',
      },
      afterWin: 'stay',
    },
    any7: {
      family: 'oneRoll',
      label: 'Any Seven',
      match: 'total',
      pays: { '7': '4 to 1' },
      afterWin: 'stay',
    },
    anyCraps: {
      family: 'oneRoll',
      label: 'Any Craps',
      match: 'total',
      pays: { '2': '7 to 1', '3': '7 to 1', '12': '7 to 1' },
      afterWin: 'stay',
    },
    c: {
      family: 'oneRoll',
      label: 'C',
      match: 'total',
      pays: { '2': '7 to 1', '3': '7 to 1', '12': '7 to 1' },
      afterWin: 'stay',
    },
    e: {
      family: 'oneRoll',
      label: 'E',
      match: 'total',
      pays: { '11': '15 to 1' },
      afterWin: 'stay',
    },
    horn2: {
      family: 'oneRoll',
      label: '2',
      match: 'total',
      pays: { '2': '30 to 1' },
      afterWin: 'stay',
    },
    horn3: {
      family: 'oneRoll',
      label: '3',
      match: 'total',
      pays: { '3': '15 to 1' },
      afterWin: 'stay',
    },
    horn11: {
      family: 'oneRoll',
      label: '11',
      match: 'total',
      pays: { '11': '15 to 1' },
      afterWin: 'stay',
    },
    horn12: {
      family: 'oneRoll',
      label: '12',
      match: 'total',
      pays: { '12': '30 to 1' },
      afterWin: 'stay',
    },
    ...hopTypes(ALL_HOPS, { easy: '15 to 1', hard: '30 to 1' }, 'stay'),
  },
  composites: {
    ce: {
      label: 'C&E',
      parts: [
        { typeId: 'c', units: 1 },
        { typeId: 'e', units: 1 },
      ],
    },
    horn: {
      label: 'Horn',
      parts: [
        { typeId: 'horn2', units: 1 },
        { typeId: 'horn3', units: 1 },
        { typeId: 'horn11', units: 1 },
        { typeId: 'horn12', units: 1 },
      ],
    },
  },
  sideBets: {
    hotShooter: {
      family: 'handLength',
      label: 'Hot Shooter Jackpot',
      countDefinition: 'allRolls',
      tiers: [
        { minRolls: 8, pays: 'push' },
        { minRolls: 16, pays: '3 for 1' },
        { minRolls: 24, pays: '5 for 1' },
        { minRolls: 32, pays: '7 for 1' },
        { minRolls: 40, pays: '12 for 1' },
        { minRolls: 45, pays: '30 for 1' },
        { minRolls: 50, pays: '100 for 1' },
      ],
      placement: 'comeOutAfterSevenOut',
      qualifyingBet: 300,
    },
    luckyRollerLow: {
      family: 'collectSet',
      label: 'Low Rolls',
      targets: [2, 3, 4, 5, 6],
      pays: '30:1',
      endsOn: 'anySeven',
      placement: 'noneOfTypeActive',
    },
    luckyRollerHigh: {
      family: 'collectSet',
      label: 'High Rolls',
      targets: [8, 9, 10, 11, 12],
      pays: '30:1',
      endsOn: 'anySeven',
      placement: 'noneOfTypeActive',
    },
    luckyRollerAll: {
      family: 'collectSet',
      label: "Roll 'Em All",
      targets: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
      pays: '155:1',
      endsOn: 'anySeven',
      placement: 'noneOfTypeActive',
    },
  },
  workingToggle: {
    global: true,
    perBet: true,
    scope: 'untilChanged',
    types: [
      'passOdds',
      'dontPassOdds',
      'comeOdds',
      'dontComeOdds',
      'big',
      'place',
      'buy',
      'placeToLose',
      'lay',
      'hard',
    ],
  },
  comeOut: {
    autoOff: {
      carried: ['comeOdds', 'place', 'buy', 'hard', 'big'],
      newlyPlaced: ['comeOdds', 'place', 'buy', 'hard', 'big'],
      reOnAt: 'pointEstablished',
    },
  },
  afterSevenOut: { newPlacedOff: null },
  layAutoOn: null,
  oddsOffReturnedAtPointMade: false,
  offBets: { consumeCredit: false },
  exclusiveGroups: [
    { types: ['pass', 'dontPass'], scope: 'global' },
    { types: ['come', 'dontCome'], scope: 'global' },
    { types: ['place', 'placeToLose'], scope: 'sameNumber' },
    { types: ['place', 'lay'], scope: 'sameNumber' },
    { types: ['buy', 'lay'], scope: 'sameNumber' },
    { types: ['buy', 'placeToLose'], scope: 'sameNumber' },
  ],
  excludeLineVsLayBuy: false,
  payLabelStyle: 'asWritten',
  flow: {
    shooter: { mode: 'community' },
    invalidRoll: 'reshoot',
    puckReset: 0,
    groupButtons: { buttons: ['across'], condition: 'afterComeOutWithLineOrOneRoll' },
    historyLength: 27,
    macros: [],
  },
  pace: { rollsPerHour: 100, betWindowSec: 20, shooterWindowSec: 20 },
  provenance: {
    '/variant': {
      status: 'verified',
      source: 'CW §2; STWO §7.1',
      note: 'Shoot To Win plays traditional craps; it has no crapless variant. Circa and Downtown Grand per VA.',
    },
    '/rules': {
      status: 'verified',
      source: 'CW §2, §11c',
      note: 'Win on 7 or 11, lose on 2, 3 or 12; Don\'t Pass "draws on a roll of 12".',
    },
    '/rules/allowPutBets': {
      status: 'assumed',
      note: 'Put bets are a live-table option; Shoot To Win describes none.',
    },
    '/money/payoutRounding': {
      status: 'assumed',
      note: 'Fractional pays other than place 6/8 are floored to the cent; no report exists either way (rules spec §0.2 #3).',
    },
    '/money/startingBankroll': { status: 'assumed', note: 'Trainer default; not a machine value.' },
    '/money/betIncrement': {
      status: 'assumed',
      note: 'Whole-dollar bets at a $1 denomination.',
    },
    '/limits/min': {
      status: 'assumed',
      source: 'VA',
      note: '$1 per bet; machines report $1 to $5.',
    },
    '/limits/max': {
      status: 'assumed',
      source: 'WSGC-ETG',
      note: '$500 per wager, the Washington tribal ETG cap; casino maximums vary.',
    },
    '/limits/perType/hotShooter': { status: 'verified', source: 'CW §33g', note: '$1 to $1,000.' },
    '/limits/minTotal': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: 'The screen shows MIN/MAX TOTAL BET; "OFF chips ... do not contribute to the minimum bet".',
    },
    '/limits/minTotal/amount': {
      status: 'assumed',
      source: 'VA',
      note: '$3 total, inside the reported $1 to $5 range.',
    },
    '/limits/minTotal/countSideBets': {
      status: 'assumed',
      note: 'Whether side bets count toward the minimum is undocumented (rules spec §9 #11).',
    },
    '/chips': {
      status: 'assumed',
      source: 'STWO (game screen)',
      note: 'Chip values are set from a keypad on the machine; these are a trainer default.',
    },
    '/catalog/pass': {
      status: 'verified',
      source: 'CW §5',
      note: 'Wins on 7 or 11, loses on 2, 3 or 12; cannot be cancelled after the point.',
    },
    '/catalog/pass/afterWin': {
      status: 'verified',
      source: 'CW §29',
      note: 'A winning Pass bet "continues to be placed in following rolls automatically until a loss".',
    },
    '/catalog/dontPass': {
      status: 'verified',
      source: 'CW §11',
      note: 'Offered "if available"; no new or larger bet after the point; cannot be cancelled after the point (rules spec §0.2 #5).',
    },
    '/catalog/dontPass/afterWin': DONT_RIDES,
    '/catalog/come': {
      status: 'verified',
      source: 'CW §9',
      note: 'Placed only after the point is established; cannot be cancelled once it travels.',
    },
    '/catalog/come/afterWin': {
      status: 'verified',
      source: 'CW §31',
      note: 'A come bet that wins on 11 on its first roll stays in the come box.',
    },
    '/catalog/dontCome': {
      status: 'verified',
      source: 'CW §14',
      note: 'Offered "if available"; pushes on 12.',
    },
    '/catalog/dontCome/afterWin': DONT_RIDES,
    '/catalog/dontCome/onNumber': {
      status: 'assumed',
      source: 'STWO §7.1',
      note: 'The card is silent; the overview lets any wager be withdrawn unless stated otherwise (rules spec §9 #8).',
    },
    '/catalog/dontCome/rebetAfterRemove': {
      status: 'assumed',
      note: 'No re-bet restriction is documented.',
    },
    '/catalog/passOdds': {
      status: 'verified',
      source: 'CW §6; VA',
      note: 'True odds; at most 2x the Pass bet on every point.',
    },
    '/catalog/comeOdds': {
      status: 'verified',
      source: 'CW §10',
      note: 'True odds; at most 2x the Come bet.',
    },
    '/catalog/comeOdds/comeOutDefault': AUTO_OFF,
    '/catalog/dontPassOdds': {
      status: 'verified',
      source: 'CW §12',
      note: '"The maximum bet amount is 2 times the bet on the DON\'T PASS LINE": a cap on the lay itself (rules spec §0.2 #6).',
    },
    '/catalog/dontComeOdds': {
      status: 'verified',
      source: 'CW §15',
      note: '"2 times the bet on DON\'T COME ... divided by the corresponding DON\'T COME ODDS": a cap on the win (rules spec §0.2 #6).',
    },
    '/catalog/dontComeOdds/comeOutDefault': COME_OUT_ON,
    '/catalog/place': {
      status: 'verified',
      source: 'CW §17',
      note: '9 to 5, 7 to 5 and 7 to 6 (not 6:5: rules spec §0.2 #9).',
    },
    '/catalog/place/payoutRounding': {
      status: 'reported',
      source: 'WOV-11344; WOV-32511',
      note: 'Place 6/8 rounds up to the cent: $1 pays $1.17 and $2 pays $2.34 (rules spec §0.2 #3). 4/5/9/10 pay whole cents on whole-dollar bets.',
    },
    '/catalog/place/afterWin': RIDES,
    '/catalog/place/comeOutDefault': AUTO_OFF,
    '/catalog/buy': {
      status: 'verified',
      source: 'CW §18',
      note: 'True odds; "a commission of 5% of the BET amount is deducted from the win".',
    },
    '/catalog/buy/commission/rounding': CENT_ROUNDING,
    '/catalog/buy/afterWin': RIDES,
    '/catalog/buy/comeOutDefault': AUTO_OFF,
    '/catalog/placeToLose': {
      status: 'verified',
      source: 'CW §19',
      note: '5 to 11, 5 to 8 and 4 to 5.',
    },
    '/catalog/placeToLose/afterWin': RIDES,
    '/catalog/placeToLose/comeOutDefault': COME_OUT_ON,
    '/catalog/lay': {
      status: 'verified',
      source: 'CW §20',
      note: 'True odds; "a commission of 5% of the WIN pay amount is deducted from the win".',
    },
    '/catalog/lay/commission/rounding': CENT_ROUNDING,
    '/catalog/lay/afterWin': RIDES,
    '/catalog/lay/comeOutDefault': COME_OUT_ON,
    '/catalog/big': { status: 'verified', source: 'CW §7', note: 'Big 6 and Big 8 pay 1 to 1.' },
    '/catalog/big/afterWin': RIDES,
    '/catalog/big/comeOutDefault': AUTO_OFF,
    '/catalog/hard': {
      status: 'verified',
      source: 'CW §16; STWO §7.1',
      note: '7 to 1 and 9 to 1; lost on the easy way or any 7 (rules spec §0.2 #11).',
    },
    '/catalog/hard/afterWin': RIDES,
    '/catalog/hard/comeOutDefault': AUTO_OFF,
    '/catalog/field': {
      status: 'verified',
      source: 'CW §8, §32',
      note: '2 to 1 on 2 and 12, 1 to 1 on 3, 4, 9, 10 and 11; winners ride.',
    },
    '/catalog/any7': {
      status: 'verified',
      source: 'CW §26, §32',
      note: 'Pays 4 to 1; winners ride.',
    },
    '/catalog/anyCraps': {
      status: 'verified',
      source: 'CW §27, §32',
      note: 'Pays 7 to 1 on 2, 3 or 12; winners ride.',
    },
    '/catalog/c': {
      status: 'verified',
      source: 'CW §22, §32',
      note: '"The same rules as ANY CRAPS apply to this bet spot."',
    },
    '/catalog/e': {
      status: 'verified',
      source: 'CW §23, §32',
      note: 'Pays 15 to 1 on 11; winners ride.',
    },
    '/catalog/horn2': HORN_SINGLE,
    '/catalog/horn3': HORN_SINGLE,
    '/catalog/horn11': HORN_SINGLE,
    '/catalog/horn12': HORN_SINGLE,
    ...hopProvenance(ALL_HOPS, {
      type: {
        status: 'verified',
        source: 'CW §28, §32; STWO §7.1',
        note: 'All 15 easy and 6 hard hops; 15 to 1 easy, 30 to 1 hard; winners ride.',
      },
    }),
    '/composites': {
      status: 'verified',
      source: 'CW §24, §25',
      note: 'C&E pays 3 to 1 on 2, 3 or 12 and 7 to 1 on 11 on the whole bet; the horn puts a quarter of the bet on each of 2, 3, 11 and 12.',
    },
    '/sideBets/hotShooter': {
      status: 'verified',
      source: 'CW §33; STWO §7.2',
      note: 'Pays 1, 3, 5, 7, 12, 30 and 100 times the bet, total return ("for 1"), at 8, 16, 24, 32, 40, 45 and 50 rolls; the 1x tier returns the stake. Bet during the come-out after a 7-out, with at least 3 credits on the main game.',
    },
    '/sideBets/hotShooter/countDefinition': {
      status: 'assumed',
      source: 'STWO §7.2',
      note: 'Definition A: every roll counts, from the come-out after a 7-out through the next 7-out. Whether the 7-out itself counts is undocumented (rules spec §6.2, §9 #10).',
    },
    '/sideBets/hotShooter/tiers/6/minRolls': {
      status: 'verified',
      source: 'STWO §7.2',
      note: '"Upon the 50th roll"; the card\'s "OVER 50" would be 51 (rules spec §0.2 #7).',
    },
    '/sideBets/hotShooter/qualifyingBet': {
      status: 'assumed',
      source: 'CW §33b',
      note: '3 credits on the craps game, read as $3 at a $1 denomination.',
    },
    '/sideBets/luckyRollerLow': LUCKY_ROLLER,
    '/sideBets/luckyRollerHigh': LUCKY_ROLLER,
    '/sideBets/luckyRollerAll': LUCKY_ROLLER,
    '/sideBets/luckyRollerLow/pays': LUCKY_ROLLER_PAYS,
    '/sideBets/luckyRollerHigh/pays': LUCKY_ROLLER_PAYS,
    '/sideBets/luckyRollerAll/pays': LUCKY_ROLLER_PAYS,
    '/workingToggle': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: 'All On, All Off and per-chip OFF, "from the upcoming roll onward", on ODDS, DON\'T ODDS, COME ODDS, DON\'T COME ODDS, BIG 6/8, PLACE, BUY, PLACE TO LOSE, LAY and HARDWAYS (rules spec §0.2 #1).',
    },
    '/comeOut/autoOff': AUTO_OFF,
    '/afterSevenOut': {
      status: 'verified',
      source: 'CW §4',
      note: 'No seven-out rule beyond the come-out auto-OFF.',
    },
    '/layAutoOn': {
      status: 'assumed',
      note: 'Lay chips stay as the player set them; the automatic re-enable is an Interblock feature.',
    },
    '/oddsOffReturnedAtPointMade': {
      status: 'assumed',
      note: 'OFF odds stay up; returning them when the point is made is an Interblock feature.',
    },
    '/offBets': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: '"OFF chips do not consume a player\'s credit and do not contribute to the minimum bet."',
    },
    '/exclusiveGroups': {
      status: 'verified',
      source: 'CW §5f, §9f, §21',
      note: 'Pass vs Don\'t Pass and Come vs Don\'t Come; PLACE vs PLACE TO LOSE/LAY and BUY vs LAY/PLACE TO LOSE "for the same roll". Reading those as same-number conflicts, and allowing place and buy together, is assumed.',
    },
    '/excludeLineVsLayBuy': {
      status: 'assumed',
      note: 'An Interblock setting; Shoot To Win documents no such exclusion.',
    },
    '/payLabelStyle': {
      status: 'assumed',
      note: 'Display only: ratios are shown as the card writes them ("9 to 5").',
    },
    '/flow/shooter': {
      status: 'verified',
      source: 'CW §35',
      note: 'A designated shooter rotates; the button "does not affect the roll result".',
    },
    '/flow/invalidRoll': {
      status: 'assumed',
      source: 'STWO',
      note: 'Operators choose reshoot, void or attendant; cosmetic here, since the engine never re-rolls.',
    },
    '/flow/puckReset': { status: 'assumed', note: 'An Interblock single-play setting; not used.' },
    '/flow/groupButtons': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: "Across: the five place numbers other than the point, after the come-out and only with a Pass, Don't Pass, Field or one-roll bet up.",
    },
    '/flow/historyLength': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: 'History of the past 27 games.',
    },
    '/flow/macros': {
      status: 'verified',
      source: 'STWO (game screen)',
      note: 'Undo, Cancel and All Cancel only; winners ride by themselves.',
    },
    '/pace/rollsPerHour': {
      status: 'assumed',
      note: 'About 100 rolls per hour: a 15 to 30 s bet timer plus the shooter window and the read (rules spec §8.3).',
    },
    '/pace/betWindowSec': {
      status: 'reported',
      source: 'WOV-11344; WOV-38668; SHRT',
      note: 'Reported 15 to 30 s; 20 s used.',
    },
    '/pace/shooterWindowSec': {
      status: 'reported',
      source: 'WOV-11344',
      note: 'Up to 20 s to press the shooter button.',
    },
  },
} satisfies MachineConfigInput)
