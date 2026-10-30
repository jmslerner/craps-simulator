import type { SessionNotice } from '../../persistence/sessionRepo.ts'
import { useGameState, useStores } from './context.tsx'

/**
 * The session-resume notice (plan §8): what `sessionRepo.loadActive` surfaced about the stored
 * session — recorded by an older engine version, or no longer reproducing from its log. The store
 * holds it as data (`state.notice`); this banner is the one place it is shown. It renders as
 * `role="alert"` (an assertive aria-live region, announced when the resume mounts it), stays until
 * the player dismisses it through the store's `dismissNotice`, and never shows a number: the
 * wording states only what happened and what was kept.
 */

export function noticeText(notice: SessionNotice): string {
  switch (notice.kind) {
    case 'engineVersion':
      // The repo re-played the log under this engine and got the same state (sessionRepo.ts),
      // so the session is kept exactly as it was.
      return (
        'This session was recorded by an older version of the game engine. ' +
        'It was checked and is kept exactly as it was.'
      )
    case 'divergence':
      return (
        'This session is kept as it was stored, but it no longer reproduces from its roll log, ' +
        'so treat its history with care.'
      )
  }
}

export function NoticeBanner() {
  const stores = useStores()
  const notice = useGameState((state) => state.notice)
  if (notice === null) return null
  return (
    <div className="session-notice" role="alert" data-testid="session-notice">
      <p>{noticeText(notice)}</p>
      <button type="button" onClick={() => stores.game.getState().dismissNotice()}>
        Dismiss
      </button>
    </div>
  )
}
