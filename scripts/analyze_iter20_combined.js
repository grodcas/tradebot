const run1 = require('../results/trade_results_iter20_run1.json');
const run2 = require('../results/trade_results_iter20_run2.json');

// Re-number run2 trades
const run2renumbered = run2.map((t, i) => ({ ...t, tradeNum: 31 + i }));
const allResults = [...run1, ...run2renumbered];

const executed = allResults.filter(r => !r.error && r.decision && r.decision.risk > 0);
const wins = executed.filter(t => t.simResult && t.simResult.outcome === 'TP');
const losses = executed.filter(t => t.simResult && t.simResult.outcome === 'SL');
const timeouts = executed.filter(t => t.simResult && t.simResult.outcome === 'TIMEOUT');

const totalRawR = executed.reduce((s, t) => s + (t.rawR || 0), 0);
const totalWeightedR = executed.reduce((s, t) => s + (t.weightedR || 0), 0);

console.log('=== ITER20 COMBINED ANALYSIS (60 trades, 2 runs) ===\n');
console.log(`Total executed: ${executed.length}`);
console.log(`Wins: ${wins.length} (${(wins.length/executed.length*100).toFixed(1)}%)`);
console.log(`Losses: ${losses.length} (${(losses.length/executed.length*100).toFixed(1)}%)`);
console.log(`Timeouts: ${timeouts.length}`);
console.log(`Skipped: ${allResults.length - executed.length}`);
console.log(`Raw R: ${totalRawR.toFixed(2)} (avg: ${(totalRawR/executed.length).toFixed(3)})`);
console.log(`Weighted R: ${totalWeightedR.toFixed(2)} (avg: ${(totalWeightedR/executed.length).toFixed(3)})`);

// === REGIME + STRUCTURE BREAKDOWN ===
console.log('\n=== REGIME + STRUCTURE BREAKDOWN ===\n');
const combos = {};
for (const t of executed) {
  const key = `${t.indicators.marketRegime}+${t.indicators.structureLabel}`;
  if (!combos[key]) combos[key] = { total: 0, wins: 0, rawR: 0 };
  combos[key].total++;
  if (t.simResult.outcome === 'TP') combos[key].wins++;
  combos[key].rawR += t.rawR || 0;
}
for (const [key, data] of Object.entries(combos).sort((a, b) => b[1].total - a[1].total)) {
  const wr = (data.wins/data.total*100).toFixed(0);
  console.log(`  ${key.padEnd(25)} ${data.total} trades | ${data.wins}W ${data.total-data.wins}L | ${wr}% WR | R: ${data.rawR.toFixed(2)}`);
}

// === SIDE BREAKDOWN ===
console.log('\n=== SIDE BREAKDOWN ===\n');
const longs = executed.filter(t => t.decision.side === 'LONG');
const shorts = executed.filter(t => t.decision.side === 'SHORT');
const longWins = longs.filter(t => t.simResult.outcome === 'TP').length;
const shortWins = shorts.filter(t => t.simResult.outcome === 'TP').length;
const longR = longs.reduce((s, t) => s + (t.rawR || 0), 0);
const shortR = shorts.reduce((s, t) => s + (t.rawR || 0), 0);
console.log(`  LONG:  ${longs.length} trades | ${longWins}W ${longs.length-longWins}L | ${(longWins/longs.length*100).toFixed(0)}% WR | R: ${longR.toFixed(2)}`);
console.log(`  SHORT: ${shorts.length} trades | ${shortWins}W ${shorts.length-shortWins}L | ${(shortWins/shorts.length*100).toFixed(0)}% WR | R: ${shortR.toFixed(2)}`);

// === INSIDE vs OUTSIDE S/R ===
console.log('\n=== INSIDE vs OUTSIDE SESSION S/R ===\n');
function getPosInSR(t) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  return sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
}
const insideSR = executed.filter(t => { const p = getPosInSR(t); return p >= 0 && p <= 100; });
const outsideSR = executed.filter(t => { const p = getPosInSR(t); return p < 0 || p > 100; });
const insideWins = insideSR.filter(t => t.simResult.outcome === 'TP').length;
const outsideWins = outsideSR.filter(t => t.simResult.outcome === 'TP').length;
const insideR = insideSR.reduce((s, t) => s + (t.rawR || 0), 0);
const outsideR = outsideSR.reduce((s, t) => s + (t.rawR || 0), 0);
console.log(`  Inside S/R:  ${insideSR.length} trades | ${insideWins}W ${insideSR.length-insideWins}L | ${(insideWins/insideSR.length*100).toFixed(0)}% WR | R: ${insideR.toFixed(2)}`);
console.log(`  Outside S/R: ${outsideSR.length} trades | ${outsideWins}W ${outsideSR.length-outsideWins}L | ${(outsideWins/outsideSR.length*100).toFixed(0)}% WR | R: ${outsideR.toFixed(2)}`);

