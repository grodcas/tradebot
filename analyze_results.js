const results = require('./trade_results.json');

// Filter out errors
const trades = results.filter(t => !t.error && t.decision);

console.log('=== WEIGHTED R EXPLANATION ===');
console.log('Total trades analyzed:', trades.length);

const totalWeightedR = trades.reduce((sum, t) => sum + (t.weightedR || 0), 0);
const avgWeightedR = totalWeightedR / trades.length;
console.log('Total Weighted R (SUM across all trades):', totalWeightedR.toFixed(3));
console.log('Avg Weighted R per trade:', avgWeightedR.toFixed(4));
console.log('');
console.log('MEANING: -0.35 total means you lost 0.35R across ALL 50 trades combined.');
console.log('If 1R = $100, you lost $35 total on 50 trades.');
console.log('');

// Wins vs Losses average R
const wins = trades.filter(t => t.simResult && t.simResult.outcome === 'TP');
const losses = trades.filter(t => t.simResult && t.simResult.outcome === 'SL');
console.log('=== WIN/LOSS BREAKDOWN ===');
console.log('Wins:', wins.length, '| Avg weighted R per win:', (wins.reduce((s,t) => s + t.weightedR, 0) / wins.length).toFixed(3));
console.log('Losses:', losses.length, '| Avg weighted R per loss:', (losses.reduce((s,t) => s + t.weightedR, 0) / losses.length).toFixed(3));
console.log('');

// Equity curve
console.log('=== EQUITY CURVE (Cumulative R after each trade) ===');
let cumR = 0;
let peak = 0;
let maxDrawdown = 0;
const curve = [];

trades.forEach((t, i) => {
  cumR += t.weightedR || 0;
  if (cumR > peak) peak = cumR;
  const dd = cumR - peak;
  if (dd < maxDrawdown) maxDrawdown = dd;
  curve.push({ trade: i + 1, cumR, dd });
});

// Print curve in chunks
for (let i = 0; i < curve.length; i += 5) {
  const chunk = curve.slice(i, i + 5);
  console.log(chunk.map(c => `T${c.trade}:${c.cumR.toFixed(2)}`).join(' | '));
}
console.log('');
console.log('Peak R reached:', peak.toFixed(2));
console.log('Max Drawdown from peak:', maxDrawdown.toFixed(2));
console.log('');

// Strategy breakdown
console.log('=== PERFORMANCE BY STRATEGY ===');
const byStrategy = {};
trades.forEach(t => {
  const strat = t.selectedStrategy || 'UNKNOWN';
  if (!byStrategy[strat]) byStrategy[strat] = { trades: [], wins: 0, losses: 0, totalR: 0 };
  byStrategy[strat].trades.push(t);
  byStrategy[strat].totalR += t.weightedR || 0;
  if (t.simResult && t.simResult.outcome === 'TP') byStrategy[strat].wins++;
  if (t.simResult && t.simResult.outcome === 'SL') byStrategy[strat].losses++;
});

Object.keys(byStrategy).sort().forEach(strat => {
  const s = byStrategy[strat];
  const winRate = s.trades.length > 0 ? (s.wins / s.trades.length * 100).toFixed(1) : 0;
  console.log(`${strat}: ${s.trades.length} trades | ${s.wins}W/${s.losses}L | WinRate: ${winRate}% | Total R: ${s.totalR.toFixed(2)}`);
});
console.log('');

// Risk correlation with outcome
console.log('=== RISK vs OUTCOME CORRELATION ===');
const winRisks = wins.map(t => t.decision.risk);
const lossRisks = losses.map(t => t.decision.risk);
const avgWinRisk = winRisks.reduce((a,b) => a+b, 0) / winRisks.length;
const avgLossRisk = lossRisks.reduce((a,b) => a+b, 0) / lossRisks.length;

console.log('Avg risk on WINNING trades:', avgWinRisk.toFixed(3));
console.log('Avg risk on LOSING trades:', avgLossRisk.toFixed(3));
console.log('');

if (avgWinRisk > avgLossRisk) {
  console.log('GOOD: Higher risk on winners than losers (+correlation)');
} else if (avgWinRisk < avgLossRisk) {
  console.log('BAD: Higher risk on LOSERS than winners (-correlation)');
  console.log('This means we are sizing UP on bad trades and DOWN on good trades!');
} else {
  console.log('NEUTRAL: Equal risk on wins and losses');
}

// Risk distribution
console.log('');
console.log('=== RISK DISTRIBUTION ===');
const riskBuckets = { '0.1-0.2': {w:0,l:0}, '0.2-0.3': {w:0,l:0}, '0.3-0.4': {w:0,l:0}, '0.4-0.5': {w:0,l:0}, '0.5-0.6': {w:0,l:0}, '0.6+': {w:0,l:0} };
trades.forEach(t => {
  const r = t.decision.risk;
  const outcome = t.simResult && t.simResult.outcome;
  let bucket;
  if (r < 0.2) bucket = '0.1-0.2';
  else if (r < 0.3) bucket = '0.2-0.3';
  else if (r < 0.4) bucket = '0.3-0.4';
  else if (r < 0.5) bucket = '0.4-0.5';
  else if (r < 0.6) bucket = '0.5-0.6';
  else bucket = '0.6+';

  if (outcome === 'TP') riskBuckets[bucket].w++;
  else if (outcome === 'SL') riskBuckets[bucket].l++;
});

Object.keys(riskBuckets).forEach(bucket => {
  const b = riskBuckets[bucket];
  const total = b.w + b.l;
  const wr = total > 0 ? (b.w / total * 100).toFixed(0) : 'N/A';
  console.log(`Risk ${bucket}: ${total} trades | ${b.w}W/${b.l}L | WinRate: ${wr}%`);
});

// Strategy-specific risk correlation
console.log('');
console.log('=== RISK CORRELATION BY STRATEGY ===');
Object.keys(byStrategy).sort().forEach(strat => {
  const s = byStrategy[strat];
  const stratWins = s.trades.filter(t => t.simResult && t.simResult.outcome === 'TP');
  const stratLosses = s.trades.filter(t => t.simResult && t.simResult.outcome === 'SL');

  if (stratWins.length > 0 && stratLosses.length > 0) {
    const avgWR = stratWins.reduce((sum, t) => sum + t.decision.risk, 0) / stratWins.length;
    const avgLR = stratLosses.reduce((sum, t) => sum + t.decision.risk, 0) / stratLosses.length;
    const corr = avgWR > avgLR ? 'GOOD' : avgWR < avgLR ? 'BAD' : 'NEUTRAL';
    console.log(`${strat}: WinRisk=${avgWR.toFixed(2)} | LossRisk=${avgLR.toFixed(2)} | ${corr}`);
  }
});
