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

const HISTORY_BARS_NEEDED = 800;  // Bars needed for indicator calculation
const BAR_SIZE_MINUTES = 5;

const RESULTS_PATH = './trade_results.json';
const LOG_PATH = './live_trader.log';

const DASHBOARD_PORT = 3000;  // Web dashboard port

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
let lastPrice = null;      // Latest market price
let sessionStartTime = null;  // When trading session started
let statusMessage = 'Initializing...';  // Current status for dashboard

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

  // Update last price for dashboard
  lastPrice = Number(close);
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
  statusMessage = `In ${decision.side} trade @ ${decision.entry.toFixed(5)}`;
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

  // Update status
  if (!sessionEnded) {
    statusMessage = 'Trading active - monitoring for setups';
  } else {
    statusMessage = 'Session ended - shutting down';
  }
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
// WEB DASHBOARD
// ----------------------------
async function startDashboard() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/status') {
      // JSON status endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getDashboardData()));
    } else if (url === '/trades') {
      // JSON trades endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tradeResults));
    } else {
      // HTML dashboard
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateDashboardHTML());
    }
  });

  server.listen(DASHBOARD_PORT, () => {
    log(`Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });

  // Start ngrok tunnel for remote access
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

    ngrokProcess.stdout.on('data', (data) => {
      log(`ngrok stdout: ${data.toString().trim()}`);
    });

    ngrokProcess.on('error', (err) => {
      log(`ngrok process error: ${err.message}`);
    });

    // Give ngrok time to start, then fetch the public URL from its API
    log('Waiting for ngrok to initialize...');
    await sleep(5000);

    log('Fetching ngrok tunnel URL from API...');
    const http = require('http');
    const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        log(`ngrok API response: ${data}`);
        try {
          const tunnels = JSON.parse(data);
          const publicUrl = tunnels.tunnels[0]?.public_url;
          if (publicUrl) {
            log(`========================================`);
            log(`PUBLIC URL: ${publicUrl}`);
            log(`========================================`);
            log(`Access dashboard from anywhere using the URL above`);
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
    log(`Dashboard available locally only. Install ngrok CLI and run 'ngrok config add-authtoken YOUR_TOKEN'`);
  }

  return server;
}

function getDashboardData() {
  const summary = calculateSummary();
  const zurich = getZurichTime();

  return {
    status: sessionEnded ? 'SESSION_ENDED' : (isConnected ? 'RUNNING' : 'DISCONNECTED'),
    statusMessage,
    currentTime: zurich.toLocaleTimeString('en-GB'),
    sessionHours: `${SESSION_START_HOUR}:00 - ${SESSION_END_HOUR}:00`,
    lastPrice: lastPrice ? lastPrice.toFixed(5) : 'N/A',
    position: currentPosition ? {
      side: currentPosition.side,
      entry: currentPosition.entry.toFixed(5),
      sl: currentPosition.sl.toFixed(5),
      tp: currentPosition.tp.toFixed(5),
      risk: currentPosition.risk.toFixed(2),
      barsInTrade: currentPosition.barsInTrade,
      entryTime: currentPosition.entryTime,
    } : null,
    summary,
    recentTrades: tradeResults.slice(-10).reverse(),
  };
}

function generateDashboardHTML() {
  const data = getDashboardData();
  const statusColor = data.status === 'RUNNING' ? '#4ade80' : (data.status === 'SESSION_ENDED' ? '#fbbf24' : '#ef4444');

  const positionHTML = data.position ? `
    <div class="card">
      <h2>Current Position</h2>
      <div class="position ${data.position.side.toLowerCase()}">
        <div class="position-side">${data.position.side}</div>
        <div class="position-details">
          <div><span class="label">Entry:</span> ${data.position.entry}</div>
          <div><span class="label">Stop Loss:</span> ${data.position.sl}</div>
          <div><span class="label">Take Profit:</span> ${data.position.tp}</div>
          <div><span class="label">Risk:</span> ${data.position.risk}</div>
          <div><span class="label">Bars in trade:</span> ${data.position.barsInTrade}</div>
        </div>
      </div>
    </div>
  ` : `
    <div class="card">
      <h2>Current Position</h2>
      <div class="no-position">No open position</div>
    </div>
  `;

  const tradesHTML = data.recentTrades.length > 0 ? data.recentTrades.map(t => {
    const outcomeClass = t.outcome === 'TP' ? 'win' : (t.outcome === 'SL' ? 'loss' : 'timeout');
    const sign = t.rawR >= 0 ? '+' : '';
    return `
      <div class="trade-row ${outcomeClass}">
        <span class="trade-time">${new Date(t.exitTime).toLocaleTimeString('en-GB')}</span>
        <span class="trade-side">${t.side}</span>
        <span class="trade-outcome">${t.outcome}</span>
        <span class="trade-r">${sign}${t.rawR.toFixed(2)}R</span>
      </div>
    `;
  }).join('') : '<div class="no-trades">No trades yet</div>';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TradeBot Dashboard</title>
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
    .container { max-width: 800px; margin: 0 auto; }
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
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
    }
    .stat {
      text-align: center;
    }
    .stat-value {
      font-size: 28px;
      font-weight: bold;
      color: #f8fafc;
    }
    .stat-value.positive { color: #4ade80; }
    .stat-value.negative { color: #ef4444; }
    .stat-label {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .position {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .position-side {
      font-size: 24px;
      font-weight: bold;
      padding: 12px 24px;
      border-radius: 8px;
    }
    .position.long .position-side { background: #166534; color: #4ade80; }
    .position.short .position-side { background: #991b1b; color: #fca5a5; }
    .position-details { font-size: 14px; line-height: 1.8; }
    .label { color: #94a3b8; }
    .no-position {
      color: #64748b;
      font-style: italic;
      padding: 20px;
      text-align: center;
    }
    .trade-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 12px;
      border-radius: 6px;
      margin-bottom: 6px;
      background: #334155;
    }
    .trade-row.win { border-left: 3px solid #4ade80; }
    .trade-row.loss { border-left: 3px solid #ef4444; }
    .trade-row.timeout { border-left: 3px solid #fbbf24; }
    .trade-time { color: #94a3b8; font-size: 13px; }
    .trade-side { font-weight: 500; }
    .trade-outcome { font-size: 13px; }
    .trade-r { font-weight: bold; }
    .trade-row.win .trade-r { color: #4ade80; }
    .trade-row.loss .trade-r { color: #ef4444; }
    .no-trades {
      color: #64748b;
      font-style: italic;
      padding: 20px;
      text-align: center;
    }
    .info-bar {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #64748b;
      margin-top: 20px;
    }
    .price { font-size: 18px; color: #f8fafc; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">TradeBot Live</div>
        <div style="color: #64748b; font-size: 14px; margin-top: 4px;">${data.statusMessage}</div>
      </div>
      <div class="status">
        <div class="status-dot"></div>
        <span>${data.status}</span>
      </div>
    </div>

    <div class="card">
      <h2>Session Info</h2>
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
          <div class="price">${data.lastPrice}</div>
          <div class="stat-label">EUR/USD</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Today's Performance</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">${data.summary.totalTrades}</div>
          <div class="stat-label">Total Trades</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.summary.wins}</div>
          <div class="stat-label">Wins</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.summary.losses}</div>
          <div class="stat-label">Losses</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.summary.winRate}</div>
          <div class="stat-label">Win Rate</div>
        </div>
        <div class="stat">
          <div class="stat-value ${parseFloat(data.summary.totalWeightedR) >= 0 ? 'positive' : 'negative'}">${parseFloat(data.summary.totalWeightedR) >= 0 ? '+' : ''}${data.summary.totalWeightedR}R</div>
          <div class="stat-label">Total P&L</div>
        </div>
      </div>
    </div>

    ${positionHTML}

    <div class="card">
      <h2>Recent Trades</h2>
      ${tradesHTML}
    </div>

    <div class="info-bar">
      <span>Auto-refreshes every 10 seconds</span>
      <span>API: /status | /trades</span>
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
  log('   LIVE PAPER TRADER - Starting (24/7 mode)');
  log('========================================');
  log(`Trading hours: ${SESSION_START_HOUR}:00 - ${SESSION_END_HOUR}:00 ${SESSION_TZ}`);
  log(`Current Zurich time: ${formatTime(new Date())}`);

  // Start web dashboard (always running)
  const dashboardServer = await startDashboard();

  // 24/7 loop - dashboard always on, trading only during session
  while (true) {
    // Reset session state for new day
    sessionEnded = false;
    tradeResults = [];
    bars5m = [];

    // Wait for trading session to start
    if (!isWithinSession()) {
      const zurich = getZurichTime();
      log(`Outside trading hours. Current hour: ${zurich.getHours()}`);
      statusMessage = `Waiting for next session (${SESSION_START_HOUR}:00)...`;

      while (!isWithinSession()) {
        await sleep(60000);  // Check every minute
      }
      log('Trading session starting!');
    }

    try {
      // Connect to IBKR
      statusMessage = 'Connecting to IBKR...';
      await connectToIBKR();
      await sleep(2000);

      // Fetch historical data for indicators
      statusMessage = 'Fetching historical data...';
      const historicalBars = await fetchHistoricalBars();
      bars5m = historicalBars;
      log(`Loaded ${bars5m.length} historical bars`);

      // Subscribe to real-time data
      statusMessage = 'Subscribing to real-time data...';
      subscribeToRealTimeBars();

      sessionStartTime = new Date();
      statusMessage = 'Trading active - monitoring for setups';
      log('Trading session active. Press Ctrl+C to stop.\n');

      // Trading loop (runs during session hours)
      while (true) {
        await sleep(5000);  // Check every 5 seconds

        // Check if session should end (18:00)
        if (shouldStopSession() && !sessionEnded) {
          sessionEnded = true;
          log('Session end time reached (18:00) - No new trades will be opened');

          if (currentPosition) {
            log(`Open position detected: ${currentPosition.side} @ ${currentPosition.entry}`);
            log('Waiting for trade to finish (TP/SL)...');
            statusMessage = 'Session ended - waiting for open trade to close';
          } else {
            statusMessage = 'Session ended - waiting for next session';
          }
        }

        // Exit trading loop when session ended AND no open position
        if (sessionEnded && !currentPosition) {
          log('Session ended and no open positions.');
          break;
        }
      }

      // End of session - save results and disconnect
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

      // Wait before retrying
      await sleep(300000);  // 5 minutes
    }
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
