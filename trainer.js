require('dotenv').config();
const fs = require("fs");
const OpenAI = require("openai");
// ----------------------------
// CONFIG
// ----------------------------
const DATA_PATH = "./eurusd_5m.json";
const RULES_PATH = "./rules.json";

const SESSION_TZ = "Europe/Zurich";
const SESSION_START_HOUR = 8;
const SESSION_END_HOUR = 18;

const WIN_5M_BARS = 15;     // ~75 min
const WIN_30M_BARS = 15;    // ~7.5 h
const WIN_DAILY_BARS = 15;  // max ~15 days
const MIN_DAILY_BARS = 3;   // minimum required

const SIM_FORWARD_5M_BARS = 300; // 25h
const DEFAULT_SPREAD = 0.00008;  // ~0.8 pip

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// HELPERS
// ----------------------------
function parseIBDate(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{8})\s+(\d{2}:\d{2}:\d{2})/);
  if (!m) return null;

  const datePart = m[1];
  const timePart = m[2];

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const [hh, mm, ss] = timePart.split(":").map(Number);

  // UTC-ish container, used only for ordering and TZ conversion via toLocaleString
  return new Date(Date.UTC(year, month, day, hh, mm, ss));
}

function toTZ(date, timeZone) {
  return new Date(date.toLocaleString("en-US", { timeZone }));
}

function isInZurichSession(dateUTCish) {
  const z = toTZ(dateUTCish, SESSION_TZ);
  const day = z.getDay();
  const hour = z.getHours();
  return day >= 1 && day <= 5 && hour >= SESSION_START_HOUR && hour < SESSION_END_HOUR;
}

function ymdZurich(dateUTCish) {
  const z = toTZ(dateUTCish, SESSION_TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function loadBars(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return raw
    .map((b) => {
      const d = parseIBDate(b.time);
      if (!d) return null;

      const open = Number(b.open);
      const high = Number(b.high);
      const low = Number(b.low);
      const close = Number(b.close);

      if (![open, high, low, close].every(Number.isFinite)) return null;

      return { ...b, _t: d.getTime(), _d: d, open, high, low, close };
    })
    .filter(Boolean)
    .sort((a, b) => a._t - b._t);
}

function aggregateBars(bars, groupSize) {
  const out = [];
  for (let i = 0; i + groupSize <= bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    out.push({
      _t: chunk[chunk.length - 1]._t,
      _d: chunk[chunk.length - 1]._d,
      open: chunk[0].open,
      high: Math.max(...chunk.map((x) => x.high)),
      low: Math.min(...chunk.map((x) => x.low)),
      close: chunk[chunk.length - 1].close,
    });
  }
  return out;
}

function aggregateDaily(bars5m) {
  const map = new Map();
  for (const b of bars5m) {
    const key = ymdZurich(b._d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, arr]) => {
      arr.sort((x, y) => x._t - y._t);
      return {
        day,
        _t: arr[arr.length - 1]._t,
        _d: arr[arr.length - 1]._d,
        open: arr[0].open,
        high: Math.max(...arr.map((x) => x.high)),
        low: Math.min(...arr.map((x) => x.low)),
        close: arr[arr.length - 1].close,
      };
    });
}

function sliceEndingAt(bars, endIndex, count) {
  const start = endIndex - count + 1;
  if (start < 0) return null;
  return bars.slice(start, endIndex + 1);
}

function summarizeSeries(bars) {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  const mean = closes.reduce((a, x) => a + x, 0) / closes.length;
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range_over_mean = mean ? (max - min) / mean : 0;
  const ret = (closes[closes.length - 1] - closes[0]) / closes[0];

  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const rmean = rets.reduce((a, x) => a + x, 0) / (rets.length || 1);
  const rvar = rets.reduce((a, x) => a + (x - rmean) ** 2, 0) / (rets.length || 1);
  const vol = Math.sqrt(rvar);

  const n = closes.length;
  const xmean = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xmean) * (closes[i] - mean);
    den += (i - xmean) ** 2;
  }
  const slope = den ? num / den : 0;
  const slope_over_mean = mean ? slope / mean : 0;

  return { n, mean, max, min, range_over_mean, ret, vol, slope_over_mean, last_close: closes[n - 1] };
}

function buildLLMContext({ bars5m, bars30m, barsDaily }) {
  return {
    ctx_5m: summarizeSeries(bars5m),
    ctx_30m: summarizeSeries(bars30m),
    ctx_daily: summarizeSeries(barsDaily),
    last_close: bars5m[bars5m.length - 1].close,
  };
}

