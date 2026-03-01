/**
 * Entry Verification Script
 *
 * Tests the full flow:
 * 1. Get current market price from IBKR
 * 2. Run AI strategy selector
 * 3. Compare AI's planned entry vs current price
 * 4. Optionally place order and verify fill
 */

require('dotenv').config();
const { IBApi, EventName, SecType, Currency } = require('@stoqey/ib');
const { computeIndicators } = require('./trade_indicators');
const orderExecutor = require('./order_executor');

// Config
const PAIR = process.argv[2] || 'EURUSD';
const PLACE_ORDER = process.argv[3] === '--execute';
const POSITION_SIZE = 20000; // Small size for testing

const PAIRS = {
  EURUSD: { symbol: 'EUR', currency: 'USD', exchange: 'IDEALPRO', pipMult: 10000 },
  USDJPY: { symbol: 'USD', currency: 'JPY', exchange: 'IDEALPRO', pipMult: 100 },
  GBPUSD: { symbol: 'GBP', currency: 'USD', exchange: 'IDEALPRO', pipMult: 10000 },
};

const strategySelectors = {
  EURUSD: require('./strategy_selector_eurusd'),
  USDJPY: require('./strategy_selector_usdjpy'),
  GBPUSD: require('./strategy_selector_gbpusd'),
};

