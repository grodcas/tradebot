const r = require('./trade_results.json').filter(t => !t.error);

console.log('═══════════════════════════════════════════════════════════════');
console.log('ITERATION COMPARISON - Current Model Analysis');
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. CONSISTENCY - Losing streak analysis
console.log('1. CONSISTENCY (Losing Streak Distribution)');
console.log('───────────────────────────────────────────');

let currentStreak = 0;
let maxStreak = 0;
let streaks = [];
let outcomes = [];

r.forEach(t => {
  const isLoss = t.simResult.outcome === 'SL';
  outcomes.push(isLoss ? 'L' : 'W');

  if (isLoss) {
    currentStreak++;
    maxStreak = Math.max(maxStreak, currentStreak);
  } else {
    if (currentStreak > 0) streaks.push(currentStreak);
    currentStreak = 0;
  }
});
if (currentStreak > 0) streaks.push(currentStreak);

// Count streak lengths
const streakDist = {};
streaks.forEach(s => {
  streakDist[s] = (streakDist[s] || 0) + 1;
});

console.log('Outcome sequence: ' + outcomes.join(''));
console.log('Max losing streak: ' + maxStreak);
console.log('Streak distribution:');
Object.entries(streakDist).sort((a,b) => a[0]-b[0]).forEach(([len, count]) => {
  console.log('  ' + len + '-loss streak: ' + count + 'x');
});

// Calculate loss clustering score (lower is better - more evenly distributed)
const totalLosses = r.filter(t => t.simResult.outcome === 'SL').length;
const avgStreakLen = streaks.length > 0 ? streaks.reduce((a,b) => a+b, 0) / streaks.length : 0;
console.log('Avg streak length: ' + avgStreakLen.toFixed(2));
console.log('');

// 2. RISK MANAGEMENT
console.log('2. RISK MANAGEMENT (Risk vs Outcome Correlation)');
console.log('───────────────────────────────────────────────');

const riskBuckets = {
  'Low (≤40%)': { wins: 0, losses: 0, totalRisk: 0, count: 0 },
  'Mid (41-60%)': { wins: 0, losses: 0, totalRisk: 0, count: 0 },
  'High (>60%)': { wins: 0, losses: 0, totalRisk: 0, count: 0 }
};

r.forEach(t => {
  const risk = t.decision.risk;
  const bucket = risk <= 0.4 ? 'Low (≤40%)' : risk <= 0.6 ? 'Mid (41-60%)' : 'High (>60%)';
  const isWin = t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0);

  riskBuckets[bucket].count++;
  riskBuckets[bucket].totalRisk += risk;
  if (isWin) riskBuckets[bucket].wins++;
  else if (t.simResult.outcome === 'SL') riskBuckets[bucket].losses++;
});

Object.entries(riskBuckets).forEach(([bucket, d]) => {
  if (d.count === 0) return;
  const wr = d.wins + d.losses > 0 ? (d.wins/(d.wins+d.losses)*100).toFixed(0) : 'N/A';
  const avgRisk = (d.totalRisk / d.count * 100).toFixed(0);
  console.log(bucket + ': ' + d.wins + 'W/' + d.losses + 'L = ' + wr + '% WR (n=' + d.count + ', avg risk=' + avgRisk + '%)');
});

// Risk range used
const risks = r.map(t => t.decision.risk);
const minRisk = Math.min(...risks);
const maxRisk = Math.max(...risks);
const uniqueRisks = [...new Set(risks.map(r => (r*100).toFixed(0)))].sort((a,b) => a-b);
console.log('Risk range: ' + (minRisk*100).toFixed(0) + '% - ' + (maxRisk*100).toFixed(0) + '%');
console.log('Unique risk levels: ' + uniqueRisks.join('%, ') + '%');
console.log('');

// 3. WIN RATE
console.log('3. WIN RATE');
console.log('───────────────────────────────────────────────');
const wins = r.filter(t => t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0)).length;
const losses = r.filter(t => t.simResult.outcome === 'SL').length;
const timeouts = r.filter(t => t.simResult.outcome === 'TIMEOUT').length;
console.log('Wins: ' + wins + ' | Losses: ' + losses + ' | Timeouts: ' + timeouts);
console.log('Win Rate: ' + (wins/(wins+losses)*100).toFixed(1) + '%');
console.log('');

// 4. MARGIN (PnL)
console.log('4. MARGIN (PnL)');
console.log('───────────────────────────────────────────────');
const totalR = r.reduce((s, t) => s + t.weightedR, 0);
const avgPerTrade = totalR / r.length;
const grossProfit = r.filter(t => t.weightedR > 0).reduce((s, t) => s + t.weightedR, 0);
const grossLoss = Math.abs(r.filter(t => t.weightedR < 0).reduce((s, t) => s + t.weightedR, 0));
const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

console.log('Total PnL: +' + totalR.toFixed(2) + 'R');
console.log('Avg per Trade: +' + avgPerTrade.toFixed(3) + 'R');
console.log('Gross Profit: +' + grossProfit.toFixed(2) + 'R');
console.log('Gross Loss: -' + grossLoss.toFixed(2) + 'R');
console.log('Profit Factor: ' + profitFactor.toFixed(2));

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('ITERATION HISTORY (from conversation)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Iter 1 (Baseline):     +11.62R | 69% WR | Risk clustered 0.5-0.7');
console.log('Iter 2 (Conservative): +7.80R  | 62% WR | All trades at 0.3 risk');
console.log('Iter 3 (Inverted):     +5.42R  | 55% WR | Low conf had higher WR');
console.log('Iter 4 (Current):      +12.32R | 69% WR | EMA+Regime calibration');
console.log('');
console.log('Changes in Current (Iter 4):');
console.log('- EMA alignment as primary predictor');
console.log('- RANGE regime capped at 65% max confidence');
console.log('- Position in range penalties (-15% for middle)');
console.log('- Counter-structure penalties');
console.log('- Breakout=0 NOT penalized (was incorrect before)');
