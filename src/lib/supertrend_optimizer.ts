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

const ATR_PERIODS  = [10, 11, 12, 13, 14];
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

  if (trades.length < MIN_TRADES) {
    return { sharpe: -999, totalReturn: 0, numTrades: trades.length };
  }

  // Compute Sharpe from daily equity curve returns
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
