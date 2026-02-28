# Mistakes & Solved Challenges

Things that were difficult to figure out and how we solved them.

---

## Simulator vs Live Trading Discrepancy

**Date**: Feb 2026
**Severity**: High
**Status**: Analyzed, Partially Fixed

### Problem
Simulator showed 50-60% WR while live IBKR showed 75-90% WR, yet live trading was **losing money**. This paradox made no sense.

### Why It Was Hard
- Expected bugs to favor simulator (fake wins), not hurt it
- Multiple bugs compounding in opposite directions
- R:R degradation only visible in live execution logs

### Root Causes Found

1. **Same-bar TP/SL conflict always goes to SL**
   - When both levels touched in same 5-min bar, simulator always counts SL
   - Real bracket orders: whoever hits first wins
   - This HURT simulator WR (explained the 50-60% vs 75-90%)

2. **Market entry degrades R:R**
   - AI sets entry/TP/SL for limit entry
   - Live trader enters at market (worse price)
   - Risk increases, reward decreases
   - Seen: R:R of 0.27 on a trade (breakeven at 78% WR)

3. **Spread calculated but never used**
   - `actualEntry` computed but never referenced
   - Exit checks use mid-price, not bid/ask

### Solution
- Documented in `docs/SIMULATOR_BUG_ANALYSIS.md`
- Live trader now recalculates TP/SL from actual fill price
- Minimum R:R filter recommended

### Lesson Learned
When metrics don't make sense, there are usually MULTIPLE bugs. Don't stop at the first one found.

---

## Risk-Win Correlation Not Working

**Date**: Feb 21, 2026
**Severity**: Medium
**Status**: Partially Solved (Iter5)

### Problem
Confidence agent giving similar risk (0.45-0.55) to both wins and losses. No correlation between assigned risk and actual outcomes.

### Why It Was Hard
- EMA alignment alone seemed like a good indicator
- "COHERENT" assessment passed on 80% of losses
- Needed to distinguish "technically aligned" from "strongly aligned"

### Root Cause
- Iter4 only checked IF EMA aligned, not HOW MUCH
- Weak EMA slopes got same treatment as strong ones
- Regime/structure mismatches not detected

### Solution (Iter5)
1. Added coherence check (regime matches structure?)
2. Added trend quality assessment (slope strength)
3. Added market decisiveness check
4. Sizing recommendations: FULL/REDUCED/MINIMAL/SKIP

### Lesson Learned
Binary checks (aligned/not aligned) lose information. Use gradients (weak/medium/strong).

---

## Long Bias in Direction Agent

**Date**: Feb 2026
**Severity**: Low
**Status**: Known, Not Fixed

### Problem
67-69% of trades are LONGs, regardless of market conditions.

### Why It's Hard
- Direction agent prompt doesn't explicitly favor longs
- May be data bias (EUR/USD trending in sample period)
- May be prompt framing bias ("look for opportunities" vs "find shorts")

### Current State
- Documented in model limitations
- Not prioritized (still profitable overall)

### Lesson Learned
Check directional balance early in development. Bias compounds over iterations.

---

## Data Format Incompatibility (OANDA vs IBKR)

**Date**: Feb 2026
**Status**: Solved

### Problem
Historical data from OANDA had different timestamp format than IBKR data. Batch trainer couldn't parse dates.

### Root Cause
- IBKR: `20260220  14:30:00`
- OANDA: `2026-02-20T14:30:00.000Z`

### Solution
Added flexible date parser that handles both formats:
```javascript
function parseDate(str) {
  // Try IBKR format first
  const ibkr = str.match(/^(\d{8})\s+(\d{2}:\d{2}:\d{2})/);
  if (ibkr) { /* parse IBKR */ }
  // Fall back to ISO format
  return new Date(str);
}
```

### Lesson Learned
Always normalize data formats at ingestion, not parsing time.

---

## API Cost Overruns in Iteration Loop

**Date**: Feb 2026
**Status**: Solved

### Problem
Auto-iteration burned through budget faster than expected. €10 budget ran out in 15 iterations instead of estimated 50+.

### Root Cause
- Claude mutations were expensive (€0.25 each)
- Mutations triggered after only 5 stuck iterations
- Multiple mutations per session

### Solution
- Added budget tracking with per-iteration cost logging
- Added mutation cost warning
- Set STUCK_THRESHOLD to 5 (was 3)
- Added `ITERATION_BUDGET_EUR` env var for explicit control

### Lesson Learned
Track costs PER OPERATION, not just total. Identify expensive operations early.

---

## Iter6: Position-Based Range Fading Failed

**Date**: Feb 28, 2026
**Severity**: High
**Status**: Understood, Reverting

### Problem
Iter6 changed direction logic to "fade the edges" - LONG at support (0-30%), SHORT at resistance (70-100%). Win rate dropped from 42% to 15%.

### Why It Was Hard
- Analysis showed SHORT at support = losses (correct observation)
- Logical fix: "fade edges instead of follow EMA"
- But this assumed markets were ranging when they were trending

### Root Cause
**Position-based fading fights trends.** The analysis was correct that shorting at support loses, but the solution was wrong:

| Scenario | Iter5 | Iter6 | Correct |
|----------|-------|-------|---------|
| Strong uptrend, price at "resistance" | SHORT (follow EMA) | SHORT (fade resistance) | LONG (follow trend) |
| Range, price at resistance | SHORT (follow EMA) | SHORT (fade resistance) | SHORT (correct) |

The fix only worked in ranges. In trends, fading the "edges" means fighting the trend.

### Data That Proved It
```
Iter5: 42.3% WR, -2.40R (followed EMA)
Iter6: 14.8% WR, -3.25R (faded edges)
```
Iter6 trades: "Direction is valid as it aligns with resistance zone" → SL hit repeatedly.

### The Real Pattern (from win/loss analysis)
```
SHORT Win Rate: 29% (too many shorts)
LONG Win Rate: 67%
```
The problem wasn't "shorting at support" - it was **too many shorts period**. The market was bullish.

### Solution
**Trend detection BEFORE position fading:**
1. IF |EMA slope| > 0.15 → Strong trend → Follow EMA direction
2. IF |EMA slope| < 0.10 → Weak/range → Apply position fading
3. NEVER fade in direction opposite to strong trend

### Lesson Learned
**Don't apply range logic to trending markets.** Position-based rules (fade edges) only work when the market is actually ranging. Always check trend strength FIRST.

---

## Template

Use this format for new entries:

```markdown
## [Title]

**Date**: [When discovered]
**Severity**: High/Medium/Low
**Status**: Solved/Partially Solved/Known

### Problem
[What went wrong]

### Why It Was Hard
[Why this wasn't obvious]

### Root Cause
[What was actually wrong]

### Solution
[How we fixed it]

### Lesson Learned
[What to remember for the future]
```

---

[Back to STRUCTURE](STRUCTURE.md)
