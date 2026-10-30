import { beforeEach, describe, expect, it } from 'vitest'
import { ENGINE_VERSION, hashJson } from '../engine/index.ts'
import type { WindowedSession } from '../engine/index.ts'
import { CRAPLESS, placePass, placeSix, playRolls, roll, testSession } from '../ui/test/game.ts'
import { createSessionRepo, type SessionMeta } from './sessionRepo.ts'
import { KEYS, SESSION_CHUNK, safeDelMany, safeGet, safeKeys, safeSet } from './storage.ts'

/**
 * The session repo on fake-indexeddb (the ui test setup loads it): store before the reveal, resume
 * with a replay and a hash check, survive version changes, and never let junk escape as a throw.
 */

const NOW = 1_761_700_000_000
const repo = createSessionRepo({ now: () => NOW })

function meta(id: string): SessionMeta {
  return { id, createdAt: NOW, divergent: false }
}

async function wipe(): Promise<void> {
  const all = await safeKeys()
  if (all.ok && all.value.length > 0) await safeDelMany(all.value)
}

beforeEach(wipe)

/** A session with one committed roll and one pending bet, the repo's bread and butter. */
function playedSession(seed: string): WindowedSession {
  const opened = placePass(testSession(seed))
  const rolled = roll(opened, [1, 1]).session // point 2 on crapless
  return placeSix(rolled) // the open window's pending bet
}

describe('start, save, resume', () => {
  it('resumes the stored session identically, pending actions included', async () => {
    const session = playedSession('repo-resume')
    const started = await repo.startSession(meta('s1'), session)
    expect(started.ok).toBe(true)
    const saved = await repo.saveBetting(meta('s1'), session)
    expect(saved.ok).toBe(true)

    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('active')
    if (loaded.kind !== 'active') return
    expect(loaded.notice).toBeNull()
    expect(loaded.pendingReveal).toBe(false)
    expect(loaded.session.pending).toStrictEqual(session.pending)
    expect(hashJson(loaded.session.state)).toBe(hashJson(session.state))
    expect(loaded.meta).toStrictEqual(meta('s1'))
  })

  it('loads nothing when no session was stored', async () => {
    expect(await repo.loadActive()).toStrictEqual({ kind: 'none' })
  })

  it('commitRoll stores the roll with pendingReveal before any reveal, cleared afterwards', async () => {
    const opened = placePass(testSession('repo-reveal'))
    await repo.startSession(meta('s2'), opened)
    const rolled = roll(opened, [3, 4]) // natural 7 on crapless: pass wins
    const committed = await repo.commitRoll(meta('s2'), rolled.session, rolled.record)
    expect(committed.ok).toBe(true)

    const during = await repo.loadActive()
    expect(during.kind).toBe('active')
    if (during.kind !== 'active') return
    expect(during.pendingReveal).toBe(true)
    // The stored state already holds the outcome: a reload reveals it and never re-rolls.
    expect(hashJson(during.session.state)).toBe(rolled.record.hashAfter)

    await repo.clearPendingReveal(meta('s2'), rolled.session)
    const after = await repo.loadActive()
    expect(after.kind === 'active' && after.pendingReveal).toBe(false)
  })

  it('refuses a commitRoll whose record is not the session’s latest window', async () => {
    const opened = placePass(testSession('repo-mismatch'))
    const first = roll(opened, [1, 1])
    const second = roll(placeSix(first.session), [2, 3])
    const written = await repo.commitRoll(meta('s3'), second.session, first.record)
    expect(written.ok).toBe(false)
  })

  it('chunks the log at 100 windows and loads them all back', async () => {
    const session = playRolls(testSession('repo-chunks'), SESSION_CHUNK + 5)
    await repo.startSession(meta('s4'), session)
    const chunk0 = await safeGet<unknown[]>(KEYS.chunk('s4', 0))
    const chunk1 = await safeGet<unknown[]>(KEYS.chunk('s4', 1))
    expect(chunk0.ok && chunk0.value?.length).toBe(SESSION_CHUNK)
    expect(chunk1.ok && chunk1.value?.length).toBe(5)
    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('active')
    if (loaded.kind !== 'active') return
    expect(loaded.session.committed).toHaveLength(SESSION_CHUNK + 5)
    expect(hashJson(loaded.session.state)).toBe(hashJson(session.state))
  })

  it('a new game archives the old session as lastResult and clears its keys', async () => {
    const first = playedSession('repo-old')
    await repo.startSession(meta('old'), first)
    const next = placePass(testSession('repo-new'))
    await repo.startSession(meta('new'), next)

    const last = await repo.readLastResult()
    expect(last).not.toBeNull()
    expect(last?.id).toBe('old')
    expect(last?.machineId).toBe(CRAPLESS.id)
    expect(last?.rolls).toBe(1)
    expect(last?.ledger).toStrictEqual(first.state.ledger)

    const keys = await safeKeys()
    expect(keys.ok && keys.value.some((key) => key.startsWith('session:old:'))).toBe(false)
    const current = await safeGet<string>(KEYS.current)
    expect(current.ok && current.value).toBe('new')
  })
})

