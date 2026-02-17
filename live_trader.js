/**
 * Live Paper Trader for IBKR
 *
 * Runs from 8:00-18:00 Zurich time, executing trades one at a time.
 * Connects to IBKR Gateway (paper account on port 4002).
 *
 * Usage: node live_trader.js
 */

require('dotenv').config();
const fs = require('fs');
const { IBApi, EventName, BarSizeSetting, WhatToShow } = require('@stoqey/ib');
const OpenAI = require('openai');
const { computeIndicators } = require('./trade_indicators');
const { callStrategyTradeDecision, validateDecision, MAX_WAIT_BARS } = require('./strategy_selector');

// ----------------------------
// CONFIG
// ----------------------------
const IBKR_HOST = '127.0.0.1';
const IBKR_PORT = 4002;  // 4002 = IB Gateway Paper, 7497 = TWS Paper
const CLIENT_ID = 100;

const SESSION_TZ = 'Europe/Zurich';
const SESSION_START_HOUR = 8;
const SESSION_END_HOUR = 18;

const HISTORY_BARS_NEEDED = 800;  // Bars needed for indicator calculation
const BAR_SIZE_MINUTES = 5;

const RESULTS_PATH = './trade_results.json';
const LOG_PATH = './live_trader.log';

const SPREAD = 0.00008;  // Typical EUR/USD spread

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// GLOBALS
// ----------------------------
let ib = null;
let bars5m = [];
let currentPosition = null;  // { side, entry, sl, tp, orderId, entryTime }
let tradeResults = [];
let isConnected = false;
let lastBarTime = null;
let tradeCounter = 0;
let sessionEnded = false;  // Flag: past 18:00, no new trades

// ----------------------------
// LOGGING
// ----------------------------
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function logTrade(message) {
  log(`[TRADE] ${message}`);
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
// IBKR CONTRACT
// ----------------------------
const eurusdContract = {
  symbol: 'EUR',
  secType: 'CASH',
  currency: 'USD',
  exchange: 'IDEALPRO',
};

// ----------------------------
// IBKR CONNECTION
// ----------------------------
function connectToIBKR() {
  return new Promise((resolve, reject) => {
    ib = new IBApi({
      clientId: CLIENT_ID,
      host: IBKR_HOST,
      port: IBKR_PORT,
    });

    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout - is IB Gateway running?'));
    }, 10000);

    ib.on(EventName.connected, () => {
      clearTimeout(timeout);
      isConnected = true;
      log('Connected to IBKR Gateway');
      resolve();
    });

    ib.on(EventName.disconnected, () => {
      isConnected = false;
      log('Disconnected from IBKR');
    });

    ib.on(EventName.error, (err, code, reqId) => {
      if (err.message?.includes('connection is OK')) return;
      log(`IBKR Error [${code}]: ${err.message}`);
    });

    log('Connecting to IBKR Gateway...');
    ib.connect();
  });
}

// ----------------------------
// FETCH HISTORICAL DATA
// ----------------------------
function fetchHistoricalBars() {
  return new Promise((resolve, reject) => {
    log(`Fetching ${HISTORY_BARS_NEEDED} historical 5m bars...`);

    const reqId = 1001;
    const collectedBars = [];

    const endDateTime = '';  // Empty = now
    const durationStr = '5 D';  // 5 days of data
    const barSize = '5 mins';

    const onHistoricalData = (id, time, open, high, low, close, volume, count, wap) => {
      if (id !== reqId) return;

      if (time.startsWith('finished')) {
        ib.off(EventName.historicalData, onHistoricalData);

        // Sort by time and parse
        const parsed = collectedBars
          .map(b => ({
            ...b,
            _t: parseBarTime(b.time),
            _d: new Date(parseBarTime(b.time)),
          }))
          .filter(b => b._t)
          .sort((a, b) => a._t - b._t);

        log(`Received ${parsed.length} historical bars`);
        resolve(parsed);
        return;
      }

      collectedBars.push({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
      });
    };

    ib.on(EventName.historicalData, onHistoricalData);

    ib.reqHistoricalData(
      reqId,
      eurusdContract,
      endDateTime,
      durationStr,
      barSize,
      WhatToShow.MIDPOINT,
      1,  // useRTH
      1,  // formatDate
      false
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      ib.off(EventName.historicalData, onHistoricalData);
      if (collectedBars.length > 0) {
        resolve(collectedBars);
      } else {
        reject(new Error('Historical data timeout'));
      }
    }, 30000);
  });
}

