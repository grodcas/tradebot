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
const MAX_ITERATIONS = 10;  // Max improvement cycles
const IMPROVEMENT_THRESHOLD = 0.02;  // Stop if improvement < 2%

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

  console.log('\n' + '='.repeat(60));
  console.log('AUTOMATED ITERATION LOOP');
  console.log('='.repeat(60));
  console.log(`Starting from iteration ${history.iterations.length + 1}`);
  if (history.bestMetrics) {
    console.log(`Best so far: ${(history.bestMetrics.winRate * 100).toFixed(1)}% WR, PF ${history.bestMetrics.profitFactor.toFixed(2)}`);
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const iterNum = history.iterations.length + 1;
    console.log('\n' + '='.repeat(60));
    console.log(`ITERATION ${iterNum}`);
    console.log('='.repeat(60));

    // Step 1: Run batch trainer
    const results = runBatchTrainer(NUM_SCENARIOS);
    const trades = results;

    // Step 2: Calculate metrics
    const metrics = calculateMetrics(trades);
    const failures = analyzeFailedTrades(trades);

    console.log('\n--- Metrics ---');
    console.log(`Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
    console.log(`Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
    console.log(`Total R: ${metrics.totalWeightedR.toFixed(2)}`);
    console.log(`Risk Differentiation: ${metrics.riskDifferentiation.toFixed(3)}`);

    // Check for improvement
    const prevBest = history.bestMetrics;
    const improved = !prevBest ||
      (metrics.winRate > prevBest.winRate + IMPROVEMENT_THRESHOLD) ||
      (metrics.profitFactor > prevBest.profitFactor * 1.1);

    if (!prevBest || metrics.profitFactor > (history.bestMetrics?.profitFactor || 0)) {
      history.bestMetrics = metrics;
      history.bestIteration = iterNum;
      console.log('>>> NEW BEST! <<<');
    }

    // Step 3: Improve each agent
    const improvements = {};

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

        // Apply the change
        applyPromptChange(agentPath, agentName, improvement.improved_prompt);
        console.log(`  Analysis: ${improvement.analysis}`);
        console.log(`  Changes: ${improvement.changes.join(', ')}`);
      }
    }

    // Step 4: Log iteration
    history.iterations.push({
      iteration: iterNum,
      timestamp: new Date().toISOString(),
      metrics: {
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        totalWeightedR: metrics.totalWeightedR,
        riskDifferentiation: metrics.riskDifferentiation,
        longWR: metrics.longWR,
        shortWR: metrics.shortWR
      },
      improvements,
      improved
    });

    saveHistory(history);

    // Step 5: Check stopping condition
    if (history.iterations.length >= 3) {
      const recent = history.iterations.slice(-3);
      const avgImprovement = recent.filter(r => r.improved).length / 3;

      if (avgImprovement < 0.33 && metrics.winRate > 0.60 && metrics.profitFactor > 2.0) {
        console.log('\n>>> Convergence reached! No significant improvement in last 3 iterations. <<<');
        console.log(`Final: ${(metrics.winRate * 100).toFixed(1)}% WR, PF ${metrics.profitFactor.toFixed(2)}`);
        break;
      }
    }

    // Brief pause between iterations
    console.log('\nWaiting 5 seconds before next iteration...');
    await new Promise(r => setTimeout(r, 5000));
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('ITERATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total iterations: ${history.iterations.length}`);
  console.log(`Best iteration: ${history.bestIteration}`);
  if (history.bestMetrics) {
    console.log(`Best Win Rate: ${(history.bestMetrics.winRate * 100).toFixed(1)}%`);
    console.log(`Best Profit Factor: ${history.bestMetrics.profitFactor.toFixed(2)}`);
    console.log(`Best Total R: ${history.bestMetrics.totalWeightedR.toFixed(2)}`);
  }

  // Show progression
  console.log('\nProgression:');
  history.iterations.forEach((iter, i) => {
    console.log(`  ${i + 1}: WR ${(iter.metrics.winRate * 100).toFixed(1)}% | PF ${iter.metrics.profitFactor.toFixed(2)} | R ${iter.metrics.totalWeightedR.toFixed(2)} ${iter.improved ? '✓' : ''}`);
  });
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
