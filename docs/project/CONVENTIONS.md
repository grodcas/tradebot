# Conventions

Naming standards and patterns used across TRADEBOT_live.

---

## Model Naming

Format: `{llm}_{pair}[_iter{N}]`

| Example | Meaning |
|---------|---------|
| `gpt4mini_eurusd` | GPT-4o-mini baseline for EUR/USD |
| `gpt4mini_gbpusd_iter11` | GPT-4o-mini iteration 11 for GBP/USD |
| `gpt5_iter5` | GPT-5.2 iteration 5 |

Each model directory contains a `metadata.json` with LLM, pair, iteration, and features.

---

## File Naming

| Directory | Convention | Example |
|-----------|-----------|---------|
| `src/` | `snake_case.js` | `live_trader.js`, `oanda_executor.js` |
| `src/` | `strategy_selector_{pair}.js` | `strategy_selector_eurusd.js` |
| `models/` | `{agent_name}.js` | `direction_agent.js`, `orchestrator.js` |
| `tools/` | `verb_noun.js` or `test_noun.js` | `check_oanda.js`, `test_1k_order.js` |
| `data/` | `snake_case.json` | `global_trades.json` |
| `docs/reports/` | `lowercase_with_date.md` | `trade_review_20260227.md` |
| `docs/features/` | `kebab-case.md` | `live-trader.md`, `ai-agents.md` |

---

## Data Files

| File | Format | Purpose |
|------|--------|---------|
| `global_trades.json` | `{ trades: [...] }` | All-time trade history |
| `trade_results.json` | `{ trades: [...] }` | Current session trades |
| `live_trader.log` | Plain text with timestamps | Runtime log |

---

## Pair Codes

Internal codes used throughout the codebase:

| Code | Instrument | Notes |
|------|-----------|-------|
| `EURUSD` | EUR_USD | Standard |
| `USDJPY` | USD_JPY | Different pip multiplier (100 vs 10000) |
| `GBPUSD` | GBP_USD | Standard |
| `EURUSD_GPT5` | EUR_USD | Shares data with EURUSD |

---

## Import Patterns

- Files in `src/` import siblings with `./` (e.g., `require('./oanda_executor')`)
- Files in `src/` import models with `../models/` (e.g., `require('../models/gpt5_iter5/orchestrator')`)
- Files in `tools/` import src with `../src/` and use `path.join(__dirname, '..')` for `.env`
- All `dotenv.config()` calls use explicit path: `require('dotenv').config({ path: path.join(__dirname, '..', '.env') })`

---

[Back to STRUCTURE](../STRUCTURE.md)
