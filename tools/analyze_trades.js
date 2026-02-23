const path = require('path');
const data = require(path.join(__dirname, '../results/trade_results.json'));
const trades = Array.isArray(data) ? data : Object.values(data);

console.log('=== COMPREHENSIVE TRADE ANALYSIS ===\n');
console.log('Total trades:', trades.length);

// Separate by outcome
const wins = trades.filter(t => t.simResult?.outcome === 'TP');
const losses = trades.filter(t => t.simResult?.outcome === 'SL');
const timeouts = trades.filter(t => t.simResult?.outcome === 'TIMEOUT');

console.log('Wins (TP):', wins.length, '(' + (wins.length/trades.length*100).toFixed(1) + '%)');
console.log('Losses (SL):', losses.length, '(' + (losses.length/trades.length*100).toFixed(1) + '%)');
console.log('Timeouts:', timeouts.length);

// Direction analysis
console.log('\n=== BY DIRECTION ===');
const longTrades = trades.filter(t => t.decision?.side === 'LONG');
const shortTrades = trades.filter(t => t.decision?.side === 'SHORT');
const longWins = longTrades.filter(t => t.simResult?.outcome === 'TP');
const shortWins = shortTrades.filter(t => t.simResult?.outcome === 'TP');
console.log('LONG trades:', longTrades.length, '| Wins:', longWins.length, '(' + (longWins.length/longTrades.length*100||0).toFixed(1) + '%)');
console.log('SHORT trades:', shortTrades.length, '| Wins:', shortWins.length, '(' + (shortWins.length/shortTrades.length*100||0).toFixed(1) + '%)');

// Regime analysis
console.log('\n=== BY MARKET REGIME ===');
const regimes = {};
trades.forEach(t => {
  const regime = t.indicators?.marketRegime || 'UNKNOWN';
  if (!regimes[regime]) regimes[regime] = { total: 0, wins: 0, losses: 0 };
  regimes[regime].total++;
  if (t.simResult?.outcome === 'TP') regimes[regime].wins++;
  if (t.simResult?.outcome === 'SL') regimes[regime].losses++;
});
Object.entries(regimes).forEach(([r, s]) => {
  console.log(r + ':', s.total, 'trades | WR:', (s.wins/s.total*100).toFixed(1) + '% | Loss rate:', (s.losses/s.total*100).toFixed(1) + '%');
});

// Structure analysis
console.log('\n=== BY STRUCTURE STATE ===');
const structures = {};
trades.forEach(t => {
  const struct = t.indicators?.structureLabel || 'UNKNOWN';
  if (!structures[struct]) structures[struct] = { total: 0, wins: 0, losses: 0 };
  structures[struct].total++;
  if (t.simResult?.outcome === 'TP') structures[struct].wins++;
  if (t.simResult?.outcome === 'SL') structures[struct].losses++;
});
Object.entries(structures).forEach(([s, stats]) => {
  console.log(s + ':', stats.total, 'trades | WR:', (stats.wins/stats.total*100).toFixed(1) + '%');
});

// Direction + Structure cross analysis
console.log('\n=== DIRECTION vs STRUCTURE (critical) ===');
const crossAnalysis = {};
trades.forEach(t => {
  const key = t.decision?.side + ' in ' + (t.indicators?.structureLabel || 'UNKNOWN');
  if (!crossAnalysis[key]) crossAnalysis[key] = { total: 0, wins: 0, losses: 0, totalR: 0 };
  crossAnalysis[key].total++;
  crossAnalysis[key].totalR += t.weightedR || 0;
  if (t.simResult?.outcome === 'TP') crossAnalysis[key].wins++;
  if (t.simResult?.outcome === 'SL') crossAnalysis[key].losses++;
});
Object.entries(crossAnalysis).sort((a,b) => b[1].total - a[1].total).forEach(([k, s]) => {
  console.log(k + ':', s.total, 'trades | WR:', (s.wins/s.total*100).toFixed(1) + '% | Total R:', s.totalR.toFixed(2));
});

