# TRADEBOT - AI-Powered EUR/USD Trading System

An iterative AI trading system that uses GPT models to generate trading signals for EUR/USD forex pairs.

## Current Best Model

**GPT-5 Iter5** (v1.0) - 78% Win Rate, +42.62R across 59 trades

## Repository Structure

```
TRADEBOT/
├── src/                    # Core source code
│   ├── agents/             # AI agent prompts (the "model")
│   │   ├── direction_agent.js    # Market structure analysis
│   │   ├── confidence_agent.js   # Probability/sizing assessment
│   │   ├── levels_agent.js       # Entry/SL/TP placement
│   │   ├── orchestrator.js       # Agent coordination
│   │   └── ai_client.js          # GPT API client
│   ├── batch_trainer.js    # Backtest engine
│   ├── live_trader.js      # Live/paper trading
│   ├── iteration_loop.js   # Auto-improvement loop
│   ├── strategy_selector.js # Decision validation
│   └── trade_indicators.js # Technical analysis
│
├── data/                   # Historical price data
│   ├── eurusd_5m_recent.json   # Nov 2025 - Feb 2026
│   └── eurusd_5m_old.json      # Aug 2025 - Nov 2025
│
├── models/                 # Saved model versions
│   └── {name}_{YYYYMMDD}/  # e.g., gpt5_iter5_20260221/
│       ├── metadata.json   # Model info & test results
│       ├── direction_agent.js
│       ├── confidence_agent.js
│       ├── levels_agent.js
│       └── ...
│
├── results/                # Test results
│   └── trade_results.json  # Latest backtest output
│
├── tools/                  # Utility scripts
│   ├── analyze_trades.js   # Trade analysis
│   ├── run_all_tests.js    # Model comparison
│   └── ...
│
├── docs/                   # Documentation
├── archive/                # Old files & iterations
└── DIARY.md               # Development log
```

## Quick Start

### 1. Setup

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and add your API keys:
# - OPENAI_API_KEY (required)
# - ANTHROPIC_API_KEY (for iteration loop)
```

### 2. Run a Backtest

```bash
# Run 30 simulated trades using current agents
node src/batch_trainer.js

# Results saved to results/trade_results.json
```

### 3. Run Live Paper Trading

```bash
# Requires IBKR Gateway running on port 4002
node src/live_trader.js

# Dashboard available at http://localhost:3000
```

### 4. Improve the Model

```bash
# Run automated improvement loop
ITERATION_BUDGET_EUR=10 node src/iteration_loop.js
```

## How It Works

### The Trading System

1. **Direction Agent** reads market structure (EMA, support/resistance, swings)
2. **Confidence Agent** assesses probability and recommends sizing
3. **Levels Agent** sets entry, stop loss, and take profit levels
4. Trade is executed if confidence > threshold

### What is a "Model"?

A model is the complete set of agent prompts that determine trading decisions:
- `direction_agent.js` - How to read market direction
- `confidence_agent.js` - How to assess trade quality
- `levels_agent.js` - How to set entry/exit levels
- `orchestrator.js` - How to coordinate agents

### Iteration Loop

The system automatically improves by:
1. Running 30 simulated trades
2. Analyzing wins vs losses
3. Using Claude to suggest prompt improvements
4. Repeating until performance plateaus

## Naming Conventions

### Models
Format: `{base_model}_{iteration}_{YYYYMMDD}`

Examples:
- `gpt4_baseline_20260221` - GPT-4 baseline from Feb 21
- `gpt5_iter5_20260221` - GPT-5 iteration 5 from Feb 21

### Test Results
Format: `{YYYYMMDD}_{model}_{dataset}.json`

Examples:
- `20260221_gpt5_iter5_recent.json`
- `20260221_gpt4_baseline_old.json`

### Data Files
- `eurusd_5m_recent.json` - Recent data (current to ~3 months ago)
- `eurusd_5m_old.json` - Older data (3-6 months ago)

## Common Tasks

### Load a Saved Model

```bash
# Copy model agents to active folder
cp models/gpt5_iter5_20260221/*.js src/agents/
```

### Test Multiple Models

```bash
node tools/run_all_tests.js
```

### Analyze Trade Results

```bash
node tools/analyze_trades.js
```

### Save Current Model

```bash
# Create new model folder with date
mkdir models/gpt5_iter6_$(date +%Y%m%d)

# Copy current agents
cp src/agents/*.js models/gpt5_iter6_$(date +%Y%m%d)/

# Don't forget to create metadata.json!
```

## Model Performance History

| Model | Win Rate | Total R | Trades | Date |
|-------|----------|---------|--------|------|
| GPT-4 Baseline | 53.4% | +10.23R | 60 | Feb 21, 2026 |
| GPT-5 Iter4 | 74.1% | +38.90R | 58 | Feb 21, 2026 |
| **GPT-5 Iter5** | **78.0%** | **+42.62R** | **59** | Feb 21, 2026 |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models | Yes |
| `ANTHROPIC_API_KEY` | Anthropic key for iteration loop | For iteration |
| `MODEL_VERSION` | `gpt4` or `gpt5` | No (default: gpt4) |
| `ITERATION_BUDGET_EUR` | Budget for iteration loop | No (default: 10) |
| `TRADE_DELAY` | Delay between trades in ms | No (default: 3000) |

## Files Overview

### Core Files

| File | Purpose |
|------|---------|
| `src/batch_trainer.js` | Simulates trades on historical data |
| `src/live_trader.js` | Paper/live trading with IBKR |
| `src/iteration_loop.js` | Automated prompt improvement |
| `src/trade_indicators.js` | Technical analysis (EMA, ATR, S/R) |
| `src/strategy_selector.js` | Decision validation & risk clamping |

### Agent Files

| File | Role |
|------|------|
| `direction_agent.js` | Determines LONG/SHORT/NEUTRAL bias |
| `confidence_agent.js` | Outputs probability 0-1 & sizing recommendation |
| `levels_agent.js` | Sets entry, stop loss, take profit |
| `orchestrator.js` | Coordinates agents, handles skip logic |
| `ai_client.js` | API wrapper for GPT-4/GPT-5 |

## Development

See `DIARY.md` for daily development notes and `docs/` for detailed documentation.

## License

Private repository. All rights reserved.
