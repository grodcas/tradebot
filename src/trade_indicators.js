/**
 * Trade Indicators Helper
 *
 * Provides session identification, support/resistance calculation,
 * swing point detection, ATR, and EMA calculations for the batch_trainer.
 */

// Session definitions in Zurich time (hours)
const SESSIONS = {
  ASIA: { name: "ASIA", start: 1, end: 10 },      // 01:00 - 10:00 Zurich
  LONDON: { name: "LONDON", start: 8, end: 17 },  // 08:00 - 17:00 Zurich
  NY: { name: "NY", start: 14, end: 22 },         // 14:00 - 22:00 Zurich
};

const SESSION_TZ = "Europe/Zurich";

// ----------------------------
// TIMEZONE HELPERS
// ----------------------------

/**
 * Convert a date to Zurich timezone
 */
function toZurich(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: SESSION_TZ }));
}

/**
 * Get Zurich hour from a date
 */
function getZurichHour(date) {
  const z = toZurich(date);
  return z.getHours();
}

/**
 * Get Zurich date string (YYYY-MM-DD) from a date
 */
function getZurichDateStr(date) {
  const z = toZurich(date);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ----------------------------
// SESSION HELPERS
// ----------------------------

/**
 * Determine the current session based on Zurich hour.
 * Priority: Most recently started session wins.
 */
function getCurrentSession(zurichHour) {
  if (zurichHour >= 14 && zurichHour < 22) {
    return SESSIONS.NY;
  } else if (zurichHour >= 8 && zurichHour < 14) {
    return SESSIONS.LONDON;
  } else if (zurichHour >= 1 && zurichHour < 8) {
    return SESSIONS.ASIA;
  } else {
    return null;
  }
}

/**
 * Get the previous session based on current session.
 */
function getPreviousSession(currentSession) {
  if (!currentSession) return null;

  switch (currentSession.name) {
    case "LONDON":
      return SESSIONS.ASIA;
    case "NY":
      return SESSIONS.LONDON;
    case "ASIA":
      return SESSIONS.NY;
    default:
      return null;
  }
}

/**
 * Get bars from the previous session.
 */
function getPreviousSessionBars(bars5m, anchorIndex, previousSession, anchorDate) {
  if (!previousSession) return [];

  const anchorZurich = toZurich(anchorDate);
  const anchorHour = anchorZurich.getHours();
  const anchorDateStr = getZurichDateStr(anchorDate);

  const sessionBars = [];
  let sessionDateStr = anchorDateStr;

  const currentSession = getCurrentSession(anchorHour);
  if (currentSession && currentSession.name === "ASIA" && previousSession.name === "NY") {
    const prevDay = new Date(anchorZurich);
    prevDay.setDate(prevDay.getDate() - 1);
    sessionDateStr = getZurichDateStr(prevDay);
  }

  for (let i = 0; i < anchorIndex; i++) {
    const bar = bars5m[i];
    const barZurich = toZurich(bar._d);
    const barHour = barZurich.getHours();
    const barDateStr = getZurichDateStr(bar._d);

    const isInSessionHours = barHour >= previousSession.start && barHour < previousSession.end;

    if (previousSession.name === "ASIA" && currentSession && currentSession.name === "LONDON") {
      if (barDateStr === anchorDateStr && isInSessionHours) {
        if (bar._t < anchorDate.getTime()) {
          sessionBars.push(bar);
        }
      }
    } else if (previousSession.name === "LONDON" && currentSession && currentSession.name === "NY") {
      if (barDateStr === anchorDateStr && isInSessionHours) {
        if (bar._t < anchorDate.getTime()) {
          sessionBars.push(bar);
        }
      }
    } else if (previousSession.name === "NY" && currentSession && currentSession.name === "ASIA") {
      if (barDateStr === sessionDateStr && isInSessionHours) {
        sessionBars.push(bar);
      }
    }
  }

  return sessionBars;
}

// ----------------------------
// SUPPORT/RESISTANCE
// ----------------------------

/**
 * Calculate the nth percentile of a sorted array
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];

  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedArr[lower];
  }

  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

/**
 * Calculate support and resistance levels from session bars.
 * Also returns raw session high and low.
 */
function calculateSupportResistance(sessionBars) {
  if (!sessionBars || sessionBars.length < 5) {
    return null;
  }

  const highs = sessionBars.map(b => b.high).sort((a, b) => a - b);
  const lows = sessionBars.map(b => b.low).sort((a, b) => a - b);

  const resistance = percentile(highs, 95);
  const support = percentile(lows, 5);

  // Raw high and low (absolute max/min)
  const rawHigh = Math.max(...sessionBars.map(b => b.high));
  const rawLow = Math.min(...sessionBars.map(b => b.low));

  return { support, resistance, rawHigh, rawLow };
}

// ----------------------------
// SWING POINTS
// ----------------------------

/**
 * Find swing points in bars (typically 30-minute bars).
 * Uses 48 bars for structure analysis.
 *
 * Swing High at candle t if:
 *   High(t) > High(t-1) AND High(t) > High(t-2) AND
 *   High(t) > High(t+1) AND High(t) > High(t+2)
 *
 * Swing Low at candle t if:
 *   Low(t) < Low(t-1) AND Low(t) < Low(t-2) AND
 *   Low(t) < Low(t+1) AND Low(t) < Low(t+2)
 */
function findSwingPoints(bars) {
  const swingHighs = [];
  const swingLows = [];

  if (!bars || bars.length < 5) {
    return { swingHighs, swingLows };
  }

  // We need 2 bars before and 2 bars after, so valid range is [2, length-3]
  for (let t = 2; t < bars.length - 2; t++) {
    const current = bars[t];
    const prev1 = bars[t - 1];
    const prev2 = bars[t - 2];
    const next1 = bars[t + 1];
    const next2 = bars[t + 2];

    const isSwingHigh =
      current.high > prev1.high &&
      current.high > prev2.high &&
      current.high > next1.high &&
      current.high > next2.high;

    if (isSwingHigh) {
      swingHighs.push({
        index: t,
        price: current.high,
        time: current._d ? current._d.toISOString() : null,
        _t: current._t,
      });
    }

    const isSwingLow =
      current.low < prev1.low &&
      current.low < prev2.low &&
      current.low < next1.low &&
      current.low < next2.low;

    if (isSwingLow) {
      swingLows.push({
        index: t,
        price: current.low,
        time: current._d ? current._d.toISOString() : null,
        _t: current._t,
      });
    }
  }

  return { swingHighs, swingLows };
}

// ----------------------------
// STRUCTURE STATE
// ----------------------------

/**
 * Calculate structure state from swing points.
 *
 * From confirmed swings, get:
 *   SH1 = Last confirmed swing high
 *   SH0 = Previous swing high before SH1
 *   SL1 = Last confirmed swing low
 *   SL0 = Previous swing low before SL1
 *
 * Structure:
 *   Uptrend (+1): SH1.price > SH0.price AND SL1.price > SL0.price
 *   Downtrend (-1): SH1.price < SH0.price AND SL1.price < SL0.price
 *   Range (0): Otherwise or not enough swings
 *
 * @param {Object} swingPoints - { swingHighs, swingLows } from findSwingPoints
 * @returns {Object} Structure analysis
 */
function calculateStructureState(swingPoints, atr30m) {
  const { swingHighs, swingLows } = swingPoints;

  // Need at least 2 swing highs and 2 swing lows
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      structureState: 0,
      structureLabel: "RANGE",
      reason: "Not enough swing points (need at least 2 highs and 2 lows)",
      SH1: null,
      SH0: null,
      SL1: null,
      SL0: null,
    };
  }

  // Get last two swing highs (sorted by time/index, most recent last)
  const sortedHighs = [...swingHighs].sort((a, b) => a.index - b.index);
  const SH1 = sortedHighs[sortedHighs.length - 1];  // Last (most recent)
  const SH0 = sortedHighs[sortedHighs.length - 2];  // Previous

  // Get last two swing lows (sorted by time/index, most recent last)
  const sortedLows = [...swingLows].sort((a, b) => a.index - b.index);
  const SL1 = sortedLows[sortedLows.length - 1];  // Last (most recent)
  const SL0 = sortedLows[sortedLows.length - 2];  // Previous

  // ATR-based noise tolerance: differences < 0.2 × ATR_30m are treated as EQUAL
  // Without this, a 0.8-pip difference on a 7.5-pip ATR market triggers structure labels
  const tolerance = (atr30m || 0) * 0.2;

  const highDiff = SH1.price - SH0.price;
  const lowDiff = SL1.price - SL0.price;

  const higherHighs = highDiff > tolerance;
  const lowerHighs = highDiff < -tolerance;
  const equalHighs = !higherHighs && !lowerHighs;

  const higherLows = lowDiff > tolerance;
  const lowerLows = lowDiff < -tolerance;
  const equalLows = !higherLows && !lowerLows;

  let structureState = 0;
  let structureLabel = "RANGE";
  let reason = "";

  // UPTREND: need HH+HL (or one equal + one clearly higher)
  if ((higherHighs || equalHighs) && (higherLows || equalLows) && (higherHighs || higherLows)) {
    structureState = 1;
    structureLabel = "UPTREND";
    const hhDesc = higherHighs ? "HH" : "EQ";
    const hlDesc = higherLows ? "HL" : "EQ";
    reason = `${hhDesc} (${SH0.price.toFixed(5)} → ${SH1.price.toFixed(5)}) + ${hlDesc} (${SL0.price.toFixed(5)} → ${SL1.price.toFixed(5)})`;
  // DOWNTREND: need LH+LL (or one equal + one clearly lower)
  } else if ((lowerHighs || equalHighs) && (lowerLows || equalLows) && (lowerHighs || lowerLows)) {
    structureState = -1;
    structureLabel = "DOWNTREND";
    const lhDesc = lowerHighs ? "LH" : "EQ";
    const llDesc = lowerLows ? "LL" : "EQ";
    reason = `${lhDesc} (${SH0.price.toFixed(5)} → ${SH1.price.toFixed(5)}) + ${llDesc} (${SL0.price.toFixed(5)} → ${SL1.price.toFixed(5)})`;
  } else {
    structureState = 0;
    structureLabel = "RANGE";
    const hhLabel = higherHighs ? "HH" : lowerHighs ? "LH" : "EQ";
    const hlLabel = higherLows ? "HL" : lowerLows ? "LL" : "EQ";
    reason = `Mixed/equal structure: highs=${hhLabel}, lows=${hlLabel} (tolerance=${(tolerance*10000).toFixed(1)}pips)`;
  }

  return {
    structureState,
    structureLabel,
    reason,
    SH1: { index: SH1.index, price: SH1.price },
    SH0: { index: SH0.index, price: SH0.price },
    SL1: { index: SL1.index, price: SL1.price },
    SL0: { index: SL0.index, price: SL0.price },
    totalSwingHighs: swingHighs.length,
    totalSwingLows: swingLows.length,
  };
}

