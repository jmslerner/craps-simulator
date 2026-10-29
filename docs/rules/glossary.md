# Coach metrics glossary

Every number the coach shows is one of the metrics below. The coach computes each one exactly, as a fraction, in `src/exact/` from the active machine config, and shows this definition under "Show math". The definitions come from the implementation plan (§5.1). The example values come from the rules spec (`docs/rules/rules-spec.md`), where the tag [M] marks exact math; they are test expectations, never typed into coach content.

## Notation

| Symbol | Meaning |
|---|---|
| s | The bet's stake (amount), in cents |
| w | Ways to roll a number N out of 36: 3 for 4/10, 4 for 5/9, 5 for 6/8, 1 for 2/12 and 2 for 3/11 (crapless) |
| P(event) | Exact probability under fair dice: 36 equally likely ordered rolls |
| E[X] | Exact expected value of X |
| π(comeOut), π(point) | The long-run share of rolls that are come-out rolls, or point-phase rolls; π(point) = 1 − π(comeOut) |
| policy | "Leave it up until it loses or is resolved": a winner that the machine keeps up (`afterWin: stay`) rides on, and nothing is taken down by hand |

Amounts are cash flows between the player's bankroll and the table. A stake that stays on the table after a win counts as returned and wagered again.

## Bet-level metrics

### Decision

One win, loss or push of a bet. A bet that stays up after winning starts a new decision. A push counts as a decision with a zero result; this includes odds returned because they were OFF when their parent was decided.

### Amount risked

Over a bet's lifecycle under the policy:

  R = Σ_decisions stake + Σ commission paid up front

Commission paid up front is the vig charged at placement and on increases, and the vig re-collected when a winner stays up (`rearm`), whether the win or credit pays it: each pays for a decision still to come. Refunded vig is subtracted. Commission deducted from a win (`timing: onWin`) is **not** added: it only reduces what the win returns, so it counts in the loss L and not in R. This is rules spec §0.1's divisor ("stake + vig" for up-front vig, the stake alone otherwise), and it gives the published edges (plan §0 #22).

### Edge

  edge = E[L] / E[R]

L is the lifecycle loss: everything the player put in (stakes and commission) minus everything returned (stakes returned or left up, plus winnings credited). R is the amount risked above.

- When every decision is independent and identical, the edge equals the textbook per-decision house edge. Examples: place 6 at 7:6, 1/66; traditional pass, 7/495; crapless pass, 373/6930; don't pass bar 12, 3/220 (ties counted).
- When up-front vig is charged once and not re-collected (`rearm: none`), the lifecycle is the honest long-run figure. Buy 4 with 5% up front:
  - Each decision wins with P = 1/3 and stays up, so E[decisions] = 3/2.
  - E[R] = 3/2 × s + s/20 and E[L] = s/20 (the final lost stake is offset by the expected winnings).
  - edge = 1/31. With the vig re-collected on every win (`recollectFromWin`), it is 1/21.
- Buy 4 with 5% of the stake taken from each win (Shoot To Win): R holds only the stakes, E[R] = 3/2 × s, and each decision loses s/60 on average, so E[L] = 3/2 × s/60 and the edge is 1/60, the published value. Adding the commission to R would give 1/61.

### Nominal edge and breakage

- **Nominal edge:** the edge with exact, unrounded payouts and commission (settlement in `exact` mode).
- **Breakage** at the user's stake s:

  breakage(s) = edge(s) − nominal edge

  Example: $5 on place 6, floored to the cent, pays $5.83 instead of $5.8333…. Its edge is 17/1100 against a nominal 1/66, so its breakage is 1/3300. At $6 the breakage is 0.

### Edge per working roll

  edge per working roll = E[L] / (E[working rolls] × s)

Working rolls are the rolls on which the bet is ON and can be decided. For a bet on N against 7 it equals the edge × (w + 6)/36. Place 6 is 1/66 × 11/36 = 1/216.

### Equity (value from now)

The expected cash a bet already on the table will still return to the player, from the current state under the policy:

  V(bet, state) = E[cash returned from now on]

A $10 crapless pass bet on point 2 has V = 2 × $10 × 1/7 = $20/7 ≈ $2.86: it wins $10 plus its stake with P = 1/7. That is why it cannot come down: a contract bet's equity is below its stake.

### Decision cost

The expected loss an action locks in:

  decision cost = outlay − ΔV

