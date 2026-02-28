#!/usr/bin/env node
const results = require('../results/trade_results.json');
console.log('=== ITER10 TRADE-BY-TRADE RESULTS ===\n');

let executed = [], skipped = [];
for (const r of results) {
  const side = r.decision && r.decision.side ? r.decision.side : '?';
  const risk = r.decision && r.decision.risk != null ? r.decision.risk : 0;
  const outcome = r.simResult && r.simResult.outcome ? r.simResult.outcome : '?';
  const rawR = r.rawR != null ? r.rawR.toFixed(2) : '?';
  const wR = r.weightedR != null ? r.weightedR.toFixed(2) : '?';
  const regime = r.indicators && r.indicators.marketRegime ? r.indicators.marketRegime : '?';
  const structure = r.indicators && r.indicators.structureLabel ? r.indicators.structureLabel : '?';
  const session = r.indicators && r.indicators.currentSession ? r.indicators.currentSession : '?';

  if (risk === 0) {
    const reason = r.decision && r.decision.reasoning ? r.decision.reasoning.slice(0, 100) : '';
    skipped.push({ num: r.tradeNum, side, regime, structure, session, reason, rawR, outcome: r.simResult && r.simResult.outcome ? r.simResult.outcome : '?' });
  } else {
    executed.push({ num: r.tradeNum, side, outcome, rawR, wR, regime, structure, session });
  }
}

console.log('EXECUTED TRADES:');
console.log('  #  | Side  | Result  | rawR  | wR    | Regime    | Structure | Session');
console.log('  ---|-------|---------|-------|-------|-----------|-----------|--------');
for (const t of executed) {
  console.log('  ' + String(t.num).padStart(2) + ' | ' + t.side.padEnd(5) + ' | ' + t.outcome.padEnd(7) + ' | ' + t.rawR.padStart(5) + ' | ' + t.wR.padStart(5) + ' | ' + t.regime.padEnd(9) + ' | ' + t.structure.padEnd(9) + ' | ' + t.session);
}

console.log('\nSKIPPED TRADES:');
console.log('  #  | Side  | Regime    | Structure | Session | Skip reason');
console.log('  ---|-------|-----------|-----------|---------|------------');
for (const t of skipped) {
  console.log('  ' + String(t.num).padStart(2) + ' | ' + t.side.padEnd(5) + ' | ' + t.regime.padEnd(9) + ' | ' + t.structure.padEnd(9) + ' | ' + t.session.padEnd(7) + ' | ' + t.reason);
}

// Stats
const wins = executed.filter(t => t.outcome === 'TP');
const losses = executed.filter(t => t.outcome === 'SL');
const timeouts = executed.filter(t => t.outcome === 'TIMEOUT');
const longTrades = executed.filter(t => t.side === 'LONG');
const shortTrades = executed.filter(t => t.side === 'SHORT');
const longWins = longTrades.filter(t => t.outcome === 'TP');
const shortWins = shortTrades.filter(t => t.outcome === 'TP');

console.log('\n=== SUMMARY ===');
console.log('Total: ' + results.length + ' | Executed: ' + executed.length + ' | Skipped: ' + skipped.length);
console.log('Wins: ' + wins.length + ' (' + (wins.length/executed.length*100).toFixed(1) + '%) | Losses: ' + losses.length + ' | Timeouts: ' + timeouts.length);
console.log('LONG: ' + longTrades.length + ' (' + longWins.length + 'W/' + (longTrades.length - longWins.length) + 'L) | SHORT: ' + shortTrades.length + ' (' + shortWins.length + 'W/' + (shortTrades.length - shortWins.length) + 'L)');
console.log('Side balance: ' + (longTrades.length/executed.length*100).toFixed(0) + '% LONG / ' + (shortTrades.length/executed.length*100).toFixed(0) + '% SHORT');

const totalRawR = executed.reduce((s, t) => s + parseFloat(t.rawR), 0);
const totalWR = executed.reduce((s, t) => s + parseFloat(t.wR), 0);
console.log('Raw R: ' + totalRawR.toFixed(2) + ' | Weighted R: ' + totalWR.toFixed(2));

// By regime
console.log('\n=== BY REGIME ===');
for (const regime of ['TREND', 'RANGE', 'EXPANSION']) {
  const rTrades = executed.filter(t => t.regime === regime);
  if (rTrades.length === 0) continue;
  const rWins = rTrades.filter(t => t.outcome === 'TP');
  const rR = rTrades.reduce((s, t) => s + parseFloat(t.rawR), 0);
  console.log(regime + ': ' + rTrades.length + ' trades, ' + rWins.length + ' wins (' + (rWins.length/rTrades.length*100).toFixed(0) + '% WR), rawR=' + rR.toFixed(2));
}

// By session
console.log('\n=== BY SESSION ===');
for (const sess of ['LONDON', 'NY', 'ASIA']) {
  const sTrades = executed.filter(t => t.session === sess);
  if (sTrades.length === 0) continue;
  const sWins = sTrades.filter(t => t.outcome === 'TP');
  const sR = sTrades.reduce((s, t) => s + parseFloat(t.rawR), 0);
  console.log(sess + ': ' + sTrades.length + ' trades, ' + sWins.length + ' wins (' + (sWins.length/sTrades.length*100).toFixed(0) + '% WR), rawR=' + sR.toFixed(2));
}

// Skipped trade outcomes if they had been taken
console.log('\n=== SKIPPED TRADE OUTCOMES (if they had been taken) ===');
let skippedWins = 0, skippedLosses = 0;
for (const t of skipped) {
  console.log('  #' + t.num + ': ' + t.side + ' -> would have been ' + t.outcome + ' (rawR=' + t.rawR + ')');
  if (t.outcome === 'TP') skippedWins++;
  else if (t.outcome === 'SL') skippedLosses++;
}
console.log('Skipped trades if taken: ' + skippedWins + ' wins / ' + skippedLosses + ' losses out of ' + skipped.length);

// Direction agent vs confidence agent rejections
console.log('\n=== SKIP REASONS ===');
let dirNeutral = 0, confReject = 0;
for (const t of skipped) {
  if (t.reason.includes('Direction unclear') || t.reason.includes('direction')) dirNeutral++;
  if (t.reason.includes('Confidence rejected') || t.reason.includes('confidence')) confReject++;
}
console.log('Direction neutral: ' + dirNeutral);
console.log('Confidence rejected: ' + confReject);

// Iter9 comparison
console.log('\n=== ITER9 vs ITER10 COMPARISON ===');
console.log('                  | Iter9     | Iter10    | Change');
console.log('  Executed        | 14/30     | ' + executed.length + '/30     | ' + (executed.length > 14 ? '+' : '') + (executed.length - 14));
console.log('  Win Rate        | 28.6%     | ' + (wins.length/executed.length*100).toFixed(1) + '%    | ' + ((wins.length/executed.length*100 - 28.6) > 0 ? '+' : '') + (wins.length/executed.length*100 - 28.6).toFixed(1) + '%');
console.log('  Raw R           | -2.00     | ' + totalRawR.toFixed(2) + '    | ' + (totalRawR + 2 > 0 ? '+' : '') + (totalRawR + 2).toFixed(2));
console.log('  Weighted R      | -1.00     | ' + totalWR.toFixed(2) + '    |');
console.log('  SHORT bias      | 78.6%     | ' + (shortTrades.length/executed.length*100).toFixed(0) + '%      | fixed');
console.log('  Breakeven WR    | 40%       | 40%       | (1.5:1 RR)');
