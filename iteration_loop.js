require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// ----------------------------
// CONFIG
// ----------------------------
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8000;
const NUM_SCENARIOS = 50;  // Trades per iteration
const MAX_ITERATIONS = 50;  // Max improvement cycles (increased for long runs)
const STUCK_THRESHOLD = 5;  // Iterations without improvement before mutation
const MIN_IMPROVEMENT = 0.005;  // 0.5% improvement counts as progress

// Budget control (in EUR)
const COST_PER_BATCH_EUR = 0.055;  // GPT-4o-mini for 50 trades
const COST_PER_ANALYSIS_EUR = 0.12;  // Claude Sonnet for 3 agent improvements
const COST_PER_MUTATION_EUR = 0.25;  // Claude for creative mutation
const COST_PER_ITERATION_EUR = COST_PER_BATCH_EUR + COST_PER_ANALYSIS_EUR;

// Set your budget here (default €10 = ~5 hours)
const BUDGET_EUR = parseFloat(process.env.ITERATION_BUDGET_EUR || "10");

const RESULTS_PATH = './trade_results.json';
const ITERATION_LOG_PATH = './iteration_history.json';

const AGENT_PATHS = {
  direction: './agents/direction_agent.js',
  confidence: './agents/confidence_agent.js',
  levels: './agents/levels_agent.js'
};

