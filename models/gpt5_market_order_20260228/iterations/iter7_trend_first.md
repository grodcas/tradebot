# Iteration 7: Trend Detection First

**Date**: Feb 28, 2026
**Status**: PARTIAL IMPROVEMENT - Better than Iter6, worse than Iter5

## Changes Made

Rebalanced logic to check trend strength BEFORE position:

```
IF |EMA slope| > 0.15:
   → STRONG TREND → Follow EMA direction (ignore position)

IF |EMA slope| < 0.10:
   → RANGE → Apply position fading (LONG at support, SHORT at resistance)
```

### Decision Matrix
| EMA Slope | Position 0-30% | Position 30-70% | Position 70-100% |
|-----------|----------------|-----------------|------------------|
| Strong UP (>0.15) | BULLISH | BULLISH | BULLISH |
| Strong DOWN (<-0.15) | BEARISH | BEARISH | BEARISH |
| Weak/Flat (<0.10) | BULLISH | NEUTRAL | BEARISH |

## Test Results

| Metric | Iter5 | Iter6 | Iter7 |
|--------|-------|-------|-------|
| Scenarios | 30 | 30 | 30 |
| Executed | 26 | 27 | 28 |
| **Win Rate** | 42.3% | 14.8% | **28.6%** |
| **Weighted R** | -2.40R | -3.25R | **-0.91R** |

## Analysis

### What Improved
- Win rate doubled vs Iter6 (15% → 29%)
- R improved significantly (-3.25R → -0.91R)
- Fewer skips (2 vs 4) - more trades executed
- Trend-following logic working better than pure position fading

### What Still Fails
- Still worse than Iter5 baseline (42% → 29%)
- Many losses still in "RANGE market regime"
- AI calls "strong trend" but market is actually ranging
- SHORT bias still present

### Example Pattern (from output)
```
[CONFIDENCE] Probability: 70%
[CONFIDENCE] Strong trend down with proposed direction matching the trend
SHORT @ 1.18790 → SL hit
Analysis: RANGE market regime...
```
**Problem**: AI says "strong trend" but market was actually ranging.

## Lesson Learned

The 0.15 slope threshold may be too low to reliably detect trends. The AI is classifying ranges as trends and following them to losses.

## Next Steps

Options for Iter8:
1. **Raise trend threshold** to 0.20 or 0.25 (more conservative)
2. **Add secondary confirmation** (breakout score, structure state)
3. **Revert to Iter5** and only add market order awareness (no direction changes)

Recommended: **Option 3** - The original Iter5 logic had 42% WR. Only add market order entry mechanics, don't change direction logic.
