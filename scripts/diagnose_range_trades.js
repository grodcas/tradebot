#!/usr/bin/env node
/**
 * Deep dive into RANGE regime trades — what did the agent see, decide, and what did the market do?
 */
const fs = require('fs');
const path = require('path');

const results = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'trade_results.json'), 'utf8'));

// Load raw bars for price action analysis
const dataDir = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
let allBars = [];
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  const candles = Array.isArray(raw) ? raw : (raw.candles || raw);
  allBars = allBars.concat(candles);
}

// Parse bar time
function barTime(bar) {
  return new Date(bar.time || bar.datetime || bar.date);
}

// Find bar index by time
function findBarIdx(time) {
  const t = new Date(time).getTime();
  for (let i = 0; i < allBars.length; i++) {
    if (barTime(allBars[i]).getTime() >= t) return i;
  }
  return -1;
}

// Get close price
function closePrice(bar) {
  if (bar.mid) return parseFloat(bar.mid.c);
  return parseFloat(bar.close || bar.c);
}

function highPrice(bar) {
  if (bar.mid) return parseFloat(bar.mid.h);
  return parseFloat(bar.high || bar.h);
}

function lowPrice(bar) {
  if (bar.mid) return parseFloat(bar.mid.l);
  return parseFloat(bar.low || bar.l);
}

console.log('=================================================================');
console.log('DEEP DIVE: RANGE REGIME TRADES — Iter10');
console.log('=================================================================\n');

// Separate executed and skipped RANGE trades
const rangeTrades = results.filter(r => r.indicators && r.indicators.marketRegime === 'RANGE');

console.log(`Total RANGE trades: ${rangeTrades.length}`);
const executed = rangeTrades.filter(r => r.decision && r.decision.risk > 0);
const skipped = rangeTrades.filter(r => !r.decision || r.decision.risk === 0);
console.log(`  Executed: ${executed.length}`);
console.log(`  Skipped: ${skipped.length}\n`);

