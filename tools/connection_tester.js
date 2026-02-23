/**
 * IBKR Connection Tester
 *
 * Tests all components needed for live trading:
 * 1. Connection to IB Gateway
 * 2. Market data retrieval
 * 3. Real-time data subscription
 * 4. Order placement (paper)
 * 5. Order cancellation/close
 *
 * Usage: node connection_tester.js
 */

const { IBApi, EventName, OrderAction, OrderType, SecType } = require('@stoqey/ib');
const readline = require('readline');

// ----------------------------
// CONFIG
// ----------------------------
const IBKR_HOST = '127.0.0.1';
const IBKR_PORT = 4002;  // 4002 = IB Gateway Paper, 7497 = TWS Paper
const CLIENT_ID = 999;   // Use different ID than live trader

// ----------------------------
// GLOBALS
// ----------------------------
let ib = null;
let nextOrderId = null;
let testOrderId = null;
let currentStep = 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ----------------------------
// HELPERS
// ----------------------------
function log(msg) {
  console.log(`[TEST] ${msg}`);
}

function success(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
}

function info(msg) {
  console.log(`  → ${msg}`);
}

function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim().toLowerCase()));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------
// CONTRACT
// ----------------------------
const eurusdContract = {
  symbol: 'EUR',
  secType: 'CASH',
  currency: 'USD',
  exchange: 'IDEALPRO',
};

// ----------------------------
// TEST 1: CONNECTION
// ----------------------------
async function testConnection() {
  log('\n═══════════════════════════════════════');
  log('TEST 1: Connection to IB Gateway');
  log('═══════════════════════════════════════');

  info(`Connecting to ${IBKR_HOST}:${IBKR_PORT}...`);

  return new Promise((resolve, reject) => {
    ib = new IBApi({
      clientId: CLIENT_ID,
      host: IBKR_HOST,
      port: IBKR_PORT,
    });

    const timeout = setTimeout(() => {
      fail('Connection timeout after 10 seconds');
      info('Make sure IB Gateway is running and logged in');
      info('Check that API connections are enabled in Gateway settings');
      reject(new Error('Connection timeout'));
    }, 10000);

    ib.on(EventName.connected, () => {
      clearTimeout(timeout);
      success('Connected to IB Gateway');
      resolve();
    });

    ib.on(EventName.nextValidId, (id) => {
      nextOrderId = id;
      success(`Received next valid order ID: ${id}`);
    });

    ib.on(EventName.error, (err, code, reqId) => {
      if (err.message?.includes('connection is OK')) return;
      if (code === 2104 || code === 2106 || code === 2158) {
        // Market data farm connection messages - not errors
        info(`Market data: ${err.message}`);
        return;
      }
      console.log(`  ! Error [${code}]: ${err.message}`);
    });

    ib.connect();
  });
}

// ----------------------------
// TEST 2: ACCOUNT INFO
// ----------------------------
async function testAccountInfo() {
  log('\n═══════════════════════════════════════');
  log('TEST 2: Account Information');
  log('═══════════════════════════════════════');

  return new Promise((resolve) => {
    let accountReceived = false;

    const onAccountSummary = (reqId, account, tag, value, currency) => {
      if (!accountReceived) {
        accountReceived = true;
        success(`Account: ${account}`);
      }
      if (tag === 'NetLiquidation') {
        info(`Net Liquidation: ${value} ${currency}`);
      }
      if (tag === 'TotalCashValue') {
        info(`Cash Value: ${value} ${currency}`);
      }
    };

    ib.on(EventName.accountSummary, onAccountSummary);

    ib.reqAccountSummary(3001, 'All', 'NetLiquidation,TotalCashValue,AccountType');

    setTimeout(() => {
      ib.off(EventName.accountSummary, onAccountSummary);
      ib.cancelAccountSummary(3001);
      if (accountReceived) {
        success('Account info retrieved');
      } else {
        fail('No account info received');
      }
      resolve();
    }, 3000);
  });
}

