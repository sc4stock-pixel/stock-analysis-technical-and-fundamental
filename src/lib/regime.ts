// ============================================================
// REGIME DETECTION & PARAMETER TABLES — exact port of Python V12.5.6
// ============================================================

export interface RegimeInfo {
  regime: string;
  atr_ratio: number;
  adx_slope: number;
  bullish_count: number;
  is_high_volatility: boolean;
  is_extreme_dislocation: boolean;
}

export interface OHLCVRow {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  macd: number;
  macdSignal: number;
  sma20: number;
  sma50: number;
  rsi: number;
}

// ─── TABLE 1: MAX HOLDING DAYS ───────────────────────────────
export const REGIME_MAX_HOLDING_DAYS: Record<string, number> = {
  STRONG_UPTREND: 60,
  STRONG_DOWNTREND: 60,
  STRENGTHENING_UPTREND: 45,
  STRENGTHENING_DOWNTREND: 45,
  UPTREND: 30,
  DOWNTREND: 30,
  WEAK_UPTREND: 25,
  WEAK_DOWNTREND: 25,
  WEAK_UPTREND_STRENGTHENING: 25,
  WEAK_DOWNTREND_STRENGTHENING: 25,
  WEAKENING_UPTREND: 15,
  WEAKENING_DOWNTREND: 15,
  WEAK_UPTREND_WEAKENING: 15,
  WEAK_DOWNTREND_WEAKENING: 15,
  EXHAUSTING_UPTREND: 10,
  EXHAUSTING_DOWNTREND: 10,
  RANGING: 10,
  OVERBOUGHT: 8,
  OVERSOLD: 8,
  BEAR_RALLY: 10,
  WEAK_BEAR_RALLY: 8,
  HIGH_VOLATILITY: 15,
  HIGH_VOL_UPTREND: 15,
  HIGH_VOL_DOWNTREND: 12,
  HIGH_VOL_BEAR_RALLY: 8,
  EXTREME_VOLATILITY: 10,
  EXTREME_VOL_BULLISH: 12,
  EXTREME_VOL_BEARISH: 8,
  NEUTRAL: 20,
};

// ─── TABLE 2: INITIAL ATR MULTIPLIER (stop loss width) ───────
export const REGIME_ATR_MULTIPLIER: Record<string, number> = {
  STRONG_UPTREND: 2.0,
  STRONG_DOWNTREND: 2.0,
  STRENGTHENING_UPTREND: 2.0,
  STRENGTHENING_DOWNTREND: 2.0,
  UPTREND: 2.2,
  DOWNTREND: 2.2,
  WEAK_UPTREND: 2.2,
  WEAK_DOWNTREND: 2.2,
  WEAK_UPTREND_STRENGTHENING: 2.2,
  WEAK_DOWNTREND_STRENGTHENING: 2.2,
  WEAKENING_UPTREND: 2.5,
  WEAKENING_DOWNTREND: 2.5,
  WEAK_UPTREND_WEAKENING: 2.5,
  WEAK_DOWNTREND_WEAKENING: 2.5,
  EXHAUSTING_UPTREND: 2.5,
  EXHAUSTING_DOWNTREND: 2.5,
  RANGING: 2.0,
  OVERBOUGHT: 2.0,
  OVERSOLD: 2.0,
  BEAR_RALLY: 2.2,
  WEAK_BEAR_RALLY: 2.2,
  HIGH_VOLATILITY: 2.5,
  HIGH_VOL_UPTREND: 2.5,
  HIGH_VOL_DOWNTREND: 2.5,
  HIGH_VOL_BEAR_RALLY: 2.5,
  EXTREME_VOLATILITY: 2.5,
  EXTREME_VOL_BULLISH: 2.5,
  EXTREME_VOL_BEARISH: 2.5,
  NEUTRAL: 2.2,
};

