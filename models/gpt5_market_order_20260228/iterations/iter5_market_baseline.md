# Iteration 5: Market Order Baseline

**Date**: Feb 28, 2026
**Status**: Baseline for market order trading

## Changes Made

Adapted Iter5 prompts for market order reality:
- Entry happens at CURRENT PRICE (not ideal levels)
- Minimum SL distance = 1.0 ATR (wider stops for noise)
- Added `recommendation: EXECUTE | SKIP` to levels agent
- Added `current_price_location` assessment

## Test Results

| Metric | Value |
|--------|-------|
| Scenarios | 30 |
| Executed | 26 |
| Skipped | 4 |
| **Win Rate** | **42.3%** |
| **Weighted R** | **-2.40R** |

## Analysis

This was the baseline after fixing the simulator to use market orders instead of perfect fill at AI entry.

### What Worked
- SKIP logic filtering bad setups
- Conservative sizing (MINIMAL/REDUCED)
- Wait/retry mechanism

### What Failed
- **SHORT bias**: 12 SHORT losses vs 3 LONG losses
- SHORT WR: 29%, LONG WR: 67%
- Shorting at support (wrong)

### Key Insight
The AI had a SHORT bias and was shorting at support levels, fighting bounces.

## Next Steps
→ Iter6: Add position-based direction logic
