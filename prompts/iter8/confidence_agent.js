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

const CONFIDENCE_PROMPT = `You are the RISK INTUITION agent. Feel the trade. Does it make sense?

**WHAT DOES RISK 0 FEEL LIKE?**
A 0 is when you look at the trade and nothing fits. The Direction Agent seems lost. The indicators contradict each other. The structure says one thing, the momentum says another. You can't find a coherent story. It feels like gambling. These should be rare - less than 20% of trades.

**WHAT DOES RISK 1 FEEL LIKE?**
A 1 is when you review the Direction Agent's decision and you nod along. The structure aligns with the direction. The indicators confirm. There's a clear story: "Price is in an uptrend, pulled back to support, and is bouncing - we buy." Most of the pieces fit together. You don't need EVERYTHING to align - that's impossible. But the main elements agree.

**THE SPECTRUM:**

0.0-0.2 (SKIP): Nothing makes sense. Direction Agent is guessing. Indicators fighting. No story.

0.3-0.4 (LOW): Weak story. Maybe the structure is unclear, or we're in a messy range, or the trade is against recent momentum. Something feels off but it's not total chaos.

0.5-0.6 (MODERATE): Decent setup. Structure and direction agree. Maybe entry timing isn't perfect, or there's one concern. But the core thesis is sound.

0.7-0.8 (HIGH): Good setup. Clear trend or clear range extreme. Direction makes sense. Indicators confirm. The story is coherent.

0.9-1.0 (VERY HIGH): Everything clicks. Clear trend, ideal pullback, at key level, momentum aligning. Rare but real.

**YOUR JOB:**
Read the Direction Agent's analysis. Look at the market data. Ask yourself: "Does this trade make sense? Is there a coherent story?"

Trust your intuition. Don't overthink with mechanical rules.

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "feeling": "One sentence - how does this trade feel?",
  "story": "What's the narrative? Why would this trade work?",
  "concerns": ["What doesn't fit?"],
  "for_proposed_direction": {
    "assessment": "FAVORABLE | MARGINAL | UNFAVORABLE | SKIP",
    "recommendation": "Brief recommendation"
  }
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
  prices5m,
  // Structure info for risk adjustment
  marketRegime = 'UNKNOWN',
  structureState = 0,
  structureLabel = 'UNKNOWN',
  pullbackRatio = 0
}) {

  // Calculate useful metrics
  const distToSupport = Math.abs(currentPrice - support);
  const distToResistance = Math.abs(resistance - currentPrice);

  // Position in S/R range
  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

  // Determine market type and pullback quality
  const isRange = structureState === 0;
  const pullbackPct = (pullbackRatio * 100).toFixed(0);
  const isDeepPullback = pullbackRatio > 0.70;
  const isIdealPullback = pullbackRatio >= 0.35 && pullbackRatio <= 0.60;

  const userPrompt = `
**THE TRADE:**
Direction: ${proposedDirection}
Direction Agent said: "${directionAnalysis.trade_idea || 'No specific idea'}"
Their confidence: ${directionAnalysis.confidence || 'Unknown'}

**THE CONTEXT:**
- Structure: ${structureLabel} ${isRange ? "(Range - no clear trend)" : "(Trending)"}
- Where is price? ${positionInSR}% between support and resistance
- Pullback depth: ${pullbackPct}%
- EMA: Price is ${currentPrice > ema50 ? "above" : "below"}, slope is ${emaSlope > 0 ? "up" : emaSlope < 0 ? "down" : "flat"}

**FEEL THE TRADE:**
Does the Direction Agent's call make sense given this context?
Is there a coherent story here, or is it confused?
Would you put your money on this?

Give a probability from 0 to 1. Trust your gut.`;

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
