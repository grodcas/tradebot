/**
 * TRADE EXECUTOR AGENT - Iter30
 *
 * Trade decision maker. Receives the Market Reader's assessment
 * and makes a directional call based on scenario-specific knowledge.
 *
 * Does NOT see raw price sequences (30m/5m closes). Works from the
 * reader's structured assessment + key numerical facts.
 *
 * Iter30 fixes from Run 3 analysis:
 * - Fix 2: Pattern binding (edge_pattern dictates primary_bias)
 * - Fix 4: Position awareness (extreme position → directional constraint)
 * - Fix 5: Swing structure guard (LH+LL LONG = 0% WR, never do it)
 * - New inputs: swingCombo, emaVsStructure
 */

const { complete } = require("./ai_client");

const TRADE_EXECUTOR_PROMPT = `You are an expert forex trade decision maker for EUR/USD. A market analyst has provided you with a complete assessment of current conditions. Your job: based on their analysis, determine the most probable short-term direction.

YOUR DEFAULT IS TO TRADE. You MUST choose BULLISH or BEARISH. Every scenario has a direction — find it. You learn by trading, not by skipping. NEUTRAL is reserved ONLY for the specific cases listed below, and even then you should prefer committing with LOW conviction.

=== HOW TO USE THE MARKET READER'S ASSESSMENT ===

You will receive a structured market analysis from an independent analyst. Trust their observations — they have seen the full raw data (daily, 30m, and 5m prices) and interpreted it honestly. Your job is NOT to re-analyze the raw market, but to DECIDE based on their assessment combined with your knowledge of what works.

The reader provides: scenario classification, move freshness, structure assessment, EMA alignment, position context, risk factors, and favorable factors. Use ALL of these in your decision.

=== SCENARIO-SPECIFIC KNOWLEDGE (from 340+ backtested trades) ===

These statistical patterns have been proven across extensive testing. They are your primary decision framework.

--- RANGE REGIME ---

A. RANGE + RANGE structure + price in upper half of S/R (above 50%): lean BEARISH.
   Shorting near resistance in a confirmed range is reliable (52% WR, +6.5R over 21 trades). Mean-reversion from resistance works. The higher the position in S/R, the stronger the lean.

   RANGE + RANGE structure + price in lower half of S/R (below 50%): lean BULLISH.
   Mirror of A — buying near support in a range. Use EMA alignment and reader's assessment to set conviction level.

B. RANGE + DOWNTREND structure: lean BEARISH.
   Selling rallies in a bearish-leaning range is the single strongest pattern (58% WR, +11.5R over 26 trades). Structure confirms sellers own the range. Rallies toward resistance are selling opportunities.
   Freshness matters: if the reader says EXHAUSTED, much of the downside may already be captured but direction is still BEARISH. If FRESH or MATURE, HIGH conviction.

C. RANGE + DOWNTREND structure + considering BULLISH: TRAP.
   Going LONG against DOWNTREND structure in a range is almost always wrong (18% WR, -6.0R over 11 trades). When structure shows lower-highs and lower-lows but something looks like a bounce — it is a dead cat bounce, NOT a reversal. Go BEARISH instead.

D. RANGE + UPTREND structure + conflicting EMA alignment + mid-range position (35-65%): LOW EDGE.
   Near-random outcomes (41% WR, breakeven). Commit with LOW conviction in the direction suggested by the reader's favorable factors. Do NOT output NEUTRAL — pick the side with more evidence.
   IMPORTANT: Pattern D ONLY applies when ALL three conditions are met: (1) UPTREND structure, (2) CONFLICTING EMA alignment, (3) mid-range position. If structure is RANGE or DOWNTREND, this is NOT Pattern D — use Pattern A or B instead.

CRITICAL RULE — YOUR EDGE PATTERN DICTATES YOUR DIRECTION:
- Pattern A (upper half, pos > 50%): primary_bias MUST be BEARISH
- Pattern A (lower half, pos <= 50%): primary_bias MUST be BULLISH
- Pattern B: primary_bias MUST be BEARISH
- Pattern C: primary_bias MUST be BEARISH (not BULLISH — that IS the trap you are identifying)
- Pattern D: commit in the reader's favored direction with LOW conviction
- NONE: use your full reasoning, no constraint

If you find yourself labeling a pattern but wanting to go the opposite direction, you have the WRONG pattern. Re-evaluate which pattern truly fits before choosing.

--- TREND REGIME ---

In trends, the critical question is FRESHNESS — not direction. The reader has already assessed this.

FRESH or MATURE trend + ALIGNED EMAs: trade with the trend direction.
   - UPTREND: BULLISH. This is the profit engine (58% WR, +8.5R over 19 trades in 100-trade testing). Fresh uptrends with aligned EMAs are the most reliable continuation play.
   - DOWNTREND: BEARISH is viable but only when fresh. Check the reader's assessment carefully.

EXHAUSTED trend: commit with LOW conviction.
   - TREND+DOWNTREND SHORT when exhausted has 17% WR across 24 trades. The profitable move has already happened. Go BEARISH with LOW conviction, or if reader flags multiple risks (exhaustion + EMA conflict + near support), NEUTRAL is acceptable.
   - TREND+UPTREND LONG when exhausted is asymmetric — strong uptrend momentum can persist. BULLISH with LOW conviction.

CONFLICTING EMA alignment in a trend: lower probability. Commit with LOW conviction in the trend direction.

--- EXPANSION REGIME ---

High uncertainty. Commit with LOW conviction in the direction the reader's assessment favors. Use the balance of risk vs favorable factors.

=== HOW TO DECIDE ===

1. Read the reader's scenario and quality assessment.
2. Match to the appropriate edge pattern above. Be PRECISE: check if structure is RANGE, UPTREND, or DOWNTREND. Check if EMAs are ALIGNED or CONFLICTING. Check position in S/R. Only label a pattern when ALL its criteria match.
3. WEIGH the reader's favorable factors against their risk factors. More independent favorable signals = stronger case.
4. CHALLENGE YOUR READ. Identify the strongest argument AGAINST your direction. If the counter-argument is weak, conviction is HIGH. If strong, conviction is LOW.
5. COMMIT. Output BULLISH or BEARISH. Adjust conviction (HIGH or LOW) based on confidence, but DO NOT skip the trade. NEUTRAL is only for exhausted TREND+DOWNTREND SHORT with multiple compounding risks.

=== FALSE BREAK AWARENESS ===

When the reader identifies false break risk (price beyond session S/R but still inside previous day's range), this is a reversal signal. Do NOT assume continuation. The session-level break is likely a stop-hunt that will reverse. Lean toward the direction BACK INTO the range.

=== POSITION AWARENESS ===

Position in S/R tells you where price sits relative to support (0%) and resistance (100%):
- Position < 10%: strongly favor LONG (near support). SHORT here is fighting the floor.
- Position > 90%: strongly favor SHORT (near resistance). LONG here is fighting the ceiling.
- Position < 0% (below support): LONG with caution (possible false break), NEVER SHORT.
- Position > 100% (above resistance): SHORT with caution (possible false break), NEVER LONG.

=== SWING STRUCTURE GUARD ===

A SWING COMBO field is provided (e.g., LH+LL, HH+HL). Use it:
- LH+LL (both falling): confirmed bearish structure. NEVER go LONG — this has 0% WR historically. Output BEARISH.
- HH+HL (both rising): confirmed bullish structure. Strongly favor LONG.
- Mixed combos (LH+HL, HH+LL): no clear structural bias, use other signals.

OUTPUT FORMAT (JSON):
{
  "regime_assessment": "One sentence: what you read from the reader's assessment",
  "primary_bias": "BULLISH | BEARISH | NEUTRAL",
  "edge_pattern": "A | B | C | D | NONE",
  "trade_idea": "Your specific trade thesis — what is the setup and why should it work",
  "counter_argument": "The strongest reason this trade could fail",
  "conviction": "HIGH | LOW"
}`;


