const r = require('./trade_results.json').filter(t => !t.error);

// Analyze 75% confidence trades specifically
const highConf = r.filter(t => t.decision.risk === 0.7);

console.log('75% CONFIDENCE TRADES ANALYSIS');
console.log('===============================================');

let wins = 0, losses = 0;
highConf.forEach(t => {
  const outcome = t.simResult.outcome;
  const regime = t.indicators.marketRegime;
  const win = outcome === 'TP' || (outcome === 'TIMEOUT' && t.rawR > 0);
  if (win) wins++; else if (outcome === 'SL') losses++;
  const icon = win ? '+' : '-';
  console.log(`${icon} Trade ${t.tradeNum}: ${outcome} | ${regime} | ${t.decision.side}`);
});

const wr = wins + losses > 0 ? (wins/(wins+losses)*100).toFixed(0) : 'N/A';
console.log('');
console.log(`Total 75% trades: ${highConf.length} | W/L: ${wins}/${losses} = ${wr}% WR`);

// Check regime distribution
const byRegime = {};
highConf.forEach(t => {
  const reg = t.indicators.marketRegime;
  if (!byRegime[reg]) byRegime[reg] = { w: 0, l: 0 };
  const win = t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0);
  if (win) byRegime[reg].w++;
  else if (t.simResult.outcome === 'SL') byRegime[reg].l++;
});

console.log('');
console.log('75% Confidence by Regime:');
Object.entries(byRegime).forEach(([reg, d]) => {
  const total = d.w + d.l;
  const regWr = total > 0 ? (d.w/total*100).toFixed(0) : 'N/A';
  console.log(`  ${reg}: ${d.w}W/${d.l}L = ${regWr}% WR`);
});

console.log('');
console.log('ISSUE: RANGE regime trades are getting 75% confidence');
console.log('Rule violation: RANGE + EMA aligned = MAX 0.65 (not 0.75)');

// Overall comparison
console.log('');
console.log('===============================================');
console.log('OVERALL BATCH METRICS');
console.log('===============================================');

const totalWins = r.filter(t => t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0)).length;
const totalLosses = r.filter(t => t.simResult.outcome === 'SL').length;
const totalR = r.reduce((s, t) => s + t.weightedR, 0);
const profitFactor = r.filter(t => t.weightedR > 0).reduce((s, t) => s + t.weightedR, 0) /
                     Math.abs(r.filter(t => t.weightedR < 0).reduce((s, t) => s + t.weightedR, 0));

console.log(`Win Rate: ${(totalWins/(totalWins+totalLosses)*100).toFixed(1)}% (${totalWins}W/${totalLosses}L)`);
console.log(`Total PnL: ${totalR.toFixed(2)}R`);
console.log(`Avg per Trade: ${(totalR/r.length).toFixed(3)}R`);
console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