// ----------------------------
// BREAKOUT SCORE
// ----------------------------

/**
 * Clamp helper function
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate Breakout Score for session opening.
 *
 * Measures how strongly price is breaking out of previous session levels.
 *
 * Components:
 * 1. Distance Score: How far price is beyond robust high/low (normalized by ATR)
 * 2. Body Score: Candle body strength relative to ATR
 * 3. Range Score: Range expansion relative to ATR
 *
 * @param {Object} params
 * @param {Object} params.currentBar - Current bar with open, high, low, close
 * @param {number} params.robustHigh - 95th percentile resistance from prev session
 * @param {number} params.robustLow - 5th percentile support from prev session
 * @param {number} params.ATR_5m - 5-minute ATR
 * @returns {Object} Breakout analysis
 */
function calculateBreakoutScore({ currentBar, robustHigh, robustLow, ATR_5m }) {
  // Validate inputs
  if (!currentBar || !ATR_5m || ATR_5m <= 0 || robustHigh === null || robustLow === null) {
    return {
      breakoutScore: 0,
      bullScore: 0,
      bearScore: 0,
      components: null,
      breakoutDirection: "NONE",
      isBreakout: false,
    };
  }

  const { open, high, low, close } = currentBar;

  // ----------------------------
  // Step 1: Distance Scores
  // ----------------------------
  // How far price is beyond the boundary
  const d_up = close - robustHigh;    // Positive if above resistance
  const d_down = robustLow - close;   // Positive if below support

  // Normalize by volatility
  const nd_up = d_up / ATR_5m;
  const nd_down = d_down / ATR_5m;

  // Convert to smooth score using sigmoid-like clamp
  // If price is 0.5 ATR above level → score ≈ 1
  const score_up = clamp(nd_up / 0.5, 0, 1);
  const score_down = clamp(nd_down / 0.5, 0, 1);

  // ----------------------------
  // Step 2: Body Strength Component
  // ----------------------------
  // Strong breakout candles have large bodies
  const bodyRatio = Math.abs(close - open) / ATR_5m;
  const bodyScore = clamp(bodyRatio / 0.5, 0, 1);

  // Determine if bullish or bearish body
  const isBullishBody = close > open;

  // ----------------------------
  // Step 3: Range Expansion (Volume Proxy)
  // ----------------------------
  // Big range expansion indicates stronger breakout
  const rangeRatio = (high - low) / ATR_5m;
  const rangeScore = clamp(rangeRatio / 1.2, 0, 1);

  // ----------------------------
  // Step 4: Combine Components
  // ----------------------------
  // Bullish breakout score
  const bullScore = 0.5 * score_up + 0.3 * bodyScore + 0.2 * rangeScore;

  // Bearish breakout score
  const bearScore = 0.5 * score_down + 0.3 * bodyScore + 0.2 * rangeScore;

  // ----------------------------
  // Step 5: Final Breakout Score
  // ----------------------------
  // Positive = bullish breakout, Negative = bearish breakout
  const breakoutScore = bullScore - bearScore;

  // Determine breakout direction and strength
  let breakoutDirection = "NONE";
  let isBreakout = false;

  if (breakoutScore > 0.3) {
    breakoutDirection = "BULLISH";
    isBreakout = true;
  } else if (breakoutScore < -0.3) {
    breakoutDirection = "BEARISH";
    isBreakout = true;
  }

  return {
    breakoutScore: breakoutScore,
    bullScore: bullScore,
    bearScore: bearScore,
    breakoutDirection: breakoutDirection,
    isBreakout: isBreakout,
    components: {
      // Distance from levels
      d_up: d_up,
      d_down: d_down,
      nd_up: nd_up,
      nd_down: nd_down,
      score_up: score_up,
      score_down: score_down,
      // Body strength
      bodyRatio: bodyRatio,
      bodyScore: bodyScore,
      isBullishBody: isBullishBody,
      // Range expansion
      rangeRatio: rangeRatio,
      rangeScore: rangeScore,
    },
  };
}

// ----------------------------
// SWEEP DETECTION
// ----------------------------

/**
 * Calculate Sweep Detection Score.
 *
 * Detects liquidity sweeps (stop hunts) where price briefly penetrates a level
 * then rejects back. Measures:
 * 1. Penetration depth (how far beyond the level)
 * 2. Rejection strength (wick size)
 * 3. Close positioning (did price close back inside)
 * 4. Acceptance penalty (did price continue beyond in next bars)
 *
 * @param {Object} params
 * @param {Object} params.currentBar - Current bar with open, high, low, close
 * @param {number} params.sessionHigh - Previous session high (LondonHigh)
 * @param {number} params.sessionLow - Previous session low (LondonLow)
 * @param {number} params.ATR_5m - 5-minute ATR
 * @param {Array} params.nextBars - Next 3 bars for acceptance check (optional)
 * @returns {Object} Sweep analysis
 */
