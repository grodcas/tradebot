/**
 * Strategy Selector - Direction Only
 *
 * 1. Direction Agent - Market structure expert (multi-timeframe)
 * 2. Mechanical levels (SL = 1.2 × ATR_30m, TP = 1.5:1 R:R, Risk = 0.50)
 */

const { orchestrateTrade } = require('./agents/orchestrator');

const MAX_WAIT_BARS = 2;  // bar 0, +10m, +20m = 3 bars total
const FIXED_RISK = 0.50;

function validateDecision(dec, fallbackEntry) {
  if (!dec || typeof dec !== "object") throw new Error("Decision not an object.");

  if (dec.action === 'SKIP') {
    return {
      action: 'SKIP',
      reason: dec.reason,
      risk: 0,
      side: 'LONG',
      entry: fallbackEntry,
      sl: fallbackEntry - 0.0001,
      tp: fallbackEntry + 0.0001,
      reasoning: dec.reason
    };
  }

  if (!["LONG", "SHORT"].includes(dec.side)) throw new Error("Invalid side.");

  const entry = Number(dec.entry ?? fallbackEntry);
  const tp = Number(dec.tp);
  const sl = Number(dec.sl);

  if (![entry, tp, sl].every(Number.isFinite)) throw new Error("entry/tp/sl must be numbers.");
  if (tp === sl) throw new Error("tp cannot equal sl.");

  if (dec.side === "LONG") {
    if (!(tp > entry && sl < entry)) throw new Error("LONG must have tp>entry and sl<entry.");
  } else {
    if (!(tp < entry && sl > entry)) throw new Error("SHORT must have tp<entry and sl>entry.");
  }

  const reasoning = typeof dec.reasoning === 'object'
    ? `Dir: ${dec.reasoning.direction?.slice(0, 50)} | Conf: ${dec.reasoning.confidence?.slice(0, 50)}`
    : dec.reasoning || "";

  return { side: dec.side, entry, tp, sl, risk: FIXED_RISK, reasoning, riskReward: dec.riskReward, agentOutputs: dec.agentOutputs };
}

/**
 * Main entry point - calls multi-agent orchestrator
 */
async function callStrategyTradeDecision({ context, indicators, currentBar, waitCount, mustTrade, waitHistory = [] }) {

  // Extract what the agents need
  const prices5m = context.prices_5m;
  const prices30m = context.prices_30m;
  const pricesDaily = context.prices_daily;
  const currentPrice = currentBar.close;

  // Get indicators
  const ema50 = indicators.EMA50_30m || currentPrice;
  const emaSlope = indicators.EMA50_slope_30m || 0;
  const ema200 = indicators.EMA200_30m || null;  // null if insufficient data — don't fake it
  const support = indicators.support || indicators.prevSessionLow;
  const resistance = indicators.resistance || indicators.prevSessionHigh;

  // Get most recent swing points
  const swingHighs = indicators.swingHighs || [];
  const swingLows = indicators.swingLows || [];
  const swingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : indicators.prevSessionHigh;
  const swingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : indicators.prevSessionLow;

  const sessionHigh = indicators.prevSessionHigh;
  const sessionLow = indicators.prevSessionLow;
  const atr5m = indicators.ATR_5m;
  const atr30m = indicators.ATR_30m;

  // Previous day high/low (broader context than session S/R)
  const prevDayHigh = indicators.prevDayHigh || null;
  const prevDayLow = indicators.prevDayLow || null;

  // Structure swing points for direction agent
  const structureSwings = indicators.structureSwings || {};

  // Call the multi-agent orchestrator
  const result = await orchestrateTrade({
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
    // Multi-timeframe context for direction agent
    currentSession: indicators.currentSession,
    marketRegime: indicators.marketRegime,
    structureState: indicators.structureState,
    structureLabel: indicators.structureLabel,
    structureSwings,
    prevDayHigh,
    prevDayLow,
    // Wait mechanism
    mustTrade,
    waitCount,
  });

  // Format for compatibility with existing system
  if (result.action === 'SKIP') {
    return {
      action: 'WAIT',
      side: 'LONG',
      entry: currentPrice,
      sl: currentPrice - atr5m,
      tp: currentPrice + atr5m,
      risk: 0,
      reasoning: result.reason,
      agentOutputs: result.agentOutputs
    };
  }

  return {
    action: 'TRADE',
    side: result.side,
    entry: result.entry,
    sl: result.sl,
    tp: result.tp,
    risk: result.risk,
    reasoning: result.reasoning,
    agentOutputs: result.agentOutputs
  };
}

module.exports = {
  callStrategyTradeDecision,
  validateDecision,
  MAX_WAIT_BARS,
};
