# GPT-5 Iter5 Model

## Performance (Validated Feb 21, 2026)

| Dataset | Win Rate | Total R | Trades | Max Loss Streak |
|---------|----------|---------|--------|-----------------|
| Recent (Nov'25-Feb'26) | 86.2% | +20.82R | 29 | 2 |
| Old (Aug'25-Nov'25) | 70.0% | +21.80R | 30 | 3 |
| **Combined** | **78.0%** | **+42.62R** | **59** | **3** |

### Detailed Statistics

**Long/Short Distribution:**
- Recent: 69% Long / 31% Short (Long WR: 85%, Short WR: 89%)
- Old: 67% Long / 33% Short (Long WR: 75%, Short WR: 60%)

**Risk Distribution:**
- Low (<0.4): 12 trades, 83% WR
- Med (0.4-0.55): 43 trades, 79% WR
- High (0.55+): 4 trades, 50% WR

**Risk-Win Correlation:**
- Avg risk on wins: 0.46
- Avg risk on losses: 0.48
- Correlation: Neutral (not yet optimized)

**Streaks:**
- Max Win Streak: 12 (recent), 6 (old)
- Max Loss Streak: 2 (recent), 3 (old)

**Skip/Wait:** 4 total scenarios triggered SKIP recommendation

### Comparison vs Iter4
- +3.9% higher win rate (78.0% vs 74.1%)
- +3.72R more profit (+9.6%)
- Conservative sizing (most trades at 0.4-0.55 risk)

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

## Known Limitations
- Long bias (67-69% of trades are longs)
- Risk-win correlation not optimized (losses have similar sizing to wins)
- Conservative sizing caps most trades at 0.5 risk

---

[Back to STRUCTURE](../../docs/STRUCTURE.md)
