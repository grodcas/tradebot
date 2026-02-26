/**
 * Live Trader - Multi-Pair Version (FULL OANDA)
 *
 * Trades EUR/USD, USD/JPY, and GBP/USD simultaneously.
 * Each pair runs sequentially (one trade at a time per pair).
 * Runs from 8:00-18:00 Zurich time.
 *
 * FULLY POWERED BY OANDA API (market data + execution)
 *
 * Usage: node live_trader.js
 */

require('dotenv').config();
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const OpenAI = require('openai');
const { computeIndicators } = require('./trade_indicators');
const oanda = require('./oanda_executor');

// ----------------------------
// REAL EXECUTION CONFIG
// ----------------------------
const REAL_EXECUTION = true;  // Set to false to simulate only
const USE_LIMIT_ORDERS = true;  // true = limit orders (wait for price), false = market orders (immediate)
const FIXED_POSITION_SIZE = 100000;  // 100K = $10/pip on EUR/USD
const COMMISSION_PER_TRADE = 2.00;  // USD per side ($4 round trip)
const MAX_PENDING_BARS = 12;  // Cancel pending limit order after this many bars (12 bars = 1 hour)

// Pair-specific strategy selectors (each pair has its own trained model/prompts)
const strategySelectors = {
  EURUSD: require('./strategy_selector_eurusd'),
  USDJPY: require('./strategy_selector_usdjpy'),
  EURUSD_GPT5: require('./strategy_selector_gpt5'),
  GBPUSD: require('./strategy_selector_gbpusd'),
};

// ----------------------------
// CONFIG
// ----------------------------
const SESSION_TZ = 'Europe/Zurich';
const SESSION_START_HOUR = 20;  // TEMP: Changed for testing (normally 8)
const SESSION_END_HOUR = 23;   // TEMP: Changed for testing (normally 18)

const HISTORY_BARS_NEEDED = 800;
const BAR_SIZE_MINUTES = 5;

const RESULTS_PATH = './trade_results.json';
const GLOBAL_TRADES_PATH = './global_trades.json';
const LOG_PATH = './live_trader.log';

const DASHBOARD_PORT = 3000;

// ----------------------------
// PAIR CONFIGURATIONS (OANDA format)
// ----------------------------
const PAIRS = {
  EURUSD: {
    oandaInstrument: 'EUR_USD',
    spread: 0.00008,
    pipMultiplier: 10000,  // 1 pip = 0.0001
    displayName: 'EUR/USD',
  },
  USDJPY: {
    oandaInstrument: 'USD_JPY',
    spread: 0.008,
    pipMultiplier: 100,  // 1 pip = 0.01 for JPY pairs
    displayName: 'USD/JPY',
  },
  EURUSD_GPT5: {
    oandaInstrument: 'EUR_USD',
    spread: 0.00008,
    pipMultiplier: 10000,
    displayName: 'EUR/USD (GPT5)',
    sharesDataWith: 'EURUSD',  // Shares market data with EURUSD
  },
  GBPUSD: {
    oandaInstrument: 'GBP_USD',
    spread: 0.00010,
    pipMultiplier: 10000,  // 1 pip = 0.0001
    displayName: 'GBP/USD',
  }
};

// Active pairs to trade
const ACTIVE_PAIRS = ['EURUSD', 'USDJPY', 'EURUSD_GPT5', 'GBPUSD'];

let client = null;
function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// ----------------------------
// PER-PAIR STATE
// ----------------------------
const pairState = {};

function initPairState() {
  for (const pairCode of ACTIVE_PAIRS) {
    pairState[pairCode] = {
      config: PAIRS[pairCode],
      bars5m: [],
      currentPosition: null,
      pendingOrder: null,  // For limit orders waiting to fill
      tradeResults: [],
      lastPrice: null,
      pendingBar: null,
      lastBarMinute: null,
      tradeCounter: 0,
    };
  }
}

// ----------------------------
// GLOBALS
// ----------------------------
let priceStream = null;  // OANDA price stream handle
let globalTrades = [];
let isConnected = false;
let sessionEnded = false;
let sessionStartTime = null;
let statusMessage = 'Initializing...';
let currentSessionDate = null;

// ----------------------------
// LOGGING
// ----------------------------
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function logTrade(pairCode, message) {
  log(`[${pairCode}] ${message}`);
}

// ----------------------------
// TIME HELPERS
// ----------------------------
function getZurichTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: SESSION_TZ }));
}

function isWithinSession() {
  const zurich = getZurichTime();
  const hour = zurich.getHours();
  const day = zurich.getDay();
  return day >= 1 && day <= 5 && hour >= SESSION_START_HOUR && hour < SESSION_END_HOUR;
}

function shouldStopSession() {
  const zurich = getZurichTime();
  const hour = zurich.getHours();
  return hour >= SESSION_END_HOUR;
}

