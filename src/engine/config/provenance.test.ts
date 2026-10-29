import { describe, expect, it } from 'vitest'
import { compileConfig } from './compile.ts'
import { PRESETS, PRESET_IDS, craplessBubble } from './presets/index.ts'
import {
  SOURCES,
  citationIssues,
  governingEntry,
  isJsonPointer,
  leafPointers,
  listAssumptions,
  parsePointer,
  provenanceIssues,
  pruneProvenance,
  resolvePointer,
  sourceUrl,
  statusAt,
  toPointer,
  uncoveredPointers,
  type Provenance,
} from './provenance.ts'
import type { MachineConfigInput } from './schema.ts'

const copy = (input: MachineConfigInput): MachineConfigInput =>
  JSON.parse(JSON.stringify(input)) as MachineConfigInput

describe('JSON pointers', () => {
  it('escape "~" and "/" in keys and round-trip', () => {
    expect(toPointer(['catalog', 'place', 'pays', '6'])).toBe('/catalog/place/pays/6')
    expect(toPointer(['provenance', '/a~b/c'])).toBe('/provenance/~1a~0b~1c')
    expect(toPointer(['tiers', 6, 'minRolls'])).toBe('/tiers/6/minRolls')
    for (const path of [['a', 'b/c', 'd~e'], ['~01', '/'], ['2-5']]) {
      expect(parsePointer(toPointer(path))).toEqual(path)
    }
  })

  it('accept only RFC 6901 syntax', () => {
    for (const ok of ['/a', '/a/b', '/', '/a~0b', '/a~1b', '/hop25/pays/2-5']) {
      expect(isJsonPointer(ok), ok).toBe(true)
    }
    for (const bad of ['', 'a', 'catalog/place', '/a~2', '/a~', '#/a']) {
      expect(isJsonPointer(bad), bad).toBe(false)
    }
    expect(() => parsePointer('catalog')).toThrow(RangeError)
  })

  it('resolve into objects and arrays, and only to values that exist', () => {
    const doc = { a: { 'b/c': [10, 20, null] }, n: null }
    expect(resolvePointer(doc, '/a/b~1c/1')).toEqual({ found: true, value: 20 })
    expect(resolvePointer(doc, '/a/b~1c/2')).toEqual({ found: true, value: null })
    expect(resolvePointer(doc, '/n')).toEqual({ found: true, value: null })
    for (const missing of [
      '/a/b~1c/3',
      '/a/b~1c/01',
      '/a/b~1c/-1',
      '/a/x',
      '/n/x',
      '/a/b~1c/1/z',
    ]) {
      expect(resolvePointer(doc, missing), missing).toEqual({ found: false })
    }
    expect(resolvePointer({}, '/toString')).toEqual({ found: false })
  })

  it('list every leaf, including empty lists and objects', () => {
    expect(leafPointers({ a: [1, { b: true }], c: [], d: {}, 'e/f': null })).toEqual([
      '/a/0',
      '/a/1/b',
      '/c',
      '/d',
      '/e~1f',
    ])
  })
})

