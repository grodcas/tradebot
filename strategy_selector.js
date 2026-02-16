/**
 * Strategy Selector
 *
 * Handles strategy selection and execution for trading decisions.
 * First selects the appropriate strategy based on market context,
 * then executes the trade decision using the selected strategy's rules.
 *
 * IMPORTANT: This file handles FORMAT only. All trading logic/rules
 * come from the JSON files (strat_rules.json, rules_strategy1-4.json).
 */

const fs = require("fs");
const OpenAI = require("openai");

const STRAT_RULES_PATH = "./strat_rules.json";
const RULES_PATHS = {
  STRATEGY_1: "./rules_strategy1.json",
  STRATEGY_2: "./rules_strategy2.json",
  STRATEGY_3: "./rules_strategy3.json",
  STRATEGY_4: "./rules_strategy4.json",
};

// Will be initialized when needed
let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// ----------------------------
// STRATEGY SELECTION
// ----------------------------

/**
 * Calls AI to select which strategy to use based on market context.
 * Passes ALL indicators so the AI can properly compare strategies.
 */
async function selectStrategy({ context, indicators, currentBar }) {
  const stratRules = JSON.parse(fs.readFileSync(STRAT_RULES_PATH, "utf8"));

  const system = `You are a strategy selector for intraday FX trading.
Your job is to compare the current market conditions against strategy profiles and select the BEST FIT.
You must output ONLY valid JSON. No markdown, no commentary.`;

  const user = `
SELECTION RULES:
${JSON.stringify(stratRules, null, 2)}

CURRENT MARKET CONDITIONS:
- Zurich Time: ${indicators.anchorZurichTime || "N/A"}
- Current Session: ${indicators.currentSession}
- Previous Session: ${indicators.previousSession}
- Market Regime: ${indicators.marketRegime}
- Structure State: ${indicators.structureState} (${indicators.structureLabel})
- EMA50 Slope 30m: ${indicators.EMA50_slope_30m}
- Pullback Ratio: ${indicators.pullbackRatio}
- Breakout Score: ${indicators.breakoutScore} (bars ago: ${indicators.breakoutBarsAgo})
- Sweep Score: ${indicators.sweepScore} (bars ago: ${indicators.sweepBarsAgo})
- Acceptance Time: ${indicators.acceptanceTime}
- ATR 5m: ${indicators.ATR_5m}
- ATR 30m: ${indicators.ATR_30m}
- Prev Session High: ${indicators.prevSessionHigh}
- Prev Session Low: ${indicators.prevSessionLow}
- Support: ${indicators.support}
- Resistance: ${indicators.resistance}

CURRENT BAR:
${JSON.stringify(currentBar)}

Compare these conditions against each strategy's criteria.
Select the strategy with the BEST relative fit - the LEAST BAD option.

OUTPUT JSON (strict):
{
  "strategy": "STRATEGY_1" | "STRATEGY_2" | "STRATEGY_3" | "STRATEGY_4",
  "reasoning": string (max 200 chars explaining why this strategy fits best)
}`;

  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty strategy selection response.");

  const result = JSON.parse(text);

  // Validate strategy
  if (!["STRATEGY_1", "STRATEGY_2", "STRATEGY_3", "STRATEGY_4"].includes(result.strategy)) {
    console.warn(`Invalid strategy "${result.strategy}", defaulting to STRATEGY_4`);
    result.strategy = "STRATEGY_4";
  }

  return result;
}

// ----------------------------
// STRATEGY EXECUTION FUNCTIONS
// ----------------------------

const MAX_WAIT_BARS = 4;

/**
 * Helper to clamp risk between MIN_RISK and 1
 * CRITICAL: We never skip trades. Minimum risk is 0.15 for garbage setups.
 */
const MIN_RISK = 0.15;
const MAX_RISK = 0.75;

function clampRisk(x) {
  if (!Number.isFinite(x) || x <= 0) return MIN_RISK;
  return Math.max(MIN_RISK, Math.min(MAX_RISK, x));
}

/**
 * Validate and normalize the trade decision
 */
function validateDecision(dec, fallbackEntry) {
  if (!dec || typeof dec !== "object") throw new Error("Decision not an object.");
  if (!["LONG", "SHORT"].includes(dec.side)) throw new Error("Invalid side.");

  const entry = Number(dec.entry ?? fallbackEntry);
  const tp = Number(dec.tp);
  const sl = Number(dec.sl);
  const risk = clampRisk(Number(dec.risk));

  if (![entry, tp, sl].every(Number.isFinite)) throw new Error("entry/tp/sl must be numbers.");
  if (tp === sl) throw new Error("tp cannot equal sl.");

  if (dec.side === "LONG") {
    if (!(tp > entry && sl < entry)) throw new Error("LONG must have tp>entry and sl<entry.");
  } else {
    if (!(tp < entry && sl > entry)) throw new Error("SHORT must have tp<entry and sl>entry.");
  }

  return { side: dec.side, entry, tp, sl, risk, reasoning: dec.reasoning || "" };
}

/**
 * Builds the common prompt structure for all strategies.
 * The RULES come from JSON, this just provides FORMAT.
 */
