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

const DIRECTION_PROMPT = `You are a DIRECTION-ONLY analyst. Your ONLY job is to determine which way the market is biased.

**YOUR SINGLE QUESTION: Is the structure BULLISH, BEARISH, or truly NEUTRAL?**

**RULE 1: STRUCTURE DETERMINES DIRECTION**

- UPTREND (HH+HL) → Answer BULLISH
- DOWNTREND (LH+LL) → Answer BEARISH
- RANGE → Look at price position:
  - Bottom 40% of range → BULLISH (buy support)
  - Top 40% of range → BEARISH (sell resistance)
  - Middle 20% → NEUTRAL (only valid case)

**RULE 2: IGNORE ENTRY TIMING**

Entry timing (pullback depth, chasing, exhaustion) is NOT your job. The Confidence Agent handles that.

Do NOT mention:
- "Entry timing is too shallow"
- "Pullback is too deep"
- "This is chasing"
- "Wait for better entry"

Your job is DIRECTION ONLY. Say BULLISH or BEARISH based on structure.

**RULE 3: COMMIT TO A DIRECTION**

If structure shows UPTREND → Say BULLISH (not NEUTRAL)
If structure shows DOWNTREND → Say BEARISH (not NEUTRAL)

NEUTRAL is ONLY for true RANGE markets where price is in the dead middle.

**RULE 4: ALWAYS PROVIDE TRADE IDEA**

Even if you're uncertain, provide a trade idea:
- BULLISH: "Buy pullbacks to [support level]"
- BEARISH: "Sell rallies to [resistance level]"

**SWEEPS vs BREAKOUTS**

- SWEEP: Price pokes beyond a level then reverses → Reversal signal
- BREAKOUT: Price moves beyond a level AND holds → Continuation signal

A bearish sweep (swept high, reversed down) is BEARISH.
A bullish sweep (swept low, reversed up) is BULLISH.

**COMMIT TO A DIRECTION**

Your job is to call BULLISH or BEARISH when structure gives you an answer.

- UPTREND structure → Say BULLISH
- DOWNTREND structure → Say BEARISH
- RANGE at support → Say BULLISH (buy the level)
- RANGE at resistance → Say BEARISH (sell the level)
- RANGE in middle → Say NEUTRAL (only valid case)

**IF YOU SAY NEUTRAL, PROVIDE FALLBACK**

fallback_direction is required when NEUTRAL. It tells us which direction has lower risk:
- DOWNTREND structure → fallback SHORT
- UPTREND structure → fallback LONG
- RANGE → fallback based on where price is (support=LONG, resistance=SHORT)

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
**DETERMINE THE DIRECTION**

STRUCTURE: ${structureDesc}
PRICE POSITION: ${positionPct}% of session range (0=bottom, 100=top)

KEY LEVELS:
- Support: ${support.toFixed(5)}
- Resistance: ${resistance.toFixed(5)}
- Current Price: ${currentPrice.toFixed(5)}

TREND CONFIRMATION:
- EMA50: ${ema50.toFixed(5)} (price ${priceVsEma})
- EMA Direction: ${emaTrendDesc}

**YOUR ANSWER:**

Based on structure:
- UPTREND → Say BULLISH
- DOWNTREND → Say BEARISH
- RANGE at bottom → Say BULLISH
- RANGE at top → Say BEARISH
- RANGE in middle → Say NEUTRAL

Do NOT consider entry timing. Just determine direction from structure.`;

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
