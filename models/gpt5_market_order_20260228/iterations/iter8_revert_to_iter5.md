# Iteration 8: Revert to Iter5 Direction Logic

**Date**: Feb 28, 2026
**Status**: ACTIVE - Best performing configuration

## Decision: Revert Direction/Confidence to Iter5

After testing Iter6 and Iter7, we determined that changing the direction logic was a mistake. The original Iter5 direction logic performed best.

### Performance Comparison

| Iteration | Win Rate | Weighted R | Direction Logic |
|-----------|----------|------------|-----------------|
| **Iter5 (baseline)** | **42.3%** | **-2.40R** | Original (EMA + structure) |
| Iter6 (position fading) | 14.8% | -3.25R | Fade edges (failed) |
| Iter7 (trend-first) | 28.6% | -0.91R | Trend threshold 0.15 (partial fix) |
| **Iter8 (revert)** | **TBD** | **TBD** | Back to Iter5 |

### Why We Reverted

1. **Iter5 had the best WR (42.3%)** - Neither Iter6 nor Iter7 improved it
2. **Direction logic wasn't the problem** - The SHORT bias analysis was misinterpreted
3. **Overengineering** - Adding position/trend rules made it worse, not better

### What We Keep

| Component | Version | Reason |
|-----------|---------|--------|
| `direction_agent.js` | **Iter5** | Best WR, don't change what works |
| `confidence_agent.js` | **Iter5** | Original coherence logic |
| `levels_agent.js` | **Market Order Aware** | Needed for realistic simulation |
| `orchestrator.js` | **Iter5** | No changes needed |

### What We Learned

1. **Don't fix what isn't broken** - Iter5 direction logic worked, we broke it
2. **Position fading fights trends** - Iter6 lesson documented in MISTAKES.md
3. **Slope thresholds need validation** - 0.15 too low, but raising it didn't help enough
4. **The real issue is market order entry** - Not direction logic

### Files Changed

```
src/agents/direction_agent.js  → Reverted to Iter5
src/agents/confidence_agent.js → Reverted to Iter5
src/agents/levels_agent.js     → Keep market order aware version
```

### Failed Attempts Saved

The Iter6/Iter7 direction agents are preserved in:
```
iterations/failed_attempts/direction_agent_iter7.js
iterations/failed_attempts/confidence_agent_iter7.js
```

## Next Steps

1. Test this configuration (Iter5 direction + market order levels)
2. If WR returns to ~42%, focus on other improvements:
   - Stop loss placement
   - R:R optimization
   - Better market regime detection
3. Do NOT change direction logic again without strong evidence

---

**Key Lesson**: The original Iter5 prompts were well-tuned. Market order simulation revealed issues with the SIMULATOR, not the direction logic. We wasted iterations trying to fix the wrong thing.
