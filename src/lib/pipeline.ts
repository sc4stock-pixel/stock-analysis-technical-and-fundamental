// ============================================================
// ANALYSIS PIPELINE — V14 + SuperTrend Parameter Optimization
//
// Key changes:
//   1. optimizeSupertrend() runs a 25-combo grid search (ATR 10-14, mult 2.5-3.5)
//      BEFORE the ST backtest. Optimal params are used for:
//        - stEntrySignal loop (signal generation)
//        - runSupertrendBacktest() (the actual backtest)
//      Chart overlay (chart_bars) keeps default params for visual consistency.
//   2. ST entry: SMA50 crossover signal catches "already bullish + SMA confirmed" entries
//   3. signals.ts velocity filter is applied to rawSignal BEFORE confirm bars
//   4. chart_bars = 500 for 2Y toggle
// ============================================================
import { AppConfig, StockAnalysisResult, KellyResult, WalkForwardResult, OHLCVBar, ChartBar } from "@/types";
import { rsi, macd, adx, atr, bollingerBands, sma, ema, volumeRatio, supertrend } from "./indicators";
import { calculateRegimePerBar, detectRegime } from "./regime";
import { calculateScores, detectRsiDivergence } from "./scoring";
import { generateSignals } from "./signals";
import { runBacktest, runSupertrendBacktest } from "./backtest";
import { runMonteCarlo } from "./montecarlo";
import { optimizeSupertrend } from "./supertrend_optimizer";

export interface RawOHLCV {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

export function runPipeline(
  rawBars: RawOHLCV[],
  stockConfig: { symbol: string; name: string; exchange: string },
  config: AppConfig,
  currentPrice: number,
  changePct: number
): StockAnalysisResult {
  const closes  = rawBars.map(b => b.close);
  const highs   = rawBars.map(b => b.high);
  const lows    = rawBars.map(b => b.low);
  const volumes = rawBars.map(b => b.volume);

  // ── Indicators ────────────────────────────────────────────────
  const rsiArr   = rsi(closes, config.analysis.rsiPeriod);
  const [macdLine, macdSignal, macdHist] = macd(closes, config.analysis.macdFast, config.analysis.macdSlow, config.analysis.macdSignal);
  const [adxArr, plusDIArr, minusDIArr]  = adx(highs, lows, closes, config.analysis.adxPeriod);
  const atrArr   = atr(highs, lows, closes, config.analysis.atrPeriod);
  const sma20Arr = sma(closes, config.analysis.smaShort);
  const sma50Arr = sma(closes, config.analysis.smaLong);
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);                        // chart display only

  const ema20SlopeArr = ema20Arr.map((v, i) =>
    (i < 3 || isNaN(v) || isNaN(ema20Arr[i - 3])) ? 0 : v - ema20Arr[i - 3]
  );
  const [bbUpper, bbMid, bbLower] = bollingerBands(closes);
  const volRatioArr = volumeRatio(volumes, config.analysis.volumePeriod);

  // Default ST params for chart overlay
  const stConfig = config.supertrend ?? { atrPeriod: 10, multiplier: 3.0, filter_mode: "ema_only" };
  const [stArr, stDirArr, stSigArr] = supertrend(highs, lows, closes, stConfig.atrPeriod, stConfig.multiplier);

  const adxSlope3 = adxArr.map((v, i) => (i < 3 ? 0 : v - adxArr[i - 3]));

  const volAccumulation = volumes.map((v, i) => {
    if (i < 20) return 0;
    const slice = volumes.slice(i - 20, i);
    const avg   = slice.reduce((a, b) => a + b, 0) / slice.length;
    return v > avg * 1.5 && closes[i] > rawBars[i].open ? 1 : 0;
  });

  const trendGate = closes.map((c, i) =>
    c > sma20Arr[i] && c > sma50Arr[i] && sma20Arr[i] > sma50Arr[i] ? 1 : 0
  );

  const bbPosition = closes.map((c, i) => {
    const range = bbUpper[i] - bbLower[i];
    return range > 0 ? (c - bbLower[i]) / range : 0.5;
  });

