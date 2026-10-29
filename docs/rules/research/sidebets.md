# Side bets on bubble and electronic craps machines: rules and exact house edges (verified revision)

**How this was checked.** I re-derived every probability and house edge (HE) independently, using exact rational arithmetic in Python `fractions`. Methods by bet:
- **Lucky Shooter:** dynamic programming (DP) over the set of numbers already hit.
- **All Small / All Tall / Make 'Em All:** inclusion–exclusion.
- **Hot Shooter:** Markov chain over shooter state, run to 400 rolls (remaining tail < 3e-26).
- **Fire Bet:** DP over the set of points made.
- **Hot Roller:** DP over all 2^14 sets of dice combinations rolled.
- **Make 'Em All Progressive:** DP over subsets of the ten numbers.

Every number in the original section reproduced. Corrections and additions are marked **CORRECTED** or **ADDED**. Where Wizard of Odds publishes a figure, it matches; Wizard has no Lucky Shooter analysis.

**How to read the numbers**
- **Payout units:** "X for 1" means X is returned including the stake, which is (X−1) to 1.
- **Dice ways (out of 36):** 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:5, 9:4, 10:3, 11:2, 12:1.
- **House edge:** expected loss ÷ initial wager, carried through to the final resolution.
  - A push that *ends* the bet counts as a resolved zero (Hot Shooter at 8–15 rolls).
  - A push that leaves the bet *working* is not a resolution (Lucky Shooter on a come-out 7 or 11). For that bet the per-come-out-roll edge, with the push counted as zero, is also given.

## 1. Which machines carry which side bets

