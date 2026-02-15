require('dotenv').config();
const fs = require("fs");
const OpenAI = require("openai");
const { computeIndicators, printIndicators } = require("./trade_indicators");
const { callStrategyTradeDecision, validateDecision, MAX_WAIT_BARS } = require("./strategy_selector");

// ----------------------------
// CONFIG
// ----------------------------
const DATA_PATH = "./eurusd_5m.json";
const RULES_PATH = "./rules.json";
const RESULTS_PATH = "./trade_results.json";

const SESSION_TZ = "Europe/Zurich";
const SESSION_START_HOUR = 8;
const SESSION_END_HOUR = 18;

const WIN_5M_BARS = 15;
const WIN_30M_BARS = 15;
const WIN_DAILY_BARS = 15;     // max daily bars to use
const MIN_DAILY_BARS = 5;      // minimum required

const SIM_FORWARD_5M_BARS = 300;
const DEFAULT_SPREAD = 0.00008;

const NUM_SCENARIOS = 15;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// HELPERS (same as trainer.js)
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

function getRandomAnchorIndices(bars5m, count) {
  const candidates = [];
  // Need ~750 bars minimum for 3 days of daily history (3 days * ~250 bars/day)
  const minIndex = 750;
  for (let i = minIndex; i < bars5m.length - SIM_FORWARD_5M_BARS; i++) {
    if (isInZurichSession(bars5m[i]._d)) candidates.push(i);
  }
  if (candidates.length < count) throw new Error(`Not enough candidates: ${candidates.length}`);

  // Shuffle and pick first 'count'
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

// ----------------------------
// LLM CALLS
// ----------------------------
async function callTradeSummary({ context, decision, simResult, R }) {
  const system = `
You are a trading analyst. Analyze the trade and explain what happened.
Output valid JSON only.
`;

  const user = `
MARKET CONTEXT at entry:
${JSON.stringify(context)}

DECISION:
${JSON.stringify(decision)}

SIMULATION RESULT:
${JSON.stringify(simResult)}

PnL (R-multiple): ${R.toFixed(3)}

Analyze this trade. Output JSON:
{
  "entry_reasoning": "Why this entry made sense (or didn't) given the context",
  "what_happened": "What price did after entry, why TP/SL/timeout occurred",
  "why_outcome": "Root cause of win/loss - was it the strategy, market conditions, or bad luck?",
  "lessons": "What rule changes could improve this outcome?",
  "rating": "GOOD" | "BAD" | "NEUTRAL"
}
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) return { error: "Empty summary response" };
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON in summary", raw: text };
  }
}

// ----------------------------
// SIMULATION
// ----------------------------
function simulateTrade({ bars5m, entryIndex, decision, spread = DEFAULT_SPREAD, forwardBars = SIM_FORWARD_5M_BARS }) {
  const { side, entry, tp, sl } = decision;

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
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsHeld: i - entryIndex };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsHeld: i - entryIndex };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, barsHeld: i - entryIndex };
    } else {
      const hitSL = b.high >= sl;
      const hitTP = b.low <= tp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsHeld: i - entryIndex };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsHeld: i - entryIndex };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, barsHeld: i - entryIndex };
    }
  }

  const last = bars5m[end - 1];
  return { outcome: "TIMEOUT", exitPrice: last.close, exitIndex: end - 1, barsHeld: end - 1 - entryIndex };
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

  const anchors = getRandomAnchorIndices(bars5m, NUM_SCENARIOS);
  console.log(`Selected ${anchors.length} random scenarios\n`);

  const results = [];
  let wins = 0, losses = 0, timeouts = 0, skipped = 0;
  let totalRawR = 0;   // Unweighted R (trade quality)
  let totalR = 0;      // Weighted R (actual PnL impact)
  let totalWaits = 0;

  for (let i = 0; i < anchors.length; i++) {
    const idx = anchors[i];
    const anchor = bars5m[idx];
    console.log(`[${i + 1}/${NUM_SCENARIOS}] Anchor: ${anchor.time}`);

    try {
      // Build context
      const win5m = sliceEndingAt(bars5m, idx, WIN_5M_BARS);
      if (!win5m) throw new Error("Not enough 5m history.");

      const need5mFor30m = WIN_30M_BARS * 6;
      const sliceFor30m = sliceEndingAt(bars5m, idx, need5mFor30m);
      if (!sliceFor30m) throw new Error("Not enough history for 30m.");
      const bars30m = aggregateBars(sliceFor30m, 6).slice(-WIN_30M_BARS);

      const upToAnchor = bars5m.slice(0, idx + 1);
      const dailyAll = aggregateDaily(upToAnchor);
      const barsDaily = dailyAll.slice(-WIN_DAILY_BARS);  // take up to 15, or as many as available
      if (barsDaily.length < MIN_DAILY_BARS) throw new Error(`Not enough daily history (need ${MIN_DAILY_BARS}, got ${barsDaily.length}).`);

      const context = buildLLMContext({ bars5m: win5m, bars30m, barsDaily });

      // Compute and print trade indicators
      const indicators = computeIndicators(bars5m, bars30m, idx);
      printIndicators(indicators);

      // Entry timing loop - AI can wait up to 4 bars (20 min)
      let waitCount = 0;
      let entryIdx = idx;
      let decision = null;
      let waitHistory = [];
      let selectedStrategy = null;  // Track selected strategy across waits

      while (waitCount <= MAX_WAIT_BARS) {
        const mustTrade = waitCount === MAX_WAIT_BARS;
        const currentBar = {
          time: bars5m[entryIdx].time,
          open: bars5m[entryIdx].open,
          high: bars5m[entryIdx].high,
          low: bars5m[entryIdx].low,
          close: bars5m[entryIdx].close,
        };

        // Use strategy selector instead of direct trade decision
        const rawDecision = await callStrategyTradeDecision({
          rules,
          context,
          indicators,
          currentBar,
          waitCount,
          mustTrade,
          waitHistory,
        });

        // Capture strategy on first call
        if (waitCount === 0 && rawDecision.selectedStrategy) {
          selectedStrategy = rawDecision.selectedStrategy;
        }

        if (rawDecision.action === "WAIT" && !mustTrade) {
          // Store strategy in wait history so subsequent calls use same strategy
          waitHistory.push({
            bar: currentBar,
            reasoning: rawDecision.reasoning,
            strategy: selectedStrategy,
          });
          console.log(`   WAIT ${waitCount + 1}/${MAX_WAIT_BARS}: ${rawDecision.reasoning?.slice(0, 80)}...`);
          waitCount++;
          entryIdx++;
          if (entryIdx >= bars5m.length - SIM_FORWARD_5M_BARS) {
            throw new Error("Ran out of bars while waiting.");
          }
          await new Promise(r => setTimeout(r, 300)); // small delay between waits
        } else if (rawDecision.action === "WAIT" && mustTrade) {
          // AI refused to trade even when forced - create skip trade with risk=0
          const closePrice = bars5m[entryIdx].close;
          decision = {
            side: "LONG",  // arbitrary, won't matter since risk=0
            entry: closePrice,
            tp: closePrice + 0.001,
            sl: closePrice - 0.001,
            risk: 0,
            reasoning: rawDecision.reasoning || "Refused to trade - conditions not met",
            skippedByAI: true,
            selectedStrategy: selectedStrategy,
          };
          decision.waitCount = waitCount;
          decision.waitHistory = waitHistory;
          break;
        } else {
          decision = validateDecision(rawDecision, bars5m[entryIdx].close);
          decision.waitCount = waitCount;
          decision.waitHistory = waitHistory;
          decision.selectedStrategy = selectedStrategy;
          if (rawDecision.strategyReasoning) {
            decision.strategyReasoning = rawDecision.strategyReasoning;
          }
          break;
        }
      }

      // Simulate from the actual entry point
      const simResult = simulateTrade({ bars5m, entryIndex: entryIdx, decision });
      const rawR = pnlInR({ side: decision.side, entry: decision.entry, sl: decision.sl, exitPrice: simResult.exitPrice });
      const weightedR = rawR * decision.risk;  // Position-sized R

      // Track stats
      totalWaits += decision.waitCount || 0;
      if (decision.risk === 0) {
        skipped++;
        console.log(`   SKIPPED (risk=0)`);
      } else {
        totalRawR += rawR;      // Unweighted (trade quality)
        totalR += weightedR;    // Weighted (actual PnL)
        if (simResult.outcome === "TP") wins++;
        else if (simResult.outcome === "SL") losses++;
        else timeouts++;
      }

      // Get AI summary
      const summary = await callTradeSummary({ context, decision, simResult, R: rawR });

      const waitInfo = decision.waitCount > 0 ? ` (waited ${decision.waitCount * 5}min)` : "";
      const strategyInfo = decision.selectedStrategy ? ` [${decision.selectedStrategy}]` : "";
      const tpR = decision.side === "LONG"
        ? (decision.tp - decision.entry) / Math.abs(decision.entry - decision.sl)
        : (decision.entry - decision.tp) / Math.abs(decision.sl - decision.entry);
      console.log(`   ${decision.side}${strategyInfo} | TP target: ${tpR.toFixed(2)}R | Result: ${rawR.toFixed(2)}R × ${decision.risk.toFixed(1)} = ${weightedR.toFixed(2)} | ${simResult.outcome}${waitInfo}`);
      console.log(`   Reasoning: ${decision.reasoning?.slice(0, 150)}...`);

      results.push({
        tradeNum: i + 1,
        anchorTime: anchor.time,
        entryTime: bars5m[entryIdx].time,
        waitCount: decision.waitCount,
        selectedStrategy: decision.selectedStrategy,
        strategyReasoning: decision.strategyReasoning,
        indicators: {
          currentSession: indicators.currentSession,
          previousSession: indicators.previousSession,
          support: indicators.support,
          resistance: indicators.resistance,
          swingHighs: indicators.swingHighs,
          swingLows: indicators.swingLows,
        },
        context,
        decision,
        simResult,
        rawR,
        weightedR,
        summary,
      });

    } catch (err) {
      console.log(`   ERROR: ${err.message}`);
      results.push({
        tradeNum: i + 1,
        anchorTime: anchor.time,
        error: err.message,
      });
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  // Save results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${RESULTS_PATH}`);

  // Print summary
  const executed = wins + losses + timeouts;
  console.log("\n=== BATCH SUMMARY ===");
  console.log(`Total scenarios: ${NUM_SCENARIOS}`);
  console.log(`Executed trades: ${executed}`);
  console.log(`Skipped (risk=0): ${skipped}`);
  console.log(`Wins (TP): ${wins} (${executed ? (wins/executed*100).toFixed(1) : 0}%)`);
  console.log(`Losses (SL): ${losses} (${executed ? (losses/executed*100).toFixed(1) : 0}%)`);
  console.log(`Timeouts: ${timeouts}`);
  console.log(`Raw R (trade quality): ${totalRawR.toFixed(2)} (avg: ${executed ? (totalRawR/executed).toFixed(3) : 0})`);
  console.log(`Weighted R (actual PnL): ${totalR.toFixed(2)} (avg: ${executed ? (totalR/executed).toFixed(3) : 0})`);
  console.log(`Avg waits per trade: ${(totalWaits/NUM_SCENARIOS).toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
