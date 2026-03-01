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

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
  // Already in OANDA format (e.g., "EUR_USD")
  if (pairCode.includes('_') && pairCode.length === 7) {
    return pairCode;
  }

  // Handle suffixes like "EURUSD_GPT5" -> "EURUSD"
  if (pairCode.includes('_')) {
    pairCode = pairCode.split('_')[0];
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

/**
 * Get details of a specific trade (open or closed)
 */
async function getTradeDetails(tradeId) {
  try {
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${tradeId}`);
    const trade = response.trade;

    return {
      success: true,
      id: trade.id,
      instrument: trade.instrument,
      price: parseFloat(trade.price),
      openTime: trade.openTime,
      state: trade.state,  // OPEN, CLOSED, CLOSE_WHEN_TRADEABLE
      currentUnits: parseInt(trade.currentUnits || 0),
      initialUnits: parseInt(trade.initialUnits),
      realizedPL: parseFloat(trade.realizedPL || 0),
      unrealizedPL: parseFloat(trade.unrealizedPL || 0),
      averageClosePrice: trade.averageClosePrice ? parseFloat(trade.averageClosePrice) : null,
      closingTransactionIDs: trade.closingTransactionIDs || [],
      closeTime: trade.closeTime || null
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get recent account transactions
 * @param {number} count - Number of transactions to fetch (default 50)
 * @param {string} sinceId - Only get transactions after this ID
 */
async function getTransactions(count = 50, sinceId = null) {
  try {
    let url = `/v3/accounts/${OANDA_ACCOUNT_ID}/transactions?count=${count}`;
    if (sinceId) {
      url += `&sinceID=${sinceId}`;
    }

    const response = await oandaRequest(url);

    return {
      success: true,
      transactions: response.pages || [],
      lastTransactionID: response.lastTransactionID
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a specific transaction by ID
 */
async function getTransaction(transactionId) {
  try {
    const response = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/transactions/${transactionId}`);

    return {
      success: true,
      transaction: response.transaction
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get transaction range (for finding how a trade was closed)
 */
async function getTransactionRange(fromId, toId) {
  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/transactions/idrange?from=${fromId}&to=${toId}`
    );

    return {
      success: true,
      transactions: response.transactions || []
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get info about how a trade was closed
 * Returns the closing transaction details (TP, SL, manual close, etc.)
 * @param {string} tradeId - The trade ID to check
 */
async function getTradeCloseInfo(tradeId) {
  try {
    // First get the trade details to find closing transaction IDs
    const tradeInfo = await getTradeDetails(tradeId);

    if (!tradeInfo.success) {
      return { success: false, error: tradeInfo.error };
    }

    if (tradeInfo.state !== 'CLOSED') {
      return {
        success: true,
        closed: false,
        state: tradeInfo.state
      };
    }

    // Get the closing transaction(s)
    const closingIds = tradeInfo.closingTransactionIDs;
    if (!closingIds || closingIds.length === 0) {
      return {
        success: true,
        closed: true,
        closeReason: 'UNKNOWN',
        realizedPL: tradeInfo.realizedPL,
        closePrice: tradeInfo.averageClosePrice
      };
    }

    // Get the closing transaction to determine why it closed
    const closingTxId = closingIds[closingIds.length - 1];  // Last closing transaction
    const txInfo = await getTransaction(closingTxId);

    if (!txInfo.success) {
      return {
        success: true,
        closed: true,
        closeReason: 'UNKNOWN',
        realizedPL: tradeInfo.realizedPL,
        closePrice: tradeInfo.averageClosePrice
      };
    }

    const tx = txInfo.transaction;
    let closeReason = 'UNKNOWN';

    // Determine close reason from transaction type
    if (tx.type === 'ORDER_FILL') {
      if (tx.reason === 'TAKE_PROFIT_ORDER') {
        closeReason = 'TP';
      } else if (tx.reason === 'STOP_LOSS_ORDER') {
        closeReason = 'SL';
      } else if (tx.reason === 'TRAILING_STOP_LOSS_ORDER') {
        closeReason = 'TRAILING_SL';
      } else if (tx.reason === 'MARKET_ORDER' || tx.reason === 'MARKET_ORDER_TRADE_CLOSE') {
        closeReason = 'MANUAL';
      } else if (tx.reason === 'LIMIT_ORDER') {
        closeReason = 'LIMIT';
      } else {
        closeReason = tx.reason || 'UNKNOWN';
      }
    }

    return {
      success: true,
      closed: true,
      closeReason: closeReason,
      closePrice: parseFloat(tx.price || tradeInfo.averageClosePrice || 0),
      realizedPL: parseFloat(tx.pl || tradeInfo.realizedPL || 0),
      closeTime: tx.time || tradeInfo.closeTime,
      transactionId: tx.id,
      fullTransaction: tx
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get open trades for a specific instrument
 * @param {string} instrument - e.g., "EUR_USD" or "EURUSD"
 */
async function getOpenTradesForInstrument(instrument) {
  try {
    const oandaInstrument = toOandaInstrument(instrument);
    const allTrades = await getOpenTrades();

    if (!allTrades.success) {
      return allTrades;
    }

    const trades = allTrades.trades.filter(t => t.instrument === oandaInstrument);

    return {
      success: true,
      trades: trades,
      totalUnits: trades.reduce((sum, t) => sum + t.units, 0)
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// MARKET DATA API
// ============================================

/**
 * Get historical candles for an instrument
 * @param {string} instrument - e.g., "EUR_USD" or "EURUSD"
 * @param {string} granularity - M1, M5, M15, M30, H1, H4, D, W, M
 * @param {number} count - Number of candles to retrieve (max 5000)
 * @returns {Promise<object>} - { success, candles: [{time, open, high, low, close}, ...] }
 */
async function getHistoricalCandles(instrument, granularity = 'M5', count = 500) {
  try {
    const oandaInstrument = toOandaInstrument(instrument);
    const response = await oandaRequest(
      `/v3/instruments/${oandaInstrument}/candles?granularity=${granularity}&count=${count}&price=M`
    );

    const candles = response.candles
      .filter(c => c.complete)  // Only completed candles
      .map(c => ({
        time: c.time,
        _t: parseInt(c.time) * 1000,  // Unix timestamp in ms
        _d: new Date(parseInt(c.time) * 1000),
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
        volume: parseInt(c.volume || 0)
      }));

    return {
      success: true,
      instrument: response.instrument,
      granularity: response.granularity,
      candles
    };

  } catch (error) {
    return { success: false, error: error.message, candles: [] };
  }
}

/**
 * Get streaming endpoint URL and headers for price streaming
 * @param {string[]} instruments - Array of instruments to stream
 * @returns {object} - { url, headers }
 */
function getStreamingConfig(instruments) {
  const streamEndpoints = {
    practice: 'https://stream-fxpractice.oanda.com',
    live: 'https://stream-fxtrade.oanda.com'
  };

  const streamUrl = streamEndpoints[OANDA_ENVIRONMENT];
  const instrumentList = instruments.map(i => toOandaInstrument(i)).join(',');

  return {
    url: `${streamUrl}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing/stream?instruments=${instrumentList}`,
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`
    }
  };
}

/**
 * Start streaming prices for instruments
 * Returns an async generator that yields price updates
 * @param {string[]} instruments - Array of instruments
 * @param {function} onPrice - Callback for each price update
 * @param {function} onError - Callback for errors
 * @returns {Promise<object>} - { stop: function } to stop streaming
 */
async function startPriceStream(instruments, onPrice, onError) {
  const config = getStreamingConfig(instruments);
  let controller = new AbortController();
  let running = true;

  const streamLoop = async () => {
    while (running) {
      try {
        const response = await fetch(config.url, {
          headers: config.headers,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Stream connection failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (running) {
          const { value, done } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value).trim().split('\n');
          for (const line of lines) {
            if (!line) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'PRICE') {
                onPrice({
                  instrument: data.instrument,
                  time: data.time,
                  bid: parseFloat(data.bids?.[0]?.price || 0),
                  ask: parseFloat(data.asks?.[0]?.price || 0),
                  mid: (parseFloat(data.bids?.[0]?.price || 0) + parseFloat(data.asks?.[0]?.price || 0)) / 2
                });
              }
            } catch (e) {
              // Heartbeat or parse error - ignore
            }
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          break;  // Normal stop
        }
        if (onError) onError(error);
        // Wait before reconnecting
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  };

  // Start streaming in background
  streamLoop();

  return {
    stop: () => {
      running = false;
      controller.abort();
    }
  };
}

// ============================================
// HIGH-LEVEL API (compatible with live_trader)
// ============================================

/**
 * Enter a trade with TP and SL (MARKET order)
 * Compatible with live_trader.js interface
 */
async function enterTrade(pairCode, side, quantity, takeProfit, stopLoss) {
  const { base, quote } = parsePairCode(pairCode);
  const action = side === 'LONG' ? 'BUY' : 'SELL';

  console.log(`[OANDA] Entering MARKET ${side} ${quantity} ${base}/${quote} TP=${takeProfit} SL=${stopLoss}`);

  const result = await marketEntryWithBracket(base, quote, action, quantity, takeProfit, stopLoss);

  if (result.success) {
    console.log(`[OANDA] Entry filled at ${result.entryPrice}`);
  } else {
    console.error(`[OANDA] Entry failed:`, result.error);
  }

  return result;
}

/**
 * Enter a trade with LIMIT order + TP and SL
 * This is the primary function used by live_trader.js when USE_LIMIT_ORDERS=true
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
  const instrument = `${base}_${quote}`;
  const units = side === 'LONG' ? Math.abs(quantity) : -Math.abs(quantity);

  // Determine decimal places based on instrument
  const isJpy = instrument.includes('JPY');
  const priceDecimals = isJpy ? 3 : 5;

  console.log(`[OANDA] Placing LIMIT ${side} ${quantity} ${base}/${quote} @ ${entryPrice} | TP=${takeProfit} SL=${stopLoss}`);

  const orderData = {
    order: {
      type: 'LIMIT',
      instrument: instrument,
      units: units.toString(),
      price: entryPrice.toFixed(priceDecimals),
      timeInForce: 'GTC',  // Good Till Cancelled
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

    // Check if order was immediately filled (price already at level)
    if (response.orderFillTransaction) {
      const fill = response.orderFillTransaction;
      console.log(`[OANDA] LIMIT order immediately filled at ${fill.price}`);
      return {
        success: true,
        filled: true,
        entryOrderId: fill.id,
        entryPrice: parseFloat(fill.price),
        tradeId: fill.tradeOpened?.tradeID,
        units: parseInt(fill.units)
      };
    }

    // Order is pending (normal case for limit orders)
    if (response.orderCreateTransaction) {
      const order = response.orderCreateTransaction;
      console.log(`[OANDA] LIMIT order pending - Order ID: ${order.id}`);
      return {
        success: true,
        filled: false,
        pending: true,
        entryOrderId: order.id,
        entryPrice: parseFloat(order.price),
        units: parseInt(order.units)
      };
    }

    // Order was rejected
    if (response.orderRejectTransaction) {
      const reject = response.orderRejectTransaction;
      console.error(`[OANDA] LIMIT order rejected: ${reject.rejectReason}`);
      return {
        success: false,
        error: reject.rejectReason
      };
    }

    return { success: false, error: 'Unknown order response' };

  } catch (error) {
    console.error(`[OANDA] LIMIT order error: ${error.message}`);
    return { success: false, error: error.message };
  }
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

/**
 * Enter a trade with MARKET order only (no TP/SL)
 * Used when we want to set TP/SL separately after getting actual fill price
 *
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY"
 * @param {string} side - "LONG" or "SHORT"
 * @param {number} quantity - Order size (in base currency units)
 */
async function enterTradeMarketOnly(pairCode, side, quantity) {
  const { base, quote } = parsePairCode(pairCode);
  const instrument = `${base}_${quote}`;
  const units = side === 'LONG' ? Math.abs(quantity) : -Math.abs(quantity);

  console.log(`[OANDA] Placing MARKET ${side} ${quantity} ${base}/${quote} (no TP/SL)`);

  const orderData = {
    order: {
      type: 'MARKET',
      instrument: instrument,
      units: units.toString(),
      timeInForce: 'FOK',  // Fill or Kill
      positionFill: 'DEFAULT'
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
      console.log(`[OANDA] MARKET order filled at ${fill.price}`);
      return {
        success: true,
        entryOrderId: fill.id,
        entryPrice: parseFloat(fill.price),
        tradeId: fill.tradeOpened?.tradeID,
        units: parseInt(fill.units)
      };
    }

    if (response.orderRejectTransaction) {
      const reject = response.orderRejectTransaction;
      console.error(`[OANDA] MARKET order rejected: ${reject.rejectReason}`);
      return { success: false, error: reject.rejectReason };
    }

    return { success: false, error: 'Unknown order response' };

  } catch (error) {
    console.error(`[OANDA] MARKET order error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Set Take Profit and Stop Loss on an existing trade
 *
 * @param {string} pairCode - e.g., "EURUSD", "USDJPY"
 * @param {string} tradeId - The OANDA trade ID
 * @param {number} takeProfit - Take profit price
 * @param {number} stopLoss - Stop loss price
 */
async function setTakeProfitStopLoss(pairCode, tradeId, takeProfit, stopLoss) {
  const { base, quote } = parsePairCode(pairCode);
  const instrument = `${base}_${quote}`;

  // Determine decimal places based on instrument
  const isJpy = instrument.includes('JPY');
  const priceDecimals = isJpy ? 3 : 5;

  console.log(`[OANDA] Setting TP=${takeProfit.toFixed(priceDecimals)} SL=${stopLoss.toFixed(priceDecimals)} on trade ${tradeId}`);

  const orderData = {
    takeProfit: {
      price: takeProfit.toFixed(priceDecimals)
    },
    stopLoss: {
      price: stopLoss.toFixed(priceDecimals)
    }
  };

  try {
    const response = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,
      'PUT',
      orderData
    );

    if (response.takeProfitOrderTransaction && response.stopLossOrderTransaction) {
      console.log(`[OANDA] TP/SL set successfully`);
      return {
        success: true,
        takeProfitOrderId: response.takeProfitOrderTransaction.id,
        stopLossOrderId: response.stopLossOrderTransaction.id
      };
    }

    // Check for partial success
    if (response.takeProfitOrderTransaction || response.stopLossOrderTransaction) {
      console.log(`[OANDA] Partial TP/SL set`);
      return {
        success: true,
        takeProfitOrderId: response.takeProfitOrderTransaction?.id,
        stopLossOrderId: response.stopLossOrderTransaction?.id
      };
    }

    return { success: false, error: 'Failed to set TP/SL orders' };

  } catch (error) {
    console.error(`[OANDA] Set TP/SL error: ${error.message}`);
    return { success: false, error: error.message };
  }
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

  // Trade Info API (for checking trade status and close info)
  getTradeDetails,
  getTransaction,
  getTransactions,
  getTransactionRange,
  getTradeCloseInfo,
  getOpenTradesForInstrument,

  // Market Data API
  getHistoricalCandles,
  getStreamingConfig,
  startPriceStream,

  // High-level API (compatible with live_trader.js)
  enterTrade,
  enterTradeLimit,
  enterTradeMarketOnly,
  setTakeProfitStopLoss,
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
