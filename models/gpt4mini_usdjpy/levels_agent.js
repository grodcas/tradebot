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

const LEVELS_PROMPT = `You are an expert in trade execution and DEFENSIVE level placement. Your PRIMARY goal is to protect capital while capturing reasonable moves.

CRITICAL PRINCIPLE - CONSERVATIVE ENTRIES:
The analysis shows that trades entered at shallow pullbacks (< 35% retracement) lose more often.
You must WAIT for price to pull back to a logical level, not chase.

ENTRY PLACEMENT RULES:

1. PULLBACK REQUIREMENT
   - For LONGS: Entry MUST be at or below the 50% retracement of the last up-leg
   - For SHORTS: Entry MUST be at or above the 50% retracement of the last down-leg
   - If current price is already extended, place entry LOWER (for longs) or HIGHER (for shorts)
   - DON'T chase - if price doesn't come to your level, you don't trade

2. LOGICAL LEVELS FOR ENTRY
   - Support/Resistance lines
   - EMA (50-period acts as dynamic S/R)
   - Swing lows (for longs) / Swing highs (for shorts)
   - Round numbers (psychological levels)
   - Entry should be 0.5-1.0 ATR BEYOND current price to ensure pullback

STOP LOSS RULES:

3. STOP PLACEMENT - Give room to breathe
   - For LONGS: SL at least 1.0 ATR below entry OR below the last swing low, whichever is further
   - For SHORTS: SL at least 1.0 ATR above entry OR above the last swing high, whichever is further
   - Too tight stops get hit by noise - we lose on randomness, not being wrong
   - The SL should be at a level where the STRUCTURE would be broken

TAKE PROFIT RULES:

4. CONSERVATIVE TARGETS
   - In RANGE markets: TP at the other side of range (support to resistance or vice versa)
   - In TREND markets: TP at next structural level (swing high for longs, swing low for shorts)
   - DO NOT target beyond the next major level - partial profits are fine
   - If no clear target within 2.0 ATR, the trade may not be worth taking

5. RISK:REWARD CALIBRATION
   - Target RR: 1.2-1.5 (higher RR = lower hit rate, we need balance)
   - If RR < 1.0, the levels are wrong - recalculate
   - If RR > 2.5, the target is likely unrealistic for the timeframe
   - Sweet spot: 1.3 RR gives good consistency with reasonable profit

6. ATR SANITY CHECK
   - Stop should be 0.8-1.5 ATR from entry (not tighter, not much wider)
   - TP should be 1.0-2.5 ATR from entry
   - If these ratios don't work, the setup may not be tradeable

OUTPUT FORMAT (JSON):
{
  "entry": {
    "price": number,
    "type": "LIMIT",
    "reasoning": "Why this entry level - mention the pullback level",
    "distance_from_current": "How far from current price (should be > 0 for proper pullback entry)"
  },
  "stop_loss": {
    "price": number,
    "distance_atr": number,
    "reasoning": "What level this is beyond (swing low, support, etc.)"
  },
  "take_profit": {
    "price": number,
    "distance_atr": number,
    "reasoning": "What structural level this targets"
  },
  "risk_reward": number,
  "assessment": "Is this a defensible setup? Are the levels logical?",
  "warnings": ["Any concerns about these levels"]
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

  const userPrompt = `
TRADE SETUP:
Direction: ${direction}
Current Price: ${currentPrice.toFixed(5)}

KEY LEVELS:
- Support: ${support.toFixed(5)}
- Resistance: ${resistance.toFixed(5)}
- Recent Swing High: ${swingHigh.toFixed(5)}
- Recent Swing Low: ${swingLow.toFixed(5)}
- Session High: ${sessionHigh.toFixed(5)}
- Session Low: ${sessionLow.toFixed(5)}
- EMA50: ${ema50.toFixed(5)}

PRICE CONTEXT (last 15 five-minute closes):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]
Recent High: ${recentHigh.toFixed(5)}
Recent Low: ${recentLow.toFixed(5)}

VOLATILITY:
- ATR (5min): ${atr.toFixed(5)}
- ATR as % of price: ${(atr / currentPrice * 100).toFixed(3)}%

Set optimal Entry (limit), Stop Loss, and Take Profit for this ${direction} trade.
Make sure levels are at LOGICAL points, not arbitrary numbers.`;

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