function formatTime(date) {
  return date.toLocaleString('en-GB', { timeZone: SESSION_TZ });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------
// OANDA INSTRUMENT HELPER
// ----------------------------
function getOandaInstrument(pairCode) {
  const config = PAIRS[pairCode];
  return config.oandaInstrument;
}

// ----------------------------
// OANDA CONNECTION
// ----------------------------
async function connectToOanda() {
  log('Connecting to OANDA API...');

  try {
    const summary = await oanda.getAccountSummary();
    if (summary.success) {
      isConnected = true;
      log(`Connected to OANDA - Account: ${summary.accountId}`);
      log(`Balance: ${summary.balance.toFixed(2)} ${summary.currency}`);
      return true;
    } else {
      throw new Error(summary.error);
    }
  } catch (error) {
    log(`OANDA connection error: ${error.message}`);
    throw error;
  }
}

// ----------------------------
// FETCH HISTORICAL DATA (OANDA)
// ----------------------------
async function fetchHistoricalBars(pairCode) {
  const config = PAIRS[pairCode];
  const instrument = config.oandaInstrument;

  log(`[${pairCode}] Fetching ${HISTORY_BARS_NEEDED} historical 5m bars from OANDA...`);

  const result = await oanda.getHistoricalCandles(instrument, 'M5', HISTORY_BARS_NEEDED);

  if (!result.success) {
    throw new Error(`[${pairCode}] Failed to fetch historical data: ${result.error}`);
  }

  log(`[${pairCode}] Received ${result.candles.length} historical bars`);
  return result.candles;
}

// ----------------------------
// REAL-TIME PRICE STREAMING (OANDA)
// ----------------------------
async function startPriceStreaming() {
  // Get unique instruments (avoid duplicates from shared pairs)
  const instruments = [...new Set(
    ACTIVE_PAIRS
      .filter(p => !PAIRS[p].sharesDataWith)
      .map(p => PAIRS[p].oandaInstrument)
  )];

  log(`Starting OANDA price stream for: ${instruments.join(', ')}`);

  priceStream = await oanda.startPriceStream(
    instruments,
    (price) => {
      // Find which pair(s) this price update is for
      for (const pairCode of ACTIVE_PAIRS) {
        const config = PAIRS[pairCode];
        if (config.oandaInstrument === price.instrument ||
            (config.sharesDataWith && PAIRS[config.sharesDataWith].oandaInstrument === price.instrument)) {
          handlePriceUpdate(pairCode, price);
        }
      }
    },
    (error) => {
      log(`Price stream error: ${error.message}`);
    }
  );
}

function handlePriceUpdate(pairCode, price) {
  const state = pairState[pairCode];
  const timestamp = Date.now();
  const date = new Date(timestamp);
  const minute = Math.floor(date.getMinutes() / BAR_SIZE_MINUTES) * BAR_SIZE_MINUTES;
  const barKey = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  const midPrice = price.mid;

  if (state.lastBarMinute !== barKey) {
    // New bar period - finalize previous bar
    if (state.pendingBar) {
      finalizeBar(pairCode, state.pendingBar);
    }

    state.pendingBar = {
      time: barKey,
      open: midPrice,
      high: midPrice,
      low: midPrice,
      close: midPrice,
      _t: timestamp,
      _d: date,
    };
    state.lastBarMinute = barKey;
  } else if (state.pendingBar) {
    // Update current bar
    state.pendingBar.high = Math.max(state.pendingBar.high, midPrice);
    state.pendingBar.low = Math.min(state.pendingBar.low, midPrice);
    state.pendingBar.close = midPrice;
    state.pendingBar._t = timestamp;
    state.pendingBar._d = date;
  }

  state.lastPrice = midPrice;
}

async function finalizeBar(pairCode, bar) {
  const state = pairState[pairCode];
  state.bars5m.push(bar);

  if (state.bars5m.length > HISTORY_BARS_NEEDED) {
    state.bars5m = state.bars5m.slice(-HISTORY_BARS_NEEDED);
  }

  log(`[${pairCode}] New bar: ${bar.time} | O:${bar.open.toFixed(5)} H:${bar.high.toFixed(5)} L:${bar.low.toFixed(5)} C:${bar.close.toFixed(5)}`);

  // Check pending limit orders first
  if (state.pendingOrder) {
    await checkPendingOrderStatus(pairCode, bar);
  }

  // Check open positions
  if (state.currentPosition) {
    await checkPositionStatus(pairCode, bar);
  } else if (!state.pendingOrder && !sessionEnded && isWithinSession()) {
    // Only look for new trades if no pending order and no position
    await processBar(pairCode, bar);
  }
}

/**
 * Check if a pending limit order has been filled
 */
async function checkPendingOrderStatus(pairCode, bar) {
  const state = pairState[pairCode];
  const pending = state.pendingOrder;
  if (!pending) return;

  pending.barsWaiting++;

  // Check if price has touched our entry level (order likely filled)
  const { side, entry, sl, tp } = pending;
  let filled = false;

  if (side === 'LONG') {
    // For long, filled when price goes down to our entry level
    if (bar.low <= entry) {
      filled = true;
    }
  } else {
    // For short, filled when price goes up to our entry level
    if (bar.high >= entry) {
      filled = true;
    }
  }

  if (filled) {
    logTrade(pairCode, `[REAL] LIMIT order FILLED at ${entry} (price touched level)`);

    // Convert pending to active position
    state.currentPosition = {
      pairCode,
      tradeNum: pending.tradeNum,
      side: pending.side,
      entry: pending.entry,  // Entry at our limit price!
      sl: pending.sl,
      tp: pending.tp,
      risk: pending.risk,
      reasoning: pending.reasoning,
      entryTime: new Date().toISOString(),
      entryBar: bar,
      indicators: pending.indicators,
      barsInTrade: 0,
      maxFavorable: 0,
      maxAdverse: 0,
      realExecution: pending.realExecution,
      positionSize: pending.positionSize,
      realOrderIds: pending.realOrderIds,
      commissionEntry: pending.realExecution ? COMMISSION_PER_TRADE : 0,
    };

    state.pendingOrder = null;
    logTrade(pairCode, `ENTERED ${side} @ ${entry} | SL: ${sl} | TP: ${tp} | Size: ${pending.positionSize}`);
    statusMessage = `[${pairCode}] In ${side} trade @ ${entry.toFixed(5)}`;
    return;
  }

  // Check for timeout
  if (pending.barsWaiting >= MAX_PENDING_BARS) {
    logTrade(pairCode, `[REAL] LIMIT order TIMEOUT after ${pending.barsWaiting} bars - cancelling`);

    // Cancel the pending orders in OANDA
    if (pending.realOrderIds) {
      try {
        await oanda.cancelOrder(pending.realOrderIds.entryOrderId);
        logTrade(pairCode, `[REAL] Cancelled entry order ${pending.realOrderIds.entryOrderId}`);
      } catch (err) {
        logTrade(pairCode, `[REAL] Error cancelling order: ${err.message}`);
      }
    }

    state.pendingOrder = null;
    statusMessage = `[${pairCode}] Ready`;
    return;
  }

  // Still waiting
  logTrade(pairCode, `[PENDING] Waiting for fill at ${entry} (${pending.barsWaiting}/${MAX_PENDING_BARS} bars)`);
}

// ----------------------------
// TRADING LOGIC
// ----------------------------
async function processBar(pairCode, bar) {
  const state = pairState[pairCode];

  if (state.bars5m.length < 100) {
    log(`[${pairCode}] Not enough bars for indicators yet...`);
    return;
  }

  try {
    const idx = state.bars5m.length - 1;
    const win5m = state.bars5m.slice(-15);
    const bars30m = aggregate30mBars(state.bars5m.slice(-90));

    const context = {
      prices_5m: win5m.map(b => b.close),
      prices_30m: bars30m.map(b => b.close),
      prices_daily: [],
      ranges_5m: win5m.map(b => b.high - b.low),
      ranges_30m: bars30m.map(b => b.high - b.low),
      ranges_daily: [],
      last_close: bar.close,
    };

    const indicators = computeIndicators(state.bars5m, bars30m, idx);

    const currentBar = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    };

    log(`[${pairCode}] Calling AI agents for trade decision...`);

    // Use pair-specific strategy selector
    const selector = strategySelectors[pairCode];
    const rawDecision = await selector.callStrategyTradeDecision({
      context,
      indicators,
      currentBar,
      waitCount: 0,
      mustTrade: false,
      waitHistory: [],
    });

    if (rawDecision.action === 'WAIT') {
      log(`[${pairCode}] AI says WAIT: ${rawDecision.reasoning?.slice(0, 100)}...`);
      return;
    }

    const decision = selector.validateDecision(rawDecision, bar.close, indicators);

    if (decision.risk === 0) {
      log(`[${pairCode}] Decision has risk=0, skipping...`);
      return;
    }

    logTrade(pairCode, `SIGNAL: ${decision.side} | Entry: ${decision.entry} | SL: ${decision.sl} | TP: ${decision.tp} | Risk: ${decision.risk}`);
    logTrade(pairCode, `Reasoning: ${decision.reasoning?.slice(0, 150)}...`);

    await executeTrade(pairCode, decision, bar, indicators);

  } catch (err) {
    log(`[${pairCode}] Error processing bar: ${err.message}`);
  }
}

