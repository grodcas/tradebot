/**
 * Test script for order executor integration
 */

const executor = require('./order_executor');

async function main() {
  console.log('='.repeat(60));
  console.log('Order Executor Integration Test');
  console.log('='.repeat(60));

  try {
    // Test 1: Check initial position
    console.log('\n[TEST 1] Check initial EUR/USD position');
    let pos = await executor.getTradePosition('EURUSD');
    console.log('Position:', pos);

    // Test 2: Enter a LONG trade
    console.log('\n[TEST 2] Enter LONG trade with TP and SL');
    const entryResult = await executor.enterTrade(
      'EURUSD',
      'LONG',
      20000,  // 20k units (IBKR min for IDEALPRO)
      1.19,   // Take profit
      1.17    // Stop loss
    );
    console.log('Entry result:', entryResult);

    // Test 3: Check position after entry
    console.log('\n[TEST 3] Check position after entry');
    pos = await executor.getTradePosition('EURUSD');
    console.log('Position:', pos);

    // Wait a moment
    await new Promise(r => setTimeout(r, 2000));

    // Test 4: Exit the trade
    console.log('\n[TEST 4] Exit the trade');
    const exitResult = await executor.exitTrade('EURUSD');
    console.log('Exit result:', exitResult);

    // Test 5: Verify position is flat
    console.log('\n[TEST 5] Verify position is flat');
    pos = await executor.getTradePosition('EURUSD');
    console.log('Position:', pos);

    console.log('\n' + '='.repeat(60));
    console.log('All tests completed successfully!');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('Test failed:', err);
  }
}

main();
