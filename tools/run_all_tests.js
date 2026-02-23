/**
 * Run all 4 tests and collect results
 *
 * Updated for new folder structure (Feb 2026)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require("fs");
const { execSync } = require("child_process");

const SRC_DIR = path.join(__dirname, '../src');
const MODELS_DIR = path.join(__dirname, '../models');
const DATA_DIR = path.join(__dirname, '../data');
const RESULTS_DIR = path.join(__dirname, '../results');

const results = {};

function parseResults(jsonPath) {
  const r = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const trades = r.filter(t => t.decision?.risk > 0);
  const wins = trades.filter(t => t.simResult?.outcome === 'TP');
  const losses = trades.filter(t => t.simResult?.outcome === 'SL');
  const timeouts = trades.filter(t => t.simResult?.outcome === 'TIMEOUT');
  const totalR = trades.reduce((s, t) => s + (t.weightedR || 0), 0);

  const longs = trades.filter(t => t.decision?.side === 'LONG');
  const shorts = trades.filter(t => t.decision?.side === 'SHORT');
  const longWins = longs.filter(t => t.simResult?.outcome === 'TP').length;
  const shortWins = shorts.filter(t => t.simResult?.outcome === 'TP').length;

  let maxStreak = 0, streak = 0;
  for (const t of trades) {
    if (t.simResult?.outcome === 'SL') { streak++; maxStreak = Math.max(maxStreak, streak); }
    else { streak = 0; }
  }

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: timeouts.length,
    winRate: (wins.length / trades.length * 100).toFixed(1),
    totalR: totalR.toFixed(2),
    maxStreak,
    longs: longs.length,
    shorts: shorts.length,
    longWR: longs.length > 0 ? (longWins / longs.length * 100).toFixed(0) : 0,
    shortWR: shorts.length > 0 ? (shortWins / shorts.length * 100).toFixed(0) : 0
  };
}

function setDataPath(dataFileName) {
  const batchTrainerPath = path.join(SRC_DIR, 'batch_trainer.js');
  let code = fs.readFileSync(batchTrainerPath, 'utf8');
  const dataPath = path.join(DATA_DIR, dataFileName).replace(/\\/g, '/');
  code = code.replace(/const DATA_PATH = .*?;/, `const DATA_PATH = "${dataPath}";`);
  fs.writeFileSync(batchTrainerPath, code);
}

function runTest(name, modelFolder, modelEnv, dataFile) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log(`Model: ${modelFolder} | Env: ${modelEnv || 'GPT-4'} | Data: ${dataFile}`);
  console.log('='.repeat(60));

  const agentsDir = path.join(SRC_DIR, 'agents');
  const modelDir = path.join(MODELS_DIR, modelFolder);

  // Copy model agents
  const files = ['direction_agent.js', 'confidence_agent.js', 'levels_agent.js', 'ai_client.js', 'orchestrator.js'];
  for (const f of files) {
    const src = path.join(modelDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(agentsDir, f));
    }
  }

  // Set data path
  setDataPath(dataFile);

  // Set model env
  if (modelEnv) {
    process.env.MODEL_VERSION = modelEnv;
  } else {
    delete process.env.MODEL_VERSION;
  }

  // Run batch trainer
  const batchTrainerPath = path.join(SRC_DIR, 'batch_trainer.js');
  try {
    const output = execSync(`node "${batchTrainerPath}"`, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 900000,
      env: process.env
    });

    // Show summary
    const summaryMatch = output.match(/=== BATCH SUMMARY ===([\s\S]*?)$/);
    if (summaryMatch) console.log(summaryMatch[0]);

    // Parse results
    const resultsPath = path.join(RESULTS_DIR, 'trade_results.json');
    const stats = parseResults(resultsPath);
    results[name] = stats;

    // Save individual results
    const outputPath = path.join(RESULTS_DIR, `test_${name.replace(/ /g, '_')}.json`);
    fs.copyFileSync(resultsPath, outputPath);

    console.log(`\nParsed: WR=${stats.winRate}% | R=${stats.totalR}R | MaxStreak=${stats.maxStreak}`);

  } catch (err) {
    console.error('ERROR:', err.message);
    results[name] = { error: err.message };
  }
}

// Backup current agents
console.log('Backing up current agents...');
const agentsDir = path.join(SRC_DIR, 'agents');
const backupDir = path.join(__dirname, '../archive/backup_run');
fs.mkdirSync(backupDir, { recursive: true });
for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.js'))) {
  fs.copyFileSync(path.join(agentsDir, f), path.join(backupDir, f));
}

// Run tests - update model folder names to match new naming convention
runTest('GPT4_Baseline_Recent', 'gpt4_baseline_20260221', '', 'eurusd_5m_recent.json');
runTest('GPT4_Baseline_Old', 'gpt4_baseline_20260221', '', 'eurusd_5m_old.json');
runTest('GPT5_Iter5_Recent', 'gpt5_iter5_20260221', 'gpt5', 'eurusd_5m_recent.json');
runTest('GPT5_Iter5_Old', 'gpt5_iter5_20260221', 'gpt5', 'eurusd_5m_old.json');

// Restore agents
console.log('\nRestoring original agents...');
for (const f of fs.readdirSync(backupDir).filter(f => f.endsWith('.js'))) {
  fs.copyFileSync(path.join(backupDir, f), path.join(agentsDir, f));
}
fs.rmSync(backupDir, { recursive: true });
setDataPath('eurusd_5m_old.json');

// Print final comparison
console.log('\n\n');
console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                              FINAL RESULTS COMPARISON                                 ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                       ║');
console.log('║  Test                    │ Trades │ Win Rate │ Total R │ Max Streak │ L/S WR        ║');
console.log('║──────────────────────────┼────────┼──────────┼─────────┼────────────┼───────────────║');

for (const [name, r] of Object.entries(results)) {
  if (r.error) {
    console.log(`║  ${name.padEnd(24)} │ ERROR: ${r.error.slice(0, 50).padEnd(57)} ║`);
  } else {
    const lswr = `${r.longWR}%/${r.shortWR}%`;
    const totalR = parseFloat(r.totalR) >= 0 ? `+${r.totalR}R` : `${r.totalR}R`;
    console.log(`║  ${name.padEnd(24)} │ ${String(r.trades).padEnd(6)} │ ${(r.winRate + '%').padEnd(8)} │ ${totalR.padEnd(7)} │ ${String(r.maxStreak).padEnd(10)} │ ${lswr.padEnd(13)} ║`);
  }
}

console.log('║                                                                                       ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                  AGGREGATED BY MODEL                                  ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');

// Aggregate GPT4
const gpt4 = Object.entries(results).filter(([k, v]) => k.startsWith('GPT4') && !v.error);
if (gpt4.length > 0) {
  const totalTrades = gpt4.reduce((s, [_, r]) => s + r.trades, 0);
  const totalWins = gpt4.reduce((s, [_, r]) => s + r.wins, 0);
  const totalR = gpt4.reduce((s, [_, r]) => s + parseFloat(r.totalR), 0);
  const maxStreak = Math.max(...gpt4.map(([_, r]) => r.maxStreak));
  console.log(`║  GPT-4 Baseline (combined):  ${totalTrades} trades | ${(totalWins/totalTrades*100).toFixed(1)}% WR | ${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R | Max Streak: ${maxStreak}`.padEnd(88) + '║');
}

// Aggregate GPT5
const gpt5 = Object.entries(results).filter(([k, v]) => k.startsWith('GPT5') && !v.error);
if (gpt5.length > 0) {
  const totalTrades = gpt5.reduce((s, [_, r]) => s + r.trades, 0);
  const totalWins = gpt5.reduce((s, [_, r]) => s + r.wins, 0);
  const totalR = gpt5.reduce((s, [_, r]) => s + parseFloat(r.totalR), 0);
  const maxStreak = Math.max(...gpt5.map(([_, r]) => r.maxStreak));
  console.log(`║  GPT-5 Iter5 (combined):     ${totalTrades} trades | ${(totalWins/totalTrades*100).toFixed(1)}% WR | ${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R | Max Streak: ${maxStreak}`.padEnd(88) + '║');
}

console.log('║                                                                                       ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');

// Save results
const allResultsPath = path.join(RESULTS_DIR, 'all_test_results.json');
fs.writeFileSync(allResultsPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to ${allResultsPath}`);
