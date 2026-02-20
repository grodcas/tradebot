/**
 * CONFIDENCE AGENT - USD/JPY - Intuitive Market Understanding
 *
 * Uses GPT-5.2 reasoning to assess trade probability.
 * EVERY trade gets executed - confidence determines position size.
 */

const { callGPT5JSON } = require('../gpt5_client');

const CONFIDENCE_PROMPT = `You are an experienced trader assessing trade probability.

YOUR TASK: Assign a probability (0.0 to 1.0) that this trade will hit its target before stop loss.

**YOUR GOAL: Correlation between confidence and outcomes**
Higher confidence trades should win more often. Your job is to identify which setups have real edge.

**FRAMEWORK - Start at 50% and adjust:**

1. **TREND ALIGNMENT (±15%)**
   - Trading WITH clear trend: +10-15%
   - No trend (sideways): +0%
   - Trading AGAINST trend: -10-15%

2. **ENTRY LOCATION (±10%)**
   - At key S/R level (good entry): +5-10%
   - Near S/R level (decent): +0-5%
   - Middle of range (bad entry): -5-10%

3. **MOMENTUM (±10%)**
   - Recent momentum WITH your direction: +5-10%
   - Mixed/neutral momentum: +0%
   - Momentum AGAINST you: -5-10%

4. **PULLBACK QUALITY (±5%)**
   - Healthy pullback (40-60%): +5%
   - Shallow pullback (<30%): +0%
   - Deep pullback (>70%): -5% (possible trend change)

**RESULTING RANGES:**
- 65-80%: Strong trend + good entry + momentum aligned - HIGH CONFIDENCE
- 50-65%: Good setup with 1-2 minor issues - MODERATE CONFIDENCE
- 40-50%: Mixed signals, could go either way - LOW CONFIDENCE
- 25-40%: Trading against trend or very weak setup - VERY LOW CONFIDENCE

**RANGES ARE STILL TRADEABLE:**
Even in a range, if price is at SUPPORT and you're going LONG → that's edge (50-55%)
Even in a range, if price is at RESISTANCE and you're going SHORT → that's edge (50-55%)
Range + middle of range + random direction → no edge (35-45%)

**BE BALANCED, NOT PESSIMISTIC.**
Look for reasons to be confident, not just reasons to be skeptical.

OUTPUT FORMAT (JSON):
{
  "probability": number between 0.0 and 1.0,
  "market_story": "1-2 sentences describing what's happening in this market",
  "for_this_trade": "Why this probability for THIS specific setup",
  "what_could_work": ["Key factors supporting the trade"],
  "what_could_fail": ["Key risks to be aware of"],
  "conviction_level": "HIGH | MODERATE | LOW | VERY_LOW"
}`;

async function assessConfidence({
  proposedDirection,
  directionAnalysis,
  currentPrice,
  support,
  resistance,
  ema50,
  emaSlope,
  atr,
  swingHigh,
  swingLow,
  sessionHigh,
  sessionLow,
  prices5m,
  marketRegime = 'UNKNOWN',
  structureState = 0,
  structureLabel = 'UNKNOWN',
  breakoutScore = 0,
  sweepScore = 0,
  pullbackRatio = 0
}) {

  // Calculate useful metrics for context
  const distToSupport = Math.abs(currentPrice - support);
  const distToResistance = Math.abs(resistance - currentPrice);
  const range = resistance - support;
  const positionInRange = range > 0 ? ((currentPrice - support) / range * 100).toFixed(0) : 50;

  const sessionRange = sessionHigh - sessionLow;
  const positionInSession = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Price momentum (last 5 bars)
  const recent = prices5m.slice(-5);
  let ups = 0, downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i-1]) ups++;
    else if (recent[i] < recent[i-1]) downs++;
  }
  const momentum = ups > downs ? "BULLISH" : ups < downs ? "BEARISH" : "NEUTRAL";

  // Trend alignment
  const trendDirection = structureState === 1 ? "UPTREND" : structureState === -1 ? "DOWNTREND" : "SIDEWAYS";
  const withTrend = (proposedDirection === 'LONG' && structureState === 1) ||
                    (proposedDirection === 'SHORT' && structureState === -1);
  const counterTrend = (proposedDirection === 'LONG' && structureState === -1) ||
                       (proposedDirection === 'SHORT' && structureState === 1);

  const userPrompt = `
**TRADE TO ASSESS**
Direction: ${proposedDirection}

**MARKET CONTEXT**
Current Price: ${currentPrice.toFixed(5)}
Structure: ${trendDirection} (${structureLabel})
Market Regime: ${marketRegime}
Position in Range: ${positionInRange}% (0=at support, 100=at resistance)
Position in Session: ${positionInSession}% (0=session low, 100=session high)

**KEY LEVELS**
Support: ${support.toFixed(5)} (${(distToSupport / atr).toFixed(1)} ATR away)
Resistance: ${resistance.toFixed(5)} (${(distToResistance / atr).toFixed(1)} ATR away)
Swing High: ${swingHigh.toFixed(5)}
Swing Low: ${swingLow.toFixed(5)}

**TREND INDICATORS**
EMA50: ${ema50.toFixed(5)} (price ${currentPrice > ema50 ? "ABOVE" : "BELOW"})
EMA Slope: ${emaSlope > 0 ? "UP" : emaSlope < 0 ? "DOWN" : "FLAT"}
${withTrend ? "✓ Trading WITH the trend" : counterTrend ? "⚠ Trading AGAINST the trend" : "○ No clear trend"}

**ENTRY QUALITY**
Pullback Depth: ${(pullbackRatio * 100).toFixed(0)}% retracement
Breakout Score: ${breakoutScore.toFixed(2)} (positive=bullish, negative=bearish)
Recent Momentum (5 bars): ${momentum}

**DIRECTION AGENT'S VIEW**
Bias: ${directionAnalysis.primary_bias}
Confidence: ${directionAnalysis.confidence}
Idea: ${directionAnalysis.trade_idea}

**YOUR TASK**
Read the market. Understand what's happening. Assign a probability (0.0-1.0) based on how likely this ${proposedDirection} trade is to succeed. Use the full range - every trade will be executed with sizing based on your probability.`;

  const result = await callGPT5JSON(CONFIDENCE_PROMPT, userPrompt);

  // Map conviction_level to legacy format for compatibility
  const assessment = result.conviction_level === 'HIGH' ? 'FAVORABLE' :
                     result.conviction_level === 'MODERATE' ? 'FAVORABLE' :
                     result.conviction_level === 'LOW' ? 'MARGINAL' : 'UNFAVORABLE';

  return {
    probability: result.probability,
    reasoning: result.for_this_trade,
    market_story: result.market_story,
    strengths: result.what_could_work,
    weaknesses: result.what_could_fail,
    conviction_level: result.conviction_level,
    for_proposed_direction: {
      assessment,
      recommendation: `${result.conviction_level} conviction - size accordingly`
    },
    should_skip: false  // Never skip - always trade with appropriate sizing
  };
}

module.exports = { assessConfidence };
