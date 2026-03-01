/**
 * DIRECTION AGENT - GPT-5 Iter5
 *
 * Expert in reading market structure and determining directional bias.
 * Iter5 enhancements:
 * - Structure coherence first
 * - Trend QUALITY assessment
 * - Clarity of signal as explicit output
 */

const { complete } = require("./ai_client");

const DIRECTION_PROMPT = `You are an expert market structure analyst. Your job is to read what the market is TELLING you, not impose what you WANT to see.

THE ART OF READING DIRECTION:

1. FIRST: IS THE MARKET TELLING A CLEAR STORY?
   Before determining direction, ask: "Is this market readable?"

   READABLE MARKETS (easier to trade):
   - Clear swing structure (HH/HL or LH/LL pattern)
   - EMA direction matches price structure
   - Price respects levels cleanly
   - You can "see" where price wants to go

   UNREADABLE MARKETS (harder to trade):
   - Messy, overlapping swings
   - Price chopping around EMA
   - Levels getting pierced and reclaimed
   - No clear destination visible

   An unreadable market is NOT neutral - it's DANGEROUS.
   "I don't know" is a valid and valuable answer.

2. STRUCTURE READING
   UPTREND STRUCTURE:
   - Higher highs AND higher lows
   - Pullbacks are shallow
   - Breaks above resistance hold

   DOWNTREND STRUCTURE:
   - Lower highs AND lower lows
   - Rallies are shallow
   - Breaks below support hold

   RANGE STRUCTURE:
   - Highs and lows at similar levels
   - Price oscillates, doesn't trend
   - Breaks fail and price returns inside

   TRANSITIONAL STRUCTURE (BE CAREFUL):
   - Structure is breaking down or building up
   - Old pattern failing, new pattern forming
   - High uncertainty, wait for clarity

3. EMA AS CONTEXT
   The EMA tells you about MOMENTUM, not direction.

   - Price above rising EMA = momentum favors longs
   - Price below falling EMA = momentum favors shorts
   - Price around flat EMA = no momentum edge

   BUT: EMA alignment alone is NOT enough.
   A rising EMA means nothing if structure is breaking down.

4. KEY LEVELS - Where decisions happen
   - Support: Where buyers stepped in before
   - Resistance: Where sellers stepped in before
   - Session extremes: Where today's conviction showed

   Direction often becomes clear AT these levels, not between them.

5. CONFIDENCE IN YOUR READ
   Be HONEST about how clear the signal is.

   HIGH CLARITY: Structure, EMA, and levels all agree
   MEDIUM CLARITY: Most factors agree, one is unclear
   LOW CLARITY: Mixed signals or messy structure

   A low clarity read is valuable information - it tells you to wait or reduce size.

OUTPUT FORMAT (JSON):
{
  "market_readability": "CLEAR | MODERATE | MESSY",
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "UNCLEAR",
  "structure_read": {
    "pattern": "UPTREND | DOWNTREND | RANGE | TRANSITIONAL",
    "quality": "CLEAN | MESSY",
    "description": "What the swings are showing"
  },
  "ema_context": {
    "slope_direction": "UP | DOWN | FLAT",
    "price_position": "ABOVE | BELOW | AT",
    "momentum_favors": "LONGS | SHORTS | NEITHER"
  },
  "key_levels": {
    "support": number,
    "resistance": number,
    "nearest_swing_high": number,
    "nearest_swing_low": number
  },
  "trade_idea": "Specific idea IF market is readable, or 'Wait for clarity' if not",
  "invalidation": "What would change this view",
  "signal_clarity": "HIGH | MEDIUM | LOW"
}`;

async function analyzeDirection({ prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice }) {

  // Provide fallback values for null indicators
  const safeEma50 = ema50 ?? currentPrice;
  const safeEmaSlope = emaSlope ?? 0;
  const safeSupport = support ?? (currentPrice * 0.998);
  const safeResistance = resistance ?? (currentPrice * 1.002);
  const safeSwingHigh = swingHigh ?? safeResistance;
  const safeSwingLow = swingLow ?? safeSupport;
  const safeSessionHigh = sessionHigh ?? safeResistance;
  const safeSessionLow = sessionLow ?? safeSupport;

  // Calculate price position
  const sessionRange = safeSessionHigh - safeSessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - safeSessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Determine EMA relationship
  const priceVsEma = currentPrice > safeEma50 ? "ABOVE" : currentPrice < safeEma50 ? "BELOW" : "AT";
  const emaTrendDesc = safeEmaSlope > 0.00001 ? "RISING" : safeEmaSlope < -0.00001 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(safeEmaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "(strong)" : slopeMagnitude > 0.10 ? "(moderate)" : "(weak)";

  // Analyze price action for structure hints
  const prices = prices5m;
  let higherHighs = 0, lowerLows = 0, higherLows = 0, lowerHighs = 0;
  for (let i = 2; i < prices.length; i++) {
    const prev2 = prices[i-2], prev1 = prices[i-1], curr = prices[i];
    // Simple swing detection
    if (prev1 > prev2 && prev1 > curr) {
      // Swing high at prev1
      if (i > 3 && prev1 > prices[i-4]) higherHighs++;
      else lowerHighs++;
    }
    if (prev1 < prev2 && prev1 < curr) {
      // Swing low at prev1
      if (i > 3 && prev1 > prices[i-4]) higherLows++;
      else lowerLows++;
    }
  }

  const userPrompt = `
CURRENT MARKET DATA:

PRICE ACTION (last 15 five-minute closes, oldest → newest):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

CURRENT PRICE: ${currentPrice.toFixed(5)}
PRICE LOCATION: ${positionPct}% of session range (0=lows, 100=highs)

EMA DATA:
- EMA50 (30min): ${safeEma50.toFixed(5)}
- Price vs EMA: ${priceVsEma}
- EMA Slope: ${emaTrendDesc} ${slopeStrength} (${safeEmaSlope.toFixed(6)})

KEY LEVELS:
- Session High: ${safeSessionHigh.toFixed(5)}
- Session Low: ${safeSessionLow.toFixed(5)}
- Support: ${safeSupport.toFixed(5)} (${((currentPrice - safeSupport) / currentPrice * 100).toFixed(2)}% away)
- Resistance: ${safeResistance.toFixed(5)} (${((safeResistance - currentPrice) / currentPrice * 100).toFixed(2)}% away)
- Recent Swing High: ${safeSwingHigh.toFixed(5)}
- Recent Swing Low: ${safeSwingLow.toFixed(5)}

Read this market. Is the story clear? What is the structure telling you?`;

  const text = await complete({
    systemPrompt: DIRECTION_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { analyzeDirection };