// ─── TABLE 2b: PROFIT TARGET ATR MULTIPLIER ──────────────────
export const REGIME_PROFIT_TARGET_ATR: Record<string, number> = {
  STRONG_UPTREND: 16.0,
  STRONG_DOWNTREND: 16.0,
  STRENGTHENING_UPTREND: 12.0,
  STRENGTHENING_DOWNTREND: 12.0,
  UPTREND: 6.6,
  DOWNTREND: 6.6,
  WEAK_UPTREND: 6.6,
  WEAK_DOWNTREND: 6.6,
  WEAK_UPTREND_STRENGTHENING: 6.6,
  WEAK_DOWNTREND_STRENGTHENING: 6.6,
  WEAKENING_UPTREND: 5.0,
  WEAKENING_DOWNTREND: 5.0,
  WEAK_UPTREND_WEAKENING: 5.0,
  WEAK_DOWNTREND_WEAKENING: 5.0,
  EXHAUSTING_UPTREND: 5.0,
  EXHAUSTING_DOWNTREND: 5.0,
  RANGING: 3.0,
  OVERBOUGHT: 3.0,
  OVERSOLD: 3.0,
  BEAR_RALLY: 4.4,
  WEAK_BEAR_RALLY: 4.4,
  HIGH_VOLATILITY: 5.0,
  HIGH_VOL_UPTREND: 5.0,
  HIGH_VOL_DOWNTREND: 5.0,
  HIGH_VOL_BEAR_RALLY: 5.0,
  EXTREME_VOLATILITY: 5.0,
  EXTREME_VOL_BULLISH: 5.0,
  EXTREME_VOL_BEARISH: 5.0,
  NEUTRAL: 4.4,
};

// ─── TABLE 3: TRAILING ATR MULTIPLIER ────────────────────────
export const REGIME_TRAILING_ATR_MULT: Record<string, number> = {
  STRONG_UPTREND: 2.0,
  STRONG_DOWNTREND: 2.0,
  STRENGTHENING_UPTREND: 1.75,
  STRENGTHENING_DOWNTREND: 1.75,
  UPTREND: 1.5,
  DOWNTREND: 1.5,
  WEAK_UPTREND: 1.5,
  WEAK_DOWNTREND: 1.5,
  WEAK_UPTREND_STRENGTHENING: 1.5,
  WEAK_DOWNTREND_STRENGTHENING: 1.5,
  WEAKENING_UPTREND: 1.75,
  WEAKENING_DOWNTREND: 1.75,
  WEAK_UPTREND_WEAKENING: 1.75,
  WEAK_DOWNTREND_WEAKENING: 1.75,
  EXHAUSTING_UPTREND: 2.0,
  EXHAUSTING_DOWNTREND: 2.0,
  RANGING: 1.0,
  OVERBOUGHT: 1.0,
  OVERSOLD: 1.0,
  BEAR_RALLY: 1.25,
  WEAK_BEAR_RALLY: 1.5,
  HIGH_VOLATILITY: 1.25,
  HIGH_VOL_UPTREND: 1.25,
  HIGH_VOL_DOWNTREND: 1.5,
  HIGH_VOL_BEAR_RALLY: 1.5,
  EXTREME_VOLATILITY: 2.0,
  EXTREME_VOL_BULLISH: 2.0,
  EXTREME_VOL_BEARISH: 2.0,
  NEUTRAL: 1.5,
};

// ─── TABLE 3b: TRAIL TRIGGER (R before trailing starts) ──────
export const REGIME_TRAIL_TRIGGER: Record<string, number> = {
  STRONG_UPTREND: 2.5,
  STRONG_DOWNTREND: 2.5,
  STRENGTHENING_UPTREND: 2.0,
  STRENGTHENING_DOWNTREND: 2.0,
  UPTREND: 1.5,
  DOWNTREND: 1.5,
  WEAK_UPTREND: 1.5,
  WEAK_DOWNTREND: 1.5,
  WEAK_UPTREND_STRENGTHENING: 1.5,
  WEAK_DOWNTREND_STRENGTHENING: 1.5,
  WEAKENING_UPTREND: 1.0,
  WEAKENING_DOWNTREND: 1.0,
  WEAK_UPTREND_WEAKENING: 1.0,
  WEAK_DOWNTREND_WEAKENING: 1.0,
  EXHAUSTING_UPTREND: 1.0,
  EXHAUSTING_DOWNTREND: 1.0,
  RANGING: 0.5,
  OVERBOUGHT: 0.5,
  OVERSOLD: 0.5,
  BEAR_RALLY: 1.0,
  WEAK_BEAR_RALLY: 1.0,
  HIGH_VOLATILITY: 1.0,
  HIGH_VOL_UPTREND: 1.0,
  HIGH_VOL_DOWNTREND: 1.0,
  HIGH_VOL_BEAR_RALLY: 1.0,
  EXTREME_VOLATILITY: 1.0,
  EXTREME_VOL_BULLISH: 1.0,
  EXTREME_VOL_BEARISH: 1.0,
  NEUTRAL: 1.5,
};

