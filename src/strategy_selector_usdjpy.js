/**
 * Strategy Selector - USD/JPY
 *
 * Coordinates specialist agents for USD/JPY pair.
 */

const { orchestrateTrade } = require('../models/gpt4mini_usdjpy/orchestrator');

const MAX_WAIT_BARS = 6;
const MIN_RISK = 0.15;
const MAX_RISK = 0.70;

function clampRisk(x) {
  if (!Number.isFinite(x) || x <= 0) return MIN_RISK;
  return Math.max(MIN_RISK, Math.min(MAX_RISK, x));
}

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
  const risk = clampRisk(Number(dec.risk));

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

  return { side: dec.side, entry, tp, sl, risk, reasoning, riskReward: dec.riskReward };
}

/**
 * Main entry point - calls multi-agent orchestrator
 */
async function callStrategyTradeDecision({ context, indicators, currentBar, waitCount, mustTrade, waitHistory = [] }) {

  // Extract what the agents need
  const prices5m = context.prices_5m;
  const currentPrice = currentBar.close;

  // Get indicators
  const ema50 = indicators.EMA50_30m || currentPrice;
  const emaSlope = indicators.EMA50_slope_30m || 0;
  const support = indicators.support || indicators.prevSessionLow;
  const resistance = indicators.resistance || indicators.prevSessionHigh;

  // Get most recent swing points
  const swingHighs = indicators.swingHighs || [];
  const swingLows = indicators.swingLows || [];
  const swingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : indicators.prevSessionHigh;
  const swingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : indicators.prevSessionLow;

  const sessionHigh = indicators.prevSessionHigh;
  const sessionLow = indicators.prevSessionLow;
  const atr = indicators.ATR_5m;

  // Call the multi-agent orchestrator
  const result = await orchestrateTrade({
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
    atr
  });

  // Format for compatibility with existing system
  if (result.action === 'SKIP') {
    return {
      action: 'WAIT',
      side: 'LONG',
      entry: currentPrice,
      sl: currentPrice - atr,
      tp: currentPrice + atr,
      risk: 0,
      reasoning: result.reason
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
