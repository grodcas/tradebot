require('dotenv').config();
const fs = require("fs");
const OpenAI = require("openai");
const { computeIndicators } = require("./trade_indicators");
const { callStrategyTradeDecision, validateDecision, MAX_WAIT_BARS } = require("./strategy_selector");
const { getPairConfig } = require("./pair_config");

// ----------------------------
// CONFIG
// ----------------------------
const pairConfig = getPairConfig();
console.log(`Trading pair: ${pairConfig.displayName}`);

const DATA_PATH = pairConfig.dataFile;
const RESULTS_PATH = pairConfig.resultsFile;

const SESSION_TZ = "Europe/Zurich";
const SESSION_START_HOUR = pairConfig.tradingHours?.start || 8;
const SESSION_END_HOUR = pairConfig.tradingHours?.end || 18;

const WIN_5M_BARS = 15;
const WIN_30M_BARS = 15;
const WIN_DAILY_BARS = 15;
const MIN_DAILY_BARS = 5;

const SIM_FORWARD_5M_BARS = 300;
const DEFAULT_SPREAD = pairConfig.spread;

const NUM_SCENARIOS = 100;  // 100-trade batch test

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
  const system = `You are an expert trade analyst with deep understanding of market structure and price action.

YOUR MARKET KNOWLEDGE:

1. STRUCTURE STATE - The Foundation
   - UPTREND (+1): Higher Highs + Higher Lows = Only LONG trades have edge
   - DOWNTREND (-1): Lower Highs + Lower Lows = Only SHORT trades have edge
   - RANGE (0): Mixed swings = Mean reversion at boundaries, NO trend trades
   - Trading AGAINST structure is the #1 cause of losses

2. PULLBACK QUALITY - Entry Timing
   - 0.38-0.62 (38-62%): Ideal pullback zone for trend continuation
   - < 0.30 (shallow): Chasing - price likely to retrace more before continuing
   - > 0.70 (deep): Structure may be breaking - trend exhaustion risk

3. SUPPORT & RESISTANCE
   - In UPTREND: Support = buy zone, Resistance = profit target
   - In DOWNTREND: Resistance = sell zone, Support = profit target
   - In RANGE: Both are reversal zones - fade the extremes
   - Breaking S/R with acceptance (multiple closes beyond) = real breakout
   - Wick through S/R then close back = liquidity sweep (trade opposite direction)

4. BREAKOUT vs SWEEP (Critical distinction)
   - Breakout Score > 0.3: Bullish expansion, price accepted above resistance
   - Breakout Score < -0.3: Bearish expansion, price accepted below support
   - Sweep Score > 0.2: Bullish sweep - stopped out longs below support, then reversed UP
   - Sweep Score < -0.2: Bearish sweep - stopped out shorts above resistance, then reversed DOWN
   - Sweeps are REVERSAL signals, Breakouts are CONTINUATION signals

5. MARKET REGIME
   - TREND: Clear structure + EMA alignment = trade with trend only
   - EXPANSION: High volatility breakout = momentum trades, wide stops needed
   - RANGE: No clear direction = fade extremes or stay out

6. COMMON FAILURE PATTERNS
   - Counter-trend trade in strong trend (structure was against the trade)
   - Chasing extended move (pullback ratio too shallow, no retracement)
   - Trading middle of range (no edge zone - not at S/R)
   - Stop too tight for volatility (< 1 ATR gets hit by noise)
   - Mistaking sweep for breakout (entered continuation when it was reversal)
   - Trading breakout that failed (no acceptance, price returned inside range)

OUTPUT FORMAT (JSON only):
{
  "entry_quality": "Evaluate entry timing using pullback ratio and position relative to S/R",
  "what_happened": "Describe price action: Did it trend, reverse, sweep, or chop?",
  "why_outcome": "Root cause using market structure logic - was setup valid for the conditions?",
  "lessons": "Specific rule: What indicator/condition should have prevented this or confirmed it?",
  "rating": "GOOD | BAD | NEUTRAL"
}`;

  const priceAfterEntry = priceBarsAfterEntry.map(b => ({
    time: b.time,
    O: b.open.toFixed(5),
    H: b.high.toFixed(5),
    L: b.low.toFixed(5),
    C: b.close.toFixed(5)
  }));

  // Determine if trade was with or against structure
  const withTrend = (decision.side === 'LONG' && indicators.structureState === 1) ||
                    (decision.side === 'SHORT' && indicators.structureState === -1);
  const counterTrend = (decision.side === 'LONG' && indicators.structureState === -1) ||
                       (decision.side === 'SHORT' && indicators.structureState === 1);
  const trendAlignment = withTrend ? "WITH TREND" : counterTrend ? "COUNTER-TREND" : "NO CLEAR TREND";

  // Pullback quality assessment
  const pullbackQuality = indicators.pullbackRatio < 0.30 ? "SHALLOW (chasing)" :
                          indicators.pullbackRatio > 0.70 ? "DEEP (structure risk)" :
                          indicators.pullbackRatio >= 0.38 && indicators.pullbackRatio <= 0.62 ? "IDEAL ZONE" : "ACCEPTABLE";

  const user = `
TRADE REVIEW REQUEST

**STRUCTURE AT ENTRY:**
- Structure State: ${indicators.structureLabel} (${indicators.structureState})
- Trade Direction: ${decision.side}
- Alignment: ${trendAlignment}
- Market Regime: ${indicators.marketRegime}

**ENTRY TIMING:**
- Pullback Ratio: ${(indicators.pullbackRatio * 100).toFixed(0)}% → ${pullbackQuality}
- Breakout Score: ${indicators.breakoutScore?.toFixed(2) || 'N/A'} (>0.3 bullish, <-0.3 bearish)
- Sweep Score: ${indicators.sweepScore?.toFixed(2) || 'N/A'} (>0.2 bull sweep, <-0.2 bear sweep)
- Acceptance Time: ${indicators.acceptanceTime?.toFixed(2) || 'N/A'} (>0.5 = confirmed beyond level)

**KEY LEVELS:**
- Entry: ${decision.entry?.toFixed(5)}
- Stop Loss: ${decision.sl?.toFixed(5)} (${((Math.abs(decision.entry - decision.sl) / indicators.ATR_5m) || 0).toFixed(1)} ATR)
- Take Profit: ${decision.tp?.toFixed(5)}
- Prev Session High: ${indicators.prevSessionHigh?.toFixed(5) || 'N/A'}
- Prev Session Low: ${indicators.prevSessionLow?.toFixed(5) || 'N/A'}
- Support: ${indicators.support?.toFixed(5) || 'N/A'}
- Resistance: ${indicators.resistance?.toFixed(5) || 'N/A'}

**PRICE CONTEXT (5M closes before entry):**
[${context.prices_5m.map(p => p.toFixed(5)).join(', ')}]

**WHAT HAPPENED AFTER ENTRY (first 10 bars):**
${priceAfterEntry.slice(0, 10).map(b => `${b.time}: O=${b.O} H=${b.H} L=${b.L} C=${b.C}`).join('\n')}

**OUTCOME:**
- Result: ${simResult.outcome}
- Exit Price: ${simResult.exitPrice?.toFixed(5)}
- Bars to Exit: ${simResult.barsToExit}
- PnL: ${R.toFixed(2)}R

**ORIGINAL REASONING:** ${decision.reasoning?.slice(0, 200)}

Analyze using your market structure knowledge. Be specific about what went right or wrong. Max 1.5K chars.`;

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
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsToExit: i - entryIndex };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsToExit: i - entryIndex };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, barsToExit: i - entryIndex };
    } else {
      const hitSL = b.high >= sl;
      const hitTP = b.low <= tp;
      if (hitSL && hitTP) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsToExit: i - entryIndex };
      if (hitSL) return { outcome: "SL", exitPrice: sl, exitIndex: i, barsToExit: i - entryIndex };
      if (hitTP) return { outcome: "TP", exitPrice: tp, exitIndex: i, barsToExit: i - entryIndex };
    }
  }

  const last = bars5m[end - 1];
  return { outcome: "TIMEOUT", exitPrice: last.close, exitIndex: end - 1, barsToExit: end - 1 - entryIndex };
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
  let totalRisk = 0;  // Track sum of all position sizes
  let riskValues = [];  // Track individual risk values for distribution analysis

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
          const defaultRange = 10 / pairConfig.pipMultiplier; // 10 pips in price terms
          decision = {
            side: "LONG",
            entry: closePrice,
            tp: closePrice + defaultRange,
            sl: closePrice - defaultRange,
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

      // Simulate from the actual entry point
      const simResult = simulateTrade({ bars5m, entryIndex: entryIdx, decision });
      const rawR = pnlInR({ side: decision.side, entry: decision.entry, sl: decision.sl, exitPrice: simResult.exitPrice });
      const weightedR = rawR * decision.risk;

      // Track stats
      totalWaits += decision.waitCount || 0;
      if (decision.risk === 0) {
        skipped++;
        console.log(`   SKIPPED (risk=0)`);
      } else {
        totalRawR += rawR;
        totalR += weightedR;
        totalRisk += decision.risk;
        riskValues.push(decision.risk);
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
        ? (decision.tp - decision.entry) / Math.abs(decision.entry - decision.sl)
        : (decision.entry - decision.tp) / Math.abs(decision.sl - decision.entry);
      console.log(`   ${decision.side} | TP target: ${tpR.toFixed(2)}R | Result: ${rawR.toFixed(2)}R x ${decision.risk.toFixed(1)} = ${weightedR.toFixed(2)} | ${simResult.outcome}${waitInfo}`);
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
          entry: decision.entry,
          tp: decision.tp,
          sl: decision.sl,
          risk: decision.risk,
          reasoning: decision.reasoning,
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

    await new Promise(r => setTimeout(r, 2000));  // 2s sleep between trades to reduce CPU load
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

  // Normalized R comparison (fair comparison between raw and weighted)
  const avgRisk = executed ? totalRisk / executed : 0;
  const normalizedWeightedR = avgRisk > 0 ? totalR / avgRisk : 0;
  console.log(`\n--- NORMALIZED COMPARISON ---`);
  console.log(`Avg position size: ${avgRisk.toFixed(3)}`);
  console.log(`Normalized Weighted R: ${normalizedWeightedR.toFixed(2)} (Weighted R ÷ Avg Risk)`);
  console.log(`Raw R (for reference): ${totalRawR.toFixed(2)}`);

  // Risk distribution analysis
  if (riskValues.length > 0) {
    const minRisk = Math.min(...riskValues);
    const maxRisk = Math.max(...riskValues);
    const riskStdDev = Math.sqrt(riskValues.reduce((sum, r) => sum + Math.pow(r - avgRisk, 2), 0) / riskValues.length);
    const uniqueRisks = [...new Set(riskValues.map(r => r.toFixed(2)))].length;
    console.log(`\n--- RISK DISTRIBUTION ---`);
    console.log(`Range: ${minRisk.toFixed(2)} to ${maxRisk.toFixed(2)}`);
    console.log(`Std Dev: ${riskStdDev.toFixed(3)}`);
    console.log(`Unique values: ${uniqueRisks} (of ${riskValues.length} trades)`);
  }

  console.log(`\nAvg waits per trade: ${(totalWaits/NUM_SCENARIOS).toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