function randomAnchorIndex(bars5m) {
  const candidates = [];
  // Need ~750 bars minimum for 3 days of daily history
  for (let i = 750; i < bars5m.length - 5; i++) {
    if (isInZurichSession(bars5m[i]._d)) candidates.push(i);
  }
  if (!candidates.length) throw new Error("No session candidates found.");
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ----------------------------
// LLM CALL (STRICT JSON)
// ----------------------------
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function validateDecision(dec, fallbackEntry) {
  if (!dec || typeof dec !== "object") throw new Error("Decision not an object.");
  if (!["LONG", "SHORT"].includes(dec.side)) throw new Error("Invalid side.");

  const entry = Number(dec.entry ?? fallbackEntry);
  const tp = Number(dec.tp);
  const sl = Number(dec.sl);
  const risk = clamp01(Number(dec.risk));

  if (![entry, tp, sl].every(Number.isFinite)) throw new Error("entry/tp/sl must be numbers.");
  if (tp === sl) throw new Error("tp cannot equal sl.");

  // Basic sanity: TP/SL direction
  if (dec.side === "LONG") {
    if (!(tp > entry && sl < entry)) throw new Error("LONG must have tp>entry and sl<entry.");
  } else {
    if (!(tp < entry && sl > entry)) throw new Error("SHORT must have tp<entry and sl>entry.");
  }

  return { side: dec.side, entry, tp, sl, risk };
}

async function callLLM({ rules, context }) {
  const system = `
You are a forex intraday trade decision engine.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.
`;

  const user = `
RULES (json):
${JSON.stringify(rules)}

MARKET CONTEXT (compressed features):
${JSON.stringify(context)}

TASK:
Decide ONE trade.

OUTPUT JSON SCHEMA (strict):
{
  "side": "LONG" | "SHORT",
  "entry": number,   // suggested entry MID price
  "tp": number,      // take profit
  "sl": number,      // stop loss
  "risk": number     // 0..1
}

Constraints:
- TP and SL must be on correct sides of entry.
- risk must be in [0,1].
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    // Force JSON-only
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty LLM response.");
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("LLM did not return valid JSON.");
  }
  return obj;
}

// ----------------------------
// SIMULATION
// ----------------------------
function simulateTrade({ bars5m, entryIndex, decision, spread = DEFAULT_SPREAD, forwardBars = SIM_FORWARD_5M_BARS }) {
  const { side, entry, tp, sl, risk } = decision;

  const entryAsk = entry + spread / 2;
  const entryBid = entry - spread / 2;
  const actualEntry = side === "LONG" ? entryAsk : entryBid;

  const start = entryIndex + 1;
  const end = Math.min(bars5m.length, start + forwardBars);

  for (let i = start; i < end; i++) {
    const b = bars5m[i];

    if (side === "LONG") {
      const hitSL = b.low <= sl;
      const hitTP = b.high >= tp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, risk, note: "Both hit same bar (worst-case)" };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, risk };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, risk };
    } else {
      const hitSL = b.high >= sl;
      const hitTP = b.low <= tp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, risk, note: "Both hit same bar (worst-case)" };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, risk };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, risk };
    }
  }

  const last = bars5m[end - 1];
  return { outcome: "TIMEOUT", exitPrice: last.close, exitIndex: end - 1, risk };
}

function pnlInR({ side, entry, sl, exitPrice }) {
  const riskPerUnit = Math.abs(entry - sl);
  if (!riskPerUnit) return 0;
  return side === "LONG" ? (exitPrice - entry) / riskPerUnit : (entry - exitPrice) / riskPerUnit;
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var.");

  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const bars5m = loadBars(DATA_PATH);
  console.log(`Loaded 5m bars: ${bars5m.length}`);

  const idx = randomAnchorIndex(bars5m);
  const anchor = bars5m[idx];
  console.log("Anchor:", anchor.time);

  const win5m = sliceEndingAt(bars5m, idx, WIN_5M_BARS);
  if (!win5m) throw new Error("Not enough 5m history.");

  const need5mFor30m = WIN_30M_BARS * 6;
  const sliceFor30m = sliceEndingAt(bars5m, idx, need5mFor30m);
  if (!sliceFor30m) throw new Error("Not enough history for 30m aggregation.");
  const bars30m = aggregateBars(sliceFor30m, 6).slice(-WIN_30M_BARS);

  const upToAnchor = bars5m.slice(0, idx + 1);
  const dailyAll = aggregateDaily(upToAnchor);
  const barsDaily = dailyAll.slice(-WIN_DAILY_BARS);
  if (barsDaily.length < MIN_DAILY_BARS) throw new Error(`Not enough daily history (need ${MIN_DAILY_BARS}, got ${barsDaily.length}).`);

  const context = buildLLMContext({ bars5m: win5m, bars30m, barsDaily });

  console.log("\n--- RULES ---");
  console.log(JSON.stringify(rules, null, 2));
  console.log("\n--- CONTEXT ---");
  console.log(JSON.stringify(context, null, 2));
  console.log("");

  // LLM decision
  const rawDecision = await callLLM({ rules, context });
  const decision = validateDecision(rawDecision, context.last_close);

  console.log("Decision:", decision);

  // simulate
  const sim = simulateTrade({ bars5m, entryIndex: idx, decision });
  const R = pnlInR({ side: decision.side, entry: decision.entry, sl: decision.sl, exitPrice: sim.exitPrice });

  console.log("Sim result:", sim);
  console.log("PnL (R-multiple):", R.toFixed(3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
