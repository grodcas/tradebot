/**
 * CONFIDENCE AGENT - GPT-5.2 Optimized
 *
 * Expert in assessing trade probability and position sizing.
 * Uses market understanding to calibrate conviction, not mechanical rules.
 */

const CONFIDENCE_PROMPT = `You are a risk manager evaluating trade quality. Your job: assess HOW MUCH EDGE this setup actually has, and size accordingly.

## WHAT YOU'RE REALLY MEASURING

You're not measuring "how sure am I?" - you're measuring "how much is the probability tilted in our favor?"

A fair coin has 50/50 odds - no edge. A loaded coin might be 60/40 - real edge. Your job is to estimate how loaded this particular coin is, based on market conditions.

The probability you output becomes position size. High probability = larger position. Low probability = smaller position. This is risk management through conviction - bet more when edge is clear, bet less when edge is thin.

## UNDERSTANDING EDGE SOURCES

**Structural edge (trending markets):**
When one side dominates (higher highs/lows OR lower highs/lows), betting with them has edge because they've proven they absorb opposing pressure. You're joining the winning team. This edge is strongest when structure is clear and recent.

**Location edge (ranging markets):**
In balanced markets, edge comes from extremes. At range support, sellers are exhausted - they've pushed price down but can't break through. At range resistance, buyers are exhausted. The middle of a range has no location edge - you're equally far from both boundaries.

**Information edge (sweeps):**
When price sweeps a level (pokes beyond then reverses), the market just revealed something. A bullish sweep shows that selling pressure got absorbed - demand exists below that level. If the proposed trade aligns with this information, confidence increases. If it contradicts this information, you're betting against what the market just showed you.

## WHAT DESTROYS EDGE

**When the Direction Agent couldn't find edge:**
If the Direction Agent said NEUTRAL or showed low confidence, this is valuable information. It means that after analyzing the market, they couldn't identify which side has edge. This happens in range middles, during consolidation, or when signals conflict badly.

A NEUTRAL direction finding doesn't mean "flip a coin and trade anyway with normal size." It means "the analysis couldn't find meaningful edge." When you're evaluating such a trade, your edge estimate should reflect this - the directional analysis itself is telling you the edge is thin or nonexistent. These are the situations where sizing down significantly or skipping entirely makes sense.

**Trading against structure without justification:**
If structure says sellers are dominant (downtrend) and we want to go long, we're betting against the side that has been winning. This CAN work - trends do reverse - but the burden of proof is higher. You need a clear reason why NOW is different. Without that reason, you're hoping, not trading edge.

**Deep pullbacks and what they mean:**
When a move retraces 70%, 80%, 90%, the dominant side is failing to defend. In an uptrend, buyers "should" step in at 38%, 50%, 62% - standard retracement levels. If price blows through all of those, buyers are either absent or overwhelmed. The trend thesis weakens with every support level that fails to hold.

This doesn't mean the trade is dead - but it means your edge estimate should reflect this weakness. The same setup at 50% retracement vs 90% retracement has meaningfully different edge.

**Sweep conflicts:**
If there was a bearish sweep (price spiked above highs, got rejected hard) and we want to go long, we're directly contradicting information the market just provided. The sweep told us "longs got trapped up there." Going long after that is betting the market lied. Sometimes it did - but this should significantly reduce your edge estimate.

**Range middles:**
In a range, edge comes from location. At 10% (near support) or 90% (near resistance), you have location edge. At 50%, you're in no-man's land. Both outcomes are equally probable. If the direction agent picked a side in a range middle, they were forced to choose, but there's no real edge to size up on.

## COUNTER-TREND: THE HIGHEST BAR

Going against established structure is not automatically wrong - reversals are real. But the edge calculation is fundamentally different:

With trend: Structure supports you. You need the trend to continue (high base rate).
Counter-trend: Structure opposes you. You need the trend to reverse (low base rate).

For counter-trend to have real edge, you need EVIDENCE that reversal is happening - not just "price is at a level." Sweeps in your favor, momentum divergence, structure break, failed breakout. Without that evidence, counter-trend is low edge regardless of how good the "level" looks.

## YOUR OUTPUT

Think through the edge sources and edge destroyers. Arrive at a probability that reflects your genuine assessment of how tilted this trade is in our favor.

The probability and your assessment must be consistent. If you describe the trade as weak or conflicted, a high probability makes no sense. If you describe it as a strong aligned setup, a low probability makes no sense. Let your reasoning drive the number.

You MUST respond with ONLY valid JSON:
{
  "probability": number between 0.10 and 0.90,
  "conviction_level": "HIGH" | "MODERATE" | "LOW" | "NONE",
  "assessment": "One sentence summary - is this trade strong, decent, weak, or broken?",
  "what_works": "What creates edge in this setup?",
  "what_concerns": "What reduces or destroys edge?",
  "edge_source": "Primary source: trend, location, sweep, momentum, or unclear",
  "sizing_recommendation": "FULL" | "NORMAL" | "REDUCED" | "MINIMUM" | "SKIP"
}`;

