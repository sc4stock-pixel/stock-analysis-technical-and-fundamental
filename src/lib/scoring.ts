// ============================================================
// SCORING ENGINE — exact port of Python V12.5.6 calculate_scores()
// Weights: RSI=18%, MACD=18%, ADX=12%, TREND=18%, MA=18%, BB=10%, VOL=6%
// ============================================================

export interface ScoreWeights {
  RSI_Score: number;
  MACD_Score: number;
  ADX_Score: number;
  Trend_Score: number;
  MA_Score: number;
  BB_Score: number;
  Volume_Score: number;
}

export const BASE_WEIGHTS: ScoreWeights = {
  RSI_Score: 0.18,
  MACD_Score: 0.18,
  ADX_Score: 0.12,
  Trend_Score: 0.18,
  MA_Score: 0.18,
  BB_Score: 0.10,
  Volume_Score: 0.06,
};

export const REGIME_WEIGHTS: Record<string, ScoreWeights> = {
  STRONG_UPTREND: { RSI_Score: 0.15, MACD_Score: 0.20, ADX_Score: 0.12, Trend_Score: 0.20, MA_Score: 0.18, BB_Score: 0.08, Volume_Score: 0.07 },
  STRONG_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.16, ADX_Score: 0.12, Trend_Score: 0.16, MA_Score: 0.15, BB_Score: 0.12, Volume_Score: 0.11 },
  EXHAUSTING_UPTREND: { RSI_Score: 0.18, MACD_Score: 0.15, ADX_Score: 0.10, Trend_Score: 0.15, MA_Score: 0.15, BB_Score: 0.14, Volume_Score: 0.13 },
  EXHAUSTING_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.14, MA_Score: 0.15, BB_Score: 0.15, Volume_Score: 0.14 },
  UPTREND: { RSI_Score: 0.16, MACD_Score: 0.18, ADX_Score: 0.10, Trend_Score: 0.20, MA_Score: 0.18, BB_Score: 0.08, Volume_Score: 0.10 },
  DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.16, ADX_Score: 0.12, Trend_Score: 0.16, MA_Score: 0.15, BB_Score: 0.12, Volume_Score: 0.11 },
  STRENGTHENING_UPTREND: { RSI_Score: 0.15, MACD_Score: 0.20, ADX_Score: 0.12, Trend_Score: 0.20, MA_Score: 0.18, BB_Score: 0.08, Volume_Score: 0.07 },
  STRENGTHENING_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.16, ADX_Score: 0.12, Trend_Score: 0.18, MA_Score: 0.15, BB_Score: 0.11, Volume_Score: 0.10 },
  WEAKENING_UPTREND: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.14, MA_Score: 0.15, BB_Score: 0.15, Volume_Score: 0.14 },
  WEAKENING_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.13, ADX_Score: 0.10, Trend_Score: 0.13, MA_Score: 0.15, BB_Score: 0.16, Volume_Score: 0.15 },
  WEAK_UPTREND: { RSI_Score: 0.16, MACD_Score: 0.16, ADX_Score: 0.10, Trend_Score: 0.16, MA_Score: 0.16, BB_Score: 0.12, Volume_Score: 0.14 },
  WEAK_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.14, MA_Score: 0.15, BB_Score: 0.15, Volume_Score: 0.14 },
  WEAK_UPTREND_STRENGTHENING: { RSI_Score: 0.16, MACD_Score: 0.18, ADX_Score: 0.10, Trend_Score: 0.18, MA_Score: 0.16, BB_Score: 0.10, Volume_Score: 0.12 },
  WEAK_DOWNTREND_STRENGTHENING: { RSI_Score: 0.18, MACD_Score: 0.16, ADX_Score: 0.10, Trend_Score: 0.16, MA_Score: 0.15, BB_Score: 0.12, Volume_Score: 0.13 },
  WEAK_UPTREND_WEAKENING: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.14, MA_Score: 0.15, BB_Score: 0.15, Volume_Score: 0.14 },
  WEAK_DOWNTREND_WEAKENING: { RSI_Score: 0.18, MACD_Score: 0.13, ADX_Score: 0.10, Trend_Score: 0.13, MA_Score: 0.15, BB_Score: 0.17, Volume_Score: 0.14 },
  BEAR_RALLY: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.12, MA_Score: 0.15, BB_Score: 0.16, Volume_Score: 0.15 },
  WEAK_BEAR_RALLY: { RSI_Score: 0.18, MACD_Score: 0.13, ADX_Score: 0.08, Trend_Score: 0.12, MA_Score: 0.14, BB_Score: 0.18, Volume_Score: 0.17 },
  RANGING: { RSI_Score: 0.18, MACD_Score: 0.12, ADX_Score: 0.08, Trend_Score: 0.12, MA_Score: 0.14, BB_Score: 0.22, Volume_Score: 0.14 },
  OVERBOUGHT: { RSI_Score: 0.20, MACD_Score: 0.10, ADX_Score: 0.08, Trend_Score: 0.10, MA_Score: 0.12, BB_Score: 0.25, Volume_Score: 0.15 },
  OVERSOLD: { RSI_Score: 0.20, MACD_Score: 0.10, ADX_Score: 0.08, Trend_Score: 0.10, MA_Score: 0.12, BB_Score: 0.25, Volume_Score: 0.15 },
  HIGH_VOLATILITY: { RSI_Score: 0.16, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.12, MA_Score: 0.14, BB_Score: 0.18, Volume_Score: 0.16 },
  NEUTRAL: { RSI_Score: 0.18, MACD_Score: 0.18, ADX_Score: 0.10, Trend_Score: 0.18, MA_Score: 0.16, BB_Score: 0.10, Volume_Score: 0.10 },
  EXTREME_VOLATILITY: { RSI_Score: 0.16, MACD_Score: 0.12, ADX_Score: 0.10, Trend_Score: 0.10, MA_Score: 0.12, BB_Score: 0.22, Volume_Score: 0.18 },
  EXTREME_VOL_BULLISH: { RSI_Score: 0.15, MACD_Score: 0.14, ADX_Score: 0.10, Trend_Score: 0.14, MA_Score: 0.14, BB_Score: 0.18, Volume_Score: 0.15 },
  EXTREME_VOL_BEARISH: { RSI_Score: 0.16, MACD_Score: 0.12, ADX_Score: 0.10, Trend_Score: 0.12, MA_Score: 0.12, BB_Score: 0.22, Volume_Score: 0.16 },
  HIGH_VOL_UPTREND: { RSI_Score: 0.15, MACD_Score: 0.18, ADX_Score: 0.12, Trend_Score: 0.18, MA_Score: 0.16, BB_Score: 0.12, Volume_Score: 0.09 },
  HIGH_VOL_DOWNTREND: { RSI_Score: 0.18, MACD_Score: 0.14, ADX_Score: 0.12, Trend_Score: 0.14, MA_Score: 0.14, BB_Score: 0.16, Volume_Score: 0.12 },
  HIGH_VOL_BEAR_RALLY: { RSI_Score: 0.18, MACD_Score: 0.13, ADX_Score: 0.10, Trend_Score: 0.12, MA_Score: 0.14, BB_Score: 0.18, Volume_Score: 0.15 },
};