function calculateSweepScore({ currentBar, sessionHigh, sessionLow, ATR_5m, nextBars = [] }) {
  // Validate inputs
  if (!currentBar || !ATR_5m || ATR_5m <= 0 || sessionHigh === null || sessionLow === null) {
    return {
      sweepScore: 0,
      bullSweep: 0,
      bearSweep: 0,
      sweepDirection: "NONE",
      isSweep: false,
      components: null,
    };
  }

  const { open, high, low, close } = currentBar;
  const SMALL = 0.000001; // Prevent division by zero

  // ============================================
  // BEARISH SWEEP (price went above sessionHigh)
  // ============================================

  // STEP 1: Penetration Component
  const bearPenetration = high - sessionHigh;
  const bearNormPen = bearPenetration / ATR_5m;
  const bearPenScore = clamp(bearNormPen / 0.5, 0, 1);

  // STEP 2: Rejection Component (Upper Wick Strength)
  const upperWick = high - Math.max(open, close);
  const body = Math.abs(close - open);
  const bearWickRatio = upperWick / Math.max(body, SMALL);
  const bearWickScore = clamp(bearWickRatio / 2.0, 0, 1);

  // STEP 3: Close Positioning (should close back below sessionHigh)
  const bearCloseDistance = sessionHigh - close;
  const bearNormClose = bearCloseDistance / ATR_5m;
  const bearCloseScore = clamp(bearNormClose / 0.3, 0, 1);

  // STEP 4: Acceptance Penalty (consecutive closes above sessionHigh)
  let bearAcceptanceTime = 0;
  for (const bar of nextBars) {
    if (bar && bar.close > sessionHigh) {
      bearAcceptanceTime++;
    } else {
      break;
    }
  }
  const bearAcceptPenalty = clamp(bearAcceptanceTime / 3, 0, 1);

  // STEP 5: Combine for bearish sweep
  let bearSweep = 0.4 * bearPenScore + 0.3 * bearWickScore + 0.3 * bearCloseScore - 0.5 * bearAcceptPenalty;
  bearSweep = clamp(bearSweep, 0, 1);

  // Only count as sweep if there was actual penetration
  if (bearPenetration <= 0) {
    bearSweep = 0;
  }

  // ============================================
  // BULLISH SWEEP (price went below sessionLow)
  // ============================================

  // STEP 1: Penetration Component
  const bullPenetration = sessionLow - low;
  const bullNormPen = bullPenetration / ATR_5m;
  const bullPenScore = clamp(bullNormPen / 0.5, 0, 1);

  // STEP 2: Rejection Component (Lower Wick Strength)
  const lowerWick = Math.min(open, close) - low;
  const bullWickRatio = lowerWick / Math.max(body, SMALL);
  const bullWickScore = clamp(bullWickRatio / 2.0, 0, 1);

  // STEP 3: Close Positioning (should close back above sessionLow)
  const bullCloseDistance = close - sessionLow;
  const bullNormClose = bullCloseDistance / ATR_5m;
  const bullCloseScore = clamp(bullNormClose / 0.3, 0, 1);

  // STEP 4: Acceptance Penalty (consecutive closes below sessionLow)
  let bullAcceptanceTime = 0;
  for (const bar of nextBars) {
    if (bar && bar.close < sessionLow) {
      bullAcceptanceTime++;
    } else {
      break;
    }
  }
  const bullAcceptPenalty = clamp(bullAcceptanceTime / 3, 0, 1);

  // STEP 5: Combine for bullish sweep
  let bullSweep = 0.4 * bullPenScore + 0.3 * bullWickScore + 0.3 * bullCloseScore - 0.5 * bullAcceptPenalty;
  bullSweep = clamp(bullSweep, 0, 1);

  // Only count as sweep if there was actual penetration
  if (bullPenetration <= 0) {
    bullSweep = 0;
  }

  // ============================================
  // STEP 6: Final Sweep Score
  // ============================================
  // +1 = strong bullish sweep (below low, rejected up)
  // -1 = strong bearish sweep (above high, rejected down)
  const sweepScore = bullSweep - bearSweep;

  // Determine sweep direction
  let sweepDirection = "NONE";
  let isSweep = false;

  if (sweepScore > 0.2) {
    sweepDirection = "BULLISH";
    isSweep = true;
  } else if (sweepScore < -0.2) {
    sweepDirection = "BEARISH";
    isSweep = true;
  }

  return {
    sweepScore: sweepScore,
    bullSweep: bullSweep,
    bearSweep: bearSweep,
    sweepDirection: sweepDirection,
    isSweep: isSweep,
    components: {
      // Bearish sweep components
      bear: {
        penetration: bearPenetration,
        normPen: bearNormPen,
        penScore: bearPenScore,
        wickRatio: bearWickRatio,
        wickScore: bearWickScore,
        closeDistance: bearCloseDistance,
        closeScore: bearCloseScore,
        acceptanceTime: bearAcceptanceTime,
        acceptPenalty: bearAcceptPenalty,
      },
      // Bullish sweep components
      bull: {
        penetration: bullPenetration,
        normPen: bullNormPen,
        penScore: bullPenScore,
        wickRatio: bullWickRatio,
        wickScore: bullWickScore,
        closeDistance: bullCloseDistance,
        closeScore: bullCloseScore,
        acceptanceTime: bullAcceptanceTime,
        acceptPenalty: bullAcceptPenalty,
      },
    },
  };
}

// ----------------------------
// MARKET REGIME
// ----------------------------

/**
 * Calculate EMA50 slope (normalized by ATR).
 *
 * slope_raw = EMA50(t) - EMA50(t - k)
 * slope = slope_raw / ATR_30m
 *
 * k = 3 candles (90 minutes on 30m timeframe)
 *
 * @param {Object} params
 * @param {number} params.EMA50_current - EMA50 at current bar
 * @param {number} params.EMA50_kBarsAgo - EMA50 at k bars ago
 * @param {number} params.ATR_30m - Current ATR on 30m timeframe
 * @returns {Object} Slope analysis
 */
function calculateEMASlope({ EMA50_current, EMA50_kBarsAgo, ATR_30m }) {
  if (!EMA50_current || !EMA50_kBarsAgo || !ATR_30m || ATR_30m <= 0) {
    return {
      slopeRaw: null,
      slope: null,
      direction: "FLAT",
    };
  }

  const slopeRaw = EMA50_current - EMA50_kBarsAgo;
  const slope = slopeRaw / ATR_30m;

  let direction = "FLAT";
  if (slope > 0.1) direction = "UP";
  else if (slope < -0.1) direction = "DOWN";

  return {
    slopeRaw,
    slope,
    direction,
  };
}

/**
 * Calculate median of an array.
 */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calculate Market Regime.
 *
 * Classifies market as TREND, EXPANSION, or RANGE.
 *
 * TREND conditions (all must be true):
 *   - structureState ≠ 0
 *   - abs(EMA50 - EMA200) > 0.5 × ATR_30m
 *   - EMA50 slope consistent with structure (positive for uptrend, negative for downtrend)
 *
 * EXPANSION conditions (any one):
 *   - |breakoutScore| > 0.6
 *   - ATR_5m > 1.5 × median(ATR_5m last 20)
 *
 * RANGE: neither TREND nor EXPANSION
 *
 * Priority: TREND > EXPANSION > RANGE
 *
 * @param {Object} params
 * @returns {Object} Market regime analysis
 */
function calculateMarketRegime({
  structureState,
  EMA50_30m,
  EMA200_30m,
  ATR_30m,
  ATR_5m,
  EMA50_kBarsAgo,
  breakoutScore,
  ATR_5m_median20,
}) {
  // Validate inputs
  if (!EMA50_30m || !EMA200_30m || !ATR_30m || !ATR_5m) {
    return {
      regime: "RANGE",
      isTrend: false,
      isExpansion: false,
      components: null,
    };
  }

  // Calculate EMA slope
  const slopeAnalysis = calculateEMASlope({
    EMA50_current: EMA50_30m,
    EMA50_kBarsAgo,
    ATR_30m,
  });

  // ----------------------------
  // Check TREND conditions
  // ----------------------------
  const hasStructure = structureState !== 0;
  const emaSpread = Math.abs(EMA50_30m - EMA200_30m);
  const emaSpreadThreshold = 0.5 * ATR_30m;
  const hasEmaSpread = emaSpread > emaSpreadThreshold;

  // Slope consistent: uptrend needs slope > 0.05, downtrend needs slope < -0.05
  // Threshold aligned with agent's FLAT classification (between -0.05 and +0.05)
  // Without this, a near-zero slope like -0.02 would count as "consistent" with downtrend
  // but the agent would describe it as "FLAT" — creating contradictory TREND + FLAT signals
  let slopeConsistent = false;
  if (slopeAnalysis.slope !== null) {
    if (structureState === 1 && slopeAnalysis.slope > 0.05) {
      slopeConsistent = true;
    } else if (structureState === -1 && slopeAnalysis.slope < -0.05) {
      slopeConsistent = true;
    }
  }

  const isTrend = hasStructure && hasEmaSpread && slopeConsistent;

  // ----------------------------
  // Check EXPANSION conditions
  // ----------------------------
  const hasBreakout = Math.abs(breakoutScore || 0) > 0.6;

  let hasVolExpansion = false;
  let volExpansionRatio = null;
  if (ATR_5m_median20 && ATR_5m_median20 > 0) {
    volExpansionRatio = ATR_5m / ATR_5m_median20;
    hasVolExpansion = volExpansionRatio > 1.5;
  }

  const isExpansion = hasBreakout || hasVolExpansion;

  // ----------------------------
  // Determine regime (TREND has priority)
  // ----------------------------
  let regime = "RANGE";
  if (isTrend) {
    regime = "TREND";
  } else if (isExpansion) {
    regime = "EXPANSION";
  }

  return {
    regime,
    isTrend,
    isExpansion,
    components: {
      // TREND components
      hasStructure,
      structureState,
      emaSpread,
      emaSpreadThreshold,
      hasEmaSpread,
      slope: slopeAnalysis.slope,
      slopeRaw: slopeAnalysis.slopeRaw,
      slopeDirection: slopeAnalysis.direction,
      slopeConsistent,
      // EXPANSION components
      breakoutScore: breakoutScore || 0,
      hasBreakout,
      ATR_5m,
      ATR_5m_median20,
      volExpansionRatio,
      hasVolExpansion,
    },
  };
}