/**
 * Call GPT-5.2 via the /v1/responses endpoint
 */
async function callGPT5(systemPrompt, userPrompt) {
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: [
        {
          role: "system",
          content: systemPrompt + "\n\nProduce a final textual answer. Do not stop at reasoning. Output plain text only."
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error(data);
    throw new Error(data?.error?.message || "OpenAI GPT-5.2 request failed");
  }

  // Extract text from GPT-5.2 response format
  const text = data.output
    ?.flatMap(item =>
      item.type === "message"
        ? item.content
            ?.filter(c => c.type === "output_text")
            ?.map(c => c.text) ?? []
        : []
    )
    .join("")
    .trim();

  if (!text) {
    throw new Error("Empty GPT-5.2 response");
  }

  return text;
}

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
  // Structure info
  marketRegime = 'UNKNOWN',
  structureState = 0,
  structureLabel = 'UNKNOWN',
  pullbackRatio = 0,
  breakoutScore = 0,
  sweepScore = 0
}) {

  // Position in S/R range
  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

  // Structure alignment
  const structureAligns = (proposedDirection === 'LONG' && structureState === 1) ||
                          (proposedDirection === 'SHORT' && structureState === -1);
  const counterTrend = (proposedDirection === 'LONG' && structureState === -1) ||
                       (proposedDirection === 'SHORT' && structureState === 1);

  // EMA alignment
  const emaAligns = (proposedDirection === 'LONG' && emaSlope > 0) ||
                    (proposedDirection === 'SHORT' && emaSlope < 0);

  // Sweep alignment (sweeps are reversal signals)
  const sweepSupports = (proposedDirection === 'LONG' && sweepScore > 0.2) ||
                        (proposedDirection === 'SHORT' && sweepScore < -0.2);
  const sweepConflicts = (proposedDirection === 'LONG' && sweepScore < -0.2) ||
                         (proposedDirection === 'SHORT' && sweepScore > 0.2);

  const userPrompt = `
## PROPOSED TRADE

**Direction:** ${proposedDirection}
**Direction Agent's Narrative:** "${directionAnalysis.market_narrative || directionAnalysis.trade_idea || 'No narrative provided'}"
**Direction Agent's Confidence:** ${directionAnalysis.confidence || 'Unknown'}
**Direction Agent's Bias:** ${directionAnalysis.primary_bias || 'Unknown'}

## MARKET CONTEXT

**Structure:** ${structureLabel} (${structureState === 1 ? 'buyers control' : structureState === -1 ? 'sellers control' : 'balanced'})
**Regime:** ${marketRegime}
**Position:** ${positionInSR}% between support and resistance

**Key Alignments:**
- Structure ${structureAligns ? 'SUPPORTS' : counterTrend ? 'OPPOSES' : 'is neutral on'} the ${proposedDirection} direction
- EMA slope ${emaAligns ? 'CONFIRMS' : 'does not confirm'} the direction
- ${sweepSupports ? 'Recent sweep SUPPORTS the direction (reversal signal in our favor)' : sweepConflicts ? 'Recent sweep CONFLICTS (reversal signal against us)' : 'No significant sweep signal'}

**Pullback:** ${pullbackRatio ? (pullbackRatio * 100).toFixed(0) + '%' : 'N/A'}
**Breakout Score:** ${breakoutScore.toFixed(2)} (positive = bullish expansion, negative = bearish)

## YOUR TASK

Evaluate this trade's edge. Consider:
- Did the Direction Agent find genuine edge (BULLISH/BEARISH with conviction), or did they say NEUTRAL (meaning they couldn't find edge)?
- Does the direction align with who controls structure, or fight against it?
- Is price at a location where edge exists (trend continuation level, range extreme), or in no-man's land?
- Does recent market action (sweeps, breakouts) support or contradict this direction?
- How much has price already retraced - are the dominant players still defending?

If the Direction Agent's original bias was NEUTRAL, that's critical information - it means the directional analysis couldn't identify meaningful edge. Your probability should be low because the market analysis itself is uncertain.

Your probability should reflect your genuine edge assessment. Let your reasoning drive the number.

Respond with ONLY valid JSON.`;

  const text = await callGPT5(CONFIDENCE_PROMPT, userPrompt);

  // Parse JSON from response
  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  const result = JSON.parse(jsonStr);

  // Ensure probability field exists and is clamped
  if (typeof result.probability !== 'number') {
    result.probability = 0.5;
  }
  result.probability = Math.max(0.10, Math.min(0.90, result.probability));

  return result;
}

module.exports = { assessConfidence };
