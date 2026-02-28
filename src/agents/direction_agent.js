/**
 * DIRECTION AGENT - Iter11
 *
 * Multi-timeframe market structure analyst.
 * Receives daily, 30m, and 5m data to determine direction top-down.
 *
 * Iter9: Gets full multi-TF context instead of just 15 five-minute closes.
 * Iter11: Fix RANGE trading — remove NEUTRAL-forcing rules, add regime-specific
 *         confluence logic, add S/R position data.
 */

const { complete } = require("./ai_client");

const DIRECTION_PROMPT = `You are an expert forex trader analyzing EUR/USD to decide whether to go LONG (buy) or SHORT (sell) right now.

You will receive market data across three timeframes: DAILY, 30-MINUTE, and 5-MINUTE. Your job is to analyze them TOP-DOWN (big picture first, then zoom in) and determine the most probable short-term direction.

HOW TO ANALYZE - TOP DOWN:

STEP 1: DAILY CONTEXT (the big picture)
Look at the last 5 daily closing prices. Ask:
- Are daily closes trending up, down, or sideways?
- Is price above or below the 200-period moving average (EMA200)? Above = bullish environment, below = bearish environment. If EMA200 is not available, skip this check.
- This tells you the WIND DIRECTION. Trading with the daily trend is easier than against it.

STEP 2: 30-MINUTE STRUCTURE (the swing picture)
Look at the 30-minute closes and the SWING POINTS. You will receive:
- The two most recent swing highs (previous and latest) and two most recent swing lows (previous and latest)
- A pre-computed comparison telling you if it's HH/LH and HL/LL
- The STRUCTURE LABEL (UPTREND / DOWNTREND / RANGE) derived from these swings

Use the swing points to confirm the structure:
- HIGHER HIGHS + HIGHER LOWS = Uptrend structure → favor LONG
- LOWER HIGHS + LOWER LOWS = Downtrend structure → favor SHORT

You also receive:
- MARKET REGIME: TREND (structure + EMA alignment confirmed), RANGE (no clear trend), or EXPANSION (volatility spike / breakout in progress — be cautious, moves can be sharp and reverse)
- EMA50 MOMENTUM: Described as RISING/FALLING/FLAT with strength (strong/moderate/weak). This measures how fast the 30m moving average is changing. Strong = clear momentum. Weak = indecisive momentum.

STEP 3: 5-MINUTE TIMING (the entry picture)
Look at the last 15 five-minute closes. Ask:
- What is price doing RIGHT NOW relative to the bigger structure?
- Is it pulling back in an uptrend (good long entry)?
- Is it rallying in a downtrend (good short entry)?

You also receive:
- SUPPORT and RESISTANCE levels (from the previous trading session). Distance shown in ATR units. If distance is NEGATIVE, it means price has BROKEN THROUGH that level (e.g., "support -0.8 ATR" means price is 0.8 ATR below support — support has been broken).
- PREVIOUS SESSION HIGH/LOW: The high and low from the prior trading session (not today's). Useful as reference levels.
- Position in previous session range: Where current price sits relative to the prior session's high/low (0% = at prior session low, 100% = at prior session high, can be outside 0-100%).
- Position in S/R range: Where current price sits relative to support/resistance (0% = at support, 100% = at resistance). This is critical in RANGE regimes.

STEP 4: CONFLUENCE - REGIME-SPECIFIC RULES

=== If MARKET REGIME is TREND ===
Count how many timeframes agree:
- ALL THREE agree (daily trend + 30m structure + 5m timing) = STRONG signal → trade it
- TWO agree, one unclear = MODERATE signal → trade it
- Only output NEUTRAL if the direction truly contradicts on ALL timeframes

=== If MARKET REGIME is RANGE ===
In a range, your POSITION relative to support/resistance determines the direction:
- Near SUPPORT (bottom 30% of S/R range): favor LONG — mean reversion from range floor
- Near RESISTANCE (top 70%+ of S/R range): favor SHORT — mean reversion from range ceiling
- Middle of range (30-70%): use the daily trend and EMA momentum as tiebreaker. If daily is up or EMA rising, lean LONG. If daily is down or EMA falling, lean SHORT. Only go NEUTRAL if everything is truly flat and contradictory.
- Below support (broken): if EMA momentum confirms the break (falling), SHORT. If EMA is flat/rising, LONG (false break bounce).
- Above resistance (broken): if EMA momentum confirms the break (rising), LONG. If EMA is flat/falling, SHORT (false break fade).

=== If MARKET REGIME is EXPANSION ===
Be careful — sharp moves can reverse. Only trade if the direction is very clear across all timeframes.

CRITICAL RULE: You MUST output BULLISH or BEARISH. Only output NEUTRAL as an absolute last resort when you genuinely cannot determine any directional lean. In a RANGE, your position relative to support/resistance always gives you a lean. In a TREND, the trend direction gives you a lean.

ADDITIONAL RULES:
- If the market is in a TREND, trade WITH the trend. Do not try to pick tops or bottoms.
- The session matters: LONDON and NY have the most volume and cleanest moves. ASIA is often choppy and range-bound.

OUTPUT FORMAT (JSON):
{
  "market_readability": "CLEAR | MODERATE | MESSY",
  "primary_bias": "BULLISH | BEARISH | NEUTRAL",
  "analysis": {
    "daily_trend": "UP | DOWN | SIDEWAYS - one sentence why",
    "structure_30m": "UPTREND | DOWNTREND | RANGE - what swings show",
    "timing_5m": "What is price doing right now relative to the structure",
    "confluence": "How many timeframes agree and what they say"
  },
  "trade_idea": "Specific trade idea with entry direction and key level",
  "invalidation": "What would prove this analysis wrong",
  "signal_clarity": "HIGH | MEDIUM | LOW"
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
}) {

  // Calculate price position in previous session range
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Calculate price position in S/R range (critical for RANGE regime decisions)
  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

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
    ? `EMA200 (30m): ${ema200.toFixed(5)} — price is ${priceVsEma200}`
    : "EMA200: not available (insufficient history)";

  // Location warning — explicit alert when price is near key levels
  let locationWarning = "";
  if (distToSupportATR >= 0 && distToSupportATR < 1.0) {
    locationWarning = `\n⚠ LOCATION: Price is NEAR SUPPORT (${distToSupportATR.toFixed(1)} ATR away). In a RANGE, this favors LONG. Only SHORT here if there is a confirmed breakdown with strong momentum.`;
  } else if (distToSupportATR < 0) {
    locationWarning = `\n⚠ LOCATION: Price has BROKEN BELOW support by ${Math.abs(distToSupportATR).toFixed(1)} ATR. This could be a breakdown (bearish) OR a false break that reverses (bullish). Check if momentum confirms the break.`;
  } else if (distToResistanceATR >= 0 && distToResistanceATR < 1.0) {
    locationWarning = `\n⚠ LOCATION: Price is NEAR RESISTANCE (${distToResistanceATR.toFixed(1)} ATR away). In a RANGE, this favors SHORT. Only LONG here if there is a confirmed breakout with strong momentum.`;
  } else if (distToResistanceATR < 0) {
    locationWarning = `\n⚠ LOCATION: Price has BROKEN ABOVE resistance by ${Math.abs(distToResistanceATR).toFixed(1)} ATR. This could be a breakout (bullish) OR a false break that reverses (bearish). Check if momentum confirms the break.`;
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

EMA50 (30m): ${ema50.toFixed(5)} — momentum is ${emaTrendDesc} (${slopeStrength})
Price vs EMA50: ${priceVsEma50}

=== 5-MINUTE TIMING (last 15 closes, oldest → newest) ===
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

CURRENT PRICE: ${currentPrice.toFixed(5)}
Session: ${currentSession || 'UNKNOWN'}
Position in previous session range: ${positionPct}% (0%=prior session low, 100%=prior session high)
Position in S/R range: ${positionInSR}% (0%=at support, 100%=at resistance)

KEY LEVELS (from previous session):
- Support: ${support.toFixed(5)} — ${supportDesc}
- Resistance: ${resistance.toFixed(5)} — ${resistanceDesc}
- Previous Session High: ${sessionHigh.toFixed(5)}
- Previous Session Low: ${sessionLow.toFixed(5)}
- Recent Swing High: ${swingHigh.toFixed(5)}
- Recent Swing Low: ${swingLow.toFixed(5)}
${locationWarning}
Analyze this market top-down. What direction is most probable?`;

  const text = await complete({
    systemPrompt: DIRECTION_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { analyzeDirection };
