import { describe, expect, it } from 'vitest'
import type { Cents } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import {
  ConfigError,
  compileConfig,
  configHashOf,
  semanticIssues,
  validateConfig,
  type CompiledBetType,
  type MachineConfig,
} from './compile.ts'
import { PRESETS, PRESET_IDS } from './presets/index.ts'
import { leafPointers, parsePointer, pruneProvenance, toPointer } from './provenance.ts'
import type { MachineConfigInput } from './schema.ts'

type Mutable = Record<string, unknown> & MachineConfigInput
type Path = (string | number)[]

/** A deep, unfrozen copy with no shared objects, so one edit changes one place. */
const copy = (input: MachineConfigInput): Mutable => JSON.parse(JSON.stringify(input)) as Mutable

/** The object at `path` inside `root`, for editing a copy in place. */
function at(root: unknown, ...path: Path): Record<string, unknown> {
  let current = root
  for (const key of path) current = (current as Record<string, unknown>)[key]
  return current as Record<string, unknown>
}

/** The list at `path` inside `root`, for editing a copy in place. */
const listAt = (root: unknown, ...path: Path) => at(root, ...path) as unknown as unknown[]

interface Fixture {
  readonly name: string
  readonly base: keyof typeof PRESETS
  readonly edit: (cfg: Mutable) => void
  /** Every issue the edited config must produce, as zod paths. */
  readonly paths: readonly Path[]
  readonly message?: RegExp
  /**
   * Keep provenance entries the edit left pointing at nothing. Otherwise they are pruned, as an
   * editor does after deleting a value, so the fixture reports only its own problem.
   */
  readonly keepProvenance?: true
}

const { craplessBubble, traditionalBubble, strictBubble } = PRESETS

