const trades = require('./test4_gpt5_old.json');
const wins = trades.filter(t => t.simResult && t.simResult.outcome === 'TP');
const losses = trades.filter(t => t.simResult && t.simResult.outcome === 'SL');

console.log('=== OLD DATA (Aug-Nov) WIN vs LOSS ===');
console.log('Wins:', wins.length, '| Losses:', losses.length);

// Structure coherence - coherent if regime and structure match
const coherent = (t) => {
  const regime = t.indicators.marketRegime;
  const struct = t.indicators.structureLabel;
  if (regime === 'RANGE' && struct === 'RANGE') return true;
  if (regime === 'TREND' && struct !== 'RANGE') return true;
  return false;
};
console.log('Structure coherence:');
console.log('  Wins coherent:', wins.filter(coherent).length, '/', wins.length);
console.log('  Loss coherent:', losses.filter(coherent).length, '/', losses.length);

// EMA slope magnitude
const winSlopes = wins.map(t => Math.abs(t.indicators.EMA50_slope_30m));
const lossSlopes = losses.map(t => Math.abs(t.indicators.EMA50_slope_30m));
console.log('EMA slope magnitude:');
console.log('  Wins avg:', (winSlopes.reduce((a,b) => a+b, 0) / winSlopes.length).toFixed(4));
console.log('  Loss avg:', (lossSlopes.reduce((a,b) => a+b, 0) / lossSlopes.length).toFixed(4));

// Combined with recent data
const recentTrades = require('./gpt5_trade_results.json');
const allTrades = [...trades, ...recentTrades];
const allWins = allTrades.filter(t => t.simResult && t.simResult.outcome === 'TP');
const allLosses = allTrades.filter(t => t.simResult && t.simResult.outcome === 'SL');

console.log('\n=== COMBINED DATA (Both periods) ===');
console.log('Wins:', allWins.length, '| Losses:', allLosses.length);
console.log('Structure coherence:');
console.log('  Wins coherent:', allWins.filter(coherent).length, '/', allWins.length);
console.log('  Loss coherent:', allLosses.filter(coherent).length, '/', allLosses.length);

// What percentage of coherent trades win?
const coherentTrades = allTrades.filter(coherent);
const coherentWins = coherentTrades.filter(t => t.simResult.outcome === 'TP');
console.log('\nCoherent trades win rate:', (coherentWins.length / coherentTrades.length * 100).toFixed(1) + '%');

const incoherentTrades = allTrades.filter(t => !coherent(t));
const incoherentWins = incoherentTrades.filter(t => t.simResult.outcome === 'TP');
console.log('Incoherent trades win rate:', (incoherentWins.length / incoherentTrades.length * 100).toFixed(1) + '%');
