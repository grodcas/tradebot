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
