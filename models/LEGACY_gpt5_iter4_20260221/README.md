# GPT-5 Iter4 Model

## Performance (Validated Feb 21, 2026)

| Dataset | Win Rate | Total R | Max Losing Streak |
|---------|----------|---------|-------------------|
| Recent (Nov'25-Feb'26) | 72.4% | +18.82R | 1 |
| Old (Aug'25-Nov'25) | 75.9% | +20.08R | 2 |
| **Combined (58 trades)** | **74.1%** | **+38.90R** | **2** |

## Key Features

### 1. Confidence Agent - EMA Alignment Focus
- EMA slope alignment marked as "Most Important"
- Trades WITH momentum get higher probability
- Trades AGAINST momentum penalized
- Cleaner probability ranges (0.70+, 0.55-0.70, 0.40-0.55, <0.40)

### 2. Levels Agent - Tight Stops Philosophy
- "Good losses happen QUICKLY"
- Stops at clear invalidation points, not arbitrary distances
- Stop quality assessment (TIGHT/NORMAL/WIDE)
- Market context awareness (RANGE vs TREND)

### 3. Direction Agent
- Standard baseline prompt
- Analyzes EMA, S/R, swing points, price location

## Usage

```bash
# Copy agents to active folder
cp saved_models/gpt5_iter4/*.js agents/

# Run with GPT-5.2
MODEL_VERSION=gpt5 node batch_trainer.js
MODEL_VERSION=gpt5 node live_trader.js
```

## Files
- `direction_agent.js` - Market structure analysis
- `confidence_agent.js` - EMA-aligned probability assessment
- `levels_agent.js` - Tight stops with invalidation logic
- `ai_client.js` - GPT-4/GPT-5.2 switching client
- `orchestrator.js` - Agent coordination

## Comparison vs GPT-4 Baseline
- +20.7% higher win rate
- +28.67R more profit (3.8x)
- Lower max losing streak (2 vs 3)

---

[Back to STRUCTURE](../../docs/STRUCTURE.md)
