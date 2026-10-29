/**
 * The version of the engine's rules and state shape. Saved sessions, replay headers and cached
 * analysis record it: a session saved under another version is replayed to verify it, and cached
 * analysis is keyed by it (plan §4.9, §8). Bump it whenever a change could make the same actions on
 * the same config produce a different state, payout or event.
 */
export const ENGINE_VERSION = 1
