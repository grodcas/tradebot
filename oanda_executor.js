/**
 * OANDA Order Executor
 *
 * Provides the same interface as order_executor.js (IBKR) but for OANDA.
 * Can be used as a drop-in replacement.
 *
 * Usage in live_trader.js:
 *   const orderExecutor = require('./oanda_executor');
 *   // or keep: const orderExecutor = require('./order_executor');  // for IBKR
 */

require('dotenv').config();

const OANDA_API_TOKEN = process.env.OANDA_API_TOKEN;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID;
const OANDA_ENVIRONMENT = process.env.OANDA_ENVIRONMENT || 'practice';

const ENDPOINTS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com'
};

const BASE_URL = ENDPOINTS[OANDA_ENVIRONMENT];

/**
 * Make authenticated request to OANDA API
 */
async function oandaRequest(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'UNIX'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.errorMessage || data.rejectReason || JSON.stringify(data);
    throw new Error(`OANDA API Error: ${errorMsg}`);
  }

  return data;
}

/**
 * Convert pair code to OANDA instrument format
 * e.g., "EURUSD" -> "EUR_USD"
 */
function toOandaInstrument(pairCode) {
  // Handle suffixes like "_GPT5"
  if (pairCode.includes('_')) {
    pairCode = pairCode.split('_')[0];
  }

  // Already in OANDA format
  if (pairCode.includes('_')) {
    return pairCode;
  }

  // Convert EURUSD -> EUR_USD
  if (pairCode.length === 6) {
    return `${pairCode.substring(0, 3)}_${pairCode.substring(3, 6)}`;
  }

  return pairCode;
}

/**
 * Parse pair code into base/quote (for compatibility)
 */
function parsePairCode(pairCode) {
  if (pairCode.includes('_')) {
    pairCode = pairCode.split('_')[0];
  }

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

  if (pairCode.length === 6) {
    return {
      base: pairCode.substring(0, 3),
      quote: pairCode.substring(3, 6),
    };
  }

  throw new Error(`Unknown pair code: ${pairCode}`);
}

/**
 * Get current position for a currency pair
 */
