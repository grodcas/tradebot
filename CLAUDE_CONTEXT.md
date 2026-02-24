# Claude Context - gbpusd Branch

## What This Project Is

This is an **AI-powered forex trading system** that uses language models (GPT-4o-mini) to make trading decisions. The core innovation is that we **iterate on the AI prompts** to improve performance, treating prompt engineering as a form of machine learning.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADING SYSTEM                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MARKET DATA (IBKR) ──► INDICATORS ──► AI AGENTS ──► TRADE │
│                                                             │
│  AI Agents (GPT-4o-mini):                                   │
│  ├─ direction_agent.js  → LONG / SHORT / WAIT              │
│  ├─ confidence_agent.js → Risk 0.0 - 1.0                   │
│  └─ levels_agent.js     → Entry, TP, SL prices             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## This Branch: gbpusd (GBP/USD Focus)

**Purpose**: Trade **GBP/USD** during optimal hours (09:00-18:00 CET - London session).

### Trading Configuration

| Parameter | Value |
|-----------|-------|
| **Pair** | GBP/USD |
| **Trading Hours** | 09:00 - 18:00 CET |
| **Spread** | 0.00012 |
| **Pip Scale** | 10000 (1 pip = 0.0001) |

### Key Files

| File | Purpose |
|------|---------|
| `pair_config.js` | Pair configuration (spread, pip scale, paths) |
| `historical_data_gbpusd.js` | Download GBP/USD 5-min data from IBKR |
| `gbpusd_5m.json` | Historical data for backtesting |
| `live_trader.js` | Live trading (needs pair_config integration) |
| `agents/*.js` | AI agents (may need GBP/USD tuning) |

### GBP/USD Characteristics

- **Pip scale**: 0.0001 = 1 pip (same as EUR/USD)
- **Higher volatility** than EUR/USD - larger swings
- **Session behavior**: Most active during London session (08:00-16:00 GMT)
- **Correlation**: ~85% with EUR/USD (moves similarly)
- **News sensitive**: Reacts strongly to UK economic data

### Quick Start

```bash
# 1. Download historical data (requires IBKR TWS/Gateway on port 4002)
node historical_data_gbpusd.js

# 2. Run backtest
node batch_trainer.js

# 3. Live trade
node live_trader.js
```

### What Needs To Be Done

1. **Download GBP/USD data** - Run `historical_data_gbpusd.js`
2. **Integrate pair_config.js into live_trader.js**
3. **Adapt AI prompts for GBP/USD** - higher volatility patterns
4. **Backtest and iterate** - optimize for GBP/USD behavior

### Related Workspaces

- `TRADEBOT_usdjpy` - USD/JPY trading
- `TRADEBOT_eurusd` - EUR/USD trading (if exists)

---

*This file helps Claude understand the project context when starting a new chat.*
