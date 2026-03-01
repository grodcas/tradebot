/**
 * Test 1K Unit Order on OANDA
 * Verifies the new position size works correctly
 */

require('dotenv').config();
const oanda = require('./oanda_executor');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log('  Testing 1,000 Unit Order');
  console.log('========================================\n');

  // Get account before
  const before = await oanda.getAccountSummary();
  if (!before.success) {
    console.log('Failed to connect:', before.error);
    return;
  }
  console.log(`Account: ${before.accountId}`);
  console.log(`Balance Before: ${before.balance.toFixed(2)} ${before.currency}\n`);

  // Get current price
  const price = await oanda.getPrice('EURUSD');
  if (!price.success) {
    console.log('Failed to get price');
    return;
  }

  const currentPrice = (price.bid + price.ask) / 2;
  console.log(`Current EUR/USD: ${currentPrice.toFixed(5)}`);
  console.log(`Spread: ${((price.ask - price.bid) * 10000).toFixed(1)} pips\n`);

  // Calculate TP and SL for a LONG trade
  const entry = currentPrice;
  const tp = entry + 0.0020;  // 20 pips TP
  const sl = entry - 0.0015;  // 15 pips SL

  console.log('--- Placing LIMIT LONG Order ---');
  console.log(`Size: 1,000 units`);
  console.log(`Entry: ${entry.toFixed(5)} (limit)`);
  console.log(`TP: ${tp.toFixed(5)} (+20 pips = ~$2.00 profit)`);
  console.log(`SL: ${sl.toFixed(5)} (-15 pips = ~$1.50 loss)`);
  console.log('');

  // Place the order
  const result = await oanda.enterTradeLimit('EURUSD', 'LONG', 1000, entry, tp, sl);

  if (result.success) {
    console.log('✅ Order placed successfully!');
    console.log(`   Order ID: ${result.entryOrderId}`);
    console.log(`   Filled: ${result.filled ? 'YES at ' + result.entryPrice : 'PENDING'}`);
    if (result.tradeId) {
      console.log(`   Trade ID: ${result.tradeId}`);
    }

    // Wait and check status
    await sleep(2000);

    // Get open trades
    const trades = await oanda.getOpenTrades();
    if (trades.success && trades.trades.length > 0) {
      console.log('\n--- Open Trades ---');
      for (const t of trades.trades) {
        console.log(`   ${t.instrument}: ${t.units > 0 ? 'LONG' : 'SHORT'} ${Math.abs(t.units)} units @ ${t.price}`);
        console.log(`   TP: ${t.takeProfitPrice || 'N/A'} | SL: ${t.stopLossPrice || 'N/A'}`);
        console.log(`   Unrealized P&L: $${t.unrealizedPL.toFixed(2)}`);
      }
    }

    // Ask to close
    console.log('\n--- Closing test position ---');
    await sleep(1000);
    const closeResult = await oanda.exitTrade('EURUSD');

    if (closeResult.success) {
      console.log(`✅ Position closed at ${closeResult.avgPrice || 'N/A'}`);
      if (closeResult.realizedPL !== undefined) {
        console.log(`   Realized P&L: $${closeResult.realizedPL.toFixed(2)}`);
      }
    } else {
      console.log(`   Close result: ${closeResult.message || closeResult.error}`);
    }

  } else {
    console.log('❌ Order failed:', result.error);
  }

  // Get account after
  await sleep(1000);
  const after = await oanda.getAccountSummary();
  if (after.success) {
    console.log(`\nBalance After: ${after.balance.toFixed(2)} ${after.currency}`);
    const diff = after.balance - before.balance;
    console.log(`Change: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ${after.currency}`);
  }

  console.log('\n========================================');
  console.log('  Test Complete');
  console.log('========================================');
  console.log('\nExpected results with 1,000 units:');
  console.log('  - 20 pip TP = ~$2.00 profit');
  console.log('  - 15 pip SL = ~$1.50 loss');
  console.log('  - Spread cost = ~$0.09 (0.9 pips)');
}

main().catch(console.error);