// Analyze each RANGE trade
for (const r of rangeTrades) {
  const isExecuted = r.decision && r.decision.risk > 0;
  const tradeNum = r.tradeNum;
  const ind = r.indicators;
  const dec = r.decision;
  const sim = r.simResult;

  console.log('=================================================================');
  console.log(`TRADE #${tradeNum} — ${isExecuted ? 'EXECUTED' : 'SKIPPED'} — ${sim.outcome} (rawR=${r.rawR.toFixed(2)})`);
  console.log('=================================================================');

  // What the agent saw
  console.log('\n--- WHAT THE AGENT SAW ---');
  console.log(`  Session: ${ind.currentSession} (prev: ${ind.previousSession})`);
  console.log(`  Regime: ${ind.marketRegime}`);
  console.log(`  Structure: ${ind.structureLabel} (state=${ind.structureState})`);
  console.log(`  EMA50 slope: ${ind.EMA50_slope_30m != null ? ind.EMA50_slope_30m.toFixed(3) : 'null'}`);
  const atr5m = ind.ATR_5m || 0.0003;
  const atr30m = ind.ATR_30m || 0.0006;
  const support = ind.support || 0;
  const resistance = ind.resistance || 0;
  console.log(`  ATR_5m: ${(atr5m * 10000).toFixed(1)} pips | ATR_30m: ${(atr30m * 10000).toFixed(1)} pips`);
  console.log(`  Support: ${support.toFixed(5)} | Resistance: ${resistance.toFixed(5)}`);
  console.log(`  Range width: ${((resistance - support) * 10000).toFixed(1)} pips (${((resistance - support) / atr5m).toFixed(1)} ATR_5m)`);
  console.log(`  Prev session: High=${(ind.prevSessionHigh||0).toFixed(5)} Low=${(ind.prevSessionLow||0).toFixed(5)}`);

  // Current price and position
  const currentPrice = dec.aiEntry || sim.actualEntry;
  const rangeWidth = resistance - support;
  const posInRange = rangeWidth > 0 ? ((currentPrice - support) / rangeWidth * 100).toFixed(0) : '?';
  const distToSupport = ((currentPrice - support) / atr5m).toFixed(1);
  const distToResistance = ((resistance - currentPrice) / atr5m).toFixed(1);

  console.log(`  Current price: ${currentPrice.toFixed(5)}`);
  console.log(`  Position in range: ${posInRange}% (0%=support, 100%=resistance)`);
  console.log(`  Distance to support: ${distToSupport} ATR_5m`);
  console.log(`  Distance to resistance: ${distToResistance} ATR_5m`);

  // What the agent decided
  console.log('\n--- AGENT DECISION ---');
  console.log(`  Side: ${dec.side}`);
  console.log(`  Risk: ${dec.risk} (${dec.risk === 0 ? 'SKIPPED' : 'TAKEN'})`);
  console.log(`  Reasoning: ${dec.reasoning}`);

  // What actually happened
  console.log('\n--- WHAT THE MARKET DID ---');
  const anchorIdx = findBarIdx(r.anchorTime);
  const entryIdx = findBarIdx(r.entryTime);

  if (entryIdx >= 0) {
    // Look at next 60 bars (5 hours) of price action after entry
    const lookAhead = 60;
    const futureBars = allBars.slice(entryIdx, entryIdx + lookAhead);

    if (futureBars.length > 0) {
      const entryPrice = closePrice(futureBars[0]);
      let maxHigh = entryPrice, minLow = entryPrice;
      let maxHighBar = 0, minLowBar = 0;

      for (let i = 0; i < futureBars.length; i++) {
        const h = highPrice(futureBars[i]);
        const l = lowPrice(futureBars[i]);
        if (h > maxHigh) { maxHigh = h; maxHighBar = i; }
        if (l < minLow) { minLow = l; minLowBar = i; }
      }

      const maxUp = maxHigh - entryPrice;
      const maxDown = entryPrice - minLow;
      const optimalDir = maxUp > maxDown ? 'LONG' : 'SHORT';

      console.log(`  Entry price: ${entryPrice.toFixed(5)}`);
      console.log(`  Max upside: +${(maxUp * 10000).toFixed(1)} pips in ${maxHighBar * 5} min`);
      console.log(`  Max downside: -${(maxDown * 10000).toFixed(1)} pips in ${minLowBar * 5} min`);
      console.log(`  Optimal direction: ${optimalDir}`);
      console.log(`  Agent chose: ${dec.side} ${dec.side === optimalDir ? '✓ CORRECT' : '✗ WRONG'}`);

      // Price at key intervals
      const intervals = [6, 12, 24, 48]; // 30min, 1h, 2h, 4h
      console.log('  Price trajectory:');
      for (const idx of intervals) {
        if (idx < futureBars.length) {
          const p = closePrice(futureBars[idx]);
          const delta = ((p - entryPrice) * 10000).toFixed(1);
          const mins = idx * 5;
          console.log(`    +${mins}min: ${p.toFixed(5)} (${delta > 0 ? '+' : ''}${delta} pips)`);
        }
      }

      // SL/TP analysis
      const slDist = atr30m * 1.5;
      const tpDist = slDist * 1.5;
      if (dec.side === 'LONG' || (!isExecuted && optimalDir === 'LONG')) {
        const idealTP = entryPrice + tpDist;
        const idealSL = entryPrice - slDist;
        console.log(`  If LONG: TP=${idealTP.toFixed(5)} (+${(tpDist*10000).toFixed(1)}p) SL=${idealSL.toFixed(5)} (-${(slDist*10000).toFixed(1)}p)`);
        console.log(`    Would reach TP? ${maxHigh >= idealTP ? 'YES (high=' + maxHigh.toFixed(5) + ')' : 'NO (max high=' + maxHigh.toFixed(5) + ')'}`);
        console.log(`    Would hit SL? ${minLow <= idealSL ? 'YES (low=' + minLow.toFixed(5) + ')' : 'NO (min low=' + minLow.toFixed(5) + ')'}`);
        // Which hits first?
        let tpBar = -1, slBar = -1;
        for (let i = 0; i < futureBars.length; i++) {
          if (tpBar < 0 && highPrice(futureBars[i]) >= idealTP) tpBar = i;
          if (slBar < 0 && lowPrice(futureBars[i]) <= idealSL) slBar = i;
        }
        if (tpBar >= 0 && slBar >= 0) {
          console.log(`    TP hit at bar ${tpBar} (${tpBar*5}min), SL hit at bar ${slBar} (${slBar*5}min) → ${tpBar < slBar ? 'TP FIRST (WIN)' : 'SL FIRST (LOSS)'}`);
        } else if (tpBar >= 0) {
          console.log(`    TP hit at bar ${tpBar} (${tpBar*5}min), SL never hit → WIN`);
        } else if (slBar >= 0) {
          console.log(`    SL hit at bar ${slBar} (${slBar*5}min), TP never hit → LOSS`);
        } else {
          console.log(`    Neither TP nor SL hit in ${futureBars.length * 5}min`);
        }
      }
      if (dec.side === 'SHORT' || (!isExecuted && optimalDir === 'SHORT')) {
        const idealTP = entryPrice - tpDist;
        const idealSL = entryPrice + slDist;
        console.log(`  If SHORT: TP=${idealTP.toFixed(5)} (-${(tpDist*10000).toFixed(1)}p) SL=${idealSL.toFixed(5)} (+${(slDist*10000).toFixed(1)}p)`);
        console.log(`    Would reach TP? ${minLow <= idealTP ? 'YES (low=' + minLow.toFixed(5) + ')' : 'NO (min low=' + minLow.toFixed(5) + ')'}`);
        console.log(`    Would hit SL? ${maxHigh >= idealSL ? 'YES (high=' + maxHigh.toFixed(5) + ')' : 'NO (max high=' + maxHigh.toFixed(5) + ')'}`);
        let tpBar = -1, slBar = -1;
        for (let i = 0; i < futureBars.length; i++) {
          if (tpBar < 0 && lowPrice(futureBars[i]) <= idealTP) tpBar = i;
          if (slBar < 0 && highPrice(futureBars[i]) >= idealSL) slBar = i;
        }
        if (tpBar >= 0 && slBar >= 0) {
          console.log(`    TP hit at bar ${tpBar} (${tpBar*5}min), SL hit at bar ${slBar} (${slBar*5}min) → ${tpBar < slBar ? 'TP FIRST (WIN)' : 'SL FIRST (LOSS)'}`);
        } else if (tpBar >= 0) {
          console.log(`    TP hit at bar ${tpBar} (${tpBar*5}min), SL never hit → WIN`);
        } else if (slBar >= 0) {
          console.log(`    SL hit at bar ${slBar} (${slBar*5}min), TP never hit → LOSS`);
        } else {
          console.log(`    Neither TP nor SL hit in ${futureBars.length * 5}min`);
        }
      }
    }
  }

  console.log('');
}

