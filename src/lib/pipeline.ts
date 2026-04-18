// ============================================================
// ANALYSIS PIPELINE — orchestrates all modules in sequence
// Mirrors Python's main analysis flow per stock
// ============================================================
import { AppConfig, StockAnalysisResult, KellyResult, WalkForwardResult, OHLCVBar, ChartBar } from "@/types";
import { rsi, macd, adx, atr, bollingerBands, sma, ema, volumeRatio, supertrend } from "./indicators";
import { calculateRegimePerBar, detectRegime } from "./regime";
import { calculateScores, detectRsiDivergence } from "./scoring";
import { generateSignals } from "./signals";
import { runBacktest, runSupertrendBacktest } from "./backtest";
import { runMonteCarlo } from "./montecarlo";

export interface RawOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function runPipeline(
  rawBars: RawOHLCV[],
  stockConfig: { symbol: string; name: string; exchange: string },
  config: AppConfig,
  currentPrice: number,
  changePct: number
): StockAnalysisResult {
  const n = rawBars.length;
  const closes = rawBars.map((b) => b.close);
  const highs = rawBars.map((b) => b.high);
  const lows = rawBars.map((b) => b.low);
  const volumes = rawBars.map((b) => b.volume);

  // ── Indicators ───────────────────────────────────────────────
  const rsiArr = rsi(closes, config.analysis.rsiPeriod);
  const [macdLine, macdSignal, macdHist] = macd(closes, config.analysis.macdFast, config.analysis.macdSlow, config.analysis.macdSignal);
  const [adxArr, plusDIArr, minusDIArr] = adx(highs, lows, closes, config.analysis.adxPeriod);
  const atrArr = atr(highs, lows, closes, config.analysis.atrPeriod);
  const sma20Arr = sma(closes, config.analysis.smaShort);
  const sma50Arr = sma(closes, config.analysis.smaLong);
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);

  const ema20SlopeArr = ema20Arr.map((v, i) => (i < 3 || isNaN(v) || isNaN(ema20Arr[i - 3])) ? 0 : v - ema20Arr[i - 3]);
  const [bbUpper, bbMid, bbLower] = bollingerBands(closes);
  const volRatioArr = volumeRatio(volumes, config.analysis.volumePeriod);

  // SuperTrend
  const stConfig = config.supertrend ?? { atrPeriod: 10, multiplier: 3.0, filter_mode: "ema_only" };
  const [stArr, stDirArr, stSigArr] = supertrend(highs, lows, closes, stConfig.atrPeriod, stConfig.multiplier);

  const adxSlope3 = adxArr.map((v, i) => (i < 3 ? 0 : v - adxArr[i - 3]));

  const volAccumulation = volumes.map((v, i) => {
    if (i < 20) return 0;
    const slice = volumes.slice(i - 20, i);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    return v > mean * 1.5 && closes[i] > rawBars[i].open ? 1 : 0;
  });

  const trendGate = closes.map((c, i) =>
    c > sma20Arr[i] && c > sma50Arr[i] && sma20Arr[i] > sma50Arr[i] ? 1 : 0
  );

  const bbPosition = closes.map((c, i) => {
    const range = bbUpper[i] - bbLower[i];
    return range > 0 ? (c - bbLower[i]) / range : 0.5;
  });

  // ── Regime per bar ────────────────────────────────────────────
  const regimeArr = calculateRegimePerBar({
    adxArr, plusDIArr, minusDIArr, atrArr,
    macdArr: macdLine, macdSignalArr: macdSignal,
    closeArr: closes, sma20Arr, sma50Arr, rsiArr,
  });

  const [rsiDivScalar, rsiDivTypeScalar] = detectRsiDivergence(
    closes, rsiArr, config.analysis.divergenceLookback
  );
  const rsiDivArr = closes.map(() => rsiDivScalar);
  const rsiDivTypeArr = closes.map(() => rsiDivTypeScalar);

  // ── Scores ───────────────────────────────────────────────────
  const barScores = calculateScores({
    rsiArr, macdArr: macdLine, macdSignalArr: macdSignal, macdHistArr: macdHist,
    adxArr, plusDIArr, minusDIArr, adxSlopeArr: adxSlope3,
    closeArr: closes, sma20Arr, sma50Arr,
    bbUpperArr: bbUpper, bbMidArr: bbMid, bbLowerArr: bbLower,
    volRatioArr, volAccumulationArr: volAccumulation,
    trendGateArr: trendGate, rsiDivergenceArr: rsiDivArr, regimeArr,
  });

  // ── Assemble OHLCVBar array ──────────────────────────────────
  const bars: OHLCVBar[] = rawBars.map((raw, i) => ({
    date: raw.date,
    open: raw.open,
    high: raw.high,
    low: raw.low,
    close: raw.close,
    volume: raw.volume,
    atr: atrArr[i] ?? 0,
    rsi: rsiArr[i] ?? 50,
    macd: macdLine[i] ?? 0,
    macdSignal: macdSignal[i] ?? 0,
    macdHist: macdHist[i] ?? 0,
    adx: adxArr[i] ?? 0,
    plusDI: plusDIArr[i] ?? 0,
    minusDI: minusDIArr[i] ?? 0,
    sma20: sma20Arr[i] ?? 0,
    sma50: sma50Arr[i] ?? 0,
    ema20: ema20Arr[i] ?? 0,
    ema20Slope: ema20SlopeArr[i] ?? 0,
    bbUpper: bbUpper[i] ?? 0,
    bbMid: bbMid[i] ?? 0,
    bbLower: bbLower[i] ?? 0,
    bbPosition: bbPosition[i] ?? 0.5,
    adxSlope: adxSlope3[i] ?? 0,
    volRatio: volRatioArr[i] ?? 1,
    volAccumulation: volAccumulation[i] ?? 0,
    trendGate: trendGate[i] ?? 0,
    rsiDivergence: rsiDivArr[i] ?? 0,
    rsiDivergenceType: rsiDivTypeArr[i] ?? "None",
    regime: regimeArr[i] ?? "NEUTRAL",
    score: barScores[i]?.Score ?? 5,
    scoreAdjusted: barScores[i]?.Score ?? 5,
    volumeSurge: 0,
    confidence: barScores[i]?.Confidence ?? 70,
    rawSignal: "HOLD",
    signalConfirmed: "HOLD",
    entrySignal: "HOLD",
    forceEntry: 0,
    supertrend: stArr[i] ?? NaN,
    supertrendDir: stDirArr[i] ?? 1,
    supertrendSignal: stSigArr[i] ?? "HOLD",
    stEntrySignal: "HOLD",
    ema50: ema50Arr[i] ?? 0,
  }));

  // ── SuperTrend entry signal with EMA filter ──────────────────
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];

    const isBullishFlip = cur.supertrendDir === 1 && prev.supertrendDir === -1;
    const isBearishFlip = cur.supertrendDir === -1 && prev.supertrendDir === 1;

    if (i + 1 < bars.length) {
      if (isBullishFlip) {
        const emaFilter = stConfig.filter_mode === "ema_only"
          ? cur.close > cur.ema50
          : cur.close > cur.ema50 && cur.adx > 20;

        if (emaFilter) {
          bars[i + 1].stEntrySignal = "BUY";
        }
      } else if (isBearishFlip) {
        bars[i + 1].stEntrySignal = "SELL";
      }
    }
  }

  // ── Generate Signals ─────────────────────────────────────────
  generateSignals(bars, config, stockConfig.exchange);

  // ── Dual Backtest ─────────────────────────────────────────────
  const backtestResult = runBacktest(bars, stockConfig.symbol, config, stockConfig.exchange);
  const stBacktestResult = runSupertrendBacktest(bars, stockConfig.symbol, config);

  // ── Monte Carlo ───────────────────────────────────────────────
  const mcResult = config.monteCarlo.enabled && backtestResult.equity_curve.length >= 30
    ? runMonteCarlo(backtestResult.equity_curve, config)
    : null;

  const stMcResult = config.monteCarlo.enabled && stBacktestResult.equity_curve.length >= 30
    ? runMonteCarlo(stBacktestResult.equity_curve, config)
    : null;

  // ── Walk-Forward ──────────────────────────────────────────────
  let walkForward: WalkForwardResult | null = null;
  if (config.walkForward.enabled && bars.length >= 100) {
    walkForward = runWalkForward(bars, stockConfig.symbol, config, stockConfig.exchange);
  }

  // ── Kelly Criterion ───────────────────────────────────────────
  let kelly: KellyResult | null = null;
  if (backtestResult.trades.length >= 5) {
    kelly = calcKelly(backtestResult, config);
  }

  // ── Current regime ────────────────────────────────────────────
  const regimeInfo = detectRegime({
    adxArr, plusDIArr, minusDIArr, atrArr,
    macdArr: macdLine, macdSignalArr: macdSignal,
    closeArr: closes, sma20Arr, sma50Arr, rsiArr,
  });

  const lastBar = bars[bars.length - 1];
  const signal = lastBar.signalConfirmed ?? "HOLD";

  // ── Chart bars — send ALL bars (up to 500d) so the 2Y toggle works ──
  // FIX: was bars.slice(-252) which broke the 2Y range selector
  const chartBars: ChartBar[] = bars.slice(-500).map((b) => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    sma20: b.sma20,
    sma50: b.sma50,
    ema20: b.ema20,
    ema50: b.ema50,
    bbUpper: b.bbUpper,
    bbLower: b.bbLower,
    signal: b.signalConfirmed,
    score: b.score,
    rsi: b.rsi,
    macd: b.macd,
    macdSig: b.macdSignal,
    macdHist: b.macdHist,
    adx: b.adx,
    pdi: b.plusDI,
    mdi: b.minusDI,
    supertrend: b.supertrend,
    supertrendDir: b.supertrendDir,
  }));

  // ── SuperTrend status ─────────────────────────────────────────
  const stDirection = lastBar.supertrendDir;
  const stValue = lastBar.supertrend;
  const stStopDistPct = stValue > 0 && currentPrice > 0
    ? ((currentPrice - stValue) / currentPrice) * 100
    : 0;

  // ── SuperTrend open position detection ────────────────────────
  let stOpenReturnPct: number | null = null;
  if (stDirection === 1) {
    let openEntryPrice: number | null = null;
    let trailingStop: number | null = null;

    for (let i = 1; i < bars.length; i++) {
      const cur = bars[i];
      const prev = bars[i - 1];

      if (openEntryPrice === null) {
        if (cur.stEntrySignal === "BUY") {
          openEntryPrice = cur.open * (1 + config.backtest.slippageRate);
          trailingStop = (!isNaN(cur.supertrend) && cur.supertrend > 0)
            ? cur.supertrend : null;
        }
      } else {
        // Only trail upward when in bullish direction (dir===1 means lower band = support)
        if (cur.supertrendDir === 1 && !isNaN(cur.supertrend) &&
            (trailingStop === null || cur.supertrend > trailingStop)) {
          trailingStop = cur.supertrend;
        }
        // Exit on bearish flip
        const stReversalExit = cur.supertrendDir === -1;
        if (stReversalExit) {
          openEntryPrice = null;
          trailingStop = null;
        }
      }
    }

    if (openEntryPrice !== null && openEntryPrice > 0) {
      stOpenReturnPct = ((currentPrice - openEntryPrice) / openEntryPrice) * 100;
    }
  }

  // ── Strategy comparison ───────────────────────────────────────
  function toMetrics(bt: typeof backtestResult) {
    return {
      total_return: bt.total_return,
      total_return_250d: bt.total_return_250d,
      total_return_500d: bt.total_return_500d,
      win_rate: bt.win_rate,
      num_trades: bt.num_trades,
      profit_factor: bt.profit_factor,
      max_drawdown: bt.max_drawdown,
      sharpe: bt.sharpe,
      sortino: bt.sortino,
      expectancy: bt.expectancy,
      avg_win: bt.avg_win,
      avg_loss: bt.avg_loss,
      alpha: bt.alpha,
      trades: bt.trades,
    };
  }
  const scoreAlpha = backtestResult.alpha;
  const stAlpha = stBacktestResult.alpha;
  const winner: "score" | "supertrend" | "tie" =
    Math.abs(scoreAlpha - stAlpha) < 0.5 ? "tie"
    : scoreAlpha > stAlpha ? "score" : "supertrend";

  const comparison = {
    score: toMetrics(backtestResult),
    supertrend: toMetrics(stBacktestResult),
    winner,
    winner_margin: Math.abs(scoreAlpha - stAlpha),
  };

  return {
    symbol: stockConfig.symbol,
    name: stockConfig.name,
    exchange: stockConfig.exchange,
    signal,
    score: lastBar.score,
    confidence: lastBar.confidence,
    regime: regimeInfo.regime,
    regime_info: regimeInfo,
    current_price: currentPrice,
    change_pct: changePct,
    backtest: backtestResult,
    monte_carlo: mcResult,
    st_monte_carlo: stMcResult,
    walk_forward: walkForward,
    kelly,
    chart_bars: chartBars,
    st_direction: stDirection,
    st_value: stValue,
    st_stop_distance_pct: stStopDistPct,
    st_open_return_pct: stOpenReturnPct,
    comparison,
  };
}

