/**
 * CONFIDENCE AGENT - GPT-5 Iter7
 *
 * Expert in VALIDATING direction calls based on TREND STRENGTH first.
 * Iter7 enhancements:
 * - Trend strength validation BEFORE position
 * - Never penalize trend-following at "wrong" position
 * - Only apply position rules in confirmed ranges
 */

const { complete } = require("./ai_client");

const CONFIDENCE_PROMPT = `You are an expert trade validator. Your job is to CHECK if the proposed direction matches the TREND.

===============================================
STEP 1: CHECK TREND STRENGTH FIRST
===============================================

| EMA Slope Magnitude | Regime | Validation Rule |
|---------------------|--------|-----------------|
| > 0.15 | STRONG TREND | Direction must match EMA |
| 0.10-0.15 | WEAK TREND | Prefer EMA direction |
| < 0.10 | RANGE | Use position-based validation |

*** STRONG TREND (|slope| > 0.15): EMA WINS ***

| EMA Direction | Proposed | Valid? |
|---------------|----------|--------|
| Strong UP | LONG | YES - high probability |
| Strong UP | SHORT | NO - fighting trend |
| Strong DOWN | SHORT | YES - high probability |
| Strong DOWN | LONG | NO - fighting trend |

In strong trends, position doesn't matter:
- LONG at "resistance" in uptrend = VALID (breakout expected)
- SHORT at "support" in downtrend = VALID (breakdown expected)

*** RANGE (|slope| < 0.10): POSITION WINS ***

Only in confirmed ranges, validate against position:
- LONG at 0-30% (support) = VALID
- SHORT at 70-100% (resistance) = VALID
- Any direction at 30-70% (middle) = LOW probability

===============================================
STEP 2: ASSIGN PROBABILITY
===============================================

HIGH (0.60-0.75):
- Strong trend + direction matches EMA
- Range + direction matches position zone

MEDIUM (0.45-0.60):
- Weak trend + direction matches EMA
- Range + direction at edge but not perfect

LOW (0.25-0.45):
- Direction conflicts with trend OR position
- Middle of range with no edge

SKIP (< 0.25):
- Fighting strong trend
- Trading middle of range

===============================================
OUTPUT FORMAT (JSON)
===============================================
{
  "trend_check": {
    "ema_slope": number,
    "regime": "STRONG_TREND | WEAK_TREND | RANGE",
    "trend_direction": "UP | DOWN | FLAT"
  },
  "direction_validation": {
    "proposed": "LONG | SHORT",
    "matches_trend": true/false,
    "matches_position": true/false,
    "is_valid": true/false
  },
  "probability": number,
  "reasoning": "Why this probability",
  "sizing_recommendation": "FULL | REDUCED | MINIMAL | SKIP"
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
  // Additional context indicators
  marketRegime = null,
  structureState = null,
  breakoutScore = null,
  sweepScore = null
}) {

  // Calculate position in range (0-100%)
  const range = resistance - support;
  const positionPct = range > 0 ? ((currentPrice - support) / range * 100) : 50;
  const positionPctRounded = Math.round(positionPct);

  // EMA info - THIS COMES FIRST NOW
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "STRONG" : slopeMagnitude > 0.10 ? "MODERATE" : "WEAK";
  const isStrongTrend = slopeMagnitude > 0.15;
  const trendDir = emaSlope > 0 ? "UP" : "DOWN";

  // Determine regime
  let regime;
  if (slopeMagnitude > 0.15) regime = "STRONG_TREND";
  else if (slopeMagnitude > 0.10) regime = "WEAK_TREND";
  else regime = "RANGE";

  // Validate direction based on regime
  let matchesTrend = false;
  let matchesPosition = false;

  // Trend matching
  if (emaSlope > 0.15 && proposedDirection === "LONG") matchesTrend = true;
  if (emaSlope < -0.15 && proposedDirection === "SHORT") matchesTrend = true;

  // Position matching (only relevant in ranges)
  if (positionPct <= 30 && proposedDirection === "LONG") matchesPosition = true;
  if (positionPct >= 70 && proposedDirection === "SHORT") matchesPosition = true;

  // Is direction valid?
  let isValid = false;
  let validationNote = "";
  if (isStrongTrend) {
    isValid = matchesTrend;
    validationNote = matchesTrend
      ? `✓ VALID: ${proposedDirection} matches strong ${trendDir} trend`
      : `✗ INVALID: ${proposedDirection} fights strong ${trendDir} trend`;
  } else {
    isValid = matchesPosition;
    validationNote = matchesPosition
      ? `✓ VALID: ${proposedDirection} matches position (${positionPctRounded}%)`
      : `✗ INVALID: ${proposedDirection} wrong for position (${positionPctRounded}%)`;
  }

  const userPrompt = `
*** TREND CHECK FIRST ***

EMA Slope: ${slopeMagnitude.toFixed(3)} (${slopeStrength} ${trendDir})
Regime: ${regime}

| If STRONG TREND (>0.15) | Direction must match EMA |
| If RANGE (<0.10) | Direction must match position |

TREND VALIDATION:
- Proposed: ${proposedDirection}
- Trend direction: ${trendDir} (slope ${emaSlope.toFixed(3)})
- Matches trend: ${matchesTrend ? "YES" : "NO"}

POSITION DATA (only matters if RANGE):
- Position: ${positionPctRounded}%
- Matches position: ${matchesPosition ? "YES" : "NO"}

ASSESSMENT: ${validationNote}

PROBABILITY GUIDE:
- Strong trend + matches trend → 0.65-0.75
- Range + matches position → 0.55-0.65
- Conflicts with trend → 0.20-0.35 (SKIP)
- Middle of range → 0.30-0.40 (SKIP)

What probability for ${proposedDirection}?`;

  const text = await complete({
    systemPrompt: CONFIDENCE_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { assessConfidence };
