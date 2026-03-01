/**
 * P&L Analysis from live_trader.log
 */
const fs = require('fs');

// Parse command line - if "log" argument, analyze log file
if (process.argv[2] === 'log') {
  const log = fs.readFileSync('live_trader.log', 'utf8');
  const regex = /\[(\w+)\] \[REAL P&L\] Gross: \$(-?[\d.]+) \| Commission: \$[\d.]+ \| Net: \$(-?[\d.]+)/g;

  const totals = {
    EURUSD: {gross: 0, net: 0, count: 0},
    USDJPY: {gross: 0, net: 0, count: 0},
    EURUSD_GPT5: {gross: 0, net: 0, count: 0},
    GBPUSD: {gross: 0, net: 0, count: 0}
  };
  let totalGross = 0, totalNet = 0, totalTrades = 0;

  let match;
  while ((match = regex.exec(log)) !== null) {
    const pair = match[1];
    const gross = parseFloat(match[2]);
    const net = parseFloat(match[3]);
    if (totals[pair]) {
      totals[pair].gross += gross;
      totals[pair].net += net;
      totals[pair].count++;
    }
    totalGross += gross;
    totalNet += net;
    totalTrades++;
  }

  console.log('=== TODAY REAL P&L (100K positions) ===\n');
  for (const [pair, data] of Object.entries(totals)) {
    const status = data.net >= 0 ? 'OK' : 'X';
    console.log(`${pair.padEnd(12)}: ${String(data.count).padStart(2)} trades | Gross: $${data.gross.toFixed(2).padStart(10)} | Net: $${data.net.toFixed(2).padStart(10)} ${status}`);
  }
  console.log('');
  console.log(`${'TOTAL'.padEnd(12)}: ${String(totalTrades).padStart(2)} trades | Gross: $${totalGross.toFixed(2).padStart(10)} | Net: $${totalNet.toFixed(2).padStart(10)}`);
  console.log('');
  console.log(`Commission: $${(totalTrades * 4).toFixed(2)} (${totalTrades} x $4 round-trip)`);
  process.exit(0);
}

const data = require('./global_trades.json');
const trades = data.trades;

// OANDA actual spreads (in pips) - from live data
const OANDA_SPREADS = {
  EURUSD: 1.7,      // EUR/USD spread from OANDA
  USDJPY: 1.8,      // USD/JPY spread from OANDA
  GBPUSD: 2.1,      // GBP/USD spread from OANDA
  EURUSD_GPT5: 1.7, // Same as EURUSD
};

// Position size for P&L calculation
const POSITION_SIZE = 100000; // 100K = $10/pip for EUR/USD

// Pip value per 100K position
// USD/JPY: 100000 / 156.123 = $6.41 per pip
const PIP_VALUES = {
  EURUSD: 10,       // $10 per pip
  USDJPY: 6.41,     // $6.41 per pip (at USD/JPY 156.123)
  GBPUSD: 10,       // $10 per pip
  EURUSD_GPT5: 10,
};

// Group trades by pair
const byPair = {};
trades.forEach(t => {
  const pair = t.pairCode || 'EURUSD';
  if (!byPair[pair]) byPair[pair] = [];
  byPair[pair].push(t);
});

console.log('═══════════════════════════════════════════════════════════════');
console.log('              P&L ANALYSIS WITH OANDA SPREADS');
console.log('              Position Size: 100K per trade');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

let grandTotalGross = 0;
let grandTotalSpreadCost = 0;
let grandTotalNet = 0;
let grandTotalTrades = 0;

Object.keys(byPair).sort().forEach(pair => {
  const pairTrades = byPair[pair];
  const spread = OANDA_SPREADS[pair] || 1.5;
  const pipValue = PIP_VALUES[pair] || 10;
  const pipMult = pair.includes('JPY') ? 100 : 10000;

  let pairGrossPnL = 0;
  let pairSpreadCost = 0;

  pairTrades.forEach(t => {
    // Calculate gross P&L in pips
    const priceDiff = t.side === 'LONG'
      ? (t.exitPrice - t.entry)
      : (t.entry - t.exitPrice);
    const pipsGained = priceDiff * pipMult;
    const grossPnL = pipsGained * pipValue;

    // Spread cost (paid on entry AND exit = round trip)
    const spreadCost = spread * pipValue;

    pairGrossPnL += grossPnL;
    pairSpreadCost += spreadCost;
  });

  const pairNetPnL = pairGrossPnL - pairSpreadCost;
  const wins = pairTrades.filter(t => t.outcome === 'TP').length;
  const losses = pairTrades.filter(t => t.outcome === 'SL').length;
  const timeouts = pairTrades.filter(t => t.outcome === 'TIMEOUT').length;

  console.log(`┌─ ${pair} ─────────────────────────────────────────────────`);
  console.log(`│  Trades: ${pairTrades.length} (${wins}W / ${losses}L / ${timeouts}T) | Win Rate: ${(wins/pairTrades.length*100).toFixed(1)}%`);
  console.log(`│  OANDA Spread: ${spread} pips ($${(spread * pipValue).toFixed(2)} per trade)`);
  console.log(`│`);
  console.log(`│  Gross P&L:    $${pairGrossPnL >= 0 ? '+' : ''}${pairGrossPnL.toFixed(2)}`);
  console.log(`│  Spread Cost:  -$${pairSpreadCost.toFixed(2)} (${pairTrades.length} trades × $${(spread * pipValue).toFixed(2)})`);
  console.log(`│  ────────────────────────────`);
  console.log(`│  NET P&L:      $${pairNetPnL >= 0 ? '+' : ''}${pairNetPnL.toFixed(2)}`);
  console.log(`└──────────────────────────────────────────────────────────────`);
  console.log('');

  grandTotalGross += pairGrossPnL;
  grandTotalSpreadCost += pairSpreadCost;
  grandTotalNet += pairNetPnL;
  grandTotalTrades += pairTrades.length;
});

console.log('═══════════════════════════════════════════════════════════════');
console.log('                      GRAND TOTAL');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total Trades:      ${grandTotalTrades}`);
console.log(`  Gross P&L:         $${grandTotalGross >= 0 ? '+' : ''}${grandTotalGross.toFixed(2)}`);
console.log(`  Total Spread Cost: -$${grandTotalSpreadCost.toFixed(2)}`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  NET P&L:           $${grandTotalNet >= 0 ? '+' : ''}${grandTotalNet.toFixed(2)}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log('Note: Spread costs assume round-trip (entry + exit) spread.');
console.log('      Actual OANDA spreads may vary with market conditions.');