// ----------------------------
// METRICS CALCULATOR
// ----------------------------
function calculateMetrics(trades) {
  const executed = trades.filter(t => t.simResult);
  const wins = executed.filter(t => t.simResult.outcome === 'TP');
  const losses = executed.filter(t => t.simResult.outcome === 'SL');

  // Overall stats
  const winRate = executed.length > 0 ? wins.length / executed.length : 0;
  const totalWeightedR = executed.reduce((sum, t) => sum + (t.weightedR || 0), 0);
  const avgWeightedR = executed.length > 0 ? totalWeightedR / executed.length : 0;

  // Direction metrics
  const longs = executed.filter(t => t.decision.side === 'LONG');
  const shorts = executed.filter(t => t.decision.side === 'SHORT');
  const longWins = longs.filter(t => t.simResult.outcome === 'TP').length;
  const shortWins = shorts.filter(t => t.simResult.outcome === 'TP').length;
  const longWR = longs.length > 0 ? longWins / longs.length : 0;
  const shortWR = shorts.length > 0 ? shortWins / shorts.length : 0;

  // Confidence/Risk metrics - correlation between risk and outcome
  const winRisks = wins.map(t => t.decision.risk);
  const lossRisks = losses.map(t => t.decision.risk);
  const avgWinRisk = winRisks.length > 0 ? winRisks.reduce((a, b) => a + b, 0) / winRisks.length : 0;
  const avgLossRisk = lossRisks.length > 0 ? lossRisks.reduce((a, b) => a + b, 0) / lossRisks.length : 0;
  const riskDifferentiation = avgWinRisk - avgLossRisk;  // Positive = good (higher risk on wins)

  // Risk distribution
  const highRiskTrades = executed.filter(t => t.decision.risk >= 0.7);
  const medRiskTrades = executed.filter(t => t.decision.risk >= 0.5 && t.decision.risk < 0.7);
  const lowRiskTrades = executed.filter(t => t.decision.risk < 0.5);
  const highRiskWR = highRiskTrades.length > 0
    ? highRiskTrades.filter(t => t.simResult.outcome === 'TP').length / highRiskTrades.length : 0;
  const medRiskWR = medRiskTrades.length > 0
    ? medRiskTrades.filter(t => t.simResult.outcome === 'TP').length / medRiskTrades.length : 0;
  const lowRiskWR = lowRiskTrades.length > 0
    ? lowRiskTrades.filter(t => t.simResult.outcome === 'TP').length / lowRiskTrades.length : 0;

  // Levels metrics - R-multiple analysis
  const winRs = wins.map(t => t.rawR);
  const avgWinR = winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : 0;
  const bigWins = wins.filter(t => t.rawR >= 2).length;
  const smallWins = wins.filter(t => t.rawR < 1).length;

  // Profit factor
  const grossProfit = wins.reduce((sum, t) => sum + (t.weightedR || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.weightedR || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Bars to exit
  const avgBarsToExit = executed.length > 0
    ? executed.reduce((sum, t) => sum + (t.simResult.barsToExit || 0), 0) / executed.length : 0;

  return {
    // Overall
    totalTrades: executed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalWeightedR,
    avgWeightedR,
    profitFactor,
    avgBarsToExit,

    // Direction
    longCount: longs.length,
    shortCount: shorts.length,
    longWR,
    shortWR,
    directionBias: shorts.length > 0 ? longs.length / shorts.length : 0,

    // Confidence/Risk
    avgWinRisk,
    avgLossRisk,
    riskDifferentiation,
    highRiskCount: highRiskTrades.length,
    highRiskWR,
    medRiskCount: medRiskTrades.length,
    medRiskWR,
    lowRiskCount: lowRiskTrades.length,
    lowRiskWR,

    // Levels
    avgWinR,
    bigWins,
    smallWins,
    bigWinRatio: wins.length > 0 ? bigWins / wins.length : 0
  };
}

function analyzeFailedTrades(trades) {
  const executed = trades.filter(t => t.simResult);
  const losses = executed.filter(t => t.simResult.outcome === 'SL');

  // Categorize failures
  const failures = {
    quickLosses: [],      // Lost in < 5 bars
    longLosses: [],       // Lost after 30+ bars (could have exited)
    badDirection: [],     // Lost with high confidence
    goodCalls: []         // Low confidence losses (expected)
  };

  for (const trade of losses) {
    const bars = trade.simResult.barsToExit;
    const risk = trade.decision.risk;
    const summary = trade.summary || {};

    if (bars < 5) {
      failures.quickLosses.push({
        tradeNum: trade.tradeNum,
        side: trade.decision.side,
        risk,
        bars,
        indicators: trade.indicators,
        reasoning: trade.decision.reasoning,
        lesson: summary.lessons
      });
    } else if (bars > 30) {
      failures.longLosses.push({
        tradeNum: trade.tradeNum,
        side: trade.decision.side,
        risk,
        bars,
        maxFavorable: trade.simResult.maxFavorable,
        reasoning: trade.decision.reasoning,
        lesson: summary.lessons
      });
    }

    if (risk >= 0.6) {
      failures.badDirection.push({
        tradeNum: trade.tradeNum,
        side: trade.decision.side,
        risk,
        indicators: trade.indicators,
        reasoning: trade.decision.reasoning,
        lesson: summary.lessons
      });
    } else if (risk < 0.5) {
      failures.goodCalls.push({
        tradeNum: trade.tradeNum,
        side: trade.decision.side,
        risk
      });
    }
  }

  return failures;
}

function formatMetricsReport(metrics, failures) {
  return `
## METRICS SUMMARY

### Overall Performance
- Total Trades: ${metrics.totalTrades}
- Win Rate: ${(metrics.winRate * 100).toFixed(1)}%
- Profit Factor: ${metrics.profitFactor.toFixed(2)}
- Total Weighted R: ${metrics.totalWeightedR.toFixed(2)}
- Avg R per Trade: ${metrics.avgWeightedR.toFixed(3)}

### Direction Agent Performance
- LONG: ${metrics.longCount} trades, ${(metrics.longWR * 100).toFixed(1)}% WR
- SHORT: ${metrics.shortCount} trades, ${(metrics.shortWR * 100).toFixed(1)}% WR
- Direction Bias (L/S ratio): ${metrics.directionBias.toFixed(2)}

### Confidence Agent Performance (CRITICAL)
- Avg Risk on WINS: ${metrics.avgWinRisk.toFixed(3)}
- Avg Risk on LOSSES: ${metrics.avgLossRisk.toFixed(3)}
- Risk Differentiation: ${metrics.riskDifferentiation.toFixed(3)} (positive = good, target > 0.15)
- High Risk (0.7+): ${metrics.highRiskCount} trades, ${(metrics.highRiskWR * 100).toFixed(1)}% WR
- Med Risk (0.5-0.7): ${metrics.medRiskCount} trades, ${(metrics.medRiskWR * 100).toFixed(1)}% WR
- Low Risk (<0.5): ${metrics.lowRiskCount} trades, ${(metrics.lowRiskWR * 100).toFixed(1)}% WR

### Levels Agent Performance
- Avg Win R-Multiple: ${metrics.avgWinR.toFixed(2)}
- Big Wins (2R+): ${metrics.bigWins} (${(metrics.bigWinRatio * 100).toFixed(0)}% of wins)
- Small Wins (<1R): ${metrics.smallWins}
- Avg Bars to Exit: ${metrics.avgBarsToExit.toFixed(0)}

## FAILURE ANALYSIS

### Quick Losses (< 5 bars) - Direction/Entry Timing Issue
${failures.quickLosses.length} trades
${failures.quickLosses.slice(0, 3).map(t =>
  `- Trade ${t.tradeNum}: ${t.side}, risk ${t.risk.toFixed(2)}, ${t.bars} bars. ${t.lesson || ''}`
).join('\n')}

### Long Losses (30+ bars) - Should Have Exited Earlier
${failures.longLosses.length} trades
${failures.longLosses.slice(0, 3).map(t =>
  `- Trade ${t.tradeNum}: ${t.side}, risk ${t.risk.toFixed(2)}, ${t.bars} bars, max favorable: ${t.maxFavorable?.toFixed(5) || 'N/A'}`
).join('\n')}

### High Confidence Losses - Confidence Miscalibration
${failures.badDirection.length} trades with risk >= 0.6 that lost
${failures.badDirection.slice(0, 3).map(t =>
  `- Trade ${t.tradeNum}: ${t.side}, risk ${t.risk.toFixed(2)}. ${t.lesson || ''}`
).join('\n')}

### Low Confidence Losses - Expected (Good Calibration)
${failures.goodCalls.length} trades with risk < 0.5 that lost (this is OK)
`;
}

// ----------------------------
// RUN BATCH TRAINER
// ----------------------------
function runBatchTrainer(numScenarios) {
  console.log(`\nRunning batch trainer with ${numScenarios} scenarios...`);

  // Update NUM_SCENARIOS in batch_trainer.js temporarily
  let batchCode = fs.readFileSync('./batch_trainer.js', 'utf8');
  const originalNumScenarios = batchCode.match(/const NUM_SCENARIOS = (\d+);/)?.[1];
  batchCode = batchCode.replace(/const NUM_SCENARIOS = \d+;/, `const NUM_SCENARIOS = ${numScenarios};`);
  fs.writeFileSync('./batch_trainer.js', batchCode);

  try {
    execSync('node batch_trainer.js', {
      stdio: 'inherit',
      timeout: 600000  // 10 min timeout
    });
  } finally {
    // Restore original
    if (originalNumScenarios) {
      batchCode = batchCode.replace(/const NUM_SCENARIOS = \d+;/, `const NUM_SCENARIOS = ${originalNumScenarios};`);
      fs.writeFileSync('./batch_trainer.js', batchCode);
    }
  }

  // Load results
  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  return results;
}

// ----------------------------
// PROMPT IMPROVER
// ----------------------------
async function improveAgent(anthropic, agentName, agentPath, metrics, failures, trades) {
  const agentCode = fs.readFileSync(agentPath, 'utf8');

  // Extract the prompt from the agent code (DIRECTION_PROMPT, CONFIDENCE_PROMPT, LEVELS_PROMPT)
  const promptVarName = agentName.toUpperCase() + '_PROMPT';
  const promptRegex = new RegExp(`const ${promptVarName} = \`([\\s\\S]*?)\`;`);
  const promptMatch = agentCode.match(promptRegex);
  const userPromptMatch = agentCode.match(/content: `([\s\S]*?)`,?\s*\}/);

  if (!promptMatch) {
    console.log(`Could not extract prompt from ${agentName}`);
    return null;
  }

  const currentPrompt = promptMatch[1];

  // Get sample trades for context
  const sampleWins = trades.filter(t => t.simResult?.outcome === 'TP').slice(0, 3);
  const sampleLosses = trades.filter(t => t.simResult?.outcome === 'SL').slice(0, 3);

  let agentSpecificAnalysis = '';
  let improvementFocus = '';

  if (agentName === 'direction') {
    improvementFocus = `
DIRECTION AGENT FOCUS:
- Current LONG WR: ${(metrics.longWR * 100).toFixed(1)}%
- Current SHORT WR: ${(metrics.shortWR * 100).toFixed(1)}%
- Quick losses (bad direction): ${failures.quickLosses.length}

Your goal: Improve win rate by being more selective about direction.
- If LONG WR < SHORT WR, add stricter criteria for LONG entries
- If quick losses are common, add momentum confirmation requirements
- Look at the indicators that led to failed trades`;

    agentSpecificAnalysis = failures.quickLosses.slice(0, 5).map(t =>
      `Trade ${t.tradeNum} (${t.side}): Lost in ${t.bars} bars. Indicators: regime=${t.indicators?.marketRegime}, structure=${t.indicators?.structureLabel}`
    ).join('\n');

  } else if (agentName === 'confidence') {
    improvementFocus = `
CONFIDENCE AGENT FOCUS:
- Avg Risk on WINS: ${metrics.avgWinRisk.toFixed(3)}
- Avg Risk on LOSSES: ${metrics.avgLossRisk.toFixed(3)}
- Risk Differentiation: ${metrics.riskDifferentiation.toFixed(3)}
- Target: Risk differentiation > 0.15 (wins should have higher risk than losses)

Your goal: Better calibrate confidence so high-confidence trades win more.
- High risk (0.7+) should have 70%+ win rate
- Low risk (<0.5) can have lower win rate (expected)
- Currently high risk WR: ${(metrics.highRiskWR * 100).toFixed(1)}%

The agent is NOT differentiating well. It gives similar risk to both winners and losers.
Add clearer criteria for what makes a HIGH confidence vs LOW confidence setup.`;

    agentSpecificAnalysis = failures.badDirection.slice(0, 5).map(t =>
      `Trade ${t.tradeNum} (${t.side}): Risk ${t.risk.toFixed(2)} but LOST. Why was confidence high? Indicators: regime=${t.indicators?.marketRegime}`
    ).join('\n');

  } else if (agentName === 'levels') {
    improvementFocus = `
LEVELS AGENT FOCUS:
- Avg Win R-Multiple: ${metrics.avgWinR.toFixed(2)}
- Big Wins (2R+): ${metrics.bigWins} (${(metrics.bigWinRatio * 100).toFixed(0)}% of wins)
- Long losses (30+ bars): ${failures.longLosses.length}

Your goal: Set TP/SL levels that maximize R-multiple while maintaining win rate.
- If too many small wins (<1R), targets may be too tight
- If too many long losses, SL may be too wide
- Sweet spot is 1.5-2.5R wins`;

    agentSpecificAnalysis = failures.longLosses.slice(0, 5).map(t =>
      `Trade ${t.tradeNum} (${t.side}): Lost after ${t.bars} bars, max favorable: ${t.maxFavorable?.toFixed(5)}. Could have taken profit earlier?`
    ).join('\n');
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{
      role: "user",
      content: `You are improving a trading agent's prompt. Your goal is to make MINIMAL, TARGETED changes that address specific issues.

## CURRENT ${agentName.toUpperCase()} AGENT PROMPT:
\`\`\`
${currentPrompt}
\`\`\`

## PERFORMANCE METRICS:
${formatMetricsReport(metrics, failures)}

${improvementFocus}

## SPECIFIC FAILURES TO ADDRESS:
${agentSpecificAnalysis}

## SAMPLE WINNING TRADES:
${JSON.stringify(sampleWins.map(t => ({
  side: t.decision.side,
  risk: t.decision.risk,
  rawR: t.rawR,
  regime: t.indicators?.marketRegime,
  structure: t.indicators?.structureLabel,
  reasoning: t.decision.reasoning?.slice(0, 100)
})), null, 2)}

## SAMPLE LOSING TRADES:
${JSON.stringify(sampleLosses.map(t => ({
  side: t.decision.side,
  risk: t.decision.risk,
  bars: t.simResult?.barsToExit,
  regime: t.indicators?.marketRegime,
  structure: t.indicators?.structureLabel,
  reasoning: t.decision.reasoning?.slice(0, 100)
})), null, 2)}

## INSTRUCTIONS:
1. Analyze WHY the losing trades failed based on the patterns
2. Identify 1-3 specific improvements to the prompt
3. Make MINIMAL changes - do not rewrite the whole prompt
4. Focus on the specific metrics that need improvement
5. Add concrete rules, not vague suggestions

Return your response in this exact JSON format:
{
  "analysis": "Brief analysis of what's wrong (2-3 sentences)",
  "changes": [
    "Change 1: description",
    "Change 2: description"
  ],
  "improved_prompt": "The full improved prompt text"
}

Return ONLY the JSON, no other text.`
    }]
  });

  try {
    const content = response.content[0].text;
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to parse ${agentName} improvement:`, err.message);
    console.log('Raw response:', response.content[0].text.slice(0, 500));
    return null;
  }
}

function applyPromptChange(agentPath, agentName, newPrompt) {
  let code = fs.readFileSync(agentPath, 'utf8');

  // Replace the agent-specific prompt (DIRECTION_PROMPT, CONFIDENCE_PROMPT, LEVELS_PROMPT)
  const promptVarName = agentName.toUpperCase() + '_PROMPT';
  const promptRegex = new RegExp(`const ${promptVarName} = \`[\\s\\S]*?\`;`);

  code = code.replace(
    promptRegex,
    `const ${promptVarName} = \`${newPrompt}\`;`
  );

  fs.writeFileSync(agentPath, code);
}