  const regimeArr = calculateRegimePerBar({
    adxArr, plusDIArr, minusDIArr, atrArr,
    macdArr: macdLine, macdSignalArr: macdSignal,
    closeArr: closes, sma20Arr, sma50Arr, rsiArr,
  });

  const [rsiDivScalar, rsiDivTypeScalar] = detectRsiDivergence(closes, rsiArr, config.analysis.divergenceLookback);
  const rsiDivArr     = closes.map(() => rsiDivScalar);
  const rsiDivTypeArr = closes.map(() => rsiDivTypeScalar);

  const barScores = calculateScores({
    rsiArr, macdArr: macdLine, macdSignalArr: macdSignal, macdHistArr: macdHist,
    adxArr, plusDIArr, minusDIArr, adxSlopeArr: adxSlope3,
    closeArr: closes, sma20Arr, sma50Arr,
    bbUpperArr: bbUpper, bbMidArr: bbMid, bbLowerArr: bbLower,
    volRatioArr, volAccumulationArr: volAccumulation,
    trendGateArr: trendGate, rsiDivergenceArr: rsiDivArr, regimeArr,
  });

  // ── Assemble OHLCVBar array ───────────────────────────────────
  const bars: OHLCVBar[] = rawBars.map((raw, i) => ({
    date: raw.date, open: raw.open, high: raw.high, low: raw.low, close: raw.close, volume: raw.volume,
    atr: atrArr[i] ?? 0, rsi: rsiArr[i] ?? 50,
    macd: macdLine[i] ?? 0, macdSignal: macdSignal[i] ?? 0, macdHist: macdHist[i] ?? 0,
    adx: adxArr[i] ?? 0, plusDI: plusDIArr[i] ?? 0, minusDI: minusDIArr[i] ?? 0,
    sma20: sma20Arr[i] ?? 0, sma50: sma50Arr[i] ?? 0,
    ema20: ema20Arr[i] ?? 0, ema20Slope: ema20SlopeArr[i] ?? 0,
    bbUpper: bbUpper[i] ?? 0, bbMid: bbMid[i] ?? 0, bbLower: bbLower[i] ?? 0,
    bbPosition: bbPosition[i] ?? 0.5, adxSlope: adxSlope3[i] ?? 0,
    volRatio: volRatioArr[i] ?? 1, volAccumulation: volAccumulation[i] ?? 0,
    trendGate: trendGate[i] ?? 0, rsiDivergence: rsiDivArr[i] ?? 0,
    rsiDivergenceType: rsiDivTypeArr[i] ?? "None", regime: regimeArr[i] ?? "NEUTRAL",
    score: barScores[i]?.Score ?? 5, scoreAdjusted: barScores[i]?.Score ?? 5,
    volumeSurge: 0, confidence: barScores[i]?.Confidence ?? 70,
    rawSignal: "HOLD", signalConfirmed: "HOLD", entrySignal: "HOLD", forceEntry: 0,
    // Default ST values (used for chart overlay)
    supertrend: stArr[i] ?? NaN, supertrendDir: stDirArr[i] ?? 1,
    supertrendSignal: stSigArr[i] ?? "HOLD", stEntrySignal: "HOLD",
    ema50: ema50Arr[i] ?? 0,
  }));

  // ── SuperTrend Parameter Optimization ────────────────────────
  // Grid search: ATR [10-14] × Multiplier [2.5-3.5] = 25 combos
  // Selects the combo with the highest Sharpe (min 2 trades).
  // Optimal params are used for signal generation AND the ST backtest.
  // Chart overlay keeps default params (stArr/stDirArr above) for consistency.
  const optResult = optimizeSupertrend(
    bars,
    config.backtest.initialCapital,
    config.backtest.commissionRate,
    config.backtest.slippageRate
  );

  // Recompute ST with optimal params for backtest + signal generation
  const [optStArr, optStDirArr, optStSigArr] = supertrend(
    highs, lows, closes, optResult.atrPeriod, optResult.multiplier
  );

