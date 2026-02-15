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
const RULES_PATH = "./rules.json";

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
You are a strategy selection engine for forex intraday trading.
Your job is to analyze market conditions and select the most appropriate trading strategy.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.
`;

  const user = `
STRATEGY OPTIONS:
${JSON.stringify(stratRules.strategy_selection_criteria, null, 2)}

SELECTION RULES:
${stratRules.selection_rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

MARKET CONTEXT:
${JSON.stringify(context, null, 2)}

TRADE INDICATORS:
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
You are an aggressive TREND FOLLOWING forex trader.
You trade WITH the trend, looking for momentum continuation.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.

TREND FOLLOWING PHILOSOPHY:
- Trade in the direction of the dominant trend (aligned slopes)
- Enter on pullbacks within the trend
- Use wider stops to stay in the trade
- Target trend continuation moves
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE" now. Use lower risk (0.2-0.5) if uncertain.`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. WARNING: Trends don't wait - hesitation means missing the move.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nBARS YOU ALREADY REJECTED:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close} - "${w.reasoning?.slice(0, 100)}..."`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: TREND FOLLOWING

RULES:
${JSON.stringify(rules)}

MARKET CONTEXT:
${JSON.stringify(context)}

INDICATORS:
- Support: ${indicators.support ? indicators.support.toFixed(5) : "N/A"}
- Resistance: ${indicators.resistance ? indicators.resistance.toFixed(5) : "N/A"}
- Swing Highs: ${JSON.stringify(indicators.swingHighs)}
- Swing Lows: ${JSON.stringify(indicators.swingLows)}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT" (required if action=TRADE),
  "entry": number (required if action=TRADE, use current close),
  "tp": number (required if action=TRADE),
  "sl": number (required if action=TRADE),
  "risk": number 0-1 (required if action=TRADE),
  "reasoning": string (max 500 chars)
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
  if (!text) throw new Error("Empty LLM response.");
  return JSON.parse(text);
}

/**
 * STRATEGY 2: Mean Reversion
 * Trades against extremes, expecting price to return to mean.
 */
async function executeStrategy2({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {
  const system = `
You are a MEAN REVERSION forex trader.
You trade AGAINST extreme moves, expecting price to revert to the mean.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.

MEAN REVERSION PHILOSOPHY:
- Look for overextended moves away from session levels
- Trade reversals at support and resistance
- Use tighter stops at extreme levels
- Target a return to the mean/session mid-point
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE" now. Use lower risk (0.2-0.5) if uncertain.`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. Mean reversion setups require patience for the right level.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nBARS YOU ALREADY REJECTED:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close} - "${w.reasoning?.slice(0, 100)}..."`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: MEAN REVERSION

RULES:
${JSON.stringify(rules)}

MARKET CONTEXT:
${JSON.stringify(context)}

INDICATORS:
- Support: ${indicators.support ? indicators.support.toFixed(5) : "N/A"}
- Resistance: ${indicators.resistance ? indicators.resistance.toFixed(5) : "N/A"}
- Swing Highs: ${JSON.stringify(indicators.swingHighs)}
- Swing Lows: ${JSON.stringify(indicators.swingLows)}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT" (required if action=TRADE),
  "entry": number (required if action=TRADE, use current close),
  "tp": number (required if action=TRADE),
  "sl": number (required if action=TRADE),
  "risk": number 0-1 (required if action=TRADE),
  "reasoning": string (max 500 chars)
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
  if (!text) throw new Error("Empty LLM response.");
  return JSON.parse(text);
}

/**
 * STRATEGY 3: Breakout
 * Trades breakouts from ranges and key levels.
 */
async function executeStrategy3({ rules, context, indicators, currentBar, waitCount, mustTrade, waitHistory }) {
  const system = `
You are a BREAKOUT forex trader.
You trade breakouts from ranges, support/resistance, and key levels.
You MUST output ONLY valid JSON matching the schema exactly.
No markdown, no commentary.

BREAKOUT PHILOSOPHY:
- Wait for price to break key levels (support/resistance)
- Confirm with volatility expansion
- Enter on the breakout or first pullback after break
- Use the broken level as your stop reference
- Target the next structural level
`;

  const waitInfo = mustTrade
    ? `FINAL BAR - You MUST output action="TRADE" now. Use lower risk (0.2-0.5) if uncertain.`
    : `Waits left: ${MAX_WAIT_BARS - waitCount}. Breakouts are time-sensitive - act quickly or miss the move.`;

  const waitHistorySection = waitHistory.length > 0
    ? `\nBARS YOU ALREADY REJECTED:\n${waitHistory.map((w, i) =>
        `  ${i + 1}. ${w.bar.time} close=${w.bar.close} - "${w.reasoning?.slice(0, 100)}..."`
      ).join('\n')}\n`
    : '';

  const user = `
STRATEGY: BREAKOUT

RULES:
${JSON.stringify(rules)}

MARKET CONTEXT:
${JSON.stringify(context)}

INDICATORS:
- Support: ${indicators.support ? indicators.support.toFixed(5) : "N/A"}
- Resistance: ${indicators.resistance ? indicators.resistance.toFixed(5) : "N/A"}
- Swing Highs: ${JSON.stringify(indicators.swingHighs)}
- Swing Lows: ${JSON.stringify(indicators.swingLows)}

CURRENT 5MIN BAR:
${JSON.stringify(currentBar)}
${waitHistorySection}

TIMING:
- Waits used: ${waitCount}/${MAX_WAIT_BARS}
- ${waitInfo}

OUTPUT JSON SCHEMA (strict):
{
  "action": "TRADE" | "WAIT",
  "side": "LONG" | "SHORT" (required if action=TRADE),
  "entry": number (required if action=TRADE, use current close),
  "tp": number (required if action=TRADE),
  "sl": number (required if action=TRADE),
  "risk": number 0-1 (required if action=TRADE),
  "reasoning": string (max 500 chars)
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
  if (!text) throw new Error("Empty LLM response.");
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
  // Load rules if not provided
  const tradingRules = rules || JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));

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

  // If we're continuing (waitCount > 0), use the strategy stored in waitHistory
  const strategyToUse = selectedStrategy ||
    (waitHistory.length > 0 && waitHistory[0].strategy) ||
    "STRATEGY_1";

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
