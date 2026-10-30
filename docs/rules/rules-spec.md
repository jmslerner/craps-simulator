# Bubble craps rules specification

The canonical rules for the Bubble Craps Trainer: what every bet does on every roll, what it pays, how machines round and charge commission, how they switch bets on and off, and which value each built-in machine uses. It is written for engine implementers and for oracle authors.

- **Source.** This is the verified research spec, `docs/rules/research/spec.md` (2026-10-28), organized for implementation. Its tables, numbers, source keys and tags are kept as researched, and its conflict resolutions (§0.2) are binding. Section numbers match the research spec, so "rules spec §9 #3" names the same item in both.
- **Oracles.** `tests/oracle/**` is written from this document with its own rule constants. It never imports `src/engine/bets`, `src/engine/round` or `src/engine/settle`, and never copies their logic.
- **Machine behaviour is data.** Everything a machine can vary is a value in the machine config (`src/engine/config/schema.ts`), with provenance for each value. §5.1 maps each knob to its JSON pointer, §5.2 lists the presets, §5.3 lists what config validation enforces, and §5.4 explains provenance.
- **Elsewhere.** The coach's metric definitions are in `docs/rules/glossary.md`. The strategy lab is deferred (§7).

| Section | Contents |
|---|---|
| §0 | Notation, tags, binding conflict resolutions, source-key aliases |
| §1 | Dice and probability reference |
| §2 | Round transitions and counters, decisions by event, the roll pipeline, working rules by machine family, machine round flow, side-bet lifecycle |
| §3 | Per-bet tables: line and odds, number bets, hardways, one-roll bets, crapless differences |
| §4 | Payouts, rounding, commission, odds limits, limits and credit |
| §5 | Machine knobs and their place in the config, the four presets, config validation, provenance |
| §6 | Side bets |
| §7 | Strategy (deferred; pointer only) |
| §8 | Coaching facts |
| §9 | Open uncertainties |

---

## 0. Conventions and conflict resolutions

### 0.1 Notation