function parseBarTime(timeStr) {
  // Format: "20260217 14:30:00" (US/Eastern from IBKR)
  if (!timeStr || typeof timeStr !== 'string') return null;

  const parts = timeStr.split(' ');
  if (parts.length < 2) return null;

  const datePart = parts[0];
  const timePart = parts[1];

  const year = parseInt(datePart.slice(0, 4));
  const month = parseInt(datePart.slice(4, 6)) - 1;
  const day = parseInt(datePart.slice(6, 8));
  const [hour, minute, second] = timePart.split(':').map(Number);

  return new Date(Date.UTC(year, month, day, hour, minute, second || 0)).getTime();
}

// ----------------------------
// REAL-TIME BAR SUBSCRIPTION
// ----------------------------
function subscribeToRealTimeBars() {
  const reqId = 2001;

  log('Subscribing to real-time 5-second bars...');

  ib.on(EventName.realtimeBar, (id, time, open, high, low, close, volume, wap, count) => {
    if (id !== reqId) return;

    // Aggregate into 5-minute bars
    const barTime = time * 1000;  // Convert to milliseconds
    aggregateRealTimeBar(barTime, open, high, low, close);
  });

  ib.reqRealTimeBars(
    reqId,
    eurusdContract,
    5,  // 5-second bars (smallest available)
    WhatToShow.MIDPOINT,
    false
  );
}

let pendingBar = null;
let lastBarMinute = null;

function aggregateRealTimeBar(timestamp, open, high, low, close) {
  const date = new Date(timestamp);
  const minute = Math.floor(date.getMinutes() / BAR_SIZE_MINUTES) * BAR_SIZE_MINUTES;
  const barKey = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  if (lastBarMinute !== barKey) {
    // New bar started
    if (pendingBar) {
      // Finalize previous bar
      finalizeBar(pendingBar);
    }

    pendingBar = {
      time: barKey,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      _t: timestamp,
      _d: date,
    };
    lastBarMinute = barKey;
  } else if (pendingBar) {
    // Update current bar
    pendingBar.high = Math.max(pendingBar.high, Number(high));
    pendingBar.low = Math.min(pendingBar.low, Number(low));
    pendingBar.close = Number(close);
    pendingBar._t = timestamp;
    pendingBar._d = date;
  }
}

async function finalizeBar(bar) {
  bars5m.push(bar);

  // Keep only last HISTORY_BARS_NEEDED bars
  if (bars5m.length > HISTORY_BARS_NEEDED) {
    bars5m = bars5m.slice(-HISTORY_BARS_NEEDED);
  }

  log(`New bar: ${bar.time} | O:${bar.open.toFixed(5)} H:${bar.high.toFixed(5)} L:${bar.low.toFixed(5)} C:${bar.close.toFixed(5)}`);

  // Check if we should process this bar for trading
  if (currentPosition) {
    // Always monitor open positions
    await checkPositionStatus(bar);
  } else if (!sessionEnded && isWithinSession()) {
    // Only look for new trades if session hasn't ended
    await processBar(bar);
  }
}