// R analysis
console.log('\n=== R ANALYSIS ===');
const avgWinR = wins.length > 0 ? wins.reduce((a,t) => a + (t.weightedR || 0), 0) / wins.length : 0;
const avgLossR = losses.length > 0 ? losses.reduce((a,t) => a + (t.weightedR || 0), 0) / losses.length : 0;
console.log('Avg Win R:', avgWinR.toFixed(2));
console.log('Avg Loss R:', avgLossR.toFixed(2));
if (losses.length > 0 && avgLossR !== 0) {
  console.log('Profit Factor:', Math.abs(avgWinR * wins.length / (avgLossR * losses.length)).toFixed(2));
}

// Bars to exit analysis
console.log('\n=== TRADE DURATION (bars to exit) ===');
const winBars = wins.map(t => t.simResult?.barsToExit || 0).filter(b => b > 0);
const lossBars = losses.map(t => t.simResult?.barsToExit || 0).filter(b => b > 0);
if (winBars.length > 0) console.log('Avg bars to WIN:', (winBars.reduce((a,b)=>a+b,0)/winBars.length).toFixed(1));
if (lossBars.length > 0) {
  console.log('Avg bars to LOSS:', (lossBars.reduce((a,b)=>a+b,0)/lossBars.length).toFixed(1));
  console.log('Max bars to LOSS:', Math.max(...lossBars));
}

// Quick vs slow losses
console.log('\n=== LOSS SPEED ANALYSIS ===');
const quickLosses = losses.filter(t => (t.simResult?.barsToExit || 0) < 10);
const slowLosses = losses.filter(t => (t.simResult?.barsToExit || 0) >= 30);
console.log('Quick losses (<10 bars):', quickLosses.length);
console.log('Slow losses (>=30 bars):', slowLosses.length);

// Breakout score analysis
console.log('\n=== BREAKOUT SCORE IMPACT ===');
const negativeBreakout = trades.filter(t => (t.indicators?.breakoutScore || 0) < 0);
const positiveBreakout = trades.filter(t => (t.indicators?.breakoutScore || 0) > 0);
const negWR = negativeBreakout.filter(t => t.simResult?.outcome === 'TP').length / negativeBreakout.length * 100;
const posWR = positiveBreakout.filter(t => t.simResult?.outcome === 'TP').length / positiveBreakout.length * 100;
console.log('Negative breakout score:', negativeBreakout.length, 'trades | WR:', negWR.toFixed(1) + '%');
console.log('Positive breakout score:', positiveBreakout.length, 'trades | WR:', posWR.toFixed(1) + '%');

// Risk sizing analysis
console.log('\n=== RISK SIZING ===');
const riskValues = trades.map(t => t.decision?.risk || 0);
const uniqueRisks = [...new Set(riskValues)].sort((a,b) => a - b);
console.log('Risk values used:', uniqueRisks.join(', '));

// Worst losses analysis
console.log('\n=== WORST LOSSES (detailed) ===');
const sortedLosses = [...losses].sort((a,b) => (a.weightedR||0) - (b.weightedR||0));
sortedLosses.slice(0, 5).forEach((t, i) => {
  console.log('\n' + (i+1) + '. Loss of ' + (t.weightedR||0).toFixed(2) + 'R');
  console.log('   Direction:', t.decision?.side);
  console.log('   Regime:', t.indicators?.marketRegime, '| Structure:', t.indicators?.structureLabel);
  console.log('   Breakout Score:', t.indicators?.breakoutScore);
  console.log('   Bars to SL:', t.simResult?.barsToExit);
  console.log('   Risk used:', t.decision?.risk);
  if (t.summary?.why_outcome) console.log('   Why:', t.summary.why_outcome.substring(0, 250));
});

// Best wins for comparison
console.log('\n=== BEST WINS (what worked) ===');
const sortedWins = [...wins].sort((a,b) => (b.weightedR||0) - (a.weightedR||0));
sortedWins.slice(0, 3).forEach((t, i) => {
  console.log('\n' + (i+1) + '. Win of +' + (t.weightedR||0).toFixed(2) + 'R');
  console.log('   Direction:', t.decision?.side);
  console.log('   Regime:', t.indicators?.marketRegime, '| Structure:', t.indicators?.structureLabel);
  console.log('   Breakout Score:', t.indicators?.breakoutScore);
  console.log('   Bars to TP:', t.simResult?.barsToExit);
});
