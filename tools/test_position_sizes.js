/**
 * Test Position Sizes on OANDA Paper Account
 *
 * Tests:
 * 1. Minimum order size
 * 2. Spread cost as % of position at different sizes
 * 3. Order execution at various sizes
 */

require('dotenv').config();
const oanda = require('./oanda_executor');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMinimumSize() {
  console.log('\n=== TEST 1: MINIMUM ORDER SIZE ===\n');

  const testSizes = [1, 10, 100, 500, 1000, 5000, 10000];
  const results = [];

  for (const size of testSizes) {
    console.log(`Testing ${size} units...`);

    try {
      // Place a market buy order
      const result = await oanda.enterTrade('EURUSD', 'LONG', size, 1.5, 1.0);

      if (result.success) {
        console.log(`  ✅ ${size} units: SUCCESS - filled at ${result.entryPrice}`);
        results.push({ size, success: true, price: result.entryPrice });

        // Close the position immediately
        await sleep(500);
        const closeResult = await oanda.exitTrade('EURUSD');
        console.log(`  Closed at ${closeResult.avgPrice || 'N/A'}`);
      } else {
        console.log(`  ❌ ${size} units: FAILED - ${result.error}`);
        results.push({ size, success: false, error: result.error });
      }
    } catch (err) {
      console.log(`  ❌ ${size} units: ERROR - ${err.message}`);
      results.push({ size, success: false, error: err.message });
    }

    await sleep(1000);
  }

  console.log('\n--- Minimum Size Results ---');
  const minSuccessful = results.find(r => r.success);
  console.log(`Minimum successful order: ${minSuccessful ? minSuccessful.size + ' units' : 'None succeeded'}`);

  return results;
}

async function testSpreadImpact() {
  console.log('\n=== TEST 2: SPREAD IMPACT AT DIFFERENT SIZES ===\n');

  // Get current price
  const price = await oanda.getPrice('EURUSD');
  if (!price.success) {
    console.log('Failed to get price');
    return;
  }

  const bid = price.bid;
  const ask = price.ask;
  const spread = ask - bid;
  const spreadPips = spread * 10000;

  console.log(`Current EUR/USD:`);
  console.log(`  Bid: ${bid.toFixed(5)}`);
  console.log(`  Ask: ${ask.toFixed(5)}`);
  console.log(`  Spread: ${spread.toFixed(5)} (${spreadPips.toFixed(1)} pips)`);

  // Calculate spread cost at different position sizes
  const sizes = [100, 1000, 5000, 10000, 20000, 50000, 100000];

  console.log('\n--- Spread Cost Analysis ---');
  console.log('Size (units) | Spread Cost | % of 20 pip profit | % of 10 pip profit');
  console.log('-------------|-------------|-------------------|-------------------');

  for (const size of sizes) {
    // Spread cost = spread × units
    const spreadCost = spread * size;

    // Potential profit for 20 pips
    const profit20pips = 0.0020 * size;  // 20 pips = 0.0020
    const profit10pips = 0.0010 * size;  // 10 pips = 0.0010

    const spreadPct20 = (spreadCost / profit20pips * 100).toFixed(1);
    const spreadPct10 = (spreadCost / profit10pips * 100).toFixed(1);

    console.log(`${size.toString().padStart(12)} | $${spreadCost.toFixed(2).padStart(10)} | ${spreadPct20.padStart(17)}% | ${spreadPct10.padStart(17)}%`);
  }

  console.log('\nNote: Spread cost is the same percentage regardless of size!');
  console.log('The spread is a fixed % of the trade, not a fixed $ amount.');
}

async function testRoundTripCost() {
  console.log('\n=== TEST 3: ACTUAL ROUND-TRIP COST ===\n');

  const testSizes = [1000, 10000, 50000];

  for (const size of testSizes) {
    console.log(`\nTesting round-trip with ${size} units...`);

    try {
      // Get price before
      const priceBefore = await oanda.getPrice('EURUSD');
      console.log(`  Price before: Bid=${priceBefore.bid.toFixed(5)} Ask=${priceBefore.ask.toFixed(5)}`);

      // Buy
      const buyResult = await oanda.enterTrade('EURUSD', 'LONG', size, 1.5, 1.0);
      if (!buyResult.success) {
        console.log(`  Buy failed: ${buyResult.error}`);
        continue;
      }
      console.log(`  Bought at: ${buyResult.entryPrice}`);

      await sleep(500);

      // Sell immediately
      const sellResult = await oanda.exitTrade('EURUSD');
      const exitPrice = sellResult.avgPrice || priceBefore.bid;
      console.log(`  Sold at: ${exitPrice}`);

      // Calculate actual cost
      const priceDiff = exitPrice - buyResult.entryPrice;
      const actualCost = priceDiff * size;
      const costInPips = priceDiff * 10000;

      console.log(`  Round-trip cost: $${Math.abs(actualCost).toFixed(2)} (${Math.abs(costInPips).toFixed(1)} pips)`);

      // Get account to see real P&L
      await sleep(500);

    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }

    await sleep(1000);
  }
}

async function testAccountAfter() {
  console.log('\n=== ACCOUNT STATUS AFTER TESTS ===\n');

  const summary = await oanda.getAccountSummary();
  if (summary.success) {
    console.log(`Account: ${summary.accountId}`);
    console.log(`Balance: ${summary.balance.toFixed(2)} ${summary.currency}`);
    console.log(`NAV: ${summary.nav.toFixed(2)}`);
    console.log(`Unrealized P&L: ${summary.unrealizedPL.toFixed(2)}`);
    console.log(`Open Trades: ${summary.openTradeCount}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('  OANDA Position Size Test');
  console.log('========================================');

  // Check connection
  const summary = await oanda.getAccountSummary();
  if (!summary.success) {
    console.log('Failed to connect to OANDA:', summary.error);
    return;
  }

  console.log(`\nConnected to: ${summary.accountId}`);
  console.log(`Starting Balance: ${summary.balance.toFixed(2)} ${summary.currency}`);

  // Run tests
  await testMinimumSize();
  await testSpreadImpact();
  await testRoundTripCost();
  await testAccountAfter();

  console.log('\n========================================');
  console.log('  Tests Complete');
  console.log('========================================\n');
}

main().catch(console.error);
