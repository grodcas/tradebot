# TRADEBOT_live - System Context

> Multi-pair AI-powered forex trading system running live on OANDA with GPT-powered decision-making.

**Last Updated**: 2026-02-28
**Status**: Production Ready
**Branch**: tradebot_live

---

## System Overview

TRADEBOT_live trades 4 currency pair strategies simultaneously during Zurich market hours:

| Pair | Trading Hours | Model | AI Model |
|------|---------------|-------|----------|
| EUR/USD | 8:00-18:00 | models/gpt4mini_eurusd | GPT-4o-mini |
| USD/JPY | 11:00-20:00 | models/gpt4mini_usdjpy | GPT-4o-mini |
| GBP/USD | 9:00-18:00 | models/gpt4mini_gbpusd_iter11 | GPT-4o-mini |
| EUR/USD (GPT5) | 8:00-18:00 | models/gpt5_iter5 | GPT-5.2 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      src/live_trader.js                          │
│            (Main Loop, Session Management, Dashboard)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   EURUSD    │  │   USDJPY    │  │   GBPUSD    │  ...         │
│  │   State     │  │   State     │  │   State     │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         v                v                v                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              src/trade_indicators.js                      │    │
│  │    (ATR, EMA, Swing Points, Support/Resistance)          │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                │                │                      │
│         v                v                v                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ strategy_   │  │ strategy_   │  │ strategy_   │              │
│  │ selector_   │  │ selector_   │  │ selector_   │              │
│  │ eurusd.js   │  │ usdjpy.js   │  │ gbpusd.js   │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         v                v                v                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  AI Agent System (models/)                │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │    │
│  │  │  Direction   │>│  Confidence  │>│    Levels    │      │    │
│  │  │    Agent     │ │    Agent     │ │    Agent     │      │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘      │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                        │
│         v                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                src/oanda_executor.js                       │    │
│  │    (Orders, Position Tracking, Price Streaming)           │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                        │
│         v                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     OANDA API                              │    │
│  │           (Practice or Live Account)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Main Engine (`src/live_trader.js`)
- 24/7 trading loop with per-pair session management
- Real-time OANDA price streaming and 5m bar aggregation
- Dashboard server on port 3000 with auto-refresh UI
- Ngrok tunnel support for remote access

### 2. Trade Executor (`src/oanda_executor.js`)
- Complete OANDA REST API wrapper
- Market orders (immediate) and Limit orders (pending)
- Bracket orders with TP/SL management
- Trade monitoring and transaction history
- Price streaming with auto-reconnection

