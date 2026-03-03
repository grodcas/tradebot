/**
 * MARKET READER AGENT - Iter30
 *
 * Pure market analyst. Describes what the market is doing honestly.
 * Does NOT output a trade direction. No bias, no decision.
 *
 * Iter30 fixes from Run 3 analysis:
 * - Fix 1: Alignment logic (DOWNTREND+bullish EMAs = CONFLICTING, not ALIGNED)
 * - Fix 3: Regime respect (trust indicator labels, don't reclassify)
 * - New: pre-computed EMA_VS_STRUCTURE field
 *
 * Output: Structured JSON assessment consumed by the Trade Executor.
 */

const { complete } = require("./ai_client");

const MARKET_READER_PROMPT = `You are an expert forex market analyst studying EUR/USD. Your job: provide an honest, complete assessment of current market conditions. You do NOT make trade recommendations or suggest a direction. You describe what you observe.

You receive data across three timeframes: DAILY, 30-MINUTE, and 5-MINUTE. Analyze top-down.

=== UNDERSTANDING YOUR INPUTS ===

DAILY CLOSES: The macro trend over the past week. Rising = bullish environment, falling = bearish, flat = neutral. EMA200 reinforces this: price above = bullish bias, below = bearish. The further from EMA200, the stronger the trend.

PREVIOUS DAY HIGH/LOW: The full prior trading day's price range. This is a broader, more significant reference than session-only levels. When price is between the previous day's high and low, it is still within "normal" territory. When price breaks beyond these levels, it indicates genuine directional conviction. Use these levels as a reality check on session S/R.

30-MINUTE SWING STRUCTURE: Swing points reveal who controls the market:
- Higher Highs + Higher Lows = buyers in control (uptrend)
- Lower Highs + Lower Lows = sellers in control (downtrend)
- Mixed = no clear control (range or transition)
The STRUCTURE LABEL and MARKET REGIME are pre-computed from rigorous technical analysis. Trust these labels — do NOT reclassify the regime yourself. Use swing data to DESCRIBE characteristics (freshness, magnitude), not to override the classification.

EMA50 MOMENTUM (30m): Speed and direction of the medium-term moving average. Strong = decisive pressure. Weak/flat = indecision. This tells you WHO has momentum and how confidently.

EMA50 vs EMA200: Shows the daily-timeframe bias.
- EMA50 > EMA200 = daily bias is BULLISH
- EMA50 < EMA200 = daily bias is BEARISH

A pre-computed EMA_VS_STRUCTURE field is provided in the data. It tells you whether the daily EMA bias MATCHES the 30m swing structure:
- UPTREND structure + bullish EMAs = ALIGNED
- DOWNTREND structure + bearish EMAs = ALIGNED
- DOWNTREND structure + bullish EMAs = CONFLICTING (structure is bearish, daily is bullish — opposing signals)
- UPTREND structure + bearish EMAs = CONFLICTING (structure is bullish, daily is bearish — opposing signals)
- RANGE structure: alignment is N/A, report EMA direction as context

CRITICAL: DOWNTREND structure with bullish EMAs is CONFLICTING, not ALIGNED. The swing structure is making lower highs and lower lows even though price is above the daily moving averages. Do NOT call this "aligned" or "both bullish."

SWING MAGNITUDE: Swing diffs in pips show how far each swing moved. Swing range (SH1 to SL1) shows the distance between the latest high and low.
- Small diffs (< 10 pips) = gentle, fresh moves with room to continue
- Moderate diffs (10-15 pips) = developing moves, still have potential
- Large diffs (> 15 pips per swing) = aggressive moves that have already traveled far
- Wide swing ranges (> 25 pips) = extended, volatile structures

SUPPORT & RESISTANCE (SESSION-BASED): Key price boundaries from the previous trading session. These levels are useful but NOT absolute — they represent one session's range, not the market's true boundaries. Distance in ATR units tells proximity. Negative distance means the level has been broken through.

POSITION IN S/R RANGE: Where price sits between support (0%) and resistance (100%). Values below 0% or above 100% mean price has moved BEYOND session S/R.

5-MINUTE CLOSES: The micro picture — what is price doing RIGHT NOW? Pulling back? Accelerating? Stalling? Reversing?

SESSION: LONDON and NY have best liquidity and directional moves. LONDON typically creates the day's main move. NY inherits what LONDON started — by NY, moves that look fresh may actually be near exhaustion.

=== HOW TO ANALYZE ===

1. USE THE PROVIDED REGIME AND STRUCTURE. The MARKET REGIME and STRUCTURE LABEL are pre-computed from rigorous technical analysis. Your scenario output MUST start with the provided regime (TREND, RANGE, or EXPANSION) followed by the structure direction.
   - TREND: Assess freshness — is the trend fresh (moderate diffs, contained range) or extended (large diffs, wide range)?
   - RANGE: Note where price sits relative to S/R boundaries.
   - EXPANSION: High volatility and uncertainty.
   Do NOT reclassify the regime. If you see bearish swings in a RANGE, it is still RANGE+DOWNTREND, not TREND+DOWNTREND.

2. ASSESS MOVE FRESHNESS. This is critical.
   - Look at swing diffs in pips: how far has each swing traveled?
   - Look at swing range: how wide is the structure?
   - A fresh trend with small diffs and tight range has room to continue.
   - An extended trend with large diffs (>15 pips) and wide range (>25 pips) may be near exhaustion.
   - For ranges: freshness matters less — focus on position relative to boundaries.

3. CHECK ALIGNMENT across timeframes.
   - Use the pre-computed EMA_VS_STRUCTURE field. ALIGNED means structure direction matches EMA direction (both bullish or both bearish). CONFLICTING means they oppose.
   - Your ema_alignment output MUST match the EMA_VS_STRUCTURE field. Do not override it.
   - 5m price action: confirming the 30m view or showing divergence/reversal?

4. IDENTIFY FALSE BREAK RISK. When price is OUTSIDE session S/R but still INSIDE previous day's range, this is a classic false break setup. The session level was broken, but the broader range was not.

5. NOTE SESSION CONTEXT. What session are we in? If NY, has the move been running since LONDON? How much of the day's range has already been captured?

OUTPUT FORMAT (JSON):
{
  "scenario": "REGIME+STRUCTURE (e.g., TREND+DOWNTREND, RANGE+RANGE)",
  "scenario_quality": "FRESH | MATURE | EXHAUSTED",
  "move_description": "One sentence: what the market is doing right now",
  "structure_assessment": "What the swing structure shows — direction, strength, and how far it has traveled",
  "ema_alignment": "ALIGNED | CONFLICTING — with brief explanation of daily vs 30m relationship",
  "position_assessment": "Where price sits relative to S/R and what that means",
  "false_break_risk": "YES | NO — explain if price is beyond S/R but inside daily range",
  "risk_factors": ["Concern 1", "Concern 2", "..."],
  "favorable_factors": ["Positive 1", "Positive 2", "..."],
  "session_context": "What the current session means for this setup"
}

IMPORTANT: Be honest. If the move looks exhausted, say so. If there are conflicts, state them clearly. Your assessment will be used by a trade decision agent — accuracy matters more than having a view.`;


