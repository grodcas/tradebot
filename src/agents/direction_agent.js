/**
 * DIRECTION AGENT - Iter20
 *
 * Multi-timeframe market structure analyst.
 * Receives daily, 30m, and 5m data to determine direction top-down.
 *
 * Iter20: Builds on Iter19's principle-based reasoning.
 *         Changes from Iter19:
 *         - FALSE BREAK AWARENESS: 47% of Iter19 losses were outside S/R range.
 *           Now teaches the AI that breaks beyond S/R often reverse (false breaks).
 *         - BINARY CONVICTION: HIGH or LOW only. MEDIUM was useless (100% of trades).
 *         - MUST DECIDE: No NEUTRAL output. Market always has a lean — find it.
 *         - PREVIOUS DAY LEVELS: Adds prevDayHigh/Low as broader context
 *           beyond session-only S/R (which can be too narrow).
 */

const { complete } = require("./ai_client");

const DIRECTION_PROMPT = `You are an expert forex trader analyzing EUR/USD. Your job: determine the most probable short-term direction. You MUST choose BULLISH or BEARISH — never NEUTRAL.

You receive data across three timeframes: DAILY, 30-MINUTE, and 5-MINUTE. Analyze top-down.

=== UNDERSTANDING YOUR INPUTS ===

DAILY CLOSES: The macro trend over the past week. Rising = bullish environment, falling = bearish, flat = neutral. EMA200 reinforces this: price above = bullish bias, below = bearish. The further from EMA200, the stronger the trend.

PREVIOUS DAY HIGH/LOW: The full prior trading day's price range. This is a broader, more significant reference than session-only levels. When price is between the previous day's high and low, it is still within "normal" territory. When price breaks beyond these levels, it indicates genuine directional conviction — the market is doing something unusual. Use these levels as a reality check on session S/R.

30-MINUTE SWING STRUCTURE: Swing points reveal who controls the market:
- Higher Highs + Higher Lows = buyers in control (uptrend)
- Lower Highs + Lower Lows = sellers in control (downtrend)
- Mixed = no clear control (range or transition)
The STRUCTURE LABEL and MARKET REGIME are pre-computed summaries. Verify with the raw swing data.

EMA50 MOMENTUM (30m): Speed and direction of the medium-term moving average. Strong = decisive pressure. Weak/flat = indecision. This tells you WHO has momentum and how confidently.

SUPPORT & RESISTANCE (SESSION-BASED): Key price boundaries from the previous trading session. These levels are useful but NOT absolute — they represent one session's range, not the market's true boundaries. Distance in ATR units tells proximity. Negative distance means the level has been broken through.

POSITION IN S/R RANGE: Where price sits between support (0%) and resistance (100%). Values below 0% or above 100% mean price has moved BEYOND session S/R. In ranging markets, edges tend to revert. S/R RANGE WIDTH in ATR units indicates room for movement.

5-MINUTE CLOSES: The micro picture — what is price doing RIGHT NOW? Pulling back (opportunity)? Accelerating (confirmation)? Stalling and reversing (rejection)?

SESSION: LONDON and NY have best liquidity and directional moves. ASIA is quieter, more range-bound.

=== HOW TO REASON ===

1. IDENTIFY THE REGIME FIRST. Everything depends on context:
   - In a TREND: trade with it. Pullbacks are entry opportunities. Only consider counter-trend at major levels with clear rejection evidence.
   - In a RANGE: boundaries drive the decision. Near support → bullish probability. Near resistance → bearish probability. Mid-range → use momentum and structure as tiebreaker. Position matters more than short-term EMA direction.
   - In EXPANSION: high uncertainty. Proceed only with clear multi-timeframe agreement.

2. BEWARE FALSE BREAKS. When price is OUTSIDE the session S/R range (position below 0% or above 100%), do NOT automatically assume continuation. False breaks are extremely common in forex — price sweeps beyond a level to trigger stops, then reverses sharply back inside the range. The further outside the range with weak momentum, the higher the false break probability. Check the previous day high/low: if price is still WITHIN the daily range despite breaking session S/R, the break is likely false. Only trust a break if momentum is strong AND multiple timeframes confirm the direction.

3. WEIGH THE EVIDENCE. No single indicator is conclusive. Look for confluence — the more independent signals that agree, the stronger the case. One very strong signal (clear rejection at a well-tested level with structure confirmation) can suffice.

4. CHALLENGE YOUR READ. Identify the strongest argument AGAINST your direction. If the counter-argument is weak → conviction is HIGH. If the counter-argument is strong → conviction is LOW. This directly determines your conviction.

5. YOU MUST DECIDE. The market always has a lean, even if slight. Your output must be BULLISH or BEARISH. There is no NEUTRAL option. Find the direction with even marginally better probability and commit to it.

OUTPUT FORMAT (JSON):
{
  "regime_assessment": "What regime is the market in and why — one sentence",
  "primary_bias": "BULLISH | BEARISH",
  "analysis": {
    "daily_context": "What the daily timeframe tells us",
    "structure_30m": "What the swing structure reveals",
    "timing_5m": "What price is doing right now relative to the larger picture",
    "key_levels": "Where is price relative to session S/R AND previous day high/low — is this a false break situation?",
    "confluence": "How the timeframes and indicators align or conflict"
  },
  "trade_idea": "Your specific trade thesis — what is the setup and why should it work",
  "counter_argument": "The strongest reason this trade could fail",
  "conviction": "HIGH | LOW"
}`;