### 3. Technical Indicators (`src/trade_indicators.js`)
- Session detection (Asia 1-10, London 8-17, NY 14-22 Zurich)
- Support/Resistance from swing point percentiles
- ATR (14-period, Wilder's smoothing)
- EMA (20, 50, 200 periods) with slope calculation
- Breakout and Sweep detection scores
- Market Regime classification (TREND/EXPANSION/RANGE)

### 4. Strategy Selectors (`src/strategy_selector_*.js`)
Each selector coordinates its agent system:
- `strategy_selector_eurusd.js` -> models/gpt4mini_eurusd/
- `strategy_selector_usdjpy.js` -> models/gpt4mini_usdjpy/
- `strategy_selector_gbpusd.js` -> models/gpt4mini_gbpusd_iter11/
- `strategy_selector_gpt5.js` -> models/gpt5_iter5/

### 5. AI Agent Systems (`models/`)
Each model directory contains:
- `orchestrator.js` - Coordinates the 3 agents, makes final decision
- `direction_agent.js` - Market structure & directional bias
- `confidence_agent.js` - Trade probability assessment
- `levels_agent.js` - Entry/SL/TP placement

---

## Configuration

### Execution Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| REAL_EXECUTION | true | Enable live trading |
| USE_LIMIT_ORDERS | false | Market orders (immediate) |
| FIXED_POSITION_SIZE | 1,000 | Units per trade ($0.10/pip) |
| COMMISSION_PER_TRADE | 0 | OANDA = spread only |
| MAX_PENDING_BARS | 12 | Cancel limit after 1 hour |
| HISTORY_BARS_NEEDED | 800 | Bars for indicator calculation |

### Risk Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| MIN_RISK | 0.15 | Minimum risk multiplier |
| MAX_RISK | 0.70 | Maximum risk multiplier |
| MIN_CONFIDENCE | 0.25 | Skip trade if probability < 25% |

---

## File Structure

```
TRADEBOT_live/
├── src/                              # Core runtime
│   ├── live_trader.js                # Main loop, dashboard, session mgmt
│   ├── oanda_executor.js             # OANDA API wrapper
│   ├── trade_indicators.js           # ATR, EMA, S/R, swing points
│   ├── pair_config.js                # Pair definitions
│   ├── strategy_selector_eurusd.js   # -> models/gpt4mini_eurusd/
│   ├── strategy_selector_usdjpy.js   # -> models/gpt4mini_usdjpy/
│   ├── strategy_selector_gbpusd.js   # -> models/gpt4mini_gbpusd_iter11/
│   └── strategy_selector_gpt5.js     # -> models/gpt5_iter5/
│
├── models/                           # Versioned AI agent checkpoints
│   ├── gpt4mini_eurusd/              # GPT-4o-mini baseline
│   ├── gpt4mini_usdjpy/              # GPT-4o-mini structure-aware
│   ├── gpt4mini_gbpusd_iter11/       # GPT-4o-mini risk-adjusted
│   └── gpt5_iter5/                   # GPT-5.2 best performer (78% WR)
│
├── tools/                            # Utilities & test scripts
│   ├── test_1k_order.js
│   ├── test_oanda_limit.js
│   ├── test_position_sizes.js
│   ├── check_oanda.js
│   ├── cancel_orders.js
│   ├── analyze_pnl.js
│   └── oanda_test.js
│
├── data/                             # Trade data & logs
│   ├── global_trades.json            # All-time trade history
│   ├── trade_results.json            # Daily session results
│   └── live_trader.log               # Runtime log (gitignored)
│
├── docs/                             # Documentation
│   ├── STRUCTURE.md                  # Master hub
│   ├── DIARY.md
│   ├── MISTAKES.md
│   ├── CONVENTIONS.md
│   ├── features/
│   ├── guidelines/
│   └── reports/
│
├── CONTEXT.md                        # <- This file
├── .env                              # Secrets (gitignored)
├── .gitignore
└── package.json
```

---

## Dashboard

**URL**: http://localhost:3000 (or ngrok tunnel)

### Endpoints
| Endpoint | Description |
|----------|-------------|
| GET `/` | HTML dashboard |
| GET `/status` | JSON system status |
| GET `/trades` | JSON trade history |
| GET `/oanda-live` | OANDA account + positions |

---

## Environment Variables

Required in `.env`:
```
OANDA_API_TOKEN=your_oanda_token
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENVIRONMENT=practice  # or 'live'
OPENAI_API_KEY=your_openai_key
```

---

## Running the System

```bash
npm start                    # Start trading
node src/live_trader.js      # Direct start
```

---

## Performance Notes

### GPT-5.2 Iter5 (EURUSD_GPT5)
- **Win Rate**: 78.0% (59 trades)
- **Total R**: +42.62R
- **Avg Win**: +0.57R
- **Avg Loss**: -0.48R
- **Max Win Streak**: 12

---

## Important Notes

- **Do NOT modify agent files** - They are trained models
- Trading hours are aligned with training configurations
- EURUSD_GPT5 shares market data with EURUSD (intentional)
- Commission is 0 for OANDA (spread-only)
- Position size is 1K units for demo account

---

## Quick Reference

| What | Where |
|------|-------|
| Start trading | `npm start` |
| View dashboard | http://localhost:3000 |
| Check logs | `data/live_trader.log` |
| Trade history | `data/global_trades.json` |
| Today's trades | `data/trade_results.json` |
| OANDA config | `.env` file |
| Agent prompts | `models/*/direction_agent.js` |
| Full docs | `docs/STRUCTURE.md` |
