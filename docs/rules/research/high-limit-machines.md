# High-limit bubble craps: posted stakes and limits (researched 2026-10-29)

Research for the `craplessBubbleHighLimit` preset: the user asked to "raise the stakes and
betting limits like the Venetian hotel". This file records every number found, its source and
date, and how each preset value was derived. **No high-limit machine's par sheet or posted limit
card could be verified online**, so the preset's limits are `reported` where a real machine's
number was reported, and `assumed` where a value is mapped from the Venetian's live tables or
scaled from a reported standard machine. Tags follow `machines.md`: [C] confirmed, [P] plausible
(one credible source), [F] forum/anecdote, [UNVERIFIED].

## 1. The Venetian specifically

| Fact | Value | Source (accessed 2026-10-29) | Tag |
|---|---|---|---|
| Live craps odds | 3-4-5× on traditional craps; **1-2-3-4-5× on crapless craps** | vegasadvantage.com/casino-hotel/strip/venetian/ (page updated 2026-10-27) | [P] |
| Live crapless offered | Yes (named on the Venetian page) | same | [P] |
| Table minimums | "usually start at $25 and run to $100 and more" (all table games) | same | [P] |
| Live craps minimum | $15–$25 | blog.jb.com/craps/casinos-in-vegas ("Best Craps Tables in Las Vegas", 2026 guide) | [P] |
| Live craps maximum | $5,000, named among the casinos with that practical maximum (3-4-5× odds listed alongside) | crapshero.com/craps/vegas/ (~2023); onthestrip.com/casinos/craps-on-the-las-vegas-strip/ ("the Wynn, the Venetian, the Palazzo and Mandalay Bay allow players to bet this amount") | [P ×2] |
| Bubble craps at the Venetian | "$5 min about a month ago" (2022 forum post); no current source found | tripadvisor / forum via search; vegasadvantage Venetian page does not mention electronic craps | [F] |
| Roll to Win at the Venetian | Not found: no source places a Roll to Win table or its limits at the Venetian | searches 2026-10-29 | [UNVERIFIED] |

The Venetian's own site publishes no table-limit page that a search could find; its posted
limits change and would need a floor visit (`USER` provenance) to verify.

## 2. High-limit bubble craps machines (Las Vegas)

| Fact | Value | Source (accessed 2026-10-29) | Tag |
|---|---|---|---|
| A high-limit **crapless** bubble machine exists in Las Vegas with a **$20,000 maximum bet** | "$20,000 HIGH LIMIT BUBBLE CRAPS!", "Building up to Max bet on crapless bubble craps!"; a fan-site retelling says "the player places a max bet of $20,000 on a single roll" | WOV-35576 (posts of 2025-06-16, linking the Dicey Craps video of 2025-04-16); youtube.com/watch?v=kiRO21x8WyU; highrollersplay.com retelling | [F + P retelling] |
| Reading of "$20,000 max bet" | The video spreads the amount across the layout for one roll, so it is read as the **most the layout holds for one roll** (a table maximum), not one wager's cap | inference from the retelling ("on a single roll") | [UNVERIFIED reading] |
| Standard (non-high-limit) machine per-bet maximums | Place **$400**; Pass Line **$195**; odds **$390** (= 2× the line maximum); hard ways ≈ **$115**; **$70** on a 16-for-1 bet; **$35** on a 31-for-1 bet | WOV-35576 (post of 2025-06-15 reporting the Color Up "Double Up and Regress" video of 2023-06-01) | [F, one machine] |
| Structure of those maximums | Odds cap = 2× the line cap; high-pay props capped so the largest payout stays near **5.4× the line maximum** ($70 × 15 = $35 × 30 = $1,050 ≈ 5.4 × $195) | arithmetic on the row above | [M on F data] |
| Typical machine minimums | $1–$6 per bet; most bubble craps $3–$5; crapless $1–$6 | vegasadvantage.com/electronic-table-games/ (VA, already a preset source); vegasadvantage craps survey (updated 2026-05-15) | [P] |
| Typical machine odds cap | 2× "on most machines" (unchanged for high-limit: no source reports more) | VA | [P] |
| Other high-limit ETG anecdotes | $25,000 maximum at Seminole Hard Rock (FL, STW, reader comment — not Las Vegas, not crapless) | machines.md §2a [F VV-STW] | [F] |

