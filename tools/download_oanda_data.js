/**
 * Download OANDA Historical Data for Offline Training
 *
 * Downloads 5-minute EUR/USD candles from OANDA and saves to JSON.
 * Run once to build local dataset, then train offline.
 *
 * Usage:
 *   node tools/download_oanda_data.js                    # Default: last 6 months
 *   node tools/download_oanda_data.js --months 12        # Last 12 months
 *   node tools/download_oanda_data.js --from 2025-01-01  # From specific date
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

// Config
const OANDA_API_TOKEN = process.env.OANDA_API_TOKEN;
const OANDA_ENVIRONMENT = process.env.OANDA_ENVIRONMENT || 'practice';
const INSTRUMENT = 'EUR_USD';
const GRANULARITY = 'M5';
const MAX_CANDLES_PER_REQUEST = 5000;
const RATE_LIMIT_MS = 200;

const ENDPOINTS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com'
};

const BASE_URL = ENDPOINTS[OANDA_ENVIRONMENT];
const DATA_DIR = path.join(__dirname, '../data');

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2);
  let months = 6;
  let fromDate = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--months' && args[i + 1]) {
      months = parseInt(args[i + 1]);
    }
    if (args[i] === '--from' && args[i + 1]) {
      fromDate = new Date(args[i + 1]);
    }
  }

  if (!fromDate) {
    fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
  }

  return { fromDate, months };
}

async function oandaRequest(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'UNIX'
    }
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`OANDA API Error: ${data.errorMessage || JSON.stringify(data)}`);
  }

  return data;
}

async function getCandles(from, count = MAX_CANDLES_PER_REQUEST) {
  const fromTs = Math.floor(from.getTime() / 1000);
  const url = `/v3/instruments/${INSTRUMENT}/candles?granularity=${GRANULARITY}&from=${fromTs}&count=${count}&price=M`;

  const response = await oandaRequest(url);

  return response.candles
    .filter(c => c.complete)
    .map(c => ({
      time: new Date(parseInt(c.time) * 1000).toISOString(),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: parseInt(c.volume || 0)
    }));
}

async function downloadAllData(fromDate) {
  console.log(`\nDownloading ${INSTRUMENT} ${GRANULARITY} data from OANDA`);
  console.log(`Environment: ${OANDA_ENVIRONMENT}`);
  console.log(`From: ${fromDate.toISOString().slice(0, 10)}`);
  console.log(`To: now\n`);

  let allCandles = [];
  let currentFrom = fromDate;
  let requestCount = 0;

  while (true) {
    requestCount++;
    process.stdout.write(`\rFetching batch ${requestCount}... `);

    const candles = await getCandles(currentFrom);

    if (candles.length === 0) {
      console.log('No more data available.');
      break;
    }

    // Avoid duplicates
    const lastTime = allCandles.length > 0
      ? new Date(allCandles[allCandles.length - 1].time).getTime()
      : 0;
    const newCandles = candles.filter(c => new Date(c.time).getTime() > lastTime);

    if (newCandles.length === 0) {
      console.log('No new candles, reached end.');
      break;
    }

    allCandles = allCandles.concat(newCandles);
    console.log(`Total: ${allCandles.length} candles`);

    // Update from to last candle time + 1 second
    const lastCandle = candles[candles.length - 1];
    currentFrom = new Date(new Date(lastCandle.time).getTime() + 1000);

    // Check if we've reached current time
    if (currentFrom > new Date()) {
      console.log('Reached current time.');
      break;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  return allCandles;
}

function saveData(candles, fromDate) {
  // Create filename based on date range
  const fromStr = fromDate.toISOString().slice(0, 10).replace(/-/g, '');
  const toStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `eurusd_5m_oanda_${fromStr}_${toStr}.json`;
  const filepath = path.join(DATA_DIR, filename);

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Save with metadata
  const data = {
    metadata: {
      instrument: INSTRUMENT,
      granularity: GRANULARITY,
      source: 'OANDA',
      environment: OANDA_ENVIRONMENT,
      downloadedAt: new Date().toISOString(),
      from: candles[0].time,
      to: candles[candles.length - 1].time,
      totalCandles: candles.length
    },
    candles: candles
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`\nSaved to: ${filepath}`);

  // Also save a "latest" symlink-style copy
  const latestPath = path.join(DATA_DIR, 'eurusd_5m_oanda.json');
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));
  console.log(`Also saved to: ${latestPath}`);

  return filepath;
}

function printSummary(candles) {
  const first = new Date(candles[0].time);
  const last = new Date(candles[candles.length - 1].time);
  const days = (last - first) / (1000 * 60 * 60 * 24);

  console.log('\n--- Summary ---');
  console.log(`Total candles: ${candles.length}`);
  console.log(`Date range: ${first.toISOString().slice(0, 10)} to ${last.toISOString().slice(0, 10)}`);
  console.log(`Days covered: ${days.toFixed(1)}`);
  console.log(`Avg candles/day: ${(candles.length / days).toFixed(0)}`);

  // Count trading sessions
  const tradingHours = candles.filter(c => {
    const d = new Date(c.time);
    const hour = d.getUTCHours();
    const day = d.getUTCDay();
    return day >= 1 && day <= 5 && hour >= 7 && hour < 17;
  });
  console.log(`Trading session candles (8-18 CET weekdays): ${tradingHours.length}`);
}

async function main() {
  if (!OANDA_API_TOKEN) {
    console.error('Error: OANDA_API_TOKEN not set in .env');
    process.exit(1);
  }

  const { fromDate, months } = parseArgs();

  console.log('='.repeat(50));
  console.log('OANDA Historical Data Downloader');
  console.log('='.repeat(50));

  try {
    const candles = await downloadAllData(fromDate);

    if (candles.length === 0) {
      console.error('No candles downloaded!');
      process.exit(1);
    }

    printSummary(candles);
    saveData(candles, fromDate);

    console.log('\nDone! You can now run batch_trainer.js with this data.');

  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

main();