export interface BarScores {
  RSI_Score: number;
  MACD_Score: number;
  ADX_Score: number;
  Trend_Score: number;
  MA_Score: number;
  BB_Score: number;
  Volume_Score: number;
  Score: number;
  Confidence: number;
}

/**
 * V12.5 RSI Score with momentum boost in uptrend regimes.
 * RSI 60-75 → 7 in uptrend (strength), 5 otherwise.
 */
function rsiScore(rsiVal: number, isUptrendRegime: boolean, rsiDivergence: number): number {
  let score: number;
  if (rsiVal < 30) score = 9;
  else if (rsiVal < 40) score = 7;
  else if (rsiVal > 80) score = 1;
  else if (rsiVal > 75) score = isUptrendRegime ? 5 : 3;
  else if (rsiVal >= 60) score = isUptrendRegime ? 7 : 5;
  else score = 5;
  // Divergence adjustment
  if (rsiDivergence === -1) score = Math.max(1, score - 2);
  else if (rsiDivergence === 1) score = Math.min(10, score + 2);
  return score;
}

/**
 * V12.5 MACD Score with trend context.
 */
function macdScore(
  macdLine: number, signalLine: number, histogram: number,
  plusDI: number, minusDI: number, adxVal: number
): number {
  const trendUp = plusDI > minusDI && adxVal > 20;
  if (macdLine > signalLine && histogram > 0) return 8;
  if (macdLine > signalLine && histogram < 0) return 6;
  if (macdLine < signalLine && histogram < 0 && trendUp) return 4;
  if (macdLine < signalLine && histogram < 0) return 2;
  return 4;
}

