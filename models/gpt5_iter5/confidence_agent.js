/**
 * CONFIDENCE AGENT - GPT-5 Iter5
 *
 * Expert in assessing trade probability and setup quality.
 * Iter5 enhancements:
 * - Structure coherence awareness
 * - Trend QUALITY not just direction
 * - Market decisiveness sensing
 * - Aggressive sizing down on mixed signals
 */

const { complete } = require("./ai_client");

const CONFIDENCE_PROMPT = `You are an expert trade probability assessor. Your job is to sense the QUALITY of a setup, not just check boxes.

THE ART OF READING SETUPS:

1. STRUCTURE COHERENCE - Does the market tell ONE story?
   Ask yourself: "Is this market in agreement with itself?"

   COHERENT markets:
   - TREND regime + price making HH/HL or LH/LL = clear story
   - RANGE regime + price oscillating = clear story
   - All timeframes pointing same direction = strong agreement

   INCOHERENT markets (DANGER ZONE):
   - TREND regime but structure shows compression = market is confused
   - RANGE regime but structure shows breakout attempt = transition period
   - Mixed signals across indicators = unclear story

   When the market doesn't tell a clear story, BE SKEPTICAL.
   Most losing trades come from forcing a view on an incoherent market.

2. TREND QUALITY - Not all trends are equal
   A barely rising EMA is NOT the same as a strongly rising EMA.

   STRONG TREND (trade confidently):
   - EMA slope is decisive (not hovering near zero)
   - Price respects EMA as dynamic support/resistance
   - Clean swing structure (obvious HH/HL or LH/LL)

   WEAK/STALE TREND (be skeptical):
   - EMA slope is barely positive or negative
   - Price is chopping around EMA instead of respecting it
   - Messy swing structure with overlapping highs/lows

   Weak trends produce the worst trades - they look aligned but aren't.

3. MARKET DECISIVENESS - Is the market making clear moves?
   DECISIVE markets:
   - Price moves cleanly from level to level
   - Rejections are sharp and clear
   - You can "see" the trade working

   INDECISIVE markets:
   - Price is chopping, testing both sides
   - No clean reactions at levels
   - Hard to visualize the path to profit

   If you can't visualize the trade working smoothly, SIZE DOWN.

4. EMA ALIGNMENT - Still important, but context matters
   - Aligned + Coherent + Decisive = HIGH confidence
   - Aligned + Incoherent or Indecisive = MODERATE confidence
   - Misaligned = needs exceptional location to work (LOW confidence)

5. RISK SIZING - Be honest about uncertainty
   The goal is NOT to trade. The goal is to make money.

   When everything is clear:
   - Size normally (0.55-0.70 probability)

   When signals are mixed or market is unclear:
   - SIZE DOWN AGGRESSIVELY (0.40-0.50)
   - A small position in an uncertain trade is better than a full position
   - You don't have to be fully sized to participate

   When signals conflict:
   - Consider skipping (below 0.40)
   - No position is also a position

PROBABILITY CALIBRATION:
- 0.65+: Coherent, decisive, aligned - everything agrees
- 0.55-0.65: Mostly aligned, minor concerns but clear direction
- 0.45-0.55: Mixed signals, incoherent, or indecisive - SIZE DOWN
- Below 0.45: Significant problems, likely skip

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "coherence_check": {
    "regime_structure_match": true/false,
    "assessment": "COHERENT | MIXED | INCOHERENT",
    "note": "What's agreeing or disagreeing"
  },
  "trend_quality": "STRONG | WEAK | UNCLEAR",
  "market_decisiveness": "DECISIVE | CHOPPY | INDECISIVE",
  "ema_aligned": true/false,
  "reasoning": "The story this market is telling",
  "sizing_recommendation": "FULL | REDUCED | MINIMAL | SKIP"
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

  // Provide fallback values for null indicators
  const safeEma50 = ema50 ?? currentPrice;
  const safeEmaSlope = emaSlope ?? 0;
  const safeAtr = atr ?? (currentPrice * 0.001);
  const safeSupport = support ?? (currentPrice * 0.998);
  const safeResistance = resistance ?? (currentPrice * 1.002);
  const safeSwingHigh = swingHigh ?? safeResistance;
  const safeSwingLow = swingLow ?? safeSupport;
  const safeSessionHigh = sessionHigh ?? safeResistance;
  const safeSessionLow = sessionLow ?? safeSupport;

  // Calculate useful metrics
  const distToSupport = Math.abs(currentPrice - safeSupport);
  const distToResistance = Math.abs(safeResistance - currentPrice);

  const sessionRange = safeSessionHigh - safeSessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - safeSessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Price momentum (last 5 bars)
  const recent = prices5m.slice(-5);
  let ups = 0, downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i-1]) ups++;
    else if (recent[i] < recent[i-1]) downs++;
  }
  const momentum = ups > downs ? "BULLISH" : ups < downs ? "BEARISH" : "NEUTRAL";

  // EMA alignment check
  const emaSlopeDir = safeEmaSlope > 0 ? "UP" : "DOWN";
  const emaAligned = (proposedDirection === "LONG" && safeEmaSlope > 0) || (proposedDirection === "SHORT" && safeEmaSlope < 0);

  // EMA slope strength
  const slopeMagnitude = Math.abs(safeEmaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "STRONG" : slopeMagnitude > 0.10 ? "MODERATE" : "WEAK";

  // Structure info
  const regimeDesc = marketRegime || 'UNKNOWN';
  const structureDesc = structureState > 0 ? 'UPTREND' : structureState < 0 ? 'DOWNTREND' : 'RANGE';

  // Coherence check
  const coherent = (regimeDesc === 'RANGE' && structureDesc === 'RANGE') ||
                   (regimeDesc === 'TREND' && structureDesc !== 'RANGE');

  const userPrompt = `
PROPOSED TRADE: ${proposedDirection}

COHERENCE CHECK:
- Regime: ${regimeDesc}
- Structure: ${structureDesc}
- ${coherent ? "✓ Regime and structure AGREE" : "⚠ Regime and structure DISAGREE - be skeptical"}

TREND QUALITY:
- EMA Slope: ${emaSlopeDir} (${slopeStrength} - magnitude ${slopeMagnitude.toFixed(3)})
- ${emaAligned ? "✓ ALIGNED with " + proposedDirection : "✗ MISALIGNED with " + proposedDirection}
- Price ${currentPrice > safeEma50 ? "ABOVE" : "BELOW"} EMA50

CONTEXT:
- Position: ${positionPct}% in session range
- Recent momentum: ${momentum}
- Support: ${safeSupport.toFixed(5)} (${(distToSupport / safeAtr).toFixed(1)} ATR away)
- Resistance: ${safeResistance.toFixed(5)} (${(distToResistance / safeAtr).toFixed(1)} ATR away)

Read this setup. Is the market telling a clear story that supports ${proposedDirection}?`;

  const text = await complete({
    systemPrompt: CONFIDENCE_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { assessConfidence };