Outlay is the cash the action moves from the bankroll to the table, including vig. ΔV is the change in the total equity of the player's bets. Placing a $6 place 6 costs $6 − V, where V is that bet's equity once it is placed.

### Combined edge with odds

  combined edge = E[loss on the flat bet] / (flat + E[odds wagered])

Odds never change the flat bet's expected loss; they only add money wagered at zero edge. With k× odds:

| Bet | Combined edge | At 2× |
|---|---|---|
| Traditional pass | (7/495) / (1 + 2k/3) | 1/165 |
| Crapless pass | (373/6930) / (1 + 5k/6) | 373/18480 |
| Don't pass, lay capped by the win (standard) | (3/220) / (1 + k) | 1/220 |
| Don't pass, lay capped by the stake | (3/220) / (1 + 2k/3) | 9/1540 |

2k/3 and 5k/6 are the expected odds per flat bet: a point is set with P = 2/3 (traditional) or 5/6 (crapless).

**Wording rule:** odds lower the edge per dollar wagered, but never reduce the flat bet's expected loss in dollars.

## Layout and time metrics

### Standing cost per roll

The long-run expected loss per roll if you keep the bet up and re-bet it whenever allowed (the layout meter). Every formula is exact and based on renewal: the expected loss per bet or decision times how many are made per roll. Where that rate has no closed form, it comes from the exact renewal solve:

| Bet type | Standing cost per roll |
|---|---|
| numberVsSeven, hardway, oneRoll | s × edge per working roll × π(phases where it works): 1 if it works on every roll, π(point) if it is OFF on the come-out |
| pass | loss per decision × π(comeOut) |
| come | loss per decision × (1 − π(comeOut)) |
| Fire (`uniquePointsMade`) | loss per bet ÷ E[rolls per hand] |
| `collectSet` placed `afterSevenOrStart`, ending on any 7 (Interblock Lucky Roller) | loss per bet × 1/6. A new bet waits for a 7 and every 7 ends the bet, so exactly one bet is made per 7 |
| `collectSet` placed `noneOfTypeActive` (Shoot To Win Lucky Roller) | loss per bet ÷ E[rolls per bet]. A completed set can be bet again before any 7, so more than 1/6 of a bet is made per roll; E[rolls until the set is complete or a 7], which is below 6, comes from the exact renewal solve |
| `collectSet` placed `newHand` | loss per bet ÷ E[rolls per hand]: one bet per hand |

| Constant | Traditional | Crapless |
|---|---|---|
| E[rolls per pass decision] | 557/165 | 9613/2310 |
| π(comeOut) = 1 / E[rolls per pass decision] | 165/557 | 2310/9613 |
| E[rolls per hand] | 1671/196 | 57678/7303 |

A $10 crapless pass costs 10 × 373/6930 × 2310/9613 = 3730/28839 dollars per roll, about 12.93¢. Odds add nothing to it.

**Check (identity):** for every bet, the π formula equals the lifecycle loss ÷ the lifecycle rolls, from the same exact solve.

### Per hour

  per hour = per roll × `pace.rollsPerHour`

The rate comes from the machine config: 120 for the Interblock presets, 100 for Shoot To Win and 144 for the live table, all assumed or reported (rules spec §8.3). The coach always also shows the 60 to 150 rolls per hour range. A $10 crapless pass with 2× odds costs about $12.93 per hour at 100 rolls per hour.

## Session metrics (session summary)

- **Wealth:** W = bankroll + Σ equity of the bets on the table.
- **Luck:** the change in W caused by a roll. Its expected value is 0, because every equity is already an expectation under the policy.
- **Identity:** W_end − W_start = Σ luck − Σ decision cost. It holds exactly over any session, so the summary splits a result into luck and decision cost.
- **Leaks:** the decision cost the player could have avoided with a `sameEvent` alternative: a cheaper bet that wins and loses on exactly the same rolls (e.g. buy 4 instead of place 4).

## Rules-spec terms

These appear in the rules spec's tables.

| Term | Meaning |
|---|---|
| HE_res | Expected loss ÷ stake per decision; pushes count as decisions unless marked. For up-front vig the divisor is stake + vig unless marked "per stake" |
| HE_roll | Expected loss per roll while the bet works, per $1 staked: HE_res × P(decided on a roll). One-roll bets: HE_roll = HE_res |
| Lifecycle edge | The edge above |
| Hand | Every roll from the first come-out after a seven-out (or the start of the session) through the next seven-out. "Shooter" in side-bet rules means hand |
