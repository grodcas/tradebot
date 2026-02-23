/**
 * CHECK DATA RANGE
 *
 * Tests how far back IBKR historical data goes for EURUSD 5-min bars.
 * Tries progressively older dates until we hit a limit.
 */

const { IBApi, EventName } = require("@stoqey/ib");

const ib = new IBApi({
  clientId: 3,
  host: "127.0.0.1",
  port: 4002,
});

const contract = {
  symbol: "EUR",
  secType: "CASH",
  currency: "USD",
  exchange: "IDEALPRO",
};

// Test dates - going back year by year
const testDates = [
  new Date("2024-06-15"),
  new Date("2023-06-15"),
  new Date("2022-06-15"),
  new Date("2021-06-15"),
  new Date("2020-06-15"),
  new Date("2019-06-15"),
  new Date("2018-06-15"),
  new Date("2017-06-15"),
  new Date("2016-06-15"),
  new Date("2015-06-15"),
  new Date("2014-06-15"),
  new Date("2013-06-15"),
  new Date("2012-06-15"),
  new Date("2011-06-15"),
  new Date("2010-06-15"),
  new Date("2009-06-15"),
  new Date("2008-06-15"),
  new Date("2007-06-15"),
  new Date("2006-06-15"),
  new Date("2005-06-15"),
];

let currentIndex = 0;
let requestId = 1;
const results = {};
let barsReceived = 0;
let silenceTimer = null;

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

async function finishCurrentTest(status) {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  const year = testDates[currentIndex].getFullYear();
  results[year] = status;
  console.log(`  ${year}: ${status}${barsReceived > 0 ? ` (${barsReceived} bars)` : ""}`);

  barsReceived = 0;
  currentIndex++;

  await sleep(3000); // Pacing
  testNextDate();
}

async function testNextDate() {
  if (currentIndex >= testDates.length) {
    console.log("\n========== RESULTS ==========");
    console.log("Year       | Status");
    console.log("-----------|--------");
    for (const [year, status] of Object.entries(results).sort((a, b) => b[0] - a[0])) {
      console.log(`${year}       | ${status}`);
    }

    const available = Object.entries(results)
      .filter(([_, status]) => status === "OK")
      .map(([year, _]) => parseInt(year))
      .sort((a, b) => a - b);

    console.log("\n========== SUMMARY ==========");
    if (available.length > 0) {
      console.log(`Available years: ${available.join(", ")}`);
      console.log(`Earliest: ${available[0]}`);
      console.log(`Latest: ${available[available.length - 1]}`);
    } else {
      console.log("No data available in tested range");
    }

    ib.disconnect();
    process.exit(0);
    return;
  }

  const testDate = testDates[currentIndex];
  const year = testDate.getFullYear();
  const endString = formatIBDate(testDate);

  console.log(`Testing ${year}... (${endString})`);
  barsReceived = 0;

  ib.reqHistoricalData(
    requestId++,
    contract,
    endString,
    "1 D",      // Just 1 day to test
    "5 mins",
    "MIDPOINT",
    1,
    1,
    false
  );

  // Timeout if no data after 12 seconds
  silenceTimer = setTimeout(() => {
    if (barsReceived === 0) {
      finishCurrentTest("TIMEOUT");
    }
  }, 12000);
}

ib.on(EventName.connected, async () => {
  console.log("Connected to IBKR");
  console.log("Testing EURUSD 5-min data availability...\n");
  await sleep(2000);
  testNextDate();
});

ib.on(EventName.historicalData, (reqId, time, open, high, low, close) => {
  // Skip the "finished" marker
  if (time === "finished" || !open) {
    // This signals end of data
    if (barsReceived > 0) {
      finishCurrentTest("OK");
    }
    return;
  }

  barsReceived++;

  // Reset silence timer on each bar
  if (silenceTimer) {
    clearTimeout(silenceTimer);
  }

  // 3 seconds of silence = done
  silenceTimer = setTimeout(() => {
    if (barsReceived > 0) {
      finishCurrentTest("OK");
    } else {
      finishCurrentTest("NO DATA");
    }
  }, 3000);
});

ib.on(EventName.error, (err, code, reqId) => {
  // Ignore connection OK messages
  if (err.message?.includes("connection is OK")) return;
  if (err.message?.includes("Market data farm")) return;
  if (err.message?.includes("HMDS data farm")) return;

  // Check for historical data limitation error
  if (code === 162 || err.message?.includes("Historical data") || err.message?.includes("query returned no data")) {
    finishCurrentTest("LIMITED");
    return;
  }

  if (code === 322) {
    console.log("  Duplicate request, waiting...");
    return;
  }

  console.error("Error:", code, err.message);
});

console.log("Connecting to IBKR...");
console.log("Make sure TWS/Gateway is running on port 4002\n");

ib.connect();
