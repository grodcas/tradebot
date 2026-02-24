# TRADEBOT Development Diary

## Feb 21, 2026

### What We Did

1. **Compared GPT-4 Baseline vs GPT-5 Iter4**
   - GPT-4 Baseline: 53.4% WR, +10.23R (60 trades)
   - GPT-5 Iter4: 74.1% WR, +38.90R (58 trades)
   - Saved both models in `saved_models/` with documentation

2. **Analyzed Iter4 Loss Patterns**
   - 80% of wins were structure-coherent, only 55% of losses
   - EMA alignment alone not enough (10/11 losses were aligned)
   - Losses took 83 bars avg vs 36 for wins
   - Risk sizing identical between wins/losses (no calibration)

3. **Created GPT-5 Iter5** with improvements:
   - Structure coherence check (regime/structure match)
   - Trend QUALITY not just direction
   - Market decisiveness sensing
   - Sizing recommendations (FULL/REDUCED/MINIMAL/SKIP)
   - Path clarity for targets

4. **Tested Iter5**
   - Recent data: 86.2% WR, +20.82R (29 trades)
   - Old data: 70.0% WR, +21.80R (30 trades)
   - Combined: 78.0% WR, +42.62R (59 trades)

5. **Identified Issues**
   - Long bias: 67-69% of trades are longs
   - Risk-win correlation not working (losses have same/higher risk)
   - Most trades capped at 0.4-0.55 risk (no high confidence trades)

---

## Tasks for Tomorrow (Feb 22, 2026)

- [ ] Fix risk taking of GPT5 Iter5 bot - improve risk-win correlation
- [ ] Test Iter5 further on additional data
- [ ] Print Iter5 prompts (create printable HTML like we did before)

---

## Feb 23, 2026

### What We Did

1. **Major Repository Reorganization**
   - Created clean folder structure: `src/`, `data/`, `models/`, `results/`, `tools/`, `docs/`, `archive/`
   - Moved all source code to `src/`
   - Moved agents to `src/agents/`
   - Renamed data files: `eurusd_5m.json` -> `eurusd_5m_recent.json`
   - Archived old iterations and test results

2. **Model Naming Convention**
   - Format: `{base_model}_{iteration}_{YYYYMMDD}`
   - Examples: `gpt4_baseline_20260221`, `gpt5_iter5_20260221`
   - Each model has `metadata.json` with test results

3. **Created Documentation**
   - `README.md` - Main usage guide
   - `docs/CONVENTIONS.md` - Naming conventions & standards
   - Updated all model README files

4. **Updated All Code Paths**
   - Fixed imports in `batch_trainer.js`, `iteration_loop.js`, `live_trader.js`
   - Updated tools to use new folder structure
   - All paths now use `path.join(__dirname, ...)` for reliability

5. **Tagged v1.0**
   - Current best model: GPT-5 Iter5 (78% WR, +42.62R)

---

## Tasks for Tomorrow (Feb 24, 2026)

- [ ] Fix risk taking of GPT5 Iter5 bot - improve risk-win correlation
- [ ] Test Iter5 further on additional data
- [ ] Print Iter5 prompts (create printable HTML)

---

# How to Train & Improve Models

## The Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. START: Current model in src/agents/                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. TEST: Run batch_trainer.js on both datasets                 │
│     node src/batch_trainer.js                                   │
│     → Results saved to results/trade_results.json               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. ANALYZE: Look at wins vs losses                             │
│     node tools/analyze_trades.js                                │
│     → What patterns cause losses?                               │
│     → Is risk calibration working?                              │
│     → Any direction bias?                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. IMPROVE: Edit agent prompts in src/agents/                  │
│     - direction_agent.js  → Market reading                      │
│     - confidence_agent.js → Risk/probability                    │
│     - levels_agent.js     → Entry/SL/TP placement               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. RE-TEST: Run batch_trainer again                            │
│     → Compare metrics to previous run                           │
│     → Did WR improve? Did risk calibration improve?             │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    ┌───────────────┐                   ┌───────────────┐
    │  WORSE/SAME   │                   │   BETTER      │
    │  → Revert     │                   │   → Save!     │
    │  → Try again  │                   │               │
    └───────────────┘                   └───────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. SAVE MODEL: Create versioned checkpoint                     │
│     mkdir models/gpt5_iter6_$(date +%Y%m%d)                     │
│     cp src/agents/*.js models/gpt5_iter6_YYYYMMDD/              │
│     → Create metadata.json with test results                    │
│     → Update DIARY.md with what changed                         │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Commands

```bash
# Test current model
node src/batch_trainer.js

# Analyze results
node tools/analyze_trades.js

# Compare multiple models
node tools/run_all_tests.js

# Auto-improve (uses Claude to suggest prompt changes)
ITERATION_BUDGET_EUR=5 node src/iteration_loop.js

# Live paper trading
node src/live_trader.js
```

## Saving a New Model Version

When you have an improvement worth keeping:

```bash
# 1. Create model folder with date
mkdir models/gpt5_iter6_20260224

# 2. Copy current agents
cp src/agents/*.js models/gpt5_iter6_20260224/

# 3. Create metadata.json (copy template from existing model)
cp models/gpt5_iter5_20260221/metadata.json models/gpt5_iter6_20260224/
# Then edit with new test results

# 4. Update DIARY.md with what changed and why
```

## Traceability

Every model folder contains:
- **metadata.json** - Test results on both datasets, key features, known limitations
- **Agent files** - The exact prompts that produced those results
- **README.md** (optional) - Detailed notes on what changed

This means you can always:
1. Go back to any previous version
2. See exactly what was changed between versions
3. Compare performance across versions
4. Understand WHY changes were made (via DIARY.md)

## Key Metrics to Track

| Metric | Target | Why |
|--------|--------|-----|
| Win Rate | >65% | Profitability |
| Total R | Positive | Actual profit |
| Risk Differentiation | >0.15 | High conf trades should win more |
| Long/Short Balance | ~50/50 | Avoid directional bias |
| Skips | <30% | Don't over-filter |

## Auto-Improvement Loop

For hands-off improvement:

```bash
ITERATION_BUDGET_EUR=10 node src/iteration_loop.js
```

This will:
1. Run batch tests
2. Analyze failures with Claude
3. Suggest prompt improvements
4. Apply changes and re-test
5. Save iteration history to `results/iteration_history.json`

Stop when: WR >70% AND PF >3.0 AND Risk Diff >0.15
