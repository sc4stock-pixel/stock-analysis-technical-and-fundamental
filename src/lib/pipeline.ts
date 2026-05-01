// ============================================================
// ANALYSIS PIPELINE — V14 + SuperTrend Parameter Optimization
//
// Debug logging enabled — matches Python script output format:
//   🔍 Optimizing SuperTrend for {symbol}...
//   ✅ Best: ATR={n}, Mult={m} => Return={r}%, Sharpe={s}, Trades={t}
//   [DEBUG] Last bar ({date}): ST={v}, Close={c}, Direction={d}, Trend={trend}
//   [DEBUG] Backtest has_open_position: {bool}
//   [DEBUG] ST Flip to BULLISH: {date} ({n} bars ago)
//   [DEBUG] At flip: Close={c}, SMA_50={s}, Close>SMA_50={bool}
//   [DEBUG] Last ST trade: entry={e}, exit={x}, reason={r}
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

// ── Debug logger — prefix matches Python output ───────────────
function dbg(symbol: string, msg: string) {
  console.log(`  [DEBUG][${symbol}] ${msg}`);
}
function info(symbol: string, msg: string) {
  console.log(`  📊 [${symbol}] ${msg}`);
}

export function runPipeline(
  rawBars: RawOHLCV[],
  stockConfig: { symbol: string; name: string; exchange: string },
  config: AppConfig,
  currentPrice: number,
  changePct: number
): StockAnalysisResult {
  const sym = stockConfig.symbol;
  console.log(`\nAnalyzing ${sym} (${stockConfig.name})...`);

  const closes  = rawBars.map(b => b.close);
  const highs   = rawBars.map(b => b.high);
  const lows    = rawBars.map(b => b.low);
  const volumes = rawBars.map(b => b.volume);

  info(sym, `Fetched ${rawBars.length} bars. Date range: ${rawBars[0]?.date} → ${rawBars[rawBars.length - 1]?.date}`);

  // ── Indicators ────────────────────────────────────────────────
  const rsiArr   = rsi(closes, config.analysis.rsiPeriod);
  const [macdLine, macdSignal, macdHist] = macd(closes, config.analysis.macdFast, config.analysis.macdSlow, config.analysis.macdSignal);
  const [adxArr, plusDIArr, minusDIArr]  = adx(highs, lows, closes, config.analysis.adxPeriod);
  const atrArr   = atr(highs, lows, closes, config.analysis.atrPeriod);
  const sma20Arr = sma(closes, config.analysis.smaShort);
  const sma50Arr = sma(closes, config.analysis.smaLong);
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);

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

  // ── Last bar indicators ───────────────────────────────────────
  const lastIdx = rawBars.length - 1;
  const lastBar0 = rawBars[lastIdx];
  const lastRSI  = rsiArr[lastIdx];
  const lastADX  = adxArr[lastIdx];
  const lastMACD = macdHist[lastIdx];
  const lastRegime = regimeArr[lastIdx];
  info(sym, `Last bar (${lastBar0.date}): Close=${lastBar0.close.toFixed(2)}, RSI=${lastRSI?.toFixed(1)}, ADX=${lastADX?.toFixed(1)}, MACD_H=${lastMACD?.toFixed(4)}, Regime=${lastRegime}`);

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
    supertrend: stArr[i] ?? NaN, supertrendDir: stDirArr[i] ?? 1,
    supertrendSignal: stSigArr[i] ?? "HOLD", stEntrySignal: "HOLD",
    ema50: ema50Arr[i] ?? 0,
  }));

  // ── SuperTrend Parameter Optimization ────────────────────────
  console.log(`  🔍 Optimizing SuperTrend for ${sym}...`);
  const optResult = optimizeSupertrend(
    bars,
    config.backtest.initialCapital,
    config.backtest.commissionRate,
    config.backtest.slippageRate
  );
  console.log(`    ✅ Best: ATR=${optResult.atrPeriod}, Mult=${optResult.multiplier} => Return=${optResult.totalReturn.toFixed(1)}%, Sharpe=${optResult.sharpe.toFixed(2)}, Trades=${optResult.numTrades}`);

  // Recompute ST with optimal params
  const [optStArr, optStDirArr, optStSigArr] = supertrend(
    highs, lows, closes, optResult.atrPeriod, optResult.multiplier
  );

  // ── Last bar ST debug ─────────────────────────────────────────
  const lastOptST  = optStArr[lastIdx] ?? NaN;
  const lastOptDir = optStDirArr[lastIdx] ?? -1;
  const lastClose  = closes[lastIdx];
  const lastSMA50  = sma50Arr[lastIdx];
  const trendStr   = lastOptDir === 1 ? "BULLISH" : "BEARISH";
  dbg(sym, `Last bar (${lastBar0.date}): ST=${isNaN(lastOptST) ? "NaN" : lastOptST.toFixed(4)}, Close=${lastClose.toFixed(2)}, Direction=${lastOptDir}.0, Trend=${trendStr}`);
  dbg(sym, `Current: Close=${lastClose.toFixed(2)}, SMA_50=${lastSMA50.toFixed(2)}, Close>SMA_50=${lastClose > lastSMA50}`);

  // ── Detect most recent ST flip ────────────────────────────────
  let lastFlipIdx: number | null = null;
  let lastFlipDir: number | null = null;
  for (let i = optStDirArr.length - 1; i >= 1; i--) {
    if (optStDirArr[i] !== optStDirArr[i - 1]) {
      lastFlipIdx = i;
      lastFlipDir = optStDirArr[i];
      break;
    }
  }
  if (lastFlipIdx !== null && lastFlipDir !== null) {
    const barsSinceFlip = lastIdx - lastFlipIdx;
    const flipLabel     = lastFlipDir === 1 ? "BULLISH" : "BEARISH";
    const flipBar       = rawBars[lastFlipIdx];
    const flipSig       = optStSigArr[lastFlipIdx];
    const flipSMA50     = sma50Arr[lastFlipIdx] ?? 0;
    dbg(sym, `ST Flip to ${flipLabel}: ${flipBar.date} (${barsSinceFlip} bars ago)`);
    dbg(sym, `At flip: Close=${flipBar.close.toFixed(2)}, SMA_50=${flipSMA50.toFixed(2)}, Close>SMA_50=${flipBar.close > flipSMA50}`);
    dbg(sym, `At flip: ST_Signal=${flipSig}, ST_Signal_EMA_Only=${flipBar.close > flipSMA50 ? flipSig : "HOLD (SMA50 filter blocked)"}`);
  } else {
    dbg(sym, `No ST flip detected in lookback window`);
  }

  // ── SuperTrend entry signals using OPTIMAL params ─────────────
  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = bars[i];
    const prev = bars[i - 1];

    if (optStSigArr[i] === "SELL") {
      bars[i + 1].stEntrySignal = "SELL";
      continue;
    }
    if (optStSigArr[i] === "BUY") {
      const smaFilter = stConfig.filter_mode === "ema_only"
        ? cur.close > cur.sma50
        : cur.close > cur.sma50 && cur.adx > 20;
      if (smaFilter) bars[i + 1].stEntrySignal = "BUY";
      continue;
    }
    if (optStDirArr[i] === 1) {
      const smaUpCross = cur.close > cur.sma50 && prev.close <= prev.sma50;
      if (smaUpCross) bars[i + 1].stEntrySignal = "BUY";
    }
  }

  // ── Score signals ─────────────────────────────────────────────
  generateSignals(bars, config, stockConfig.exchange);

  // Log current signal state
  const lastBar = bars[bars.length - 1];
  dbg(sym, `Signals: Raw=${lastBar.rawSignal}, Confirmed=${lastBar.signalConfirmed}, Entry=${lastBar.entrySignal}, ST_Entry=${lastBar.stEntrySignal}`);
  dbg(sym, `Score: ${lastBar.score.toFixed(1)}, Confidence: ${lastBar.confidence}%, EMA20Slope: ${lastBar.ema20Slope.toFixed(6)}`);

  // ── Dual Backtest ─────────────────────────────────────────────
  const backtestResult = runBacktest(bars, sym, config, stockConfig.exchange);
  info(sym, `Score backtest: ${backtestResult.num_trades} trades, Return=${backtestResult.total_return.toFixed(1)}%, Sharpe=${backtestResult.sharpe.toFixed(2)}, Alpha=${backtestResult.alpha.toFixed(1)}%`);

  const barsForST: OHLCVBar[] = bars.map((b, i) => ({
    ...b,
    supertrend:       optStArr[i]    ?? NaN,
    supertrendDir:    optStDirArr[i] ?? 1,
    supertrendSignal: optStSigArr[i] ?? "HOLD",
  }));
  const stBacktestResult = runSupertrendBacktest(barsForST, sym, config);

  const stTradesCount = stBacktestResult.trades.length;
  console.log(`  SuperTrend trades count: ${stTradesCount}`);
  if (stTradesCount > 0) {
    const first = stBacktestResult.trades[0];
    const last  = stBacktestResult.trades[stTradesCount - 1];
    console.log(`  First ST trade: ${first.entry_date} -> ${first.exit_date}`);
    console.log(`  Last ST trade:  ${last.entry_date} -> ${last.exit_date}`);
    dbg(sym, `Last ST trade: entry=${last.entry_price.toFixed(2)}, exit=${last.exit_price.toFixed(2)}, reason=${last.exit_reason}, ret=${(last.return * 100).toFixed(1)}%`);

    // Log ST value at exit date
    const exitIdx = last.exit_idx;
    if (exitIdx >= 0 && exitIdx < optStArr.length) {
      const stAtExit  = optStArr[exitIdx];
      const dirAtExit = optStDirArr[exitIdx];
      dbg(sym, `At exit date (${last.exit_date}): ST=${isNaN(stAtExit) ? "NaN" : stAtExit.toFixed(2)}, Close=${rawBars[exitIdx]?.close.toFixed(2)}, Direction=${dirAtExit}.0`);
    }
  }
  info(sym, `ST backtest: ${stTradesCount} trades, Return=${stBacktestResult.total_return.toFixed(1)}%, Sharpe=${stBacktestResult.sharpe.toFixed(2)}, Alpha=${stBacktestResult.alpha.toFixed(1)}%`);

  // ── Open position detection ───────────────────────────────────
  let stOpenReturnPct: number | null = null;
  let hasOpenPosition = false;

  // Determine ST current direction/value using OPTIMAL params
  const lastOptDir2 = optStDirArr[optStDirArr.length - 1] ?? -1;
  const lastOptST2  = optStArr[optStArr.length - 1] ?? 0;
  const stDirection   = lastOptDir2;
  const stValue       = !isNaN(lastOptST2) ? lastOptST2 : 0;
  const stStopDistPct = stValue > 0 && currentPrice > 0
    ? ((currentPrice - stValue) / currentPrice) * 100 : 0;

  if (stDirection === 1) {
    let openEntryPrice: number | null = null;
    let trailingStop:   number | null = null;

    for (let i = 1; i < bars.length; i++) {
      const cur  = bars[i];

      if (openEntryPrice === null) {
        if (cur.stEntrySignal === "BUY") {
          openEntryPrice = cur.open * (1 + config.backtest.slippageRate);
          const prevOptST = optStArr[i - 1];
          trailingStop = (!isNaN(prevOptST) && prevOptST > 0) ? prevOptST : null;
        }
      } else {
        // Update trailing stop as ST line rises
        const curOptST = optStArr[i];
        if (!isNaN(curOptST) && (trailingStop === null || curOptST > trailingStop)) {
          trailingStop = curOptST;
        }
        const stopHit    = trailingStop !== null && cur.low <= trailingStop;
        const sellSignal = optStSigArr[i - 1] === "SELL";
        if (stopHit || sellSignal) {
          openEntryPrice = null;
          trailingStop   = null;
        }
      }
    }

    hasOpenPosition = openEntryPrice !== null;
    dbg(sym, `Backtest has_open_position: ${hasOpenPosition}`);

    if (openEntryPrice !== null && openEntryPrice > 0) {
      stOpenReturnPct = ((currentPrice - openEntryPrice) / openEntryPrice) * 100;
      dbg(sym, `Open position: entry=${openEntryPrice.toFixed(2)}, current=${currentPrice.toFixed(2)}, P&L=${stOpenReturnPct.toFixed(2)}%, trailing_stop=${trailingStop?.toFixed(2) ?? "none"}`);
    }
  } else {
    dbg(sym, `Backtest has_open_position: false (ST is BEARISH)`);
  }

  // ── Monte Carlo ───────────────────────────────────────────────
  const mcResult   = config.monteCarlo.enabled && backtestResult.equity_curve.length   >= 30 ? runMonteCarlo(backtestResult.equity_curve,   config) : null;
  const stMcResult = config.monteCarlo.enabled && stBacktestResult.equity_curve.length >= 30 ? runMonteCarlo(stBacktestResult.equity_curve, config) : null;

  // ── Walk-Forward + Kelly ──────────────────────────────────────
  let walkForward: WalkForwardResult | null = null;
  if (config.walkForward.enabled && bars.length >= 100) {
    walkForward = runWalkForward(bars, sym, config, stockConfig.exchange);
    if (walkForward) {
      dbg(sym, `Walk-forward: train_sharpe=${walkForward.train_sharpe}, test_sharpe=${walkForward.test_sharpe}, quality=${walkForward.efficiency_quality}`);
    }
  }
  let kelly: KellyResult | null = null;
  if (backtestResult.trades.length >= 5) kelly = calcKelly(backtestResult, config);

  // ── Current regime ────────────────────────────────────────────
  const regimeInfo = detectRegime({
    adxArr, plusDIArr, minusDIArr, atrArr,
    macdArr: macdLine, macdSignalArr: macdSignal,
    closeArr: closes, sma20Arr, sma50Arr, rsiArr,
  });

  const signal  = lastBar.signalConfirmed ?? "HOLD";
  info(sym, `Final: Signal=${signal}, Score=${lastBar.score.toFixed(1)}, Regime=${regimeInfo.regime}, ST=${trendStr}, StopDist=${stStopDistPct.toFixed(1)}%`);

  // ── chartBars: use OPTIMIZED ST params ─────────────────────────
  const chartBars: ChartBar[] = bars.slice(-500).map((b, i) => {
    const offset = bars.length - Math.min(500, bars.length);
    const absIdx = offset + i;
    return {
      date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      sma20: b.sma20, sma50: b.sma50, ema20: b.ema20, ema50: b.ema50,
      bbUpper: b.bbUpper, bbLower: b.bbLower, signal: b.signalConfirmed, score: b.score,
      rsi: b.rsi, macd: b.macd, macdSig: b.macdSignal, macdHist: b.macdHist,
      adx: b.adx, pdi: b.plusDI, mdi: b.minusDI,
      // Optimized ST params — consistent with st_direction/st_value badges
      supertrend: optStArr[absIdx] ?? NaN,
      supertrendDir: optStDirArr[absIdx] ?? -1,
    };
  });

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

  dbg(sym, `Winner: ${winner} (Score α=${scoreAlpha.toFixed(1)}% vs ST α=${stAlpha.toFixed(1)}%)`);
  console.log(`  ✓ Done: ${sym}\n`);

  return {
    symbol: sym, name: stockConfig.name, exchange: stockConfig.exchange,
    signal, score: lastBar.score, confidence: lastBar.confidence,
    regime: regimeInfo.regime, regime_info: regimeInfo,
    current_price: currentPrice, change_pct: changePct,
    backtest: backtestResult, monte_carlo: mcResult, st_monte_carlo: stMcResult,
    walk_forward: walkForward, kelly, chart_bars: chartBars,
    st_direction: stDirection, st_value: stValue,
    st_stop_distance_pct: stStopDistPct, st_open_return_pct: stOpenReturnPct,
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
