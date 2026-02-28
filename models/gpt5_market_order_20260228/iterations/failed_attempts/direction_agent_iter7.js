/**
 * DIRECTION AGENT - GPT-5 Iter7
 *
 * Expert in reading market structure and determining directional bias.
 * Iter7 enhancements:
 * - TREND DETECTION FIRST (EMA slope > 0.15 = trend)
 * - Only fade edges in CONFIRMED ranges
 * - Never fight a strong trend
 */

const { complete } = require("./ai_client");

const DIRECTION_PROMPT = `You are an expert market structure analyst. Your job is to read the trend FIRST, then determine direction.

===============================================
STEP 1: CHECK TREND STRENGTH FIRST (Most Important!)
===============================================

Look at EMA SLOPE MAGNITUDE to determine regime:

| EMA Slope | Regime | Trading Rule |
|-----------|--------|--------------|
| > 0.20    | STRONG TREND | Follow EMA direction, ignore position |
| 0.15-0.20 | MODERATE TREND | Follow EMA, but be cautious at extremes |
| 0.10-0.15 | WEAK/TRANSITIONAL | Mixed signals, reduce size |
| < 0.10    | RANGE | Use position-based fading |

*** STRONG TREND (|slope| > 0.15): FOLLOW THE TREND ***

In a strong trend, EMA direction overrides position:
- EMA UP (slope > 0.15): BULLISH even at "resistance"
- EMA DOWN (slope < -0.15): BEARISH even at "support"

WHY: Trends break through levels. "Resistance" in uptrend = breakout opportunity.

*** WEAK/RANGE (|slope| < 0.10): FADE THE EDGES ***

Only when EMA is flat, use position-based logic:
- 0-30% position: BULLISH (at support, expect bounce)
- 70-100% position: BEARISH (at resistance, expect rejection)
- 30-70% position: NEUTRAL (middle of range, no edge)

===============================================
STEP 2: DETERMINE DIRECTION
===============================================

Decision matrix:

| EMA Slope | Position 0-30% | Position 30-70% | Position 70-100% |
|-----------|----------------|-----------------|------------------|
| Strong UP (>0.15) | BULLISH | BULLISH | BULLISH |
| Strong DOWN (<-0.15) | BEARISH | BEARISH | BEARISH |
| Weak/Flat (<0.10) | BULLISH | NEUTRAL | BEARISH |

KEY INSIGHT: Strong trends WIN more than position fading.
Data shows: Following strong EMA = 60%+ WR. Fading against strong EMA = 30% WR.

===============================================
STEP 3: AVOID THESE MISTAKES
===============================================

MISTAKE: Fading against a strong trend
- EMA slope is -0.25 (strong downtrend)
- Price at 20% (support zone)
- WRONG: "BULLISH because at support"
- RIGHT: "BEARISH because strong downtrend breaks supports"

The old Iter6 made this mistake and dropped from 42% to 15% WR.

===============================================
OUTPUT FORMAT (JSON)
===============================================
{
  "ema_slope_magnitude": number,
  "regime": "STRONG_TREND_UP | STRONG_TREND_DOWN | WEAK_TREND | RANGE",
  "position_pct": number (0-100),
  "primary_bias": "BULLISH | BEARISH | NEUTRAL",
  "bias_reasoning": "Why: trend strength + position consideration",
  "ema_context": {
    "slope_direction": "UP | DOWN | FLAT",
    "slope_strength": "STRONG | MODERATE | WEAK"
  },
  "trade_idea": "Specific trade idea",
  "signal_clarity": "HIGH | MEDIUM | LOW"
}`;

async function analyzeDirection({ prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice }) {

  // Calculate price position in range
  const range = resistance - support;
  const positionPct = range > 0 ? ((currentPrice - support) / range * 100) : 50;
  const positionPctRounded = Math.round(positionPct);

  // Determine position zone
  let positionZone;
  if (positionPct <= 30) {
    positionZone = "SUPPORT_ZONE (0-30%) → BULLISH expected";
  } else if (positionPct >= 70) {
    positionZone = "RESISTANCE_ZONE (70-100%) → BEARISH expected";
  } else {
    positionZone = "MIDDLE (30-70%) → No edge, consider NEUTRAL";
  }

  // Determine EMA relationship
  const priceVsEma = currentPrice > ema50 ? "ABOVE" : currentPrice < ema50 ? "BELOW" : "AT";
  const emaTrendDesc = emaSlope > 0.00001 ? "RISING" : emaSlope < -0.00001 ? "FALLING" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "STRONG" : slopeMagnitude > 0.10 ? "MODERATE" : "WEAK";

  // Determine regime based on slope
  let regime, regimeRule;
  if (slopeMagnitude > 0.15) {
    regime = emaSlope > 0 ? "STRONG_TREND_UP" : "STRONG_TREND_DOWN";
    regimeRule = emaSlope > 0 ? "→ BULLISH (follow trend, ignore position)" : "→ BEARISH (follow trend, ignore position)";
  } else if (slopeMagnitude > 0.10) {
    regime = "WEAK_TREND";
    regimeRule = "→ Lean with EMA but be cautious";
  } else {
    regime = "RANGE";
    regimeRule = "→ Use position fading (LONG at support, SHORT at resistance)";
  }

  const userPrompt = `
*** CHECK TREND STRENGTH FIRST ***

EMA SLOPE: ${slopeMagnitude.toFixed(3)} (${slopeStrength})
REGIME: ${regime} ${regimeRule}

| If slope > 0.15 | FOLLOW the trend direction |
| If slope < 0.10 | FADE the edges (position-based) |

POSITION DATA:
- Current Price: ${currentPrice.toFixed(5)}
- Position: ${positionPctRounded}% (0% = support, 100% = resistance)
- Zone: ${positionZone}

DECISION MATRIX:
| EMA Slope | Any Position | Direction |
|-----------|--------------|-----------|
| ${slopeMagnitude > 0.15 ? ">>> " : ""}Strong UP (>0.15) | Any | BULLISH |
| ${slopeMagnitude > 0.15 && emaSlope < 0 ? ">>> " : ""}Strong DOWN (<-0.15) | Any | BEARISH |
| ${slopeMagnitude < 0.10 ? ">>> " : ""}Weak/Flat | 0-30% | BULLISH |
| ${slopeMagnitude < 0.10 ? ">>> " : ""}Weak/Flat | 30-70% | NEUTRAL |
| ${slopeMagnitude < 0.10 ? ">>> " : ""}Weak/Flat | 70-100% | BEARISH |

PRICE ACTION (last 15 closes):
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

KEY LEVELS:
- Support: ${support.toFixed(5)} | Resistance: ${resistance.toFixed(5)}
- Session: ${sessionLow.toFixed(5)} - ${sessionHigh.toFixed(5)}

What is the direction? Remember: Strong trend > Position fading.`;

  const text = await complete({
    systemPrompt: DIRECTION_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { analyzeDirection };
