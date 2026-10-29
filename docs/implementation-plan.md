# Bubble Craps Trainer: final implementation plan

All paths are relative to `/Users/jameslerner/bubble craps simulator/craps-simulator/`. I re-checked every version, peer range and API claim below on 2026-10-28, using `npm view`, the unpkg file listings and the official docs.

## 0. Integrator amendments (these override anything below)

1. **No git commits or pushes.** The user has not asked for any. M0's "Step 0: baseline commit" is skipped. Leave the tree uncommitted, and never run `git commit`, `git push`, `git stash`, `git reset` or `git checkout -- <file>`.
2. **Research lands in `docs/rules/research/`.** That is where the verified research on core bets, machines, side bets and strategies goes (`core.md`, `machines.md`, `sidebets.md`, `strategies.md`, `spec.md`). M2's `rules-spec.md` and the preset provenance are written from those files. Where research contradicts §4.4's assumed values, the research wins, recorded with its provenance status.
3. **Milestone status is tracked in §13** at the end of this file. Only the integrator edits §13. Implementation agents report status in their final message instead.
4. **Parallel agents share one working tree.** While other agents may be active, scope your checks to your own tsconfig, Vitest project and files. Run the full `npm run verify` only when you are the sole agent, or when told to.
5. **Playwright browsers:** install Chromium (plus WebKit for the iphone15 project) with `npx playwright install chromium webkit`. If WebKit cannot be installed, skip that project and report it rather than failing the milestone.

### Research-driven amendments (research completed 2026-10-28; see `docs/rules/research/`)

6. **The rules source is `docs/rules/research/spec.md`.** It is the verified, synthesized rules spec, with each fact tagged V verified / R reported / A assumed / M math / U unresolved, and source keys. The per-topic research is in `core.md`, `machines.md`, `sidebets.md` and `strategies.md`, and the verifier issue lists are in `verification.json`.
   - M2 writes the canonical `docs/rules/rules-spec.md` from it, adopting it largely as-is but organized for implementers and oracle authors.
   - Preset values and their provenance come from its §5.2 table.
   - Its §0.2 conflict resolutions are binding.
7. **Schema additions.** Implement every knob marked "+" in research §5.1:
   - per-type `payoutRounding`; per-number commission overrides
   - `limits.minTotal{amount, scope, countOff, countSideBets}`
   - `odds.take` multipliers per point; `odds.lay{multiplier, basis: stake|win}` per parent type
   - `comeOut.autoOff{carried[], newlyPlaced[], reOnAt}`, `afterSevenOut.newPlacedOff{types[], until}`, `layAutoOn`, `oddsOffReturnedAtPointMade`
   - `offBets.consumeCredit`
   - `dontPassAfterPoint`, `dontComeAfterTravel`, `noRebetAfterRemove`
   - `exclusiveGroups` with scope; `excludeLineVsLayBuy`
   - `afterWin` values `stayIfFirstRoll` and `stayIf11`
   - side-bet blocks
   - flow knobs: shooter mode, `invalidRoll` (cosmetic), `puckReset`, `groupButtons`, `historyLength`
8. **There are four presets**, per research §5.2. All values are tagged with provenance.

   | Preset | Machine |
   |---|---|
   | `craplessBubble` (**default**) | Interblock heads-up crapless |
   | `traditionalBubble` | Shoot To Win community dome |
   | `strictBubble` | Interblock GV6.5 traditional, 2× odds, upfront vig |
   | `traditionalLive345` | live reference table |