// ─── TABLE 4: CONFIRMATION BARS (exchange-aware) ─────────────
export const EXCHANGE_CONFIRM_BARS: Record<string, Record<string, number>> = {
  US: {
    STRONG_UPTREND: 0, STRONG_DOWNTREND: 0,
    STRENGTHENING_UPTREND: 0, STRENGTHENING_DOWNTREND: 0,
    UPTREND: 1, DOWNTREND: 1,
    WEAK_UPTREND: 1, WEAK_DOWNTREND: 1,
    WEAK_UPTREND_STRENGTHENING: 1, WEAK_DOWNTREND_STRENGTHENING: 1,
    WEAKENING_UPTREND: 2, WEAKENING_DOWNTREND: 2,
    WEAK_UPTREND_WEAKENING: 2, WEAK_DOWNTREND_WEAKENING: 2,
    EXHAUSTING_UPTREND: 2, EXHAUSTING_DOWNTREND: 2,
    RANGING: 2, OVERBOUGHT: 2, OVERSOLD: 2,
    BEAR_RALLY: 2, WEAK_BEAR_RALLY: 2,
    HIGH_VOLATILITY: 1, HIGH_VOL_UPTREND: 0, HIGH_VOL_DOWNTREND: 2, HIGH_VOL_BEAR_RALLY: 2,
    EXTREME_VOLATILITY: 2, EXTREME_VOL_BULLISH: 1, EXTREME_VOL_BEARISH: 2,
    NEUTRAL: 1,
  },
  HK: {
    STRONG_UPTREND: 0, STRONG_DOWNTREND: 0,
    STRENGTHENING_UPTREND: 0, STRENGTHENING_DOWNTREND: 0,
    UPTREND: 1, DOWNTREND: 1,
    WEAK_UPTREND: 1, WEAK_DOWNTREND: 1,
    WEAK_UPTREND_STRENGTHENING: 1, WEAK_DOWNTREND_STRENGTHENING: 1,
    WEAKENING_UPTREND: 2, WEAKENING_DOWNTREND: 2,
    WEAK_UPTREND_WEAKENING: 2, WEAK_DOWNTREND_WEAKENING: 2,
    EXHAUSTING_UPTREND: 2, EXHAUSTING_DOWNTREND: 2,
    RANGING: 2, OVERBOUGHT: 2, OVERSOLD: 2,
    BEAR_RALLY: 2, WEAK_BEAR_RALLY: 2,
    HIGH_VOLATILITY: 2, HIGH_VOL_UPTREND: 1, HIGH_VOL_DOWNTREND: 2, HIGH_VOL_BEAR_RALLY: 2,
    EXTREME_VOLATILITY: 2, EXTREME_VOL_BULLISH: 2, EXTREME_VOL_BEARISH: 2,
    NEUTRAL: 1,
  },
  DEFAULT: {
    STRONG_UPTREND: 0, STRONG_DOWNTREND: 0,
    STRENGTHENING_UPTREND: 0, STRENGTHENING_DOWNTREND: 0,
    UPTREND: 1, DOWNTREND: 1,
    WEAK_UPTREND: 1, WEAK_DOWNTREND: 1,
    WEAK_UPTREND_STRENGTHENING: 1, WEAK_DOWNTREND_STRENGTHENING: 1,
    WEAKENING_UPTREND: 2, WEAKENING_DOWNTREND: 2,
    WEAK_UPTREND_WEAKENING: 2, WEAK_DOWNTREND_WEAKENING: 2,
    EXHAUSTING_UPTREND: 2, EXHAUSTING_DOWNTREND: 2,
    RANGING: 2, OVERBOUGHT: 2, OVERSOLD: 2,
    BEAR_RALLY: 2, WEAK_BEAR_RALLY: 2,
    HIGH_VOLATILITY: 2, HIGH_VOL_UPTREND: 2, HIGH_VOL_DOWNTREND: 2, HIGH_VOL_BEAR_RALLY: 2,
    EXTREME_VOLATILITY: 2, EXTREME_VOL_BULLISH: 2, EXTREME_VOL_BEARISH: 2,
    NEUTRAL: 2,
  },
};