// ----------------------------
// TEST 3: HISTORICAL DATA
// ----------------------------
async function testHistoricalData() {
  log('\n═══════════════════════════════════════');
  log('TEST 3: Historical Market Data');
  log('═══════════════════════════════════════');

  info('Requesting last 10 bars of EUR/USD 5-minute data...');

  return new Promise((resolve) => {
    const reqId = 4001;
    let barCount = 0;
    let lastBar = null;

    const onHistoricalData = (id, time, open, high, low, close) => {
      if (id !== reqId) return;

      if (time.startsWith('finished')) {
        ib.off(EventName.historicalData, onHistoricalData);
        if (barCount > 0) {
          success(`Received ${barCount} historical bars`);
          info(`Last bar: ${lastBar.time} | Close: ${lastBar.close}`);
        } else {
          fail('No historical data received');
        }
        resolve();
        return;
      }

      barCount++;
      lastBar = { time, open, high, low, close };
    };

    ib.on(EventName.historicalData, onHistoricalData);

    ib.reqHistoricalData(
      reqId,
      eurusdContract,
      '',  // endDateTime (empty = now)
      '1 D',  // duration
      '5 mins',  // bar size
      'MIDPOINT',
      1,
      1,
      false
    );

    setTimeout(() => {
      ib.off(EventName.historicalData, onHistoricalData);
      if (barCount === 0) {
        fail('Historical data timeout');
      }
      resolve();
    }, 15000);
  });
}

// ----------------------------
// TEST 4: REAL-TIME DATA
// ----------------------------
async function testRealtimeData() {
  log('\n═══════════════════════════════════════');
  log('TEST 4: Real-Time Market Data');
  log('═══════════════════════════════════════');

  info('Subscribing to real-time EUR/USD data (5 seconds)...');

  return new Promise((resolve) => {
    const reqId = 5001;
    let tickCount = 0;
    let lastPrice = null;

    const onRealtimeBar = (id, time, open, high, low, close) => {
      if (id !== reqId) return;
      tickCount++;
      lastPrice = close;
      if (tickCount <= 3) {
        info(`Real-time bar: ${new Date(time * 1000).toISOString()} | Close: ${close}`);
      }
    };

    ib.on(EventName.realtimeBar, onRealtimeBar);

    ib.reqRealTimeBars(
      reqId,
      eurusdContract,
      5,  // 5-second bars
      'MIDPOINT',
      false
    );

    setTimeout(() => {
      ib.cancelRealTimeBars(reqId);
      ib.off(EventName.realtimeBar, onRealtimeBar);

      if (tickCount > 0) {
        success(`Received ${tickCount} real-time bars`);
        info(`Last price: ${lastPrice}`);
      } else {
        fail('No real-time data received');
        info('This might be normal outside market hours');
      }
      resolve();
    }, 8000);
  });
}

// ----------------------------
// TEST 5: PLACE ORDER
// ----------------------------
async function testPlaceOrder() {
  log('\n═══════════════════════════════════════');
  log('TEST 5: Place Test Order (Paper Account)');
  log('═══════════════════════════════════════');

  const answer = await prompt('\nPlace a test LIMIT order? (y/n): ');
  if (answer !== 'y') {
    info('Skipping order test');
    return;
  }

  if (!nextOrderId) {
    fail('No valid order ID available');
    return;
  }

  info('Placing a BUY LIMIT order far from market (will not fill)...');
  info('Order: BUY 20000 EUR/USD @ 1.00000 (limit far below market)');

  return new Promise((resolve) => {
    testOrderId = nextOrderId++;

    const order = {
      action: 'BUY',
      totalQuantity: 20000,  // Minimum for EUR/USD
      orderType: 'LMT',
      lmtPrice: 1.00000,  // Far below market - won't fill
      tif: 'GTC',
      transmit: true,
    };

    let orderPlaced = false;
    let orderStatus = null;

    const onOrderStatus = (orderId, status, filled, remaining, avgFillPrice) => {
      if (orderId !== testOrderId) return;
      orderStatus = status;
      info(`Order ${orderId} status: ${status} (filled: ${filled}, remaining: ${remaining})`);

      if (status === 'PreSubmitted' || status === 'Submitted') {
        if (!orderPlaced) {
          orderPlaced = true;
          success('Order placed successfully');
        }
      }
    };

    const onOpenOrder = (orderId, contract, order, orderState) => {
      if (orderId !== testOrderId) return;
      info(`Order ${orderId} state: ${orderState.status}`);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.openOrder, onOpenOrder);

    ib.placeOrder(testOrderId, eurusdContract, order);

    setTimeout(() => {
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.openOrder, onOpenOrder);

      if (orderPlaced) {
        success('Order placement test passed');
      } else {
        fail('Order was not confirmed');
        info('Check TWS/Gateway for any error messages');
      }
      resolve();
    }, 5000);
  });
}

