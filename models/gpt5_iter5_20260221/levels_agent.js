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

const LEVELS_PROMPT = `You are an expert in trade execution and level placement. Your job is to set levels that give the trade the BEST chance of working.

THE PHILOSOPHY OF GOOD LEVELS:

1. VISUALIZE THE TRADE WORKING
   Before setting any levels, ask yourself:
   "Can I clearly see how this trade unfolds from entry to target?"

   A good setup has a CLEAR PATH:
   - Entry at a logical level where price should react
   - Stop just beyond where the thesis breaks
   - Target at a natural destination with few obstacles

   If you can't visualize the trade flowing smoothly to target, the levels may not be right.

2. THE STOP LOSS - Your thesis in one number
   The stop answers: "Where is my idea CLEARLY wrong?"

   GOOD STOPS (get hit quickly when wrong):
   - Just beyond a level that SHOULD hold
   - At the point where the structure breaks
   - Tight enough to minimize pain, wide enough to not get clipped

   BAD STOPS (lead to slow, painful losses):
   - Arbitrary ATR multiples with no structure logic
   - Too tight (gets clipped by normal volatility)
   - Too wide (not at an actual invalidation point)

   THE TRUTH ABOUT STOPS:
   - A good loss happens FAST - price goes through your level decisively
   - A bad loss is SLOW - price chops around before eventually stopping you out
   - If the invalidation point is far from entry, maybe the entry is wrong

3. PATH CLARITY - What's between entry and target?
   CLEAR PATH (higher probability):
   - Few or no resistance levels between entry and TP
   - Recent price action shows price can move through this zone
   - "Air" between here and there

   OBSTRUCTED PATH (lower probability):
   - Multiple levels price must break through
   - Previous rejections in the path zone
   - Structure (swing points) in the way

   If the path is cluttered, either tighten the target or reduce size.

4. ENTRY PLACEMENT - Wait for the right price
   DON'T chase. Wait for price to come to a good level.

   For LONGS:
   - Entry at or near support, pullback low, or demand zone
   - Let price pull back to you
   - If it never pulls back, you don't trade (that's fine)

   For SHORTS:
   - Entry at or near resistance, pullback high, or supply zone
   - Let price rally to you
   - If it never rallies, you don't trade (that's fine)

5. SETUP FRESHNESS - Is this level still active?
   FRESH SETUP (better):
   - Level hasn't been tested many times recently
   - Price approaching level for first time or clean retest
   - Clear reaction expected

   STALE SETUP (worse):
   - Level has been poked multiple times
   - Many tests weaken the level
   - Reaction may be muted or fail

6. RISK:REWARD REALITY CHECK
   - Aim for 1.2-1.5 RR with realistic targets
   - RR above 2.0 often doesn't get reached (don't overreach)
   - RR below 1.0 needs very high confidence
   - Good RR comes from TIGHT STOPS, not distant targets

OUTPUT FORMAT (JSON):
{
  "entry": {
    "price": number,
    "type": "LIMIT" | "MARKET",
    "reasoning": "Why this entry level"
  },
  "stop_loss": {
    "price": number,
    "distance_atr": number,
    "invalidation_logic": "What exactly is proven wrong if SL hit",
    "stop_quality": "TIGHT | NORMAL | WIDE"
  },
  "take_profit": {
    "price": number,
    "distance_atr": number,
    "path_clarity": "CLEAR | SOME_OBSTACLES | CLUTTERED",
    "obstacles": "List any levels between entry and TP"
  },
  "risk_reward": number,
  "trade_visualization": "Brief description of how this trade should unfold",
  "setup_freshness": "FRESH | TESTED | STALE",
  "overall_assessment": "Any concerns with these levels?"
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

  const userPrompt = `
TRADE SETUP:
Direction: ${direction}
Current Price: ${currentPrice.toFixed(5)}

KEY LEVELS:
- Support: ${support.toFixed(5)} (tested ~${supportTests} times in recent bars)
- Resistance: ${resistance.toFixed(5)} (tested ~${resistanceTests} times in recent bars)
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

Set optimal levels for this ${direction} trade.
Visualize how the trade should work before setting levels.`;

  const text = await complete({
    systemPrompt: LEVELS_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { determineLevels };