9. **Come-bet merge is unreachable** (research §0.2 #12). The existing Come on N wins on the same roll that the box Come travels to N. Remove the merge rule from §4.5 and treat any merge as an invariant violation.
10. **Rounding.** Per-type rounding includes STW place 6/8 `{ceil, 1}` [R]. `exact/sanity.ts` must reject any config that creates a player-positive bet, such as ceil or half-up rounding on wrong-way payouts (research §4.2), or "for 1" read as "to 1".
11. **Side bets (M11), in priority order:**
    1. **Lucky Roller** (All Small / All Tall / All; `collectSet`). Offered on IB and STW; the default crapless preset has it at 30/30/155 to 1 [R].
    2. **Hot Shooter Jackpot** (STW). Needs a new `handLength` family: tiers by roll count, using definition A.
    3. **Lucky Shooter** (IB traditional; the `pointRun` family, now confirmed by research §6.3, paytable D).
    4. **Fire Bet** (live reference; `uniquePointsMade` with `countedPoints`).

    Power Odds stays disabled by default, because its trigger rates are unknown.
12. **UI fidelity for the default (IB heads-up crapless), M8:**
    - The game is self-paced (no timer), and the player is always the shooter.
    - The "Set bets On/Off" toggle covers Place, Buy, Odds and Hard.
    - Place and buy bets **work on the come-out**, except those placed after a seven-out, which stay OFF until "Set bets On".
    - OFF bets still use credit.
    - A minimum-total check runs on roll: "BETS ARE NOT VALID YET! – Must bet N credits more!".
    - Group buttons: Press and Across. Macros: Repeat Last Bet and Double.
13. **Coach content (M9) comes from research §8:** the ranking, the crapless guidance, the hourly-loss table and the misconceptions. Every displayed number is still computed through `exact/`; research numbers serve only as test expectations.
14. **Hand definition:** "shooter" means hand everywhere (research §0.1). Side bets key on hand counters, never on STW's cosmetic shooter button.

### M4 amendments (decided 2026-10-28, before M4)

15. **Composites settle as one bet** (resolves rules spec §9 #25 and #27; supersedes §4.5's "expand to component bets").
    - A composite (C&E, horn, world, horn high X) is one `BetInstance` whose `typeId` is the composite id, shown and removed as one spot, as on IB and STW.
    - Its net per unit for each outcome is derived from its parts' catalog pays: Σ(units of the parts that win × (pay + 1)) ÷ total units − 1. Example: horn on a 2 nets 27/4 per unit, so $100 on 6-6 nets +$675 (IB's formula). It settles once, with one rounding, like any one-roll bet.
    - Limits, increments and minimums apply to the composite's total stake.
    - Config validation rejects a composite whose derived net on some outcome lies strictly between −1 and 0; partial losses are not modelled.
    - A world bet on a 7 nets 0 and is a push.
16. **Test layout for the bet families.** Rule tables go in `tests/golden/rules/<family>.test.ts` and settlement tables in `tests/golden/settlement/<family>.test.ts`, one file per family, so families built in parallel never edit the same test file. This supersedes the single `golden/{rules.tables,settlement}.test.ts`.
17. **Reference oracle scope (M4d).**
    - `tests/oracle/referenceRules.ts` decides and settles any single bet.
    - `tests/oracle/referenceTable.ts` is a naive whole-table model covering places, takedowns, working toggles and rolls.
    - Both are written from the rules spec alone, with their own rule constants and their own BigInt rounding. They read machine data (pays, commission, rounding, working policy) from the plain `MachineConfigInput` JSON through `tests/oracle/machineFacts.ts`. They never use the compiled config, which carries the engine's rulesets.
    - The differential runs seeded random action sequences through both the engine and the reference table, and compares bankroll, house net and the bets on the table after every action. Every mismatch is settled against the rules spec: fix the engine when the engine is wrong, and the oracle only when it misreads the spec. Report each case.

### Player-requested features (2026-10-28; working versions are in the playable demo)

18. **Next-step guide.** Every new game opens with a "Next step" bar on the layout.
    - It names the one action to take now and shows the basic round as a stepper: bet the line, come-out roll, add odds, roll for the point.
    - It lights up the spot or control to tap and offers a one-tap shortcut.
    - It adds at most one optional idea the player can dismiss, such as the cheapest extra bet, keeping number bets off for the come-out, or adding credit.
    - It is a pure `coach/nextStep.ts` over `TableState`, `MachineConfig` and `legalBets`, so it never suggests a bet the table would reject. Every number in it is a `CoachNumber`.
    - M8 builds the bar and the highlight, and M9 writes the content.
    - The player can hide it. The New game dialog decides whether it opens.
    - Tests: a table of states → steps, a property that every suggested action passes `validateAction`, and e2e checking that a new game shows step 1 pointing at the pass line.
    - Lessons from reviewing the demo's version, which M9 must keep:
      - Any step that says to roll states what a 7 would do to every bet on the table (wins, losses, bets returned and the net), computed by the engine. "A 7 wins your Pass Line" must never stand alone when the 7 also takes Come or working place bets.
      - Amounts it offers come from `legalBets().maxAdd`, so per-bet maximums apply (2× odds on a $300 line is capped at $500).
      - It knows the UI's mode. In take-down mode it first sends the player back to betting, and its shortcuts leave that mode.
      - It never claims a bet "still plays" when the bet is OFF for the roll, and offers a chip shortcut only for a chip that fits the credit.
      - Nothing that changes bets runs while a roll is settling.
      - Its buttons keep their place, so keyboard focus survives a render. Each action is announced together with the next step.
19. **Bankroll: starting amount and adding credit.**
    - New game takes a chosen starting bankroll, and settings remember it.
    - "Add credit" tops up at any time, like feeding bills into the machine.
    - Deposits go through the engine's `deposit` action and are logged for replay (M5).
    - Results, luck and the session summary (M13) are measured against total deposits, so a top-up never shows as a win.
20. **Roll history.** Every roll is listed newest first and grouped by hand, with per-hand totals. Each entry shows:
    - the dice, the total and the round event;
    - every bet the roll decided (won, lost, moved, returned or off), with amounts;
    - the roll's net and the credit after it.

    The data comes from the session log and events (`DiceRolled`, `BetResolved` with its `SettlementTrace`), which M5 provides. M8 shows the list under the dome, and the newest entry shows its payout arithmetic.

### Decisions after M4 (2026-10-29)

21. **Interblock "Set bets On" is `setGlobalWorking(null)`** (resolves M4 open item 1; IB §3.2 doesn't say).
    - It returns every covered bet to its machine default and clears the post-seven-out OFF.
    - It never forces Come odds to work on the come-out, because their Interblock default there is OFF [A].
    - Rules spec §2.4 and §9 record this as [A], a crapless scenario pins it, and the coach marks it assumed.
    - If the player's own machine behaves otherwise, change the mapping and the scenario together.
22. **"Amount risked" follows rules spec §0.1:** the stake per decision plus commission paid up front. Commission deducted from a win is not added. So a buy 4 with 5% of the stake taken from the win has an edge of 1/60 (the published value), not 1/61. `glossary.md` and §5.1 follow this.
23. **Shoot To Win OFF chips still use credit in the trainer.** `/offBets/consumeCredit: false` is not modelled, because no source says what happens when an OFF chip turns ON without credit to back it.
    - The compiled config lists every value it does not model.
    - The coach shows an "approximation" note on that preset.
    - The default Interblock machine is unaffected: its OFF bets use credit [V].
24. **The exact analysis assumes enough credit.** It prices bets and layouts as if every charge can be paid. Outcomes that depend on credit, such as a declined vig re-collection or a minimum-total refusal, belong to the reducer and the session, not to edges.

## 1. Approach summary

**Base: Plan A.** Both judges recommended it. Plan A has three properties worth building on:
- One rule implementation, checked by oracles that share none of its code.
- Machine settings as data, with provenance recorded per field.
- Exact rational analysis computed from the active config.

**Ideas grafted from B (coach-first):**
- `CoachNumber`-only templates, plus a content lint and an audit harness.
- A pure anti-nag gate.
- Post-roll recaps that include "no action" lines.
- Cheaper-alternative suggestions that are proven to win and lose on the same events, applied with one tap.
- Clear metric definitions: edge per decision, edge per working roll, standing cost.
- Persist before animating; undo limited to the betting window.
- Separate seed streams for dice and physics.
- A scenario DSL and an implausible-edge detector.
- A chain built by driving the full reducer, used as a test oracle.

**Ideas grafted from C (fidelity and 3D-first):**
- A machine-faithful station generated from config: a BUY strip and a PLACE cell per number, and a 2×5 number grid on phones.
- Betting macros written as pure functions.
- A headless physics spike before any UI work.
- Throws simulated without knowing the outcome and prefetched while the user bets.
- A face remap that first snaps, then later blends smoothly (handoff).
- Bundle size budgets, the PWA precache-limit fix, and Rapier det-compat 0.19.3.

**Fixes that no plan had:**
- An explicit rule for re-collecting upfront vig when a winning bet stays up (`rearm`). This setting alone moves Buy 5/9 between 4.76% and 2.91%, which flips the place-vs-buy advice.
- Side-bet `countedPoints` and pay tables are required data. A crapless Fire bet with the 24/249/999 table has a 13.4152% edge if all 10 points count, and 70.4488% if only 4–10 count.
- Odds and buy pay tables are configurable, not hard-coded to true odds.

**The repo is not empty.** It contains an untracked, never-committed scaffold:
- Toolchain: TS 5.9.3, ESLint 10.13 with typescript-eslint 8.72.1, Prettier, Vite 8.3.5, Vitest 5.0.5, jsdom 29.1.1, React 19.3.1, zustand 5.0.16, fast-check.
- About 745 lines of tested primitives in `src/engine/`: `Fraction`, money/rounding/commission, xoshiro128**, dice, and closed-form pass-line math (373/6930 and 9613/2310 are already asserted).
- M0 keeps and adopts all of this; it does not regenerate it.

**Layers.** Imports only point in one direction:
- `engine` → `exact` → `coach` → `ui`.
- `sim` uses `engine` and `exact`. `physics/core` uses only Rapier.
- Shells: `ui`, `dome`, `persistence`, `workers`.
- Core code runs unchanged in the browser, in workers, in Vitest, and under `node scripts/*.ts`. Node 24.13.1 strips TypeScript types natively.

**Correctness.** The reducer, the exact solver and Monte Carlo all call the same pure functions: `advanceRound`, `family.decide`/`family.apply`, and `settle`. Independent checks come from oracles that share no rule code:
- compact hand-written tables, taken from `docs/rules/rules-spec.md`
- a naive reference implementation, compared using fast-check
- closed-form math, grown from the existing `probability.ts`
- a chain driven through the full reducer, which catches wiring bugs exactly
- published exact fractions

**Money and dice.**
- Money is branded integer cents. Payouts are computed as exact fractions, then rounded by an explicit rule from the config. Every settlement carries a trace.
- Dice come only from xoshiro128** state stored in `TableState`.
- The dome plays a pre-simulated throw whose seed is derived separately, then remaps die faces so the engine's dice land face up.

**Coach.** Every number shown is a `CoachNumber`. It is priced at the user's actual bet amount from cached outcome distributions that don't depend on the amount. A pure gate decides what gets shown.

**Scope.**
- v1: the practice table, the live coach and the 3D dome. Crapless is the default; traditional is a variant.
- Deferred but already possible with this design: Strategy Lab (`sim/` and `exact/` are headless), drills (`SettlementTrace`, `catalogTable`), shadow mode (`roll {dice}`).
- Not in v1: fairness panel and roll logger, lessons and mastery tracking, z-score calibration, Teacher mode, audio, camera rig, re-pop, slow-motion replay, physics-lab UI, screenshot baselines.

## 2. Stack & versions

| Area | Package | Pin | Verified evidence / note |
|---|---|---|---|
| Runtime | node / npm | 24.13.1 / 11.8.0 | `process.features.typescript === 'strip'`. Set `engines.node: "^24.13.0 \|\| >=26"` (Vitest 5 needs `^22.12 \|\| ^24 \|\| >=26`) and add `.nvmrc`. |
| Language | typescript | **5.9.3 (kept)** | Latest is 7.0.2, but typescript-eslint 8.72.1 peers `typescript >=4.8.4 <6.1.0`. `erasableSyntaxOnly` exists in 5.9. |
| Lint/format | eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals, prettier | 10.13.0, 10.0.1, 8.72.1, 7.1.1, 17.13.0, 3.9.10 (kept) | typescript-eslint peers `eslint ^10`. |
| Build | vite, @vitejs/plugin-react | 8.3.5, 6.1.2 (kept) | The plugin peers `vite ^8`. `worker.format` defaults to `'iife'`, so set `'es'`. Use `worker.rolldownOptions`, because `rollupOptions` is deprecated. |
| UI | react, react-dom / @types | 19.3.1 exact / 19.3.0 | R3F 9.8.2 peers `react >=19 <19.4`. Never float this pin. |
| State | zustand | 5.0.16 (kept) | |
| Validation | zod | 4.6.7 (**add as direct dependency**) | Today it is only transitive, through eslint-plugin-react-hooks. |
| Storage | idb-keyval | 6.3.0 | Its README says `setMany` is atomic. |
| 3D | three, @types/three, @react-three/fiber | 0.186.1, 0.186.0, 9.8.2 | Fiber peers `three >=0.156`. three exports `./addons/*`, and `RoundedBoxGeometry.js` and `RoomEnvironment.js` are present. Canvas supports `frameloop` (always/demand/never), `dpr`, `fallback`, and an async `gl`. |
| Physics | @dimforge/rapier3d-deterministic-compat | **0.19.3 exact** | `rapier.mjs` is 2,280,507 B with WASM inlined; 0.21.0 is 4,372,012 B. Verified API: `World.timestep`, `lengthUnit`, `numSolverIterations`, `step(eventQueue?)`, `free()`; `ColliderDesc.roundCuboid(hx,hy,hz,r)`, `trimesh(v,i,flags?)`, `convexHull`; `RigidBodyDesc.setCcdEnabled`; `RigidBody.isSleeping/applyImpulse/applyTorqueImpulse`. |
| Tests | vitest, @vitest/coverage-v8 | 5.0.5 (kept), 5.0.5 | In v5, inline `test.projects` inherit the root config by default. |
| | jsdom | **29.1.1 (kept)** | 30.1.3 requires Node `^24.15.0`. |
| | fast-check; @testing-library/react, /dom, /user-event; @testing-library/jest-dom; fake-indexeddb | 4.10.2; 16.3.3/10.4.2/14.6.8 (kept); 7.0.1; 6.2.6 | jest-dom exports `./vitest`. |
| | @playwright/test, @axe-core/playwright | 1.64.1, 4.14.0 | Chromium dropped its automatic SwiftShader fallback, so the 3D project needs `--enable-unsafe-swiftshader`. |
| PWA (M14) | vite-plugin-pwa (workbox 7.4.1) | 2.0.0 | Peers `vite ^8`. Workbox's default precache limit is 2 MiB, and the plugin errors on oversized entries since 0.20.2. Both Rapier builds exceed 2 MiB, so set `maximumFileSizeToCacheInBytes: 6 * 1024 * 1024`. |
| Types | @types/node | 24.19.2 (kept) | Matches the runtime. The latest, 26.x, would be wrong here. |

**Rejected:**
- Migrating to TS 7 + oxlint (see the decision log).
- `@react-three/drei` 10.7.9: 21 runtime dependencies, including hls.js and @mediapipe/tasks-vision, for three helpers we can take from `three/addons`.
- `@react-three/rapier` 2.2.0: it pins rapier3d-compat 0.19.2 and is built for live simulation.
- Also: Dexie, Tailwind, immer, a router, comlink, cannon-es.

**tsconfig.** Keep the existing flags: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions` + `noEmit`, and bundler resolution. Add or change:
- `tsconfig.core.json`: covers `src/{engine,exact,coach,sim,physics/core}` with `lib ["ES2023"]` and `types []`, so any DOM or Node use is a compile error.
- `tsconfig.worker.json`: covers `src/workers/**` with `lib ["ES2023","WebWorker"]`.
- `tsconfig.test.json`: covers `tests/**` with `types ["node"]`.
- `tsconfig.app.json`: narrow it to `src/{ui,dome,persistence}` plus `src/main.tsx`.
- `tsconfig.node.json`: add `scripts/**`, `e2e/**` and the configs.

## 3. Directory layout

```
CLAUDE.md  package.json  index.html  vite.config.ts  vitest.config.ts  playwright.config.ts  eslint.config.js
tsconfig.{json,core,app,worker,test,node}.json   .nvmrc   .gitignore (+dist-e2e)
docs/rules/  rules-spec.md (canonical rules + sources) glossary.md (§5.1 metrics) machines/<machine>.md (research landing)
docs/manual-checks.md
scripts/     edges.ts  sim.ts  physics-stats.ts  check-bundle.ts
src/
  main.tsx
  engine/  index.ts version.ts (ENGINE_VERSION)
    core/     rational.ts (existing Fraction) money.ts rng.ts (pure) dice.ts hash.ts      <- moved from src/engine/*.ts
    config/   schema.ts compile.ts rulesets.ts ratio.ts provenance.ts presets/{craplessBubble,traditionalBubble,traditionalLive345,index}.ts
    round/    round.ts
    bets/     types.ts registry.ts working.ts limits.ts validate.ts legal.ts composites.ts
              families/{line,odds,numberVsSeven,hardway,oneRoll,uniquePointsMade,collectSet,pointRun}.ts
    settle/   settle.ts commission.ts trace.ts
    table/    state.ts actions.ts events.ts reducer.ts roll.ts ledger.ts invariants.ts
    session/  window.ts macros.ts replay.ts serialize.ts
  exact/     chain.ts solve.ts price.ts analyze.ts equity.ts standing.ts events.ts catalog.ts alternatives.ts derive.ts sanity.ts wire.ts
  coach/     types.ts numbers.ts policy.ts gate.ts recap.ts run.ts content/templates.ts
             advisors/{edgeWarning,sameEvent,restructure,odds,amountEfficiency,variantContext,working,layoutCost,teachable,sideBetProgress}.ts
  sim/       runner.ts strategies.ts
  physics/core/ params world popper simulate settle validity recording prng quat cube remap handoff plan restPose hash (.ts)
  workers/   analysis.worker.ts physics.worker.ts rpc.ts
  persistence/ storage.ts sessionRepo.ts settings.ts exportImport.ts migrations.ts
  dome/      (lazy chunk) DomeView.tsx Scene.tsx DomeShell.tsx Dice.tsx pipTextures.ts BlobShadows.tsx quality.ts playback.ts
  ui/        App.tsx testHooks.ts
             store/{gameStore,settingsStore,machineStore,coachStore,analysisStore,selectors}.ts
             services/{seed,analysisClient,physicsClient,rollFlow}.ts
             dice/{DiceView.ts,InstantDice.ts,Dice2D.tsx}
             layout/{layoutSpec.ts,TableLayout,NumberColumn,LineBar,FieldBar,PropsPanel,SideBetsPanel,PointPuck,ChipStack}.tsx
             controls/{ChipRack,ActionBar,Meters,RollHistory}.tsx  inspector/BetInspector.tsx
             coach/{CoachStrip,CoachPanel,Toasts,Recap,ShowMath,LayoutMeter,CheatSheet,SessionSummary}.tsx
             machine/{PresetPicker,MachineEditor,MatchMyMachine}.tsx  styles/{tokens.css,*.module.css}
tests/  oracle/{closedForm.ts (from probability.ts + variant.ts, own rule constants), referenceRules.ts, dispatchChain.ts, denseSolve.ts}
        golden/{rules.tables,settlement,published}.test.ts   scenarios/{dsl.ts,*.test.ts}   properties/*.prop.test.ts
        replay/{fixtures/*.json,replay.test.ts}   slow/{mc,audit}.slow.test.ts   architecture.test.ts  content-lint.test.ts
e2e/    smoke table coach persistence layout dome a11y offline (.spec.ts)  support/hooks.ts
```

Unit tests sit next to their modules as `*.test.ts(x)`. Formatting follows the existing Prettier config: no semicolons, single quotes, 100-character width.

## 4. Engine design

### 4.1 Hard rules
These are enforced three ways: `tsconfig.core.json`, per-directory ESLint rules (`no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`, plus typed `switch-exhaustiveness-check` and `no-floating-promises`), and `tests/architecture.test.ts`. The architecture test parses imports from source text, so it does not depend on lint coverage.

- **Import graph.**
  - `engine` imports only `engine` and zod. `exact` imports `engine`. `coach` imports `engine` and `exact`. `sim` imports `engine` and `exact`. `physics/core` imports only Rapier and itself.
  - Nothing in `src/` imports `tests/`.
  - Core never imports react, three, zustand, idb-keyval, `ui`, `dome`, `persistence` or `workers`.
- **Banned in core:** `Math.random`, `Date`, `performance`, `crypto`, `window`/`document`/`navigator`, and timers. `Math.floor/round/ceil` may appear only in `engine/core/{money,rational}.ts`; `physics/core` and `sim` are exempt.
- **Syntax:** relative imports with a `.ts` extension, and `import type` for types. No enums, namespaces or parameter properties.
- **State shape:** `TableState` and the session log are JSON-safe — no bigint, Map, Set or class instances.

### 4.2 Primitives (`engine/core/`, adopting existing code)
```ts
// rational.ts: existing immutable Fraction (bigint num/den, normalized). Add:
formatPercent(digits: number): string        // exact half-up decimal, no floats: 1/66 -> "1.52", 373/6930 -> "5.38"
floorDiv, min, max, abs; toWire(): readonly [string, string]; static fromWire(w)  // worker/IDB transfer (class prototypes don't survive structured clone)
// money.ts: existing, changed
export type Cents = number & { readonly __brand: 'Cents' }; export function cents(n: number): Cents  // asserts safe integer
export interface Rounding { readonly mode: 'floor' | 'ceil' | 'halfUp' | 'halfEven'; readonly increment: Cents } // 'nearest' -> 'halfUp'
roundCents(exact: Fraction, r: Rounding): Cents; winnings(stake, ratio, r): Cents; commissionOn(base, c): Cents; formatCents(c)
// config/ratio.ts
export type Ratio = { readonly num: bigint; readonly den: bigint; readonly label: string }  // net "to 1"
export function parseRatio(s: string): Ratio      // "7:6" | "9 to 5" | "30 for 1" (-> 29:1, label "30 for 1")
// rng.ts: pure; replaces the mutable Rng closure. createCryptoRng moves to ui/services/seed.ts (newSessionSeed())
export type RngState = readonly [number, number, number, number]
export function seedRng(seed: string): RngState              // FNV-1a -> splitmix32 x4: same state as today's createSeededRng
export function nextUint32(s: RngState): [number, RngState]
export function rollDie(s: RngState): [Die, RngState]        // reject u >= 4294967292, then u % 6 + 1
export function deriveSeed32(...parts: (string | number)[]): number   // physics/animation only; never advances the dice stream
// dice.ts: existing + DICE_CLASSES: 21 unordered outcomes, weight 1|2 (sum 36)
// hash.ts: 64-bit FNV-1a over canonical JSON (sorted keys)
```

### 4.3 Ruleset and round state machine (`config/rulesets.ts`, `round/round.ts`)
```ts
export type Ruleset = { variant: 'crapless' | 'traditional'; naturals: readonly Total[]; craps: readonly Total[];
  points: readonly PointNumber[]; dontBar: Total | null }
// crapless: naturals [7], craps [], points [2,3,4,5,6,8,9,10,11,12], dontBar null (no don't bets)
// traditional: naturals [7,11], craps [2,3,12], points [4,5,6,8,9,10], dontBar 12 (configurable 2|12)
export type Phase = { kind: 'comeOut' } | { kind: 'point'; point: PointNumber }
export type RoundState = { phase: Phase; rollIndex: number;
  shooter: { index: number; rolls: number; pointsMadeMask: number }; sinceSeven: { rolls: number; totalsMask: number } }
export type RoundTransition = { kind: 'natural'; total: Total } | { kind: 'craps'; total: Total } | { kind: 'pointEstablished'; point: PointNumber }
  | { kind: 'pointMade'; point: PointNumber } | { kind: 'sevenOut' } | { kind: 'none' }
export function advanceRound(r: RoundState, dice: Dice, rules: Ruleset): { next: RoundState; transition: RoundTransition }
```

| Phase | Roll | Crapless | Traditional |
|---|---|---|---|
| come-out | 7 | natural | natural |
| come-out | 11 | point 11 | natural |
| come-out | 2, 3, 12 | point | craps (same shooter) |
| come-out | 4–6, 8–10 | point | point |
| point p | p | pointMade → come-out; mask gets p | same |
| point p | 7 | sevenOut → come-out; shooter index +1; shooter counters reset | same |
| point p | other | none | none |

- Any 7 resets `sinceSeven`.
- Bets decide using the *before* state plus the transition.
- `compileConfig` checks that naturals ∪ craps ∪ points = {2..12} as a partition, with 7 ∈ naturals.

### 4.4 Machine config and presets (`config/`)

`MachineConfigInput` is plain JSON validated by zod. Its type is `z.infer` of the schema, and presets declare `satisfies MachineConfigInput`.

```ts
type RatioStr = string; type PointKey = '2'|'3'|'4'|'5'|'6'|'8'|'9'|'10'|'11'|'12'
type RoundingRule = { mode: 'floor'|'ceil'|'halfUp'|'halfEven'; increment: number }
type CommissionInput = { rate: RatioStr /* "1:20" */; basis: 'stake' | 'win'; timing: 'upfront' | 'onWin'; rounding: RoundingRule;
  minimum: number; refundOnTakeDown: boolean; rearm: 'recollectFromWin' | 'recollectFromCredit' | 'none' } // rearm: upfront vig when a winner stays up
type MachineConfigInput = { schemaVersion: 1; id: string; name: string; variant: 'crapless' | 'traditional'
  rules?: { dontBar?: 2 | 12 | null; allowPutBets?: boolean }
  money: { payoutRounding: RoundingRule; startingBankroll: number; betIncrement: number }
  limits: { min: number; max: number; tableMax?: number; perType?: Record<string, { min?: number; max?: number; increment?: number }> }
  chips: number[]
  catalog: BetTypeConfig[]                                     // §4.5; presence = offered
  composites: { id: string; label: string; parts: { typeId: string; units: number }[] }[]   // horn, C&E, world
  workingToggle: { global: boolean; scope: 'untilChanged' | 'nextRollOnly' }
  exclusiveGroups: string[][]                                  // [["place","buy"]] per number
  pace: { rollsPerHour: number; betWindowSec: number | null }
  provenance: Record<string /* JSON pointer */, { status: 'verified' | 'reported' | 'assumed'; source?: string; note?: string }> }
```

- **`compileConfig(input) → MachineConfig`** (memoized) produces parsed ratios, the ruleset, typeId maps and `configHash`. The hash is `hash(canonical(input without name/provenance))`, so editing a note doesn't invalidate caches. UI preferences such as theme live in settings, not in the config.
- **Semantic checks:**
  - every offered number has a pay entry
  - ratios are > 0
  - buy and lay have a commission
  - side-bet pay tables are non-empty and their counts fit `countedPoints`
  - provenance marked `verified` or `reported` must carry a `source`
- **`exact/sanity.ts`** (M6) runs on every config and edit:
  - any edge < 0 is an error ("player advantage: almost certainly a data-entry error")
  - any edge > 40% is a warning
- **Presets:**
  - `craplessBubble` (default)
  - `traditionalBubble`
  - `traditionalLive345`: a reference for "on a live table this pays…" comparisons — payouts floored to $1, $1 minimum vig, 3-4-5x odds
- **Assumed values.** Any value not backed by research is `assumed`. Where coach advice depends on an unknown, pick the conservative value until research or the user confirms it. For example, buy vig is `upfront` + `recollectFromWin`, so the coach never overstates buy bets.
- **Side bets** enter the presets only in M11, from research. Until then the user can add them in the editor.

### 4.5 Bets: instances, families, decisions (`bets/`)
```ts
export type BetId = string & { readonly __brand: 'BetId' }            // `b${nextBetSeq}`, deterministic
export type BetInstance = { id: BetId; typeId: string; number: PointNumber | null /* target, or a line bet's own point */;
  parentId: BetId | null /* odds */; amount: Cents; vigHeld: Cents; working: boolean | null /* null = default */;
  progress: number /* side-bet mask/count */; placedAtRoll: number }
export type Decision = { kind: 'none' } | { kind: 'progress'; progress: number } | { kind: 'travel'; number: PointNumber }
  | { kind: 'win'; payKey: string; stake: 'return' | 'stay' } | { kind: 'lose' } | { kind: 'push'; reason: 'bar' | 'offReturned' }
export type RollContext = { dice: Dice; total: Total; isPair: boolean; before: RoundState; transition: RoundTransition;
  rules: Ruleset; cfg: MachineConfig; working: boolean; parentDecision?: Decision }
export interface BetFamily<C extends BetTypeConfig> {
  readonly projection: 'none' | 'round'            // round fields the solver must track
  canPlace(i: PlaceInput<C>): Rejection | null
  mutability(b: BetInstance, s: TableState, c: C): { increase: boolean; decrease: boolean; remove: boolean; toggle: boolean }
  defaultWorking(phase: Phase, c: C, cfg: MachineConfig): boolean
  decide(b: BetInstance, ctx: RollContext, c: C): Decision          // pure; never depends on amount or money
  apply(b: BetInstance, d: Decision, ctx: RollContext, c: C): BetInstance | null
  configPaths(c: C, n: PointNumber | null): readonly string[]       // JSON pointers its math depends on (assumed chips, invariance test)
}
```

| Family | Bet types and config data | `decide` (when working) | After a win | Mutability |
|---|---|---|---|---|
| line | pass, come; dontPass/dontCome (traditional) | number null: naturals win, craps lose, else travel (don't side mirrored; `dontBar` pushes). Number n: n wins, 7 loses (don't side inverted). | pass `stay\|return` (config); come returns | Do side on a number: locked (`CONTRACT_BET`). Don't side: reduce or remove only. Bets with no roll yet: free. |
| odds | passOdds, comeOdds, dontPassOdds, dontComeOdds: `pays` and `limit` per point (default true odds, configurable), `workingOnComeOut` | Follows the parent's decision and pays `pays[n]`. If the parent resolves while the odds are off: `push(offReturned)`. | Returned with the parent | Free |
| numberVsSeven | place, buy, lay, big6, big8: numbers, pays, commission, afterWin, comeOutDefault | place/buy/big: n wins, 7 loses. lay: 7 wins, n loses. | config (`stay` default) | Free; exclusive groups |
| hardway | hard 4/6/8/10: pays, afterWin, comeOutDefault | n rolled as a pair wins; n rolled easy, or 7, loses | config | Free |
| oneRoll | field, any 7, any craps, 2/3/11/12, hops: outcome table by totals or pairs | Matching outcome wins at its pay; otherwise loses | `return` | Resolves on the next roll |
| uniquePointsMade (Fire) | **required** `countedPoints`, `payTable`, `payAtCount`, window `shooterFirstRoll` | A counted pointMade sets a progress bit; reaching `payAtCount` wins. At sevenOut: pays `payTable[count]`, else loses. | — | Locked after its first roll |
| collectSet (All Small / All Tall / Make 'Em All) | `targets`, `pays`, `endsOn: anySeven \| sevenOut`, window `noRollsSinceSeven` | The ending 7 loses. Otherwise add the total; a complete set wins at once. | — | Locked |
| pointRun (Lucky Shooter) | Built **only if research confirms it**; mechanics from 58 Pa. Code ch. 623c | Per the researched data | — | Locked |

Other rules:
- Placing an existing (typeId, number, parent) is an increase.
- A new come bet requires an empty come box.
- When a come bet travels onto a number that already has a come bet, the flat amounts merge and the existing bet keeps its odds.
- Composites are UI groups that expand to component one-roll bets in one atomic `batch`. Their edges add linearly.

### 4.6 Validation (`bets/validate.ts`, `limits.ts`, `legal.ts`)
```ts
type RejectionCode = 'NOT_OFFERED'|'BAD_PARAMS'|'WRONG_PHASE'|'WINDOW_CLOSED'|'BELOW_MIN'|'ABOVE_MAX'|'BAD_INCREMENT'|'TABLE_MAX'
  |'INSUFFICIENT_CREDIT'|'CONTRACT_BET'|'NO_PARENT'|'PARENT_NOT_ON_POINT'|'ODDS_LIMIT'|'EXCLUSIVE_CONFLICT'|'BET_NOT_FOUND'|'NOT_TOGGLEABLE'
type Rejection = { code: RejectionCode; details: Readonly<Record<string, string | number>> }
validateAction(s: TableState, a: Action, cfg: MachineConfig): Rejection | null
maxOdds(parent: BetInstance, cfg): Cents          // basis 'stake': m×flat; basis 'win': floor(m×flat ÷ lay ratio)
legalBets(s, cfg): { typeId; number; parentId?; canAdd: Rejection | null; maxAdd: Cents; canRemove: Rejection | null }[]  // zones + coach
```
Checks run in this order:
1. Offered, and params are valid.
2. Phase and window: pass only on the come-out unless put bets are allowed; come only during the point phase; Fire only when `shooter.rolls == 0`; collectSet only when `sinceSeven.rolls == 0`.
3. Limits and increments.
4. Odds: a parent on a number, and the amount ≤ `maxOdds`.
5. Credit covers the stake plus any upfront vig on the change.
6. Mutability and exclusive groups.

A rejected action never changes state.

### 4.7 Payouts, commission, rounding (`settle/`)
```ts
type CommissionRule = { rate: Fraction; basis: 'stake' | 'win'; timing: 'upfront' | 'onWin'; rounding: Rounding; minimum: Cents;
  refundOnTakeDown: boolean; rearm: 'recollectFromWin' | 'recollectFromCredit' | 'none' }
type SettlementTrace = { betId: BetId; outcome: 'win' | 'lose' | 'push'; stake: Cents; ratioLabel: string; winExact: string /* "3500/6" ¢ */;
  winPaid: Cents; breakage: string; vigOnWin: Cents; vigRearm: Cents; credited: Cents; stakeDisposition: 'returned'|'stays'|'lost'|'pushed' }
settle(bet, d: Decision, cfg, mode: 'rounded' | 'exact' = 'rounded'): SettlementTrace
chargeOnPlace(typeCfg, amountDelta: Cents, cfg): Cents     // upfront vig on placement/increase; lay base = potential win
```
- **Winnings:** `winExact = stake × num/den` as a Fraction, then `winPaid = roundCents(winExact, cfg.money.payoutRounding)`. Bubble machines use `{floor, 1}` (reported "to the penny"); the live preset uses `{floor, 100}`.
- **Vig on win:** `max(minimum, round(base × rate))`. The base is the stake (buy) or `winPaid` (lay), according to `basis`.
- **Upfront vig:** charged at placement and on increases, and held in `vigHeld`. On a win that stays up, `rearm` either takes it again from the win, charges it to credit, or skips it. It is refunded on takedown only if the policy says so.
- **Credited:** `winPaid − vigOnWin − (rearm from win)`, plus the stake if it is returned.
- **`exact` mode** skips rounding. It is used for the nominal edge and the cost of breakage.
- **Ledger:**
  ```ts
  { deposits, bankroll, houseNet, vigPaid, wagered }
  ```
  Invariant: `deposits === bankroll + Σ bet.amount + houseNet`. Vig moves to `houseNet` immediately; a refund reverses it.

### 4.8 Roll pipeline (`table/roll.ts`)
1. Get the dice from `action.dice` (marked scripted; RNG untouched) or from `rollDie` ×2 on `state.rng`.
2. `advanceRound(before)` gives the transition.
3. Order the bets: line, then odds (each gets its parent's decision), then numberVsSeven, hardway, oneRoll, side bets. Ties break by id.
4. Compute effective working for each bet: `bet.working ?? global toggle ?? family default by phase`. A bet that is not working gets `none` — except odds, which push when their parent resolves.
5. Settle every non-`none` decision, update the ledger, and emit events.
6. Call `family.apply` (travel, progress, stays up, removed). Merge come bets that traveled onto the same number.
7. Commit the round, `lastRoll` and the recent-totals history.
8. In dev and test builds, run `assertInvariants`.

### 4.9 Actions, events, betting window, macros, replay
```ts
type Action =
  | { type: 'place'; typeId: string; number?: PointNumber; parentId?: BetId; amount: Cents }
  | { type: 'setAmount'; betId: BetId; amount: Cents }               // press/reduce; 0 = take down
  | { type: 'setWorking'; betId: BetId; working: boolean | null }
  | { type: 'setGlobalWorking'; off: boolean | null }                 // BETS ON/OFF button
  | { type: 'deposit'; amount: Cents }
  | { type: 'batch'; actions: readonly Action[] }                     // atomic: repeat, one-tap switch, composites
  | { type: 'roll'; dice?: Dice }                                     // dice only from tests / e2e builds; logged as scripted
type GameEvent = BetPlaced | BetAdjusted | BetRemoved | WorkingChanged | VigCharged | VigRefunded | DiceRolled | Natural | CrapsOut
  | PointEstablished | PointMade | SevenOut | NewShooter | BetResolved /* + SettlementTrace */ | BetTraveled | BetProgress | Deposited
applyAction(s, a, cfg): { ok: true; state: TableState; events: readonly GameEvent[] } | { ok: false; rejection: Rejection }
type TableState = { v: 1; configHash: string; rng: RngState; round: RoundState; bets: readonly BetInstance[]; nextBetSeq: number;
  ledger: Ledger; globalOff: boolean | null; lastRoll: { dice: Dice; scripted: boolean } | null; recentTotals: readonly Total[] }
// session/window.ts: undo is limited to the betting window (no roll undo, so no hindsight betting)
type WindowedSession = { header: SessionHeader; committed: readonly { actions: readonly Action[]; roll: Action; hashAfter: string }[];
  windowStart: TableState; pending: readonly Action[]; state: TableState; lastWindow: readonly Action[] }
dispatchBetting(ws, a, cfg); undo(ws, cfg); clearWindow(ws, cfg); rollWindow(ws, cfg, dice?)  // roll commits pending atomically
// session/macros.ts: pure, return Action[] wrapped in one batch: repeat(lastWindow), double(...), press(betId, lastWin, increment), maxOdds(s,cfg), takeDownAll(s,cfg)
replay(header, committed): TableState            // hash-checked per window; ENGINE_VERSION in the header
```
- Changing machines starts a new session, so a session never has two configs.
- Rejected actions are not logged. The UI counts them for the coach.

## 5. Coach design

### 5.1 Metric definitions
Each is written into `docs/rules/glossary.md` and shown verbatim under "Show math".

- **Decision:** one win, loss or push. A bet that stays up after winning starts a new decision.
- **Edge:** expected loss ÷ expected amount risked, over the bet's lifecycle under the policy "leave it up until it loses (or resolves)".
  - Amount risked = stake per decision + commission paid up front (at placement and when it is re-collected); commission deducted from a win is not added (§0 #22). Pushes count as decisions.
  - When every decision is i.i.d., this equals the textbook per-decision edge: 1/66, 1/21, 3/220.
  - When upfront vig is not re-collected, it is the honest long-run figure: Buy 4 = 1/31.
- **Nominal edge:** the same, with unrounded payouts. **Breakage** = edge − nominal edge at the user's stake.
- **Edge per working roll:** expected loss per roll that the bet is working ÷ stake. Place 6: 1/216.
- **Equity (value from now):** the expected cash a bet on the table will still return.
  - Decision cost of an action = outlay − Δequity.
  - Example: a $10 crapless pass line on point 2 has equity 2 × $10 × 1/7 = $2.86. This is why it can't come down.
- **Standing cost per roll** (layout meter): the long-run expected loss per roll if you keep the bet up and re-bet it whenever allowed. All formulas are exact and renewal-based:

  | Bet type | Standing cost per roll |
  |---|---|
  | numberVsSeven, hardway, oneRoll | `e_working(amount) × π(phases where it works)` |
  | pass | `loss per decision × π(comeOut)` |
  | come | `loss per decision × (1 − π(comeOut))` |
  | Fire | `loss per bet ÷ E[rolls per shooter]` — crapless 57678/7303; traditional 1671/196 |
  | collectSet | `loss per bet × 1/6` |

  - π(comeOut) = 1/E[rolls per pass decision]: crapless 2310/9613, traditional 165/557.
- **Per hour:** per roll × `pace.rollsPerHour`. The default of 100 is assumed, and a 60–150 range is always shown.
- **Combined edge with odds:** loss ÷ (flat + odds wagered). Wording rule: odds lower the edge per dollar wagered but never reduce the flat bet's expected loss.

### 5.2 Exact analysis (`exact/`)

**How a chain is built (`chain.ts`):**
1. The state is the bet's sub-state, plus `(phase, point)` if `projection === 'round'`.
2. For each state, branch over the 21 dice classes (weight/36) using the engine's own `advanceRound`, effective-working rules, `decide` and `apply`.
3. Each decision emits an amount-independent label, `${kind}:${payKey}`, plus `vig:rearm`.
4. The horizon is either `decision` (stop at the first decision) or `lifetime` (continue through wins that stay up).

**How it is solved (`solve.ts`):**
1. BFS over states.
2. Normalize self-loops.
3. Tarjan SCC.
4. Solve each SCC with exact rational Gaussian elimination, in reverse topological order.

The output is the expected count of each label, expected rolls, expected working rolls, and per-state values (used for equity). A `maxStates` guard applies. If a side bet misses its time budget, a specialized DP is allowed, provided it is cross-checked against the general solver in tests.

**Pricing (`price.ts`).** `Σ count(label) × cash(label, amount)`. The cash value comes from `settle` (rounded or exact) and `chargeOnPlace`. Distributions are cached by `(configHash, ENGINE_VERSION, typeId, number, startKey, horizon)`, so pricing any stake is a dot product of under 0.1 ms. That makes chip previews, rounding scans and minimum-vig break-even scans cheap.

```ts
analyzeBet(spec: BetSpec, amount: Cents, start: StartContext, cfg): BetAnalysis
  // { pWin, pLose, pPush, edge, nominalEdge, breakage, edgePerWorkingRoll, expectedRolls, payoutLabel, winPaid, vig, assumedPaths }
analyzeExisting(betId, s, cfg): { equity: Fraction; expectedLossFromNow: Fraction }
standingCost(spec, amount, cfg, toggles): { perRoll: Fraction; policy: string }
analyzeLayout(s, cfg): { perRoll; perHour: { at: number; value: Fraction }[]; byBet; alternativeLayout? }
catalogTable(cfg): CatalogRow[]
efficientAmounts(spec, cfg, range): { amount: Cents; edge: Fraction }[]
sameEvents(a: BetSpec, b: BetSpec, start, cfg): boolean    // product chain: every transition has the same outcome kind
suggestAlternatives(s, spec, amount, cfg): Alternative[]   // comparability 'sameEvent' | 'restructure' | 'sizing'
derive(spec, amount, cfg): DerivationStep[]                // "wins 5 ways, loses 6 → P=5/11; $5×7/6=$5.833…→$5.83; EV…"; numbers from the solver
```
`sameEvents` compares event maps, not names. So place N ↔ buy N passes. Big 6 ↔ place 6 passes only when place 6 works on the come-out; otherwise it is classed as `restructure`. Hard 6 → place 6 is never `sameEvent`.

### 5.3 `CoachNumber`, templates, content lint
```ts
interface CoachNumber { kind: 'percent'|'money'|'probability'|'ratio'|'rolls'|'perHour'|'count'; exact: Fraction | Cents;
  source: { fn: string; args: unknown /* JSON */; configHash: string }; assumedPaths: readonly string[] }
interface Advice { id: string; ruleId: string; severity: 'info'|'tip'|'warn'|'critical'; subject?: { betId?: BetId; typeId?: string; number?: PointNumber };
  templateId: string; numbers: Record<string, CoachNumber>; fix?: { label: string; actions: Action[] } /* pre-validated by dry-run applyAction */ }
```
- Templates have the type `(n: Record<K, CoachNumber>) => TemplateParts`, so a raw `number` cannot be interpolated.
- `tests/content-lint.test.ts` rejects `\d%`, `$\d` and `\d+\s*(:|to|for)\s*\d+` anywhere in `coach/content/**` outside placeholders.
- An "assumed" chip appears whenever any of the number's `assumedPaths` has `assumed` provenance. The paths come from `configPaths()`.

### 5.4 Advisors (`coach/advisors/*`; each is a pure `(CoachInput) => Advice[]` with its own tests)
- **edgeWarning:** a grade from `policy.ts` thresholds (≤0.5% excellent, ≤2% good, ≤5.5% fair, ≤10% poor, >10% awful) plus "$X per $100 bet". For bets already held, it fires once per bet lifecycle.
- **sameEvent:** a strictly cheaper bet that wins and loses on identical events, evaluated at the user's amount, with savings ≥ 0.25 pp. It comes with a one-tap "Switch to Buy" `batch`. Examples:
  - It flips automatically with commission settings. On 5/9: on-win vig, buy 2.00% vs place 4.00% → buy. Upfront + recollect, 4.76% → place. Upfront + none, 2.91% → buy.
  - Place 6/8 at 1.52% always beats buying them.
- **restructure:** informational only, never counted as a leak. Examples: Big 6/8 → place 6/8; hard N vs place N; for crapless pass, "smaller flat + odds" vs "bigger flat".
- **odds:** for a line bet without full odds, shows the combined edge now and at max odds. Flags any odds paid below true odds as **not free**; for example, 2/12 odds at 11:2 cost 1/14.
- **amountEfficiency:** triggers on breakage at the user's stake, whatever the rounding unit, and suggests nearby efficient amounts. Examples:
  - Place 6 for $5 pays $5.83 (17/1100 = 1.55%), vs 1/66 at $6.
  - $1 pays $1.16 (1/55).
  - It also catches minimum-vig traps on live presets.
- **variantContext:** crapless pass/come 5.38%, compared with the traditional preset's 1.41% and place 6/8 at 1.52%. All three numbers are computed; none are typed in.
- **working:** what is on or off for the next come-out, and how a toggle changes $/hour.
- **layoutCost:** $/roll and $/hour, plus a same-exposure layout built from `sameEvent` swaps.
- **teachable:** event-triggered, shown for the first 3 occurrences of each:
  - the point is set on 2/3/11/12, with the equity drop
  - a come bet travels to 2/3/11/12
  - place bets are untouched by a come-out 7 while off
  - come odds are returned on the come-out
  - the first rounding loss
  - after ≥3 straight losses followed by a bet increase: "dice have no memory"
- **sideBetProgress** (M11): exact P(reaching the next tier) and the equity from now.

### 5.5 Surfaces and timing
1. **Chip tap or hover on a zone:** the coach strip previews the payout, edge and per-roll cost for the hypothetical amount.
2. **Edge badges** on each zone: text plus colour, so they are colour-blind safe.
3. **Bet inspector:** "Show math" derivation, equity for bets on the table, alternatives.
4. **Toast after placement:** non-blocking, with Switch, Undo, Keep, "It's for fun" and "Don't show".
5. **Post-roll recap** built from `SettlementTrace`. Each line shows outcome, then stake × ratio = exact, then rounding, then vig, then the amount credited, then the stake's disposition. It also includes **no-action lines**, such as "Place 6 OFF on come-out — the 7 didn't take it".
6. **Layout meter** and **cheat sheet** (`catalogTable` sorted by edge, with assumed chips).
7. **Coach feed:** everything generated, including gated-out messages.

### 5.6 Modes and gate (`coach/gate.ts`, pure)

| | Off | Quiet | Coach (default) |
|---|---|---|---|
| Edge badges | hidden | poor/awful only | all |
| sameEvent cheaper | – | toast if saving ≥ 25% | toast (≥ 0.25 pp) |
| High-edge toast | – | edge ≥ 9% | edge ≥ 4% |
| Rounding / min-vig tip | – | badge | toast |
| Recap | one total line | one line per bet | per bet, expandable math, no-action lines |
| Teachable moments | – | – | first 3 of each |
| Layout meter | hidden | compact | full |

Gate rules:
- **Budget:** at most 1 toast per betting window. The rest go to the feed, ranked by severity × $ impact.
- **Cooldown:** 20 rolls per (ruleId, betKey).
- **Dismissals:** 2 dismissals demote that advice to badge-only.
- **"It's for fun":** silences that bet type, which still counts in the summary.
- **Never blocks a bet.**

The thresholds are in `coach/policy.ts` and can be edited by the user.

### 5.7 Session summary (M13, scoped)
- Wealth W = bankroll + Σ equity. This gives an exact identity: `W_end − W_start = Σ luck − Σ decision cost`.
- The summary shows:
  - actual result (cash basis and equity basis)
  - expected = −Σ cost
  - luck
  - expected loss by bet family
  - **leaks from sameEvent choices only**, e.g. "Place 4/10 instead of Buy: −$3.20 over 16 decisions"
  - the two largest $/hour savings as next-session focus
- Not in v1: z-scores, σ bands, calibration.

### 5.8 How the coach is kept right
- Every number traces to `exact/`, which runs the engine's own rules.
- Numbers are typed `CoachNumber`s.
- Templates pass the content lint.
- An audit harness (`tests/slow/audit.slow.test.ts`) runs 200 random sessions in all modes. It recomputes each emitted number from its `source` through the oracles, and re-verifies every claim: strictly cheaper, same events, and legal by dry-run.
- In e2e builds, the UI text must equal `__CRAPS_TEST__.analyze(...)`.

## 6. UI design

**Layout generation.** `layoutSpec(cfg)` is pure and tested. It generates zones from `ruleset.points` and the catalog:
- Each number column has a BUY strip (if buy is offered, with a "5% now" or "5% on win" badge), a PLACE cell showing the machine's payout wording ("11:2", SIX/NINE), and a come/odds strip showing come bets on that number.
- The traditional layout adds a LAY strip and the DON'T bar.
- Other zones: pass line + odds bar, come bar, field bar, props/hardways panel (composites are buttons), side-bets panel, point puck.

**Responsive layout.** CSS grid with container queries. Use `dvh`, safe-area insets, and touch targets ≥ 44×44 px.

| Width | Number layout | Props, hardways, side bets |
|---|---|---|
| ≥960 px | row of 10 | inline |
| 600–959 px | row of 10 | column below |
| <600 px | **2×5 grid**, about 70×56 px per cell at 390 px | tabs that open a bottom sheet |

Phone portrait:
```
+ CREDIT $482.35   BET $36.00   WIN $14.00      [=] +
| dome (30dvh)        [4][4] HARD 8   7 8 4 6 11 > |
| [ 2 ][ 3 ][ 4 ][ 5 ][ 6 ]   each: BUY strip /    |
| [ 8 ][ 9 ][10 ][11 ][12 ]   PLACE cell / come     |
| [ COME 1:1 ]  [ FIELD 2x/3x ]  [ PASS | ODDS max ] |
| (Props)(Hardways)(Side bets) -> sheet              |
| Coach: Place 6 $6 pays $7.00 · 1.52% · good       |
| ($1)($5)($25)($100)  [Undo][Clear][Repeat][On/Off] (ROLL) |
```
- **Desktop (≥1024 px):** dome and roll history on the left, the layout in the centre, and a coach panel on the right with tabs Now / Bets / Cheat sheet / Session.
- **Phone landscape:** dome on the left, layout on the right.

**Interactions:**
- **Tap** a zone to `place` the selected chip. If rejected, the zone shakes and the coach strip shows the reason from the `Rejection` code, e.g. "Pass line is a contract bet once the point is set".
- **Long-press** (450 ms; cancelled after 10 px of movement), right-click or `i` opens the `BetInspector`: amount stepper, Press, Reduce, Take down, Working toggle, odds stepper with Max, Show math, alternatives.
- **REMOVE mode** is a toggle on phones.
- **Action bar:** UNDO, CLEAR, REPEAT, DOUBLE, BETS ON/OFF, ROLL. The ROLL button becomes SKIP while the dice are rolling.
- **Keys:** Space/R roll, U undo, C clear, Shift+R repeat, 1–6 chips, I info mode, X remove mode, O on/off.

**State management (zustand vanilla stores + hooks):**
- `gameStore = { session: WindowedSession, view: { phase: 'betting'|'rolling'|'revealing'; shown: TableState; next?: TableState; events? } }`. Its actions all go through `engine/session`.
- The table and the coach render `view.shown`, so nothing reveals the result early. Input is locked unless the view is `betting`.
- Other stores:
  - `settingsStore` (persisted to localStorage): chips, coach mode, dice mode, speed, quality, pace.
  - `machineStore`: preset and custom configs.
  - `coachStore`: feed, gate state, teachable counters.
  - `analysisStore`: worker results, rehydrated from wire format.
- `selectZoneViews(state, cfg, analysis, ui)` is memoized and carries `addBlocked`, `removeBlocked`, the edge and the payout label for each zone.
- Non-urgent coach updates use `useTransition`.

**Roll flow (`ui/services/rollFlow.ts`):**
1. Run `rollWindow` (the engine state becomes the truth).
2. `sessionRepo.commitRoll(...)` with `pendingReveal: true`, **before** any animation.
3. Set `view.phase = 'rolling'`, `shown = previous state`.
4. `await diceView.play({ dice, rollIndex, physicsSeed }, signal)`.
5. Set `revealing`, `shown = next`. Run the recap, gate and payout animations.
6. After 600 ms, return to `betting`.

The `DiceView` contract is:
```ts
{ mode: 'instant' | '2d' | '3d'; play(req, signal): Promise<void>; showRest(dice) }
```

**Accessibility.**
- Each zone is a `<button>` with an aria-label such as "Place 6, $12.00, pays 7 to 6, house edge 1.52 percent".
- An aria-live region announces rolls and payouts.
- Reduced motion switches to instant dice.

**Test hooks.** These exist only when `import.meta.env.MODE === 'e2e'`, and `check-bundle.ts` asserts they are absent from the production build.
- URL params: `?seed=&preset=&dice=instant|2d|3d&script=1-1,3-3&force3d=1`.
- `window.__CRAPS_TEST__ = { getState, sessionHash, analyze(spec, amount), queueDice, domeReadout }`.

## 7. 3D dome design

**Decoupling.** The engine has already decided the dice before any animation starts.
- The physics seed is `deriveSeed32(sessionSeed, 'physics', rollIndex, attempt)`, computed in the UI and passed as a number into `physics/core`, which has its own small PRNG.
- A test asserts that the same seed gives an identical dice sequence in instant, 2D and 3D modes.

**Headless simulation (`physics/core`; runs in Node and in `workers/physics.worker.ts`).** Starting values, to be tuned with `node scripts/physics-stats.ts`:
- **Units:** 1 unit = one die edge (19 mm). Gravity −516 u/s². `world.timestep = 1/240`. `numSolverIterations = 8`. A fresh `World` per throw, freed afterwards.
- **Floor:** a fixed cylinder with its top at y = 0; friction 0.6, restitution 0.25.
- **Dome:** a hemisphere of inner radius 7.5 u, built as a `trimesh` (48×16), with internal-edge `TriMeshFlags` if 0.19.3 exposes them. Fallback: a ring of convex tiles.
- **Dice:** `RigidBodyDesc.dynamic().setCcdEnabled(true)` with `ColliderDesc.roundCuboid(0.42, 0.42, 0.42, 0.08)`. The half-extent plus the border radius gives 0.5. Restitution 0.35, friction 0.4.
- **Popper:** a 70 ms upward impulse burst from the centre of the floor, with radial falloff, a launch speed of 70–95 u/s, ±15 u/s of sideways jitter, and 15–35 rad/s of spin.
- **Recording:** step at 240 Hz and record at 60 Hz, as a `Float32Array` of frames × 2 dice × 7 floats. Also record contacts (for finding handoff windows), `settleFrame`, the final body poses, and `finalUpAxis`.
- **Settled:** both dice below |v| < 0.05 u/s and |ω| < 0.1 rad/s for 0.3 s, or asleep.
- **Valid:** tilt ≤ 4°, centre height 0.5 ± 0.03, inside the dome, settled within 4.5 s, all values finite. In handoff mode, each die also needs a usable window.
- **Fallback chain:** up to 8 seeded retries, then a low-energy drop (up to 4 tries), then an analytic hop that is valid by construction.

**Face remap (`cube.ts`, `remap.ts`, `handoff.ts`, `plan.ts`).**
- The visual orientation is `q_vis(t) = q_body(t) · R[o(t)]`, where R is one of the 24 proper cube rotations.
- Face normals: `FACE_NORMALS = {1:+Y, 6:−Y, 2:+Z, 5:−Z, 3:+X, 4:−X}`. This is a right-handed die, and opposite faces sum to 7.
- After simulating, find the body axis `a_up` that points up at rest. Choose `o_end` with `R[o_end]·n_target = a_up`; there are 4 candidates, so pick the one with the smallest angle from `o_start`, which is the previous rest offset. That keeps the visual pose continuous across throws.
- **`snap` (M10a):** switch the offset in a single frame — the airborne frame with peak |ω|.
- **`handoff` (M10b):** slerp `R[o_start]→R[o_end]` over a 100–250 ms window where:
  - the die is airborne
  - its clearance is ≥ √3/2 + 0.05 from the floor and the dome, and ≥ √3 from the other die
  - |ω| ≥ 12 rad/s

  The plan may swap which die shows d1 and which shows d2 to minimise the rotation. About 1/6 of the time, a die needs no change.
- **Plan API:**
  ```ts
  buildPlaybackPlan(rec, dice, prevRest, mode): PlaybackPlan
  synthesizeRest(seed, faces)   // first load, restore, fallback
  ```

**Prefetch (`ui/services/physicsClient.ts`).**
- The worker starts after first paint.
- Throw k+1 is simulated from throw k's final body poses while the user bets, and handed back as a transferable buffer.
- `takeThrow` waits at most 150 ms; otherwise that roll reveals in 2D.
- A prefetched throw is discarded when the session or the physics parameters change.
- Golden recording hashes are checked **in Node only**. In the browser, the gate is visible faces equal to the engine's dice.

**Rendering (`dome/`, a lazy chunk).**
- **Canvas:** R3F `<Canvas frameloop="demand" fallback={<Dice2D/>}>`, calling `invalidate()` on every playback frame. The `gl` attribute `failIfMajorPerformanceCaveat` is true unless `force3d=1`.
- **Scene:** a felt floor drawn to a CanvasTexture, and a chrome ring.
- **Dome:** `SphereGeometry(R, 64, 24, 0, 2π, 0, π/2)`, drawn last with `depthWrite: false`. On the high tier, `MeshPhysicalMaterial` with transmission 1, ior 1.49, roughness 0.02. Otherwise a transparent `MeshStandardMaterial` with environment reflections.
- **Dice:** `RoundedBoxGeometry(1, 1, 1, 4, 0.08)` with 6 pip CanvasTexture materials that match `FACE_NORMALS`.
- **Lighting:** `RoomEnvironment` via `PMREMGenerator`, which needs no network.
- **Shadows:** blob-shadow quads.
- **Camera:** station view, FOV 35°.

**Playback (`playback.ts`).**
- The clock advances by `min(dt, 1/20) × speed`. Positions are lerped and rotations slerped between recorded frames, the offset track is applied, and matrices are written to refs — no React state changes per frame.
- Timing: a 120 ms lead-in, play until settled, a 250 ms read pause, then `onSettled`.
- Modes: full, fast (1.75×) and instant. Skip jumps to the final frame.

**Quality and fallbacks.**
- **Tiers:**

  | Tier | When | DPR | Material |
  |---|---|---|---|
  | high | desktop default | [1, 2] | transmission |
  | medium | `pointer: coarse` default | [1, 1.5] | no transmission |
  | low | dropped to | 1 | no MSAA |
  | 2D | last resort | — | — |

- A ~30-line frame-time monitor runs during playback. It drops a tier when the median frame exceeds 22 ms over 60 frames, and the result is saved per device.
- **Fallbacks:** `React.lazy` + `Suspense` + `ErrorBoundary` fall back to `Dice2D`. `webglcontextlost` switches to 2D and shows a "Retry 3D" toast. A watchdog reveals the result at the plan's duration + 2 s, or when the page is hidden. Reduced motion uses instant dice.
- **DOM attributes:** `data-testid="dice-view"`, plus:

  | Attribute | Values |
  |---|---|
  | `data-mode` | `3d` / `2d` / `instant` |
  | `data-state` | `idle` / `playing` / `settled` |
  | `data-dice` | read from the rendered meshes' world-up faces |

## 8. Persistence

- **Settings:** localStorage key `bct:v1:settings`, read synchronously at boot so there is no flash of wrong mode.
- **IndexedDB:** idb-keyval with `createStore('bct','kv')`. Keys:
  - `machines:v1`
  - `session:current`
  - `sessions:index`
  - `session:<id>:head` → `{ header (config snapshot, seed, engineVersion, createdAt), windowStart, pending, state, stateHash, pendingReveal, diceRest, coachGate }`
  - `session:<id>:log:<k>` → up to 100 committed windows each, as actions plus `hashAfter`
  - `analysis:<configHash>:<ENGINE_VERSION>` → wire-format label distributions
- **Writes:**
  - On each roll, write the head and the current log chunk in one `setMany` (atomic) **before** the animation.
  - Betting actions are saved to the head with a 250 ms debounce, and flushed immediately on `visibilitychange: hidden` and `pagehide`.
  - Call `navigator.storage.persist()`.
- **Loading:**
  - Validate the head with zod and continue from its stored state.
  - If `pendingReveal` is set, reveal it instantly; never re-roll.
  - If `ENGINE_VERSION` differs, replay to verify. On divergence, keep the stored state, mark the session divergent and show a notice.
  - If a blob is invalid, save it as `corrupt:<ts>` and start fresh.
- **Export/import:** JSON `{ format: 'bubble-craps-session', version: 1, header, windows, finalStateHash }`, validated with zod, replayed and hash-checked. Migrations live in `migrations.ts` with fixture tests.
- Basic autosave and resume arrive in **M8**; export/import and migrations in M12.

## 9. Testing & verification strategy

**Vitest projects.** In Vitest 5, inline projects inherit the root config.

| Project | Environment | Covers |
|---|---|---|
| `core` | node | `src/{engine,exact,coach,sim}/**`, `tests/**` except `slow` |
| `physics` | node | 60 s timeout |
| `ui` | jsdom 29, jest-dom/vitest, fake-indexeddb | |
| `slow` | node | |

**Scripts:**
- `test` runs core + ui + physics.
- `test:slow`
- `e2e`: Playwright against a `vite build --mode e2e` preview.
- `verify` = `tsc -b && eslint . && npm test && vite build && node scripts/check-bundle.ts`.
- Coverage is reported for all code, but gated only on `src/engine/**` (≥90% lines, ≥85% branches).

**Playwright projects:**
- desktop-chromium (1440×900)
- pixel7 (`devices['Pixel 7']`)
- iphone15 (`devices['iPhone 15']`, WebKit)
- chromium-3d: `launchOptions.args ['--enable-unsafe-swiftshader','--use-angle=swiftshader']` and `force3d=1`. It must assert `data-mode="3d"` and a live WebGL context before checking dice.

**Test layers:**
1. **Rule tables:** compact per-bet win/lose/push/travel sets for each phase, with working flags. They are written **test-first from `rules-spec.md`** in the same milestone as each family. Exhaustive 36-dice coverage comes from item 2.
2. **Reference oracle:** `tests/oracle/referenceRules.ts` is a naive if/else implementation written from the spec without reading `src/engine/bets` (a rule in CLAUDE.md). A fast-check differential over random (bet, state, working, dice) must find 0 mismatches.
3. **Closed form:** `tests/oracle/closedForm.ts`, grown from the existing `probability.ts` with its own rule constants. It covers place, buy, lay, odds, field, props, hardways, line, collectSet by inclusion–exclusion, and a Fire DP. A fast-check run over random configs (pay ratios, commission basis/timing/rounding/minimum/rearm, amounts) must equal `analyzeBet` exactly.
4. **Dispatch-chain oracle:** `tests/oracle/dispatchChain.ts` builds a chain by calling the full `applyAction(roll{dice})`, then solves it with the independent `denseSolve.ts`. It must equal `analyzeBet` exactly for every offered bet × preset × stakes {101, 500, 600, 1000, 2500}¢. This catches reducer wiring errors exactly.
5. **Published values** (exact rational equality, in `tests/golden/published.test.ts`):

| Bet | Exact value |
|---|---|
| Crapless pass/come | 373/6930; 9613/2310 rolls per decision; 373/28839 per roll; π(comeOut) 2310/9613; 57678/7303 rolls per shooter |
| Traditional pass; with 3-4-5x odds | 7/495; 557/165 rolls; 7/1671 per roll; π 165/557; combined 7/1870 |
| Don't pass, bar 12 | 3/220 |
| Place 4/10 · 5/9 · 6/8 · crapless 2/12 (11:2) · 3/11 (11:4) | 1/15 · 1/25 · 1/66 · 1/14 · 1/16 |
| Buy, 5% of stake on win: 2/12 · 3/11 · 4/10 · 5/9 · 6/8 | 1/140 · 1/80 · 1/60 · 1/50 · 1/44 |
| Buy upfront, recollect · buy upfront, rearm none: 4/10 · 5/9 · 6/8 | 1/21 · 1/31 · 3/103 · 3/113 |
| Lay on win: 4/10 · 5/9 · 6/8 · lay upfront, recollect | 1/60 · 1/50 · 1/44 · 1/41, 1/31, 1/25 |
| Field 2:1/2:1 · 2:1/3:1 · hard 4/10 · hard 6/8 · big 6/8 | 1/18 · 1/36 · 1/9 · 1/11 · 1/11 |
| Any 7 · any craps · yo 15:1 · yo "15 for 1" · 2 at 30:1 · "30 for 1" · horn | 1/6 · 1/9 · 1/9 · 1/6 · 5/36 · 1/6 · 1/8 |
| Odds 2/12 short-paid at 11:2 · true odds | 1/14 · 0 (stake-qualified; plus an odd-cent sweep) |
| All Small/Tall 34:1 · Make 'Em All 175:1 | 1687/21736 · 10207263466/136745788725 |
| Fire 24/249/999: traditional · crapless with all 10 counted · crapless with only 4–10 counted | 20.7628% · 13.4152% · 70.4488% (pin the exact rationals) |
| Place 6 at penny floor: $5 · $1 · per working roll | 17/1100 · 1/55 · 1/216 |

6. **Properties** (fast-check, ≥1000 runs of ≤200 actions):
   - money conservation, and bankroll ≥ 0
   - contract immutability: every change attempt gets `CONTRACT_BET`
   - odds ≤ `maxOdds`
   - rejected actions change nothing
   - `decide(a,b) ≡ decide(b,a)` (justifies the 21 dice classes)
   - replay equals live play; undo is exact; JSON round-trips
   - macros emit only valid actions
   - the same seed gives the same dice in every dice mode
   - standing-cost identity: π-formula = lifecycle loss ÷ lifecycle rolls
   - **config-path invariance:** mutating any config path not in a bet's `configPaths()` leaves its analysis unchanged
7. **Primitives:**
   - xoshiro known answer `[11520, 0, 5927040, 70819200]`
   - a seed snapshot recorded before the RNG refactor
   - rejection sampling tested with stubbed draws
   - `roundCents` checked exhaustively against a separate bigint reference
   - 36-cell χ² < 66.62 (35 degrees of freedom, p = .001)
8. **Scenario DSL:**
   ```ts
   scenario(cfg).place('pass', 1000).roll(1, 1).expect({ point: 2 }).expectBankroll(...)
   ```
   **Every researched machine fact becomes a scenario plus a provenance entry.**
9. **Lean Monte Carlo** (slow suite):
   - 10^5 decisions per bet through `decide`/`settle`, within 4σ using the exact σ, plus χ² on outcome labels; seeds pinned; whole suite ≤ 5 min
   - plus 500 full-reducer random sessions of 200 rolls, with invariants checked
   - a quick subset of 4 bets × 2×10^4 runs in `npm test`
10. **Architecture and lint:** the architecture scanner is unit-tested on fixture source strings, then run on all of `src`.
11. **Preset fingerprints:** a snapshot of `catalogTable` per preset, so any data change shows its effect in review.
12. **UI tests** (Testing Library) and **e2e** (Playwright); see the milestones.

**Which test catches which bug.** Include this table in CLAUDE.md.

| Bug class | Caught by |
|---|---|
| Wrong rule in `decide` or `advanceRound` | rule tables, reference differential, closed form, published values |
| Rounding, commission or rearm errors | settlement tables, closed-form fuzzing, rounding sweeps, published values |
| Solver math or chain construction | closed form, dense-solve oracle, Monte Carlo |
| Reducer wiring (order, working flags, travel, ledger) | dispatch-chain oracle (exact), invariants, scenarios, full-reducer Monte Carlo |
| Coach number or claim errors | `CoachNumber` types, content lint, audit harness, e2e hook equality |
| RNG bias or non-determinism | χ², known-answer test, replay/undo properties, fixtures, dice-mode invariance |
| Physics or remap | 24×6 exhaustive check, 1000 random plans, e2e `data-dice` |

Monte Carlo alone cannot catch a bug in `decide` or `settle`, because it shares those functions with the solver.

## 10. Milestones

Every milestone ends with `npm run verify` green, plus its own acceptance check. UI milestones also need `npm run e2e`.

- **M0 — Adopt the scaffold and add guardrails.**
  - **Step 0: ask the user to approve a baseline commit** of the untracked scaffold before moving anything.
  - Add pinned dependencies: zod, idb-keyval, jest-dom, coverage-v8, Playwright, fake-indexeddb.
  - Add tsconfig.core/worker/test, per-directory ESLint rules, Vitest projects, Playwright projects, CLAUDE.md, `.nvmrc`, engines.
  - Move `src/engine/{rational,money,rng,dice}.ts` and their tests to `src/engine/core/`. Move `probability.ts` and `variant.ts` to `tests/oracle/closedForm.ts` with their tests.
  - Move `App.tsx` to `src/ui/`.
  - *Accept:*
    - `verify` is green, and all 5 existing test files pass from their new locations.
    - The architecture scanner flags each planted fixture (forbidden import, `Math.random`, `Date`, a core file importing `ui`).
    - The e2e smoke test finds the title "Bubble Craps Trainer" on all 3 projects.
    - `node scripts/edges.ts --help` exits 0 under native type stripping.
- **M1 — Primitives.**
  - Pure RNG (record the pre-refactor seed snapshot first), branded `Cents`, rounding modes, `parseRatio`, Fraction additions and wire codec, `hash`, `DICE_CLASSES`.
  - *Accept:* the primitives suite (§9 item 7); `formatPercent` gives "1.52" and "5.38"; "30 for 1" → 29:1 with the label kept; the hash ignores key order.
- **M2 — Rules spec, config schema and presets.**
  - `rules-spec.md`, `glossary.md`, schema, compile, rulesets, provenance, 3 presets, `listAssumptions(cfg)`.
  - *Accept:*
    - The presets compile.
    - ≥20 invalid fixtures are rejected at the expected zod paths: crapless with craps totals, a missing place 11 pay, an empty Fire table, missing `countedPoints`, a negative ratio, and so on.
    - The partition property holds.
    - `configHash` ignores key order and provenance edits.
    - Any `verified` or `reported` entry without a source fails.
- **M3 — Round state machine and scenario DSL.**
  - *Accept:* a hand-written table (11 phase states × 36 dice × 2 variants) passes; shooter, `sinceSeven` and symmetry properties hold; the DSL can express "crapless come-out 11 sets point 11".
- **M4a — Line + odds, settle, reducer, ledger.**
  - *Accept:*
    - The rule tables, written first, pass for pass, come, don't pass, don't come and odds.
    - About 20 scenarios pass:
      - crapless: 7 wins on the come-out, and 2/3/11/12 become points
      - come bets travel to 2 and 12
      - come odds are returned on a come-out
      - traditional: 7 and 11 win, 2 and 3 lose, bar-12 pushes
      - 6:1 odds on 2 are paid to the penny
    - The ledger invariant holds after every step.
- **M4b — Place/buy/lay/big 6/8, commission, working rules.**
  - *Accept:*
    - $5 place 6 pays $5.83 (bubble) and $5.00 (live).
    - $25 buy 4 with vig on win credits $48.75.
    - Upfront vig is charged on placement and increases, and refunded per policy.
    - `rearm` recollect vs none: a `VigCharged` event on a winning stay-up bet in one case, none in the other.
    - A come-out 7 doesn't touch place bets that are off.
    - BETS OFF works.
    - Place + buy on the same number gives `EXCLUSIVE_CONFLICT`.
- **M4c — Field, hardways, props, hops, composites.**
  - *Accept:* the field 2x/3x table passes; hard 6 wins on 3-3, loses on 5-1 and on 7, and is off on the come-out per config; a $4 horn splits into 4 units; "15 for 1" pays 14:1 net; hop 1-2 matches both orders.
- **M4d — Validation matrix, invariants, properties, reference differential.**
  - *Accept:* every `RejectionCode` has a triggering test; the §9 item 6 engine properties pass; the reference differential finds 0 mismatches.
- **M5 — Session window, macros, replay.**
  - *Accept:*
    - Undo restores the exact prior state, and cannot cross a roll.
    - The macro property passes.
    - Replay hash equals live play.
    - The pinned fixture `crapless-200.json` reproduces its hash.
    - The `ENGINE_VERSION` bump policy is written into CLAUDE.md.
- **P1 — Headless physics spike.**
  - Independent of M2–M5; it can be pulled earlier or run in a parallel session.
  - Add Rapier 0.19.3 and `physics/core` with snap-mode plans. Add `scripts/physics-stats.ts`.
  - *Accept (physics project):*
    - Over 300 seeds: ≥95% valid on the first attempt, and 100% valid after the fallback chain.
    - The same seed gives an identical golden recording hash in Node.
    - The remap is exhaustive over 24 orientations × 6 targets.
    - 1,000 random (seed, d1, d2) plans show the requested top faces.
    - No escapes or NaN values over 500 seeds.
    - Settle p95 ≤ 4.5 s. The mean sim time is reported, with a soft target of ≤40 ms.
- **M6 — Exact analysis.**
  - `chain`, `solve`, `price`, `analyze`, `equity`, `standing`, `events`, `catalog`, `alternatives`, `derive`, `sanity`, `wire`, `scripts/edges.ts`, fingerprints.
  - *Accept:*
    - Every published value matches exactly.
    - Closed-form fuzzing passes (≥300 runs).
    - The dispatch-chain oracle matches for every non-side bet × preset × stake.
    - The standing identity and config-path invariance properties hold.
    - `node scripts/edges.ts --preset crapless-bubble` prints the table.
    - The non-side catalog computes in under 200 ms; pricing takes under 0.1 ms per call.
- **M7 — Lean Monte Carlo and the slow suite.**
  - *Accept:* the §9 item 9 criteria, with pinned seeds and `test:slow` ≤ 5 min.
- **M8 — Playable table (instant/2D dice) with basic persistence.**
  - *Accept:*
    - Testing Library: a tap places a chip; a long-press opens the inspector; a contract bet shows the lock message; disabled zones show the `Rejection` text.
    - e2e scripted crapless run, with dice injected using the e2e-only test preset:
      1. Pass $10, roll 1+1 (point 2).
      2. 2× odds.
      3. Place 6 $6, roll 3+3 (+$7.00).
      4. Roll 1+1.

      The bankroll must read exactly **$631.00**, with place 6 still up, on all 3 projects.
    - A reload mid-point restores the identical `sessionHash`.
    - A reload during `pendingReveal` reveals without re-rolling.
    - No horizontal scroll at 375 px, and every zone is ≥44×44 px.
    - The production bundle doesn't contain `__CRAPS_TEST__`.
- **M9a — Coach I: analysis worker, badges, inspector math, `CoachNumber`.**
  - *Accept:*
    - The worker builds the catalog, and no main-thread long task exceeds 50 ms (measured with a Playwright longtask observer).
    - Each badge equals `__CRAPS_TEST__.analyze`.
    - The Place 6 $5 inspector shows "$5.83" and "1.55%".
    - The content lint fails on a fixture containing "1.52%".
    - The second load hits the IndexedDB analysis cache.
- **M9b — Coach II: recaps and teachable moments.**
  - *Accept:*
    - Recap tests exist for each event kind, including no-action lines.
    - The recap shows "$5 × 7/6 = $5.833… → paid $5.83".
    - Setting the point on 2 with a $10 pass shows equity $2.86.
    - Each teachable moment appears only for its first 3 occurrences.
- **M9c — Coach III: advisors, alternatives, gate, modes.**
  - *Accept:*
    - Alternatives property: each one is legal by dry-run, offered, strictly cheaper by at least the threshold, and `sameEvents`-verified.
    - The 5/9 advice flips across the three commission settings: buy, then place, then buy.
    - A gate fixture produces the expected toasts per mode (budget, cooldown, dismissals, "for fun").
    - e2e: Place 4 on an on-win preset, tap "Switch to Buy", the bet converts and the meter drops.
    - The audit harness finds 0 discrepancies.
- **M9d — Coach IV: layout meter and cheat sheet.**
  - *Accept:*
    - The meter equals Σ `standingCost`, and the $/hour line shows the 60–150 range.
    - The cheat sheet rows equal `catalogTable` sorted by edge.
    - e2e: switching buy vig from on-win to upfront + recollect changes the Buy 4 badge from **1.67% to 4.76%** (to 3.23% with rearm none).
- **M10a — 3D dome, snap mode.**
  - Add three, @types/three and R3F. Build the lazy dome, worker prefetch, playback, watchdog, fallbacks and DOM attributes.
  - *Accept (chromium-3d project):*
    - `data-mode="3d"`, a live WebGL context, and a canvas that is not blank.
    - 10 seeded rolls where the sorted `data-dice` equals the engine's dice.
    - 3D and instant modes produce the same dice sequence.
    - Forcing a WebGL failure falls back to 2D.
    - `check-bundle`: initial JS ≤250 KB gzip with no three or Rapier; dome chunk ≤350 KB; physics worker ≤900 KB.
- **M10b — Handoff, quality tiers, performance, context loss.**
  - *Accept:*
    - Handoff physics tests: no contacts inside the window, the clearance rules hold, and the frame-0 orientation equals the previous rest pose within 1e-6.
    - With reduced motion, the reveal takes under 500 ms.
    - Forcing `WEBGL_lose_context` switches to 2D and play continues.
    - Manual iPhone check, recorded in `docs/manual-checks.md`: ≥45 fps and no visible face swap.
- **M11 — Side bets.**
  - Fire, All Small / All Tall / Make 'Em All, and pointRun only if confirmed — across engine, exact, UI and coach. Preset tables come from research.
  - *Accept:*
    - Scenarios: Fire pays 24:1 at seven-out after 4 unique points, ignores repeated points, and closes after the first roll; a come-out 7 loses All Small; completing the set pays immediately.
    - Published values match.
    - Side-bet Monte Carlo passes.
    - The full crapless catalog computes in under 2 s in Node and is cached.
    - Progress shows the exact P(next tier).
- **M12 — Machine editor, Match My Machine, provenance chips, export/import.**
  - A 5-question quick setup: buy vig timing and rearm; place/buy working on the come-out; odds caps on 2/12 and 3/11; field pays on 2/12; which side bets exist.
  - *Accept:*
    - Inline zod errors appear.
    - The player-advantage edit "place 6 pays 7:5" is blocked; edges above 40% warn.
    - 2/12 odds at 11:2 are flagged "not free" (7.14%).
    - Assumed chips are visible.
    - Export, clear, then import gives the same hash; a corrupt file is rejected; the migration fixture passes.
- **M13 — Session summary.**
  - *Accept:* the exact identity holds as a property over random sessions; a fixture session matches its golden numbers; leaks come only from `sameEvent` alternatives.
- **M14 — PWA, accessibility, performance; optional casino-pace timer.**
  - *Accept:*
    - Offline reload works after the service worker installs, and the precache includes the physics worker.
    - axe reports no serious violations.
    - A keyboard-only session passes.
    - Bundle budgets are met.
    - If built, the timer auto-rolls at 0 (fake-timer test).

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Machine conventions are unknown or vary (vig timing and rearm, caps, working defaults, side bets, "for" vs "to") | All of it is config data with per-pointer provenance. Conservative assumed defaults. Assumed chips, Match My Machine and the editor. One scenario per researched fact. Fingerprints. |
| A bug in the shared rule functions fools both the solver and Monte Carlo | Hand-written tables, a reference oracle, closed form, the dispatch chain and published values — none share rule code. |
| Rounding, vig or rearm semantics are ambiguous | Explicit `Rounding` and `CommissionRule.rearm`. The coach prices at the actual amount. Sweeps over odd-cent amounts. |
| Solver blow-up on side bets, or huge bigint fractions | Round projection, 21 dice classes, SCC solving, the worker, an IndexedDB cache, the `maxStates` guard, and specialized DPs cross-checked against the general solver. |
| Losing the uncommitted scaffold | Ask for a baseline commit at M0; adopt the scaffold rather than regenerate it. |
| Peer drift (R3F needs React below 19.4; jsdom 30 needs Node 24.15) | Exact pins; upgrade deliberately. |
| Rapier typings needing DOM or WebAssembly types under the core tsconfig | Give `physics/core` its own tsconfig with a DOM lib and keep purity through the architecture test. |
| Cocked, escaped or tunneling dice; a visible face swap | Validity checks, the fallback chain, CCD, a convex-tile dome option, the handoff window, snap mode as a fallback, 2D dice. |
| Mobile GPU, battery, iOS context loss, bundle size | Tiers, the demand frame loop, DPR clamps, blob shadows, lazy chunks, Rapier only in the worker, budgets in `verify`, the context-loss handler. |
| Animation spoiling or desyncing the result; reload to re-roll | `view.shown` gating, the input lock, persist-before-reveal, `pendingReveal`. |
| Hindsight betting | No roll undo; undo only within the window. |
| The coach nags, misleads or gets misread | The gate, `CoachNumber`, the content lint, the audit harness, the glossary, equity for contract bets, honest odds wording. |
| Floats leaking into money or percentages | Branded `Cents`, lint and architecture bans, exact formatting. |
| Headless WebGL silently passing on the 2D path | SwiftShader flags, `force3d`, and assertions on `data-mode` and the WebGL context. |
| PWA build failing on the >2 MiB Rapier chunk | `maximumFileSizeToCacheInBytes = 6 MiB`. |
| Safari IndexedDB eviction | `storage.persist()`, export, installing as a PWA. |
| Engine changes breaking saved sessions | `ENGINE_VERSION`; the stored state is the truth; a divergence notice; a fixture-regeneration policy. |
| Scope creep | The deferred list in §1. |
| Encouraging gambling | The trainer never shows positive EV, frames everything as expected loss, and adds an independence note. |

## 12. Decision log

| Decision | Choice and why |
|---|---|
| Base plan | **A**, as both judges recommended: the strongest correctness core and config model. |
| Toolchain | **Keep the existing TS 5.9.3 + ESLint/typescript-eslint + Prettier + jsdom 29.1.1** instead of A/B/C's TS 7 + oxlint. No churn; typescript-eslint peers `<6.1.0`; it allows typed rules (exhaustiveness) plus restricted imports and globals; jsdom 30 needs Node ≥24.15. Revisit when typescript-eslint supports TS 7. |
| Source of coach numbers | Engine-driven chains over amount-independent labels (A), priced by dot product. C's closed form and B's dispatch-driven chain become test oracles. This avoids C's second rules implementation drifting, and B's re-solving for every amount. |
| Undo | Only within the betting window (B/C). A's roll undo allowed hindsight betting. |
| Upfront vig | New `rearm` setting (no plan had it). It decides whether buy 5/9 or place 5/9 is the better bet. |
| Pay tables | Odds, buy and lay pay tables are data with true-odds defaults (fixes C). Side-bet `countedPoints` and pay tables are required (fixes A). |
| Metrics | B's definitions with a lifecycle edge and π-based standing cost. Fixes A's placement-dependent per-roll edge. |
| Alternatives | `sameEvents` proof (B). A's hard 6 → place 6 is reclassified as `restructure`. |
| Coach behaviour | B's `CoachNumber`, gate and recaps plus A's advisors. Three modes; Teacher, mastery and lessons deferred (judge). |
| Session review | A scoped summary: identity, leaks, focus. B's fairness panel, logger and calibration are deferred (scope). |
| Table UI | C's config-generated CSS-grid station with a 2×5 phone grid, replacing A's SVG (37 px targets). Pure macros (C). |
| Persistence | idb-keyval chunked log plus a localStorage boot read (A/C), not Dexie. Moved earlier to M8 (fixes A and C). |
| Physics | det-compat **0.19.3** exact, worker-only, prefetched, outcome-agnostic (C). Snap first, then handoff. Golden hash checked in Node only (fixes C). |
| 3D helpers | No drei (B): use `three/addons` and a small frame monitor. Offline-safe, fewer dependencies. |
| Order | Engine → session → **physics spike** → exact → Monte Carlo → table → coach → **dome** → side bets → editor → summary → PWA. The dome comes before unrequested extras (fixes B); the spike comes before UI (fixes A); the rules come before physics (fixes C). |
| Testing load | Compact test-first tables plus a differential instead of thousands of hand-written cells; lean, time-boxed Monte Carlo; modest coverage gate; 200-session audit (fixes A/B). |
| e2e dice | Injection only in e2e builds, checked by `check-bundle` (fixes C's seed search). |
| Deferred polish | Audio, camera rig, re-pop, slow-motion replay, physics-lab UI, screenshot baselines. The casino-pace timer is optional in M14. |

**Sources:**
- [vite-pwa FAQ (2 MiB default; error since 0.20.2)](https://vite-pwa-org.netlify.app/guide/faq)
- [Chromium: Intent to Remove SwiftShader Fallback](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM)
- [Vitest 5 announcement (inline projects extend root)](https://v5.cn.vitest.dev/blog/vitest-5)
- [Vite worker options](https://vite.dev/config/worker-options)
- [R3F Canvas API](https://r3f.docs.pmnd.rs/api/canvas)
- [Rapier det-compat 0.19.3 files](https://unpkg.com/@dimforge/rapier3d-deterministic-compat@0.19.3/?meta) and [0.21.0](https://unpkg.com/@dimforge/rapier3d-deterministic-compat@0.21.0/?meta)
- [three 0.186.1 exports](https://unpkg.com/three@0.186.1/package.json)
- [idb-keyval README](https://unpkg.com/idb-keyval@6.3.0/README.md)

### Critical Files for Implementation
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/table/roll.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/settle/settle.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/config/schema.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/exact/chain.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/physics/core/plan.ts

## 13. Milestone status (maintained by the integrator)

| Milestone | Status | Notes |
|---|---|---|
| Scaffold (pre-M0) | done | TS 5.9.3, ESLint 10, Vite 8, Vitest 5, jsdom 29.1.1; `src/engine/{rational,rng,dice,money,variant,probability}.ts` + 31 tests |
| M0 | done | Integrated 2026-10-28: `verify` (24 files, 190 tests) and `e2e` (3 projects) green. Physics has its own pure `tsconfig.physics.json`. Core unit tests are type-checked by `tsconfig.test.json` and exempt from the purity and rounding bans (now in CLAUDE.md). `createCryptoRng` moved to `ui/services/seed.ts` early. The integrator added `src/workers` tests to the Node `core` Vitest project, because no project collected them and Vitest skips such files silently. For later: `check-bundle` enforces only the initial-JS budget (M10a adds the rest); `test:slow` fails with "No test files found" until M7; `e2e/**` has no DOM types, so M8 must declare the `__CRAPS_TEST__` hook type; the scanner has no scope analysis, so locals named like banned globals (e.g. `window` in M5) must be renamed. |
| M1 | done | `money.ts` takes a structural `RatioLike`, so core never imports config. Hash API: `hashJson`, `canonicalJson`, `fnv1a64`. Seeds still squeeze to 32 bits, as before; changing that needs an `ENGINE_VERSION` bump and a new snapshot. For M2: `Rounding.increment` must go through `cents()`, and the zod enum can reuse `RoundingMode`. For M11: `parseRatio` rejects "1 for 1" (a push), so the Hot Shooter Jackpot push tier needs another representation. |
| P1 | done | 300 seeds: 100% valid first time. Deviations: a box floor (a cylinder let wedged dice sink through), soft CCD 0.25 u, and a trimesh dome with `FIX_INTERNAL_EDGES`. `simulateThrow` derives its retry seeds itself, so the UI passes `deriveSeed32(sessionSeed, 'physics', rollIndex)` with no `attempt` part. Dice settle in about 0.5 s; M10a should judge the look and tune `params.ts`. The golden hash, step rate, per-throw cost and contact recording changed in P1b; see that row. |
| M2 | done | Integrated 2026-10-28 with M3 and both hardening rows: `verify` (34 files, 471 tests; engine coverage 97% lines, 93% branches) and `e2e` (3 projects) green. **API** (`src/engine/config/`): `compileConfig(input)` returns a frozen `MachineConfig`, memoized per input object, or throws `ConfigError` whose `.issues` carry zod-style paths; also `validateConfig`, `MachineConfigSchema`, `configHashOf`. `MachineConfig` holds `ruleset`, `payoutRounding`, `limits.byType` (min/max/increment per type, defaults applied), `catalog: Map<typeId, CompiledBetType>` (ratios parsed, money in `Cents`, buy/lay commission per number as a `CommissionRule` with a `Fraction` rate), `oddsFor` (line type → odds type), `composites`, `sideBets`, `working.{toggle, comeOutAutoOff, afterSevenOut, layAutoOn, oddsOffReturnedAtPointMade, offBetsConsumeCredit}`, `exclusiveGroups` and `provenance`. Presets: `PRESETS`, `PRESET_IDS`, `DEFAULT_PRESET_ID` (`craplessBubble`), `isPresetId`, all frozen. Provenance: `statusAt`, `listAssumptions`, `resolvePointer`, `uncoveredPointers`, `pruneProvenance`. Core gained `ROUNDING_MODES`, the `Die`/`Dice` aliases and `parseDollars` (strict, BigInt; UI input must use it, not the float `dollarsToCents`). **Deviations from §4.4:** `catalog`, `composites` and `sideBets` are records keyed by type id; the come-out lists are written out in the required `rules` block and must equal the variant's; side bets are validated data only until M11; odds caps are `limit{basis, multiple per point}` on each odds type; don't-bet mutability is `onNumber`/`rebetAfterRemove` per don't type; added `workingToggle.perBet` and `.types`, `flow.macros`, `payLabelStyle: 'asWritten'` and `invalidRoll` `reVibrate`/`noRoll`; Power Odds is not modeled. **For M4:** a bet type without its own `payoutRounding` uses `/money/payoutRounding`, so its `configPaths()` must list that pointer; odds caps round down to the bet increment (research §4.4 [A]), from `limits.byType`; composite settlement (research §4.1 settles horn, world and C&E as one bet, §4.5 splits them) and per-part minimums are open (rules spec §9 #25, #27), so M4c decides; Come stays point-phase only although IB's text allows it after a point is made (§9 #26). **For M8:** `craplessBubble` keeps a winning pass up (`/catalog/pass/afterWin` = `stay`, IB §2.1 [V]), so §10's scripted run ends at $621 with the pass still up; the e2e test preset must pin the pass to `return` to keep $631. |
| M3 | done | **API** (`src/engine/round/round.ts`, pure, JSON-safe, 100% covered): `initialRound()`, `advanceRound(r, dice, rules)` returning `{ next, transition }`, `totalBit`, `totalsInMask`; types `Phase`, `Hand`, `SinceSeven`, `RoundState { phase, rollIndex, hand, sinceSeven }`, `RoundTransition`, `RoundStep`. **Deviations:** the plan's `shooter` is `hand` `{ index, rolls, pointsMadeMask }` (§0 #14), so §4.6's Fire window reads `hand.rolls === 0`. A seven-out is `{ kind: 'sevenOut', point, endedHand }`: `endedHand` holds the ended hand's counts (its `rolls` include the seven-out) and `next.hand` is already the new hand, so hand-reading side bets settle on `endedHand` (M11 Hot Shooter: A = `endedHand.rolls`, B = A − 1, C = A − 2). The come-out is decided by the ruleset's lists, never the variant name. `advanceRound` throws `RangeError` for dice outside 1–6, a point the ruleset lacks, or a come-out total in no list. Mask bit `1 << n` is number n; `rollIndex` starts at 0 and is the next roll's index; hand indexes start at 0. **For M4:** extend `tests/scenarios/dsl.ts` in place (`scenario(presetId \| config)` with `.roll`, `.expect`, `.expectProvenance`, `.facts()`, `.round`, `.transition`): its `ScenarioState` becomes the table state, which keeps `round`; `advance()` goes through the reducer's roll action; add `place`, `expectBankroll` and `expectBet`. Existing scenarios read only `round` and the last step, so they keep passing. A cheap reducer check: `state.round` equals `advanceRound(before.round, dice, rules).next`. Placement windows: Fire and Hot Shooter `hand.rolls === 0`; Lucky Roller (`afterSevenOrStart`) `sinceSeven.rolls === 0`; pass on the come-out only, come in the point phase only. |
| Guardrails hardening | done | Fixes for the M0/M1 audit. **Scanner** (`tests/architecture/scanner.ts`, now over all of `src` and `tests`, `.js/.mjs/.cjs/.jsx` included): engine/core imports only engine/core, its tests too; relative and root imports in `src/**` and `tests/**` name their file (`.ts`, `.tsx` or an asset; Vite `?query` suffixes ignored); `Math` members are found through destructuring and `globalThis.Math`; `Math.trunc` and `.toFixed`/`.toPrecision`/`.toNumber` join the rounding ban in engine, exact and coach; oracle modules (`tests/oracle/*.ts`, not their tests) may not import `src/exact`, `src/engine/{bets,round,settle,table,session}`, the engine barrel or `config/rulesets.ts`, and `tests/oracle/dispatchChain.ts` may drive the engine but not import `src/exact`; `Math.random` is banned in all of `tests/**` (the integrator added `table`, `session` and the `tests/**` ban). **ESLint** mirrors these: per-layer import bans, package allowlists for engine/core and physics/core, no Node builtins or `import()` in shipped core. The closed-form oracle uses exact rational equality only. `verify` is now `tsc -b && eslint . && npm run format:check && npm test && npm run coverage && vite build && node scripts/check-bundle.ts`, superseding §9; coverage counts `src/**/*.{ts,tsx}` and gates `src/engine/**`. `.prettierignore` skips `docs/**`, `CLAUDE.md` and generated output. **Deviation:** oracle *tests* (`tests/oracle/*.test.ts`) may import the engine and solver they compare against, while CLAUDE.md still says nothing in `tests/oracle/**` may; CLAUDE.md also does not yet describe the new bans or `verify`'s two new steps (the user's call). **Known gaps:** aliases such as `const M = Math` are not followed (closed in P1c: `Math` as a value is now banned); lint matches import text only, so it assumes normalized paths and flat engine/core and physics/core; `.js` files in core are checked by the scanner alone; `verify` runs the core tests twice (about 1 s). |
| P1b physics hardening | done | Fixes for the P1 audit. Exact per-frame depths into the floor, the dome's trimesh and the other die (`gap.ts`, `dome.ts`), with physics re-tuned to 480 Hz steps and 300 Hz contact stiffness. Golden hash `16720c1589ac738c`, params fingerprint `a715829ad46046a2`: re-pin both after any params, popper or Rapier change. Validity allows up to 0.1 u of overlap (`validity.maxOverlap`) into the floor, dome or other die, gains an `overlap` reason, and measures `escaped`/`outside` against the real mesh. The hop's guarantees are restated in the P1c row (this row's first wording was wrong). Recordings carry one contact byte per physics step (3 bits per die: floor, dome, other die; read with `touchesAt`/`touchesDuring`) and the params fingerprint; frames and contacts each own a transferable `ArrayBuffer`, and `hashRecording` covers both. `buildPlaybackPlan` throws `RangeError` when frame 0 is not at `prevRest` (Float32 tolerance) or the params differ. `DieTrack.hidden` marks a face switch that may be seen (spin floor 6 rad/s). `clearance()` is exact below a cutoff and a sagitta-corrected sphere bound above it. Breaking, inside physics only: `AttemptLog.penetration` became `depths` + `apex`, `maxPenetration` became `depthProfile`, `snapFrame` returns `{ frame, turnRate, hidden }`, and `domeMesh` moved to `dome.ts`. `physics-stats --seeds 300`: 297/300 (99.0%) valid first time, settle p95 0.60 s, 4.7 ms per throw in Node. Integrator check: the engine-to-worker seam (engine `Dice` → `DicePair`, `deriveSeed32` → `simulateThrow` → `buildPlaybackPlan`, both buffers transferred, chained rests) compiles under the worker lib and shows the engine's dice. **For M10a:** about 0.3% of face switches cannot be hidden (3 of 886 over 600 chained throws, each turning fast but touching something); decide how to cover them. Browser speed is not measured yet. **For M10b:** §10's handoff thresholds are centre-based but `clearance()` returns exact gaps, so restate them as gaps; the hop's fallback tumble window has no guarantee, though default params never reach it. |
| M4a | done | Line and odds bets, settlement, the table reducer and the ledger. **API** (`src/engine/`, public barrel `index.ts`; `ENGINE_VERSION = 1` in `version.ts`): `bets/types.ts` (`BetId`, `betId`, `betSeq`, `BetInstance { id, typeId, number, parentId, amount, vigHeld, working, progress, placedAtRoll }`, `Decision`, `RollContext`, `REJECTION_CODES`, `Rejection`, `BetFamily`, `roundingPointer`); `bets/registry.ts` (`FAMILY_ORDER`, `betTypeOf`, `resolveType`, `requireType`, `settlementOrder`, `decideBet`); `bets/limits.ts` (`typeLimits`, `checkAmount`, `checkTableMax`, `oddsCap`, `maxOdds`, `availableCredit`); `bets/validate.ts` (one validator per action, returning a `BetChange` the reducer applies); `bets/families/{line,odds}.ts`; `settle/settle.ts` `settle(bet, decision, cfg, mode)` with `settle/trace.ts` `SettlementTrace<M = Cents>`; `table/{state,actions,events,ledger,reducer,roll,invariants}.ts` (`newTable`, `applyAction`, `validateAction`, `assertInvariants`, `invariantViolations`, `InvariantError`). The roll pipeline is documented at the top of `table/roll.ts`. **Deviations from §4.5–§4.9:** the family interface is wider: `locate` (validation steps 1–2), `canPlace` (step 4), `toggleable`, `decidesWhenOff`, `payout(type, payKey)` and the optional hooks `vigOnChange`, `winCommission`, `blocksRebet` and `invariants`; `mutability` and `configPaths` take the config. The trace is generic (exact mode gives `Fraction`s), adds `typeId`, `number`, `pushReason`, `payKey` and `rounding`, and its dispositions are `returned \| stays \| lost` (a bar push `stays`, OFF odds are `returned`; there is no `pushed`). `TableState.rebetBlocked` lists don't types blocked until the next come-out. Invariants run on every `applyAction` unless `{ checkInvariants: false }`, since core cannot read the build mode. `validateAction` is a dry run of `applyAction`, so batches validate exactly. `setAmount` checks mutability before limits, so a contract bet answers `CONTRACT_BET` to any change. **Readings:** a line bet's pay key is `flat` and an odds bet's is its number; a bar push leaves the bet where it is; `stayIfFirstRoll` and `stayIf11` keep a winner only if it won before it had a number, or on 11 in the come box; odds always come down with their parent, and OFF odds are returned whether the parent won or lost (§2.3 step 4); only pass can be put, landing on the point; odds caps are floored to the odds increment after per-type limits, and cutting a line bet below what its odds need is refused (`ODDS_LIMIT`); `wagered` counts the stake of every decision, pushes included; the table maximum counts odds too. **Tests:** `tests/golden/{rules,settlement}/{line,odds}.test.ts` (written first: 95 of 100 rule cases failed against stub families) and `tests/scenarios/{line,odds,ledger}.test.ts`. The DSL (`tests/scenarios/dsl.ts`) now plays through the reducer, rechecks the ledger after every action and the round after every roll, and gained `place`, `setAmount`, `takeDown`, `setWorking`, `setGlobalWorking`, `deposit`, `act`, `rollFromRng`, `expectReject` (which also checks the table is unchanged), `expectBankroll`, `expectLedger`, `expectBet`, `expectNoBet`, `expectBets`, `expectSettled` and `expectEvents`. |
| M4b | done | Place, buy, lay, place to lose and big 6/8; commission; the machines' working rules. **API:** `bets/families/numberVsSeven.ts`; `settle/commission.ts` (`commissionRule(type, n)`, `vigOf(base, rule, round)`, `vigBase`, `upfrontVig(type, n, amount)`, `vigOnChange`, `winCommission`, `vigHeldAfterWin`, `rearmAfterWin`); `bets/working.ts` (`workingStatus(bet, state, cfg)` → `{ working, source }`, `effectiveWorking`, `canToggle`); `bets/policies.ts`, whose lists the engine consults: `FORCED_WORKING` (Shoot To Win's come-out auto-OFF), `DEFAULT_WORKING` (empty), `RETURN_OFF_ODDS` (Interblock's OFF odds returned when the point is made), `ROLL_CHECKS` (empty), `EXCLUSIONS` (`excludeLineVsLayBuy`) and `AFTER_ROLL` (`layAutoOn`, `afterSevenOutUntilPoint`), plus `startsOff` (Interblock's post-seven-out OFF, set on the new bet). Events gained `vigCharged.from` (`win` or `credit`), the `betRemoved` reason `vigDeclined` and `workingChanged.by` (`layAutoOn` or `afterSevenOut`). **Working precedence** (§2.4), highest first, as `workingStatus` reports it: `always` (line flats, come points, one-roll bets, composites); `machine` (`FORCED_WORKING`); `bet` (the bet's own setting, which Interblock's post-seven-out OFF and lay re-enable also set); `button` (`globalOff`, only for `/workingToggle/types`; `false` means ON and overrides the defaults); `machineDefault` (none); `default` (`/catalog/<t>/comeOutDefault` on the come-out, ON with a point). A bet is carried when `placedAtRoll < round.rollIndex`. Any press of the global button clears the covered bets' own settings. **Commission readings (§4.3):** vig = `max(minimum, round(base × rate))`; a lay's base is its win as paid; an increase tops `vigHeld` up to the vig due on the new amount; a cut refunds the excess only where `refundOnTakeDown`; on-win vig comes off the win and is capped at it; `recollectFromCredit` is charged after the win is credited. **Deviations:** the machine rules live in `policies.ts`, not `working.ts` (a load-order cycle otherwise); Interblock's post-seven-out OFF is the bet's own setting, so it outranks a Set bets On pressed before the seven-out (superseded: it is now a machine hold, `TableState.heldOff`, reported as source `afterSevenOut`; see "M4 audit fixes"); Shoot To Win's `/offBets/consumeCredit: false` is not modelled (M4 integration row). **Tests:** `tests/golden/rules/numberVsSeven.test.ts` (written first: 55 of 78 failed against a stub), `tests/golden/settlement/{numberVsSeven,commission}.test.ts`, `tests/scenarios/{numberBets,working,commission}.test.ts`, the seeded helper `tests/scenarios/numberPlay.ts` and `tests/slow/numberPlay.slow.test.ts`. |
| M4c | done | Hardways, one-roll bets and composites. **API:** `bets/families/hardway.ts`, `bets/families/oneRoll.ts` (also `outcomeKey(match, dice)`, `locateSpot`, `spotMutability`, `applySpot`, `spotInvariants`) and `bets/composites.ts` (`compositeFamily`); `BetType = CompiledBetType \| CompositeBet`. **Composites** (plan §0 #15): `cfg.composites` maps each id to a `CompositeBet { family: 'composite', id, typeId (= id), label, parts, units, match, pays, pushes, afterWin, payoutRounding }`. `units` adds the parts' units (horn 4, world 5); `match` is `total`, or `dice` (low face first) when a part matches dice; `pays` is the net per unit on each winning outcome, a `Ratio` in lowest terms labelled like "27:4"; `pushes` are the outcomes netting exactly 0; `afterWin` and `payoutRounding` are the parts' shared values. A composite bet is one `BetInstance` (`typeId` = the composite id, no number, no parent), placed as `{ type: 'place', typeId: 'horn', amount }`; it settles once through `settle` with one rounding, and a zero net is the new decision `{ kind: 'push', reason: 'zeroNet', stake }`, whose stake comes back or stays per `afterWin`. Limits apply to the whole stake (`limits.byType` and `/limits/perType/<id>` include composites). **Readings:** hard N loses on the easy way or any 7 in either phase and wins on its pair, including the come-out pair that sets the point; one-roll bets and composites always work, cannot be toggled and ignore the global button; "x for 1" pays (x−1):1; Shoot To Win winners ride (CW §32), Interblock and live winners are returned (§9 #19); a winning composite on Shoot To Win rides whole (the same money as riding parts; only what stays up differs). **Tests:** `tests/golden/{rules,settlement}/{hardway,oneRoll,composite}.test.ts` (written first: 100 of 128 failed against stubs) and `tests/scenarios/{hardways,oneRoll,composites}.test.ts`, with a parts-versus-whole property: equal in exact mode on every preset, and in rounded mode on penny machines with whole-dollar bets, while a live $1 horn on 12 pays $6 whole and $6.25 as parts. |
| M4d | done | Validation matrix, invariants, engine properties and the reference differential. **The differential finds 0 mismatches** on all four presets at 2,000 seeded sequences × 100 actions (`tests/slow/reference.slow.test.ts`; quick subset of 150 × 100 in `tests/oracle/reference.diff.test.ts`), with every offered type placed and settled and every decision kind reached, after five mismatch classes were settled against the rules spec. The engine was wrong three times: the vig minimum applies whenever a bet is up, even when its win rounds to $0 (§4.3 LIVE minimums); up-front vig is re-collected in full (§4.3 "re-paid on every win"): the win pays what it can and credit the rest, and when credit cannot, the bet comes down and what the win paid is refunded (§4.5); and only a take-down, not a reduction, blocks a re-bet (§0.2 #5, §5.1). The oracle was wrong twice: Interblock's post-seven-out OFF outranks a Set bets On pressed before the seven-out (§0.2 #4, §9 #6), and a put adds to the pass bet on its point (§3.1). Each case is replayed through both models under "adjudicated mismatches (M4d)". From the spec alone: once a don't type is blocked, adding to its box bet is `WINDOW_CLOSED` too (§0.2 #5 LIVE). **API:** `bets/legal.ts` `legalBets(state, cfg)` → one `LegalBet { typeId, number, parentId, betId, amount, canAdd, minAdd, maxAdd, canRemove }` per spot, each answer what `validatePlace` or `validateSetAmount` gives (the largest addition found by bisection); `invariantViolations(state, cfg, before?)` and `assertInvariants` also check the change (no id reuse; `nextBetSeq`, the round, deposits and `wagered` never go back), JSON safety, per-type limits and the table maximum. **Deviations:** a 17th rejection code, `BELOW_MIN_TOTAL` (`/limits/minTotal`; details `{ scope, min, total, short }`, plus `betId`, `typeId` and `amount` under `perBet`), checked in `validateRoll` rather than `ROLL_CHECKS` because it needs `effectiveWorking`; an empty table cannot roll on a `totalRound` machine (§2.3 step 9; Interblock's round "will not start until bets are valid"); a roll re-checks credit, per-type limits and the table maximum, for tables restored from storage. **Tests:** `tests/golden/validation.test.ts` (every code, the §4.6 order in 24 cases, batch atomicity, the minimum total, roll-time checks, `legalBets` on known tables); `tests/properties/{engine,legal}.prop.test.ts` on the helpers `tests/properties/{actions,differential,session}.ts` (outside `tests/oracle/` because they import the engine); `tests/slow/engine.slow.test.ts` (1,000 sessions of up to 200 actions per preset, and `legalBets` against `validateAction` on 3,000+ tables). The engine and the oracle refuse some changes with different codes, all in `setAmount`, where the engine checks mutability first and answers `CONTRACT_BET` while the oracle names a limit, increment, credit or window code. (Corrected after the M4 audit, which found "under 1% of refusals" wrong per preset: with the reconciliation's generator, 2,000 × 100 actions per machine, they differ on 0.68% of refusals on crapless, 0.52% on Shoot To Win, 0.54% on strict and 1.91% on the live table, 763 of its 914 pairs being `CONTRACT_BET`/`BELOW_MIN`; the differential now asserts that no other pair occurs.) |
| Config and provenance fixes | done | Thirteen fixes to the config schema, validation and provenance. **Status:** crapless odds pays and place pays on 4–10 are `assumed` (Interblock's par sheet is not public; MD-CL and WOO-CL, CW §17 and WOO-B stay as sources); traditionalBubble's `/comeOut/autoOff/newlyPlaced` and `/exclusiveGroups/2…5/scope` are `assumed`; both Interblock presets' `/workingToggle/perBet`, `/catalog/come/window` and `/oddsOffReturnedAtPointMade` are `assumed`; Shoot To Win's place rounding cites `WOV-30281; WOV-11344; WOV-32511` and live rounding `LVA-RND; HAR-PA`; there is no blanket provenance: every catalog and side-bet value is covered at its type level or deeper. **Schema:** `afterSevenOut.newPlacedOff.trigger: 'sevenOut' \| 'anySeven'` (required; both Interblock presets `sevenOut` [A]); `limits.minTotal` compiles to a frozen `MinTotal { amount: Cents, scope, countOff, countSideBets }` or null. **Validation** (38 new invalid fixtures; rules spec §5.3 updated by the integrator): put bets or Hot Shooter in crapless; a minimum total, per-type maximum or increment off the grid; a composite that can lose part of its stake, or whose parts disagree on `afterWin` or rounding; a working-control list naming a type that always works. Big 6/8, lay and place to lose stay legal in crapless (a real crapless table deals Big 6/8, core.md §8). `compileConfig` freezes the caller's input on its first successful compile (the bug was a stale memo after an in-place edit), and `deepFreeze` also freezes below a shallowly frozen object, so the M12 editor must copy a config before changing it. `sourceUrl('WOV-n')` links `…/craps/<n>-thread/`. **Hashes:** craplessBubble `4537b96ffb0ea61c` and strictBubble `0ba183bdf8e1412a` (the new `trigger`); traditionalBubble `49b0968a540bc9a5` and traditionalLive345 `c2e6321d12e7ccbb` unchanged. Config coverage 100% of lines, 99% of branches. **Open:** Shoot To Win's `/catalog/<t>/comeOutDefault: off` entries stay `verified` (CW §4's carried chips); chips newly placed for the come-out follow `/comeOut/autoOff/newlyPlaced` [A], which outranks the default, so their assumed chip comes from that pointer (number bets' `configPaths` list `/comeOut/autoOff`). The research `spec.md` WOV-n link template still has the bare-number problem. §9 #4 (Interblock's par sheet) stays open. |
| P1c physics + guardrail fixes | done | Seven fixes. **Oracle independence is transitive:** the scanner's `checkFiles(sources)` builds the import graph and reports, for each oracle module (a non-test file in `tests/oracle/`), every forbidden area it reaches through runtime imports, once, by its shortest chain. `import type`, `export type` and `typeof import()` are erased edges; `import { type X }` is not. `dispatchChain.ts` may reach the engine but not `src/exact`. ESLint's oracle block bans the same areas plus `compile.ts`, `presets/**`, `tests/scenarios/**` and schema values as direct imports, with `@typescript-eslint/no-import-type-side-effects`. **`Math` as a value** (rule `math-value`) is reported wherever a `Math` member is banned (the core layers, their tests and `tests/**`): aliases, casts, wrappers, `Reflect`, parentheses, `Math?.['random']`, `globalThis['Math']` and `self?.Math`; ESLint mirrors it with `no-restricted-syntax` selectors. **Per-step overlap:** `Recording.stepDepths` keeps each physics step's deepest depth into the floor, the dome and the other die, and `checkRecording` holds them to `maxOverlap` (0.1 u); `Depths` is `{ step, frame, sustained, atRest }`. **Rest states:** `simulateThrow(seed, rest, params?)`, `simulateAttempt(seed, rest, source, params?)` and `analyticHop(seed, rest, params?)` take the whole `RestState` and stamp `Recording.restHash = hashRest(rest)` (Float32 values, quaternion sign normalized). `buildPlaybackPlan` throws `RangeError` ("stale offsets?") on a mismatch, so M10a's worker request must carry the `RestState` its plan is built from. New helpers: `contactAt`, `hashRest`, `restOf`, `deeper`, `NO_DEPTH`, `SurfaceDepths`, `Hasher.mixFloat`. **The hop** (corrected wording, replacing P1b's): it lands the dice 2 u apart (2 × `hop.landing`) along their start bearing, in order, and adds no overlap: no gap to the floor, the dome or the other die goes below zero, or below where it started if it started there. Dice that start more than 2 u apart end closer than they started. Tested from 48 wall starts and at every physics step. **Bounds asserted:** sustained depth < 0.05 u (at most 0.036 u per 60 Hz frame over 6,000 throws) and settle p95 ≤ 1 s (0.60–0.63 s). The golden hash is re-pinned from `16720c1589ac738c` to `6030a138dfc5ffd7` because it now covers `stepDepths` and `restHash` (frames and contacts are bit-identical); the params fingerprint is unchanged (`a715829ad46046a2`); no re-tune. `physics-stats --seeds 300`: 296/300 (98.7%) valid first time (overlap 2, tilted 2, height 1); 98.9–99.1% over 6,000 throws. **Remaining gaps** (corrected after the M4 audit, which found this list incomplete): ESLint missed `globalThis.Math.random` and `globalThis.Math[name]` in tests (the scanner caught both); the scanner flagged `: Math` type annotations, which ESLint allowed; a name built from strings, or `eval`, reaches neither; the probe that the presets reach `rulesets.ts` held only while they imported `deepFreeze` from `compile.ts`; and, not listed here, an oracle module could reach `src/engine/core` beyond `rational.ts` and `dice.ts` (`money.ts` included) and config code at run time through helper modules, `self`, `window` and `global` could carry `Math` in tests (destructured, aliased or passed on), oracle paths were compared case-sensitively although macOS loads `src/Engine/...` as `src/engine/...`, and `simulateThrow` from a rest with dice sunk into each other or outside the dome could return an invalid hop. All are closed in the "M4 audit fixes" row except the string-built name and `eval`. |
| M4 integration | done | Integrated 2026-10-29 (M4a–d and both fix rows). `npm run verify` is green: `npm test` 69 files, 1,518 tests (core 51 / 1,389, physics 15 / 123, ui 3 / 6); engine coverage 99.76% of lines and 97.63% of branches (gate 90 / 85); initial JS 67.9 kB gzip of 250 kB. `npm run test:slow`: 3 files, 13 tests, 43 s. `npm run e2e`: 3 passed. `npx eslint .` and the scanner are clean on the whole tree. **Integrator changes:** Vitest titles that printed "undefined" (`$12` and `$10` read as interpolation) reworded in `tests/golden/settlement/{hardway,composite,oneRoll}.test.ts` and `tests/scenarios/odds.test.ts`; the barrel also exports `workingStatus`, `requireType`, `commissionRule`, `upfrontVig`, `vigOf`, `vigBase` and the types `WorkingStatus`, `WorkingSource`, `ResolvedType`, `PushReason`, `CommissionRule`, `CompositeBet`, `HardwayBetType`, `NumberBetType`, `OneRollBetType` and `MinTotal`; `tests/scenarios/presetFacts.test.ts` adds 21 scenarios for researched facts that no family file covered, and strict's place pays join the odd-cent sweep in `tests/golden/settlement/numberVsSeven.test.ts`; rules spec §2.3 step 8 (the OFF-odds reading), §5.1 (`trigger`) and §5.3 (the new checks). **Decision: Shoot To Win's `/offBets/consumeCredit: false` is not modelled.** Every OFF chip keeps its stake off the bankroll on every machine, so the trainer never lets a player bet more than a machine would. Modelling it needs a ledger "reserve" (bankroll ≥ −Σ OFF stakes) and a rule for an unfunded chip turning ON, which no source documents; revisit if the player uses Shoot To Win. **Machine facts** (rules spec §2.4, §3, §4, §5.2): every M4 fact of each preset has a scenario, or a rule or settlement table where a scenario would only repeat one (strict's place and hardway pays in the odd-cent sweeps, sub-cent commission rounding), and 191 `expectProvenance` checks pin the tags of 158 preset values (crapless 59, Shoot To Win 49, strict 22, live 28). `presetFacts.test.ts` added the crapless minimum total, per-bet limits, come window, come and buy after a win, and place 4/5/9/10 pays; Shoot To Win's pass odds, place pays, minimum total, don't come removal, come against don't come, and don't come odds on the come-out; strict's pass odds, buy vig, minimum total, big 6 and lay exclusions; and the live table's lay odds, lay vig, don't come contract, doey-don't, come-out working, line minimum and odds above the maximum. Not scenario-tested: commission rounding on whole-dollar buys (never sub-cent; the settlement tables sweep it), flow and pace (M5, M8) and side bets (M11). **Open:** (1) Interblock's Set bets On may map to `setGlobalWorking(false)` (explicit ON: come odds then also work on the come-out) or to `null` (the defaults: come odds OFF on the come-out [A]); both clear the covered bets' own settings, the post-seven-out OFF included, and IB §3.2 does not say which, so M8 decides and records it. (2) Per-bet toggles together with Interblock's post-seven-out OFF (no preset): `setWorking(null)` turns the bet ON in the engine and leaves it OFF in the oracle. (3) A declined re-collection is judged against the bankroll at that bet's place in settlement order, not after the roll's other payouts; the oracle does not model the decline (§4.5 gap). (4) `validatePlace`'s step-6 `CONTRACT_BET` cannot be reached with a valid config. (5) With `scope: nextRollOnly` the post-seven-out OFF clears after one roll, and `until: pointEstablished` with per-bet toggles also clears the player's own OFF (no preset). (6) The live preset sets no per-type increments for composites, so it takes a $1 horn or world bet and floors the win to the dollar; `/limits/perType` can now name horn and C&E ($4, $2) and horn high and world ($5). (7) `tests/oracle/machineFacts.ts` rounds composites with `/money/payoutRounding` and the engine with the parts' rounding (equal on every preset). (8) The glossary's "amount risked" includes vig taken from wins (an on-win buy 4 at 1/61); rules spec §0.1 does not (1/60, the published value). The hand-offs for M5, M6 and M8 are the next three rows. |
| M4 → M5 hand-off | notes | Actions are plain JSON (`table/actions.ts`): `place { typeId, number?, parentId?, amount }` (adds to the bet already on that spot), `setAmount { betId, amount }` (0 takes it down, with its odds), `setWorking { betId, working: boolean \| null }`, `setGlobalWorking { off: boolean \| null }`, `deposit { amount }`, `batch { actions }` (all or nothing; a refusal adds `batchIndex` to its details) and `roll { dice? }` (scripted dice leave `rng` alone and set `lastRoll.scripted`). `applyAction(state, action, cfg, { checkInvariants? })` returns `{ ok: true, state, events }` or `{ ok: false, rejection: { code, details } }`, never mutates, and changes nothing on a refusal; `validateAction(state, action, cfg)` is the same call as a dry run; both throw `RangeError` for a table of another `configHash`. `newTable(cfg, seed)` starts a session. `TableState { v: 1, configHash, rng, round, bets, nextBetSeq, ledger { deposits, bankroll, houseNet, vigPaid, wagered }, globalOff, lastRoll, recentTotals, rebetBlocked }` is JSON-safe, so `hashJson(state)` is a window's hash and undo can rebuild from `windowStart` plus `pending` without its last action. A roll can be refused (`BELOW_MIN_TOTAL` with `details.short`, credit, limits), so `rollWindow` must keep the window open on a refusal. On machines with `/limits/minTotal` (crapless and strict $5, Shoot To Win $3) the working bets must reach it, so fixtures such as `crapless-200.json` bet before every roll (the DSL's `withoutMinimum(id)` serves round-only tests). State that outlives a window: `globalOff` (until changed, or reset every roll under `/workingToggle/scope: nextRollOnly`), each bet's own `working`, `vigHeld` and `rebetBlocked`; the machine's own changes after a roll arrive as `workingChanged` events with `by`. Macros: Repeat is the last window's actions as one `batch`, validated as a whole; Double is `setAmount` to twice each bet that may increase (contract bets refuse with `CONTRACT_BET`); max odds is the spot's `maxAdd` from `legalBets(state, cfg)` (the cap, the per-type maximum and credit); take down all is `setAmount 0` for each spot whose `canRemove` is null. Replay feeds the log back through `applyAction`; `tests/properties/session.ts` already checks that a replay from the seed reproduces the table. The roll history (§0 #20) comes from the events: `diceRolled { dice, total, scripted, rollIndex }`, the round's `natural`, `crapsOut`, `pointEstablished`, `pointMade`, `sevenOut { point, endedHand }` and `newShooter { handIndex }`, then `betResolved { trace }`, `betTraveled`, `vigCharged { reason: placement \| increase \| rearm, from? }`, `vigRefunded`, `betRemoved { reason: takenDown \| withParent \| vigDeclined }` and `deposited`. A `vigCharged` with `from: 'win'` only announces `trace.vigRearm`, which `trace.credited` already nets; `from: 'credit'` is a separate debit. |
| M4 → M6 hand-off | notes | Decide with `decideBet(bet, ctx, resolveType(cfg, typeId))`, where `ctx` is a `RollContext { dice, total, isPair, before, transition, rules, cfg, working, parentDecision }`. A `Decision` is `none`, `progress`, `travel { number }`, `win { payKey, stake: return \| stay }`, `lose`, `push { reason: bar \| offReturned }` or `push { reason: zeroNet, stake }`. A bet that is not working gets `none`, except odds (`decidesWhenOff`): they are returned (`offReturned`) when their parent is decided while they are OFF, and on Interblock whenever the pass point is made (`RETURN_OFF_ODDS`). `settle(bet, decision, cfg, 'exact')` gives a `SettlementTrace<Fraction>` with nothing rounded but commission minimums kept: `credited = (stake if returned) + winPaid − vigOnWin − vigRearm`, and `stakeDisposition` says where the stake goes (`returned`, `stays` or `lost`; a `bar` push stays, `offReturned` comes back, `zeroNet` follows its `stake`). Cash depends on the kind, the `payKey` and the disposition, so chain labels need all three. Commission: placing and increasing cost `upfrontVig(type, n, amount)`, held in `vigHeld`; a winner that stays up under `recollectFromWin` or `recollectFromCredit` pays the full `upfrontVig(type, n, amount)` again (`trace.vigRearm` is only the part its win covered: credit pays the rest, or the bet comes down when it cannot); `rearm: none` pays nothing again; on-win vig comes off the win, capped at it; a lay's base is its win as paid; `commissionRule(type, n)` applies per-number overrides. `family.apply(bet, decision, ctx, type)` returns the bet after the roll, or null. Working is `effectiveWorking(bet, state, cfg)` on the table before the roll (precedence in the M4b row); a chain over rolls must carry what changes it between rolls: the `AFTER_ROLL` rules, the `nextRollOnly` reset, Shoot To Win's carried against new chips (`placedAtRoll < rollIndex`) and Interblock's post-seven-out OFF on bets placed right after a seven-out. `configPaths`: `resolveType(cfg, id).family.configPaths(type, number, cfg)` for every family, with `roundingPointer(cfg, typeId)` for the rounding (a composite answers for its first part); a composite lists `/composites/<id>` and each part's `match`, `pays`, `afterWin` and rounding; number bets list their pays, commission (or per-number override), `afterWin`, `comeOutDefault`, `/comeOut/autoOff`, `/afterSevenOut/newPlacedOff` and, for lays, `/layAutoOn`. Composites are described in the M4c row; their outcome keys follow `match` (`outcomeKey`). The solver may rely on these: `decide` is pure, never reads an amount and is symmetric in the dice (checked exhaustively per preset), so the 21 dice classes suffice; bets decide on the round before the roll plus its transition, and on nothing else except odds on their parent's decision; the come box travelling to N and a come bet on N are separate decisions and never merge; settlement order is `FAMILY_ORDER`, then placement; `projection` is `round` for line, odds, number and hardway bets and `none` for one-roll bets and composites; each settlement rounds once; every table invariant and the ledger identity hold after every action; `wagered` counts the stake of every decision, pushes included. The dispatch-chain oracle's 101¢ stake (§9 item 4) fails the presets' $1 increment, and a lone bet under $5 cannot roll on crapless, so run it on config variants with `money.betIncrement` 1, `limits.min` 1 and `limits.minTotal` null (pruning provenance as `withoutMinimum` does). Use rules spec §0.1's divisor for published values (an on-win buy 4 at 1/60) and fix the glossary's "amount risked" to match. |
| M4 → M8 hand-off | notes | The e2e preset pins `/catalog/pass/afterWin` to `return` for $631 ($621 with the default `stay`), and every e2e roll needs a working bet ($5 on crapless). "BETS ARE NOT VALID YET! – Must bet N credits more!" takes N from `validateAction(state, { type: 'roll' }, cfg).details.short` ÷ the credit value. Zones come from `legalBets(state, cfg)`. Interblock's button shows Set bets On while any covered bet is OFF (`workingStatus` source `bet`, `afterSevenOut` or `button`); Set bets Off is `setGlobalWorking(true)` and Set bets On is `setGlobalWorking(null)` (§0 #21; updated in the M5/M6 integration, see the M8 hand-off row below). A horn is `{ type: 'place', typeId: 'horn', amount }`, and its recap rebuilds the arithmetic from `cfg.composites.get('horn').parts`. |
| M4 audit fixes | done | Fixes for the M4 audit (engine-fix and guardrail/physics agents). **Refused, never thrown:** dice that are not an object of two integer faces are `BAD_PARAMS` (`isDice`); an addition that would leave the safe-integer range is `ABOVE_MAX { typeId, held, added, max }`, checked before the sum is formed; a deposit past it is `ABOVE_MAX { scope: 'ledger', field: 'amount', amount, max }` (`depositRoom`), and a roll that could take the ledger past it is `ABOVE_MAX { scope: 'ledger' }` (`checkLedgerRoom`, which counts side bets as winning 0: M11 must add their pays). **Batches:** a roll inside a batch, at any depth, is `BAD_PARAMS { field: 'actions', reason: 'roll', batchIndex }` (the top-level index) before anything applies; a batch that contains itself is `reason: 'cycle'`; nesting is flattened iteratively, so any depth works. **Re-collection** is judged after all of the roll's settlements, in settlement order (rules spec §4.5): a declined bet's stake comes back before later re-collections are judged, and re-collection events follow every bet event of the roll, before `newShooter` (closes M4 integration open item 3). **Mutants pinned:** pushes count as wagered; credit that exactly covers a re-collection pays it; a press counts only its increase toward the table maximum; `validatePlace`'s unreachable step-6 `CONTRACT_BET` is gone (open item 4). **Per-number rounding:** `/catalog/<t>/payoutRoundingByNumber` (`NumberBetType.payoutRoundingByNumber`); every payout and a lay's commission base go through `payoutRoundingFor(type, n)`, and `roundingPointer(cfg, typeId, n?)` and `configPaths` name the per-number pointer. Shoot To Win place now rounds 4/5/9/10 down [A] and 6/8 up to the cent [R], with provenance per number. **Per-number units:** `/limits/perType/<t>/incrementByNumber` (compiled to `cfg.limits.incrementByNumber`; read through `typeLimits(cfg, typeId, n?)`, for odds the parent's point; each unit a multiple of the type's increment): amounts must be multiples of it, `maxOdds` and `legalBets` floor to it, `smallestBet(limits)` is the minimum rounded up to it, and a type's maximum need not be a multiple. The live preset takes odds in $1/$2/$5 units (4-10, 5-9, 6-8) and lay odds in $2/$3/$6, and C&E at $2, horn $4, horn high and world $5, each also its minimum [A] (open item 6). **Set bets On is `setGlobalWorking(null)`** [A] (§0 #21; rules spec §2.4, §9 #28; open item 1): it ends the post-seven-out OFF, and Come odds stay OFF on the come-out and are returned on a 7 there. **The post-seven-out OFF is a machine hold**, `TableState.heldOff?: readonly BetId[]` (optional only so hand-built tables may omit it; read it with `heldOffOf(state)`), not the bet's own setting: new bets carry `working: null`; `WorkingSource` gains `afterSevenOut`, between `bet` and `button`; `setWorking(bet, true)` turns a held bet ON and `setWorking(bet, null)` returns it to the hold; Set bets On ends the hold and Set bets Off leaves it; a `nextRollOnly` reset leaves it; `until: pointEstablished` releases only the hold, never the player's own OFF (rules spec §9 #29; open items 2 and 5). **Not modelled:** `MachineConfig.notModelled` (`notModelledPointers(input)`) is `['/offBets/consumeCredit']` on Shoot To Win and empty elsewhere (§0 #23; rules spec §4.5, §5.2). **Docs and provenance:** the glossary's amount risked excludes commission taken from a win (an on-win buy 4 at 1/60; open item 8); `configPaths` lists the parts of `/comeOut/autoOff` and `/afterSevenOut/newPlacedOff` (`comeOutAutoOffPaths`, `afterSevenOutPaths`), so the assumed `newlyPlaced` is no longer hidden behind the verified block; Shoot To Win's `comeOutDefault` entries stay `verified`, because both auto-OFF lists outrank them on every chip, new or carried (rules spec §2.4, §9 #7). **API:** `typeLimits` and `roundingPointer` take an optional number and `validateDeposit` takes the state; the barrel adds `payoutRoundingFor`, `smallestBet` and `heldOffOf`; also new are `depositRoom`, `checkLedgerRoom`, `notModelledPointers`, `comeOutAutoOffPaths` and `afterSevenOutPaths`. **Hashes:** traditionalBubble `dc6332ab799e58a8`, traditionalLive345 `a17489739caa9249`; crapless `4537b96ffb0ea61c` and strict `0ba183bdf8e1412a` unchanged. **Guardrails:** of `src/engine/core` an oracle module may import only `rational.ts` and `dice.ts`, and on any route every import into engine/core from outside it must land on one of them (`dice.ts → rng.ts` is fine, a helper importing `rng.ts` is not); `money.ts` is banned on any route; `src/engine/config` is banned at run time on any route (`import type` is allowed there, while `import type` of rule code is still flagged); reports carry the import chain; ESLint mirrors this with a config-wide pattern (types allowed) and an engine/core pattern, and now also covers `tests/properties`. In core tests and `tests/**`, a host (`globalThis`, `self`, `window`, `global`) may be used only to read a member by name (rule `host-value`; exempt: `typeof`, equality operands, and a name declared with `const`, `let`, `var` or `declare`); Math destructured from a host is `math-value`, or `seeded-random` when it takes `random`; Math through a host is reported in every form; shipped core bans all four hosts outright; ESLint now flags `globalThis.Math.random`, `globalThis.Math[name]` and `Math` as a type (`typeof Math` stays allowed); a test runs the fixtures through both tools and asserts they flag the same lines, and lint fixtures fail on parse errors. Oracle paths compare case-insensitively and import edges resolve to the real file names. The probe asserts direct config violations and helper chains to config modules without relying on `deepFreeze`. **Physics:** `checkStart(rest, params?)` returns a `Validity` (`nonfinite`; `escaped`, a centre outside the dome or below the floor; `overlap`, deeper than `maxOverlap` as given or as Float32 stores it); `simulateThrow` from an `escaped` or `overlap` rest starts from `synthesizeRest` with the same faces (seed `deriveSeed(seed, popRetries + dropTries + 2)`), still throws `RangeError` for `nonfinite`, and throws rather than return an invalid hop; `ThrowResult` gains `rest` (the rest actually used, which the playback plan must be built from) and `start` (`checkStart` of the rest asked for). Golden hash `6030a138dfc5ffd7` and params fingerprint `a715829ad46046a2` unchanged. **Tests:** `tests/golden/validation.test.ts`; `src/engine/table/reducer.test.ts`; `tests/scenarios/{commission,ledger,numberBets,odds,composites,working,presetFacts}.test.ts`; `tests/golden/settlement/{numberVsSeven,commission}.test.ts` (the odd-cent sweep split into place 6/8 rounding up and 4/5/9/10 down); `src/engine/config/{compile,presets/presets}.test.ts`; `tests/architecture.test.ts` (56 → 69 tests); `src/physics/core/{validity,simulate,hop}.test.ts` (a seeded 160-start check that the hop is valid exactly when `checkStart` accepts). **Deviations:** the fallback-chain test now fails every physics attempt with `maxOverlap: 1e-6`, since its old `maxTiltDeg: -1` makes the hop invalid, which now throws (a test of its own); `checkLegal` in `tests/properties/session.ts` uses per-spot limits. **Known limits:** neither tool does scope analysis, so a parameter, shorthand destructuring or later declarator named like a host is reported (rename it; only the scanner reports `const a = 1, window = 2`); in a multi-line destructuring the scanner reports the key's line and lint the host's; unusual type spellings such as `(typeof Math)['random']` are not mirrored exactly. |
| Oracles | done | The four independent oracles (plan §9 items 2–4). The rule oracles were written from the rules spec before any engine code was read; `tests/oracle/dispatchChain.ts` then read only the engine's public API (`index.ts`, `table/{state,actions,events,ledger}.ts`, the reducer's header, `settle/trace.ts`, `BetInstance`, `workingStatus`), never `src/exact`, `tests/scenarios` or `tests/golden`. **Dense solver** (`denseSolve.ts`): one Gauss-Jordan pass over (I−Q)[N\|B\|V] = [I\|R\|r] in BigInt Fractions (expected visits, absorption chances, expected rewards), a different method from `src/exact`'s SCC solver. **Closed form** (`closedForm.ts`, grown from the old file, exports kept): `numberBet` (place, buy, lay, place to lose, big; every commission mode), `oddsBet`/`trueOdds`, `hardway`, `oneRoll` with `byTotal`/`byDice`/`composite`, `lineBet`, `putBet`, `lineWithOdds`/`maxOdds` (both cap bases), `collectSet` by inclusion–exclusion, `fireBet` as a DP, `handConstants`, `handLengthAtLeast`; `analyze(bet)` gives pWin/pLose/pPush, working rolls, lifecycle loss and amount risked, `edge`, `edgeExcludingTies`, `edgePerWorkingRoll`, `heRoll` and a `perDecision` view. `closedFormOf.ts`: `machineBets(facts, amount)` lists every bet a machine offers, and `closedFormOf(facts, bet, paid?)` gives its closed form (null for come and don't come odds OFF on the come-out; `paid: 'exact'` for the nominal edge). `randomMachine.ts`: `editArb`, `commissionArb`, `roundingArb`, `edited`, all inside what config validation accepts. **Dispatch chain** (`dispatchChain.ts`): `dispatchVariant` (1¢ increments, $0.01 minimum, no minimum total), `startTable`, `buildChain` through the real `applyAction(roll { dice })`, `dispatchAnalysis(cfg, bet, 'decision' \| 'lifetime')`, `dispatchBetOf`, `checkAgainstClosedForm`. **Reference rules and table:** per-number rounding (on the win and a lay's vig base) and units (odds caps floor to them); commission from a win capped at the win; re-collection judged after the roll's payouts, with the decline (`RefSettled.vigDeclined`, `vigRearmFromWin`, `vigRearmFromCredit`); `wagered` and `rebetBlocked` in `RefSnapshot` (the differential compares them); the post-seven-out hold ended only by Set bets On, or the point under `until: pointEstablished` (changed from M4d, whose code ended it on a per-bet ON against its own comment). `machineFacts.ts` gains `payoutRoundingOf(type, n)` and `incrementOf(type, n)`, and a composite takes its parts' rounding and `afterWin`, throwing when they disagree (closes M4 integration open item 7). **Results:** every published value of §9 item 5 and rules spec §1.3, §3 and §4.2–§4.4 in `closedForm.test.ts`, by exact equality (percent-only values through `formatPercent`), the three Fire edges pinned as exact rationals; through the reducer the dispatch chain reproduces crapless pass 373/6930, place 6 1/66 (1/216 a working roll), on-win buy 4 1/60, up-front buy 1/21 (1/31 not re-collected), lays 1/60 and 1/41, field, hardways, props, horn, odds and the penny-floor place 6 (17/1100, 1/55); `tests/slow/dispatchChain.slow.test.ts`: 4,354 preset bet × stake cases and 400 random machines against the closed form, 0 mismatches. **Readings** (rules spec): commission taken from a win never exceeds it (§4.3); `wagered` counts the stake of every win, loss and push, bar pushes, a world bet netting 0 and odds returned while OFF included (§0.1); `rebetBlocked` clears at the end of any roll whose next roll is a come-out (§0.2 #5, §5.1); `incrementByNumber` applies to the bet's own number, an odds bet's parent point and a put bet's point, while box line bets, one-roll bets and composites use the type's increment (§4.4 [A]); `payoutRoundingByNumber` applies to the win and to a lay's up-front vig base (§4.1, §4.3); `tableMax` counts every bet, odds and OFF bets included, on additions only; one decision alone counts a stake left up as returned, and a re-collection belongs to the next decision. **For M11:** the published crapless Fire 13.4152% holds only if 6 or more points pay 999 (`payImmediatelyAt: 6`, or tiers for 6–10); paying nothing above 6 gives 17.1059%. |
| M5 | done | Session window, macros and replay (`src/engine/session/`, all in the barrel). **Window** (`window.ts`): `newSession(cfg, seed)`; `dispatchBetting(ws, action, cfg)` → `BettingResult`; `undo(ws, cfg)` → `WindowedSession \| null` (null: nothing to undo); `clearWindow(ws, cfg)`; `rollWindow(ws, cfg, dice?)` → `RollResult { session, events, record }`; `lastWindowOf(committed)`; `SessionHeader { engineVersion, configHash, seed, config }`, where `config` is the validated config input, so a log replays without the machine list; `WindowRecord { actions, roll, hashAfter }`. Every function is pure, a cfg of another config hash throws `RangeError`, and a refused roll leaves the window open and unchanged. **Macros** (`macros.ts`), each returning `readonly Action[]`, empty or one `batch` the table accepts and that changes it: `repeatBets(state, lastWindow, cfg)`, `doubleBets(state, cfg)`, `pressBet(state, betId, won, cfg)`, `maxOutOdds(state, parentId \| null, cfg)`, `takeDownAll(state, cfg)`, and `winsOf(rollEvents)` → `ReadonlyMap<BetId, Cents>`, the net win per bet that Press adds. Every amount comes from `legalBets`, so it is a whole multiple of the bet's unit, per-number units included. **Replay** (`replay.ts`): `replay(header, committed, options?)` → the final table; `replayHistory(...)` → `ReplayedWindow[] { index, start, actionEvents, atRoll, rollEvents, after }`, the §0 #20 roll history; `resumeSession(header, committed, pending, { expectHash? })`; `headerConfig(header)`; a failure throws `ReplayError` whose `failure` is `engineVersion`, `config`, `configHash`, `malformed`, `refused { window, step }` or `hash { window }`; `{ anyEngineVersion: true }` checks a log from another version (plan §8), which then resumes as this version's. **Session log** (`serialize.ts`): `{ format: 'bubble-craps-session', version: 1, header, windows, pending, finalStateHash }` through `serializeSession(ws, space?)`, `deserializeSession(text, options?)` → `LoadResult` (junk is an error, never a throw), `parseSessionLog`, `sessionFromLog` and `toSessionLog`. **Deviations from §4.9 and §8:** accepted actions are logged as plain JSON copies, and one that leaves the table unchanged is not logged, so undo always takes back something visible; deposits are window actions, undoable until the roll, logged and replayed; Repeat repeats only the `place` and `setAmount` actions (batches flattened) of the latest window that made any bets, never deposits or switches, so after a seven-out it places the line bet again, and it is unavailable once a bet it names by id has come down; Double is all-or-nothing on credit and the table maximum, while a bet its own limit refuses (a contract bet, its maximum, the odds cap) is left as it is and the rest are doubled; the header carries the whole config (the fixture is about 100 KB, 30 KB of it config); the log also keeps the open window's `pending`. **Readings:** Press adds the last win rounded down to the bet's unit, capped by its limits and credit; Undo and Clear are Interblock's "Clear Last Bet" and "press twice to clear all" (rules spec §2.5, §9 #19 [A]); a roll refused for the round's minimum keeps the window open (§2.3 step 9). **Fixture** `tests/replay/fixtures/crapless-200.json`: 200 rolls on craplessBubble drawn from seed `crapless-200`, bets before every roll, 8 deposits, 54 macro batches, buy re-collection, odds returned while OFF, hops, the horn and 34 seven-outs; final hash `28d4440b6145393f`, bankroll 44,321¢, deposits 220,000¢, house net 172,679¢; written deterministically by `node tests/replay/record.ts` from the player in `tests/replay/recorder.ts`. **Tests:** `src/engine/session/{window,macros,replay,serialize}.test.ts`; `tests/replay/replay.test.ts`; `tests/properties/session{Window,Macros,Replay}.prop.test.ts` (quick subsets) and `tests/slow/session.slow.test.ts`, on the random-session driver `tests/replay/play.ts`; 14 injected session bugs each failed a test. **Deviation:** the slow suite runs 400 sessions of up to 200 moves on crapless and 150 on each other preset, under §9 item 6's ≥1,000 runs per property, to keep `test:slow` under 5 minutes (1,000 crapless sessions took about 2 minutes; the counts are the `RUNS` table). **Integrator:** `ENGINE_VERSION` bumped to 2 for the M4 audit fixes and the reconciliation, with the fixture re-recorded (only its header's version changed) and its pins updated; see "M5/M6 integration". |
| M6 | done | Exact analysis (`src/exact/`, barrel `index.ts`). **Modules:** `chain.ts` (`buildChain`, `solveBetChain`, `BetSpec { typeId, number }`, `StartContext` (phases weighted, plus `carried`, `working`, `globalOff`, `held`), `Horizon` `decision \| lifetime`, `ExactError`, `DEFAULT_MAX_STATES` 5,000); `solve.ts` (BFS, self-loop normalization, Tarjan SCC, exact Bareiss elimination per SCC in reverse topological order); `price.ts` (`distribution`, `price`, `measure`, `edgeOf`, `settlementCash`, `upfrontCharge`, `analysisKey`, `EXACT_VERSION` 1; distributions cached by config hash, `ENGINE_VERSION`, `EXACT_VERSION`, type, number, start and horizon); `analyze.ts` (`analyzeBet`, `combinedEdge`, `efficientAmounts`, `assumedPaths`, `configPathsOf`, `firstDecision`); `equity.ts` (`analyzeExisting`, `startOfBet`, `takeDownValue`); `standing.ts` (`standingCost`, `workingShare`, `arrivalRate`, `renewalCost`); `layout.ts` (`analyzeLayout`, `perHourAt`, `PACE_RANGE` 60–150); `events.ts` (`sameEvents`); `catalog.ts` (`catalogTable`, `catalogRow`, `catalogSpecs`, `byEdge`); `alternatives.ts` (`suggestAlternatives`); `derive.ts` (`derive`); `sanity.ts` (`sanityCheck`, `checkBet`, `sweepAmounts`, `HIGH_EDGE` 2/5); `wire.ts` (`toWire`, `fromWire`); and the helpers `roundStats.ts` (π, rolls per decision and per hand), `start.ts` (`startAt`, `typicalStart`, `everyPhase`, `pointPhases`, `afterTravel`), `amounts.ts` (`legalAmounts`, `smallestAmount`, `largestAmount`, `exactUnit`, `paysExactly`, `roundingPeriod`; `commissionMinimumBinds` and `minimumFreeFrom` are not in the barrel) and `cache.ts` (`clearAnalysisCache`). **Definitions** (glossary; plan §0 #22, #24): edge = E[loss] ÷ E[amount risked] over the lifecycle, left up until it loses; amount risked = every decision's stake, pushes included, plus up-front vig at placement and on each re-collection, never vig taken from a win (1/60, 1/21); nominal edge is `settle` in exact mode with commission minimums kept; edge per working roll is ÷ stake; equity is the value of the bet's current decision, a stake left up counted as returned; re-collection is priced at the full `upfrontVig`, with enough credit assumed; the policy is no toggles from the start, and standing costs take the Interblock hold as released, because the player sets bets ON; come standing cost is one new bet per point-phase roll, and odds standing cost is per arrival of the parent on the number (a reading: §5.1's table has no odds row). **Deviations:** chains import `AFTER_ROLL` from `bets/policies.ts` and copy the roll's unexported commit step (bets carried, the `nextRollOnly` reset, holds kept for bets still up), which the dispatch-chain oracle guards; labels are `kind:payKey:disposition`, plus `vig:rearm` and `travel:<n>`; chains run at nominal stakes ($1, and $10,000,000 for a parent), so a limit edit never changes an analysis; typical starts are phase distributions (the come box by each point's share of point-phase rolls, come odds just after the come bet travels, number bets the long-run share of every phase), and `startAt(phase)` gives one phase; where a bet works differently new and carried (no preset), the standing working share comes from the exact re-bet cycle; `analyzeLayout` counts each come-type stream once (`LayoutBet.cost` null, with `countedIn`); `sameEvents` compares only bets that stand alone; `sanityCheck` also checks every later decision a winner leaves up (it catches a buy at 21:10 with its vig paid once); catalog rows are priced at the bet's exact unit (rules spec §3.2: $3 place 6 on a penny machine, $6 live, $20 live buy), with `atMinimum` at the smallest legal stake. **Sanity** (plan §4.4, rules spec §4.2): an edge below 0 at any legal stake is an error, swept over one rounding period (lcm with the stake step) from the minimum and from where a vig minimum stops binding; above 40% at the exact unit is a warning; ceiling and half-up rounding on lay odds are rejected. **Acceptance:** every non-side published value of §9 item 5 in `tests/golden/published.test.ts` (23 tests, exact equality); closed-form fuzzing and the dispatch chain in the Reconciliation row; the standing identity and config-path invariance in `tests/properties/exact{Standing,ConfigPaths}.prop.test.ts` (quick) and `tests/slow/exact.slow.test.ts`; `node scripts/edges.ts --preset crapless-bubble` (also `craplessBubble`, `--sort edge`) prints the table; `src/exact/perf.test.ts`: the cold non-side catalog in 37–60 ms per preset (crapless 74 rows), pricing 3.5 µs a call; fingerprints in `src/exact/__snapshots__/catalog.test.ts.snap`. |
| Reconciliation | done | The four M6 comparisons, all at 0 mismatches. (1) **Reference differential** (`tests/slow/reference.slow.test.ts`): 2,000 × 100 actions on each of 18 machines, the 4 presets and the 14 variants of `tests/properties/machineVariants.ts` (`MACHINE_VARIANTS`, `DIFF_MACHINES`, each naming its knobs: `nextRollOnly`, `anySeven`, `until: pointEstablished`, per-bet toggles with the hold, `tableMax`, `recollectFromCredit`, `rearm: none` with refunds, a $50 vig minimum, lay re-collection from credit, `payoutRoundingByNumber`, `incrementByNumber`, the Reno bar, `countOff` and held lays); the quick run is 150 × 100 per machine (`tests/oracle/reference.diff.test.ts`). The generator aims odds at parents that are up (1 in 12 still names none, so those refusals stay tested), plays the don't side one time in three and stakes in per-number units (NO_PARENT refusals fell from about 750 to 63 per 150 runs). The bars: every odds type placed ≥150 times (≥10 quick) and each commission event the machine can reach (placement, increase, re-arm from the win and from credit, decline, decline refund, take-down refund) ≥20 times (≥1 quick), with `wagered` and `rebetBlocked` compared after every action and refusal codes differing only where the engine answers `CONTRACT_BET` first (asserted). (2) **Closed-form fuzz** (`tests/slow/exactOracles.slow.test.ts`): 600 random machines (pay ratios, commission basis, timing, rounding, minimum and re-arm, payout roundings, after-win rules, stakes 1¢–$50, half on a buy or lay), at least 300 compared (551 at the pinned seed), plus every bet of every preset and pricing variant at §9 item 4's stakes and odd cents. (3) **Dispatch chain against `analyzeBet`:** every bet of every preset and 6 pricing variants at 101, 500, 600, 1,000 and 2,500¢ on `dispatchVariant`, 13 metrics each (1,695 preset bet × stake cases): lifetime horizon for edge, loss, amount risked and edge per working roll, decision horizon for the chances and rolls. (4) **Published values** through both the closed form and `analyzeBet` (and `roundStats`, `combinedEdge`): `tests/oracle/published.diff.test.ts`, 17 tests. Quick subsets of (2) and (3): `tests/oracle/exact.diff.test.ts`; helpers in `tests/properties/exactOracles.ts`. The exact sweeps skip the 8 variants whose knobs a lone bet never meets (`prices: false`). **Mismatches settled:** pressing an excluded buy (strictBubble, seed 20261028, run 1048: buy 9, don't pass, roll 4-5, add $1 to buy 9) — the engine was wrong: IB221's setting "will prevent the player from wagering on the Buy bet of the established Point", so exclusions now block additions too, by `place` or a `setAmount` increase, while cuts and take-downs are allowed (`bets/validate.ts`; rules spec §5.1, §9 #30), and the oracle's `setAmount`, which let the same press through, was fixed too; a lay held after a seven-out meeting Interblock's lay re-enable (`strict-lay-held`, run 24) — the oracle was wrong: only Set bets On, or the point under `until: pointEstablished`, ends the hold (rules spec §2.3 step 8, §2.4, §9 #31). Both replay through both models under "adjudicated mismatches (M6 reconciliation)". **Reading:** edge per working roll is ÷ stake (plan §5.1, glossary: a re-collected buy 4 is 1/80); rules spec §0.1's HE_roll ÷ (stake + vig) (1/84) stays a table term of the rules spec, reproduced only by the closed form's `heRoll`. Slow tests allow 600 s each, because this machine (8 GB, swapping) once stalled runs that had already passed; they take seconds. |
| M5–M14 | pending | |
