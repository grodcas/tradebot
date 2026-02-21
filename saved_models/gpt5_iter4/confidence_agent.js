/**
 * CONFIDENCE AGENT - GPT-5.2 OPTIMAL
 *
 * Expert in assessing trade probability and setup quality.
 * Does NOT determine direction - evaluates a proposed direction.
 * Output is a calibrated probability with reasoning.
 *
 * PERFORMANCE: 63.3% WR, +17.82R, Max Streak 2, Balanced 53/47
 */

const { complete } = require("./ai_client");

const CONFIDENCE_PROMPT = `You are an expert trade probability assessor. Your confidence must be CALIBRATED based on proven patterns.

KEY PRINCIPLES FOR CALIBRATION:

1. EMA SLOPE ALIGNMENT (Most Important)
   The EMA slope shows current momentum:
   - EMA UP + LONG = ALIGNED (higher probability)
   - EMA DOWN + SHORT = ALIGNED (higher probability)
   - Trading AGAINST EMA slope = MISALIGNED (lower probability, needs strong justification)

2. MARKET STRUCTURE
   - Trading WITH structure direction = higher probability
   - Trading COUNTER to structure = lower probability
   - Counter-structure trades need extreme location to work

3. REGIME CONTEXT
   - TREND regime: momentum trades work well
   - RANGE regime: be more conservative, cap confidence

4. PRICE LOCATION
   - Near session lows: better for longs
   - Near session highs: better for shorts
   - Middle of range: no clear edge

5. CONFLUENCE
   - Multiple factors aligned = higher probability
   - Mixed signals = lower probability
   - Conflicting signals = skip or minimum size

PROBABILITY RANGES:
- 0.70+: Everything aligned (momentum, structure, location)
- 0.55-0.70: Good alignment with minor concerns
- 0.40-0.55: Mixed signals, trade small or wait
- Below 0.40: Significant headwinds, likely skip

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "ema_aligned": true/false,
  "reasoning": "Why this probability",
  "for_proposed_direction": {
    "assessment": "FAVORABLE | MARGINAL | UNFAVORABLE",
    "recommendation": "Sizing recommendation"
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
  // Additional context indicators
  marketRegime = null,
  structureState = null,
  breakoutScore = null,
  sweepScore = null
}) {

  // Calculate useful metrics
  const distToSupport = Math.abs(currentPrice - support);
  const distToResistance = Math.abs(resistance - currentPrice);

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

  // EMA alignment check
  const emaSlopeDir = emaSlope > 0 ? "UP" : "DOWN";
  const emaAligned = (proposedDirection === "LONG" && emaSlope > 0) || (proposedDirection === "SHORT" && emaSlope < 0);

  // Structure info
  const regimeDesc = marketRegime || 'UNKNOWN';
  const structureDesc = structureState > 0 ? 'UPTREND' : structureState < 0 ? 'DOWNTREND' : 'RANGE';

  const userPrompt = `
PROPOSED TRADE: ${proposedDirection}

KEY CHECKS:
- EMA Slope: ${emaSlopeDir} → ${emaAligned ? "✓ ALIGNED with " + proposedDirection : "✗ MISALIGNED"}
- Structure: ${structureDesc}
- Regime: ${regimeDesc}
- Position: ${positionPct}% in session (0=lows, 100=highs)

CONTEXT:
- EMA50: ${ema50.toFixed(5)} | Price ${currentPrice > ema50 ? "ABOVE" : "BELOW"} EMA
- Support: ${support.toFixed(5)} (${(distToSupport / atr).toFixed(1)} ATR away)
- Resistance: ${resistance.toFixed(5)} (${(distToResistance / atr).toFixed(1)} ATR away)

Assess this ${proposedDirection} trade.`;

  const text = await complete({
    systemPrompt: CONFIDENCE_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { assessConfidence };
