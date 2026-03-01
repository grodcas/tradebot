# Model System

Versioned AI agent checkpoints stored in `models/`.

---

## Overview

Each model directory is a self-contained agent system that was trained in the TRADEBOT repo and deployed here. Models are never modified in TRADEBOT_live -- they are treated as frozen checkpoints.

---

## Directory Structure

```
models/
├── gpt4mini_eurusd/
│   ├── orchestrator.js
│   ├── direction_agent.js
│   ├── confidence_agent.js
│   ├── levels_agent.js
│   └── metadata.json
├── gpt4mini_usdjpy/
│   └── ...
├── gpt4mini_gbpusd_iter11/
│   └── ...
└── gpt5_iter5/
    ├── orchestrator.js
    ├── direction_agent.js
    ├── confidence_agent.js
    ├── levels_agent.js
    ├── ai_client.js          # GPT-5.2 API wrapper
    ├── README.md
    └── metadata.json
```

---

## metadata.json Schema

```json
{
  "name": "gpt5_iter5",
  "pair": "EUR/USD",
  "llm": "gpt-5.2",
  "iteration": 5,
  "source": "TRADEBOT",
  "features": ["direction_agent", "confidence_agent", "levels_agent", "ai_client"],
  "agents": 3,
  "notes": "Description of what makes this model special"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Directory name |
| `pair` | Yes | Trading pair (e.g., "EUR/USD") |
| `llm` | Yes | LLM model used (e.g., "gpt-4o-mini", "gpt-5.2") |
| `iteration` | No | Training iteration number |
| `source` | Yes | Source repo (TRADEBOT, TRADEBOT_GBPUSD, etc.) |
| `features` | Yes | List of agent files |
| `agents` | Yes | Number of agents |
| `notes` | No | Free-text description |

---

## Swapping a Model

1. Copy the new agent files to `models/{name}/`
2. Create `metadata.json`
3. Update the strategy selector in `src/strategy_selector_{pair}.js`:
   ```javascript
   // Change the require path to point to the new model
   const { orchestrateTrade } = require('../models/{new_model}/orchestrator');
   ```
4. Test: `node -e "require('./src/strategy_selector_{pair}')"`
5. Smoke test: `node src/live_trader.js`

---

## Current Models

| Model | Pair | LLM | Key Feature |
|-------|------|-----|-------------|
| gpt4mini_eurusd | EUR/USD | GPT-4o-mini | Baseline |
| gpt4mini_usdjpy | USD/JPY | GPT-4o-mini | Structure-aware |
| gpt4mini_gbpusd_iter11 | GBP/USD | GPT-4o-mini | Bad pattern detection |
| gpt5_iter5 | EUR/USD | GPT-5.2 | Best performer (78% WR) |

---

[Back to STRUCTURE](../STRUCTURE.md)
