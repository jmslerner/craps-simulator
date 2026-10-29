# Craps wager spec: traditional and crapless, with exact math and sourced rules

**Method.** Every probability, payout and house edge (HE) below was recomputed from first principles with exact fractions (`python3` `fractions.Fraction`). One-roll and hop bets were checked by enumerating all 36 ordered outcomes. The independent re-verification on 2026-10-28 found **no arithmetic errors** in the original values. Every value that can be compared with Wizard of Odds (WoO) matches [WOO-HE][WOO-CL]. Non-math claims carry a source key; the URLs are in §12. Claims still unconfirmed are tagged [UNVERIFIED].

**Definitions**
- **"a:b" / "a to b"** = net win of a per b staked, with the stake returned. **"x for 1"** includes the stake, so x for 1 = (x−1):1. Examples: 30 for 1 = 29:1; 15 for 1 = 14:1; Any 7 "5 for 1" = 4:1. WoO's prop table includes the 29 and 14 variants [WOO-HE]. Regulators use both wordings: Maryland props are "30 to 1", but its Fire Bet table says "10 for 1" [MD-C].
- **HE_res** = expected loss ÷ stake, per decision. DP/DC get two bases: ties counted (= WoO "per bet made") and ties excluded (= WoO "per bet resolved").
- **HE_roll** = expected loss per decision ÷ E[rolls per decision] = expected loss per roll per $1 working.
  - For a bet on number N, this equals HE_res × (w+6)/36. For hardways the decision ways are 1 hard + easy ways + 6.
  - For line bets the per-roll decision probability is not constant, so E[rolls per decision] from §1 is used.
  - One-roll bets: HE_roll = HE.
- **Commission paid up front:** HE is given per (stake + commission), WoO's "commission always paid" basis, and also per stake. Use one basis consistently for both amounts and HE_roll.
- **Expected loss per hour** = rolls/hr × Σ over working bets of (amount × HE_roll). Count only rolls on which the bet is ON. Rolls/hr is machine-specific and was not researched.

---

## 1. Dice, decision probabilities, pace of play

| Total | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ways /36 | 1 | 2 | 3 | 4 | 5 | 6 | 5 | 4 | 3 | 2 | 1 |
| P | 2.778% | 5.556% | 8.333% | 11.111% | 13.889% | 16.667% | 13.889% | 11.111% | 8.333% | 5.556% | 2.778% |

**Bets on a number N against 7.** P(N before 7) = w/(w+6). P(decided on a given roll) = (w+6)/36. E[rolls to a decision] = 36/(w+6).

| N | P(N before 7) | E[rolls to decision] |
|---|---|---|
| 4/10 | 1/3 | 4 |
| 5/9 | 2/5 | 3.6 |
| 6/8 | 5/11 | 36/11 = 3.2727 |
| 2/12 (crapless) | 1/7 | 36/7 = 5.1429 |
| 3/11 (crapless) | 1/4 | 4.5 |

| Pace metric | Traditional | Crapless |
|---|---|---|
| E[rolls per pass-line decision] | **557/165 = 3.3758** | **9613/2310 = 4.1615** |
| E[rolls per shooter (hand)] | **1671/196 = 8.5255** | **57678/7303 = 7.8979** |
| E[pass decisions per shooter] | 495/196 = 2.5255 | 13860/7303 = 1.8979 |
| E[points made per shooter] | 67/98 = 0.6837 | 4247/7303 = 0.5815 |
| E[come-out naturals per shooter] | 55/98 = 0.5612 (7 or 11) | 2310/7303 = 0.3163 (7 only) |
| E[come-out craps per shooter] | 55/196 = 0.2806 | 0 |
| P(a decision ends in seven-out) | 196/495 | 7303/13860 |

- **Test identities:**
  - E[rolls per shooter] = E[decisions per shooter] + 6. This follows from Wald's identity: each hand contains exactly one seven-out, and come-out 7s occur at a rate of 1/6 per come-out.
  - Decisions per shooter = naturals + craps + points made + 1. Traditional: (110+55+134+196)/196 = 495/196. Crapless: (2310+4247+7303)/7303 = 13860/7303.
- **"Shooter"** here means one hand: from the come-out after a seven-out through the next seven-out. Shoot to Win's Hot Shooter ROLL COUNT uses this definition [STW-R §33f]. On Shoot to Win the shooter *button* rotates on a 7-out **or when a point is established**, and it "does not affect the roll result" [STW-R §35g–h].

---

## 2. Line bets

### 2.1 Bet catalogue

| id | Aliases | Variants | Window | Removal | Pays | P(win) / P(push) / P(lose) | HE_res | HE_roll |
|---|---|---|---|---|---|---|---|---|
| PASS | Pass Line, front line, "do" | trad | Come-out only on machines: "can only be placed before the come-out roll" [IB-WA]; implied by [STW-R]. Some live casinos accept it after the point, which makes it a PUT (§4) [WOO-B][WIKI] | Contract once a point is set: no removal or reduction [MD-C][HAR-PA][STW-R §5e][IB-WA] | 1:1 | 244/495 / 0 / 251/495 | **7/495 = 1.4141%** | 7/1671 = 0.4189% |
| PASS (crapless) | same | crapless | same | same [MD-CL] | 1:1 | 6557/13860 / 0 / 7303/13860 | **373/6930 = 5.3824%** [WOO-CL] | 373/28839 = 1.2934% |
| DONT_PASS bar 12 | Don't, back line, wrong | trad only | Come-out only; "No additional bets can be made after the Point" [STW-R §11d][MD-C] | **Live:** may be removed or reduced, never re-placed or increased [MD-C][HAR-PA]. **Shoot to Win:** "cannot be canceled after the Point" [STW-R §11e]. **Interblock:** its §2.3 text allows take-down or reduction (no re-bet until the next cycle), but its §2.1.1 table lists DP as a contract bet [IB-WA] → engine flag | 1:1 | 949/1980 / 1/36 / 244/495 | **3/220 = 1.3636%** ties counted; **27/1925 = 1.4026%** ties excluded | 9/2228 = 0.4039% |
| DONT_PASS bar 2 | "Reno rules": 3 and 12 win, 2 pushes [LVA-RENO] | trad, Northern Nevada | same | same | 1:1 | identical by symmetry | same as bar 12 | same |
| (DP bar 3, math only, no current source) | — | — | — | — | 1:1 | 149/330 / 1/18 / 244/495 | 41/990 = 4.1414% / 41/935 = 4.3850% | 41/3342 = 1.2268% |
| COME | Come | trad and crapless | Point phase only, i.e. any roll after the come-out [MD-C][IB-WA][STW-R §9b][HAR-PA] | Contract once it travels [MD-C][STW-R §9e] | 1:1 | = PASS | = PASS | = PASS |
| DONT_COME | DC | **trad only** (none in crapless [IB-WA]) | Point phase only | Removable or reducible, not re-placeable [MD-C] | 1:1 | = DP | = DP | = DP |