describe('junk and versions', () => {
  it('quarantines a junk head and starts fresh, without throwing', async () => {
    await safeSet(KEYS.current, 'sX')
    await safeSet(KEYS.head('sX'), { nonsense: true })
    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('corrupt')
    expect(await repo.loadActive()).toStrictEqual({ kind: 'none' })
    const quarantined = await safeGet(KEYS.corrupt(NOW))
    expect(quarantined.ok && quarantined.value !== undefined).toBe(true)
  })

  it('quarantines a junk log chunk', async () => {
    const session = playedSession('repo-badchunk')
    await repo.startSession(meta('s5'), session)
    await repo.saveBetting(meta('s5'), session)
    await safeSet(KEYS.chunk('s5', 0), ['not a window'])
    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('corrupt')
  })

  it('quarantines a same-version log that does not replay to its hash', async () => {
    const opened = placePass(testSession('repo-tamper'))
    const rolled = roll(opened, [1, 1])
    await repo.startSession(meta('s6'), rolled.session)
    const tampered = [{ ...rolled.record, hashAfter: '0123456789abcdef' }]
    await safeSet(KEYS.chunk('s6', 0), tampered)
    const head = await safeGet<Record<string, unknown>>(KEYS.head('s6'))
    if (!head.ok || head.value === undefined) throw new Error('head missing')
    await safeSet(KEYS.head('s6'), { ...head.value, windowCount: 1 })
    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('corrupt')
  })

  it('verifies a log from another engine version and resumes it with a version notice', async () => {
    const session = playedSession('repo-version')
    await repo.startSession(meta('s7'), session)
    await repo.saveBetting(meta('s7'), session)
    // The same log claiming another version: this engine still plays it identically, so the
    // verification passes and the session resumes, stamped to the current version.
    const head = await safeGet<Record<string, unknown>>(KEYS.head('s7'))
    if (!head.ok || head.value === undefined) throw new Error('head missing')
    const header = head.value.header as Record<string, unknown>
    await safeSet(KEYS.head('s7'), {
      ...head.value,
      header: { ...header, engineVersion: ENGINE_VERSION + 1 },
    })
    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('active')
    if (loaded.kind !== 'active') return
    expect(loaded.notice).toStrictEqual({
      kind: 'engineVersion',
      from: ENGINE_VERSION + 1,
      to: ENGINE_VERSION,
    })
    expect(loaded.session.header.engineVersion).toBe(ENGINE_VERSION)
    expect(hashJson(loaded.session.state)).toBe(hashJson(session.state))
  })

  it('keeps the stored state and surfaces a divergence notice when the old log replays differently', async () => {
    const opened = placePass(testSession('repo-diverge'))
    const rolled = roll(opened, [1, 1])
    await repo.startSession(meta('s8'), rolled.session)
    const record = rolled.record
    // Another version's log whose recorded hash this engine cannot reproduce.
    await safeSet(KEYS.chunk('s8', 0), [{ ...record, hashAfter: '0123456789abcdef' }])
    const head = await safeGet<Record<string, unknown>>(KEYS.head('s8'))
    if (!head.ok || head.value === undefined) throw new Error('head missing')
    const header = head.value.header as Record<string, unknown>
    await safeSet(KEYS.head('s8'), {
      ...head.value,
      windowCount: 1,
      header: { ...header, engineVersion: ENGINE_VERSION + 1 },
    })

    const loaded = await repo.loadActive()
    expect(loaded.kind).toBe('active')
    if (loaded.kind !== 'active') return
    expect(loaded.notice?.kind).toBe('divergence')
    expect(loaded.meta.divergent).toBe(true)
    // The stored state is kept exactly; nothing was replayed over it.
    expect(hashJson(loaded.session.state)).toBe(hashJson(rolled.session.state))

    // A later load trusts the stored state and repeats the notice without replaying.
    const again = await repo.loadActive()
    expect(again.kind === 'active' && again.notice?.kind).toBe('divergence')
    expect(again.kind === 'active' && again.meta.divergent).toBe(true)
  })
})