function aggregate30mBars(bars) {
  const result = [];
  for (let i = 0; i + 6 <= bars.length; i += 6) {
    const chunk = bars.slice(i, i + 6);
    result.push({
      _t: chunk[chunk.length - 1]._t,
      _d: chunk[chunk.length - 1]._d,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
    });
  }
  return result;
}

// ----------------------------
// TRADE EXECUTION (Real or Simulated)
// ----------------------------
async function executeTrade(pairCode, decision, entryBar, indicators) {
  const state = pairState[pairCode];
  state.tradeCounter++;

  let realEntry = decision.entry;
  let realOrderIds = null;
  let isPending = false;

  // Place real order if enabled
  if (REAL_EXECUTION) {
    try {
      if (USE_LIMIT_ORDERS) {
        // LIMIT ORDER - waits for price to reach entry level
        logTrade(pairCode, `[REAL] Placing LIMIT ${decision.side} @ ${decision.entry} for ${FIXED_POSITION_SIZE} units...`);

        const result = await oanda.enterTradeLimit(
          pairCode,
          decision.side,
          FIXED_POSITION_SIZE,
          decision.entry,  // Limit entry price
          decision.tp,
          decision.sl
        );

        if (result.success) {
          realOrderIds = {
            entryOrderId: result.entryOrderId,
            takeProfitOrderId: result.takeProfitOrderId,
            stopLossOrderId: result.stopLossOrderId,
          };
          // With limit orders, the entry is pending until price hits the level
          isPending = true;
          logTrade(pairCode, `[REAL] LIMIT order placed - waiting for fill at ${decision.entry}`);
        } else {
          logTrade(pairCode, `[REAL] LIMIT order FAILED: ${result.error}`);
          return;
        }
      } else {
        // MARKET ORDER - immediate fill (old behavior)
        logTrade(pairCode, `[REAL] Placing MARKET ${decision.side} for ${FIXED_POSITION_SIZE} units...`);

        const result = await oanda.enterTrade(
          pairCode,
          decision.side,
          FIXED_POSITION_SIZE,
          decision.tp,
          decision.sl
        );

        if (result.success) {
          realEntry = result.entryPrice;
          realOrderIds = {
            entryOrderId: result.entryOrderId,
            takeProfitOrderId: result.takeProfitOrderId,
            stopLossOrderId: result.stopLossOrderId,
          };
          logTrade(pairCode, `[REAL] MARKET order filled at ${realEntry}`);
        } else {
          logTrade(pairCode, `[REAL] MARKET order FAILED: ${result.error}`);
          return;
        }
      }
    } catch (err) {
      logTrade(pairCode, `[REAL] Order execution error: ${err.message}`);
      return;
    }
  }

  if (isPending) {
    // Store as pending order - will track until filled or cancelled
    state.pendingOrder = {
      pairCode,
      tradeNum: state.tradeCounter,
      side: decision.side,
      entry: decision.entry,
      sl: decision.sl,
      tp: decision.tp,
      risk: decision.risk,
      reasoning: decision.reasoning,
      orderTime: new Date().toISOString(),
      entryBar: entryBar,
      indicators: {
        currentSession: indicators.currentSession,
        marketRegime: indicators.marketRegime,
        structureState: indicators.structureState,
        ATR_5m: indicators.ATR_5m,
      },
      barsWaiting: 0,
      realExecution: REAL_EXECUTION,
      positionSize: FIXED_POSITION_SIZE,
      realOrderIds: realOrderIds,
    };
    logTrade(pairCode, `PENDING ${decision.side} @ ${decision.entry} | SL: ${decision.sl} | TP: ${decision.tp} | Size: ${FIXED_POSITION_SIZE}`);
    statusMessage = `[${pairCode}] Pending ${decision.side} @ ${decision.entry.toFixed(5)}`;
  } else {
    // Immediate fill (market order or simulation)
    state.currentPosition = {
      pairCode,
      tradeNum: state.tradeCounter,
      side: decision.side,
      entry: realEntry,
      sl: decision.sl,
      tp: decision.tp,
      risk: decision.risk,
      reasoning: decision.reasoning,
      entryTime: new Date().toISOString(),
      entryBar: entryBar,
      indicators: {
        currentSession: indicators.currentSession,
        marketRegime: indicators.marketRegime,
        structureState: indicators.structureState,
        ATR_5m: indicators.ATR_5m,
      },
      barsInTrade: 0,
      maxFavorable: 0,
      maxAdverse: 0,
      realExecution: REAL_EXECUTION,
      positionSize: FIXED_POSITION_SIZE,
      realOrderIds: realOrderIds,
      commissionEntry: REAL_EXECUTION ? COMMISSION_PER_TRADE : 0,
    };
    logTrade(pairCode, `ENTERED ${decision.side} @ ${realEntry} | SL: ${decision.sl} | TP: ${decision.tp} | Size: ${FIXED_POSITION_SIZE}`);
    statusMessage = `[${pairCode}] In ${decision.side} trade @ ${realEntry.toFixed(5)}`;
  }
}

