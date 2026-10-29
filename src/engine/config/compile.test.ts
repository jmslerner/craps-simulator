import { describe, expect, it } from 'vitest'
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
    edit: (cfg) => delete at(cfg, 'provenance', '/catalog/place/payoutRounding').source,
    paths: [['provenance', '/catalog/place/payoutRounding', 'source']],
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

  it('freezes its own copy and leaves the caller’s object alone', () => {
    const mine = copy(traditionalBubble)
    const cfg = compileConfig(mine)
    expect(Object.isFrozen(mine)).toBe(false)
    expect(Object.isFrozen(mine.rules.points)).toBe(false)
    expect(Object.isFrozen(mine.catalog.place)).toBe(false)
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(Object.isFrozen(cfg.input.catalog)).toBe(true)
    expect(Object.isFrozen(cfg.input.provenance)).toBe(true)
    expect(cfg.input).toEqual(mine)
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
  })

  it('applies per-type rounding over the config default', () => {
    const stw = compileConfig(traditionalBubble)
    expect(stw.catalog.get('place')?.payoutRounding).toEqual({ mode: 'ceil', increment: 1 })
    expect(stw.catalog.get('placeToLose')?.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(stw.catalog.get('lay')?.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
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