// ----------------------------
// MUTATION - CREATIVE BREAKTHROUGH
// ----------------------------
async function performMutation(anthropic, history, currentMetrics, trades) {
  console.log('\n' + '!'.repeat(60));
  console.log('MUTATION PHASE - Creative breakthrough needed');
  console.log('!'.repeat(60));

  // Gather context about what's been tried
  const recentIterations = history.iterations.slice(-10);
  const triedChanges = recentIterations.flatMap(i =>
    Object.values(i.improvements || {}).flatMap(imp => imp.changes || [])
  );

  // Read current indicator file
  let indicatorCode = '';
  try {
    indicatorCode = fs.readFileSync('./trade_indicators.js', 'utf8');
  } catch (e) {
    console.log('Could not read trade_indicators.js');
  }

  // Analyze persistent problems
  const persistentProblems = analyzePersistentProblems(recentIterations);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 12000,
    messages: [{
      role: "user",
      content: `You are a senior quant strategist. The trading system has hit a plateau and needs a CREATIVE BREAKTHROUGH.

## SITUATION
We've been optimizing prompts for ${history.iterations.length} iterations but progress has stalled.
The system is stuck and incremental changes aren't working.

## CURRENT PERFORMANCE (Stuck at)
- Win Rate: ${(currentMetrics.winRate * 100).toFixed(1)}%
- Profit Factor: ${currentMetrics.profitFactor.toFixed(2)}
- Risk Differentiation: ${currentMetrics.riskDifferentiation.toFixed(3)}
- LONG WR: ${(currentMetrics.longWR * 100).toFixed(1)}%
- SHORT WR: ${(currentMetrics.shortWR * 100).toFixed(1)}%

## PERSISTENT PROBLEMS
${persistentProblems}

## CHANGES ALREADY TRIED (didn't break plateau)
${triedChanges.slice(-15).map(c => `- ${c}`).join('\n')}

## CURRENT INDICATORS AVAILABLE
\`\`\`javascript
${indicatorCode.slice(0, 3000)}
\`\`\`

## SAMPLE LOSING TRADES (patterns we can't fix)
${JSON.stringify(trades.filter(t => t.simResult?.outcome === 'SL').slice(0, 5).map(t => ({
  side: t.decision.side,
  risk: t.decision.risk,
  regime: t.indicators?.marketRegime,
  structure: t.indicators?.structureLabel,
  barsToExit: t.simResult?.barsToExit,
  reasoning: t.decision.reasoning?.slice(0, 150)
})), null, 2)}

## YOUR TASK: THINK BIG

The problem is no longer optimization - it's MACRO. We need:
1. NEW INFORMATION (new indicators)
2. DIFFERENT PERSPECTIVE (new strategy angle)
3. STRUCTURAL CHANGE (different approach entirely)

Consider:
- Are we missing a key indicator? (volume, momentum oscillators, volatility regime)
- Is our market structure read fundamentally flawed?
- Should we add time-based filters? (session, day of week)
- Do we need multi-timeframe confirmation?
- Is there a market condition we should AVOID entirely?

## OUTPUT FORMAT

Return JSON with your creative mutation:
{
  "diagnosis": "What's fundamentally wrong (2-3 sentences)",
  "breakthrough_idea": "The big-picture change needed",
  "mutation_type": "NEW_INDICATOR" | "NEW_FILTER" | "STRATEGY_SHIFT" | "AVOID_CONDITION",
  "implementation": {
    "description": "What to implement",
    "code_changes": "If adding indicator, provide the JavaScript code",
    "prompt_changes": {
      "direction": "Changes to direction agent prompt (or null)",
      "confidence": "Changes to confidence agent prompt (or null)",
      "levels": "Changes to levels agent prompt (or null)"
    }
  },
  "expected_impact": "What improvement this should bring",
  "risk": "What could go wrong"
}

Be BOLD but SPECIFIC. We need a real breakthrough, not another tweak.`
    }]
  });

  try {
    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to parse mutation response:', err.message);
    return null;
  }
}