| Product (maker) | Format | Side bets | Key machine rules | Sources |
|---|---|---|---|---|
| Interblock heads-up and stadium craps. Hardware: Diamond Dice / Big Dice / Ministar Dice generators with EGT terminals; Universal Cabinet with Micro Dice; Starbar/Bartop "with internal RNG or connected to a mechanical or live external generator" | Craps; Crapless (GV6.0+); Easy Craps (GV6.0+) | **Lucky Shooter** (defined for standard Craps only); **Lucky Roller** (software 5.123.0.0+, all three variants) | **Minimum check:** the round will not start until bets are valid: "BETS ARE NOT VALID YET! – Must bet N credits more!" OFF bets don't satisfy it, but "All placed bets decrease the Playable credit meter regardless of them being set to on or off".<br>**Auto-OFF:** after a 7-out, Place/Buy wagers are set OFF automatically until the player taps Set Bets On; Lay is not. Set Bets Off covers Place, Lay, Buy, Odds and Hardways.<br>**Lay:** standard Craps only. Buy/Place are "excluding bets" with Lay.<br>**GV6.5 commission:** "specified Buy/Lay bets are only possible with added upfront commission fee". Example pop-up for a $2 Lay on 4: "Pay $0.05 commission for: 1 to 2 odds?" (5% of the win).<br>**Field:** 12 pays triple only with paytable EL602.<br>**Paytables:** per "jurisdictionally approved par sheets". | [Interblock WA game description v2.5.1](https://wsgc.wa.gov/sites/default/files/2025-02/Craps_Crapless_Craps_Easy_Craps_game_description_Washington-specific_v2.5.1_0.pdf), [Interblock Lucky Shooter doc v1.5.1](https://wsgc.wa.gov/sites/default/files/2024-03/Lucky%20Shooter%20Special%20Bet%20Description_WA-specific_v1.5.1.pdf) |
| Shoot To Win Craps Lucky Roll (Aruze Gaming; Interblock bought Aruze's electronic table game line in July 2023) | Dome with two 88 mm RFID dice on a shaker. 8 player stations; one center unit supports up to 50. The designated shooter presses a button; dice shoot automatically on timeout. | **Hot Shooter Jackpot (HSJ)**, **Lucky Roller**, **Power Odds** — each one configurable | **Screen:** shows MIN/MAX TOTAL BET.<br>**OFF chips:** "do not consume a player's credit and do not contribute to the minimum bet".<br>**Withdrawal:** wagers can be withdrawn "excluding special games"; Pass/Come cannot be withdrawn after a point.<br>**Odds limit:** 2x–100x, set by the casino.<br>**Clearwater (WA) install:**<br>• HSJ needs 3 credits on the main game first; HSJ limits $1–$1,000.<br>• Lay vig is 5% of the win, deducted from the win. Buy vig is 5% of the bet, deducted from the win.<br>• Place-to-Lose pays 5:11 / 5:8 / 4:5.<br>• At the come-out, carried-over Come Odds, Place, Buy, Hardways and Big 6/8 switch OFF automatically. Lay and Place-to-Lose are not on that list.<br>• 2x odds; Field pays 2 to 1 on both 2 and 12. | [STW overview (in WSGC approval packet)](https://wsgc.wa.gov/sites/default/files/2025-04/3195%20Craps%20Shoot%20to%20Win%20ETG%20Approval%20Letter%20signed_0.pdf), [Clearwater rules](https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf), [GGRAsia (acquisition)](https://www.ggrasia.com/interblock-to-acquire-aruze-gamings-etg-assets/) |
| Roll To Win Craps (Aruze, now Interblock) | 10-terminal LED table — **not a bubble.** ETG mode uses virtual dice whose "results ... are determined by Software RNG". DETG mode: players throw real dice and the dealer enters the result. | HSJ, Lucky Roller, Power Odds. Galaxy Bonus Craps was added (press release, 3 Mar 2022). | Same special-game text as Shoot To Win. The LED roll counter "resets upon a 7 Out". | [RTW overview](https://wsgc.wa.gov/sites/default/files/2025-02/DESC_RollToWinCraps_NO_ODDS_WA_Overview_v1.1.pdf), [Galaxy press release](https://ir.galaxygaming.com/news-events/press-releases/detail/544/aruze-gaming-and-galaxy-gaming-partner-to-launch-bonus) |
| **ADDED:** Gaming Arts Casino Wizard (VIP) | Video craps, no physical dice | "Super Any Craps" (vegasadvantage). Gaming Arts also lists "Super 7/11 for Craps". [Rules and paytable UNVERIFIED] | — | [vegasadvantage](https://vegasadvantage.com/electronic-table-games/), [Indian Gaming](https://www.indiangaming.com/gaming-arts-casino-wizard-vip/) |

**Las Vegas footprint** ([vegasadvantage](https://vegasadvantage.com/electronic-table-games/))
- Interblock is the most common heads-up maker. Heads-up craps is available "on Casino Wizard machines in video form and Interblock machines with dice bubbles".
- Aruze Shoot To Win machines "dominate the multiplayer electronic craps selection". Photo captions show Circa and Downtown Grand.
- **Lucky Shooter's decline:** "When these electronic table games first rolled out, most had a Lucky Shooter side bet. It has been mostly replaced by Lucky Roller."
- **Lucky Roller's reach:** "Lucky Roller is the same side bet found on many heads-up craps and crapless installations, as well as some hybrid tables."
- **CORRECTED (stadium):** the source says "The Lucky Shooter or Lucky Roller side bet is available on most stadium craps games." It does not say Lucky Shooter specifically.
- **CORRECTED (HSJ):** the newest Shoot To Win versions "normally offer Lucky Roller and Hot Shooter Jackpot side bets". No source says HSJ appears *only* on multiplayer machines. It is documented only in Shoot To Win and Roll To Win materials, both multiplayer.
- **Buy commission:** "some installations now require a 5% commission to be paid upfront on all Buy wagers. So, even losing wagers pay a commission." On crapless machines: "Most require a 5% commission to be paid upfront on all Buy wagers."
- **For the coaching layer:** a Las Vegas bubble player will most often meet:
  - Lucky Roller, on Interblock heads-up, crapless and stadium games;
  - HSJ + Lucky Roller + Power Odds, on Shoot To Win.

  Lucky Shooter is a legacy bet on most Vegas heads-up machines. [Machine-by-machine prevalence UNVERIFIED]

**Regulators**
- **Pennsylvania:** Lucky Shooter only "on a fully automated electronic gaming table" (§623c.2(a)). HSJ on a "fully automated electronic gaming table or a hybrid gaming table" (§623c.4(a)) ([PA ch. 623c](https://pacodeandbulletin.gov/secure/pacode/data/058/chapter623c/058_0623c.pdf)).
- **Maryland — ADDED:** Lucky Shooter is listed among wagers "authorized in the games of craps and mini-craps" (Ch.3 A(45)). Maryland does not limit it to electronic tables ([MD](https://mdgaming.com/wp-content/uploads/2024/06/Craps-Standard-Rules-Version-1.5.pdf)).
- **New Jersey** (proposed rule texts): Fire Bet, Bonus Craps (All Small, All Tall, "All or Nothing at All") and Hot Roller move to "the game of craps" only; the texts strike "mini-craps and automated craps". The Fire Bet may not be offered at a table that offers Hot Roller ([NJ Bonus Craps](https://nj.gov/oag/ge/docs/TempRegs/bonuscrapstext.pdf), [NJ Hot Roller](https://nj.gov/oag/ge/docs/TempRegs/hotrollercraps.PDF)). [Adoption status UNVERIFIED]
- **Live-table bets:** I found no bubble or electronic machine offering Fire Bet, Hot Roller, Repeater, Ride the Line, Different Doubles, Replay, Sharp Shooter or the Galaxy progressives.

## 2. Lucky Shooter (Interblock special bet; PA §623c.2; MD Ch.3 A(45) and Ch.5 J)

**Identification: CONFIRMED.**
- LUCKY SHOOTER® is Interblock's registered special bet. Its layout reads "ALL HITS + POINT / POINT + 5…2 HITS".
- PA and MD regulate the same bet with identical paytables A–D.
- Rivers Philadelphia's Interblock brochure describes the same rules.
- Three independent primary sources agree on how it settles.

**When it can be placed and locked**

| Source | Placement | Limits | Lock |
|---|---|---|---|
| Interblock | "can only be placed before a Point has been established" | 1–100 **credits** (not dollars) | Becomes a contract bet (no reduce, increase or remove) once the point is set. Removal before the point is implied but [UNVERIFIED]. |
| PA | Before "the come out roll to establish a point" | Operator sets | — |
| MD | "may only be made prior to the come out roll of a new shooter" | Posted table limits | — |
| Interblock setting "Puck can be reset = 2" | A player with no puck-related bets can flip the puck to OFF and place a new Lucky Shooter mid-cycle, after the previous one has resolved. Puck-related bets: Pass, Don't Pass, Come, Don't Come, Come/Don't Come points, Lucky Shooter. | — | — |

**Settlement (engine spec)**
1. **Come-out roll:**
   - 2, 3 or 12: the bet loses.
   - 7 or 11: push, and the bet stays working. PA/MD list this as "1st roll of 7 or 11: 1 for 1"; Interblock says "The bet stays on the betting field".
   - 4, 5, 6, 8, 9 or 10: that number becomes the Lucky Shooter point P.
2. **Hits:** each later roll that is a box number not yet rolled, and not P, adds one hit (k+1).
3. **Settlement:** any other roll settles the bet with k hits. That means 2, 3, 7, 11, 12, P, or a repeat of a number already hit.
   - **CORRECTED citation.** The repeat rule comes from:
     - PA §623c.2(d)(3): "If any number other than one of the remaining, not already rolled numbers is rolled, the Lucky Shooter wager shall then be settled".
     - PA example (i): point 9, then 10, 4, 6, 10 → paid for 3 points.
     - MD: the bet "ends when any number other than one of the remaining unique point totals ... are rolled".
     - Rivers: "in any order without repeating".
   - PA example (iii) (6, 9, 6 → lose) shows only a point re-roll before 2 hits; it does not show the repeat rule.
   - Interblock's own text names 2/3/12/7/11 and P as ending the bet and says nothing about repeats. [Interblock repeat handling UNVERIFIED; default to PA/MD]
4. **After 5 hits:** the next roll settles it. If it is P, the top award pays; anything else pays the 5-hit award. Sources: PA example (ii); Interblock's "re-rolled in the 6th roll".
5. **Losing counts:** 0 or 1 hits always lose. 2 hits lose on paytables A and C.

**Exact probabilities (verified)**

| Outcome | P per come-out roll | P per resolved wager | About 1 in |
|---|---|---|---|
| 7/11 push (bet stays) | 2/9 | — | — |
| 2/3/12 loss | 1/9 | 1/7 | 7.0 |
| Point, then 0 hits | 97/324 | 0.384921 | 2.6 |
| 1 hit | 67/324 | 0.265873 | 3.8 |
| 2 hits | 7583/69984 | 0.139311 | 7.2 |
| 3 hits | 8597/209952 | 0.052647 | 19.0 |
| 4 hits | 175/17496 | 0.012860 | 77.8 |
| 5 hits, 6th roll not P | 125/118098 | 0.0013609 | 735 |
| 5 hits + P on the 6th roll | 125/944784 | 0.00017011 | 5,879 |

- A resolved wager takes 474275/163296 = 2.9044 rolls on average, of which 9/7 are come-out rolls.

**Paytables (PA §623c.2(e) = MD Ch.5 J; all "for 1")**

| Paytable | 5 hits + P | 5 hits | 4 | 3 | 2 | HE per resolved wager (exact) | HE per come-out roll |
|---|---|---|---|---|---|---|---|
| A | 1000 | 150 | 15 | 5 | loses | 16.9630% (249299/1469664) | 13.1934% |
| B | 500 | 100 | 10 | 4 | 2 | 16.1050% (118345/734832) | 12.5261% |
| C | 1000 | 150 | 20 | 5 | loses | 10.5330% (154799/1469664) | 8.1923% |
| D | 500 | 100 | 10 | 5 | 2 | **10.8404%** (159317/1469664) | 8.4314% |

- **Which paytable is where:**
  - Interblock's own screenshots show D.
  - The Rivers Philadelphia (PA) brochure screenshot appears to show A in to-1 form (999/149/14/4 to 1). [UNVERIFIED — screenshot illegible]
  - Las Vegas machine paytables: [UNVERIFIED]. Default to D and make it configurable.
- **CORRECTED — third-party paytable error.** bubble-craps.com shows an "example" table of 1000 / 150 / 20 / 5 / 2 / 1 for 1, for 5+P / 5 / 4 / 3 / 2 / 1 hits ([bubble-craps.com](https://www.bubble-craps.com/discovering-the-lucky-shooter-feature-in-bubble-craps-your-ultimate-guide/)).
  - It matches no regulated paytable.
  - The whole table would give the *player* +43.92% per resolved wager (+34.16% per come-out roll). Adding only the "1 hit = 1 for 1" line to D would give +15.75%.
  - Its quoted "approximately 12.53%" is exactly Paytable B's per-come-out-roll edge (12.526%): a real figure attached to the wrong table.
- **Coaching trap:** reading Interblock's "for 1" as "to 1" makes Paytable D look like a +9.79% player bet.
- **Crapless and Easy Craps:** Interblock screenshots show the Lucky Shooter panel on Crapless and Easy Craps tables. But Lucky Shooter is defined as "Craps specific", with Point = 4, 5, 6, 8, 9, 10. What happens when 2, 3, 11 or 12 is the point is undefined. [UNVERIFIED]

## 3. All Small / All Tall / Make 'Em All

**Names for the same bet**

| Name | Where |
|---|---|
| All Small / All Tall / Make 'Em All | Galaxy "Bonus Craps" |
| "All or Nothing at All" (the All bet) | NJ, MD. PA §623c.3(b) renamed it "Make 'Em All". |
| Low Rolls / High Rolls / Roll 'Em All | Interblock and Shoot To Win / Roll To Win "Lucky Roller" |
| Little / Big / All | Nevada "Super Shooter". No maker is named; the wording mirrors Shoot To Win's Lucky Roller text. [UNVERIFIED] |
| Little Ones / Big Ones / Boom or Bust | MD "Dice-Ology" |

**Rules**
- **Win conditions:** All Small wins if 2, 3, 4, 5 and 6 are each rolled before a 7; All Tall is the same for 8–12; the All bet needs all ten.
- Repeated numbers and the order of rolls don't matter.
- Any 7 loses, including a 7 on the come-out roll (Galaxy: "(including on the come-out roll)").
- **Locked once placed:**
  - NJ: cannot be reduced, increased or removed until it wins or any 7.
  - MD: cannot be reduced or increased.
  - Shoot To Win / Roll To Win: special games cannot be withdrawn.
  - Interblock heads-up Lucky Roller: [UNVERIFIED].
- Galaxy lets operators require a Pass or Don't Pass bet to qualify.

**When it can be placed.** The edge is the same whenever the bet is placed, because tracking always starts fresh at placement.

| Product | Timing |
|---|---|
| Galaxy | On the come-out roll after a 7; or when that wager type has no active wagers; or after a win ([Galaxy WA rules](https://wsgc.wa.gov/sites/default/files/2023-11/Bonus%20Craps%20Modification-Progressive.pdf)) |
| NJ | Before a new shooter's come-out. After a win, it cannot be placed again until the next new shooter's come-out. |
| MD Bonus Craps | Before a new shooter's initial come-out |
| MD Dice-Ology | No timing restriction stated. **CORRECTED:** the original grouped MD with new-shooter-only. |
| Interblock Lucky Roller | Only "after a 7 has been rolled or before the first roll in the history cycle". Cannot be placed again after a win until a 7 rolls (Interblock doc, game-flow step 6). |
| Shoot To Win / Roll To Win Lucky Roller | "prior to any roll when there are no active wagers of the same type" |
| NV Super Shooter | "Before any roll, if there are no currently active Super Shooter Craps Side Bet wagers" (wording covers any type) ([NV](https://www.gaming.nv.gov/contentassets/3a632692f87340bf9890a9784fd3f1aa/super-shooter-craps-side-bet.pdf)) |

**Exact probabilities:** P(Small) = P(Tall) = 20049/760760 = 0.0263539; P(All) = 126538525259/24067258815600 = 0.00525770. Wizard's figures are identical.

| Small/Tall payout | HE | All payout | HE |
|---|---|---|---|
| 30 to 1 (31 for 1) | 18.3029% (139241/760760) | 150 to 1 | 20.6087% |
| 31 to 1 | 15.6675% | 155 to 1 (156 for 1) | 17.9798% |
| 33 to 1 (34 for 1) | 10.3967% | 160 to 1 | 15.3510% |
| 34 to 1 (35 for 1) | 7.7613% (59045/760760) | 170 to 1 | 10.0933% |
| 35 to 1 | 5.1259% | 174 to 1 (175 for 1) | 7.9902% |
| — | — | 175 to 1 | 7.4644% |

- Break-even payouts: 36.945 to 1 for Small/Tall, 189.197 to 1 for All.

**Paytables in use**

| Source | Small / Tall / All (to 1) |
|---|---|
| Galaxy PT-FLT-BC-01 | 34 / 34 / 175 |
| Galaxy PT-FLT-BC-02 and -03 (-03 adds a house-paid Dealer Envy of 1x/1x/5x) | 30 / 30 / 150 |
| Wizard of Odds | Small/Tall "usually pay 30 to 1" and All usually 150 to 1; 34 to 1 has been "known" at some tables ([Wizard](https://wizardofodds.com/games/craps/side-bets/bonus-craps/)) |
| PA §623c.3 | 34/34/175 or 30/30/150 |
| MD Bonus Craps and Dice-Ology | A: 34/34/175; B: 30/30/150 |
| NJ (proposed) | 34/34/175 |
| **Interblock Lucky Roller** (screenshot) | **30 / 30 / 155** — the screen shows Low 31, Roll 'Em All 156, High 31 "for 1". **CORRECTED:** the original listed the values in screen order (30/155/30) under a Small/Tall/All header. Read literally, that pays Tall at 155 to 1 (player +311%) and All at 30 to 1. |
| Shoot To Win / Roll To Win Lucky Roller | Low = High; Roll 'Em All is "substantially higher"; actual values per par sheet [UNVERIFIED] |
| NV Super Shooter | Little/Big 30 or 34; All 150, 160 or 175 |

- **CORRECTED:** removed "Galaxy PT-01 (most common)". No source supports it, and Wizard indicates 30/150 is the usual live paytable.

## 4. Hot Shooter Jackpot (Shoot To Win / Roll To Win; PA §623c.4)

**Rules**
- **When it can be placed:**
  - Shoot To Win / Roll To Win / Clearwater: only during the come-out bet time after a 7-out, i.e. for a new shooter.
  - PA §623c.4(c): "prior to the shooter throwing the dice on the come out roll to establish a point", with no 7-out restriction.
  - The edge is identical either way, because the number of rolls from any come-out to the next 7-out has the same distribution.
- **Other rules:**
  - A special game: it cannot be withdrawn.
  - An optional qualifying main-game bet (3 credits at Clearwater); Clearwater limits $1–$1,000.
  - Only the highest band reached is paid.
- **Roll count, in Interblock's words:**
  - Definition: "the total number of rolls that occur from the Come Out Roll after a 7 Out until the next 7 Out".
  - Pays "1 times bet upon the 8th roll and ... 100 times bet upon the 50th roll".
  - The HSJ panel shows "1 ROLL(S)" during the come-out bet time, then "2 ROLL(S) … PLEASE WAIT UNTIL NEXT 7 OUT".
  - Roll To Win's LED counter "resets upon a 7 Out".

| Roll count | Pays (× bet, for 1) | To 1 | Probability (definition A) |
|---|---|---|---|
| 7 or fewer | 0 | loses | 0.57095589 |
| 8–15 | 1× | push | 0.29742455 |
| 16–23 | 3× | 2 to 1 | 0.09130006 |
| 24–31 | 5× | 4 to 1 | 0.02797297 |
| 32–39 | 7× | 6 to 1 | 0.00856620 |
| 40–44 (Minor) | 12× | 11 to 1 | 0.00197622 |
| 45–49 (Major) | 30× | 29 to 1 | 0.00094313 |
| 50 or more (Grand) | 100× | 99 to 1 | 0.00086098 |

- A shooter averages exactly 1671/196 = 8.5255 rolls, counting the come-out through the 7-out.

**House edge by roll-count definition**

| Definition | HE per wager (push = 0) |
|---|---|
| **(A)** Every roll counts, including the first come-out and the 7-out | **9.0740%** (12.915% per non-push decision) |
| (A′) Grand at 51+ (literal reading of Clearwater's "OVER 50 ROLLS") | 9.9029%. **CORRECTED status:** the manufacturer text ("upon the 50th roll") and screen ("50 ROLLS OR MORE") both say 50, so keep 51 only as an edge-case toggle. |
| (B) The 7-out roll is not counted | 21.5608% |
| (C) Neither the first come-out nor the 7-out is counted (literal reading of PA's "after the come out roll … before the next 7 out") | 32.3353% |

- Default to (A). No source says outright whether the 7-out roll itself increments the counter, so keep the definition configurable. [UNVERIFIED]

## 5. Fire Bet (live tables only)

**Rules**
- Placed only before a new shooter's first come-out (NJ, MD).
- Contract: MD says it "may not be removed prior to the throwing of a loser 7".
- Counts unique points the shooter both sets and makes. Repeating a point doesn't add to the count; come-out naturals and craps don't matter.
- Paid once, on the highest count, at the loser 7 (MD).
- **CORRECTED:** some houses may pay immediately when the 6th unique point is made. [UNVERIFIED] This doesn't change the edge.
- MD: minimum $1, maximum $5, in $1 increments.

| Unique points | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Probability | 98/165 = 0.593939 | 78834/302335 = 0.260750 | 0.101275 | 0.033434 | 0.008798 | 0.001640 | 0.000162 |

- P(4 or more) = 0.0106005, about 1 in 94.3.

| Paytable (to 1) | 3 pts | 4 | 5 | 6 | HE |
|---|---|---|---|---|---|
| A (Wizard: most common; = 25/250/1000 for 1; MD Pay Table A) | — | 24 | 249 | 999 | 20.7628% |
| B | — | 10 | 200 | 2000 | 24.8562% |
| C | 6 | 29 | 149 | 299 | 20.7295% |
| MD Pay Table B | — | 39 | 199 | 499 | 23.8869% |

Sources: [Wizard: Fire Bet](https://wizardofodds.com/games/craps/side-bets/fire-bet/), [MD](https://mdgaming.com/wp-content/uploads/2024/06/Craps-Standard-Rules-Version-1.5.pdf).

## 6. Other side bets (none found on bubble or electronic machines)

**Hot Roller** (PA §623c.1; NJ)
- **Placement:** PA: before the come-out. NJ: before a new shooter's come-out.
- **Settlement:** locked; settled at any 7, **including a come-out 7**.
- **Counting:** a number counts when all its unordered dice combinations have been rolled (14 combinations; e.g. 6 = 1-5, 2-4, 3-3).
- **Distribution, 0–6 numbers completed:** 0.7516772, 0.1606832, 0.0562873, 0.0211919, 0.0075283, 0.0022199, 0.0004122.
- **NJ restriction:** not on the same table as the Fire Bet.
- **Paytables (to 1, for 2–6 numbers):**
  - NJ-A 4/10/20/50/200 → 13.1290%
  - NJ-B = PA-A 5/10/20/50/200 → 7.5003% (Wizard: 7.50%)
  - NJ-C = PA-B 5/10/20/50/300 → 3.3782%

**Repeater** (TCS John Huxley "Repeater Bets with Dealer Envy"; Wizard lists the same paytable at Suncoast)
- **Rules:** requires a standard craps wager. Pick one or more numbers from 2–12 (not 7), "at any time if the number chosen has not been tracked". The number must be rolled n times before any 7.
- **Win probability:** (w/(w+6))^n.
- **Paytable → HE:**
  - 2/12 ×2: 40 for 1 → 18.3673% (9/49)
  - 3/11 ×3: 50 → 21.8750% (7/32)
  - 4/10 ×4: 65 → 19.7531% (16/81)
  - 5/9 ×5: 80 → 18.0800%
  - 6/8 ×6: 90 → 20.6209%
- The Dealer Envy is paid by the house ([TCSJH](https://tcsjohnhuxley.com/wp-content/uploads/2023/11/TCSJH_Repeater_Bets_Craps-with-Dealer-Envy-HTP.pdf), [Wizard appendix 5](https://wizardofodds.com/games/craps/appendix/5/)).

**Ride the Line** (Colorado; Wizard, 2017)
- **Rules:** placed before a new shooter. Counts pass-line wins until the 7-out. P(k wins) = (61/110)^k · (49/110).
- **Paytables PT1–PT7 → HE:** 9.2792, 10.2527, 10.2127, 10.6042, 10.5753, **8.5219** (lowest), 9.6485% ([Wizard](https://wizardofodds.com/games/craps/side-bets/ride-the-line/)).

**Different Doubles** (Beau Rivage, Biloxi)
- **Rules:** counts distinct doubles rolled before a 7. P(0–6) = 1/2, 3/11, 3/22, 2/33, 1/44, 1/154, 1/924.
- **Paytable:** 3/4/5/6 doubles pay 4/8/15/100 to 1 → 27.9221% (exactly 43/154) ([Wizard](https://wizardofodds.com/games/craps/side-bets/different-doubles/)).

**"Point Streak"** — no product by this name found in a web search. Nearest matches:
- **Sharp Shooter:** counts points made, repeats included; each established point is made with probability 67/165.
  - Paytable (to 1): 3 pts 5, 4 pts 9, 5 pts 19, 6 pts 29, 7 pts 49, 8 pts 99, 9 pts 199, 10+ pts 299.
  - HE 21.8744% (Wizard: 21.87%).
- **Replay** (Boulder Station, 2010): the same point made 3+ or 4+ times → 24.8064% (Wizard: 24.81%) ([Wizard: Replay](https://wizardofodds.com/games/craps/side-bets/replay/)).
- "Hot Shooter" on machines means the Hot Shooter Jackpot (§4).

**Galaxy progressives**

Common rules:
- Live tables, on the Andromeda jackpot system.
- Fixed $1 wager; pays are "for 1"; the progressive wager is not returned.
- Only the highest event is paid. The Dealer Envy is paid by the house.

Make 'Em All Progressive — each of the ten numbers must be rolled exactly once; the bet is lost on a 7 or any repeat:

| Paytable | Fixed pays (9/8/7/6/5 numbers) | Fixed awards return per $1 | Jackpot odds | Break-even jackpot |
|---|---|---|---|---|
| MEA-01 to -04 | $300/50/10/5/2 | $0.4599 | 1 in 69,968 | $37,791 |
| MEA-05 and -06 | $200/40/10/6/3 | $0.5052 | 1 in 69,968 | $34,622 |

Fired Up — an exact sequence must be rolled. Where two sequences are offered, the first roll picks which one to follow:

| Paytable | Sequence | Fixed pays | Fixed awards return per $1 | Jackpot odds | Break-even jackpot |
|---|---|---|---|---|---|
| FUP-01 and -02 | 6-5-4-3-2 or 8-9-10-11-12 | $300/40/5/1 | $0.5272 | 1 in 251,942 | $119,114 |
| FUP-03 and -04 | 5-4-3-2 | $200/20/2 | $0.4786 | 1 in 69,984 | $36,488 |
| FUP-05 | 8-9-10-11-12 | $1000/100/10/2 | $0.5793 | 1 in 503,885 | $211,989 |
| **ADDED:** FUP-06 | 8-9-10-11-12 | $200/40/6/3 | $0.5177 | 1 in 503,885 | $243,013 |

Source: [Galaxy WA rules](https://wsgc.wa.gov/sites/default/files/2023-11/Bonus%20Craps%20Modification-Progressive.pdf).

## 7. Hop bets and proposition bets on machines

| Bet | Interblock (generic screen) | Shoot To Win (Clearwater) | HE | Power Odds (Shoot To Win / Roll To Win) → edge on a boosted roll |
|---|---|---|---|---|
| Easy hop | 16 for 1 | 15 to 1 | 11.11% | 22 to 1 → +27.8%; 30 to 1 → +72.2% |
| Hard hop | 31 for 1 | 30 to 1 | 13.89% | 45 to 1 → +27.8%; 60 to 1 → +69.4% |
| Horn 2 or 12 (single number) | 31 for 1 | 30 to 1 | 13.89% | 45 / 60 to 1 → +27.8% / +69.4% |
| Horn 3 or 11 (single number); E (11) | 16 for 1 | 15 to 1 | 11.11% | 22 / 30 to 1 → +27.8% / +72.2% |
| Horn, split 4 ways **(ADDED)** | per-number pays | same | 12.50% | per-number boosts |
| Any 7 | 5 for 1 | 4 to 1 | 16.67% | 6 / 8 to 1 → +16.7% / +50.0% |
| Any Craps / C | 8 for 1 | 7 to 1 | 11.11% | 10 / 14 to 1 → +22.2% / +66.7% |
| C&E | 3 to 1 on craps / 7 to 1 on 11 (Rivers: "paid 3 times" / "7 times") | same | 11.11% | (4, 10) to 1 → +16.7%; (6, 14) to 1 → +61.1% |
| Hard 4/10, Hard 6/8 | 8 for 1 / 10 for 1 | 7 to 1 / 9 to 1 | 11.11% / 9.09% | 10 or 14 to 1 / 13 or 18 to 1, "for that roll only" (these are multi-roll bets) |

- **Display wording varies.** Interblock's generic screen uses "for 1". The Rivers Philadelphia Interblock install shows "to 1" (e.g. "4 TO 1 SEVEN", "7 TO 1 ANY CRAPS"). The economics are the same ([Rivers guide](https://philadelphia-rushstreetgaming.cdn.prismic.io/philadelphia-rushstreetgaming/29d50dc1-e5b1-43f0-a1c5-786980ad0bf1_Interblock+Craps+Gaming+Guide.pdf)).
- **Interblock horn formula:** win = (bet/4) × payout − 3·bet/4. **CORRECTED:** the payout must be the to-1 figure. Interblock's own example: a $100 horn bet, 6-6 rolls at 30 to 1 → +$675.
- **Power Odds:**
  - How it works: random, and revealed only after betting closes. Of the two possible boost values, the higher one doubles the base to-1 pay.
  - Why the overall edge can't be computed: how often it triggers is in confidential par sheets.
  - Model for one-roll bets: EV = base EV + Σ P(boost b) × p_win × (boost b − base payout). For hardways, apply it per roll.
  - Example: a hard hop breaks even if a 45-to-1 boost occurs on 1 roll in 3, or a 60-to-1 boost on 1 roll in 6.

## 8. "Low-Investment Hunting" — identification UNSUPPORTED

**Verdict.**
- The phrase gets zero matches in a web search. It appears in no manufacturer, regulator, casino, Wizard of Odds or vegasadvantage source.
- What follows is a hypothesis built from machine mechanics. Present it to the user as a what-if scenario for the strategy lab, not as a known player technique.
- It cannot create an edge: the dice are independent, the side bet's EV is unchanged, and any filler bet only adds cost.

**Premise check**

| Premise | Status |
|---|---|
| Machines enforce a minimum total bet each round | Sourced: Interblock "Must bet N credits more!"; Shoot To Win / Roll To Win "MIN TOTAL BET"; Rivers screens "Min total bet $5 / Max total bet $10,000" |
| Lucky Shooter's own minimum is below that minimum | Sourced: Interblock Lucky Shooter minimum is 1 credit |
| Special bets (Lucky Shooter, Lucky Roller, HSJ) do NOT count toward the minimum | **[UNVERIFIED].** If they count, no filler is needed. If they don't, the filler alone must cover the whole minimum. (The original's "s + L meets the minimum" assumed they count.) |
| The minimum is re-checked every roll, including after Lucky Shooter locks | **[UNVERIFIED].** Interblock says the player "can be required" to add active bets "to meet the conditions for starting the next game round". |
| Lay is the only removable bet that works on the come-out | **CORRECTED — false as stated:**<br>• Interblock: switches OFF only Place/Buy wagered after a 7-out, and lets the player tap Set Bets On. Its doc describes a pop-up when a come-out Place bet wins.<br>• Shoot To Win: switches OFF only carried-over Come Odds, Place, Buy, Hardways and Big 6/8 at the come-out.<br>• Rivers brochure: Place, Buy and Hardways are "inactive on the come out roll".<br>• MD (live-table rules, not machines): Place, Place-to-Lose, Buy and Hardways are inactive unless called on; Lay is active unless called off. |

**Filler cost** (EV per $ per come-out roll; cost per Lucky Shooter wager with L = $4 spread over 9/7 come-out rolls)

| Filler | EV per $ per roll | Cost per Lucky Shooter wager |
|---|---|---|
| Lay 4/10, 5% of win taken from the win (Clearwater) | −0.4167% | **$0.0214** |
| **ADDED:** Place 6/8 switched ON (Interblock, if allowed) | −0.4630% | $0.0238 |
| Lay 4/10, upfront commission (5% of win) refunded on takedown | −0.625% | $0.0321 |
| Lay 4/10, upfront non-refundable, recharged after each lay win (GV6.5-style; refund/recharge behavior [UNVERIFIED]) | 2.5% of L per charge × **15/14** charges per Lucky Shooter wager | **$0.1071** (**CORRECTED** from $0.1214 / 17/14) |
| Lay 5/9 or 6/8, commission on win | −0.5556% / −0.6944% | $0.0286 / $0.0357 |
| Place-to-Lose 4/10, 5/9, 6/8 (5:11, 5:8, 4:5) | −0.7576%, −0.6944%, −0.5556% | $0.0390, $0.0357, $0.0286 |
| **ADDED:** Buy 4/10, 5% of bet charged on win | −0.8333% | $0.0429 |
| Field paying 2× / 3× on 12 | −2.778% | $0.1429 |
| Field paying 2× / 2× (Clearwater; Interblock default) | −5.556% | $0.2857 |
| Don't Pass, removed after the point | −13.889% | $0.7143 |
| Pass Line (cannot be removed after the point) | −1.414% per bet | $0.0727, and the $4 stays locked through the point |

- Where 15/14 comes from: 6/7 (a new lay is needed unless the previous Lucky Shooter ended on 2/3/12 with the lay still up) + 3/14 (expected come-out 7s per Lucky Shooter wager).

**Hypothetical sequence**
1. **At the come-out:** place the Lucky Shooter stake s plus filler L. If special bets don't count toward the minimum, L alone must meet it.
2. **On the roll:**
   - **Point set:** the Lucky Shooter locks; take the filler down, if the minimum-bet re-check allows.
   - **7:** Lucky Shooter pushes and the lay wins; repeat.
   - **11:** push; repeat.
   - **2/3/12:** Lucky Shooter lost; the lay stays up.
   - **Come-out is the laid number:** the lay loses. This is already in the costs above.

**Expected cost per Lucky Shooter wager** = s × HE_LS (per resolved wager) + filler cost.
- **Example:** $1 Lucky Shooter on paytable D + $4 Lay on the 4 with commission on win: $0.1084 + $0.0214 = **$0.130**.
- **Same, upfront non-refundable commission:** $0.1084 + $0.1071 = **$0.216** (**CORRECTED** from $0.230).
- **HSJ variant:** Shoot To Win needs a 3-credit qualifying bet on the main game. A filler is needed for one come-out roll only, and only if HSJ doesn't count toward the minimum [UNVERIFIED]. With a $4 lay: $0.0167 + $1 × 9.074%.
- **Bottom line:**
  - A filler adds about 0.5% of L per Lucky Shooter wager with commission on win, up to about 2.7% of L with upfront non-refundable commission (**CORRECTED** from about 3%).
  - On upfront-commission machines, a Place 6/8 ON filler (about 0.6% of L) is roughly 4.5× cheaper than the lay.

**Caveats**
- **Interblock variants:** Lay exists only in standard Craps. Crapless has Place and Buy; Easy Craps has Place only.
  - **CORRECTED:** the original called the trick "impossible" there. A Place-ON filler would still work, though Lucky Shooter rules are undefined on those variants anyway.
- **Bet-combination limits:**
  - Interblock calls Buy/Place "excluding bets" with Lay, without stating the scope. [Same-number-only UNVERIFIED]
  - Clearwater says Place with Place-to-Lose/Lay, and Buy with Lay/Place-to-Lose, "cannot be placed for the same roll". [Scope UNVERIFIED]
- **OFF bets and credit:** on Interblock heads-up, OFF bets still use Playable credit; on Shoot To Win, OFF chips do not.

## 9. Engine settings to make configurable

| Setting | Options (default first) |
|---|---|
| `payUnit` | for / to (display only; store to-1 internally) |
| `luckyShooter.table` | D / A / B / C |
| `luckyShooter.push711` | true |
| `luckyShooter.repeatEndsBet` | true (PA/MD) / false [Interblock UNVERIFIED] |
| `luckyShooter.placement` | beforePoint (Interblock) / comeOut (PA) / newShooterOnly (MD) |
| `luckyShooter.removableBeforePoint` | true? [UNVERIFIED] |
| `luckyShooter.variants` | standard craps only; disabled on crapless/easy until rules are found |
| `puckReset` | off / on (Interblock "Puck can be reset = 2") |
| `luckyRoller.paytable` | {30,30,155} Interblock / {30,30,150} / {34,34,175} / NV {30 or 34; 150, 160 or 175} |
| `luckyRoller.placement` | after7OrCycleStart (Interblock; no re-bet after a win until a 7) / anyRollIfNoneOfType (Shoot To Win / Roll To Win) / galaxy (come-out after a 7, none active, or after a win) / newShooter (NJ, MD Bonus Craps) |
| `hotShooter.rollCountDef` | A / B / C |
| `hotShooter.grandAt` | 50 / 51 |
| `hotShooter.placement` | comeOutAfterSevenOut (Shoot To Win) / anyComeOut (PA) |
| `hotShooter.qualifyingCredits` | 3 (Clearwater) |
| `lay.vig` | onWinFromWin (5% of win) / upfrontRefundOnTakedown / upfrontNoRefundRechargeOnWin / upfrontPctOfAmountWagered (MD allows up to 5% of the lay amount) |
| `buy.vig` | onWin, 5% of bet (Clearwater) / upfront 5% of bet, non-refundable (Interblock GV6.5; vegasadvantage) |
| `minTotal.validation` | perRound / onPlacement |
| `minTotal.countOffBets` | false |
| `minTotal.countSpecialBets` | ? [UNVERIFIED] |
| `offBets.consumeCredit` | true (Interblock heads-up) / false (Shoot To Win / Roll To Win) |
| `comeOut.autoOff` | interblock (Place/Buy wagered after a 7-out; player may set ON) / stw (carried-over Come Odds, Place, Buy, Hardways, Big 6/8) / liveDefault (Place, Buy, Hardways, Place-to-Lose off; Lay on) |
| `field.twelve` | 2x / 3x (Interblock paytable EL602) |
| `powerOdds.enabled`, `powerOdds.distribution` | per bet spot {base, boostLo, boostHi} with trigger probabilities (unknown; user-set) |
| `fireBet.enabledOnMachine` | false |
| `fireBet.payOnSixImmediately` | false (MD) / true |

**Unit-test targets for the Monte Carlo lab** (exact fractions):
- Lucky Shooter HE per resolved wager: A 249299/1469664, B 118345/734832, C 154799/1469664, D 159317/1469664.
- P(Small) = P(Tall) = 20049/760760.
- P(All) = 126538525259/24067258815600.
- Mean shooter length: 1671/196 rolls.
- Mean rolls per resolved Lucky Shooter wager: 474275/163296.
- Different Doubles HE: 43/154.

### Critical Files for Implementation
The repo is empty; these are proposed new files:
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/sideBets/luckyShooter.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/sideBets/allSmallTallAll.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/sideBets/hotShooterJackpot.ts
- /Users/jameslerner/bubble craps simulator/craps-simulator/src/engine/machineProfiles.ts (minimum-bet validation, commission modes, OFF rules, come-out auto-OFF lists)
- /Users/jameslerner/bubble craps simulator/craps-simulator/test/sideBets.exact.test.ts