- **WoO cross-check:** Pass 1.41% (0.42% per roll). DP 1.36% per bet made, 1.40% per bet resolved, 0.40% per roll [WOO-HE].
- **Crapless:** Don't Pass does not exist [WOO-CL][IB-WA][LVA-CL][MD-CL]. A crapless DP with no barred number would give the **player +373/6930 = +5.38%**.
- **Machine exclusions:** Pass and Don't Pass are mutually exclusive, and so are Come and Don't Come [IB-WA][STW-R].
- **Shoot to Win don't areas:** optional ("IF AVAILABLE") [STW-R]. "Don't bet areas" are an operator setting [INTG].
- **Interblock Easy Craps:** also treats 2/3/11/12 as points, and removes DP, DC, Come, Buy, Lay and Big 6/8 [IB-WA].

### 2.2 Resolution: first roll after placement

PASS uses the come-out roll. COME uses the next roll after it is placed. "→N" means the point is set (PASS/DP) or the bet travels to box N (COME/DC).

| Roll | PASS/COME, trad | DP/DC, bar 12 | DP/DC, bar 2 | PASS/COME, crapless |
|---|---|---|---|---|
| 2 | LOSE | WIN | PUSH | →N=2 |
| 3 | LOSE | WIN | WIN | →N=3 |
| 4, 5, 6, 8, 9, 10 | →N | →N | →N | →N |
| 7 | WIN | LOSE | LOSE | WIN |
| 11 | WIN | LOSE | LOSE | →N=11 |
| 12 | LOSE | PUSH | WIN | →N=12 |

Every cell was re-checked against [STW-R][IB-WA][HAR-PA][MD-CL][WOO-CL][LVA-RENO]. The crapless point set is {2,3,4,5,6,8,9,10,11,12}.

**After the point or come point N:**
- Roll N: PASS/COME **WIN**, DP/DC **LOSE**.
- Roll 7: PASS/COME **LOSE**, DP/DC **WIN**.
- Any other roll: **NO ACTION**. This includes 2/3/11/12 in traditional craps and any non-N total in crapless.
- A Come or DC bet still in the come area on a roll that also settles the pass line resolves under its own first-roll rules. On a seven-out, an unmoved Come bet wins and an unmoved DC bet loses.

---

## 3. Free odds

### 3.1 Payouts

| Point | Take odds (Pass/Come) | Unit for whole-dollar pay | Lay odds (DP/DC) | Unit |
|---|---|---|---|---|
| 4/10 | 2:1 | $1 | 1:2 | $2 |
| 5/9 | 3:2 | $2 | 2:3 | $3 |
| 6/8 | 6:5 | $5 | 5:6 | $6 |
| 2/12 (crapless) | **6:1** | $1 | — | — |
| 3/11 (crapless) | **3:1** | $1 | — | — |

- HE = 0. Odds resolve with their parent bet. Sources: [WOO-B][STW-R][MD-C][MD-CL][CROWN-CL].
- **Window:** after the point or come point is set. The player may add up to the limit before any roll, and may reduce, remove or turn off odds at any time [WIKI][IB-WA].

### 3.2 Working status on the come-out

- **Come odds:**
  - OFF by default; the player may call them ON [WOO-B][HAR-PA][CROWN-CL].
  - If the Come bet wins or loses while its odds are OFF, the **odds are returned** [WIKI].
  - Shoot to Win turns them OFF automatically at the come-out [STW-R §4].
- **Don't Come odds:** ON by default [WOO-B][HAR-PA].

### 3.3 Odds-limit conventions

- **k× on the pass side (1×, 2×, 5×, 10×, 20×, 100×):** odds up to k × flat on every point.
- **Don't side, standard rule "A" (win-capped):**
  - Lay up to the amount whose WIN is ≤ k × flat: lay ≤ 2k× on 4/10, 1.5k× on 5/9, 1.2k× on 6/8 [WOO-B][WIKI].
  - Maryland words it as "winnings not in excess of" [MD-C].
- **Don't side, rule "B" (lay-amount-capped):** lay ≤ k × flat.
  - Shoot to Win's Washington sheet uses this for DP odds: "2 times the bet on the DON'T PASS LINE".
  - The same sheet words DC odds as "2 times the bet on DON'T COME ... divided by the corresponding DON'T COME ODDS", which is win-capped (rule A). The sheet is internally inconsistent [STW-R §12, §15].
- **3-4-5×:** take up to 3× on 4/10, 4× on 5/9, 5× on 6/8, so every maximum odds win equals 6× flat. Don't side: "you can Lay up to 6X the Don't Pass bet after any Point", which wins 3/4/5× flat [WOO-B].
- **Live availability:**
  - "Most casinos allow ... 3-4-5X Odds"; "Some casinos pay even more, like 5X, 10X, 20X, or 100X" [WOO-B].
  - Maryland permits up to 100× taken, and lay odds winning up to 100× [MD-C][MD-CL].
- **Machines:**
  - Shoot to Win Washington sheet: 2× on all points [STW-R §6, §10, §12].
  - The Shoot to Win product limit is configurable "between 2x and 100x" [STW-O]; odds are an operator setting [INTG].
  - Interblock: a pop-up offers multipliers up to a configured maximum, and odds can also be placed, reduced or removed manually [IB-WA].
- **Las Vegas bubble machines (dated player reports; [UNVERIFIED] as current):**
  - 2× is most common: Linq, Excalibur, Aria (2015), Eastside Cannery (2015), 4 Queens (2016) [WOV-1]; Mandalay Bay (2015) [VV].
  - Higher limits: Luxor 3×, Downtown Grand 4×, NYNY 5×, Palms 5× (2015–16) [WOV-1]; El Cortez 5× (2018 comment) [VV]; Binion's 10× (2016) [WOV-1].
  - Outside Las Vegas: Ohio 2×; one unnamed casino 3-4-5× (2017) [WOV-3].
- **Crapless tables:** make the limit a per-table parameter.
  - LVA: "most versions allow only 2X odds" [LVA-CL]. Low confidence: the same sentence confuses odds with place-bet edges [UNVERIFIED].
  - Crown Perth: odds limited to the Pass Line bet (1×) "or a higher amount displayed on a sign" [CROWN-CL].
  - Maryland: up to 100× [MD-CL].

### 3.4 Combined HE: line bet plus maximum odds

Formula: expected loss ÷ expected total wagered, ties counted.
- **Pass:** (7/495) / (1 + E[odds per flat]). E[odds per flat] = 2k/3 for k×, or 25/9 for 3-4-5×.
- **DP:** (3/220) / (1 + E[lay]).
  - E[lay] = k under rule A and 2k/3 under rule B.
  - E[lay] = 4 for a 6× lay, and 25/9 for a rule-B 3-4-5 cap (lay ≤ 3/4/5× flat).
