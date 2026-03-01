# Iteration 12 — Changes from Iter11 (GPT-5, Market Order)

**Performance**: 34.5% WR, -3.26R — REGRESSION
**Code was never committed** — tested, found to be a regression, reverted.
**Only record**: `models/gpt5_market_order_20260228/iterations/iter12_disguised_trends.md`

---

## What Changed from Iter11

### Direction Agent Changes

1. **Added range character classification** to user prompt data:
   - `TRUE_RANGE`: structureLabel=RANGE AND |emaSlope| < 0.10
   - `DIRECTIONAL_RANGE`: structureLabel != RANGE OR |emaSlope| >= 0.10

2. **Added range size in pips** to user prompt:
   - NARROW (<20 pips) / NORMAL / WIDE (>40 pips)

3. **Added EMA50 magnitude numeric value** to user prompt

4. **System prompt rewrite** — two-part RANGE logic:
   - `TRUE_RANGE`: use range-fading (buy support, sell resistance)
   - `DIRECTIONAL_RANGE`: trade WITH structure direction (don't fade)
   - NARROW ranges with directional structure: expect breakout

5. **Added TREND location awareness**:
   - Avoid SHORT in bottom 20% of S/R
   - Avoid LONG in top 80% of S/R

### Confidence Agent Changes

1. Added S/R position to data section
2. Added range character to data section
3. Two-part RANGE alignment in prompt:
   - `TRUE_RANGE` alignment = direction matches LOCATION
   - `DIRECTIONAL_RANGE` alignment = direction matches STRUCTURE
   - REJECT range-fading against structure in disguised trends

---

## Why Iter12 Failed — Post-Mortem

The hypothesis was based on Iter11 Run 2 showing "0/7 WR for directional structure in RANGE" — but Iter11 Run 1 had **72.7% WR (8/11)** for the exact same category.

The "0/7" was **small-sample variance** (30 scenarios per run is noisy).

Iter12's structure-following in DIRECTIONAL_RANGE put trades at **bad locations** — buying high, selling low — resulting in ~28% WR for DIRECTIONAL_RANGE trades.

**Key lesson**: Position-based fading works in ALL ranges regardless of structure direction. Do not try to classify range subtypes.