/**
 * Compute per-bar scores for a full OHLCV dataset.
 * Returns array of BarScores aligned to input arrays.
 */
export function calculateScores(params: {
  rsiArr: number[];
  macdArr: number[];
  macdSignalArr: number[];
  macdHistArr: number[];
  adxArr: number[];
  plusDIArr: number[];
  minusDIArr: number[];
  adxSlopeArr: number[];
  closeArr: number[];
  sma20Arr: number[];
  sma50Arr: number[];
  bbUpperArr: number[];
  bbMidArr: number[];
  bbLowerArr: number[];
  volRatioArr: number[];
  volAccumulationArr: number[];
  trendGateArr: number[];
  rsiDivergenceArr: number[];
  regimeArr: string[];
}): BarScores[] {
  const n = params.closeArr.length;
  const results: BarScores[] = [];

  for (let i = 0; i < n; i++) {
    const regime = params.regimeArr[i] ?? "NEUTRAL";
    // AUDIT FIX C4 (2026-05-20): old pattern matched STRONG_DOWNTREND,
    // STRENGTHENING_DOWNTREND, etc. — applied the RSI uptrend bonus in bear regimes.
    // Anchor to *UPTREND suffix so only bullish regime labels qualify.
    // PARITY VERIFIED (2026-06-10): Python signals.py:234 uses the identical
    // suffix anchor — WEAK_UPTREND_STRENGTHENING / WEAK_UPTREND_WEAKENING /
    // EXTREME_VOL_BULLISH are excluded in BOTH codebases by design. Keep in sync.
    const isUptrend = /UPTREND$/i.test(regime);

    // RSI
    const rScore = rsiScore(params.rsiArr[i], isUptrend, params.rsiDivergenceArr[i] ?? 0);

    // MACD
    const mScore = macdScore(
      params.macdArr[i], params.macdSignalArr[i], params.macdHistArr[i],
      params.plusDIArr[i], params.minusDIArr[i], params.adxArr[i]
    );

    // ADX
    let aScore: number;
    const adxVal = params.adxArr[i];
    if (adxVal > 40) aScore = 8;
    else if (adxVal > 30) aScore = 7;
    else if (adxVal > 25) aScore = 6;
    else if (adxVal > 20) aScore = 4;
    else aScore = 3;
    // ADX slope adjustment
    const adxSlope = params.adxSlopeArr[i] ?? 0;
    if (adxSlope > 2) aScore = Math.min(10, aScore + 1);
    else if (adxSlope < -2) aScore = Math.max(1, aScore - 1);

    // Trend (DI)
    const pDI = params.plusDIArr[i];
    const mDI = params.minusDIArr[i];
    let tScore: number;
    if (pDI > mDI * 1.5) tScore = 8;
    else if (pDI > mDI) tScore = 7;
    else if (pDI < mDI * 0.67) tScore = 3;
    else if (pDI < mDI) tScore = 4;
    else tScore = 5;

    // MA
    const close = params.closeArr[i];
    const sma20 = params.sma20Arr[i];
    const sma50 = params.sma50Arr[i];
    let maScore: number;
    if (close > sma20 && sma20 > sma50) maScore = 8;
    else if (close > sma20 && sma20 < sma50) maScore = 6;
    else if (close < sma20 && sma20 < sma50) maScore = 2;
    else maScore = 4;

    // BB Position
    const bbUpper = params.bbUpperArr[i];
    const bbLower = params.bbLowerArr[i];
    const bbRange = bbUpper - bbLower;
    const bbPos = bbRange > 0 ? (close - bbLower) / bbRange : 0.5;
    let bbScore: number;
    if (bbPos < 0.15) bbScore = 9;
    else if (bbPos < 0.30) bbScore = 7;
    else if (bbPos > 0.85) bbScore = 2;
    else if (bbPos > 0.70) bbScore = 3;
    else bbScore = 5;

    // Volume
    let vScore: number;
    const vr = params.volRatioArr[i] ?? 1;
    if (vr > 2) vScore = 8;
    else if (vr > 1.5) vScore = 6;
    else if (vr < 0.5) vScore = 3;
    else vScore = 5;
    if (params.volAccumulationArr[i] === 1) vScore = Math.min(10, vScore + 2);

    const weights = REGIME_WEIGHTS[regime] ?? BASE_WEIGHTS;
    const rawScore =
      rScore * weights.RSI_Score +
      mScore * weights.MACD_Score +
      aScore * weights.ADX_Score +
      tScore * weights.Trend_Score +
      maScore * weights.MA_Score +
      bbScore * weights.BB_Score +
      vScore * weights.Volume_Score;

    // Confidence: 100 - std(subscores) * 10
    const subScores = [rScore, mScore, aScore, tScore, maScore, bbScore, vScore];
    const mean = subScores.reduce((a, b) => a + b, 0) / subScores.length;
    // pandas std() default is sample std (ddof=1) — match Python exactly
    const variance = subScores.reduce((a, b) => a + (b - mean) ** 2, 0) / (subScores.length - 1);
    const std = Math.sqrt(variance);
    const confidence = Math.min(95, Math.max(50, 100 - std * 10));

    results.push({
      RSI_Score: rScore,
      MACD_Score: mScore,
      ADX_Score: aScore,
      Trend_Score: tScore,
      MA_Score: maScore,
      BB_Score: bbScore,
      Volume_Score: vScore,
      Score: Math.round(rawScore * 10) / 10,
      Confidence: Math.round(confidence),
    });
  }

  return results;
}