async function analyzeDirection({
  prices5m,
  prices30m,
  pricesDaily,
  ema50,
  emaSlope,
  ema200,
  support,
  resistance,
  swingHigh,
  swingLow,
  sessionHigh,
  sessionLow,
  currentPrice,
  atr5m,
  currentSession,
  marketRegime,
  structureLabel,
  structureSwings,
  prevDayHigh = null,
  prevDayLow = null,
}) {

  // Calculate price position in previous session range
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Calculate price position in S/R range
  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

  // S/R range width — helps AI assess room for movement
  const rangeSizePips = (srRange * 10000).toFixed(0);
  const rangeWidthATR = atr5m > 0 ? (srRange / atr5m).toFixed(1) : "N/A";

  // EMA context
  const priceVsEma50 = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const priceVsEma200 = ema200 ? (currentPrice > ema200 ? "ABOVE" : currentPrice < ema200 ? "BELOW" : "AT") : null;

  // EMA slope description — slope is ATR-normalized: (EMA_now - EMA_1.5h_ago) / ATR_30m
  // >0.20 = strong directional move, 0.10-0.20 = moderate, <0.10 = weak/flat
  const emaTrendDesc = emaSlope > 0.05 ? "RISING" : emaSlope < -0.05 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "strong" : slopeMagnitude > 0.10 ? "moderate" : "weak";

  // Structure swing points — these are objects { index, price } or null
  const sh0Price = structureSwings?.SH0?.price;
  const sh1Price = structureSwings?.SH1?.price;
  const sl0Price = structureSwings?.SL0?.price;
  const sl1Price = structureSwings?.SL1?.price;

  // Format swing point comparison with clear labels
  let swingAnalysis = "";
  if (sh0Price && sh1Price && sl0Price && sl1Price) {
    const hhOrLh = sh1Price > sh0Price ? "HIGHER HIGH (HH)" : sh1Price < sh0Price ? "LOWER HIGH (LH)" : "EQUAL HIGH";
    const hlOrLl = sl1Price > sl0Price ? "HIGHER LOW (HL)" : sl1Price < sl0Price ? "LOWER LOW (LL)" : "EQUAL LOW";
    swingAnalysis = `Previous swing high: ${sh0Price.toFixed(5)} → Latest swing high: ${sh1Price.toFixed(5)} = ${hhOrLh}
Previous swing low: ${sl0Price.toFixed(5)} → Latest swing low: ${sl1Price.toFixed(5)} = ${hlOrLl}`;
  } else {
    swingAnalysis = "Not enough swing points to determine structure";
  }

  // Format support/resistance distances clearly
  const distToSupport = currentPrice - support;
  const distToSupportATR = distToSupport / atr5m;
  const supportDesc = distToSupportATR >= 0
    ? `${distToSupportATR.toFixed(1)} ATR above support`
    : `${Math.abs(distToSupportATR).toFixed(1)} ATR BELOW support (broken)`;

  const distToResistance = resistance - currentPrice;
  const distToResistanceATR = distToResistance / atr5m;
  const resistanceDesc = distToResistanceATR >= 0
    ? `${distToResistanceATR.toFixed(1)} ATR below resistance`
    : `${Math.abs(distToResistanceATR).toFixed(1)} ATR ABOVE resistance (broken)`;

  // EMA200 line
  const ema200Line = ema200
    ? `EMA200 (daily): ${ema200.toFixed(5)} — price is ${priceVsEma200}`
    : "EMA200: not available (insufficient history)";

  // Previous day high/low context
  let prevDayContext = "";
  if (prevDayHigh != null && prevDayLow != null) {
    const dayRange = prevDayHigh - prevDayLow;
    const posInDayRange = dayRange > 0 ? ((currentPrice - prevDayLow) / dayRange * 100).toFixed(0) : 50;
    const withinDayRange = currentPrice >= prevDayLow && currentPrice <= prevDayHigh;
    prevDayContext = `
PREVIOUS DAY RANGE:
- Previous Day High: ${prevDayHigh.toFixed(5)}
- Previous Day Low: ${prevDayLow.toFixed(5)}
- Day range: ${(dayRange * 10000).toFixed(0)} pips
- Price position in day range: ${posInDayRange}% (0%=day low, 100%=day high)
- Price is ${withinDayRange ? "INSIDE" : "OUTSIDE"} the previous day's range`;
  }

  // Location note — factual observation, no directional guidance
  let locationNote = "";
  const outsideSR = distToSupportATR < 0 || distToResistanceATR < 0;
  if (outsideSR) {
    // Price is beyond session S/R — flag the false break possibility
    const withinDayRange = prevDayHigh != null && prevDayLow != null &&
      currentPrice >= prevDayLow && currentPrice <= prevDayHigh;
    if (distToSupportATR < 0) {
      locationNote = `\nLOCATION: Price is ${Math.abs(distToSupportATR).toFixed(1)} ATR below session support (level broken).`;
      if (withinDayRange) locationNote += ` But still INSIDE previous day's range — potential false break.`;
    } else {
      locationNote = `\nLOCATION: Price is ${Math.abs(distToResistanceATR).toFixed(1)} ATR above session resistance (level broken).`;
      if (withinDayRange) locationNote += ` But still INSIDE previous day's range — potential false break.`;
    }
  } else if (distToSupportATR >= 0 && distToSupportATR < 1.0) {
    locationNote = `\nLOCATION: Price is ${distToSupportATR.toFixed(1)} ATR from support.`;
  } else if (distToResistanceATR >= 0 && distToResistanceATR < 1.0) {
    locationNote = `\nLOCATION: Price is ${distToResistanceATR.toFixed(1)} ATR from resistance.`;
  }

  const userPrompt = `
=== DAILY CONTEXT (last 5 daily closes, oldest → newest) ===
[${(pricesDaily || []).map(p => p.toFixed(5)).join(', ')}]
${ema200Line}

=== 30-MINUTE STRUCTURE (closes, oldest → newest) ===
[${(prices30m || []).map(p => p.toFixed(5)).join(', ')}]

SWING POINTS (from 30m bars, last 24 hours):
${swingAnalysis}
Structure: ${structureLabel || 'UNKNOWN'}
Market Regime: ${marketRegime || 'UNKNOWN'}

EMA50 (30m): ${ema50.toFixed(5)} — momentum is ${emaTrendDesc} (${slopeStrength}, magnitude: ${slopeMagnitude.toFixed(2)})
Price vs EMA50: ${priceVsEma50}

=== 5-MINUTE TIMING (last 15 closes, oldest → newest) ===
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

CURRENT PRICE: ${currentPrice.toFixed(5)}
Session: ${currentSession || 'UNKNOWN'}
Position in previous session range: ${positionPct}% (0%=prior session low, 100%=prior session high)
Position in S/R range: ${positionInSR}% (0%=at support, 100%=at resistance)
S/R range width: ${rangeSizePips} pips (${rangeWidthATR}x ATR_5m)

KEY LEVELS (from previous session):
- Support: ${support.toFixed(5)} — ${supportDesc}
- Resistance: ${resistance.toFixed(5)} — ${resistanceDesc}
- Previous Session High: ${sessionHigh.toFixed(5)}
- Previous Session Low: ${sessionLow.toFixed(5)}
- Recent Swing High: ${swingHigh.toFixed(5)}
- Recent Swing Low: ${swingLow.toFixed(5)}
${prevDayContext}${locationNote}
Analyze this market top-down. You MUST choose BULLISH or BEARISH.`;

  const text = await complete({
    systemPrompt: DIRECTION_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { analyzeDirection };
