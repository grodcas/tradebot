/**
 * Order Executor - Node.js wrapper for IBKR Python executor
 *
 * Provides async interface to place real orders through IBKR TWS/Gateway.
 */

const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(__dirname, 'ibkr_executor.py');

/**
 * Execute a command through the Python IBKR executor
 * @param {string[]} args - Command arguments
 * @returns {Promise<object>} - JSON result from executor
 */
function executeCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [PYTHON_SCRIPT, ...args], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (stderr) {
        console.error('[EXECUTOR STDERR]', stderr.trim());
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse executor output: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Get current position for a currency pair
 * @param {string} base - Base currency (e.g., "EUR")
 * @param {string} quote - Quote currency (e.g., "USD")
 */
async function getPosition(base, quote) {
  return executeCommand(['position', base, quote]);
}

/**
 * Place a market buy order
 * @param {string} base - Base currency
 * @param {string} quote - Quote currency
 * @param {number} quantity - Order size
 */
async function marketBuy(base, quote, quantity) {
  return executeCommand(['buy', base, quote, quantity.toString()]);
}

/**
 * Place a market sell order
 * @param {string} base - Base currency
 * @param {string} quote - Quote currency
 * @param {number} quantity - Order size
 */
async function marketSell(base, quote, quantity) {
  return executeCommand(['sell', base, quote, quantity.toString()]);
}

/**
 * Place a bracket order (limit entry + TP + SL)
 * @param {string} base - Base currency
 * @param {string} quote - Quote currency
 * @param {string} action - "BUY" or "SELL"
 * @param {number} quantity - Order size
 * @param {number} entryPrice - Limit entry price
 * @param {number} takeProfit - Take profit price
 * @param {number} stopLoss - Stop loss price
 */
async function bracketOrder(base, quote, action, quantity, entryPrice, takeProfit, stopLoss) {
  return executeCommand([
    'bracket', base, quote, action,
    quantity.toString(),
    entryPrice.toString(),
    takeProfit.toString(),
    stopLoss.toString()
  ]);
}

/**
 * Place a market entry with attached TP and SL orders
 * @param {string} base - Base currency
 * @param {string} quote - Quote currency
 * @param {string} action - "BUY" or "SELL"
 * @param {number} quantity - Order size
 * @param {number} takeProfit - Take profit price
 * @param {number} stopLoss - Stop loss price
 */
async function marketEntryWithBracket(base, quote, action, quantity, takeProfit, stopLoss) {
  return executeCommand([
    'market_bracket', base, quote, action,
    quantity.toString(),
    takeProfit.toString(),
    stopLoss.toString()
  ]);
}

/**
 * Close entire position for a currency pair
 * @param {string} base - Base currency
 * @param {string} quote - Quote currency
 */
async function closePosition(base, quote) {
  return executeCommand(['close', base, quote]);
}

/**
 * Cancel a specific order
 * @param {number} orderId - Order ID to cancel
 */
async function cancelOrder(orderId) {
  return executeCommand(['cancel', orderId.toString()]);
}

/**
 * Cancel all open orders
 */
async function cancelAllOrders() {
  return executeCommand(['cancel_all']);
}

/**
 * Parse pair code (e.g., "EURUSD") into base/quote currencies
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY", "GBPUSD"
 */
function parsePairCode(pairCode) {
  // Handle special cases
  if (pairCode.includes('_')) {
    pairCode = pairCode.split('_')[0]; // Remove suffixes like "_GPT5"
  }

  // Standard forex pairs
  const pairs = {
    'EURUSD': { base: 'EUR', quote: 'USD' },
    'USDJPY': { base: 'USD', quote: 'JPY' },
    'GBPUSD': { base: 'GBP', quote: 'USD' },
    'USDCHF': { base: 'USD', quote: 'CHF' },
    'AUDUSD': { base: 'AUD', quote: 'USD' },
    'USDCAD': { base: 'USD', quote: 'CAD' },
    'NZDUSD': { base: 'NZD', quote: 'USD' },
    'EURGBP': { base: 'EUR', quote: 'GBP' },
    'EURJPY': { base: 'EUR', quote: 'JPY' },
    'GBPJPY': { base: 'GBP', quote: 'JPY' },
  };

  if (pairs[pairCode]) {
    return pairs[pairCode];
  }

  // Try to parse automatically (first 3 chars = base, last 3 = quote)
  if (pairCode.length === 6) {
    return {
      base: pairCode.substring(0, 3),
      quote: pairCode.substring(3, 6),
    };
  }

  throw new Error(`Unknown pair code: ${pairCode}`);
}

/**
 * High-level function to enter a trade with TP and SL (MARKET order - immediate fill)
 * Used by live_trader.js
 *
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY"
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} quantity - Order size (in base currency units)
 * @param {number} takeProfit - Take profit price
 * @param {number} stopLoss - Stop loss price
 */
async function enterTrade(pairCode, side, quantity, takeProfit, stopLoss) {
  const { base, quote } = parsePairCode(pairCode);
  const action = side === 'LONG' ? 'BUY' : 'SELL';

  console.log(`[EXECUTOR] Entering ${side} ${quantity} ${base}/${quote} TP=${takeProfit} SL=${stopLoss}`);

  const result = await marketEntryWithBracket(base, quote, action, quantity, takeProfit, stopLoss);

  if (result.success) {
    console.log(`[EXECUTOR] Entry filled at ${result.entryPrice}`);
  } else {
    console.error(`[EXECUTOR] Entry failed:`, result.error);
  }

  return result;
}

/**
 * High-level function to enter a trade with LIMIT order + TP and SL
 * This places a limit order at the specified entry price.
 * The order will only fill when price reaches the entry level.
 * TP and SL orders are attached and activate when entry fills.
 *
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY"
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} quantity - Order size (in base currency units)
 * @param {number} entryPrice - Limit entry price
 * @param {number} takeProfit - Take profit price
 * @param {number} stopLoss - Stop loss price
 */
async function enterTradeLimit(pairCode, side, quantity, entryPrice, takeProfit, stopLoss) {
  const { base, quote } = parsePairCode(pairCode);
  const action = side === 'LONG' ? 'BUY' : 'SELL';

  console.log(`[EXECUTOR] Placing LIMIT ${side} ${quantity} ${base}/${quote} @ ${entryPrice} TP=${takeProfit} SL=${stopLoss}`);

  const result = await bracketOrder(base, quote, action, quantity, entryPrice, takeProfit, stopLoss);

  if (result.success) {
    console.log(`[EXECUTOR] LIMIT order placed - Entry: ${result.entryOrderId}, TP: ${result.takeProfitOrderId}, SL: ${result.stopLossOrderId}`);
  } else {
    console.error(`[EXECUTOR] LIMIT order failed:`, result.error);
  }

  return result;
}

/**
 * High-level function to exit a trade
 * Closes the entire position for the pair
 *
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY"
 */
async function exitTrade(pairCode) {
  const { base, quote } = parsePairCode(pairCode);

  console.log(`[EXECUTOR] Closing position for ${base}/${quote}`);

  const result = await closePosition(base, quote);

  if (result.success) {
    console.log(`[EXECUTOR] Position closed at ${result.avgPrice || 'N/A'}`);
  } else {
    console.error(`[EXECUTOR] Close failed:`, result.error);
  }

  return result;
}

/**
 * Get current position for a pair
 * @param {string} pairCode - e.g., "EURUSD"
 */
async function getTradePosition(pairCode) {
  const { base, quote } = parsePairCode(pairCode);
  return getPosition(base, quote);
}

module.exports = {
  // Low-level API
  getPosition,
  marketBuy,
  marketSell,
  bracketOrder,
  marketEntryWithBracket,
  closePosition,
  cancelOrder,
  cancelAllOrders,

  // High-level API for live_trader
  enterTrade,        // Market entry (immediate fill)
  enterTradeLimit,   // Limit entry (waits for price)
  exitTrade,
  getTradePosition,
  parsePairCode,
};

// Test if run directly
if (require.main === module) {
  (async () => {
    console.log('Testing order executor...\n');

    // Test position check
    console.log('Getting EUR/USD position:');
    const pos = await getPosition('EUR', 'USD');
    console.log(pos);

    console.log('\nExecutor module ready!');
  })();
}
