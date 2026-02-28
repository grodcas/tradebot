# Iter11: Fix RANGE Trading

## Problem
Iter10 showed TREND trades are profitable (44% WR, +1.00R) but RANGE trades are catastrophic (13% WR, -4.79R). 13/30 trades were skipped — all RANGE — and 9 of those would have been winners (69% WR).

Two root causes:
1. Direction agent can't trade ranges: 5 prompt instructions compound to make NEUTRAL the only possible output in RANGE
2. Confidence agent has structural bias against RANGE: `structureAligned` is always `false` when `structureState === 0`

## Changes

### 1. Direction Agent Prompt Rewrite (`src/agents/direction_agent.js`)

**Removed 5 NEUTRAL-forcing instructions:**
- `"Mixed or contradicting = NO TRADE (output NEUTRAL)"` — RANGE is by definition mixed
- `"Middle of range = no edge"` — data shows many mid-range trades win
- `"When in doubt, output NEUTRAL"` — explicit skip bias
- `"Mixed (e.g. LH + HL) = Range or transition → be cautious"` — redundant RANGE-is-bad signal
- `"Is it stuck in the middle of a range (no edge)?"` — primes model to skip

**Replaced STEP 4 with regime-specific confluence rules:**
- TREND: keep existing logic (44% WR is working). ALL THREE or TWO agree → trade. Only NEUTRAL if all timeframes truly contradict.
- RANGE: position-based logic:
  - Bottom 30% of S/R range → favor LONG
  - Top 70%+ → favor SHORT
  - Middle (30-70%) → use daily trend / EMA as tiebreaker
  - Below support → SHORT if momentum confirms break, LONG if false break
  - Above resistance → LONG if momentum confirms break, SHORT if false break

**Added critical rule:** "You MUST output BULLISH or BEARISH. Only output NEUTRAL as absolute last resort."

**Changed output format hint:** trade_idea now says "Specific trade idea with entry direction and key level" (removed "No clear setup - wait").

### 2. Direction Agent Data Enhancement

Added **Position in S/R range** to data sent to model:
```
Position in S/R range: X% (0%=at support, 100%=at resistance)
```
Computed as: `(currentPrice - support) / (resistance - support) * 100`

### 3. Confidence Agent Code Fix (`src/agents/confidence_agent.js`)

Fixed `structureAligned` for RANGE regime. Previously always `false` when `structureState === 0`.

Now uses position-based alignment:
- LONG in lower half of S/R range (posInSR < 0.5) = aligned
- SHORT in upper half (posInSR > 0.5) = aligned

### 4. Confidence Agent Prompt Tweak

- Added RANGE-specific CONFIRM condition: "In a RANGE, the direction matches the price location"
- Added explanation that RANGE structure alignment = location match, not trend match

## Files Modified
- `src/agents/direction_agent.js` — prompt rewrite + S/R position data
- `src/agents/confidence_agent.js` — structureAligned fix + prompt tweak

## Results — 30 Scenario Batch Test

### Headline Numbers
| Metric | Iter10 | Iter11 | Change |
|--------|--------|--------|--------|
| Executed | 17/30 (56.7%) | **27/30 (90%)** | +10 |
| Skipped | 13/30 (43%) | **3/30 (10%)** | -10 |
| Win Rate | 29.4% | **66.7%** | +37.3pp |
| Raw R | -3.79 | **+18.82** | +22.61 |
| Weighted R | -1.89 | **+9.41** | +11.30 |
| Avg waits/trade | — | 1.6 | — |