// ─── REGIME DETECTION ────────────────────────────────────────
/**
 * V12.2 regime detection — exact port of Python detect_regime().
 * Requires arrays of computed indicator values; uses the LAST bar as "latest".
 */
export function detectRegime(params: {
  adxArr: number[];
  plusDIArr: number[];
  minusDIArr: number[];
  atrArr: number[];
  macdArr: number[];
  macdSignalArr: number[];
  closeArr: number[];
  sma20Arr: number[];
  sma50Arr: number[];
  rsiArr: number[];
}): RegimeInfo {
  const { adxArr, plusDIArr, minusDIArr, atrArr, macdArr, macdSignalArr,
          closeArr, sma20Arr, sma50Arr, rsiArr } = params;
  const n = closeArr.length;
  const last = (arr: number[]) => arr[n - 1];

  const adx = last(adxArr);
  const plusDI = last(plusDIArr);
  const minusDI = last(minusDIArr);

  // ADX slope over last 4 bars
  const adxSlope = n >= 4 ? adx - adxArr[n - 4] : 0;
  const adxStrengthening = adxSlope > 1;
  const adxWeakening = adxSlope < -1;

  // Dynamic volatility: ATR(14) vs avg ATR(100)
  const atrCurrent = last(atrArr);
  const atrSlice = atrArr.slice(Math.max(0, n - 100));
  const atrAvg100 = atrSlice.reduce((a, b) => a + b, 0) / atrSlice.length;
  const atrRatio = atrAvg100 > 0 ? atrCurrent / atrAvg100 : 1.0;
  const isHighVolatility = atrRatio > 1.5;
  const isExtremeDislocation = atrRatio > 2.0;

  const price = last(closeArr);
  const sma20 = last(sma20Arr);
  const sma50 = last(sma50Arr);
  const rsi = last(rsiArr);

  const maBullish = sma20 > sma50;
  const priceAboveSma20 = price > sma20;
  const priceAboveSma50 = price > sma50;
  const primaryTrendBullish = priceAboveSma50 && maBullish;
  const trendBullishDI = plusDI > minusDI;
  const macdBullish = last(macdArr) > last(macdSignalArr);

  const bullishCount = [
    trendBullishDI, macdBullish, priceAboveSma20, priceAboveSma50, maBullish
  ].filter(Boolean).length;

  let regime: string;

  if (isExtremeDislocation) {
    if (bullishCount >= 3) regime = "EXTREME_VOL_BULLISH";
    else if (bullishCount <= 1) regime = "EXTREME_VOL_BEARISH";
    else regime = "EXTREME_VOLATILITY";
  } else if (adx > 35) {
    if (bullishCount >= 3) {
      regime = primaryTrendBullish ? "STRONG_UPTREND" : "BEAR_RALLY";
    } else if (bullishCount <= 1) {
      regime = "STRONG_DOWNTREND";
    } else {
      regime = trendBullishDI ? "STRONG_UPTREND" : "STRONG_DOWNTREND";
    }
    if (adxWeakening) regime = regime.replace("STRONG_", "EXHAUSTING_");
  } else if (adx > 25) {
    if (bullishCount >= 3) {
      regime = primaryTrendBullish ? "UPTREND" : "BEAR_RALLY";
    } else if (bullishCount <= 1) {
      regime = "DOWNTREND";
    } else {
      regime = trendBullishDI ? "UPTREND" : "DOWNTREND";
    }
    if (adxStrengthening) regime = `STRENGTHENING_${regime}`;
    else if (adxWeakening) regime = `WEAKENING_${regime}`;
  } else if (adx > 20) {
    if (bullishCount >= 3) {
      regime = primaryTrendBullish ? "WEAK_UPTREND" : "WEAK_BEAR_RALLY";
    } else if (bullishCount <= 1) {
      regime = "WEAK_DOWNTREND";
    } else {
      regime = "NEUTRAL";
    }
    if (adxStrengthening) regime = `${regime}_STRENGTHENING`;
    else if (adxWeakening) regime = `${regime}_WEAKENING`;
  } else {
    const priceDeviation = Math.abs(price - sma20) / sma20 * 100;
    if (priceDeviation < 2 && priceAboveSma20 === priceAboveSma50) {
      regime = "RANGING";
    } else if (rsi > 70) {
      regime = "OVERBOUGHT";
    } else if (rsi < 30) {
      regime = "OVERSOLD";
    } else {
      regime = "NEUTRAL";
    }
  }

  // Add HIGH_VOL prefix if elevated (not extreme)
  if (isHighVolatility && !isExtremeDislocation) {
    if (regime.includes("UPTREND") || regime.includes("DOWNTREND") || regime.includes("RALLY")) {
      regime = `HIGH_VOL_${regime}`;
    }
  }

  return {
    regime,
    atr_ratio: Math.round(atrRatio * 100) / 100,
    adx_slope: Math.round(adxSlope * 100) / 100,
    bullish_count: bullishCount,
    is_high_volatility: isHighVolatility,
    is_extreme_dislocation: isExtremeDislocation,
  };
}

