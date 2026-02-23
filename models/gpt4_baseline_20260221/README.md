# GPT-4 Baseline Model

## Performance (Validated Feb 21, 2026)

| Dataset | Win Rate | Total R | Max Losing Streak |
|---------|----------|---------|-------------------|
| Recent (Nov'25-Feb'26) | 56.7% | +7.38R | 2 |
| Old (Aug'25-Nov'25) | 50.0% | +2.85R | 3 |
| **Combined (60 trades)** | **53.4%** | **+10.23R** | **3** |

## Key Features

### 1. Confidence Agent - Generic Assessment
- 6 expertise sections: Confluence, Location, Trend, Volatility, Structure, Freshness
- Verbose output with strengths/weaknesses arrays
- Generic calibration guide

### 2. Levels Agent - Standard RR Focus
- Basic entry/SL/TP placement
- Standard ATR guidance
- Focus on 1.2-1.5 RR target

### 3. Direction Agent
- Standard baseline prompt
- Analyzes EMA, S/R, swing points, price location

## Usage

```bash
# Copy agents to active folder
cp saved_models/gpt4_baseline/*.js agents/

# Run with GPT-4o-mini (default)
node batch_trainer.js
node live_trader.js
```

## Files
- `direction_agent.js` - Market structure analysis
- `confidence_agent.js` - Generic probability assessment
- `levels_agent.js` - Standard level placement
- `orchestrator.js` - Agent coordination

## Notes
- Uses GPT-4o-mini model (hardcoded)
- Original prompts from prototype_1 branch
- Superseded by GPT-5 Iter4 model
