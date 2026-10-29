import { describe, expect, it } from 'vitest'

describe('ui test environment', () => {
  it('provides IndexedDB, which jsdom lacks, through fake-indexeddb', () => {
    expect(typeof indexedDB.open).toBe('function')
  })
})
