/**
 * LEVELS AGENT
 *
 * Expert in setting Entry, Stop Loss, and Take Profit levels.
 * Understands order flow, volatility-based sizing, and logical level placement.
 */

const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const LEVELS_PROMPT = `You are an expert in trade execution and level placement. You understand that levels should be at MEANINGFUL price points where the market has shown or is likely to show reaction.

**PHILOSOPHY OF LEVEL PLACEMENT**

Levels are not arbitrary numbers. Each level - entry, stop, and target - should be at a price where something MATTERS. A stop below a swing low makes sense because if price breaks that low, the structure has changed. A target at the next resistance makes sense because that's where sellers are likely to appear.

**ENTRY PLACEMENT - PATIENCE OVER CHASING**

The best entries come when price pulls back to a level where buyers (for longs) or sellers (for shorts) are likely to step in. This means:

For LONG trades, ideal entries are:
- At or near support levels where buyers have previously defended
- Near the EMA when price is respecting it as dynamic support
- At prior swing lows that could now act as support
- When price has retraced enough to give a meaningful entry, not when it's extended

For SHORT trades, ideal entries are:
- At or near resistance levels where sellers have previously appeared
- Near the EMA when price is respecting it as dynamic resistance
- At prior swing highs that could now act as resistance
- When price has bounced enough to give a meaningful entry

If current price is already extended (barely pulled back), consider placing entry further from current price to wait for the pullback. If you chase extended price, you often enter just before the pullback happens.

**STOP LOSS PLACEMENT - STRUCTURAL INVALIDATION**

A stop should be placed where your trade thesis would be WRONG, not just where random noise might trigger it.

For LONG trades:
- The stop should be below a level where, if broken, the bullish structure is damaged
- This often means below the last swing low or below key support
- The stop should give enough room that normal market noise doesn't trigger it
- But not so far that a loss becomes catastrophic

For SHORT trades:
- The stop should be above a level where, if broken, the bearish structure is damaged
- This often means above the last swing high or above key resistance
- Give room for normal volatility without placing it so far that risk becomes excessive

The key insight: if your stop gets hit, you want it to mean you were WRONG about the trade, not that you were just unlucky with noise.

**TAKE PROFIT PLACEMENT - REALISTIC TARGETS**

Targets should be at levels where opposing pressure is likely to emerge:

For LONG trades:
- Target near the next resistance where sellers may appear
- Or near the next swing high that could act as a ceiling
- In a range, the other side of the range is a natural target

For SHORT trades:
- Target near the next support where buyers may appear
- Or near the next swing low that could act as a floor
- In a range, the other side of the range is a natural target

Don't set targets beyond major structural levels. It's better to exit at a meaningful level and potentially re-enter than to hold through resistance/support and watch profits evaporate.

**RISK-REWARD REQUIREMENTS**

The take profit MUST be further from entry than the stop loss. This is non-negotiable.

**MINIMUM R:R RATIO: 1.5:1**
- If stop is 20 pips away, target must be at least 30 pips away
- If stop is 1 ATR away, target must be at least 1.5 ATR away

**IDEAL R:R RATIO: 2:1 to 3:1**
- This means for every 1 unit of risk, you target 2-3 units of reward
- Find the next meaningful resistance (for longs) or support (for shorts) that gives at least 2:1

**HOW TO ACHIEVE GOOD R:R:**
1. First, identify where your stop MUST go (structural invalidation level)
2. Then, find a realistic target that is at least 1.5-2x that distance
3. If no such target exists at a meaningful level, the setup may not be worth taking

**DO NOT:**
- Set TP closer than SL (this guarantees negative expectancy)
- Set TP at arbitrary distances without structural reasoning
- Use tiny targets just to "get a win" - small wins don't compensate for full losses

**CRITICAL VALIDATION RULES** (These are ABSOLUTE requirements)

For LONG trades:
- Entry ≤ Current Price (limit order to buy lower or at market)
- Stop Loss < Entry (stop BELOW your entry)
- Take Profit > Entry (target ABOVE your entry)
- VERIFY: SL < Entry < TP

For SHORT trades:
- Entry ≥ Current Price (limit order to sell higher or at market)
- Stop Loss > Entry (stop ABOVE your entry)
- Take Profit < Entry (target BELOW your entry)
- VERIFY: TP < Entry < SL

Before outputting, mentally verify your levels follow the correct pattern for the direction.

OUTPUT FORMAT (JSON):
{
  "entry": {
    "price": number,
    "type": "LIMIT",
    "reasoning": "Why is this entry level meaningful? What level does it correspond to?",
    "distance_from_current": "How far from current price"
  },
  "stop_loss": {
    "price": number,
    "distance_atr": number,
    "reasoning": "What structural level does this protect? Why would the trade be wrong if this level breaks?"
  },
  "take_profit": {
    "price": number,
    "distance_atr": number,
    "reasoning": "What structural level is this targeting? Why might price react here?"
  },
  "risk_reward": number,
  "assessment": "Is this a defensible setup with logical levels? Do the levels correspond to meaningful market structure?",
  "warnings": ["Any concerns about these levels or the setup"]
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

  // Calculate where price is in the structure
  const range = resistance - support;
  const positionInRange = range > 0 ? ((currentPrice - support) / range * 100).toFixed(0) : 50;

  // Calculate distance to key levels
  const distToSupport = currentPrice - support;
  const distToResistance = resistance - currentPrice;
  const distToSwingLow = currentPrice - swingLow;
  const distToSwingHigh = swingHigh - currentPrice;

  const userPrompt = `
TRADE SETUP:
Direction: ${direction}
Current Price: ${currentPrice.toFixed(5)}

STRUCTURAL CONTEXT:
Price is at ${positionInRange}% of the support-resistance range (0% = at support, 100% = at resistance)

KEY LEVELS (consider which are meaningful for this trade):
- Support: ${support.toFixed(5)} (${(distToSupport / atr).toFixed(1)} ATR below current price)
- Resistance: ${resistance.toFixed(5)} (${(distToResistance / atr).toFixed(1)} ATR above current price)
- Recent Swing High: ${swingHigh.toFixed(5)} (${(distToSwingHigh / atr).toFixed(1)} ATR above)
- Recent Swing Low: ${swingLow.toFixed(5)} (${(distToSwingLow / atr).toFixed(1)} ATR below)
- Session High: ${sessionHigh.toFixed(5)}
- Session Low: ${sessionLow.toFixed(5)}
- EMA50: ${ema50.toFixed(5)} (${currentPrice > ema50 ? 'price above' : 'price below'})

RECENT PRICE ACTION (last 15 five-minute closes):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]
Recent High: ${recentHigh.toFixed(5)}
Recent Low: ${recentLow.toFixed(5)}

VOLATILITY CONTEXT:
- ATR (5min): ${atr.toFixed(5)}
- This tells you what "normal" price movement looks like

YOUR TASK:
Set Entry (limit), Stop Loss, and Take Profit for this ${direction} trade.

REQUIREMENTS:
1. Each level must be at a meaningful structural point
2. TP distance must be at least 1.5x the SL distance (minimum R:R of 1.5:1)
3. Ideal R:R is 2:1 to 3:1

First identify the stop (where the trade is wrong), then find a target at least 1.5-2x that distance at a meaningful level.`;

  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: LEVELS_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty levels response");

  return JSON.parse(text);
}

module.exports = { determineLevels };
