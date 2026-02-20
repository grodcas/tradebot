/**
 * DIRECTION AGENT - USD/JPY
 *
 * Expert in reading market structure and determining directional bias.
 * Uses GPT-5.2
 */

const { callGPT5JSON } = require('../gpt5_client');

const DIRECTION_PROMPT = `You are an expert market structure analyst specializing in DIRECTION reading.

CRITICAL PRINCIPLE - STRUCTURE STATE DETERMINES BIAS:
Before analyzing anything else, you MUST classify the structure:
- UPTREND (HH + HL): Only look for LONG opportunities
- DOWNTREND (LH + LL): Only look for SHORT opportunities
- RANGE (mixed/unclear): Be NEUTRAL - do NOT force a directional bias

THE #1 MISTAKE traders make is seeing bullish signals in a range and calling it an uptrend.
If swing highs are NOT making higher highs, it's NOT an uptrend - it's a range.
If swing lows are NOT making lower lows, it's NOT a downtrend - it's a range.

YOUR EXPERTISE:

1. STRUCTURE STATE - THE FOUNDATION (Check this FIRST)
   - Count the last 3-4 swing highs and swing lows
   - UPTREND: Each swing high HIGHER than previous, each swing low HIGHER than previous
   - DOWNTREND: Each swing high LOWER than previous, each swing low LOWER than previous
   - RANGE: Swing points at similar levels OR conflicting signals (HH but LL, or LH but HL)
   - If structure is RANGE, your bias MUST be NEUTRAL unless price breaks range boundaries

2. EMA (Exponential Moving Average) - CONFIRMS STRUCTURE, doesn't override it
   - Price ABOVE EMA in UPTREND = Strong confirmation
   - Price BELOW EMA in DOWNTREND = Strong confirmation
   - Price crossing EMA in RANGE = Just noise, not a signal
   - EMA FLAT = RANGE confirmation - do not trade directionally

3. SUPPORT & RESISTANCE - WHERE to trade, not WHETHER to trade
   - In UPTREND: Buy at support (pullback entries)
   - In DOWNTREND: Sell at resistance (pullback entries)
   - In RANGE: These are mean-reversion levels, NOT breakout signals

4. COUNTER-TREND RULE (CRITICAL FOR RISK)
   - NEVER call bullish bias if structure shows lower highs
   - NEVER call bearish bias if structure shows higher lows
   - Counter-trend trades require the trend to BREAK first

5. PULLBACK QUALITY - Entry timing matters
   - Good pullback: 40-60% retracement of previous leg
   - Shallow pullback (<30%): Higher risk of continuation against you
   - Deep pullback (>70%): Structure may be breaking down

OUTPUT FORMAT (JSON):
{
  "structure_state": "UPTREND" | "DOWNTREND" | "RANGE",
  "structure_evidence": "Describe the swing points: SH0→SH1, SL0→SL1 pattern",
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "bias_reasoning": "Why this bias given the structure (if RANGE, explain why NEUTRAL)",
  "ema_analysis": "Does EMA confirm or conflict with structure?",
  "key_levels": {
    "support": number,
    "resistance": number,
    "nearest_swing_high": number,
    "nearest_swing_low": number
  },
  "trade_idea": "Specific idea IF structure supports it. If RANGE, say 'Wait for breakout' or 'No clear trade'",
  "invalidation": "What would change this view",
  "confidence": "HIGH | MEDIUM | LOW",
  "is_counter_trend": false
}`;

async function analyzeDirection({
  prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice,
  computedStructureState = 0, computedStructureLabel = 'UNKNOWN', marketRegime = 'UNKNOWN', pullbackRatio = 0
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

  const userPrompt = `
CURRENT MARKET DATA:

**COMPUTED STRUCTURE STATE (from swing analysis):**
- Structure: ${structureDesc}
- Market Regime: ${marketRegime}
- Pullback Depth: ${(pullbackRatio * 100).toFixed(0)}% (40-60% is ideal for entry)

IMPORTANT: The structure state above is computed from actual swing points.
If it shows RANGE, your bias should be NEUTRAL unless you see a clear breakout.
If it shows UPTREND, only consider LONG. If DOWNTREND, only consider SHORT.

PRICE ACTION (last 15 five-minute closes, oldest → newest):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

CURRENT PRICE: ${currentPrice.toFixed(5)}
PRICE LOCATION: ${positionPct}% of session range (0=low, 100=high)

EMA DATA:
- EMA50 (30min): ${ema50.toFixed(5)}
- Price vs EMA: ${priceVsEma}
- EMA Slope: ${emaTrendDesc} (${emaSlope.toFixed(6)})

KEY LEVELS:
- Session High: ${sessionHigh.toFixed(5)}
- Session Low: ${sessionLow.toFixed(5)}
- Support: ${support.toFixed(5)} (${((currentPrice - support) / currentPrice * 100).toFixed(2)}% away)
- Resistance: ${resistance.toFixed(5)} (${((resistance - currentPrice) / currentPrice * 100).toFixed(2)}% away)
- Recent Swing High: ${swingHigh.toFixed(5)}
- Recent Swing Low: ${swingLow.toFixed(5)}

Analyze this setup. RESPECT the computed structure state - do not override it with optimistic interpretation.`;

  return await callGPT5JSON(DIRECTION_PROMPT, userPrompt);
}

module.exports = { analyzeDirection };
