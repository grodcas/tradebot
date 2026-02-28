/**
 * CONFIDENCE AGENT - Iter11
 *
 * Binary confirm/reject gate for the direction agent's call.
 * Does NOT set position size (that's fixed at 0.50).
 *
 * Its job: "Given the direction agent says X, does this make sense?"
 * Output: CONFIRM or REJECT with reasoning.
 *
 * Iter10 changes:
 * - Added pullback awareness: temporary EMA misalignment during pullbacks is normal
 * - Added location context: near support/resistance info
 * - Loosened EMA requirement: structure alignment matters more than perfect EMA match
 *
 * Iter11 changes:
 * - Fixed structureAligned for RANGE: uses position-based alignment instead of always false
 * - Added RANGE-specific CONFIRM guidance to prompt
 */

const { complete } = require("./ai_client");

const CONFIDENCE_PROMPT = `You are a second-opinion trader reviewing a proposed trade direction on EUR/USD.

Another analyst has proposed a direction (LONG or SHORT). Your job is to CONFIRM or REJECT this call.

You should CONFIRM when:
- The proposed direction aligns with the market structure (this is the MOST important factor)
- The trade makes sense given the regime and location (where price is relative to support/resistance)
- In a RANGE, the direction matches the price location (LONG near support, SHORT near resistance)
- There is no obvious reason the trade would fail

You should REJECT when:
- The direction clearly contradicts the market structure (e.g., LONG in confirmed downtrend with no support nearby)
- The market is too choppy or unclear to trade (MESSY readability)
- The trade is at a dangerous location (e.g., LONG at resistance in a range, SHORT at support in a range)
- The market is in EXPANSION (volatile breakout) and the direction is uncertain

IMPORTANT — RANGE regime alignment:
- In a RANGE regime, "structure alignment" means the direction matches the price LOCATION
  (LONG in lower half near support, SHORT in upper half near resistance).
  This is different from TREND alignment. If location aligns, CONFIRM.

IMPORTANT — DO NOT reject just because EMA momentum is flat or temporarily misaligned:
- In a TREND, pullbacks are NORMAL. During a pullback, EMA momentum temporarily weakens or flattens — this does NOT invalidate the trend. If structure shows HH+HL (uptrend) but EMA is temporarily flat/weak-down, that's a pullback opportunity, not a rejection signal.
- EMA alignment is a SUPPORTING factor, not a veto. Structure and location matter more.
- Only reject on EMA grounds if momentum is STRONGLY opposed to the proposed direction (e.g., LONG proposed but EMA strongly falling in a downtrend).

Be honest and direct. If the trade looks reasonable, CONFIRM it. Only REJECT when something is clearly wrong. You are a sanity check, not a perfectionist — do not demand perfect alignment of every indicator.

OUTPUT FORMAT (JSON):
{
  "verdict": "CONFIRM | REJECT",
  "reasoning": "One or two sentences explaining why you confirm or reject"
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
  marketRegime = null,
  structureState = null,
  structureLabel = null,
}) {

  // EMA alignment check — require meaningful slope (>0.05) to count as aligned
  const emaAligned = (proposedDirection === "LONG" && emaSlope > 0.05) || (proposedDirection === "SHORT" && emaSlope < -0.05);
  const emaOpposed = (proposedDirection === "LONG" && emaSlope < -0.10) || (proposedDirection === "SHORT" && emaSlope > 0.10);
  const emaSlopeDir = emaSlope > 0.05 ? "UP" : emaSlope < -0.05 ? "DOWN" : "FLAT";
  const slopeMagnitude = Math.abs(emaSlope);
  const slopeStrength = slopeMagnitude > 0.20 ? "STRONG" : slopeMagnitude > 0.10 ? "MODERATE" : "WEAK";

  // Structure description — use label if available (includes ATR tolerance from Iter10)
  const structureDesc = structureLabel || (structureState > 0 ? 'UPTREND' : structureState < 0 ? 'DOWNTREND' : 'RANGE');

  // Check if direction aligns with structure
  let structureAligned;
  if (structureState !== 0) {
    // TREND: align with structure direction
    structureAligned = (proposedDirection === "LONG" && structureState > 0) ||
                       (proposedDirection === "SHORT" && structureState < 0);
  } else {
    // RANGE: align with position (near support → LONG aligned, near resistance → SHORT aligned)
    const srRange = resistance - support;
    const posInSR = srRange > 0 ? (currentPrice - support) / srRange : 0.5;
    structureAligned = (proposedDirection === "LONG" && posInSR < 0.5) ||
                       (proposedDirection === "SHORT" && posInSR > 0.5);
  }

  // Position in previous session range
  const sessionRange = sessionHigh - sessionLow;
  const positionPct = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  // Location context — is price near support or resistance?
  const distToSupport = (currentPrice - support) / atr;
  const distToResistance = (resistance - currentPrice) / atr;
  let locationWarning = "";
  if (distToSupport < 1.0 && proposedDirection === "SHORT") {
    locationWarning = `⚠ CAUTION: Price is only ${distToSupport.toFixed(1)} ATR above support — shorting near support in a range is risky.`;
  } else if (distToResistance < 1.0 && proposedDirection === "LONG") {
    locationWarning = `⚠ CAUTION: Price is only ${distToResistance.toFixed(1)} ATR below resistance — buying near resistance in a range is risky.`;
  } else if (distToSupport < 0) {
    locationWarning = `Note: Price has broken below support by ${Math.abs(distToSupport).toFixed(1)} ATR.`;
  } else if (distToResistance < 0) {
    locationWarning = `Note: Price has broken above resistance by ${Math.abs(distToResistance).toFixed(1)} ATR.`;
  }

  const userPrompt = `
PROPOSED DIRECTION: ${proposedDirection}

DIRECTION AGENT'S REASONING:
${directionAnalysis.trade_idea || 'No specific idea'}
Signal clarity: ${directionAnalysis.signal_clarity || 'N/A'}
Market readability: ${directionAnalysis.market_readability || 'N/A'}

MARKET CONTEXT:
- Regime: ${marketRegime || 'UNKNOWN'} (TREND = confirmed directional move, RANGE = no clear trend, EXPANSION = volatility spike)
- Structure: ${structureDesc}
- Direction aligns with structure: ${structureAligned ? "YES" : "NO"}
- EMA50 momentum: ${emaSlopeDir} (${slopeStrength})
- EMA aligned with ${proposedDirection}: ${emaAligned ? "YES" : emaOpposed ? "OPPOSED" : "FLAT/WEAK"}
- Price vs EMA50: ${currentPrice > ema50 ? "ABOVE" : "BELOW"}
- Position in previous session range: ${positionPct}% (0%=prior low, 100%=prior high)
${locationWarning ? `\n${locationWarning}` : ''}

Should this ${proposedDirection} trade be taken? CONFIRM or REJECT.`;

  const text = await complete({
    systemPrompt: CONFIDENCE_PROMPT,
    userPrompt,
    temperature: 0.3,
    jsonMode: true
  });

  return JSON.parse(text);
}

module.exports = { assessConfidence };
