/**
 * LEVELS AGENT - GPT-5 Iter5
 *
 * Expert in setting Entry, Stop Loss, and Take Profit levels.
 * Iter5 enhancements:
 * - Path clarity assessment
 * - Setup freshness awareness
 * - "Working trade" visualization
 */

const { complete } = require("./ai_client");

const LEVELS_PROMPT = `You are an expert in trade execution and level placement for MARKET ORDER trading.

CRITICAL: YOU ARE TRADING WITH MARKET ORDERS
- Entry happens IMMEDIATELY at CURRENT PRICE
- You CANNOT wait for a better price - trade is executed NOW
- All levels must be based on WHERE PRICE IS NOW, not where you wish it was
- Entry price = Current Price (you don't pick it)

THE PHILOSOPHY OF MARKET ORDER LEVELS:

1. STOP LOSS - MUST SURVIVE MARKET NOISE
   Since entry is at market price (not a perfect level), stops must be WIDER:

   MINIMUM STOP DISTANCE:
   - At least 1.0 ATR from current price (NEVER tighter)
   - Preferably 1.2-1.5 ATR for safety
   - Below/above a REAL structure level that would invalidate the trade

   WHY WIDER STOPS FOR MARKET ORDERS:
   - You're not entering at a perfect support/resistance bounce
   - Price may chop around before moving in your direction
   - Tight stops get hunted by normal market noise

   STOP PLACEMENT RULES:
   - LONG: SL below nearest swing low OR current price - 1.5 ATR (whichever is lower)
   - SHORT: SL above nearest swing high OR current price + 1.5 ATR (whichever is higher)
   - Never place SL at a round number or obvious level (add buffer)

2. TAKE PROFIT - REALISTIC FROM CURRENT PRICE
   Since you're entering NOW (not at support/resistance):
   - TP must be reachable from CURRENT price
   - Use nearest structure level as target (swing high for LONG, swing low for SHORT)
   - Don't set TP at distant levels that require multiple breakouts

   TP PLACEMENT RULES:
   - LONG: TP at resistance, swing high, or session high (whichever is closest and logical)
   - SHORT: TP at support, swing low, or session low (whichever is closest and logical)
   - Ensure clear path (no major obstacles between current price and TP)

3. RISK:REWARD WITH MARKET ORDERS
   - With wider stops, RR may be lower (1.0-1.5 is acceptable)
   - RR above 2.0 is rare with market orders - don't force it
   - Better to have realistic RR than fake RR that never gets hit

4. THE "SHOULD I EVEN TRADE?" CHECK
   Before setting levels, ask:
   - Is current price at a good location for this direction?
   - LONG: Is price near support, or in the middle of nowhere?
   - SHORT: Is price near resistance, or in the middle of nowhere?

   If price is in NO MAN'S LAND (middle of range):
   - Stops will be wide, targets will be far
   - Maybe this isn't a good market order setup
   - Consider SKIP if location is poor

OUTPUT FORMAT (JSON):
{
  "entry": {
    "price": number (MUST equal current price - market order),
    "type": "MARKET",
    "location_quality": "GOOD | OKAY | POOR - where is current price relative to structure"
  },
  "stop_loss": {
    "price": number,
    "distance_atr": number (MUST be >= 1.0 ATR),
    "structure_level": "What level is SL placed beyond",
    "stop_quality": "SAFE | ADEQUATE | RISKY"
  },
  "take_profit": {
    "price": number,
    "distance_atr": number,
    "target_level": "What structure level is TP at",
    "path_clarity": "CLEAR | SOME_OBSTACLES | CLUTTERED"
  },
  "risk_reward": number,
  "trade_quality": "Is this a good market order setup given current price location?",
  "recommendation": "EXECUTE | SKIP - should we trade from current price?"
}`;

async function determineLevels({
  direction,
  currentPrice,
  support,
  resistance,
  swingHigh,
  swingLow,
  sessionHigh,
  sessionLow,
  atr,
  ema50,
  prices5m
}) {

  // Find recent high/low in price data for context
  const recentHigh = Math.max(...prices5m);
  const recentLow = Math.min(...prices5m);

  // Calculate how many times price has tested support/resistance
  const priceClose = prices5m;
  const testThreshold = atr * 0.3;
  let supportTests = 0, resistanceTests = 0;
  for (const p of priceClose) {
    if (Math.abs(p - support) < testThreshold) supportTests++;
    if (Math.abs(p - resistance) < testThreshold) resistanceTests++;
  }

  // Calculate minimum SL distance (1.0 ATR)
  const minSlDistance = atr * 1.0;

  const userPrompt = `
*** MARKET ORDER ENTRY ***
Entry will happen IMMEDIATELY at: ${currentPrice.toFixed(5)}
You CANNOT choose a different entry price.

Direction: ${direction}

KEY LEVELS (use these for SL/TP placement):
- Support: ${support.toFixed(5)} (tested ~${supportTests} times in recent bars)
- Resistance: ${resistance.toFixed(5)} (tested ~${resistanceTests} times in recent bars)
- Swing High: ${swingHigh.toFixed(5)}
- Swing Low: ${swingLow.toFixed(5)}
- Session High: ${sessionHigh.toFixed(5)}
- Session Low: ${sessionLow.toFixed(5)}
- EMA50: ${ema50.toFixed(5)}

PRICE CONTEXT (recent closes):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]
Recent High: ${recentHigh.toFixed(5)}
Recent Low: ${recentLow.toFixed(5)}

VOLATILITY:
- ATR (5min): ${atr.toFixed(5)}
- MINIMUM SL DISTANCE: ${minSlDistance.toFixed(5)} (1.0 ATR - NEVER go tighter)
- For LONG: SL must be <= ${(currentPrice - minSlDistance).toFixed(5)}
- For SHORT: SL must be >= ${(currentPrice + minSlDistance).toFixed(5)}

Set levels for this ${direction} MARKET ORDER trade.
Remember: Entry = ${currentPrice.toFixed(5)} (fixed, cannot change).
SL must be at least 1.0 ATR from entry to survive market noise.`;

  const text = await complete({
    systemPrompt: LEVELS_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { determineLevels };