- **Crapless:** (373/6930) / (1 + 5k/6).

| Limit | Pass + odds | DP + lay, rule A (standard) | DP + lay, rule B | Crapless pass + odds |
|---|---|---|---|---|
| none | 1.4141% | 1.3636% | 1.3636% | 5.3824% |
| 1× | 7/825 = 0.8485% | 3/440 = 0.6818% | 9/1100 = 0.8182% | 373/12705 = 2.9359% |
| 2× | 1/165 = 0.6061% | 1/220 = 0.4545% | 9/1540 = 0.5844% | 373/18480 = 2.0184% |
| 3× | 7/1485 = 0.4714% | 3/880 = 0.3409% | 1/220 = 0.4545% | 373/24255 = 1.5378% |
| 3-4-5× (rule A = 6× lay) | 7/1870 = 0.3743% | 3/1100 = 0.2727% | 27/7480 = 0.3610% (lay ≤ 3/4/5× flat) | — |
| 5× | 7/2145 = 0.3263% | 1/440 = 0.2273% | 9/2860 = 0.3147% | 373/35805 = 1.0418% |
| 10× | 7/3795 = 0.1845% | 3/2420 = 0.1240% | 9/5060 = 0.1779% | 373/64680 = 0.5767% |
| 20× | 7/7095 = 0.0987% | 1/1540 = 0.0649% | 9/9460 = 0.0951% | 373/122430 = 0.3047% |
| 100× | 1/4785 = 0.0209% | 3/22220 = 0.0135% | 9/44660 = 0.0202% | 373/584430 = 0.0638% |

- The crapless 1/2/3/5× values match WoO: 2.936%, 2.018%, 1.538%, 1.042% [WOO-CL].
- Pass + 4× (the Downtown Grand report): 7/1815 = 0.3857%.
- Two hypothetical crapless odds structures, for strategy-lab testing only:
  - 3× on 2/3/11/12 plus 3-4-5× on the rest: 373/29645 = 1.2582%.
  - Every maximum odds win = 6× flat (1× on 2/12, 2× on 3/11, 3× on 4/10, 4× on 5/9, 5× on 6/8): 373/28105 = 1.3272%.

---

## 4. Put bets (PUT_N)

- **What it is:** a flat Pass or Come bet made after the point is set. It pays 1:1, plus odds, and is a contract bet. Wikipedia says put betting "is a disadvantage to the player" [WIKI].
- **Where offered:**
  - Some live casinos [WOO-B][WIKI].
  - Not on Interblock, where Pass "can only be placed before the come-out roll" [IB-WA]; Shoot to Win implies the same [STW-R].
  - The crapless rows below are math only.
- **Formula:** HE = ((6−w)/(6+w)) / (1+m).
- **HE_roll with no odds** = (6−w)/36: 8.333% (4/10), 5.556% (5/9), 2.778% (6/8), 13.889% (2/12), 11.111% (3/11).

| N | 0× | 1× | 2× | 3× | 4× | 5× | 6× | 10× | 19× | 20× | 100× |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4/10 | 33.333% | 16.667% | 11.111% | 8.333% | 6.667% | 5.556% | 4.762% | 3.030% | 1.667% | 1.587% | 0.330% |
| 5/9 | 20.000% | 10.000% | 6.667% | 5.000% | 4.000% | 3.333% | 2.857% | 1.818% | 1.000% | 0.952% | 0.198% |
| 6/8 | 9.091% | 4.545% | 3.030% | 2.273% | 1.818% | 1.515% | 1.299% | 0.826% | 0.455% | 0.433% | 0.090% |
| 2/12 (crapless) | 71.429% | 35.714% | 23.810% | 17.857% | 14.286% | 11.905% | 10.204% | 6.494% | 3.571% | 3.401% | 0.707% |
| 3/11 (crapless) | 50.000% | 25.000% | 16.667% | 12.500% | 10.000% | 8.333% | 7.143% | 4.545% | 2.500% | 2.381% | 0.495% |

**Break-evens.** WoO's wording is "same" / "match" [WOO-B]; "beats" requires one more multiple.

| Put on | Compared with | Equal at | Better from | Value at equality |
|---|---|---|---|---|
| 6/8 | place 6/8 | 5× | 6× | 1.515% |
| 5/9 | place 5/9 | 4× | 5× | 4.000% |
| 4/10 | buy, commission always paid | 6× | 7× | 1/21 = 4.762% per (bet + commission) |
| 4/10 | buy, commission on win only | 19× | 20× | 1/60 = 1.667% |

- WoO: "At casinos that offer 3-4-5X odds, or worse, there is no reason to make a put bet" [WOO-B].

---

## 5. Place, buy, lay, place-to-lose, Big 6/8

### 5.1 Common rules

- **Window:** any roll. Interblock: point bets "can be placed in any roll" [IB-WA].
- **Removal:** remove, reduce or turn OFF at any time [WOO-B][MD-C].

**Come-out defaults on live tables**

| Bet | Default on come-out | Sources |
|---|---|---|
| Place | OFF | [WOO-B][MD-C][HAR-PA][WIKI] |
| Buy | OFF | [WOO-B][MD-C][HAR-PA][WIKI] |
| Lay | **ON** | [WOO-B][MD-C][WIKI] |
| Place-to-lose | WoO: "ON (... I'm not 100% sure on this one)" [WOO-B]. Maryland: inactive unless called on [MD-C]. → engine flag | |
| Big 6/8 | **ON**: "Big 6 and 8 bets always work" [WIKI]. WoO does not address it | |

**Machines**
- **Shoot to Win:**
  - At the come-out, chips on COME ODDS, PLACE, BUY, HARDWAYS, BIG6 and BIG8 are automatically turned OFF until the point is established, then automatically back ON [STW-R §4].
  - The All Off / Off buttons act only on **PLACE, BUY, PLACE TO LOSE, LAY and HARDWAYS** (odds and Big 6/8 are not in this list). OFF chips "become inactive and are not bet" [STW-O].
- **Interblock:**
  - "Set bets Off" disables Place, Lay, Buy, Odds and Hard Ways for the next roll. While OFF, bets can be increased, reduced or removed [IB-WA §3.2].
  - After a 7-out, new Place and Buy wagers are automatically set OFF [IB-WA §3.2].
  - All placed bets debit the Playable meter, whether ON or OFF [IB-WA §3.2].
  - The same section says "Odds bets are removed when a Point is reestablished" [UNVERIFIED interpretation].

**Mutual exclusions**
- Shoot to Win: these "cannot be placed for the same roll": PLACE with PLACE TO LOSE/LAY; BUY with LAY/PLACE TO LOSE [STW-R §21].
- Interblock: Buy and Place exclude Lay. Place and Buy can be placed simultaneously "when available" [IB-WA §2.6].
- **Bet caps:** "most of these machines ... limit place/lay bets to $25" (Las Vegas, 2016 post) [WOV-1] [UNVERIFIED as current].