const FIXTURES: readonly Fixture[] = [
  {
    name: 'crapless with craps totals',
    base: 'craplessBubble',
    edit: (cfg) => {
      cfg.rules.craps = [2, 3, 12]
      cfg.rules.points = [4, 5, 6, 8, 9, 10, 11]
    },
    paths: [
      ['rules', 'craps'],
      ['rules', 'points'],
    ],
    message: /no craps totals|crapless points/,
  },
  {
    name: 'a missing place 11 pay',
    base: 'craplessBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'place', 'pays')['11'],
    paths: [['catalog', 'place', 'pays', '11']],
    message: /Place 11 is offered but has no pay ratio/,
  },
  {
    name: 'an empty Fire pay table',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire').payTable = {}),
    paths: [['sideBets', 'fire', 'payTable']],
    message: /pay table is empty/,
  },
  {
    name: 'an empty Hot Shooter pay table',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'sideBets', 'hotShooter').tiers = []),
    paths: [['sideBets', 'hotShooter', 'tiers']],
    message: /pay table is empty/,
  },
  {
    name: 'missing countedPoints',
    base: 'traditionalLive345',
    edit: (cfg) => delete at(cfg, 'sideBets', 'fire').countedPoints,
    paths: [['sideBets', 'fire', 'countedPoints']],
  },
  {
    name: 'a zero ratio',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'place', 'pays')['6'] = '0:1'),
    paths: [['catalog', 'place', 'pays', '6']],
    message: /greater than zero/,
  },
  {
    name: 'a negative ratio',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'field', 'pays')['12'] = '-2:1'),
    paths: [['catalog', 'field', 'pays', '12']],
    message: /cannot be negative/,
  },
  {
    name: 'a "for 1" ratio that pays nothing',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'any7', 'pays')['7'] = '1 for 1'),
    paths: [['catalog', 'any7', 'pays', '7']],
    message: /pays nothing/,
  },
  {
    name: 'verified provenance without a source',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'provenance')['/variant'] = { status: 'verified' }),
    paths: [['provenance', '/variant', 'source']],
  },
  {
    name: 'reported provenance without a source',
    base: 'traditionalBubble',
    edit: (cfg) => delete at(cfg, 'provenance', '/catalog/place/payoutRoundingByNumber/6').source,
    paths: [['provenance', '/catalog/place/payoutRoundingByNumber/6', 'source']],
  },
  {
    name: 'assumed provenance without a note',
    base: 'craplessBubble',
    edit: (cfg) => delete at(cfg, 'provenance', '/chips').note,
    paths: [['provenance', '/chips', 'note']],
  },
  {
    name: 'an unknown source key',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'provenance', '/variant').source = 'IBX §2'),
    paths: [['provenance', '/variant', 'source']],
    message: /known source key/,
  },
  {
    name: 'a rejected source',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'provenance', '/catalog/place').source = 'CRAPSEE'),
    paths: [['provenance', '/catalog/place', 'source']],
    message: /rejected source/,
  },
  {
    name: 'provenance for a value that does not exist',
    base: 'craplessBubble',
    edit: (cfg) =>
      (at(cfg, 'provenance')['/catalog/lay/pays'] = { status: 'assumed', note: 'no lay' }),
    paths: [['provenance', '/catalog/lay/pays']],
    message: /does not name a value/,
    keepProvenance: true,
  },
  {
    name: 'a provenance key that is not a JSON pointer',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'provenance')['catalog/place'] = { status: 'assumed', note: 'x' }),
    paths: [['provenance', 'catalog/place']],
    message: /invalid key: must be a JSON pointer/,
    keepProvenance: true,
  },
  {
    name: 'a bet type id that is not camelCase',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog')['place-6'] = at(cfg, 'catalog', 'place')),
    paths: [['catalog', 'place-6']],
    message: /invalid key: must be camelCase/,
  },
  {
    name: 'a negative odds multiple',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'passOdds', 'limit', 'multiple')['4'] = -1),
    paths: [['catalog', 'passOdds', 'limit', 'multiple', '4']],
  },
  {
    name: 'an odds limit on a number that is not a point',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'passOdds', 'limit', 'multiple')['2'] = 2),
    paths: [['catalog', 'passOdds', 'limit', 'multiple', '2']],
    message: /not offered/,
  },
  {
    name: 'odds with no pay for a point',
    base: 'traditionalBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'dontComeOdds', 'pays')['10'],
    paths: [['catalog', 'dontComeOdds', 'pays', '10']],
  },
  {
    name: 'odds behind a bet that is not a line bet',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'comeOdds').parent = 'place'),
    paths: [['catalog', 'comeOdds', 'parent']],
    message: /back a line bet/,
  },
  {
    name: 'pass odds with a come-out default',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'passOdds').comeOutDefault = 'off'),
    paths: [['catalog', 'passOdds', 'comeOutDefault']],
  },
  {
    name: 'a rounding increment of 0',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'money', 'payoutRounding').increment = 0),
    paths: [['money', 'payoutRounding', 'increment']],
  },
  {
    name: 'an unknown rounding mode',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'place', 'payoutRounding').mode = 'nearest'),
    paths: [['catalog', 'place', 'payoutRounding', 'mode']],
  },
  {
    name: 'fractional cents',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'money').startingBankroll = 100.5),
    paths: [['money', 'startingBankroll']],
  },
  {
    name: 'an unknown typeId in a composite',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'composites', 'horn', 'parts', 0).typeId = 'aces'),
    paths: [['composites', 'horn', 'parts', 0, 'typeId']],
    message: /not a bet type/,
  },
  {
    name: 'a composite of a bet that is not a one-roll bet',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'composites', 'ce', 'parts', 1).typeId = 'hard'),
    paths: [['composites', 'ce', 'parts', 1, 'typeId']],
    message: /one-roll/,
  },
  {
    name: 'a composite id that is already a bet type',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'composites').field = at(cfg, 'composites', 'ce')),
    paths: [['composites', 'field']],
  },
  {
    name: 'an exclusive group naming an unknown type',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'exclusiveGroups', 2, 'types')[1] = 'placeToWin'),
    paths: [['exclusiveGroups', 2, 'types', 1]],
    message: /not a bet type/,
  },
  {
    name: 'a working toggle naming a type that is not offered',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'workingToggle').types = ['place', 'buy', 'lay']),
    paths: [['workingToggle', 'types', 2]],
  },
  {
    name: '7 that is not a natural',
    base: 'traditionalBubble',
    edit: (cfg) => {
      cfg.rules.naturals = [11]
      cfg.rules.craps = [2, 3, 7, 12]
    },
    paths: [['rules', 'naturals']],
    message: /7 must be a natural/,
  },
  {
    name: 'a total listed twice',
    base: 'traditionalBubble',
    edit: (cfg) => (cfg.rules.points = [4, 5, 6, 8, 9, 10, 11]),
    paths: [['rules', 'points', 6]],
    message: /11 is listed twice/,
  },
  {
    name: 'a total left out',
    base: 'traditionalBubble',
    edit: (cfg) => (cfg.rules.points = [4, 5, 6, 8, 9]),
    paths: [['rules']],
    message: /missing 10/,
  },
  {
    name: 'traditional craps with no bar',
    base: 'traditionalBubble',
    edit: (cfg) => (cfg.rules.dontBar = null),
    paths: [['rules', 'dontBar']],
  },
  {
    name: "crapless craps offering don't pass",
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog').dontPass = copy(traditionalBubble).catalog.dontPass),
    paths: [['catalog', 'dontPass']],
    message: /beat the house/,
  },
  {
    name: 'a buy bet without a commission',
    base: 'craplessBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'buy').commission,
    paths: [['catalog', 'buy', 'commission']],
    message: /must carry a commission/,
  },
  {
    name: 'a place bet with a commission',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'place').commission = at(cfg, 'catalog', 'buy').commission),
    paths: [['catalog', 'place', 'commission']],
  },
  {
    name: 'commission taken from wins that is also re-collected',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'buy', 'commission').rearm = 'recollectFromWin'),
    paths: [['catalog', 'buy', 'commission', 'rearm']],
  },
  {
    name: 'a place number listed twice',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'place').numbers = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 6]),
    paths: [['catalog', 'place', 'numbers', 10]],
  },
  {
    name: 'a place bet on 2 in traditional craps',
    base: 'traditionalBubble',
    edit: (cfg) => {
      at(cfg, 'catalog', 'place').numbers = [2, 4, 5, 6, 8, 9, 10]
      at(cfg, 'catalog', 'place', 'pays')['2'] = '11 to 2'
    },
    paths: [['catalog', 'place', 'numbers', 0]],
    message: /not a traditional point/,
  },
  {
    name: 'a big bet on 5',
    base: 'traditionalBubble',
    edit: (cfg) => {
      at(cfg, 'catalog', 'big').numbers = [5, 8]
      at(cfg, 'catalog', 'big').pays = { '5': '1 to 1', '8': '1 to 1' }
    },
    paths: [['catalog', 'big', 'numbers', 0]],
  },
  {
    name: 'a hop written high face first',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'hop25').pays = { '5-2': '15 to 1' }),
    paths: [['catalog', 'hop25', 'pays', '5-2']],
    message: /low face first/,
  },
  {
    name: 'stayIf11 on the pass line',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'pass').afterWin = 'stayIf11'),
    paths: [['catalog', 'pass', 'afterWin']],
  },
  {
    name: 'Hot Shooter tiers out of order',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'sideBets', 'hotShooter', 'tiers', 1).minRolls = 8),
    paths: [['sideBets', 'hotShooter', 'tiers', 1, 'minRolls']],
  },
  {
    name: 'a Fire count beyond the counted points',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire', 'payTable')['7'] = '1999 to 1'),
    paths: [['sideBets', 'fire', 'payTable', '7']],
    message: /cannot happen/,
  },
  {
    name: 'a Lucky Roller that needs a 7',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'sideBets', 'luckyRollerAll').targets = [2, 3, 7]),
    paths: [['sideBets', 'luckyRollerAll', 'targets', 2]],
  },
  {
    name: 'Lucky Shooter on a crapless machine',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'sideBets').luckyShooter = copy(strictBubble).sideBets.luckyShooter),
    paths: [['sideBets', 'luckyShooter']],
    message: /traditional craps only/,
  },
  {
    name: 'a minimum bet above the maximum',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.min = 60_000),
    paths: [['limits', 'min']],
  },
  {
    name: 'per-type limits for a type that is not offered',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { lay: { min: 500 } }),
    paths: [['limits', 'perType', 'lay']],
  },
  {
    name: 'a per-type minimum above its maximum',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'limits', 'perType', 'hotShooter').min = 200_000),
    paths: [['limits', 'perType', 'hotShooter', 'min']],
  },
  {
    name: 'a chip that is not a whole number of bet increments',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.chips = [100, 550, 1_000]),
    paths: [['chips', 1]],
  },
  {
    name: 'a misspelt key',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'place').comeOutDefualt = 'on'),
    paths: [['catalog', 'place']],
    message: /Unrecognized key/,
  },
  {
    name: 'a schema version from the future',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg).schemaVersion = 2),
    paths: [['schemaVersion']],
  },
  // Rules and money (rules spec §5.3 #1, #11)
  {
    name: 'crapless craps with a don’t bar',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.rules.dontBar = 12),
    paths: [['rules', 'dontBar']],
    message: /nothing is barred/,
  },
  {
    name: 'crapless craps with put bets',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.rules.allowPutBets = true),
    paths: [['rules', 'allowPutBets']],
    message: /put bets/,
  },
  {
    name: 'a table maximum below the maximum bet',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.tableMax = 10_000),
    paths: [['limits', 'tableMax']],
    message: /table maximum is below/,
  },
  {
    name: 'a minimum total that is not a whole number of bet increments',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'limits', 'minTotal').amount = 550),
    paths: [['limits', 'minTotal', 'amount']],
    message: /multiple of \$1\.00/,
  },
  {
    name: 'a per-type maximum that is not a whole number of its increments',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'limits', 'perType', 'passOdds').max = 2_500_050),
    paths: [['limits', 'perType', 'passOdds', 'max']],
    message: /multiple of \$1\.00/,
  },
  {
    name: 'a per-type maximum below the minimum it inherits',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { field: { max: 50, increment: 50 } }),
    paths: [['limits', 'perType', 'field', 'max']],
    message: /the minimum is above the maximum/,
  },
  {
    name: 'a per-type increment that the inherited limits do not fit',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { field: { increment: 300 } }),
    paths: [['limits', 'perType', 'field', 'increment']],
    message: /min and max this type inherits must be a multiple of \$3\.00/,
  },
  {
    name: 'per-number units on a type that takes no number',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { field: { incrementByNumber: { '6': 500 } } }),
    paths: [['limits', 'perType', 'field', 'incrementByNumber']],
    message: /only odds, number bets and hardways sit on a number/,
  },
  {
    name: 'a per-number unit on a number the type takes no bet on',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'limits', 'perType', 'passOdds', 'incrementByNumber')['2'] = 500),
    paths: [['limits', 'perType', 'passOdds', 'incrementByNumber', '2']],
    message: /passOdds takes no bet on 2/,
  },
  {
    name: 'a per-number unit on a number a hardway does not offer',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { hard: { incrementByNumber: { '5': 500 } } }),
    paths: [['limits', 'perType', 'hard', 'incrementByNumber', '5']],
    message: /hard takes no bet on 5/,
  },
  {
    name: 'a per-number unit off the type’s own increment',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'limits', 'perType', 'dontPassOdds', 'incrementByNumber')['5'] = 350),
    paths: [['limits', 'perType', 'dontPassOdds', 'incrementByNumber', '5']],
    message: /must be a multiple of \$1\.00, the type's increment/,
  },
  {
    name: 'chips out of order',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.chips = [100, 1_000, 500]),
    paths: [['chips', 2]],
    message: /smallest to largest/,
  },
  // Line and odds bets (§5.3 #3, #4)
  {
    name: 'two do bets in the same window',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog').pass2 = copy(craplessBubble).catalog.pass),
    paths: [['catalog', 'pass2', 'side']],
    message: /pass is already the do bet placed in the comeOut phase/,
  },
  {
    name: 'a don’t bet that does not say how it may change on a number',
    base: 'traditionalBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'dontPass').onNumber,
    paths: [['catalog', 'dontPass', 'onNumber']],
    message: /must say how it may change/,
  },
  {
    name: 'a do bet that says how it may change on a number',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'pass').rebetAfterRemove = 'allowed'),
    paths: [['catalog', 'pass', 'rebetAfterRemove']],
    message: /locked once on a number/,
  },
  {
    name: 'stayIfFirstRoll on the pass line',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'pass').afterWin = 'stayIfFirstRoll'),
    paths: [['catalog', 'pass', 'afterWin']],
    message: /applies to don't bets/,
  },
  {
    name: 'odds behind a bet that is not in the catalog',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'passOdds').parent = 'passLine'),
    paths: [['catalog', 'passOdds', 'parent']],
    message: /"passLine" is not a bet type/,
  },
  {
    name: 'come odds with no come-out default',
    base: 'craplessBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'comeOdds').comeOutDefault,
    paths: [['catalog', 'comeOdds', 'comeOutDefault']],
    message: /need a come-out default/,
  },
  {
    name: 'two odds types behind one line bet',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog').passOdds2 = copy(craplessBubble).catalog.passOdds),
    paths: [['catalog', 'passOdds2', 'parent']],
    message: /pass already has odds: passOdds/,
  },
  {
    name: 'odds with no limit on a point',
    base: 'craplessBubble',
    edit: (cfg) => delete at(cfg, 'catalog', 'passOdds', 'limit', 'multiple')['12'],
    paths: [['catalog', 'passOdds', 'limit', 'multiple', '12']],
    message: /odds on 12 need a limit/,
  },
  // Number bets and commission (§5.3 #5)
  {
    name: 'a rounding override on a number the bet does not offer',
    base: 'traditionalBubble',
    edit: (cfg) =>
      (at(cfg, 'catalog', 'place', 'payoutRoundingByNumber')['11'] = {
        mode: 'ceil',
        increment: 1,
      }),
    paths: [['catalog', 'place', 'payoutRoundingByNumber', '11']],
    message: /11 is not one of this bet's numbers/,
  },
  {
    name: 'a commission override on a number the bet does not offer',
    base: 'traditionalLive345',
    edit: (cfg) =>
      (at(cfg, 'catalog', 'buy', 'commissionByNumber')['3'] = at(
        cfg,
        'catalog',
        'buy',
        'commissionByNumber',
        '4',
      )),
    paths: [['catalog', 'buy', 'commissionByNumber', '3']],
    message: /3 is not one of this bet's numbers/,
  },
  {
    name: 'commission taken from wins that is refunded on take-down',
    base: 'traditionalBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'lay', 'commission').refundOnTakeDown = true),
    paths: [['catalog', 'lay', 'commission', 'refundOnTakeDown']],
    message: /nothing can be refunded/,
  },
  // One-roll bets (§5.3 #7)
  {
    name: 'a one-roll bet with no winning outcome',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'field').pays = {}),
    paths: [['catalog', 'field', 'pays']],
    message: /at least one winning outcome/,
  },
  {
    name: 'a one-roll bet on a total that does not exist',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'field', 'pays')['13'] = '1:1'),
    paths: [['catalog', 'field', 'pays', '13']],
    message: /total from "2" to "12"/,
  },
  {
    name: 'a hop keyed by a total',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'hop25').pays = { '7': '16 for 1' }),
    paths: [['catalog', 'hop25', 'pays', '7']],
    message: /dice pair such as "2-5"/,
  },
  // Composites (§5.3 #8; plan §0 #15)
  {
    name: 'a composite that lists a part twice',
    base: 'craplessBubble',
    edit: (cfg) => listAt(cfg, 'composites', 'ce', 'parts').push({ typeId: 'c', units: 1 }),
    paths: [['composites', 'ce', 'parts', 2, 'typeId']],
    message: /c is already a part/,
  },
  {
    name: 'a world bet that loses part of its stake on a 7',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'catalog', 'any7', 'pays')['7'] = '3 to 1'),
    paths: [['composites', 'world']],
    message: /on 1-6 it nets -1\/5 per unit, a partial loss/,
  },
  {
    name: 'composite parts that disagree after a win',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'catalog', 'e').afterWin = 'stay'),
    paths: [['composites', 'ce', 'parts', 1, 'typeId']],
    message: /must agree after a win: c has return, e stay/,
  },
  {
    name: 'composite parts that round winnings differently',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'catalog', 'boxcars').payoutRounding = { mode: 'ceil', increment: 1 }),
    paths: [['composites', 'horn', 'parts', 3, 'typeId']],
    message: /boxcars must round winnings like snakeEyes/,
  },
  {
    name: 'a composite increment that the limits it inherits do not fit',
    base: 'craplessBubble',
    edit: (cfg) => (cfg.limits.perType = { horn: { increment: 400 } }),
    paths: [['limits', 'perType', 'horn', 'increment']],
    message: /the min this type inherits must be a multiple of \$4\.00/,
  },
  // Side bets (§5.3 #9)
  {
    name: 'a side bet that reuses a bet type id',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'sideBets').field = at(cfg, 'sideBets', 'luckyRollerLow')),
    paths: [['sideBets', 'field']],
    message: /"field" is already the id of a bet type/,
  },
  {
    name: 'a Lucky Roller target listed twice',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'sideBets', 'luckyRollerLow').targets = [2, 3, 4, 5, 6, 6]),
    paths: [['sideBets', 'luckyRollerLow', 'targets', 5]],
    message: /6 is listed twice/,
  },
  {
    name: 'a Fire bet that counts no points',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire').countedPoints = []),
    paths: [
      ['sideBets', 'fire', 'countedPoints'],
      ['sideBets', 'fire', 'payTable', '4'],
      ['sideBets', 'fire', 'payTable', '5'],
      ['sideBets', 'fire', 'payTable', '6'],
    ],
    message: /list the points that count/,
  },
  {
    name: 'a Fire bet paid at once on more points than count',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire').payImmediatelyAt = 7),
    paths: [['sideBets', 'fire', 'payImmediatelyAt']],
    message: /only 6 points count/,
  },
  {
    name: 'a Fire bet paid at once on a count with no pay',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire').payImmediatelyAt = 3),
    paths: [['sideBets', 'fire', 'payImmediatelyAt']],
    message: /no pay for this count/,
  },
  {
    name: 'a count-table key that is not a whole number',
    base: 'traditionalLive345',
    edit: (cfg) => (at(cfg, 'sideBets', 'fire', 'payTable').six = '999 to 1'),
    paths: [['sideBets', 'fire', 'payTable', 'six']],
    message: /whole number of unique points/,
  },
  {
    name: 'a Lucky Shooter with one box number',
    base: 'strictBubble',
    edit: (cfg) => (at(cfg, 'sideBets', 'luckyShooter').points = [4]),
    paths: [
      ['sideBets', 'luckyShooter', 'points'],
      ['sideBets', 'luckyShooter', 'payTable', '3'],
      ['sideBets', 'luckyShooter', 'payTable', '4'],
      ['sideBets', 'luckyShooter', 'payTable', '5'],
    ],
    message: /list the box numbers/,
  },
  {
    name: 'Hot Shooter on a crapless machine',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'sideBets').hotShooter = copy(traditionalBubble).sideBets.hotShooter),
    paths: [['sideBets', 'hotShooter']],
    message: /traditional craps only/,
  },
  // Working controls and type lists (§5.3 #10; rules spec §2.4)
  {
    name: 'a working toggle that lists a type twice',
    base: 'craplessBubble',
    edit: (cfg) => (at(cfg, 'workingToggle').types = ['place', 'buy', 'place']),
    paths: [['workingToggle', 'types', 2]],
    message: /place is listed twice/,
  },
  {
    name: 'a working toggle that switches the pass line',
    base: 'craplessBubble',
    edit: (cfg) => listAt(cfg, 'workingToggle', 'types').push('pass'),
    paths: [['workingToggle', 'types', 5]],
    message: /pass always works/,
  },
  {
    name: 'a come-out auto-OFF that switches the field',
    base: 'traditionalBubble',
    edit: (cfg) => listAt(cfg, 'comeOut', 'autoOff', 'newlyPlaced').push('field'),
    paths: [['comeOut', 'autoOff', 'newlyPlaced', 5]],
    message: /field always works/,
  },
  {
    name: 'a seven-out rule that switches come bets',
    base: 'craplessBubble',
    edit: (cfg) => listAt(cfg, 'afterSevenOut', 'newPlacedOff', 'types').push('come'),
    paths: [['afterSevenOut', 'newPlacedOff', 'types', 2]],
    message: /come always works/,
  },
  {
    name: 'an unknown seven-out trigger',
    base: 'strictBubble',
    edit: (cfg) => (at(cfg, 'afterSevenOut', 'newPlacedOff').trigger = 'pointMade'),
    paths: [['afterSevenOut', 'newPlacedOff', 'trigger']],
  },
]

