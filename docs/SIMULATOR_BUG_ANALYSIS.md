# Simulator Bug Analysis - Deep Dive

**Date**: 2026-02-27
**Status**: Identified - Not Fixed
**Severity**: High
**Files**: `src/batch_trainer.js`, `src/live_trader.js`

---

## The Paradox

| Environment | Win Rate | Profitability |
|-------------|----------|---------------|
| Simulator (batch_trainer.js) | 50-60% | Unknown |
| Live IBKR (real bracket orders) | 75-90% | **LOSING MONEY** |

This is counterintuitive. If the simulator had bugs that "cheated" in its favor, it should show HIGHER win rates, not lower.

---

## Summary

The `simulateTrade` function has critical bugs that cause backtested results to be **overly optimistic** compared to live trading. Limit orders are assumed to fill instantly, and spread is calculated but never applied.

---

---

## ROOT CAUSE ANALYSIS

### Why Simulator WR is LOWER than Live

**Bug: Same-Bar TP/SL Conflict Always Goes to SL**

In `batch_trainer.js` lines 274, 280:
```javascript
if (hitSL && hitTP) return { outcome: "SL", ... };
```

And identically in `live_trader.js` lines 465-481:
```javascript
if (bar.low <= sl) {
  outcome = 'SL';  // Checked FIRST
} else if (bar.high >= tp) {
  outcome = 'TP';  // Only if SL not hit
}
```

**Impact:**
- When BOTH levels are touched in the same 5-min bar, simulator counts it as LOSS
- In reality with IBKR bracket orders, whichever level is hit FIRST wins
- This could easily be 50/50 in real trading
- This HURTS simulator win rate compared to live

**Example:**
- 5-min bar range: Low=1.1795, High=1.1825
- Position: LONG, SL=1.1800, TP=1.1820
- Both levels touched in same bar
- Simulator: LOSS (SL checked first)
- Live IBKR: Could be WIN if TP was hit first in real-time

---

### Why Live IBKR is LOSING MONEY Despite High WR

**Issue: Market Entry with Limit-Based TP/SL**

The AI sets Entry/TP/SL assuming a LIMIT entry at a specific price.
When you enter at MARKET instead:

1. **Entry is often WORSE than AI's intended price**
2. **Risk to SL becomes LARGER (more pips)**
3. **Reward to TP becomes SMALLER (fewer pips)**
4. **R:R degrades significantly**

**Example:**
```
AI Decision:     Entry=1.1800 (LIMIT), SL=1.1780, TP=1.1830
                 Risk=20 pips, Reward=30 pips, R:R=1.50

Market Entry:    Filled at 1.1810 (10 pips worse)
                 Risk=30 pips (to same SL), Reward=20 pips (to same TP)
                 R:R = 0.67 (WORSE THAN 1:1!)
```

**Math with degraded R:R:**
- 80% WR × 0.67R wins = +0.536R
- 20% × 1.0R losses = -0.20R
- Expected = +0.336R per trade

Still profitable... BUT add spread costs:
- 0.8 pips spread on entry
- 0.8 pips spread on exit
- Adds ~1.6 pips to every trade's cost
- On a 20-pip risk trade, that's 8% drag

**The Real Killer: AI Setting R:R < 1.0**

Observed in live trading today:
```
[EURUSD] MARKET filled at 1.18178 | Adjusted TP: 1.18248 SL: 1.17918 (R:R 0.27)
```

With R:R = 0.27:
- 80% WR × 0.27R = +0.216R wins
- 20% × 1.0R = -0.20R losses
- Expected = +0.016R per trade (breakeven)
- Add spread = NEGATIVE expectancy

---

## Bug 1: Limit Order Fill NOT Simulated

### Location
`batch_trainer.js` lines 265-267

### Problem
The simulator **assumes the limit order fills immediately** at `entryIndex`. It never checks if price actually reached the entry level before starting TP/SL monitoring.

```javascript
const start = entryIndex + 1;  // Starts checking TP/SL from next bar
const end = Math.min(bars5m.length, start + forwardBars);

for (let i = start; i < end; i++) {
  // Immediately checks for TP/SL without verifying entry filled
}
```

### Impact
- AI sets LIMIT SHORT @ 1.18115
- Current price: 1.18080 (below entry)
- Simulator immediately starts checking for TP hit
- If next bar's low touches TP, it counts as a WIN
- **The trade never actually entered, but simulator counts it as a win**

### Fix Required
Add loop before TP/SL checking that waits for price to reach entry:
- LONG LIMIT: Wait for `bar.low <= entry` (or `bar.ask <= entry`)
- SHORT LIMIT: Wait for `bar.high >= entry` (or `bar.bid >= entry`)

---

## Bug 2: Spread Calculated But Never Used

### Location
`batch_trainer.js` lines 261-263

### Problem
```javascript
const entryAsk = entry + spread / 2;
const entryBid = entry - spread / 2;
const actualEntry = side === "LONG" ? entryAsk : entryBid;  // NEVER USED!
```

The `actualEntry` variable is calculated but **never referenced** anywhere in the function. All subsequent checks use the raw `entry`, `tp`, and `sl` values without spread adjustment.

### Impact
- Entry slippage from spread is ignored
- R calculations are overly optimistic
- A 4.2 pip risk trade with 0.8 pip spread actually has ~19% worse entry than simulated

---

## Bug 3: TP/SL Detection Uses Mid-Price Only

### Location
`batch_trainer.js` lines 271-283

### Problem
```javascript
if (side === "LONG") {
  const hitSL = b.low <= sl;   // Mid-price low
  const hitTP = b.high >= tp;  // Mid-price high, should be BID
} else {
  const hitSL = b.high >= sl;  // Mid-price high
  const hitTP = b.low <= tp;   // Mid-price low, should be ASK
}
```