// ----------------------------
// ACCEPTANCE TIME
// ----------------------------

/**
 * Calculate Acceptance Time.
 *
 * Measures how long price has been accepted beyond a key level,
 * based on the dominant event (breakout or sweep).
 *
 * Step 1: Determine context (breakout vs sweep based on magnitude)
 * Step 2: Determine relevant level
 *   - Breakout > 0: resistance (robust high)
 *   - Breakout < 0: support (robust low)
 *   - Sweep < 0 (bearish): prevSessionHigh
 *   - Sweep > 0 (bullish): prevSessionLow
 * Step 3: Count backward how many bars closed beyond level
 * Step 4: Normalize by 6 (30 min = 6 x 5m bars)
 *
 * @param {Object} params
 * @param {number} params.breakoutScore - Breakout score (-1 to 1)
 * @param {number} params.sweepScore - Sweep score (-1 to 1)
 * @param {number} params.resistance - Robust high (95th percentile)
 * @param {number} params.support - Robust low (5th percentile)
 * @param {number} params.prevSessionHigh - Raw session high
 * @param {number} params.prevSessionLow - Raw session low
 * @param {Array} params.bars5mUpToAnchor - 5m bars up to anchor (for backward counting)
 * @returns {Object} Acceptance analysis
 */
function calculateAcceptanceTime({
  breakoutScore,
  sweepScore,
  resistance,
  support,
  prevSessionHigh,
  prevSessionLow,
  bars5mUpToAnchor,
}) {
  // Step 1: Determine Context
  const absBreakout = Math.abs(breakoutScore || 0);
  const absSweep = Math.abs(sweepScore || 0);

  let context = "NONE";
  if (absBreakout >= absSweep && absBreakout > 0) {
    context = "BREAKOUT";
  } else if (absSweep > absBreakout && absSweep > 0) {
    context = "SWEEP";
  }

  if (context === "NONE") {
    return {
      acceptanceTime: 0,
      rawCount: 0,
      context: "NONE",
      level: null,
      direction: null,
    };
  }

  // Step 2: Determine Relevant Level
  let level = null;
  let direction = null; // "ABOVE" or "BELOW"

  if (context === "BREAKOUT") {
    if (breakoutScore > 0) {
      level = resistance; // Robust high from prev session
      direction = "ABOVE"; // beyond means Close > Level
    } else {
      level = support; // Robust low from prev session
      direction = "BELOW"; // beyond means Close < Level
    }
  } else { // SWEEP
    if (sweepScore < 0) {
      // Bearish sweep (price went above high, rejected down)
      level = prevSessionHigh;
      direction = "ABOVE"; // beyond means Close > Level
    } else {
      // Bullish sweep (price went below low, rejected up)
      level = prevSessionLow;
      direction = "BELOW"; // beyond means Close < Level
    }
  }

  if (level === null || !bars5mUpToAnchor || bars5mUpToAnchor.length === 0) {
    return {
      acceptanceTime: 0,
      rawCount: 0,
      context,
      level: null,
      direction: null,
    };
  }

  // Step 3: Count Backward From T
  let count = 0;
  for (let i = bars5mUpToAnchor.length - 1; i >= 0; i--) {
    const bar = bars5mUpToAnchor[i];
    const isBeyond = direction === "ABOVE"
      ? bar.close > level
      : bar.close < level;

    if (isBeyond) {
      count++;
    } else {
      break; // Stop when price closes back inside the level
    }
  }

  // Step 4: Normalize (6 bars = 30 minutes)
  const acceptanceTime = clamp(count / 6, 0, 1);

  return {
    acceptanceTime,
    rawCount: count,
    context,
    level,
    direction,
  };
}

// ----------------------------
// PULLBACK RATIO
// ----------------------------

/**
 * Calculate Pullback Ratio.
 *
 * Measures how deep a retracement is relative to the prior impulse.
 * Impulse defined on 30m swings, retracement measured on 5m.
 *
 * UPTREND:
 *   ImpulseLow = swing low that preceded lastSwingHigh
 *   ImpulseHigh = lastSwingHigh (SH1)
 *   PullbackLow = lowest 5m low from SH1 to anchor
 *   pullbackRatio = (ImpulseHigh - PullbackLow) / ImpulseRange
 *
 * DOWNTREND:
 *   ImpulseHigh = swing high that preceded lastSwingLow
 *   ImpulseLow = lastSwingLow (SL1)
 *   PullbackHigh = highest 5m high from SL1 to anchor
 *   pullbackRatio = (PullbackHigh - ImpulseLow) / ImpulseRange
 *
 * @param {Object} params
 * @param {number} params.structureState - 1 (uptrend), -1 (downtrend), 0 (range)
 * @param {Array} params.swingHighs - Array of swing highs with index, price, _t
 * @param {Array} params.swingLows - Array of swing lows with index, price, _t
 * @param {Array} params.bars30mForSwings - 30m bars used for swing detection
 * @param {Array} params.bars5mUpToAnchor - 5m bars up to anchor
 * @returns {Object} Pullback ratio analysis
 */
function calculatePullbackRatio({
  structureState,
  swingHighs,
  swingLows,
  bars30mForSwings,
  bars5mUpToAnchor,
}) {
  // No impulse in RANGE or insufficient swings
  if (structureState === 0 || !swingHighs || !swingLows) {
    return {
      pullbackRatio: null,
      impulseRange: null,
      retraceDistance: null,
      impulseHigh: null,
      impulseLow: null,
      pullbackExtreme: null,
      direction: null,
    };
  }

  const sortedHighs = [...swingHighs].sort((a, b) => a.index - b.index);
  const sortedLows = [...swingLows].sort((a, b) => a.index - b.index);

  if (structureState === 1) {
    // UPTREND
    if (sortedHighs.length < 1 || sortedLows.length < 1) {
      return { pullbackRatio: null, direction: "UP" };
    }

    const SH1 = sortedHighs[sortedHighs.length - 1]; // Last swing high

    // Find the swing low that preceded SH1
    const lowsBeforeSH1 = sortedLows.filter(sl => sl.index < SH1.index);
    if (lowsBeforeSH1.length === 0) {
      return { pullbackRatio: null, direction: "UP" };
    }
    const impulseLowSwing = lowsBeforeSH1[lowsBeforeSH1.length - 1];

    // Get 5m bars from SH1 to anchor
    if (!bars30mForSwings || SH1.index >= bars30mForSwings.length) {
      return { pullbackRatio: null, direction: "UP" };
    }
    const sh1Timestamp = bars30mForSwings[SH1.index]._t;
    const bars5mAfterSH1 = bars5mUpToAnchor.filter(b => b._t > sh1Timestamp);

    if (bars5mAfterSH1.length === 0) {
      // No bars after SH1 yet, no pullback measured
      return {
        pullbackRatio: 0,
        impulseRange: SH1.price - impulseLowSwing.price,
        retraceDistance: 0,
        impulseHigh: SH1.price,
        impulseLow: impulseLowSwing.price,
        pullbackExtreme: SH1.price,
        direction: "UP",
      };
    }

    const impulseHigh = SH1.price;
    const impulseLow = impulseLowSwing.price;
    const impulseRange = impulseHigh - impulseLow;

    if (impulseRange <= 0) {
      return { pullbackRatio: null, direction: "UP" };
    }

    const pullbackLow = Math.min(...bars5mAfterSH1.map(b => b.low));
    const retraceDistance = impulseHigh - pullbackLow;
    const pullbackRatio = retraceDistance / impulseRange;

    return {
      pullbackRatio,
      impulseRange,
      retraceDistance,
      impulseHigh,
      impulseLow,
      pullbackExtreme: pullbackLow,
      direction: "UP",
    };

  } else if (structureState === -1) {
    // DOWNTREND
    if (sortedHighs.length < 1 || sortedLows.length < 1) {
      return { pullbackRatio: null, direction: "DOWN" };
    }

    const SL1 = sortedLows[sortedLows.length - 1]; // Last swing low

    // Find the swing high that preceded SL1
    const highsBeforeSL1 = sortedHighs.filter(sh => sh.index < SL1.index);
    if (highsBeforeSL1.length === 0) {
      return { pullbackRatio: null, direction: "DOWN" };
    }
    const impulseHighSwing = highsBeforeSL1[highsBeforeSL1.length - 1];

    // Get 5m bars from SL1 to anchor
    if (!bars30mForSwings || SL1.index >= bars30mForSwings.length) {
      return { pullbackRatio: null, direction: "DOWN" };
    }
    const sl1Timestamp = bars30mForSwings[SL1.index]._t;
    const bars5mAfterSL1 = bars5mUpToAnchor.filter(b => b._t > sl1Timestamp);

    if (bars5mAfterSL1.length === 0) {
      // No bars after SL1 yet, no pullback measured
      return {
        pullbackRatio: 0,
        impulseRange: impulseHighSwing.price - SL1.price,
        retraceDistance: 0,
        impulseHigh: impulseHighSwing.price,
        impulseLow: SL1.price,
        pullbackExtreme: SL1.price,
        direction: "DOWN",
      };
    }

    const impulseHigh = impulseHighSwing.price;
    const impulseLow = SL1.price;
    const impulseRange = impulseHigh - impulseLow;

    if (impulseRange <= 0) {
      return { pullbackRatio: null, direction: "DOWN" };
    }

    const pullbackHigh = Math.max(...bars5mAfterSL1.map(b => b.high));
    const retraceDistance = pullbackHigh - impulseLow;
    const pullbackRatio = retraceDistance / impulseRange;

    return {
      pullbackRatio,
      impulseRange,
      retraceDistance,
      impulseHigh,
      impulseLow,
      pullbackExtreme: pullbackHigh,
      direction: "DOWN",
    };
  }

  return { pullbackRatio: null, direction: null };
}

