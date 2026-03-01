# TRADEBOT Development Diary

## Design Philosophy

### Core Principles

1. **Understand first, profit second.** The goal is to build a system that correctly reads the market. Profitability follows from understanding.

2. **Let the AI reason, don't hardcode it.** Teach trading principles, not decision trees. Hard thresholds (e.g., "if position < 30%, go LONG") turn the LLM into an expensive if/else. Teach WHY proximity to support matters and let it weigh the evidence.

3. **Simple inputs, perfect understanding.** Every input must be clearly defined — what it measures and why it matters. Better 5 well-understood indicators than 15 confusing ones. Do not overflow the AI with raw data (e.g., full OHLC) that makes pattern extraction harder.

4. **One problem at a time.** Isolate variables. Keep R:R and TP/SL mechanical so performance changes are attributable to direction quality, not risk management.

5. **Learn from every trade.** The trade summary agent is as important as the direction agent. A good teacher diagnoses root causes, not symptoms. "Price went the other way" is not a diagnosis.

6. **Trade, don't skip.** Understanding comes from engagement, not avoidance. Default to having a directional lean. Iter20 enforces this: BULLISH or BEARISH only, no NEUTRAL.

### Prompt Design

- Teach principles and concepts, not prescriptive rules
- Size the prompt so the AI has margin to reason — don't overload
- Inputs should be factual, not directive ("0.7 ATR from support" not "near support, favors LONG")
- Force counter-argument thinking before finalizing decisions
- The AI must explain WHY, not just WHAT it decided

### Training Loop Focus

- 30 scenarios per batch (cost-effective, sufficient for diagnosing failure patterns)
- Run 2 batches (60 trades) when data is unclear to get statistical significance
- The goal of each iteration is not to improve win rate — it is to identify WHY trades fail and fix the reasoning
- Two agents must improve together: the **direction agent** (the student) and the **trade summary agent** (the teacher)

---

## Iteration History (Market Order Era)

> Legacy iterations (Iter1-8) used limit-order fills with a simulator bug that inflated results. Only market-order results (Iter9+) are realistic. See `docs/SIMULATOR_BUG_ANALYSIS.md` for details.

### Iter11 — First Profitable Market Order Model (Feb 28, 2026)

**66.7% WR | +18.82 Raw R | +9.41 Weighted R | 30 trades**

Fixed RANGE trading catastrophe from Iter10 (13% WR in ranges). Removed 5 NEUTRAL-forcing rules from direction prompt. Added regime-specific confluence and S/R position data. Fixed `structureAligned` for RANGE in confidence agent.

- RANGE: 71% WR (was 13%) | TREND: 60% WR (was 44%)
- Skip rate: 10% (was 43%)
- Tagged **v2.0**

> Note: Follow-up run was ~30% WR — high variance at 30-trade samples. Iter11 was lucky.

### Iter12-18 — Experimentation Phase

| Iter | WR | Raw R | Key Change | Outcome |
|------|----|-------|------------|---------|
| 12 | 34.5% | -3.26 | Aggressive risk scaling | Regression — overcomplicated |
| 13 | 44.6% | +8.72 | Position overrides momentum | Partial recovery |
| 18 | 40.0% | -0.01 | Direction-only (dropped confidence+levels agents) | Baseline for simplification |

Key lesson: Dropping the confidence and levels agents was correct (they added noise), but the direction prompt still used Iter11's rule-based style which is too rigid.

### Iter19 — Principle-Based Reasoning (Mar 1, 2026)

**42.3% WR | +1.48 Raw R | +0.74 Weighted R | 26 executed, 4 skipped**

Complete rewrite of direction agent prompt: principle-based instead of rule-based. Teaches trading concepts and lets the AI reason independently. Added counter-argument step.

