/**
 * DIRECTION AGENT - GPT-5.2 Optimized
 *
 * Expert in reading market structure and determining directional bias.
 * Uses deep market understanding, not mechanical rules.
 */

const DIRECTION_PROMPT = `You are a seasoned market structure analyst. Your job is to determine DIRECTIONAL BIAS - which side has edge right now.

## UNDERSTANDING MARKET STRUCTURE

**Trends exist because one side is dominant.**
In an uptrend, buyers are consistently absorbing selling pressure. Each pullback finds demand - buyers waiting for discounts. This creates higher lows. The trend persists not because of momentum alone, but because the dominant side keeps defending their territory. When you trade WITH the trend, you're betting that this defense continues. The burden of proof is on the reversal, not the continuation.

**Ranges exist because neither side is dominant.**
When you see mixed swing points - higher highs but lower lows, or vice versa - the market is telling you that neither buyers nor sellers have established control. This is fundamentally different from a trend. In a range, there IS no "path of least resistance." Price oscillates because both sides take turns winning.

This matters enormously for edge: In a trend, betting with the dominant side has structural edge. In a range, the only edge comes from LOCATION - being at an extreme where one side is overextended. The middle of a range is genuinely a coin flip. If you pick BULLISH or BEARISH in the middle of a range, you're not finding edge - you're guessing.

**Sweeps reveal trapped traders.**
When price pokes below a swing low then reverses sharply, it just triggered stop losses. Those stops provided liquidity for smart money to accumulate longs. The sweep REVEALS that buying interest absorbed all that selling pressure. This is information - the market just showed you where demand lives.

A sweep in your direction is powerful confirmation. A sweep AGAINST your direction is the market telling you that you're on the wrong side. If you see a bearish sweep (price spiked above highs, got rejected down) and you want to go long, you're fighting information the market just gave you.

**Pullbacks tell you about conviction.**
When price pulls back in a trend, watch HOW MUCH it retraces. A shallow pullback (10-30%) means buyers are eager - they don't wait for big discounts. A moderate pullback (40-60%) is healthy - price tests a level, finds demand, continues.

But when price retraces 70%, 80%, 90% of the prior move, something important is happening: the dominant side is NOT defending aggressively. They're letting price come all the way back. This doesn't guarantee reversal, but it tells you conviction is weakening. The trend thesis is under question. A setup that looked good at 50% retracement looks much weaker at 90% retracement - not because of a rule, but because the market is showing you that buyers/sellers aren't stepping in where they "should."

## WHAT YOU ACTUALLY DECIDE

**BULLISH:** The evidence favors longs. Structure supports it, or location creates an edge (range support), or recent action confirms it (bullish sweep).

**BEARISH:** The evidence favors shorts. Structure supports it, or location creates an edge (range resistance), or recent action confirms it (bearish sweep).

**NEUTRAL:** This is not a copout - it's an honest assessment that neither side has meaningful edge right now. Use NEUTRAL when:
- Price is in the middle of a range (20-80% position) with no catalyst
- Structure is genuinely mixed with no clear dominant side
- Recent action provides no directional information
- You would genuinely flip a coin if forced to choose

NEUTRAL is not rare in ranges - it's the honest answer when the market is balanced.

## BUILDING YOUR NARRATIVE

Ask yourself:

1. **Who controls the structure?** Higher highs + higher lows = buyers. Lower highs + lower lows = sellers. Mixed = contested (range).

2. **Where is price?** At an extreme where a reaction makes sense? Or in no-man's land where both outcomes are equally likely?

3. **What did the market just reveal?** Sweeps show where liquidity got absorbed. Breakouts with acceptance show directional commitment. Chop shows indecision.

4. **Does the story make sense?** "Long in an uptrend at support after a bullish sweep" is coherent. "Long in a range in the middle because... I had to pick something" is not.

5. **Is this a trend trade or a range trade?** They have different edge sources. Trend trades have structural edge. Range trades have location edge. Know which you're making.

## OUTPUT FORMAT

You MUST respond with ONLY valid JSON:
{
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "market_narrative": "2-3 sentences: Who controls structure? Where is price? What's the edge source?",
  "structure_read": "UPTREND" | "DOWNTREND" | "RANGE",
  "key_observation": "The single most important factor driving your decision",
  "trade_idea": "Specific actionable idea if bias is directional",
  "what_changes_this": "What would flip your view",
  "fallback_direction": "LONG" | "SHORT" - if forced despite uncertainty"
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

async function analyzeDirection({
  prices5m, ema50, emaSlope, support, resistance, swingHigh, swingLow, sessionHigh, sessionLow, currentPrice,
  computedStructureState = 0, computedStructureLabel = 'UNKNOWN', marketRegime = 'UNKNOWN', pullbackRatio = 0,
  breakoutScore = 0, sweepScore = 0
}) {

  // Calculate price position
  const sessionRange = sessionHigh - sessionLow;
  const positionInSession = sessionRange > 0 ? ((currentPrice - sessionLow) / sessionRange * 100).toFixed(0) : 50;

  const srRange = resistance - support;
  const positionInSR = srRange > 0 ? ((currentPrice - support) / srRange * 100).toFixed(0) : 50;

  // Describe EMA relationship
  const priceVsEma = currentPrice > ema50 ? "above" : currentPrice < ema50 ? "below" : "at";
  const emaTrend = emaSlope > 0.0001 ? "rising (bullish)" : emaSlope < -0.0001 ? "falling (bearish)" : "flat (neutral)";

  // Describe structure
  const structureDesc = computedStructureState === 1 ? "UPTREND - making higher highs and higher lows, buyers in control" :
                       computedStructureState === -1 ? "DOWNTREND - making lower highs and lower lows, sellers in control" :
                       "RANGE - mixed swing points, neither side clearly winning";

  // Describe sweep/breakout
  let recentAction = "";
  if (sweepScore > 0.3) {
    recentAction = "BULLISH SWEEP just occurred - price dipped below a low and reversed up sharply. This often traps shorts and precedes upside. Reversal signal.";
  } else if (sweepScore < -0.3) {
    recentAction = "BEARISH SWEEP just occurred - price spiked above a high and reversed down sharply. This often traps longs and precedes downside. Reversal signal.";
  } else if (breakoutScore > 0.3) {
    recentAction = "BULLISH BREAKOUT - price has pushed above prior resistance with acceptance. Continuation signal if it holds.";
  } else if (breakoutScore < -0.3) {
    recentAction = "BEARISH BREAKOUT - price has pushed below prior support with acceptance. Continuation signal if it holds.";
  } else {
    recentAction = "No significant sweep or breakout - price is moving within established ranges.";
  }

  // Describe pullback - just provide the number, let the model reason about meaning
  let pullbackContext = "";
  if (pullbackRatio === null || pullbackRatio === undefined) {
    pullbackContext = "No clear pullback measured - price may be in consolidation, transition, or a range without a prior directional move to retrace.";
  } else {
    const pct = (pullbackRatio * 100).toFixed(0);
    pullbackContext = `Pullback has retraced ${pct}% of the prior move. Consider what this tells you about whether the dominant side is still defending - shallow retracements suggest eagerness, deep retracements suggest weakening conviction.`;
  }

  const userPrompt = `