// ----------------------------
// ATR (Average True Range)
// ----------------------------

/**
 * Calculate True Range for a single bar.
 * TR = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
 */
function trueRange(bar, prevClose) {
  if (prevClose === null || prevClose === undefined) {
    return bar.high - bar.low;
  }
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose)
  );
}

/**
 * Calculate ATR (Average True Range) using Wilder's smoothing method.
 * @param {Array} bars - Array of bars with high, low, close
 * @param {number} period - ATR period (default 14)
 * @returns {number|null} ATR value or null if not enough data
 */
function calculateATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) {
    return null;
  }

  // Calculate True Ranges
  const trueRanges = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = trueRange(bars[i], bars[i - 1].close);
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    return null;
  }

  // Initial ATR is SMA of first 'period' true ranges
  let atr = trueRanges.slice(0, period).reduce((sum, x) => sum + x, 0) / period;

  // Apply Wilder's smoothing for remaining periods
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

// ----------------------------
// EMA (Exponential Moving Average)
// ----------------------------

/**
 * Calculate EMA (Exponential Moving Average).
 * @param {Array} bars - Array of bars with close price
 * @param {number} period - EMA period
 * @returns {number|null} EMA value or null if not enough data
 */
function calculateEMA(bars, period) {
  if (!bars || bars.length < period) {
    return null;
  }

  const closes = bars.map(b => b.close);
  const multiplier = 2 / (period + 1);

  // Seed EMA with SMA of first 'period' closes
  let ema = closes.slice(0, period).reduce((sum, x) => sum + x, 0) / period;

  // Calculate EMA for remaining periods
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] * multiplier) + (ema * (1 - multiplier));
  }

  return ema;
}

// ----------------------------
// BAR AGGREGATION
// ----------------------------

/**
 * Aggregate 5m bars into 30m bars.
 * @param {Array} bars5m - 5-minute bars
 * @param {number} groupSize - Number of 5m bars per aggregated bar (6 for 30m)
 * @returns {Array} Aggregated bars
 */
function aggregateBars(bars5m, groupSize = 6) {
  const out = [];
  for (let i = 0; i + groupSize <= bars5m.length; i += groupSize) {
    const chunk = bars5m.slice(i, i + groupSize);
    out.push({
      _t: chunk[chunk.length - 1]._t,
      _d: chunk[chunk.length - 1]._d,
      open: chunk[0].open,
      high: Math.max(...chunk.map(x => x.high)),
      low: Math.min(...chunk.map(x => x.low)),
      close: chunk[chunk.length - 1].close,
    });
  }
  return out;
}

// ----------------------------
// MAIN COMPUTE FUNCTION
// ----------------------------

/**
 * Main function to compute all indicators for a given anchor point.
 *
 * @param {Array} bars5m - All 5-minute bars
 * @param {Array} bars30m - The 15 30-minute bars from context window
 * @param {number} anchorIndex - Index of anchor bar in bars5m
 * @returns {Object} All computed indicators
 */
