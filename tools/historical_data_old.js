const { IBApi, EventName } = require("@stoqey/ib");
const fs = require("fs");

const ib = new IBApi({
  clientId: 99,
  host: "127.0.0.1",
  port: 4002,
});

const contract = {
  symbol: "EUR",
  secType: "CASH",
  currency: "USD",
  exchange: "IDEALPRO",
};

const allBars = [];
let requestId = 1;

// Start from 3 months ago, go back to 6 months ago
let currentEnd = new Date();
currentEnd.setMonth(currentEnd.getMonth() - 3);  // Start 3 months ago

const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);  // End 6 months ago

console.log("Downloading EURUSD 5m data:");
console.log("  From:", sixMonthsAgo.toISOString().slice(0, 10));
console.log("  To:", currentEnd.toISOString().slice(0, 10));
console.log("  Output: eurusd_5m_old.json\n");

let chunkTimer = null;
let barsThisChunk = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchNextChunk() {
  if (currentEnd <= sixMonthsAgo) {
    console.log("\nFinished!");
    console.log("Total bars:", allBars.length);
    fs.writeFileSync("eurusd_5m_old.json", JSON.stringify(allBars, null, 2));
    console.log("Saved to eurusd_5m_old.json");
    ib.disconnect();
    process.exit(0);
    return;
  }

  const endString = formatIBDate(currentEnd);
  console.log("Requesting chunk ending:", endString);

  ib.reqHistoricalData(
    requestId++,
    contract,
    endString,
    "3 D",
    "5 mins",
    "MIDPOINT",
    1,
    1,
    false
  );

  currentEnd.setDate(currentEnd.getDate() - 3);
}

ib.on(EventName.connected, async () => {
  console.log("Connected to IBKR\n");
  await sleep(2000);
  fetchNextChunk();
});

ib.on(EventName.historicalData, (reqId, time, open, high, low, close) => {
  if (time === "finished" || !open) return;

  barsThisChunk++;
  allBars.push({ time, open, high, low, close });

  if (chunkTimer) clearTimeout(chunkTimer);

  chunkTimer = setTimeout(async () => {
    console.log(`  Chunk complete: ${barsThisChunk} bars (total: ${allBars.length})`);
    barsThisChunk = 0;

    await sleep(5000); // pacing protection
    fetchNextChunk();
  }, 2000);
});

ib.on(EventName.error, (err) => {
  if (err.message?.includes("connection is OK")) return;
  if (err.message?.includes("Market data farm")) return;
  if (err.message?.includes("HMDS data farm")) return;
  console.error("Error:", err.message);
});

ib.connect();
