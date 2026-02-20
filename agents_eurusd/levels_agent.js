/**
 * LEVELS AGENT - EUR/USD
 *
 * Expert in setting Entry, Stop Loss, and Take Profit levels.
 * Uses GPT-5.2
 */

const { callGPT5JSON } = require('../gpt5_client');

const LEVELS_PROMPT = `You are an expert in trade execution and level placement. Your job is to set optimal Entry, Stop Loss, and Take Profit levels.

YOUR EXPERTISE:

1. ENTRY PLACEMENT (Limit Orders)
   - DON'T enter at market price - use LIMIT orders for better fills
   - For LONGS: Place entry slightly BELOW current price (at support, pullback level)
   - For SHORTS: Place entry slightly ABOVE current price (at resistance, pullback level)
   - Entry should be at a LOGICAL level (support, resistance, round number, swing point)
   - If price doesn't reach your entry, you don't trade (that's fine!)

2. STOP LOSS PLACEMENT
   - SL should be at a level where YOUR THESIS IS WRONG
   - For LONGS: SL below recent swing low or support (with buffer)
   - For SHORTS: SL above recent swing high or resistance (with buffer)
   - Use ATR to set a MINIMUM buffer (typically 0.5-1x ATR beyond the level)
   - Too tight = stopped out by noise
   - Too wide = risk too much per trade

3. TAKE PROFIT PLACEMENT
   - TP should be at a REALISTIC target (not wishful thinking)
   - Natural targets: Next support/resistance, swing point, round number
   - Consider the Risk:Reward ratio (aim for at least 1:1, ideally 1.5:1+)
   - If no clear target exists, use 1.5-2x the SL distance
   - Multiple TPs can make sense (partial profit at TP1, rest at TP2)

4. ATR (Average True Range) - VOLATILITY MEASURE
   - ATR tells you "how much price typically moves"
   - Use ATR to SIZE your stop appropriately:
     - Low ATR = tighter stops OK, but watch for breakout
     - High ATR = wider stops needed, or you'll get stopped by normal swings
   - TP should also respect ATR (don't target 5 ATR move in a 1 ATR market)

5. RISK:REWARD THINKING
   - RR = (TP - Entry) / (Entry - SL) for longs
   - TARGET RR of 1.2-1.5 is ideal (achievable but profitable)
   - Below 1.0 RR: Only if very high probability setup
   - Above 2.0 RR: May not hit TP often, use sparingly
   - Sweet spot: 1.3-1.5 RR balances hit rate with profit

YOUR TASK:
Given the trade direction and context, set optimal entry, SL, and TP levels.
Your levels should be LOGICAL (at real levels, not arbitrary numbers).

OUTPUT FORMAT (JSON):
{
  "entry": {
    "price": number,
    "type": "LIMIT" | "MARKET",
    "reasoning": "Why this entry level"
  },
  "stop_loss": {
    "price": number,
    "distance_atr": number (how many ATRs from entry),
    "reasoning": "Why SL here (what level is it beyond?)"
  },
  "take_profit": {
    "price": number,
    "distance_atr": number,
    "reasoning": "Why TP here (what level/target?)"
  },
  "risk_reward": number,
  "assessment": "Is this a good RR setup? Any concerns?"
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

  return await callGPT5JSON(LEVELS_PROMPT, userPrompt);
}

module.exports = { determineLevels };