### Trade-by-Trade
```
  #  | Side  | Result  | rawR  | wR    | Regime    | Structure | Session
  ---|-------|---------|-------|-------|-----------|-----------|--------
   1 | LONG  | TIMEOUT | -0.19 | -0.10 | RANGE     | RANGE     | NY
   2 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
   3 | LONG  | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | LONDON
   4 | SHORT | TP      | +1.49 | +0.75 | RANGE     | RANGE     | LONDON
   5 | SHORT | SL      | -1.00 | -0.50 | RANGE     | DOWNTREND | LONDON
   6 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
   7 | LONG  | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | LONDON
   8 | LONG  | SL      | -1.00 | -0.50 | RANGE     | RANGE     | NY
   9 | LONG  | SL      | -1.00 | -0.50 | TREND     | UPTREND   | LONDON
  10 | SHORT | TP      | +1.50 | +0.75 | RANGE     | DOWNTREND | NY
  11 | SHORT | SL      | -1.00 | -0.50 | RANGE     | DOWNTREND | LONDON
  12 | LONG  | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | LONDON
  13 | SHORT | TP      | +1.51 | +0.76 | RANGE     | RANGE     | LONDON
  14 | LONG  | TP      | +1.50 | +0.75 | TREND     | UPTREND   | NY
  15 | LONG  | SL      | -1.00 | -0.50 | RANGE     | UPTREND   | LONDON
  16 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
  17 | SHORT | TP      | +1.50 | +0.75 | RANGE     | DOWNTREND | NY
  18 | SHORT | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | LONDON
  19 | LONG  | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | LONDON
  20 | SHORT | TP      | +1.51 | +0.75 | TREND     | DOWNTREND | LONDON
  22 | SHORT | TP      | +1.49 | +0.75 | TREND     | DOWNTREND | LONDON
  23 | SHORT | TP      | +1.50 | +0.75 | RANGE     | UPTREND   | NY
  24 | LONG  | TP      | +1.50 | +0.75 | RANGE     | RANGE     | NY
  27 | SHORT | TP      | +1.51 | +0.75 | TREND     | DOWNTREND | LONDON
  28 | SHORT | TP      | +1.49 | +0.74 | RANGE     | RANGE     | LONDON
  29 | LONG  | TP      | +1.50 | +0.75 | TREND     | UPTREND   | NY
  30 | SHORT | TP      | +1.50 | +0.75 | TREND     | DOWNTREND | LONDON
```

### Performance by Regime
| Regime | Trades | Wins | WR | rawR | Iter10 WR | Change |
|--------|--------|------|----|------|-----------|--------|
| **TREND** | 10 | 6 | **60%** | **+5.01** | 44% | +16pp |
| **RANGE** | 17 | 12 | **71%** | **+13.81** | 13% | +58pp |

Both regimes now profitable. RANGE went from catastrophic (13%) to best-performing (71%).

### Performance by Session
| Session | Trades | Wins | WR | rawR |
|---------|--------|------|----|------|
| LONDON | 19 | 12 | 63% | +11.01 |
| NY | 8 | 6 | 75% | +7.81 |

### Direction Bias
| Direction | Count | % |
|-----------|-------|---|
| LONG | 11 | 41% |
| SHORT | 16 | 59% |

Balanced — no extreme bias (was 67-69% LONG in earlier iterations).

### Skipped Trades
Only 3/30 skipped (10%, down from 43%). All 3 would have been TP — the confidence agent correctly blocked bad-location trades but the direction agent kept insisting on the wrong direction for the location.

## What Worked
1. **RANGE WR jumped from 13% to 71%** — position-based direction logic works
2. **Skip rate dropped from 43% to 10%** — no longer auto-skipping all RANGE trades
3. **TREND WR improved from 44% to 60%** — removing "when in doubt NEUTRAL" helped TREND too
4. **Direction bias balanced** — 41% LONG / 59% SHORT (was 67-69% LONG)
5. **Confidence agent location logic working** — correctly rejects wrong-direction-for-location trades (e.g., SHORT at support in RANGE)
6. **Overall rawR: +18.82** — first profitable iteration of market order model

## What Could Be Better
1. 3 remaining skips (direction agent stuck on wrong direction despite location)
2. 8 losses still present — could analyze loss patterns for further improvement
3. Only tested on 30 random scenarios — need more data points for confidence
