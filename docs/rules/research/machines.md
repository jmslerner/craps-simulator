# Bubble craps machines: how they work and how their rules differ from live tables (fact-checked 2026-10-28)

**How to read the tags.**
- **[C] Confirmed.** Backed by an official document (a manufacturer manual filed with a regulator, a casino rule card, a regulation or a settlement notice), or by two or more independent sources.
- **[P] Plausible.** Backed by one credible source: trade press, an editorial, or an official text that is ambiguous.
- **[F] Forum only.** One forum poster or anecdote. "F×n" means n independent posts agree.
- **[UNVERIFIED].** The cited source does not say it, or no corroboration was found. Do not hard-code these.
- **[FIXED].** The original claim was refuted. The corrected text is shown, and the tag after it applies to the corrected text.
- **[M] Math.** Recomputed exactly with Python Fractions. Every math figure in the original section reproduced.

**Scope warnings.**
- The manuals filed in Washington (WSGC-STW, IB-CCE, IB-C221, IB-RTW, IB-LS) describe Washington builds. All of them defer paytables to "jurisdictionally approved par sheets". The IB-CCE v2.5.1 changelog says: "Jurisdictional specific document and removed pay tables" [C]. Nevada builds may differ [P].
- **Engine rule (inference):** make every product-specific behavior below a config flag. Default to the best-documented product, which is STW as described on the Clearwater card. Offer an Interblock profile as the alternative.

---

## 1. Products and manufacturers