  // ── SuperTrend entry signals using OPTIMAL params ─────────────
  // Two conditions:
  // A) Bullish flip (optStSig='BUY') AND close > SMA50
  // B) Already bullish (no flip) AND price just crossed above SMA50
  //    (catches the "wick stopped out, trend resumed" case like GOOGL 06/23)
  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = bars[i];
    const prev = bars[i - 1];

    if (optStSigArr[i] === "SELL") {
      bars[i + 1].stEntrySignal = "SELL";
      continue;
    }
    if (optStSigArr[i] === "BUY") {
      // Condition A: bullish flip with SMA50 filter
      const smaFilter = stConfig.filter_mode === "ema_only"
        ? cur.close > cur.sma50
        : cur.close > cur.sma50 && cur.adx > 20;
      if (smaFilter) bars[i + 1].stEntrySignal = "BUY";
      continue;
    }
    // Condition B: already bullish, SMA50 upward crossover
    if (optStDirArr[i] === 1) {
      const smaUpCross = cur.close > cur.sma50 && prev.close <= prev.sma50;
      if (smaUpCross) bars[i + 1].stEntrySignal = "BUY";
    }
  }

  // ── Score signals ─────────────────────────────────────────────
  generateSignals(bars, config, stockConfig.exchange);

  // ── Dual Backtest ─────────────────────────────────────────────
  const backtestResult = runBacktest(bars, stockConfig.symbol, config, stockConfig.exchange);

  // ST backtest: inject optimal params into bars temporarily
  // We need bars with optimal ST values for the backtest loop.
  // Create a patched copy with optimal supertrend/dir/signal values.
  const barsForST: OHLCVBar[] = bars.map((b, i) => ({
    ...b,
    supertrend:       optStArr[i]    ?? NaN,
    supertrendDir:    optStDirArr[i] ?? 1,
    supertrendSignal: optStSigArr[i] ?? "HOLD",
    // stEntrySignal already set on bars[] above (same loop, uses optStDirArr)
  }));
  const stBacktestResult = runSupertrendBacktest(barsForST, stockConfig.symbol, config);

  // ── Monte Carlo ───────────────────────────────────────────────
  const mcResult   = config.monteCarlo.enabled && backtestResult.equity_curve.length   >= 30 ? runMonteCarlo(backtestResult.equity_curve,   config) : null;
  const stMcResult = config.monteCarlo.enabled && stBacktestResult.equity_curve.length >= 30 ? runMonteCarlo(stBacktestResult.equity_curve, config) : null;

  // ── Walk-Forward + Kelly ──────────────────────────────────────
  let walkForward: WalkForwardResult | null = null;
  if (config.walkForward.enabled && bars.length >= 100) {
    walkForward = runWalkForward(bars, stockConfig.symbol, config, stockConfig.exchange);
  }
  let kelly: KellyResult | null = null;
  if (backtestResult.trades.length >= 5) kelly = calcKelly(backtestResult, config);

  // ── Current regime ────────────────────────────────────────────
  const regimeInfo = detectRegime({
    adxArr, plusDIArr, minusDIArr, atrArr,
    macdArr: macdLine, macdSignalArr: macdSignal,
    closeArr: closes, sma20Arr, sma50Arr, rsiArr,
  });

  const lastBar = bars[bars.length - 1];
  const signal  = lastBar.signalConfirmed ?? "HOLD";

