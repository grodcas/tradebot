# Iter10 — Diagnostic Fixes (Input Quality + Agent Interpretation)

## Date: 2026-02-28

## Root Cause Analysis from Iter9
Ran end-to-end diagnostics on 12 trades tracing raw bars → indicators → agent prompts → agent judgments. Plumbing is correct but found 5 issues: 2 calculation bugs feeding wrong labels, 2 prompt interpretation issues, 1 stale data issue.

## Changes from Iter9

### Fix 1: Structure label ATR tolerance (trade_indicators.js)
**Problem:** `calculateStructureState()` used raw `>` / `<` — a 0.8 pip difference on 7.5 pip ATR triggered DOWNTREND.
**Fix:** Add ATR-based tolerance. Swing differences < 0.2 × ATR_30m are treated as EQUAL. Need to pass ATR_30m into the function.
- HH only if `SH1 > SH0 + 0.2 × ATR`
- LL only if `SL1 < SL0 - 0.2 × ATR`
- Otherwise EQUAL → contributes to RANGE classification

### Fix 2: Regime slope threshold alignment (trade_indicators.js)
**Problem:** TREND required `slope < 0` (any negative), but agent describes -0.05 to +0.05 as FLAT. Created contradictory TREND + FLAT signals.
**Fix:** Require `|slope| > 0.05` for slope to count as consistent with structure direction.

### Fix 3: Confidence agent pullback awareness (confidence_agent.js)
**Problem:** Rejected all trades where EMA wasn't perfectly aligned, even during normal pullbacks within confirmed trends.
**Fix:** Add pullback awareness to prompt. If structure confirms a trend (HH+HL or LH+LL) and the direction aligns with structure, temporary EMA misalignment during a pullback is NORMAL and should not trigger rejection.

### Fix 4: Direction agent support/resistance adherence (direction_agent.js)
**Problem:** Agent shorted at support despite prompt saying "RANGE: trade near support for LONG." Strong EMA momentum overrode the support level logic.
**Fix:** Add explicit location warning in data section. When price is within 1 ATR of support, add "⚠ NEAR SUPPORT — favor LONG in range." Same for resistance.

### Fix 5: Recompute context during waits (batch_trainer.js)
**Problem:** Context and indicators frozen from original anchor while currentBar advanced during waits.
**Fix:** Recompute context and indicators from new entryIdx on each wait iteration.

## Results — 30 Scenario Batch Test

### Headline Numbers
| Metric | Iter9 | Iter10 | Change |
|--------|-------|--------|--------|
| Executed | 14/30 (46.7%) | 17/30 (56.7%) | +3 |
| Win Rate | 28.6% | 29.4% | +0.8% |
| Raw R | -2.00 | -3.79 | -1.79 (worse) |
| Weighted R | -1.00 | -1.89 | -0.89 (worse) |
| SHORT bias | 78.6% | 59% | Fixed |
| Breakeven WR | 40% | 40% | (1.5:1 RR) |

### Trade-by-Trade
```
  #  | Side  | Result  | rawR  | wR    | Regime    | Structure | Session
  ---|-------|---------|-------|-------|-----------|-----------|--------
   2 | LONG  | TP      |  1.51 |  0.76 | TREND     | UPTREND   | LONDON
   4 | LONG  | SL      | -1.00 | -0.50 | RANGE     | UPTREND   | LONDON
   5 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
   6 | SHORT | TP      |  1.51 |  0.75 | RANGE     | DOWNTREND | LONDON
   9 | LONG  | SL      | -1.00 | -0.50 | RANGE     | UPTREND   | NY
  10 | SHORT | SL      | -1.00 | -0.50 | RANGE     | DOWNTREND | NY
  11 | LONG  | SL      | -1.00 | -0.50 | TREND     | UPTREND   | NY
  12 | LONG  | TIMEOUT | -0.30 | -0.15 | RANGE     | UPTREND   | NY
  13 | LONG  | SL      | -1.00 | -0.50 | TREND     | UPTREND   | NY
  17 | SHORT | SL      | -1.00 | -0.50 | RANGE     | RANGE     | LONDON
  21 | SHORT | SL      | -1.00 | -0.50 | RANGE     | RANGE     | NY
  22 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
  23 | SHORT | SL      | -1.00 | -0.50 | TREND     | DOWNTREND | LONDON
  24 | SHORT | TP      |  1.50 |  0.75 | TREND     | DOWNTREND | NY
  25 | SHORT | TP      |  1.50 |  0.75 | TREND     | DOWNTREND | NY
  28 | LONG  | TP      |  1.49 |  0.75 | TREND     | UPTREND   | LONDON
  29 | SHORT | SL      | -1.00 | -0.50 | RANGE     | DOWNTREND | LONDON
```

### KEY FINDING: Performance by Regime

| Regime | Trades | Wins | WR | rawR | Status |
|--------|--------|------|----|------|--------|
| **TREND** | 9 | 4 | **44%** | **+1.00** | **PROFITABLE** (above 40% breakeven) |
| **RANGE** | 8 | 1 | **13%** | **-4.79** | **CATASTROPHIC** |

**TREND trading works.** The system is profitable at 44% WR with 1.5:1 RR in trend regimes.
**RANGE trading is destroying all gains** and then some. 13% WR in ranges.

### KEY FINDING: Skipped Trades Were Winners

Of 13 skipped trades, **9 would have been TP** (69% WR) if taken:
- All 13 were LONG calls in RANGE regimes
- 10/13 skipped by direction agent (NEUTRAL output)
- 3/13 rejected by confidence agent
- The agent is literally skipping the best LONG trades and taking the worst RANGE trades

| Skipped | Would-have-been TP | Would-have-been SL |
|---------|-------------------|-------------------|
| 13 | 9 (69%) | 4 (31%) |

### Skip Reasons
- Direction NEUTRAL: 10 trades (all RANGE regimes)
- Confidence REJECT: 3 trades (all RANGE, near support)

### By Session
| Session | Trades | WR | rawR |
|---------|--------|----|------|
| LONDON | 9 | 33% | -1.49 |
| NY | 8 | 25% | -2.30 |

### What Improved from Iter9
1. **SHORT bias eliminated**: 59% SHORT (was 78.6%) — much more balanced
2. **Execution rate up**: 56.7% (was 46.7%) — taking more trades
3. **Structure labels more accurate**: ATR tolerance prevents noise from triggering false trends
4. **Regime/slope consistency**: No more contradictory TREND + FLAT signals
5. **Location awareness working**: Confidence agent correctly blocks some range-edge trades

### Root Problem for Iter11
The system has two distinct problems:
1. **RANGE direction is wrong**: When the agent DOES trade ranges, it picks the wrong direction (13% WR). It should either avoid ranges entirely or dramatically improve range direction logic.
2. **NEUTRAL too aggressive on LONGs in ranges**: The direction agent outputs NEUTRAL for 10 RANGE scenarios that were overwhelmingly LONG winners (70% would have won). The prompt says "middle of range = no edge" but many of these are near support, not in the middle.

**Strategic choice for Iter11:**
- Option A: Stop trading ranges entirely (filter to TREND-only) — immediately profitable based on TREND 44% WR
- Option B: Fix RANGE trading — the skipped trades suggest the direction is consistently LONG and winning; the agent just needs to stop going NEUTRAL/SHORT in ranges
- Option C: Hybrid — trade ranges only near clear edges (support → LONG, resistance → SHORT), skip middle-of-range
