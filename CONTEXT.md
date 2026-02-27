# TRADEBOT_live - System Context

> Multi-pair AI-powered forex trading system running live on OANDA with GPT-powered decision-making.

**Last Updated**: 2026-02-27
**Status**: Production Ready
**Branch**: prototype_1

---

## System Overview

TRADEBOT_live trades 4 currency pair strategies simultaneously during Zurich market hours:

| Pair | Trading Hours | Strategy | AI Model |
|------|---------------|----------|----------|
| EUR/USD | 8:00-18:00 | agents_eurusd | GPT-4o-mini |
| USD/JPY | 11:00-20:00 | agents_usdjpy | GPT-4o-mini |
| GBP/USD | 9:00-18:00 | agents_gbpusd | GPT-4o-mini |
| EUR/USD (GPT5) | 8:00-18:00 | agents_gpt5 | GPT-5.2 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        live_trader.js                           │
│              (Main Loop, Session Management, Dashboard)         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   EURUSD    │  │   USDJPY    │  │   GBPUSD    │  ...        │
│  │   State     │  │   State     │  │   State     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              trade_indicators.js                         │   │
│  │    (ATR, EMA, Swing Points, Support/Resistance)         │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ strategy_   │  │ strategy_   │  │ strategy_   │             │
│  │ selector_   │  │ selector_   │  │ selector_   │             │
│  │ eurusd.js   │  │ usdjpy.js   │  │ gbpusd.js   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   AI Agent System                        │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │  Direction   │→│  Confidence  │→│    Levels    │     │   │
│  │  │    Agent     │ │    Agent     │ │    Agent     │     │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  oanda_executor.js                       │   │
│  │      (Orders, Position Tracking, Price Streaming)        │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     OANDA API                            │   │
│  │           (Practice or Live Account)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Main Engine (`live_trader.js`)
- 24/7 trading loop with per-pair session management
- Real-time OANDA price streaming and 5m bar aggregation
- Dashboard server on port 3000 with auto-refresh UI
- Ngrok tunnel support for remote access

### 2. Trade Executor (`oanda_executor.js`)
- Complete OANDA REST API wrapper
- Market orders (immediate) and Limit orders (pending)
- Bracket orders with TP/SL management
- Trade monitoring and transaction history
- Price streaming with auto-reconnection