/**
 * Calculate regime for every bar (for per-bar regime tracking used in backtest).
 */
export function calculateRegimePerBar(params: {
  adxArr: number[];
  plusDIArr: number[];
  minusDIArr: number[];
  atrArr: number[];
  macdArr: number[];
  macdSignalArr: number[];
  closeArr: number[];
  sma20Arr: number[];
  sma50Arr: number[];
  rsiArr: number[];
}): string[] {
  const n = params.closeArr.length;
  const regimes: string[] = [];

  for (let i = 0; i < n; i++) {
    if (i < 50) {
      regimes.push("NEUTRAL");
      continue;
    }
    const slice = (arr: number[]) => arr.slice(0, i + 1);
    const info = detectRegime({
      adxArr: slice(params.adxArr),
      plusDIArr: slice(params.plusDIArr),
      minusDIArr: slice(params.minusDIArr),
      atrArr: slice(params.atrArr),
      macdArr: slice(params.macdArr),
      macdSignalArr: slice(params.macdSignalArr),
      closeArr: slice(params.closeArr),
      sma20Arr: slice(params.sma20Arr),
      sma50Arr: slice(params.sma50Arr),
      rsiArr: slice(params.rsiArr),
    });
    regimes.push(info.regime);
  }
  return regimes;
}

// ─── Regime helper lookups ────────────────────────────────────
export function getMaxHoldingDays(regime: string): number {
  return REGIME_MAX_HOLDING_DAYS[regime] ?? 20;
}
export function getAtrMultiplier(regime: string): number {
  return REGIME_ATR_MULTIPLIER[regime] ?? 2.2;
}
export function getTrailingAtrMult(regime: string): number {
  return REGIME_TRAILING_ATR_MULT[regime] ?? 1.25;
}
export function getProfitTargetAtr(regime: string): number {
  return REGIME_PROFIT_TARGET_ATR[regime] ?? 4.4;
}
export function getTrailTrigger(regime: string): number {
  return REGIME_TRAIL_TRIGGER[regime] ?? 1.5;
}
export function getConfirmBars(regime: string, exchange = "DEFAULT"): number {
  const table = EXCHANGE_CONFIRM_BARS[exchange] ?? EXCHANGE_CONFIRM_BARS.DEFAULT;
  return table[regime] ?? 2;
}

/** Colour token for regime badge */
export function regimeColor(regime: string): string {
  if (regime.includes("STRONG_UPTREND") || regime.includes("STRENGTHENING_UPTREND")) return "text-green-400 border-green-500/40 bg-green-500/10";
  if (regime.includes("UPTREND")) return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (regime.includes("DOWNTREND") || regime.includes("BEARISH")) return "text-red-400 border-red-500/40 bg-red-500/10";
  if (regime.includes("BEAR_RALLY") || regime.includes("EXHAUSTING")) return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  if (regime.includes("RANGING") || regime.includes("NEUTRAL")) return "text-sky-400 border-sky-500/40 bg-sky-500/10";
  if (regime.includes("OVERBOUGHT")) return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
  if (regime.includes("OVERSOLD")) return "text-purple-400 border-purple-500/40 bg-purple-500/10";
  if (regime.includes("HIGH_VOL") || regime.includes("EXTREME_VOL")) return "text-amber-400 border-amber-500/40 bg-amber-500/10";
  return "text-slate-400 border-slate-500/40 bg-slate-500/10";
}
