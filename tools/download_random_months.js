/**
 * DOWNLOAD RANDOM MONTHS
 *
 * Downloads 5-minute EURUSD bars from 10 random months.
 * Each month is labeled and saved separately in the output JSON.
 *
 * Usage: node download_random_months.js
 *
 * Adjust START_YEAR and END_YEAR based on check_data_range.js results.
 */

const { IBApi, EventName } = require("@stoqey/ib");
const fs = require("fs");

// ============ CONFIGURATION ============
// Adjust these based on check_data_range.js results
const START_YEAR = 2005;  // Earliest available year
const END_YEAR = 2024;    // Latest year to sample from
const NUM_MONTHS = 10;    // How many random months to download
const OUTPUT_FILE = "eurusd_random_months.json";
// ========================================

const ib = new IBApi({
  clientId: 4,
  host: "127.0.0.1",
  port: 4002,
});

const contract = {
  symbol: "EUR",
  secType: "CASH",
  currency: "USD",
  exchange: "IDEALPRO",
};

// Generate random months
function generateRandomMonths(startYear, endYear, count) {
  const allMonths = [];

  // Generate all possible months
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      // Skip future months
      const now = new Date();
      if (year === now.getFullYear() && month >= now.getMonth() + 1) continue;
      if (year > now.getFullYear()) continue;

      allMonths.push({ year, month });
    }
  }

  // Shuffle and pick
  const shuffled = allMonths.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

const selectedMonths = generateRandomMonths(START_YEAR, END_YEAR, NUM_MONTHS);

console.log("Selected random months:");
selectedMonths.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.year}-${String(m.month).padStart(2, "0")}`);
});
console.log("");

// Data storage
const allData = {
  metadata: {
    pair: "EURUSD",
    timeframe: "5min",
    downloadedAt: new Date().toISOString(),
    months: selectedMonths.map(m => `${m.year}-${String(m.month).padStart(2, "0")}`),
  },
  months: {},
};

let currentMonthIndex = 0;
let currentChunk = 0;
let requestId = 1;
let currentMonthBars = [];
let chunkTimer = null;

function formatIBDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + "-" +
    pad(date.getUTCHours()) + ":" +
    pad(date.getUTCMinutes()) + ":" +
    pad(date.getUTCSeconds())
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMonthKey(monthObj) {
  return `${monthObj.year}-${String(monthObj.month).padStart(2, "0")}`;
}

// For each month, we'll fetch in ~10-day chunks (to avoid IBKR limits)
function getChunksForMonth(year, month) {
  const chunks = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  // Chunk 1: days 1-10
  // Chunk 2: days 11-20
  // Chunk 3: days 21-end
  chunks.push(new Date(year, month - 1, 10, 23, 59, 59));
  chunks.push(new Date(year, month - 1, 20, 23, 59, 59));
  chunks.push(new Date(year, month - 1, daysInMonth, 23, 59, 59));

  return chunks;
}

let chunksForCurrentMonth = [];

async function startNextMonth() {
  if (currentMonthIndex >= selectedMonths.length) {
    // All done!
    console.log("\n========== DOWNLOAD COMPLETE ==========");
    console.log(`Total months: ${Object.keys(allData.months).length}`);

    let totalBars = 0;
    for (const [month, data] of Object.entries(allData.months)) {
      console.log(`  ${month}: ${data.bars.length} bars`);
      totalBars += data.bars.length;
    }
    console.log(`Total bars: ${totalBars}`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2));
    console.log(`\nSaved to ${OUTPUT_FILE}`);

    ib.disconnect();
    return;
  }

  const monthObj = selectedMonths[currentMonthIndex];
  const monthKey = getMonthKey(monthObj);

  console.log(`\n[${currentMonthIndex + 1}/${selectedMonths.length}] Downloading ${monthKey}...`);

  currentMonthBars = [];
  currentChunk = 0;
  chunksForCurrentMonth = getChunksForMonth(monthObj.year, monthObj.month);

  fetchNextChunk();
}

async function fetchNextChunk() {
  if (currentChunk >= chunksForCurrentMonth.length) {
    // Month complete
    const monthObj = selectedMonths[currentMonthIndex];
    const monthKey = getMonthKey(monthObj);

    // Sort bars by time
    currentMonthBars.sort((a, b) => a.time.localeCompare(b.time));

    // Remove duplicates
    const seen = new Set();
    const uniqueBars = currentMonthBars.filter(bar => {
      if (seen.has(bar.time)) return false;
      seen.add(bar.time);
      return true;
    });

    allData.months[monthKey] = {
      year: monthObj.year,
      month: monthObj.month,
      bars: uniqueBars,
      barCount: uniqueBars.length,
    };

    console.log(`  ${monthKey} complete: ${uniqueBars.length} bars`);

    currentMonthIndex++;
    await sleep(5000); // Pacing between months
    startNextMonth();
    return;
  }

  const endDate = chunksForCurrentMonth[currentChunk];
  const endString = formatIBDate(endDate);

  console.log(`  Chunk ${currentChunk + 1}/3: ending ${endString.slice(0, 8)}`);

  ib.reqHistoricalData(
    requestId++,
    contract,
    endString,
    "10 D",     // 10 days per chunk
    "5 mins",
    "MIDPOINT",
    1,
    1,
    false
  );
}

ib.on(EventName.connected, async () => {
  console.log("Connected to IBKR\n");
  await sleep(2000);
  startNextMonth();
});

ib.on(EventName.historicalData, (reqId, time, open, high, low, close) => {
  if (time === "finished") return;

  currentMonthBars.push({ time, open, high, low, close });

  // Reset chunk timer
  if (chunkTimer) clearTimeout(chunkTimer);

  chunkTimer = setTimeout(async () => {
    console.log(`    Received ${currentMonthBars.length} bars so far`);
    currentChunk++;
    await sleep(3000); // Pacing between chunks
    fetchNextChunk();
  }, 3000);
});

ib.on(EventName.historicalDataEnd, async (reqId) => {
  // Clear the timeout since we got explicit end
  if (chunkTimer) {
    clearTimeout(chunkTimer);
    chunkTimer = null;
  }

  console.log(`    Chunk done, ${currentMonthBars.length} bars total`);
  currentChunk++;
  await sleep(3000);
  fetchNextChunk();
});

ib.on(EventName.error, (err, code, reqId) => {
  if (err.message?.includes("connection is OK")) return;
  if (err.message?.includes("Market data farm")) return;

  // Historical data query limit
  if (code === 162) {
    console.log(`    Warning: ${err.message?.slice(0, 60)}...`);
    // Continue to next chunk
    currentChunk++;
    setTimeout(() => fetchNextChunk(), 10000);
    return;
  }

  console.error("Error:", code, err.message);
});

console.log("========================================");
console.log("EURUSD Random Months Downloader");
console.log("========================================");
console.log(`Range: ${START_YEAR} - ${END_YEAR}`);
console.log(`Months to download: ${NUM_MONTHS}`);
console.log(`Output: ${OUTPUT_FILE}`);
console.log("========================================\n");

console.log("Connecting to IBKR...");
console.log("Make sure TWS/Gateway is running on port 4002\n");

ib.connect();
