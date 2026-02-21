# GPT-5 Iter5 Model

## Performance (Validated Feb 21, 2026)

| Dataset | Win Rate | Total R | Max Losing Streak |
|---------|----------|---------|-------------------|
| Recent (Nov'25-Feb'26) | 86.2% | +20.80R | 1 |
| Old (Aug'25-Nov'25) | 70.0% | +21.81R | 2 |
| **Combined (59 trades)** | **78.0%** | **+42.61R** | **2** |

### Comparison vs Iter4
- +3.9% higher win rate (78.0% vs 74.1%)
- +3.71R more profit (+9.5%)
- Better risk calibration (sizing down on mixed signals)

Based on analysis of Iter4 losses, this iteration adds judgment-based improvements.

## Key Changes from Iter4

### Loss Pattern Analysis (Iter4)
- 80% of wins were structure-coherent, only 55% of losses were
- Losses took 83 bars avg vs 36 for wins ("slow losses")
- 10/11 losses were EMA-aligned (alignment alone not enough)
- Risk sizing identical between wins/losses (no proper calibration)

### 1. Confidence Agent - Structure Coherence Focus

**New concepts:**
- **Coherence Check**: Does regime match structure? If TREND regime but RANGE structure, be skeptical
- **Trend Quality**: Not just aligned, but HOW aligned? Weak EMA slope ≠ strong EMA slope
- **Market Decisiveness**: Is price making clean moves or chopping?
- **Aggressive sizing down**: Mixed signals → reduce size, don't trade full

**Philosophy shift:**
- Iter4: "EMA aligned = good"
- Iter5: "EMA aligned + coherent + decisive = good. Otherwise, size down."

### 2. Levels Agent - Path Clarity Focus

**New concepts:**
- **Trade Visualization**: Can you "see" how the trade works?
- **Path Clarity**: What's between entry and target? CLEAR / SOME_OBSTACLES / CLUTTERED
- **Setup Freshness**: Is this level active or stale?
- **Stop Quality**: Does the stop make sense structurally?

**Philosophy shift:**
- Iter4: "Good losses are fast"
- Iter5: "Good losses are fast. Can you visualize the trade working smoothly?"

### 3. Direction Agent - Readability First

**New concepts:**
- **Market Readability**: Is this market telling a clear story?
- **Structure Quality**: CLEAN vs MESSY patterns
- **Signal Clarity**: HIGH / MEDIUM / LOW explicit rating

**Philosophy shift:**
- Iter4: "Determine direction"
- Iter5: "Is the market readable? If not, that's valuable info."

## Expected Improvements

1. **Fewer incoherent trades**: Should avoid RANGE regime + TREND structure mismatches
2. **Better risk calibration**: Size down on mixed signals instead of full size
3. **Avoid choppy markets**: "MESSY" readability → skip or reduce
4. **Faster exits**: Better stop placement with visualization requirement

## Usage

```bash
# Copy agents to active folder
cp saved_models/gpt5_iter5/*.js agents/

# Run with GPT-5.2
MODEL_VERSION=gpt5 node batch_trainer.js
```

## Files
- `direction_agent.js` - Market readability + structure quality
- `confidence_agent.js` - Coherence + trend quality + decisiveness
- `levels_agent.js` - Path clarity + visualization + freshness
- `ai_client.js` - GPT-5.2 client (from Iter4)
- `orchestrator.js` - Agent coordination (from Iter4)

## Validation Required
Run against both datasets to compare with Iter4:
- Recent data (Nov'25-Feb'26)
- Old data (Aug'25-Nov'25)

Target: Maintain 74%+ win rate with improved R/risk calibration.
