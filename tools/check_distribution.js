const r = require('./trade_results.json').filter(t => !t.error);
const longs = r.filter(t => t.decision.side === 'LONG');
const shorts = r.filter(t => t.decision.side === 'SHORT');

console.log('LONG/SHORT DISTRIBUTION (Iter 4)');
console.log('================================');
console.log('LONG:  ' + longs.length + ' trades (' + (longs.length/r.length*100).toFixed(0) + '%)');
console.log('SHORT: ' + shorts.length + ' trades (' + (shorts.length/r.length*100).toFixed(0) + '%)');

// Win rates by side
const longWins = longs.filter(t => t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0)).length;
const longLosses = longs.filter(t => t.simResult.outcome === 'SL').length;
const shortWins = shorts.filter(t => t.simResult.outcome === 'TP' || (t.simResult.outcome === 'TIMEOUT' && t.rawR > 0)).length;
const shortLosses = shorts.filter(t => t.simResult.outcome === 'SL').length;

const longPnL = longs.reduce((s, t) => s + t.weightedR, 0);
const shortPnL = shorts.reduce((s, t) => s + t.weightedR, 0);

console.log('');
console.log('LONG WR:  ' + longWins + 'W/' + longLosses + 'L = ' + (longWins/(longWins+longLosses)*100).toFixed(0) + '% | PnL: ' + longPnL.toFixed(2) + 'R');
console.log('SHORT WR: ' + shortWins + 'W/' + shortLosses + 'L = ' + (shortWins/(shortWins+shortLosses)*100).toFixed(0) + '% | PnL: ' + shortPnL.toFixed(2) + 'R');
