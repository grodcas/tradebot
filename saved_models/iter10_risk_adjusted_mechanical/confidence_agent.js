/**
 * CONFIDENCE AGENT - Risk Adjusted
 *
 * Expert in assessing trade probability and setup quality.
 * CRITICAL: Dramatically reduces risk for BAD setup patterns identified from backtesting:
 * - Counter-trend trades (trading against structure)
 * - Range-bound markets without clear direction
 * - Deep pullback ratios (trend exhaustion)
 * - Shallow pullback ratios (no proper entry)
 */

const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const CONFIDENCE_PROMPT = `You are an expert trade probability assessor. Your job is to evaluate HOW LIKELY a proposed trade is to succeed.

You do NOT decide direction - the Direction Agent did that. You ASSESS the quality of the setup.

CRITICAL: From extensive backtesting, we've identified that ALL LOSSES come from specific BAD setup patterns. You MUST identify and SEVERELY penalize these patterns:

## BAD SETUP PATTERNS (40% win rate - REDUCE PROBABILITY TO 0.25-0.35):

1. COUNTER-TREND TRADES
   - Going LONG when structure is DOWNTREND = BAD
   - Going SHORT when structure is UPTREND = BAD
   - These trades win only 40% of the time!

2. RANGE TRADING WITHOUT EDGE
   - Structure is RANGE and we're not at a clear boundary = BAD
   - Middle of range with no clear catalyst = BAD

3. DEEP PULLBACK (pullbackRatio > 0.70)
   - This indicates trend exhaustion
   - The dominant side is losing control
   - High probability of reversal = BAD

4. SHALLOW PULLBACK (pullbackRatio < 0.25)
   - No proper retracement for entry
   - Chasing price without confirmation = BAD

## GOOD SETUP PATTERNS (100% win rate - PROBABILITY 0.65-0.80):

1. WITH-TREND TRADES
   - LONG when structure is UPTREND = GOOD
   - SHORT when structure is DOWNTREND = GOOD

2. IDEAL PULLBACK (0.38-0.62)
   - Healthy retracement showing trend strength
   - Fibonacci zone = GOOD

3. CLEAR STRUCTURE
   - Trending market with obvious direction = GOOD

YOUR TASK:
1. First, identify if ANY BAD patterns are present
2. If BAD patterns exist: probability MUST be 0.25-0.35
3. If setup is clean with GOOD patterns: probability can be 0.65-0.80
4. Mixed signals: 0.45-0.55

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "bad_patterns_detected": ["list any BAD patterns found"],
  "good_patterns_detected": ["list any GOOD patterns found"],
  "reasoning": "Why this probability (mention specific factors)",
  "strengths": ["What's good about this setup"],
  "weaknesses": ["What's concerning about this setup"],
  "for_proposed_direction": {
    "assessment": "FAVORABLE | MARGINAL | UNFAVORABLE",
    "recommendation": "Specific recommendation"
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
  prices5m,
  // NEW: Critical indicators for BAD pattern detection
  structureState,
  structureLabel,
  marketRegime,
  pullbackRatio,
  breakoutScore
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

  // PRE-DETECT BAD PATTERNS to help the model
  const badPatterns = [];
  const goodPatterns = [];

  // Check counter-trend
  if (proposedDirection === 'LONG' && structureState === -1) {
    badPatterns.push('COUNTER-TREND: Going LONG in DOWNTREND structure');
  }
  if (proposedDirection === 'SHORT' && structureState === 1) {
    badPatterns.push('COUNTER-TREND: Going SHORT in UPTREND structure');
  }

  // Check with-trend
  if (proposedDirection === 'LONG' && structureState === 1) {
    goodPatterns.push('WITH-TREND: Going LONG in UPTREND structure');
  }
  if (proposedDirection === 'SHORT' && structureState === -1) {
    goodPatterns.push('WITH-TREND: Going SHORT in DOWNTREND structure');
  }

  // Check range
  if (structureState === 0 || marketRegime === 'RANGE') {
    badPatterns.push('RANGE: Trading in range-bound market without clear edge');
  }

  // Check pullback ratio
  if (pullbackRatio !== null && pullbackRatio !== undefined) {
    if (pullbackRatio > 0.70) {
      badPatterns.push(`DEEP PULLBACK: ${(pullbackRatio * 100).toFixed(0)}% retracement indicates trend exhaustion`);
    } else if (pullbackRatio < 0.25 && pullbackRatio >= 0) {
      badPatterns.push(`SHALLOW PULLBACK: ${(pullbackRatio * 100).toFixed(0)}% retracement - no proper entry`);
    } else if (pullbackRatio >= 0.38 && pullbackRatio <= 0.62) {
      goodPatterns.push(`IDEAL PULLBACK: ${(pullbackRatio * 100).toFixed(0)}% in Fibonacci zone`);
    }
  }

  const userPrompt = `
PROPOSED TRADE:
Direction: ${proposedDirection}
Direction Agent's Analysis: ${JSON.stringify(directionAnalysis, null, 2)}

=== CRITICAL STRUCTURE INDICATORS ===
- Structure State: ${structureLabel || 'UNKNOWN'} (${structureState})
- Market Regime: ${marketRegime || 'UNKNOWN'}
- Pullback Ratio: ${pullbackRatio !== null ? (pullbackRatio * 100).toFixed(0) + '%' : 'N/A'}
- Breakout Score: ${breakoutScore || 'N/A'}

=== PRE-DETECTED PATTERNS ===
BAD PATTERNS FOUND: ${badPatterns.length > 0 ? badPatterns.join('; ') : 'NONE'}
GOOD PATTERNS FOUND: ${goodPatterns.length > 0 ? goodPatterns.join('; ') : 'NONE'}

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

REMEMBER: If ANY BAD patterns are detected, probability MUST be 0.25-0.35.
Only give 0.65+ probability if GOOD patterns dominate and NO BAD patterns exist.

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

  const result = JSON.parse(text);

  // SAFETY NET: If bad patterns were detected but model still gave high probability, force reduction
  if (badPatterns.length > 0 && result.probability > 0.40) {
    console.log(`   [CONFIDENCE] SAFETY: Reducing probability from ${(result.probability * 100).toFixed(0)}% due to BAD patterns`);
    result.probability = 0.30 + Math.random() * 0.10; // 0.30-0.40
    result.safety_adjusted = true;
  }

  return result;
}

module.exports = { assessConfidence };
