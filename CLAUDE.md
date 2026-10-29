# Bubble Craps Trainer

A browser app for practising electronic **bubble craps**, with a **live coach** and a **3D dice dome**. Crapless is the default variant and traditional is a configurable one. The user plays crapless bubble craps in Las Vegas and wants to learn real-machine play, so **rules and payouts must match real machines exactly**: a trainer that teaches wrong payouts is worse than none.

- Design and milestones: `docs/implementation-plan.md` (§0 amendments override the rest; §13 tracks status).
- Canonical rules: `docs/rules/rules-spec.md`, written from the verified research in `docs/rules/research/`.

## Commands
- `npm run verify` runs typecheck, lint, all tests, the build and the bundle check. A milestone is done only when this is green, plus its own acceptance checks.
- `npm test` runs the core, ui and physics Vitest projects. Use `npx vitest run --project core` (or `ui`, `physics`) for one project, and `npm run test:slow` for Monte Carlo and audit.
- `npm run e2e` runs Playwright against a `vite build --mode e2e` preview.
- `node scripts/<name>.ts` runs scripts with Node 24's native type stripping. Node is 24.13.1, so jsdom stays pinned at 29.1.1.

## Hard rules
- **Never commit, push, stash, reset or check out files with git.** The user has not asked for commits.
- **Layering:** engine → exact → coach → ui. `sim` uses engine and exact. `physics/core` uses only Rapier and itself. The shells are `ui`, `dome`, `persistence` and `workers`. Core code (`src/{engine,exact,coach,sim,physics/core}`) must not use DOM or Node APIs, `Math.random`, `Date`, `performance`, `crypto` or timers. It also must not import react, three, zustand, idb-keyval, ui, dome, persistence or workers. These rules are enforced by tsconfig, ESLint and `tests/architecture.test.ts`. Unit tests beside core modules (`*.test.ts`) run under Node and are type-checked by `tsconfig.test.json`, so they may use Node APIs, the clock, timers and `Math.floor/round/ceil`; they still may not import those libraries or shells, or use `Math.random`.
- **Money is integer cents** (branded `Cents`). Exact amounts are BigInt `Fraction`s, rounded once by an explicit `Rounding` from the machine config. `Math.floor/round/ceil` are allowed only in `engine/core/{money,rational}.ts`. Never use floats for money or percentages; format with `Fraction.formatPercent`.
- **Dice come only from engine RNG state.** It is seedable, so tests and replays are reproducible. Physics and animation use separately derived seeds and never decide outcomes. The 3D dome animates to dice the engine already chose.
- **Machine behaviour is data:** the zod-validated `MachineConfigInput`, with provenance for each JSON pointer (`verified` / `reported` / `assumed`). Never hard-code a payout, commission rule, odds cap or working default in rule code.
- **Coach numbers are computed, never typed in.** Every displayed number is a `CoachNumber` traced to `src/exact/`. The content lint rejects literal percentages, dollar amounts and ratios in `coach/content/**`.
- **Oracle independence:** `tests/oracle/**` is written from `docs/rules/rules-spec.md` with its own rule constants. It must never import from `src/engine/bets`, `src/engine/round` or `src/engine/settle`, and never copy their logic. Shared rule code cannot catch its own bugs.
- **State is JSON-safe:** `TableState` and the session log contain no bigint, Map, Set or class instances. `Fraction`s cross worker and IndexedDB boundaries through `toWire`/`fromWire`.
- **Syntax:** relative imports with a `.ts`/`.tsx` extension; `import type` for types; no enums, namespaces or parameter properties (`erasableSyntaxOnly`). Prettier: no semicolons, single quotes, 100-character width.

## Testing expectations
- Rule tables are written **test-first from the rules spec**, in the same milestone as each bet family.
- Every researched machine fact becomes a scenario test plus a provenance entry.
- Published exact values (`tests/golden/published.test.ts`) must match with exact rational equality, never `toBeCloseTo`.
- Randomized tests use pinned seeds, so failures are reproducible.

| Bug class | Caught by |
|---|---|
| Wrong rule in `decide` or `advanceRound` | rule tables, reference differential, closed form, published values |
| Rounding, commission or rearm errors | settlement tables, closed-form fuzzing, rounding sweeps, published values |
| Solver math or chain construction | closed form, dense-solve oracle, Monte Carlo |
| Reducer wiring | dispatch-chain oracle, invariants, scenarios, full-reducer Monte Carlo |
| Coach number or claim errors | `CoachNumber` types, content lint, audit harness, e2e hook equality |
| RNG bias or non-determinism | χ², known-answer test, replay/undo properties, fixtures |
| Physics or remap | 24×6 exhaustive check, random plans, e2e `data-dice` |
