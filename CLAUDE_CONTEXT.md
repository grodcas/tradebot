# Claude Context - other_pairs Branch

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

## This Branch: other_pairs

**Purpose**: Extend the trading system to work with **multiple forex pairs** (GBP/USD, USD/JPY, AUD/USD, etc.) instead of just EUR/USD.

### Key Files

| File | Purpose |
|------|---------|
| `pair_config.js` | **Pair configuration** - spread, pip scale, data files per pair |
| `live_trader.js` | Needs modification to use pair_config |
| `agents/*.js` | May need pair-specific prompt tuning |

### Supported Pairs (in pair_config.js)

| Pair | Symbol | Currency | Spread | Pip Scale | Notes |
|------|--------|----------|--------|-----------|-------|
| EUR/USD | EUR | USD | 0.00008 | 10000 | Base pair (use base_trainer) |
| GBP/USD | GBP | USD | 0.00012 | 10000 | Higher volatility |
| USD/JPY | USD | JPY | 0.008 | 100 | Different pip scale! |
| AUD/USD | AUD | USD | 0.00010 | 10000 | Commodity currency |
| USD/CHF | USD | CHF | 0.00012 | 10000 | Safe haven |

### Usage

```bash
# Set pair via environment variable
TRADING_PAIR=GBPUSD node live_trader.js

# Or modify DEFAULT_PAIR in pair_config.js
```

### What Needs To Be Done

1. **Integrate pair_config.js into live_trader.js**
   ```javascript
   const { getPairConfig, getContract } = require('./pair_config');
   const pairConfig = getPairConfig();
   const contract = getContract(pairConfig);
   ```

2. **Update paths to use pair-specific files**
   - Data file: `pairConfig.dataFile`
   - Results: `pairConfig.resultsFile`
   - Log: `pairConfig.logFile`

3. **Handle different pip scales**
   - JPY pairs use 0.01 = 1 pip (not 0.0001)
   - Use `pairConfig.pipMultiplier` for calculations

4. **Download historical data for each pair**
   - Use IBKR to fetch data
   - Save to `gbpusd_5m.json`, `usdjpy_5m.json`, etc.

5. **Consider pair-specific prompt tuning**
   - Different pairs have different characteristics
   - GBP/USD: More volatile, wider ranges
   - USD/JPY: Trends strongly, different session behavior

### Correlation Warning

| Pair Combo | Correlation | Effective Diversification |
|------------|-------------|---------------------------|
| EUR/USD + GBP/USD | ~85% | Poor (same trade twice) |
| EUR/USD + USD/JPY | ~-60% | Decent (inverse) |
| EUR/USD + AUD/USD | ~40% | Moderate |

**Don't run EUR/USD and GBP/USD simultaneously** - they're highly correlated. If you want more trades, choose uncorrelated pairs.

### Iteration Strategy

1. **Start with EUR/USD** (base_trainer branch) - get it profitable
2. **Clone to new pair** - copy trained prompts, adjust for pair characteristics
3. **Backtest on new pair** - validate performance
4. **Fine-tune** - iterate prompts for pair-specific patterns
5. **Run both** - if truly uncorrelated

### What You Can Ask Claude To Do

1. **Integrate config**: "Integrate pair_config.js into live_trader.js"
2. **Fetch data**: "Create a script to download GBP/USD historical data from IBKR"
3. **Adapt prompts**: "Modify direction_agent for GBP/USD - higher volatility, wider ranges"
4. **Run backtest**: "Run batch_trainer for GBP/USD and compare to EUR/USD baseline"
5. **Analyze correlation**: "Analyze if EUR/USD and USD/JPY signals are independent"

### Related Branches

- `base_trainer` - EUR/USD iteration with prompt optimization
- `prototype_1` - Live trading (24/7 mode)
- `scalper` - Scalping strategy

---

*This file helps Claude understand the project context when starting a new chat.*
