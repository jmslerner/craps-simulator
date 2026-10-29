# Bubble craps rules specification for the engine, coach and strategy lab

This spec merges four research sections dated 2026-10-28:
- **core** (high confidence)
- **machines** (medium)
- **sidebets** (high)
- **strategies** (high)

Target file: `docs/rules/rules-spec.md`. The repo is no longer empty. Names in this spec follow `docs/implementation-plan.md`:
- `MachineConfigInput` and `RoundingRule`.
- `CommissionInput{rate, basis, timing, rounding, minimum, refundOnTakeDown, rearm}`.
- Provenance values `verified` / `reported` / `assumed`.
- Presets `craplessBubble` (the default), `traditionalBubble` and `traditionalLive345`. This spec adds `strictBubble`.

Checks done while synthesizing:
1. I re-read the Clearwater STW rule card [CW], the STW Lucky Roll overview [STWO] and the Interblock v2.5.1 description [IB]. I extracted text from the cached PDFs with PDFKit (read-only) to settle conflicts between sections.
2. I fetched vegasadvantage [VA] once.
3. I recomputed every number that is new here with exact `fractions`.
4. This turn's shared WebSearch budget ran out after one query, so I could not search further. Every gap that needs more searching is listed in §9.

---

## 0. Conventions and conflict resolutions

### 0.1 Notation

| Term | Meaning |
|---|---|
| Pays `a:b` | Net win of a per b staked; the stake is returned. Store payouts as an exact "to 1" ratio. `x for 1` = (x−1):1. Examples: 30 for 1 = 29:1; 5 for 1 = 4:1. |
| HE_res | Expected loss ÷ stake, per decision. Pushes count as decisions ("ties counted") unless marked otherwise. For upfront vig the divisor is stake + vig, unless marked "per stake". |
| HE_roll | Expected loss per roll while the bet is working, per $1 staked: HE_res × P(the bet is decided on a roll). For one-roll bets HE_roll = HE_res. |
| Lifecycle edge (plan §5.1) | Loss ÷ (sum of stakes over all decisions + all vig), for a bet left up until it loses. Equals HE_res when every decision is i.i.d. |
| Hand | Every roll from the first come-out after a seven-out (or session start) through the next seven-out, inclusive. In side-bet rules, "shooter" means hand. |
| T / C | Traditional / crapless. |
| STW / IB / LIVE | **STW**: Shoot To Win community dome (Aruze, now Interblock). **IB**: Interblock heads-up or stadium machines, GV6.x (Craps, Crapless, Easy). **LIVE**: dealer table. |
| Tags | **V** verified: official text, or two or more independent sources (provenance `verified`).<br>**R** reported: one credible or forum source (`reported`).<br>**A** assumed: no source; conservative default (`assumed`).<br>**M** exact math, recomputed.<br>**U** unresolved. |

### 0.2 Conflict resolutions

