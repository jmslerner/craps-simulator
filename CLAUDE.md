# Bubble Craps Trainer

A browser app for practising electronic **bubble craps**, with a **live coach** and a **3D dice dome**. Crapless is the default variant and traditional is a configurable one. The user plays crapless bubble craps in Las Vegas and wants to learn real-machine play, so **rules and payouts must match real machines exactly**: a trainer that teaches wrong payouts is worse than none.

- Design and milestones: `docs/implementation-plan.md` (§0 amendments override the rest; §13 tracks status).
- Canonical rules: `docs/rules/rules-spec.md`, written from the verified research in `docs/rules/research/`.

## Commands
- `npm run verify` runs `tsc -b`, `eslint .`, the Prettier check, `npm test`, the core coverage run (gated on `src/engine/**`: ≥90% lines, ≥85% branches), `vite build` and the bundle check. It runs neither `test:slow` nor `e2e`. A milestone is done only when verify is green, plus its own acceptance checks (UI milestones also need `npm run e2e`).
- `npm test` runs the core, ui and physics Vitest projects; use `npx vitest run --project core` (or `ui`, `physics`) for one. `npm run test:slow` runs `tests/slow/**`: the reference differential, the closed-form and dispatch-chain oracles, the exact, engine and session properties, and the M7 Monte Carlo (339 bets × 10⁵ decisions, 500 full-reducer sessions) — about two to three minutes on this machine (the coach audit joins in M9). It must stay under 5 minutes, and each slow suite keeps a quick subset of a few seconds in the core project.
- `node tests/replay/record.ts` re-records the replay fixture (see the ENGINE_VERSION policy).
- `npm run e2e` runs Playwright against a `vite build --mode e2e` preview.
- `node scripts/<name>.ts` runs scripts with Node 24's native type stripping. Node is 24.13.1, so jsdom stays pinned at 29.1.1.

## Hard rules
- **Never commit, push, stash, reset or check out files with git.** The user has not asked for commits.
- **Layering:** engine → exact → coach → ui, and `engine/core` imports only itself. `sim` uses engine and exact. `physics/core` uses only Rapier and itself. The shells are `ui`, `dome`, `persistence` and `workers`. Core code (`src/{engine,exact,coach,sim,physics/core}`) must not use DOM or Node APIs, `Math.random`, `Date`, `performance`, `crypto` or timers. It also must not import react, three, zustand, idb-keyval, ui, dome, persistence or workers. These rules are enforced by tsconfig, ESLint and `tests/architecture.test.ts`. Unit tests beside core modules (`*.test.ts`) run under Node and are type-checked by `tsconfig.test.json`, so they may use Node APIs, the clock, timers and `Math.floor/round/ceil`; they still may not import those libraries or shells, or use `Math.random`. In those tests and everywhere under `tests/`, use `Math` only by reading a member (never alias it, pass it around or destructure banned members), and use a host object (`globalThis`, `self`, `window`, `global`) only to read a member by name; shipped core code may not name those hosts at all. The tools do no scope analysis, so rename any local, parameter or destructured name that matches a host or a banned global.
- **Money is integer cents** (branded `Cents`). Exact amounts are BigInt `Fraction`s, rounded once by an explicit `Rounding` from the machine config. `Math.floor/round/ceil/trunc`, `.toFixed`, `.toPrecision` and `Fraction#toNumber` are banned in engine, exact and coach code except `engine/core/{money,rational}.ts`. Never use floats for money or percentages; format with `formatCents` and `Fraction.formatPercent`.
- **Dice come only from engine RNG state.** It is seedable, so tests and replays are reproducible. Physics and animation use separately derived seeds and never decide outcomes. The 3D dome animates to dice the engine already chose.
- **Machine behaviour is data:** the zod-validated `MachineConfigInput`, with provenance for each JSON pointer (`verified` / `reported` / `assumed`). Never hard-code a payout, commission rule, odds cap or working default in rule code. Read rounding through `payoutRoundingFor(type, number)` and limits through `typeLimits(cfg, typeId, number)` (or `legalBets`), never the type-level value alone: rounding (`payoutRoundingByNumber`) and stake units (`incrementByNumber`) can differ by number. Values the trainer does not model are listed in `MachineConfig.notModelled`, and the UI and coach must say so.
- **Coach numbers are computed, never typed in.** Every displayed number is a `CoachNumber` traced to `src/exact/`. The content lint rejects literal percentages, dollar amounts and ratios in `coach/content/**`.
- **Oracle independence:** the oracle modules (files in `tests/oracle/` other than its tests) are written from `docs/rules/rules-spec.md` with their own rule constants and never copy engine logic. They must not import, or reach at run time through other modules, `src/exact`, `src/engine/{bets,round,settle,table,session}`, the engine barrel or `src/engine/config/rulesets.ts` (not even with `import type`). From the rest of `src/engine/config` they take types only (`import type`), and from `src/engine/core` only `rational.ts` and `dice.ts`, never `money.ts`. The one exception is `tests/oracle/dispatchChain.ts`, which drives the real reducer but must not reach `src/exact`. Oracle tests (`tests/oracle/*.test.ts`) may import the engine and solver they compare against; helpers that drive the engine for tests live in `tests/properties/`. Shared rule code cannot catch its own bugs.
- **State is JSON-safe:** `TableState` and the session log contain no bigint, Map, Set or class instances. `Fraction`s cross worker and IndexedDB boundaries through `toWire`/`fromWire`.
- **Syntax:** relative imports with a `.ts`/`.tsx` extension; `import type` for types; no enums, namespaces or parameter properties (`erasableSyntaxOnly`). Prettier: no semicolons, single quotes, 100-character width.

