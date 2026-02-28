require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require("fs");
const OpenAI = require("openai");
const { computeIndicators } = require("./trade_indicators");
const { callStrategyTradeDecision, validateDecision, MAX_WAIT_BARS } = require("./strategy_selector");

// ----------------------------
// CONFIG
// ----------------------------
// Use OANDA data by default, fall back to IBKR data
const DATA_PATH = process.env.DATA_PATH ||
  require('path').join(__dirname, "../data/eurusd_5m_oanda.json");
const RESULTS_PATH = require('path').join(__dirname, "../results/trade_results.json");

const SESSION_TZ = "Europe/Zurich";
const SESSION_START_HOUR = 8;
const SESSION_END_HOUR = 18;

const WIN_5M_BARS = 15;
const WIN_30M_BARS = 15;
const WIN_DAILY_BARS = 15;
const MIN_DAILY_BARS = 5;

const SIM_FORWARD_5M_BARS = 300;
const DEFAULT_SPREAD = 0.00008;

const NUM_SCENARIOS = 30;

// CPU-light mode: delay between trades (milliseconds)
// Higher = less CPU, slower execution
// 0 = no delay, 3000 = 3 sec, 5000 = 5 sec
const DELAY_BETWEEN_TRADES = parseInt(process.env.TRADE_DELAY || "3000");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// HELPERS
// ----------------------------

/**
 * Parse date from either IBKR or OANDA format
 * IBKR: "20260210 17:15:00 US/Eastern"
 * OANDA: "2026-02-10T22:15:00.000Z" (ISO)
 */
function parseDate(str) {
  if (!str || typeof str !== "string") return null;

  // Try IBKR format first: YYYYMMDD HH:MM:SS
  const ibkrMatch = str.match(/^(\d{8})\s+(\d{2}:\d{2}:\d{2})/);
  if (ibkrMatch) {
    const datePart = ibkrMatch[1];
    const timePart = ibkrMatch[2];
    const year = Number(datePart.slice(0, 4));
    const month = Number(datePart.slice(4, 6)) - 1;
    const day = Number(datePart.slice(6, 8));
    const [hh, mm, ss] = timePart.split(":").map(Number);
    return new Date(Date.UTC(year, month, day, hh, mm, ss));
  }

  // Try ISO format (OANDA)
  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  return null;
}

