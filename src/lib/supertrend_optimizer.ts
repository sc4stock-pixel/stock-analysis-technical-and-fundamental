// ============================================================
// SUPERTREND OPTIMIZER
// Finds the best ATR period + multiplier combination per stock
// by running a grid search over 25 combinations and selecting
// the one with the highest Sharpe ratio (min 2 trades).
//
// Grid:
//   ATR periods:  [10, 11, 12, 13, 14]
//   Multipliers:  [2.5, 2.75, 3.0, 3.25, 3.5]
//   Combinations: 25
//
// Runs entirely in-memory on pre-computed OHLCV arrays.
// No external calls. Adds ~25 ST computations per stock.
// ============================================================

import { supertrend, atr as calcAtr } from "./indicators";
import { OHLCVBar } from "@/types";

export interface STOptResult {
  atrPeriod:  number;
  multiplier: number;
  sharpe:     number;
  totalReturn: number;
  numTrades:  number;
}

const ATR_PERIODS  = [10, 12, 14];
const MULTIPLIERS  = [2.5, 2.75, 3.0, 3.25, 3.5];
const MIN_TRADES   = 2;

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Run a lightweight ST backtest for one parameter combo.
 * Uses the same exit logic as runSupertrendBacktest():
 *   - Exit: low <= trailing ST line OR prev ST signal = SELL
 *   - Entry: stEntrySignal fires on bullish flip where close > sma50
 *            OR ST already bullish and price just crossed above sma50
 */
function quickSTBacktest(
  bars: OHLCVBar[],
  stLine: number[],
  stDir:  number[],
  stSig:  string[],
  initialCapital: number,
  commission: number,
  slippage:   number
): { sharpe: number; totalReturn: number; numTrades: number } {
  // Build stEntrySignal array
  const stEntry: string[] = new Array(bars.length).fill("HOLD");
  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = bars[i];
    const prev = bars[i - 1];

    if (stSig[i] === "SELL") {
      stEntry[i + 1] = "SELL";
      continue;
    }
    if (stSig[i] === "BUY") {
      // Bullish flip — apply SMA50 filter
      if (cur.close > cur.sma50) stEntry[i + 1] = "BUY";
      continue;
    }
    // Already bullish — SMA50 upward crossover
    if (stDir[i] === 1) {
      const smaUpCross = cur.close > cur.sma50 && prev.close <= prev.sma50;
      if (smaUpCross) stEntry[i + 1] = "BUY";
    }
  }

  // Simulate backtest
  const equity: number[] = [initialCapital];
  let running = initialCapital;
  let pos: { entryPrice: number; entryCost: number; shares: number; equity: number; stop: number } | null = null;
  const trades: { ret: number; pnl: number }[] = [];

  for (let i = 1; i < bars.length; i++) {
    const cur  = bars[i];
    const prev = bars[i - 1];

    if (pos === null) {
      if (stEntry[i] === "BUY") {
        const ep    = cur.open * (1 + slippage);
        const shs   = Math.floor((running * 0.998) / ep);
        const stop  = (!isNaN(stLine[i - 1]) && stLine[i - 1] > 0) ? stLine[i - 1] : ep - 2 * cur.atr;
        pos = { entryPrice: ep, entryCost: ep * (1 + commission), shares: shs, equity: running, stop };
      }
    } else {
      // Trail stop upward
      if (!isNaN(stLine[i]) && stLine[i] > pos.stop) pos.stop = stLine[i];

      const stopHit  = cur.low  <= pos.stop;
      const sellSig  = stSig[i - 1] === "SELL";  // prev bar signal
      if (stopHit || sellSig) {
        const rawExit = Math.min(pos.stop, cur.open);
        const exitPrice = rawExit * (1 - slippage);
        const proceeds  = exitPrice * (1 - commission);
        const pnl = (proceeds - pos.entryCost) * pos.shares;
        const ret = (exitPrice - pos.entryPrice) / pos.entryPrice;
        running = pos.equity + pnl;
        trades.push({ ret, pnl });
        pos = null;
      }
    }

    const curValue = pos !== null
      ? pos.equity + (cur.close - pos.entryPrice) * pos.shares
      : running;
    equity.push(curValue);
  }

  // AUDIT FIX (2026-05-20): always compute real metrics, even when trades < MIN_TRADES.
  // The previous `return { sharpe: -999, totalReturn: 0, ... }` sentinel leaked through
  // the OOS WFO evaluation path (causing OOS Sharpe = -999.00 on the dashboard) AND
  // broke the grid's own fallback comparison (which checks totalReturn for low-trade
  // combos — always seeing 0 made the fallback pick arbitrary params). The grid loop
  // below already filters by `numTrades >= MIN_TRADES` for its primary path, so the
  // sentinel was redundant for the grid AND wrong for the direct-eval OOS path.
  const dailyRets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    dailyRets.push(prev > 0 ? (equity[i] - prev) / prev : 0);
  }
  const m   = mean(dailyRets);
  const std = Math.sqrt(mean(dailyRets.map(r => (r - m) ** 2)));
  const sharpe = std > 0 ? (m * 252) / (std * Math.sqrt(252)) : 0;
  const totalReturn = (running - initialCapital) / initialCapital * 100;

  return { sharpe, totalReturn, numTrades: trades.length };
}

/**
 * Find the optimal SuperTrend parameters for a given stock.
 * Returns the best combo by Sharpe ratio with at least MIN_TRADES.
 * Falls back to best total_return if no combo meets MIN_TRADES.
 */
