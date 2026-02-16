const results = require('./trade_results.json');

// Filter out errors
const trades = results.filter(t => !t.error && t.decision && t.simResult);

console.log('=== INVERTED RISK ANALYSIS ===');
console.log('Testing hypothesis: What if risk was 1 - risk?');
console.log('If inverted is better, AI understands quality but has logic backwards.');
console.log('');

// Calculate original weighted R
const originalTotal = trades.reduce((sum, t) => sum + (t.weightedR || 0), 0);

// Calculate inverted weighted R
// Original: weightedR = rawR * risk
// Inverted: weightedR = rawR * (1 - risk)
const invertedTotal = trades.reduce((sum, t) => {
  const rawR = t.rawR || 0;
  const originalRisk = t.decision.risk;
  const invertedRisk = 1 - originalRisk;
  return sum + (rawR * invertedRisk);
}, 0);

console.log('=== OVERALL COMPARISON ===');
console.log('Original Total R:', originalTotal.toFixed(3));
console.log('INVERTED Total R:', invertedTotal.toFixed(3));
console.log('Difference:', (invertedTotal - originalTotal).toFixed(3));
console.log('');

if (invertedTotal > originalTotal) {
  console.log('*** INVERTED IS BETTER ***');
  console.log('The AI understands setup quality but has risk logic BACKWARDS.');
  console.log('It thinks low number = less confident, but we want low number = less risk.');
} else {
  console.log('Original is better or same.');
  console.log('The AI is just bad at predicting, not inverted.');
}
console.log('');

// By strategy
console.log('=== BY STRATEGY ===');
const byStrategy = {};
trades.forEach(t => {
  const strat = t.selectedStrategy || 'UNKNOWN';
  if (!byStrategy[strat]) byStrategy[strat] = { original: 0, inverted: 0, trades: 0 };
  byStrategy[strat].trades++;
  byStrategy[strat].original += t.weightedR || 0;

  const rawR = t.rawR || 0;
  const invertedRisk = 1 - t.decision.risk;
  byStrategy[strat].inverted += rawR * invertedRisk;
});

Object.keys(byStrategy).sort().forEach(strat => {
  const s = byStrategy[strat];
  const better = s.inverted > s.original ? 'INVERTED BETTER' : s.inverted < s.original ? 'ORIGINAL BETTER' : 'SAME';
  console.log(`${strat} (${s.trades} trades):`);
  console.log(`  Original: ${s.original.toFixed(3)} | Inverted: ${s.inverted.toFixed(3)} | ${better}`);
  console.log(`  Diff: ${(s.inverted - s.original).toFixed(3)}`);
  console.log('');
});

// Equity curve comparison
console.log('=== EQUITY CURVES ===');
let cumOriginal = 0;
let cumInverted = 0;
console.log('Trade | Original | Inverted | Better');
trades.forEach((t, i) => {
  cumOriginal += t.weightedR || 0;
  const rawR = t.rawR || 0;
  const invertedRisk = 1 - t.decision.risk;
  cumInverted += rawR * invertedRisk;

  if ((i + 1) % 5 === 0 || i === trades.length - 1) {
    const better = cumInverted > cumOriginal ? 'INV' : 'ORIG';
    console.log(`T${i+1}: ${cumOriginal.toFixed(2)} | ${cumInverted.toFixed(2)} | ${better}`);
  }
});

console.log('');
console.log('=== DETAILED TRADE ANALYSIS ===');
console.log('Looking at where inversion helps most...');
console.log('');

// Show trades where inversion made biggest difference
const diffs = trades.map(t => {
  const originalWR = t.weightedR || 0;
  const rawR = t.rawR || 0;
  const invertedRisk = 1 - t.decision.risk;
  const invertedWR = rawR * invertedRisk;
  return {
    trade: t.tradeNum,
    strat: t.selectedStrategy,
    outcome: t.simResult.outcome,
    risk: t.decision.risk,
    invertedRisk: invertedRisk,
    originalWR,
    invertedWR,
    diff: invertedWR - originalWR
  };
});

// Sort by difference (where inversion helped most)
diffs.sort((a, b) => b.diff - a.diff);

console.log('Top 10 trades where INVERSION helped:');
diffs.slice(0, 10).forEach(d => {
  console.log(`T${d.trade} ${d.strat} ${d.outcome}: Risk ${d.risk.toFixed(2)}→${d.invertedRisk.toFixed(2)} | WR ${d.originalWR.toFixed(2)}→${d.invertedWR.toFixed(2)} | Diff: +${d.diff.toFixed(2)}`);
});

console.log('');
console.log('Top 10 trades where INVERSION hurt:');
diffs.slice(-10).reverse().forEach(d => {
  console.log(`T${d.trade} ${d.strat} ${d.outcome}: Risk ${d.risk.toFixed(2)}→${d.invertedRisk.toFixed(2)} | WR ${d.originalWR.toFixed(2)}→${d.invertedWR.toFixed(2)} | Diff: ${d.diff.toFixed(2)}`);
});
