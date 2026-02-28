#!/usr/bin/env node
/**
 * Diagnose: Why does the system WAIT so much?
 * The key: strategy_selector maps SKIP → WAIT, so every NEUTRAL/REJECT
 * causes a retry on the next 5m bar instead of immediately skipping.
 */
const fs = require('fs');
const path = require('path');

const results = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'trade_results.json'), 'utf8'));

console.log('=================================================================');
console.log('WAIT MECHANISM ANALYSIS — Iter10');
console.log('=================================================================\n');

// Calculate wait bars from anchor vs entry time
for (const r of results) {
  const anchorT = new Date(r.anchorTime).getTime();
  const entryT = new Date(r.entryTime).getTime();
  const waitMs = entryT - anchorT;
  const waitBars = Math.round(waitMs / (5 * 60 * 1000));
  r._waitBars = waitBars;
  r._waitMinutes = waitBars * 5;
  r._isExecuted = r.decision && r.decision.risk > 0;
}

// Summary
const withWaits = results.filter(r => r._waitBars > 0);
const noWaits = results.filter(r => r._waitBars === 0);
console.log(`Trades with zero waits: ${noWaits.length}`);
console.log(`Trades with 1+ waits: ${withWaits.length}`);
console.log(`Total wait bars across all trades: ${results.reduce((s, r) => s + r._waitBars, 0)}`);
console.log(`Average wait bars: ${(results.reduce((s, r) => s + r._waitBars, 0) / results.length).toFixed(1)}`);
console.log('');

// Distribution
const waitDist = {};
for (const r of results) {
  const key = r._waitBars;
  if (!waitDist[key]) waitDist[key] = { total: 0, executed: 0, wins: 0, losses: 0, skipped: 0 };
  waitDist[key].total++;
  if (r._isExecuted) {
    waitDist[key].executed++;
    if (r.simResult.outcome === 'TP') waitDist[key].wins++;
    else if (r.simResult.outcome === 'SL') waitDist[key].losses++;
  } else {
    waitDist[key].skipped++;
  }
}

console.log('=== WAIT COUNT DISTRIBUTION ===');
console.log('Waits | Count | Executed | Wins | Losses | Skipped | WR');
console.log('------|-------|----------|------|--------|---------|----');
for (const [waits, d] of Object.entries(waitDist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const wr = d.executed > 0 ? (d.wins / d.executed * 100).toFixed(0) + '%' : 'n/a';
  console.log(`  ${String(waits).padStart(3)}  |   ${String(d.total).padStart(2)}  |    ${String(d.executed).padStart(2)}    |  ${String(d.wins).padStart(2)}  |   ${String(d.losses).padStart(2)}   |    ${String(d.skipped).padStart(2)}   | ${wr}`);
}

// The core question: Do waits improve outcomes?
console.log('\n=== WAIT IMPACT ON OUTCOMES ===');
const immediateExec = results.filter(r => r._waitBars === 0 && r._isExecuted);
const waitedExec = results.filter(r => r._waitBars > 0 && r._isExecuted);
const immediateWins = immediateExec.filter(r => r.simResult.outcome === 'TP');
const waitedWins = waitedExec.filter(r => r.simResult.outcome === 'TP');

console.log(`Immediate trades (0 waits): ${immediateExec.length} executed, ${immediateWins.length} wins (${immediateExec.length ? (immediateWins.length/immediateExec.length*100).toFixed(0) : 'n/a'}% WR)`);
console.log(`Waited trades (1+ waits): ${waitedExec.length} executed, ${waitedWins.length} wins (${waitedExec.length ? (waitedWins.length/waitedExec.length*100).toFixed(0) : 'n/a'}% WR)`);

const immR = immediateExec.reduce((s, r) => s + r.rawR, 0);
const waitR = waitedExec.reduce((s, r) => s + r.rawR, 0);
console.log(`Immediate rawR: ${immR.toFixed(2)} | Waited rawR: ${waitR.toFixed(2)}`);

// Skipped after max waits vs immediately skipped
console.log('\n=== SKIPPED TRADES: IMMEDIATE vs AFTER WAITING ===');
const immediateSkips = results.filter(r => r._waitBars === 0 && !r._isExecuted);
const waitedSkips = results.filter(r => r._waitBars > 0 && !r._isExecuted);
console.log(`Skipped immediately (0 waits): ${immediateSkips.length}`);
console.log(`Skipped after waiting: ${waitedSkips.length}`);

// For skipped-after-waiting: would they have been better if taken at bar 0?
if (waitedSkips.length > 0) {
  console.log('\nSkipped after waiting (would original anchor have been better?):');
  for (const r of waitedSkips) {
    console.log(`  #${r.tradeNum}: waited ${r._waitMinutes}min, then skipped → sim shows ${r.simResult.outcome} (rawR=${r.rawR.toFixed(2)})`);
  }
}

// Each trade: full wait story
console.log('\n=== TRADE-BY-TRADE WAIT ANALYSIS ===');
console.log('#  | Waits | Min | Status   | Side  | Outcome | Regime    | Structure | Skip Reason');
console.log('---|-------|-----|----------|-------|---------|-----------|-----------|------------');
for (const r of results) {
  const status = r._isExecuted ? 'EXECUTED' : 'SKIPPED ';
  const side = r.decision ? r.decision.side : '?';
  const outcome = r.simResult ? r.simResult.outcome : '?';
  const regime = r.indicators ? r.indicators.marketRegime : '?';
  const structure = r.indicators ? r.indicators.structureLabel : '?';
  const reason = !r._isExecuted ? (r.decision.reasoning || '').slice(0, 60) : '';
  console.log(`${String(r.tradeNum).padStart(2)} |   ${String(r._waitBars).padStart(2)}  | ${String(r._waitMinutes).padStart(3)} | ${status} | ${(side||'?').padEnd(5)} | ${(outcome||'?').padEnd(7)} | ${(regime||'?').padEnd(9)} | ${(structure||'?').padEnd(9)} | ${reason}`);
}

// Cost analysis: how many API calls does waiting cost?
console.log('\n=== API CALL COST OF WAITING ===');
const totalWaitBars = results.reduce((s, r) => s + r._waitBars, 0);
// Each wait = 1 direction + 1 confidence call (2 API calls) except when direction says NEUTRAL (1 call)
// Best estimate: each wait is ~1.5 API calls on average (some hit direction only, some hit both)
const apiCallsForWaits = totalWaitBars * 1.5;
const apiCallsForFinal = results.length * 2; // direction + confidence for final decision
console.log(`Total wait bars: ${totalWaitBars}`);
console.log(`Estimated extra API calls from waiting: ~${apiCallsForWaits.toFixed(0)}`);
console.log(`API calls for final decisions: ~${apiCallsForFinal}`);
console.log(`Waiting adds ~${(apiCallsForWaits / apiCallsForFinal * 100).toFixed(0)}% more API calls`);

// The mechanism trace
console.log('\n=== THE MECHANISM ===');
console.log('strategy_selector.js line 115-125:');
console.log('  When orchestrator returns SKIP (direction=NEUTRAL or confidence=REJECT)');
console.log('  → strategy_selector maps SKIP to WAIT (action: "WAIT", risk: 0)');
console.log('  → batch_trainer retries on next 5m bar');
console.log('  → Up to MAX_WAIT_BARS=6 retries (30 minutes)');
console.log('');
console.log('The problem: SKIP and WAIT are conflated.');
console.log('  SKIP = "No clear direction, do not trade this scenario"');
console.log('  WAIT = "Direction exists but entry timing not ideal yet"');
console.log('  Currently: ALL skips become waits, burning API calls and shifting entry timing.');
