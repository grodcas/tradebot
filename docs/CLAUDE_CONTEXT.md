# Claude Context - base_trainer Branch

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
│  The prompts in these agents are what we ITERATE.           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## This Branch: base_trainer

**Purpose**: Iterate and optimize the EUR/USD trading system using automated prompt improvement.

### Key Files

| File | Purpose |
|------|---------|
| `iteration_loop.js` | **Main script** - runs batch tests, analyzes results, improves prompts automatically |
| `batch_trainer.js` | Runs simulated trades on historical data |
| `live_trader.js` | Live paper trading with IBKR |
| `claude_agent.js` | Autonomous Claude agent for manual iteration |
| `agents/*.js` | The AI trading agents (prompts live here) |
| `trade_indicators.js` | Technical indicators (EMA, ATR, S/R, etc.) |
| `iteration_history.json` | Log of all iterations, metrics, mutations |

### How Iteration Works

```
1. Run 50 simulated trades (batch_trainer)
2. Calculate metrics:
   - Win Rate (target: >60%)
   - Profit Factor (target: >2.0)
   - Risk Differentiation (target: >0.15) ← confidence agent calibration
3. Analyze failures (quick losses, long losses, miscalibration)
4. Use Claude to generate prompt improvements
5. Apply changes to agent files
6. Repeat until improvement plateaus
7. If STUCK for 5 iterations → MUTATION (creative breakthrough)
   - Add new indicators
   - Change strategy angle
   - Add filters
```

### Current Performance (Benchmark)

From validation run (100 trades):
- Win Rate: 61.6%
- Profit Factor: 2.47
- SHORT bias: 64.9% WR
- LONG bias: 57.1% WR

### Running the Iterator

```bash
# Set your API keys in .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Run with default €10 budget
node iteration_loop.js

# Or with custom budget
ITERATION_BUDGET_EUR=20 node iteration_loop.js
```

### Cost

~€2/hour (~10-12 iterations per hour)

### What You Can Ask Claude To Do

1. **Run iteration loop**: "Run the iteration loop with €10 budget"
2. **Analyze results**: "Read iteration_history.json and summarize progress"
3. **Manual improvement**: "Read the direction agent, analyze why LONGs fail, and improve it"
4. **Add indicator**: "Add RSI indicator to trade_indicators.js and integrate into agents"
5. **Compare to benchmark**: "Compare current metrics to BENCHMARK_OLD_TRADES.md"

### Related Branches

- `prototype_1` - Live trading (24/7 mode)
- `scalper` - Tight TP/SL, momentum exits
- `other_pairs` - Multi-pair support (GBP/USD, USD/JPY, etc.)

---

*This file helps Claude understand the project context when starting a new chat.*
