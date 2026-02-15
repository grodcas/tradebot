require('dotenv').config();
const fs = require("fs");
const OpenAI = require("openai");

// ----------------------------
// CONFIG
// ----------------------------
const RESULTS_PATH = "./trade_results.json";
const RULES_PATH = "./rules.json";
const RULES_HISTORY_PATH = "./rules_history.json";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// ANALYSIS HELPERS
// ----------------------------
function analyzeResults(results) {
  const validTrades = results.filter(r => !r.error && r.simResult);

  const stats = {
    total: validTrades.length,
    wins: validTrades.filter(r => r.simResult.outcome === "TP").length,
    losses: validTrades.filter(r => r.simResult.outcome === "SL").length,
    timeouts: validTrades.filter(r => r.simResult.outcome === "TIMEOUT").length,
    totalR: validTrades.reduce((sum, r) => sum + (r.R || 0), 0),
    avgR: 0,
    winRate: 0,
    avgWinR: 0,
    avgLossR: 0,
  };

  stats.avgR = stats.total ? stats.totalR / stats.total : 0;
  stats.winRate = stats.total ? stats.wins / stats.total : 0;

  const winTrades = validTrades.filter(r => r.simResult.outcome === "TP");
  const lossTrades = validTrades.filter(r => r.simResult.outcome === "SL");

  stats.avgWinR = winTrades.length ? winTrades.reduce((s, r) => s + r.R, 0) / winTrades.length : 0;
  stats.avgLossR = lossTrades.length ? lossTrades.reduce((s, r) => s + r.R, 0) / lossTrades.length : 0;

  // Categorize by rating
  const ratings = { GOOD: [], BAD: [], NEUTRAL: [] };
  for (const r of validTrades) {
    const rating = r.summary?.rating || "NEUTRAL";
    if (ratings[rating]) ratings[rating].push(r);
  }

  // Extract lessons from losing trades
  const losingLessons = lossTrades
    .filter(r => r.summary?.lessons)
    .map(r => r.summary.lessons);

  // Extract lessons from winning trades
  const winningLessons = winTrades
    .filter(r => r.summary?.lessons)
    .map(r => r.summary.lessons);

  return { stats, ratings, losingLessons, winningLessons, validTrades };
}

