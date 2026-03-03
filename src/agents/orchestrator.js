/**
 * TRADE ORCHESTRATOR - Iter29 (Two-Agent Architecture)
 *
 * 1. Market Reader → honest market assessment (no direction)
 * 2. Trade Executor → directional decision from reader's assessment
 * 3. Mechanical Filter A: no SHORT below support (pos < 0%)
 * 4. Mechanical Filter B: no SHORT into higher highs (HH diff > 1 pip)
 * 5. Mechanical Filter C: no SHORT in TREND+DOWNTREND (14-27% WR, mechanical mismatch)
 * 6. Mechanical levels (no AI)
 *
 * Levels:
 * - SL = 1.2 × ATR_30m
 * - TP = 1.5:1 R:R
 * - Risk = fixed 0.50
 */

const { readMarket } = require('./market_reader');
const { executeTrade } = require('./trade_executor');

// Mechanical level constants
const SL_ATR_MULTIPLIER = 1.2;   // SL distance = 1.2 × ATR_30m
const RR_RATIO = 1.5;            // R:R = 1.5:1
const FIXED_RISK = 0.50;         // Fixed position size

/**
 * Main orchestration function
 */
async function orchestrateTrade({
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
  atr30m,
  // Multi-timeframe context
  currentSession = null,
  marketRegime = null,
  structureState = null,
  structureLabel = null,
  structureSwings = {},
  prevDayHigh = null,
  prevDayLow = null,
  // Wait mechanism
  mustTrade = false,
  waitCount = 0,
}) {

  const startTime = Date.now();
  const agentOutputs = {};

  // ========== STEP 1: MARKET READER (pure analysis, no direction) ==========
  const readerResult = await readMarket({
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
    prevDayHigh,
    prevDayLow,
  });
  agentOutputs.reader = readerResult;

  const readerAlign = readerResult.ema_alignment?.split(' —')[0] || '?';
  console.log(`   [READER] ${readerResult.scenario || '?'} | ${readerResult.scenario_quality || '?'} | ${readerAlign} | FBR:${readerResult.false_break_risk || 'N/A'}`);

  // ========== STEP 2: TRADE EXECUTOR (direction decision from reader) ==========

  // Compute location note for executor (same logic as reader, but passed as pre-computed string)
  const distToSupport = currentPrice - support;
  const distToSupportATR = distToSupport / atr5m;
  const distToResistance = resistance - currentPrice;
  const distToResistanceATR = distToResistance / atr5m;
  let locationNote = "";
  const outsideSR = distToSupportATR < 0 || distToResistanceATR < 0;
  if (outsideSR) {
    const withinDayRange = prevDayHigh != null && prevDayLow != null &&
      currentPrice >= prevDayLow && currentPrice <= prevDayHigh;
    if (distToSupportATR < 0) {
      locationNote = `LOCATION: Price is ${Math.abs(distToSupportATR).toFixed(1)} ATR below session support (level broken).`;
      if (withinDayRange) locationNote += ` But still INSIDE previous day's range — potential false break.`;
    } else {
      locationNote = `LOCATION: Price is ${Math.abs(distToResistanceATR).toFixed(1)} ATR above session resistance (level broken).`;
      if (withinDayRange) locationNote += ` But still INSIDE previous day's range — potential false break.`;
    }
  } else if (distToSupportATR >= 0 && distToSupportATR < 1.0) {
    locationNote = `LOCATION: Price is ${distToSupportATR.toFixed(1)} ATR from support.`;
  } else if (distToResistanceATR >= 0 && distToResistanceATR < 1.0) {
    locationNote = `LOCATION: Price is ${distToResistanceATR.toFixed(1)} ATR from resistance.`;
  }

  // Compute position in S/R
  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

  // Compute swing combo for executor
  let swingCombo = "";
  if (structureSwings?.SH0 && structureSwings?.SH1 && structureSwings?.SL0 && structureSwings?.SL1) {
    const hh = structureSwings.SH1.price > structureSwings.SH0.price ? "HH" : structureSwings.SH1.price < structureSwings.SH0.price ? "LH" : "EQ";
    const hl = structureSwings.SL1.price > structureSwings.SL0.price ? "HL" : structureSwings.SL1.price < structureSwings.SL0.price ? "LL" : "EQ";
    swingCombo = `${hh}+${hl}`;
  }

  // Compute EMA vs Structure alignment for executor
  let emaVsStructure = "N/A";
  if (ema200) {
    const emaBias = ema50 > ema200 ? "BULLISH" : "BEARISH";
    const structDir = (structureLabel || "").toUpperCase();
    if (structDir.includes("UPTREND")) {
      emaVsStructure = emaBias === "BULLISH" ? "ALIGNED" : "CONFLICTING";
    } else if (structDir.includes("DOWNTREND")) {
      emaVsStructure = emaBias === "BEARISH" ? "ALIGNED" : "CONFLICTING";
    } else {
      emaVsStructure = `RANGE — EMA bias ${emaBias}`;
    }
  }

  const executorResult = await executeTrade({
    readerAssessment: readerResult,
    currentPrice,
    currentSession,
    marketRegime,
    structureLabel,
    positionInSR,
    ema50,
    ema200,
    emaSlope,
    support,
    resistance,
    atr5m,
    prevDayHigh,
    prevDayLow,
    locationNote,
    swingCombo,
    emaVsStructure,
    mustTrade,
    waitCount,
  });
  // Store as "direction" for backward compatibility with analysis scripts
  agentOutputs.direction = executorResult;

  let proposedDirection = executorResult.primary_bias === 'BULLISH' ? 'LONG' :
                         executorResult.primary_bias === 'BEARISH' ? 'SHORT' : null;

  console.log(`   [EXECUTOR] ${executorResult.primary_bias} | Edge:${executorResult.edge_pattern || 'NONE'} | Conv:${executorResult.conviction || '?'}`);

  // If no clear direction (NEUTRAL), SKIP this bar — unless mustTrade
  if (!proposedDirection) {
    if (mustTrade) {
      // Force a direction based on reader's assessment when executor refuses on final try
      // Use position in S/R as tiebreaker: below 50% → LONG, above 50% → SHORT
      const forcedDirection = Number(positionInSR) < 50 ? 'LONG' : 'SHORT';
      console.log(`   [EXECUTOR] NEUTRAL on final try — forcing ${forcedDirection} (pos=${positionInSR}%)`);
      proposedDirection = forcedDirection;
      executorResult.primary_bias = forcedDirection === 'LONG' ? 'BULLISH' : 'BEARISH';
      executorResult.conviction = 'LOW';
      executorResult.trade_idea = `Forced ${forcedDirection}: executor refused to commit, using position-based fallback (pos=${positionInSR}%)`;
    } else {
      console.log('   [EXECUTOR] No clear direction → WAIT');
      return {
        action: 'SKIP',
        reason: `Direction unclear: ${executorResult.primary_bias}`,
        agentOutputs,
        timeMs: Date.now() - startTime
      };
    }
  }

  // ========== MECHANICAL FILTER A: No SHORT below support ==========
  // 80-trade analysis: SHORT when pos < 0% = 20% WR (2W 8L).
  // Price below session support is a false-break zone. Shorting chases
  // breakdowns that almost always reverse.
  if (proposedDirection === 'SHORT') {
    const posInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100) : 50;
    if (posInSR < 0) {
      console.log(`   [FILTER] SHORT blocked: price below support (pos=${posInSR.toFixed(0)}%) → SKIP`);
      return {
        action: 'SKIP',
        reason: `Mechanical filter: SHORT below support (pos=${posInSR.toFixed(0)}%)`,
        agentOutputs,
        timeMs: Date.now() - startTime
      };
    }
  }

  // ========== MECHANICAL FILTER B: No SHORT into higher highs ==========
  // 25-trade swing analysis: SHORT when swing highs are making higher highs
  // (HH diff > 0) = 0% WR (0W 9L). Higher highs = bullish structure,
  // shorting against it gets run over every time.
  if (proposedDirection === 'SHORT' && structureSwings && structureSwings.SH1 && structureSwings.SH0) {
    const hhDiff = (structureSwings.SH1.price - structureSwings.SH0.price) * 10000; // in pips
    if (hhDiff > 1) {
      console.log(`   [FILTER] SHORT blocked: swing highs making HIGHER HIGH (HH diff: +${hhDiff.toFixed(1)} pips) → SKIP`);
      return {
        action: 'SKIP',
        reason: `Mechanical filter: SHORT into higher highs (HH diff=+${hhDiff.toFixed(1)}pips)`,
        agentOutputs,
        timeMs: Date.now() - startTime
      };
    }
  }

  // ========== MECHANICAL FILTER C: No SHORT in TREND+DOWNTREND ==========
  // 50+ trade evidence across Iter26-30: TREND+DOWNTREND SHORT = 14-27% WR.
  // The AI correctly identifies the downtrend and correctly goes SHORT, but
  // market order entry enters near the bottom of an already-extended move.
  // The 1.2x ATR stop gets hit by the inevitable bounce. This is a mechanical
  // mismatch, not an AI error — no prompt can fix it.
  // In live trading, a skip means "retry in 5 minutes" — by then the setup
  // may shift to RANGE+DOWNTREND (Pattern B, 58% WR) or offer better entry.
  if (proposedDirection === 'SHORT' && marketRegime === 'TREND' &&
      structureLabel && structureLabel.toUpperCase().includes('DOWNTREND')) {
    console.log(`   [FILTER] SHORT blocked: TREND+DOWNTREND (mechanical mismatch — market order can't catch exhausted trends) → SKIP`);
    return {
      action: 'SKIP',
      reason: `Mechanical filter: SHORT in TREND+DOWNTREND (14-27% WR across 50+ trades)`,
      agentOutputs,
      timeMs: Date.now() - startTime
    };
  }

  // ========== STEP 3: MECHANICAL LEVELS ==========
  const slDistance = atr30m * SL_ATR_MULTIPLIER;
  const tpDistance = slDistance * RR_RATIO;

  let entry, sl, tp;
  if (proposedDirection === 'LONG') {
    entry = currentPrice;
    sl = currentPrice - slDistance;
    tp = currentPrice + tpDistance;
  } else {
    entry = currentPrice;
    sl = currentPrice + slDistance;
    tp = currentPrice - tpDistance;
  }

  // Round to 5 decimal places
  entry = Math.round(entry * 100000) / 100000;
  sl = Math.round(sl * 100000) / 100000;
  tp = Math.round(tp * 100000) / 100000;

  const rr = tpDistance / slDistance;

  console.log(`   [LEVELS] ${proposedDirection} Entry=${entry.toFixed(5)} SL=${(slDistance * 10000).toFixed(1)}p TP=${(tpDistance * 10000).toFixed(1)}p RR=${rr.toFixed(1)}:1`);

  return {
    action: 'TRADE',
    side: proposedDirection,
    entry,
    sl,
    tp,
    risk: FIXED_RISK,
    riskReward: rr,
    reasoning: executorResult.trade_idea,
    agentOutputs,
    timeMs: Date.now() - startTime
  };
}

module.exports = { orchestrateTrade };
