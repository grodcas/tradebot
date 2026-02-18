# Branch: base_trainer

## Purpose
Iterate and improve the **EUR/USD trading system** using the Claude autonomous agent.

## Current System Stats (Backtest)

| Metric | Value |
|--------|-------|
| Win Rate | 61.6% |
| Profit Factor | 2.47 |
| Avg R/Trade | +0.31R |
| SHORT WR | 64.9% |
| LONG WR | 57.1% |

## Live Session (Feb 18, 2026)

| Metric | Value |
|--------|-------|
| Trades | 7 |
| Win Rate | 57.1% |
| Total R | +3.31R weighted |
| SHORT WR | 80% (4/5) |
| LONG WR | 0% (0/2) |

## Iteration Workflow

```
┌─────────────────────────────────────────┐
│           DAILY LOOP                    │
├─────────────────────────────────────────┤
│ 1. Run live_trader.js (08:00-18:00)     │
│ 2. Collect trade results                │
│ 3. Run Claude agent to analyze          │
│ 4. Agent modifies agent prompts         │
│ 5. Next day: test changes               │
│ 6. Repeat                               │
└─────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `live_trader.js` | Live paper trading system |
| `batch_trainer.js` | Backtest on historical data |
| `claude_agent.js` | Autonomous iteration agent |
| `agents/direction_agent.js` | Decides LONG/SHORT/WAIT |
| `agents/confidence_agent.js` | Assigns risk 0.0-1.0 |
| `agents/levels_agent.js` | Sets entry, TP, SL |
| `trade_results.json` | Today's trade results |
| `BENCHMARK_OLD_TRADES.md` | Backtest reference stats |

## Usage

### Run Live Trading
```bash
node live_trader.js
```

### Run Backtest
```bash
node batch_trainer.js
```

### Iterate with Claude Agent
```bash
# Analyze and improve
node claude_agent.js "Analyze trade_results.json, compare to BENCHMARK_OLD_TRADES.md, and suggest improvements to direction_agent.js for better LONG performance"

# Run specific improvement
node claude_agent.js "Add momentum check to direction_agent.js - only go LONG if last 3 bars are green"

# Full iteration cycle
node claude_agent.js "Read today's results, identify the worst trade, understand why it failed, and modify the relevant agent to prevent similar losses"
```

## Iteration Targets

Based on live session analysis:

1. **LONG performance** - Both LONGs failed (0/2)
   - Add momentum filter?
   - Require stronger confirmation?

2. **Confidence calibration** - Risk nearly identical on wins/losses
   - Should differentiate more (0.3-0.7 range)

3. **Time filter** - Trade #1 at 07:05 failed
   - No trades before 08:00?

4. **Trade #4 sat 52 bars then lost**
   - Add time-based exit?
   - Partial TP to lock gains?

## Requirements

```
OPENAI_API_KEY=sk-...      # For trading agents
ANTHROPIC_API_KEY=sk-ant-...  # For Claude iteration agent
```