| Maker | Product | Dice / outcome | Key facts (tag, source) |
|---|---|---|---|
| Aruze Gaming America, now Interblock | **Shoot to Win Craps (STW)**, the product most associated with the name "bubble craps" | 8 stations around a Plexiglass dome. 2 large dice on a vibration table [C WSGC-STW]. | **Ownership.** Aruze filed Chapter 11 on **Feb 1, 2023** [C SFNET, AGB-AR]. A §363 auction on Jun 15, 2023 split the assets among Interblock, Empire Technological Group and the bank group [P SFNET]. Interblock's purchase of the Aruze ETG line was **announced Jul 20–21, 2023** [C CDC-IBAR, GGR-AR, CB-AR]. No closing date was found [UNVERIFIED]. Coverage names Roll to Win [P CDC-IBAR]. "Lucky Roulette" as an acquired asset was not found [UNVERIFIED]. By September 2024 the STW Lucky Roll overview is © Interblock d.o.o., and the WSGC STW approval (Feb 18, 2025) is addressed to Interblock [C WSGC-STW]. The SHOOT TO WIN CRAPS mark (SN 85426486) is listed under Interblock d.o.o. [P TM]. **[FIXED] "the original bubble craps":** STW launched around 2010 in Macau [P ASG-STW10], and Interblock announced Organic Dice craps at G2E 2010 [C CEM-OD, CEM-G2E10]. Which came first is unproven. |
| Aruze, then Interblock | **STW Lucky Roll** (shown at G2E Oct 11, 2022; for sale "late in the first quarter of 2023") | AP-X platform with a new dice-sensing system. Dice are 88 mm, about 250 g ±5%, with 6 RFID tags each, read by an RFID array in the vibration table. Linear voice-coil actuator. Overhead camera with a live feed to every seat. | 8 seats. One center unit supports at most 50 stations [C WSGC-STW]; calling that "stadium" is an inference. The operator can configure odds, commission, simultaneous bets, jackpot features, don't-bet areas and side games, and can schedule min/max changes [C CDC-STW + WSGC-STW]. Dice unit name: "Push to Win Dice Generator". Screens: 21-inch full HD [C WSGC-STW]. |
| Aruze, then Interblock | **Roll to Win Craps (RTW)**, a hybrid, not a bubble | LED playing field, 10 player terminals and 1 dealer terminal. **DETG mode:** the dealer hands over real dice and keys in the result. **ETG mode:** the shooter swipes virtual dice, and the result is "determined by Software RNG". | "Shooter Play" opt-in toggle. Tip button and tip ticket. 21.5-inch screens. History shows 15 rolls. The LED roll count resets on a 7-out [C IB-RTW]. **Locations:** Harrah's LV, the first Strip install (Feb 2021) [C VV-DTG, YOGO-RTW]. Paris and Linq [F, reader comments]. Palace Station $5 (2023 comment) [P LVTN]. Cosmopolitan (cheating case) [P GGB-COSMO]. **[FIXED]** No source was found for Circus Circus or Fremont [UNVERIFIED]. |
| Interblock (Slovenia) | **Organic Dice / G4** | Vibrating table. Real dice with an RFID chip on each side. | 6, 8 or 10 stations. 19-inch touchscreens. The same station can run craps or sic bo [C CEM-OD, CEM-G2E10; G4 with 8 seats in ASG-G4]. Interblock's RFID-dice patent re-vibrates and re-reads the dice on a misread [P PAT-RFID]. "G5 Dice" [UNVERIFIED; GGR-G5 could not be retrieved]. |
| Interblock | **Diamond Dice Generator; Diamond Big Dice Generator; Diamond Ministar Dice (4/6/8/10 terminals); Live Craps Table with dealer assist (community); Diamond Universal Cabinet with Micro Dice topper; Diamond Starbar / Bartop** | Mechanical generator. Starbar/Bartop run on an internal RNG or connect to an external mechanical or live generator. | Variants: Craps, Crapless Craps and Easy Craps (all "Double Field"). Crapless and Easy need GV 6.0+ [C IB-CCE]. Single-play means internal-RNG Play Stations and Universal Cabinets [C IB-C221]. **So some Interblock single-seat craps uses an RNG, not physical dice [C].** |
| Interblock | **"Bubble Craps for One"** (single seat) | Each cabinet has its own small bubble with physical dice. | Name and maker [P LVTN-G2E]. Banks of 4 at The D and the Strat (Feb 2020) [F WoV-34333]. In the single-player version the player is always the shooter [C IB-CCE]. Self-paced, no timer [C: G3-MOH "fully self-paced", CDC-DC; F WoV-35576]. |
| Interblock | **Pick2Win Craps** | 3 shuttered, colored dice cylinders. The player picks which 2 count. | Community mode (one shooter) or individual mode. Shown at ICE London, Feb 2023 [C GNW-ICE, GNW-IGA, GA-P2W]. |
| Interblock | **Stadium Live Craps** (hybrid) | Players throw real dice. Stickperson attendants retrieve the dice and key in the result; a lower camera confirms it. | Downtown Grand $3 (Feb 2023). Also Planet Hollywood, Treasure Island and Horseshoe [P VV-DTG plus comments]. In the UI, the odds bet sits on the line rather than behind it [P VV-DTG]. |
| Shuffle Master (now Light & Wonder) | **Vegas Star Craps** (2008; dice "rolled on a touchscreen"); **Rapid Craps** (one live dealer, real dice, Bill's LV, 2011) | Neither is a bubble. | Rapid Craps paid exact cents and settled fractional cents at cash-out [P LVA-RC]. No current L&W physical-dice bubble was found [P, absence]. Sources: [P ASG-VS], [P LVA-RC]. |
| Novomatic | Novo Unity II | none | No craps title found [P, absence]. **[FIXED]** IG-NOVO does not list the games; it mentions only "Lucky Lady's Roulette". The roulette/baccarat/blackjack/sic bo/poker list is [UNVERIFIED]. |
| Alfastreet | Dice Tumbler (G2E 2024) | **[FIXED]** Explicitly a craps product: it "adds a fresh twist to the classic game of Craps". Whether it is a physical tumbler is [UNVERIFIED]. | Presented as one of Alfastreet's US-market innovations; actual US availability not stated [P SA-ALFA]. |
| Zuum | Class II/III ETGs, slots, bingo | none | Interblock took a majority share on Sep 16, 2024. No craps title is mentioned [P IG-ZUUM]. |
| ICONIC21 (online) | Bubble Craps; Bubble Crapless Craps | Automated table broadcast 24/7 (Mar 26, 2026) | Online analog only [P IGB-IC21]. |

---

## 2. Where they run

Machines come and go, so treat every location as historical.

### 2a. Locations

| Area | Reports | Tag |
|---|---|---|
| Strip | 2015–16 forum list: NYNY ($2, 5x), Linq ($3, 2x), Harrah's ($3, 2x), Bally's ($3, 2x), Palms (actually off-Strip; $2, 5x), Excalibur ($1, 2x), Luxor ($2, 3x), Mandalay Bay ($3, 2x), Slots A Fun ($2, 5x), Aria ($5, 2x), Cosmopolitan ($5, 2x), Tropicana ($2, 2x), Monte Carlo (Aruze $3 at 5x and Interblock $1 at 2x), MGM Grand ($5, 3x), Flamingo ($3, 2x), Cromwell ($3, 2x), Bellagio ($5, 2x). | [F WoV-24510] |
| | 2026 player directory (Aria … Sahara). It is self-updated and lists closed venues. | [F BCD] |
| | Park MGM (Feb 2026): "Craps", "Crapless" and an old-style STW. Casino Royale: first-generation big-dice bubble, "5x" (probably odds). | [F TA-2026] |
| | **[FIXED]** Westgate ("had one … very low minimum") and Resorts World were described in the past tense. | [F TA-2026] |
| | Paris: electronic craps from $5. | [P LVD, undated] |
| Downtown | **Golden Gate:** "first downtown table games pit powered entirely by ETGs", with Interblock craps, roulette and blackjack. Launch event Sep 19, 2025. The live craps table closed in Aug 2025. | [C CDC-GG, VV-GG] |
| | **Plaza:** Craps, Crapless, a modernized STW and stadium bubble [F TA-2026]. STW kiosks at $1 minimum with "payouts up to 5x" (meaning unclear) [P LVD, undated]. | |
| | **El Cortez:** $2 with 5x odds (2021 comment); $1 Don't Pass with 5x (2015). | [F×2 LVTN, WoV-24510] |
| | **Circa:** shared bubble, $1 terminals, no comp points (Apr 2021). **The D:** Interblock single seats (2020). **Fremont:** single seats (2021). | [F WoV-34333] |
| | Four Queens ($2, 2x), Binion's ($2, 5x or 10x), Downtown Grand ($1, 4x) (2015–16). Golden Nugget (no-points sign). | [F WoV-24510, LVA-PTS] |
| | California casino | [UNVERIFIED] |
| Locals / other Nevada | Red Rock (Aruze), GVR, Sunset Station and Eastside Cannery ($1) (2015). Gold Strike Jean, 2012: $3–$500; odds 2x per two posters, "345X" per one. South Point removed its card readers. | [F WoV-24510, WoV-11344, LVA-PTS] |
| | "Station Casinos removed all STW (2020)" | [UNVERIFIED; not in the cited threads] |
| Elsewhere | **Mohegan Sun:** Interblock Crapless Craps, $5, mechanical dice generator on top, "fully self-paced". It sits in Casino of the Sky, past Johnny Rockets (Jun 16–18, 2026) [P G3-MOH, SCC]. **[FIXED]** Casino of the Sky and Johnny Rockets are at Mohegan Sun in Uncasville/Montville, CT [P JR]. The Pennsylvania chamber repost does not make it the Pennsylvania property. | |
| | **Clearwater Casino, WA:** STW rule card rev 06-16-2025. | [C CW] |
| | **Seminole Hard Rock Tampa:** real dice, 30-second bet countdown (Jun 2014) [P SHRT]. Hollywood and Tampa FL: $25,000 maximum (reader comment) [F VV-STW]. | |
| | **Isle Pompano, FL:** Interblock Organic Dice. The buy-commission class period ran Jul 8, 2015 to Jan 22, 2017 [C TCA]. **[FIXED]** "Shut down 2017": no source says the machines were removed [UNVERIFIED]. | |
| | **Talking Stick and Casino Arizona:** Interblock Organic Dice (around 2017). The casinos said their commission math was correct. | [P ABC15] |
| | Horseshoe Hammond IN (2021, 2x max) [F WoV-34333]. Harrah's Cherokee NC single-player machines (2025) [F WoV-35576]. Century Casino (2021) [F WoV-35576]. Palace Biloxi and Reno [UNVERIFIED]. | |

### 2b. Known rule configurations

| Casino (date) | Product | Min | Odds | Commission | Crapless | Field | Side bets | Tag |
|---|---|---|---|---|---|---|---|---|
| Clearwater WA (card rev 06-16-2025) | STW | not stated | Pass/Come odds: max 2× base on every number. **[FIXED] Don't odds are not uniformly win-capped.** DP odds: "maximum bet amount is 2 times the bet on the DON'T PASS LINE", which literally caps the bet. DC odds: "2 times the bet on DON'T COME … divided by the corresponding DON'T COME ODDS", which caps the win at 2×. | Buy: "5% of the BET amount is deducted from the win". Lay: "5% of the WIN pay amount is deducted from the win". | No | 2:1 on 2 and 12; 1:1 on 3, 4, 9, 10, 11 | Hot Shooter Jackpot $1–$1,000, requires ≥3 **credits** on the main game (credits depend on denomination). Power Odds. | [C CW] |
| Isle Pompano FL (Jul 2015–Jan 2017) | Interblock Organic Dice | – | – | 5% of the *winnings*: 10% of the bet on 4/10, 7.5% on 5/9, 6% on 6/8. Example: a $20 buy on 4 returned $58, not $59. | – | – | – | [C TCA, CDC-ISLE, WCD-ISLE]. $15 or $30 per claimant; no admission of fault; final hearing Feb 13, 2018 [C TCA]. Plaintiff's lawyer said other Interblock dice games showed the same discrepancy [P CDC-ISLE]. |
| Century Casino (Jan 2021) | bubble (make not stated) | $1; limits $1–$1,000 | Pass 0/1/2x; Don't Pass 0/1/2/3x | $5 buy on 5 paid $7.25 (5% of the bet, taken on the win) | – | – | – | [F WoV-35576]. The same poster says the shooter did not need a line bet, and a button turned all place bets ON for the come-out. |
| Unnamed (Jun 2025) | bubble. **[FIXED]** The make is not stated; the original said "STW". | – | 2x | $3 buy on 10 paid $5.70 (5% of the win, taken on the win) | – | – | – | [F WoV-35576] |
| Downtown Grand (Feb 2023) | Interblock Stadium Live (hybrid) | $3 | "double odds" (reader) | – | – | 2:1 on 2 and 12 | Lucky Shooter, $1 | [P VV-DTG] |
| Arizona (Feb 2017) | bubble | $0.50 Pass | 3x on 4/5/9/10, 2x on 6/8 | – | – | – | $35 maximum total on the table ("treated like slot machines") | [F WoV-28274]. The $35 Arizona cap also appears in a VV-STW comment and in WoV-34333 (2020): [F×3]. |
| Plaza LV (undated page, ©2026) | STW kiosks | $1 | "payouts up to 5x" (unclear) | – | **[FIXED]** The property has crapless games; this is not stated for the STW kiosks. | – | – | [P LVD; F TA-2026] |
| Mohegan Sun CT (Jun 2026) | Interblock Crapless | $5 | – | – | Yes | – | – | [P G3-MOH, SCC] |
| 2015–16 Las Vegas snapshot | STW and Interblock | $1–$5 | Mostly 2x; 3x, 4x, 5x and 10x also seen | – | – | – | One poster: "most of these machines … limit place/lay bets to $25" | [F WoV-24510] |

---

## 3. Rule configuration: machine vs live table

| Parameter | Variants observed | Engine default / most common on bubbles | Tag |
|---|---|---|---|
| Minimum bet | $0.50–$5 on machines. One Nov 2025 editorial: bubble $3 vs live $15–$25 at the author's casino. | $1–$3 | [C: F WoV-24510 + P VV-STW + P LVTN + P CORG] |
| Odds cap | STW and RTW: the casino sets Odds and Don't Odds as a multiple of the base bet "between 2x and 100x". Observed: 2x most often, plus 3x, 4x, 5x, 10x, and 3x/2x by number (Arizona). | **2x flat** | [C WSGC-STW, IB-RTW, CW; F×6 from 2012, 2013, 2015, 2021, 2023, 2025] |
| **Don't-odds cap mode** | **[FIXED]** Not always capped by the win. Clearwater DP odds: capped at 2× the DP bet. Clearwater DC odds: win capped at 2×. 2012 forum: "the don't odds only allows 2X bet … just like the pass/come side". Century 2021: DP up to 3× while Pass was 2×. | Configurable per bet type: bet-capped or win-capped. | [C CW; F WoV-11344, WoV-35576] |
| Buy commission | **A)** Taken on the win, 5% of the *bet*, to the penny (Clearwater card; Century $7.25; a 2021 post: "the vig is taken on the win") [C CW + F×2]. **B)** Upfront: a YES/NO pop-up, the fee is deducted from credits, and no other bet can be placed until the player answers. Applies only to "specified" Buy/Lay bets per the par sheet, from GV6.5; the manual does not state the rate [C IB-CCE]. **C)** 5% of the win amount (Organic Dice 2015–17 [C TCA]; an unnamed 2025 machine [F]). A 2012 claim of "double juice" on 4/10 buys was disputed in the same thread [F]. | A is the best documented. Make it configurable: on-win % of bet, on-win % of win, or upfront. Whether upfront commission is charged again when a winning buy rides is [UNVERIFIED]. | |
| Lay commission | 5% of the win, deducted from the win (STW) [C CW]. Upfront on specified bets (Interblock GV6.5+) [C IB-CCE]. | Taken on the win | |
| Payout precision | Pays to the cent with no chip rounding [C: F×4 WoV-11344 2012, VV-STW comment, WoV-30281 2018, WoV-32511 2019]. **Examples:** $1 place 6 pays $1.17 [F×2, 2012 and 2019]; $3 place-to-lose on 6/8 pays $2.40 [F WoV-36634, 2025]; $5 buy on 5 pays $7.25 [F]. "$50 buy on 5 pays $72.50" is consistent with the math [M], but no source was found. **[FIXED] Rounding:** two reports say round-up (7craps 2012: the machine "rounds Place 6/8 payouts up"; Aruze STW 2018: a $2 place 6 paid $2.34). No round-down report exists. Wrong-way rounding has never been reported. | Penny precision. Rounding mode configurable per bet type; right-way default is round-up, the only direction reported. | |
| Field | 2:1 on 2 and 12 is typical. Interblock paytable EL602 pays 3:1 on 12. | 2x/2x | [C IB-CCE, IB-C221, CW, VV-DTG, VV-STW] |
| **Come-out ON/OFF** | **STW:** "any chips bet remaining from the previous series on COME ODDS/PLACE/BUY/HARDWAYS/BIG6/BIG8 are automatically turned OFF until the Point is established and then are automatically turned ON" [C CW]. Not documented: whether place/buy chips *newly placed* during the come-out bet time work, and whether lay and place-to-lose keep working (the original "keep working" was an inference) [UNVERIFIED]. **[FIXED] Interblock:** place/buy bets placed on the come-out *are* resolved when their number rolls. IB-C221: "Wagering the Place and/or Buy bets on the come-out roll will, after the Point has been established, resolve the Buy or Place bet of that Point". IB-CCE: "…that bet wins…", followed by a pop-up offering to move the bet [C IB-C221, IB-CCE]. Only place/buy bets made after a 7-out are automatically OFF until the player taps Set bets On [C IB-CCE]. No automatic OFF is documented for bets carried through the come-out after a point is made. Interblock's hardways default on the come-out is undocumented. Forum: a button sets all place bets ON for the come-out (Century 2021) [F]. | **Per product.** STW: carried bets OFF. Interblock: ON, unless placed after a 7-out or set OFF by the player. | |
| Toggling ON/OFF | **STW/RTW:** ALL ON, plus ALL OFF and per-chip OFF "from the upcoming roll onward" on **[FIXED]** ODDS, DON'T ODDS, COME ODDS, DON'T COME ODDS, BIG 6/8, PLACE, BUY, PLACE TO LOSE, LAY and HARDWAYS. OFF chips don't use credit and don't count toward the minimum. Undo cannot reverse ON/OFF [C WSGC-STW, IB-RTW]. **Interblock:** Set bets Off disables Place, Lay, Buy, Odds (Take and Give) and Hard Ways for the next roll. Lay re-enables automatically after a point is made or a 7. Other bets stay OFF. OFF bets still reduce the "Playable" meter [C IB-CCE, IB-C221]. | | |
| Taking bets down | **STW overview:** "Unless otherwise specified, all wagers may be withdrawn … before they have been resolved, excluding special games." Only Pass and Come are explicitly locked once a point is set [C WSGC-STW, IB-RTW]. **[FIXED]** Locking Don't Pass is card- or operator-specific. The Clearwater card locks DP after the point and says nothing about DC [C CW]. A 2023 forum post: "locks pass/come bets but not DP/DC bets" [F WoV-38668]. **Interblock:** DP is not a contract bet; it can be reduced or removed but not re-placed until the next cycle. All odds can be taken down, reduced or increased any time before they resolve [C IB-CCE, IB-C221]. | Configurable `dpLockedAfterPoint`: default false; Clearwater profile = true. | |
| Put bets | Interblock: Pass only before the come-out, so no put bets [C IB-CCE]. STW: none described [P WSGC-STW]. | None | |
| Mutually exclusive bets | Pass vs Don't Pass; Come vs Don't Come [C CW, IB-CCE]. STW: "cannot be placed for the same roll: PLACE and PLACE TO LOSE/LAY; BUY and LAY/PLACE TO LOSE". "Same number" is the likely reading [C CW]. Interblock: Place and Buy can share a number if the paytable allows; Place/Buy exclude Lay [C IB-CCE, IB-C221]. **[FIXED]** Interblock setting "Exclude bets on Pass/Don't Pass – Lay/Buy": with a **Pass** bet up it blocks **Lay** on the established point; with a **Don't Pass** bet up it blocks **Buy** on the established point [C IB-C221]. | | |
| Come bets | Allowed only after a point is set [C CW, IB-CCE]. The Interblock text says Come can be placed after the point is made ("any other bet, except Don't Come"). But its Don't Come section allows Don't Come bets "even if the Pass/Don't Pass Point bets got resolved". The text is confirmed; the actual behavior is [UNVERIFIED]. | | |
| Winning bets stay up | **STW:** a winning Pass rides "until a loss". DP/DC that win on the first roll ride "until a loss or a point is established". A Come that wins on 11 stays. Place, Buy, Hardways, Field, Lay, place-to-lose, props and Big 6/8 ride unless cancelled before bet time ends. All carried bets are returned if table settings change [C CW]. **Interblock:** Repeat Last Bet (auto-repeat after holding more than 3 s and confirming), Double Bet, Keep Bets On (not in every jurisdiction) [C IB-CCE]. | | |
| Minimum-action rules | **STW:** OFF chips don't count toward the minimum. The Hot Shooter qualifying bet on the main game is configurable; Clearwater uses 3 credits [C WSGC-STW, CW]. A Pass or Don't Pass bet is required to shoot [C CW, MA]; on the Century machine a shooter rolled with no line bet [F]. **Interblock:** shows "BETS ARE NOT VALID YET!" until the minimum is met [C IB-CCE]. | | |
| Maximums | Set by the operator; STW can schedule them [C CDC-STW]. Washington tribal: $500 maximum wager [C WSGC-ETG]. **Forum:** $195 line maximum with 2x odds (2023) [F WoV-38668]; "$500 max spread … at most places" (2017) [F WoV-28274]; limits $1–$1,000 (2021) [F]; place/lay capped at $25 (2015) [F]; Arizona $35 total [F×3]; $25,000 at Hollywood/Tampa [F VV-STW]. **[FIXED]** "Place $400; hardways $115; hops $70/$35" does not appear in WoV-38668, 32511 or 35576 [UNVERIFIED]; removed. No per-round payout cap was found in any manual [P]. | | |
| Big 6/8 | 1:1 on STW [C CW; WSGC-STW says "lower pays"]. Interblock: standard Craps only, can be placed on any roll [C IB-CCE]. | | |
| Props (STW card) | C 7:1; E 15:1; C&E 3:1 (2, 3, 12) and 7:1 (11); Horn 15:1 (3/11) and 30:1 (2/12), a quarter of the bet on each, or single numbers undivided; Any 7 4:1; Any Craps 7:1; hops: hard 30:1, easy 15:1; hardways 7:1 (4/10) and 9:1 (6/8). Interblock pays the horn net of the losing parts: a $100 horn on 12 pays $675. | | [C CW, IB-CCE] |
| **Hop layout (new)** | Interblock "Hopping Hard Ways" covers only 2-2, 3-3, 4-4 and 5-5. Easy hops: 1-3, 1-4, 1-5, 1-6, 2-3, 2-4, 2-5, 2-6, 3-4, 3-5, 3-6, 4-5, 4-6 (13 bets). There is no 1-2 or 5-6 hop; those are on the horn, as are 1-1 and 6-6. STW: hard hop on paired dice, easy hop on unpaired [C IB-CCE, CW, WSGC-STW]. | | |
| **Single-player puck reset (new)** | Interblock setting "Puck can be reset": **0** = standard. **1** = the puck returns to OFF 15 s after a cash-out or a game restart. **2** = the player can also manually return the puck to OFF whenever no puck-related bet is up (Pass, Don't Pass, Come, Don't Come, Come/Don't Come points, Lucky Shooter); qualifying bets are also turned OFF. Single-play only (internal-RNG Play Stations and Universal Cabinets) [C IB-C221, IB-CCE]. | Engine: add a "reset to come-out" action for single-player mode. | |
| **Group-bet buttons (new)** | STW/RTW Across, and Interblock Press, Inside and Across, work only after the come-out and only when a Pass, Don't Pass, Field or one-roll bet is placed. Interblock has a setting, "special buttons follow the puck" [C WSGC-STW, IB-CCE, IB-C221]. | | |

### House edges, computed exactly [M]

All figures in the original section reproduced exactly.

| Bet | Edge |
|---|---|
| Pass line | 7/495 = 1.414% |
| Don't Pass | 3/220 = 1.364% per bet; 1.403% per decided bet |
| Pass + odds | 1x 0.848%; 2x 0.606%; 3x 0.471%; 3-4-5x 0.374%; 5x 0.326%; 10x 0.184%; 20x 0.099%; 100x 0.021%; Arizona 3x/2x 0.520% |
| Don't Pass + lay odds, win capped at m × base | 1x 0.682%; 2x 0.455%; 3x 0.341%; 5x 0.227%; 6x 0.195%; 10x 0.124% |
| **New:** Don't Pass + lay odds, bet capped at m × base (Clearwater DP literal reading) | 1x 0.818%; 2x 0.584%; 3x 0.455%; 5x 0.315%; 6x 0.273%; 10x 0.178% |

| Number | Place | Buy, on win (5% of bet) | Buy, 5% of win | Buy, upfront | Lay, on win | Lay, upfront | Place-to-lose |
|---|---|---|---|---|---|---|---|
| 4/10 | 6.667% | 1.667% | 3.333% | 5.000% of bet (4.762% of bet + commission) | 1.667% | 2.500% (2.439%) | 5:11, 3.030% |
| 5/9 | 4.000% | 2.000% | 3.000% | 5.000% (4.762%) | 2.000% | 3.333% (3.226%) | 5:8, 2.500% |
| 6/8 | 1.515% | 2.273% | 2.727% | 5.000% (4.762%) | 2.273% | 4.167% (4.000%) | 4:5, 1.818% |

- Field: 2x/2x 5.556%; 2x/3x 2.778%.
- Big 6/8 9.091%. Hard 4/10 at 7:1 11.111%. Hard 6/8 at 9:1 9.091%.
- Any 7 16.667%. Any craps 11.111%. 2 or 12 at 30:1 13.889%. 3 or 11 at 15:1 11.111%. C&E 11.111%. Horn 12.5%. Hops: easy 11.111%, hard 13.889%.

**Coaching point [FIXED].** Penny accounting makes a $1 buy on 4/10 with on-win commission of 5% of the bet cost 1.667%, against 6.667% for placing [M]. The original said the advantage "mostly disappears" under upfront commission or 5%-of-win. That is wrong for 4/10.
- **4/10:** buying beats placing under all three commission methods: 1.667%, 3.333%, and 4.762% (of bet plus commission), all below 6.667%.
- **5/9:** buying beats placing (4.000%) under on-win of the bet (2.000%) and 5%-of-win (3.000%), but not under upfront (4.762%).
- **6/8:** placing (1.515%) beats buying under every method [M].
- Live tables usually charge a $1 minimum commission, so buys need to be $20+ [P].

### Rounding to the cent [M]

| Bet | Round down | Nearest cent | Round up |
|---|---|---|---|
| $1 place 6 | $1.16, edge 1.818% | $1.17, 1.364% | $1.17, 1.364% |
| $2 place 6 | $2.33, 1.591% | $2.33, 1.591% | $2.34, 1.364% |
| $5 place 6 | $5.83, 1.545% | $5.83, 1.545% | $5.84, 1.455% |

- Right-way round-up has two forum reports [F×2]. Wrong-way rounding has none.
- If lay odds were rounded up, a $1 lay-odds bet on 6/8 would pay $0.84, giving the player a +0.364% edge on that odds bet [M].
- Inference: machines probably round wrong-way pays down or restrict bet increments [UNVERIFIED]. Engine: make the rounding mode configurable per bet type.

---

## 4. Crapless and Easy Craps on machines

| | Interblock Crapless (GV 6.0+) | Interblock Easy Craps (GV 6.0+) |
|---|---|---|
| Points | 2, 3, 4, 5, 6, 8, 9, 10, 11, 12. On the come-out only 7 wins; 11 becomes a point. | Same |
| Removed | Don't Pass, Don't Come, Lay, Big 6/8, Big/Small | Don't Pass, Don't Come, Come (and Come odds), Buy, Lay, Big 6/8, Big/Small |
| Available | Pass, Come, Pass and Come odds, Place (including 2/3/11/12), Buy, Hardways, Field, C/E/C&E, Seven, Any Craps, Horn, hops, Lucky Roller | Pass, Pass odds, Place, Hardways, Field, **Low Field (wins on 2, 3, 4)**, **High Field (wins on 10, 11, 12)**, props, hops, Lucky Roller |
| Buttons | Press, Across | Press, Across |
| Source | [C IB-CCE] | [C IB-CCE] |

- Lucky Roller is on every Interblock variant from SW 5.123.0.0 [C IB-CCE].
- Lucky Shooter is described as "Craps specific", with points defined as 4–10. It is not documented for Crapless or Easy [P IB-CCE].
- Paytables and odds caps are not public [C, absence]. An STW crapless variant was not found [P]. The crapless games at Park MGM and the Plaza are separate "Crapless" games [F TA-2026].
- Live crapless reference (Cypress Bayou): place 2/12 at 11:2, place 3/11 at 11:4; odds 6:1 and 3:1; lay 1:6 and 1:3; bets on 2/3/11/12 become buy bets at $20+ [C CYP]. Las Vegas Advisor (Apr 9, 2018): "most versions allow only 2X odds" [P LVA-CL].
- Math [M]: crapless Pass wins with probability 6557/13860, edge 5.382%. With odds: 1x 2.936%; 2x 2.018%; 3x 1.538%; 5x 1.042%; 10x 0.577%. Place 2/12 at 11:2: 7.143%. Place 3/11 at 11:4: 6.250%.
- Wrong claim: crapsee.com says that in Easy Craps "a 7 doesn't lose the Pass line". Refuted: IB-CCE's Pass table shows the 7-out losing in all three variants [C].

---

## 5. Game flow

### Community machine (STW / Lucky Roll) [C WSGC-STW]

1. Credits go in through the bill/ticket acceptor.
2. One bet timer applies to everyone. It turns from green to red at 5 seconds or less, then "No More Bets" appears.
3. The designated shooter's button lights up. If it isn't pressed within the time limit, the machine shoots automatically.
4. A linear voice-coil actuator shakes and launches the dice.
5. The RFID array reads the dice. Results show on screen and on the optional 360° LED display.
6. Wins are paid automatically.

**Timer length:**
- Interblock: configurable ("settable in G4Settings") [C IB-CCE]. STW: the length is not stated [UNVERIFIED].
- 2012: a 20-second bet countdown plus up to 20 seconds to press the shooter button [F WoV-11344].
- 2023: "15 second countdown" [F WoV-38668].
- 2025: "20 seconds to roll the dice". This is the shooter's window, not necessarily the bet timer [F WoV-35576].
- Seminole Tampa (2014): 30-second countdown [P SHRT].
- Roll to Win "15–20 seconds" [UNVERIFIED].

### Shooter rules (STW, Clearwater card) [C CW]

- A Pass or Don't Pass bet is required to be eligible. If nobody has one, a player with a non-cancelable Come bet becomes eligible.
- **Rule 35d:** "As long as the designated SHOOTER maintains a bet on the PASS LINE / DON'T PASS LINE, the SHOOTER continues to roll the dice until a 7 OUT is rolled or a point is established."
- **Rule 35g:** eligibility "rotates to the next highest numbered player terminal" with a line bet "when a 7 OUT is rolled or when a point is established". Read literally, the dice rotate when a point is set; the wording is ambiguous.
- Forum reports conflict: some say the shooter keeps the dice until a 7-out [F VV-STW comments].
- "The SHOOTER functionality does not affect the roll result of the game."
- Roll to Win: players can opt out of shooting with the "Shooter Play" toggle [C IB-RTW].
- Massachusetts (dealer-run automated-shaker table): the shooter must give up the shaker after rolling **any** 7, including a come-out natural [C MA].

### Interblock machines [C IB-CCE]

- The system picks the shooter from eligible players, or a dealer picks.
- On a single-player machine the player is always the shooter.
- An optional Roll button starts the game once all players tap it.
- Single-player machines are self-paced with no timer [C G3-MOH, CDC-DC; F WoV-35576].

### When a new "shooter" starts for side bets

| Product | Definition | Tag |
|---|---|---|
| STW Hot Shooter | The roll count covers the rolls from the come-out after a 7-out until the next 7-out. The bet is accepted only during that come-out's bet time. RTW's LED roll count resets on a 7-out. "No matter who presses the button" is an inference from rule 35g. | [C CW, WSGC-STW, IB-RTW] |
| Pennsylvania | Hot Shooter and Lucky Shooter are placed before the come-out that sets a point. | [C PA623c] |
| Interblock Lucky Roller | Only after a 7, or before the first roll of the history cycle. | [C IB-CCE] |
| **New:** STW/RTW Lucky Roller | "May be placed prior to any roll when there are no active wagers of the same type." | [C WSGC-STW, IB-RTW] |
| Interblock Lucky Shooter | Placed before the point; becomes a contract bet once the point is set. **[FIXED]** The puck returns to OFF 15 s after a cash-out only when "Puck can be reset" is set to 1 or 2 (single-play). | [C IB-CCE, IB-LS, IB-C221] |

### How the come-out is signaled [C IB-CCE, IB-RTW]

- The puck shows OFF (black) during the come-out and ON (white) on the point.
- LED messages: "Come Out Roll", "Place Your Bets", "No More Bets" (RTW).
- Interblock colors the next roll's winning totals blue ("Win Condition").

### Invalid rolls

- STW setting: reshoot automatically, void the game and return bets, or pause for an attendant [C WSGC-STW].
- Massachusetts: a roll is invalid if both dice don't land flat or one die rests on the other. A malfunction voids the round. The floorperson can call "No Roll" [C MA].
- Interblock's patent describes re-vibrating the platform and re-reading on a misread [P PAT-RFID].
- Forum: dice sometimes lean against the dome so the result can't be read (2017) [F WoV-29882].
- **[FIXED]** "WoV-tag" is not a source. "Errors out until an attendant turns a key" is [UNVERIFIED], though it fits the official pause-for-attendant option.

### Pace and hourly loss

- Live table (Jim Kilby, *Casino Operations Management*, via Wizard of Odds): 249 rolls/hour with 1 player, 216 with 3, 144 with 5, 135 with 7, 123 with 9, 102 with 11 [C WoO-K].
- Rating systems are "pre-programed to reflect sixty (60) rolls per hour" (Bill Zender, Mar 2021) [P GGB-RATE].
- STW "close to 100 rolls/hour" [UNVERIFIED; no source found]. The Interblock stadium hybrid rolls about every 30 s, roughly 120/hour [P VV-DTG]. Single-player pace has not been measured.
- Math [M]: a line decision averages 557/165 = 3.376 rolls. A hand averages 1671/196 = 8.526 rolls. A hand of 154+ rolls has odds of 1 in 5.59 billion.

| Rolls/hour | 7s/hour | 7-outs/hour | Line decisions/hour | $5 Pass | $6+$6 Place 6 & 8, always working | $5 Field 2x/2x every roll | $1 on each of 4 hardways, always working |
|---|---|---|---|---|---|---|---|
| 100 | 16.7 | 11.7 | 29.6 | $2.09 | $5.56 | $27.78 | $11.11 |
| 144 | 24.0 | 16.9 | 42.7 | $3.02 | $8.00 | $40.00 | $16.00 |
| 200 | 33.3 | 23.5 | 59.2 | $4.19 | $11.11 | $55.56 | $22.22 |
| 249 | 41.5 | 29.2 | 73.8 | $5.22 | $13.83 | $69.17 | $27.67 |

- The last four columns are expected loss per hour [M]: Σ(bet × per-roll edge) × rolls/hour. Pass loses 0.4189% of the flat bet per roll. Place 6/8 loses 1/216 of the bet per roll.
- **New [M]:** STW turns carried place and hardway chips OFF on the come-out, and only 392/557 = 70.4% of rolls are point rolls. With that default, losses at 100/144/200/249 rolls per hour are:
  - $6+$6 place 6 & 8: $3.91 / $5.63 / $7.82 / $9.74.
  - 4 hardways at $1: $7.82 / $11.26 / $15.64 / $19.47.

---

## 6. Touchscreen controls and displays

| Function | STW / RTW (Interblock, formerly Aruze) [C WSGC-STW, IB-RTW] | Interblock Craps [C IB-CCE, IB-C221] |
|---|---|---|
| Chips | Chip rack. Tap the cog icon to set any chip value on a keypad. | 7 chips when multi-denomination is off; values scale with denomination. |
| Placing bets | Tap a spot; each extra tap adds the chip's value again. | Tap, or drag and drop. |
| Removing bets | Drag a chip off the layout; Cancel then tap chips; All Cancel (unlocked chips); Undo up to 50 times (cannot undo ON/OFF). | Clear Last Bet; press twice to clear all. |
| Repeat / double | – | Repeat Last Bet (hold >3 s and confirm for auto-repeat), Double Bet, Keep Bets On (not in all jurisdictions). |
| Group bets | Across: the 5 place numbers other than the point, only after the come-out. RTW: after a place win, an "OK" button presses the bet by the amount won. | Press, Across, Inside, Outside (Crapless/Easy: Press and Across only). After a come-out place win, a pop-up offers to move the bet: to Buy on another point in Craps, or to Place on another point in Crapless/Easy. |
| ON/OFF | All On; All Off and per-chip Off (see the full list in §3). | Set bets On/Off. |
| Odds | Odds spot appears once the point is set. | Pop-up with multipliers of the base bet; can also be placed or adjusted by hand. |
| Displays | Bet timer; "No More Bets"; history of 27 results with each die (Lucky Roll) or 15 (RTW); RTW LED roll count; live overhead camera; Win, Bet and Credit meters (switch credits/currency); Easy Help; Game Rules. | Info bar; Win Condition; last-results sidebar; hardway "rolls since last" counters; puck; Show Winnings; Show Hints; Show Bet Limits; Reserve Station; language flags. |
| Money | Bill/ticket acceptor; ticket printer; Cash Out; Service; USB charging; RTW Tip button and tip ticket. | Cash out only when no bets are on the table; ticket, or hand pay above the ticket limit; Call Attendant. |

An older Aruze STW showed a "history of 50" rolls [F×2 WoV-14022].

---

## 7. Fairness and regulation

| Topic | Finding | Tag |
|---|---|---|
| How results are read | STW: physical dice with embedded RFID tags, read by an RFID array in the vibration table, plus a camera feed. Organic Dice: an RFID chip on each side. | [C WSGC-STW; C CEM-OD, CEM-G2E10] |
| Nevada | Reg 14.040 (Rev. 08/26). **14.040(1)(a):** at least 75% return for each wager. **(1)(b):** outcomes decided by chance, skill, or both. **(1)(c)(5):** must display "any monetary wagering limits for games representative of live gambling games". **(4):** for games that represent live games, "the mathematical probability of a symbol or other element appearing … must be equal to … the live gambling game"; any difference must be disclosed in the play area or the posted rules. This covers outcome probabilities, not payouts. **(6):** devices "must not alter any function … based on the actual hold percentage". | [C NV14] |
| Washington tribal | "Maximum wager is $500". "Pay tables and odds on ETG will be consistent with approved rules for table games". Three modes: dealer-run, dealerless (shared roll) and hybrid. Approved craps titles: Interblock Craps, Roll To Win, STW Lucky Roll, and the Craps/Crapless/Easy Craps Washington-specific description. | [C WSGC-ETG] |
| Massachusetts | These rules cover a **dealer-run automated-shaker table**, not touchscreen stations. Dice stay sealed in the shaker (205 CMR 146.47) and are replaced at least every 24 h. Invalid-roll rules as in §5. A Pass or Don't Pass bet is required to operate the shaker. The shooter must give up the shaker after any 7. | [C MA] |
| Pennsylvania | 58 Pa. Code ch. 623c was added May 24, 2024, effective May 25, 2024. Lucky Shooter is allowed on fully automated tables; Hot Shooter on fully automated or hybrid tables. §605a.5 is titled "Fully automated electronic gaming tables and electronic wagering terminals". | [C PA623c, PA605] |
| Lab standards | GLI-24 v1.3 (Sep 6, 2011) covers electronic table game systems; GLI-25 v1.2 covers dealer-controlled ETGs. Maine adopts them by reference [C GLI24, GLI25, ME]. Massachusetts adoption appears only in a draft [P]. The dice-specific text of GLI-24 was not reviewed. | |
| Other jurisdictions | California "has a regulation against using dice alone to determine the outcome of a bet", so its casinos use card or card-and-dice hybrids [P LVA-CA]. Florida: electronic dice and roulette games were "declared legal there in 2012 when they were classified as slot machines" [P WCD-ISLE]. | |

**"Bubble craps is rigged": what the evidence shows**

- No regulator or court finding of rigged dice was found [P, absence].
- The documented real harm was **payout math**: the Isle/Interblock buy-commission case, settled at $15 or $30 per claimant with no admission of fault [C TCA].
- Software bugs cut both ways. A second-hand 2023 report says a machine paid Don't Pass/Don't Come on 12 until it was fixed the next day [F WoV-38668].
- Players' logs: about 10,000 rolls described as consistent with random in 2012 [F WoV-11344]. "5,155 logged rolls (2023)" [UNVERIFIED].
- Claims of magnets or RNG-steered dice are unsupported. Vital Vegas's Scott Roeben replied "That's not a thing" [P VV-STW].
- Physical quirks reported: dice leaning on the dome, a die failing to tumble, and a 2017 redesign with a dip in the center of the platform [F WoV-29882].
- Interblock marketing says the dice bounce higher the harder players strike the button [P CDC-GG]. The STW card says the shooter function does not affect the result [C CW].
- The "too many sevens" impression comes from pace. A 7 is 1/6 of rolls, so 200 rolls/hour means about 33 sevens and 23.5 seven-outs an hour [M]. History displays and "rolls since last" counters invite gambler's-fallacy thinking.

---

## 8. Comps, taxes, cash handling and other quirks

- **Points:**
  - A casino executive says dealerless games earn slot points, "usually based solely off coin-in" [P LVA-PTS, Jul 20, 2023]. "Booked as slot revenue" [UNVERIFIED]. "Slot clubs pay about 0.1% of coin-in" [UNVERIFIED].
  - No-points signs reported at Bellagio, Sahara, Golden Nugget and Oklahoma machines; South Point removed card readers [F LVA-PTS comments]. Circa 2021 and 2015 Strip machines gave no points [F WoV-34333, WoV-24510].
  - Interblock and other makers changed machines to "award points only for the amount of money at risk", after players hedged to farm points [P LVA-PTS].
  - Downtown Grand's hybrid shows "No points" [P VV-DTG].
  - **[FIXED]** "Some Oklahoma machines disallow free play": the source only says "no points will be awarded". The free-play claim is [UNVERIFIED].
  - Comps described as "skimpy" [F WoV-32511]. "Offers drop after bubble play" rests on travelzork, which §10 rejects [UNVERIFIED].
- **Taxes and hand pays:**
  - Forum posts report W-2Gs on wins of $1,200 or more [F×2 WoV-11344, WoV-28274].
  - The IRS slot W-2G threshold is **$2,000 from Jan 1, 2026**, indexed for inflation from 2027, under the One Big Beautiful Bill Act [C HK, IRS-W2G].
  - Interblock hand-pays above its ticket limit [C IB-CCE].
  - "Vouchers start printing above about $3,000 in credits" [UNVERIFIED].
- **Cash and tips:**
  - Cash is ticket-in/ticket-out through the acceptor and printer [C WSGC-STW, IB-RTW].
  - Gold Strike (2012): "All hand pay on every cash out" [F].
  - Roll to Win prints tip tickets for its dealer [C IB-RTW]. No tip function appears on the dealerless STW Lucky Roll [C, absence].
- **Other quirks:**
  - "You can't play two seats on one players card" [UNVERIFIED].
  - Glitches can halt the game, and slot techs are "not yet fully versed" in repairing it [P CDC-DC].
  - Power Odds can raise prop payouts after betting closes [C CW, WSGC-STW].

---

## 9. Side bets on machines

### Hot Shooter Jackpot (STW, RTW; Pennsylvania)

- **Rules:** pays on the hand's roll count. Only the highest tier reached pays.
- **Paytables:**
  - Pennsylvania: ≤7 rolls lose; 8–15 push; 16–23 pays 2:1; 24–31 4:1; 32–39 6:1; 40–44 11:1; 45–49 29:1; 50+ 99:1 [C PA623c].
  - Clearwater: "1xBET … 100xBET", meaning total return including the stake [C CW]. The Clearwater top tier says "OVER 50 ROLLS". The STW overview says "100 times bet upon the 50th roll", so use 50+ [C WSGC-STW].
- **Edge [M]:**
  - **9.074%** if the 7-out roll counts, which matches the STW wording "upon the 8th roll".
  - **21.56%** if it doesn't. Pennsylvania's "throws the dice 7 times or less before the next 7 out" leans this way.
  - Tier probabilities with the 7-out counted: ≤7 0.570956; 8–15 0.297425; 16–23 0.091300; 24–31 0.027973; 32–39 0.008566; 40–44 0.001976; 45–49 0.000943; 50+ 0.000861.
  - Reading the multipliers as "to 1" would give the player +33.8%, which is impossible, so the total-return reading is right.

### Lucky Shooter (Interblock; Pennsylvania)

- **Rules:** 2, 3 or 12 before a point loses. A 7 or 11 on the come-out keeps the bet working; Pennsylvania lists it as "1 for 1", i.e. a push. Once the point is set, count the distinct other point numbers hit. Any repeat or other number, including 7 or the point, settles the bet. All 5 others and then the point on the 6th roll pays the top award.
- **Internal inconsistency:** IB-LS and IB-CCE say both "loses … if 7 or 11" and "stays … if 7 or 11".
- **Paytables ("for 1"):** A 1000/150/15/5/–; B 500/100/10/4/2; C 1000/150/20/5/–; D 500/100/10/5/2 [C PA623c].
- **Edge [M]:**
  - Per trial, with come-out 7/11 pushes counted as 0: A 13.19%, B 12.53%, C 8.19%, D 8.43% (the original figures).
  - **New:** per resolved bet: A 16.96%, B 16.11%, C 10.53%, D 10.84%.
  - If the 7/11 actually paid even money and the bet stayed up, every table would be player-favorable, so the push reading is correct.

### Lucky Roller

- **Bets:** Low Rolls (All Small), High Rolls (All Tall), Roll 'Em All. The listed totals must all roll before a 7.
- **Where offered:** Interblock, placed only after a 7 or at the start of the cycle [C IB-CCE]. **New:** also on STW Lucky Roll and RTW, placeable before any roll when no same-type wager is active [C WSGC-STW, IB-RTW]. Low and High pay the same; Roll 'Em All pays "substantially higher" [C WSGC-STW].
- **Paytable:** not public.
- **Math [M]:** probabilities: small or tall 0.026354; all 0.005258. Pennsylvania's Bonus Craps paytables give the edges:
  - 34/34/175 to 1: 7.76% / 7.76% / 7.46%.
  - 30/30/150 to 1: 18.30% / 18.30% / 20.61% [C PA623c for the paytables].

### Power Odds (STW, RTW)

- **Rules:** randomly boosts prop payouts after betting closes. The odds are drawn from two improved values, "with the maximum improved odds value doubling the pay" [C WSGC-STW].
- **Paytable:** Any Craps and C 10 or 14:1; Any 7 6 or 8:1; E, easy hops and horn 3/11 22 or 30:1; horn 2/12 and hard hops 45 or 60:1; C&E 4 or 6:1 (craps) and 10 or 14:1 (11); hard 4/10 10 or 14:1; hard 6/8 13 or 18:1 [C CW].
- **Edge:** can't be computed; trigger rates are only in the par sheets. Model as configurable.

---

## 10. Claims to reject or flag

**From low-quality sources** (crapsee.com, travelzork.com, pokerology.com, casino.org blog posts, esports.gg, netlify mirror pages):
- "Bubble machines pay 6:5 on place 6/8." The rule cards say 7:6 [C CW]. CORG's 6:5 figure is for odds, not place bets.
- "In Easy Craps a 7 doesn't lose the Pass line." Refuted [C IB-CCE].
- "60–120 rolls/hour vs 20–40 live." Contradicted by Kilby's 102–249 [C WoO-K].
- "150 rolls/hour." Unsourced.
- bubble-craps.com is self-updated, lists closed venues and contradicts itself.

**New rejections from this fact-check:**
- "Interblock place bets are off on every come-out." Interblock place/buy bets placed on the come-out resolve unless set OFF; only bets placed after a 7-out are auto-OFF.
- "Don't odds are always capped by the win." The Clearwater DP odds are capped by the bet.
- "Exc Lay/Buy blocks Lay and Buy while a Pass bet is up." A Pass bet blocks Lay; a Don't Pass bet blocks Buy.
- Maximums "place $400 / hardways $115 / hops $70/$35." Not found in the cited threads.
- Roll to Win at Circus Circus and Fremont. No source.
- "Isle machines shut down 2017." No source.
- "Upfront commission makes buying 4/10 no better than placing." Wrong math.

---

## 11. Gaps

- Paytables and par sheets for Interblock's Crapless/Easy odds caps, place 2/3/11/12, Low/High Field and Lucky Roller, and for STW's Lucky Roller.
- Nevada default settings. Power Odds trigger rates.
- Whether STW place/buy chips *newly placed* during come-out bet time work, and the lay and place-to-lose status on the come-out.
- Whether Interblock carried place bets work on the come-out after a point is made; Interblock's hardways default on the come-out.
- Whether STW shooter rotation happens at point establishment (rules 35d/35g). Which odds-cap mode the don't side uses on each machine. Whether Don't Pass locks after the point, per operator.
- **Interblock Big/Small:** v2.2.1 calls them single-roll bets, v2.5.1 calls them multi-roll bets "before 7-out", and the paytable is unknown.
- Whether upfront commission is charged again when a winning buy rides.
- Measured rolls per hour on bubble machines. Wrong-way rounding direction.

---

## Source keys

| Key | URL |
|---|---|
| WSGC-STW | https://wsgc.wa.gov/sites/default/files/2025-04/3195%20Craps%20Shoot%20to%20Win%20ETG%20Approval%20Letter%20signed_0.pdf |
| IB-CCE | https://wsgc.wa.gov/sites/default/files/2025-02/Craps_Crapless_Craps_Easy_Craps_game_description_Washington-specific_v2.5.1_0.pdf |
| IB-C221 | https://wsgc.wa.gov/sites/default/files/2024-03/Craps%20-%20Game%20Description_WA-specific_v2.2.1.pdf |
| IB-RTW | https://wsgc.wa.gov/sites/default/files/2025-02/DESC_RollToWinCraps_NO_ODDS_WA_Overview_v1.1.pdf |
| IB-LS | https://wsgc.wa.gov/sites/default/files/2024-03/Lucky%20Shooter%20Special%20Bet%20Description_WA-specific_v1.5.1.pdf |
| WSGC-ETG | https://wsgc.wa.gov/tribal-partnerships/tribal-electronic-table-games |
| CW | https://clearwatercasino.com/wp-content/uploads/2025/10/Electronic-Craps-Shoot-to-Win-Rules-rev-06-16-2025-WSGC-06-18-2025-SGA-06-18-2025.pdf |
| PA623c | https://pacodeandbulletin.gov/secure/pacode/data/058/chapter623c/058_0623c.pdf |
| PA605 | https://www.law.cornell.edu/regulations/pennsylvania/58-Pa-Code-SS-605a-5 |
| MA | https://massgaming.com/wp-content/uploads/RULES-Automated-Craps-2-1-18.pdf |
| NV14 | https://www.gaming.nv.gov/contentassets/d6342a488e944e6aa02337fa9d3c94e5/regulation-14-as-of-08-26.pdf |
| GLI | https://www.gaminglabs.com/gli-standards |
| GLI24 | https://www.maine.gov/dps/sites/maine.gov.dps/files/inline-files/GLI-24Electronictablegamesv1-3.pdf |
| GLI25 | https://www.maine.gov/dps/sites/maine.gov.dps/files/inline-files/GLI-25DealerControlledETGsv1-2.pdf |
| ME | https://www.law.cornell.edu/regulations/maine/16-633-C-M-R-ch-20-SS-2 |
| SFNET | https://www.sfnet.com/home/industry-data-publications/the-secured-lender/tsl-express-daily-articles-news/tsl-express-daily-articles-news/2023/10/04/armory-securities-llc-announces-the-sale-of-the-assets-of-aruze-gaming-america-inc |
| AGB-AR | https://agbrief.com/news/usa/02/02/2023/aruze-america-files-for-chapter-11-bankruptcy-but-assures-it-will-emerge-stronger/ |
| CDC-IBAR | https://cdcgaming.com/brief/las-vegas-developer-interblock-plans-to-buy-aruzes-table-game-assets |
| CB-AR | https://casinobeats.com/2023/07/21/interblock-play-synergy-aruze-gaming/ |
| GGR-AR | https://www.ggrasia.com/interblock-to-acquire-aruze-gamings-etg-assets/ |
| GI-AR | https://www.gamblinginsider.com/news/21869/interblock-acquires-electronic-table-game-assets-from-aruze-gaming-america |
| TM | https://trademarks.justia.com/owners/interblock-d-o-o-5300461 |
| ASG-STW10 | https://www.asgam.com/mags/201012/27/ |
| CDC-STW | https://cdcgaming.com/g2e-aruze-gaming-introduces-new-shoot-to-win-craps-lucky-roll/ |
| IG-STW | https://www.intergameonline.com/casino/news/aruze-updates-shoot-to-win-craps |
| YOGO-RTW | https://www.yogonet.com/international/news/2021/02/11/56447-harrah-39s-las-vegas-installs-strip-39s-first-hybrid-digital-craps-table |
| GGB-COSMO | https://ggbnews.com/article/four-suspects-involved-in-225k-etg-scam-at-the-cosmo |
| CEM-OD | https://casinoenterprisemanagement.com/articles/november-2010/table-games-and-gear-november-2010 |
| CEM-G2E10 | https://casinoenterprisemanagement.com/newswire/interblock-announces-its-grand-plans-g2e |
| ASG-G4 | https://www.asgam.com/mags/201205/78/ |
| PAT-RFID | https://patents.google.com/patent/US10417466 |
| GGR-G5 | https://www.ggrasia.com/interblock-holds-g5-summit-at-g2e-asia/ |
| GNW-ICE | https://www.globenewswire.com/en/news-release/2023/02/24/2615534/0/en/Award-Winning-ETG-Company-Interblock-Crushed-It-at-ICE-London-2023.html |
| GNW-IGA | https://rss.globenewswire.com/news-release/2023/03/17/2629707/0/en/Interblock-to-Exhibit-Ground-Breaking-Technology-at-IGA-2023.html |
| GA-P2W | https://gamingamerica.com/?p=34402 |
| IG-ZUUM | https://www.intergameonline.com/casino/news/interblock-acquires-manufacturer-zuum |
| IG-NOVO | https://www.intergameonline.com/land-based-gaming/news/novo-unity-ii-named-etg-of-the-year |
| SA-ALFA | https://soloazar.com/en/interviews/revolutionising-the-gaming-experience-with-its-v-line-series-alfastreet-at-g2e-2024 |
| ASG-VS | https://www.asgam.com/mags/200808/22/ |
| LVA-RC | https://www.lasvegasadvisor.com/question/2011-03-01/ |
| IGB-IC21 | https://igamingbusiness.com/company-news/iconic21-unleashes-industry-first-power-combo-bubble-craps-and-bubble-crapless-craps/ |
| LVTN-G2E | https://lasvegasthenandnow.com/casino-table-game-innovations-on-display-at-g2e/ |
| LVTN | https://lasvegasthenandnow.com/where-to-find-the-cheapest-craps-in-vegas/ |
| VV-STW | https://www.casino.org/vitalvegas/the-casino-game-were-loving-right-now-shoot-to-win-craps/ |
| VV-DTG | https://www.casino.org/vitalvegas/hybrid-stadium-craps-rolls-into-downtown-grand/ |
| VV-GG | https://www.casino.org/vitalvegas/golden-gate-to-close-its-remaining-live-craps-table/ |
| CDC-GG | https://cdcgaming.com/las-vegas-golden-gate-hotel-casino-to-install-interblocks-electronic-table-games/ |
| CDC-DC | https://cdcgaming.com/commentary/what-about-these-electronic-crap-games/ |
| G3-MOH | https://g3newswire.com/interblock-installs-crapless-craps-at-mohegan-sun/ |
| SCC | https://www.scrantonchamber.com/mohegan-sun-enhances-gaming-floor-with-crapless-craps/ |
| JR | https://locations.johnnyrockets.com/ll/US/CT/Montville/1-Mohegan-Sun-Boulevard |
| SHRT | https://blog.seminolehardrocktampa.com/?p=755 |
| ABC15 | https://www.abc15.com/news/region-phoenix-metro/central-phoenix/gambling-lawsuit-claims-diminished-payouts |
| TCA | https://topclassactions.com/lawsuit-settlements/closed-settlements/isle-of-capri-fan-club-loyalty-program-class-action-settlement |
| CDC-ISLE | https://cdcgaming.com/commentary/publics-disinterest-could-bode-well-for-interblock-isle-casino/ |
| WCD-ISLE | https://news.worldcasinodirectory.com/electronic-craps-machines-at-florida-casino-accused-of-ripping-players-off-41335 |
| LVA-PTS | https://www.lasvegasadvisor.com/question/etgs-player-points/ |
| LVA-CL | https://www.lasvegasadvisor.com/question/crapless-craps/ |
| LVA-CA | https://www.lasvegasadvisor.com/question/california-craps/ |
| CYP | https://cypressbayou-casino.treepl.co/play-casino-table-games/crapless-craps |
| LVD | https://www.lasvegasdirect.com/?p=20178 |
| CORG | https://www.casino.org/blog/bubble-craps-rules-strategy-guide/ |
| WoO-K | https://wizardofodds.com/ask-the-wizard/table-games/ |
| GGB-RATE | https://ggbmagazine.com/article/player-rating-errors-you-are-probably-making-in-craps |
| IRS-W2G | https://www.irs.gov/pub/irs-prior/iw2g--2026.pdf |
| HK | https://www.hklaw.com/en/insights/publications/2026/01/w2g-reporting-threshold-raised |
| TA-2026 | https://www.tripadvisor.com/ShowTopic-g45963-i10-k15498822-Bubble_Craps-Las_Vegas_Nevada.html |
| BCD | https://www.bubble-craps.com/bubble-craps-las-vegas/ |
| TZ | https://travelzork.com/bubble-craps-vs-traditional-craps/ (rejected source) |
| WoV-nnnnn | `https://wizardofvegas.com/forum/gambling/craps/<id>/`. Threads checked: 24510, 28274, 30281, 32511, 11344, 14022, 29882, 34333, 35576, 36634, 38668. "WoV-tag" is retired; it was not a real source. |

### Critical files for implementation

The repo is empty; these are local copies of the primary PDFs. Extract text with Python zlib, mapping each font through its ToUnicode CMap. Simple TrueType fonts are 1 byte per code even when the CMap's codespace says 2.
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793230148125-rd89pu.pdf (Clearwater STW rule card)
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793229837267-evj1ys.pdf (STW Lucky Roll overview, WSGC)
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793229904808-vmetx5.pdf (Interblock Craps/Crapless/Easy v2.5.1)
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793230364898-0yxiiv.pdf (Interblock Craps v2.2.1: come-out place/buy resolution, Exc Lay/Buy, puck settings)
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793230137994-rtxne6.pdf (Roll to Win overview)
- /Users/jameslerner/.claude/projects/-Users-jameslerner-bubble-craps-simulator-craps-simulator/fb794ffc-14fa-418a-a22d-8fd26e54ea9d/tool-results/webfetch-1793229812049-uzxcw6.pdf (Pennsylvania ch. 623c)