describe('invalid configs', () => {
  it('has at least 20 fixtures, each with a distinct name', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(20)
    expect(new Set(FIXTURES.map((f) => f.name)).size).toBe(FIXTURES.length)
  })

  it.each(FIXTURES)('rejects $name at the expected path', (fixture) => {
    const { base, edit, paths, message, keepProvenance } = fixture
    const cfg = copy(PRESETS[base])
    edit(cfg)
    if (keepProvenance === undefined) cfg.provenance = pruneProvenance(cfg)
    const issues = validateConfig(cfg)
    expect(issues.map((issue) => issue.path)).toEqual(paths)
    if (message !== undefined) expect(issues.map((i) => i.message).join(' | ')).toMatch(message)
    expect(() => compileConfig(cfg)).toThrow(ConfigError)
  })

  it('rejects input that is not a config object at all', () => {
    for (const input of [null, undefined, 42, 'craplessBubble', []]) {
      expect(validateConfig(input).length).toBeGreaterThan(0)
      expect(() => compileConfig(input)).toThrow(ConfigError)
    }
  })

  it('reports every issue in the ConfigError, with readable locations', () => {
    const cfg = copy(craplessBubble)
    delete at(cfg, 'catalog', 'place', 'pays')['11']
    at(cfg, 'catalog', 'place', 'pays')['6'] = '0:1'
    try {
      compileConfig(cfg)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const { issues, message } = error as ConfigError
      // A bad value inside a well-formed config does not stop the semantic checks.
      expect(issues.map((issue) => toPointer(issue.path))).toEqual([
        '/catalog/place/pays/6',
        '/catalog/place/pays/11',
        '/provenance/~1catalog~1place~1pays~111',
      ])
      expect(message).toMatch(/^Invalid machine config: \/catalog\/place\/pays\/6: .*; \/catalog/)
    }
  })

  it('shows the first five issues in the message and counts the rest', () => {
    const cfg = copy(craplessBubble)
    for (const n of ['2', '3', '4', '5', '6', '8', '9']) {
      at(cfg, 'catalog', 'place', 'pays')[n] = '0:1'
    }
    expect(() => compileConfig(cfg)).toThrow(/; \/catalog\/place\/pays\/6: .* \(and 2 more\)$/)
  })

  it('stops at structural errors before checking how values relate', () => {
    const cfg = copy(craplessBubble)
    at(cfg, 'catalog', 'place').numbers = 'all'
    delete at(cfg, 'catalog', 'buy', 'pays')['11']
    expect(validateConfig(cfg).map((issue) => issue.path)).toEqual([
      ['catalog', 'place', 'numbers'],
    ])
  })
})