async function checkPositionStatus(pairCode, bar) {
  const state = pairState[pairCode];
  if (!state.currentPosition) return;

  state.currentPosition.barsInTrade++;

  const { side, entry, sl, tp, realExecution } = state.currentPosition;

  if (side === 'LONG') {
    state.currentPosition.maxFavorable = Math.max(state.currentPosition.maxFavorable, bar.high - entry);
    state.currentPosition.maxAdverse = Math.max(state.currentPosition.maxAdverse, entry - bar.low);
  } else {
    state.currentPosition.maxFavorable = Math.max(state.currentPosition.maxFavorable, entry - bar.low);
    state.currentPosition.maxAdverse = Math.max(state.currentPosition.maxAdverse, bar.high - entry);
  }

  let outcome = null;
  let exitPrice = null;

  // For real execution, check actual position status
  if (REAL_EXECUTION && realExecution) {
    try {
      const positionInfo = await oanda.getTradePosition(pairCode);
      const positionSize = positionInfo.position || 0;

      // If position is closed (by TP or SL order), determine which hit
      if (positionSize === 0) {
        // Position was closed by bracket order
        if (side === 'LONG') {
          if (bar.high >= tp) {
            outcome = 'TP';
            exitPrice = tp;
          } else if (bar.low <= sl) {
            outcome = 'SL';
            exitPrice = sl;
          } else {
            // Closed but unclear why - use current price
            outcome = 'TP';  // Assume TP if position gone
            exitPrice = bar.close;
          }
        } else {
          if (bar.low <= tp) {
            outcome = 'TP';
            exitPrice = tp;
          } else if (bar.high >= sl) {
            outcome = 'SL';
            exitPrice = sl;
          } else {
            outcome = 'TP';
            exitPrice = bar.close;
          }
        }
        logTrade(pairCode, `[REAL] Position closed by bracket order - ${outcome}`);
      }
    } catch (err) {
      log(`[${pairCode}] Error checking real position: ${err.message}`);
      // Fall back to simulated check
    }
  }

  // Simulated check (or fallback)
  if (!outcome) {
    if (side === 'LONG') {
      if (bar.low <= sl) {
        outcome = 'SL';
        exitPrice = sl;
      } else if (bar.high >= tp) {
        outcome = 'TP';
        exitPrice = tp;
      }
    } else {
      if (bar.high >= sl) {
        outcome = 'SL';
        exitPrice = sl;
      } else if (bar.low <= tp) {
        outcome = 'TP';
        exitPrice = tp;
      }
    }
  }

  if (!outcome && state.currentPosition.barsInTrade >= 300) {
    outcome = 'TIMEOUT';
    exitPrice = bar.close;
  }

  if (outcome) {
    await closePosition(pairCode, outcome, exitPrice, bar);
  }
}

