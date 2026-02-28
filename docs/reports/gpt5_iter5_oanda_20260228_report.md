# GPT-5 Iter5 Test Report - OANDA Data

**Date:** Feb 28, 2026
**Model:** GPT-5 Iter5
**Data:** `eurusd_5m_oanda_recent.json` (Nov 2025 - Feb 2026)
**Scenarios:** 30

---

## Summary

| Metric | Value |
|--------|-------|
| Total Scenarios | 30 |
| Executed Trades | 21 |
| Skipped (SKIP) | 9 (30%) |
| Wins (TP) | 10 |
| Losses (SL) | 11 |
| Win Rate | 47.6% |
| Raw R Total | +65.52R |
| **Weighted R Total** | **+28.39R** |
| Avg R per Trade | +1.35R |

---

## Analysis

### Win Rate: 47.6%

This is significantly lower than the 78% win rate seen in previous tests with IBKR data. Possible causes:

1. **Different data source** - OANDA data may have different characteristics
2. **Random scenario selection** - 30 scenarios is a small sample size
3. **Market conditions** - The selected scenarios may have been in unfavorable conditions

### Skip Rate: 30%

The model correctly skipped 9 out of 30 scenarios where it detected:
- INCOHERENT market conditions
- LOW clarity / MESSY readability
- Conflicting regime/structure signals

### Weighted R: +28.39R

Despite the lower win rate, the total weighted R is positive (+28.39R), indicating:
- Winners had larger R multiples than losers
- Risk sizing worked (reduced exposure on lower confidence trades)
- Average weighted R per trade: +1.35R

---

## Direction Breakdown

| Direction | Trades | Wins | Win Rate |
|-----------|--------|------|----------|
| LONG | 12 | 6 | 50% |
| SHORT | 9 | 4 | 44% |

Long bias present (57% of trades were LONG).

---

## Key Observations

1. **Low win rate but positive R** - The model is profitable despite <50% WR due to R:R management
2. **High skip rate** - Model correctly avoiding unclear setups
3. **Consistent with known issues** - Long bias and risk-win correlation problems still present

---

## Recommendations

- [ ] Run on `eurusd_5m_oanda_old.json` for out-of-sample validation
- [ ] Increase sample size to 60+ scenarios for statistical significance
- [ ] Investigate why win rate dropped vs IBKR data

---

## Files

- Results: `results/trade_results.json`
- Data: `data/eurusd_5m_oanda_recent.json`
- Model: `models/gpt5_iter5_20260221/`

---

[Back to STRUCTURE](../STRUCTURE.md)