// Summary patterns
console.log('\n=================================================================');
console.log('PATTERN ANALYSIS');
console.log('=================================================================\n');

// Structure labels in RANGE regime
const structureCounts = {};
for (const r of rangeTrades) {
  const sl = r.indicators.structureLabel;
  if (!structureCounts[sl]) structureCounts[sl] = { total: 0, executed: 0, wins: 0 };
  structureCounts[sl].total++;
  if (r.decision && r.decision.risk > 0) {
    structureCounts[sl].executed++;
    if (r.simResult.outcome === 'TP') structureCounts[sl].wins++;
  }
}
console.log('Structure labels within RANGE regime:');
for (const [label, counts] of Object.entries(structureCounts)) {
  console.log(`  ${label}: ${counts.total} total, ${counts.executed} executed, ${counts.wins} wins`);
}

// Position in range when trading
console.log('\nPosition in range for executed RANGE trades:');
for (const r of executed) {
  const price = r.decision.aiEntry || r.simResult.actualEntry;
  const sup = r.indicators.support || 0;
  const res = r.indicators.resistance || 0;
  const rw = res - sup;
  const pos = rw > 0 ? ((price - sup) / rw * 100).toFixed(0) : '?';
  console.log(`  #${r.tradeNum}: ${r.decision.side} at ${pos}% of range → ${r.simResult.outcome}`);
}

console.log('\nPosition in range for skipped RANGE trades:');
for (const r of skipped) {
  const price = r.decision.aiEntry || r.simResult.actualEntry;
  const sup = r.indicators.support || 0;
  const res = r.indicators.resistance || 0;
  const rw = res - sup;
  const pos = rw > 0 ? ((price - sup) / rw * 100).toFixed(0) : '?';
  console.log(`  #${r.tradeNum}: ${r.decision.side} SKIPPED at ${pos}% of range → would have been ${r.simResult.outcome}`);
}

// EMA slope direction
console.log('\nEMA slope for RANGE trades:');
for (const r of rangeTrades) {
  const isExec = r.decision && r.decision.risk > 0;
  const slope = r.indicators.EMA50_slope_30m;
  const slopeDir = slope == null ? 'NULL' : slope > 0.05 ? 'UP' : slope < -0.05 ? 'DOWN' : 'FLAT';
  const slopeStr = slope != null ? slope.toFixed(3) : 'null';
  console.log(`  #${r.tradeNum}: slope=${slopeStr} (${slopeDir}) | decided ${r.decision.side} | ${isExec ? r.simResult.outcome : 'SKIPPED→'+r.simResult.outcome}`);
}
