const { IBApi, EventName } = require("@stoqey/ib");
const fs = require("fs");

const ib = new IBApi({
  clientId: 2,
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

let currentEnd = new Date();
const threeMonthsAgo = new Date();
threeMonthsAgo.setMonth(currentEnd.getMonth() - 3);


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

function parseIBDate(str) {
  if (!str) return null;

  const parts = str.split(" ");
  if (parts.length < 2) return null;

  const datePart = parts[0]; // 20260213
  const timePart = parts[1]; // 16:30:00

  const year = parseInt(datePart.slice(0, 4));
  const month = parseInt(datePart.slice(4, 6)) - 1;
  const day = parseInt(datePart.slice(6, 8));

  const [hour, minute, second] = timePart.split(":").map(Number);

  // This is US/Eastern → convert to UTC manually
  // Simpler: treat as UTC and adjust later using Europe/Zurich

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}


function isValidTime(barDate) {
  const parsed = parseIBDate(barDate);
  if (!parsed) return false;

  const cet = new Date(
    parsed.toLocaleString("en-US", { timeZone: "Europe/Zurich" })
  );

  const day = cet.getDay();
  const hour = cet.getHours();

  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}



async function fetchNextChunk() {
  if (currentEnd <= threeMonthsAgo) {
    console.log("Finished.");
    fs.writeFileSync("eurusd_5m.json", JSON.stringify(allBars, null, 2));
    ib.disconnect();
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
  console.log("Connected.");
  await sleep(2000);
  fetchNextChunk();
});

ib.on(EventName.historicalData, (reqId, time, open, high, low, close) => {
  barsThisChunk++;
  allBars.push({ time, open, high, low, close });
  console.log("BAR:", time, open, high, low, close);

  if (chunkTimer) clearTimeout(chunkTimer);

  chunkTimer = setTimeout(async () => {
    console.log(`Chunk complete. Bars received: ${barsThisChunk}`);
    barsThisChunk = 0;

    await sleep(5000); // pacing protection
    fetchNextChunk();
  }, 2000); // 2 seconds of silence = done
});

ib.on(EventName.error, (err) => {
  if (err.message?.includes("connection is OK")) return;
  console.error("Real error:", err);
});

ib.connect();