// ----------------------------
// TRADING LOGIC
// ----------------------------
async function processBar(bar) {
  if (bars5m.length < 100) {
    log('Not enough bars for indicators yet...');
    return;
  }

  try {
    const idx = bars5m.length - 1;

    // Build context (last 15 bars)
    const win5m = bars5m.slice(-15);

    // Aggregate 30m bars
    const bars30m = aggregate30mBars(bars5m.slice(-90));

    const context = {
      prices_5m: win5m.map(b => b.close),
      prices_30m: bars30m.map(b => b.close),
      prices_daily: [],  // Not critical for live
      ranges_5m: win5m.map(b => b.high - b.low),
      ranges_30m: bars30m.map(b => b.high - b.low),
      ranges_daily: [],
      last_close: bar.close,
    };

    const indicators = computeIndicators(bars5m, bars30m, idx);

    // Entry timing loop
    let waitCount = 0;
    let decision = null;
    let waitHistory = [];

    const currentBar = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    };

    log('Calling AI agents for trade decision...');

    const rawDecision = await callStrategyTradeDecision({
      context,
      indicators,
      currentBar,
      waitCount,
      mustTrade: false,
      waitHistory,
    });

    if (rawDecision.action === 'WAIT') {
      log(`AI says WAIT: ${rawDecision.reasoning?.slice(0, 100)}...`);
      return;  // Will try again on next bar
    }

    decision = validateDecision(rawDecision, bar.close, indicators);

    if (decision.risk === 0) {
      log('Decision has risk=0, skipping...');
      return;
    }

    logTrade(`SIGNAL: ${decision.side} | Entry: ${decision.entry} | SL: ${decision.sl} | TP: ${decision.tp} | Risk: ${decision.risk}`);
    logTrade(`Reasoning: ${decision.reasoning?.slice(0, 150)}...`);

    // Execute the trade
    await executeTrade(decision, bar, indicators);

  } catch (err) {
    log(`Error processing bar: ${err.message}`);
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
// TRADE EXECUTION (Paper)
// ----------------------------
async function executeTrade(decision, entryBar, indicators) {
  tradeCounter++;

  // For paper trading, we simulate the entry at the decision price
  // In a real setup, you'd place actual orders via ib.placeOrder()

  currentPosition = {
    tradeNum: tradeCounter,
    side: decision.side,
    entry: decision.entry,
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
  };

  logTrade(`ENTERED ${decision.side} @ ${decision.entry} | SL: ${decision.sl} | TP: ${decision.tp}`);
}

async function checkPositionStatus(bar) {
  if (!currentPosition) return;

  currentPosition.barsInTrade++;

  const { side, entry, sl, tp } = currentPosition;

  // Track max favorable/adverse excursion
  if (side === 'LONG') {
    currentPosition.maxFavorable = Math.max(currentPosition.maxFavorable, bar.high - entry);
    currentPosition.maxAdverse = Math.max(currentPosition.maxAdverse, entry - bar.low);
  } else {
    currentPosition.maxFavorable = Math.max(currentPosition.maxFavorable, entry - bar.low);
    currentPosition.maxAdverse = Math.max(currentPosition.maxAdverse, bar.high - entry);
  }

  // Check for TP/SL hit
  let outcome = null;
  let exitPrice = null;

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

  // Timeout after 300 bars (25 hours)
  if (!outcome && currentPosition.barsInTrade >= 300) {
    outcome = 'TIMEOUT';
    exitPrice = bar.close;
  }

  if (outcome) {
    await closePosition(outcome, exitPrice, bar);
  }
}

async function closePosition(outcome, exitPrice, exitBar) {
  const pos = currentPosition;

  const riskPerUnit = Math.abs(pos.entry - pos.sl);
  const rawR = pos.side === 'LONG'
    ? (exitPrice - pos.entry) / riskPerUnit
    : (pos.entry - exitPrice) / riskPerUnit;
  const weightedR = rawR * pos.risk;

  logTrade(`CLOSED ${pos.side} | ${outcome} @ ${exitPrice} | R: ${rawR.toFixed(2)} | Weighted: ${weightedR.toFixed(2)}`);
  logTrade(`Bars in trade: ${pos.barsInTrade} | Max favorable: ${pos.maxFavorable.toFixed(5)} | Max adverse: ${pos.maxAdverse.toFixed(5)}`);

  // Get AI analysis
  let summary = null;
  try {
    summary = await getTradeAnalysis(pos, outcome, exitPrice, rawR);
    logTrade(`Analysis: ${summary.rating} - ${summary.why_outcome?.slice(0, 100)}...`);
  } catch (err) {
    log(`Error getting trade analysis: ${err.message}`);
  }

  // Save result
  tradeResults.push({
    tradeNum: pos.tradeNum,
    entryTime: pos.entryTime,
    exitTime: new Date().toISOString(),
    side: pos.side,
    entry: pos.entry,
    sl: pos.sl,
    tp: pos.tp,
    risk: pos.risk,
    exitPrice,
    outcome,
    rawR,
    weightedR,
    barsInTrade: pos.barsInTrade,
    maxFavorable: pos.maxFavorable,
    maxAdverse: pos.maxAdverse,
    indicators: pos.indicators,
    reasoning: pos.reasoning,
    summary,
  });

  // Save results after each trade
  saveResults();

  currentPosition = null;
}

async function getTradeAnalysis(pos, outcome, exitPrice, rawR) {
  const system = `You are a professional trading analyst reviewing completed trades. Analyze what happened and explain WHY the trade won or lost. Be specific. Output valid JSON only.`;

  const user = `
TRADE:
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

  const resp = await client.chat.completions.create({
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
  const summary = calculateSummary();
  const output = {
    sessionDate: new Date().toISOString().split('T')[0],
    trades: tradeResults,
    summary,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  log(`Results saved (${tradeResults.length} trades)`);
}

function calculateSummary() {
  const executed = tradeResults.filter(t => t.outcome);
  const wins = executed.filter(t => t.outcome === 'TP').length;
  const losses = executed.filter(t => t.outcome === 'SL').length;
  const timeouts = executed.filter(t => t.outcome === 'TIMEOUT').length;

  const totalRawR = executed.reduce((sum, t) => sum + t.rawR, 0);
  const totalWeightedR = executed.reduce((sum, t) => sum + t.weightedR, 0);

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
  };
}

function printFinalSummary() {
  const summary = calculateSummary();

  log('\n========================================');
  log('         SESSION COMPLETE');
  log('========================================');
  log(`Total trades: ${summary.totalTrades}`);
  log(`Wins: ${summary.wins} | Losses: ${summary.losses} | Timeouts: ${summary.timeouts}`);
  log(`Win Rate: ${summary.winRate}`);
  log(`Raw R: ${summary.totalRawR} (avg: ${summary.avgRawR})`);
  log(`Weighted R: ${summary.totalWeightedR} (avg: ${summary.avgWeightedR})`);
  log('========================================\n');
}

// ----------------------------
// MAIN LOOP
// ----------------------------
async function main() {
  log('\n========================================');
  log('   LIVE PAPER TRADER - Starting');
  log('========================================');
  log(`Session hours: ${SESSION_START_HOUR}:00 - ${SESSION_END_HOUR}:00 ${SESSION_TZ}`);
  log(`Current Zurich time: ${formatTime(new Date())}`);

  // Check if within session
  if (!isWithinSession()) {
    const zurich = getZurichTime();
    log(`Outside trading session. Current hour: ${zurich.getHours()}`);
    log('Waiting for session to start...');

    // Wait until session starts
    while (!isWithinSession()) {
      await sleep(60000);  // Check every minute
      if (shouldStopSession()) {
        log('Session ended before starting. Exiting.');
        process.exit(0);
      }
    }
  }

  try {
    // Connect to IBKR
    await connectToIBKR();
    await sleep(2000);

    // Fetch historical data for indicators
    const historicalBars = await fetchHistoricalBars();
    bars5m = historicalBars;
    log(`Loaded ${bars5m.length} historical bars`);

    // Subscribe to real-time data
    subscribeToRealTimeBars();

    log('Live trading loop started. Press Ctrl+C to stop.\n');

    // Main monitoring loop
    while (true) {
      await sleep(5000);  // Check every 5 seconds

      // Check if session should end (18:00)
      if (shouldStopSession() && !sessionEnded) {
        sessionEnded = true;
        log('Session end time reached (18:00) - No new trades will be opened');

        if (currentPosition) {
          log(`Open position detected: ${currentPosition.side} @ ${currentPosition.entry}`);
          log('Waiting for trade to finish (TP/SL)...');
        }
      }

      // Exit only when session ended AND no open position
      if (sessionEnded && !currentPosition) {
        log('Session ended and no open positions. Shutting down.');
        break;
      }
    }

  } catch (err) {
    log(`Fatal error: ${err.message}`);
    console.error(err);
  } finally {
    // Save final results
    saveResults();
    printFinalSummary();

    // Disconnect
    if (ib && isConnected) {
      ib.disconnect();
    }

    log('Trader stopped.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('\nReceived SIGINT, shutting down gracefully...');

  if (currentPosition) {
    const lastBar = bars5m[bars5m.length - 1];
    logTrade('Closing open position due to manual shutdown');
    await closePosition('MANUAL_STOP', lastBar?.close || currentPosition.entry, lastBar);
  }

  saveResults();
  printFinalSummary();

  if (ib && isConnected) {
    ib.disconnect();
  }

  process.exit(0);
});

// Start
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