// ─── Walk-Forward Optimization ────────────────────────────────
function runWalkForward(
  bars: OHLCVBar[],
  symbol: string,
  config: AppConfig,
  exchange: string
): WalkForwardResult | null {
  const splitIdx = Math.floor(bars.length * config.walkForward.trainRatio);
  const trainBars = bars.slice(0, splitIdx);
  const testBars = bars.slice(splitIdx);

  if (trainBars.length < 50 || testBars.length < 20) return null;

  let bestParams = { entryThreshold: 5.5, maxHoldingDays: 8 };
  let bestTrainSharpe = -999;

  const entryOptions = [5.0, 5.5, 6.0, 6.5];
  const maxDaysOptions = [8, 10, 12, 15];

  for (const entry of entryOptions) {
    for (const maxDays of maxDaysOptions) {
      const tempConfig = {
        ...config,
        signal: { ...config.signal, entryThreshold: entry, maxHoldingDays: maxDays },
      };
      const trainResult = runBacktest([...trainBars], symbol, tempConfig, exchange);
      if (trainResult.sharpe > bestTrainSharpe) {
        bestTrainSharpe = trainResult.sharpe;
        bestParams = { entryThreshold: entry, maxHoldingDays: maxDays };
      }
    }
  }

  const testConfig = {
    ...config,
    signal: { ...config.signal, ...bestParams },
  };
  const testResult = runBacktest([...testBars], symbol, testConfig, exchange);

  const trainSharpe = bestTrainSharpe;
  const testSharpe = testResult.sharpe;

  let efficiencyRatio = 0;
  if (trainSharpe > 0 && testSharpe > 0) {
    efficiencyRatio = Math.min(1.5, testSharpe / trainSharpe);
  }

  let efficiencyQuality: string;
  if (efficiencyRatio >= 0.7) efficiencyQuality = "GOOD";
  else if (efficiencyRatio >= 0.4) efficiencyQuality = "ACCEPTABLE";
  else efficiencyQuality = "OVERFIT";

  return {
    best_params: bestParams,
    train_sharpe: Math.round(trainSharpe * 100) / 100,
    test_sharpe: Math.round(testSharpe * 100) / 100,
    efficiency_ratio: Math.round(efficiencyRatio * 100) / 100,
    efficiency_quality: efficiencyQuality,
    passed: efficiencyRatio >= 0.4 && testSharpe > 0,
  };
}

