/**
 * COMPARE MODELS
 *
 * Tests two configurations:
 * 1. GPT-4 + Baseline (Prototype1) prompts
 * 2. GPT-5 + Iter4 prompts
 *
 * On both data files:
 * - eurusd_5m.json (recent: Nov 2025 - Feb 2026)
 * - eurusd_5m_old.json (old: Aug 2025 - Nov 2025)
 */

require('dotenv').config();
const fs = require("fs");
const { execSync } = require("child_process");

// Configuration
const SCENARIOS_PER_TEST = 30;

const TESTS = [
  {
    name: "GPT4_Baseline",
    agents: "saved_iterations/prototype1_eurusd",
    model: "", // default = GPT-4 (hardcoded in prototype1)
    description: "GPT-4 + Baseline prompts"
  },
  {
    name: "GPT5_Iter4",
    agents: "saved_iterations/gpt5_iter4_test",
    model: "gpt5",
    description: "GPT-5 + Iter4 prompts (EMA + tight stops)"
  }
];

const DATA_FILES = [
  { path: "eurusd_5m.json", label: "recent" },
  { path: "eurusd_5m_old.json", label: "old" }
];

// Backup current agents
console.log("Backing up current agents...");
if (!fs.existsSync("saved_iterations/backup_temp")) {
  fs.mkdirSync("saved_iterations/backup_temp", { recursive: true });
}
const agentBackupFiles = fs.readdirSync("agents").filter(f => f.endsWith(".js"));
for (const f of agentBackupFiles) {
  fs.copyFileSync(`agents/${f}`, `saved_iterations/backup_temp/${f}`);
}

const allResults = {};