async function getPosition(base, quote) {
  try {
    const instrument = `${base}_${quote}`;
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/positions/${instrument}`);

    const position = response.position;
    const longUnits = parseInt(position.long.units) || 0;
    const shortUnits = parseInt(position.short.units) || 0;
    const netUnits = longUnits + shortUnits;

    return {
      success: true,
      position: netUnits,
      longUnits,
      shortUnits,
      unrealizedPL: parseFloat(position.unrealizedPL || 0),
      avgPrice: parseFloat(position.long.averagePrice || position.short.averagePrice || 0)
    };
  } catch (error) {
    // No position is not an error
    if (error.message.includes('NO_SUCH_POSITION')) {
      return { success: true, position: 0, longUnits: 0, shortUnits: 0 };
    }
    return { success: false, error: error.message, position: 0 };
  }
}

/**
 * Place a market order
 */
async function marketOrder(instrument, units) {
  const orderData = {
    order: {
      type: 'MARKET',
      instrument: instrument,
      units: units.toString(),
      timeInForce: 'FOK',  // Fill or Kill
      positionFill: 'DEFAULT'
    }
  };

  const response = await oandaRequest(
    `/v3/accounts/${OANDA_ACCOUNT_ID}/orders`,
    'POST',
    orderData
  );

  if (response.orderFillTransaction) {
    return {
      success: true,
      orderId: response.orderFillTransaction.id,
      tradeId: response.orderFillTransaction.tradeOpened?.tradeID,
      price: parseFloat(response.orderFillTransaction.price),
      units: parseInt(response.orderFillTransaction.units)
    };
  }

  if (response.orderCancelTransaction) {
    return {
      success: false,
      error: response.orderCancelTransaction.reason
    };
  }

  return { success: false, error: 'Unknown order response' };
}

/**
 * Place a market buy order
 */
async function marketBuy(base, quote, quantity) {
  const instrument = `${base}_${quote}`;
  return marketOrder(instrument, Math.abs(quantity));
}

/**
 * Place a market sell order
 */
async function marketSell(base, quote, quantity) {
  const instrument = `${base}_${quote}`;
  return marketOrder(instrument, -Math.abs(quantity));
}

/**
 * Place a market order with take profit and stop loss
 */
async function marketEntryWithBracket(base, quote, action, quantity, takeProfit, stopLoss) {
  const instrument = `${base}_${quote}`;
  const units = action === 'BUY' ? Math.abs(quantity) : -Math.abs(quantity);

  // Determine decimal places based on instrument
  const isJpy = instrument.includes('JPY');
  const priceDecimals = isJpy ? 3 : 5;

  const orderData = {
    order: {
      type: 'MARKET',
      instrument: instrument,
      units: units.toString(),
      timeInForce: 'FOK',
      positionFill: 'DEFAULT',
      takeProfitOnFill: {
        price: takeProfit.toFixed(priceDecimals)
      },
      stopLossOnFill: {
        price: stopLoss.toFixed(priceDecimals)
      }
    }
  };

  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/orders`,
      'POST',
      orderData
    );

    if (response.orderFillTransaction) {
      const fill = response.orderFillTransaction;
      const tradeId = fill.tradeOpened?.tradeID;

      // Get the TP/SL order IDs from related transactions
      let takeProfitOrderId = null;
      let stopLossOrderId = null;

      if (response.relatedTransactionIDs) {
        // The related transactions include the TP and SL orders
        for (const txId of response.relatedTransactionIDs) {
          // These will be set by OANDA automatically
        }
      }

      return {
        success: true,
        entryOrderId: fill.id,
        entryPrice: parseFloat(fill.price),
        tradeId: tradeId,
        takeProfitOrderId: takeProfitOrderId,
        stopLossOrderId: stopLossOrderId,
        units: parseInt(fill.units)
      };
    }

    if (response.orderCancelTransaction) {
      return {
        success: false,
        error: response.orderCancelTransaction.reason
      };
    }

    if (response.orderRejectTransaction) {
      return {
        success: false,
        error: response.orderRejectTransaction.rejectReason
      };
    }

    return { success: false, error: 'Unknown order response' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Place a limit bracket order (not commonly used, but included for compatibility)
 */
async function bracketOrder(base, quote, action, quantity, entryPrice, takeProfit, stopLoss) {
  const instrument = `${base}_${quote}`;
  const units = action === 'BUY' ? Math.abs(quantity) : -Math.abs(quantity);
  const isJpy = instrument.includes('JPY');
  const priceDecimals = isJpy ? 3 : 5;

  const orderData = {
    order: {
      type: 'LIMIT',
      instrument: instrument,
      units: units.toString(),
      price: entryPrice.toFixed(priceDecimals),
      timeInForce: 'GTC',
      positionFill: 'DEFAULT',
      takeProfitOnFill: {
        price: takeProfit.toFixed(priceDecimals)
      },
      stopLossOnFill: {
        price: stopLoss.toFixed(priceDecimals)
      }
    }
  };

  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/orders`,
      'POST',
      orderData
    );

    if (response.orderCreateTransaction) {
      return {
        success: true,
        orderId: response.orderCreateTransaction.id,
        pending: true
      };
    }

    return { success: false, error: 'Failed to create limit order' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Close a specific trade by ID
 */
async function closeTrade(tradeId, units = 'ALL') {
  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${tradeId}/close`,
      'PUT',
      { units: units }
    );

    if (response.orderFillTransaction) {
      return {
        success: true,
        price: parseFloat(response.orderFillTransaction.price),
        units: parseInt(response.orderFillTransaction.units),
        pl: parseFloat(response.orderFillTransaction.pl || 0)
      };
    }

    return { success: false, error: 'Trade close failed' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Close entire position for a currency pair
 */
async function closePosition(base, quote) {
  const instrument = `${base}_${quote}`;

  try {
    // First get the current position
    const posResponse = await getPosition(base, quote);

    if (!posResponse.success || posResponse.position === 0) {
      return { success: true, message: 'No position to close' };
    }

    // Close the position
    const closeData = {};
    if (posResponse.longUnits > 0) {
      closeData.longUnits = 'ALL';
    }
    if (posResponse.shortUnits < 0) {
      closeData.shortUnits = 'ALL';
    }

    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/positions/${instrument}/close`,
      'PUT',
      closeData
    );

    let avgPrice = 0;
    let totalPL = 0;

    if (response.longOrderFillTransaction) {
      avgPrice = parseFloat(response.longOrderFillTransaction.price);
      totalPL += parseFloat(response.longOrderFillTransaction.pl || 0);
    }

    if (response.shortOrderFillTransaction) {
      avgPrice = parseFloat(response.shortOrderFillTransaction.price);
      totalPL += parseFloat(response.shortOrderFillTransaction.pl || 0);
    }

    return {
      success: true,
      avgPrice: avgPrice,
      realizedPL: totalPL
    };

  } catch (error) {
    if (error.message.includes('NO_SUCH_POSITION')) {
      return { success: true, message: 'No position to close' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Cancel a specific order
 */
async function cancelOrder(orderId) {
  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/orders/${orderId}/cancel`,
      'PUT'
    );

    return {
      success: true,
      cancelledOrderId: response.orderCancelTransaction?.orderID
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Cancel all pending orders
 */
async function cancelAllOrders() {
  try {
    // Get all pending orders
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/pendingOrders`);
    const orders = response.orders || [];

    const results = [];
    for (const order of orders) {
      const result = await cancelOrder(order.id);
      results.push({ orderId: order.id, ...result });
    }

    return {
      success: true,
      cancelled: results.length,
      results: results
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get account summary
 */
async function getAccountSummary() {
  try {
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`);
    const account = response.account;

    return {
      success: true,
      accountId: account.id,
      currency: account.currency,
      balance: parseFloat(account.balance),
      nav: parseFloat(account.NAV),
      unrealizedPL: parseFloat(account.unrealizedPL),
      marginUsed: parseFloat(account.marginUsed),
      marginAvailable: parseFloat(account.marginAvailable),
      openTradeCount: account.openTradeCount,
      openPositionCount: account.openPositionCount
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get current price for an instrument
 */
async function getPrice(instrument) {
  try {
    const oandaInstrument = toOandaInstrument(instrument);
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${oandaInstrument}`
    );

    const price = response.prices[0];
    return {
      success: true,
      instrument: price.instrument,
      bid: parseFloat(price.bids[0]?.price || 0),
      ask: parseFloat(price.asks[0]?.price || 0),
      time: price.time
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get all open trades
 */
async function getOpenTrades() {
  try {
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/openTrades`);

    return {
      success: true,
      trades: response.trades.map(t => ({
        id: t.id,
        instrument: t.instrument,
        units: parseInt(t.currentUnits),
        price: parseFloat(t.price),
        unrealizedPL: parseFloat(t.unrealizedPL),
        takeProfitPrice: t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : null,
        stopLossPrice: t.stopLossOrder ? parseFloat(t.stopLossOrder.price) : null
      }))
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// HIGH-LEVEL API (compatible with live_trader)
// ============================================

/**
 * Enter a trade with TP and SL
 * Compatible with live_trader.js interface
 */
async function enterTrade(pairCode, side, quantity, takeProfit, stopLoss) {
  const { base, quote } = parsePairCode(pairCode);
  const action = side === 'LONG' ? 'BUY' : 'SELL';

  console.log(`[OANDA] Entering ${side} ${quantity} ${base}/${quote} TP=${takeProfit} SL=${stopLoss}`);

  const result = await marketEntryWithBracket(base, quote, action, quantity, takeProfit, stopLoss);

  if (result.success) {
    console.log(`[OANDA] Entry filled at ${result.entryPrice}`);
  } else {
    console.error(`[OANDA] Entry failed:`, result.error);
  }

  return result;
}

/**
 * Exit a trade (close position)
 * Compatible with live_trader.js interface
 */
async function exitTrade(pairCode) {
  const { base, quote } = parsePairCode(pairCode);

  console.log(`[OANDA] Closing position for ${base}/${quote}`);

  const result = await closePosition(base, quote);

  if (result.success) {
    console.log(`[OANDA] Position closed at ${result.avgPrice || 'N/A'}`);
  } else {
    console.error(`[OANDA] Close failed:`, result.error);
  }

  return result;
}

/**
 * Get current position for a pair
 * Compatible with live_trader.js interface
 */
async function getTradePosition(pairCode) {
  const { base, quote } = parsePairCode(pairCode);
  return getPosition(base, quote);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Low-level API
  getPosition,
  marketBuy,
  marketSell,
  bracketOrder,
  marketEntryWithBracket,
  closePosition,
  closeTrade,
  cancelOrder,
  cancelAllOrders,
  getAccountSummary,
  getPrice,
  getOpenTrades,

  // High-level API (compatible with live_trader.js)
  enterTrade,
  exitTrade,
  getTradePosition,
  parsePairCode,
  toOandaInstrument,
};

// ============================================
// TEST IF RUN DIRECTLY
// ============================================

if (require.main === module) {
  (async () => {
    console.log('Testing OANDA executor...\n');

    if (!OANDA_API_TOKEN || !OANDA_ACCOUNT_ID) {
      console.error('Please set OANDA_API_TOKEN and OANDA_ACCOUNT_ID in .env');
      process.exit(1);
    }

    // Test account summary
    console.log('1. Getting account summary:');
    const summary = await getAccountSummary();
    if (summary.success) {
      console.log(`   Balance: ${summary.balance} ${summary.currency}`);
      console.log(`   NAV: ${summary.nav}`);
      console.log(`   Open Trades: ${summary.openTradeCount}`);
    } else {
      console.log(`   Error: ${summary.error}`);
    }

    // Test price
    console.log('\n2. Getting EUR/USD price:');
    const price = await getPrice('EURUSD');
    if (price.success) {
      console.log(`   Bid: ${price.bid}`);
      console.log(`   Ask: ${price.ask}`);
    } else {
      console.log(`   Error: ${price.error}`);
    }

    // Test position check
    console.log('\n3. Getting EUR/USD position:');
    const pos = await getPosition('EUR', 'USD');
    console.log(`   Position: ${pos.position} units`);

    // Test open trades
    console.log('\n4. Getting open trades:');
    const trades = await getOpenTrades();
    if (trades.success) {
      console.log(`   Open trades: ${trades.trades.length}`);
      for (const t of trades.trades) {
        console.log(`   - ${t.instrument}: ${t.units} units @ ${t.price}`);
      }
    }

    console.log('\nOANDA executor module ready!');
    console.log('Use in live_trader.js by changing:');
    console.log("  const orderExecutor = require('./oanda_executor');");
  })();
}
