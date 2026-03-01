const results = require('../results/trade_results.json');
const executed = results.filter(r => !r.error && r.decision && r.decision.risk > 0);

console.log(`=== ITER20 DETAILED ANALYSIS ===`);
console.log(`Total executed: ${executed.length}`);
console.log(`Skipped: ${results.length - executed.length}\n`);

// === WINS ===
console.log('=== WINS — WHAT WORKED ===\n');
const wins = executed.filter(t => t.simResult && t.simResult.outcome === 'TP');
for (const t of wins) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  const regime = t.indicators.marketRegime;
  const struct = t.indicators.structureLabel;
  const side = t.decision.side;
  const session = t.indicators.currentSession;
  const conviction = t.decision.agentOutputs?.direction?.conviction || 'N/A';
  const reasoning = (t.decision.reasoning || '').slice(0, 140);

  console.log(`#${t.tradeNum} | ${side} | ${regime}+${struct} | ${session} | PosInSR: ${pos}% | Conv: ${conviction}`);
  console.log(`  Reasoning: ${reasoning}`);
  console.log('');
}

// === LOSSES ===
console.log('\n=== LOSSES — WHAT FAILED ===\n');
const losses = executed.filter(t => t.simResult && t.simResult.outcome === 'SL');
for (const t of losses) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  const regime = t.indicators.marketRegime;
  const struct = t.indicators.structureLabel;
  const side = t.decision.side;
  const session = t.indicators.currentSession;
  const conviction = t.decision.agentOutputs?.direction?.conviction || 'N/A';
  const reasoning = (t.decision.reasoning || '').slice(0, 140);
  const rootCause = ((t.summary && t.summary.root_cause) || 'N/A').slice(0, 140);
  const barsToExit = t.simResult ? t.simResult.barsToExit : '?';

  console.log(`#${t.tradeNum} | ${side} | ${regime}+${struct} | ${session} | PosInSR: ${pos}% | Exit in ${barsToExit} bars | Conv: ${conviction}`);
  console.log(`  Reasoning: ${reasoning}`);
  console.log(`  Root cause: ${rootCause}`);
  console.log('');
}

// === PATTERN ANALYSIS ===
console.log('\n=== PATTERN ANALYSIS ===\n');

// 1. Inside vs Outside S/R range
const insideTrades = executed.filter(t => {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
  return pos >= 0 && pos <= 100;
});
const outsideTrades = executed.filter(t => {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
  return pos < 0 || pos > 100;
});

const insideWins = insideTrades.filter(t => t.simResult.outcome === 'TP').length;
const outsideWins = outsideTrades.filter(t => t.simResult.outcome === 'TP').length;

console.log(`Inside S/R range: ${insideTrades.length} trades, ${insideWins} wins (${insideTrades.length ? (insideWins/insideTrades.length*100).toFixed(0) : 0}% WR)`);
console.log(`Outside S/R range: ${outsideTrades.length} trades, ${outsideWins} wins (${outsideTrades.length ? (outsideWins/outsideTrades.length*100).toFixed(0) : 0}% WR)`);

// 2. Inside vs Outside PREVIOUS DAY range
const insideDayTrades = executed.filter(t => {
  const pdh = t.indicators.prevDayHigh;
  const pdl = t.indicators.prevDayLow;
  if (!pdh || !pdl) return false;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  return price >= pdl && price <= pdh;
});
const outsideDayTrades = executed.filter(t => {
  const pdh = t.indicators.prevDayHigh;
  const pdl = t.indicators.prevDayLow;
  if (!pdh || !pdl) return false;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  return price < pdl || price > pdh;
});

const insideDayWins = insideDayTrades.filter(t => t.simResult.outcome === 'TP').length;
const outsideDayWins = outsideDayTrades.filter(t => t.simResult.outcome === 'TP').length;