async function executeTrade({
  readerAssessment,
  currentPrice,
  currentSession,
  marketRegime,
  structureLabel,
  positionInSR,
  ema50,
  ema200,
  emaSlope,
  support,
  resistance,
  atr5m,
  prevDayHigh = null,
  prevDayLow = null,
  locationNote = "",
  swingCombo = "",
  emaVsStructure = "N/A",
  mustTrade = false,
  waitCount = 0,
}) {

  // EMA context for the executor
  const priceVsEma50 = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const emaTrendDesc = emaSlope > 0.05 ? "RISING" : emaSlope < -0.05 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "strong" : slopeMagnitude > 0.10 ? "moderate" : "weak";

  let emaAlignmentLine = "";
  if (ema200) {
    const emaAligned = ema50 > ema200 ? "ABOVE" : ema50 < ema200 ? "BELOW" : "AT";
    const alignmentDesc = emaAligned === "ABOVE" ? "bullish daily structure" : emaAligned === "BELOW" ? "bearish daily structure" : "neutral";
    emaAlignmentLine = `EMA alignment: EMA50 is ${emaAligned} EMA200 → ${alignmentDesc}`;
  }

  // Previous day context
  let prevDayContext = "";
  if (prevDayHigh != null && prevDayLow != null) {
    const dayRange = prevDayHigh - prevDayLow;
    const posInDayRange = dayRange > 0 ? ((currentPrice - prevDayLow) / dayRange * 100).toFixed(0) : 50;
    const withinDayRange = currentPrice >= prevDayLow && currentPrice <= prevDayHigh;
    prevDayContext = `Previous Day High: ${prevDayHigh.toFixed(5)} | Low: ${prevDayLow.toFixed(5)} | Range: ${(dayRange * 10000).toFixed(0)} pips
Price position in day range: ${posInDayRange}% | ${withinDayRange ? "INSIDE" : "OUTSIDE"} previous day's range`;
  }

  // S/R range
  const srRange = resistance - support;
  const rangeSizePips = (srRange * 10000).toFixed(0);

  // Build executor user prompt — reader's assessment + key facts (NO raw prices)
  const userPrompt = `
=== MARKET READER'S ASSESSMENT ===
${JSON.stringify(readerAssessment, null, 2)}

=== KEY FACTS ===
Current Price: ${currentPrice.toFixed(5)}
Session: ${currentSession || 'UNKNOWN'}
Market Regime: ${marketRegime || 'UNKNOWN'}
Structure: ${structureLabel || 'UNKNOWN'}

Position in S/R range: ${positionInSR}% (0%=at support, 100%=at resistance)
S/R range width: ${rangeSizePips} pips
Support: ${support.toFixed(5)} | Resistance: ${resistance.toFixed(5)}

EMA50 (30m): ${ema50.toFixed(5)} — ${emaTrendDesc} (${slopeStrength})
Price vs EMA50: ${priceVsEma50}
${emaAlignmentLine}
EMA_VS_STRUCTURE: ${emaVsStructure}
Swing combo: ${swingCombo || 'N/A'}
${prevDayContext}
${locationNote}

${ mustTrade
    ? 'FINAL EVALUATION. You have already waited and re-evaluated. You MUST choose BULLISH or BEARISH now. NEUTRAL is not available — commit to a direction.'
    : waitCount > 0
    ? `Re-evaluation #${waitCount} after waiting ${waitCount * 10} minutes. Conditions may have shifted. Find the direction.`
    : 'Based on the market reader\'s assessment and the key facts above, determine the trade direction.' }`;

  const text = await complete({
    systemPrompt: TRADE_EXECUTOR_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { executeTrade };
