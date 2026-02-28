# GPT-5 Market Order Model

**Created**: Feb 28, 2026
**Purpose**: Agents adapted for MARKET ORDER trading (not limit orders)

## Key Difference from Previous Models

Previous models (Iter1-5) assumed **limit order** entry at AI's suggested price.
This model assumes **market order** entry at current price.

### Impact
- Entry happens NOW at market price (can't wait for ideal level)
- SL/TP must be adjusted from actual fill, not AI suggestion
- Wider stops needed (1.0+ ATR) to survive market noise
- Entry location quality becomes critical

## Current Status

**Active Iteration**: Iter8 (Reverted to Iter5 direction logic)

| Iteration | Win Rate | Status | Key Change |
|-----------|----------|--------|------------|
| [Iter5](iterations/iter5_market_baseline.md) | 42.3% | Baseline | Market order awareness |
| [Iter6](iterations/iter6_position_fading.md) | 14.8% | FAILED | Position fading (fought trends) |
| [Iter7](iterations/iter7_trend_first.md) | 28.6% | Partial fix | Trend detection first |
| **[Iter8](iterations/iter8_revert_to_iter5.md)** | **TBD** | **ACTIVE** | **Revert to Iter5 direction** |

### Why We Reverted

After Iter6 and Iter7 failed to improve on the baseline, we determined the original Iter5 direction logic was correct. The issue was market order simulation, not direction logic. See [iter8_revert_to_iter5.md](iterations/iter8_revert_to_iter5.md) for full explanation.

## Iteration History

See `iterations/` folder for detailed logs of each iteration:
- What was changed
- Test results
- Why it worked or failed
- Lessons learned

## Files

| File | Description |
|------|-------------|
| `direction_agent.js` | Trend-first direction logic |
| `confidence_agent.js` | Trend validation before position |
| `levels_agent.js` | Market order level placement |
| `orchestrator.js` | Agent coordination |
| `ai_client.js` | GPT-5 API client |

## Usage

```bash
# Copy to active agents folder
cp models/gpt5_market_order_20260228/*.js src/agents/

# Run batch trainer
node src/batch_trainer.js --scenarios 20
```

## Known Issues

1. **Simulator fixed**: Now enters at next bar's open (market price)
2. **R:R preserved**: SL/TP adjusted to maintain original risk/reward ratio
3. **Trend vs Range**: Must detect regime before applying direction logic

---

[Back to Models](../README.md) | [STRUCTURE](../../docs/STRUCTURE.md)
