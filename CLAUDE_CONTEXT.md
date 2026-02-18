# Claude Context - prototype_1 Branch

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

## This Branch: prototype_1

**Purpose**: **Live paper trading** with IBKR. This is the production branch that runs 24/7.

### Key Features

- **24/7 Mode**: Dashboard always on, trading only during 8:00-18:00 Zurich time
- **Web Dashboard**: Real-time monitoring at `http://localhost:3000`
- **ngrok Integration**: Remote access via public URL
- **Auto-reconnect**: Connects to IBKR at session start, disconnects at end
- **Position Management**: Tracks open positions, waits for TP/SL before session end

### Key Files

| File | Purpose |
|------|---------|
| `live_trader.js` | **Main script** - runs the live trading loop |
| `trade_results.json` | Today's trade results |
| `live_trader.log` | Full log of all activity |
| `BENCHMARK_OLD_TRADES.md` | Backtest reference (100 trades) |
| `LIVE_SESSION_ANALYSIS_*.md` | Daily session analysis |

### Running Live Trading

```bash
# Start (runs 24/7)
node live_trader.js

# Dashboard will be at:
# - Local: http://localhost:3000
# - Remote: https://xxx.ngrok-free.dev (check log)
```

### Session Schedule

```
00:00-08:00  Dashboard running, waiting for session
08:00        Connect to IBKR, load historical data, start trading
08:00-18:00  Active trading - monitoring for setups
18:00        Stop opening new trades, wait for open position to close
18:00+       Disconnect IBKR, wait for next session
```

### First Live Session Results (Feb 18, 2026)

| Metric | Value |
|--------|-------|
| Trades | 7 |
| Win Rate | 57.1% (4/7) |
| Total R | +3.31R weighted |
| LONG WR | 0% (0/2) |
| SHORT WR | 80% (4/5) |
| Big Winner | Trade #6: +3.38R |

### Backtest Benchmark (Reference)

| Metric | Backtest | Live Target |
|--------|----------|-------------|
| Win Rate | 61.6% | >55% |
| Profit Factor | 2.47 | >1.5 |
| Avg R/Trade | +0.31R | >+0.20R |

### Windows Settings for 24/7 Running

1. **Power Settings**: Set "Sleep" to Never
2. **Network Adapter**: Disable "turn off to save power"
3. **Windows Update**: Disable auto-restart
4. **Terminal**: Keep open or use PM2:
   ```bash
   npm install -g pm2
   pm2 start live_trader.js --name tradebot
   ```

### What You Can Ask Claude To Do

1. **Check status**: "Read live_trader.log and tell me what's happening"
2. **Analyze session**: "Analyze today's trades from trade_results.json"
3. **Compare to benchmark**: "Compare today's results to BENCHMARK_OLD_TRADES.md"
4. **Fix issues**: "The bot disconnected, check the log and help me fix it"
5. **Modify settings**: "Change trading hours to 9:00-17:00"

### Related Branches

- `base_trainer` - Prompt iteration and optimization
- `scalper` - Scalping strategy experiments
- `other_pairs` - Multi-pair support

### Important Notes

- This branch is for **live execution**, not experimentation
- Test changes in `base_trainer` first, then merge here
- Always check `live_trader.log` for connection issues
- The bot uses **paper trading** (simulated) - no real money at risk

---

*This file helps Claude understand the project context when starting a new chat.*