const config = PAIRS[PAIR];
if (!config) {
  console.error(`Unknown pair: ${PAIR}`);
  process.exit(1);
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

const ib = new IBApi({ host: '127.0.0.1', port: 7497, clientId: 200 });

let currentBid = null;
let currentAsk = null;
let bars5m = [];

async function main() {
  console.log('='.repeat(60));
  console.log('  ENTRY VERIFICATION TEST');
  console.log('  Pair:', PAIR);
  console.log('  Execute:', PLACE_ORDER ? 'YES' : 'NO (dry run)');
  console.log('='.repeat(60));
  console.log('');

  // Connect to IBKR
  console.log('[1] Connecting to IBKR...');

  await new Promise((resolve, reject) => {
    ib.once(EventName.connected, resolve);
    ib.once(EventName.error, reject);
    ib.connect();
  });

  console.log('    Connected!\n');

  // Get current market price
  console.log('[2] Getting current market price...');

  const contract = {
    symbol: config.symbol,
    secType: SecType.CASH,
    currency: config.currency,
    exchange: config.exchange,
  };

  await new Promise((resolve) => {
    ib.on(EventName.tickPrice, (reqId, tickType, price) => {
      if (reqId !== 1) return;
      if (tickType === 1) currentBid = price;  // Bid
      if (tickType === 2) currentAsk = price;  // Ask
      if (currentBid && currentAsk) resolve();
    });

    ib.reqMktData(1, contract, '', false, false);

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!currentBid || !currentAsk) {
        console.log('    Warning: Market data timeout, using fallback...');
        resolve();
      }
    }, 5000);
  });

  const midPrice = currentBid && currentAsk ? (currentBid + currentAsk) / 2 : null;

  console.log('    Bid:', currentBid?.toFixed(5) || 'N/A');
  console.log('    Ask:', currentAsk?.toFixed(5) || 'N/A');
  console.log('    Mid:', midPrice?.toFixed(5) || 'N/A');
  console.log('');

  // Get historical bars for AI
  console.log('[3] Fetching historical data for AI...');

  bars5m = await new Promise((resolve, reject) => {
    const collectedBars = [];

    ib.on(EventName.historicalData, (reqId, time, open, high, low, close, volume) => {
      if (reqId !== 2) return;
      if (time.startsWith('finished')) {
        resolve(collectedBars);
        return;
      }
      // Parse time for _d property (needed by indicators)
      // Format: "20260226 13:30:00 US/Eastern" or "20260226 13:30:00"
      const timeClean = time.replace(/ US\/Eastern$/, '').replace(/ [A-Za-z]+\/[A-Za-z]+$/, '');
      const parts = timeClean.split(' ');
      const datePart = parts[0];
      const timePart = parts[1] || '00:00:00';
      const year = parseInt(datePart.slice(0, 4));
      const month = parseInt(datePart.slice(4, 6)) - 1;
      const day = parseInt(datePart.slice(6, 8));
      const [hour, minute] = timePart.split(':').map(Number);
      const barDate = new Date(Date.UTC(year, month, day, hour, minute, 0));

      collectedBars.push({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        _d: barDate,
        _t: barDate.getTime(),
      });
    });

    ib.reqHistoricalData(
      2,
      contract,
      '',
      '2 D',
      '5 mins',
      'MIDPOINT',
      1,
      1,
      false
    );

    setTimeout(() => reject(new Error('Historical data timeout')), 30000);
  });

  console.log(`    Got ${bars5m.length} bars`);
  const lastBar = bars5m[bars5m.length - 1];
  console.log(`    Last bar: ${lastBar.time} | Close: ${lastBar.close.toFixed(5)}`);
  console.log('');

  // Run AI strategy selector
  console.log('[4] Running AI strategy selector...');

  const bars30m = aggregate30mBars(bars5m.slice(-90));
  const idx = bars5m.length - 1;
  const indicators = computeIndicators(bars5m, bars30m, idx);
  const selector = strategySelectors[PAIR];

  console.log('    Current price (last bar close):', lastBar.close.toFixed(5));
  console.log('    Calling AI...');

  // Build context like live_trader.js does
  const context = {
    prices_5m: bars5m.map(b => b.close),
    highs_5m: bars5m.map(b => b.high),
    lows_5m: bars5m.map(b => b.low),
    prices_30m: bars30m.map(b => b.close),
    highs_30m: bars30m.map(b => b.high),
    lows_30m: bars30m.map(b => b.low),
    ranges_30m: bars30m.map(b => b.high - b.low),
  };

  const currentBar = {
    open: lastBar.open,
    high: lastBar.high,
    low: lastBar.low,
    close: lastBar.close,
  };

  const rawDecision = await selector.callStrategyTradeDecision({
    context,
    indicators,
    currentBar,
    waitCount: 0,
    mustTrade: false,
    waitHistory: [],
  });

  // Validate decision
  const decision = rawDecision.action === 'WAIT'
    ? rawDecision
    : selector.validateDecision(rawDecision, lastBar.close, indicators);

  console.log('');
  console.log('    === AI RAW DECISION ===');
  console.log('    Raw:', JSON.stringify(rawDecision, null, 2).substring(0, 500));
  console.log('');
  console.log('    === AI VALIDATED DECISION ===');
  console.log('    Action:', decision.action);

  if (decision.action === 'TRADE' || decision.side) {
    console.log('    Side:', decision.side);
    console.log('    Planned Entry:', decision.entry.toFixed(5));
    console.log('    Stop Loss:', decision.sl.toFixed(5));
    console.log('    Take Profit:', decision.tp.toFixed(5));
    console.log('    Risk:', decision.risk);

    // Calculate differences
    const currentPrice = midPrice || lastBar.close;
    const entryDiff = (decision.entry - currentPrice) * config.pipMult;

    console.log('');
    console.log('    === COMPARISON ===');
    console.log('    Current Market Price:', currentPrice.toFixed(5));
    console.log('    AI Planned Entry:    ', decision.entry.toFixed(5));
    console.log('    Difference:          ', entryDiff.toFixed(1), 'pips');

    if (decision.side === 'LONG') {
      if (entryDiff < -1) {
        console.log('    >> AI wants to buy BELOW current (pullback entry)');
      } else if (entryDiff > 1) {
        console.log('    >> AI wants to buy ABOVE current (breakout entry)');
      } else {
        console.log('    >> AI entry is at current market');
      }
    } else {
      if (entryDiff > 1) {
        console.log('    >> AI wants to sell ABOVE current (rally entry)');
      } else if (entryDiff < -1) {
        console.log('    >> AI wants to sell BELOW current (breakdown entry)');
      } else {
        console.log('    >> AI entry is at current market');
      }
    }

    // Calculate R:R at planned vs at market
    const plannedRisk = Math.abs(decision.entry - decision.sl) * config.pipMult;
    const plannedReward = Math.abs(decision.tp - decision.entry) * config.pipMult;
    const plannedRR = plannedReward / plannedRisk;

    const marketRisk = Math.abs(currentPrice - decision.sl) * config.pipMult;
    const marketReward = Math.abs(decision.tp - currentPrice) * config.pipMult;
    const marketRR = marketReward / marketRisk;

    console.log('');
    console.log('    === R:R ANALYSIS ===');
    console.log('    At PLANNED entry:', plannedReward.toFixed(1), 'pip reward /', plannedRisk.toFixed(1), 'pip risk = ', plannedRR.toFixed(2), 'R:R');
    console.log('    At MARKET entry: ', marketReward.toFixed(1), 'pip reward /', marketRisk.toFixed(1), 'pip risk = ', marketRR.toFixed(2), 'R:R');

    if (marketRR < plannedRR * 0.5) {
      console.log('    >> WARNING: Market entry R:R is less than half of planned!');
    }

    // Place order if requested
    if (PLACE_ORDER) {
      console.log('');
      console.log('[5] PLACING LIMIT ORDER (as AI intended)...');
      console.log('    Entry price:', decision.entry.toFixed(5));

      const result = await orderExecutor.enterTradeLimit(
        PAIR,
        decision.side,
        POSITION_SIZE,
        decision.entry,  // LIMIT order at AI's planned entry!
        decision.tp,
        decision.sl
      );

      console.log('    Order result:', JSON.stringify(result, null, 2));

      if (result.success) {
        console.log('');
        console.log('    === LIMIT ORDER PLACED ===');
        console.log('    Entry Order ID:', result.entryOrderId);
        console.log('    Limit Price:   ', result.entryPrice.toFixed(5));
        console.log('    TP Order ID:   ', result.takeProfitOrderId);
        console.log('    SL Order ID:   ', result.stopLossOrderId);
        console.log('');
        console.log('    >> Order is PENDING - will fill when price reaches', decision.entry.toFixed(5));
        console.log('    >> R:R preserved at', plannedRR.toFixed(2));

        // Cancel the test order
        console.log('');
        console.log('    Cancelling test order in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));

        const cancelResult = await orderExecutor.cancelOrder(result.entryOrderId);
        console.log('    Cancel result:', JSON.stringify(cancelResult, null, 2));
      }
    }
  } else {
    console.log('    Reasoning:', decision.reasoning?.substring(0, 100) + '...');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  TEST COMPLETE');
  console.log('='.repeat(60));

  ib.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  ib.disconnect();
  process.exit(1);
});
