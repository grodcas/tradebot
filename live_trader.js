/**
 * Live Paper Trader for IBKR - Multi-Pair Version
 *
 * Trades EUR/USD and USD/JPY simultaneously.
 * Each pair runs sequentially (one trade at a time per pair).
 * Runs from 8:00-18:00 Zurich time.
 *
 * Usage: node live_trader.js
 */

require('dotenv').config();
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
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

const HISTORY_BARS_NEEDED = 800;
const BAR_SIZE_MINUTES = 5;

const RESULTS_PATH = './trade_results.json';
const GLOBAL_TRADES_PATH = './global_trades.json';
const LOG_PATH = './live_trader.log';

const DASHBOARD_PORT = 3000;

// ----------------------------
// PAIR CONFIGURATIONS
// ----------------------------
const PAIRS = {
  EURUSD: {
    symbol: 'EUR',
    currency: 'USD',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.00008,
    pipMultiplier: 10000,  // 1 pip = 0.0001
    displayName: 'EUR/USD',
    histReqId: 1001,
    rtReqId: 2001,
  },
  USDJPY: {
    symbol: 'USD',
    currency: 'JPY',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.008,
    pipMultiplier: 100,  // 1 pip = 0.01 for JPY pairs
    displayName: 'USD/JPY',
    histReqId: 1002,
    rtReqId: 2002,
  }
};

// Active pairs to trade
const ACTIVE_PAIRS = ['EURUSD', 'USDJPY'];

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
let ib = null;
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
// IBKR CONTRACT BUILDER
// ----------------------------
function getContract(pairCode) {
  const config = PAIRS[pairCode];
  return {
    symbol: config.symbol,
    secType: config.secType,
    currency: config.currency,
    exchange: config.exchange,
  };
}

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
      log(`IBKR Error [${code}] reqId=${reqId}: ${err.message}`);
    });

    log('Connecting to IBKR Gateway...');
    ib.connect();
  });
}