describe('sources', () => {
  it('accept known keys with a location, forum threads and user observations', () => {
    for (const ok of [
      'CW §17',
      'IB §2.6, §3.2; VA',
      'WOV-11344',
      'USER photo 2026-11-02',
      'MD-CL',
    ]) {
      expect(citationIssues(ok), ok).toEqual([])
    }
  })

  it('reject unknown keys, rejected sources and empty citations', () => {
    expect(citationIssues('CWW §17')).toEqual([
      '"CWW §17" does not start with a known source key, such as CW, IB or WOO-B',
    ])
    expect(citationIssues('CRAPSEE')).toEqual(['CRAPSEE is a rejected source (rules spec §9 #23)'])
    expect(citationIssues('CW;;IB')).toEqual(['a citation is empty; separate citations with ";"'])
    expect(citationIssues('cw §17')).toHaveLength(1)
  })

  it('link to their documents', () => {
    expect(sourceUrl('CW')).toMatch(/^https:\/\/clearwatercasino\.com\//)
    expect(sourceUrl('WOV-38668')).toBe('https://wizardofvegas.com/forum/gambling/craps/38668/')
    expect(sourceUrl('USER')).toBeNull()
    expect(sourceUrl('NOPE')).toBeNull()
    for (const [key, url] of Object.entries(SOURCES)) {
      if (key !== 'USER') expect(url, key).toMatch(/^https:\/\//)
    }
  })
})

describe('governing entries', () => {
  const provenance: Provenance = {
    '/catalog/place': { status: 'verified', source: 'IB §2.6' },
    '/catalog/place/pays/2': { status: 'assumed', note: '11:2' },
    '/catalog/placeholder': { status: 'reported', source: 'VA' },
  }

  it('are the deepest entry at or above a pointer', () => {
    expect(governingEntry(provenance, '/catalog/place/pays/2')?.pointer).toBe(
      '/catalog/place/pays/2',
    )
    expect(governingEntry(provenance, '/catalog/place/pays/6')?.pointer).toBe('/catalog/place')
    expect(governingEntry(provenance, '/catalog/place')?.pointer).toBe('/catalog/place')
    expect(statusAt(provenance, '/catalog/place/pays/6')).toBe('verified')
    expect(statusAt(provenance, '/catalog/place/pays/2')).toBe('assumed')
  })

  it('match whole keys, not prefixes of keys', () => {
    expect(governingEntry(provenance, '/catalog/placeTo')).toBeNull()
    expect(statusAt(provenance, '/catalog/placeholder/x')).toBe('reported')
  })

  it('treat uncovered values as assumed', () => {
    expect(governingEntry(provenance, '/money/payoutRounding')).toBeNull()
    expect(statusAt(provenance, '/money/payoutRounding')).toBe('assumed')
  })
})

describe('listAssumptions', () => {
  it('returns exactly the assumed entries, sorted, with their notes and sources', () => {
    const provenance: Provenance = {
      '/pace/rollsPerHour': { status: 'assumed', note: '120 rolls per hour' },
      '/catalog/place': { status: 'verified', source: 'IB §2.6' },
      '/catalog/place/pays/2': { status: 'assumed', source: 'WOO-CL', note: '11:2' },
      '/limits': { status: 'reported', source: 'VA' },
    }
    expect(listAssumptions({ provenance })).toEqual([
      { pointer: '/catalog/place/pays/2', note: '11:2', source: 'WOO-CL' },
      { pointer: '/pace/rollsPerHour', note: '120 rolls per hour', source: null },
    ])
    expect(listAssumptions({ provenance: {} })).toEqual([])
  })

  it('works on compiled configs and matches the assumed provenance of every preset', () => {
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      const assumed = Object.entries(PRESETS[id].provenance)
        .filter(([, entry]) => entry.status === 'assumed')
        .map(([pointer]) => pointer)
        .sort()
      expect(listAssumptions(cfg).map((a) => a.pointer)).toEqual(assumed)
      expect(listAssumptions(cfg).every((a) => a.note.length > 0)).toBe(true)
    }
  })

  it('lists the default machine’s key unknowns', () => {
    const pointers = listAssumptions(compileConfig(craplessBubble)).map((a) => a.pointer)
    for (const unknown of [
      '/catalog/place/pays/2',
      '/catalog/place/pays/3',
      '/catalog/buy/commission/rearm',
      '/catalog/buy/commission/refundOnTakeDown',
      '/money/payoutRounding',
      '/pace/rollsPerHour',
    ]) {
      expect(pointers).toContain(unknown)
    }
    expect(pointers).not.toContain('/catalog/buy/commission/timing')
  })
})

describe('coverage and stale entries', () => {
  it('finds values no entry covers, ignoring bookkeeping fields', () => {
    const cfg = copy(craplessBubble)
    cfg.provenance = { '/catalog': { status: 'verified', source: 'IB' } }
    const uncovered = uncoveredPointers(cfg)
    expect(uncovered).toContain('/money/payoutRounding/mode')
    expect(uncovered).toContain('/rules/craps')
    expect(uncovered.some((p) => p.startsWith('/catalog/'))).toBe(false)
    expect(uncovered.some((p) => ['/schemaVersion', '/id', '/name'].includes(p))).toBe(false)
  })

  it('flags entries that name nothing or describe the provenance itself', () => {
    const cfg = copy(craplessBubble)
    cfg.provenance = {
      '/catalog/place/pays/7': { status: 'assumed', note: 'no such pay' },
      '/provenance/~1variant': { status: 'assumed', note: 'circular' },
      '/rules/craps': { status: 'verified', source: 'IB' },
    }
    expect(provenanceIssues(cfg)).toEqual([
      {
        path: ['provenance', '/catalog/place/pays/7'],
        message: '/catalog/place/pays/7 does not name a value in this config',
      },
      {
        path: ['provenance', '/provenance/~1variant'],
        message: 'provenance cannot describe itself',
      },
    ])
  })

  it('prunes entries whose values were deleted', () => {
    const cfg = copy(craplessBubble)
    delete (cfg.catalog as Record<string, unknown>).buy
    const pruned = pruneProvenance(cfg)
    expect(Object.keys(pruned).some((p) => p.startsWith('/catalog/buy'))).toBe(false)
    expect(Object.keys(pruned).length).toBeLessThan(Object.keys(cfg.provenance).length)
    expect(provenanceIssues({ ...cfg, provenance: pruned })).toEqual([])
  })
})