describe('valid configs', () => {
  it('every preset passes the schema and the semantic checks', () => {
    for (const id of PRESET_IDS) {
      expect(validateConfig(PRESETS[id]), id).toEqual([])
      expect(semanticIssues(PRESETS[id]), id).toEqual([])
    }
  })

  it('accepts a Fire bet paid at once on a count its pay table has', () => {
    const cfg = copy(PRESETS.traditionalLive345)
    at(cfg, 'sideBets', 'fire').payImmediatelyAt = 6
    expect(validateConfig(cfg)).toEqual([])
    expect(compileConfig(cfg).sideBets.get('fire')).toMatchObject({ payImmediatelyAt: 6 })
  })

  it('accepts Big 6/8 in crapless: Crown Perth deals it at 1:1 (research core.md §8)', () => {
    const cfg = copy(craplessBubble)
    at(cfg, 'catalog').big = copy(traditionalBubble).catalog.big
    expect(validateConfig(cfg)).toEqual([])
  })

  it('accepts a composite that nets exactly 0 or −1 on some rolls (plan §0 #15)', () => {
    // The live world bet pushes on 7: any 7's 4 to 1 on one of five units returns 5/5.
    expect(validateConfig(PRESETS.traditionalLive345)).toEqual([])
    // Field + any 7 returns 2/2 on 3, 4, 9, 10 and 11, a push, and loses it all on 5, 6 and 8.
    const cfg = copy(PRESETS.traditionalLive345)
    at(cfg, 'composites').fieldSeven = {
      label: 'Field Seven',
      parts: [
        { typeId: 'field', units: 1 },
        { typeId: 'any7', units: 1 },
      ],
    }
    expect(validateConfig(cfg)).toEqual([])
  })
})