// ─── Kelly Criterion ──────────────────────────────────────────
function calcKelly(
  bt: { trades: { return: number; r_multiple: number }[]; latest_atr: number | null; latest_price: number },
  config: AppConfig
): KellyResult {
  const trades = bt.trades;
  if (trades.length < 5) {
    return { kelly_fraction: 0.10, full_kelly: 0.40, recommended_fraction: 0.10, sizing_method: "Default", atr_shares: 0, correlation_adjustment: 1.0, correlated_with: null };
  }

  const wins = trades.filter((t) => t.return > 0);
  const losses = trades.filter((t) => t.return <= 0);
  const p = wins.length / trades.length;
  const avgWinR = wins.length > 0 ? wins.reduce((a, t) => a + t.r_multiple, 0) / wins.length : 1;
  const avgLossR = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.r_multiple, 0) / losses.length) : 1;
  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;

  const fullKelly = b > 0 ? Math.max(0, (p * b - (1 - p)) / b) : 0;
  let kellyFraction = Math.min(fullKelly * 0.25 * 0.8, 0.25);
  if (fullKelly > 0 && kellyFraction < 0.05) kellyFraction = 0.05;

  const { riskPerTrade, atrMultiplier, maxPositionSize } = config.risk;
  const { initialCapital } = config.backtest;
  const { latest_atr, latest_price } = bt;

  let atrFraction = 0;
  let atrShares = 0;
  if (latest_atr && latest_atr > 0 && latest_price > 0) {
    const stopDistance = atrMultiplier * latest_atr;
    if (stopDistance > 0) {
      atrShares = (initialCapital * riskPerTrade) / stopDistance;
      atrFraction = Math.min((atrShares * latest_price) / initialCapital, maxPositionSize);
    }
  }

  const recommended = atrFraction > 0 ? Math.min(kellyFraction, atrFraction) : kellyFraction;
  const method = atrFraction > 0
    ? (kellyFraction <= atrFraction ? "Kelly-Binding" : "ATR-Binding")
    : "Kelly-Only";

  return {
    kelly_fraction: Math.round(kellyFraction * 10000) / 10000,
    full_kelly: Math.round(fullKelly * 10000) / 10000,
    recommended_fraction: Math.round(recommended * 10000) / 10000,
    sizing_method: method,
    atr_shares: Math.floor(atrShares),
    correlation_adjustment: 1.0,
    correlated_with: null,
  };
}