// Legacy alias for compatibility
function parseIBDate(str) {
  return parseDate(str);
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

function loadBars(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // Handle OANDA format (has metadata wrapper) or plain array (IBKR)
  const candles = Array.isArray(raw) ? raw : (raw.candles || raw);

  if (raw.metadata) {
    console.log(`Data source: ${raw.metadata.source || 'unknown'}`);
    console.log(`Date range: ${raw.metadata.from?.slice(0, 10)} to ${raw.metadata.to?.slice(0, 10)}`);
  }

  return candles
    .map((b) => {
      const d = parseDate(b.time);
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

function buildLLMContext({ bars5m, bars30m, barsDaily }) {
  const prices5m = bars5m.map(b => b.close);
  const prices30m = bars30m.map(b => b.close);
  const pricesDaily = barsDaily.map(b => b.close);

  const ranges5m = bars5m.map(b => b.high - b.low);
  const ranges30m = bars30m.map(b => b.high - b.low);
  const rangesDaily = barsDaily.map(b => b.high - b.low);

  return {
    prices_5m: prices5m,
    prices_30m: prices30m,
    prices_daily: pricesDaily,
    ranges_5m: ranges5m,
    ranges_30m: ranges30m,
    ranges_daily: rangesDaily,
    last_close: bars5m[bars5m.length - 1].close,
  };
}

function getRandomAnchorIndices(bars5m, count) {
  const candidates = [];
  const minIndex = 750;
  for (let i = minIndex; i < bars5m.length - SIM_FORWARD_5M_BARS; i++) {
    if (isInZurichSession(bars5m[i]._d)) candidates.push(i);
  }
  if (candidates.length < count) throw new Error(`Not enough candidates: ${candidates.length}`);

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

// ----------------------------
// LLM CALLS
// ----------------------------
async function callTradeSummary({ context, decision, simResult, R, indicators, priceBarsAfterEntry }) {
  const system = `
You are a professional trading analyst reviewing completed trades.
Your job is to analyze what happened and explain WHY the trade won or lost.
Be specific and reference actual price levels. Output valid JSON only.
`;

  const priceAfterEntry = priceBarsAfterEntry.map(b => ({
    time: b.time,
    O: b.open.toFixed(5),
    H: b.high.toFixed(5),
    L: b.low.toFixed(5),
    C: b.close.toFixed(5)
  }));

  const user = `
MARKET CONDITIONS AT ENTRY:
- Session: ${indicators.currentSession}
- Market Regime: ${indicators.marketRegime}
- Structure State: ${indicators.structureState} (${indicators.structureLabel})
- Breakout Score: ${indicators.breakoutScore}
- Sweep Score: ${indicators.sweepScore}
- Pullback Ratio: ${indicators.pullbackRatio}
- Acceptance Time: ${indicators.acceptanceTime}
- ATR_5m: ${indicators.ATR_5m}
- Prev Session High: ${indicators.prevSessionHigh}
- Prev Session Low: ${indicators.prevSessionLow}

PRICE CONTEXT AT ENTRY (15 candles before):
5M closes: [${context.prices_5m.map(p => p.toFixed(5)).join(', ')}]
30M closes: [${context.prices_30m.map(p => p.toFixed(5)).join(', ')}]

TRADE DECISION:
- Side: ${decision.side}
- Entry: ${decision.entry}
- Stop Loss: ${decision.sl}
- Take Profit: ${decision.tp}
- Risk: ${decision.risk}
- Original Reasoning: ${decision.reasoning}

PRICE ACTION AFTER ENTRY (${priceAfterEntry.length} bars until exit, only showing 15 next bars):
${priceAfterEntry.slice(0, 15).map(b => `${b.time}: O=${b.O}`).join('\n')}

OUTCOME:
- Result: ${simResult.outcome} (TP=win, SL=loss, TIMEOUT=expired)
- Exit Price: ${simResult.exitPrice}
- Bars to Exit: ${simResult.barsToExit}
- PnL (R-multiple): ${R.toFixed(3)}

Analyze this trade thoroughly. Output JSON:
{
  "entry_quality": "Was the entry well-timed given the conditions? Reference specific indicators.",
  "what_happened": "Describe the price action after entry. What did price actually do?",
  "why_outcome": "Root cause: Was it good/bad execution, unfavorable market conditions, or random noise?",
  "lessons": "Specific actionable improvements for the strategy rules or execution.",
  "rating": "GOOD | BAD | NEUTRAL",
   DO NOT OUTPUT MORE THAN 1.5K chars
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
/**
 * Simulate trade with MARKET ORDER entry (like live trading)
 * - Enters at next bar's open (market price), NOT AI's suggested entry
 * - Adjusts SL/TP to maintain the same R:R ratio from actual entry
 */
function simulateTrade({ bars5m, entryIndex, decision, spread = DEFAULT_SPREAD, forwardBars = SIM_FORWARD_5M_BARS }) {
  const { side, entry: aiEntry, tp: aiTp, sl: aiSl } = decision;

  const start = entryIndex + 1;
  const end = Math.min(bars5m.length, start + forwardBars);

  if (start >= bars5m.length) {
    return { outcome: "TIMEOUT", exitPrice: aiEntry, exitIndex: entryIndex, barsToExit: 0, actualEntry: aiEntry, adjustedTp: aiTp, adjustedSl: aiSl };
  }

  // MARKET ORDER: Enter at next bar's open (simulates immediate market fill)
  const nextBar = bars5m[start];
  const marketPrice = nextBar.open;

  // Apply spread to get actual fill price
  const actualEntry = side === "LONG" ? marketPrice + spread / 2 : marketPrice - spread / 2;

  // Calculate original R:R from AI decision (same as live_trader.js)
  const originalRisk = Math.abs(aiEntry - aiSl);
  const originalReward = Math.abs(aiTp - aiEntry);

  // Adjust SL/TP based on actual entry, maintaining same distances (preserves R:R)
  let adjustedSl, adjustedTp;
  if (side === "LONG") {
    adjustedSl = actualEntry - originalRisk;
    adjustedTp = actualEntry + originalReward;
  } else {
    adjustedSl = actualEntry + originalRisk;
    adjustedTp = actualEntry - originalReward;
  }

  // Round to 5 decimal places
  adjustedSl = Math.round(adjustedSl * 100000) / 100000;
  adjustedTp = Math.round(adjustedTp * 100000) / 100000;

  // Simulate forward using adjusted levels
  for (let i = start; i < end; i++) {
    const b = bars5m[i];

    if (side === "LONG") {
      const hitSL = b.low <= adjustedSl;
      const hitTP = b.high >= adjustedTp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: adjustedSl, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
      if (hitSL) return { outcome: "SL", exitPrice: adjustedSl, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
      if (hitTP) return { outcome: "TP", exitPrice: adjustedTp, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
    } else {
      const hitSL = b.high >= adjustedSl;
      const hitTP = b.low <= adjustedTp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: adjustedSl, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
      if (hitSL) return { outcome: "SL", exitPrice: adjustedSl, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
      if (hitTP) return { outcome: "TP", exitPrice: adjustedTp, exitIndex: i, barsToExit: i - entryIndex, actualEntry, adjustedTp, adjustedSl };
    }
  }

  const last = bars5m[end - 1];
  return { outcome: "TIMEOUT", exitPrice: last.close, exitIndex: end - 1, barsToExit: end - 1 - entryIndex, actualEntry, adjustedTp, adjustedSl };
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

  const bars5m = loadBars(DATA_PATH);
  console.log(`Loaded 5m bars: ${bars5m.length}`);

  const anchors = getRandomAnchorIndices(bars5m, NUM_SCENARIOS);
  console.log(`Selected ${anchors.length} random scenarios\n`);

  const results = [];
  let wins = 0, losses = 0, timeouts = 0, skipped = 0;
  let totalRawR = 0;
  let totalR = 0;
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
      const barsDaily = dailyAll.slice(-WIN_DAILY_BARS);
      if (barsDaily.length < MIN_DAILY_BARS) throw new Error(`Not enough daily history (need ${MIN_DAILY_BARS}, got ${barsDaily.length}).`);

      const context = buildLLMContext({ bars5m: win5m, bars30m, barsDaily });
      const indicators = computeIndicators(bars5m, bars30m, idx);

      // Entry timing loop
      let waitCount = 0;
      let entryIdx = idx;
      let decision = null;
      let waitHistory = [];

      while (waitCount <= MAX_WAIT_BARS) {
        const mustTrade = waitCount >= MAX_WAIT_BARS;  // Allow WAIT until max reached
        const currentBar = {
          time: bars5m[entryIdx].time,
          open: bars5m[entryIdx].open,
          high: bars5m[entryIdx].high,
          low: bars5m[entryIdx].low,
          close: bars5m[entryIdx].close,
        };

        const rawDecision = await callStrategyTradeDecision({
          context,
          indicators,
          currentBar,
          waitCount,
          mustTrade,
          waitHistory,
        });

        if (rawDecision.action === "WAIT" && !mustTrade) {
          waitHistory.push({
            bar: currentBar,
            reasoning: rawDecision.reasoning,
          });
          console.log(`   WAIT ${waitCount + 1}/${MAX_WAIT_BARS}: ${rawDecision.reasoning?.slice(0, 80)}...`);
          waitCount++;
          entryIdx++;
          if (entryIdx >= bars5m.length - SIM_FORWARD_5M_BARS) {
            throw new Error("Ran out of bars while waiting.");
          }
          await new Promise(r => setTimeout(r, 300));
        } else if (rawDecision.action === "WAIT" && mustTrade) {
          const closePrice = bars5m[entryIdx].close;
          decision = {
            side: "LONG",
            entry: closePrice,
            tp: closePrice + 0.001,
            sl: closePrice - 0.001,
            risk: 0,
            reasoning: rawDecision.reasoning || "Refused to trade - conditions not met",
            skippedByAI: true,
          };
          decision.waitCount = waitCount;
          decision.waitHistory = waitHistory;
          break;
        } else {
          decision = validateDecision(rawDecision, bars5m[entryIdx].close, indicators);
          decision.waitCount = waitCount;
          decision.waitHistory = waitHistory;
          break;
        }
      }

      // Simulate from the actual entry point (MARKET ORDER - enters at next bar open)
      const simResult = simulateTrade({ bars5m, entryIndex: entryIdx, decision });

      // Use ACTUAL entry and ADJUSTED SL for R calculation (like live trading)
      const actualEntry = simResult.actualEntry || decision.entry;
      const adjustedSl = simResult.adjustedSl || decision.sl;
      const adjustedTp = simResult.adjustedTp || decision.tp;

      const rawR = pnlInR({ side: decision.side, entry: actualEntry, sl: adjustedSl, exitPrice: simResult.exitPrice });
      const weightedR = rawR * decision.risk;

      // Track stats
      totalWaits += decision.waitCount || 0;
      if (decision.risk === 0) {
        skipped++;
        console.log(`   SKIPPED (risk=0)`);
      } else {
        totalRawR += rawR;
        totalR += weightedR;
        if (simResult.outcome === "TP") wins++;
        else if (simResult.outcome === "SL") losses++;
        else timeouts++;
      }

      // Get AI summary
      const exitBarIdx = entryIdx + (simResult.barsToExit || 0);
      const priceBarsAfterEntry = bars5m.slice(entryIdx, Math.min(exitBarIdx + 1, bars5m.length));

      const summary = await callTradeSummary({
        context,
        decision,
        simResult,
        R: rawR,
        indicators,
        priceBarsAfterEntry,
      });

      const waitInfo = decision.waitCount > 0 ? ` (waited ${decision.waitCount * 5}min)` : "";
      const tpR = decision.side === "LONG"
        ? (adjustedTp - actualEntry) / Math.abs(actualEntry - adjustedSl)
        : (actualEntry - adjustedTp) / Math.abs(adjustedSl - actualEntry);

      // Show slippage info (difference between AI entry and actual market entry)
      const slippage = actualEntry - decision.entry;
      const slippageInfo = Math.abs(slippage) > 0.00001 ? ` | Slip: ${slippage > 0 ? '+' : ''}${(slippage * 10000).toFixed(1)}pips` : "";

      console.log(`   ${decision.side} @ ${actualEntry.toFixed(5)}${slippageInfo} | TP: ${tpR.toFixed(2)}R | Result: ${rawR.toFixed(2)}R x ${decision.risk.toFixed(1)} = ${weightedR.toFixed(2)} | ${simResult.outcome}${waitInfo}`);
      console.log(`   Reasoning: ${decision.reasoning?.slice(0, 150)}...`);

      if (summary && !summary.error) {
        const ratingIcon = summary.rating === "GOOD" ? "+" : summary.rating === "BAD" ? "-" : "o";
        console.log(`   Analysis: ${ratingIcon} ${summary.rating} | ${summary.why_outcome?.slice(0, 120)}...`);
      }

      results.push({
        tradeNum: i + 1,
        anchorTime: anchor.time,
        entryTime: bars5m[entryIdx].time,
        indicators: {
          currentSession: indicators.currentSession,
          previousSession: indicators.previousSession,
          marketRegime: indicators.marketRegime,
          structureState: indicators.structureState,
          structureLabel: indicators.structureLabel,
          breakoutScore: indicators.breakoutScore,
          breakoutBarsAgo: indicators.breakoutBarsAgo,
          sweepScore: indicators.sweepScore,
          sweepBarsAgo: indicators.sweepBarsAgo,
          pullbackRatio: indicators.pullbackRatio,
          acceptanceTime: indicators.acceptanceTime,
          EMA50_slope_30m: indicators.EMA50_slope_30m,
          ATR_5m: indicators.ATR_5m,
          ATR_30m: indicators.ATR_30m,
          support: indicators.support,
          resistance: indicators.resistance,
          prevSessionHigh: indicators.prevSessionHigh,
          prevSessionLow: indicators.prevSessionLow,
        },
        decision: {
          side: decision.side,
          aiEntry: decision.entry,  // AI's suggested entry
          aiTp: decision.tp,        // AI's suggested TP
          aiSl: decision.sl,        // AI's suggested SL
          risk: decision.risk,
          reasoning: decision.reasoning,
        },
        execution: {
          actualEntry: actualEntry,   // Market fill price
          adjustedTp: adjustedTp,     // TP adjusted from market entry
          adjustedSl: adjustedSl,     // SL adjusted from market entry
          slippage: actualEntry - decision.entry,  // Slippage in price
        },
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

    // CPU-light delay between trades
    if (DELAY_BETWEEN_TRADES > 0) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_TRADES));
    }
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