// ----------------------------
// LLM CALL FOR RULE EVOLUTION
// ----------------------------
async function evolveRules({ currentRules, analysis }) {
  const { stats, losingLessons, winningLessons, validTrades } = analysis;

  // Sample some trade summaries for context
  const sampleBad = validTrades
    .filter(r => r.simResult?.outcome === "SL")
    .slice(0, 5)
    .map(r => ({
      decision: r.decision,
      outcome: r.simResult.outcome,
      R: r.R,
      why: r.summary?.why_outcome,
      lessons: r.summary?.lessons,
    }));

  const sampleGood = validTrades
    .filter(r => r.simResult?.outcome === "TP")
    .slice(0, 5)
    .map(r => ({
      decision: r.decision,
      outcome: r.simResult.outcome,
      R: r.R,
      why: r.summary?.why_outcome,
      lessons: r.summary?.lessons,
    }));

  const system = `
You are an expert trading strategy optimizer. Your job is to analyze trading results
and improve the rulebook to increase profitability.

You understand:
- Risk/reward ratios
- Entry/exit timing
- Trend following vs mean reversion
- Volatility filters
- Session timing (Zurich hours 8-18)
- Position sizing based on confidence

Output valid JSON only.
`;

  const user = `
CURRENT RULES:
${JSON.stringify(currentRules, null, 2)}

PERFORMANCE STATS:
- Total trades: ${stats.total}
- Win rate: ${(stats.winRate * 100).toFixed(1)}%
- Wins: ${stats.wins}, Losses: ${stats.losses}, Timeouts: ${stats.timeouts}
- Average R per trade: ${stats.avgR.toFixed(3)}
- Average winning R: ${stats.avgWinR.toFixed(3)}
- Average losing R: ${stats.avgLossR.toFixed(3)}
- Total R: ${stats.totalR.toFixed(2)}

SAMPLE LOSING TRADES:
${JSON.stringify(sampleBad, null, 2)}

SAMPLE WINNING TRADES:
${JSON.stringify(sampleGood, null, 2)}

LESSONS FROM LOSSES:
${losingLessons.slice(0, 10).map((l, i) => `${i + 1}. ${l}`).join("\n")}

LESSONS FROM WINS:
${winningLessons.slice(0, 5).map((l, i) => `${i + 1}. ${l}`).join("\n")}

TASK:
Analyze the performance and create IMPROVED rules. Be specific and actionable.
Consider:
1. Are entries timed correctly? (trend confirmation, support/resistance)
2. Are TP/SL levels appropriate? (too tight = stopped out, too wide = bad R:R)
3. Should we filter out certain market conditions?
4. What patterns led to wins vs losses?

OUTPUT JSON:
{
  "analysis": "Brief analysis of what's working and what's not",
  "key_problems": ["problem1", "problem2", ...],
  "improvements": ["what you're changing and why", ...],
  "new_rules": {
    "rule1": "...",
    "rule2": "...",
    ...
  },
  "expected_impact": "What improvement you expect from these changes"
}
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty LLM response.");
  return JSON.parse(text);
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var.");

  // Load results
  if (!fs.existsSync(RESULTS_PATH)) {
    throw new Error(`Results file not found: ${RESULTS_PATH}. Run batch_trainer.js first.`);
  }
  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  console.log(`Loaded ${results.length} trade results`);

  // Load current rules
  const currentRules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  console.log("\n=== CURRENT RULES ===");
  console.log(JSON.stringify(currentRules, null, 2));

  // Analyze results
  const analysis = analyzeResults(results);

  console.log("\n=== PERFORMANCE ANALYSIS ===");
  console.log(`Total trades: ${analysis.stats.total}`);
  console.log(`Win rate: ${(analysis.stats.winRate * 100).toFixed(1)}%`);
  console.log(`Avg R: ${analysis.stats.avgR.toFixed(3)}`);
  console.log(`Total R: ${analysis.stats.totalR.toFixed(2)}`);

  // Call LLM to evolve rules
  console.log("\n=== EVOLVING RULES ===");
  const evolution = await evolveRules({ currentRules, analysis });

  console.log("\nAnalysis:", evolution.analysis);
  console.log("\nKey Problems:");
  evolution.key_problems?.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log("\nImprovements:");
  evolution.improvements?.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log("\nExpected Impact:", evolution.expected_impact);

  console.log("\n=== NEW RULES ===");
  console.log(JSON.stringify(evolution.new_rules, null, 2));

  // Save history
  let history = [];
  if (fs.existsSync(RULES_HISTORY_PATH)) {
    history = JSON.parse(fs.readFileSync(RULES_HISTORY_PATH, "utf8"));
  }
  history.push({
    timestamp: new Date().toISOString(),
    previousRules: currentRules,
    stats: analysis.stats,
    evolution: {
      analysis: evolution.analysis,
      key_problems: evolution.key_problems,
      improvements: evolution.improvements,
      expected_impact: evolution.expected_impact,
    },
    newRules: evolution.new_rules,
  });
  fs.writeFileSync(RULES_HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`\nHistory saved to ${RULES_HISTORY_PATH}`);

  // Update rules
  fs.writeFileSync(RULES_PATH, JSON.stringify(evolution.new_rules, null, 2));
  console.log(`Rules updated in ${RULES_PATH}`);

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Review the new rules above");
  console.log("2. Run batch_trainer.js again to test the new rules");
  console.log("3. Run rule_evolver.js again to continue improving");
  console.log("4. Repeat until satisfied with performance");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
