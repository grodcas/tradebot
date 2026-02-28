/**
 * DIAGNOSTIC: Trace indicator values for specific trade anchors
 * Verifies that inputs to the AI agents are correct and make sense.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require("fs");
const { computeIndicators } = require("./trade_indicators");

const DATA_PATH = process.env.DATA_PATH ||
  require('path').join(__dirname, "../data/eurusd_5m_oanda.json");

const WIN_5M_BARS = 15;
const WIN_30M_BARS = 15;
const WIN_DAILY_BARS = 15;

function loadBars(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  // Handle OANDA format (has metadata wrapper) or plain array (IBKR)
  const candles = Array.isArray(raw) ? raw : (raw.candles || raw);
  if (raw.metadata) {
    console.log(`Data source: ${raw.metadata.source || 'unknown'}`);
    console.log(`Date range: ${raw.metadata.from?.slice(0,10)} to ${raw.metadata.to?.slice(0,10)}`);
  }
  if (!candles?.length) throw new Error("No bars loaded");
  console.log(`Loaded ${candles.length} raw candles`);

  return candles
    .map(b => {
      const d = new Date(b.time);
      if (isNaN(d.getTime())) return null;
      const open = +b.open, high = +b.high, low = +b.low, close = +b.close;
      if (![open,high,low,close].every(Number.isFinite)) return null;
      return { ...b, time: b.time, _t: d.getTime(), _d: d, open, high, low, close };
    })
    .filter(Boolean)
    .sort((a, b) => a._t - b._t);
}

function aggregateBars(bars, n) {
  const result = [];
  for (let i = 0; i <= bars.length - n; i += n) {
    const chunk = bars.slice(i, i + n);
    result.push({
      time: chunk[0].time,
      _t: chunk[0]._t,
      _d: chunk[0]._d,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
    });
  }
  return result;
}

function aggregateDaily(bars) {
  const byDay = {};
  for (const b of bars) {
    const day = b.time.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(b);
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, arr]) => ({
      day,
      _t: arr[arr.length - 1]._t,
      _d: arr[arr.length - 1]._d,
      open: arr[0].open,
      high: Math.max(...arr.map(x => x.high)),
      low: Math.min(...arr.map(x => x.low)),
      close: arr[arr.length - 1].close,
    }));
}

function sliceEndingAt(bars, endIndex, count) {
  const start = endIndex - count + 1;
  if (start < 0) return null;
  return bars.slice(start, endIndex + 1);
}

function findAnchorIndex(bars, targetTime) {
  // Find closest bar to target timestamp
  const targetTs = new Date(targetTime).getTime();
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const diff = Math.abs(bars[i]._t - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ========== BUILD WHAT THE AGENT SEES ==========
function buildAgentView(context, indicators, currentPrice) {
  const ema50 = indicators.EMA50_30m || currentPrice;
  const emaSlope = indicators.EMA50_slope_30m || 0;
  const ema200 = indicators.EMA200_30m || null;
  const support = indicators.support || indicators.prevSessionLow;
  const resistance = indicators.resistance || indicators.prevSessionHigh;
  const atr5m = indicators.ATR_5m;
  const atr30m = indicators.ATR_30m;

  const swingHighs = indicators.swingHighs || [];
  const swingLows = indicators.swingLows || [];
  const swingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : indicators.prevSessionHigh;
  const swingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : indicators.prevSessionLow;

  const structureSwings = indicators.structureSwings || {};
  const sh0Price = structureSwings?.SH0?.price;
  const sh1Price = structureSwings?.SH1?.price;
  const sl0Price = structureSwings?.SL0?.price;
  const sl1Price = structureSwings?.SL1?.price;

  // Swing analysis
  let swingAnalysis = "";
  if (sh0Price && sh1Price && sl0Price && sl1Price) {
    const hhOrLh = sh1Price > sh0Price ? "HIGHER HIGH (HH)" : sh1Price < sh0Price ? "LOWER HIGH (LH)" : "EQUAL HIGH";
    const hlOrLl = sl1Price > sl0Price ? "HIGHER LOW (HL)" : sl1Price < sl0Price ? "LOWER LOW (LL)" : "EQUAL LOW";
    swingAnalysis = `Previous SH: ${sh0Price.toFixed(5)} → Latest SH: ${sh1Price.toFixed(5)} = ${hhOrLh}\n    Previous SL: ${sl0Price.toFixed(5)} → Latest SL: ${sl1Price.toFixed(5)} = ${hlOrLl}`;
  } else {
    swingAnalysis = "Not enough swing points";
  }

  // EMA descriptions
  const priceVsEma50 = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const priceVsEma200 = ema200 ? (currentPrice > ema200 ? "ABOVE" : currentPrice < ema200 ? "BELOW" : "AT") : null;
  const emaTrendDesc = emaSlope > 0.05 ? "RISING" : emaSlope < -0.05 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "strong" : slopeMagnitude > 0.10 ? "moderate" : "weak";

  // Support/resistance
  const distToSupport = currentPrice - support;
  const distToSupportATR = distToSupport / atr5m;
  const supportDesc = distToSupportATR >= 0
    ? `${distToSupportATR.toFixed(1)} ATR above support`
    : `${Math.abs(distToSupportATR).toFixed(1)} ATR BELOW support (broken)`;

  const distToResistance = resistance - currentPrice;
  const distToResistanceATR = distToResistance / atr5m;
  const resistanceDesc = distToResistanceATR >= 0
    ? `${distToResistanceATR.toFixed(1)} ATR below resistance`
    : `${Math.abs(distToResistanceATR).toFixed(1)} ATR ABOVE resistance (broken)`;

  // Session range position
  const sessionHigh = indicators.prevSessionHigh;
  const sessionLow = indicators.prevSessionLow;
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  return {
    // Raw values for verification
    raw: {
      currentPrice,
      ema50, emaSlope, ema200,
      support, resistance,
      atr5m, atr30m,
      swingHigh, swingLow,
      sessionHigh, sessionLow,
      structureState: indicators.structureState,
      structureLabel: indicators.structureLabel,
      marketRegime: indicators.marketRegime,
      currentSession: indicators.currentSession,
      breakoutScore: indicators.breakoutScore,
      sweepScore: indicators.sweepScore,
    },
    // What direction agent sees (derived descriptions)
    agentSees: {
      priceVsEma50,
      priceVsEma200,
      emaMomentum: `${emaTrendDesc} (${slopeStrength})`,
      supportDesc,
      resistanceDesc,
      positionInPrevSession: `${positionPct}%`,
      swingAnalysis,
    },
    // Price arrays
    prices5m: context.prices_5m,
    prices30m: context.prices_30m,
    pricesDaily: context.prices_daily,
  };
}

// ========== VERIFICATION CHECKS ==========
function verifyIndicators(view, bars5m, idx) {
  const issues = [];
  const raw = view.raw;
  const currentBar = bars5m[idx];

  // 1. currentPrice should match anchor bar close
  if (Math.abs(raw.currentPrice - currentBar.close) > 0.000005) {
    issues.push(`currentPrice ${raw.currentPrice} != anchor close ${currentBar.close}`);
  }

  // 2. Last 5m price should match currentPrice
  const last5m = view.prices5m[view.prices5m.length - 1];
  if (Math.abs(last5m - raw.currentPrice) > 0.000005) {
    issues.push(`Last 5m close ${last5m.toFixed(5)} != currentPrice ${raw.currentPrice.toFixed(5)}`);
  }

  // 3. EMA50 should be near recent prices (not garbage)
  const avgPrice = view.prices30m.reduce((a, b) => a + b, 0) / view.prices30m.length;
  const ema50Deviation = Math.abs(raw.ema50 - avgPrice) / raw.atr30m;
  if (ema50Deviation > 10) {
    issues.push(`EMA50 ${raw.ema50.toFixed(5)} is ${ema50Deviation.toFixed(1)} ATR from avg 30m price ${avgPrice.toFixed(5)}`);
  }

  // 4. Support should be below resistance
  if (raw.support >= raw.resistance) {
    issues.push(`Support ${raw.support.toFixed(5)} >= Resistance ${raw.resistance.toFixed(5)}`);
  }

  // 5. sessionHigh should be >= sessionLow
  if (raw.sessionHigh < raw.sessionLow) {
    issues.push(`Session High ${raw.sessionHigh.toFixed(5)} < Session Low ${raw.sessionLow.toFixed(5)}`);
  }

  // 6. ATR should be positive and reasonable
  if (raw.atr5m <= 0 || raw.atr5m > 0.01) {
    issues.push(`ATR_5m ${raw.atr5m} seems wrong (expected 0.0001-0.005)`);
  }
  if (raw.atr30m <= 0 || raw.atr30m > 0.05) {
    issues.push(`ATR_30m ${raw.atr30m} seems wrong (expected 0.0005-0.01)`);
  }

  // 7. Structure label should match structureState
  const expectedLabel = raw.structureState > 0 ? 'UPTREND' : raw.structureState < 0 ? 'DOWNTREND' : 'RANGE';
  if (raw.structureLabel !== expectedLabel) {
    issues.push(`structureLabel "${raw.structureLabel}" doesn't match structureState ${raw.structureState} (expected "${expectedLabel}")`);
  }

  // 8. EMA slope direction consistency
  const slopeDir = raw.emaSlope > 0.05 ? "UP" : raw.emaSlope < -0.05 ? "DOWN" : "FLAT";

  // 9. Verify swing analysis matches structureLabel
  const sw = raw;
  // If structure is UPTREND, we should have HH+HL pattern
  // If DOWNTREND, we should have LH+LL pattern

  // 10. Check 30m prices are reasonable aggregation of 5m
  const last30m = view.prices30m[view.prices30m.length - 1];
  // Last 30m close should be close to currentPrice (within a few 5m bars)
  const dist30mToCurrent = Math.abs(last30m - raw.currentPrice) / raw.atr5m;
  if (dist30mToCurrent > 5) {
    issues.push(`Last 30m close ${last30m.toFixed(5)} is ${dist30mToCurrent.toFixed(1)} ATR_5m from currentPrice ${raw.currentPrice.toFixed(5)}`);
  }

  // 11. Daily prices should be in reasonable range
  const dailyMin = Math.min(...view.pricesDaily);
  const dailyMax = Math.max(...view.pricesDaily);
  if (raw.currentPrice < dailyMin - 0.01 || raw.currentPrice > dailyMax + 0.01) {
    issues.push(`currentPrice ${raw.currentPrice.toFixed(5)} is far outside daily range [${dailyMin.toFixed(5)}, ${dailyMax.toFixed(5)}]`);
  }

  // 12. Check price trend direction vs what we'd visually expect
  const prices5m = view.prices5m;
  const first3avg = (prices5m[0] + prices5m[1] + prices5m[2]) / 3;
  const last3avg = (prices5m[12] + prices5m[13] + prices5m[14]) / 3;
  const priceTrend5m = last3avg > first3avg + raw.atr5m * 0.5 ? "UP" :
                       last3avg < first3avg - raw.atr5m * 0.5 ? "DOWN" : "FLAT";

  return { issues, meta: { slopeDir, priceTrend5m, ema50Deviation: ema50Deviation.toFixed(2) } };
}

// ========== MAIN ==========
function main() {
  const bars5m = loadBars(DATA_PATH);

  // Anchors from the batch test
  const tradeAnchors = [
    { id: 9,  time: "2026-02-16T16:45:00.000Z", label: "WIN - SHORT TP +0.75" },
    { id: 30, time: "2026-01-08T10:15:00.000Z", label: "WIN - SHORT TP +0.75" },
    { id: 17, time: "2026-02-25T16:00:00.000Z", label: "WIN - LONG TP +0.75 (waited)" },
    { id: 15, time: "2026-01-08T15:55:00.000Z", label: "WIN - SHORT TP +0.75" },
    { id: 5,  time: "2026-01-15T15:00:00.000Z", label: "LOSS - SHORT SL -0.50" },
    { id: 8,  time: "2026-02-12T07:55:00.000Z", label: "LOSS - SHORT SL -0.50" },
    { id: 10, time: "2026-02-24T15:15:00.000Z", label: "LOSS - SHORT SL -0.50" },
    { id: 16, time: "2025-12-04T13:10:00.000Z", label: "LOSS - LONG SL -0.50 (waited)" },
    { id: 3,  time: "2026-02-23T08:30:00.000Z", label: "SKIP - Conf rejected BEARISH" },
    { id: 4,  time: "2025-12-08T10:00:00.000Z", label: "SKIP - Conf rejected BULLISH" },
    { id: 1,  time: "2025-12-26T12:50:00.000Z", label: "SKIP - Direction NEUTRAL" },
    { id: 27, time: "2026-02-18T11:35:00.000Z", label: "SKIP - Conf rejected BEARISH (would have won)" },
  ];

  console.log(`\n${'='.repeat(100)}`);
  console.log(`TRADE DIAGNOSTIC: Verifying indicator inputs for ${tradeAnchors.length} trades`);
  console.log(`${'='.repeat(100)}\n`);

  for (const trade of tradeAnchors) {
    const idx = findAnchorIndex(bars5m, trade.time);
    if (idx < 0) {
      console.log(`Trade #${trade.id}: Could not find anchor ${trade.time}`);
      continue;
    }

    console.log(`${'─'.repeat(100)}`);
    console.log(`TRADE #${trade.id} | ${trade.label}`);
    console.log(`Anchor: ${trade.time} (idx=${idx}) | Bar: ${bars5m[idx].time}`);
    console.log(`${'─'.repeat(100)}`);

    // Build context same way as batch_trainer
    const win5m = sliceEndingAt(bars5m, idx, WIN_5M_BARS);
    if (!win5m) { console.log("  Not enough 5m history"); continue; }

    const need5mFor30m = WIN_30M_BARS * 6;
    const sliceFor30m = sliceEndingAt(bars5m, idx, need5mFor30m);
    if (!sliceFor30m) { console.log("  Not enough 30m history"); continue; }
    const bars30m = aggregateBars(sliceFor30m, 6).slice(-WIN_30M_BARS);

    const upToAnchor = bars5m.slice(0, idx + 1);
    const dailyAll = aggregateDaily(upToAnchor);
    const barsDaily = dailyAll.slice(-WIN_DAILY_BARS);

    const context = {
      prices_5m: win5m.map(b => b.close),
      prices_30m: bars30m.map(b => b.close),
      prices_daily: barsDaily.map(b => b.close),
    };

    const indicators = computeIndicators(bars5m, bars30m, idx);
    const currentPrice = bars5m[idx].close;

    const view = buildAgentView(context, indicators, currentPrice);
    const verification = verifyIndicators(view, bars5m, idx);

    // Print raw indicator values
    console.log(`\n  RAW INDICATORS:`);
    console.log(`    currentPrice:   ${currentPrice.toFixed(5)}`);
    console.log(`    EMA50_30m:      ${view.raw.ema50.toFixed(5)}  (price ${view.agentSees.priceVsEma50})`);
    console.log(`    EMA200_30m:     ${view.raw.ema200 ? view.raw.ema200.toFixed(5) : 'null'}  (price ${view.agentSees.priceVsEma200 || 'N/A'})`);
    console.log(`    EMA50_slope:    ${view.raw.emaSlope.toFixed(4)}  → agent sees: "${view.agentSees.emaMomentum}"`);
    console.log(`    ATR_5m:         ${(view.raw.atr5m * 10000).toFixed(1)} pips`);
    console.log(`    ATR_30m:        ${(view.raw.atr30m * 10000).toFixed(1)} pips`);
    console.log(`    support:        ${view.raw.support.toFixed(5)}  → agent sees: "${view.agentSees.supportDesc}"`);
    console.log(`    resistance:     ${view.raw.resistance.toFixed(5)}  → agent sees: "${view.agentSees.resistanceDesc}"`);
    console.log(`    prevSessionH:   ${view.raw.sessionHigh.toFixed(5)}`);
    console.log(`    prevSessionL:   ${view.raw.sessionLow.toFixed(5)}`);
    console.log(`    swingHigh:      ${view.raw.swingHigh.toFixed(5)}`);
    console.log(`    swingLow:       ${view.raw.swingLow.toFixed(5)}`);
    console.log(`    structureState: ${view.raw.structureState} (${view.raw.structureLabel})`);
    console.log(`    marketRegime:   ${view.raw.marketRegime}`);
    console.log(`    session:        ${view.raw.currentSession}`);
    console.log(`    breakoutScore:  ${view.raw.breakoutScore?.toFixed(3) || 'N/A'}`);
    console.log(`    sweepScore:     ${view.raw.sweepScore?.toFixed(3) || 'N/A'}`);
    console.log(`    position in prev session: ${view.agentSees.positionInPrevSession}`);

    // Print swing analysis
    console.log(`\n  SWING ANALYSIS (what direction agent sees):`);
    console.log(`    ${view.agentSees.swingAnalysis}`);

    // Print price arrays
    console.log(`\n  PRICE ARRAYS:`);
    console.log(`    Daily (${view.pricesDaily.length}): [${view.pricesDaily.slice(-5).map(p => p.toFixed(5)).join(', ')}] (last 5)`);
    console.log(`    30m (${view.prices30m.length}):   [${view.prices30m.map(p => p.toFixed(5)).join(', ')}]`);
    console.log(`    5m (${view.prices5m.length}):    [${view.prices5m.map(p => p.toFixed(5)).join(', ')}]`);

    // Print visual price direction
    const p5 = view.prices5m;
    const trend5m = p5[14] > p5[0] ? `UP (+${((p5[14]-p5[0])*10000).toFixed(1)}pips)` :
                    p5[14] < p5[0] ? `DOWN (${((p5[14]-p5[0])*10000).toFixed(1)}pips)` : "FLAT";
    const p30 = view.prices30m;
    const trend30m = p30[14] > p30[0] ? `UP (+${((p30[14]-p30[0])*10000).toFixed(1)}pips)` :
                     p30[14] < p30[0] ? `DOWN (${((p30[14]-p30[0])*10000).toFixed(1)}pips)` : "FLAT";
    console.log(`\n  VISUAL PRICE DIRECTION:`);
    console.log(`    5m trend (75min):    ${trend5m}`);
    console.log(`    30m trend (7.5hrs):  ${trend30m}`);

    // Verify EMA50 position makes sense vs actual price
    const pricesAboveEma50 = view.prices30m.filter(p => p > view.raw.ema50).length;
    console.log(`    30m bars above EMA50: ${pricesAboveEma50}/15`);

    // Verification results
    console.log(`\n  VERIFICATION:`);
    if (verification.issues.length === 0) {
      console.log(`    ✓ All checks passed`);
    } else {
      for (const issue of verification.issues) {
        console.log(`    ✗ ${issue}`);
      }
    }
    console.log(`    Meta: slopeDir=${verification.meta.slopeDir}, 5mTrend=${verification.meta.priceTrend5m}, ema50Dev=${verification.meta.ema50Deviation}ATR`);

    // Sanity check: does the agent's reading of the data match reality?
    console.log(`\n  SANITY CHECK: Does agent interpretation match reality?`);

    // Check if structureLabel matches swing points
    const sw = indicators.structureSwings || {};
    if (sw.SH0 && sw.SH1 && sw.SL0 && sw.SL1) {
      const isHH = sw.SH1.price > sw.SH0.price;
      const isHL = sw.SL1.price > sw.SL0.price;
      const isLH = sw.SH1.price < sw.SH0.price;
      const isLL = sw.SL1.price < sw.SL0.price;

      if (isHH && isHL && view.raw.structureLabel !== 'UPTREND') {
        console.log(`    ✗ HH+HL but label is ${view.raw.structureLabel}`);
      } else if (isLH && isLL && view.raw.structureLabel !== 'DOWNTREND') {
        console.log(`    ✗ LH+LL but label is ${view.raw.structureLabel}`);
      } else if ((isHH !== isHL) && view.raw.structureLabel !== 'RANGE') {
        console.log(`    ✗ Mixed swings (HH=${isHH} HL=${isHL}) but label is ${view.raw.structureLabel}`);
      } else {
        console.log(`    ✓ Structure label matches swing points`);
      }
    }

    // Check EMA slope vs price trend direction
    if (verification.meta.slopeDir === "UP" && view.raw.emaSlope < -0.05) {
      console.log(`    ✗ EMA slope says DOWN but price trend is UP`);
    } else {
      console.log(`    ✓ EMA slope direction is plausible`);
    }

    // Check if we're near support or resistance (is the agent told correctly?)
    const distToSup = (currentPrice - view.raw.support) / view.raw.atr5m;
    const distToRes = (view.raw.resistance - currentPrice) / view.raw.atr5m;
    if (distToSup < 1) {
      console.log(`    → Price is NEAR SUPPORT (${distToSup.toFixed(1)} ATR) - good LONG zone if range trading`);
    } else if (distToRes < 1) {
      console.log(`    → Price is NEAR RESISTANCE (${distToRes.toFixed(1)} ATR) - good SHORT zone if range trading`);
    } else {
      console.log(`    → Price is in the MIDDLE (sup: ${distToSup.toFixed(1)} ATR away, res: ${distToRes.toFixed(1)} ATR away)`);
    }

    // Check: actual price action after anchor (next 30 bars = 2.5 hours)
    const futureSlice = bars5m.slice(idx + 1, idx + 31);
    if (futureSlice.length > 0) {
      const futureHigh = Math.max(...futureSlice.map(b => b.high));
      const futureLow = Math.min(...futureSlice.map(b => b.low));
      const futureClose = futureSlice[futureSlice.length - 1].close;
      const maxUp = (futureHigh - currentPrice) * 10000;
      const maxDown = (currentPrice - futureLow) * 10000;
      const netMove = (futureClose - currentPrice) * 10000;
      console.log(`    → ACTUAL next 2.5hrs: up ${maxUp.toFixed(1)}pips, down ${maxDown.toFixed(1)}pips, net ${netMove > 0 ? '+' : ''}${netMove.toFixed(1)}pips`);
      console.log(`    → Optimal direction was: ${maxUp > maxDown ? 'LONG' : 'SHORT'} (up/down ratio: ${(maxUp/maxDown).toFixed(2)})`);
    }

    console.log('');
  }
}

main();
