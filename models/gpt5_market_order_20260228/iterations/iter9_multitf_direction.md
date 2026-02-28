# Iter9 — Multi-Timeframe Direction + Mechanical Levels

## Date: 2026-02-28

## Changes from Iter8
1. **Direction Agent rewrite** — Now receives multi-timeframe data (Daily, 30m, 5m) with top-down analysis prompt
   - Daily: 5 closes + EMA200
   - 30m: 15 closes + swing points (SH0/SH1/SL0/SL1) + structureLabel + marketRegime + EMA50 momentum
   - 5m: 15 closes + support/resistance with ATR distances + previous session high/low
   - Prompt teaches: Daily trend → 30m structure → 5m timing → Confluence
2. **Confidence Agent simplified** — Binary CONFIRM/REJECT gate (no sizing)
3. **Levels Agent removed** — Replaced with mechanical levels:
   - SL = 1.5 × ATR_30m
   - TP = 1.5:1 R:R (= 2.25 × ATR_30m)
4. **Fixed risk** — 0.50 for all trades (isolate direction quality)
5. **Indicator fixes** — EMA slope shown as description not raw number, EXPANSION regime added to prompts, EMA200 fallback fixed to null, negative support distance labeled "broken", session high/low labeled "previous session"

## Results: 30 Random Scenarios

### Summary
| Metric | Value |
|--------|-------|
| Executed | 14 / 30 (46.7%) |
| Skipped | 16 / 30 (53.3%) |
| Wins | 4 |
| Losses | 10 |
| **Win Rate** | **28.6%** |
| **Total P&L** | **-2.00R** |
| Breakeven WR at 1.5:1 | 40% |

### Trade-by-Trade
| # | Side | Waited | Result | Weighted R |
|---|------|--------|--------|------------|
| 5 | SHORT | 0 | SL | -0.50 |
| 8 | SHORT | 0 | SL | -0.50 |
| 9 | SHORT | 0 | TP | +0.75 |
| 10 | SHORT | 0 | SL | -0.50 |
| 11 | SHORT | 0 | SL | -0.50 |
| 15 | SHORT | 0 | TP | +0.75 |
| 16 | LONG | 2 | SL | -0.50 |
| 17 | LONG | 3 | TP | +0.75 |
| 18 | SHORT | 0 | SL | -0.50 |
| 23 | SHORT | 2 | SL | -0.50 |
| 24 | SHORT | 0 | SL | -0.50 |
| 25 | LONG | 1 | SL | -0.50 |
| 26 | SHORT | 0 | SL | -0.50 |
| 30 | SHORT | 0 | TP | +0.75 |

### Problems Identified

**1. Massive SHORT bias (78.6%)** — 11/14 executed trades are SHORT. Direction agent outputs BEARISH far more than BULLISH, even in mixed conditions.

**2. Confidence agent too strict** — Rejects any trade where EMA50 isn't perfectly aligned with proposed direction. Pattern:
- Direction BEARISH + structure DOWNTREND → rejected because "EMA flat"
- Direction BULLISH + structure UPTREND → rejected because "EMA moderately down"
- Only TREND regime + strong EMA alignment passes the gate

**3. Direction agent defaults to NEUTRAL in RANGE** — EUR/USD spends most time in ranges. The agent refuses to pick a direction in RANGE regimes, outputting NEUTRAL/LOW clarity repeatedly.

**4. Skip quality is decent** — 12/16 skipped would have been SL, 4/16 would have been TP. Filtering logic works but is too aggressive.

**5. Direction accuracy is poor** — 28.6% WR vs 40% breakeven for 1.5:1 RR. The agent is not reading the market correctly when it does trade.

## Post-Run Diagnostic (Input Verification)

Ran end-to-end diagnostics on 12 trades (4 wins, 4 losses, 4 skips) tracing raw indicators → agent prompt → agent judgment. All basic verification checks pass (prices match, EMAs reasonable, ATR valid). **The plumbing is correct — data flows accurately.** But found 5 issues in how indicators are calculated or interpreted:

### Issue 1: Structure label has NO noise tolerance
`calculateStructureState()` uses raw `>` / `<` comparisons. A 0.8 pip swing high difference on a 7.5 pip ATR market (0.11 ATR) triggers "LOWER HIGH" → DOWNTREND. This is noise, not structure. Trade #3: agent read DOWNTREND and went SHORT while EMA was strongly rising and all 15 bars were above EMA50.

### Issue 2: Regime TREND threshold doesn't match EMA description threshold
Regime code requires `slope < 0` (any negative) for downtrend consistency. Agent describes slope as FLAT when between -0.05 and +0.05. Result: regime=TREND + momentum=FLAT — contradictory signal. Trade #27: winning SHORT rejected because confidence saw "TREND + FLAT momentum" as inconsistent.

### Issue 3: Confidence agent rejects normal pullbacks
During pullbacks within confirmed trends, EMA temporarily moves against the trend direction. Confidence agent rejects these as "EMA not aligned" even when structure is clearly trending. Trades #4, #13: UPTREND structure with temporary down-EMA during pullback — both would have won but were rejected.

### Issue 4: Direction agent shorts at support despite its own rules
Prompt says "RANGE: trade near support for LONG, resistance for SHORT." But when EMA momentum is strongly bearish, the agent ignores proximity to support and shorts anyway. Trades #5, #10: shorted near/at support, both bounced and hit SL.

### Issue 5: Context frozen during waits
During wait loop, `context` and `indicators` are computed once at anchor bar but `currentBar` advances. After 6 waits (30 min), agent sees stale 5m prices but updated currentPrice — creating inconsistency.

## Next Steps → Iter10
Fix all 5 issues: ATR tolerance for structure, aligned regime/slope thresholds, pullback-aware confidence agent, stronger support/resistance adherence in direction prompt, recompute context during waits.