### 5.2 Resolution on number N

| State | Roll N | Roll 7 | Other |
|---|---|---|---|
| Place, Buy, Big 6/8, take-odds — working | WIN | LOSE | no action |
| Lay, place-to-lose, lay-odds — working | LOSE | WIN | no action |
| Any of these OFF | no action | no action | no action (bet stays) |

**Exception:** if a Come bet is decided while its odds are OFF, the odds are **returned**, not left up [WIKI]. Example: on a come-out 7 the Come bet loses and its odds are returned. On a come-out roll of the come point, the Come bet wins and its odds are returned.

### 5.3 Place to win, place to lose, Big 6/8

| Bet | Pays | Unit | P(win) | HE_res | HE_roll |
|---|---|---|---|---|---|
| Place 4/10 | 9:5 | $5 | 1/3 | 1/15 = 6.6667% | 1/60 = 1.6667% |
| Place 5/9 | 7:5 | $5 | 2/5 | 1/25 = 4.0000% | 1/90 = 1.1111% |
| Place 6/8 | 7:6 | $6 | 5/11 | 1/66 = 1.5152% | 1/216 = 0.4630% |
| Place 2/12 (crapless) | **11:2** | $2 | 1/7 | 1/14 = 7.1429% | 1/72 = 1.3889% |
| Place 2/12, alternative "25 to 5" (= 5:1) | 5:1 | $1 | 1/7 | 1/7 = 14.2857% | 1/36 = 2.7778% |
| Place 3/11 (crapless) | **11:4** | $4 | 1/4 | 1/16 = 6.2500% | 1/72 = 1.3889% |
| Place 3/11, alternative | 13:5 | $5 | 1/4 | 1/10 = 10.000% | 1/45 = 2.2222% |
| Place-to-lose 4/10 | 5:11 | $11 | 2/3 | 1/33 = 3.0303% | 1/132 = 0.7576% |
| Place-to-lose 5/9 | 5:8 | $8 | 3/5 | 1/40 = 2.5000% | 1/144 = 0.6944% |
| Place-to-lose 6/8 | 4:5 | $5 | 6/11 | 1/55 = 1.8182% | 1/180 = 0.5556% |
| Big 6 / Big 8 | 1:1 | $1 | 5/11 | 1/11 = 9.0909% | 1/36 = 2.7778% |

Sources for payouts: [WOO-B][WOO-HE][MD-C][STW-R §7, §17, §19][MD-CL][WOO-CL][CROWN-CL].
- **Crapless 2/12 and 3/11 place pays:**
  - Maryland permits either 11:2 or "25 to 5" on 2/12, and either 11:4 or 13:5 on 3/11 [MD-CL].
  - Crown Perth pays **only** 25 to 5 and 13 to 5 [CROWN-CL].
  - WoO lists 11:2 and 11:4 [WOO-CL].
- **Place-to-lose:** offered on Shoot to Win [STW-R §19] and in Maryland standard craps [MD-C]. Not listed by Interblock [IB-WA] or Maryland crapless [MD-CL].
- **Big 6/8:** Shoot to Win [STW-R §7] and Interblock standard craps only, not its crapless [IB-WA]. Crown Perth crapless pays 1:1 [CROWN-CL].

### 5.4 Buy: true odds, commission = 5% of the BET

- On-win HE = 0.05 × P(win).
- Up-front HE = 0.05/1.05 = 1/21 per (bet + commission), or 5% per bet.

| N | True odds | Net per $1, commission on win | HE, on win | HE_roll, on win | HE up front, per (bet + commission) | HE up front, per bet | HE_roll up front, per (bet + commission) | HE_roll up front, per bet |
|---|---|---|---|---|---|---|---|---|
| 4/10 | 2:1 | 1.95 | 1/60 = 1.6667% | 1/240 = 0.4167% | 1/21 = 4.7619% | 5% | 1/84 = 1.1905% | 1/80 = 1.2500% |
| 5/9 | 3:2 | 1.45 | 1/50 = 2.0000% | 1/180 = 0.5556% | 4.7619% | 5% | 5/378 = 1.3228% | 1/72 = 1.3889% |
| 6/8 | 6:5 | 1.15 | 1/44 = 2.2727% | 1/144 = 0.6944% | 4.7619% | 5% | 11/756 = 1.4550% | 11/720 = 1.5278% |
| 2/12 (crapless) | 6:1 | 5.95 | 1/140 = 0.7143% | 1/720 = 0.1389% | 4.7619% | 5% | 1/108 = 0.9259% | 7/720 = 0.9722% |
| 3/11 (crapless) | 3:1 | 2.95 | 1/80 = 1.2500% | 1/360 = 0.2778% | 4.7619% | 5% | 2/189 = 1.0582% | 1/90 = 1.1111% |

- WoO's per-roll figures match: 1.19/1.32/1.46% with commission up front, 0.42/0.56/0.69% with commission on win [WOO-HE].
- Live variant: Santa Ana Star buys 4/10 with no commission, so 0% HE [WOO-B].

### 5.5 Lay: true odds, commission = 5% of the WIN

On-win HE (per lay amount) = 0.05 × P(N before 7).

| N | Lay pays | HE, on win | HE_roll, on win | HE up front, per (lay + commission) | HE up front, per lay | HE_roll up front, per (lay + commission) | HE_roll up front, per lay |
|---|---|---|---|---|---|---|---|
| 4/10 | 1:2 | 1/60 = 1.6667% | 0.4167% | 1/41 = 2.4390% | 1/40 = 2.5000% | 1/164 = 0.6098% | 1/160 = 0.6250% |
| 5/9 | 2:3 | 1/50 = 2.0000% | 0.5556% | 1/31 = 3.2258% | 1/30 = 3.3333% | 5/558 = 0.8961% | 1/108 = 0.9259% |
| 6/8 | 5:6 | 1/44 = 2.2727% | 0.6944% | 1/25 = 4.0000% | 1/24 = 4.1667% | 11/900 = 1.2222% | 11/864 = 1.2731% |
| 2/12 (crapless, rare) | 1:6 | 1/140 = 0.7143% | 0.1389% | 1/121 = 0.8264% | 1/120 = 0.8333% | 7/4356 = 0.1607% | 7/4320 = 0.1620% |
| 3/11 (crapless, rare) | 1:3 | 1/80 = 1.2500% | 0.2778% | 1/61 = 1.6393% | 1/60 = 1.6667% | 2/549 = 0.3643% | 1/270 = 0.3704% |

- Lay is only in Interblock standard craps, not its crapless [IB-WA]. Maryland crapless has no lay bet [MD-CL].
- WoO's crapless page says: "I have an unconfirmed report that at least one casino offers lay bets" [WOO-CL] [UNVERIFIED].

### 5.6 Commission handling by venue

