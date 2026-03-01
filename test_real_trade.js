/**
 * Test Real Trade - Verify IBKR Connection & Permissions
 *
 * Places a small EUR/USD market order to test connectivity.
 * Uses minimum position size.
 */

require('dotenv').config();
const { IBApi, EventName, OrderAction, OrderType, SecType } = require('@stoqey/ib');

const IBKR_HOST = '127.0.0.1';
const IBKR_PORT = 4001;  // Real account
const CLIENT_ID = 200;   // Unique client ID for test

let ib = null;
let nextOrderId = null;

const contract = {
  symbol: 'EUR',
  secType: SecType.CASH,
  currency: 'USD',
  exchange: 'IDEALPRO',
};

// Minimum forex order on IBKR is 20,000 units
// With 100 EUR and ~30:1 leverage, this should be fine
const ORDER_SIZE = 20000;  // Minimum size

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log('   TEST REAL TRADE - IBKR Connection');
  console.log('========================================');
  console.log(`Connecting to IBKR on port ${IBKR_PORT} (REAL account)...`);

  ib = new IBApi({
    clientId: CLIENT_ID,
    host: IBKR_HOST,
    port: IBKR_PORT,
  });

  // Wait for connection
  const connected = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

    ib.on(EventName.connected, () => {
      clearTimeout(timeout);
      console.log('Connected to IBKR Gateway (REAL)');
      resolve(true);
    });

    ib.on(EventName.error, (err, code, reqId) => {
      console.log(`IBKR Error [${code}]: ${err.message}`);
      if (code === 502) {
        reject(new Error('Cannot connect - is IB Gateway running on port 4001?'));
      }
    });

    ib.connect();
  });

  // Get next valid order ID
  await new Promise((resolve) => {
    ib.on(EventName.nextValidId, (orderId) => {
      nextOrderId = orderId;
      console.log(`Next valid order ID: ${nextOrderId}`);
      resolve();
    });
    ib.reqIds();
  });

  await sleep(1000);

  // Place a BUY order
  console.log('\n--- Placing TEST BUY order ---');
  console.log(`Contract: EUR/USD`);
  console.log(`Action: BUY`);
  console.log(`Size: ${ORDER_SIZE} units (minimum)`);
  console.log(`Type: MARKET`);

  const order = {
    action: OrderAction.BUY,
    orderType: OrderType.MKT,
    totalQuantity: ORDER_SIZE,
    transmit: true,
  };

  // Listen for order status
  ib.on(EventName.orderStatus, (orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice) => {
    console.log(`\nOrder ${orderId} Status: ${status}`);
    console.log(`  Filled: ${filled} / ${ORDER_SIZE}`);
    if (avgFillPrice > 0) {
      console.log(`  Avg Fill Price: ${avgFillPrice}`);
    }
    if (status === 'Filled') {
      console.log('\n SUCCESS! Order filled.');
      console.log('Trade executed successfully on REAL account.');
    }
  });

  ib.on(EventName.openOrder, (orderId, contract, order, orderState) => {
    console.log(`\nOpen Order ${orderId}: ${order.action} ${order.totalQuantity} ${contract.symbol}/${contract.currency}`);
    console.log(`  Status: ${orderState.status}`);
    if (orderState.warningText) {
      console.log(`  Warning: ${orderState.warningText}`);
    }
  });

  ib.on(EventName.execDetails, (reqId, contract, execution) => {
    console.log(`\nExecution: ${execution.side} ${execution.shares} @ ${execution.price}`);
    console.log(`  Order ID: ${execution.orderId}`);
    console.log(`  Time: ${execution.time}`);
  });

  // Place the order
  console.log(`\nSubmitting order ID ${nextOrderId}...`);
  ib.placeOrder(nextOrderId, contract, order);

  // Wait for execution
  console.log('\nWaiting for order execution (30 seconds max)...');
  await sleep(30000);

  // Check positions
  console.log('\n--- Checking Positions ---');
  ib.on(EventName.position, (account, contract, pos, avgCost) => {
    console.log(`Position: ${pos} ${contract.symbol}/${contract.currency} @ avg ${avgCost}`);
  });
  ib.on(EventName.positionEnd, () => {
    console.log('Position check complete.');
  });
  ib.reqPositions();

  await sleep(5000);

  console.log('\n========================================');
  console.log('   TEST COMPLETE');
  console.log('========================================');
  console.log('Check your IBKR account to verify the position.');
  console.log('You can close it manually in TWS/Gateway.');

  ib.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  if (ib) ib.disconnect();
  process.exit(1);
});
