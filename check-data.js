const fs = require("fs");

const bars = JSON.parse(fs.readFileSync("eurusd_5m.json"));

function parseIB(barDate) {
  const m = String(barDate).match(
    /^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;

  const [, Y, Mo, D, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(Y, Mo - 1, D, h, mi, s));
}

function toZurich(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
}

// Group bars by Zurich date
const days = {};

for (const bar of bars) {
  const utc = parseIB(bar.date);
  if (!utc) continue;

  const zurich = toZurich(utc);

  const day = zurich.getDay(); // 0 Sun
  if (day === 0 || day === 6) continue;

  const hour = zurich.getHours();
  const minute = zurich.getMinutes();

  if (hour >= 8 && hour < 18) {
    const key = zurich.toISOString().slice(0, 10);
    if (!days[key]) days[key] = [];
    days[key].push(`${hour}:${minute}`);
  }
}

// Check completeness
for (const date of Object.keys(days).sort()) {
  const count = days[date].length;

  if (count === 120) {
    console.log(`OK  ${date} → 120 bars`);
  } else {
    console.log(`MISS ${date} → ${count} bars`);
  }
}