| Context | Buy | Lay | Rounding / minimum | Taken down before decision | Bet kept up after a win |
|---|---|---|---|---|---|
| Live, Harrah's Philadelphia (2013 rack card) [HAR-PA] | 5% of bet at placement; minimum buy $20 | 5% of the amount WON, at placement; lay must win ≥ $20 | "All commissions are rounded down to the nearest whole dollar amount" | Commission returned | Commission re-paid on every win |
| Live, other | Usually at placement. "At some casinos, the commission on the 4 and 10 is charged only on a win"; Santa Ana Star charges none on 4/10 [WOO-B]. Maryland: at placement "of up to 5 percent ... of the amount wagered on the Buy or Lay Bet", or only on a winning bet; the operator's rules submission picks one [MD-C][MD-CL] | Same options. Maryland's cap base is the amount wagered, not the win [MD-C] | $1 minimum commission is common [UNVERIFIED]. Rounding down lowers HE: a $25 buy rounded to a $1 commission "cuts the commission to 4%" [WOO-HE] | WoO: "usually non-refundable" [WOO-B]. Crown: returned if removed [CROWN-CL]. Harrah's Philadelphia: returned [HAR-PA] | — |
| Shoot to Win, Washington rules [STW-R §18d, §20d] | "5% of the BET amount is deducted from the win" (charged on wins only) | "5% of the WIN pay amount is deducted from the win" | Exact 5%; no rounding clause | n/a (nothing is paid before a win) | Winning bets stay up automatically [STW-R §32] |
| Shoot to Win, generally | Commission is an operator setting [INTG], so the Washington behavior is not guaranteed at other venues | same | ? | ? | ? |
| Interblock GV6.5 [IB-WA §3.3] | "only possible with added upfront commission fee": a YES/NO pop-up, and NO removes the bet. "Refer to approved par sheets for where this type of bets are available" | same | ? | ? | "Keep Bets On" option (not in all jurisdictions) |
| Interblock ETG, Isle Casino Pompano Beach FL, Feb 2017 lawsuit (allegation) [GGB] | A $20 bet paying 2:1 ($60 due, i.e. a buy on 4 or 10) returned $58: $2 deducted (5% of the $40 win) instead of $1. The suit also cites 7.5% commissions on other bets | | | | |

**Player report consistent with on-win commission on a machine:** "Bubble Craps pays 1.40X for a PB and 1.45X for a 5 or 9 Buy Bet" and "The vig is taken on the win" (Dec 2021; casino and brand not named) [WOV-2].

**HE of the alleged 5%-of-win buy commission:**
- Charged on win: 4/10 = 1/30 = 3.333%; 5/9 = 3/100 = 3.000%; 6/8 = 3/110 = 2.727%; 2/12 = 3/70 = 4.286%; 3/11 = 3/80 = 3.750%.
- Charged up front:

| N | Per bet | Per (bet + commission) |
|---|---|---|
| 4/10 | 10% | 1/11 = 9.091% |
| 5/9 | 7.5% | 3/43 = 6.977% |
| 6/8 | 6% | 3/53 = 5.660% |

**Effect of live rounding and minimums on buying the 4:**

| Bet | Commission up front (per total / per bet) | Commission on win |
|---|---|---|
| $25 buy for $1 | 1/26 = 3.846% / 1/25 = 4% | 1/75 = 1.333% |
| $39 buy for $1 | 1/40 = 2.5% / 1/39 = 2.564% | 1/117 = 0.855% |
| $20 buy for $1 | 1/21 = 4.762% / 5% | 1/60 = 1.667% |
| $10 buy, $1 minimum commission | 1/11 = 9.091% / 10% | 1/30 = 3.333% |
| $5 buy, $1 minimum commission | 1/6 = 16.667% / 20% | pays $9, identical to place 9:5 (1/15 = 6.667%) |

**Rule for a flat $C commission on 4/10:**
- Up-front per-bet HE = C/B. On-win HE = C/(3B).
- The buy beats place 4/10 (1/15) only if B > 15C (up front) or B > 5C (on win).

---

## 6. Hardways

| id | Pays | Unit | P(win) | HE_res | HE_roll | Expected rolls |
|---|---|---|---|---|---|---|
| HARD_4 / HARD_10 | 7:1 (= 8 for 1) | $1 | 1/9 | 1/9 = 11.1111% | 1/36 = 2.7778% | 4 |
| HARD_6 / HARD_8 | 9:1 (= 10 for 1) | $1 | 1/11 | 1/11 = 9.0909% | 1/36 = 2.7778% | 36/11 = 3.2727 |

| Bet | WIN | LOSE | No action |
|---|---|---|---|
| Hard 4 | 2-2 | 1-3, 3-1, any 7 | everything else |
| Hard 6 | 3-3 | 1-5, 5-1, 2-4, 4-2, any 7 | everything else |
| Hard 8 | 4-4 | 2-6, 6-2, 3-5, 5-3, any 7 | everything else |
| Hard 10 | 5-5 | 4-6, 6-4, any 7 | everything else |

- **Window and removal:** any roll; remove or turn OFF any time [WOO-B][HAR-PA]. When OFF, a 7 or the easy way has no effect.
- **Come-out default:**