function analyzePersistentProblems(recentIterations) {
  const problems = [];

  // Check if LONG consistently underperforms
  const longWRs = recentIterations.map(i => i.metrics?.longWR || 0);
  const avgLongWR = longWRs.reduce((a, b) => a + b, 0) / longWRs.length;
  if (avgLongWR < 0.55) {
    problems.push(`LONG trades consistently underperform (avg ${(avgLongWR * 100).toFixed(1)}% WR)`);
  }

  // Check if risk differentiation is stuck near zero
  const riskDiffs = recentIterations.map(i => i.metrics?.riskDifferentiation || 0);
  const avgRiskDiff = riskDiffs.reduce((a, b) => a + b, 0) / riskDiffs.length;
  if (Math.abs(avgRiskDiff) < 0.05) {
    problems.push(`Confidence agent not differentiating (avg risk diff: ${avgRiskDiff.toFixed(3)})`);
  }

  // Check if win rate is stuck
  const winRates = recentIterations.map(i => i.metrics?.winRate || 0);
  const wrVariance = Math.max(...winRates) - Math.min(...winRates);
  if (wrVariance < 0.03) {
    problems.push(`Win rate stuck in narrow band (${(Math.min(...winRates) * 100).toFixed(1)}-${(Math.max(...winRates) * 100).toFixed(1)}%)`);
  }

  // Check if profit factor plateaued
  const pfs = recentIterations.map(i => i.metrics?.profitFactor || 0);
  const pfTrend = pfs[pfs.length - 1] - pfs[0];
  if (Math.abs(pfTrend) < 0.2) {
    problems.push(`Profit factor not improving (${pfs[0]?.toFixed(2)} → ${pfs[pfs.length - 1]?.toFixed(2)})`);
  }

  return problems.length > 0 ? problems.join('\n') : 'No specific persistent problems identified';
}

