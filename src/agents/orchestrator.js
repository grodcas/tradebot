/**
 * TRADE ORCHESTRATOR - Iter9
 *
 * Coordinates:
 * 1. Direction Agent → Determines market bias (multi-timeframe)
 * 2. Confidence Agent → Confirms or rejects the direction call
 *
 * Levels are MECHANICAL (no AI):
 * - SL = 1.5 × ATR_30m from current price
 * - TP = 1.5:1 R:R (= 2.25 × ATR_30m from current price)
 * - Risk = fixed 0.50
 */

const { analyzeDirection } = require('./direction_agent');
const { assessConfidence } = require('./confidence_agent');

// Mechanical level constants
const SL_ATR_MULTIPLIER = 1.5;   // SL distance = 1.5 × ATR_30m
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
}) {

  const startTime = Date.now();
  const agentOutputs = {};

  // ========== STEP 1: DIRECTION AGENT (multi-timeframe) ==========
  console.log('   [DIRECTION] Analyzing market structure (multi-TF)...');
  const directionResult = await analyzeDirection({
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
  });
  agentOutputs.direction = directionResult;

  const proposedDirection = directionResult.primary_bias === 'BULLISH' ? 'LONG' :
                           directionResult.primary_bias === 'BEARISH' ? 'SHORT' : null;

  console.log(`   [DIRECTION] ${directionResult.primary_bias} (${directionResult.signal_clarity || 'N/A'} clarity)`);
  console.log(`   [DIRECTION] Readability: ${directionResult.market_readability || 'N/A'}`);
  console.log(`   [DIRECTION] ${directionResult.trade_idea?.slice(0, 100)}`);

  // If no clear direction, SKIP this bar (don't force a trade)
  if (!proposedDirection) {
    console.log('   [DIRECTION] No clear direction → SKIP');
    return {
      action: 'SKIP',
      reason: `Direction unclear: ${directionResult.primary_bias}`,
      agentOutputs,
      timeMs: Date.now() - startTime
    };
  }

  // ========== STEP 2: CONFIDENCE AGENT (confirm/reject) ==========
  console.log('   [CONFIDENCE] Confirming direction...');

  const confidenceResult = await assessConfidence({
    proposedDirection,
    directionAnalysis: directionResult,
    currentPrice,
    support,
    resistance,
    ema50,
    emaSlope,
    atr: atr5m,
    swingHigh,
    swingLow,
    sessionHigh,
    sessionLow,
    prices5m,
    marketRegime,
    structureState,
    structureLabel,
  });
  agentOutputs.confidence = confidenceResult;

  console.log(`   [CONFIDENCE] Verdict: ${confidenceResult.verdict} | ${confidenceResult.reasoning?.slice(0, 80)}`);

  // Confidence agent acts as gate: CONFIRM or REJECT
  if (confidenceResult.verdict === 'REJECT') {
    console.log(`   [CONFIDENCE] Trade REJECTED: ${confidenceResult.reasoning}`);
    return {
      action: 'SKIP',
      reason: `Confidence rejected: ${confidenceResult.reasoning}`,
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

  console.log(`   [LEVELS] MECHANICAL: Entry=${entry.toFixed(5)} SL=${sl.toFixed(5)} TP=${tp.toFixed(5)} | RR=${rr.toFixed(1)}:1 | Risk=${FIXED_RISK}`);
  console.log(`   [LEVELS] SL=${(slDistance * 10000).toFixed(1)}pips TP=${(tpDistance * 10000).toFixed(1)}pips (ATR_30m=${(atr30m * 10000).toFixed(1)}pips)`);

  return {
    action: 'TRADE',
    side: proposedDirection,
    entry,
    sl,
    tp,
    risk: FIXED_RISK,
    riskReward: rr,
    reasoning: {
      direction: directionResult.trade_idea,
      confidence: confidenceResult.reasoning,
    },
    agentOutputs,
    timeMs: Date.now() - startTime
  };
}

module.exports = { orchestrateTrade };
