# Iteration Guidelines - Prompt Engineering Philosophy

## Core Principle: Structure Over Numbers

The AI agents must understand market **structure and context**, not execute mechanical rules. Markets are probabilistic, not deterministic. The AI should reason about the situation, weigh evidence, and make nuanced decisions.

---

## What Does NOT Work

### Mechanical Threshold Rules
```
BAD: "If pullback ratio is between 0.38-0.62, enter the trade"
BAD: "If breakout score > 0.3, go long"
BAD: "If ATR > 0.0005, use wider stops"
```

These fail because:
- Markets don't respect arbitrary numbers
- Context matters more than thresholds
- Same number means different things in different conditions
- Creates brittle, overfitted behavior

### Deterministic Decision Trees
```
BAD: "Check condition A → if true, check B → if true, execute C"
```

This creates an "Excel formula" that:
- Ignores nuance and partial signals
- Can't handle conflicting information
- Doesn't adapt to market context
- Produces inconsistent results when conditions are borderline

---

## What DOES Work

### Probabilistic Soft Language
```
GOOD: "A shallow pullback suggests the market hasn't fully retested support,
       which tends to result in further retracement before continuation.
       This increases the risk of a premature entry."

GOOD: "When price has retraced deeply into the prior impulse, the trend's
       momentum may be exhausting. Consider whether the structure still
       supports continuation or if a reversal is forming."
```

### Contextual Reasoning
```
GOOD: "In a trending market, pullbacks to key levels offer high-probability
       entries because the underlying structure supports continuation. However,
       in a range, the same pullback might simply be noise within consolidation."
```

### Weighing Evidence
```
GOOD: "Consider all factors together: Is the structure clear? Does the entry
       timing align with a logical level? Is momentum supporting the direction?
       Strong setups have multiple confirming factors, not just one signal."
```

---

## Indicator Understanding (What They MEAN, Not What Numbers To Use)

### Structure State
- **UPTREND**: Price is making higher highs AND higher lows. This reveals buying pressure is dominant. Pullbacks are opportunities to join the trend, not reversals.
- **DOWNTREND**: Price is making lower highs AND lower lows. Selling pressure dominates. Rallies tend to fail and offer short opportunities.
- **RANGE**: Swing points are mixed - no clear direction. The market is balanced between buyers and sellers. Extremes tend to reverse, middle is noise.

**Key insight**: Structure tells you WHO is in control. Trade with the dominant side.

### Pullback Ratio
- **Shallow pullback**: Price barely retraced before continuing. This often means the move is overextended and likely to pull back more. Entering here is "chasing."
- **Ideal pullback**: Price has retraced enough to show the market tested a level and found support/resistance. This confirms the level is meaningful.
- **Deep pullback**: Price has retraced most of the prior move. This suggests the trend may be losing steam. The structure could be transitioning.

**Key insight**: Pullback depth tells you about entry TIMING and trend HEALTH.

### Breakout Score
- **Positive (bullish)**: Price has expanded above a prior resistance level with conviction. The market is accepting higher prices.
- **Negative (bearish)**: Price has expanded below a prior support level. The market is accepting lower prices.
- **Near zero**: No significant expansion. Price is contained within prior ranges.

**Key insight**: Breakouts show ACCEPTANCE of new price levels. But false breakouts are common - look for follow-through.

### Sweep Score
- **Bullish sweep**: Price dipped below a low (stopping out longs) then reversed up. This is often smart money accumulating - bullish signal.
- **Bearish sweep**: Price spiked above a high (stopping out shorts) then reversed down. Smart money distributing - bearish signal.

**Key insight**: Sweeps are the OPPOSITE of breakouts. They're reversal signals, not continuation signals. Mistaking one for the other is a common failure.

### Market Regime
- **TREND**: Clear structure + momentum alignment. High probability for trend-following trades.
- **EXPANSION**: High volatility, potentially transitioning. Momentum is strong but direction may be establishing.
- **RANGE**: No clear direction. Mean reversion at extremes works, but trend trades fail.

**Key insight**: Regime tells you WHICH strategy to apply. Trend-following in ranges fails. Range fading in trends fails.

### Acceptance Time
- **High acceptance**: Price has spent significant time beyond a key level. The market has "accepted" this as the new normal.
- **Low/no acceptance**: Price briefly touched beyond a level but hasn't stayed there. Could be a fake breakout or sweep.

**Key insight**: Acceptance confirms whether a breakout is real or a trap.

---

## How Agents Should Reason

### Instead of Rules, Use Narratives

The agent should build a "market story":

1. **What is the structure telling me?** Who is in control - buyers, sellers, or neither?

2. **Where is price relative to key levels?** Is it at support/resistance where a reaction is likely, or in no-man's land?

3. **What is the quality of the current setup?** Has price pulled back to a logical level, or is it overextended?

4. **Do multiple factors align?** A good trade has structure, timing, and momentum all pointing the same direction.

5. **What could invalidate this idea?** Every trade idea has conditions that would make it wrong.

### Weigh Conflicting Signals

Markets often give mixed signals. The AI should:

- Identify what the STRONGEST signal is (usually structure)
- Acknowledge conflicting information
- Reduce confidence when signals conflict
- Require more confirmation when uncertain

### Adapt to Context

The same indicator value means different things in different contexts:

- A "shallow pullback" in a strong trend might still work because momentum is overwhelming
- A "perfect pullback" in a range means nothing because there's no trend to continue
- High breakout score after a sweep might be a trap

---

## Prompt Writing Guidelines

1. **Explain the WHY**: Don't just say what to do, explain why it works
2. **Use probabilistic language**: "tends to", "suggests", "increases likelihood", "often indicates"
3. **Emphasize context**: "In a trending market...", "When structure is unclear..."
4. **Allow for nuance**: "Consider whether...", "Weigh the evidence that..."
5. **Avoid numbers in rules**: Instead of thresholds, describe the concept
6. **Teach the market dynamics**: Help the AI understand cause and effect

---

## Iteration Process

1. **Read feedback from losing trades**: What patterns caused failures?
2. **Identify conceptual gaps**: Did the AI misunderstand something about market structure?
3. **Improve explanations**: Add clarity to the concepts that were misapplied
4. **Test and observe**: Run backtest, read the reasoning, see if understanding improved
5. **Iterate on understanding, not on rules**: The goal is better comprehension, not more conditions

---

## Success Criteria

A well-tuned agent should:

- Correctly identify market structure and regime
- Avoid trading trend strategies in ranging markets
- Recognize when entry timing is poor (chasing or exhaustion)
- Distinguish between breakouts and sweeps
- Show appropriate confidence calibration (uncertain when signals conflict)
- Produce reasoning that sounds like an experienced trader's thought process
