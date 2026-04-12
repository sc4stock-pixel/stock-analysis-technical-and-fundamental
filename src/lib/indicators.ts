// ============================================================
// TECHNICAL INDICATORS — exact port of Python TechnicalIndicators
// Wilder's RMA (EWM alpha=1/period, adjust=False) everywhere
// ============================================================

/**
 * Exponential weighted moving average using Wilder's smoothing.
 * Matches: series.ewm(alpha=1/period, adjust=False).mean()
 */
function ewm(values: number[], alpha: number): number[] {
  const result = new Array(values.length).fill(NaN);
  let initialized = false;
  for (let i = 0; i < values.length; i++) {
    if (isNaN(values[i])) continue;
    if (!initialized) {
      result[i] = values[i];
      initialized = true;
    } else {
      const prev = result[i - 1] !== undefined && !isNaN(result[i - 1])
        ? result[i - 1]
        : values[i];
      result[i] = alpha * values[i] + (1 - alpha) * prev;
    }
  }
  return result;
}

/**
 * RSI — Wilder's RMA smoothing with edge case handling.
 * Exact match to Python: alpha=1/period, adjust=False
 * Edge cases: avg_loss=0 → RSI=100; both=0 → RSI=50; avg_gain=0 → RSI=0
 */
export function rsi(closes: number[], period = 14): number[] {
  const deltas = closes.map((c, i) => (i === 0 ? NaN : c - closes[i - 1]));
  const gains = deltas.map((d) => (isNaN(d) ? NaN : d > 0 ? d : 0));
  const losses = deltas.map((d) => (isNaN(d) ? NaN : d < 0 ? -d : 0));

  const alpha = 1 / period;
  const avgGain = ewm(gains, alpha);
  const avgLoss = ewm(losses, alpha);

  return closes.map((_, i) => {
    const ag = avgGain[i];
    const al = avgLoss[i];
    if (isNaN(ag) || isNaN(al)) return NaN;
    if (ag === 0 && al === 0) return 50; // both zero → neutral
    if (al === 0) return 100; // no losses → RSI=100
    if (ag === 0) return 0; // no gains → RSI=0
    const rs = ag / al;
    return Math.min(100, Math.max(0, 100 - 100 / (1 + rs)));
  });
}

/**
 * MACD — EMA smoothing (span=fast/slow/signal).
 * Returns [macdLine, signalLine, histogram]
 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): [number[], number[], number[]] {
  const alphaFast = 2 / (fast + 1);
  const alphaSlow = 2 / (slow + 1);
  const alphaSignal = 2 / (signal + 1);

  const emaFast = ewm(closes, alphaFast);
  const emaSlow = ewm(closes, alphaSlow);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ewm(macdLine, alphaSignal);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);

  return [macdLine, signalLine, histogram];
}

/**
 * ATR — Wilder's ATR using RMA smoothing.
 * Matches: tr.ewm(alpha=1/period, adjust=False).mean()
 */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  const tr = highs.map((h, i) => {
    if (i === 0) return h - lows[i];
    const hl = h - lows[i];
    const hc = Math.abs(h - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    return Math.max(hl, hc, lc);
  });
  return ewm(tr, 1 / period);
}

/**
 * ADX — Wilder's ADX with DM mutual exclusion and RMA smoothing.
 * Returns [adx, plusDI, minusDI]
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): [number[], number[], number[]] {
  const n = highs.length;
  const plusDM = new Array(n).fill(NaN);
  const minusDM = new Array(n).fill(NaN);
  const trArr = new Array(n).fill(NaN);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    // Mutual exclusion rule
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trArr[i] = Math.max(hl, hc, lc);
  }

  const alpha = 1 / period;
  const smoothedATR = ewm(trArr, alpha);
  const smoothedPlusDM = ewm(plusDM, alpha);
  const smoothedMinusDM = ewm(minusDM, alpha);

  const plusDI = smoothedATR.map((a, i) =>
    a > 0 ? (100 * smoothedPlusDM[i]) / a : 0
  );
  const minusDI = smoothedATR.map((a, i) =>
    a > 0 ? (100 * smoothedMinusDM[i]) / a : 0
  );

  const dx = plusDI.map((p, i) => {
    const sum = p + minusDI[i];
    return sum > 0 ? (100 * Math.abs(p - minusDI[i])) / sum : 0;
  });

  const adxValues = ewm(dx, alpha).map((v) => (isNaN(v) ? 0 : v));
  return [adxValues, plusDI, minusDI];
}

/**
 * Bollinger Bands — population std (ddof=0).
 * Returns [upper, middle, lower]
 */
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2
): [number[], number[], number[]] {
  const upper = new Array(closes.length).fill(NaN);
  const middle = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    // Population std (ddof=0)
    const variance = slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    middle[i] = sma;
    upper[i] = sma + stdDev * std;
    lower[i] = sma - stdDev * std;
  }
  return [upper, middle, lower];
}

