# Simulator Bug Analysis

**Date**: 2026-02-27
**Status**: Identified - Not Fixed
**Severity**: High
**File**: `src/batch_trainer.js` (lines 258-288)

---

## Summary

The `simulateTrade` function has critical bugs that cause backtested results to be **overly optimistic** compared to live trading. Limit orders are assumed to fill instantly, and spread is calculated but never applied.

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