describe('compileConfig', () => {
  it('memoizes by input object', () => {
    expect(compileConfig(craplessBubble)).toBe(compileConfig(craplessBubble))
    const twin = copy(craplessBubble)
    const fromTwin = compileConfig(twin)
    expect(fromTwin).not.toBe(compileConfig(craplessBubble))
    expect(fromTwin.configHash).toBe(compileConfig(craplessBubble).configHash)
    expect(compileConfig(twin)).toBe(fromTwin)
  })

  it('memoizes the compiled config’s own input, so compileConfig(cfg.input) is the same object', () => {
    const cfg = compileConfig(copy(craplessBubble))
    expect(compileConfig(cfg.input)).toBe(cfg)
  })

  it('never returns a stale config after the caller edits its input in place', () => {
    const mine = copy(craplessBubble)
    compileConfig(mine)
    try {
      at(mine, 'catalog', 'place', 'pays')['6'] = '6:5'
    } catch {
      // A frozen input refuses the edit; either way the compiled config must match the input.
    }
    const again = compileConfig(mine)
    expect(again.configHash).toBe(configHashOf(mine))
    expect(numberType(again, 'place').pays.get(6)?.label).toBe(mine.catalog.place?.pays['6'])
  })

  it('freezes a valid input all the way down, so it cannot drift from its compiled form', () => {
    const mine = copy(traditionalBubble)
    const cfg = compileConfig(mine)
    for (const part of [mine, mine.rules.points, mine.catalog.place, mine.provenance]) {
      expect(Object.isFrozen(part)).toBe(true)
    }
    expect(() => {
      at(mine, 'catalog', 'place', 'pays')['6'] = '6 to 5'
    }).toThrow(TypeError)
    expect(compileConfig(mine)).toBe(cfg)
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(Object.isFrozen(cfg.input.catalog)).toBe(true)
    expect(Object.isFrozen(cfg.input.provenance)).toBe(true)
    expect(cfg.input).toEqual(mine)
  })

  it('freezes below an object that was frozen only shallowly', () => {
    const mine = Object.freeze(copy(craplessBubble))
    compileConfig(mine)
    expect(Object.isFrozen(mine.catalog.place)).toBe(true)
    expect(Object.isFrozen(mine.limits.minTotal)).toBe(true)
  })

  it('leaves an invalid input unfrozen, for the caller to fix', () => {
    const mine = copy(craplessBubble)
    at(mine, 'catalog', 'place', 'pays')['6'] = '0:1'
    expect(() => compileConfig(mine)).toThrow(ConfigError)
    expect(Object.isFrozen(mine)).toBe(false)
    at(mine, 'catalog', 'place', 'pays')['6'] = '7:6'
    expect(compileConfig(mine).configHash).toBe(compileConfig(craplessBubble).configHash)
  })

  it('parses ratios, keeping the machine’s wording as the label', () => {
    const cfg = compileConfig(craplessBubble)
    const place = numberType(cfg, 'place')
    expect(place.pays.get(2)).toEqual({ num: 11n, den: 2n, label: '11:2' })
    expect(place.pays.get(6)).toEqual({ num: 7n, den: 6n, label: '7:6' })
    const any7 = cfg.catalog.get('any7')
    expect(any7?.family === 'oneRoll' && any7.pays.get('7')).toEqual({
      num: 4n,
      den: 1n,
      label: '5 for 1',
    })
    expect(cfg.sideBets.get('luckyRollerAll')).toMatchObject({
      pays: { num: 155n, den: 1n, label: '156 for 1' },
    })
  })

  it('builds the ruleset, money, limits and type maps', () => {
    const cfg = compileConfig(craplessBubble)
    expect(cfg.ruleset).toEqual({
      variant: 'crapless',
      dontBar: null,
      naturals: [7],
      craps: [],
      points: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    })
    expect(cfg.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(cfg.betIncrement).toBe(100)
    expect(cfg.limits.byType.get('place')).toEqual({ min: 100, max: 50_000, increment: 100 })
    expect(cfg.limits.byType.get('luckyRollerLow')).toEqual({
      min: 100,
      max: 50_000,
      increment: 100,
    })
    expect(cfg.oddsFor).toEqual(
      new Map([
        ['pass', 'passOdds'],
        ['come', 'comeOdds'],
      ]),
    )
    expect([...cfg.composites.keys()]).toEqual(['ce', 'horn'])
    expect(cfg.catalog.get('pass')).toMatchObject({
      onNumber: 'locked',
      rebetAfterRemove: 'allowed',
    })
    const live = compileConfig(PRESETS.traditionalLive345)
    expect(live.limits.byType.get('pass')).toEqual({ min: 1_000, max: 500_000, increment: 100 })
    expect(live.limits.byType.get('passOdds')).toEqual({ min: 100, max: 2_500_000, increment: 100 })
    expect(live.limits.minTotal).toBeNull()
    expect(live.limits.tableMax).toBeNull()
  })

  it('compiles the minimum total and the table maximum to cents', () => {
    const cfg = compileConfig(craplessBubble)
    // Typed as Cents, like every other compiled amount.
    const amount: Cents | undefined = cfg.limits.minTotal?.amount
    expect(amount).toBe(500)
    expect(cfg.limits.minTotal).toEqual({
      amount: 500,
      scope: 'totalRound',
      countOff: false,
      countSideBets: false,
    })
    expect(Object.isFrozen(cfg.limits.minTotal)).toBe(true)
    const capped = copy(craplessBubble)
    capped.limits.tableMax = 200_000
    const tableMax: Cents | null = compileConfig(capped).limits.tableMax
    expect(tableMax).toBe(200_000)
  })

  it('applies per-type rounding over the config default, and per-number rounding over that', () => {
    const stw = compileConfig(traditionalBubble)
    const place = numberType(stw, 'place')
    expect(place.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect([...place.payoutRoundingByNumber]).toEqual([
      [6, { mode: 'ceil', increment: 1 }],
      [8, { mode: 'ceil', increment: 1 }],
    ])
    expect(stw.catalog.get('placeToLose')?.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(stw.catalog.get('lay')?.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(numberType(stw, 'lay').payoutRoundingByNumber.size).toBe(0)
  })

  it('compiles per-number stake units, keyed by number, for the types that set them', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    expect([...(live.limits.incrementByNumber.get('passOdds') ?? [])]).toEqual([
      [4, 100],
      [5, 200],
      [6, 500],
      [8, 500],
      [9, 200],
      [10, 100],
    ])
    expect(live.limits.incrementByNumber.get('dontComeOdds')?.get(6)).toBe(600)
    expect(live.limits.incrementByNumber.has('place')).toBe(false)
    expect(compileConfig(craplessBubble).limits.incrementByNumber.size).toBe(0)
  })

  it('lists the values it does not model (plan §0 #23)', () => {
    expect(compileConfig(traditionalBubble).notModelled).toEqual(['/offBets/consumeCredit'])
    expect(compileConfig(craplessBubble).notModelled).toEqual([])
    const credit = copy(craplessBubble)
    credit.offBets.consumeCredit = false
    expect(compileConfig(credit).notModelled).toEqual(['/offBets/consumeCredit'])
  })

  it('resolves commission per number, overrides included', () => {
    const live = numberType(compileConfig(PRESETS.traditionalLive345), 'buy')
    const vig4 = live.commission?.get(4)
    const vig5 = live.commission?.get(5)
    expect(vig4?.timing).toBe('onWin')
    expect(vig4?.rearm).toBe('none')
    expect(vig5?.timing).toBe('upfront')
    expect(vig5?.refundOnTakeDown).toBe(true)
    expect(vig5?.rate.equals(Fraction.of(1, 20))).toBe(true)
    expect(vig5?.rounding).toEqual({ mode: 'floor', increment: 100 })
    expect(vig5?.minimum).toBe(100)
    expect(numberType(compileConfig(craplessBubble), 'place').commission).toBeNull()
  })

  it('keeps the Hot Shooter push tier apart from paying tiers', () => {
    const hotShooter = compileConfig(traditionalBubble).sideBets.get('hotShooter')
    expect(hotShooter?.family).toBe('handLength')
    if (hotShooter?.family !== 'handLength') return
    expect(
      hotShooter.tiers.map((t) => [t.minRolls, t.pays === 'push' ? 'push' : t.pays.num]),
    ).toEqual([
      [8, 'push'],
      [16, 2n],
      [24, 4n],
      [32, 6n],
      [40, 11n],
      [45, 29n],
      [50, 99n],
    ])
  })
})

describe('compiled composites (plan §0 #15)', () => {
  it('reports a part whose pay ratio is junk as issues, never a raw throw (M5/M6 audit)', () => {
    const cfg = structuredClone(craplessBubble)
    const c = cfg.catalog.c
    if (c?.family !== 'oneRoll') throw new Error('no c bet')
    c.pays['2'] = '1:0'
    expect(validateConfig(cfg).map((i) => i.path.join('.'))).toContain('catalog.c.pays.2')
    expect(() => compileConfig(cfg)).toThrow(ConfigError)
  })

  it('reports a composite with no parts as issues, never a division by zero (M5/M6 audit)', () => {
    const cfg = structuredClone(craplessBubble)
    const horn = cfg.composites.horn
    if (horn === undefined) throw new Error('no horn')
    horn.parts = []
    expect(validateConfig(cfg).length).toBeGreaterThan(0)
    expect(() => compileConfig(cfg)).toThrow(ConfigError)
  })

  /** A composite's wins as "key=num:den" and its pushes as "key=push", outcome order kept. */
  function nets(cfg: MachineConfig, id: string): string[] {
    const composite = cfg.composites.get(id)
    if (composite === undefined) throw new Error(`${cfg.id} has no composite ${id}`)
    return [
      ...[...composite.pays].map(([key, { num, den }]) => `${key}=${num}:${den}`),
      ...[...composite.pushes].map((key) => `${key}=push`),
    ]
  }

  it('compiles each composite as one bet type of its own id, keyed by total', () => {
    const cfg = compileConfig(craplessBubble)
    expect(cfg.composites.get('horn')).toMatchObject({
      family: 'composite',
      id: 'horn',
      typeId: 'horn',
      label: 'Horn',
      units: 4,
      match: 'total',
      afterWin: 'return',
      payoutRounding: { mode: 'floor', increment: 1 },
    })
    expect(nets(cfg, 'horn')).toEqual(['2=27:4', '3=3:1', '11=3:1', '12=27:4'])
    expect(nets(cfg, 'ce')).toEqual(['2=3:1', '3=3:1', '11=7:1', '12=3:1'])
    expect(cfg.composites.get('horn')?.pays.get('12')?.label).toBe('27:4')
  })

  it('derives the world bet’s push on 7 and the horn high nets from the parts', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    expect(nets(live, 'world')).toEqual(['2=26:5', '3=11:5', '11=11:5', '12=26:5', '7=push'])
    expect(nets(live, 'hornHigh11')).toEqual(['2=26:5', '3=11:5', '11=27:5', '12=26:5'])
    expect(live.composites.get('world')).toMatchObject({ units: 5, afterWin: 'return' })
  })

  it('takes after-win and rounding from the parts', () => {
    expect(compileConfig(traditionalBubble).composites.get('ce')?.afterWin).toBe('stay')
    const cfg = copy(craplessBubble)
    for (const id of ['snakeEyes', 'aceDeuce', 'yo', 'boxcars']) {
      at(cfg, 'catalog', id).payoutRounding = { mode: 'halfUp', increment: 1 }
    }
    expect(compileConfig(cfg).composites.get('horn')?.payoutRounding).toEqual({
      mode: 'halfUp',
      increment: 1,
    })
  })

  it('keys a composite with a dice-matched part by dice, low face first', () => {
    const cfg = copy(PRESETS.traditionalLive345)
    at(cfg, 'composites').acesAndHop = {
      label: 'Aces and Hop 1-1',
      parts: [
        { typeId: 'aces', units: 1 },
        { typeId: 'hop11', units: 1 },
      ],
    }
    const compiled = compileConfig(cfg)
    expect(compiled.composites.get('acesAndHop')?.match).toBe('dice')
    // Both parts win on 1-1: each returns 31 of its unit, so the bet nets 30:1.
    expect(nets(compiled, 'acesAndHop')).toEqual(['1-1=30:1'])
  })

  it('gives composites limits: the config defaults, or their own per-type limits', () => {
    expect(compileConfig(craplessBubble).limits.byType.get('horn')).toEqual({
      min: 100,
      max: 50_000,
      increment: 100,
    })
    const cfg = copy(craplessBubble)
    cfg.limits.perType = { horn: { min: 400, increment: 400 } }
    expect(validateConfig(cfg)).toEqual([])
    expect(compileConfig(cfg).limits.byType.get('horn')).toEqual({
      min: 400,
      max: 50_000,
      increment: 400,
    })
  })
})

describe('configHash', () => {
  /** A deep copy with every object's keys inserted in reverse order. */
  function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeys)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    )
  }

  it('ignores key order', () => {
    for (const id of PRESET_IDS) {
      const reordered = reverseKeys(PRESETS[id])
      expect(compileConfig(reordered).configHash, id).toBe(compileConfig(PRESETS[id]).configHash)
    }
  })

  it('ignores the name and every provenance edit', () => {
    const base = compileConfig(craplessBubble).configHash
    const renamed = copy(craplessBubble)
    renamed.name = 'My machine at the Fremont'
    expect(compileConfig(renamed).configHash).toBe(base)
    const noted = copy(craplessBubble)
    at(noted, 'provenance', '/chips').note = 'Measured on my machine.'
    delete at(noted, 'provenance')['/pace/rollsPerHour']
    at(noted, 'provenance')['/catalog/place/pays/6'] = { status: 'verified', source: 'USER photo' }
    expect(compileConfig(noted).configHash).toBe(base)
  })

  it('changes when any rule value changes, in every preset', () => {
    const changed = (value: unknown): unknown => {
      if (typeof value === 'number') return value + 1
      if (typeof value === 'string') return `${value}x`
      if (typeof value === 'boolean') return !value
      if (Array.isArray(value)) return [...value, 0]
      if (value === null) return 0
      return { ...value, extra: 0 }
    }
    for (const id of PRESET_IDS) {
      const base = configHashOf(PRESETS[id])
      const pointers = leafPointers(PRESETS[id]).filter(
        (p) => p !== '/name' && !p.startsWith('/provenance/'),
      )
      expect(pointers.length).toBeGreaterThan(200)
      const unchanged = pointers.filter((pointer) => {
        const cfg = copy(PRESETS[id])
        const path = parsePointer(pointer)
        const key = path.pop()!
        const parent = at(cfg, ...path)
        parent[key] = changed(parent[key])
        return configHashOf(cfg) === base
      })
      expect(unchanged, id).toEqual([])
    }
  })

  it('differs between presets', () => {
    const hashes = PRESET_IDS.map((id) => compileConfig(PRESETS[id]).configHash)
    expect(new Set(hashes).size).toBe(PRESET_IDS.length)
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })
})

function numberType(cfg: MachineConfig, typeId: string) {
  const type: CompiledBetType | undefined = cfg.catalog.get(typeId)
  if (type?.family !== 'numberVsSeven') throw new Error(`${typeId} is not a number bet`)
  return type
}

// toPointer is exercised here so issue paths and provenance keys stay interchangeable.
describe('issue paths', () => {
  it('turn into the same JSON pointers that provenance uses', () => {
    expect(toPointer(['provenance', '/variant', 'source'])).toBe('/provenance/~1variant/source')
    expect(toPointer(['catalog', 'place', 'pays', '11'])).toBe('/catalog/place/pays/11')
  })
})
