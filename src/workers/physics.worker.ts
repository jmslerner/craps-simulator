import { handlePhysicsRequest } from './physicsHandler.ts'
import type { PhysicsRequest } from './physicsProtocol.ts'

/**
 * The physics worker's entry (plan §7: headless Rapier pre-simulates each throw off the main
 * thread). A thin shell over `handlePhysicsRequest`; Vite bundles it, Rapier included, as its own
 * chunk via `new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' })` in
 * `src/dome/physicsClient.ts`, so no Rapier lands in the initial bundle. The recording's buffers
 * go back in the transfer list, so the main thread gets them without a copy.
 */

self.addEventListener('message', (event) => {
  const request = (event as MessageEvent<PhysicsRequest>).data
  void handlePhysicsRequest(request).then(({ response, transfer }) => {
    postMessage(response, [...transfer])
  })
})
