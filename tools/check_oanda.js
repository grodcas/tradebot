/**
 * OANDA API Validation Script
 * Checks pending orders and open trades without interfering with the trader
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const https = require('https');

const accountId = process.env.OANDA_ACCOUNT_ID;
const token = process.env.OANDA_API_TOKEN;
const env = process.env.OANDA_ENVIRONMENT || 'practice';
const host = env === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com';

function oandaRequest(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: '/v3/accounts/' + accountId + path,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

function analyzeTrade(entry, tp, sl, units, instrument) {
  const isShort = parseFloat(units) < 0;
  const pipMultiplier = instrument.includes('JPY') ? 100 : 10000;

  const risk = isShort ? (sl - entry) : (entry - sl);
  const reward = isShort ? (entry - tp) : (tp - entry);
  const riskPips = risk * pipMultiplier;
  const rewardPips = reward * pipMultiplier;
  const rr = reward / risk;

  return {
    direction: isShort ? 'SHORT' : 'LONG',
    riskPips: riskPips.toFixed(1),
    rewardPips: rewardPips.toFixed(1),
    rr: rr.toFixed(2),
    issues: []
  };
}

function validateTrade(analysis) {
  const issues = [];
  const rr = parseFloat(analysis.rr);
  const riskPips = parseFloat(analysis.riskPips);
  const rewardPips = parseFloat(analysis.rewardPips);

  // Check for unreasonable R:R
  if (rr < 0.5) issues.push(`BAD: R:R too low (${analysis.rr}) - TP is less than 0.5R`);
  if (rr > 5) issues.push(`WARNING: R:R very high (${analysis.rr}) - may be unrealistic`);

  // Check for unreasonable SL
  if (riskPips > 50) issues.push(`WARNING: SL very wide (${analysis.riskPips} pips)`);
  if (riskPips < 2) issues.push(`BAD: SL too tight (${analysis.riskPips} pips) - will get stopped out by noise`);

  // Check for unreasonable TP
  if (rewardPips < 3) issues.push(`WARNING: TP very tight (${analysis.rewardPips} pips)`);
  if (rewardPips > 100) issues.push(`WARNING: TP very ambitious (${analysis.rewardPips} pips)`);

  return issues;
}

async function check() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              OANDA API VALIDATION                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Get account summary
  const account = await oandaRequest('/summary');
  console.log('Account:', account.account.id);
  console.log('Balance:', account.account.balance, account.account.currency);
  console.log('Open Trades:', account.account.openTradeCount);
  console.log('Pending Orders:', account.account.pendingOrderCount);

  // Get pending orders
  console.log('\n┌────────────────────────────────────────────────────────────┐');
  console.log('│                    PENDING ORDERS                          │');
  console.log('└────────────────────────────────────────────────────────────┘');

  const orders = await oandaRequest('/pendingOrders');
  if (orders.orders && orders.orders.length > 0) {
    for (const o of orders.orders) {
      console.log('\n  Order ID:', o.id);
      console.log('  Instrument:', o.instrument);
      console.log('  Type:', o.type);
      console.log('  Units:', o.units);
      console.log('  Entry Price:', o.price);

      if (o.takeProfitOnFill) console.log('  TP:', o.takeProfitOnFill.price);
      if (o.stopLossOnFill) console.log('  SL:', o.stopLossOnFill.price);

      if (o.takeProfitOnFill && o.stopLossOnFill) {
        const entry = parseFloat(o.price);
        const tp = parseFloat(o.takeProfitOnFill.price);
        const sl = parseFloat(o.stopLossOnFill.price);

        const analysis = analyzeTrade(entry, tp, sl, o.units, o.instrument);
        console.log('\n  ═══ ANALYSIS ═══');
        console.log('  Direction:', analysis.direction);
        console.log('  Risk:', analysis.riskPips, 'pips');
        console.log('  Reward:', analysis.rewardPips, 'pips');
        console.log('  R:R Ratio:', analysis.rr);

        const issues = validateTrade(analysis);
        if (issues.length > 0) {
          console.log('\n  ⚠️  ISSUES DETECTED:');
          issues.forEach(i => console.log('     •', i));
        } else {
          console.log('  ✓ Trade parameters look reasonable');
        }
      }
    }
  } else {
    console.log('  No pending orders');
  }

  // Get open trades
  console.log('\n┌────────────────────────────────────────────────────────────┐');
  console.log('│                    OPEN TRADES                             │');
  console.log('└────────────────────────────────────────────────────────────┘');

  const trades = await oandaRequest('/openTrades');
  if (trades.trades && trades.trades.length > 0) {
    for (const t of trades.trades) {
      console.log('\n  Trade ID:', t.id);
      console.log('  Instrument:', t.instrument);
      console.log('  Units:', t.currentUnits);
      console.log('  Entry Price:', t.price);
      console.log('  Unrealized P&L:', t.unrealizedPL);

      if (t.takeProfitOrder) console.log('  TP:', t.takeProfitOrder.price);
      if (t.stopLossOrder) console.log('  SL:', t.stopLossOrder.price);

      if (t.takeProfitOrder && t.stopLossOrder) {
        const entry = parseFloat(t.price);
        const tp = parseFloat(t.takeProfitOrder.price);
        const sl = parseFloat(t.stopLossOrder.price);

        const analysis = analyzeTrade(entry, tp, sl, t.currentUnits, t.instrument);
        console.log('\n  ═══ ANALYSIS ═══');
        console.log('  Direction:', analysis.direction);
        console.log('  Risk:', analysis.riskPips, 'pips');
        console.log('  Reward:', analysis.rewardPips, 'pips');
        console.log('  R:R Ratio:', analysis.rr);

        const issues = validateTrade(analysis);
        if (issues.length > 0) {
          console.log('\n  ⚠️  ISSUES DETECTED:');
          issues.forEach(i => console.log('     •', i));
        } else {
          console.log('  ✓ Trade parameters look reasonable');
        }
      }
    }
  } else {
    console.log('  No open trades');
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    VALIDATION COMPLETE                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

check().catch(console.error);