## ENGINE_VERSION policy
- `ENGINE_VERSION` (`src/engine/version.ts`) is recorded by session logs, stored sessions and cached analysis; a log replays only on its own version.
- Bump it by 1, in the same change, whenever an edit could make the same config, seed and actions give a different result: the dice drawn; any decision, payout, rounding, commission or working status; whether an action is accepted, or its rejection's code or details; any `TableState` field or the state hash; any event, its fields or their order. Behaviour-preserving refactors do not bump it, and neither do preset or config edits (a log carries its own config and config hash).
- With each bump: run `node tests/replay/record.ts`; put the printed final hash, the ledger and the new version in `RECORDED` in `tests/replay/replay.test.ts`; update `src/engine/index.test.ts`; add a line to the history in `version.ts`. Re-record without a bump when a `craplessBubble` edit changes its config hash.
- A change in `src/exact` alone that changes any analysis result bumps `EXACT_VERSION` (`src/exact/price.ts`) instead; analysis caches are keyed by both.
- If the fixture test fails with `ReplayError` kind `hash`, the engine now plays the same actions differently: decide whether that was meant before re-recording; never re-record only to make it pass.
- `replay` refuses a log from another version (kind `engineVersion`); the shell keeps such a session's stored state and replays it with `{ anyEngineVersion: true }` only to check it.
- `TableState.v` and the session log's `version` change only with a stored-shape change that comes with a migration (M12).

## Testing expectations
- Rule tables are written **test-first from the rules spec**, in the same milestone as each bet family. They go in `tests/golden/rules/<family>.test.ts`, and settlement tables in `tests/golden/settlement/<family>.test.ts`.
- A scenario that rolls on a machine with a minimum total needs working bets that meet it; round-only scenarios use `withoutMinimum(id)` from the scenario DSL.
- Every researched machine fact becomes a scenario test plus a provenance entry.
- Published exact values must match with exact rational equality, never `toBeCloseTo`. They are checked in `tests/golden/published.test.ts` and, through both oracles, in `tests/oracle/published.diff.test.ts`.
- Randomized tests use pinned seeds (fast-check seed 20261028), so failures are reproducible. `Math.random` is banned in all of `tests/**`.
- UI tests (the `ui` Vitest project, jsdom) live beside their components as `*.test.tsx` and render through `renderApp()`/`testStores()` from `src/ui/test/renderApp.tsx`: isolated stores per test, `meta` kept null so component tests never touch IndexedDB; engine-driving helpers live in `src/ui/test/game.ts`. Assert money through `formatCents` strings; never build a dollar string by arithmetic in a component or a test.
- e2e specs drive the app only through `window.__CRAPS_TEST__` (`src/ui/services/testHooks.ts`), which exists only in `--mode e2e` builds, and wait by polling `storedHead()`/state, never by sleeping. The production bundle must contain no `__CRAPS_TEST__`: `scripts/check-bundle.ts` enforces it (`testHookOffences`, unit-tested in `tests/bundle/checkBundle.test.ts`); its `TEST_HOOK_MARKERS` and `e2eMachine`'s provenance note must change together. The e2e machine pins pass `afterWin` to `return` [A], so e2e dollar expectations differ from production presets ($631 vs $621).

| Bug class | Caught by |
|---|---|
| Wrong rule in `decide` or `advanceRound` | rule tables, reference differential, closed form, published values |
| Rounding, commission or rearm errors | settlement tables, closed-form fuzzing, rounding sweeps, published values |
| Solver math or chain construction | closed form, dense-solve oracle, Monte Carlo |
| Reducer wiring | dispatch-chain oracle, invariants, scenarios, full-reducer Monte Carlo |
| Session window, undo, macros or replay | window, macro and replay properties; the pinned crapless-200 fixture |
| Coach number or claim errors | `CoachNumber` types, content lint, audit harness, e2e hook equality |
| RNG bias or non-determinism | χ², known-answer test, replay/undo properties, fixtures |
| Physics or remap | 24×6 exhaustive check, random plans, e2e `data-dice` |