async function closePosition(pairCode, outcome, exitPrice, exitBar) {
  const state = pairState[pairCode];
  const pos = state.currentPosition;

  let realExitPrice = exitPrice;

  // Close real position if enabled
  if (REAL_EXECUTION && pos.realExecution) {
    try {
      logTrade(pairCode, `[REAL] Closing position...`);

      const result = await oanda.exitTrade(pairCode);

      if (result.success && result.avgPrice) {
        realExitPrice = result.avgPrice;
        logTrade(pairCode, `[REAL] Position closed at ${realExitPrice}`);
      } else if (result.message === 'No position to close') {
        // Position might have been closed by TP/SL already
        logTrade(pairCode, `[REAL] Position already closed (likely by TP/SL order)`);
      } else {
        logTrade(pairCode, `[REAL] Close result: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      logTrade(pairCode, `[REAL] Close error: ${err.message}`);
    }
  }

  const riskPerUnit = Math.abs(pos.entry - pos.sl);
  const rawR = pos.side === 'LONG'
    ? (realExitPrice - pos.entry) / riskPerUnit
    : (pos.entry - realExitPrice) / riskPerUnit;
  const weightedR = rawR * pos.risk;

  // Calculate real P&L in USD
  const pipMultiplier = PAIRS[pairCode.split('_')[0]]?.pipMultiplier || 10000;
  const priceDiff = pos.side === 'LONG' ? (realExitPrice - pos.entry) : (pos.entry - realExitPrice);
  const grossPnL = priceDiff * (pos.positionSize || FIXED_POSITION_SIZE);
  const totalCommission = (pos.commissionEntry || 0) + COMMISSION_PER_TRADE;
  const netPnL = grossPnL - totalCommission;

  logTrade(pairCode, `CLOSED ${pos.side} | ${outcome} @ ${realExitPrice} | R: ${rawR.toFixed(2)} | Weighted: ${weightedR.toFixed(2)}`);
  logTrade(pairCode, `Bars in trade: ${pos.barsInTrade} | Max favorable: ${pos.maxFavorable.toFixed(5)} | Max adverse: ${pos.maxAdverse.toFixed(5)}`);

  if (REAL_EXECUTION) {
    logTrade(pairCode, `[REAL P&L] Gross: $${grossPnL.toFixed(2)} | Commission: $${totalCommission.toFixed(2)} | Net: $${netPnL.toFixed(2)}`);
  }

  let summary = null;
  try {
    summary = await getTradeAnalysis(pos, outcome, realExitPrice, rawR);
    logTrade(pairCode, `Analysis: ${summary.rating} - ${summary.why_outcome?.slice(0, 100)}...`);
  } catch (err) {
    log(`[${pairCode}] Error getting trade analysis: ${err.message}`);
  }

  const tradeResult = {
    pairCode,
    tradeNum: pos.tradeNum,
    entryTime: pos.entryTime,
    exitTime: new Date().toISOString(),
    side: pos.side,
    entry: pos.entry,
    sl: pos.sl,
    tp: pos.tp,
    risk: pos.risk,
    exitPrice: realExitPrice,
    outcome,
    rawR,
    weightedR,
    barsInTrade: pos.barsInTrade,
    maxFavorable: pos.maxFavorable,
    maxAdverse: pos.maxAdverse,
    indicators: pos.indicators,
    reasoning: pos.reasoning,
    summary,
    // Real execution data
    realExecution: pos.realExecution || false,
    positionSize: pos.positionSize || FIXED_POSITION_SIZE,
    grossPnL: REAL_EXECUTION ? grossPnL : null,
    commission: REAL_EXECUTION ? totalCommission : null,
    netPnL: REAL_EXECUTION ? netPnL : null,
  };

  state.tradeResults.push(tradeResult);

  saveResults();
  appendToGlobalTrades(tradeResult);

  state.currentPosition = null;

  if (!sessionEnded) {
    statusMessage = `Trading active - monitoring ${ACTIVE_PAIRS.join(', ')}`;
  } else {
    statusMessage = 'Session ended - waiting for positions to close';
  }
}

async function getTradeAnalysis(pos, outcome, exitPrice, rawR) {
  const system = `You are a professional trading analyst reviewing completed trades. Analyze what happened and explain WHY the trade won or lost. Be specific. Output valid JSON only.`;

  const user = `
TRADE:
- Pair: ${pos.pairCode}
- Side: ${pos.side}
- Entry: ${pos.entry}
- Stop Loss: ${pos.sl}
- Take Profit: ${pos.tp}
- Risk: ${pos.risk}

MARKET CONDITIONS:
- Session: ${pos.indicators.currentSession}
- Structure: ${pos.indicators.structureState}
- ATR: ${pos.indicators.ATR_5m}

OUTCOME:
- Result: ${outcome}
- Exit Price: ${exitPrice}
- Bars in trade: ${pos.barsInTrade}
- PnL (R): ${rawR.toFixed(3)}

Analyze briefly. Output JSON:
{
  "why_outcome": "Brief explanation of what happened",
  "rating": "GOOD | BAD | NEUTRAL"
}`;

  const resp = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
  });

  const text = resp.choices?.[0]?.message?.content;
  return text ? JSON.parse(text) : { error: 'Empty response' };
}

// ----------------------------
// RESULTS MANAGEMENT
// ----------------------------
function saveResults() {
  const allResults = [];
  for (const pairCode of ACTIVE_PAIRS) {
    allResults.push(...pairState[pairCode].tradeResults);
  }

  const summary = calculateSummary();
  const output = {
    sessionDate: new Date().toISOString().split('T')[0],
    pairs: ACTIVE_PAIRS,
    trades: allResults,
    summary,
    pairSummaries: {},
  };

  for (const pairCode of ACTIVE_PAIRS) {
    output.pairSummaries[pairCode] = calculatePairSummary(pairCode);
  }

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  log(`Results saved (${allResults.length} total trades)`);
}

function calculatePairSummary(pairCode) {
  const results = pairState[pairCode].tradeResults;
  const executed = results.filter(t => t.outcome);
  const wins = executed.filter(t => t.outcome === 'TP').length;
  const losses = executed.filter(t => t.outcome === 'SL').length;
  const timeouts = executed.filter(t => t.outcome === 'TIMEOUT').length;

  const totalRawR = executed.reduce((sum, t) => sum + t.rawR, 0);
  const totalWeightedR = executed.reduce((sum, t) => sum + t.weightedR, 0);

  // Real P&L tracking
  const realTrades = executed.filter(t => t.realExecution);
  const totalGrossPnL = realTrades.reduce((sum, t) => sum + (t.grossPnL || 0), 0);
  const totalCommission = realTrades.reduce((sum, t) => sum + (t.commission || 0), 0);
  const totalNetPnL = realTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);

  return {
    totalTrades: executed.length,
    wins,
    losses,
    timeouts,
    winRate: executed.length ? ((wins / executed.length) * 100).toFixed(1) + '%' : '0%',
    totalRawR: totalRawR.toFixed(2),
    totalWeightedR: totalWeightedR.toFixed(2),
    avgRawR: executed.length ? (totalRawR / executed.length).toFixed(3) : '0',
    avgWeightedR: executed.length ? (totalWeightedR / executed.length).toFixed(3) : '0',
    // Real P&L (if real execution enabled)
    realTrades: realTrades.length,
    grossPnL: totalGrossPnL.toFixed(2),
    totalCommission: totalCommission.toFixed(2),
    netPnL: totalNetPnL.toFixed(2),
  };
}

function calculateSummary() {
  const allResults = [];
  for (const pairCode of ACTIVE_PAIRS) {
    allResults.push(...pairState[pairCode].tradeResults);
  }

  const executed = allResults.filter(t => t.outcome);
  const wins = executed.filter(t => t.outcome === 'TP').length;
  const losses = executed.filter(t => t.outcome === 'SL').length;
  const timeouts = executed.filter(t => t.outcome === 'TIMEOUT').length;

  const totalRawR = executed.reduce((sum, t) => sum + t.rawR, 0);
  const totalWeightedR = executed.reduce((sum, t) => sum + t.weightedR, 0);

  // Real P&L tracking
  const realTrades = executed.filter(t => t.realExecution);
  const totalGrossPnL = realTrades.reduce((sum, t) => sum + (t.grossPnL || 0), 0);
  const totalCommission = realTrades.reduce((sum, t) => sum + (t.commission || 0), 0);
  const totalNetPnL = realTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);

  return {
    totalTrades: executed.length,
    wins,
    losses,
    timeouts,
    winRate: executed.length ? ((wins / executed.length) * 100).toFixed(1) + '%' : '0%',
    totalRawR: totalRawR.toFixed(2),
    totalWeightedR: totalWeightedR.toFixed(2),
    avgRawR: executed.length ? (totalRawR / executed.length).toFixed(3) : '0',
    avgWeightedR: executed.length ? (totalWeightedR / executed.length).toFixed(3) : '0',
    // Real P&L (if real execution enabled)
    realExecution: REAL_EXECUTION,
    realTrades: realTrades.length,
    grossPnL: totalGrossPnL.toFixed(2),
    totalCommission: totalCommission.toFixed(2),
    netPnL: totalNetPnL.toFixed(2),
  };
}

function loadGlobalTrades() {
  try {
    if (fs.existsSync(GLOBAL_TRADES_PATH)) {
      const data = JSON.parse(fs.readFileSync(GLOBAL_TRADES_PATH, 'utf8'));
      globalTrades = data.trades || [];
      log(`Loaded ${globalTrades.length} historical trades from global history`);
    } else {
      globalTrades = [];
      log('No global trades history found, starting fresh');
    }
  } catch (err) {
    log(`Error loading global trades: ${err.message}`);
    globalTrades = [];
  }
}

function saveGlobalTrades() {
  const summary = calculateGlobalSummary();
  const output = {
    lastUpdated: new Date().toISOString(),
    trades: globalTrades,
    summary,
  };

  fs.writeFileSync(GLOBAL_TRADES_PATH, JSON.stringify(output, null, 2));
  log(`Global trades saved (${globalTrades.length} total trades)`);
}

function appendToGlobalTrades(trade) {
  globalTrades.push(trade);
  saveGlobalTrades();
}

function calculateGlobalSummary() {
  const executed = globalTrades.filter(t => t.outcome);
  const wins = executed.filter(t => t.outcome === 'TP').length;
  const losses = executed.filter(t => t.outcome === 'SL').length;
  const timeouts = executed.filter(t => t.outcome === 'TIMEOUT').length;

  const totalRawR = executed.reduce((sum, t) => sum + t.rawR, 0);
  const totalWeightedR = executed.reduce((sum, t) => sum + t.weightedR, 0);

  const longs = executed.filter(t => t.side === 'LONG');
  const shorts = executed.filter(t => t.side === 'SHORT');
  const longWins = longs.filter(t => t.outcome === 'TP').length;
  const shortWins = shorts.filter(t => t.outcome === 'TP').length;

  const tradingDays = new Set(executed.map(t => t.entryTime?.split('T')[0])).size;

  // Per-pair breakdown
  const pairStats = {};
  for (const pairCode of ACTIVE_PAIRS) {
    const pairTrades = executed.filter(t => t.pairCode === pairCode);
    const pairWins = pairTrades.filter(t => t.outcome === 'TP').length;
    const pairR = pairTrades.reduce((sum, t) => sum + t.weightedR, 0);
    pairStats[pairCode] = {
      trades: pairTrades.length,
      winRate: pairTrades.length ? ((pairWins / pairTrades.length) * 100).toFixed(1) + '%' : '0%',
      totalR: pairR.toFixed(2),
    };
  }

  return {
    totalTrades: executed.length,
    wins,
    losses,
    timeouts,
    winRate: executed.length ? ((wins / executed.length) * 100).toFixed(1) + '%' : '0%',
    totalRawR: totalRawR.toFixed(2),
    totalWeightedR: totalWeightedR.toFixed(2),
    avgRawR: executed.length ? (totalRawR / executed.length).toFixed(3) : '0',
    avgWeightedR: executed.length ? (totalWeightedR / executed.length).toFixed(3) : '0',
    longTrades: longs.length,
    longWinRate: longs.length ? ((longWins / longs.length) * 100).toFixed(1) + '%' : '0%',
    shortTrades: shorts.length,
    shortWinRate: shorts.length ? ((shortWins / shorts.length) * 100).toFixed(1) + '%' : '0%',
    tradingDays,
    pairStats,
  };
}

function printFinalSummary() {
  const summary = calculateSummary();

  log('\n========================================');
  log('         SESSION COMPLETE');
  log('========================================');
  log(`Pairs traded: ${ACTIVE_PAIRS.join(', ')}`);
  log(`Total trades: ${summary.totalTrades}`);
  log(`Wins: ${summary.wins} | Losses: ${summary.losses} | Timeouts: ${summary.timeouts}`);
  log(`Win Rate: ${summary.winRate}`);
  log(`Raw R: ${summary.totalRawR} (avg: ${summary.avgRawR})`);
  log(`Weighted R: ${summary.totalWeightedR} (avg: ${summary.avgWeightedR})`);

  for (const pairCode of ACTIVE_PAIRS) {
    const ps = calculatePairSummary(pairCode);
    log(`  ${pairCode}: ${ps.totalTrades} trades, ${ps.winRate} WR, ${ps.totalWeightedR}R`);
  }

  log('========================================\n');
}

// ----------------------------
// WEB DASHBOARD
// ----------------------------
async function startDashboard() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getDashboardData()));
    } else if (url === '/trades') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const allTrades = [];
      for (const pairCode of ACTIVE_PAIRS) {
        allTrades.push(...pairState[pairCode].tradeResults);
      }
      res.end(JSON.stringify(allTrades));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateDashboardHTML());
    }
  });

  server.listen(DASHBOARD_PORT, () => {
    log(`Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });

  // Start ngrok tunnel
  try {
    log('Starting ngrok...');
    const ngrokProcess = spawn('npx', ['ngrok', 'http', String(DASHBOARD_PORT)], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    ngrokProcess.stderr.on('data', (data) => {
      log(`ngrok stderr: ${data.toString().trim()}`);
    });

    ngrokProcess.on('error', (err) => {
      log(`ngrok process error: ${err.message}`);
    });

    log('Waiting for ngrok to initialize...');
    await sleep(5000);

    log('Fetching ngrok tunnel URL from API...');
    const httpLib = require('http');
    const req = httpLib.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data);
          const publicUrl = tunnels.tunnels[0]?.public_url;
          if (publicUrl) {
            log(`========================================`);
            log(`PUBLIC URL: ${publicUrl}`);
            log(`========================================`);
          } else {
            log('No tunnel URL found in response');
          }
        } catch (e) {
          log(`Could not parse ngrok response: ${e.message}`);
        }
      });
    });
    req.on('error', (err) => {
      log(`ngrok API error: ${err.message}`);
      log(`Dashboard available locally only at http://localhost:${DASHBOARD_PORT}`);
    });

  } catch (err) {
    log(`ngrok error: ${err.message}`);
  }

  return server;
}

