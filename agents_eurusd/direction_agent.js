/**
 * DIRECTION AGENT - EUR/USD
 *
 * Expert in reading market structure and determining directional bias.
 * Uses GPT-5.2
 */

const { callGPT5JSON } = require('../gpt5_client');

const DIRECTION_PROMPT = `You are an expert market structure analyst specializing in DIRECTION reading.

YOUR EXPERTISE:

1. EMA (Exponential Moving Average) - TREND INDICATOR
   - Price ABOVE EMA = Bullish bias (buyers in control)
   - Price BELOW EMA = Bearish bias (sellers in control)
   - EMA SLOPE UP = Momentum is bullish, trend strengthening
   - EMA SLOPE DOWN = Momentum is bearish, trend weakening
   - EMA FLAT = No clear trend, ranging market
   - Price crossing EMA = Potential trend change

2. SUPPORT & RESISTANCE - KEY DECISION LEVELS
   - SUPPORT: Price level where buying emerged before (floor)
   - RESISTANCE: Price level where selling emerged before (ceiling)
   - Price approaching support = Potential bounce UP
   - Price approaching resistance = Potential rejection DOWN
   - Price BREAKING support = Bearish (support becomes resistance)
   - Price BREAKING resistance = Bullish (resistance becomes support)
   - The MORE times a level held, the STRONGER it is

3. SWING POINTS - MARKET STRUCTURE
   - SWING HIGH: A peak where price reversed down
   - SWING LOW: A bottom where price reversed up
   - UPTREND: Higher Highs (HH) + Higher Lows (HL)
   - DOWNTREND: Lower Highs (LH) + Lower Lows (LL)
   - RANGE: Swing points at similar levels
   - Breaking a swing point = Structure shift

4. PRICE LOCATION - CONTEXT
   - Near session LOW = Potential long zone (but confirm with structure)
   - Near session HIGH = Potential short zone (but confirm with structure)
   - Mid-range = Less clear, wait for level test

YOUR TASK:
Analyze the market structure and provide a DIRECTIONAL VIEW.
Your output should be VERBOSE and NUANCED - markets are not black and white.

OUTPUT FORMAT (JSON):
{
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "structure_read": "Description of current market structure (trend, swings, key levels)",
  "ema_analysis": "What EMA is telling us about trend",
  "key_levels": {
    "support": number,
    "resistance": number,
    "nearest_swing_high": number,
    "nearest_swing_low": number
  },
  "trade_idea": "Specific actionable idea (e.g., 'Short to support at X, then reassess for long')",
  "invalidation": "What would change this view",
  "confidence": "HIGH | MEDIUM | LOW"
}`;

async function analyzeDirection({ prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice }) {

  // Calculate price position
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Determine EMA relationship
  const priceVsEma = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const emaTrendDesc = emaSlope > 0.00001 ? "RISING" : emaSlope < -0.00001 ? "FALLING" : "FLAT";

  const userPrompt = `
CURRENT MARKET DATA:

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

Analyze this setup and provide your directional view.`;

  return await callGPT5JSON(DIRECTION_PROMPT, userPrompt);
}

module.exports = { analyzeDirection };
