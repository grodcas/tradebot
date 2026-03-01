# Backtest Benchmark - Multi-Agent Trading System
## Validation Run: 100 Trades (Feb 16, 2026)

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| **Total Trades** | 99 executed (100 scenarios) |
| **Win Rate** | 61.6% (61 wins) |
| **Loss Rate** | 32.3% (32 losses) |
| **Timeouts** | 6.1% (6 timeouts) |
| **Profit Factor** | 2.47 |
| **Total Weighted R** | +30.33R |
| **Avg R per Trade** | +0.31R |
| **Avg Winning R** | +1.40R |
| **Avg Risk Level** | 0.61 (scale 0-1) |
| **Avg Bars to Exit** | 63 bars (~5h 15m) |

---

## Performance by Direction

| Side | Trades | Wins | Win Rate |
|------|--------|------|----------|
| **LONG** | 42 | 24 | 57.1% |
| **SHORT** | 57 | 37 | 64.9% |

SHORT bias outperformed by ~8%.

---

## Performance by Session

| Session | Trades | Wins | Win Rate |
|---------|--------|------|----------|
| **LONDON** | 65 | 39 | 60.0% |
| **NY** | 34 | 22 | 64.7% |

NY session slightly better edge.

---

## Performance by Market Regime

| Regime | Trades | Wins | Win Rate |
|--------|--------|------|----------|
| **RANGE** | 65 | 42 | 64.6% |
| **TREND** | 29 | 15 | 51.7% |
| **EXPANSION** | 5 | 4 | 80.0% |

RANGE regime is the bread-and-butter setup.

---

## R-Multiple Distribution (Winners)

| R-Multiple | Count | % of Wins |
|------------|-------|-----------|
| < 1R | 36 | 59% |
| 1-2R | 11 | 18% |
| 2-3R | 5 | 8% |
| 3R+ | 9 | 15% |

Most wins are partial TP or tight targets. Big winners (3R+) provide tail lift.

---

## Risk Level Performance

| Risk Bucket | Trades | Win Rate | Total R |
|-------------|--------|----------|---------|
| Medium (0.5-0.7) | 96 | 62.5% | +28.73R |
| High (0.7+) | 2 | 0% | -1.40R |
| Low (<0.5) | 1 | 100% | +3.00R |

System operates primarily in medium confidence range.

---

## Streaks

| Metric | Value |
|--------|-------|
| **Max Win Streak** | 7 |
| **Max Loss Streak** | 3 |

Healthy asymmetry - wins cluster, losses don't compound.

---

## Best Trades

| # | Side | Regime | Session | Raw R | Weighted R | Bars |
|---|------|--------|---------|-------|------------|------|
| 82 | SHORT | RANGE | NY | +6.00R | +3.90R | 7 |
| 39 | LONG | RANGE | NY | +4.67R | +3.03R | 20 |
| 100 | LONG | RANGE | NY | +7.50R | +3.00R | 37 |

Pattern: Big winners come from RANGE + NY session.

---

## Worst Trades

| # | Side | Regime | Session | Raw R | Weighted R |
|---|------|--------|---------|-------|------------|
| 31 | LONG | RANGE | LONDON | -1.00R | -0.70R |
| 26 | LONG | TREND | LONDON | -1.00R | -0.70R |
| 93 | SHORT | TREND | LONDON | -1.00R | -0.65R |

Pattern: Losses capped at -1R (proper SL discipline). No catastrophic losses.

---

## Trade Quality Ratings (AI Self-Assessment)

| Rating | Count | % |
|--------|-------|---|
| GOOD | 59 | 60% |
| BAD | 36 | 36% |
| NEUTRAL | 4 | 4% |

---

## Key Characteristics

1. **Conservative Sizing**: Avg risk 0.61 - system doesn't max out confidence
2. **Short Bias Edge**: 65% WR on shorts vs 57% on longs
3. **Range Specialist**: 65% of trades in RANGE regime, best performance
4. **Quick Big Winners**: Best trades exit in 7-37 bars
5. **Loss Discipline**: All losses at exactly -1R (no blown stops)
6. **Session Sweet Spot**: NY session slightly better
7. **Robust Streaks**: Max 3 losses in a row, max 7 wins

---

## Benchmark Targets for Live Trading

| Metric | Backtest | Live Target |
|--------|----------|-------------|
| Win Rate | 61.6% | >55% |
| Profit Factor | 2.47 | >1.5 |
| Avg R/Trade | +0.31R | >+0.20R |
| Max Loss Streak | 3 | <6 |

Live slippage and execution will likely reduce performance. These targets account for ~20% degradation.

---

*Generated: Feb 18, 2026*
*Data source: git commit 86105b8*

---

[Back to STRUCTURE](../STRUCTURE.md)
