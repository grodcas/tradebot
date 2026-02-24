# Model Training Workflow

This document explains the complete process for improving trading models.

## Overview

The improvement process is **human-supervised**. You run tests, analyze results with Claude, decide on changes together, and save progress manually.

```
YOU                          CLAUDE                         SYSTEM
 │                              │                              │
 ├─── Run test ─────────────────┼──────────────────────────────►
 │                              │                              │
 ◄──────────────────────────────┼─────────── Results ──────────┤
 │                              │                              │
 ├─── "What's wrong?" ─────────►│                              │
 │                              │                              │
 ◄─── Analysis & suggestions ───┤                              │
 │                              │                              │
 ├─── "Let's try X" ───────────►│                              │
 │                              │                              │
 │◄── Implements changes ───────┤                              │
 │                              │                              │
 ├─── Run test again ───────────┼──────────────────────────────►
 │                              │                              │
 ◄──────────────────────────────┼─────────── Results ──────────┤
 │                              │                              │
 ├─── "Save this version" ─────►│                              │
 │                              │                              │
 │◄── Creates model folder ─────┤                              │
```

---

## Files & Their Purposes

### Core Files (in `src/`)

| File | What It Does | Run Manually? |
|------|--------------|---------------|
| `src/batch_trainer.js` | Runs 30 simulated trades on historical data | Yes |
| `src/live_trader.js` | Paper trades with IBKR in real-time | Yes |
| `src/iteration_loop.js` | Auto-improvement (Claude suggests changes) | Optional |
| `src/strategy_selector.js` | Validates trade decisions, clamps risk | No (library) |
| `src/trade_indicators.js` | Calculates EMA, ATR, S/R, swings | No (library) |

### Agent Files (in `src/agents/`)

These are the "model" - the prompts that determine trading decisions:

| File | What It Decides |
|------|-----------------|
| `direction_agent.js` | LONG / SHORT / NEUTRAL direction |
| `confidence_agent.js` | Probability (0-1) and sizing (FULL/REDUCED/MINIMAL/SKIP) |
| `levels_agent.js` | Entry price, Stop Loss, Take Profit |
| `orchestrator.js` | Coordinates the 3 agents, handles skips |
| `ai_client.js` | API wrapper (GPT-4 or GPT-5) |

### Tool Files (in `tools/`)

| File | What It Does |
|------|--------------|
| `analyze_trades.js` | Analyzes trade_results.json, shows patterns |
| `run_all_tests.js` | Runs tests on multiple models for comparison |
| `compare_models.js` | Compares two specific models |

---

## Folder Structure

```
TRADEBOT/
├── src/agents/          ← CURRENT MODEL (edit these to improve)
├── data/                ← Historical price data
│   ├── eurusd_5m_recent.json   (Nov 2025 - Feb 2026)
│   └── eurusd_5m_old.json      (Aug 2025 - Nov 2025)
├── models/              ← SAVED VERSIONS (checkpoints)
│   ├── gpt5_iter5_20260221/
│   │   ├── metadata.json       (test results)
│   │   └── *.js                (agent files)
│   └── ...
├── results/             ← TEST OUTPUTS
│   ├── trade_results.json      (latest batch test)
│   └── iteration_history.json  (auto-loop history)
└── docs/                ← DOCUMENTATION
```

---

## Step-by-Step Process

### Step 1: Run a Test

```bash
node src/batch_trainer.js
```

**What happens:**
- Picks 30 random moments from historical data
- Calls the 3 agents to make trade decisions
- Simulates each trade forward in time
- Saves detailed results

**Output:** `results/trade_results.json`

**Time:** ~3-5 minutes (depends on API speed)

---

### Step 2: Analyze Results (WITH CLAUDE)

Ask Claude:
> "Analyze the latest test results. What's causing losses?"

Or run the analysis script:
```bash
node tools/analyze_trades.js
```

**What to look for:**
- Win rate by direction (LONG vs SHORT)
- Risk distribution (are high-risk trades winning more?)
- Loss patterns (quick losses = bad direction, slow losses = bad levels)
- Skip rate (too many skips = over-filtering)

