// ----------------------------
// PAIR CONFIGURATION
// ----------------------------
// Set TRADING_PAIR in .env or change DEFAULT_PAIR below

const DEFAULT_PAIR = 'GBPUSD';

const PAIR_CONFIGS = {
  EURUSD: {
    symbol: 'EUR',
    currency: 'USD',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.00008,
    pipMultiplier: 10000,  // 1 pip = 0.0001
    displayName: 'EUR/USD',
    dataFile: './eurusd_5m.json',
    resultsFile: './trade_results_eurusd.json',
    logFile: './live_trader_eurusd.log'
  },
  GBPUSD: {
    symbol: 'GBP',
    currency: 'USD',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.00012,
    pipMultiplier: 10000,
    displayName: 'GBP/USD',
    dataFile: './gbpusd_5m.json',
    resultsFile: './trade_results_gbpusd.json',
    logFile: './live_trader_gbpusd.log',
    tradingHours: { start: 9, end: 18 }  // 09:00-18:00 CET (London session focus)
  },
  USDJPY: {
    symbol: 'USD',
    currency: 'JPY',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.008,
    pipMultiplier: 100,  // 1 pip = 0.01 for JPY pairs
    displayName: 'USD/JPY',
    dataFile: './usdjpy_5m.json',
    resultsFile: './trade_results_usdjpy.json',
    logFile: './live_trader_usdjpy.log',
    tradingHours: { start: 11, end: 20 }  // 11:00-20:00 CET
  },
  AUDUSD: {
    symbol: 'AUD',
    currency: 'USD',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.00010,
    pipMultiplier: 10000,
    displayName: 'AUD/USD',
    dataFile: './audusd_5m.json',
    resultsFile: './trade_results_audusd.json',
    logFile: './live_trader_audusd.log'
  },
  USDCHF: {
    symbol: 'USD',
    currency: 'CHF',
    secType: 'CASH',
    exchange: 'IDEALPRO',
    spread: 0.00012,
    pipMultiplier: 10000,
    displayName: 'USD/CHF',
    dataFile: './usdchf_5m.json',
    resultsFile: './trade_results_usdchf.json',
    logFile: './live_trader_usdchf.log'
  }
};

function getPairConfig() {
  const pair = process.env.TRADING_PAIR || DEFAULT_PAIR;
  const config = PAIR_CONFIGS[pair.toUpperCase()];

  if (!config) {
    console.error(`Unknown pair: ${pair}`);
    console.error(`Available pairs: ${Object.keys(PAIR_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  return {
    ...config,
    pairCode: pair.toUpperCase()
  };
}

function getContract(config) {
  return {
    symbol: config.symbol,
    secType: config.secType,
    currency: config.currency,
    exchange: config.exchange
  };
}

module.exports = {
  getPairConfig,
  getContract,
  PAIR_CONFIGS,
  DEFAULT_PAIR
};
