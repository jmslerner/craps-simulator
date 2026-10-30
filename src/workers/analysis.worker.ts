import { handleAnalysisRequest } from './analysisHandler.ts'
import type { AnalysisRequest } from './analysisProtocol.ts'

/**
 * The analysis worker's entry (plan §5.5: the solver runs off the main thread, so no long task
 * blocks the table). It is a thin shell over `handleAnalysisRequest`; Vite bundles it as its own
 * chunk via `new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })` in
 * `analysisClient.ts`, so none of the exact solver lands in the initial bundle.
 */

self.addEventListener('message', (event) => {
  const request = (event as MessageEvent<AnalysisRequest>).data
  void handleAnalysisRequest(request).then((response) => {
    postMessage(response)
  })
})