/**
 * Per-bar causal RSI divergence — exact port of Python signals.py
 * detect_rsi_divergence() (AUDIT FIX C1, 2026-05-20).
 *
 * The old TS version computed a single scalar over the LAST `lookback` bars,
 * which pipeline.ts then broadcast across every row — today's divergence
 * reading invalidated every historical bar's BUY signal in the backtest
 * (lookahead bias). This port evaluates each bar i using only pivots
 * confirmed at that bar: a pivot centered at j counts once i >= j + w.
 *
 * Returns [divArr, divTypeArr] aligned to the input series:
 *   div: -1 (bearish), 0 (none), 1 (bullish)
 */
export function detectRsiDivergence(
  closes: number[],
  rsiArr: number[],
  lookback = 20,
  pivotWindow = 5
): [number[], string[]] {
  const n = closes.length;
  const div: number[] = new Array(n).fill(0);
  const divType: string[] = new Array(n).fill("None");
  const w = pivotWindow;

  if (n < lookback + w) return [div, divType];

  // All pivot highs/lows; center j is confirmed once bar i reaches j + w.
  const pivotHighs: { idx: number; price: number; rsi: number }[] = [];
  const pivotLows: { idx: number; price: number; rsi: number }[] = [];
  for (let j = w; j < n - w; j++) {
    const window = closes.slice(j - w, j + w + 1);
    const maxVal = Math.max(...window);
    const minVal = Math.min(...window);
    if (closes[j] === maxVal) pivotHighs.push({ idx: j, price: closes[j], rsi: rsiArr[j] });
    if (closes[j] === minVal) pivotLows.push({ idx: j, price: closes[j], rsi: rsiArr[j] });
  }

  // Sliding-pointer scan over confirmed pivots within the trailing window.
  let hiPtr = 0, loPtr = 0;
  for (let i = lookback + w - 1; i < n; i++) {
    const confirmedMax = i - w;
    const windowMin = i - lookback + 1;

    while (hiPtr < pivotHighs.length && pivotHighs[hiPtr].idx < windowMin) hiPtr++;
    while (loPtr < pivotLows.length && pivotLows[loPtr].idx < windowMin) loPtr++;

    const ph = pivotHighs.slice(hiPtr).filter(p => p.idx <= confirmedMax);
    const pl = pivotLows.slice(loPtr).filter(p => p.idx <= confirmedMax);

    if (ph.length >= 2) {
      const h1 = ph[ph.length - 2];
      const h2 = ph[ph.length - 1];
      if (h2.price > h1.price && h2.rsi < h1.rsi) {
        div[i] = -1;
        divType[i] = "Bearish";
        continue;
      }
    }
    if (pl.length >= 2) {
      const l1 = pl[pl.length - 2];
      const l2 = pl[pl.length - 1];
      if (l2.price < l1.price && l2.rsi > l1.rsi) {
        div[i] = 1;
        divType[i] = "Bullish";
      }
    }
  }

  return [div, divType];
}