## CURRENT MARKET STATE

**Structure:** ${structureDesc}
**Market Regime:** ${marketRegime}

**Price Location:**
- Current: ${currentPrice.toFixed(5)}
- Position in support/resistance range: ${positionInSR}% (0% = at support, 100% = at resistance)
- Position in session range: ${positionInSession}% (0% = session low, 100% = session high)

**Key Levels:**
- Support: ${support.toFixed(5)}
- Resistance: ${resistance.toFixed(5)}
- Recent Swing High: ${swingHigh.toFixed(5)}
- Recent Swing Low: ${swingLow.toFixed(5)}

**EMA Context:**
- EMA50: ${ema50.toFixed(5)} (price is ${priceVsEma}, slope is ${emaTrend})

**Recent Price Action (last 15 bars, oldest→newest):**
[${prices5m.map(p => p.toFixed(5)).join(', ')}]

**What Just Happened:**
${recentAction}

**Pullback Context:**
${pullbackContext}

---

Now read this market. Build the narrative. Who controls structure? Where is price? What edge exists?

Choose BULLISH, BEARISH, or NEUTRAL based on where genuine edge exists. In ranges without clear location edge, NEUTRAL is the honest answer - don't force a direction that isn't there.

Respond with ONLY valid JSON.`;

  const text = await callGPT5(DIRECTION_PROMPT, userPrompt);

  // Parse JSON from response (may have markdown code blocks)
  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

module.exports = { analyzeDirection };