**This is manual** - you discuss with Claude what the issues are.

---

### Step 3: Decide on Changes (WITH CLAUDE)

Based on analysis, discuss improvements:

> "The confidence agent is giving similar risk to wins and losses. How can we fix this?"

Claude will:
1. Explain the issue
2. Suggest prompt changes
3. Show you the specific edits

**You decide** whether to apply the changes.

---

### Step 4: Apply Changes

Claude edits files in `src/agents/`:

```
src/agents/confidence_agent.js  ← Most common to change
src/agents/direction_agent.js   ← Change if direction is wrong
src/agents/levels_agent.js      ← Change if R:R is bad
```

**Changes are made to your working copy** - not saved as a version yet.

---

### Step 5: Re-Test

```bash
node src/batch_trainer.js
```

Compare new results to previous:
- Did win rate improve?
- Did risk differentiation improve?
- Any new problems introduced?

**If worse:** Ask Claude to revert or try different approach
**If better:** Continue to Step 6

---

### Step 6: Save as New Version (MANUAL)

When you have a meaningful improvement:

```bash
# Create folder with date
mkdir models/gpt5_iter6_20260224

# Copy current agents
cp src/agents/*.js models/gpt5_iter6_20260224/

# Copy and edit metadata.json
cp models/gpt5_iter5_20260221/metadata.json models/gpt5_iter6_20260224/
```

Then edit `metadata.json` with:
- New test results
- What changed (key_features)
- Known limitations

**Update DIARY.md** with what you changed and why.

---

## The Iteration Conversation

A typical improvement session looks like:

```
YOU: Run a batch test
CLAUDE: [runs test] Results: 58% WR, +15R, risk diff -0.02

YOU: What's wrong with the risk differentiation?
CLAUDE: The confidence agent is giving 0.45-0.55 risk to both wins
        and losses. It's not distinguishing high-quality setups.
        Looking at losses, 8/12 had "COHERENT" assessment but lost.
        The coherence check isn't strict enough.

YOU: How can we fix it?
CLAUDE: We could add a "trend quality" check - not just whether
        EMA is aligned, but HOW strongly. Weak slopes should
        reduce confidence even if technically aligned.

YOU: Let's try that
CLAUDE: [edits confidence_agent.js with new trend quality logic]

YOU: Test it
CLAUDE: [runs test] Results: 62% WR, +18R, risk diff +0.08
        Improvement! High-risk trades now winning 70% vs 55% before.

YOU: Good, save this as iter6
CLAUDE: [creates models/gpt5_iter6_20260224/ with metadata]
```

---

## Auto-Improvement Mode (Optional)

For hands-off iteration:

```bash
ITERATION_BUDGET_EUR=10 node src/iteration_loop.js
```

**What it does:**
1. Runs batch test
2. Analyzes failures with Claude API
3. Automatically edits agent prompts
4. Re-tests and repeats

**Output:** `results/iteration_history.json`

**Use when:** You want to let it run overnight or explore many variations.

**Caution:** Review changes afterward - auto mode can make weird decisions.

---

## Key Metrics

| Metric | Target | Meaning |
|--------|--------|---------|
| Win Rate | >65% | % of trades that hit TP |
| Total R | >+20R | Cumulative risk-adjusted profit |
| Risk Diff | >+0.15 | Avg risk on wins - avg risk on losses |
| High Risk WR | >70% | Win rate on trades with risk >0.6 |
| Skip Rate | <30% | % of scenarios skipped |

---

## Quick Reference

| Task | Command |
|------|---------|
| Run test | `node src/batch_trainer.js` |
| Analyze results | `node tools/analyze_trades.js` |
| Compare models | `node tools/run_all_tests.js` |
| Auto-improve | `ITERATION_BUDGET_EUR=10 node src/iteration_loop.js` |
| Live trade | `node src/live_trader.js` |

| Location | Contents |
|----------|----------|
| `src/agents/` | Current working model |
| `models/` | Saved versions |
| `results/` | Test outputs |
| `data/` | Historical prices |
| `DIARY.md` | Development log |