async function applyMutation(mutation, anthropic) {
  console.log(`\nMutation Type: ${mutation.mutation_type}`);
  console.log(`Diagnosis: ${mutation.diagnosis}`);
  console.log(`Breakthrough: ${mutation.breakthrough_idea}`);

  // Apply code changes if any
  if (mutation.implementation?.code_changes && mutation.mutation_type === 'NEW_INDICATOR') {
    console.log('\nAdding new indicator code...');
    // Append to trade_indicators.js
    const indicatorPath = './trade_indicators.js';
    let code = fs.readFileSync(indicatorPath, 'utf8');

    // Find the exports section and add before it
    const newCode = `\n// === MUTATION: ${mutation.breakthrough_idea} ===\n${mutation.implementation.code_changes}\n`;

    if (code.includes('module.exports')) {
      code = code.replace('module.exports', newCode + '\nmodule.exports');
    } else {
      code += newCode;
    }

    fs.writeFileSync(indicatorPath, code);
    console.log('  Added new indicator code');
  }

  // Apply prompt changes
  const promptChanges = mutation.implementation?.prompt_changes || {};

  for (const [agentName, change] of Object.entries(promptChanges)) {
    if (change && change !== 'null' && change.trim()) {
      const agentPath = AGENT_PATHS[agentName];
      if (agentPath) {
        console.log(`\nApplying mutation to ${agentName} agent...`);

        // Read current prompt and ask Claude to integrate the change
        const agentCode = fs.readFileSync(agentPath, 'utf8');
        const promptVarName = agentName.toUpperCase() + '_PROMPT';
        const promptRegex = new RegExp(`const ${promptVarName} = \`([\\s\\S]*?)\`;`);
        const promptMatch = agentCode.match(promptRegex);

        if (promptMatch) {
          const currentPrompt = promptMatch[1];

          const integrationResponse = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 6000,
            messages: [{
              role: "user",
              content: `Integrate this change into the trading agent prompt.

CURRENT PROMPT:
\`\`\`
${currentPrompt}
\`\`\`

CHANGE TO INTEGRATE:
${change}

Return ONLY the new complete prompt text, no explanation or markdown.`
            }]
          });

          const newPrompt = integrationResponse.content[0].text.trim();
          applyPromptChange(agentPath, agentName, newPrompt);
          console.log(`  Applied mutation to ${agentName}`);
        }
      }
    }
  }

  return true;
}

