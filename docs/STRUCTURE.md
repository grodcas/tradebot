# TRADEBOT

## Purpose
AI-powered EUR/USD trading system using GPT-5. Core innovation: **iterate on prompts** as a form of machine learning to improve trading performance.

## Tech Stack
`Node.js` | `GPT-5` | `OANDA API` | `Claude (human-guided iteration)`

## Current Active Model
**Iter30** | Two-Agent + Filter C + RSI | Testing | Mar 3, 2026
**Previous best**: Iter26 | 47.4% WR | +0.185 R/trade | 100 trades

---

## Architecture (Iter29 — Two-Agent)

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
orchestrator.js             <-- Calls Reader → Executor → Filters → Levels
        |
        ├──> market_reader.js    <-- GPT-5 call #1: pure market assessment
        |    (sees ALL raw data)      scenario, freshness, alignment, risks
        |         |
        |         v
        ├──> trade_executor.js   <-- GPT-5 call #2: trade decision
        |    (sees reader output      BULLISH, BEARISH, or NEUTRAL
        |     + key facts, NOT        edge pattern, conviction
        |     raw price sequences)
        |         |
        |         v
        ├──> Mechanical Filters  <-- A: No SHORT below support (pos < 0%)
        |                            B: No SHORT into higher highs (HH diff > 1 pip)
        |                            C: No SHORT in TREND+DOWNTREND (mechanical mismatch)
        v
Mechanical Levels            <-- SL = 1.2 x ATR_30m, TP = 1.5:1 R:R, Risk = 0.50
        |
        v
Trade Decision               <-- {side, entry, sl, tp, risk, reasoning}
```

**Key design choice (Iter29):** Two specialized AI agents instead of one. The Market Reader provides honest analysis without directional bias. The Trade Executor makes decisions from the reader's assessment, preventing the confirmation bias that caused single-agent approaches to fail on TREND+DOWNTREND SHORT. See [ITER29_ARCHITECTURE.md](ITER29_ARCHITECTURE.md) for full rationale.

---

## Agent Decision Flow (Iter29)

```
5m/30m/Daily bars + indicators
        |
        v
Market Reader (GPT-5 call #1)
  Input: ALL raw data (closes, swings, EMAs, S/R, prevDay, regime, session)
  Output: {scenario, scenario_quality, structure_assessment, ema_alignment,
           risk_factors, favorable_factors, session_context}
        |
        v
Trade Executor (GPT-5 call #2)
  Input: Reader's assessment + key facts (price, position%, EMAs, session)
         Does NOT see raw price sequences (prevents confirmation bias)
  Output: {primary_bias: BULLISH|BEARISH|NEUTRAL, edge_pattern, conviction, trade_idea}
        |
        v
Mechanical Filters A + B → Mechanical Levels (no AI)
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
│   │   ├── market_reader.js     # Iter29: market analysis agent (no direction)
│   │   ├── trade_executor.js    # Iter29: trade decision agent (from reader output)
│   │   ├── direction_agent.js   # Legacy: single-agent prompt (Iter24/26/28)
│   │   ├── orchestrator.js      # Pipeline: reader → executor → filters → levels
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
├── results/                  # Test results (trade_results_iter{N}_run{1,2}.json)
├── scripts/                  # Analysis scripts (analyze_iter{N}_combined.js)
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
| 20 | 51.7% | +17.45 | False break awareness, must-decide, prevDay levels | Best WR (60 trades) |
| 21 | 44.1% | — | Fix bleeders (broke winners) | Superseded |
| 22 | 38.3% | -2.50 | Classification-first (Situation A/B/C) | Failed — rigid rules hurt |
| 23 | 33.3% | -9.95 | Rule-based classification fix | Failed — trending trades dead |
| 24 | 44.2% | +5.49 | Iter20 base + statistical edge patterns, NEUTRAL skip | Superseded |
| 25 | 37.5% | -2.00 | Added SHORT below support filter | Superseded |
| **26** | **47.4%** | **+14.04** | **Swing structure filter (no SHORT into HH), swing data storage** | **Best single-agent (76exec+24skip, 100t)** |
| 27 | 27.3% | -7.01 | Complete prompt rewrite — failed | Failed |
| 28 | 42.9% | +1.01 | Enriched Iter26 prompt — marginal | Failed |
| 29 | 40.0% | +0.00 | Two-agent: Market Reader + Trade Executor (60exec/10skip, 70t) | Superseded |
| **30** | **57.7%** | **+11.50** | **Run 2: Reader fixes + pattern binding + Filter C + RSI input (26exec/4skip, 30t)** | **Testing** |

> Legacy models (Iter1-8) used limit-order fills with inflated results. See [SIMULATOR_BUG_ANALYSIS](SIMULATOR_BUG_ANALYSIS.md).

---

## Iter26 Performance Breakdown (100-trade definitive batch)

**Winning setups (76 executed from 100 scenarios):**
- TREND+UPTREND LONG: 58% WR, +8.55R (19 trades) — engine of profitability
- RANGE+DOWNTREND SHORT: 47% WR, +2.98R (17 trades) — consistent positive R
- RANGE+RANGE LONG: 80% WR, +5.00R (5 trades) — small sample but strong
- LONG overall: 59% WR, +15.56R (32 trades) — profit engine

**Mechanical filters (100 scenarios):**
- Filter A (pos < 0%): blocked 7 trades, saved 6 SL / lost 1 TP → **+4.50R saved**
- Filter B (HH > 1 pip): blocked 5 trades, saved 3 SL / lost 2 TP → ~neutral
- NEUTRAL: blocked 12 trades, saved 5 SL / lost 7 TP → over-skipping

**Biggest bleeders:**
- TREND+DOWNTREND SHORT: 27% WR, -5.01R (15 trades) — shorting exhausted moves
- NY session: 38% WR, -1.47R (29 trades) — LONDON carries all profitability

See [DIARY.md](DIARY.md) for full analysis. See [ITER26_PROMPTS.md](ITER26_PROMPTS.md) for exact filters and results.

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
| [ITER26_PROMPTS.md](ITER26_PROMPTS.md) | Iter26 exact filters, swing analysis, results |
| [ITER29_ARCHITECTURE.md](ITER29_ARCHITECTURE.md) | Iter29 two-agent design rationale, comparison to alternatives |
| [ITER24_PROMPTS.md](ITER24_PROMPTS.md) | Iter24 exact prompts, edge patterns (direction prompt base) |
| [ITER18_PROMPTS.md](ITER18_PROMPTS.md) | Iter18 exact prompts (baseline reference) |
| [MISTAKES.md](MISTAKES.md) | Solved challenges & lessons learned |
| [SIMULATOR_BUG_ANALYSIS.md](SIMULATOR_BUG_ANALYSIS.md) | Why legacy results are inflated |
| [CONVENTIONS.md](CONVENTIONS.md) | Naming standards |

---

## Quick Navigation

**Start Here:**
1. Read this file (STRUCTURE.md)
2. Check [DIARY.md](DIARY.md) for latest iteration results
3. Look at `src/agents/direction_agent.js` — that IS the model
