/**
 * The version of the engine's rules and state shape. Saved sessions, replay headers and cached
 * analysis record it: a session saved under another version is replayed to verify it, and cached
 * analysis is keyed by it (plan §4.9, §8). Bump it whenever a change could make the same actions on
 * the same config produce a different state, payout or event, and re-record the replay fixture in
 * the same change (CLAUDE.md, the ENGINE_VERSION policy).
 *
 * - 1: the M4 engine (integrated 2026-10-29).
 * - 2: the M4 audit fixes and the M6 reconciliation: re-collection judged after the whole roll,
 *   Interblock's post-seven-out hold in `TableState.heldOff`, rolls refused inside batches, ledger
 *   limits, and exclusions that block additions too.
 */
export const ENGINE_VERSION = 2