// === INSIDE vs OUTSIDE PREV DAY ===
console.log('\n=== INSIDE vs OUTSIDE PREVIOUS DAY RANGE ===\n');
const insideDay = executed.filter(t => {
  const pdh = t.indicators.prevDayHigh, pdl = t.indicators.prevDayLow;
  if (!pdh || !pdl) return false;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  return price >= pdl && price <= pdh;
});
const outsideDay = executed.filter(t => {
  const pdh = t.indicators.prevDayHigh, pdl = t.indicators.prevDayLow;
  if (!pdh || !pdl) return false;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  return price < pdl || price > pdh;
});
const insideDayWins = insideDay.filter(t => t.simResult.outcome === 'TP').length;
const outsideDayWins = outsideDay.filter(t => t.simResult.outcome === 'TP').length;
const insideDayR = insideDay.reduce((s, t) => s + (t.rawR || 0), 0);
const outsideDayR = outsideDay.reduce((s, t) => s + (t.rawR || 0), 0);
console.log(`  Inside day range:  ${insideDay.length} trades | ${insideDayWins}W ${insideDay.length-insideDayWins}L | ${(insideDayWins/insideDay.length*100).toFixed(0)}% WR | R: ${insideDayR.toFixed(2)}`);
console.log(`  Outside day range: ${outsideDay.length} trades | ${outsideDayWins}W ${outsideDay.length-outsideDayWins}L | ${(outsideDayWins/outsideDay.length*100).toFixed(0)}% WR | R: ${outsideDayR.toFixed(2)}`);

// === SESSION BREAKDOWN ===
console.log('\n=== SESSION BREAKDOWN ===\n');
const sessions = {};
for (const t of executed) {
  const s = t.indicators.currentSession || 'UNKNOWN';
  if (!sessions[s]) sessions[s] = { total: 0, wins: 0, rawR: 0 };
  sessions[s].total++;
  if (t.simResult.outcome === 'TP') sessions[s].wins++;
  sessions[s].rawR += t.rawR || 0;
}
for (const [s, data] of Object.entries(sessions).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${s.padEnd(10)} ${data.total} trades | ${data.wins}W ${data.total-data.wins}L | ${(data.wins/data.total*100).toFixed(0)}% WR | R: ${data.rawR.toFixed(2)}`);
}

// === LOSSES DETAIL — REGIME+STRUCTURE+SIDE ===
console.log('\n=== LOSSES DETAIL ===\n');
for (const t of losses) {
  const pos = Math.round(getPosInSR(t));
  const pdh = t.indicators.prevDayHigh, pdl = t.indicators.prevDayLow;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const inDay = pdh && pdl ? (price >= pdl && price <= pdh ? 'inDay' : 'outDay') : '?';
  const inSR = pos >= 0 && pos <= 100 ? 'inSR' : 'outSR';
  const regime = t.indicators.marketRegime;
  const struct = t.indicators.structureLabel;
  const rootCause = ((t.summary && t.summary.root_cause) || 'N/A').slice(0, 120);

  console.log(`#${String(t.tradeNum).padStart(2)} | ${t.decision.side.padEnd(5)} | ${regime}+${struct} | PosInSR:${String(pos).padStart(4)}% | ${inSR} ${inDay} | ${t.simResult.barsToExit}bars`);
  console.log(`     ${rootCause}`);
}

// === WINS DETAIL — what's working ===
console.log('\n=== WINS DETAIL ===\n');
for (const t of wins) {
  const pos = Math.round(getPosInSR(t));
  const regime = t.indicators.marketRegime;
  const struct = t.indicators.structureLabel;

  console.log(`#${String(t.tradeNum).padStart(2)} | ${t.decision.side.padEnd(5)} | ${regime}+${struct} | PosInSR:${String(pos).padStart(4)}%`);
}

// === REGIME+STRUCTURE+SIDE deeper cut ===
console.log('\n=== REGIME+STRUCTURE+SIDE BREAKDOWN ===\n');
const deepCombos = {};
for (const t of executed) {
  const key = `${t.indicators.marketRegime}+${t.indicators.structureLabel} ${t.decision.side}`;
  if (!deepCombos[key]) deepCombos[key] = { total: 0, wins: 0, rawR: 0 };
  deepCombos[key].total++;
  if (t.simResult.outcome === 'TP') deepCombos[key].wins++;
  deepCombos[key].rawR += t.rawR || 0;
}
for (const [key, data] of Object.entries(deepCombos).sort((a, b) => b[1].total - a[1].total)) {
  const wr = (data.wins/data.total*100).toFixed(0);
  console.log(`  ${key.padEnd(35)} ${data.total} trades | ${data.wins}W ${data.total-data.wins}L | ${wr}% WR | R: ${data.rawR.toFixed(2)}`);
}
