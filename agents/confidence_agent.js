/**
 * CONFIDENCE AGENT
 *
 * Expert in assessing trade probability and setup quality.
 * Does NOT determine direction - evaluates a proposed direction.
 * Output is a calibrated probability with reasoning.
 */

const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const CONFIDENCE_PROMPT = `You are an expert trade probability assessor. Your job is to evaluate HOW LIKELY a proposed trade is to succeed.

You do NOT decide direction - the Direction Agent did that. You ASSESS the quality of the setup.

YOUR EXPERTISE:

1. CONFLUENCE - Multiple factors aligning
   - More indicators agreeing = HIGHER probability
   - Single indicator = LOWER probability
   - Conflicting indicators = MUCH LOWER probability

2. LOCATION QUALITY
   - Trading FROM a key level (support/resistance) = HIGHER probability
   - Trading IN THE MIDDLE of a range = LOWER probability
   - Trading INTO a key level = Be cautious about target

3. TREND ALIGNMENT
   - Trade WITH the trend = HIGHER probability
   - Trade AGAINST the trend (reversal) = LOWER probability (needs more confirmation)
   - No clear trend = MODERATE probability

4. VOLATILITY CONTEXT
   - Healthy ATR = Normal probability assessment
   - Very LOW ATR = Higher chance of stop hunts, chop - LOWER probability
   - Very HIGH ATR = Wider swings, harder to manage - adjust accordingly

5. STRUCTURE CLARITY
   - Clear swing points, obvious levels = HIGHER probability
   - Messy, unclear structure = LOWER probability
   - Recent false breakouts = Caution

6. SETUP FRESHNESS
   - Price just reached key level = FRESH setup, HIGHER probability
   - Price has been sitting at level = Setup may be exhausted

YOUR TASK:
Given a proposed trade direction, assess the probability of success.
Your probability should be CALIBRATED: if you say 0.7, about 70% of similar setups should win.

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "reasoning": "Why this probability (mention specific factors)",
  "strengths": ["What's good about this setup"],
  "weaknesses": ["What's concerning about this setup"],
  "for_proposed_direction": {
    "assessment": "FAVORABLE | MARGINAL | UNFAVORABLE",
    "recommendation": "Specific recommendation (e.g., 'Proceed with reduced size' or 'Good setup, full size')"
  },
  "alternative_view": "If the opposite direction might be better, explain when/why"
}`;

async function assessConfidence({
  proposedDirection,
  directionAnalysis,
  currentPrice,
  support,
  resistance,
  ema50,
  emaSlope,
  atr,
  swingHigh,
  swingLow,
  sessionHigh,
  sessionLow,
  prices5m
}) {

  // Calculate useful metrics
  const distToSupport = Math.abs(currentPrice - support);
  const distToResistance = Math.abs(resistance - currentPrice);
  const atrRatio = atr > 0 ? distToSupport / atr : 0;

  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Price momentum (last 5 bars)
  const recent = prices5m.slice(-5);
  let ups = 0, downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i-1]) ups++;
    else if (recent[i] < recent[i-1]) downs++;
  }
  const momentum = ups > downs ? "BULLISH" : ups < downs ? "BEARISH" : "NEUTRAL";

  const userPrompt = `
PROPOSED TRADE:
Direction: ${proposedDirection}
Direction Agent's Analysis: ${JSON.stringify(directionAnalysis, null, 2)}

CURRENT CONTEXT:
- Current Price: ${currentPrice.toFixed(5)}
- Position in Session: ${positionPct}% (0=low, 100=high)
- Recent Momentum (last 5 bars): ${momentum}

KEY LEVELS:
- Support: ${support.toFixed(5)} (${(distToSupport / atr).toFixed(1)} ATR away)
- Resistance: ${resistance.toFixed(5)} (${(distToResistance / atr).toFixed(1)} ATR away)
- Swing High: ${swingHigh.toFixed(5)}
- Swing Low: ${swingLow.toFixed(5)}

TREND:
- EMA50: ${ema50.toFixed(5)}
- Price vs EMA: ${currentPrice > ema50 ? "ABOVE" : "BELOW"}
- EMA Slope: ${emaSlope > 0 ? "UP" : emaSlope < 0 ? "DOWN" : "FLAT"}

VOLATILITY:
- ATR: ${atr.toFixed(5)}
- ATR as % of price: ${(atr / currentPrice * 100).toFixed(3)}%

Assess the probability of the proposed ${proposedDirection} trade succeeding.`;

  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: CONFIDENCE_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty confidence response");

  return JSON.parse(text);
}

module.exports = { assessConfidence };
