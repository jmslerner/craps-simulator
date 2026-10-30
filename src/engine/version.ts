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
 * - 3: the side bets (M11): the table accepts Lucky Roller, Fire, Hot Shooter Jackpot and Lucky
 *   Shooter bets, settles them (`betProgress` events, side-bet `betResolved` traces, a `zeroNet`
 *   push for the Hot Shooter's 1-for-1 tier and a `bar` push for the Lucky Shooter's come-out 7 or
 *   11), and refuses them with `WINDOW_CLOSED`, `WRONG_PHASE`, `CONTRACT_BET` and the qualifier's
 *   `BELOW_MIN_TOTAL` where it did with `NOT_OFFERED` before. `TableState` keeps its shape;
 *   `BetInstance.progress` is now set for side bets.
 * - 4: the M11 side-bet audit fixes. The Hot Shooter counts the hand's rolls (rules spec §2.6): its
 *   `progress` is `hand.rolls`, so a bet placed on a later come-out (`anyComeOut`) carries the
 *   hand's earlier rolls, and definition C leaves out the hand's first come-out rather than the
 *   bet's first roll (under C the first roll now emits `betProgress` too). A roll refused for the
 *   round's minimum with side bets up carries their stakes (`BELOW_MIN_TOTAL.sideBets`). Presets
 *   moved too (config edits: the Fire Bet's $5 and the Lucky Shooter's $100 maximums), and Take
 *   down all takes down side bets that can still come down.
 */
export const ENGINE_VERSION = 4