console.log(`\nInside prev DAY range: ${insideDayTrades.length} trades, ${insideDayWins} wins (${insideDayTrades.length ? (insideDayWins/insideDayTrades.length*100).toFixed(0) : 0}% WR)`);
console.log(`Outside prev DAY range: ${outsideDayTrades.length} trades, ${outsideDayWins} wins (${outsideDayTrades.length ? (outsideDayWins/outsideDayTrades.length*100).toFixed(0) : 0}% WR)`);

// 3. Conviction analysis
console.log('\n--- CONVICTION DISTRIBUTION ---');
const convictions = {};
for (const t of executed) {
  const conv = t.decision.agentOutputs?.direction?.conviction || 'UNKNOWN';
  if (!convictions[conv]) convictions[conv] = { total: 0, wins: 0 };
  convictions[conv].total++;
  if (t.simResult.outcome === 'TP') convictions[conv].wins++;
}
for (const [conv, data] of Object.entries(convictions)) {
  console.log(`  ${conv}: ${data.total} trades, ${data.wins} wins (${(data.wins/data.total*100).toFixed(0)}% WR)`);
}

// 4. Regime + Structure breakdown
console.log('\n--- REGIME + STRUCTURE BREAKDOWN ---');
const combos = {};
for (const t of executed) {
  const key = `${t.indicators.marketRegime}+${t.indicators.structureLabel}`;
  if (!combos[key]) combos[key] = { total: 0, wins: 0 };
  combos[key].total++;
  if (t.simResult.outcome === 'TP') combos[key].wins++;
}
for (const [key, data] of Object.entries(combos).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${key}: ${data.total} trades, ${data.wins} wins (${(data.wins/data.total*100).toFixed(0)}% WR)`);
}

// 5. Side breakdown
console.log('\n--- SIDE BREAKDOWN ---');
const longs = executed.filter(t => t.decision.side === 'LONG');
const shorts = executed.filter(t => t.decision.side === 'SHORT');
const longWins = longs.filter(t => t.simResult.outcome === 'TP').length;
const shortWins = shorts.filter(t => t.simResult.outcome === 'TP').length;
console.log(`  LONG: ${longs.length} trades, ${longWins} wins (${longs.length ? (longWins/longs.length*100).toFixed(0) : 0}% WR)`);
console.log(`  SHORT: ${shorts.length} trades, ${shortWins} wins (${shorts.length ? (shortWins/shorts.length*100).toFixed(0) : 0}% WR)`);

// 6. Losses fighting position (SHORT at bottom / LONG at top)
const fightingPosition = losses.filter(t => {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
  return (t.decision.side === 'SHORT' && pos < 20) || (t.decision.side === 'LONG' && pos > 80);
});
console.log(`\nLosses fighting position: ${fightingPosition.length}/${losses.length}`);
for (const t of fightingPosition) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  console.log(`  #${t.tradeNum} ${t.decision.side} at PosInSR=${pos}%`);
}

// 7. Speed of losses
const fastLosses = losses.filter(t => t.simResult.barsToExit <= 5);
const slowLosses = losses.filter(t => t.simResult.barsToExit > 20);
console.log(`\nFast losses (<=5 bars / 25min): ${fastLosses.length}/${losses.length}`);
console.log(`Slow losses (>20 bars / 1.5h+): ${slowLosses.length}/${losses.length}`);

// 8. Compare to Iter19 key patterns
console.log('\n=== KEY COMPARISONS TO ITER19 ===');
console.log('Iter19: 42.3% WR, +1.48 Raw R, 7/15 losses outside S/R (47%), all MEDIUM conviction');
console.log(`Iter20: ${(wins.length/executed.length*100).toFixed(1)}% WR, Raw R calculated above`);
console.log(`Iter20: ${outsideTrades.filter(t => t.simResult.outcome === 'SL').length}/${losses.length} losses outside S/R (${losses.length ? (outsideTrades.filter(t => t.simResult.outcome === 'SL').length/losses.length*100).toFixed(0) : 0}%)`);
console.log(`Iter20: 0 skipped (must-decide worked), conviction spread: ${JSON.stringify(convictions)}`);