## 3. How the `craplessBubbleHighLimit` preset uses this

Machine rules (variant, catalog, pays, commission, working rules) are **identical to
`craplessBubble`** — no source reports different *rules* on a high-limit unit, only different
money. Each money value, its provenance status in the preset, and its derivation:

| Preset value | Amount (cents) | Status | Derivation |
|---|---|---|---|
| `/limits/tableMax` | 2_000_000 ($20,000) | reported (WOV-35576) | §2 row 1, under the §2 row 2 reading |
| `/limits/max` | 500_000 ($5,000) | assumed | The Venetian's reported live-craps maximum (§1), mapped onto a machine wager; no machine source |
| `/limits/min` | 500 ($5) | assumed | One credit at the $5 denomination; machine minimums report $1–$6 (§2) |
| `/limits/minTotal/amount` | 2_500 ($25) | assumed | The Venetian's "$25 and up" table minimums (§1), mapped onto Interblock's minimum-total check |
| `/money/betIncrement` | 500 ($5) | assumed | High-limit denomination; Interblock chips and credits scale with denomination (IB §5.1) |
| `/limits/perType/*` maxes | odds and place/buy 1_000_000; hard 300_000; 8-for-1 props 380_000; 16-for-1 props 180_000; 31-for-1 props 90_000; C&E and Horn 360_000 | assumed (WOV-35576) | The §2 structure (odds 2× line, place ≈ 2× line, props capped near 5.4× line exposure), scaled by this machine's $5,000 line maximum: $400→$10,000, $115→$3,000 (= $27,000/9), $70→$1,800, $35→$900; composites at parts × the part's tier |
| `/money/startingBankroll` | 500_000 ($5,000) | assumed | Trainer default sized to the stakes; not a machine value |
| `/chips` | $25 / $50 / $100 / $250 / $500 / $1,000 | assumed | Trainer default; Interblock chip values scale with denomination (IB §5.1) |

**Not** carried into the preset:

- The Venetian's **1-2-3-4-5× crapless odds** (§1) is a live-table rule. The machine keeps the
  2× cap reported for crapless machines (VA, LVA-CL, unchanged from `craplessBubble`): no source
  reports a bubble unit with more than double odds, and VA could not find one either. If the
  user's machine differs, that is a one-line preset edit (M12 "Match My Machine").
- A **traditional** high-limit preset: not added. The only reported traditional-machine maximums
  (§2, $195 pass) are a *standard* machine's; the one reported high-limit unit is crapless. The
  research does not support it.
- The $25,000 Florida STW anecdote (§2): not Las Vegas, not crapless, single reader comment.

## 4. Searches run (2026-10-29)

Venetian + Roll to Win/bubble limits; vegasadvantage bubble craps minimums/maximums; Interblock
high-limit; "Dicey Craps" $20,000; Venetian craps 3-4-5 odds $5,000. Fetched:
vegasadvantage.com/las-vegas-table-game-survey/craps/ (updated 2026-05-15; Roll to Win $5 min,
electronic machines "maximum odds on most machines are double"; casino-by-casino data is
paywalled), vegasadvantage.com/casino-hotel/strip/venetian/ (2026-10-27),
wizardofvegas.com/forum/gambling/craps/35576 (the repo's existing WOV-35576),
youtube.com/watch?v=kiRO21x8WyU (title only; description unavailable to the fetcher). The
vegasmessageboard thread on Strip bubble-craps minimums returned HTTP 403.