const chartBars: ChartBar[] = bars.slice(-500).map((b, i) => {
  const offset = bars.length - Math.min(500, bars.length);
  const absIdx = offset + i;
  return {
    date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    sma20: b.sma20, sma50: b.sma50, ema20: b.ema20, ema50: b.ema50,
    bbUpper: b.bbUpper, bbLower: b.bbLower, signal: b.signalConfirmed, score: b.score,
    rsi: b.rsi, macd: b.macd, macdSig: b.macdSignal, macdHist: b.macdHist,
    adx: b.adx, pdi: b.plusDI, mdi: b.minusDI,
    // Use OPTIMIZED ST params for chart overlay — matches st_direction/st_value
    supertrend: optStArr[absIdx] ?? NaN,
    supertrendDir: optStDirArr[absIdx] ?? -1,
  };
});

  // ── ST status (uses optimal params for current direction/value) ─
  const lastOptDir = optStDirArr[optStDirArr.length - 1] ?? -1;
  const lastOptST  = optStArr[optStArr.length - 1] ?? 0;
  const stDirection   = lastOptDir;
  const stValue       = !isNaN(lastOptST) ? lastOptST : 0;
  const stStopDistPct = stValue > 0 && currentPrice > 0 ? ((currentPrice - stValue) / currentPrice) * 100 : 0;

  // ── ST open position detection (uses optimal params) ──────────
  let stOpenReturnPct: number | null = null;
  if (stDirection === 1) {
    let openEntryPrice: number | null = null;
    let trailingStop:   number | null = null;

    for (let i = 1; i < bars.length; i++) {
      const cur  = bars[i];
      const prev = bars[i - 1];

      if (openEntryPrice === null) {
        if (cur.stEntrySignal === "BUY") {
          openEntryPrice = cur.open * (1 + config.backtest.slippageRate);
          const prevOptST = optStArr[i - 1];
          trailingStop = (!isNaN(prevOptST) && prevOptST > 0) ? prevOptST : null;
        }
      } else {
        const curOptST = optStArr[i];
        if (!isNaN(curOptST) && (trailingStop === null || curOptST > trailingStop)) {
          trailingStop = curOptST;
        }
        const stopHit    = trailingStop !== null && cur.low <= trailingStop;
        const sellSignal = optStSigArr[i - 1] === "SELL";
        if (stopHit || sellSignal) { openEntryPrice = null; trailingStop = null; }
      }
    }
    if (openEntryPrice !== null && openEntryPrice > 0) {
      stOpenReturnPct = ((currentPrice - openEntryPrice) / openEntryPrice) * 100;
    }
  }

  // ── Strategy comparison ───────────────────────────────────────
  function toMetrics(bt: typeof backtestResult) {
    return {
      total_return: bt.total_return, total_return_250d: bt.total_return_250d, total_return_500d: bt.total_return_500d,
      win_rate: bt.win_rate, num_trades: bt.num_trades, profit_factor: bt.profit_factor,
      max_drawdown: bt.max_drawdown, sharpe: bt.sharpe, sortino: bt.sortino,
      expectancy: bt.expectancy, avg_win: bt.avg_win, avg_loss: bt.avg_loss,
      alpha: bt.alpha, trades: bt.trades,
    };
  }

  const scoreAlpha = backtestResult.alpha;
  const stAlpha    = stBacktestResult.alpha;
  const winner: "score" | "supertrend" | "tie" =
    Math.abs(scoreAlpha - stAlpha) < 0.5 ? "tie" : scoreAlpha > stAlpha ? "score" : "supertrend";

  return {
    symbol: stockConfig.symbol, name: stockConfig.name, exchange: stockConfig.exchange,
    signal, score: lastBar.score, confidence: lastBar.confidence,
    regime: regimeInfo.regime, regime_info: regimeInfo,
    current_price: currentPrice, change_pct: changePct,
    backtest: backtestResult, monte_carlo: mcResult, st_monte_carlo: stMcResult,
    walk_forward: walkForward, kelly, chart_bars: chartBars,
    st_direction: stDirection, st_value: stValue,
    st_stop_distance_pct: stStopDistPct, st_open_return_pct: stOpenReturnPct,
    // Expose optimal params so UI can display them
    st_opt_params: { atrPeriod: optResult.atrPeriod, multiplier: optResult.multiplier, sharpe: optResult.sharpe, numTrades: optResult.numTrades },
    comparison: {
      score: toMetrics(backtestResult), supertrend: toMetrics(stBacktestResult),
      winner, winner_margin: Math.abs(scoreAlpha - stAlpha),
    },
  };
}