| Venue | Default | Sources |
|---|---|---|
| Las Vegas | ON (generally working) | [WOO-B][WIKI] |
| Atlantic City | OFF | [WOO-B][WIKI] |
| Maryland | Inactive unless called on | [MD-C][MD-CL] |
| Pennsylvania (Harrah's) | Works "unless otherwise stated" | [HAR-PA] |
| Shoot to Win | Turned OFF automatically | [STW-R §4] |
| Interblock | Player toggle (Set bets Off); default not documented | [IB-WA] |

- Hardways are the same in crapless [MD-CL][CROWN-CL].
- Non-US pays: Hard 6/8 at 19:2 → 1/22 = 4.545%; Hard 4/10 at 15:2 → 1/18 = 5.556% (Australia) [WOO-HE].

---

## 7. One-roll bets

HE equals HE_roll. Units are $1 unless noted.

| id | Aliases | Win condition | Pays (to 1) | "for 1" version | HE | Sources |
|---|---|---|---|---|---|---|
| FIELD | Field | 2, 3, 4, 9, 10, 11, 12. 3/4/9/10/11 pay 1:1 | 2 and 12 both 2:1 | — | **1/18 = 5.5556%** (Shoot to Win, Maryland, Harrah's, Interblock default) | [STW-R §8][MD-C][HAR-PA][IB-WA] |
| FIELD, triple on 12 | | | One of 2/12 pays 3:1 | — | **1/36 = 2.7778%**. Most live Las Vegas pay 3:1 on 12; Reno pays 3:1 on 2; Interblock pay table EL602 ("triple payout" on 12); Crown | [WOO-B][IB-WA][CROWN-CL] |
| FIELD, triple both | | | 3:1 on both | — | 0% (Santa Ana Star) | [WOO-B][WOO-HE] |
| ANY_7 | Big Red, Seven | 7 | 4:1 | 5 for 1 | 1/6 = 16.6667%. Australian 4.5:1: 1/12 = 8.333% [WOO-HE] | [STW-R §26][MD-C] |
| ANY_CRAPS | Any Craps, C, Craps | 2, 3, 12 | 7:1 | 8 for 1 | 1/9 = 11.1111%. 7.5:1 variant: 1/18 = 5.556% [WOO-HE] | [STW-R §22, §27][MD-C][HAR-PA] |
| PROP_2 / PROP_12 | Aces, Snake Eyes / Boxcars, Midnight | 2 / 12 | 30:1 | If posted "30 for 1" (= 29:1): 16.6667% | 5/36 = 13.8889% | [MD-C][HAR-PA][STW-R §25][WOO-HE] |
| PROP_3 / PROP_11 | Ace-Deuce / Yo, E | 3 / 11 | 15:1 | If posted "15 for 1" (= 14:1): 16.6667% | 1/9 = 11.1111% | [MD-C][STW-R §23][WOO-HE] |
| CE | C&E | 2, 3, 12 pay 3:1; 11 pays 7:1, on the whole bet (= half on Any Craps at 7:1 + half on Yo at 15:1) | | | 1/9 = 11.1111% | [STW-R §24][WIKI][HAR-PA] |
| HORN, $4 unit | | Four equal parts on 2, 3, 11, 12. Net on the whole bet: 2 or 12 = +27/4; 3 or 11 = +3/1 | | "for 1" payouts: 16.6667% | 1/8 = 12.5000% | [STW-R §25][MD-CL][WIKI] |
| HORN_HIGH_X, $5 unit | | Horn plus an extra unit on X [MD-CL][WIKI] | | | X = 2 or 12: 23/180 = 12.7778%; X = 3 or 11: 11/90 = 12.2222% | |
| WORLD, $5 unit | Whirl | Horn ×4 plus Any 7 ×1 [MD-CL]. Net: 2/12 +26:5, 3/11 +11:5, 7 = push | | | 2/15 = 13.3333% | [WIKI][MD-C] |
| HOP_EASY | Hop a-b, a≠b | That exact non-pair, either order, including the 7 combinations | 15:1 | 15 for 1 → 16.67% | 1/9 = 11.1111% | [MD-CL][STW-R §28] |
| HOP_HARD | Hop a-a | That exact pair | 30:1 | 30 for 1 → 16.67% | 5/36 = 13.8889% | [MD-CL][STW-R §28] |
| HI_LO (math only) | | 2 or 12 | Single wager at 15:1 on the whole bet → 1/9 = 11.1111%. Split as two halves each at 30:1 → net 29:2 on the whole → 5/36 = 13.8889% | | see Pays | |
| CRAPS_3WAY (math only) | Three-way craps (NOT an alias of Any Craps) | 1 unit each on 2, 3, 12 at 30/15/30:1. Net per 3 units: 2 or 12 = +28, 3 = +13 | | | 7/54 = 12.963% | |

- **Pay ranges seen:** 2/12 and hard hops 29–33:1; 3/11 and easy hops 14–16:1. HE runs from 16.67% down to 5.56%. In the US, "usually the payoff odds are the lower ones" [WOO-B][WOO-HE].
- **Interblock horn:** split equally among 2, 3, 11, 12. Win = (bet/4 × payout) − 3·bet/4. Example: $100 horn, roll 6-6 → +$675 [IB-WA]. The formula text is garbled in the source PDF; the arithmetic was verified.
- **Maryland anomaly:** MD-C §5.A(23) also lists Any Seven at "26 to 5" as option (b). As written, that gives the player a +1/30 = +3.33% edge. It is likely a drafting artifact; do not implement it [MD-C][UNVERIFIED].

**Net per unit by total**

| Bet | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Field, 2:1 on both | +2 | +1 | +1 | −1 | −1 | −1 | −1 | +1 | +1 | +1 | +2 (or +3) |
| Any 7 | −1 | −1 | −1 | −1 | −1 | +4 | −1 | −1 | −1 | −1 | −1 |
| Any Craps | +7 | +7 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | +7 |
| C&E | +3 | +3 | −1 | −1 | −1 | −1 | −1 | −1 | −1 | +7 | +3 |
| Horn, per 4 units | +27 | +12 | −4 | −4 | −4 | −4 | −4 | −4 | −4 | +12 | +27 |
| World, per 5 units | +26 | +11 | −5 | −5 | −5 | 0 | −5 | −5 | −5 | +11 | +26 |

**Machine-only features (off in a "standard" engine profile):**
- Shoot to Win "Power Odds": random boosted pays on props and hardways [STW-R §34].
  - Any 7: 6:1 or 8:1. Any Craps / C: 10:1 or 14:1.
  - E, easy hops, horn 3/11: 22:1 or 30:1. Horn 2/12, hard hops: 45:1 or 60:1.
  - C&E: 4:1 or 6:1 on 2/3/12; 10:1 or 14:1 on 11.
  - Hardways: 4/10 at 10:1 or 14:1; 6/8 at 13:1 or 18:1.
- Interblock Big/Small bets, and Easy Craps Low/High Field [IB-WA].
- Side bets: Hot Shooter [STW-R §33], Lucky Roller [STW-O][IB-WA], Lucky Shooter [IB-WA].

---

## 8. Crapless (Never Ever Craps): every difference

| Item | Rule | Sources |
|---|---|---|
| Come-out | Only 7 wins. 2, 3, 4, 5, 6, 8, 9, 10, 11, 12 all become points. No come-out losses; 11 is a point | [WOO-CL][MD-CL][IB-WA] |
| Come | Same: 7 on the first roll wins; any other number travels | [MD-CL][IB-WA][CROWN-CL] |
| DP / DC | **Not offered.** A different patented variant exists: "No-crap craps: crapless craps done right" (US 7,134,660, Ethier, granted 2006, lapsed 2010). It groups 2-or-3 and 11-or-12 as points, and its DP pays 1:2 after point 11-or-12. Not found on any bubble machine | [WOO-CL][IB-WA][LVA-CL][MD-CL][PAT] |
| Odds | 6:1 on 2/12, 3:1 on 3/11, standard elsewhere. Limits: Crown 1× unless a higher amount is posted; Maryland up to 100×; Interblock configurable; LVA "most allow only 2X" [UNVERIFIED] | [MD-CL][CROWN-CL][WOO-CL][IB-WA][LVA-CL] |
| Place | 2/12: 11:2 (Maryland, WoO) or "25 to 5" = 5:1 (Maryland, Crown). 3/11: 11:4 (Maryland, WoO) or 13:5 (Maryland, Crown). Others standard | [MD-CL][CROWN-CL][WOO-CL] |
| Buy | All ten numbers at true odds, 5% commission. Maryland: up front ("up to 5 percent") or win-only. Crown: up front, refundable if removed. Interblock: up-front pop-up where approved. WoO lists both methods ("One reader claims they only charge the commission on wins in Mississippi") | [MD-CL][CROWN-CL][IB-WA][WOO-CL] |
| Lay / place-to-lose | Not in Interblock or Maryland crapless; rare live | [IB-WA][MD-CL][WOO-CL] |
| Big 6/8 | Not in Interblock or Maryland crapless; 1:1 at Crown | [IB-WA][MD-CL][CROWN-CL] |
| Field, hardways, props | Unchanged. Maryland Field 2:1/2:1; Crown Field pays 3:1 on 12 | [MD-CL][CROWN-CL] |
| Come-out defaults | Place, Buy, Come odds inactive unless called on. Maryland also makes hardways inactive | [CROWN-CL][MD-CL] |
| Pass HE | 373/6930 = 5.3824%; per roll 1.2934% | |
| Pace | 4.1615 rolls per decision; 7.8979 rolls per shooter | |
| Availability | Interblock Crapless Craps electronic table game (GV6.0+) [IB-WA]. Mohegan Sun, Interblock, $5 minimum, June 2026 [G3]. Live: Stratosphere and Detroit per WoO (undated) [WOO-CL][UNVERIFIED as current]. Shoot to Win has no crapless variant [STW-R] | |

---

## 9. Claim check: buy 4/10, place 6/8 on crapless

The claim: "On crapless setups, buying the 4 and 10 provides a higher payout than placing them due to how the 5% commission is structured, while placing the 6 and 8 remains more advantageous."

| N | Place pays → HE | Buy, commission on win: net pays → HE | Buy, commission up front: HE | Better when commission on win | Better when commission up front |
|---|---|---|---|---|---|
| 4/10 | 1.80 → 6.667% | 1.95 → 1.667% | 4.762% (5% per bet) | **Buy** | **Buy** |
| 5/9 | 1.40 → 4.000% | 1.45 → 2.000% | 4.762% | **Buy** | **Place** |
| 6/8 | 1.1667 → 1.515% | 1.15 → 2.273% | 4.762% | **Place** | **Place** |
| 2/12 | 5.5 → 7.143% (5:1 version: 14.29%) | 5.95 → 0.714% | 4.762% | **Buy** | **Buy** |
| 3/11 | 2.75 → 6.25% (13:5 version: 10%) | 2.95 → 1.25% | 4.762% | **Buy** | **Buy** |

**Verdict: TRUE for 4/10 and 6/8 under both commission methods, at an exact 5% commission (penny-exact machine pays). It is not specific to crapless; the numbers are identical in traditional craps.**
- On 6/8 the buy even pays less per win (1.15 vs 1.1667).
- On 5/9 the answer depends on the commission method.
- On 2/12 and 3/11, buying always wins, under either place pay schedule.
- **Rules of thumb:**
  - A win-only buy beats a place bet when 0.05 × P(win) < place HE.
  - An up-front buy beats a place bet when place HE > 5% per stake, i.e. only on 2, 3, 4, 10, 11, 12.
- **Live flat-dollar commissions can reverse it at small stakes.** With a $1 commission, a 4/10 buy beats the place bet only when the buy is over $15 (up front; $15 ties) or over $5 (on win; $5 ties). Example: a $10 buy with $1 up front costs 10% vs 6.667% for the place bet. See §5.6.
- **Machines:** Interblock GV6.5 charges commission up front where approved [IB-WA], so the "up front" column applies to Interblock crapless. Shoot to Win's Washington sheet charges on win, but it has no crapless variant [STW-R].

---

## 10. Payout granularity and rounding

**Live tables**
- Casinos "always keep the change", described as "the universal casino policy of rounding payoffs down" (in a blackjack context) [LVA-RND].
- Commissions are "rounded down to the nearest whole dollar amount" [HAR-PA].
- So bet in the exact units listed in §§3 and 5. Example: $5 placed on the 6 is paid $5, an HE of 1/11 = 9.09%.

**Electronic machines: penny-exact pays are corroborated by player reports, but no regulator or rules text states them.**
- Player reports:
  - "pays true odds on every bet down to the penny" (2013) [VV].
  - "u get paid the right odds even if placing the 6 for only $1" (2016) [WOV-1].
  - Two $3 place-to-lose bets on 6/8 "pay $2.40" (2025) [WOV-2].
  - "a $50 Buy Bet would pay $72.50" (2021) [WOV-2].
- Shoot to Win rules state commissions as an exact 5%, with no rounding clause [STW-R].
- How sub-cent amounts are rounded is **not documented**.
- **Engine parameters:**
  - `payRounding` ∈ {exact, floor, halfUp}, applied to each gross win.
  - `commissionRounding` ∈ {exact, floor, halfUp}, applied to each commission.
  - A unit: $0.01 on machines, $1 live.
  - Suggested default: floor for both, mirroring the live convention [UNVERIFIED for machines].
  - Flooring a payout favors the house. Flooring a commission favors the player.
- Interblock's "Show Winnings" option displays the possible win per bet. Use it to measure rounding on a real machine [IB-WA].
- **With whole-dollar wagers, sub-cent amounts arise only for:**
  - Place 6/8 (7:6) not in $6 multiples.
  - Place-to-lose 4/10 (5:11) and 5/9 (5:8).
  - Lay bets and lay odds paying 2:3, 5:6, 1:6 or 1:3 whose win is not a whole cent.
  - 5%-of-win lay commissions when the win is not a multiple of $0.20.
- **Never produce sub-cent amounts:** place 4/5/9/10, crapless place 2/3/11/12, take odds, buy wins, 5%-of-bet buy commissions, place-to-lose 6/8 (4:5), field, props, hardways, and horn/horn-high/world splits.

| Example | Exact | Floor to cent | Half-up to cent | HE |
|---|---|---|---|---|
| $5 place 6 | 5.8333 | 5.83 | 5.83 | 17/1100 = 1.5455% either way (exact 1/66 = 1.5152%; live $5 pay: 9.09%) |
| $1 place 6 | 1.1667 | 1.16 → 1/55 = 1.818% | 1.17 → 3/220 = 1.364% | exact 1.515% |
| $10 place 8 | 11.6667 | 11.66 → 17/1100 = 1.5455% | 11.67 → 3/200 = 1.500% | exact 1.515% |
| $1 lay 4, commission on win (gross win 0.50, commission 0.025) | net 0.475 | Rounding the NET: 0.47 → 1/50 = 2.000%. Rounding the COMMISSION (0.02): net 0.48 → 1/75 = 1.333% | Rounding the NET: 0.48 → 1.333%. Rounding the COMMISSION (0.03): net 0.47 → 2.000% | exact 1/60 = 1.667% |
| $1 lay odds on 6/8 | 0.8333 | 0.83 → 1/550 = 0.182% | 0.83 → 0.182% | exact 0% |

**Rejected claim:** a simulator vendor says bubble machines "typically pay 6-for-5" on place 6/8, "which raises the edge to about 2.78%" [CRAPSEE].
- The regulator-approved Shoot to Win rules say 7:6 [STW-R §17].
- The vendor's 2.78% fits neither reading: 6:5 net is 0% HE, and "6 for 5" (net 1:5) is 45.45% HE.
- Do not use it.

---

## 11. Engine configuration flags derived from the sources

| Flag | Live (typical; source) | Shoot to Win, Washington rules | Interblock (GV6.x) |
|---|---|---|---|
| maxOdds | 3-4-5× (6× lay), "most casinos" [WOO-B]; Maryland up to 100× | 2× all points; product configurable 2×–100× [STW-O] | Configurable; pop-up multipliers |
| layOddsCap | Win-based [WOO-B][MD-C] | DP: lay amount ≤ 2× flat; DC: win-based (inconsistent) | ? |
| dontPassRemovableAfterPoint | Yes; no re-bet or increase [HAR-PA][MD-C] | **No** [STW-R §11e] | Yes, no re-bet until the next cycle (text conflicts with its contract-bet table) |
| putBetsAllowed | Casino-specific | No (implied) | No |
| Place/Buy on come-out | OFF, toggle | Auto OFF; auto ON at the point | New Place/Buy auto OFF after a 7-out; toggle |
| Come odds on come-out | OFF; returned if the Come bet is decided | Auto OFF | Toggle (Set bets Off) |
| DC odds and Lay on come-out | ON | ON (not in the auto-off list) | Toggle |
| Place-to-lose on come-out | ON per WoO (unsure) / OFF per Maryland | ON (not in the auto-off list) | Not offered |
| Hardways on come-out | ON (Las Vegas, Pennsylvania) / OFF (Atlantic City, Maryland) | Auto OFF | Toggle; default undocumented |
| Big 6/8 on come-out | ON ("always work") [WIKI] | Auto OFF | ? |
| Off-button scope | Per bet, verbal | Place, Buy, place-to-lose, Lay, Hardways [STW-O] | Place, Lay, Buy, Odds, Hardways [IB-WA] |
| OFF bets and credit | n/a | "inactive and are not bet" [STW-O] | Still debit the Playable meter [IB-WA] |
| Buy commission | 5% of bet. At placement (Harrah's Philadelphia: rounded down, $20 minimum, returned if removed, re-paid per win) or on win only at some casinos, esp. 4/10 [WOO-B] | 5% of bet, deducted from the win (operator-configurable [INTG]) | Up front via pop-up (GV6.5) |
| Lay commission | 5% of win, at placement (Harrah's Philadelphia) or on win; Maryland cap: up to 5% of amount wagered | 5% of win, deducted from the win | Up front via pop-up |
| commissionRounding | Down to whole $ [HAR-PA] | None stated [UNVERIFIED] | ? |
| Field 2 / 12 | 2:1 / 3:1 most Las Vegas; 3:1 / 2:1 Reno; some 2:1 / 2:1 [WOO-B] | 2:1 / 2:1 | 2:1 / 2:1 (EL602: 3:1 on 12) |
| Pay granularity | Whole chips, round down [LVA-RND] | Cents (player reports; brand not named) [UNVERIFIED] | Cents (player reports; brand not named) [UNVERIFIED] |
| Winning bets stay up | Varies | Yes, including one-roll bets [STW-R §29–32] | "Keep Bets On" option (not in all jurisdictions) |
| Variants available | — | Craps | Craps, Crapless, Easy Craps |

---

## 12. Sources

| Key | URL |
|---|---|
| WOO-B | https://wizardofodds.com/games/craps/basics/ |
| WOO-HE | https://wizardofodds.com/games/craps/appendix/2/ |
| WOO-A1 | https://wizardofodds.com/games/craps/appendix/1/ |
| WOO-CL | https://wizardofodds.com/games/crapless-craps/ |
| IB-WA | https://wsgc.wa.gov/sites/default/files/2025-02/Craps_Crapless_Craps_Easy_Craps_game_description_Washington-specific_v2.5.1_0.pdf (Interblock game description v2.5.1) |
| STW-R | https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf |
| STW-O | https://wsgc.wa.gov/sites/default/files/2025-04/3195%20Craps%20Shoot%20to%20Win%20ETG%20Approval%20Letter%20signed_0.pdf (Interblock "Shoot To Win Craps Lucky Roll" overview) |
| INTG | https://www.intergameonline.com/casino/news/aruze-updates-shoot-to-win-craps |
| MD-C | https://www.mdgaming.com/wp-content/uploads/2026/04/Craps-Standard-Rules-Version-1.5-accessible.pdf |
| MD-CL | https://www.mdgaming.com/wp-content/uploads/2026/04/Crapless-Craps-Standard-Rules-Version-1.1-accessible.pdf |
| CROWN-CL | https://www.crownperth.com.au/getmedia/2f173189-0e81-4059-893b-ff3e45a8f128/crown-perth-gaming-crapless-craps-rules.pdf |
| HAR-PA | https://www.caesars.com/content/dam/ccr/Gaming/tableGames/Craps-RackCard-Philly.pdf |
| WIKI | https://en.wikipedia.org/wiki/Craps |
| LVA-CL | https://www.lasvegasadvisor.com/question/crapless-craps-overview/ |
| LVA-RENO | https://www.lasvegasadvisor.com/question/reno-dont-bets/ |
| LVA-RND | https://www.lasvegasadvisor.com/question/rounding-down-6-5-blackjack/ |
| VV | https://www.casino.org/vitalvegas/the-casino-game-were-loving-right-now-shoot-to-win-craps/ |
| WOV-1 | https://wizardofvegas.com/forum/gambling/craps/24510-bubble-craps-in-vegas/ |
| WOV-2 | https://wizardofvegas.com/forum/gambling/craps/36634-place-to-lose-on-bubble-craps/ |
| WOV-3 | https://wizardofvegas.com/forum/gambling/craps/28259-is-bubble-crapstaking-over/ |
| GGB | https://ggbmagazine.com/article/players-sue-interblock-florida-casino-over-etg |
| G3 | https://g3newswire.com/interblock-installs-crapless-craps-at-mohegan-sun/ |
| PAT | https://patents.google.com/patent/US7134660 |
| CRAPSEE (unreliable; cited only to reject) | https://v3.crapsee.com/bubble-craps-strategy |

### Critical Files for Implementation
The repo is empty. These are suggested paths only; none exist yet:
- /Users/jameslerner/bubble craps simulator/craps-simulator/spec/rules-wagers.md
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/bets.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/payouts.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/tableConfig.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/test/houseEdge.test.ts