/**
 * Test OANDA Limit Order Placement
 *
 * Places a small limit order to verify the integration works.
 * Usage: node test_oanda_limit.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const oanda = require('../src/oanda_executor');

async function testLimitOrder() {
  console.log('='.repeat(50));
  console.log('OANDA Limit Order Test');
  console.log('='.repeat(50));
  console.log('');

  // 1. Get current EUR/USD price
  console.log('[1] Getting current EUR/USD price...');
  const price = await oanda.getPrice('EURUSD');

  if (!price.success) {
    console.error('Failed to get price:', price.error);
    return;
  }

  console.log(`    Bid: ${price.bid}`);
  console.log(`    Ask: ${price.ask}`);
  console.log('');

  // 2. Calculate limit order prices
  // For a BUY limit: price below current ask (we want to buy cheaper)
  // Set entry 10 pips below ask, TP 20 pips above entry, SL 10 pips below entry
  const entryPrice = price.bid - 0.0010;  // 10 pips below bid
  const takeProfit = entryPrice + 0.0020;  // 20 pips above entry
  const stopLoss = entryPrice - 0.0010;    // 10 pips below entry

  console.log('[2] Calculated order levels:');
  console.log(`    Entry (LIMIT BUY): ${entryPrice.toFixed(5)}`);
  console.log(`    Take Profit: ${takeProfit.toFixed(5)}`);
  console.log(`    Stop Loss: ${stopLoss.toFixed(5)}`);
  console.log('');

  // 3. Place limit order (small size: 1000 units = micro lot)
  console.log('[3] Placing LIMIT BUY order (1000 units)...');
  const result = await oanda.enterTradeLimit(
    'EURUSD',
    'LONG',
    1000,        // Small size for testing
    entryPrice,
    takeProfit,
    stopLoss
  );

  console.log('');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('');

  if (result.success) {
    console.log('[4] Order placed successfully!');

    if (result.pending) {
      console.log(`    Status: PENDING`);
      console.log(`    Order ID: ${result.entryOrderId}`);
      console.log('');

      // Cancel the test order
      console.log('[5] Cancelling test order...');
      const cancelResult = await oanda.cancelOrder(result.entryOrderId);
      console.log('    Cancel result:', cancelResult.success ? 'SUCCESS' : cancelResult.error);
    } else if (result.filled) {
      console.log(`    Status: FILLED (price was already at limit level)`);
      console.log(`    Fill Price: ${result.entryPrice}`);
      console.log(`    Trade ID: ${result.tradeId}`);
      console.log('');

      // Close the position
      console.log('[5] Closing test position...');
      const closeResult = await oanda.exitTrade('EURUSD');
      console.log('    Close result:', closeResult.success ? `SUCCESS @ ${closeResult.avgPrice}` : closeResult.error);
    }
  } else {
    console.log('[4] Order FAILED:', result.error);
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('Test complete!');
  console.log('='.repeat(50));
}

testLimitOrder().catch(console.error);
