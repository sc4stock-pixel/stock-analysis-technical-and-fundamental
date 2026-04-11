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
 * atrPeriod=10, multiplier=3.0
 *
 * Formula:
 *   Upper Band = HL2 + (multiplier x ATR)  <- resistance in downtrend
 *   Lower Band = HL2 - (multiplier x ATR)  <- support in uptrend
 *
 * Band locking rules (prevent whipsawing):
 *   finalLower[i] = max(lowerBand[i], finalLower[i-1])  IF close[i-1] >= finalLower[i-1]
 *                 = lowerBand[i]                          OTHERWISE (reset)
 *   finalUpper[i] = min(upperBand[i], finalUpper[i-1])  IF close[i-1] <= finalUpper[i-1]
 *                 = upperBand[i]                          OTHERWISE (reset)
 *
 * Direction:
 *   Uptrend  (1): continues while close >= finalLower; flips bearish when close < finalLower
 *   Downtrend(-1): continues while close <= finalUpper; flips bullish when close > finalUpper
 *
 * Returns: [supertrendLine, direction, signal]
 *   signal = 'BUY' on bearish->bullish flip, 'SELL' on bullish->bearish flip, 'HOLD' otherwise
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

  const stLine   = new Array(n).fill(NaN);
  const dirArr   = new Array(n).fill(1);
  const sigArr   = new Array(n).fill("HOLD");

  const finalUpper = new Array(n).fill(NaN);
  const finalLower = new Array(n).fill(NaN);

  // Find first valid ATR bar
  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (!isNaN(atrArr[i])) { firstValid = i; break; }
  }
  if (firstValid < 0) return [stLine, dirArr, sigArr];

  // Seed first valid bar
  const hl2_0 = (highs[firstValid] + lows[firstValid]) / 2;
  finalUpper[firstValid] = hl2_0 + multiplier * atrArr[firstValid];
  finalLower[firstValid] = hl2_0 - multiplier * atrArr[firstValid];
  dirArr[firstValid] = 1;
  stLine[firstValid] = finalLower[firstValid];

  for (let i = firstValid + 1; i < n; i++) {
    if (isNaN(atrArr[i])) {
      finalUpper[i] = finalUpper[i - 1];
      finalLower[i] = finalLower[i - 1];
      dirArr[i]     = dirArr[i - 1];
      stLine[i]     = stLine[i - 1];
      continue;
    }

    const hl2 = (highs[i] + lows[i]) / 2;
    const rawUpper = hl2 + multiplier * atrArr[i];
    const rawLower = hl2 - multiplier * atrArr[i];

    // Lock lower band upward (support can only rise while price stays above it)
    finalLower[i] = (closes[i - 1] >= finalLower[i - 1])
      ? Math.max(rawLower, finalLower[i - 1])
      : rawLower;

    // Lock upper band downward (resistance can only fall while price stays below it)
    finalUpper[i] = (closes[i - 1] <= finalUpper[i - 1])
      ? Math.min(rawUpper, finalUpper[i - 1])
      : rawUpper;

    // Direction
    const prevDir = dirArr[i - 1];
    let curDir: number;
    if (prevDir === 1) {
      // Uptrend: stays bullish unless close drops below lower band
      curDir = closes[i] >= finalLower[i] ? 1 : -1;
    } else {
      // Downtrend: stays bearish unless close rises above upper band
      curDir = closes[i] <= finalUpper[i] ? -1 : 1;
    }

    dirArr[i] = curDir;
    stLine[i] = curDir === 1 ? finalLower[i] : finalUpper[i];

    if (prevDir !== curDir) {
      sigArr[i] = curDir === 1 ? "BUY" : "SELL";
    }
  }

  return [stLine, dirArr, sigArr];
}
