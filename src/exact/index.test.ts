import { describe, expect, it } from 'vitest'
import * as exact from './index.ts'

describe('the exact barrel', () => {
  it('exports the analysis API the coach and the workers use', () => {
    for (const name of [
      'analyzeBet',
      'analyzeExisting',
      'analyzeLayout',
      'catalogTable',
      'combinedEdge',
      'commissionMinimumBinds',
      'derive',
      'efficientAmounts',
      'minimumFreeFrom',
      'renewalCost',
      'roundStats',
      'sameEvents',
      'sanityCheck',
      'standingCost',
      'suggestAlternatives',
      'toWire',
      'fromWire',
      'typicalStart',
    ] as const) {
      expect(typeof exact[name], name).toBe('function')
    }
    expect(exact.EXACT_VERSION).toBe(2)
  })
})
