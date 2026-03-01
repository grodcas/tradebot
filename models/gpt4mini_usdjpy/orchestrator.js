/**
 * TRADE ORCHESTRATOR
 *
 * Coordinates the specialist agents:
 * 1. Direction Agent → Determines market bias
 * 2. Confidence Agent → Assesses probability
 * 3. Levels Agent → Sets Entry, SL, TP
 *
 * Final decision combines all inputs.
 */

const { analyzeDirection } = require('./direction_agent');
const { assessConfidence } = require('./confidence_agent');
const { determineLevels } = require('./levels_agent');

/**
 * Main orchestration function
 */
async function orchestrateTrade({
  prices5m,
  ema50,
  emaSlope,
  support,
  resistance,
  swingHigh,
  swingLow,
  sessionHigh,
  sessionLow,
  currentPrice,
  atr,
  // Structure and regime info (CRITICAL for risk assessment)
  marketRegime = 'UNKNOWN',
  structureState = 0,
  structureLabel = 'UNKNOWN',
  breakoutScore = 0,
  sweepScore = 0,
  pullbackRatio = 0
}) {

  const startTime = Date.now();
  const agentOutputs = {};

  // ========== STEP 1: DIRECTION AGENT ==========
  console.log('   [DIRECTION] Analyzing market structure...');
  const directionResult = await analyzeDirection({
    prices5m,
    ema50,
    emaSlope,
    support,
    resistance,
    swingHigh,
    swingLow,
    sessionHigh,
    sessionLow,
    currentPrice,
    // Pass structure info so agent can verify
    computedStructureState: structureState,
    computedStructureLabel: structureLabel,
    marketRegime,
    pullbackRatio
  });
  agentOutputs.direction = directionResult;

  const proposedDirection = directionResult.primary_bias === 'BULLISH' ? 'LONG' :
                           directionResult.primary_bias === 'BEARISH' ? 'SHORT' : null;

  console.log(`   [DIRECTION] ${directionResult.primary_bias} (${directionResult.confidence})`);
  console.log(`   [DIRECTION] ${directionResult.trade_idea?.slice(0, 80)}...`);

  // If direction is unclear, we might still trade but with lower confidence
  if (!proposedDirection) {
    console.log('   [DIRECTION] No clear direction - will assess both sides');
  }

  // ========== STEP 2: CONFIDENCE AGENT ==========
  console.log('   [CONFIDENCE] Assessing setup quality...');

  // If neutral, assess LONG (default slight bias)
  const directionToAssess = proposedDirection || 'LONG';

  const confidenceResult = await assessConfidence({
    proposedDirection: directionToAssess,
    directionAnalysis: directionResult,
    currentPrice,
    support,
    resistance,
    ema50,
    emaSlope,
    atr,
    swingHigh,
    swingLow,
    sessionHigh,
    sessionLow,
    prices5m,
    // CRITICAL: Pass structure info for risk assessment
    marketRegime,
    structureState,
    structureLabel,
    breakoutScore,
    sweepScore,
    pullbackRatio
  });
  agentOutputs.confidence = confidenceResult;

  console.log(`   [CONFIDENCE] Probability: ${(confidenceResult.probability * 100).toFixed(0)}%`);
  console.log(`   [CONFIDENCE] ${confidenceResult.for_proposed_direction?.assessment}: ${confidenceResult.for_proposed_direction?.recommendation?.slice(0, 60)}...`);

  // ========== STEP 3: LEVELS AGENT ==========
  // NEW APPROACH: Take ALL trades, use confidence for position sizing
  // No skipping - every trade gets executed with appropriate risk

  console.log('   [LEVELS] Determining entry, SL, TP...');
  const levelsResult = await determineLevels({
    direction: directionToAssess,
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
  });
  agentOutputs.levels = levelsResult;

  console.log(`   [LEVELS] Entry: ${levelsResult.entry?.price?.toFixed(5)} (${levelsResult.entry?.type})`);
  console.log(`   [LEVELS] SL: ${levelsResult.stop_loss?.price?.toFixed(5)} | TP: ${levelsResult.take_profit?.price?.toFixed(5)} | RR: ${levelsResult.risk_reward?.toFixed(2)}`);

  // ========== FINAL DECISION ==========
  // Convert confidence to position size using full range
  // Confidence 0.0-1.0 maps to position size 0.10-1.0
  // Low confidence = small position, high confidence = full position
  const positionSize = 0.10 + (confidenceResult.probability * 0.90);

  // Validate levels
  const entry = levelsResult.entry?.price;
  const sl = levelsResult.stop_loss?.price;
  const tp = levelsResult.take_profit?.price;

  if (!entry || !sl || !tp) {
    return {
      action: 'SKIP',
      reason: 'Invalid levels from Levels Agent',
      agentOutputs,
      timeMs: Date.now() - startTime
    };
  }

  // Sanity check levels
  if (directionToAssess === 'LONG') {
    if (tp <= entry || sl >= entry) {
      return {
        action: 'SKIP',
        reason: 'Invalid LONG levels: TP must be > entry, SL must be < entry',
        agentOutputs,
        timeMs: Date.now() - startTime
      };
    }
  } else {
    if (tp >= entry || sl <= entry) {
      return {
        action: 'SKIP',
        reason: 'Invalid SHORT levels: TP must be < entry, SL must be > entry',
        agentOutputs,
        timeMs: Date.now() - startTime
      };
    }
  }

  return {
    action: 'TRADE',
    side: directionToAssess,
    entry,
    sl,
    tp,
    risk: positionSize,  // Full range 0.10-1.0 based on confidence
    riskReward: levelsResult.risk_reward,
    reasoning: {
      direction: directionResult.trade_idea,
      confidence: confidenceResult.reasoning,
      levels: levelsResult.assessment
    },
    agentOutputs,
    timeMs: Date.now() - startTime
  };
}

module.exports = { orchestrateTrade };
