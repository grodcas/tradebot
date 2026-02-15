/**
 * Strategy Selector
 *
 * Handles strategy selection and execution for trading decisions.
 * First selects the appropriate strategy based on market context,
 * then executes the trade decision using the selected strategy's prompt.
 */

const fs = require("fs");
const OpenAI = require("openai");

const STRAT_RULES_PATH = "./strat_rules.json";
const RULES_PATHS = {
  STRATEGY_1: "./rules_strategy1.json",
  STRATEGY_2: "./rules_strategy2.json",
  STRATEGY_3: "./rules_strategy3.json",
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
 *
 * @param {Object} params
 * @param {Object} params.context - Market context (5m, 30m, daily features)
 * @param {Object} params.indicators - Trade indicators (support, resistance, swings)
 * @param {Object} params.currentBar - Current 5M bar
 * @returns {Promise<{strategy: string, reasoning: string}>}
 */
async function selectStrategy({ context, indicators, currentBar }) {
  const stratRules = JSON.parse(fs.readFileSync(STRAT_RULES_PATH, "utf8"));

  const system = `
You are a professional intraday FX strategy advisor.
Your role is to SELECT the most appropriate trading strategy at a given timestamp,
based on probabilistic alignment between market conditions and predefined strategy instructions.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.
`;

  const user = `

  You operate using:

1) INSTRUCTIONS → Strategic decision framework (from JSON file)
2) INSTRUMENTS → Market indicators (provided data snapshot)

You must:

- Evaluate timing first (session relevance).
- Evaluate regime (trend, expansion, range).
- Evaluate event intensity (breakoutScore, sweepScore).
- Evaluate structural alignment (structureState, pullbackRatio, EMA slope).

The decision is probabilistic.
Conditions do NOT need to be perfectly satisfied.
Choose the strategy that best fits the current environment.

If no strategy strongly fits, default to the most structurally stable option.

STRATEGY OPTIONS:
${JSON.stringify(stratRules.strategy_selection_criteria, null, 2)}


TRADE INDICATORS:
- Zurich Time: ${indicators.anchorZurichTime || "N/A"}
- Current Session: ${indicators.currentSession}
- Previous Session: ${indicators.previousSession}
- Support (5th %ile): ${indicators.support ? indicators.support.toFixed(5) : "N/A"}
- Resistance (95th %ile): ${indicators.resistance ? indicators.resistance.toFixed(5) : "N/A"}
- Swing Highs: ${JSON.stringify(indicators.swingHighs)}
- Swing Lows: ${JSON.stringify(indicators.swingLows)}

CURRENT 5M BAR:
${JSON.stringify(currentBar)}

OUTPUT JSON SCHEMA (strict):
{
  "strategy": "STRATEGY_1" | "STRATEGY_2" | "STRATEGY_3",
  "reasoning": string (max 200 chars explaining why this strategy was chosen)
}
`;

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
  if (!["STRATEGY_1", "STRATEGY_2", "STRATEGY_3"].includes(result.strategy)) {
    console.warn(`Invalid strategy "${result.strategy}", defaulting to STRATEGY_1`);
    result.strategy = "STRATEGY_1";
  }

  return result;
}

// ----------------------------
// STRATEGY EXECUTION FUNCTIONS
// ----------------------------

const MAX_WAIT_BARS = 4;

/**
 * Helper to clamp value between 0 and 1
 */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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
  const risk = clamp01(Number(dec.risk));

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
 * STRATEGY 1: Trend Following
 * Trades in the direction of the trend with momentum confirmation.
 */
async function executeStrategy1({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {

  const system = `
You are a professional intraday TREND PULLBACK trader.
Your objective is to trade continuation moves in the direction of the dominant 30m structure.
You trade structured pullbacks inside an established trend.

You must decide:
- Whether to TRADE or WAIT.
- If trading, define side, entry (current close), stop loss, take profit and risk.
- Stop loss must allow structural fluctuation.
- Take profit must aim for continuation beyond recent structure.
- Risk must reflect confidence (0–1.0).

The decision is probabilistic, not deterministic.

You MUST output ONLY valid JSON matching the schema exactly.
No markdown. No commentary.
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE". If uncertain, reduce risk (0.2–0.5).`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. Trends require timing precision.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nPREVIOUS REJECTIONS:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close}`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: TREND PULLBACK CONTINUATION

INSTRUCTIONS:
${JSON.stringify(rules)}

MARKET CONTEXT (15 candles each timeframe):
${JSON.stringify(context)}

KEY INDICATORS:
- structureState: ${indicators.structureState}
- EMA50_slope_30m: ${indicators.EMA50_slope_30m}
- marketRegime: ${indicators.marketRegime}
- pullbackRatio: ${indicators.pullbackRatio}
- ATR_5m: ${indicators.ATR_5m}
- ATR_30m: ${indicators.ATR_30m}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT",
  "entry": number,
  "tp": number,
  "sl": number,
  "risk": number,
  "reasoning": string
}
`;

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


/**
 * STRATEGY 2: Mean Reversion
 * Trades against extremes, expecting price to return to mean.
 */
async function executeStrategy2({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {

  const system = `
You are a professional intraday LIQUIDITY SWEEP REVERSAL trader.
Your objective is to trade failed breakouts after stop hunts beyond key session levels.
You trade rejection and liquidity traps.

You must decide:
- Whether to TRADE or WAIT.
- If trading, define side, entry (current close), stop loss, take profit and risk.
- Stop loss must sit beyond the liquidity sweep extreme.
- Take profit should target return toward session mean or opposite structure.
- Risk must reflect confidence (0–1.0).

The decision is probabilistic, not deterministic.

You MUST output ONLY valid JSON matching the schema exactly.
No markdown. No commentary.
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE". If uncertain, reduce risk (0.2–0.5).`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. Reversal setups are short-lived.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nPREVIOUS REJECTIONS:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close}`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: LIQUIDITY SWEEP REVERSAL

INSTRUCTIONS:
${JSON.stringify(rules)}

MARKET CONTEXT (15 candles each timeframe):
${JSON.stringify(context)}

KEY INDICATORS:
- sweepScore: ${indicators.sweepScore}
- acceptanceTime: ${indicators.acceptanceTime}
- marketRegime: ${indicators.marketRegime}
- structureState: ${indicators.structureState}
- ATR_5m: ${indicators.ATR_5m}
- prevSessionHigh: ${indicators.prevSessionHigh}
- prevSessionLow: ${indicators.prevSessionLow}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT",
  "entry": number,
  "tp": number,
  "sl": number,
  "risk": number,
  "reasoning": string
}
`;

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


/**
 * STRATEGY 3: Breakout
 * Trades breakouts from ranges and key levels.
 */
async function executeStrategy3({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {

  const system = `
You are a professional intraday SESSION BREAKOUT trader.
Your objective is to trade volatility expansion when price escapes a defined session range with momentum.
You trade continuation after range escape.

You must decide:
- Whether to TRADE or WAIT.
- If trading, define side, entry (current close), stop loss, take profit and risk.
- Stop loss must allow structural volatility.
- Take profit must target continuation expansion.
- Risk must reflect confidence (0–1.0).

The decision is probabilistic, not deterministic.

You MUST output ONLY valid JSON matching the schema exactly.
No markdown. No commentary.
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE". If uncertain, reduce risk (0.2–0.5).`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. Breakouts require timely execution.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nPREVIOUS REJECTIONS:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close}`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: SESSION BREAKOUT EXPANSION

INSTRUCTIONS:
${JSON.stringify(rules)}

MARKET CONTEXT (15 candles each timeframe):
${JSON.stringify(context)}

KEY INDICATORS:
- breakoutScore: ${indicators.breakoutScore}
- acceptanceTime: ${indicators.acceptanceTime}
- marketRegime: ${indicators.marketRegime}
- structureState: ${indicators.structureState}
- ATR_5m: ${indicators.ATR_5m}
- prevSessionHigh: ${indicators.prevSessionHigh}
- prevSessionLow: ${indicators.prevSessionLow}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT",
  "entry": number,
  "tp": number,
  "sl": number,
  "risk": number,
  "reasoning": string
}
`;

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


// ----------------------------
// MAIN ORCHESTRATION
// ----------------------------

/**
 * Main function that orchestrates strategy selection and execution.
 *
 * @param {Object} params
 * @param {Object} params.rules - Trading rules from rules.json
 * @param {Object} params.context - Market context
 * @param {Object} params.indicators - Trade indicators
 * @param {Object} params.currentBar - Current 5M bar
 * @param {number} params.waitCount - Current wait count
 * @param {boolean} params.mustTrade - Whether this is the final bar
 * @param {Array} params.waitHistory - History of rejected bars
 * @returns {Promise<Object>} Trade decision with strategy info
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

  // If we're continuing (waitCount > 0), use the strategy stored in waitHistory
  const strategyToUse = selectedStrategy ||
    (waitHistory.length > 0 && waitHistory[0].strategy) ||
    "STRATEGY_1";

  // Load strategy-specific rules
  const rulesPath = RULES_PATHS[strategyToUse] || RULES_PATHS.STRATEGY_1;
  const tradingRules = rules || JSON.parse(fs.readFileSync(rulesPath, "utf8"));

  // Step 2: Execute the appropriate strategy
  const strategyParams = {
    rules: tradingRules,
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
    default:
      console.warn(`Unknown strategy ${strategyToUse}, using STRATEGY_1`);
      rawDecision = await executeStrategy1(strategyParams);
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
  callStrategyTradeDecision,
  validateDecision,
  MAX_WAIT_BARS,
};