function getDashboardData() {
  const summary = calculateSummary();
  const globalSummary = calculateGlobalSummary();
  const zurich = getZurichTime();

  const pairData = {};
  for (const pairCode of ACTIVE_PAIRS) {
    const state = pairState[pairCode];
    pairData[pairCode] = {
      displayName: PAIRS[pairCode].displayName,
      lastPrice: state.lastPrice ? state.lastPrice.toFixed(pairCode === 'USDJPY' ? 3 : 5) : 'N/A',
      position: state.currentPosition ? {
        side: state.currentPosition.side,
        entry: state.currentPosition.entry.toFixed(pairCode === 'USDJPY' ? 3 : 5),
        sl: state.currentPosition.sl.toFixed(pairCode === 'USDJPY' ? 3 : 5),
        tp: state.currentPosition.tp.toFixed(pairCode === 'USDJPY' ? 3 : 5),
        risk: state.currentPosition.risk.toFixed(2),
        barsInTrade: state.currentPosition.barsInTrade,
        entryTime: state.currentPosition.entryTime,
      } : null,
      summary: calculatePairSummary(pairCode),
      recentTrades: state.tradeResults.slice(-5).reverse(),
    };
  }

  return {
    status: sessionEnded ? 'SESSION_ENDED' : (isConnected ? 'RUNNING' : 'DISCONNECTED'),
    statusMessage,
    currentTime: zurich.toLocaleTimeString('en-GB'),
    currentDate: currentSessionDate,
    sessionHours: `${SESSION_START_HOUR}:00 - ${SESSION_END_HOUR}:00`,
    activePairs: ACTIVE_PAIRS,
    pairData,
    summary,
    globalSummary,
  };
}