async function readMarket({
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

  // S/R range width
  const rangeSizePips = (srRange * 10000).toFixed(0);
  const rangeWidthATR = atr5m > 0 ? (srRange / atr5m).toFixed(1) : "N/A";

  // EMA context
  const priceVsEma50 = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const priceVsEma200 = ema200 ? (currentPrice > ema200 ? "ABOVE" : currentPrice < ema200 ? "BELOW" : "AT") : null;

  // EMA slope description
  const emaTrendDesc = emaSlope > 0.05 ? "RISING" : emaSlope < -0.05 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "strong" : slopeMagnitude > 0.10 ? "moderate" : "weak";

  // Structure swing points
  const sh0Price = structureSwings?.SH0?.price;
  const sh1Price = structureSwings?.SH1?.price;
  const sl0Price = structureSwings?.SL0?.price;
  const sl1Price = structureSwings?.SL1?.price;

  // Swing analysis with magnitude
  let swingAnalysis = "";
  let swingDiffs = "";
  if (sh0Price && sh1Price && sl0Price && sl1Price) {
    const hhOrLh = sh1Price > sh0Price ? "HIGHER HIGH (HH)" : sh1Price < sh0Price ? "LOWER HIGH (LH)" : "EQUAL HIGH";
    const hlOrLl = sl1Price > sl0Price ? "HIGHER LOW (HL)" : sl1Price < sl0Price ? "LOWER LOW (LL)" : "EQUAL LOW";
    const hhDiffPips = ((sh1Price - sh0Price) * 10000).toFixed(1);
    const llDiffPips = ((sl1Price - sl0Price) * 10000).toFixed(1);
    const swingRangePips = ((sh1Price - sl1Price) * 10000).toFixed(1);

    swingAnalysis = `Previous swing high: ${sh0Price.toFixed(5)} → Latest swing high: ${sh1Price.toFixed(5)} = ${hhOrLh}
Previous swing low: ${sl0Price.toFixed(5)} → Latest swing low: ${sl1Price.toFixed(5)} = ${hlOrLl}`;

    swingDiffs = `Swing high diff: ${hhDiffPips > 0 ? '+' : ''}${hhDiffPips} pips (${hhOrLh.split(' (')[0]})
Swing low diff: ${llDiffPips > 0 ? '+' : ''}${llDiffPips} pips (${hlOrLl.split(' (')[0]})
Swing range (SH1 to SL1): ${swingRangePips} pips`;
  } else {
    swingAnalysis = "Not enough swing points to determine structure";
  }

  // EMA alignment
  let emaAlignmentLine = "";
  if (ema200) {
    const emaAligned = ema50 > ema200 ? "ABOVE" : ema50 < ema200 ? "BELOW" : "AT";
    const alignmentDesc = emaAligned === "ABOVE" ? "bullish daily structure" : emaAligned === "BELOW" ? "bearish daily structure" : "neutral";
    emaAlignmentLine = `EMA alignment: EMA50 is ${emaAligned} EMA200 → ${alignmentDesc}`;
  } else {
    emaAlignmentLine = "EMA alignment: not available (insufficient history)";
  }

  // Pre-computed EMA vs Structure alignment (so the reader doesn't have to reason about it)
  let emaVsStructure = "N/A";
  if (ema200) {
    const emaBias = ema50 > ema200 ? "BULLISH" : "BEARISH";
    const structDir = (structureLabel || "").toUpperCase();
    if (structDir.includes("UPTREND")) {
      emaVsStructure = emaBias === "BULLISH" ? "ALIGNED (both bullish)" : "CONFLICTING (structure bullish, EMAs bearish)";
    } else if (structDir.includes("DOWNTREND")) {
      emaVsStructure = emaBias === "BEARISH" ? "ALIGNED (both bearish)" : "CONFLICTING (structure bearish, EMAs bullish)";
    } else {
      emaVsStructure = `RANGE — EMA bias is ${emaBias}`;
    }
  }

  // Support/resistance distances
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

  // Previous day context
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

  // Location note
  let locationNote = "";
  const outsideSR = distToSupportATR < 0 || distToResistanceATR < 0;
  if (outsideSR) {
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

  // Build user prompt — same data as Iter26 direction agent
  const userPrompt = `
=== DAILY CONTEXT (last 5 daily closes, oldest → newest) ===
[${(pricesDaily || []).map(p => p.toFixed(5)).join(', ')}]
${ema200Line}
${emaAlignmentLine}
EMA_VS_STRUCTURE: ${emaVsStructure}

=== 30-MINUTE STRUCTURE (closes, oldest → newest) ===
[${(prices30m || []).map(p => p.toFixed(5)).join(', ')}]

SWING POINTS (from 30m bars, last 24 hours):
${swingAnalysis}
${swingDiffs ? swingDiffs + '\n' : ''}Structure: ${structureLabel || 'UNKNOWN'}
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

Analyze this market and provide your structured assessment.`;

  const text = await complete({
    systemPrompt: MARKET_READER_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { readMarket };