### Correct Logic
| Position | Exit Type | Actual Price Needed |
|----------|-----------|---------------------|
| LONG | TP | SELL at BID = mid - spread/2 |
| LONG | SL | SELL at BID = mid - spread/2 |
| SHORT | TP | BUY at ASK = mid + spread/2 |
| SHORT | SL | BUY at ASK = mid + spread/2 |

### Impact
- SHORT TP at 1.18075 triggers when `bar.low = 1.18070`
- But actual ASK at that moment ≈ 1.18074 (barely hits)
- Edge cases incorrectly counted as clean wins
- Especially problematic for tight TP targets (< 5 pips)

---

## Example Scenario

### AI Decision
```
Side: SHORT
Entry: 1.18115 (LIMIT)
TP: 1.18075 (4.0 pips)
SL: 1.18142 (2.7 pips)
```

### What Simulator Does
1. Decision made at bar index 100
2. Immediately starts checking TP/SL from bar 101
3. Bar 101: low = 1.18070 → `1.18070 <= 1.18075` → **TP HIT!**
4. Records +1.48R win

### What Actually Happens (Live)
1. LIMIT order placed at 1.18115
2. Price is at 1.18080, never rises to 1.18115
3. Order sits unfilled for hours
4. Eventually cancelled or price moves away
5. **No trade executed**

---

## Impact on Training Results

| Metric | Simulated | Likely Real |
|--------|-----------|-------------|
| Win Rate | ~78% | ~55-65% |
| Avg Win | +0.57R | +0.45R |
| Fill Rate | 100% | ~40-60% |
| Total R | +42.62R | Unknown |

The 78% win rate includes trades that **would never have filled** in real markets.

---

## Recommended Fixes

### 1. Add Limit Order Fill Simulation
```javascript
// Before TP/SL loop, add fill check loop:
let fillIndex = -1;
for (let i = start; i < end; i++) {
  const b = bars5m[i];
  if (side === "LONG" && b.low <= entry - spread/2) {
    fillIndex = i;
    break;
  } else if (side === "SHORT" && b.high >= entry + spread/2) {
    fillIndex = i;
    break;
  }
}

if (fillIndex === -1) {
  return { outcome: "NO_FILL", exitPrice: entry, exitIndex: end-1, barsToExit: 0 };
}

// Then start TP/SL checking from fillIndex + 1
```

### 2. Apply Spread to Exit Checks
```javascript
if (side === "LONG") {
  const hitSL = b.low - spread/2 <= sl;   // Exit at BID
  const hitTP = b.high - spread/2 >= tp;  // Exit at BID
} else {
  const hitSL = b.high + spread/2 >= sl;  // Exit at ASK
  const hitTP = b.low + spread/2 <= tp;   // Exit at ASK
}
```

### 3. Track Fill Statistics
Add metrics for:
- Fill rate (% of signals that actually fill)
- Average time to fill
- Slippage from intended entry

---

## Files Affected

| File | Lines | Issue |
|------|-------|-------|
| `src/batch_trainer.js` | 258-288 | Main simulation bugs |
| `src/iteration_loop.js` | TBD | May have same issues |
| `src/live_trader.js` | TBD | Live version may differ |

---

## Notes

- These bugs cause **backtested results to be unrealistically good**
- Live trading with OANDA shows the real behavior (orders sit pending)
- The trained AI models may have learned from flawed feedback
- Consider re-training after fixing simulator

---

## COMPLETE FINDINGS SUMMARY

### Why Simulator Shows 50-60% WR (Lower Than Expected)

1. **Same-bar conflict bias**: When both TP and SL hit in same bar, ALWAYS counts as SL
2. This actually HURTS simulator performance
3. Real bracket orders would win some of these conflicts

### Why Live IBKR Shows 75-90% WR

1. Real OCO bracket orders properly resolve same-bar conflicts
2. Whichever level is hit first in real-time wins
3. Explains ~15-30% WR improvement over simulator

### Why Live IBKR LOSES MONEY Despite High WR

1. **Market entry degrades R:R**: AI's TP/SL are designed for specific entry, not market entry
2. **AI sometimes sets R:R < 1.0**: Seen today with 0.27 R:R trade
3. **Spread costs compound**: Entry + exit spread adds ~8% drag on small trades
4. **Position sizing doesn't help**: Weighted R doesn't change the underlying math

### The Core Problem

The simulator and live trading measure SUCCESS differently:

| Simulator | Live Reality |
|-----------|--------------|
| Enters at AI's limit price | Enters at market (worse) |
| Same-bar = SL | Same-bar = whoever first |
| No spread cost | ~0.8 pip each direction |
| R calculation uses AI's entry | R should use actual entry |

### Recommendations

1. **Fix same-bar conflict**: Randomize or check bar internals (use tick data if available)
2. **Simulate market entry**: Enter at bar.close + spread, not at AI's limit price
3. **Recalculate TP/SL for market entry**: Maintain R:R ratio from actual entry (DONE in TRADEBOT_live)
4. **Add minimum R:R filter**: Reject trades with R:R < 1.0
5. **Track fill rate**: Not all limit orders fill - this should be simulated

### Code Locations

| Issue | File | Lines |
|-------|------|-------|
| Same-bar bias (simulator) | batch_trainer.js | 274, 280 |
| Same-bar bias (live paper) | live_trader.js | 465-481 |
| No limit fill simulation | batch_trainer.js | 265-267 |
| Spread calculated but unused | batch_trainer.js | 261-263 |
| R:R validation missing | orchestrator.js | None (should add) |

---

[Back to STRUCTURE](STRUCTURE.md)