// ----------------------------
// TEST 6: CANCEL ORDER
// ----------------------------
async function testCancelOrder() {
  log('\n═══════════════════════════════════════');
  log('TEST 6: Cancel Test Order');
  log('═══════════════════════════════════════');

  if (!testOrderId) {
    info('No order to cancel (order test was skipped)');
    return;
  }

  info(`Cancelling order ${testOrderId}...`);

  return new Promise((resolve) => {
    let cancelled = false;

    const onOrderStatus = (orderId, status) => {
      if (orderId !== testOrderId) return;
      if (status === 'Cancelled') {
        cancelled = true;
        success('Order cancelled successfully');
      }
    };

    ib.on(EventName.orderStatus, onOrderStatus);

    ib.cancelOrder(testOrderId);

    setTimeout(() => {
      ib.off(EventName.orderStatus, onOrderStatus);
      if (!cancelled) {
        info('Cancel confirmation not received (may already be cancelled)');
      }
      resolve();
    }, 3000);
  });
}

// ----------------------------
// TEST 7: CHECK POSITIONS
// ----------------------------
async function testPositions() {
  log('\n═══════════════════════════════════════');
  log('TEST 7: Current Positions');
  log('═══════════════════════════════════════');

  return new Promise((resolve) => {
    let positionCount = 0;

    const onPosition = (account, contract, pos, avgCost) => {
      if (pos !== 0) {
        positionCount++;
        info(`Position: ${contract.symbol}/${contract.currency} | Qty: ${pos} | Avg Cost: ${avgCost}`);
      }
    };

    const onPositionEnd = () => {
      ib.off(EventName.position, onPosition);
      ib.off(EventName.positionEnd, onPositionEnd);

      if (positionCount === 0) {
        success('No open positions (clean state)');
      } else {
        info(`Found ${positionCount} open position(s)`);
      }
      resolve();
    };

    ib.on(EventName.position, onPosition);
    ib.on(EventName.positionEnd, onPositionEnd);

    ib.reqPositions();

    setTimeout(() => {
      ib.off(EventName.position, onPosition);
      ib.off(EventName.positionEnd, onPositionEnd);
      resolve();
    }, 5000);
  });
}

// ----------------------------
// SUMMARY
// ----------------------------
function printSummary() {
  log('\n═══════════════════════════════════════');
  log('TEST COMPLETE');
  log('═══════════════════════════════════════');
  console.log(`
If all tests passed, your setup is ready for live_trader.js

Checklist:
  □ IB Gateway running and logged in
  □ API connections enabled (port ${IBKR_PORT})
  □ Paper trading account active
  □ EUR/USD market data subscription (or trial)

To start trading:
  node live_trader.js
`);
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           IBKR CONNECTION TESTER                          ║
║           Testing all components for live trading         ║
╚═══════════════════════════════════════════════════════════╝
`);

  console.log(`Configuration:`);
  console.log(`  Host: ${IBKR_HOST}`);
  console.log(`  Port: ${IBKR_PORT}`);
  console.log(`  Client ID: ${CLIENT_ID}`);
  console.log('');

  const startAnswer = await prompt('Start connection test? (y/n): ');
  if (startAnswer !== 'y') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  try {
    await testConnection();
    await sleep(1000);

    await testAccountInfo();
    await sleep(1000);

    await testHistoricalData();
    await sleep(1000);

    await testRealtimeData();
    await sleep(1000);

    await testPlaceOrder();
    await sleep(1000);

    await testCancelOrder();
    await sleep(1000);

    await testPositions();

    printSummary();

  } catch (err) {
    fail(`Test failed: ${err.message}`);
    console.log('\nTroubleshooting:');
    console.log('  1. Is IB Gateway / TWS running?');
    console.log('  2. Are you logged in to paper account?');
    console.log('  3. Is API enabled? (Configure → Settings → API → Enable)');
    console.log(`  4. Is port ${IBKR_PORT} correct? (Gateway paper = 4002, TWS paper = 7497)`);
    console.log('  5. Is "Allow connections from localhost" checked?');
  } finally {
    if (ib) {
      ib.disconnect();
    }
    rl.close();
  }
}

main();
