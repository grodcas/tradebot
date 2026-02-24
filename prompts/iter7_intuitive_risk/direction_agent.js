/**
 * DIRECTION AGENT
 *
 * Expert in reading market structure and determining directional bias.
 * Output is VERBOSE - explains the reasoning, not just LONG/SHORT.
 */

const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const DIRECTION_PROMPT = `You are an expert market structure analyst. Your job is to determine if there is a TRADEABLE OPPORTUNITY right now, not just describe the market.

**YOUR PRIMARY QUESTION: Is this a good time to trade, or should we wait?**

Most of the time, the answer is WAIT. Good setups are rare. Your job is to find them and reject everything else.

**WHAT MAKES A SETUP TRADEABLE**

A tradeable setup requires ALL of the following:

1. **CLEAR STRUCTURE** - One side must be winning
   - UPTREND: Higher highs AND higher lows. Buyers are clearly in control.
   - DOWNTREND: Lower highs AND lower lows. Sellers are clearly in control.
   - RANGE: Mixed swings or clustering = NO TREND. This is NOT tradeable with trend-following. Only extremes of range are tradeable.

2. **PROPER ENTRY TIMING** - Price must have pulled back
   - Ideal: Price has retraced to a meaningful level (roughly 38-62% of the prior move) and shown signs of holding.
   - Poor: Price barely pulled back (chasing) or has retraced too deeply (exhaustion).
   - A shallow pullback means you're chasing - wait for price to come to you.
   - A deep pullback (>70%) often signals the trend is losing momentum.

3. **NO CONFLICTING SIGNALS**
   - Structure and momentum should agree
   - EMA should confirm the trend
   - No recent sweep that suggests reversal

**WHEN TO SAY NEUTRAL (NO TRADE)**

Say NEUTRAL when ANY of these are true:
- Structure is RANGE (mixed swing points)
- Pullback is too shallow (<30%) - you'd be chasing
- Pullback is too deep (>70%) - trend may be exhausting
- EMA is flat or price is whipping around it
- Recent price action conflicts with the supposed trend

NEUTRAL means: "There is no edge here. Do not trade."

**SWEEPS vs BREAKOUTS - CRITICAL DISTINCTION**

- BREAKOUT: Price moves beyond a level AND holds there. This is continuation.
- SWEEP: Price briefly pokes beyond a level then reverses. This is a TRAP.

If price just swept a high and reversed down, that's BEARISH even if it looked bullish for a moment.
If price just swept a low and reversed up, that's BULLISH even if it looked bearish for a moment.

Sweeps are reversal signals. Breakouts are continuation signals. Don't confuse them.

**EXHAUSTION SIGNALS**

The trend is exhausting when:
- Pullbacks are getting deeper each time
- Price can barely make new highs/lows
- The move is overextended without pullbacks
- Volume/momentum is fading

When you see exhaustion, even if structure still shows trend, reduce confidence significantly.

**CRITICAL: WHEN YOU SAY NEUTRAL, ALSO INDICATE THE LOWER-RISK DIRECTION**

Even when the setup isn't tradeable, one direction is usually LESS RISKY than the other:

- In a DOWNTREND structure: SHORT is less risky (you'd be with the structure)
- In an UPTREND structure: LONG is less risky (you'd be with the structure)
- In a RANGE: Look at WHERE price is:
  - Near the BOTTOM of the range → LONG is less risky (buying support)
  - Near the TOP of the range → SHORT is less risky (selling resistance)
  - In the MIDDLE → either direction is equally risky

This "fallback_direction" helps if a trade must be taken despite your NEUTRAL call.

OUTPUT FORMAT (JSON):
{
  "structure_state": "UPTREND" | "DOWNTREND" | "RANGE",
  "structure_evidence": "What do the swing points show? Is control clear or contested?",
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "fallback_direction": "LONG" | "SHORT" - Required when NEUTRAL. Which direction has LESS risk given structure?",
  "fallback_reason": "Why this direction is less risky despite no clear edge",
  "is_tradeable": true | false,
  "why_or_why_not": "Explain why this setup is or isn't tradeable right now",
  "entry_timing_quality": "GOOD | POOR | CHASING | EXHAUSTED",
  "ema_analysis": "Does EMA confirm the bias or suggest caution?",
  "key_levels": {
    "support": number,
    "resistance": number,
    "nearest_swing_high": number,
    "nearest_swing_low": number
  },
  "trade_idea": "Specific trade if tradeable, or 'NO TRADE - [reason]' if not",
  "invalidation": "What would change this view",
  "confidence": "HIGH | MEDIUM | LOW"
}`;

