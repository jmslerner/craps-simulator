# Craps strategy specs for the strategy bot and the Monte Carlo lab (bubble craps), reviewed

Review status (2026-10-28): every figure was re-derived with exact fractions (`python3 fractions`) or numpy Markov-chain solves rationalized back to fractions. "≈" marks a float solve or a truncated enumeration. Non-math claims cite §7 keys. Every key except [YT-*], [5c-sec] and [5c-sec2] was re-fetched in this review. **[DEFAULT]** = a reviewer-chosen gap filler. **[UNVERIFIED]** = still uncertain. Both must be engine or bot parameters.

## 0. Where each definition comes from

| Group | Written canonical rules found? | How the spec was built |
|---|---|---|
| Pass + odds, Don't Pass + lay, Come / 3-Point Molly, 3-Point Dolly, Place 6&8 (± regression, hit-and-run), Inside/Across, Iron Cross, 5-Count, Martingale / Anti-Martingale / Paroli / 1-3-2-6 / D'Alembert / Fibonacci | Yes: [WoO-*], [WoV-3PM], [WoV-Dolly] (the Wizard's own definition and simulation), [HR], [MC], [BC-*], glossaries | Sourced; variants listed |
| Power Press | Partly: press taxonomy [CC-press][PNat]; step lists "Power Press and Pull", "Press Press Regress", "Power Press", "Reluctant Double-Tap" [MC]; [BC-PP] | Parameterized from these sources |
| Three-Hit Challenge | The name has no source. The 3-hit patterns do: "Basic Hedge", "The Pass Over Method", "Windstar Walk" [MC]; hit-and-run after 2–3 wins [HR] | CODIFIED |
| Bankroll Builder, Fibonacci Press, Cover hedge, Low-Investment Hunting | No. Only YouTube titles exist [YT-*] [UNVERIFIED: titles not re-fetched]. Web searches for these names return no rule text. | CODIFIED from the most common community pattern, fully parameterized. Label these "codified" in the UI, not "official". |
| "$32 Inside", "$44 Across" | No authoritative source; one spam-mirror page uses "thirty-two inside". The standard terms are "$32 Across" and "$44 Inside" [MC][BS-across]. | Standard presets plus literal-parse presets (§3.5) |

## 1. Exact math the engine and coaching layer need

### 1.1 Per-bet edges (standard paytables; all re-verified; match [WoO-basics])

| Bet | Payout | Edge per $ resolved | Expected loss per roll while working, per $ |
|---|---|---|---|
| Pass / Come | 1:1 | 7/495 = 1.4141% | 7/1671 = 0.4189% |
| Don't Pass / Don't Come (bar 12) | 1:1 | 3/220 = 1.3636% per $ made; 27/1925 = 1.4026% per $ resolved | 0.4039% |
| Odds, take or lay | 2:1, 3:2, 6:5 / 1:2, 2:3, 5:6 | 0 | 0 |
| Place 6/8 | 7:6 | 1/66 = 1.5152% | 1/216 = 0.4630% |
| Place 5/9 | 7:5 | 1/25 = 4.0000% | 1/90 = 1.1111% |
| Place 4/10 | 9:5 | 1/15 = 6.6667% | 1/60 = 1.6667% |
| Buy 4/10, 5/9, 6/8; 5% of the bet deducted from the win (STW) | 2:1, 3:2, 6:5 (net per $1: 1.95, 1.45, 1.15) | 1.6667%, 2.0000%, 2.2727% | 0.4167%, 0.5556%, 0.6944% |
| Buy; 5% vig paid upfront, not refunded | same | 1/21 = 4.7619% of (bet + vig) | 1.19%, 1.32%, 1.46% of (bet + vig) |
| Lay 4/10, 5/9, 6/8; 5% of the win deducted from the win (STW) | 1:2, 2:3, 5:6 | 1.6667%, 2.0000%, 2.2727% | 0.4167%, 0.5556%, 0.6944% |
| Lay; 5% of the win paid upfront | same | 2.44%, 3.23%, 4.00% | 0.61%, 0.90%, 1.22% |
| Place to lose 4/10, 5/9, 6/8 | 5:11, 5:8, 4:5 | 1/33 = 3.0303%, 1/40 = 2.5000%, 1/55 = 1.8182% | 0.7576%, 0.6944%, 0.5556% |
| Field, 2 pays 2:1, 12 pays 3:1 (Vegas live) | — | 1/36 = 2.7778% | same (one roll) |
| Field, 2 and 12 both pay 2:1 (STW default) | — | 1/18 = 5.5556% | same |
| Any 7 | 4:1 | 1/6 = 16.667% | same |
| Any Craps / C | 7:1 | 1/9 = 11.111% | same |
| C&E | 3:1 on craps, 7:1 on 11 | 1/9 = 11.111% | same |
| Horn (¼ on each number) | 15:1 / 30:1 | 1/8 = 12.5% | same |
| Yo / E (11) | 15:1 | 1/9 = 11.111% | same |
| 2 or 12 | 30:1 | 5/36 = 13.889% | same |
| Hop hard / hop easy (STW) | 30:1 / 15:1 | 5/36 = 13.889% / 1/9 = 11.111% | same |
| Hard 6/8 | 9:1 | 1/11 = 9.0909% | 1/36 = 2.7778% |
| Hard 4/10 | 7:1 | 1/9 = 11.111% | 1/36 = 2.7778% |
| Big 6/8 | 1:1 | 1/11 = 9.0909% | 1/36 = 2.7778% |
| Crapless pass line | 1:1 | 373/6930 = 5.3824% | — |
| Crapless place 2/12 | 11:2 | 1/14 = 7.1429% | — |
| Crapless place 3/11 | 11:4 | 1/16 = 6.25% | — |

- **STW Power Odds** [STW §34] are random one-roll boosts:
  - Any Craps / C: 10:1 or 14:1. Any 7: 6:1 or 8:1.
  - E / easy hop / horn 3-11: 22:1 or 30:1. Horn 2-12 / hard hop: 45:1 or 60:1.
  - C&E: craps 4:1 or 6:1; 11 pays 10:1 or 14:1.
  - Hard 4/10: 10:1 or 14:1. Hard 6/8: 13:1 or 18:1.
  - The trigger frequency is not published [UNVERIFIED]. The edges above exclude boosts.
  - Any 7 breaks even only if it is boosted on 1/2 of rolls at 6:1, or 1/4 at 8:1 (exact).

### 1.2 Hand constants and closed forms

A **hand** runs from the come-out after a seven-out to the next seven-out, inclusive.

| Quantity | Exact value |
|---|---|
| Expected rolls per hand | 1671/196 = 8.5255 (crapless: 57678/7303 = 7.8979) |
| Expected point-phase rolls per hand | 6 exactly (each point-phase roll is a 7 with probability 1/6) |
| Expected come-out rolls per hand = pass decisions per hand | 495/196 = 2.5255 |
| Expected rolls per pass decision | 557/165 = 3.3758 |
| P(seven-out) per decision | 196/495 |
| P(shooter makes at least one point) | 67/165 = 40.606% |
| Share of rolls that are come-outs | 495/1671 = 29.62% |

**Hits on a place set.** Take a set S of place bets that work only in the point phase, include the point number, and are OFF on the come-out. The number of hits before the seven-out is geometric:
- P(k) = q^k (1 − q), with q = W(S) / (W(S) + 6), where W(S) is the number of dice combinations that roll a number in S.
- q values: {6,8} = 5/8; {5,6,8} = 7/10; Inside = 3/4; Across = 4/5; a single 6 = 5/11; a single 5 = 2/5; a single 4 = 1/3.
- Making the point and sitting through come-outs does not change these odds.
- The closed form needs the same set S in every point phase. Layouts that exclude the point, or that take bets down, regress or press on set-level counters, need the Markov chain over (phase, point, counters).
- For a single number n with a per-number ladder amt_j: EV_n = Σ_k q_n^k (1 − q_n) · [Σ_{j<k} amt_j · pay_n − amt_k]. This is exact for any press, regression or rack drop, because every change in amt is money moved between the rack and the layout.

**Static place layout:** expected loss per hand = 6 × Σ (amount × per-roll edge).

**Theoretical-loss accumulator** (use the same one for coaching and the lab):
- Add amount × per-roll edge for every working non-contract bet on every roll.
- Add flat × 7/495 when a Pass or Come bet is placed, and flat × 3/220 for Don't Pass or Don't Come. A bet re-made after a 12 push counts as a new placement.
- Odds add 0.
- Upfront vig: add the vig at placement, and subtract it if it is refunded on take-down.
- Removing a Don't Pass or Don't Come bet after it travels forfeits its equity: 1/3 on 4/10, 1/5 on 5/9, 1/11 on 6/8, times the flat. [WoO-sys]: "You should never remove a don't pass bet after a point is made!"

**Handle** (money resolved) adds the bet amount on every win or loss. Pushes, returned off-bets and take-downs are excluded. With an upfront vig, count bet + vig.
- Edge per $ resolved = theoretical loss ÷ resolved handle.
- Edge per $ made = theoretical loss ÷ new money placed.

### 1.3 Line bet + odds (exact)

| Odds allowed | Pass + odds, edge per $ (made = resolved) | Don't Pass + lay, win-basis (lay to win k × flat): per $ made / per $ resolved | Don't Pass + lay, risk-basis (lay k × flat), per $ made | SD per decision in flats (Pass / DP win-basis) |
|---|---|---|---|---|
| none | 1.4141% | 1.3636% / 1.4026% | — | 1.000 / 0.986 |
| 1x | 0.8485% | 0.6818% / 0.6914% | 0.8182% | 1.893 / 1.886 |
| **2x (STW rule card)** | **0.6061%** | **0.4545% / 0.4588%** | **0.5844%** | 2.858 / 2.853 |
| 3x | 0.4714% | 0.3409% / 0.3433% | 0.4545% | 3.841 / 3.837 |
| 3-4-5x (Don't side lays 6× flat, i.e., wins 3/4/5×) | 0.3743% | 0.2727% / 0.2743% | same as win-basis | 4.916 / 4.913 |
| 5x | 0.3263% | 0.2273% / 0.2283% | 0.3147% | 5.824 / 5.822 |
| 10x | 0.1845% | 0.1240% / 0.1243% | 0.1779% | 10.81 / 10.81 |

- Closed forms:
  - Pass: (7/495)/(1 + 2k/3).
  - DP win-basis: (3/220)/(1 + k).
  - DP risk-basis: (3/220)/(1 + 2k/3).
  - Pass 3-4-5x: (7/495)/(1 + 100/36).
- Expected loss per decision is always 7/495 × flat (Pass) or 3/220 × flat (Don't Pass). Odds never change that dollar figure; they only dilute it per dollar.
- [WoO-basics] lists Don't Pass "Bet Resolved" as 0.701% (1x), 0.468% (2x) and 0.281% (3-4-5x). Those equal the per-made figure × 36/35: the Wizard removes the 1/36 push from the odds handle as well. The engine uses this spec's column (loss ÷ resolved handle); show the Wizard's figures only for cross-reference.
- Crapless Pass + odds, per $ made (P(point) = 5/6): 1x 2.936%, 2x 2.018%, 3x 1.538%, 5x 1.042%. Crapless odds pay 6:1 on 2/12 and 3:1 on 3/11 [WoO-crapless].

### 1.4 Penny payouts: rounding

The rounding mode is not documented anywhere; make it an engine parameter `round` ∈ {FLOOR, HALF_UP, EXACT}.

| Place 6/8 at 7:6 | $1 | $2 | $3 | $4 | $5 | $6 | Any multiple of $3 |
|---|---|---|---|---|---|---|---|
| Floor to the cent | 1.818% | 1.591% | 1.515% | 1.591% | 1.545% | 1.515% | 1.515% (exact) |
| Round half-up | 1.364% | 1.591% | 1.515% | 1.477% | 1.545% | 1.515% | 1.515% |
| Live table (whole dollars, floored) | 9.09% | 9.09% | 9.09% | 9.09% | 9.09% | 1.515% | — |

- Place 4/5/9/10, Pass/Come odds and buy vig (5% of the bet) are cent-exact for any whole-dollar bet.
- **Lay odds (no commission)** are cent-exact for any $1 on 4/10 and for multiples of $3 on 5/9 and 6/8. Other sizes depend on the rounding mode:
  - Round half-up makes some sizes player-positive: $1 on 5/9 +0.200%, $4 on 5/9 +0.050%, $2 on 6/8 +0.091%, $5 on 6/8 +0.036%.
  - Floor: $1 on 5/9 −0.400%, $2 on 6/8 −0.182%.
- **Lay bets (5% of the win deducted)** are net-cent-exact only in multiples of $2 (4/10), $3 (5/9) and $6 (6/8). The same multiples give whole-dollar lay-odds payouts on live tables.
- **Bot grid on penny machines:** place 6/8 in multiples of $3; place 5/9 and 4/10, buy, and Pass/Come odds in any $1; lay odds $1 (4/10) and $3 (5/9, 6/8); lay bets $2 / $3 / $6.
- **Live grid:** place $5 (4/5/9/10) and $6 (6/8); lay odds $2 / $3 / $6.

## 2. Bot interface (declarative, covers every state)

```
decide(ctx):                      // every bet window, before each roll
  ev = classify(lastRoll, prevPhase, prevPoint, crapless)
       // NEWHAND | NAT | CRAPS | EST(p) | MADE(p) | SEVEN_OUT | OTHER, plus wins[], losses[], pushes[]
  S.update(ev, ctx)                                    // strategy counters
  g  = sessionGate(ctx)                                // CONTINUE | WIND_DOWN | STOP
  T  = (g == CONTINUE) ? S.target(ctx) : windDown(ctx)
  B  = applyMachineAutoActions(ctx.bets, ev, ctx.machine)   // auto re-bets, auto ON/OFF (§2.1)
  return reconcile(B, T, ctx.machine, ctx.bankroll)
```

- Crapless: a come-out 2, 3, 11 or 12 is EST(p); only 7 is NAT; there is no CRAPS event.

**Context.**
- `phase` ∈ {CO, PT}; `point` (crapless adds 2, 3, 11, 12); `lastRoll` {d1, d2, sum, hard}.
- `bets[]` with {type, number, amount, odds, working, contract}; `comePoints` C; `dontComePoints` D.
- Hand counters: H = place/buy hits this hand; h[n] = hits on n; `pointsMade`, `rollsInHand`, `handPL`.
- Session values: `bankroll`, `sessionPL`, `peakPL`, `guarantee`, `hands`, `rolls`; `vars` for strategy state.
- `machine` profile: {min, max, minScope, grid, round, maxOdds(p), layBasis, dcOddsOnCO, placeOnCO, fieldPay12, oddsRemovable, autoRebet, comeWinBanked, exclusivity, dpAvailable, crapless, propGate}.

**Common counter rules.**
- NEWHAND (session start, or the window after a SEVEN_OUT): H = 0, h[·] = 0, `handPL` = 0, then the strategy's own resets.
- A place/buy win on n is a hit: H++, h[n]++. If a place bet is up on the point number, it wins on MADE(p) and counts as a hit.
- Come-bet wins are not hits unless a strategy says so [DEFAULT].
- Place bets are OFF on the come-out, so H cannot move during come-outs.

**Universal state table.** These are the defaults for every strategy unless its own table overrides a row.

| State / event | Default action |
|---|---|
| SESSION_START | NEWHAND; session counters = 0 |
| CO window | Place the strategy's come-out bets. Cancel machine auto-continuations the strategy does not want: a Pass can be cancelled only before its point [STW §5e]; field and one-roll bets any time [DEFAULT]. Place/buy/hardways/Big 6/8 stay OFF: STW turns them off automatically with no toggle [STW §4]; on live tables they stay OFF unless `placeOnCO` (default false) [WoO-basics] |
| NAT / CRAPS on the CO | Contract bets resolve; counters unchanged (except FIVE_COUNT) |
| EST(p) | Build the strategy's point-phase layout. Take down bets on excluded numbers; a take-down is not a resolution |
| PT roll, nothing resolves | No change |
| HIT(n): place/buy/come on n wins | Strategy press rule; default SAME (collect the win, bet stays) [DEFAULT] |
| One-roll bet wins or loses | Re-bet per the strategy schedule. Cancel off-schedule winners the machine auto-continued [STW §32] [DEFAULT] |
| MADE(p) | Line bets resolve; place levels and H are kept; non-contract bets go OFF for the CO (machine). Cancel an auto-continued field or prop unless scheduled for the CO [DEFAULT] |
| SEVEN_OUT | NEWHAND; then the session gate |
| Bankroll below the target's cost | Fund in priority order: contract → odds → 6/8 → 5/9 → 4/10 → lay → props. Odds = largest affordable grid amount (may be 0); skip the rest. If the come-out contract bet is unaffordable and no contract bet is live → STOP [DEFAULT] |
| Odds cap, per-bet max or table max reached | Clamp. A press that would exceed the cap becomes SAME. Doubling progressions bust and reset to base [DEFAULT] |
| Target below the machine minimum | `skip` (default) or `raise` |
| Machine rejects a combination | Keep the higher-priority group: contract > odds > place/buy > lay/place-to-lose > props [DEFAULT] |
| Gate = WIND_DOWN or STOP | See the session gate |

**reconcile() rules.**
1. **Contract bets.**
   - Never cancel or reduce a Pass or Come flat after its point is set [STW §5e, §9e].
   - Never cancel a Don't Pass after the point, and never place or increase one after the point [STW §11d–e].
   - Treat a Don't Pass or Don't Come that has travelled as contract on every machine. Removal is legal on live tables but forfeits equity (§1.2). The STW Don't Come text is silent on cancelling [UNVERIFIED].
2. **Timing.**
   - Come and Don't Come only in point-phase windows [STW §9b, §14b].
   - Pass and Don't Pass only in come-out windows; put bets are off (`allowPut` = false) [DEFAULT].
   - Odds only behind an established point or come point [STW §6b, §10b, §12b, §15b].
3. **Working status on the come-out.**
   - Come odds, place, buy, hardways and Big 6/8: OFF.
   - Don't Come odds: ON on live tables [WoO-basics]. On STW the auto-OFF rule says generic "ODDS", so the STW profile defaults to `dcOddsOnCO` = OFF [UNVERIFIED].
   - Lay, place-to-lose, field and props: ON.
4. **Odds caps.**
   - Pass/Come odds ≤ maxOdds(p) × flat; STW is 2x on every point [STW §6e–g, §10d–f].
   - Don't Come lay ≤ 2 × flat ÷ odds ratio, i.e., win-basis [STW §15d–f].
   - Don't Pass lay: "2 times the bet" → `layBasis` [STW §12e–g].
5. **Grid.** §1.4. Regressions round down; power presses round up; plain targets round to the nearest grid amount.
6. **Minimums.** `minScope` ∈ {PER_BET, TOTAL_ON_GAME}. Hot Shooter requires ≥ 3 credits on the craps game [STW §33b]. One machine allows prop bets only after a $15 bet [WoV-9005].
7. **Exclusivity** (STW): no Pass + Don't Pass; no Come + Don't Come; "PLACE and PLACE TO LOSE/LAY" and "BUY and LAY/PLACE TO LOSE" cannot be bet for the same roll [STW §5f, §9f, §11f, §14e, §21].
8. **Auto-actions.** Diff against the layout after the machine's auto re-bets [STW §29–32]. Some machines bank a winning Come bet instead of riding it [WoV-9005].
9. **Bankroll.** As in the universal table. Never abandon live contract bets: STOP means WIND_DOWN first.

**Session gate** (checked at hand boundaries by default; `checkEveryRoll` is optional).
- **Session bankroll:** SB = 30–50 units ("A solid session bankroll is 30 to 50 units of your base bet") [AoC]. Alternative: bets of 1–2% of SB, i.e., 50–100 units [HR].
- **Stop-loss:** 40–50% of SB [AoC]. [HR] only says the loss limit should never exceed the whole session amount.
- **Win goal:** 30–50% of SB [AoC]; 50% [HR].
- `winGoalAction` ∈ {STOP, LOCK}. AoC gives both without reconciling them [AoC]:
  - STOP: "Walk away when you hit either your pre-set win goal or loss limit".
  - LOCK: the guarantee-and-excess method below.
- **LOCK rule, fitted to AoC's example** (buy-in $400; at a $650 stack, guarantee = $500; at $800, "move $75 of that new $150 gain", so guarantee = $575):
  - When sessionPL first reaches the win goal: guarantee = lockInit × sessionPL, with lockInit = 0.4 (the example's 100/250) [DEFAULT]; hi = sessionPL.
  - On every new high: guarantee += lockFrac × (sessionPL − hi), with lockFrac = 0.5 [AoC]; then hi = sessionPL.
  - STOP when sessionPL ≤ guarantee.
- Also stop at maxHands or maxRolls, or when the bankroll cannot fund the base layout.
- **WIND_DOWN:**
  - Place no new bets.
  - Take down place, buy, lay, place-to-lose, hardways, field and props, plus odds if `oddsRemovable` (live: true [WoO-basics]; machines [UNVERIFIED]).
  - Leave Pass, Come, Don't Pass and Don't Come flats (and their odds) to resolve.
  - Cancel the auto-re-bet Pass in the next come-out window.
  - STOP when no contract bet remains.

### 2.1 Machine constraints that affect strategies

| Parameter | Observed variants | Source |
|---|---|---|
| Come-out ON/OFF | STW: "ODDS/OLACE[sic]/BUY/HARDWAYS/BIG6/BIG8 are automatically turned OFF until the Point is established and then are automatically turned ON"; no player toggle is documented. "ODDS" is generic: come odds are OFF; Don't Come odds [UNVERIFIED], defaulting to OFF on the STW profile. Live tables: come odds, place and buy OFF; Don't Come odds and lay ON; hardways ON in Las Vegas and OFF in Atlantic City | [STW §4][WoO-basics] |
| Lay, place-to-lose, field and props on the come-out | Not in STW's list, so working (inference) | [STW] |
| Cancel / remove | STW: Pass, Come and Don't Pass cannot be cancelled after their point; the Don't Come text is silent. "You can call off, or cancel, all your bets at any time, though some bets, like the Pass Line, can't be cancelled" (2013). One bubble guide: "You can temporarily de-activate a Place bet, or take it down altogether" | [STW §5e, §9e, §11e][VV-STW][CO-bubble] |
| Pass/Come odds cap | **2x:** STW rule card (2025); Binion's and Gold Strike (2012); "only allows me to bet 2X Odds" (2021); a 2x example in 2022. **3x:** Bellagio, MGM, NYNY (2012). **5x:** Palms, Riviera, Monte Carlo, Sunset Station (2012); NYNY (a 2011 report); Palms, Hooters, Slotsafun, El Cortez (2014); Resorts World NYC ("I think … 5x"). **3-4-5x:** Aqueduct (2014). A strategy article says "usually 2x or 3x". **Default: 2x.** | [STW][WoV-9005][WoV-36634][WoV-37778][CO-bubble] |
| Don't-side odds cap | STW Don't Come: "2 times the bet on DON'T COME … divided by the corresponding DON'T COME ODDS", i.e., win-basis. STW Don't Pass: "2 times the bet on the DON'T PASS LINE" (ambiguous). "You can only bet 2x on either pass or don't pass." One machine capped lays at $500 ("NO Laying the 4 for $1,000") | [STW §12, §15][WoV-9005] |
| Payout precision | "The proper payout will be made to the odd penny"; "Fractional payments on breakage bets"; place 6/8 "would pay 116.67%". Reader comments (not the article): "down to the penny", no multiples of $6 needed, "$1 increments" | [WoV-9005][WoV-36634][VV-STW comments] |
| Buy and lay vig | STW buy: "5% of the BET amount is deducted from the win". STW lay: "5% of the WIN pay amount is deducted from the win". NYNY and Gold Strike "took the vig for all buys and lays after a win". "1.45X for a 5 or 9 Buy Bet" | [STW §18, §20][WoV-9005][WoV-36634] |
| Field 2 / 12 | STW pays 2:1 / 2:1 ("a 12 on the field pays double"); Vegas live tables pay 2:1 / 3:1 | [STW §8][VV-STW][WoO-basics] |
| Exclusivity | No Pass + Don't Pass; no Come + Don't Come; no Place with Place-to-lose/Lay, and no Buy with Lay/Place-to-lose, "for the same roll" | [STW §5f, §9f, §11f, §14e, §21] |
| Auto re-bet | A winning Pass "continues … until a loss". A Don't Pass/Don't Come winning on its first roll continues "until a loss or a point is established". A Come bet winning on 11 continues. Winning place, buy, hardways, field, lay, place-to-lose, props, hop and Big 6/8 continue unless cancelled. So a field that wins on a point made with 4/9/10 rides into the come-out. | [STW §29–32] |
| Come-bet win on another machine | "The machine takes the bet and puts it into your bank so you have to rebet it again" (Aqueduct, 2014) | [WoV-9005] |
| Minimums | $1: Binion's, Sunset Station (2012), Palace Biloxi (2022). $2: Palms, Riviera. STW: "$5, and possibly less" (2013). $10: Resorts World NYC. $15: Aqueduct (2014) | [WoV-9005][WoV-37778][VV-STW] |
| Prop gating / side bet | "Once you bet 15, you can make smaller bets of prop bets"; "No hop bets, no fire bets" (Aqueduct). Hot Shooter: ≥ 3 credits on the craps game; placed only in the come-out window after a 7-out; $1–$1000 | [WoV-9005][STW §33] |
| Don't availability | Don't Pass and Don't Come are "(IF AVAILABLE)". Crapless: "There is no don't pass bet in this game" | [STW §11, §14][WoO-crapless] |
| Shooter | A designated player presses a button; this "does not affect the roll result of the game" | [STW §35] |

## 3. Strategy specs

**Notation.** Each table lists the states where the strategy differs from the §2 universal table; every unlisted state follows §2. Defaults assume u = $5 on a live-style grid.

### 3.1 PASS_ODDS (Pass line + maximum odds)

- **Sources:** [WoO-basics]; [CO-bubble] ("the bubble strategy starts with a Pass Line bet when the dice are coming out"; odds "usually 2x or 3x").
- **Parameters:** u; k (`MAX` = maxOdds(p)); `oddsGrid` (live: even dollars on 5/9 and multiples of $5 on 6/8 [DEFAULT]; penny: $1).

| State / event | Target / action |
|---|---|
| CO window | Pass = u. STW re-places a winning Pass automatically [STW §29] |
| NAT / CRAPS | Resolved; Pass = u at the next come-out |
| EST(p) | Odds = floorGrid(min(k, maxOdds(p)) × u); if short of bankroll, the largest affordable amount, possibly 0 [DEFAULT] |
| PT roll ∉ {p, 7} | No change |
| MADE(p) | Flat + odds paid; Pass = u at the next come-out |
| SEVEN_OUT | Flat + odds lose; NEWHAND |
| Bankroll < u in a CO window, no live contract bet | STOP [DEFAULT] |

- **Math:** EV per hand = −u/28; loss per roll 7/1671 u = 0.004189u. SD per decision 2.858u (2x), 4.916u (3-4-5x).
- **Bubble:** STW's 2x cap gives 0.6061%.

### 3.2 DONT_PASS_LAY (dark side) and DOLLY3

- **Sources:** [WoO-basics]; [WoO-sys] ("You should never remove a don't pass bet after a point is made"; equity 9.09% on 6/8, 20% on 5/9, 33.33% on 4/10); [STW §11, §12, §14, §15, §30]; [WoV-Dolly].
- **Parameters:** u; k; `layBasis` ∈ {WIN, RISK}. Lay amount L(p) = WIN ? k·u·T(p) : k·u, with T = 2 (4/10), 1.5 (5/9), 1.2 (6/8).
- **Lay-odds grid:** live (whole-dollar payouts) $2 / $3 / $6; penny $1 / $3 / $3 (§1.4).

**DONT_PASS_LAY**

| State / event | Target / action |
|---|---|
| CO window | Don't Pass = u (unavailable on some machines and in crapless) |
| CO roll 2/3 | Don't Pass wins. STW keeps it up automatically [STW §30]; otherwise re-bet u |
| CO roll 7/11 | Don't Pass loses; re-bet u |
| CO roll 12 | Push; the bet stays |
| EST(p) | Lay odds = L(p), capped (§2 rule 4); if short of bankroll, the largest affordable grid amount [DEFAULT] |
| PT roll ∉ {p, 7} | No change |
| MADE(p) | Don't Pass + lay lose; Don't Pass = u at the next come-out |
| SEVEN_OUT | Don't Pass + lay win; NEWHAND |
| Any window | Never remove the Don't Pass (STW forbids it after the point) |

- **Math:** 2x win-basis 0.4545% per $ made; 2x risk-basis 0.5844%; 3-4-5x (lay 6× flat) 0.2727%. EV per hand = −27/784 u = −0.03444u.
- **Bubble:** Don't Pass may be unavailable; it cannot be combined with Pass (no Doey-Don't) [STW §5f, §11f].

**DOLLY3** (the Wizard's 3-Point Dolly [WoV-Dolly])

The Wizard's definition:
- "Player makes don't pass, don't come, and lays odds only."
- One-unit flats.
- Maximum lay odds; his simulation assumes 3-4-5x, i.e., lay 6× flat on every point.
- "Player always makes a don't pass or don't come bet on every roll except if he already is on three numbers."
- "Player quits on the seven out."

Parameters: N = 3 numbers; `dcOddsOnCO` (live: ON; STW: OFF [UNVERIFIED]).

| State / event | Target / action |
|---|---|
| CO window | If covered(D) < N and there is no Don't Pass: Don't Pass = u |
| CO roll 7 | Don't Pass loses. Every Don't Come point wins, with its lay odds if `dcOddsOnCO`, otherwise the odds are returned. D = ∅ |
| CO roll 11 | Don't Pass loses |
| CO roll 2/3 or 12 | Don't Pass wins, or pushes |
| CO roll n (point number) | Don't Pass travels to n; lay L(n). If n ∈ D, the Don't Come on n loses, with its odds if working, otherwise the odds are returned |
| PT window | If covered(D ∪ {p if a Don't Pass is on p}) < N and the Don't Come box is empty: Don't Come = u |
| PT roll 11 / 2,3 / 12 | Box Don't Come loses / wins (STW keeps it up [§30]) / pushes |
| PT roll n ≠ p | The Don't Come on n (if any) loses. The box Don't Come travels to n; lay L(n) |
| PT roll p | Don't Pass + lay lose. The box Don't Come travels to p. Next window is a come-out |
| SEVEN_OUT | Don't Pass, Don't Come points and lay odds win; the box Don't Come loses. The hand ends (Wizard: the session ends) |
| Any window | Never remove a Don't Pass or a travelled Don't Come |

- **Exact:**
  - Flats per hand 77671/12740 = 6.0966, the same as the 3PM.
  - EV per hand −21183/254800 u = −0.083136u (Wizard simulation: 0.08315).
  - Units resolved per hand at 3-4-5x: 30.314 (Wizard: 30.313926). 0.2743% per $ resolved, 0.2727% per $ made.
  - With 2x win-basis lays (STW Don't Come cap): 0.4588% per $ resolved, 0.4545% per $ made.
  - P(hand > 0) = 67.98% (Wizard simulation, 3-4-5x).
- **Variant DARK_DOLLY [MC]:**
  - $30 Don't Pass + $2 Yo + $1 Midnight on the come-out.
  - After the point: a $10 Don't Come + a hardway hedge on the point. A second $10 Don't Come once the first travels.
  - Ride to the 7-out, replacing fallen bets. If the point hits, restart even with Don't Comes still up.

### 3.3 MOLLY(K): come betting (3-Point Molly is K = 2, 2-Point Molly is K = 1)

- **Sources:**
  - [WoV-3PM]: "It's just making come bets until up to three point numbers are covered" (Ace2). "Three come bets with odds" (AlanMendelson, a K = 3 variant). "Increases your total bets made by a factor of 2.4 and standard deviation by a factor of 1.9."
  - [HR]: "making continuous Come bets to establish three separate point numbers."
  - [BC-3PM]: "Once three points are working, stop adding new Come bets."
  - [WoO-sys]: with full odds "it doesn't make any difference how many come bets you make."
  - The 2-Point Molly has no source; it is defined by analogy.
- **Parameters:** K; u; k; `comeOddsOnCO` = OFF (STW automatic; live default).
- The Pass point is never in C during a point phase, because a come bet that travels to p makes the point on the same roll. So K counts distinct numbers.

| State / event | Target / action |
|---|---|
| NEWHAND | C = ∅ |
| CO window | Pass = u. Come flats stay (contract). Come odds stay but OFF |
| CO roll 7 | Pass wins; every come flat loses; come odds returned; C = ∅ (the hand continues) |
| CO roll 11 / 2,3,12 | Pass wins / loses; C unchanged |
| CO roll n ∈ C | The come flat on n wins and its odds are returned; remove n. n becomes the new point → EST(n) |
| EST(p) | Pass odds = min(k, maxOdds(p)) × u |
| PT window, size(C) < K, box empty | Come = u; if short of bankroll, skip [DEFAULT] |
| PT roll 11 | The box wins. STW rides it again automatically [§31]; on machines that bank it [WoV-9005], re-place it next window |
| PT roll 2/3/12 | The box loses |
| PT roll n ≠ p (point number) | If n ∈ C, that come bet + odds are paid and removed. If the box is up, it travels: add n to C, come odds(n) = min(k, maxOdds(n)) × u (off-and-on when n was already in C) |
| PT roll p | Pass + odds paid; the box (if any) travels to p as above. Next window is a come-out; C remains |
| SEVEN_OUT | Pass, odds, come flats and come odds lose; the box wins; NEWHAND |

- **Exact (per unit flat):**
  - Flats per hand: Pass alone 495/196; K = 1 891/196 (EV −9/140 u); K = 2 77671/12740 = 6.0966 (EV −7061/81900 = −0.08621u, 2.414× Pass alone); K = 3 7.2178 (EV −0.10207u).
  - Edge per $ made equals Pass + k odds: 0.606% at 2x, 0.374% at 3-4-5x.
  - Edge per $ resolved, with come odds OFF on the come-out: 3PM 0.6429% (2x) / 0.4044% (3-4-5x); 2PM 0.6337% / 0.3968%; K = 3 0.6471% / 0.4079%.
  - Loss per roll: 0.01011u (3PM), 0.00754u (2PM).

### 3.4 PLACE_68: flat, regression, hit-and-run

- **Sources:**
  - [WoO-basics]: 1.52% per resolved.
  - [WoO-sys]: "By making six unit place bets on the 6 and 8, and taking the other down if one wins … the probability of winning 7 units is 62.5% and the probability of losing 12 units is 37.5%." Those numbers need **both** bets down after the first hit, so the Wizard's case is a 1-hit hit-and-run (V5), not a regression.
  - [HR]: "a 'hit and run' approach, collecting profits after two or three wins on each number."
- **Parameters:** b (6/8 grid); m0 (starting multiple); R (regress after R hits); D (take down after D hits); `excludePoint` (true if a line bet is on); `reEnter` ∈ {NEXT_HAND, NEXT_POINT}.
- Bet size: amt(H) = m0·b if H < R; b if R ≤ H < D; 0 if H ≥ D.

| State / event | Target / action |
|---|---|
| NEWHAND | H = 0; armed |
| CO window | Nothing to place (bets OFF, left on the layout) |
| EST(p), armed | 6 = 8 = amt(H); if `excludePoint`, take down the bet on p |
| EST(p), disarmed | Nothing |
| HIT(n) | H++; retarget both to amt(H) (regress rounds down; 0 = take down and disarm) |
| MADE(p) | Bets stay (OFF on the come-out); H kept. With `reEnter` = NEXT_POINT and disarmed: H = 0, re-arm [DEFAULT] |
| SEVEN_OUT | Lost; NEWHAND |
| Bankroll short | Place 6, then 8, as affordable [DEFAULT] |

| Preset | EV per hand | P(hand profit > 0) | Notes |
|---|---|---|---|
| V1: $6/$6 flat | −1/3 | 25/64 | SD 14.76 |
| V2: $12/$12, regress to $6/$6 after the 1st hit | −11/24 | **5/8** | +$2 locked after the 1st hit |
| V3: V2, then take down after the 2nd hit | −21/64 | 5/8 | −24 (3/8), +2 (15/64), +21 (25/64) |
| V4: $6/$6, take down after 2 hits | −13/64 | 25/64 | −12 (3/8), −5 (15/64), +14 (25/64) |
| V5: 1-hit hit-and-run, $6/$6 (Wizard example) | −1/8 | 5/8 | +7 (5/8) / −12 (3/8) |

- All variants: 1.515% per $ resolved; expected loss per point-phase roll = (amount on the layout) / 216.
- Pass $5 + 2x odds + place 6/8 at $6 excluding the point: EV per hand −527/1176 = −0.4481; 0.948% per $ resolved (1x 1.154%; 3-4-5x 0.684%).

### 3.5 INSIDE and ACROSS: presets, regression

- **Definitions:**
  - Inside = 5, 6, 8, 9 ("betting on the 5, 6, 8, 9") [WP-gloss][PNat].
  - Across = "A bet on all the box numbers not including the point" [PNat].
  - Dealer naming varies: "96 across" = "3 units on all numbers including the point"; "81 across" / "78 across" exclude a point of 4/5/9/10 or 6/8 [BS-across].
- **Standard presets:**
  - $22 Inside = $5/$6/$6/$5 [MC "Bet $22 inside"].
  - $44 Inside = $10/$12/$12/$10.
  - $32 Across = $5 on 4/5/9/10 and $6 on 6/8.
  - $64 and $96 Across [MC].
  - Regression to $44 Inside or $22 Inside is common [MC: "Inside Love", "Uncle Angelo's 108", "Field Trip"].
- **Literal-parse presets** for the unsourced names: "$32 Inside" = $10 / $6 / $6 / $10; "$44 Across" = $5 on 4/5/9/10 and $12 on 6/8.
- **Parameters:** preset(START), preset(REGRESS); R; D; `excludePoint`; `useBuy[4,5,9,10]` (turn on when the vig is taken only on a win); press rule (default SAME).

| State / event | Target / action |
|---|---|
| NEWHAND | H = 0; level = START; armed |
| CO window | Nothing to place (bets OFF, left on the layout) |
| EST(p), armed | Layout = preset(level), minus p if `excludePoint`; buy instead of place on 4/5/9/10 if `useBuy` |
| HIT(n) | H++. If H = R, level = REGRESS (round down). If H ≥ D, everything down and disarm. Otherwise apply the press rule |
| MADE(p) | Keep the layout. With no line bet, the bet on p was paid and counts as a hit |
| SEVEN_OUT | NEWHAND |
| Bankroll short | Fund 6/8, then 5/9, then 4/10 [DEFAULT] |

| Preset (no line bet) | EV per hand | Edge per $ resolved | SD per hand | P(hand > 0) |
|---|---|---|---|---|
| Inside $22, collect | −1 | 2.586% | 24.25 | 81/256 = 31.64% (4+ hits; every hit pays $7) |
| Inside $44 | −2 | 2.586% | 48.50 | 81/256 |
| Inside $44, regress to $22 after the 1st hit | −5/4 | 2.586% | 32.41 | 27/64 (net −44 at k = 0; 7k − 15 for k ≥ 1) |
| Across $32 | −2 | 3.727% | 33.59 | 1037/3125 = 33.18% |
| Across $44 (literal) | −7/3 | 3.084% | 47.00 | ≈ 33.78% |
| "Inside $32" (literal) | −5/3 | 3.012% | 35.54 | ≈ 35.29% |
| Across $32 with **buy** 4/5/9/10 (vig on win) and place 6/8 | **−11/12** | 1.708% | 34.83 | ≈ 34.91% |

- Pass $5 + 2x + Inside $22 excluding the point: −393/392 per hand (1.640%).
- Pass $5 (no odds) + Across $32 excluding the point: −365/196 (3.257%).

### 3.6 IRON_CROSS

- **Sources:**
  - [WoO-326]: "a way of betting the field and place bets to win on any roll of the dice except a 7"; $5 field + $5 place 5 + $6 place 6 + $6 place 8; "$0.25/$22 = 1/88 = 1.14%"; "Be wary of casinos that pay only 2 to 1 for 12 on the field bet."
  - [HR]: "winning combinations on 30 out of the 36 possible dice outcomes".
  - [BC-IC]: Pass optional; "Wait for a point to be established"; replace the field after a 5/6/8.
  - [MC]: a variant and a crapless variant.
- **Parameters:** f = 5, p5 = 5, p6 = p8 = 6; `includePass`; `excludePoint`; `fieldOnCO` = false; `fieldPay12` (STW: 2:1); optional "spread field wins into place bets" [MC].

| State / event | Target / action |
|---|---|
| CO window | Pass = u if included. No field: cancel a field the machine auto-continued from a point made on 4/9/10 [STW §32] [DEFAULT]. Places OFF |
| EST(p) | Field = f; place 5/6/8 (minus p if `excludePoint`); odds per k if Pass is included |
| PT roll 5/6/8 | Place paid (stays); field lost → re-bet f |
| PT roll 2/3/4/9/10/11/12 | Field paid; it stays (STW automatic) |
| MADE(p) | Places stay OFF; apply the CO window rule |
| SEVEN_OUT | Lose $22 (less if a number is excluded); NEWHAND; wait for the next point |
| Bankroll < layout | Skip the Iron Cross for this point [DEFAULT] |

- **Per point-phase roll:** 7 (6/36) −$22; 5/6/8 (14/36) +$2; 3/4/9/10/11 (14/36) +$5; 2 (1/36) +$10; 12 (1/36) +$15 (3:1) or +$10 (2:1).
- **Field 3:1 on 12:** EV per hand −3/2; 2.486% per $ resolved; 1/88 = 1.136% per point-phase roll; SD 23.28; P(hand > 0) 33.29%.
- **STW field (2:1 on 12), the bubble default:** EV per hand −7/3; 3.867% per $ resolved; $7/18 per point-phase roll (1.768% of $22); SD 22.09; P(hand > 0) 32.04%.
- **Pass $5 + 2x + Iron Cross excluding the point:** −611/392 (1.852%); with the STW field −2813/1176 (2.841%).
- **Variant MC_IRON_CROSS [MC]:** 1 unit Pass + 2x odds; 2 units each on 5/6/8 + 1 unit field; replenish the field after 5/6/8; after 4 total hits remove the field and reduce the places to 1 unit.
- **Variant crapless [MC]:** $30 / $36 / $36 + $15 field; spread field wins onto the other place numbers; take the field down once all are covered.

### 3.7 HEDGES: Any Craps check, C&E, Any 7 insurance

- **Sources:**
  - [WoO-sys]: "Never hedge your bets." "No combination of bets can give the player an advantage."
  - [WoV-36080] (Mission146): "I only play $5 tables and hedge my Pass Line CO with a $1 Crap Check."
  - Any-7 hedge example [MC] "The One + 7": $66 inside + $80 Don't Come + $30 Any 7. Its "take down the Don't Come" step forfeits equity and may be impossible on machines, so the bot never removes a travelled Don't Come.
  - "The Oreo" [MC] is **not** an Any-7 hedge. It is a light/dark mix: $10 Don't Pass + lay odds + place 6/8 at $12 (the sister number if the point is 6/8) + $10 Come bets.
- **Parameters:** `hedgeBet` ∈ {ANY_CRAPS, C&E, ANY7}; size A (a full Any Craps hedge needs A = F/7; a full Any 7 hedge needs A = exposure/4); `when` ∈ {every CO, first PT roll, every PT roll, until the first hit}.

| State / event | Target / action |
|---|---|
| CO window | If `when` = every CO: hedge A (Any Craps / C&E) |
| PT window | If `when` covers this roll: Any 7 = A |
| Hedge resolves | Re-bet per `when`; cancel auto-continued winners that are off schedule |
| SEVEN_OUT | NEWHAND |

- **Craps check, Pass $10 + Any Craps $1 every come-out:**
  - Come-out 7/11 = +9; 2/3/12 = −3; point = −1, then the Pass resolves.
  - EV per hand −125/196 = −0.638, versus −0.357 for the Pass alone.
  - 2.296% per $ resolved, or 1.038% with 2x odds.
- **Any 7 insurance, Across $32 + Any 7 $6 every point-phase roll:** EV per hand **−8** versus −2 (8.92% per $ resolved).
- **Bubble:** one-roll bets work on the come-out. Power Odds boosts are random (§1.1). A Pass + Don't Pass hedge is illegal on STW [STW §5f].

### 3.8 FIVE_COUNT (a timing wrapper around any strategy)

- **Sources:**
  - [WoO-228]: "you start counting rolls as soon as a new shooter throws any point number"; "if the 5th roll is not a point number, it doesn't count"; "you will only be betting 43% of the time".
  - Counts 2–4 accept any number, and the count holds at 4 until a point number rolls [5c-sec] (low quality; consistent with secondary summaries).
  - [BC-5c] simplified version: "Once a point is established, begin tracking"; "Count each roll that is not a 7"; "If a 7 appears before your count reaches five, reset."

| c | Next roll | New c |
|---|---|---|
| 0 | Come-out point number (EST) | 1 |
| 0 | Come-out 2/3/7/11/12 | 0 |
| 1–3 | Any roll except the seven-out (including come-out 7/11/craps and point made) | c + 1 (variant RESET7: a come-out 7 → 0) |
| 4 | Point number 4/5/6/8/9/10, either phase | 5 (qualified) |
| 4 | Anything else except the seven-out | 4 |
| any | SEVEN_OUT | 0 (NEWHAND) |

- The target is the inner strategy's layout once c = 5, otherwise nothing.
- **Inner start rules [DEFAULT]:**
  - Place/buy/field layouts start in the next window if in the point phase, otherwise at the next EST.
  - Come and Don't Come bets start in the next point-phase window.
  - Pass and Don't Pass start in the next come-out window (no put bets).

| Variant | P(hand qualifies) | Share of rolls bet |
|---|---|---|
| Scoblete [WoO-228] | 0.513627 | 0.434930 (Wizard: 43.5%) |
| RESET7 | 0.488995 | 0.414962 |
| [BC-5c] simplified (qualified until the seven-out) | ≈ 0.4285 | ≈ 0.3636 |
| Wizard's alternative: start after the shooter's first made point [WoO-228] | 67/165 = 0.406061 | 67/165 (Wizard: 40.6%) |

- **Memoryless:** after qualification, place-bet hit distributions equal an unfiltered hand. The edge per $ is unchanged; only volume falls (place loss per hand × 0.513627).
- **Bubble:** the STW "shooter" only presses a button [STW §35], so qualifying only reduces action.

### 3.9 Money-management progressions (they do not change the house edge [WoO-mart][WoO-sys])

Carrier (one decision = one resolution): Pass flat (default); Don't Pass (repeat the bet on a 12 push); or Field. bubble-craps.com doubles "your Field bet after each loss" [BC-index].

| ID | Rules (state → next bet) | Exact or sourced stats (Pass carrier) |
|---|---|---|
| MARTINGALE | First bet = goal b. Loss: double "if you can". Win: quit [WoO-mart], or i = 0 and continue (loop variant). If you cannot double: "walk away broke" [WoO-mart] (alternative: bet the remainder [DEFAULT off]). Exceeding the table max = bust | P(L straight losses) = (251/495)^L: L = 5 → 3.352%, L = 7 → 0.862%, L = 10 → 0.112%. Don't Pass carrier (976/1925)^L: 3.350%, 0.861%, 0.112%. Field carrier (5/9)^L: 5.29%, 1.63%, 0.28% |
| ANTI-MARTINGALE | "Your first bet should be one unit"; after a win, double until the bankroll equals the goal (a power of 2); after a loss, "quit a loser" [WoO-anti] | P(32-unit goal) = (244/495)^5 = 2.910% (Wizard simulation: 0.029102) |
| PAROLI(3) | Bet b·2^s. Win: s + 1. After 3 straight wins (+7b), reset. Any loss: reset [PN-paroli] | P(+7b) = 11.98%; EV per sequence −0.0418b |
| 1-3-2-6 | Units 1, 3, 2, 6. A loss ends the sequence; restart after the 4th bet; after a tie or push, repeat the previous bet [WoO-1326] | −1 (50.71%), −2 (25.00%), +2 (12.32%), 0 (6.07%), +12 (5.90%); EV −0.052088 per sequence (the Wizard gives 0.052088) |
| D'ALEMBERT | Unit = goal; start at 1 unit. Loss: +1. Win: −1 (minimum 1). Tie: repeat. Stop at the goal, cutting the bet so it lands exactly on the goal, or at bust; the bet is capped at the money left [WoO-dal] | P(goal) = 90.34% with a 10-unit bankroll and a 1-unit goal (Wizard simulation, craps Pass) |
| FIBONACCI | "You will start on the SECOND one"; bet = goal × F[i]. Loss: i + 1. Win: i − 2. Dropping off the sequence = session won [WoO-fib]. If the bankroll is short, bet the remainder [DEFAULT] | P(goal) 0.911445 and EV −0.062661 units per session with 11 units (Wizard simulation, Pass) |

### 3.10 BANKROLL_BUILDER (CODIFIED)

- **Evidence:** a YouTube title only [YT-BB]. Codified from hit-and-run [HR] plus the guarantee/excess method [AoC].
- **Parameters:** u = 5; k = MAX (≤ 2 by default); b68 = 6 (penny: a $3 multiple); D = 2; `reEnter` = NEXT_HAND; SB = 40u; stopLoss = 0.5·SB; winGoal = 0.3·SB; `winGoalAction` = LOCK with lockFrac = 0.5.

| State / event | Target / action |
|---|---|
| NEWHAND | H = 0; armed (then apply the session gate) |
| CO window | Pass = u; place bets OFF on the layout |
| EST(p) | Pass odds = min(k, maxOdds) × u. If armed: place 6 and 8 = b68 each, except p. If p is 6 or 8, take that bet down. If the previous point's exclusion no longer applies, add the missing number back |
| HIT(n) on 6/8 | H++. If H ≥ D, take both down and disarm until the next hand |
| MADE(p) / OTHER | No change |
| SEVEN_OUT | NEWHAND |
| Bankroll short | Drop the place bets first, then reduce odds [DEFAULT] |

- **Exact (u = 5, 2x):** EV per hand **−0.3553**; 0.864% per $ resolved; loss per roll $0.0417.
- D = 1: −0.2908 (0.789%). D = 3: −0.3931 (0.901%). No take-down: −527/1176 = −0.4481 (0.948%).
- **Variant "Regress builder":** PLACE_68 V3 (−21/64; after the 1st hit the worst case is +2).

### 3.11 FIBONACCI_PRESS (CODIFIED)

- **Evidence:** a YouTube title only ("Fibonacci Press… El Cortez") [YT-FIB].
- **Parameters:** numbers {6, 8} (variant: Inside, with b = 5 on 5/9); base b; Fib = 1, 2, 3, 5, 8, 13, 21; `cap`; `atCap` ∈ {COLLECT, REGRESS_TO(level)}.

| State / event | Target / action |
|---|---|
| NEWHAND | ℓ_n = 0 for every number |
| CO window | Nothing (bets OFF, left on the layout) |
| EST(p) | Place n = b·Fib[ℓ_n] for each number, including p (no line bet) |
| HIT(n) | If ℓ_n < cap: ℓ_n++ and press to b·Fib[ℓ_n], paid from the win; collect the rest. Otherwise apply `atCap` |
| MADE(p) | Keep the levels |
| SEVEN_OUT | Reset (NEWHAND) |
| Table or per-bet max | Treat as the cap |

- **Always self-funding:** the press cost b·(Fib[ℓ+1] − Fib[ℓ]) = b·Fib[ℓ−1] is ≤ the win (b·Fib[ℓ]·7/6 on 6/8, ·7/5 on 5/9). No rack money is needed after the initial bet.
- **Profit to the rack per hit** (b = 6, on a 6 or 8): +1, +8, +9, +17, +26, then +$91 per hit at the 13-unit cap. Net on one number after k hits then a 7 (13u cap): −6, −5, +3, +12, +29, +55, +146.
- **EV per hand (b = 6):** cap 3u −0.5537; 5u −0.6163; 8u −0.6590; 13u −0.6914. 1.515% per $ resolved. P(hand > 0) = 17.55% for every cap.
- **Variant FIB-NEG:** apply §3.9's Fibonacci to the base unit, one step per hand.

### 3.12 POWER_PRESS (partly sourced)

**Press taxonomy (enum used by every strategy):**

| Press | Rule | Source |
|---|---|---|
| SAME | "collect all winnings, leave your original bet unchanged" | [CC-press][PNat] |
| UNIT | "Add one unit ($6 for 6/8)" | [CC-press][PNat] |
| HALF | "Add half your bet amount" | [CC-press] |
| FULL | "Double your current bet" ($12 → $24, collect $2). **Variant:** "The highest amount you can take a bet without dropping money" | [CC-press]; variant [PNat] |
| POWER | New amount = ceilGrid(amount + win); the difference comes from the rack ("everything it won plus more of their own money"; "$12 → $30+ (add from rack)") | [PNat][CC-press] |
| PARLAY | amount + win, no rounding (feasible on penny machines only on grid) | [WP-gloss][PNat] |
| REGRESS | Back to a level | [MC] |
| DOWN | Remove | — |

- ceilGrid reproduces [MC]: $5 → $15 dropping $3 and $6 → $18 dropping $5 ("Power Press and Pull"); $15 → $40 dropping $4 ("Press Press Regress"); $12 → $30 dropping $4 ("Reluctant Double-Tap").
- **Default:** Inside $22. Count power presses per number, p_n. On HIT(n): if p_n < P, POWER press and p_n++; otherwise SAME (collect). P = 2 is "Double-Tap" ("Press a number twice, then collect the third hit. Reset and repeat."); P = 3 is "Triple Lux" [CC-press]. With `resetAfterCollect` (the CC-press reading): after the collect hit, regress to base and set p_n = 0 (also "Press-Press-Regress" [MC]).

| State / event | Target / action |
|---|---|
| NEWHAND | Base layout; p_n = 0 |
| CO window | Nothing (bets OFF, left on the layout) |
| EST(p) | Current layout (no line bet: p included) |
| HIT(n) | As above. If the drop is not fundable, do a FULL press; if that is not possible either, SAME. A per-number cap or table max forces SAME [DEFAULT] |
| MADE(p) | Keep levels |
| SEVEN_OUT | Reset to base (NEWHAND) |

| Variant (Inside $22 base) | EV per hand | Edge per $ resolved | P(hand > 0) |
|---|---|---|---|
| Live grid ($5/$6), P = 1 / 2 / 3, then SAME | −1.836 / −2.645 / −3.439 | 2.551% / 2.555% / 2.549% | ≈ 25.8% / 20.3% / 9.8% |
| Live grid, P = 2 / 3, then collect + reset to base | −2.252 / −2.963 | 2.569% / 2.567% | Monte Carlo |
| Penny grid (5/9 $1, 6/8 $3), P = 1 / 2 / 3, then SAME (rounding-free) | −1.601 / −2.170 / −2.723 | 2.541% / 2.532% / 2.524% | ≈ 25.8% / 20.5% / 9.8% |
| Penny grid, P = 2 / 3 + reset | −1.891 / −2.389 | 2.549% / 2.542% | Monte Carlo |
| Off-grid $1 on 6/8 too (exact fractional pay / floor-to-cent) | P = 1: −1.550 / −1.555; P = 2: −2.096 / −2.100; P = 3: −2.624 / −2.627 | ≈ 2.59–2.61% | ≈ 25.8% / 20.5% / 9.8% |
| POWER_PRESS_AND_PULL [MC]: power press once, take that number down after its 2nd hit | −3962/3025 = −1.310 | 2.601% | ≈ 40.2% |

- Ladders: live 5/9 is 5 → 15 → 40 → 100 and 6/8 is 6 → 18 → 42 → 96. Penny 5/9 is 5 → 12 → 29 → 70 and 6/8 is 6 → 15 → 33 → 72.
- **MC "Power Press" variant:** $5 on 4/10, $10 on 5/9, $30 on 6/8 + $1 on all hardways. On a 6/8 hit regress to $6 each; on a 5/9 hit regress to $5 each. Then power press, and once any number hits, full press.
- **bubble-craps.com version** [BC-PP]: small come-out Horn/Seven bets; cover 4–10 by buying 4/5/9/10 and placing 6/8; press "a meaningful portion" of each win; small hardways; set a cash-out target.

### 3.13 THREE_HIT_CHALLENGE (CODIFIED)

- **Evidence** [MC]:
  - "Basic Hedge": "Keep bets up for 3 hits".
  - "The Pass Over Method": "Go for 3 hits, then collect on the 4th".
  - "Windstar Walk": "Same bet for the next 3 hits of the inside numbers".
  - Hit-and-run after 2–3 wins [HR].
- **Default:** Inside $22 (or Across $32, or 6&8 $12); no line bet; collect each hit.

| State / event | Target / action |
|---|---|
| NEWHAND | H = 0; armed |
| EST(p), armed | Full layout (p included) |
| HIT(n) | H++. At H = 3, take everything down: success++, disarm |
| MADE(p) | Keep the layout; the place bet on p was paid and counts as a hit |
| SEVEN_OUT | Failure if H < 3; NEWHAND; re-enter next hand |

- **Exact:** P(success) = q³: 6&8 125/512 = 24.41%, **Inside 27/64 = 42.19%**, Across 64/125 = 51.2%.
  - Inside $22 outcomes: −22 (1/4), −15 (3/16), −8 (9/64), +21 (27/64); EV −37/64.
  - 6&8 $12 outcomes: −12 (3/8), −5 (15/64), +2 (75/512), +21 (125/512); EV −129/512.
  - Across $32: EV −122/125.
- **Variant (b) BASIC_HEDGE [MC]:**
  - $30 Don't Pass. After the point, $56 Inside ($10 on 5/9, $18 on 6/8).
  - Count 3 inside hits. MC says that if the point hits before the third hit it subtracts from the count; `pointMadeEffect` ∈ {MINUS_ONE (default), NO_EFFECT} [UNVERIFIED interpretation].
  - After 3 hits: take down 5/9, regress 6/8 to $12 each, ride to the 7-out. Never remove the Don't Pass.
- **Variant (c):** press-press-collect per number (§3.12 with P = 2).

### 3.14 COVER_HEDGE: Field + Come + Place (CODIFIED)

- **Evidence:** the Iron Cross is the canonical "cover" structure [WoO-326]; field and come hedges appear in [MC]; a YouTube "Hedge… then drop the hammer" exists [YT-hedge].
- **Default (u = 5):** K = 2; place 5/6/8 at u / 1.2u / 1.2u; no odds (parameter).

| State / event | Target / action |
|---|---|
| CO window | Pass = u. Come flats stay. No field: cancel an auto-continued field. Places OFF |
| EST(p) and every PT window | Field = u. Come = u while size(C) < K and the box is empty. Place {5, 6, 8} minus p and minus C (take a place bet down after a come bet travels onto that number) |
| PT roll (any non-7) | Settle the field, places and come bets per §3.3; re-bet the field after a loss |
| MADE(p) | Pass paid; come flats stay; places OFF |
| SEVEN_OUT | Only the box Come bet pays; NEWHAND |

- **Exact (float solve):**
  - Field 3:1 on 12: K = 2 with 5/6/8 gives EV per hand −1.671; 2.124% per $ resolved; loss per roll $0.196.
  - STW field (2:1 on 12): −2.505 (3.184%; $0.294 per roll).
  - K = 1 with 6/8 only (field 3:1): −1.383 (2.040%).

### 3.15 LOW_INVESTMENT_HUNTING (CODIFIED from the user's description)

- **Machine hooks:**
  - "Once you bet 15, you can make smaller bets of prop bets" (one machine) [WoV-9005].
  - Hot Shooter needs ≥ 3 credits on the craps game and can only be bet in the come-out window after a 7-out [STW §33].
  - Lay vig is deducted from the win, so a lay can be taken down without paying commission [STW §20].
- **Parameters:**
  - `props`: hard 6/8 $1 in the point phase (OFF on the come-out [STW §4]); C&E $1 on the come-out.
  - `sideBet`: Hot Shooter $1 in the come-out window after a 7-out.
  - `minReq` {amount, scope, check ∈ {PLACEMENT, EVERY_ROLL}}.
  - `filler` = LAY on 4 or 10 (fallback: minimum Pass).
  - `onHit` ∈ {SAME, PARLAY_ONCE}; stopLoss 20u; stop at the first payout ≥ 10u; maxRolls.

| State / event | Target / action |
|---|---|
| Any window | If the qualifying bets are below minReq: filler lay = shortfall, on the grid ($2 multiples on 4/10 for cent-exact net) |
| Filler, check = PLACEMENT | The filler rides **at least one roll**; remove it in the next window. Cost = one roll at amount × 1/240 ($0.0125 for $3), not $0 |
| Filler, check = EVERY_ROLL | Keep the filler on every roll that needs it; per-roll cost amount × 1/240 (0.4167%), similar to a Pass flat (0.4189%) but removable |
| Filler = Pass (fallback) | A contract bet: once a point is set it cannot be removed [STW §5e]. Cost 7/495 × flat per placement. Use only in a come-out window |
| Any window | Place props and side bets per their schedules; cancel off-schedule auto-continued winners |
| HIT | Apply `onHit` |
| SEVEN_OUT | NEWHAND; Hot Shooter window opens |

- **Bubble conflict:** on STW a lay blocks place and buy bets "for the same roll" [STW §21].
- **Exact costs:**
  - $1 hard 6 + $1 hard 8 every point-phase roll: $1/3 per hand.
  - $1 C&E every come-out: 55/196 = $0.281 per hand.
  - A $3 filler lay on 4 or 10 for one roll: $0.0125.
- **Hot Shooter:**
  - Paytable [STW §33]: 8–15 rolls 1×, 16–23 3×, 24–31 5×, 32–39 7×, 40–44 12×, 45–49 30×, "OVER 50" 100×. Exactly 50 rolls falls in a gap.
  - Exact hand-length survival (L counts the 7-out roll): P(L ≥ 8) 0.429044; ≥ 16 0.131620; ≥ 24 0.040320; ≥ 32 0.012347; ≥ 40 0.003780; ≥ 45 0.001804; ≥ 50 0.000861; ≥ 51 0.000743.

| Reading of the paytable | EV per $1 |
|---|---|
| "for 1", count includes the 7-out, GRAND at ≥ 50 | **−9.07%** |
| "for 1", count includes the 7-out, literal "OVER 50" (≥ 51; exactly 50 pays nothing) | −10.26% |
| "for 1", count excludes the 7-out (GRAND ≥ 50 / ≥ 51) | −21.56% / −22.58% |
| "to 1" (any count rule) | +14.4% to +33.8%, implausible; reject |

  - Default: "for 1", including the 7-out, ≥ 50 [UNVERIFIED].

## 4. Comparison (u = $5; per hand; exact unless marked ≈)

| Preset | Expected loss per hand | Loss per roll | Edge per $ resolved | P(hand > 0) |
|---|---|---|---|---|
| Pass + 2x | $0.179 | $0.0209 | 0.606% | — |
| 3PM, 2x ($5 flats) | $0.431 | $0.0506 | 0.643% | — |
| Dolly3, 3-4-5x ($5 flats) | $0.416 | $0.0488 | 0.274% | 67.98% (Wizard simulation) |
| P68 $6 flat | $0.333 | $0.0391 | 1.515% | 39.06% |
| P68 $12 → $6 | $0.458 | $0.0538 | 1.515% | 62.5% |
| Bankroll Builder | $0.355 | $0.0417 | 0.864% | Monte Carlo |
| Inside $22 | $1.00 | $0.117 | 2.586% | 31.64% |
| Three-Hit (Inside $22) | $0.578 | $0.068 | 2.586% | 42.19% |
| Across $32 | $2.00 | $0.235 | 3.727% | 33.18% |
| Iron Cross $22, field 3:1 on 12 | $1.50 | $0.176 | 2.486% | 33.29% |
| Iron Cross $22, STW field (2:1 on 12) | $2.333 | $0.274 | 3.867% | 32.04% |
| Fibonacci Press 6/8 (cap 13u) | $0.691 | $0.081 | 1.515% | 17.55% |
| Power Press and Pull (Inside $22) | $1.310 | $0.154 | 2.601% | ≈ 40.2% |
| Power Press Inside (P = 2, live grid) | $2.645 | $0.310 | 2.555% | ≈ 20.3% |
| Power Press Inside (P = 2, penny grid) | $2.170 | $0.255 | 2.532% | ≈ 20.5% |
| Cover hedge (K = 2, 5/6/8), field 3:1 | ≈ $1.671 | ≈ $0.196 | ≈ 2.124% | Monte Carlo |
| Cover hedge, STW field | ≈ $2.505 | ≈ $0.294 | ≈ 3.184% | Monte Carlo |
| Across $32 + Any 7 $6 | $8.00 | $0.938 | 8.92% | Monte Carlo |

## 5. Test vectors for validating the simulator

- **Hand constants:** rolls per hand 1671/196 (crapless 57678/7303); point-phase rolls per hand 6; decisions per hand 495/196; P(at least one point made) 67/165.
- **Place layouts and line combos:**
  - Place 6/8 $6 flat: −1/3 per hand. Inside $22: −1. Across $32: −2.
  - Iron Cross: −3/2 (field 3:1) and −7/3 (STW field).
  - Pass $5 + 2x + place 6/8 excluding the point: −527/1176.
- **Come and Don't Come chains:**
  - Flats per hand: 3PM 77671/12740; 2PM 891/196; Dolly3 77671/12740.
  - Dolly3 EV −21183/254800 u.
- **5-Count:** betting share 0.434930; P(qualify) 0.513627; RESET7 0.414962 / 0.488995.
- **Progressions:**
  - 1-3-2-6 on Pass: −0.052088 per sequence.
  - Martingale on Pass, L = 7: P(bust) 0.00862.
- **Single-strategy results:**
  - Three-Hit success on Inside: 27/64.
  - Pass + 3-4-5x SD per decision: 4.915632 (matches the Wizard).
  - Across $32 P(hand > 0) = 1037/3125.
  - Power Press and Pull: −3962/3025.
  - Bankroll Builder (D = 2): −0.355332.
- **Rounding:** a $2 lay-odds bet on 6 with HALF_UP pays $1.67 (+0.0909%); with FLOOR it pays $1.66 (−0.1818%). A $3 lay on 6 pays exactly $2.50.
- **Hot Shooter:** P(L ≥ 8) = 0.429044; P(L ≥ 50) = 0.000861; EV −9.07% under the default reading.

## 6. Unverified or conflicting items: make these engine parameters

1. Rounding of fractional cents (FLOOR / HALF_UP / EXACT). It matters for off-grid lay odds (which can turn player-positive) and for 6/8 place bets that are not multiples of $3.
2. Don't Pass lay-odds basis on STW ("2 times the bet": WIN vs. RISK). Don't Come is win-basis [STW §15].
3. Don't Come odds working on the come-out on STW. The auto-OFF list says generic "ODDS"; the STW profile defaults to OFF, live tables to ON.
4. Whether a travelled Don't Come can be cancelled on STW (the text is silent). Bots never remove one regardless.
5. Whether odds can be removed on machines. [VV-STW] says "cancel all your bets at any time", except the Pass and similar bets, which suggests yes.
6. Come-bet "off and on"; whether a machine re-rides (STW, on 11) or banks (Aqueduct) a winning Come bet.
7. Upfront vig and whether it is refunded on take-down. All machine sources found take the vig from the win.
8. Whether any machine lets the player turn place bets ON for the come-out. STW documents no toggle; [CO-bubble] says place bets can be de-activated.
9. Hot Shooter: "xBET" for vs. to, whether the count includes the 7-out, and the exactly-50-roll gap. Power Odds frequency [STW].
10. Odds caps by casino are 2011–2014 forum data, except the STW rule card (2025) and 2021–22 forum reports. The machine's paytable screen wins.
11. Field 12 pays 2:1 on STW; other machines unknown.
12. What counts toward "3 credit(s) on the Craps game" (Hot Shooter) and "Once you bet 15" (props).
13. crapsee.com claims bubble machines pay place 6/8 "6-for-5" ("about 2.78%") and hard 6/8 at 8:1 ("roughly an 11%"). Read literally, 6-for-5 (1:5) is a 45.45% edge; read as 6:5 it is 0%; 8:1 on hard 6/8 is 18.18%. None match its stated figures. Its 60–120 rounds/hour is unsourced. **Use the machine's paytable, not this site** [crapsee].
14. The Scoblete/forum claim that the 5-Count eliminates "57%" of random rollers matches the share of **rolls** skipped (1 − 0.4349 = 56.5%), not shooters (48.6%) [5c-sec2].
15. AoC calls the win goal both a stop point and a lock trigger (`winGoalAction`).
16. Basic Hedge: interpretation of "point subtracts from the count" (`pointMadeEffect`).

## 7. Source key

Every key was re-fetched in this review except [YT-*], [5c-sec] and [5c-sec2].

| Key | URL |
|---|---|
| WoO-basics | https://wizardofodds.com/games/craps/basics/ |
| WoO-crapless | https://wizardofodds.com/games/crapless-craps/ |
| WoO-326 | https://wizardofodds.com/ask-the-wizard/326/ |
| WoO-228 | https://wizardofodds.com/ask-the-wizard/228/ |
| WoO-sys | https://wizardofodds.com/ask-the-wizard/craps/betting-systems/ |
| WoO-mart | https://wizardofodds.com/gambling/martingale/ |
| WoO-anti | https://wizardofodds.com/gambling/anti-martingale/ |
| WoO-1326 | https://wizardofodds.com/gambling/1-3-2-6-betting-system/ |
| WoO-dal | https://wizardofodds.com/gambling/dalembert-betting-system/ |
| WoO-fib | https://wizardofodds.com/gambling/fibonacci/ |
| PN-paroli | https://www.pokernews.com/casino/roulette/paroli-strategy-for-roulette.htm |
| STW | https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf (section numbers § are the rule card's) |
| WoV-9005 | https://wizardofvegas.com/forum/gambling/craps/9005-bubble-craps-machine-w-best-odds-in-vegas/ |
| WoV-36634 | https://wizardofvegas.com/forum/gambling/craps/36634-place-to-lose-on-bubble-craps/ |
| WoV-37778 | https://wizardofvegas.com/forum/gambling/craps/37778-bubble-craps-machine/ |
| WoV-36080 | https://wizardofvegas.com/forum/gambling/craps/36080-defeating-the-25-table-minimum/ |
| WoV-3PM | https://wizardofvegas.com/forum/gambling/craps/37046-three-point-molly-is-the-best-beginner-strategy/ |
| WoV-Dolly | https://wizardofvegas.com/forum/gambling/craps/37179-three-point-dolly/ |
| VV-STW | https://www.casino.org/vitalvegas/the-casino-game-were-loving-right-now-shoot-to-win-craps (article dated 2013-10-08; some claims come from reader comments) |
| CO-bubble | https://casino.org/blog/the-bubble-craps-strategy |
| BC-index | https://www.bubble-craps.com/craps-strategy/ |
| BC-5c | https://www.bubble-craps.com/5-count-craps-strategy/ |
| BC-IC | https://www.bubble-craps.com/the-iron-cross-for-bubble-craps-bubble-craps-strategy/ |
| BC-3PM | https://www.bubble-craps.com/three-point-molly-bubble-craps-strategy/ |
| BC-PP | https://www.bubble-craps.com/bubble-craps-power-pressing-craps-strategy/ |
| MC | https://marconius.com/craps/allStrats.html |
| CC-press | https://www.controlledcraps.com/craps-pressing-strategy/ |
| PNat | https://parlaynation.com/glossary |
| WP-gloss | https://en.wikipedia.org/wiki/Glossary_of_craps_terms |
| BS-across | https://www.brainscape.com/flashcards/across-bets-craps-15130657/packs/21881603 |
| HR | https://www.hardrock.bet/casino/how-to-play-craps/strategies/ |
| AoC | https://www.artofcraps.com/craps-strategies/craps-bankroll-management/ |
| 5c-sec | https://foxbytes.netlify.app/5-count-craps (low quality) |
| 5c-sec2 | https://cludilrana1989.netlify.app/craps-does-5-count-work (low quality) |
| crapsee | https://v3.crapsee.com/bubble-craps-strategy (unreliable) |
| YT-BB | https://www.youtube.com/watch?v=1GwJgShE69U |
| YT-FIB | https://www.youtube.com/watch?v=4UF7kYjyyBs |
| YT-PP3 | https://www.youtube.com/watch?v=sS7NrnBbTlk |
| YT-PPall | https://www.youtube.com/watch?v=_T5XDPE6Itc |
| YT-hedge | https://www.youtube.com/watch?v=MxhQbfWpx6o |

### Critical Files for Implementation (proposed; the repo is empty, so none of these exist yet)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/strategy/types.ts — context, events, actions, machine profile (incl. dcOddsOnCO, layBasis, round, autoRebet)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/strategy/reconcile.ts — universal state table, contract/timing rules, grids, odds caps, exclusivity, auto-action diff, WIND_DOWN
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/strategy/presets.ts — §3 strategies as counters plus target functions
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/theoreticalLoss.ts — §1.2 accumulator and handle metrics
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/lab/montecarlo.test.ts — §5 test vectors