/**
 * Simple Moving Average
 */
export function sma(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

/**
 * Standard Exponential Moving Average — alpha = 2/(period+1).
 * Matches: pandas series.ewm(span=period, adjust=False).mean()
 * Used for the 50-day EMA filter in SuperTrend entry condition.
 */
export function ema(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  return ewm(values, alpha);
}

/**
 * Volume ratio vs 20-period rolling mean (shifted to avoid look-ahead)
 */
export function volumeRatio(volumes: number[], period = 20): number[] {
  return volumes.map((v, i) => {
    if (i < period) return 1.0;
    // Shifted mean: use previous day's average (i-period to i-1)
    const slice = volumes.slice(i - period, i);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    return mean > 0 ? v / mean : 1.0;
  });
}

/**
 * SuperTrend Indicator — exact port of Python TechnicalIndicators.supertrend()
 *
 * Matches Python logic precisely:
 * 1. Band adjustment: based on close vs previous ST LINE (not bands independently)
 *    - if close[i-1] > stLine[i-1]: lock lower band upward (we were above ST = uptrend support)
 *    - else: lock upper band downward (we were below ST = downtrend resistance)
 * 2. Direction flip: compare close[i] vs PREVIOUS RAW bands (upper_band[i-1], lower_band[i-1])
 *    - close[i] > upper_band[i-1] → bullish flip
 *    - close[i] < lower_band[i-1] → bearish flip
 *    - else → keep previous direction
 * 3. Seed: first bar = upper_band (bearish default), direction = 1 only if close > upper
 *
 * Returns: [supertrendLine, direction, signal]
 *   signal = 'BUY' on bearish→bullish flip, 'SELL' on bullish→bearish flip, 'HOLD' otherwise
 */
export function supertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  atrPeriod = 10,
  multiplier = 3.0
): [number[], number[], string[]] {
  const n = closes.length;
  const atrArr = atr(highs, lows, closes, atrPeriod);

  const stLine = new Array(n).fill(NaN);
  const dirArr = new Array(n).fill(-1);
  const sigArr = new Array(n).fill("HOLD");

  // Raw band arrays (recomputed each bar from HL2 + ATR)
  const upperBand = new Array(n).fill(NaN);
  const lowerBand = new Array(n).fill(NaN);

  // Build raw bands first
  for (let i = 0; i < n; i++) {
    if (isNaN(atrArr[i])) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    upperBand[i] = hl2 + multiplier * atrArr[i];
    lowerBand[i] = hl2 - multiplier * atrArr[i];
  }

  // Find first valid bar
  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (!isNaN(atrArr[i])) { firstValid = i; break; }
  }
  if (firstValid < 0) return [stLine, dirArr, sigArr];

  // Seed: Python sets supertrend[first] = upper_band[first] (bearish default)
  // direction[first] = 1 only if close > upper_band (rare), else -1
  stLine[firstValid] = upperBand[firstValid];
  dirArr[firstValid] = closes[firstValid] > upperBand[firstValid] ? 1 : -1;

  for (let i = firstValid + 1; i < n; i++) {
    if (isNaN(upperBand[i]) || isNaN(lowerBand[i])) {
      upperBand[i] = upperBand[i - 1];
      lowerBand[i] = lowerBand[i - 1];
      dirArr[i]    = dirArr[i - 1];
      stLine[i]    = stLine[i - 1];
      continue;
    }

    // Band adjustment: Python checks close[i-1] vs stLine[i-1] (the active ST value)
    if (closes[i - 1] > stLine[i - 1]) {
      // Was above ST line → lock lower band upward (support rising)
      lowerBand[i] = Math.max(lowerBand[i], lowerBand[i - 1]);
    } else {
      // Was below ST line → lock upper band downward (resistance falling)
      upperBand[i] = Math.min(upperBand[i], upperBand[i - 1]);
    }

    // Direction flip: compare close[i] vs PREVIOUS bars' (already-adjusted) bands
    let curDir: number;
    if (closes[i] > upperBand[i - 1]) {
      curDir = 1;   // Crossed above upper band → bullish
    } else if (closes[i] < lowerBand[i - 1]) {
      curDir = -1;  // Crossed below lower band → bearish
    } else {
      curDir = dirArr[i - 1]; // No flip
    }

    dirArr[i] = curDir;
    stLine[i] = curDir === 1 ? lowerBand[i] : upperBand[i];

    if (dirArr[i - 1] !== curDir) {
      sigArr[i] = curDir === 1 ? "BUY" : "SELL";
    }
  }

  return [stLine, dirArr, sigArr];
}