export function optimizeSupertrend(
  bars: OHLCVBar[],
  initialCapital: number,
  commission: number,
  slippage: number
): STOptResult {
  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  let best: STOptResult = {
    atrPeriod: 10, multiplier: 3.0,
    sharpe: -Infinity, totalReturn: -Infinity, numTrades: 0,
  };
  let bestFallback: STOptResult = { ...best };

  for (const atrP of ATR_PERIODS) {
    for (const mult of MULTIPLIERS) {
      const [stLine, stDir, stSig] = supertrend(highs, lows, closes, atrP, mult);
      const result = quickSTBacktest(bars, stLine, stDir, stSig, initialCapital, commission, slippage);

      if (result.numTrades >= MIN_TRADES) {
        if (result.sharpe > best.sharpe) {
          best = { atrPeriod: atrP, multiplier: mult, ...result };
        }
      } else {
        // Fallback: track best total return even with fewer trades
        if (result.totalReturn > bestFallback.totalReturn) {
          bestFallback = { atrPeriod: atrP, multiplier: mult, ...result };
        }
      }
    }
  }

  // If no combo met MIN_TRADES, use fallback
  if (best.sharpe === -Infinity) return bestFallback;
  return best;
}

// ============================================================
// AUDIT FIX C2 (2026-05-20): True out-of-sample WFO for SuperTrend.
//
// The existing `optimizeSupertrend()` above picks params on the FULL window —
// fine for live trading (most data → best params going forward) but the
// resulting "ST backtest return" displayed on the dashboard is in-sample.
//
// `optimizeSupertrendOos()` runs a separate train/test split: optimize on the
// first `trainRatio` of bars, then evaluate train-derived params on the held-
// out test slice. The OOS metrics are returned alongside efficiency analysis
// for honest dashboard display.
//
// Both functions can be called for the same bars: full-data params for live
// signaling, OOS metrics for display.
// ============================================================

export interface STOosResult {
  // Train slice (optimized in-sample to that slice)
  wf_train_atr_period:   number;
  wf_train_multiplier:   number;
  wf_train_sharpe:       number;
  wf_train_return:       number;
  wf_train_trades:       number;
  // Test slice (held-out, true OOS using train-derived params)
  wf_test_sharpe:        number;
  wf_test_return:        number;
  wf_test_trades:        number;
  // Quality classification
  wf_efficiency_ratio:   number;
  wf_efficiency_quality: "GOOD" | "ACCEPTABLE" | "OVERFIT" | "NO DATA" | "POOR IS" | "FAILED OOS";
  wf_passed:             boolean;
  wf_is_true_oos:        true;
}

export function optimizeSupertrendOos(
  bars: OHLCVBar[],
  initialCapital: number,
  commission: number,
  slippage: number,
  trainRatio = 0.7
): STOosResult | null {
  if (bars.length < 100) return null;

  const splitIdx = Math.floor(bars.length * trainRatio);
  const trainBars = bars.slice(0, splitIdx);
  const testBars  = bars.slice(splitIdx);
  if (trainBars.length < 50 || testBars.length < 20) return null;

  // Step 1: grid-search on TRAIN slice only — true train-only optimization
  const trainBest = optimizeSupertrend(trainBars, initialCapital, commission, slippage);

  // Step 2: evaluate train-derived params on TEST slice
  const testHighs  = testBars.map(b => b.high);
  const testLows   = testBars.map(b => b.low);
  const testCloses = testBars.map(b => b.close);
  const [stLine, stDir, stSig] = supertrend(
    testHighs, testLows, testCloses, trainBest.atrPeriod, trainBest.multiplier
  );
  const testResult = quickSTBacktest(
    testBars, stLine, stDir, stSig, initialCapital, commission, slippage
  );

  // Step 3: efficiency ratio + quality classification (mirrors Python analyzer.py)
  let eff = 0.0;
  let quality: STOosResult["wf_efficiency_quality"] = "NO DATA";
  if (trainBest.numTrades < 3) {
    quality = "NO DATA";
  } else if (testResult.numTrades < 2) {
    quality = "NO DATA";
  } else if (trainBest.sharpe <= 0) {
    quality = "POOR IS";
  } else if (testResult.sharpe <= 0) {
    quality = "FAILED OOS";
  } else {
    eff = Math.min(testResult.sharpe / trainBest.sharpe, 1.5);
    quality = eff >= 0.7 ? "GOOD" : eff >= 0.4 ? "ACCEPTABLE" : "OVERFIT";
  }
  const passed = eff >= 0.4 && testResult.sharpe > 0;

  return {
    wf_train_atr_period:   trainBest.atrPeriod,
    wf_train_multiplier:   trainBest.multiplier,
    wf_train_sharpe:       Number(trainBest.sharpe.toFixed(2)),
    wf_train_return:       Number(trainBest.totalReturn.toFixed(2)),
    wf_train_trades:       trainBest.numTrades,
    wf_test_sharpe:        Number(testResult.sharpe.toFixed(2)),
    wf_test_return:        Number(testResult.totalReturn.toFixed(2)),
    wf_test_trades:        testResult.numTrades,
    wf_efficiency_ratio:   Number(eff.toFixed(2)),
    wf_efficiency_quality: quality,
    wf_passed:             passed,
    wf_is_true_oos:        true,
  };
}
