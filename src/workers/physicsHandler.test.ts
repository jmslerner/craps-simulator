import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import { buildPlaybackPlan, faceShown, synthesizeRest } from '../physics/core/plan.ts'
import { hashRest, visualTopFace, type RestState } from '../physics/core/restPose.ts'
import { handlePhysicsRequest } from './physicsHandler.ts'
import type { ThrowRequest } from './physicsProtocol.ts'

/**
 * The physics worker's handler under Node: a throw request yields a recording that the main thread
 * can plan from the rest it reports, failures are responses rather than throws, and the buffers
 * for the transfer list are the recording's own.
 */

const REST: RestState = synthesizeRest(0x1234, [3, 5])

function throwRequest(id: number, seed: number, rest: RestState = REST): ThrowRequest {
  return { id, kind: 'throw', seed, rest }
}

describe('handlePhysicsRequest', () => {
  it('answers a ping once Rapier is loaded, with the params fingerprint', async () => {
    const { response, transfer } = await handlePhysicsRequest({ id: 1, kind: 'ping' })
    expect(response).toStrictEqual({
      id: 1,
      ok: true,
      kind: 'ready',
      paramsFingerprint: paramsFingerprint(DEFAULT_PARAMS),
    })
    expect(transfer).toStrictEqual([])
  })

  it('simulates a throw from the requested rest and lists its buffers for transfer', async () => {
    const { response, transfer } = await handlePhysicsRequest(throwRequest(2, 0x5eed))
    expect(response.ok).toBe(true)
    if (!response.ok || response.kind !== 'throw') throw new Error('expected a throw response')
    expect(response.seed).toBe(0x5eed)
    expect(response.startedFromRequest).toBe(true)
    expect(response.rest).toStrictEqual(REST)
    expect(response.attempts).toBeGreaterThanOrEqual(1)
    expect(['pop', 'drop', 'hop']).toContain(response.source)
    // The recording was thrown from exactly the rest it reports, so a plan can be built from it.
    expect(response.recording.restHash).toBe(hashRest(response.rest))
    expect(response.recording.paramsFingerprint).toBe(paramsFingerprint(DEFAULT_PARAMS))
    expect(transfer).toStrictEqual([
      response.recording.frames.buffer,
      response.recording.contacts.buffer,
    ])
  }, 30_000)

  it('yields a recording the dome plans into the engine’s dice', async () => {
    const { response } = await handlePhysicsRequest(throwRequest(3, 0xabc))
    if (!response.ok || response.kind !== 'throw') throw new Error('expected a throw response')
    const plan = buildPlaybackPlan(response.recording, { d1: 6, d2: 2 }, response.rest, 'snap')
    const last = plan.recording.frameCount - 1
    const shown = [faceShown(plan, 0, last), faceShown(plan, 1, last)].sort()
    expect(shown).toStrictEqual([2, 6])
    // And the rest it leaves shows the same faces, for the next throw to start from.
    const next = plan.rest.map(({ pose, offset }) => visualTopFace(pose.q, offset)).sort()
    expect(next).toStrictEqual([2, 6])
  }, 30_000)

  it('is deterministic: the same seed and rest give the same recording', async () => {
    const a = await handlePhysicsRequest(throwRequest(4, 77))
    const b = await handlePhysicsRequest(throwRequest(5, 77))
    if (!a.response.ok || a.response.kind !== 'throw') throw new Error('expected a throw')
    if (!b.response.ok || b.response.kind !== 'throw') throw new Error('expected a throw')
    expect(Array.from(b.response.recording.frames)).toStrictEqual(
      Array.from(a.response.recording.frames),
    )
    expect(b.response.recording.settleFrame).toBe(a.response.recording.settleFrame)
  }, 30_000)

  it('starts from fresh poses when the requested rest cannot start a throw', async () => {
    // Both dice at the same spot: sunk into each other, which checkStart rejects.
    const sunk: RestState = [REST[0], { ...REST[1], pose: REST[0].pose }]
    const { response } = await handlePhysicsRequest(throwRequest(6, 9, sunk))
    if (!response.ok || response.kind !== 'throw') throw new Error('expected a throw response')
    expect(response.startedFromRequest).toBe(false)
    expect(response.rest).not.toStrictEqual(sunk)
    expect(response.recording.restHash).toBe(hashRest(response.rest))
    // The fresh rest shows the faces the sunk one showed.
    const faces = (rest: RestState) =>
      rest.map(({ pose, offset }) => visualTopFace(pose.q, offset)).sort()
    expect(faces(response.rest)).toStrictEqual(faces(sunk))
  }, 30_000)

  it('refuses junk as a failure response, never a throw', async () => {
    const seed = await handlePhysicsRequest(throwRequest(7, -1))
    expect(seed.response).toMatchObject({ id: 7, ok: false })
    const shape = await handlePhysicsRequest({
      id: 8,
      kind: 'throw',
      seed: 1,
      rest: [{ pose: { p: [0, 0], q: [0, 0, 0, 1] }, offset: 0 }, REST[1]] as unknown as RestState,
    })
    expect(shape.response).toMatchObject({ id: 8, ok: false })
    expect((shape.response as { error: string }).error).toContain('position')
    const offset = await handlePhysicsRequest({
      id: 9,
      kind: 'throw',
      seed: 1,
      rest: [{ ...REST[0], offset: 24 }, REST[1]],
    })
    expect(offset.response).toMatchObject({ id: 9, ok: false })
  })
})