| # | Topic | Conflict | Resolution |
|---|---|---|---|
| 1 | STW OFF-button scope | core lists 5 bet types; machines lists 10 | **10 types** (STWO text re-read): ODDS, DON'T ODDS, COME ODDS, DON'T COME ODDS, BIG 6/8, PLACE, BUY, PLACE TO LOSE, LAY, HARDWAYS. OFF chips "do not consume a player's credit and do not contribute to the minimum bet". |
| 2 | STW come-out auto-OFF list | strategies read it as "ODDS/OLACE…" and so set Don't Come odds OFF | **"COME ODDS/OLACE[sic]/BUY/HARDWAYS/BIG6/BIG8"**: "COME" sits at the end of the previous line (CW §4, re-read). Only chips *carried from the previous series* go OFF. Don't Come odds, lay and place-to-lose are not in the list, so they stay ON [A, by omission]. The strategies section's `dcOddsOnCO=OFF` for STW is wrong. |
| 3 | Machine payout rounding | core suggested floor; machines found 2 reports of rounding up | Place 6/8 on STW: **ceil to 1¢** [R, 2 forum reports]. Every other fractional machine payout: **floor to 1¢** [A]. Machine commission: **ceil to 1¢** [A]. Live: **floor to $1** [V]. A ceiling on wrong-way payouts would create player-positive bets, so the sanity check must reject it. |
| 4 | IB come-out place/buy | strategies assume OFF on the come-out | **ON** (they resolve) unless set OFF. Only Place/Buy bets placed *after a seven-out* start OFF, until the player taps "Set bets On" [V IB §2.6, §3.2]. |
| 5 | Don't Pass after the point | the sources differ by product | STW: locked (CW §11e) [V]. IB: may be reduced or removed, with no re-bet until the next cycle (§2.3 text) [V]; IB's own §2.1.1 table calls it a contract bet. LIVE: may be reduced or removed, never re-placed or increased [V]. |
| 6 | STW don't-odds cap | — | Don't Pass odds ≤ 2 × flat (**stake basis**, CW §12 literal). Don't Come odds ≤ 2 × flat ÷ odds ratio (**win basis**, CW §15). Configure per bet type. |
| 7 | Hot Shooter Grand tier | CW says "OVER 50"; STWO says "upon the 50th roll" | **≥ 50 rolls**. Keep "≥ 51" as a toggle. |
| 8 | Lucky Shooter on a come-out 7 or 11 | IB contradicts itself | **Push; the bet stays** (PA, MD, and IB's "stays" sentence). |
| 9 | "Bubble machines pay 6:5 or 6-for-5 on place 6/8" [CRAPSEE] | — | Rejected. CW §17 says 7:6. |
| 10 | IB Lucky Roller paytable | — | **30/30/155 to 1** (Low/High/All). The screen shows 31 / 156 / 31 "for 1" in Low, All, High order. |
| 11 | CW §16c hardway wording ("loses if the roll is not the selected matching pair") | — | Use the standard multi-roll rule (loses on the easy way or a 7), as stated in STWO §7.1. CW §4 and §32 also treat hardways as persistent bets. |
| 12 | Plan §4.5 "merge come bets" | — | Unreachable. Decisions use the before-roll state, so the existing Come on N **wins** on the same roll the box Come travels to N ("off and on"). Treat a merge as an invariant violation. |
| 13 | Plan's crapless Fire Bet figures | — | Re-verified [M]: **13.4152%** if all 10 points count; **70.4488%** if only 4–10 count (paytable 24/249/999 to 1). |

---

## 1. Dice and probability reference

### 1.1 Totals

| Total | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ways /36 | 1 | 2 | 3 | 4 | 5 | 6 | 5 | 4 | 3 | 2 | 1 |
| P | 2.778% | 5.556% | 8.333% | 11.111% | 13.889% | 16.667% | 13.889% | 11.111% | 8.333% | 5.556% | 2.778% |
| Hard (pair) way | 1-1 | — | 2-2 | — | 3-3 | — | 4-4 | — | 5-5 | — | 6-6 |

- There are 21 unordered outcomes: 6 pairs at 1/36 each and 15 non-pairs at 2/36 each. Hop easy = 2/36; hop hard = 1/36.
- Dice come only from engine RNG: two independent uniform d6 per roll (xoshiro128**, rejection sampling for u ≥ 4294967292, per plan §4.2).
- Physics and invalid-roll animation never change the outcome.

### 1.2 A number N against 7

| N | Ways w | P(N before 7) = w/(w+6) | E[rolls to a decision] = 36/(w+6) | Decided per roll |
|---|---|---|---|---|
| 4/10 | 3 | 1/3 | 4 | 1/4 |
| 5/9 | 4 | 2/5 | 3.6 | 5/18 |
| 6/8 | 5 | 5/11 | 36/11 = 3.2727 | 11/36 |
| 2/12 (C) | 1 | 1/7 | 36/7 = 5.1429 | 7/36 |
| 3/11 (C) | 2 | 1/4 | 4.5 | 2/9 |

### 1.3 Line and hand constants [M]

| Metric | Traditional | Crapless |
|---|---|---|
| Come-out P(natural) / P(craps) / P(point) | 8/36 (7, 11) / 4/36 / 24/36 | 6/36 (7 only) / 0 / 30/36 |
| P(pass wins) | 244/495 = 49.293% | 6557/13860 = 47.309% |
| Pass/Come HE_res | **7/495 = 1.4141%** | **373/6930 = 5.3824%** |
| E[rolls per pass decision] | 557/165 = 3.3758 | 9613/2310 = 4.1615 |
| Pass HE_roll | 7/1671 = 0.4189% | 373/28839 = 1.2934% |
| E[rolls per hand] | **1671/196 = 8.5255** | **57678/7303 = 7.8979** |
| E[come-out rolls per hand] = pass decisions per hand | 495/196 = 2.5255 | 13860/7303 = 1.8979 |
| E[point-phase rolls per hand] | **6** | **6** |
| π(comeOut) = share of rolls that are come-outs | 165/557 = 29.62% | 2310/9613 = 24.03% |
| π(point) | 392/557 = 70.38% | 7303/9613 = 75.97% |
| E[points made per hand] | 67/98 = 0.6837 | 4247/7303 = 0.5815 |
| P(hand makes ≥ 1 point) | 67/165 = 40.61% | 4247/11550 = 36.77% |
| E[naturals / craps per hand] | 55/98 / 55/196 | 2310/7303 / 0 |
| P(a decision ends in seven-out) | 196/495 | 7303/13860 |
| Pass EV per hand, per $1 flat | −1/28 | −746/7303 = −0.10215 |
| Seven-outs per 100 rolls (sevens: 16.67) | 11.73 | 12.66 |

**Identities for tests:**
- Rolls per hand = decisions per hand + 6.
- Decisions per hand = naturals + craps + points made + 1.
- π(comeOut) = 1 / E[rolls per decision].

**Traditional hand length** L (counts every roll, including the seven-out), as P(L ≥ k):

| k | 8 | 16 | 24 | 32 | 40 | 45 | 50 | 51 |
|---|---|---|---|---|---|---|---|---|
| P(L ≥ k) | 0.429044 | 0.131620 | 0.040320 | 0.012347 | 0.003780 | 0.001804 | 0.000861 | 0.000743 |

A hand of 154 or more rolls has odds of about 1 in 5.59 billion.

---

## 2. Game-flow state machine

### 2.1 Round transitions (`advanceRound`)

| Phase before | Roll | Traditional | Crapless | Next phase |
|---|---|---|---|---|
| come-out | 7 | NATURAL | NATURAL | come-out (same hand) |
| come-out | 11 | NATURAL | POINT_ESTABLISHED(11) | come-out (T) / point 11 (C) |
| come-out | 2, 3, 12 | CRAPS (same hand) | POINT_ESTABLISHED(n) | come-out (T) / point (C) |
| come-out | 4, 5, 6, 8, 9, 10 | POINT_ESTABLISHED(n) | same | point n (puck ON) |
| point p | p | POINT_MADE | same | come-out; p added to the hand's mask |
| point p | 7 | SEVEN_OUT | same | come-out; the hand ends; next roll starts a new hand |
| point p | other | none | none | point p |

**Rulesets:**
- T: naturals [7, 11], craps [2, 3, 12], points [4, 5, 6, 8, 9, 10], `dontBar` 12 (Reno: 2).
- C: naturals [7], craps [], points [2–6, 8–12], `dontBar` null (there are no don't bets).

**Counters:**
- `hand.rolls` increments on every roll, including the seven-out.
- `hand.pointsMadeMask`; `hand.index`.
- `sinceSeven.{rolls, totalsMask}` resets on **any** 7.
- On SEVEN_OUT, settle the side bets that read hand counters first, then reset the hand.

### 2.2 Decisions by event (working bets only; a bet that is not working gets `none`, except odds, see §2.3 step 4)

| Event | Pass; Come on N | Don't Pass; Don't Come on N | Come box | Don't Come box | Take odds | Lay odds | Place/Buy/Big on N | Lay/PTL on N | Hard N |
|---|---|---|---|---|---|---|---|---|---|
| Come-out 7 | Pass W; Come on N L | Don't Pass L; Don't Come on N W | (empty) | (empty) | Come odds: returned if OFF (default), else L | Don't Come odds: W if ON (default on LIVE/STW), else returned | L | W | L |
| Come-out 11 (T) | Pass W | Don't Pass L | — | — | — | — | — | — | — |
| Come-out 2/3/12 (T) | Pass L | Don't Pass W on 2/3; 12 push (bar 12) [bar 2: 2 push, 3 and 12 W] | — | — | — | — | — | — | — |
| Come-out n = point number (C: any non-7) | Pass gets point n; Come on n W (odds returned if OFF) | Don't Pass gets point n; Don't Come on n L (odds L if ON) | — | — | — | — | n: W | n: L | n pair W; easy n L |
| Point p rolled (MADE) | Pass W | Don't Pass L | box travels to p | box travels to p | pass odds W | Don't Pass odds L | p: W | p: L | p pair W / easy L |
| 7 in point phase (SEVEN_OUT) | Pass and all Come on N L | Don't Pass and all Don't Come on N W | box **W** | box **L** | L | W | L | W | L |
| n ≠ p in point phase | Come on n W | Don't Come on n L | T: 11 W; 2/3/12 L; else travel. C: always travel | T: 11 L; 2/3 W; 12 push; else travel | come odds on n W | Don't Come odds on n L | n: W | n: L | n pair W / easy L |

- One-roll bets resolve on every roll (§3.4).
- Side bets: see §2.6.
- A Come or Don't Come bet on N cannot coexist with pass point N. Whenever the pass point becomes N, the bet on N is decided on that same roll.

### 2.3 Roll pipeline (`table/roll.ts`)

1. Take the dice from the RNG (scripted dice only in tests). Then `advanceRound(before)` gives the transition.
2. Effective working status = `bet.working ?? globalToggle ?? policyDefault(type, phaseBefore, carried?, placedAfterSevenOut?)` (§2.4).
3. `decide` every bet independently against the **before** state. The bet on N and the box bet traveling to N are separate decisions.
4. Odds take their parent's decision. If the parent resolves while the odds are not working, the odds are **returned**: `push(offReturned)`.
5. Settle each bet: exact amount → round → commission (§4). Update the ledger.
6. Apply the results:
   - Resolved bets are removed or stay, per `afterWin`.
   - Box bets travel. A travelled bet starts with 0 odds.
   - Side-bet progress is updated.
7. Commit the round state.
8. Machine post-roll actions:
   - **STW:** on POINT_ESTABLISHED, auto-OFF chips turn ON. When the next phase is a come-out, carried types go OFF.
   - **IB:** lay bets turn back ON after a point is made or any 7. OFF odds are returned when their point is made.
   - Auto re-bets happen per `afterWin`.
   - Side-bet windows open or close.
   - **IB:** after a SEVEN_OUT, Place/Buy bets placed in the next window are flagged OFF.
9. Betting window. On `roll`, validate the minimum (active bets only), credit and limits.

### 2.4 Come-out working defaults

| Bet | LIVE (Las Vegas) | STW (CW §4) | IB (§2.6, §3.2) |
|---|---|---|---|
| Place / Buy | OFF [V WOO-B, MD-C] | Carried: auto-OFF, auto-ON at the point [V]. Newly placed during the come-out window: OFF [A] | **ON**. Bets placed after a seven-out are OFF until "Set bets On" [V]. "Until player ON" rather than "until the point" is a literal reading [U] |
| Big 6/8 | ON [R WIKI] | carried auto-OFF [V] | ON [A] (T only) |
| Hardways | ON in Vegas; OFF in Atlantic City / MD [V] | carried auto-OFF [V] | ON [A] |
| Come odds | OFF; returned if the Come bet is decided [V] | auto-OFF [V] | OFF [A] |
| Don't Come odds | ON [V WOO-B] | ON [A, not in §4] | ON [A] |
| Lay | ON [V] | ON [A, not in §4] | ON (comes back ON after a point is made or a 7) [V] |
| Place to lose | ON per WoO ("not 100% sure") / OFF per MD | ON [A] | not offered |
| Line flats, come/DC points, one-roll bets, side bets | always working | always | always |

**Toggles:**
- **LIVE:** per bet, verbally.
- **STW:** All On; All Off; per-chip OFF "from the upcoming roll onward" on the 10 types in §0.2 #1. Whether All On can override the come-out auto-OFF is undocumented [A: no].
- **IB:** "Set bets Off" covers Place, Lay, Buy, Odds (take and give) and Hardways [V].

### 2.5 Machine round flow

| Step | STW community dome | IB heads-up (crapless default) | LIVE |
|---|---|---|---|
| Bet window | One shared timer; turns green→red at ≤ 5 s, then "No More Bets" [V STWO]. Length 15–30 s reported [R WOV-11344, WOV-38668, SHRT] | Self-paced, no timer [R G3-MOH]; "can be sped up by pushing the deal/roll/spin button" [R VA]. Optional Roll button [V IB] | Dealer-paced |
| Minimum check | MIN/MAX TOTAL BET; OFF chips don't count [V STWO] | "BETS ARE NOT VALID YET! – Must bet N credits more!"; OFF bets don't satisfy it but still use Playable credit [V IB] | Per-bet table minimum |
| After bet time | Power Odds draw on prop/hardway spots, if enabled [V CW §34] | — | — |
| Shoot | Designated shooter presses the button within the time limit (≈ 20 s [R]); otherwise the machine shoots automatically. "Does not affect the roll result" [V CW §35] | The player is always the shooter [V IB] | Shooter |
| Read | RFID dice plus camera. Cocked or stacked dice: reshoot / void and return bets / pause for an attendant (operator setting) [V STWO] | RFID; re-vibrate on a misread [R PAT-RFID] | "No roll" |
| Settle | Auto-pay. Winners continue automatically per §5 `afterWin` [V CW §29–32] | Repeat Last Bet, Double, Keep Bets On (varies by jurisdiction) [V IB] | Dealer |

In an RNG engine, invalid rolls are animation only and never change the outcome.

### 2.6 Side-bet lifecycle

| Side bet | Placement window | Counter | Resolution | Lock |
|---|---|---|---|---|
| Hot Shooter Jackpot (STW/RTW) | Come-out bet time with `hand.rolls == 0` ("after a 7 OUT only") [V CW §33e]; PA: any come-out before a point [V PA623c] | `hand.rolls`, including the come-out and the seven-out (definition A) [A] | At SEVEN_OUT, pay the multiplier "for 1" for the highest tier reached | Special game, cannot be withdrawn [V STWO] |
| Lucky Shooter (IB, traditional only) | Before the point is set [V IB]. PA: before the come-out [V]. MD: new shooter only [V] | Point P, plus a hit mask over the other 5 box numbers | §6.3 | Contract once the point is set [V]; removable before [A] |
| Lucky Roller, IB | Only when the last roll was a 7 (any 7) or at the start of a cycle. No re-bet after a win until a 7 [V IB] | Totals rolled since placement | Full set → wins at once; any 7 → loses | Locked [A] |
| Lucky Roller, STW/RTW | Before any roll, if no wager of the same type is active [V STWO] | same | same | Special game [V] |
| Fire Bet (LIVE only) | `hand.rolls == 0` [V MD-C] | Points made ∩ `countedPoints` | Paid at SEVEN_OUT by count (MD); optionally paid immediately on the 6th point [U] | Contract [V MD-C] |

STW's shooter button rotates at a seven-out "or when a point is established" (CW §35g). This is cosmetic: side bets use the hand, not the button-holder.

---

## 3. Bet catalog

Placement windows: **CO** = come-out window; **PT** = point-phase window.

### 3.1 Line and odds bets

| id | Variants | Window | Contract | Remove / reduce | Come-out working | Toggle | Resolution | Pays | Exact unit, live / penny | HE_res | HE_roll |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PASS | T, C | CO only. Machines: "only before the come-out roll" [V IB, CW]. Put bets are LIVE only | after the point [V] | before the point only | always | no | §2.2 | 1:1 | $1 / $1 | T **7/495 = 1.4141%**; C **373/6930 = 5.3824%** | T 7/1671; C 373/28839 |
| COME | T, C | PT only [V CW §9b, IB] | after it travels [V] | box: before the roll | always | no | Pass rules on its first roll, then N vs 7 | 1:1 | $1 / $1 | same as Pass | same as Pass |
| DONT_PASS (bar 12; bar 2 = Reno) | T only | CO only; no new or larger bet after the point [V CW §11d] | STW yes [V]; IB/LIVE no (reduce or remove only; no re-add) [V] | see Contract | always | no | Come-out: 2/3 W, 12 push, 7/11 L; then 7 W, p L | 1:1 | $1 / $1 | **3/220 = 1.3636%** (ties excluded: 27/1925 = 1.4026%) | 9/2228 = 0.4039% |
| DONT_COME | T only | PT only | LIVE: removable [V MD-C]; STW: silent [A removable per STWO's general rule]; IB [U] | — | always | no | mirror of Come, bar 12 | 1:1 | $1 / $1 | same as DP | same as DP |
| PUT_N | T, LIVE only (`allowPutBets`) | PT | yes | no | — | no | N vs 7 | 1:1 + odds | — | (6−w)/(6+w) ÷ (1+m): 33.33 / 20.00 / 9.09% with no odds | (6−w)/36 |
| ODDS_TAKE (pass/come) | T, C | after the parent's point is set; add up to the cap before any roll [V IB] | no | any time before it resolves [V IB, WIKI] | Come odds OFF (§2.4) | yes | follows parent | 4/10 2:1; 5/9 3:2; 6/8 6:5; **C 2/12 6:1; 3/11 3:1** | $1/$2/$5 live / $1 penny | 0 | 0 |
| ODDS_LAY (DP/DC) | T | after the parent's point is set | no | any time | Don't Come odds ON | yes | follows parent | 1:2, 2:3, 5:6 | $2/$3/$6 live / $1, $3, $3 penny | 0 | 0 |

Equity of contract bets [M]:
- A Pass bet on point N is worth flat × 2w/(w+6): 0.667 (4/10), 0.8 (5/9), 0.909 (6/8), **0.286 (C 2/12)**, 0.5 (C 3/11).
- Removing a travelled Don't Pass / Don't Come forfeits 1/3 (4/10), 1/5 (5/9) or 1/11 (6/8) of the flat.

### 3.2 Number bets

All of these can be placed on any roll [V IB, WOO-B], are not contract bets, can be removed, follow §2.4 for come-out status, and can be toggled.

| id | Variants | Resolution | Pays (to 1) | Exact unit, live / penny | HE_res | HE_roll |
|---|---|---|---|---|---|---|
| PLACE 4/10 | T, C | N W, 7 L | 9:5 | $5 / $1 | 1/15 = 6.6667% | 1/60 = 1.6667% |
| PLACE 5/9 | T, C | same | 7:5 | $5 / $1 | 1/25 = 4.0000% | 1/90 = 1.1111% |
| PLACE 6/8 | T, C | same | 7:6 | $6 / **$3** | **1/66 = 1.5152%** | 1/216 = 0.4630% |
| PLACE 2/12 | C | same | **11:2** [alt 5:1 "25 to 5"] | $2 / $1 | 1/14 = 7.1429% [1/7 = 14.2857%] | 1/72 [1/36] |
| PLACE 3/11 | C | same | **11:4** [alt 13:5] | $4 / $1 [$5 / $1] | 1/16 = 6.2500% [1/10] | 1/72 [1/45] |
| BUY_N | T 4–10; C 2–12 | N W, 7 L | True odds 2:1, 3:2, 6:5, 6:1, 3:1; vig 5% of the stake (§4.3) | live: $20 (= $1 vig) / penny: $1 | §4.3 | §4.3 |
| LAY_N | T (STW, IB Craps, LIVE); C rare | 7 W, N L | 1:2, 2:3, 5:6 (C: 1:6, 1:3); vig 5% of the win | live: win ≥ $20 / penny: $2, $3, $6 | §4.3 | §4.3 |
| PTL_N (place to lose) | T (STW, MD live) | 7 W, N L | 5:11, 5:8, 4:5 | $11, $8, $5 / $11, $2, $1 | 1/33 = 3.0303%, 1/40 = 2.5%, 1/55 = 1.8182% | 1/132, 1/144, 1/180 |
| BIG_6 / BIG_8 | T only | N W, 7 L | 1:1 | $1 / $1 | 1/11 = 9.0909% | 1/36 = 2.7778% |

### 3.3 Hardways

Window: any roll. Removable and toggleable. Come-out status per §2.4. The rules are the same in crapless.

| id | Win | Lose | Pays | HE_res | HE_roll | E[rolls] |
|---|---|---|---|---|---|---|
| HARD_4 / HARD_10 | 2-2 / 5-5 | easy 4/10, any 7 | 7:1 | 1/9 = 11.111% | 1/36 | 4 |
| HARD_6 / HARD_8 | 3-3 / 4-4 | easy 6/8, any 7 | 9:1 | 1/11 = 9.0909% | 1/36 | 36/11 |

Non-US paytables: 15:2 → 5.556%; 19:2 → 4.545% [WOO-HE].

### 3.4 One-roll bets

- Window: any roll. Cancellable before bet time ends.
- STW re-bets winners automatically [V CW §32].
- HE_roll = HE_res.

| id | Wins on | Pays (to 1) | HE |
|---|---|---|---|
| FIELD | 2, 3, 4, 9, 10, 11, 12 (16 ways) | 1:1. On 2 and 12: **2:1 / 2:1 on machines** [V CW, IB; R VA]; 2:1 / 3:1 at live Vegas tables and IB paytable EL602 [V] | 1/18 = **5.5556%**; 1/36 = 2.7778% (3:1 on both: 0%) |
| ANY_7 | 7 | 4:1 | 1/6 = 16.667% |
| ANY_CRAPS, C | 2, 3, 12 | 7:1 | 1/9 |
| PROP_3, PROP_11 (E, yo) | 3 / 11 | 15:1 | 1/9 |
| PROP_2, PROP_12 | 2 / 12 | 30:1 | 5/36 = 13.889% |
| CE | 2, 3, 12 pay 3:1; 11 pays 7:1, on the whole bet | — | 1/9 |
| HORN | ¼ on each of 2, 3, 11, 12 at 30:1 / 15:1. Net on the whole bet: 2/12 +27/4; 3/11 +3; else −1. IB formula: (bet/4) × to-1 pay − 3·bet/4 ($100, 6-6 → +$675) | — | 1/8 = 12.5% |
| HORN_HIGH_X (live) | horn plus an extra unit on X (5 units) | — | 23/180 (X = 2/12); 11/90 (X = 3/11) |
| WORLD (live) | horn ×4 plus Any 7 ×1; a 7 pushes | — | 2/15 = 13.333% |
| HOP_EASY a-b | that non-pair, either order | 15:1 | 1/9 |
| HOP_HARD a-a | that pair | 30:1 | 5/36 |
| BIG / SMALL (IB, T) | v2.2.1 says single-roll; v2.5.1 says "before 7-out" [U]; paytable unknown | — | do not implement |
| LOW / HIGH FIELD (IB Easy Craps) | 2, 3, 4 / 10, 11, 12 | unknown | out of scope |

- **Hops offered:**
  - STW: all 15 easy and 6 hard [V STWO].
  - IB: 13 easy (no 1-2 or 5-6) and 4 hard (2-2 through 5-5). 1-1, 1-2, 5-6 and 6-6 are on the horn singles [V IB].
- "For 1" props are worse: 30 for 1 (29:1) and 15 for 1 (14:1) are both 16.667%.
- **Do not implement** the Maryland Any 7 at "26 to 5" (player +3.33%).

**Net per unit, by total (oracle table):**

| Bet | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Field 2:1/2:1 | +2 | +1 | +1 | −1 | −1 | −1 | −1 | +1 | +1 | +1 | +2 (+3) |
| Any 7 | −1 | −1 | −1 | −1 | −1 | +4 | −1 | −1 | −1 | −1 | −1 |
| Any Craps | +7 | +7 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | +7 |
| C&E | +3 | +3 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | +7 | +3 |
| Horn (per 4 units) | +27 | +12 | −4 | −4 | −4 | −4 | −4 | −4 | −4 | +12 | +27 |
| World (per 5 units) | +26 | +11 | −5 | −5 | −5 | 0 | −5 | −5 | −5 | +11 | +26 |

### 3.5 Crapless differences

| Item | Rule |
|---|---|
| Come-out and Come first roll | Only 7 wins. 2, 3, 11 and 12 become points; nothing loses on the come-out [V WOO-CL, MD-CL, IB] |
| Not offered | Don't Pass, Don't Come, lay, place to lose, Big 6/8, Big/Small. Lucky Shooter is defined for 4–10 only [V IB, MD-CL]. (A crapless Don't Pass with no bar would give the player +5.38% [M].) |
| Offered (IB) | Pass, Come, Pass and Come odds, Place and Buy on all 10 points, Hardways, Field, C, E, C&E, Seven, Any Craps, Horn, Hops, Lucky Roller [V IB] |
| Group buttons (IB) | Press and Across only. Across = all points except the established one (9 numbers) [V IB; A that 2/3/11/12 are included] |
| Easy Craps (IB) | Out of scope. No Come, Buy, Lay or don't bets; adds Low/High Field [V IB] |

---

## 4. Payout and money rules

### 4.1 Representation

- **Amounts:** money is integer `Cents`. Stakes must be multiples of `money.betIncrement` (or of `perType.increment`).
- **Payout ratios:** stored as exact `Ratio` "to 1"; `parseRatio` converts "for 1".
- **Win amount:**
  - `winExact = stake × num/den` (a Fraction).
  - `winPaid = round(winExact, catalog[type].payoutRounding ?? money.payoutRounding)`.
  - Round **once** per bet settlement. Composite bets (horn, world, C&E) settle as a single bet using their whole-bet net table.
- **Credited:** `credited = (stake if returned) + winPaid − vigOnWin − vigRearmFromWin`.
- **Ledger invariant:** `deposits = bankroll + Σ bet.amount + houseNet`.

### 4.2 Rounding

| Context | Payout rounding | Commission rounding | Tag |
|---|---|---|---|
| STW, place 6/8 (7:6) | `{ceil, 1}`: $1 → $1.17; $2 → $2.34 | — | R (7craps 2012; Aruze STW 2018) |
| Machine, all other fractional payouts | `{floor, 1}` | `{ceil, 1}` | A (conservative; no report exists) |
| LIVE | `{floor, 100}` (whole dollars, "keep the change") | floor to whole dollar, $1 minimum | V [LVA-RND, HAR-PA] |

The existing `src/engine/money.ts` supports only `floor | nearest`. Add `ceil` and `halfEven` (plan §4.2). The existing `TO_THE_PENNY = {floor, 1}` is the A default.

| Breakage example [M] | Floor | Half-up | Ceil | Exact |
|---|---|---|---|---|
| $1 place 6 | $1.16 → 1/55 = 1.818% | $1.17 → 1.364% | $1.17 → 1.364% | 1.515% |
| $2 place 6 | $2.33 → 1.591% | $2.33 → 1.591% | $2.34 → 1.364% | 1.515% |
| $5 place 6 | $5.83 → 17/1100 = 1.545% | 1.545% | $5.84 → 1.455% | 1.515%. LIVE pays $5 → 1/11 = 9.09% |
| $1 lay odds on 6 (5:6) | $0.83 → −0.182% on the odds bet | $0.83 | $0.84 → **player +0.364%** (reject) | 0 |
| $1 lay odds on 5 (2:3) | $0.66 → −0.400% | $0.67 → **player +0.200%** (reject) | — | 0 |
| $1 lay on 4, 5% vig on win (win $0.50, vig $0.025) | vig ceil to $0.03 → net $0.47 → 2.000% | — | vig floor to $0.02 → net $0.48 → 1.333% | 1/60 = 1.667% |

**Sub-cent payouts with whole-dollar bets** occur only on:
- place 6/8 not in multiples of $3;
- place to lose 4/10 and 5/9;
- lay odds 2:3 and 5:6 not in multiples of $3;
- lays not in multiples of $2 (4/10), $3 (5/9) or $6 (6/8).

Everything else is exact to the cent.

### 4.3 Commission (vig): formulas and edges

Rate r = 1/20. w = ways for the number. Buy pays true odds 6/w to 1. Lay wins w/6 per $1 laid.

| Mode (`basis`, `timing`) | Formula | Where |
|---|---|---|
| Buy, `stake`, `onWin` | Win: credit stake + stake·6/w − round(r·stake). HE = r·P(win) | STW "5% of the BET amount is deducted from the win" [V CW §18d] |
| Buy, `win`, `onWin` | vig = r·stake·6/w. HE = 6r/(w+6) | Isle Pompano / Interblock 2015–17 (settled lawsuit) [V TCA]; one 2025 report [R] |
| Buy, `stake`, `upfront` | vig charged at placement and on increases, held in `vigHeld`. `refundOnTakeDown`; `rearm` ∈ {recollectFromWin, recollectFromCredit, none}. Re-collected: HE = r/(1+r) = **1/21** per (stake + vig) = 5% per stake | IB GV6.5 YES/NO pop-up; NO removes the bet [V IB §3.3]. "Some/most" Interblock and crapless installs charge upfront on **all** buys [R VA]. LIVE [V HAR-PA] |
| Lay, `win`, `onWin` | credit stake + win − round(r·win). HE = r·w/(w+6) | STW "5% of the WIN pay amount is deducted from the win" [V CW §20d] |
| Lay, `win`, `upfront` | vig = r × potential win. Example: $2 lay on 4 → $0.05 | IB pop-up [R]; LIVE HAR-PA [V] |
| Lay, `stake`, `upfront` (≤ 5% of the amount wagered) | — | Maryland option [V MD-C] |
| LIVE minimums | vig = max($1, floor$(r·base)). Harrah's PA: minimum buy $20; lay must win ≥ $20; refunded if taken down; **re-paid on every win** [V HAR-PA]. WoO: commission "usually non-refundable" [R WOO-B]. Some casinos charge 4/10 buys only on a win [R WOO-B] | — |

**Edges by commission mode [M]** (lay on 2/12 and 3/11 shown in parentheses because it is rare):

| N | Place | Buy on win (5% of stake) | Buy on win (5% of win) | Buy upfront, re-collected | Buy upfront, not re-collected (lifecycle) | Lay on win | Lay upfront, re-collected | Lay upfront, not re-collected |
|---|---|---|---|---|---|---|---|---|
| 4/10 | 6.667% | **1.667%** (1/60) | 3.333% | 4.762% (1/21) | 3.226% (1/31) | 1.667% | 2.439% (1/41) | 0.826% (1/121) |
| 5/9 | 4.000% | 2.000% | 3.000% | 4.762% | 2.913% (3/103) | 2.000% | 3.226% (1/31) | 1.316% (1/76) |
| 6/8 | **1.515%** | 2.273% | 2.727% | 4.762% | 2.655% (3/113) | 2.273% | 4.000% (1/25) | 1.859% (5/269) |
| 2/12 (C) | 7.143% (5:1 version: 14.29%) | 0.714% | 4.286% | 4.762% | 4.110% (3/73) | (0.714%) | (0.826%) | (0.119%) |
| 3/11 (C) | 6.250% (13:5 version: 10%) | 1.250% | 3.750% | 4.762% | 3.614% (3/83) | (1.25%) | (1.639%) | (0.415%) |

**HE_roll:**
- On win (5% of stake), buy or lay: 1/240, 1/180, 1/144 (4/10, 5/9, 6/8); C buy 1/720, 1/360 (2/12, 3/11).
- Buy upfront, per (stake + vig): 1/84, 5/378, 11/756 (4/10, 5/9, 6/8); C 1/108, 2/189 (2/12, 3/11).
- Lay upfront, per (lay + vig): 1/164, 5/558, 11/900 (4/10, 5/9, 6/8).

**Place vs buy:**
- 4/10, 2/12, 3/11: **buy** is better under every exact-5% mode.
- 6/8: **place** is better under every mode.
- 5/9: buy is better if the vig is charged on the win or not re-collected; place is better if upfront vig is re-collected.
- Live flat $C vig on 4/10: an upfront buy beats placing only if the bet B > 15C ($1 vig: B > $15, tie at $15); an on-win buy beats placing if B > 5C.

**Live buy-the-4 examples:**

| Buy amount and vig | Upfront | On win |
|---|---|---|
| $25 for $1 | 3.846% | 1.333% |
| $39 for $1 | 2.5% | 0.855% |
| $10, $1 minimum | 9.091% | — |
| $5, $1 minimum | 16.667% | pays $9, same as placing |

### 4.4 Odds limits

| Rule | Formula | Source |
|---|---|---|
| Take odds, k× | ≤ k·flat on every point. Crapless: all 10 points | [V WOO-B] |
| Take odds, 3-4-5× | ≤ 3× on 4/10, 4× on 5/9, 5× on 6/8, so every maximum win = 6× flat | [V WOO-B] |
| Lay odds, `basis:'win'` (standard) | lay ≤ k·flat ÷ (w/6): 2k (4/10), 1.5k (5/9), 1.2k (6/8). On 3-4-5× tables: lay ≤ 6× flat on every point | [V WOO-B, MD-C; CW §15 for Don't Come] |
| Lay odds, `basis:'stake'` | lay ≤ k·flat | [V CW §12 for Don't Pass; STWO "multiple of the base wager, between 2x and 100x"] |
| Machine caps | STW configurable 2×–100× [V STWO]. IB pop-up multipliers up to a configured maximum, adjustable manually before each roll [V IB]. Observed: 2× most common [R VA "mostly double"]; also 3×, 4×, 5×, 10×, 3-4-5×, and 3×/2× by number (Arizona) [R WOV-*]. Crapless 2× [R VA, LVA-CL] | — |
| Rounding the cap | floor to the bet increment [A] | — |

**Combined edge, ties counted [M]:**
- Pass: (7/495)/(1 + 2k/3).
- Don't Pass, win basis: (3/220)/(1 + k).
- Don't Pass, stake basis: (3/220)/(1 + 2k/3).
- Crapless pass: (373/6930)/(1 + 5k/6).

| Limit | Pass + odds | Don't Pass + lay, win basis | Don't Pass + lay, stake basis | Crapless pass + odds |
|---|---|---|---|---|
| none | 1.4141% | 1.3636% | 1.3636% | 5.3824% |
| 1× | 0.8485% | 0.6818% | 0.8182% | 2.9359% |
| **2×** | **0.6061%** | **0.4545%** | **0.5844%** | **2.0184%** (373/18480) |
| 3× | 0.4714% | 0.3409% | 0.4545% | 1.5378% |
| 3-4-5× (don't side lays 6×) | 0.3743% | 0.2727% (lay 6×) | 0.3610% (lay ≤ 3/4/5× flat) | — |
| 5× | 0.3263% | 0.2273% | 0.3147% | 1.0418% |
| 10× | 0.1845% | 0.1240% | 0.1779% | 0.5767% |
| 100× | 0.0209% | 0.0135% | 0.0202% | 0.0638% |

Odds never change the flat bet's dollar loss per decision: 7/495 × flat (T) or 373/6930 × flat (C).

### 4.5 Limits and credit

| Item | Observed values | Tag |
|---|---|---|
| Machine minimums | $1–$5 (heads-up and STW); crapless $1–$6 [R VA]; Mohegan crapless $5 [R G3-MOH]; Arizona $0.50 pass [F] | R |
| Maximum per wager | WA tribal ETG cap $500 [V WSGC-ETG]; $195 line max (2023), $500 max spread (2017), place/lay ≤ $25 (2015), Arizona $35 total, $25,000 (Florida), lays capped at $500 [F] | R/F |
| Hot Shooter | $1–$1,000; needs ≥ 3 credits on the craps game [V CW §33] | V |
| Lucky Shooter | 1–100 credits [V IBLS] | V |
| Fire Bet (MD live) | $1–$5 in $1 steps [V MD-C] | V |
| OFF bets and credit | STW: OFF chips use no credit and don't count toward the minimum [V STWO]. IB: every placed bet reduces Playable, ON or OFF; the minimum must be met by active bets [V IB] | V |
| Upfront vig | Must be covered by credit at placement; declining removes the bet [V IB §3.3] | V |
| Cash-out | IB: only with no bets on the table; ticket or hand pay [V IB] | V |

---

## 5. Machine configuration

### 5.1 Configuration knobs (schema additions beyond plan §4.4 marked +)

| Group | Knob | Options / semantics |
|---|---|---|
| Rules | `variant` | `traditional` / `crapless` |
| | `rules.dontBar` | 12 / 2 / null |
| | `rules.allowPutBets` | bool |
| | `catalog[]` | Presence = offered. Per type: `pays` per number, `commission`, `afterWin`, `comeOutDefault`, `payoutRounding`+ |
| Money | `money.payoutRounding`, `money.betIncrement` | `RoundingRule{mode: floor/ceil/halfUp/halfEven, increment}` |
| | `catalog[t].payoutRounding`+ | Per-type override; needed for place 6/8 ceil vs wrong-way floor |
| | `catalog[t].commission` (+ per-number override+) | `CommissionInput`; per-number override needed for live "on win for 4/10 only" |
| Pays | place / buy / lay / PTL / odds / field / props / hops / hardways / big | Exact ratios. Crapless place 2/12 ∈ {11:2, 5:1}; 3/11 ∈ {11:4, 13:5}. `payLabelStyle`+ ∈ {to, for} affects display only |
| Limits | `limits.{min, max, tableMax, perType}`; `minTotal{amount, scope: perBet/totalRound, countOff: false, countSideBets: ?}`+ | — |
| Odds | `odds.take{multiplier per point}`, `odds.lay{multiplier, basis: stake/win}` per parent type+ | Don't Pass and Don't Come can differ (STW) |
| Working | `comeOut.autoOff{carried[], newlyPlaced[], reOnAt: pointEstablished}`+; `afterSevenOut.newPlacedOff{types[], until: playerOn/pointEstablished}`+; `layAutoOn{afterPointMade, afterSeven}`+; `oddsOffReturnedAtPointMade`+ | §2.4 |
| | `workingToggle{global, scope, types[]}` | STW 10 types; IB 5 types |
| | `offBets.consumeCredit`+ | STW false; IB true |
| Mutability | `dontPassAfterPoint`+ | locked / reduceRemove |
| | `dontComeAfterTravel`+ | — |
| | `noRebetAfterRemove`+ | `nextCycle` |
| | `oddsMutable` | — |
| | `sideBetsWithdrawable` | false |
| Exclusivity | `exclusiveGroups[]` with `scope: global/sameNumber`+ | — |
| | `excludeLineVsLayBuy`+ | IB: Pass blocks Lay on the point; Don't Pass blocks Buy on the point |
| Auto-actions | `afterWin` per type | `stay` / `return` / `stayIfFirstRoll`+ / `stayIf11`+ |
| | `keepBetsOn`, `repeatLastBet` | UI |
| Side bets | `hotShooter`, `luckyShooter`, `luckyRoller`, `fire`, `powerOdds` | See §6 |
| Flow | `pace{rollsPerHour, betWindowSec}`, `shooterWindowSec`+, `shooter{mode: community/single}`+ | — |
| | `invalidRoll`+ | reshoot / void / attendant (cosmetic) |
| | `puckReset`+ | 0/1/2 (IB single-play) |
| | `groupButtons`+ | Across / Inside / Outside / Press, with conditions |
| | `historyLength`+ | — |
| Provenance | `provenance[jsonPointer] = {status, source, note}` | Required for every non-assumed value |

### 5.2 Presets

Column names below are the preset ids `traditionalBubble`, `craplessBubble`, `strictBubble`, `traditionalLive345`.

| Knob | **traditionalBubble**: "Typical Vegas bubble craps" (STW dome; Circa, Downtown Grand [R VA]) | **craplessBubble**: "Crapless bubble craps" (IB heads-up crapless; MGM Grand, Fontainebleau, Fremont, Red Rock [R VA]). **DEFAULT** | **strictBubble**: "Strict machine" (IB GV6.5 traditional, 2× odds, upfront vig) | **traditionalLive345**: "Generous live table" |
|---|---|---|---|---|
| variant / dontBar | T / 12 [V CW] | C / null [V IB] | T / 12 [V IB] | T / 12 [V] |
| Bets offered | Pass, DP, Come, DC, 4 odds types, Place, Buy, PTL, Lay, Big 6/8, Hard, Field, Any 7, Any Craps, C, E, C&E, Horn (+ singles), 21 hops [V CW, STWO] | Pass, Come, odds, Place and Buy on 2–12, Hard, Field, C, E, C&E, Seven, Any Craps, Horn (+ singles), 17 hops [V IB] | Pass, DP, Come, DC, odds, Place, Buy, Lay, Big 6/8, Hard, Field, props, 17 hops; no PTL [V IB]. Big/Small disabled [U] | Everything, plus PTL [V MD-C], put bets [R WOO-B], horn-high, world |
| Take odds | 2× [V CW §6, §10; R VA] | 2× on all 10 points [R VA, LVA-CL] | 2× [R] | 3-4-5× [V WOO-B] |
| Lay odds | DP: stake basis 2× [V CW §12]. DC: win basis 2× [V CW §15] | n/a | stake basis 2× [A] | lay 6× flat (win basis 3/4/5×) [V WOO-B] |
| Odds pays | true [V CW] | true, including **6:1 (2/12) and 3:1 (3/11)** [R MD-CL, WOO-CL; A for IB's par sheet] | true [A] | true [V] |
| Place pays | 9:5 / 7:5 / 7:6 [V CW §17] | same, plus **11:2 (2/12), 11:4 (3/11)** [A; alternatives 5:1 / 13:5 per CROWN-CL, MD-CL] | standard [A] | standard [V] |
| Buy vig | 5% of stake, **onWin** [V CW §18] | 5% of stake, **upfront**, `refundOnTakeDown:false`, `rearm:recollectFromWin` [R VA; mechanism V IB; refund/rearm A] | same as crapless [V/R/A] | 4/10: onWin [R WOO-B]. Others: upfront, floor to $1, minimum $1, refund true, rearm recollect [V HAR-PA] |
| Lay vig | 5% of win, onWin [V CW §20] | n/a | 5% of win, upfront, no refund, recollect [R IB pop-up / A] | 5% of win, upfront, floor to $1, minimum $1, refund true, recollect [V HAR-PA] |
| Place to lose | 5:11 / 5:8 / 4:5 [V CW §19] | n/a | n/a [V IB] | same [V MD-C] |
| Big 6/8; hardways | 1:1; 7:1 / 9:1 [V CW] | —; 7:1 / 9:1 [A, IB par] | 1:1; 7:1 / 9:1 [A] | 1:1; 7:1 / 9:1 [V] |
| Field 2 / 12 | 2:1 / 2:1 [V CW §8] | 2:1 / 2:1 [R VA] | 2:1 / 2:1 [V IB default] | 2:1 / **3:1** [V WOO-B] |
| Props / hops | Any 7 4:1, C 7:1, E 15:1, C&E 3:1 / 7:1, horn 30 / 15 / 15 / 30, hops 30 / 15 [V CW] | same [R IB screen: 5/8/16/31 "for 1"] | same [R] | same, "to 1" [V MD-C, HAR-PA] |
| Payout rounding | place 6/8 `{ceil, 1}` [R]; others `{floor, 1}` [A] | `{floor, 1}` [A] | `{floor, 1}` [A] | `{floor, 100}` [V] |
| Commission rounding | `{ceil, 1}` (only lay can hit sub-cent) [A] | `{ceil, 1}` [A] | `{ceil, 1}` [A] | `{floor, 100}`, minimum 100 [V HAR-PA] |
| Bet increment | $1 [A] | $1 [A] | $1 [A] | $1; bot grid $5 / $6 [V] |
| Minimum | $1 per bet; **$3 total** [A; R range $1–$5] | $1 per bet; **$5 total** [A; R $1–$6, G3 $5] | $5 total [A] | $10 line [A] |
| Maximum per wager | $500 [A; WA cap V] | $500 [A] | $500 [A] | $5,000; odds may exceed [A] |
| Come-out working | STW policy (§2.4) [V; new chips A] | IB policy (§2.4) [V] | IB policy [V] | LIVE: place/buy OFF, come odds OFF→returned, DC odds ON, lay ON, PTL ON, hard ON, Big ON [V/R] |
| Toggle | 10 types, "from the upcoming roll onward" [V STWO] | Place, Buy, Odds, Hard; persists [V IB] | Place, Lay, Buy, Odds, Hard [V IB] | per bet |
| OFF bets use credit | no [V STWO] | yes [V IB] | yes [V IB] | n/a |
| DP after point / DC after travel | locked [V CW §11e] / removable [A] | n/a | reduce/remove, no re-bet until next cycle [V IB §2.3] / same [A] | reduce/remove, no re-add or increase [V MD-C] / same [V] |
| Exclusive | Pass×DP, Come×DC (global); Place×{PTL, Lay}, Buy×{Lay, PTL} on the same number [V CW §21; same-number scope A]. Place + Buy on one number allowed [A] | Place + Buy on one number if the paytable allows [V IB] | Pass×DP, Come×DC; Place×Lay, Buy×Lay; `excludeLineVsLayBuy` ON [setting V IB221; ON A] | none (Doey-Don't allowed) [A] |
| afterWin | Pass stay; DP/DC `stayIfFirstRoll`; Come `stayIf11`; place, buy, hard, field, lay, PTL, props, hops, big stay [V CW §29–32] | Pass stay (chips "pushed to the next round") [V IB §2]; place/buy/hard stay [A]; one-roll return, with Keep Bets On/Repeat as UI [A] | same as crapless | Pass stay; Come return; number bets stay; one-roll return [A] |
| Side bets | HSJ: tiers 1/3/5/7/12/30/100× "for 1" at 8/16/24/32/40/45/50+ rolls; definition A; window = come-out after a 7-out; qualifier 3 credits; $1–$1,000 [V CW; definition A]. Lucky Roller 30/30/155 [A]. Power Odds off [A] | **Lucky Roller 30/30/155 to 1** [R]; window after a 7 or at cycle start, no re-bet after a win until a 7 [V IB]. Lucky Shooter off [V] | Lucky Roller 30/30/150 [A]; Lucky Shooter table A [A] | Fire Bet 24/249/999 to 1, optional [R WOO-FIRE] |
| Pace | 100 rolls/hr [A]; bet window 20 s [R]; shooter window 20 s [R] | 120 rolls/hr [A]; no timer, self-paced [V/R] | 120 [A]; no timer | 144 [R WOO-K, 5 players] |
| Shooter / invalid roll / puck | community; rotate per CW §35g (cosmetic) / reshoot [A] / — | single (player) [V] / re-vibrate [R] / `puckReset` 0 [V options] | single / same / 0 | rotate at 7-out / no roll |
| Group buttons / history | Across: after the come-out, only with Pass, DP, Field or a one-roll bet up [V STWO] / 27 rolls [V] | Press, Across (same conditions) [V IB] / configurable | Press, Across, Inside, Outside [V IB] | — |

---

## 6. Side bets

### 6.1 Availability

| Side bet | STW | IB heads-up | IB stadium | LIVE / regulator | Notes |
|---|---|---|---|---|---|
| Hot Shooter Jackpot | V (configurable) | — | — | PA: fully automated or hybrid tables [V PA623c] | Also on Roll to Win (not a bubble) |
| Lucky Roller / All Small–Tall–All | V (configurable) | V (T, C, Easy) | R | Galaxy Bonus Craps; NV Super Shooter; NJ/MD/PA | Has "mostly replaced" Lucky Shooter on Las Vegas heads-up and crapless machines [R VA] |
| Lucky Shooter | — | V (T only; legacy) | R | PA (automated only), MD | — |
| Power Odds | V | — | — | — | Feature, not a wager |
| Fire, Hot Roller, Repeater, Ride the Line, Different Doubles, Sharp Shooter, Replay, Galaxy progressives | — | — | — | live only | None found on any bubble machine |

### 6.2 Hot Shooter Jackpot [V CW §33, STWO §7.2; M]

| Roll count | ≤ 7 | 8–15 | 16–23 | 24–31 | 32–39 | 40–44 | 45–49 | ≥ 50 |
|---|---|---|---|---|---|---|---|---|
| Pays (× bet, "for 1") | 0 | 1 (push) | 3 | 5 | 7 | 12 | 30 | 100 |
| P (definition A) | 0.570956 | 0.297425 | 0.091300 | 0.027973 | 0.008566 | 0.001976 | 0.000943 | 0.000861 |

| Definition | HE |
|---|---|
| **A**: every roll counts, including the 7-out (default) | **9.0740%** |
| A, exactly 50 rolls in MAJOR (Grand at ≥ 51) | 9.9029% |
| A, literal "OVER 50" (50 pays nothing) | 10.2581% |
| B: 7-out not counted | 21.5608% |
| C: neither the first come-out nor the 7-out counted | 32.3353% |
| "to 1" reading | player +14–34%: impossible, reject |

Not defined for crapless.

### 6.3 Lucky Shooter [V PA623c, MD-C, IB, IBLS; M]

Settlement:
1. **Come-out:** 2, 3 or 12 loses. 7 or 11 pushes and the bet stays. 4–10 sets the Lucky Shooter point P, and the bet becomes a contract bet.
2. **Hits:** each later roll of a box number not yet hit and ≠ P adds a hit.
3. **Settlement:** any other roll (2, 3, 7, 11, 12, P, or a repeat) settles with k hits. The repeat rule comes from PA/MD; IB is silent; default `repeatEndsBet: true`.
4. **After 5 hits:** the next roll settles. P pays the top award; anything else pays the 5-hit award.

| Outcome | P per come-out roll | P per resolved wager |
|---|---|---|
| 7/11 push | 2/9 | — |
| 2/3/12 loss | 1/9 | 1/7 |
| Point, then 0 / 1 / 2 / 3 / 4 hits | 97/324, 67/324, 7583/69984, 8597/209952, 175/17496 | 0.384921, 0.265873, 0.139311, 0.052647, 0.012860 |
| 5 hits, 6th roll not P / 5 hits + P | 125/118098, 125/944784 | 0.0013609, 0.00017011 |

| Paytable ("for 1") | 5 hits + P | 5 hits | 4 | 3 | 2 | HE per resolved wager | HE per come-out roll |
|---|---|---|---|---|---|---|---|
| A | 1000 | 150 | 15 | 5 | loses | 249299/1469664 = 16.963% | 13.193% |
| B | 500 | 100 | 10 | 4 | 2 | 118345/734832 = 16.105% | 12.526% |
| C | 1000 | 150 | 20 | 5 | loses | 154799/1469664 = 10.533% | 8.192% |
| **D** (IB screen) | 500 | 100 | 10 | 5 | 2 | **159317/1469664 = 10.840%** | 8.431% |

- E[rolls per resolved wager] = 474275/163296.
- Traps:
  - Reading "for 1" as "to 1" makes D look like a player +9.79% bet.
  - The bubble-craps.com table pays 1000/150/20/5/2/1: that is player +43.9%. Reject it.

### 6.4 Lucky Roller / All Small / All Tall / Make 'Em All [M]

- Small = 2–6 all rolled before a 7; Tall = 8–12; All = all ten.
- Repeats and order don't matter. Any 7 loses, including a come-out 7.
- Tracking starts fresh at placement, so placement timing does not affect the edge.
- P(Small) = P(Tall) = 20049/760760 = 0.0263539.
- P(All) = 126538525259/24067258815600 = 0.0052577.
- Break-even pays: 36.945 to 1 (Small/Tall), 189.197 to 1 (All).

| Small/Tall (to 1) | 30 | 31 | 33 | 34 | 35 |
|---|---|---|---|---|---|
| HE | 18.3029% | 15.6675% | 10.3967% | 7.7613% | 5.1259% |

| All (to 1) | 150 | 155 | 160 | 170 | 174 | 175 |
|---|---|---|---|---|---|---|
| HE | 20.6087% | **17.9798%** | 15.3510% | 10.0933% | 7.9902% | 7.4644% |

Paytables in use:
- IB screen: **30/30/155** [R].
- Galaxy PT-01: 34/34/175. Galaxy PT-02/03: 30/30/150 [V GALAXY-WA].
- WoO: usually 30/150 [R].
- PA/MD/NJ: 34/34/175 or 30/30/150 [V].
- NV Super Shooter: Small/Tall 30 or 34; All 150, 160 or 175 [V NV-SS].
- STW: Low = High, Roll 'Em All "substantially higher"; values on the par sheet [V STWO; values U].

### 6.5 Power Odds (STW) [V CW §34, STWO]

- **How it works:** random. It shows after bet time ends and applies to that roll only. One of two boost values is chosen; "the maximum improved odds value doubl[es] the pay".

| Spot | Boosted pays |
|---|---|
| Any Craps / C | 10:1 or 14:1 |
| Any 7 | 6:1 or 8:1 |
| E, easy hops, horn 3/11 | 22:1 or 30:1 |
| Horn 2/12, hard hops | 45:1 or 60:1 |
| C&E | 2/3/12: 4:1 or 6:1; 11: 10:1 or 14:1 |
| Hard 4/10 | 10:1 or 14:1 |
| Hard 6/8 | 13:1 or 18:1 |

- **Trigger rates:** unpublished [U].
- **Model:** EV = base EV + Σ_b P(boost b)·p_win·(b − base).
- **Break-even [M]:** hard hop at 45:1 needs a boost on 1/3 of rolls; at 60:1, on 1/6. Any 7 at 6:1 needs 1/2; at 8:1, 1/4.
- **Default:** disabled in the rules-exact profile; trigger rates set by the user.

### 6.6 Live-only side bets (reference; lab and coach comparisons)

| Bet | Rule summary | HE [M] |
|---|---|---|
| Fire Bet | Unique points made by the shooter. Paytable A 24/249/999 to 1 at 4/5/6 | 20.7628% (T). Crapless, all 10 points count: **13.4152%**; only 4–10 count: **70.4488%**. MD Pay Table B (39/199/499): 23.8869% |
| Hot Roller | Every combination of a number completed before any 7 | 7.5003% (PA-A), 3.3782% (PA-B), 13.1290% (NJ-A) |
| Repeater | n repeats of a number before a 7 | 18.08–21.88% |
| Ride the Line | Pass-line wins until the 7-out | 8.52–10.60% |
| Different Doubles | Distinct doubles before a 7 | 43/154 = 27.92% |
| Sharp Shooter / Replay | Points made, with repeats / the same point made repeatedly | 21.87% / 24.81% |

---

## 7. Strategy definitions (bot and Monte Carlo lab)

### 7.1 Metrics (match plan §5.1)

| Metric | Definition |
|---|---|
| EV per hand; P(hand > 0); SD per hand | Per hand, as defined in §0.1 |
| Edge per $ resolved | Theoretical loss ÷ resolved handle. Handle = bet amounts that won or lost. Pushes, returned OFF bets and take-downs are excluded. Upfront vig counts bet + vig |
| Edge per $ made | Theoretical loss ÷ new money placed |
| Theoretical-loss accumulator | Each roll: + amount × HE_roll for each working non-contract bet. + flat × 7/495 (T) or 373/6930 (C) per Pass/Come placement; + flat × 3/220 per Don't Pass/Don't Come. Odds + 0. Upfront vig: + vig at placement, − refund. A travelled Don't Pass/Don't Come that is removed forfeits its equity (§3.1) |
| Static place layout, OFF on the come-out | Loss per hand = **6 × Σ amount × HE_roll**, in both variants |
| Hits on a place set S (OFF on the come-out; S fixed, includes the point) | P(k hits) = q^k(1 − q), with q = W(S)/(W(S) + 6). {6,8} 5/8; {5,6,8} 7/10; Inside 3/4; Across 4/5; single 6 5/11; single 5 2/5; single 4 1/3 |

**IB note:** place bets work on the come-out, so a bot reproducing the "OFF on come-out" values must call `setWorking(false)` at each come-out. Otherwise:
- working rolls per hand = 6 + come-out rolls per hand;
- $6 + $6 on 6 & 8 loses 0.4736 per hand (T) or 9613/21909 = 0.4388 per hand (C), instead of 1/3.

### 7.2 Universal bot rules (defaults; each strategy overrides rows)

| State / rule | Action |
|---|---|
| NEWHAND (session start, or the window after a SEVEN_OUT) | H = 0, h[·] = 0, handPL = 0, then strategy resets |
| Come-out window | Place the strategy's come-out bets. Cancel machine auto-continuations the strategy doesn't want: Pass only before its point; field and one-roll bets any time. Place/buy/hard/Big follow the machine policy (§2.4) |
| Hit | A place or buy win on n: H++, h[n]++. A place bet on the point wins at MADE and counts as a hit. Come wins are not hits [A]. Default press = SAME |
| Contract | Never cancel or reduce Pass/Come after the point. Never cancel a Don't Pass after the point, or place or increase one. Treat a travelled Don't Pass/Don't Come as contract everywhere |
| Timing | Come/DC only in point-phase windows; Pass/DP only in come-out windows; `allowPut = false`; odds only behind an established point |
| Odds caps | ≤ maxOdds; STW Don't Come win basis, STW Don't Pass stake basis (`layBasis`) |
| Grid | Penny machine: place 6/8 in $3 multiples; place 4/5/9/10, buy and take odds any $1; lay odds $1 (4/10) and $3 (5/9, 6/8); lays $2 / $3 / $6. Live: place $5 / $6; lay odds $2 / $3 / $6. Regressions round down; power presses round up |
| Funding when short | Contract → odds → 6/8 → 5/9 → 4/10 → lay → props. If the come-out contract bet is unaffordable and no contract bet is live: STOP |
| Caps hit | Clamp; a press over the cap becomes SAME; doubling progressions bust and reset |
| Below minimum | `skip` (default) / `raise` |
| Machine rejects a combination | Keep in priority order: contract > odds > place/buy > lay/PTL > props |
| Exclusivity (STW) | No Pass with DP; no Come with DC; no Place with PTL/Lay or Buy with Lay/PTL on the same number in the same roll |
| Auto-actions | Diff the target against the layout after the machine's auto re-bets (STW §29–32; Aqueduct banks Come wins [R WOV-9005]) |
| Session gate (checked at hand boundaries) | Session bankroll SB = 30–50 units [AoC] (or bets of 1–2% of SB [HR]). Stop-loss 40–50% of SB [AoC]. Win goal 30–50% [AoC] / 50% [HR]. `winGoalAction` STOP / LOCK: guarantee = 0.4 × PL at first reach [A]; + 0.5 × each new high [AoC]; stop at PL ≤ guarantee. Also stop at maxHands, maxRolls or when the bankroll is short |
| WIND_DOWN | No new bets. Take down place, buy, lay, PTL, hard, field and props, plus odds if removable. Let contract flats resolve. Cancel the auto re-bet Pass. STOP when no contract bet remains |

### 7.3 Strategy decision table

T values use u = $5, the live grid and point-phase-only place bets, unless noted. "Codified" means built from community patterns; label it "codified" in the UI.

**Sources:** PASS_ODDS [WOO-B, CO-BUB] · DONT_PASS_LAY [WOO-B, WOO-SYS] · DOLLY3 [WOV-DOLLY] · MOLLY(K) [WOV-3PM, BC-3PM, HR] · PLACE_68 [WOO-SYS, HR] · INSIDE/ACROSS [MC, PNAT, BS] · IRON_CROSS [WOO-326, BC-IC, MC] · HEDGE [WOO-SYS, WOV-36080, MC] · FIVE_COUNT [WOO-228] · BANKROLL_BUILDER [YT-BB, HR, AoC] · FIB_PRESS [YT-FIB] · POWER_PRESS [CC-PRESS, PNAT, MC] · THREE_HIT [MC, HR] · COVER_HEDGE [WOO-326, MC] · LOW_INVESTMENT (no source)

| id | Parameters (defaults) | Come-out window | EST(p) | Point-phase rolls / HIT | MADE(p) | SEVEN_OUT | Exact values [M] | Crapless? |
|---|---|---|---|---|---|---|---|---|
| PASS_ODDS (sourced) | u, k = max | Pass u | odds = floorGrid(min(k, cap)·u); largest affordable | — | paid; Pass u | lose | EV per hand −u/28 (C −746u/7303). 2×: 0.606% (C 2.018%). SD per decision 2.858u (2×), 4.916u (3-4-5×) | yes |
| DONT_PASS_LAY (sourced) | u, k, layBasis | DP u. 2/3 win (STW keeps it up); 7/11 lose and re-bet; 12 push | lay L(p) = win basis k·u·{2, 1.5, 1.2} or stake basis k·u | — | lose; DP u | win | EV per hand −27u/784. 2× win basis 0.4545% (made) / 0.4588% (resolved); stake basis 0.5844%; 3-4-5× (lay 6×) 0.2727% | no |
| DOLLY3 (sourced) | N = 3, lay 6× flat (3-4-5×) | DP u if covered < N | travel + lay | DC u while covered < N and the box is empty. Box: 11 L, 2/3 W, 12 push, n → travel + lay. DC on n loses when n rolls | DP + lay lose; box DC travels to p | all don'ts win; box DC loses; end | flats per hand 77671/12740; EV per hand −21183u/254800. 0.2743% (resolved) / 0.2727% (made); 2× win basis 0.4588% / 0.4545%; P(hand > 0) 67.98% (simulation). Variant DARK_DOLLY: $30 DP + $2 yo + $1 midnight; $10 DCs [MC] | no |
| MOLLY(K) (sourced; 3-Point Molly = K2) | K, u, k; come odds OFF on the come-out | Pass u; come flats stay; come odds OFF (7 → flats lose, odds returned; come point rolled → wins, odds returned) | pass odds | Box Come u while \|C\| < K and the box is empty. Travel → come odds k·u. A come bet on n wins: paid and removed. Box 11 W (STW rides it), 2/3/12 L | paid; box travels to p | all lose except the box (wins) | Flats per hand: K1 891/196 (EV −9u/140), K2 77671/12740 (EV −7061u/81900), K3 7.2178 (−0.10207u). Per resolved, 2×: 3PM 0.6429%, 2PM 0.6337%, K3 0.6471%; 3-4-5×: 0.4044 / 0.3968 / 0.4079% | yes (travels to 2/3/11/12) |
| PLACE_68 (sourced) | b = 6, m0, R, D, excludePoint, reEnter | nothing | 6 = 8 = amt(H) (minus p if excluded) | H++, retarget (amt = m0·b if H < R; b if H < D; 0 = down and disarm) | keep | NEWHAND | V1 $6/$6: −1/3 per hand, P > 0 25/64. V2 $12→$6 after the 1st hit: −11/24, 5/8. V3 = V2 + down after the 2nd hit: −21/64, 5/8. V4 $6, down after 2 hits: −13/64, 25/64. V5 1-hit hit-and-run: −1/8, 5/8. Pass $5 + 2× + 6/8 excluding the point: −527/1176 (0.948%) | yes |
| INSIDE / ACROSS (sourced presets) | $22 Inside = 5/6/6/5; $44 = 10/12/12/10; $32 Across = 5 on 4/5/9/10 + 6 on 6/8; literal "$32 Inside" = 10/6/6/10; "$44 Across" = 5s + $12 on 6/8; R, D, excludePoint, useBuy | nothing | layout | H++; regress at R; down at ≥ D | keep; bet on p counts as a hit | NEWHAND | Inside $22: −1, 2.586%, SD 24.25, P > 0 81/256. $44 → $22 after 1 hit: −5/4, P 27/64. Across $32: −2, 3.727%, P 1037/3125. Across with buy 4/5/9/10 (vig on win): −11/12, 1.708% | yes (Across = 9 numbers [A]) |
| IRON_CROSS (sourced) | f = 5, place 5/6/8 at 5/6/6 | Pass if included; cancel auto-continued field | field + 5/6/8 | 5/6/8: place paid, field lost → re-bet. Field numbers: field paid | places stay | −$22 | Per point-phase roll: 7 −22 (6/36); 5/6/8 +2 (14/36); 3/4/9/10/11 +5 (14/36); 2 +10; 12 +15 (3:1) or +10 (2:1). EV per hand −3/2 (field 3:1; 1/88 per point-phase roll) / **−7/3 on bubble field 2:1** (3.867%) | yes (same per-roll math) |
| HEDGE (sourced) | ANY_CRAPS / C&E / ANY7, A, when | craps hedge each come-out | — | Any 7 per `when` | — | — | $10 Pass + $1 Any Craps each come-out: −125/196 per hand (vs −0.357). Across $32 + $6 Any 7 each point-phase roll: −8 (vs −2) | craps hedges pointless in C |
| FIVE_COUNT (wrapper, sourced) | inner strategy | c: 0 → 1 on a come-out point; c+1 per roll; at 4, only a point number → 5; 7-out → 0 | inner strategy starts at c = 5 | — | — | reset | P(qualify) 0.513627; share of rolls bet 0.434930 (WoO 43.5%); RESET7 0.488995 / 0.414962; edge unchanged | yes [A: variant point set] |
| BANKROLL_BUILDER (codified) | u = 5, k ≤ 2, b68 = 6, D = 2, SB = 40u, stop 0.5 SB, goal 0.3 SB LOCK | Pass u | odds; 6 and 8 at b68 except p | 6/8 hit: H++; at H ≥ D, both down until the next hand | — | NEWHAND | −0.3553 per hand (0.864%); D = 1: −0.2908; D = 3: −0.3931 | yes |
| FIB_PRESS (codified) | {6, 8}, b, Fib 1, 2, 3, 5, 8, 13, 21, cap, atCap | nothing | n = b·Fib[ℓn] | ℓ++ and press (paid from the win) or atCap | keep levels | reset | b = 6: cap 3u −0.5537, 5u −0.6163, 8u −0.6590, 13u −0.6914; P > 0 17.55% | yes |
| POWER_PRESS (partly sourced) | Inside $22, P presses per number, resetAfterCollect | nothing | layout | If p_n < P: POWER press (ceilGrid(amt + win), extra from the rack) and p_n++; else SAME | keep | reset | Live P = 1/2/3: −1.836 / −2.645 / −3.439. Penny: −1.601 / −2.170 / −2.723. PRESS_AND_PULL: −3962/3025 (P > 0 ≈ 40.2%). Ladders: live 5/9 is 5→15→40→100, 6/8 is 6→18→42→96; penny 5/9 is 5→12→29→70, 6/8 is 6→15→33→72 | yes |
| THREE_HIT (codified) | Inside $22 (or Across $32 / 6&8 $12) | nothing | full layout including p | H++; at H = 3 everything down → success | keep; bet on p counts | fail if H < 3 | P(success) = q³: 6&8 125/512, **Inside 27/64**, Across 64/125. EV: Inside −37/64; 6&8 $12 −129/512; Across −122/125. BASIC_HEDGE variant: $30 DP + $56 Inside [MC] | yes (BASIC_HEDGE no) |
| COVER_HEDGE (codified) | K = 2, place 5/6/8 at u / 1.2u / 1.2u, field u | Pass; no field | field; Come while \|C\| < K; places minus p and minus C | settle; re-bet field after a loss | places OFF | only the box Come pays | ≈ −1.671 per hand (field 3:1, 2.124%); ≈ −2.505 (field 2:1, 3.184%) | yes |
| LOW_INVESTMENT (hypothetical) | props, side bet, minReq, filler lay 4/10 (fallback Pass) | filler = shortfall, on the grid | — | — | — | Hot Shooter window opens | Cannot create an edge. $1 hard 6 + $1 hard 8 each point-phase roll: $1/3 per hand. $1 C&E each come-out: $0.281 per hand. $3 lay on 4 for one roll: $0.0125. STW: a lay blocks place/buy on that number | IB crapless has no lay; use place 6/8 ON |

**Press taxonomy:**
- SAME: collect, leave the bet.
- UNIT: +1 unit.
- HALF: +½ the bet.
- FULL: double the bet.
- POWER: ceilGrid(amount + win).
- PARLAY: amount + win (penny machines only).
- REGRESS; DOWN.

**Progressions** (carrier: Pass by default; they do not change the edge [WOO-SYS]):

| id | Rules | Exact |
|---|---|---|
| MARTINGALE [WOO-MART] | Double after a loss; quit on a win (or loop); "walk away broke" if you can't double; the table max busts it | P(L straight losses), T (251/495)^L: L = 5 3.352%, 7 0.862%, 10 0.112%. C (7303/13860)^L: 4.062%, 1.128%, 0.165%. Field (5/9)^L: 5.29%, 1.63%, 0.28% |
| ANTI_MARTINGALE [WOO-ANTI] | 1 unit; double after a win up to the goal; quit on a loss | P(32 units): T (244/495)^5 = 2.910%; C 2.370% |
| PAROLI(3) [PN-PAROLI] | b·2^s; reset after 3 wins (+7b) or any loss | P(+7b) 11.98%; EV −0.0418b per sequence |
| 1-3-2-6 [WOO-1326] | units 1, 3, 2, 6; a loss ends the sequence; a push repeats | EV −0.052088 per sequence |
| D'ALEMBERT [WOO-DAL] | +1 after a loss, −1 after a win (minimum 1); stop at the goal | P(goal) 90.34% (bankroll 10, goal 1; WoO simulation) |
| FIBONACCI [WOO-FIB] | start on the 2nd term; loss i+1; win i−2 | P(goal) 0.911445; EV −0.062661 per session (11 units; simulation) |

### 7.4 Lab test vectors (exact unless noted)

- **Hand constants:**
  - Rolls per hand: 1671/196 (C 57678/7303).
  - Point-phase rolls per hand: 6.
  - P(≥ 1 point made): 67/165 (C 4247/11550).
- **Place layouts and line combos:**
  - Place 6/8 $6 flat: −1/3. Inside $22: −1. Across $32: −2.
  - Iron Cross: −3/2 and −7/3.
  - Pass $5 + 2× + 6/8 excluding the point: −527/1176.
- **Come and Don't Come chains:**
  - 3PM flats per hand: 77671/12740. Dolly3 EV: −21183/254800 u.
- **5-Count:** 0.434930 / 0.513627.
- **Single-strategy results:**
  - 1-3-2-6: −0.052088.
  - Martingale L = 7: 0.00862.
  - Three-Hit Inside: 27/64.
  - Pass 3-4-5× SD: 4.915632.
  - Across P(hand > 0): 1037/3125.
  - Power Press and Pull: −3962/3025.
  - Bankroll Builder: −0.355332.
- **Rounding:** $2 lay odds on 6 pays $1.67 under HALF_UP (+0.0909%) and $1.66 under FLOOR (−0.1818%). A $3 lay on 6 pays $2.50.
- **Side bets:**
  - Hot Shooter P(L ≥ 8) = 0.429044; EV −9.074%.
  - Lucky Shooter A/B/C/D: per §6.3.
  - P(Small) = 20049/760760.
  - Different Doubles: 43/154.
  - Crapless Fire: 13.4152% / 70.4488%.

---

## 8. Coaching knowledge

### 8.1 Bets ranked by house edge (standard paytables) [M]

| Rank | Bet | HE_res | HE_roll | Where |
|---|---|---|---|---|
| 1 | Free odds, take or lay | 0 | 0 | All; machines usually cap at 2× |
| 2 | Don't Pass / Don't Come, bar 12 | 1.364% | 0.404% | T |
| 3 | Pass / Come | 1.414% | 0.419% | T |
| 4 | **Place 6/8** | **1.515%** | 0.463% | T, C (the cheapest flat bet in crapless) |
| 5 | Buy 4/10 or lay 4/10, vig on win | 1.667% | 0.417% | STW |
| 6 | Place to lose 6/8 | 1.818% | 0.556% | STW |
| 7 | Buy 5/9 or lay 5/9, vig on win | 2.000% | 0.556% | STW |
| 8 | Buy 6/8 or lay 6/8, vig on win | 2.273% | 0.694% | STW |
| 9 | Lay 4/10, vig upfront | 2.439% | 0.610% | IB, LIVE |
| 10 | Place to lose 5/9 | 2.500% | 0.694% | — |
| 11 | Field, 3:1 on 12 | 2.778% | 2.778% | LIVE Vegas |
| 12 | Place to lose 4/10 | 3.030% | 0.758% | — |
| 13 | Lay 5/9 upfront | 3.226% | — | — |
| 14 | Place 5/9; lay 6/8 upfront | 4.000% | 1.111% / 1.222% | — |
| 15 | Buy, any number, upfront vig re-collected | 4.762% | 1.19–1.46% | IB, crapless |
| 16 | **Crapless Pass / Come** | **5.382%** | 1.293% | C |
| 17 | **Field 2:1 / 2:1** | **5.556%** | 5.556% | All machines |
| 18 | Crapless place 3/11 (11:4) | 6.250% | 1.389% | C |
| 19 | Place 4/10 | 6.667% | 1.667% | — |
| 20 | Crapless place 2/12 (11:2) | 7.143% | 1.389% | C |
| 21 | Hot Shooter Jackpot | 9.074% | 1.064% per roll (per $1 per hand ÷ 8.5255) | STW |
| 22 | Big 6/8; Hard 6/8 | 9.091% | 2.778% | — |
| 23 | Crapless place 3/11 at 13:5 | 10.000% | 2.222% | — |
| 24 | Lucky Shooter D | 10.840% | — | IB legacy |
| 25 | Hard 4/10; Any Craps; C&E; 3 or 11 (15:1); easy hop | 11.111% | 2.778% for hard; others same as HE_res | — |
| 26 | Horn | 12.500% | — | — |
| 27 | World | 13.333% | — | — |
| 28 | 2 or 12 (30:1); hard hop | 13.889% | — | — |
| 29 | Crapless place 2/12 at 5:1 | 14.286% | 2.778% | — |
| 30 | Any 7; "for 1" props | 16.667% | — | — |
| 31 | Lucky Roller 30/30/155 | 17.98% (All) / 18.30% (Small, Tall) | — | IB, STW |

### 8.2 Best / worst guidance

**Crapless bubble (default preset):**
- **Line bets:**
  - The flat crapless Pass/Come costs 5.382% per decision: **3.8×** the traditional Pass.
  - Always take maximum odds. 2× brings the combined edge to 2.018%, but the flat's dollar loss is unchanged.
  - $10 Pass costs $12.93 per hour at 100 rolls/hr, versus $4.19 per hour in traditional craps.
- **Number bets:**
  - Place 6/8 (1.515%) is the cheapest flat bet. Use $3 multiples on penny machines.
  - On 2/12, 3/11 and 4/10, **buy rather than place**: 4.762% with upfront vig against place 7.143% / 6.25% / 6.667%.
  - On 5/9, **place** (4.00%) unless the machine does not re-collect the vig (then buy is 2.913%).
- **Avoid:** Field 5.56%; props 11–17%; Lucky Roller about 18%.
- **Machine behavior:** IB place bets work on the come-out. A 7 there (1/6) takes them unless you set them OFF.

**Traditional bubble (STW):**
- **Best:** Don't Come + 2× lay (0.455%), Don't Pass + 2× (0.584%, stake basis), Pass/Come + 2× (0.606%).
- **Buy vs place:** buy 4/10 (1.667%) and buy 5/9 (2.0%) beat placing them. Place 6/8 beats buying 6/8.
- **Avoid:** the 2:1 / 2:1 Field (5.56%, twice the live Vegas field), Big 6/8 (9.09%) and props.

### 8.3 Expected loss per hour

**Formulas:**
- Loss per hour = rolls/hr × Σ_bets amount × HE_roll × π_working.
  - π_working: 1 if always ON; π(point) if OFF on the come-out.
- Equivalently: Σ amount × HE_res × decisions/hr.
  - Pass decisions/hr = rolls/hr × 165/557 (T) or × 2310/9613 (C).
  - Number bets: decisions/hr = rolls/hr × π × (w + 6)/36.
  - One-roll bets: decisions/hr = rolls/hr.

| Pace | Rolls/hr | Tag |
|---|---|---|
| LIVE, 1 / 3 / 5 / 7 / 9 / 11 players | 249 / 216 / 144 / 135 / 123 / 102 | R [WOO-K, Kilby] |
| Live comp rating systems | 60 | R [GGB-RATE] |
| STW community dome | **~100** (range 60–150): 15–30 s bet timer + ≤ 20 s shooter window + shake/read | A |
| IB stadium hybrid | ~120 (≈ 30 s per roll) | R [VV-DTG] |
| IB heads-up, self-paced | **120** (range 60–250) | A |
| Rejected | "60–120 rounds/hr vs 20–40 live" | CRAPSEE, TZ |

| Expected loss per hour [M] | 60 | 100 | 120 | 144 | 249 |
|---|---|---|---|---|---|
| T: $10 Pass (any odds) | 2.51 | 4.19 | 5.03 | 6.03 | 10.43 |
| T: $6 + $6 place 6&8, OFF on the come-out (STW) | 2.35 | 3.91 | 4.69 | 5.63 | 9.74 |
| Any variant: $6 + $6 place 6&8, always ON (IB) | 3.33 | 5.56 | 6.67 | 8.00 | 13.83 |
| C: $10 Pass + 2× odds | 7.76 | **12.93** | 15.52 | 18.62 | 32.21 |
| C: $6 + $6 place 6&8, OFF on the come-out | 2.53 | 4.22 | 5.06 | 6.08 | 10.51 |
| C: $5 + $5 place 4&10, always ON | 10.00 | 16.67 | 20.00 | 24.00 | 41.50 |
| C: $5 + $5 buy 4&10, upfront re-collected, ON | 7.50 | 12.50 | 15.00 | 18.00 | 31.12 |
| C: $5 + $5 buy 4&10, vig on win (5% of stake), ON | 2.50 | 4.17 | 5.00 | 6.00 | 10.38 |
| $5 Field 2:1/2:1 every roll / 2:1/3:1 | 16.67 / 8.33 | 27.78 / 13.89 | 33.33 / 16.67 | 40.00 / 20.00 | 69.17 / 34.58 |
| $1 Any 7 every roll | 10.00 | 16.67 | 20.00 | 24.00 | 41.50 |

### 8.4 Misconceptions and factual answers

| Claim | Answer |
|---|---|
| "A 7 is due" / "the dice are cold" (gambler's fallacy) | Every roll is independent: P(7) = 1/6 regardless of history. History panels (27 rolls on STW) and IB's "rolls since last" hardway counters predict nothing |
| Hot/cold dice, streaks | Streaks are expected. A traditional hand averages 8.53 rolls; P(≥ 50 rolls) = 0.000861 |
| "Bubble craps is rigged" | STW reads physical RFID dice with a camera feed [V STWO]. NV Reg 14.040(4) requires outcome probabilities equal to the live game, or disclosure [V NV14]. No regulator or court finding of rigged dice was found. The documented harm was **payout math**: the Isle/Interblock buy-vig settlement, $15/$30 per claimant, no admission of fault [V TCA]. Some IB single seats use an RNG, not dice [V IB221]. Answer: check payouts; the trainer shows the math |
| "Too many sevens on machines" | That is the pace: about 16.7 sevens and 11.7 seven-outs per 100 rolls |
| "Pressing the shooter button harder or at the right moment matters" | "The SHOOTER functionality does not affect the roll result" [V CW §35h] |
| "Systems (Martingale, presses, 5-count, Iron Cross) beat the house" | No mix of negative-EV bets has positive EV. Progressions change variance only [WOO-SYS]. The Iron Cross "wins 30 of 36" yet still loses 1/88 per point-phase roll (7/18 per roll with a 2:1 field) |
| "Hedging lowers the edge" | Hedges add negative-EV bets. A $1 Any Craps check on $10 Pass: −$0.638 per hand vs −$0.357 |
| "Odds bets lower my losses" | They lower the edge per dollar, not the flat bet's dollar loss, and they raise variance |
| "Crapless is better: you can't crap out" | Pass edge 5.38% vs 1.41%. You give up 11 as a winner, and 2/3/12 become hard-to-make points: a $10 Pass on point 2 is worth $2.86 and can't be taken down |
| "Big 6/8 = place 6/8" | Big pays 1:1 (9.09%) vs 7:6 (1.52%) |
| "Buy always beats place" | Not on 6/8. On 5/9 it depends on the vig mode (§4.3) |
| "$5 on the 6 pays the same everywhere" | Machine: $5.83–$5.84 (to the cent). Live: $5 (9.09%). Live, bet $6 units |
| Comps | Dealerless games usually earn slot points on coin-in; several venues give none [R LVA-PTS] |
| Big wins | IB hand-pays above the ticket limit [V IB]. The IRS slot W-2G threshold is $2,000 from 1 Jan 2026 [V IRS-W2G]; whether ETG craps wins fall under it is not established [U] |

---

## 9. Open uncertainties (keep configurable; defaults shown)

| # | Item | Default |
|---|---|---|
| 1 | Payout rounding per machine and bet; measure with IB "Show Winnings" [V IB] | STW place 6/8 ceil [R]; others floor [A] |
| 2 | Rounding of sub-cent commissions (lay, 5% of win) | ceil [A] |
| 3 | IB / crapless upfront buy vig: re-collected when a winner stays up? refunded on take-down? Flips the 5/9 advice | re-collect, no refund [A] |
| 4 | IB crapless odds cap (shown only in game) and place 2/12, 3/11 payouts | 2× [R]; 11:2 / 11:4 [A] |
| 5 | IB come-out status for hardways, Big 6/8, come odds; carried place bets after a point is made | ON / ON / OFF / ON [A] |
| 6 | IB post-7-out auto-OFF: lasts until the player taps ON or until the point; triggered by a seven-out or any 7 | until player ON; seven-out [A] |
| 7 | STW place/buy/hard bets newly placed during the come-out window; can All On override the auto-OFF? | OFF; no [A] |
| 8 | STW Don't Come removable after travel; DP lay-odds basis (literal stake basis vs intended win basis) | removable [A]; stake basis [V literal] |
| 9 | IB Don't Pass: contract (§2.1.1 table) vs removable (§2.3 text) | removable [V text] |
| 10 | Hot Shooter: does the count include the 7-out? Grand at 50 vs 51 | definition A; 50 [A/V] |
| 11 | Do side bets count toward the minimum total? What counts as "3 credits on the Craps game"? | no [A] |
| 12 | Lucky Shooter: removable before the point; IB repeat rule; crapless behavior | yes; repeat ends the bet; disabled [A] |
| 13 | STW Lucky Roller paytable | 30/30/155 [A] |
| 14 | Power Odds trigger rates | disabled [U] |
| 15 | IB Big/Small rules and paytable | not offered [U] |
| 16 | Pace per product | 100 / 120 / 144 [A/R] |
| 17 | Casino-specific minimums and maximums; Field 12 pays 3:1 at two unnamed IB casinos | preset values [A/R] |
| 18 | Live: vig refund on take-down (HAR-PA says refund; WoO says "usually non-refundable"); allowing odds above the cap to make payable amounts | refund; no [V/R/U] |
| 19 | IB one-roll winners: auto re-bet (Keep Bets On) or returned | return [A] |
| 20 | Come-bet wins banked on some machines (Aqueduct 2014) | ride per CW [R] |
| 21 | Prop gating ("once you bet 15…", one machine) | off [R] |
| 22 | STW shooter rotation at point established | cosmetic |
| 23 | Rejected or low-quality claims to keep out of the data: CRAPSEE (6:5 / 6-for-5 place 6/8, 8:1 hard 6/8, 60–120 rounds/hr), TZ, bubble-craps.com paytables | — |
| 24 | Not searched this turn (WebSearch budget exhausted) | rolls/hr measurements, current LV crapless paytables, Lucky Roller par sheets |

---

## Sources

| Key | URL |
|---|---|
| CW | https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf |
| STWO | https://wsgc.wa.gov/sites/default/files/2025-04/3195%20Craps%20Shoot%20to%20Win%20ETG%20Approval%20Letter%20signed_0.pdf |
| IB | https://wsgc.wa.gov/sites/default/files/2025-02/Craps_Crapless_Craps_Easy_Craps_game_description_Washington-specific_v2.5.1_0.pdf |
| IB221 | https://wsgc.wa.gov/sites/default/files/2024-03/Craps%20-%20Game%20Description_WA-specific_v2.2.1.pdf |
| IBLS | https://wsgc.wa.gov/sites/default/files/2024-03/Lucky%20Shooter%20Special%20Bet%20Description_WA-specific_v1.5.1.pdf |
| RTW | https://wsgc.wa.gov/sites/default/files/2025-02/DESC_RollToWinCraps_NO_ODDS_WA_Overview_v1.1.pdf |
| WSGC-ETG | https://wsgc.wa.gov/tribal-partnerships/tribal-electronic-table-games |
| NV14 | https://www.gaming.nv.gov/contentassets/d6342a488e944e6aa02337fa9d3c94e5/regulation-14-as-of-08-26.pdf |
| NV-SS | https://www.gaming.nv.gov/contentassets/3a632692f87340bf9890a9784fd3f1aa/super-shooter-craps-side-bet.pdf |
| PA623c | https://pacodeandbulletin.gov/secure/pacode/data/058/chapter623c/058_0623c.pdf |
| MA | https://massgaming.com/wp-content/uploads/RULES-Automated-Craps-2-1-18.pdf |
| MD-C | https://www.mdgaming.com/wp-content/uploads/2026/04/Craps-Standard-Rules-Version-1.5-accessible.pdf (also https://mdgaming.com/wp-content/uploads/2024/06/Craps-Standard-Rules-Version-1.5.pdf) |
| MD-CL | https://www.mdgaming.com/wp-content/uploads/2026/04/Crapless-Craps-Standard-Rules-Version-1.1-accessible.pdf |
| CROWN-CL | https://www.crownperth.com.au/getmedia/2f173189-0e81-4059-893b-ff3e45a8f128/crown-perth-gaming-crapless-craps-rules.pdf |
| CYP | https://cypressbayou-casino.treepl.co/play-casino-table-games/crapless-craps |
| HAR-PA | https://www.caesars.com/content/dam/ccr/Gaming/tableGames/Craps-RackCard-Philly.pdf |
| GALAXY-WA | https://wsgc.wa.gov/sites/default/files/2023-11/Bonus%20Craps%20Modification-Progressive.pdf |
| NJ | https://nj.gov/oag/ge/docs/TempRegs/bonuscrapstext.pdf ; https://nj.gov/oag/ge/docs/TempRegs/hotrollercraps.PDF |
| TCSJH | https://tcsjohnhuxley.com/wp-content/uploads/2023/11/TCSJH_Repeater_Bets_Craps-with-Dealer-Envy-HTP.pdf |
| WOO-B | https://wizardofodds.com/games/craps/basics/ |
| WOO-HE | https://wizardofodds.com/games/craps/appendix/2/ |
| WOO-CL | https://wizardofodds.com/games/crapless-craps/ |
| WOO-K | https://wizardofodds.com/ask-the-wizard/table-games/ |
| WOO-SYS / 228 / 326 | https://wizardofodds.com/ask-the-wizard/craps/betting-systems/ ; https://wizardofodds.com/ask-the-wizard/228/ ; https://wizardofodds.com/ask-the-wizard/326/ |
| WOO-MART / ANTI / 1326 / DAL / FIB | https://wizardofodds.com/gambling/martingale/ ; https://wizardofodds.com/gambling/anti-martingale/ ; https://wizardofodds.com/gambling/1-3-2-6-betting-system/ ; https://wizardofodds.com/gambling/dalembert-betting-system/ ; https://wizardofodds.com/gambling/fibonacci/ |
| WOO side bets | https://wizardofodds.com/games/craps/side-bets/fire-bet/ ; .../bonus-craps/ ; .../ride-the-line/ ; .../different-doubles/ ; .../replay/ ; https://wizardofodds.com/games/craps/appendix/5/ |
| WIKI | https://en.wikipedia.org/wiki/Craps |
| LVA-CL / RENO / RND / PTS | https://www.lasvegasadvisor.com/question/crapless-craps/ ; https://www.lasvegasadvisor.com/question/reno-dont-bets/ ; https://www.lasvegasadvisor.com/question/rounding-down-6-5-blackjack/ ; https://www.lasvegasadvisor.com/question/etgs-player-points/ |
| VA | https://vegasadvantage.com/electronic-table-games/ |
| VV-STW / VV-DTG | https://www.casino.org/vitalvegas/the-casino-game-were-loving-right-now-shoot-to-win-craps/ ; https://www.casino.org/vitalvegas/hybrid-stadium-craps-rolls-into-downtown-grand/ |
| WOV-n | https://wizardofvegas.com/forum/gambling/craps/<n>/ (n = 9005, 11344, 24510, 28274, 36080, 36634, 37778, 35576, 38668, 37046 [3PM], 37179 [Dolly]) |
| SHRT | https://blog.seminolehardrocktampa.com/?p=755 |
| G3-MOH | https://g3newswire.com/interblock-installs-crapless-craps-at-mohegan-sun/ |
| TCA / GGB | https://topclassactions.com/lawsuit-settlements/closed-settlements/isle-of-capri-fan-club-loyalty-program-class-action-settlement ; https://ggbmagazine.com/article/players-sue-interblock-florida-casino-over-etg |
| GGB-RATE | https://ggbmagazine.com/article/player-rating-errors-you-are-probably-making-in-craps |
| IRS-W2G | https://www.irs.gov/pub/irs-prior/iw2g--2026.pdf |
| PAT-RFID / PAT | https://patents.google.com/patent/US10417466 ; https://patents.google.com/patent/US7134660 |
| MC / CC-PRESS / PNAT / BS / HR / AoC / PN-PAROLI | https://marconius.com/craps/allStrats.html ; https://www.controlledcraps.com/craps-pressing-strategy/ ; https://parlaynation.com/glossary ; https://www.brainscape.com/flashcards/across-bets-craps-15130657/packs/21881603 ; https://www.hardrock.bet/casino/how-to-play-craps/strategies/ ; https://www.artofcraps.com/craps-strategies/craps-bankroll-management/ ; https://www.pokernews.com/casino/roulette/paroli-strategy-for-roulette.htm |
| BC-* / CO-BUB | https://www.bubble-craps.com/craps-strategy/ (and the 5-count, iron-cross, three-point-molly, power-pressing pages) ; https://casino.org/blog/the-bubble-craps-strategy |
| YT-BB / YT-FIB | https://www.youtube.com/watch?v=1GwJgShE69U ; https://www.youtube.com/watch?v=4UF7kYjyyBs |
| CRAPSEE / TZ (rejected) | https://v3.crapsee.com/bubble-craps-strategy ; https://travelzork.com/bubble-craps-vs-traditional-craps/ |

### Critical Files for Implementation
- /Users/jameslerner/bubble craps simulator/craps-simulator/docs/rules/rules-spec.md (write this spec here; the oracle tables come from it)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/config/schema.ts (`MachineConfigInput` plus the knobs marked + in §5.1)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/config/presets/craplessBubble.ts (and `traditionalBubble`, `strictBubble`, `traditionalLive345`, with provenance)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/settle/settle.ts (with `commission.ts`: rounding, basis, timing, rearm, refund)
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/money.ts (existing; `Rounding` needs `ceil` and `halfEven` and per-type overrides)