**Analysis revealed:**
- 47% of losses (7/15) came from trades OUTSIDE the S/R range — model treated session-level breaks as continuation when they were false breaks
- Inside S/R: 53% WR (profitable). Outside S/R: 22% WR (catastrophic)
- TREND+UPTREND LONG: 100% WR (3/3) — model gets this right
- All conviction was MEDIUM — not discriminating at all (useless)
- 0 waits — model decides immediately or stays NEUTRAL forever

### Iter20 — False Break Awareness + Must-Decide (Mar 1, 2026)

**51.7% WR | +17.45 Raw R | +8.73 Weighted R | 60 trades (2 runs), 0 skipped**

Changes from Iter19:
1. **FALSE BREAK AWARENESS**: Teaches model that sweeps beyond session S/R often reverse, especially when price is still inside the previous day's range
2. **PREVIOUS DAY HIGH/LOW**: Added as broader context beyond session-only S/R
3. **MUST DECIDE**: No NEUTRAL output — market always has a lean
4. **BINARY CONVICTION**: HIGH or LOW only (MEDIUM was 100% of Iter19 trades)

**Combined 60-trade analysis (2 batches):**

| Metric | Iter19 | Iter20 |
|--------|--------|--------|
| Win Rate | 42.3% | **51.7%** |
| Raw R | +1.48 | **+17.45** |
| Avg R/trade | +0.057 | **+0.291** |
| Skipped | 4 (13%) | **0 (0%)** |
| Losses outside S/R | 47% | **14%** |

**What's profitable (protect these):**

| Setup | Trades | WR | R |
|-------|--------|----|---|
| RANGE+RANGE | 21 | **62%** | +11.47 |
| TREND+DOWNTREND SHORT | 10 | **60%** | +4.98 |
| RANGE+DOWNTREND SHORT | 4 | **100%** | +5.98 |
| SHORT overall | 28 | **61%** | +14.44 |
| LONDON session | 40 | **57%** | +17.48 |
| Inside day range | 36 | **56%** | +13.98 |

**What's bleeding (fix these):**

| Setup | Trades | WR | R |
|-------|--------|----|---|
| TREND+UPTREND LONG | 9 | **33%** | -1.50 |
| RANGE+DOWNTREND LONG | 5 | **20%** | -2.49 |
| RANGE+UPTREND LONG | 4 | **25%** | -1.50 |
| NY session | 20 | **40%** | -0.03 |
| LONG overall | 32 | **44%** | +3.01 |

**Root cause of bleeding:**
- The LONG side is the problem, not a specific regime. LONG 44% WR vs SHORT 61%.
- TREND+UPTREND LONG: model enters too late (PosInSR 82-103% on losses). Tries to buy continuation but enters near the top of the S/R range where pullbacks hit SL.
- RANGE+DOWNTREND LONG: model fights the structure. RANGE+DOWNTREND SHORT is 100% WR (4/4).
- 6/14 losses still fighting position (shorting near support / buying near resistance).

---

## How to Train & Improve Models

### The Workflow

```
1. EDIT: Modify prompts in src/agents/direction_agent.js
2. TEST: node src/batch_trainer.js (30 random scenarios)
3. ANALYZE: node scripts/analyze_iter20_combined.js (or write new)
4. COMPARE: Check winning vs bleeding patterns against previous iteration
5. ITERATE: Fix identified failure patterns without breaking winners
```

### Quick Commands

```bash
# Run backtest (30 trades, ~3min)
node src/batch_trainer.js

# Run with specific data
DATA_PATH=data/eurusd_5m_oanda_old.json node src/batch_trainer.js

# Live paper trading
node src/live_trader.js
```

### Key Metrics

| Metric | Current (Iter20) | Target |
|--------|-----------------|--------|
| Win Rate | 51.7% | >55% |
| Raw R per trade | +0.291 | >0.30 |
| Long/Short Balance | 44/61% | >50/>55% |
| Skips | 0% | <5% |

---

[Back to STRUCTURE](STRUCTURE.md)
