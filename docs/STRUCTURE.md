# TRADEBOT

## Purpose
AI-powered EUR/USD trading system using GPT-5. Core innovation: **iterate on prompts** as a form of machine learning to improve trading performance.

## Tech Stack
`Node.js` | `GPT-5` | `OANDA API` | `Claude (human-guided iteration)`

## Current Active Model
**Iter20** | Direction-only + mechanical levels | 51.7% WR | +0.291 R/trade | Mar 1, 2026

---

## Architecture

```
Market Data (OANDA 5m bars)
        |
        v
trade_indicators.js         <-- Computes: sessions, S/R, swing points,
        |                        structure, EMA, ATR, regime, prevDay levels
        v
strategy_selector.js        <-- Extracts indicators, calls orchestrator
        |
        v
orchestrator.js             <-- Calls direction agent, applies mechanical levels
        |
        v
direction_agent.js          <-- GPT-5 prompt: multi-TF analysis, must decide
        |                        BULLISH or BEARISH, counter-argument, conviction
        v
Mechanical Levels           <-- SL = 1.2 x ATR_30m, TP = 1.5:1 R:R, Risk = 0.50
        |
        v
Trade Decision              <-- {side, entry, sl, tp, risk, reasoning}
```

**Key design choice (since Iter18):** Single AI agent (direction only). Confidence and levels agents were removed — they added noise without improving results. Levels are mechanical to isolate direction quality.

---

## Agent Decision Flow

```
5m/30m/Daily bars + indicators
        |
        v
Direction Agent (GPT-5)
  Input: closes, swing points, EMA, S/R, prevDay high/low, regime, session
  Output: {primary_bias: BULLISH|BEARISH, conviction: HIGH|LOW, trade_idea, counter_argument}
        |
        v
Mechanical Levels (no AI)
  SL = 1.2 x ATR_30m from entry
  TP = 1.5 x SL distance (1.5:1 R:R)
  Risk = 0.50 fixed
```

---

## Simulation Flow (batch_trainer.js)

1. Load historical 5m bars from OANDA JSON
2. Pick 30 random timestamps during Zurich session hours
3. For each: compute indicators, call AI, get trade decision
4. Simulate forward: market order at next bar's open, check SL/TP hit
5. Record result + call trade summary agent for diagnosis
6. Save to `results/trade_results.json`

**Simulation rules:**
- Entry: Market order at next bar's open (+ half spread)
- SL/TP adjusted from actual fill price (preserves R:R)
- Same-bar TP+SL conflict counts as SL (conservative)
- Timeout: 300 bars (~25 hours)

---

## Folder Structure

```
TRADEBOT/
├── src/                      # Core source code
│   ├── agents/               # AI agent prompts (THE MODEL)
│   │   ├── direction_agent.js   # The main AI prompt (Iter20)
│   │   ├── orchestrator.js      # Pipeline: direction → mechanical levels
│   │   └── ai_client.js         # GPT-5 API wrapper
│   ├── batch_trainer.js      # Backtest engine (30 random scenarios)
│   ├── live_trader.js        # Live/paper trading via OANDA
│   ├── strategy_selector.js  # Indicator extraction + decision validation
│   └── trade_indicators.js   # Technical analysis (~900 lines)
│
├── data/                     # Historical price data
│   ├── eurusd_5m_oanda.json        # Default (symlink to recent)
│   ├── eurusd_5m_oanda_recent.json # Nov 2025 - Feb 2026
│   └── eurusd_5m_oanda_old.json    # Aug 2025 - Nov 2025
│
├── models/                   # Saved model checkpoints
│   └── gpt5_market_order_20260228/ # Current model with iteration history
│
├── results/                  # Test results (trade_results.json)
├── scripts/                  # Analysis scripts (analyze_iter20_combined.js)
├── docs/                     # Documentation
└── archive/                  # Old iterations, legacy models
```

---

## Iteration History

| Iter | WR | Raw R | Key Change | Status |
|------|----|-------|------------|--------|
| 11 | 66.7% | +18.82 | First profitable market order (lucky run) | v2.0 tag |
| 12 | 34.5% | -3.26 | Aggressive risk scaling | Regression |
| 13 | 44.6% | +8.72 | Position overrides momentum | Partial recovery |
| 18 | 40.0% | -0.01 | Direction-only, dropped conf+levels agents | Simplification baseline |
| 19 | 42.3% | +1.48 | Principle-based prompt rewrite | Identified false break problem |
| **20** | **51.7%** | **+17.45** | **False break awareness, must-decide, prevDay levels** | **Current (60 trades)** |

> Legacy models (Iter1-8) used limit-order fills with inflated results. See [SIMULATOR_BUG_ANALYSIS](SIMULATOR_BUG_ANALYSIS.md).

---

## Iter20 Performance Breakdown

**Winning setups (protect):**
- RANGE+RANGE: 62% WR, +11.47R (21 trades)
- TREND+DOWNTREND SHORT: 60% WR, +4.98R (10 trades)
- RANGE+DOWNTREND SHORT: 100% WR, +5.98R (4 trades)

**Bleeding setups (fix next):**
- TREND+UPTREND LONG: 33% WR, -1.50R (9 trades)
- RANGE+DOWNTREND LONG: 20% WR, -2.49R (5 trades)
- RANGE+UPTREND LONG: 25% WR, -1.50R (4 trades)

See [DIARY.md](DIARY.md) for detailed analysis and next steps.

---

## Quick Commands

```bash
# Run backtest
node src/batch_trainer.js

# Run with old data
DATA_PATH=data/eurusd_5m_oanda_old.json node src/batch_trainer.js

# Analyze results
node scripts/analyze_iter20_combined.js

# Live paper trading
node src/live_trader.js
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [DIARY.md](DIARY.md) | Development history, iteration results, analysis |
| [MISTAKES.md](MISTAKES.md) | Solved challenges & lessons learned |
| [SIMULATOR_BUG_ANALYSIS.md](SIMULATOR_BUG_ANALYSIS.md) | Why legacy results are inflated |
| [CONVENTIONS.md](CONVENTIONS.md) | Naming standards |

---

## Quick Navigation

**Start Here:**
1. Read this file (STRUCTURE.md)
2. Check [DIARY.md](DIARY.md) for latest iteration results
3. Look at `src/agents/direction_agent.js` — that IS the model