| Term | Meaning |
|---|---|
| Pays `a:b` | Net win of a per b staked; the stake is returned. Store payouts as an exact "to 1" ratio. `x for 1` = (x−1):1. Examples: 30 for 1 = 29:1; 5 for 1 = 4:1. |
| HE_res | Expected loss ÷ stake, per decision. Pushes count as decisions ("ties counted") unless marked otherwise. For upfront vig the divisor is stake + vig, unless marked "per stake". **Convention [M]:** a settlement that returns a bet unplayed (odds OFF when their parent is decided, or returned when the point is made — the engine's push `offReturned`) is not a decision of that bet: its stake was never at risk and joins no divisor. So come odds cost the same as pass odds at the same pay (2/12 at 11:2: 1/14 on both, §3.1, §8.1 rank 1), although come odds are sometimes handed back unplayed. The trainer's edges follow this convention. |
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

### 0.3 Source keys

The Sources table at the end lists every key. The topic files in `docs/rules/research/` cite some of the same documents under other names:

| Key here | `core.md` | `machines.md` | `sidebets.md` |
|---|---|---|---|
| CW (Clearwater Shoot To Win rule card) | STW-R | CW | "Clearwater rules" |
| STWO (Shoot To Win Lucky Roll overview, WSGC) | STW-O | WSGC-STW | "STW overview" |
| IB (Interblock Craps, Crapless, Easy Craps v2.5.1) | IB-WA | IB-CCE | "Interblock WA game description" |
| IB221 (Interblock Craps v2.2.1) | — | IB-C221 | — |
| IBLS (Interblock Lucky Shooter v1.5.1) | — | IB-LS | "Interblock Lucky Shooter doc" |
| G3-MOH | G3 | G3-MOH | — |
| VV-STW | VV | VV-STW | — |
| WOV-n (Wizard of Vegas thread n) | WOV-1 = WOV-24510; WOV-2 = WOV-36634; WOV-3 = WOV-28259 | WoV-n | — |

Config provenance cites these keys (§5.4); `USER` cites the player's own observation of a machine. CRAPSEE and TZ are rejected sources and may not be cited.

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

## 2. Game flow: round transitions, counters and decisions by event

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
- **Config:** the come-out partition is written out in `/rules/naturals`, `/rules/craps` and `/rules/points`, and must equal the variant's lists above in any order (§5.3). `/rules/dontBar` is null for crapless and 2 or 12 for traditional. `src/engine/config/rulesets.ts` holds both rulesets.

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
2. Effective working status = `bet.working ?? heldAfterSevenOut ?? globalToggle ?? policyDefault(type, phaseBefore, carried?)`, below any machine rule that forces a bet OFF (§2.4).
3. `decide` every bet independently against the **before** state. The bet on N and the box bet traveling to N are separate decisions.
4. Odds take their parent's decision. If the parent resolves while the odds are not working, the odds are **returned**: `push(offReturned)`.
5. Settle each bet: exact amount → round → commission (§4). Update the ledger. Once every bet is settled, up-front vig is re-collected from the winners that stay up, in settlement order, against the credit the whole roll left (§4.5).
6. Apply the results:
   - Resolved bets are removed or stay, per `afterWin`.
   - Box bets travel. A travelled bet starts with 0 odds.
   - Side-bet progress is updated.
7. Commit the round state.
8. Machine post-roll actions:
   - **STW:** on POINT_ESTABLISHED, auto-OFF chips turn ON. When the next phase is a come-out, carried types go OFF.
   - **IB:** lay bets turn back ON after a point is made or any 7 (those a toggle switched OFF; a lay the post-seven-out hold covers stays held, §9 #31). OFF odds are returned when their point is made. The engine and the oracle read IB §3.2's "Odds bets are removed when a Point is reestablished" as: when the pass point is made, every odds bet that is OFF comes down and is returned, come odds whose come bet the roll does not decide included (`/oddsOffReturnedAtPointMade` [A]). Odds whose own bet is decided while they are OFF are returned by step 4 in any case.
   - Auto re-bets happen per `afterWin`.
   - Side-bet windows open or close.
   - **IB:** after a SEVEN_OUT, Place/Buy bets placed in the next window are held OFF (a machine hold, not the bet's own setting; §2.4).
9. Betting window. On `roll`, validate the minimum (active bets only), credit and limits.

### 2.4 Working rules by machine family: come-out defaults and toggles

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
  - "Set bets On" returns every covered bet to its machine default (`setGlobalWorking(null)`), so Come odds stay OFF on the come-out and are returned on a come-out 7. It does not force them ON (`setGlobalWorking(false)` would make them work) [A, plan §0 #21, §9 #28]. IB §3.2 does not say which; if the player's machine works Come odds on the come-out after Set bets On, change the mapping and its scenario together.
  - The post-seven-out OFF is a machine hold on the bets placed in that window, not the bets' own setting. It outranks the button, so a Set bets On pressed before the seven-out does not reach it, and it ends when the player presses Set bets On (a Set bets Off leaves it, as those bets are OFF either way) or, under `until: pointEstablished`, when the point is established [V IB §3.2; reading §9 #29]. On a machine with per-bet toggles (no preset has both), setting the bet ON turns it ON, and setting it back to its default leaves it held; a toggle that lasts `nextRollOnly` resets the player's settings, not the hold.

**Config** (§5.1):
- A type's come-out default is `/catalog/<type>/comeOutDefault` (`on` or `off`). In the point phase every bet works unless it is switched OFF. Odds carry a default only when their parent is a come or don't come bet: pass-line odds never face a come-out roll.
- STW's auto-OFF is `/comeOut/autoOff`. The machine forces those bets OFF for the come-out roll and back ON when the point is established; player toggles do not override it [A, §9 #7]. Its `carried` and `newlyPlaced` lists both name come odds, place, buy, hardways and Big 6/8, so every chip of those types is OFF on the come-out, carried [V CW §4] or new [A], and their `/catalog/<t>/comeOutDefault` decides none of them. A bet's config paths name the rule's parts, so the assumed `newlyPlaced` shows on any number that depends on it.
- IB's post-seven-out rule is `/afterSevenOut/newPlacedOff`, its lay re-enable is `/layAutoOn`, and its return of OFF odds is `/oddsOffReturnedAtPointMade`.
- The ON/OFF control is `/workingToggle`: a `global` button, `perBet` toggles, the `types` it covers, and whether OFF lasts `untilChanged` or for the `nextRollOnly`. Whether OFF bets use credit is `/offBets/consumeCredit`.

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

## 3. Bet catalog: per-bet tables

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

- **Amounts:** money is integer `Cents`. Stakes must be multiples of `money.betIncrement` (or of `perType.increment`, or of the type's unit on the bet's number, `perType.incrementByNumber`; for odds, the parent's point).
- **Malformed or extreme input** is refused, never thrown (plan §4.6): amounts are safe integers of cents; an addition is checked against the limits before it is summed; neither a deposit nor a roll whose largest possible payout could do so may carry the ledger past `Number.MAX_SAFE_INTEGER` cents (about $90 trillion; `ABOVE_MAX`, `scope: 'ledger'`); scripted dice must be an object with two whole faces from 1 to 6; and a batch may not contain a roll at any depth (`BAD_PARAMS`).
- **Payout ratios:** stored as exact `Ratio` "to 1"; `parseRatio` converts "for 1".
- **Win amount:**
  - `winExact = stake × num/den` (a Fraction).
  - `winPaid = round(winExact, catalog[type].payoutRoundingByNumber[n] ?? catalog[type].payoutRounding ?? money.payoutRounding)`, where `n` is the number a number bet sits on (`payoutRoundingFor` in `src/engine/bets/types.ts`). A lay's commission base, its potential win, rounds the same way.
  - Round **once** per bet settlement. Composite bets (horn, world, C&E) settle as a single bet using their whole-bet net table.
- **Credited:** `credited = (stake if returned) + winPaid − vigOnWin − vigRearmFromWin`.
- **Composites in the config:** `/composites/<id>` lists the component one-roll bets and their units: C&E = C + E; horn = 2, 3, 11, 12; world = horn + Any 7; horn high X = horn + a second unit on X. The whole-bet net table (§3.4) follows from the parts. With whole-dollar machine bets every part is a whole number of cents, so settling the parts and settling the whole give the same result; which path the engine takes is open (§9 #25).
- **Ledger invariant:** `deposits = bankroll + Σ bet.amount + houseNet`.

### 4.2 Rounding

| Context | Payout rounding | Commission rounding | Tag |
|---|---|---|---|
| STW, place 6/8 (7:6) | `{ceil, 1}`: $1 → $1.17; $2 → $2.34 | — | R (7craps 2012; Aruze STW 2018) |
| Machine, all other fractional payouts (STW place 4/5/9/10 included) | `{floor, 1}` | `{ceil, 1}` | A (conservative; no report exists) |

STW's place type rounds `{floor, 1}` (`/catalog/place/payoutRounding` [A]) with `{ceil, 1}` overrides on 6 and 8 only (`/catalog/place/payoutRoundingByNumber/6` and `/8` [R]): whole-dollar bets on 4/5/9/10 pay whole cents anyway, but a stake in cents shows the difference ($1.01 on 5 pays $1.41, on 6 $1.18).
| LIVE | `{floor, 100}` (whole dollars, "keep the change") | floor to whole dollar, $1 minimum | V [LVA-RND, HAR-PA] |

`src/engine/core/money.ts` implements all four modes (`ROUNDING_MODES`: floor, ceil, halfUp, halfEven). Its `TO_THE_PENNY = {floor, 1}` is the A default.

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
- **Convention [M]:** the trainer's "Per roll" (`edgePerWorkingRoll` in `analyzeBet` and the catalog, and `scripts/edges.ts`) always divides by the **stake alone**, as the glossary defines it, never by stake + vig. The upfront figures above translate: buy 1/80, 1/72, 11/720 (4/10, 5/9, 6/8); lay 1/160, 1/108, 11/864 (4/10, 5/9, 6/8). Coach copy quoting this section's per-(stake + vig) figures must convert, or cite the trainer's own numbers.

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
| OFF bets and credit, trainer | **Deviation:** STW's `/offBets/consumeCredit: false` is not modelled. Every OFF bet keeps its stake on the layout and so still uses credit, on every machine, because no source says what happens when an OFF chip turns ON without the credit to back it. The trainer never lets a player bet more than a machine would; on STW it lets them bet less. `MachineConfig.notModelled` lists the pointer, and the coach shows an "approximation" note on that machine (plan §0 #23) | — |
| Upfront vig | Must be covered by credit at placement; declining removes the bet [V IB §3.3] | V |
| Re-collected vig and credit | Up-front vig is "re-paid on every win" [V HAR-PA]. **Reading:** the re-collection is judged after all of the roll's settlements, against the credit they leave, in settlement order, so the vig comes out of the roll's payouts. A live $1 lay on 4 wins 50¢, paid as $0, and owes its $1 vig again: with $0 credit and an Any 7 paying $25 on the same roll, the $1 comes out of the $25 and the lay stays. Only when the credit after the whole roll cannot pay does the bet come down, as declining the vig removes it [IB §3.3]; what its win paid toward the vig is refunded and its stake returned. Credit that exactly covers the vig pays it | V / reading |
| Cash-out | IB: only with no bets on the table; ticket or hand pay [V IB] | V |

---

## 5. Machine configuration

### 5.1 Configuration knobs (schema additions beyond plan §4.4 marked +)

The last column is where each knob lives in `MachineConfigInput` (`src/engine/config/schema.ts`), as a JSON pointer. `<t>` is a bet type id and `<n>` a number.

| Group | Knob | Options / semantics | In the config |
|---|---|---|---|
| Rules | `variant` | `traditional` / `crapless` | `/variant` |
| | come-out partition | Naturals, craps and points; must equal the variant's (§2.1) | `/rules/naturals`, `/rules/craps`, `/rules/points` |
| | `rules.dontBar` | 12 / 2 / null | `/rules/dontBar` |
| | `rules.allowPutBets` | bool | `/rules/allowPutBets` |
| | `catalog[]` | Presence = offered. Per type: `pays` per number, `commission`, `afterWin`, `comeOutDefault`, `payoutRounding`+ | `/catalog/<t>`, keyed by type id rather than an array, so pointers stay stable. Each type names its `family`; line types give `side` and `window`, number bets their `kind` |
| Money | `money.payoutRounding`, `money.betIncrement` | `RoundingRule{mode: floor/ceil/halfUp/halfEven, increment}` | `/money/payoutRounding`, `/money/betIncrement`; also `/money/startingBankroll` |
| | `catalog[t].payoutRounding`+ | Per-type override; needed for place 6/8 ceil vs wrong-way floor | `/catalog/<t>/payoutRounding` |
| | `catalog[t].payoutRoundingByNumber`+ | Number bets: overrides the type's rounding on the numbers it lists (STW place 6/8 ceil, 4/5/9/10 floor) | `/catalog/<t>/payoutRoundingByNumber/<n>` |
| | `catalog[t].commission` (+ per-number override+) | `CommissionInput`; per-number override needed for live "on win for 4/10 only" | `/catalog/<t>/commission`, `/catalog/<t>/commissionByNumber/<n>` |
| Pays | place / buy / lay / PTL / odds / field / props / hops / hardways / big | Exact ratios. Crapless place 2/12 ∈ {11:2, 5:1}; 3/11 ∈ {11:4, 13:5}. `payLabelStyle`+ ∈ {to, for} affects display only | `/catalog/<t>/pays/<n>`; one-roll bets key pays by total or by dice pair, low face first. Each ratio string keeps the machine's own wording ("9 to 5", "31 for 1"), so `/payLabelStyle` is `asWritten` unless a uniform `to` or `for` is wanted |
| Limits | `limits.{min, max, tableMax, perType}`; `minTotal{amount, scope: perBet/totalRound, countOff: false, countSideBets: ?}`+ | `perType.incrementByNumber`+: the stake unit on each number listed, for odds (the parent's point), number bets and hardways; amounts must be multiples of it, odds caps floor to it, and the smallest new bet is the minimum rounded up to it | `/limits/min`, `/limits/max`, `/limits/tableMax`, `/limits/perType/<t>/{min,max,increment}`, `/limits/perType/<t>/incrementByNumber/<n>`; `/limits/minTotal` (null when there is none) |
| Odds | `odds.take{multiplier per point}`, `odds.lay{multiplier, basis: stake/win}` per parent type+ | Don't Pass and Don't Come can differ (STW) | Each odds type: `/catalog/<t>/parent` (its line type), `/catalog/<t>/pays/<n>`, `/catalog/<t>/limit/basis`, `/catalog/<t>/limit/multiple/<n>` (whole multiples; 3-4-5× is 3, 4 and 5 by point) |
| Working | `comeOut.autoOff{carried[], newlyPlaced[], reOnAt: pointEstablished}`+; `afterSevenOut.newPlacedOff{types[], trigger: sevenOut/anySeven, until: playerOn/pointEstablished}`+; `layAutoOn{afterPointMade, afterSeven}`+; `oddsOffReturnedAtPointMade`+ | §2.4; `trigger` is §9 #6 (default `sevenOut`) | `/comeOut/autoOff`, `/afterSevenOut/newPlacedOff` (with `/afterSevenOut/newPlacedOff/trigger`) and `/layAutoOn` (each null when the machine has no such rule), `/oddsOffReturnedAtPointMade`; per-type defaults in `/catalog/<t>/comeOutDefault` |
| | `workingToggle{global, scope, types[]}` | STW 10 types; IB 5 types | `/workingToggle`, plus `perBet`: whether single bets can be switched |
| | `offBets.consumeCredit`+ | STW false; IB true | `/offBets/consumeCredit` |
| Mutability | `dontPassAfterPoint`+ | locked / reduceRemove | `/catalog/<don't pass type>/onNumber` |
| | `dontComeAfterTravel`+ | — | `/catalog/<don't come type>/onNumber` |
| | `noRebetAfterRemove`+ | `nextCycle` | `/catalog/<don't type>/rebetAfterRemove`: `allowed` or `nextCycle` |
| | `oddsMutable` | — | Not a knob: odds may be added, reduced or removed until decided (§3.1) |
| | `sideBetsWithdrawable` | false | Side bets are locked (§2.6); Lucky Shooter before its point: `/sideBets/<t>/removableBeforePoint` |
| Exclusivity | `exclusiveGroups[]` with `scope: global/sameNumber`+ | — | `/exclusiveGroups/<i>/types`, `/exclusiveGroups/<i>/scope` |
| | `excludeLineVsLayBuy`+ | IB: Pass blocks Lay on the point; Don't Pass blocks Buy on the point. A blocked spot takes no money, so a lay or buy already up when the line bet reaches its number can be cut or taken down but not added to or pressed (§9 #30) | `/excludeLineVsLayBuy` |
| Auto-actions | `afterWin` per type | `stay` / `return` / `stayIfFirstRoll`+ / `stayIf11`+ | `/catalog/<t>/afterWin`; the last two on line bets only |
| | `keepBetsOn`, `repeatLastBet` | UI | `/flow/macros`: `repeatLastBet`, `double`, `keepBetsOn` |
| Side bets | `hotShooter`, `luckyShooter`, `luckyRoller`, `fire`, `powerOdds` | See §6 | `/sideBets/<t>` by family: `handLength` (Hot Shooter), `pointRun` (Lucky Shooter), `collectSet` (Lucky Roller, one type each for Low, High and All), `uniquePointsMade` (Fire, with required `countedPoints` and `payTable`). Power Odds is not modeled (§5.2) |
| Flow | `pace{rollsPerHour, betWindowSec}`, `shooterWindowSec`+, `shooter{mode: community/single}`+ | — | `/pace/rollsPerHour`, `/pace/betWindowSec`, `/pace/shooterWindowSec` (null when untimed); `/flow/shooter/mode` |
| | `invalidRoll`+ | reshoot / void / attendant (cosmetic) | `/flow/invalidRoll`, which adds `reVibrate` (IB) and `noRoll` (live) |
| | `puckReset`+ | 0/1/2 (IB single-play) | `/flow/puckReset` |
| | `groupButtons`+ | Across / Inside / Outside / Press, with conditions | `/flow/groupButtons/buttons`, `/flow/groupButtons/condition` |
| | `historyLength`+ | — | `/flow/historyLength` |
| Provenance | `provenance[jsonPointer] = {status, source, note}` | Required for every non-assumed value | `/provenance/<pointer>` (§5.4) |

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
| Payout rounding | place 6/8 `{ceil, 1}` [R] (`payoutRoundingByNumber`); place 4/5/9/10 and everything else `{floor, 1}` [A] | `{floor, 1}` [A] | `{floor, 1}` [A] | `{floor, 100}` [V] |
| Commission rounding | `{ceil, 1}` (only lay can hit sub-cent) [A] | `{ceil, 1}` [A] | `{ceil, 1}` [A] | `{floor, 100}`, minimum 100 [V HAR-PA] |
| Bet increment | $1 [A] | $1 [A] | $1 [A] | $1; bot grid $5 / $6 [V]. Odds only in the units that pay whole dollars (§3.1): take $1 / $2 / $5 on 4-10 / 5-9 / 6-8, lay $2 / $3 / $6 (`incrementByNumber`) [A]. Composites in whole-dollar units per number: C&E $2, horn $4, horn high and world $5, each also its minimum [A, §9 #27] |
| Minimum | $1 per bet; **$3 total** [A; R range $1–$5] | $1 per bet; **$5 total** [A; R $1–$6, G3 $5] | $5 total [A] | $10 line [A] |
| Maximum per wager | $500 [A; WA cap V] | $500 [A] | $500 [A] | $5,000; odds may exceed [A] |
| Come-out working | STW policy (§2.4) [V; new chips A] | IB policy (§2.4) [V] | IB policy [V] | LIVE: place/buy OFF, come odds OFF→returned, DC odds ON, lay ON, PTL ON, hard ON, Big ON [V/R] |
| Toggle | 10 types, "from the upcoming roll onward" [V STWO] | Place, Buy, Odds, Hard; persists [V IB] | Place, Lay, Buy, Odds, Hard [V IB] | per bet |
| OFF bets use credit | no [V STWO]; **not modelled**: the trainer's OFF chips still use credit (`notModelled`, §4.5, plan §0 #23) | yes [V IB] | yes [V IB] | n/a |
| DP after point / DC after travel | locked [V CW §11e] / removable [A] | n/a | reduce/remove, no re-bet until next cycle [V IB §2.3] / same [A] | reduce/remove, no re-add or increase [V MD-C] / same [V] |
| Exclusive | Pass×DP, Come×DC (global); Place×{PTL, Lay}, Buy×{Lay, PTL} on the same number [V CW §21; same-number scope A]. Place + Buy on one number allowed [A] | Place + Buy on one number if the paytable allows [V IB] | Pass×DP, Come×DC; Place×Lay, Buy×Lay; `excludeLineVsLayBuy` ON [setting V IB221; ON A] | none (Doey-Don't allowed) [A] |
| afterWin | Pass stay; DP/DC `stayIfFirstRoll`; Come `stayIf11`; place, buy, hard, field, lay, PTL, props, hops, big stay [V CW §29–32] | Pass stay (chips "pushed to the next round") [V IB §2]; place/buy/hard stay [A]; one-roll return, with Keep Bets On/Repeat as UI [A] | same as crapless | Pass stay; Come return; number bets stay; one-roll return [A] |
| Side bets | HSJ: tiers 1/3/5/7/12/30/100× "for 1" at 8/16/24/32/40/45/50+ rolls; definition A; window = come-out after a 7-out; qualifier 3 credits; $1–$1,000 [V CW; definition A]. Lucky Roller 30/30/155 [A]. Power Odds off [A] | **Lucky Roller 30/30/155 to 1** [R]; window after a 7 or at cycle start, no re-bet after a win until a 7 [V IB]. Lucky Shooter off [V] | Lucky Roller 30/30/150 [A]; Lucky Shooter table A [A] | Fire Bet 24/249/999 to 1, optional [R WOO-FIRE] |
| Pace | 100 rolls/hr [A]; bet window 20 s [R]; shooter window 20 s [R] | 120 rolls/hr [A]; no timer, self-paced [V/R] | 120 [A]; no timer | 144 [R WOO-K, 5 players] |
| Shooter / invalid roll / puck | community; rotate per CW §35g (cosmetic) / reshoot [A] / — | single (player) [V] / re-vibrate [R] / `puckReset` 0 [V options] | single / same / 0 | rotate at 7-out / no roll |
| Group buttons / history | Across: after the come-out, only with Pass, DP, Field or a one-roll bet up [V STWO] / 27 rolls [V] | Press, Across (same conditions) [V IB] / configurable | Press, Across, Inside, Outside [V IB] | — |

**Implementation** (`src/engine/config/presets/`). Each preset is a frozen `MachineConfigInput`, and a provenance entry covers every value with the tag above: V → `verified`, R → `reported`, A → `assumed`. Where the table gives two tags, the entry takes the one that applies to the machine the preset models. Values the table leaves open use these choices, `assumed` unless noted:
- Starting bankroll $500 and the chip values are trainer defaults; Interblock's history length is 20.
- Interblock props and hops are written "for 1", as its screen shows them (5, 8, 16 and 31 for 1) [R].
- C, E and Any Craps are separate spots wherever the machine has them, though they pay the same; the horn singles are their own bets; C&E and the horn are composites of those (§4.1).
- One-roll winners are returned on Interblock (§9 #19). A winning come bet is returned except on STW (`stayIf11`).
- strictBubble's don't come bet and its lay odds follow its don't pass: reduce or remove with no re-bet until the next cycle, and a 2× stake-basis cap. Its Lucky Roller is 30/30/150 to 1, shown as 31/31/151 for 1.
- traditionalLive345 lays 6× the flat bet (the same as a win-basis 3/4/5× cap), takes props from $1, and lets odds exceed the $5,000 maximum (take odds to $25,000, lays to $30,000).
- Power Odds is not in the config: every preset disables it and its trigger rates are unknown (§6.5).

`src/engine/config/presets/__snapshots__/presets.test.ts.snap` fingerprints every preset value with its tag, so a data change shows up in review.

### 5.3 Config validation

`compileConfig` (`src/engine/config/compile.ts`) accepts a config only if it passes the schema and the checks below. Each failure is reported at the JSON path of the offending value, so an editor can show it inline.

**Shape (schema).**
- Every object is strict, so a misspelt key is an error.
- Money is whole cents (safe integers). Limits, increments and chips are greater than zero.
- Ratios must parse: whole numbers written `a:b`, `a to b` or `a for b`, with a net pay above zero ("0:1" and "1 for 1" fail).
- Rounding modes are floor, ceil, halfUp and halfEven, with an increment of at least 1¢. Odds multiples are whole numbers, at least 0.
- `verified` and `reported` provenance needs a `source` whose citations start with known keys; `assumed` provenance needs a `note`.

**Semantics.**
1. The come-out lists partition 2–12 with 7 a natural, and equal the variant's lists (§2.1). Crapless has no bar; traditional bars 2 or 12.
2. Crapless offers no don't bets, no put bets and no Hot Shooter Jackpot.
3. Line types: one per side and window. A don't bet states `onNumber` and `rebetAfterRemove`; a do bet does not. `stayIfFirstRoll` is for don't bets only, `stayIf11` for a come bet only.
4. Odds: the parent exists and is a line type, with at most one odds type per parent. Pays and limits cover exactly the variant's points. `comeOutDefault` is given exactly when the parent is placed in the point phase.
5. Number bets: numbers are points of the variant (big bets: 6 and 8), listed once. Every offered number has a pay ratio, and no other number does. Buy and lay carry a commission and no other kind does. Per-number commissions and per-number payout roundings name offered numbers. Commission taken from wins is never refunded or re-collected.
6. Hardways: numbers are 4, 6, 8 and 10, listed once, each with a pay ratio.
7. One-roll bets: at least one winning outcome, keyed by a total ("2" to "12") or a dice pair written low face first ("2-5").
8. Composites combine one-roll bets from the catalog, each once. Composite and side-bet ids do not reuse a bet type id. A composite settles as one bet (§9 #25), so its parts agree on `afterWin` and on payout rounding, and on each of the 21 dice outcomes its net per unit is positive (a win), exactly 0 (a push) or −1 (a loss), never strictly between −1 and 0.
9. Side bets: pay tables are non-empty. Lucky Roller targets exclude 7. Fire counts fit `countedPoints` (points of the variant), and an immediate-pay count has a pay. Hot Shooter tiers rise in rolls. Lucky Shooter is traditional only, and its hit counts fit its box numbers.
10. Type lists (toggle, auto-OFF, after-seven-out, exclusive groups, per-type limits) name offered types, once each. The lists that switch bets ON and OFF (toggle, both auto-OFF lists, after-seven-out) name only odds, number and hardway types, the bets that can be OFF (§2.4). Per-type limits may also name a composite.
11. Limits: the minimum is at most the maximum, and both are multiples of the bet increment. The table maximum is at least the per-bet maximum. Per-type minimums and maximums, including those a type inherits, are multiples of its increment, and the minimum total is a multiple of the bet increment. Chips go up in size and are multiples of the bet increment. Per-number units (`incrementByNumber`) belong only to odds, number bets and hardways, name only numbers the type takes bets on (for odds, the variant's points), and are multiples of the type's increment; the type's minimum need not be a multiple of a unit, as the smallest bet on that number is the minimum rounded up to it.
12. Every provenance pointer names a value in the config, outside the provenance itself.

`configHash` is a 64-bit FNV-1a hash of the config's canonical JSON (sorted keys), leaving out `name` and `provenance`. Reordering keys, renaming a config or editing provenance keeps cached analysis valid; changing any rule value gives a new hash.

The player-advantage check (any edge below 0 is an error, above 40% a warning; §4.2) runs in `exact/sanity.ts` (M6), because it needs the exact solver.

### 5.4 Provenance

- `provenance` maps RFC 6901 JSON pointers to `{ status, source?, note? }`. An entry covers its pointer and everything below it, and the deepest entry wins. A value that no entry covers counts as `assumed`.
- Status follows the tags: V → `verified`, R → `reported`, A → `assumed`. M (math) facts are not config values. A U item is configured with an `assumed` default.
- `source` cites keys from the Sources table, separated by ";", each optionally followed by a location: `CW §17; WOO-B`, `IB §3.2`, `WOV-11344`, `USER photo 2026-11-02`.
- Presets cover every value. Each bet type's pays, commission, limits and after-win rule are covered at the type level or deeper, so no payout inherits a blanket status.
- `listAssumptions(cfg)` returns every `assumed` entry with its note: the values a player should check on their own machine. The coach shows an "assumed" chip on any number that depends on one.
- Deleting a value leaves its entries pointing at nothing, which validation rejects; `pruneProvenance` removes them.

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

## 7. Strategy definitions (deferred)

The strategy lab (bots, progressions and Monte Carlo comparisons) is deferred past v1. Its research is kept unchanged in `docs/rules/research/spec.md` §7 and `docs/rules/research/strategies.md`: the metrics for strategy runs, the universal bot rules, the strategy decision table (Pass + odds, Molly, Dolly, place-and-press systems, Iron Cross, hedges, the 5-count, progressions) and the lab test vectors. Move it here when the lab is built. Until then the coach's metrics come from `docs/rules/glossary.md`, and a strategy figure reaches the coach only as a computed `CoachNumber`.

---

## 8. Coaching facts

### 8.1 Bets ranked by house edge (standard paytables) [M]

Rows marked "vig upfront" quote HE per (stake + vig), §0.1's upfront-vig convention; the trainer's own edge and "Per roll" divide by the stake alone (§4.3 HE_roll convention note), so its figures for those rows read slightly higher per decision and per roll (rank 15's per-roll range 1.19–1.46% is 1.25–1.53% per stake).

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
| 7 | STW place/buy/hard bets newly placed during the come-out window; can All On override the auto-OFF? | OFF; no [A]. Carried in `/comeOut/autoOff/newlyPlaced` [A], which outranks the types' `comeOutDefault`, so those defaults decide no chip on the come-out (§2.4) |
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
| 25 | Composite settlement: §4.1 settles horn, world and C&E as one bet on the whole-bet net table; plan §4.5 expands them into their component bets. The two agree on whole-dollar machine bets | **Resolved by plan §0 #15:** one bet, settled once with one rounding on the net per unit derived from its parts' pays, Σ(winning units × (pay + 1)) ÷ total units − 1. The config stores the parts; validation requires them to agree on `afterWin` and rounding, and rejects a composite that could lose only part of its stake (a net strictly between −1 and 0) |
| 26 | Interblock's text lets a Come bet be placed after the pass point is made (IB §2.4); CW, and the window this spec uses, allow Come only in the point phase | point phase only (§3.1) |
| 27 | Whether per-bet minimums apply to each part of a composite (a $1 horn is four 25¢ parts) | **Resolved by plan §0 #15:** limits, increments and minimums apply to the composite's total stake |
| 28 | Interblock "Set bets On": does it force the covered bets ON (`setGlobalWorking(false)`: Come odds then work on the come-out) or return them to the machine's defaults (`setGlobalWorking(null)`)? IB §3.2 does not say | **Defaults** (`null`) [A, plan §0 #21]: it ends the post-seven-out OFF, and Come odds stay OFF on the come-out (returned on a come-out 7). The coach marks it assumed; a crapless scenario pins it (`tests/scenarios/working.test.ts`) |
| 29 | The post-seven-out OFF on a machine with per-bet toggles (no preset has both): does setting the bet back to its default end it? | **No** [reading]: the OFF is the machine's hold on the bet, not the bet's own setting. Setting the bet ON turns it ON; setting it back to its default leaves it held until Set bets On (or the point, under `until: pointEstablished`, which releases only the hold, not a player's own OFF); a `nextRollOnly` toggle reset leaves the hold |
| 30 | Interblock's `excludeLineVsLayBuy` when the lay or buy is already up as the dice take the pass or don't pass bet to its number (no rule can stop that): may the player add to it or press it? | **No** [reading, IB221: the setting "will prevent the player from wagering on the Buy bet of the established Point"]: the bet stays up and can be cut or taken down, but takes no more money, whether by a new placement on its spot or by a press. Any exclusion blocks additions the same way (M6 reconciliation; `tests/oracle/reference.diff.test.ts`) |
| 31 | Interblock's lay re-enable (`/layAutoOn`) on a lay the post-seven-out hold covers (no preset: IB §3.2 holds place and buy only): does a point made or a 7 end the hold? | **No** [reading, IB §3.2]: "Lay bets become enabled after a Point is reestablished or a 7 is rolled" is said of the bets "Set bets Off" disables, while bets held after a 7-out need "the Set bets On button" (§2.4). A lay a toggle switched OFF is set ON, its own setting outranking the hold; one OFF only by the hold stays OFF until Set bets On, or the point under `until: pointEstablished` (M6 reconciliation; `tests/oracle/reference.diff.test.ts`) |

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
| WOV-n | https://wizardofvegas.com/forum/gambling/craps/<n>-thread/ (n = 9005, 11344, 24510, 28274, 30281, 32511, 36080, 36634, 37778, 35576, 38668, 37046 [3PM], 37179 [Dolly]). The forum finds a thread by the number before its title slug, so any slug works; the bare `<n>/` opens a list of threads instead |
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
| WOO-FIRE / WOO-BONUS | https://wizardofodds.com/games/craps/side-bets/fire-bet/ ; https://wizardofodds.com/games/craps/side-bets/bonus-craps/ (the keys config provenance uses for two of the "WOO side bets" pages) |
| USER | The player's own observation of a machine; config provenance only |

### Implementation map
- `src/engine/config/schema.ts`: the zod `MachineConfigInput` (§5.1).
- `src/engine/config/compile.ts`: validation (§5.3), `configHash` and the compiled `MachineConfig`.
- `src/engine/config/rulesets.ts`: the two rulesets and the partition checks (§2.1).
- `src/engine/config/provenance.ts`: source keys, JSON pointers and `listAssumptions` (§5.4).
- `src/engine/config/presets/`: the four presets (§5.2) and their fingerprints.
- `src/engine/round/round.ts`: `advanceRound`, the round transitions and the hand and since-seven counters (§2.1).
- `tests/scenarios/dsl.ts`: the scenario DSL that turns each researched machine fact into a test.
- `docs/rules/glossary.md`: the coach's metric definitions.