function generateDashboardHTML() {
  const data = getDashboardData();
  const statusColor = data.status === 'RUNNING' ? '#4ade80' : (data.status === 'SESSION_ENDED' ? '#fbbf24' : '#ef4444');

  // Generate pair cards
  let pairCardsHTML = '';
  for (const pairCode of ACTIVE_PAIRS) {
    const pd = data.pairData[pairCode];
    const positionHTML = pd.position ? `
      <div class="position ${pd.position.side.toLowerCase()}">
        <span class="position-side">${pd.position.side}</span>
        <span>@ ${pd.position.entry} | SL: ${pd.position.sl} | TP: ${pd.position.tp}</span>
      </div>
    ` : '<div class="no-position">No position</div>';

    const tradesHTML = pd.recentTrades.length > 0 ? pd.recentTrades.map(t => {
      const outcomeClass = t.outcome === 'TP' ? 'win' : (t.outcome === 'SL' ? 'loss' : 'timeout');
      const sign = t.rawR >= 0 ? '+' : '';
      return `<span class="trade-pill ${outcomeClass}">${t.side} ${sign}${t.rawR.toFixed(2)}R</span>`;
    }).join('') : '<span class="no-trades">No trades</span>';

    pairCardsHTML += `
      <div class="card pair-card">
        <div class="pair-header">
          <h2>${pd.displayName}</h2>
          <span class="price">${pd.lastPrice}</span>
        </div>
        <div class="pair-stats">
          <span>${pd.summary.totalTrades} trades</span>
          <span>${pd.summary.winRate} WR</span>
          <span class="${parseFloat(pd.summary.totalWeightedR) >= 0 ? 'positive' : 'negative'}">${parseFloat(pd.summary.totalWeightedR) >= 0 ? '+' : ''}${pd.summary.totalWeightedR}R</span>
        </div>
        ${positionHTML}
        <div class="recent-trades">${tradesHTML}</div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TradeBot Dashboard - Multi-Pair</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid #334155;
    }
    .title { font-size: 24px; font-weight: bold; }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #1e293b;
      border-radius: 8px;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${statusColor};
      animation: ${data.status === 'RUNNING' ? 'pulse 2s infinite' : 'none'};
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card h2 {
      font-size: 14px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 12px;
    }
    .card.global-card {
      background: linear-gradient(135deg, #1e293b 0%, #312e81 100%);
      border: 1px solid #4f46e5;
    }
    .pair-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .pair-card { border: 1px solid #334155; }
    .pair-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .pair-header h2 { margin: 0; font-size: 18px; color: #f8fafc; }
    .price { font-size: 20px; font-weight: bold; color: #60a5fa; }
    .pair-stats { display: flex; gap: 16px; margin-bottom: 12px; font-size: 14px; color: #94a3b8; }
    .positive { color: #4ade80; }
    .negative { color: #ef4444; }
    .position {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .position.long { background: #166534; }
    .position.short { background: #991b1b; }
    .position-side { font-weight: bold; }
    .no-position { color: #64748b; font-style: italic; font-size: 13px; margin-bottom: 12px; }
    .recent-trades { display: flex; flex-wrap: wrap; gap: 6px; }
    .trade-pill {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .trade-pill.win { background: #166534; color: #4ade80; }
    .trade-pill.loss { background: #991b1b; color: #fca5a5; }
    .trade-pill.timeout { background: #854d0e; color: #fbbf24; }
    .no-trades { color: #64748b; font-style: italic; font-size: 12px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 16px;
    }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #f8fafc; }
    .stat-value.positive { color: #4ade80; }
    .stat-value.negative { color: #ef4444; }
    .stat-label { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    .info-bar {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #64748b;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">TradeBot Multi-Pair</div>
        <div style="color: #64748b; font-size: 14px; margin-top: 4px;">${data.statusMessage}</div>
      </div>
      <div class="status">
        <div class="status-dot"></div>
        <span>${data.status}</span>
      </div>
    </div>

    <div class="card">
      <h2>Session Info - ${data.currentDate}</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">${data.currentTime}</div>
          <div class="stat-label">Zurich Time</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.sessionHours}</div>
          <div class="stat-label">Session Hours</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.summary.totalTrades}</div>
          <div class="stat-label">Today's Trades</div>
        </div>
        <div class="stat">
          <div class="stat-value ${parseFloat(data.summary.totalWeightedR) >= 0 ? 'positive' : 'negative'}">${parseFloat(data.summary.totalWeightedR) >= 0 ? '+' : ''}${data.summary.totalWeightedR}R</div>
          <div class="stat-label">Today's P&L</div>
        </div>
      </div>
    </div>

    <div class="pair-cards">
      ${pairCardsHTML}
    </div>

    <div class="card global-card">
      <h2>All-Time Performance</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">${data.globalSummary.totalTrades}</div>
          <div class="stat-label">Total Trades</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.globalSummary.winRate}</div>
          <div class="stat-label">Win Rate</div>
        </div>
        <div class="stat">
          <div class="stat-value ${parseFloat(data.globalSummary.totalWeightedR) >= 0 ? 'positive' : 'negative'}">${parseFloat(data.globalSummary.totalWeightedR) >= 0 ? '+' : ''}${data.globalSummary.totalWeightedR}R</div>
          <div class="stat-label">Total P&L</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.globalSummary.avgWeightedR}</div>
          <div class="stat-label">Avg R/Trade</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.globalSummary.tradingDays}</div>
          <div class="stat-label">Trading Days</div>
        </div>
      </div>
    </div>

    <div class="info-bar">
      <span>Auto-refreshes every 10 seconds</span>
      <span>Pairs: ${ACTIVE_PAIRS.join(', ')}</span>
    </div>
  </div>
</body>
</html>`;
}

// ----------------------------
// MAIN LOOP
// ----------------------------
async function main() {
  log('\n========================================');
  log('   LIVE PAPER TRADER - Multi-Pair Mode');
  log('========================================');
  log(`Active pairs: ${ACTIVE_PAIRS.join(', ')}`);
  log(`Trading hours: ${SESSION_START_HOUR}:00 - ${SESSION_END_HOUR}:00 ${SESSION_TZ}`);
  log(`Current Zurich time: ${formatTime(new Date())}`);

  // Initialize per-pair state
  initPairState();

  // Load global trades history
  loadGlobalTrades();

  // Initialize current session date
  currentSessionDate = new Date().toISOString().split('T')[0];

  // Start web dashboard
  const dashboardServer = await startDashboard();

  // 24/7 loop
  while (true) {
    // Check for midnight reset
    const todayDate = new Date().toISOString().split('T')[0];
    if (todayDate !== currentSessionDate) {
      log(`New day detected (${todayDate}), resetting daily stats`);
      for (const pairCode of ACTIVE_PAIRS) {
        pairState[pairCode].tradeResults = [];
      }
      currentSessionDate = todayDate;
    }

    // Reset session state
    sessionEnded = false;
    for (const pairCode of ACTIVE_PAIRS) {
      pairState[pairCode].bars5m = [];
      pairState[pairCode].pendingBar = null;
      pairState[pairCode].lastBarMinute = null;
    }

    // Wait for session
    if (!isWithinSession()) {
      const zurich = getZurichTime();
      log(`Outside trading hours. Current hour: ${zurich.getHours()}`);
      statusMessage = `Waiting for next session (${SESSION_START_HOUR}:00)...`;

      while (!isWithinSession()) {
        await sleep(60000);
      }
      log('Trading session starting!');
    }

    try {
      // Connect to OANDA
      statusMessage = 'Connecting to OANDA...';
      await connectToOanda();

      // Fetch historical data for all pairs
      for (const pairCode of ACTIVE_PAIRS) {
        const config = PAIRS[pairCode];
        // If this pair shares data with another, copy from that pair
        if (config.sharesDataWith && pairState[config.sharesDataWith]?.bars5m?.length > 0) {
          pairState[pairCode].bars5m = [...pairState[config.sharesDataWith].bars5m];
          log(`[${pairCode}] Sharing data from ${config.sharesDataWith} (${pairState[pairCode].bars5m.length} bars)`);
        } else {
          statusMessage = `Fetching ${pairCode} historical data...`;
          const historicalBars = await fetchHistoricalBars(pairCode);
          pairState[pairCode].bars5m = historicalBars;
          log(`[${pairCode}] Loaded ${historicalBars.length} historical bars`);
          await sleep(1000);  // Small delay between requests
        }
      }

      // Start OANDA price streaming for all pairs
      statusMessage = 'Starting price stream...';
      await startPriceStreaming();

      sessionStartTime = new Date();
      statusMessage = `Trading active - monitoring ${ACTIVE_PAIRS.join(', ')}`;
      log('Trading session active. Press Ctrl+C to stop.\n');

      // Trading loop
      while (true) {
        await sleep(5000);

        // Check session end
        if (shouldStopSession() && !sessionEnded) {
          sessionEnded = true;
          log('Session end time reached (18:00) - No new trades will be opened');

          const openPositions = ACTIVE_PAIRS.filter(p => pairState[p].currentPosition);
          if (openPositions.length > 0) {
            log(`Open positions: ${openPositions.join(', ')}`);
            log('Waiting for trades to finish (TP/SL)...');
            statusMessage = 'Session ended - waiting for open trades to close';
          } else {
            statusMessage = 'Session ended - waiting for next session';
          }
        }

        // Exit when session ended and no open positions
        const hasOpenPositions = ACTIVE_PAIRS.some(p => pairState[p].currentPosition);
        if (sessionEnded && !hasOpenPositions) {
          log('Session ended and no open positions.');
          break;
        }
      }

      // End of session
      saveResults();
      printFinalSummary();

      if (priceStream) {
        priceStream.stop();
        priceStream = null;
      }
      isConnected = false;

      statusMessage = `Session complete. Waiting for next session (${SESSION_START_HOUR}:00)...`;
      log('Waiting for next trading session...\n');

    } catch (err) {
      log(`Error during session: ${err.message}`);
      console.error(err);
      statusMessage = `Error: ${err.message}. Retrying in 5 minutes...`;

      if (priceStream) {
        priceStream.stop();
        priceStream = null;
      }
      isConnected = false;

      await sleep(300000);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('\nReceived SIGINT, shutting down gracefully...');

  for (const pairCode of ACTIVE_PAIRS) {
    const state = pairState[pairCode];
    if (state.currentPosition) {
      const lastBar = state.bars5m[state.bars5m.length - 1];
      logTrade(pairCode, 'Closing open position due to manual shutdown');
      await closePosition(pairCode, 'MANUAL_STOP', lastBar?.close || state.currentPosition.entry, lastBar);
    }
  }

  saveResults();
  printFinalSummary();

  if (priceStream) {
    priceStream.stop();
  }

  process.exit(0);
});

// Start
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
