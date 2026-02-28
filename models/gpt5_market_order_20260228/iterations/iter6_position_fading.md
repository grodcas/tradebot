# Iteration 6: Position-Based Fading (FAILED)

**Date**: Feb 28, 2026
**Status**: REVERTED - Made performance worse

## Changes Made

Changed direction logic to "fade the edges":
- 0-30% position → BULLISH (at support, expect bounce)
- 70-100% position → BEARISH (at resistance, expect rejection)
- 30-70% position → NEUTRAL (no edge)
- "EMA doesn't matter in ranges, position does"

## Test Results

| Metric | Iter5 | Iter6 | Change |
|--------|-------|-------|--------|
| Win Rate | 42.3% | **14.8%** | -27.5% |
| Weighted R | -2.40R | **-3.25R** | -0.85R |
| Executed | 26 | 27 | +1 |

## Why It Failed

### Root Cause
**Position-based fading fights trends.** The fix assumed markets were ranging when they were actually trending.

### The Mistake
```
Observation: "SHORT at support = loses"
Wrong conclusion: "Fade edges - LONG at support, SHORT at resistance"
Right conclusion: "Market was trending UP, follow the trend"
```

### Example Failures
| Trade | Position | Direction | EMA | Result |
|-------|----------|-----------|-----|--------|
| #5 | 88% | SHORT | -0.25 | SL (trend broke resistance) |
| #7 | 84% | SHORT | -0.15 | SL (trend broke resistance) |
| #12 | 93% | SHORT | -0.20 | SL (trend broke resistance) |

All "correct" per position rules, all lost because **the market was trending, not ranging**.

### Data That Proves It
Looking at losses:
- "range market regime with low breakout score" = analysis said range
- But price kept breaking through "resistance" = actually trending

## Lesson Learned

**Don't apply range logic to trending markets.**

Position fading (LONG at support, SHORT at resistance) only works when:
1. EMA slope < 0.10 (confirmed range)
2. Breakout score near 0 (no momentum)

If EMA slope > 0.15, it's a TREND → follow the trend, ignore position.

## Fix Applied
→ Iter7: Check trend strength FIRST, only fade if confirmed range

---

**Referenced in**: [docs/MISTAKES.md](../../../docs/MISTAKES.md) - "Iter6: Position-Based Range Fading Failed"