### 3. Technical Indicators (`trade_indicators.js`)
- Session detection (Asia 1-10, London 8-17, NY 14-22 Zurich)
- Support/Resistance from swing point percentiles
- ATR (14-period, Wilder's smoothing)
- EMA (20, 50, 200 periods) with slope calculation
- Breakout and Sweep detection scores
- Market Regime classification (TREND/EXPANSION/RANGE)

### 4. Strategy Selectors (4 files)
Each selector coordinates its agent system:
- `strategy_selector_eurusd.js` → agents_eurusd/
- `strategy_selector_usdjpy.js` → agents_usdjpy/
- `strategy_selector_gbpusd.js` → agents_gbpusd/
- `strategy_selector_gpt5.js` → agents_gpt5/

### 5. AI Agent Systems (4 directories)
Each directory contains:
- `orchestrator.js` - Coordinates the 3 agents, makes final decision
- `direction_agent.js` - Market structure & directional bias
- `confidence_agent.js` - Trade probability assessment
- `levels_agent.js` - Entry/SL/TP placement

---

## Configuration

### Pair Configuration

```javascript
PAIRS = {
  EURUSD: {
    oandaInstrument: 'EUR_USD',
    spread: 0.00008,         // 0.8 pips
    pipMultiplier: 10000,    // 1 pip = 0.0001
    tradingHours: { start: 8, end: 18 }
  },
  USDJPY: {
    oandaInstrument: 'USD_JPY',
    spread: 0.008,           // 0.8 pips
    pipMultiplier: 100,      // 1 pip = 0.01
    tradingHours: { start: 11, end: 20 }
  },
  GBPUSD: {
    oandaInstrument: 'GBP_USD',
    spread: 0.00010,         // 1.0 pip
    pipMultiplier: 10000,
    tradingHours: { start: 9, end: 18 }
  },
  EURUSD_GPT5: {
    oandaInstrument: 'EUR_USD',
    sharesDataWith: 'EURUSD',
    tradingHours: { start: 8, end: 18 }
  }
}
```

### Execution Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| REAL_EXECUTION | true | Enable live trading |
| USE_LIMIT_ORDERS | true | Limit orders (wait for price) |
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

## Decision Flow

### Per-Bar Processing (5-minute candles)

1. **Price Stream** → OANDA WebSocket receives bid/ask quotes
2. **Bar Aggregation** → Updates pending 5m bar (OHLC)
3. **Bar Finalization** → When 5 minutes pass, bar is locked
4. **Indicator Calculation** → ATR, EMA, swing points, S/R
5. **Agent Orchestration**:
   - **Direction Agent** → BULLISH / BEARISH / NEUTRAL
   - **Confidence Agent** → Probability (0.0-1.0)
   - **Levels Agent** → Entry / SL / TP
6. **Validation** → Risk clamping, level sanity checks
7. **Execution** → LIMIT or MARKET order to OANDA
8. **Position Monitoring** → Track TP/SL hits
9. **Position Close** → Record outcome and P&L

---

## File Structure

```
TRADEBOT_live/
├── live_trader.js           # Main trading engine (1,831 lines)
├── oanda_executor.js        # OANDA API wrapper (1,109 lines)
├── trade_indicators.js      # Technical indicators (1,813 lines)
├── strategy_selector_eurusd.js
├── strategy_selector_usdjpy.js
├── strategy_selector_gbpusd.js
├── strategy_selector_gpt5.js
│
├── agents_eurusd/           # EUR/USD agents (GPT-4o-mini)
│   ├── orchestrator.js
│   ├── direction_agent.js
│   ├── confidence_agent.js
│   └── levels_agent.js
│
├── agents_usdjpy/           # USD/JPY agents (GPT-4o-mini)
│   └── ...
│
├── agents_gbpusd/           # GBP/USD agents (GPT-4o-mini)
│   └── ...
│
├── agents_gpt5/             # EUR/USD GPT-5.2 experimental
│   ├── orchestrator.js
│   ├── direction_agent.js
│   ├── confidence_agent.js
│   ├── levels_agent.js
│   ├── ai_client.js         # GPT-5.2 API wrapper
│   └── README.md            # Performance documentation
│
├── docs/                    # Documentation
│   ├── STRUCTURE.md
│   ├── DIARY.md
│   ├── MISTAKES.md
│   └── features/
│
├── global_trades.json       # All historical trades
├── trade_results.json       # Today's session trades
├── live_trader.log          # Runtime logs
├── .env                     # Secrets (OANDA, OpenAI)
└── package.json             # Dependencies
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

### Features
- Real-time pair status cards
- Position tracking (if open)
- Recent trades per pair
- Global statistics (WR, R, P&L)
- OANDA live account data
- Auto-refresh every 10 seconds

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
# Start trading
node live_trader.js

# Output:
# Dashboard running at http://localhost:3000
# Trading hours: 8:00 - 18:00 Europe/Zurich
# Active pairs: EURUSD, USDJPY, EURUSD_GPT5, GBPUSD
```

The system will:
1. Connect to OANDA API
2. Fetch 800 historical bars per pair
3. Start price streaming
4. Wait for trading hours
5. Process bars and execute trades
6. Continue until session ends

---

## Performance Notes

### GPT-5.2 Iter5 (EURUSD_GPT5)
- **Win Rate**: 78.0% (59 trades)
- **Total R**: +42.62R
- **Avg Win**: +0.57R
- **Avg Loss**: -0.48R
- **Max Win Streak**: 12

### Standard Agents (GPT-4o-mini)
- Baseline performance documented in batch training
- Per-pair results in `global_trades.json`

---

## Known Limitations

1. **Fixed Position Size** - No equity-based scaling
2. **No Notifications** - Dashboard only, no alerts
3. **JSON Storage** - Not ideal for high-volume data
4. **Single Timeframe** - 5m bars only (aggregates to 30m)

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
| Start trading | `node live_trader.js` |
| View dashboard | http://localhost:3000 |
| Check logs | `live_trader.log` |
| Trade history | `global_trades.json` |
| Today's trades | `trade_results.json` |
| OANDA config | `.env` file |
| Agent prompts | `agents_*/direction_agent.js` |