function runWalkForward(bars: OHLCVBar[], symbol: string, config: AppConfig, exchange: string): WalkForwardResult | null {
  const splitIdx = Math.floor(bars.length * config.walkForward.trainRatio);
  const trainBars = bars.slice(0, splitIdx);
  const testBars  = bars.slice(splitIdx);
  if (trainBars.length < 50 || testBars.length < 20) return null;

  let bestParams = { entryThreshold: 5.5, maxHoldingDays: 8 };
  let bestSharpe = -999;

  for (const entry of [5.0, 5.5, 6.0, 6.5]) {
    for (const maxDays of [8, 10, 12, 15]) {
      const r = runBacktest([...trainBars], symbol, { ...config, signal: { ...config.signal, entryThreshold: entry, maxHoldingDays: maxDays } }, exchange);
      if (r.sharpe > bestSharpe) { bestSharpe = r.sharpe; bestParams = { entryThreshold: entry, maxHoldingDays: maxDays }; }
    }
  }

  const testResult = runBacktest([...testBars], symbol, { ...config, signal: { ...config.signal, ...bestParams } }, exchange);
  const trainSharpe = bestSharpe; const testSharpe = testResult.sharpe;
  const efficiencyRatio   = (trainSharpe > 0 && testSharpe > 0) ? Math.min(1.5, testSharpe / trainSharpe) : 0;
  const efficiencyQuality = efficiencyRatio >= 0.7 ? "GOOD" : efficiencyRatio >= 0.4 ? "ACCEPTABLE" : "OVERFIT";

  return {
    best_params: bestParams,
    train_sharpe: Math.round(trainSharpe * 100) / 100, test_sharpe: Math.round(testSharpe * 100) / 100,
    efficiency_ratio: Math.round(efficiencyRatio * 100) / 100, efficiency_quality: efficiencyQuality,
    passed: efficiencyRatio >= 0.4 && testSharpe > 0,
  };
}

function calcKelly(bt: { trades: { return: number; r_multiple: number }[]; latest_atr: number | null; latest_price: number }, config: AppConfig): KellyResult {
  const trades = bt.trades;
  if (trades.length < 5) return { kelly_fraction: 0.10, full_kelly: 0.40, recommended_fraction: 0.10, sizing_method: "Default", atr_shares: 0, correlation_adjustment: 1.0, correlated_with: null };

  const wins = trades.filter(t => t.return > 0); const losses = trades.filter(t => t.return <= 0);
  const p = wins.length / trades.length;
  const avgWinR  = wins.length   > 0 ? wins.reduce((a, t) => a + t.r_multiple, 0)             / wins.length   : 1;
  const avgLossR = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.r_multiple, 0)) / losses.length : 1;
  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;
  const fullKelly = b > 0 ? Math.max(0, (p * b - (1 - p)) / b) : 0;
  let kellyFraction = Math.min(fullKelly * 0.25 * 0.8, 0.25);
  if (fullKelly > 0 && kellyFraction < 0.05) kellyFraction = 0.05;

  const { riskPerTrade, atrMultiplier, maxPositionSize } = config.risk;
  const { initialCapital } = config.backtest;
  let atrFraction = 0, atrShares = 0;
  if (bt.latest_atr && bt.latest_atr > 0 && bt.latest_price > 0) {
    const stopDistance = atrMultiplier * bt.latest_atr;
    if (stopDistance > 0) { atrShares = (initialCapital * riskPerTrade) / stopDistance; atrFraction = Math.min((atrShares * bt.latest_price) / initialCapital, maxPositionSize); }
  }
  const recommended = atrFraction > 0 ? Math.min(kellyFraction, atrFraction) : kellyFraction;
  const method = atrFraction > 0 ? (kellyFraction <= atrFraction ? "Kelly-Binding" : "ATR-Binding") : "Kelly-Only";

  return {
    kelly_fraction: Math.round(kellyFraction * 10000) / 10000, full_kelly: Math.round(fullKelly * 10000) / 10000,
    recommended_fraction: Math.round(recommended * 10000) / 10000, sizing_method: method,
    atr_shares: Math.floor(atrShares), correlation_adjustment: 1.0, correlated_with: null,
  };
}