// ----------------------------
// ITERATION HISTORY
// ----------------------------
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(ITERATION_LOG_PATH, 'utf8'));
  } catch {
    return {
      iterations: [],
      bestMetrics: null,
      bestIteration: 0
    };
  }
}

function saveHistory(history) {
  fs.writeFileSync(ITERATION_LOG_PATH, JSON.stringify(history, null, 2));
}

// ----------------------------
// MAIN LOOP
// ----------------------------
async function runIterationLoop() {
  const anthropic = new Anthropic();
  const history = loadHistory();

  // Initialize cost tracking
  if (!history.totalCostEur) history.totalCostEur = 0;
  if (!history.mutations) history.mutations = [];
  let iterationsWithoutImprovement = 0;

  console.log('\n' + '='.repeat(60));
  console.log('AUTOMATED ITERATION LOOP');
  console.log('='.repeat(60));
  console.log(`Budget: €${BUDGET_EUR.toFixed(2)} | Spent so far: €${history.totalCostEur.toFixed(2)}`);
  console.log(`Starting from iteration ${history.iterations.length + 1}`);
  console.log(`Mutations so far: ${history.mutations.length}`);
  if (history.bestMetrics) {
    console.log(`Best so far: ${(history.bestMetrics.winRate * 100).toFixed(1)}% WR, PF ${history.bestMetrics.profitFactor.toFixed(2)}`);
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const iterNum = history.iterations.length + 1;

    // Check budget
    if (history.totalCostEur >= BUDGET_EUR) {
      console.log(`\n>>> BUDGET EXHAUSTED (€${history.totalCostEur.toFixed(2)} / €${BUDGET_EUR.toFixed(2)}) <<<`);
      break;
    }

    const remainingBudget = BUDGET_EUR - history.totalCostEur;
    console.log('\n' + '='.repeat(60));
    console.log(`ITERATION ${iterNum} | Budget remaining: €${remainingBudget.toFixed(2)}`);
    console.log('='.repeat(60));

    // Step 1: Run batch trainer
    const results = runBatchTrainer(NUM_SCENARIOS);
    const trades = results;
    history.totalCostEur += COST_PER_BATCH_EUR;

    // Step 2: Calculate metrics
    const metrics = calculateMetrics(trades);
    const failures = analyzeFailedTrades(trades);

    console.log('\n--- Metrics ---');
    console.log(`Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
    console.log(`Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
    console.log(`Total R: ${metrics.totalWeightedR.toFixed(2)}`);
    console.log(`LONG WR: ${(metrics.longWR * 100).toFixed(1)}% | SHORT WR: ${(metrics.shortWR * 100).toFixed(1)}%`);
    console.log(`Risk Diff: ${metrics.riskDifferentiation.toFixed(3)} (target: >0.15)`);

    // Check for improvement (more nuanced)
    const prevBest = history.bestMetrics;
    let dominated = false;  // New best in ALL key metrics
    let improved = false;   // Better in at least one key metric

    if (!prevBest) {
      improved = true;
      dominated = true;
    } else {
      const wrImproved = metrics.winRate > prevBest.winRate + MIN_IMPROVEMENT;
      const pfImproved = metrics.profitFactor > prevBest.profitFactor * (1 + MIN_IMPROVEMENT);
      const riskDiffImproved = metrics.riskDifferentiation > prevBest.riskDifferentiation + 0.02;

      improved = wrImproved || pfImproved || riskDiffImproved;
      dominated = wrImproved && pfImproved;

      // Check for new best (composite score)
      const currentScore = metrics.winRate * 0.4 + Math.min(metrics.profitFactor / 5, 1) * 0.4 + metrics.riskDifferentiation * 0.2;
      const bestScore = prevBest.winRate * 0.4 + Math.min(prevBest.profitFactor / 5, 1) * 0.4 + (prevBest.riskDifferentiation || 0) * 0.2;

      if (currentScore > bestScore + 0.01) {
        history.bestMetrics = metrics;
        history.bestIteration = iterNum;
        console.log('>>> NEW BEST! <<<');
      }
    }

    if (improved) {
      iterationsWithoutImprovement = 0;
      console.log('  [Improvement detected]');
    } else {
      iterationsWithoutImprovement++;
      console.log(`  [No improvement: ${iterationsWithoutImprovement}/${STUCK_THRESHOLD} until mutation]`);
    }

    // Step 3: Check if stuck - trigger mutation
    let mutationPerformed = false;
    if (iterationsWithoutImprovement >= STUCK_THRESHOLD && remainingBudget > COST_PER_MUTATION_EUR) {
      console.log('\n>>> STUCK DETECTED - Triggering mutation <<<');

      const mutation = await performMutation(anthropic, history, metrics, trades);
      history.totalCostEur += COST_PER_MUTATION_EUR;

      if (mutation) {
        await applyMutation(mutation, anthropic);
        history.mutations.push({
          iteration: iterNum,
          timestamp: new Date().toISOString(),
          type: mutation.mutation_type,
          diagnosis: mutation.diagnosis,
          breakthrough: mutation.breakthrough_idea,
          expectedImpact: mutation.expected_impact
        });
        mutationPerformed = true;
        iterationsWithoutImprovement = 0;  // Reset counter after mutation
        console.log('\n  Mutation applied. Resetting improvement counter.');
      }
    }

    // Step 4: Normal agent improvements (skip if mutation was performed)
    const improvements = {};
    if (!mutationPerformed) {
      for (const [agentName, agentPath] of Object.entries(AGENT_PATHS)) {
        console.log(`\nImproving ${agentName} agent...`);

        const improvement = await improveAgent(
          anthropic,
          agentName,
          agentPath,
          metrics,
          failures,
          trades
        );

        if (improvement) {
          improvements[agentName] = {
            analysis: improvement.analysis,
            changes: improvement.changes
          };

          applyPromptChange(agentPath, agentName, improvement.improved_prompt);
          console.log(`  Analysis: ${improvement.analysis}`);
          console.log(`  Changes: ${improvement.changes.join(', ')}`);
        }
      }
      history.totalCostEur += COST_PER_ANALYSIS_EUR;
    }

    // Step 5: Log iteration
    history.iterations.push({
      iteration: iterNum,
      timestamp: new Date().toISOString(),
      costEur: mutationPerformed ? COST_PER_BATCH_EUR + COST_PER_MUTATION_EUR : COST_PER_ITERATION_EUR,
      metrics: {
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        totalWeightedR: metrics.totalWeightedR,
        riskDifferentiation: metrics.riskDifferentiation,
        longWR: metrics.longWR,
        shortWR: metrics.shortWR
      },
      improvements,
      improved,
      mutationPerformed
    });

    saveHistory(history);

    // Step 6: Check stopping conditions
    // Excellent performance achieved
    if (metrics.winRate > 0.70 && metrics.profitFactor > 3.0 && metrics.riskDifferentiation > 0.15) {
      console.log('\n>>> EXCELLENT PERFORMANCE ACHIEVED! <<<');
      console.log(`WR ${(metrics.winRate * 100).toFixed(1)}% | PF ${metrics.profitFactor.toFixed(2)} | Risk Diff ${metrics.riskDifferentiation.toFixed(3)}`);
      break;
    }

    // Good performance + no improvement after multiple mutations
    if (history.mutations.length >= 3 && iterationsWithoutImprovement >= STUCK_THRESHOLD) {
      if (metrics.winRate > 0.60 && metrics.profitFactor > 2.0) {
        console.log('\n>>> CONVERGENCE: Multiple mutations attempted, performance is good <<<');
        console.log('System appears to have reached its potential with current architecture.');
        break;
      }
    }

    // Cost status
    console.log(`\n  Cost this iteration: €${(mutationPerformed ? COST_PER_BATCH_EUR + COST_PER_MUTATION_EUR : COST_PER_ITERATION_EUR).toFixed(3)}`);
    console.log(`  Total spent: €${history.totalCostEur.toFixed(2)} / €${BUDGET_EUR.toFixed(2)}`);

    // Brief pause
    console.log('\nWaiting 3 seconds before next iteration...');
    await new Promise(r => setTimeout(r, 3000));
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('ITERATION LOOP COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total iterations: ${history.iterations.length}`);
  console.log(`Total mutations: ${history.mutations.length}`);
  console.log(`Total cost: €${history.totalCostEur.toFixed(2)}`);
  console.log(`Best iteration: ${history.bestIteration}`);
  if (history.bestMetrics) {
    console.log(`Best Win Rate: ${(history.bestMetrics.winRate * 100).toFixed(1)}%`);
    console.log(`Best Profit Factor: ${history.bestMetrics.profitFactor.toFixed(2)}`);
    console.log(`Best Risk Differentiation: ${(history.bestMetrics.riskDifferentiation || 0).toFixed(3)}`);
  }

  // Show progression
  console.log('\nProgression:');
  history.iterations.forEach((iter, idx) => {
    const m = iter.mutationPerformed ? ' [MUTATION]' : '';
    const imp = iter.improved ? '✓' : '';
    console.log(`  ${idx + 1}: WR ${(iter.metrics.winRate * 100).toFixed(1)}% | PF ${iter.metrics.profitFactor.toFixed(2)} | RD ${(iter.metrics.riskDifferentiation || 0).toFixed(3)} ${imp}${m}`);
  });

  // Show mutations
  if (history.mutations.length > 0) {
    console.log('\nMutations performed:');
    history.mutations.forEach((m, i) => {
      console.log(`  ${i + 1}. [${m.type}] ${m.diagnosis.slice(0, 60)}...`);
    });
  }

  saveHistory(history);
}

// ----------------------------
// ENTRY POINT
// ----------------------------
if (require.main === module) {
  runIterationLoop().catch(err => {
    console.error('Iteration loop error:', err);
    process.exit(1);
  });
}

module.exports = { runIterationLoop, calculateMetrics, analyzeFailedTrades };