async function runTest(test, dataFile) {
  const testKey = `${test.name}_${dataFile.label}`;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running: ${test.description} on ${dataFile.label} data`);
  console.log(`${"=".repeat(60)}`);

  // Copy agents
  console.log(`Copying agents from ${test.agents}...`);

  // Copy all agent files including ai_client.js and orchestrator if present
  const agentFiles = ["direction_agent.js", "confidence_agent.js", "levels_agent.js", "ai_client.js", "orchestrator.js"];
  for (const file of agentFiles) {
    const src = `${test.agents}/${file}`;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, `agents/${file}`);
    }
  }

  // Update batch_trainer DATA_PATH temporarily
  let batchCode = fs.readFileSync("batch_trainer.js", "utf8");
  const originalDataPath = batchCode.match(/const DATA_PATH = "(.+?)";/)[1];
  batchCode = batchCode.replace(
    /const DATA_PATH = ".+?";/,
    `const DATA_PATH = "./${dataFile.path}";`
  );
  fs.writeFileSync("batch_trainer.js", batchCode);

  // Run batch trainer
  // Set env var for model version
  if (test.model) {
    process.env.MODEL_VERSION = test.model;
  } else {
    delete process.env.MODEL_VERSION;
  }

  const cmd = `node batch_trainer.js`;
  console.log(`Running: ${cmd} (MODEL_VERSION=${test.model || "default/gpt4"})`);

  try {
    const output = execSync(cmd, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600000, // 10 min timeout
      env: { ...process.env }
    });

    // Parse results from output
    const summaryMatch = output.match(/=== BATCH SUMMARY ===([\s\S]*?)$/);
    if (summaryMatch) {
      console.log(summaryMatch[0]);
    }

    // Read trade_results.json
    const results = JSON.parse(fs.readFileSync("trade_results.json", "utf8"));

    // Calculate stats
    const trades = results.filter(t => t.risk > 0);
    const wins = trades.filter(t => t.outcome === "TP");
    const losses = trades.filter(t => t.outcome === "SL");
    const timeouts = trades.filter(t => t.outcome === "TIMEOUT");

    const totalR = trades.reduce((sum, t) => sum + (t.weightedR || 0), 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : 0;

    // Calculate losing streaks
    let maxStreak = 0;
    let currentStreak = 0;
    for (const t of trades) {
      if (t.outcome === "SL") {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    // Direction balance
    const longs = trades.filter(t => t.side === "LONG");
    const shorts = trades.filter(t => t.side === "SHORT");
    const longWR = longs.length > 0 ? (longs.filter(t => t.outcome === "TP").length / longs.length * 100).toFixed(0) : 0;
    const shortWR = shorts.length > 0 ? (shorts.filter(t => t.outcome === "TP").length / shorts.length * 100).toFixed(0) : 0;

    allResults[testKey] = {
      test: test.name,
      data: dataFile.label,
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      winRate: parseFloat(winRate),
      totalR: parseFloat(totalR.toFixed(2)),
      maxLosingStreak: maxStreak,
      longs: longs.length,
      shorts: shorts.length,
      longWR: parseFloat(longWR),
      shortWR: parseFloat(shortWR)
    };

    // Save individual results
    fs.copyFileSync("trade_results.json", `trade_results_${testKey}.json`);

  } catch (err) {
    console.error("Error running test:", err.message);
    allResults[testKey] = { error: err.message };
  }

  // Restore DATA_PATH
  batchCode = batchCode.replace(
    /const DATA_PATH = ".+?";/,
    `const DATA_PATH = "${originalDataPath}";`
  );
  fs.writeFileSync("batch_trainer.js", batchCode);
}

async function main() {
  // Run all tests
  for (const test of TESTS) {
    for (const dataFile of DATA_FILES) {
      await runTest(test, dataFile);
    }
  }

  // Restore original agents
  console.log("\nRestoring original agents...");
  const backupFiles = fs.readdirSync("saved_iterations/backup_temp").filter(f => f.endsWith(".js"));
  for (const f of backupFiles) {
    fs.copyFileSync(`saved_iterations/backup_temp/${f}`, `agents/${f}`);
  }
  fs.rmSync("saved_iterations/backup_temp", { recursive: true, force: true });

  // Print comparison
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                           FINAL COMPARISON                                      ║");
  console.log("╠════════════════════════════════════════════════════════════════════════════════╣");

  console.log("║                                                                                 ║");
  console.log("║  Configuration        │ Data   │ WinRate │ Total R │ MaxStrk │ L/S WR         ║");
  console.log("║───────────────────────┼────────┼─────────┼─────────┼─────────┼────────────────║");

  for (const key of Object.keys(allResults).sort()) {
    const r = allResults[key];
    if (r.error) {
      console.log(`║  ${r.test.padEnd(20)} │ ${r.data.padEnd(6)} │ ERROR: ${r.error.slice(0, 40)}`);
    } else {
      const lswr = `${r.longWR}%/${r.shortWR}%`;
      console.log(`║  ${r.test.padEnd(20)} │ ${r.data.padEnd(6)} │ ${(r.winRate + "%").padEnd(7)} │ ${(r.totalR >= 0 ? "+" : "") + r.totalR.toFixed(1) + "R".padEnd(6)} │ ${String(r.maxLosingStreak).padEnd(7)} │ ${lswr.padEnd(14)} ║`);
    }
  }

  console.log("║                                                                                 ║");
  console.log("╚════════════════════════════════════════════════════════════════════════════════╝");

  // Aggregate by model
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                    AGGREGATE (ALL DATA)                        ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");

  for (const test of TESTS) {
    const keys = Object.keys(allResults).filter(k => k.startsWith(test.name));
    const combined = keys.map(k => allResults[k]).filter(r => !r.error);

    if (combined.length > 0) {
      const totalTrades = combined.reduce((s, r) => s + r.trades, 0);
      const totalWins = combined.reduce((s, r) => s + r.wins, 0);
      const totalR = combined.reduce((s, r) => s + r.totalR, 0);
      const maxStreak = Math.max(...combined.map(r => r.maxLosingStreak));
      const avgWR = (totalWins / totalTrades * 100).toFixed(1);

      console.log(`║  ${test.name.padEnd(20)}                                      ║`);
      console.log(`║    Trades: ${totalTrades}  |  Win Rate: ${avgWR}%  |  Total R: ${totalR >= 0 ? "+" : ""}${totalR.toFixed(1)}R  |  Max Streak: ${maxStreak}  ║`);
      console.log("║                                                               ║");
    }
  }

  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Save all results
  fs.writeFileSync("comparison_results.json", JSON.stringify(allResults, null, 2));
  console.log("\nResults saved to comparison_results.json");
}

main().catch(console.error);
