const results = require('../results/trade_results.json');
const executed = results.filter(r => !r.error && r.decision && r.decision.risk > 0);

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
  const reasoning = (t.decision.reasoning || '').slice(0, 140);
  const rootCause = ((t.summary && t.summary.root_cause) || (t.summary && t.summary.why_outcome) || 'N/A').slice(0, 140);

  console.log(`#${t.tradeNum} | ${side} | ${regime}+${struct} | ${session} | PosInSR: ${pos}%`);
  console.log(`  Reasoning: ${reasoning}`);
  console.log(`  Why it won: ${rootCause}`);
  console.log('');
}

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
  const reasoning = (t.decision.reasoning || '').slice(0, 140);
  const rootCause = ((t.summary && t.summary.root_cause) || (t.summary && t.summary.why_outcome) || 'N/A').slice(0, 140);
  const lesson = ((t.summary && t.summary.lesson) || 'N/A').slice(0, 140);
  const barsToExit = t.simResult ? t.simResult.barsToExit : '?';

  console.log(`#${t.tradeNum} | ${side} | ${regime}+${struct} | ${session} | PosInSR: ${pos}% | Exit in ${barsToExit} bars`);
  console.log(`  Reasoning: ${reasoning}`);
  console.log(`  Root cause: ${rootCause}`);
  console.log(`  Lesson: ${lesson}`);
  console.log('');
}

// Pattern analysis
console.log('\n=== PATTERN ANALYSIS ===\n');

// Losses where direction fought position
const fightingPosition = losses.filter(t => {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
  return (t.decision.side === 'SHORT' && pos < 20) || (t.decision.side === 'LONG' && pos > 80);
});
console.log(`Losses fighting position (SHORT at bottom / LONG at top): ${fightingPosition.length}/${losses.length}`);
for (const t of fightingPosition) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  console.log(`  #${t.tradeNum} ${t.decision.side} at PosInSR=${pos}% (${t.indicators.marketRegime}+${t.indicators.structureLabel})`);
}

// Losses outside S/R range
const outsideLosses = losses.filter(t => {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? (price - t.indicators.support) / sr * 100 : 50;
  return pos < 0 || pos > 100;
});
console.log(`\nLosses outside S/R range: ${outsideLosses.length}/${losses.length}`);
for (const t of outsideLosses) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  console.log(`  #${t.tradeNum} ${t.decision.side} at PosInSR=${pos}% (${t.indicators.marketRegime}+${t.indicators.structureLabel})`);
}

// Speed of losses
const fastLosses = losses.filter(t => t.simResult.barsToExit <= 5);
const slowLosses = losses.filter(t => t.simResult.barsToExit > 20);
console.log(`\nFast losses (<=5 bars / 25min): ${fastLosses.length}/${losses.length}`);
console.log(`Slow losses (>20 bars / 1.5h+): ${slowLosses.length}/${losses.length}`);

// DOWNTREND+TREND — 0% WR
console.log('\n=== DOWNTREND+TREND: 0/3 WR — what happened? ===');
const dtTrend = executed.filter(t => t.indicators.structureLabel === 'DOWNTREND' && t.indicators.marketRegime === 'TREND');
for (const t of dtTrend) {
  const sr = t.indicators.resistance - t.indicators.support;
  const price = t.execution ? t.execution.actualEntry : t.decision.aiEntry;
  const pos = sr > 0 ? Math.round((price - t.indicators.support) / sr * 100) : '?';
  console.log(`  #${t.tradeNum} ${t.decision.side} at PosInSR=${pos}% -> ${t.simResult.outcome} (${t.simResult.barsToExit} bars)`);
  console.log(`    ${(t.decision.reasoning || '').slice(0, 140)}`);
}