async function analyzeDirection({
  prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice,
  computedStructureState = 0, computedStructureLabel = 'UNKNOWN', marketRegime = 'UNKNOWN', pullbackRatio = 0,
  breakoutScore = 0, sweepScore = 0
}) {

  // Calculate price position
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Determine EMA relationship
  const priceVsEma = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const emaTrendDesc = emaSlope > 0.00001 ? "RISING" : emaSlope < -0.00001 ? "FALLING" : "FLAT";

  // Structure state description
  const structureDesc = computedStructureState === 1 ? "UPTREND (HH+HL)" :
                       computedStructureState === -1 ? "DOWNTREND (LH+LL)" :
                       "RANGE (mixed swings)";

  // Pullback quality - be very explicit about problems
  let pullbackLabel, pullbackWarning;
  if (pullbackRatio === null || pullbackRatio === undefined) {
    pullbackLabel = "NO PULLBACK DATA";
    pullbackWarning = "Cannot assess entry timing - be cautious";
  } else if (pullbackRatio < 0.25) {
    pullbackLabel = "VERY SHALLOW (<25%)";
    pullbackWarning = "CHASING - price has barely retraced. High risk of entering before a pullback.";
  } else if (pullbackRatio < 0.35) {
    pullbackLabel = "SHALLOW (25-35%)";
    pullbackWarning = "Likely chasing - consider waiting for deeper retracement";
  } else if (pullbackRatio > 0.75) {
    pullbackLabel = "VERY DEEP (>75%)";
    pullbackWarning = "EXHAUSTION SIGNAL - trend may be reversing. High risk.";
  } else if (pullbackRatio > 0.65) {
    pullbackLabel = "DEEP (65-75%)";
    pullbackWarning = "Caution - trend may be losing momentum";
  } else {
    pullbackLabel = "IDEAL (35-65%)";
    pullbackWarning = "Good entry timing - price has tested a level";
  }

  // Sweep/breakout context
  let sweepBreakoutContext = "";
  if (sweepScore > 0.3) {
    sweepBreakoutContext = "BULLISH SWEEP detected - price swept a low and reversed up. This is a bullish reversal signal.";
  } else if (sweepScore < -0.3) {
    sweepBreakoutContext = "BEARISH SWEEP detected - price swept a high and reversed down. This is a bearish reversal signal.";
  } else if (breakoutScore > 0.3) {
    sweepBreakoutContext = "BULLISH BREAKOUT - price has expanded above recent highs with acceptance.";
  } else if (breakoutScore < -0.3) {
    sweepBreakoutContext = "BEARISH BREAKOUT - price has expanded below recent lows with acceptance.";
  } else {
    sweepBreakoutContext = "No significant sweep or breakout detected.";
  }

  const userPrompt = `
**THE KEY QUESTION: Is this a tradeable setup, or should we wait?**

STRUCTURE CONTEXT:
- Structure: ${structureDesc}
- Market Regime: ${marketRegime}
${computedStructureState === 0 ? "⚠️ RANGE means no clear trend - trend-following will likely fail here." : ""}

ENTRY TIMING:
- Pullback: ${pullbackLabel}
- Assessment: ${pullbackWarning}

SWEEP/BREAKOUT STATUS:
${sweepBreakoutContext}

RECENT PRICE ACTION (last 15 five-minute closes):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

CURRENT PRICE: ${currentPrice.toFixed(5)}
PRICE LOCATION: ${positionPct}% of session range

EMA CONTEXT:
- EMA50: ${ema50.toFixed(5)} (price ${priceVsEma})
- EMA Direction: ${emaTrendDesc}
${emaTrendDesc === "FLAT" ? "⚠️ Flat EMA suggests ranging conditions" : ""}

KEY LEVELS:
- Support: ${support.toFixed(5)}
- Resistance: ${resistance.toFixed(5)}
- Swing High: ${swingHigh.toFixed(5)}
- Swing Low: ${swingLow.toFixed(5)}

**YOUR TASK:**
1. Is structure CLEAR (one side winning) or UNCLEAR (range/contested)?
2. Is entry timing GOOD (proper pullback) or BAD (chasing/exhausted)?
3. Are there CONFLICTING signals?

If ANY of these fail, this is NOT TRADEABLE. Say NEUTRAL and explain why.
Only say BULLISH or BEARISH if you have a clear, well-timed setup.

**IMPORTANT: If NEUTRAL, you MUST also provide fallback_direction:**
- DOWNTREND structure → fallback SHORT (with the structure)
- UPTREND structure → fallback LONG (with the structure)
- RANGE at bottom → fallback LONG (buying support)
- RANGE at top → fallback SHORT (selling resistance)
- RANGE in middle → use the direction that aligns with recent momentum or EMA slope`;

  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: DIRECTION_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty direction response");

  return JSON.parse(text);
}

module.exports = { analyzeDirection };