// ----------------------------
// FETCH HISTORICAL DATA
// ----------------------------
function fetchHistoricalBars(pairCode) {
  return new Promise((resolve, reject) => {
    const config = PAIRS[pairCode];
    const reqId = config.histReqId;
    const contract = getContract(pairCode);

    log(`[${pairCode}] Fetching ${HISTORY_BARS_NEEDED} historical 5m bars...`);

    const collectedBars = [];
    const endDateTime = '';
    const durationStr = '5 D';
    const barSize = '5 mins';

    const onHistoricalData = (id, time, open, high, low, close, volume, count, wap) => {
      if (id !== reqId) return;

      if (time.startsWith('finished')) {
        ib.off(EventName.historicalData, onHistoricalData);

        const parsed = collectedBars
          .map(b => ({
            ...b,
            _t: parseBarTime(b.time),
            _d: new Date(parseBarTime(b.time)),
          }))
          .filter(b => b._t)
          .sort((a, b) => a._t - b._t);

        log(`[${pairCode}] Received ${parsed.length} historical bars`);
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
      contract,
      endDateTime,
      durationStr,
      barSize,
      WhatToShow.MIDPOINT,
      1,
      1,
      false
    );

    setTimeout(() => {
      ib.off(EventName.historicalData, onHistoricalData);
      if (collectedBars.length > 0) {
        resolve(collectedBars);
      } else {
        reject(new Error(`[${pairCode}] Historical data timeout`));
      }
    }, 30000);
  });
}

function parseBarTime(timeStr) {
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
function subscribeToRealTimeBars(pairCode) {
  const config = PAIRS[pairCode];
  const reqId = config.rtReqId;
  const contract = getContract(pairCode);

  log(`[${pairCode}] Subscribing to real-time 5-second bars...`);

  ib.on(EventName.realtimeBar, (id, time, open, high, low, close, volume, wap, count) => {
    if (id !== reqId) return;
    const barTime = time * 1000;
    aggregateRealTimeBar(pairCode, barTime, open, high, low, close);
  });

  ib.reqRealTimeBars(
    reqId,
    contract,
    5,
    WhatToShow.MIDPOINT,
    false
  );
}

function aggregateRealTimeBar(pairCode, timestamp, open, high, low, close) {
  const state = pairState[pairCode];
  const date = new Date(timestamp);
  const minute = Math.floor(date.getMinutes() / BAR_SIZE_MINUTES) * BAR_SIZE_MINUTES;
  const barKey = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  if (state.lastBarMinute !== barKey) {
    if (state.pendingBar) {
      finalizeBar(pairCode, state.pendingBar);
    }

    state.pendingBar = {
      time: barKey,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      _t: timestamp,
      _d: date,
    };
    state.lastBarMinute = barKey;
  } else if (state.pendingBar) {
    state.pendingBar.high = Math.max(state.pendingBar.high, Number(high));
    state.pendingBar.low = Math.min(state.pendingBar.low, Number(low));
    state.pendingBar.close = Number(close);
    state.pendingBar._t = timestamp;
    state.pendingBar._d = date;
  }

  state.lastPrice = Number(close);
}

async function finalizeBar(pairCode, bar) {
  const state = pairState[pairCode];
  state.bars5m.push(bar);

  if (state.bars5m.length > HISTORY_BARS_NEEDED) {
    state.bars5m = state.bars5m.slice(-HISTORY_BARS_NEEDED);
  }

  log(`[${pairCode}] New bar: ${bar.time} | O:${bar.open.toFixed(5)} H:${bar.high.toFixed(5)} L:${bar.low.toFixed(5)} C:${bar.close.toFixed(5)}`);

  if (state.currentPosition) {
    await checkPositionStatus(pairCode, bar);
  } else if (!sessionEnded && isWithinSession()) {
    await processBar(pairCode, bar);
  }
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

    const rawDecision = await callStrategyTradeDecision({
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

    const decision = validateDecision(rawDecision, bar.close, indicators);

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
// TRADE EXECUTION (Paper)
// ----------------------------
async function executeTrade(pairCode, decision, entryBar, indicators) {
  const state = pairState[pairCode];
  state.tradeCounter++;

  state.currentPosition = {
    pairCode,
    tradeNum: state.tradeCounter,
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

  logTrade(pairCode, `ENTERED ${decision.side} @ ${decision.entry} | SL: ${decision.sl} | TP: ${decision.tp}`);
  statusMessage = `[${pairCode}] In ${decision.side} trade @ ${decision.entry.toFixed(5)}`;
}

async function checkPositionStatus(pairCode, bar) {
  const state = pairState[pairCode];
  if (!state.currentPosition) return;

  state.currentPosition.barsInTrade++;

  const { side, entry, sl, tp } = state.currentPosition;

  if (side === 'LONG') {
    state.currentPosition.maxFavorable = Math.max(state.currentPosition.maxFavorable, bar.high - entry);
    state.currentPosition.maxAdverse = Math.max(state.currentPosition.maxAdverse, entry - bar.low);
  } else {
    state.currentPosition.maxFavorable = Math.max(state.currentPosition.maxFavorable, entry - bar.low);
    state.currentPosition.maxAdverse = Math.max(state.currentPosition.maxAdverse, bar.high - entry);
  }

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

  const riskPerUnit = Math.abs(pos.entry - pos.sl);
  const rawR = pos.side === 'LONG'
    ? (exitPrice - pos.entry) / riskPerUnit
    : (pos.entry - exitPrice) / riskPerUnit;
  const weightedR = rawR * pos.risk;

  logTrade(pairCode, `CLOSED ${pos.side} | ${outcome} @ ${exitPrice} | R: ${rawR.toFixed(2)} | Weighted: ${weightedR.toFixed(2)}`);
  logTrade(pairCode, `Bars in trade: ${pos.barsInTrade} | Max favorable: ${pos.maxFavorable.toFixed(5)} | Max adverse: ${pos.maxAdverse.toFixed(5)}`);

  let summary = null;
  try {
    summary = await getTradeAnalysis(pos, outcome, exitPrice, rawR);
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
      // Connect to IBKR
      statusMessage = 'Connecting to IBKR...';
      await connectToIBKR();
      await sleep(2000);

      // Fetch historical data for all pairs
      for (const pairCode of ACTIVE_PAIRS) {
        statusMessage = `Fetching ${pairCode} historical data...`;
        const historicalBars = await fetchHistoricalBars(pairCode);
        pairState[pairCode].bars5m = historicalBars;
        log(`[${pairCode}] Loaded ${historicalBars.length} historical bars`);
        await sleep(1000);  // Small delay between requests
      }

      // Subscribe to real-time data for all pairs
      for (const pairCode of ACTIVE_PAIRS) {
        statusMessage = `Subscribing to ${pairCode} real-time data...`;
        subscribeToRealTimeBars(pairCode);
        await sleep(500);
      }

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

      if (ib && isConnected) {
        ib.disconnect();
        isConnected = false;
      }

      statusMessage = `Session complete. Waiting for next session (${SESSION_START_HOUR}:00)...`;
      log('Waiting for next trading session...\n');

    } catch (err) {
      log(`Error during session: ${err.message}`);
      console.error(err);
      statusMessage = `Error: ${err.message}. Retrying in 5 minutes...`;

      if (ib && isConnected) {
        ib.disconnect();
        isConnected = false;
      }

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