function computeIndicators(bars5m, bars30m, anchorIndex) {
  const anchorBar = bars5m[anchorIndex];
  const anchorDate = anchorBar._d;
  const anchorZurich = toZurich(anchorDate);
  const anchorHour = anchorZurich.getHours();
  const anchorMinute = anchorZurich.getMinutes();

  // Determine current and previous sessions
  const currentSession = getCurrentSession(anchorHour);
  const previousSession = getPreviousSession(currentSession);

  // Get previous session bars
  const prevSessionBars = getPreviousSessionBars(bars5m, anchorIndex, previousSession, anchorDate);

  // Calculate support, resistance, and raw high/low
  const srData = calculateSupportResistance(prevSessionBars);

  // Get bars up to anchor for calculations
  const bars5mUpToAnchor = bars5m.slice(0, anchorIndex + 1);

  // ----------------------------
  // ATR Calculations (computed first — needed for structure tolerance)
  // ----------------------------

  // ATR_5m: Use last 15 5m bars (14 periods + 1)
  const atrBars5m = bars5mUpToAnchor.slice(-15);
  const ATR_5m = calculateATR(atrBars5m, 14);

  // ATR_30m: Aggregate 5m bars to 30m, then calculate ATR
  // Need at least 15 * 6 = 90 5m bars for 15 30m bars
  const bars5mForATR30m = bars5mUpToAnchor.slice(-100); // Extra buffer
  const bars30mForATR = aggregateBars(bars5mForATR30m, 6);
  const ATR_30m = calculateATR(bars30mForATR.slice(-15), 14);

  // ----------------------------
  // Swing Points & Structure State (48 x 30m bars)
  // ----------------------------
  // Need 48 * 6 = 288 5m bars for 48 30m bars
  const bars5mForSwings = bars5mUpToAnchor.slice(-300); // Extra buffer
  const bars30mForSwings = aggregateBars(bars5mForSwings, 6).slice(-48);
  const swingPoints = findSwingPoints(bars30mForSwings);
  const structureAnalysis = calculateStructureState(swingPoints, ATR_30m);

  // ----------------------------
  // EMA Calculations
  // ----------------------------
  // EMA20_5m: Need 20 5m bars
  const bars5mForEMA20 = bars5mUpToAnchor.slice(-25); // Extra buffer
  const EMA20_5m = calculateEMA(bars5mForEMA20, 20);

  // EMA50_30m: Need 50 30m bars = 300 5m bars
  const bars5mForEMA50_30m = bars5mUpToAnchor.slice(-350); // Extra buffer
  const bars30mForEMA50 = aggregateBars(bars5mForEMA50_30m, 6);
  const EMA50_30m = calculateEMA(bars30mForEMA50.slice(-55), 50);

  // EMA200_30m: Need 200 30m bars = 1200 5m bars
  const bars5mForEMA200_30m = bars5mUpToAnchor.slice(-1300); // Extra buffer
  const bars30mForEMA200 = aggregateBars(bars5mForEMA200_30m, 6);
  const EMA200_30m = calculateEMA(bars30mForEMA200.slice(-210), 200);

  // ----------------------------
  // Breakout Score Calculation (scan last 2h = 24 bars)
  // ----------------------------
  const LOOKBACK_BARS = 24; // 2 hours of 5m bars
  const recentBars = bars5mUpToAnchor.slice(-LOOKBACK_BARS);

  let breakoutAnalysis = {
    breakoutScore: 0,
    bullScore: 0,
    bearScore: 0,
    components: null,
    breakoutDirection: "NONE",
    isBreakout: false,
    barsAgo: null,
  };

  // Find the strongest breakout in the last 2h
  for (let i = 0; i < recentBars.length; i++) {
    const bar = recentBars[i];
    const analysis = calculateBreakoutScore({
      currentBar: {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
      robustHigh: srData ? srData.resistance : null,
      robustLow: srData ? srData.support : null,
      ATR_5m: ATR_5m,
    });

    // Keep the strongest breakout (max absolute score)
    if (Math.abs(analysis.breakoutScore) > Math.abs(breakoutAnalysis.breakoutScore)) {
      breakoutAnalysis = { ...analysis, barsAgo: recentBars.length - 1 - i };
    }
  }

  // ----------------------------
  // Sweep Score Calculation (scan last 2h = 24 bars)
  // ----------------------------
  let sweepAnalysis = {
    sweepScore: 0,
    bullSweep: 0,
    bearSweep: 0,
    sweepDirection: "NONE",
    isSweep: false,
    components: null,
    barsAgo: null,
  };

  // Find the strongest sweep in the last 2h
  for (let i = 0; i < recentBars.length; i++) {
    const bar = recentBars[i];
    // Get next 3 bars after this bar for acceptance penalty
    const nextBarsForSweep = [];
    const barGlobalIndex = anchorIndex - (recentBars.length - 1 - i);
    for (let j = 1; j <= 3; j++) {
      if (barGlobalIndex + j < bars5m.length) {
        nextBarsForSweep.push(bars5m[barGlobalIndex + j]);
      }
    }

    const analysis = calculateSweepScore({
      currentBar: {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
      sessionHigh: srData ? srData.rawHigh : null,
      sessionLow: srData ? srData.rawLow : null,
      ATR_5m: ATR_5m,
      nextBars: nextBarsForSweep,
    });

    // Keep the strongest sweep (max absolute score)
    if (Math.abs(analysis.sweepScore) > Math.abs(sweepAnalysis.sweepScore)) {
      sweepAnalysis = { ...analysis, barsAgo: recentBars.length - 1 - i };
    }
  }

  // ----------------------------
  // Market Regime Calculation
  // ----------------------------
  // Need EMA50 at 3 30m bars ago (18 5m bars ago)
  // We use the same bars30mForEMA50 but calculate EMA ending 3 bars earlier
  const bars30mForEMA50_kAgo = bars30mForEMA50.slice(0, -3); // Remove last 3 30m bars
  const EMA50_kBarsAgo = calculateEMA(bars30mForEMA50_kAgo.slice(-55), 50);

  // Calculate ATR_5m for last 20 bars and get median
  const atrValues = [];
  for (let i = 0; i < 20; i++) {
    const endIdx = bars5mUpToAnchor.length - i;
    if (endIdx >= 15) {
      const barsForATR = bars5mUpToAnchor.slice(endIdx - 15, endIdx);
      const atrVal = calculateATR(barsForATR, 14);
      if (atrVal !== null) {
        atrValues.push(atrVal);
      }
    }
  }
  const ATR_5m_median20 = median(atrValues);

  const marketRegimeAnalysis = calculateMarketRegime({
    structureState: structureAnalysis.structureState,
    EMA50_30m: EMA50_30m,
    EMA200_30m: EMA200_30m,
    ATR_30m: ATR_30m,
    ATR_5m: ATR_5m,
    EMA50_kBarsAgo: EMA50_kBarsAgo,
    breakoutScore: breakoutAnalysis.breakoutScore,
    ATR_5m_median20: ATR_5m_median20,
  });

  // ----------------------------
  // Acceptance Time Calculation
  // ----------------------------
  const acceptanceAnalysis = calculateAcceptanceTime({
    breakoutScore: breakoutAnalysis.breakoutScore,
    sweepScore: sweepAnalysis.sweepScore,
    resistance: srData ? srData.resistance : null,
    support: srData ? srData.support : null,
    prevSessionHigh: srData ? srData.rawHigh : null,
    prevSessionLow: srData ? srData.rawLow : null,
    bars5mUpToAnchor: bars5mUpToAnchor,
  });

  // ----------------------------
  // Pullback Ratio Calculation
  // ----------------------------
  const pullbackRatioAnalysis = calculatePullbackRatio({
    structureState: structureAnalysis.structureState,
    swingHighs: swingPoints.swingHighs,
    swingLows: swingPoints.swingLows,
    bars30mForSwings: bars30mForSwings,
    bars5mUpToAnchor: bars5mUpToAnchor,
  });

  return {
    // Session info
    anchorTime: anchorBar.time,
    anchorZurichTime: `${anchorHour.toString().padStart(2, "0")}:${anchorMinute.toString().padStart(2, "0")}`,
    currentSession: currentSession ? currentSession.name : "NONE",
    previousSession: previousSession ? previousSession.name : "NONE",
    previousSessionBarsCount: prevSessionBars.length,

    // Support/Resistance (percentile-based)
    support: srData ? srData.support : null,
    resistance: srData ? srData.resistance : null,

    // Raw session high/low
    prevSessionHigh: srData ? srData.rawHigh : null,
    prevSessionLow: srData ? srData.rawLow : null,

    // Swing points (from 48 x 30m bars)
    swingHighs: swingPoints.swingHighs,
    swingLows: swingPoints.swingLows,

    // Structure State
    structureState: structureAnalysis.structureState,
    structureLabel: structureAnalysis.structureLabel,
    structureReason: structureAnalysis.reason,
    structureSwings: {
      SH1: structureAnalysis.SH1,
      SH0: structureAnalysis.SH0,
      SL1: structureAnalysis.SL1,
      SL0: structureAnalysis.SL0,
    },
    totalSwingHighs: structureAnalysis.totalSwingHighs,
    totalSwingLows: structureAnalysis.totalSwingLows,

    // ATR
    ATR_5m: ATR_5m,
    ATR_30m: ATR_30m,

    // EMAs
    EMA20_5m: EMA20_5m,
    EMA50_30m: EMA50_30m,
    EMA200_30m: EMA200_30m,

    // EMA50 Slope (normalized by ATR, from market regime calculation)
    EMA50_slope_30m: marketRegimeAnalysis.components ? marketRegimeAnalysis.components.slope : null,

    // Breakout Score (scanned last 2h)
    breakoutScore: breakoutAnalysis.breakoutScore,
    breakoutDirection: breakoutAnalysis.breakoutDirection,
    isBreakout: breakoutAnalysis.isBreakout,
    breakoutBarsAgo: breakoutAnalysis.barsAgo,
    bullScore: breakoutAnalysis.bullScore,
    bearScore: breakoutAnalysis.bearScore,
    breakoutComponents: breakoutAnalysis.components,

    // Sweep Score (scanned last 2h)
    sweepScore: sweepAnalysis.sweepScore,
    sweepDirection: sweepAnalysis.sweepDirection,
    isSweep: sweepAnalysis.isSweep,
    sweepBarsAgo: sweepAnalysis.barsAgo,
    bullSweep: sweepAnalysis.bullSweep,
    bearSweep: sweepAnalysis.bearSweep,
    sweepComponents: sweepAnalysis.components,

    // Market Regime
    marketRegime: marketRegimeAnalysis.regime,
    isTrend: marketRegimeAnalysis.isTrend,
    isExpansion: marketRegimeAnalysis.isExpansion,
    marketRegimeComponents: marketRegimeAnalysis.components,

    // Acceptance Time
    acceptanceTime: acceptanceAnalysis.acceptanceTime,
    acceptanceRawCount: acceptanceAnalysis.rawCount,
    acceptanceContext: acceptanceAnalysis.context,
    acceptanceLevel: acceptanceAnalysis.level,
    acceptanceDirection: acceptanceAnalysis.direction,

    // Pullback Ratio
    pullbackRatio: pullbackRatioAnalysis.pullbackRatio,
    pullbackImpulseRange: pullbackRatioAnalysis.impulseRange,
    pullbackRetraceDistance: pullbackRatioAnalysis.retraceDistance,
    pullbackImpulseHigh: pullbackRatioAnalysis.impulseHigh,
    pullbackImpulseLow: pullbackRatioAnalysis.impulseLow,
    pullbackExtreme: pullbackRatioAnalysis.pullbackExtreme,
    pullbackDirection: pullbackRatioAnalysis.direction,

    // Current price for reference
    currentClose: anchorBar.close,
  };
}

/**
 * Print indicators to console in a formatted way.
 */
function printIndicators(indicators) {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│                    TRADE INDICATORS                         │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│ Anchor Time (Raw):     ${indicators.anchorTime.padEnd(36)}│`);
  console.log(`│ Anchor Time (Zurich):  ${indicators.anchorZurichTime.padEnd(36)}│`);
  console.log(`│ Current Session:       ${indicators.currentSession.padEnd(36)}│`);
  console.log(`│ Previous Session:      ${indicators.previousSession.padEnd(36)}│`);
  console.log(`│ Prev Session Bars:     ${String(indicators.previousSessionBarsCount).padEnd(36)}│`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ PREVIOUS SESSION LEVELS                                     │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  if (indicators.support !== null && indicators.resistance !== null) {
    console.log(`│ Support (5th %ile):    ${indicators.support.toFixed(5).padEnd(36)}│`);
    console.log(`│ Resistance (95th %ile): ${indicators.resistance.toFixed(5).padEnd(35)}│`);
    console.log(`│ Raw Session High:      ${indicators.prevSessionHigh.toFixed(5).padEnd(36)}│`);
    console.log(`│ Raw Session Low:       ${indicators.prevSessionLow.toFixed(5).padEnd(36)}│`);
  } else {
    console.log("│ Support/Resistance:    Not enough data                      │");
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ ATR (Average True Range)                                    │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  const atr5mStr = indicators.ATR_5m ? indicators.ATR_5m.toFixed(5) : "N/A";
  const atr30mStr = indicators.ATR_30m ? indicators.ATR_30m.toFixed(5) : "N/A";
  console.log(`│ ATR_5m (14 period):    ${atr5mStr.padEnd(36)}│`);
  console.log(`│ ATR_30m (14 period):   ${atr30mStr.padEnd(36)}│`);

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ EMAs (Exponential Moving Averages)                          │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  const ema20_5mStr = indicators.EMA20_5m ? indicators.EMA20_5m.toFixed(5) : "N/A";
  const ema50_30mStr = indicators.EMA50_30m ? indicators.EMA50_30m.toFixed(5) : "N/A";
  const ema200_30mStr = indicators.EMA200_30m ? indicators.EMA200_30m.toFixed(5) : "N/A";
  const currentCloseStr = indicators.currentClose ? indicators.currentClose.toFixed(5) : "N/A";
  console.log(`│ Current Close:         ${currentCloseStr.padEnd(36)}│`);
  console.log(`│ EMA20_5m:              ${ema20_5mStr.padEnd(36)}│`);
  console.log(`│ EMA50_30m:             ${ema50_30mStr.padEnd(36)}│`);
  console.log(`│ EMA200_30m:            ${ema200_30mStr.padEnd(36)}│`);

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ BREAKOUT SCORE                                              │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Breakout direction with visual indicator
  const breakoutIcon = indicators.breakoutDirection === "BULLISH" ? "🟢" :
                       indicators.breakoutDirection === "BEARISH" ? "🔴" : "⚪";
  const breakoutScoreStr = indicators.breakoutScore !== undefined ? indicators.breakoutScore.toFixed(3) : "N/A";
  const breakoutDirStr = `${breakoutIcon} ${indicators.breakoutDirection || "NONE"}`;
  const breakoutBarsAgoStr = indicators.breakoutBarsAgo !== null ? `${indicators.breakoutBarsAgo} bars ago` : "N/A";
  console.log(`│ Breakout Score:        ${breakoutScoreStr.padEnd(36)}│`);
  console.log(`│ Direction:             ${breakoutDirStr.padEnd(36)}│`);
  console.log(`│ When:                  ${breakoutBarsAgoStr.padEnd(36)}│`);
  console.log(`│ Is Breakout:           ${String(indicators.isBreakout || false).padEnd(36)}│`);

  // Show component scores
  const bullScoreStr = indicators.bullScore !== undefined ? indicators.bullScore.toFixed(3) : "N/A";
  const bearScoreStr = indicators.bearScore !== undefined ? indicators.bearScore.toFixed(3) : "N/A";
  console.log(`│ Bull Score:            ${bullScoreStr.padEnd(36)}│`);
  console.log(`│ Bear Score:            ${bearScoreStr.padEnd(36)}│`);

  // Show detailed components if available
  if (indicators.breakoutComponents) {
    const c = indicators.breakoutComponents;
    const distUpStr = `score_up: ${c.score_up.toFixed(2)} (${c.nd_up.toFixed(2)} ATR)`;
    const distDownStr = `score_down: ${c.score_down.toFixed(2)} (${c.nd_down.toFixed(2)} ATR)`;
    const bodyStr = `bodyScore: ${c.bodyScore.toFixed(2)} (${c.bodyRatio.toFixed(2)} ATR)`;
    const rangeStr = `rangeScore: ${c.rangeScore.toFixed(2)} (${c.rangeRatio.toFixed(2)} ATR)`;
    console.log(`│ ${distUpStr.padEnd(58)}│`);
    console.log(`│ ${distDownStr.padEnd(58)}│`);
    console.log(`│ ${bodyStr.padEnd(58)}│`);
    console.log(`│ ${rangeStr.padEnd(58)}│`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ SWEEP DETECTION                                             │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Sweep direction with visual indicator
  const sweepIcon = indicators.sweepDirection === "BULLISH" ? "🟢" :
                    indicators.sweepDirection === "BEARISH" ? "🔴" : "⚪";
  const sweepScoreStr = indicators.sweepScore !== undefined ? indicators.sweepScore.toFixed(3) : "N/A";
  const sweepDirStr = `${sweepIcon} ${indicators.sweepDirection || "NONE"}`;
  const sweepBarsAgoStr = indicators.sweepBarsAgo !== null ? `${indicators.sweepBarsAgo} bars ago` : "N/A";
  console.log(`│ Sweep Score:           ${sweepScoreStr.padEnd(36)}│`);
  console.log(`│ Direction:             ${sweepDirStr.padEnd(36)}│`);
  console.log(`│ When:                  ${sweepBarsAgoStr.padEnd(36)}│`);
  console.log(`│ Is Sweep:              ${String(indicators.isSweep || false).padEnd(36)}│`);

  // Show component scores
  const bullSweepStr = indicators.bullSweep !== undefined ? indicators.bullSweep.toFixed(3) : "N/A";
  const bearSweepStr = indicators.bearSweep !== undefined ? indicators.bearSweep.toFixed(3) : "N/A";
  console.log(`│ Bull Sweep:            ${bullSweepStr.padEnd(36)}│`);
  console.log(`│ Bear Sweep:            ${bearSweepStr.padEnd(36)}│`);

  // Show detailed components if available
  if (indicators.sweepComponents) {
    const bull = indicators.sweepComponents.bull;
    const bear = indicators.sweepComponents.bear;
    if (bull.penetration > 0) {
      const bullPenStr = `Bull: pen=${bull.penScore.toFixed(2)} wick=${bull.wickScore.toFixed(2)} close=${bull.closeScore.toFixed(2)} accept=-${bull.acceptPenalty.toFixed(2)}`;
      console.log(`│ ${bullPenStr.padEnd(58)}│`);
    }
    if (bear.penetration > 0) {
      const bearPenStr = `Bear: pen=${bear.penScore.toFixed(2)} wick=${bear.wickScore.toFixed(2)} close=${bear.closeScore.toFixed(2)} accept=-${bear.acceptPenalty.toFixed(2)}`;
      console.log(`│ ${bearPenStr.padEnd(58)}│`);
    }
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ MARKET REGIME                                               │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Market regime with visual indicator
  const regimeIcon = indicators.marketRegime === "TREND" ? "📈" :
                     indicators.marketRegime === "EXPANSION" ? "💥" : "📊";
  const regimeStr = `${regimeIcon} ${indicators.marketRegime || "RANGE"}`;
  console.log(`│ Regime:                ${regimeStr.padEnd(36)}│`);
  console.log(`│ Is Trend:              ${String(indicators.isTrend || false).padEnd(36)}│`);
  console.log(`│ Is Expansion:          ${String(indicators.isExpansion || false).padEnd(36)}│`);

  // Show detailed components if available
  if (indicators.marketRegimeComponents) {
    const c = indicators.marketRegimeComponents;
    // TREND components
    const slopeStr = c.slope !== null ? c.slope.toFixed(2) : "N/A";
    const emaSpreadStr = `EMA spread: ${c.emaSpread ? c.emaSpread.toFixed(5) : "N/A"} (thresh: ${c.emaSpreadThreshold ? c.emaSpreadThreshold.toFixed(5) : "N/A"})`;
    const slopeInfoStr = `Slope: ${slopeStr} ATR/90min (${c.slopeDirection || "FLAT"})`;
    console.log(`│ ${emaSpreadStr.padEnd(58)}│`);
    console.log(`│ ${slopeInfoStr.padEnd(58)}│`);
    console.log(`│ Slope consistent:      ${String(c.slopeConsistent || false).padEnd(36)}│`);
    // EXPANSION components
    if (c.volExpansionRatio !== null) {
      const volStr = `Vol ratio: ${c.volExpansionRatio.toFixed(2)}x median (expand: ${c.hasVolExpansion})`;
      console.log(`│ ${volStr.padEnd(58)}│`);
    }
    console.log(`│ Breakout trigger:      ${String(c.hasBreakout || false).padEnd(36)}│`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ ACCEPTANCE TIME                                             │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Acceptance time with visual indicator
  const acceptanceVal = indicators.acceptanceTime || 0;
  const acceptanceIcon = acceptanceVal >= 0.8 ? "🔥" :
                         acceptanceVal >= 0.5 ? "⚠️" :
                         acceptanceVal > 0 ? "⏱️" : "⚪";
  const acceptanceTimeStr = acceptanceVal.toFixed(2);
  const acceptanceContextStr = indicators.acceptanceContext || "NONE";
  console.log(`│ Acceptance Time:       ${acceptanceIcon} ${acceptanceTimeStr.padEnd(33)}│`);
  console.log(`│ Context:               ${acceptanceContextStr.padEnd(36)}│`);
  console.log(`│ Raw Bar Count:         ${String(indicators.acceptanceRawCount || 0).padEnd(36)}│`);

  // Show level and direction if available
  if (indicators.acceptanceLevel !== null) {
    const levelStr = indicators.acceptanceLevel.toFixed(5);
    const dirStr = indicators.acceptanceDirection || "N/A";
    console.log(`│ Level:                 ${levelStr.padEnd(36)}│`);
    console.log(`│ Direction:             ${dirStr.padEnd(36)}│`);
  }

  // Show interpretation
  if (acceptanceVal >= 0.8) {
    console.log(`│ Status: Strong acceptance (30+ min beyond level)           │`);
  } else if (acceptanceVal >= 0.5) {
    console.log(`│ Status: Moderate acceptance (~15 min beyond level)         │`);
  } else if (acceptanceVal > 0) {
    console.log(`│ Status: Weak acceptance (<15 min beyond level)             │`);
  } else {
    console.log(`│ Status: No acceptance (price inside level)                 │`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ PULLBACK RATIO                                              │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Pullback ratio with visual indicator
  const pullbackVal = indicators.pullbackRatio;
  if (pullbackVal !== null) {
    const pullbackIcon = pullbackVal >= 0.618 ? "🔴" :
                         pullbackVal >= 0.382 ? "🟡" :
                         pullbackVal >= 0.236 ? "🟢" : "⚪";
    const pullbackStr = pullbackVal.toFixed(3);
    const pullbackDirStr = indicators.pullbackDirection || "N/A";
    console.log(`│ Pullback Ratio:        ${pullbackIcon} ${pullbackStr.padEnd(33)}│`);
    console.log(`│ Direction:             ${pullbackDirStr.padEnd(36)}│`);

    // Show impulse details
    if (indicators.pullbackImpulseHigh !== null && indicators.pullbackImpulseLow !== null) {
      const impulseHighStr = indicators.pullbackImpulseHigh.toFixed(5);
      const impulseLowStr = indicators.pullbackImpulseLow.toFixed(5);
      const impulseRangeStr = indicators.pullbackImpulseRange ? indicators.pullbackImpulseRange.toFixed(5) : "N/A";
      console.log(`│ Impulse High:          ${impulseHighStr.padEnd(36)}│`);
      console.log(`│ Impulse Low:           ${impulseLowStr.padEnd(36)}│`);
      console.log(`│ Impulse Range:         ${impulseRangeStr.padEnd(36)}│`);
    }

    // Show pullback extreme
    if (indicators.pullbackExtreme !== null) {
      const extremeStr = indicators.pullbackExtreme.toFixed(5);
      const retraceStr = indicators.pullbackRetraceDistance ? indicators.pullbackRetraceDistance.toFixed(5) : "N/A";
      console.log(`│ Pullback Extreme:      ${extremeStr.padEnd(36)}│`);
      console.log(`│ Retrace Distance:      ${retraceStr.padEnd(36)}│`);
    }

    // Fibonacci interpretation
    if (pullbackVal < 0.236) {
      console.log(`│ Fib Level: Shallow pullback (<23.6%)                       │`);
    } else if (pullbackVal < 0.382) {
      console.log(`│ Fib Level: Near 23.6% retracement                          │`);
    } else if (pullbackVal < 0.5) {
      console.log(`│ Fib Level: Near 38.2% retracement                          │`);
    } else if (pullbackVal < 0.618) {
      console.log(`│ Fib Level: Near 50% retracement                            │`);
    } else if (pullbackVal < 0.786) {
      console.log(`│ Fib Level: Near 61.8% retracement (golden ratio)           │`);
    } else if (pullbackVal < 1.0) {
      console.log(`│ Fib Level: Deep pullback (>78.6%)                          │`);
    } else {
      console.log(`│ Fib Level: Exceeded 100% - impulse broken                  │`);
    }
  } else {
    console.log(`│ Pullback Ratio:        N/A (no clear impulse in RANGE)     │`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ STRUCTURE STATE (48 x 30M bars)                             │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Structure state with visual indicator
  const structureIcon = indicators.structureState === 1 ? "▲" :
                        indicators.structureState === -1 ? "▼" : "◆";
  const structureStr = `${structureIcon} ${indicators.structureLabel} (${indicators.structureState})`;
  console.log(`│ Structure:             ${structureStr.padEnd(36)}│`);

  // Show swing counts
  const swingCountStr = `${indicators.totalSwingHighs || 0} highs, ${indicators.totalSwingLows || 0} lows`;
  console.log(`│ Swing Points Found:    ${swingCountStr.padEnd(36)}│`);

  // Show key levels if available
  if (indicators.structureSwings && indicators.structureSwings.SH1) {
    const sh0Str = indicators.structureSwings.SH0 ? indicators.structureSwings.SH0.price.toFixed(5) : "N/A";
    const sh1Str = indicators.structureSwings.SH1 ? indicators.structureSwings.SH1.price.toFixed(5) : "N/A";
    const sl0Str = indicators.structureSwings.SL0 ? indicators.structureSwings.SL0.price.toFixed(5) : "N/A";
    const sl1Str = indicators.structureSwings.SL1 ? indicators.structureSwings.SL1.price.toFixed(5) : "N/A";
    console.log(`│ SH0 → SH1:             ${sh0Str} → ${sh1Str.padEnd(21)}│`);
    console.log(`│ SL0 → SL1:             ${sl0Str} → ${sl1Str.padEnd(21)}│`);
  }

  // Show reason
  if (indicators.structureReason) {
    const reasonShort = indicators.structureReason.slice(0, 55);
    console.log(`│ Reason: ${reasonShort.padEnd(51)}│`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ SWING POINTS DETAIL                                         │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  if (indicators.swingHighs.length > 0) {
    console.log("│ Swing Highs:                                                │");
    // Show last 4 swing highs
    const recentHighs = indicators.swingHighs.slice(-4);
    for (const sh of recentHighs) {
      console.log(`│   Index ${String(sh.index).padEnd(2)}: ${sh.price.toFixed(5).padEnd(44)}│`);
    }
  } else {
    console.log("│ Swing Highs:           None found                           │");
  }

  if (indicators.swingLows.length > 0) {
    console.log("│ Swing Lows:                                                 │");
    // Show last 4 swing lows
    const recentLows = indicators.swingLows.slice(-4);
    for (const sl of recentLows) {
      console.log(`│   Index ${String(sl.index).padEnd(2)}: ${sl.price.toFixed(5).padEnd(44)}│`);
    }
  } else {
    console.log("│ Swing Lows:            None found                           │");
  }

  console.log("└─────────────────────────────────────────────────────────────┘\n");
}

module.exports = {
  SESSIONS,
  SESSION_TZ,
  toZurich,
  getZurichHour,
  getZurichDateStr,
  getCurrentSession,
  getPreviousSession,
  getPreviousSessionBars,
  calculateSupportResistance,
  findSwingPoints,
  calculateStructureState,
  calculateBreakoutScore,
  calculateSweepScore,
  calculateEMASlope,
  calculateMarketRegime,
  calculateAcceptanceTime,
  calculatePullbackRatio,
  median,
  calculateATR,
  calculateEMA,
  aggregateBars,
  computeIndicators,
  printIndicators,
};
