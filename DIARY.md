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