function buildStrategyPrompt({ strategyName, rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {
  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE". Size risk according to how well conditions align.`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. You may WAIT if entry timing can improve.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nPREVIOUS WAITS:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close}`
      ).join('\n')}\n`
    : '';

  const system = `You are an intraday FX trader executing the ${strategyName} strategy.
Your job is to decide whether to TRADE or WAIT, and if trading, set entry/sl/tp/risk.
Follow the RULES provided. The decision is probabilistic - conditions don't need to be perfect.
You must output ONLY valid JSON. No markdown, no commentary.`;

  const user = `
STRATEGY: ${strategyName}

RULES (follow these):
${JSON.stringify(rules, null, 2)}

PRICE CONTEXT (15 candles, oldest to newest):
5M closes: [${context.prices_5m.map(p => p.toFixed(5)).join(', ')}]
30M closes: [${context.prices_30m.map(p => p.toFixed(5)).join(', ')}]
Daily closes: [${context.prices_daily.map(p => p.toFixed(5)).join(', ')}]

RANGES (high-low per candle):
5M: [${context.ranges_5m.map(r => r.toFixed(5)).join(', ')}]
30M: [${context.ranges_30m.map(r => r.toFixed(5)).join(', ')}]
Daily: [${context.ranges_daily.map(r => r.toFixed(5)).join(', ')}]

INDICATORS:
- marketRegime: ${indicators.marketRegime}
- structureState: ${indicators.structureState} (${indicators.structureLabel})
- EMA50_slope_30m: ${indicators.EMA50_slope_30m}
- pullbackRatio: ${indicators.pullbackRatio}
- breakoutScore: ${indicators.breakoutScore} (barsAgo: ${indicators.breakoutBarsAgo})
- sweepScore: ${indicators.sweepScore} (barsAgo: ${indicators.sweepBarsAgo})
- acceptanceTime: ${indicators.acceptanceTime}
- ATR_5m: ${indicators.ATR_5m}
- ATR_30m: ${indicators.ATR_30m}
- prevSessionHigh: ${indicators.prevSessionHigh}
- prevSessionLow: ${indicators.prevSessionLow}
- support: ${indicators.support}
- resistance: ${indicators.resistance}
- currentSession: ${indicators.currentSession}

CURRENT 5M BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}
TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

RISK SCALING (CRITICAL - must vary from 0.15 to 0.7):
- Excellent setup (everything aligns): 0.55-0.7
- Good setup (most factors align): 0.4-0.55
- Mediocre setup (mixed signals): 0.25-0.4
- Poor setup (dead market, conflicts): 0.15-0.25
NEVER use risk 0. Even garbage setups get 0.15. The variance is how we profit.

OUTPUT JSON (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT",
  "entry": number (use current close),
  "tp": number,
  "sl": number,
  "risk": number (0.15-0.7 - NEVER 0, garbage still gets 0.15),
  "reasoning": string (brief explanation)
}`;

  return { system, user };
}

/**
 * Generic strategy executor - loads rules from JSON file and executes.
 */
async function executeStrategy({ strategyKey, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {
  const rulesPath = RULES_PATHS[strategyKey];
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const strategyName = rules.strategy_name || strategyKey;

  const { system, user } = buildStrategyPrompt({
    strategyName,
    rules,
    context,
    indicators,
    currentBar,
    waitCount,
    mustTrade,
    waitHistory,
  });

  const resp = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty strategy response.");

  return JSON.parse(text);
}

// Individual strategy functions now just call the generic executor
async function executeStrategy1(params) {
  return executeStrategy({ strategyKey: "STRATEGY_1", ...params });
}

async function executeStrategy2(params) {
  return executeStrategy({ strategyKey: "STRATEGY_2", ...params });
}

async function executeStrategy3(params) {
  return executeStrategy({ strategyKey: "STRATEGY_3", ...params });
}

async function executeStrategy4(params) {
  return executeStrategy({ strategyKey: "STRATEGY_4", ...params });
}

// ----------------------------
// MAIN ORCHESTRATION
// ----------------------------

/**
 * Main function that orchestrates strategy selection and execution.
 */
async function callStrategyTradeDecision({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory = [] }) {
  // Step 1: Select strategy (only on first call, waitCount === 0)
  let selectedStrategy = null;
  let strategyReasoning = "";

  if (waitCount === 0) {
    const selection = await selectStrategy({ context, indicators, currentBar });
    selectedStrategy = selection.strategy;
    strategyReasoning = selection.reasoning;

    console.log(`   [STRATEGY] Selected: ${selectedStrategy}`);
    console.log(`   [STRATEGY] Reason: ${strategyReasoning}`);
  }

  // If continuing (waitCount > 0), use the strategy stored in waitHistory
  const strategyToUse = selectedStrategy ||
    (waitHistory.length > 0 && waitHistory[0].strategy) ||
    "STRATEGY_4";

  // Step 2: Execute the appropriate strategy
  const strategyParams = {
    context,
    indicators,
    currentBar,
    waitCount,
    mustTrade,
    waitHistory,
  };

  let rawDecision;

  switch (strategyToUse) {
    case "STRATEGY_1":
      rawDecision = await executeStrategy1(strategyParams);
      break;
    case "STRATEGY_2":
      rawDecision = await executeStrategy2(strategyParams);
      break;
    case "STRATEGY_3":
      rawDecision = await executeStrategy3(strategyParams);
      break;
    case "STRATEGY_4":
      rawDecision = await executeStrategy4(strategyParams);
      break;
    default:
      console.warn(`Unknown strategy ${strategyToUse}, using STRATEGY_4`);
      rawDecision = await executeStrategy4(strategyParams);
  }

  // Attach strategy info to decision
  rawDecision.selectedStrategy = strategyToUse;
  if (strategyReasoning) {
    rawDecision.strategyReasoning = strategyReasoning;
  }

  return rawDecision;
}

module.exports = {
  selectStrategy,
  executeStrategy1,
  executeStrategy2,
  executeStrategy3,
  executeStrategy4,
  callStrategyTradeDecision,
  validateDecision,
  MAX_WAIT_BARS,
};
