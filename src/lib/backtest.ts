// ============================================================
// BACKTEST ENGINE — V14 Score Alpha + SuperTrend
// V14 additions matching Python exactly:
//   Score Alpha (runBacktest): alpha_mode=true
//     - ALPHA_MODE_TRAILING_ATR_MULT: 4x for STRONG/STRENGTHENING (wide trail)
//     - ALPHA_MODE_PROFIT_TARGET_ATR: 999x for strong trends (no cap)
//     - ALPHA_MODE_IGNORE_SIGNAL_EXIT: ignore SELL in strong trends
//     - vol_capped_stop=true, vol_cap_pct=0.15
//     - velocity_entry runtime check: skip bar if EMA slope ≤ 0 or price ≤ EMA20
// ============================================================

import {
  getAtrMultiplier, getAlphaTrailingAtrMult, getAlphaProfitTargetAtr,
  getTrailTrigger, getMaxHoldingDays, getConfirmBars, shouldIgnoreSignalExit,
} from "./regime";
import { AppConfig, Trade, BacktestResult, FibTargets, CandlestickPattern, OHLCVBar } from "@/types";
import { detectCandlestickPatterns } from "./candlestick";

function calcSupport(bars: OHLCVBar[], lookback = 30): number | null {
  if (bars.length < 10) return null;
  const latest = bars[bars.length - 1].close;
  const supports: number[] = [];
  const lb = Math.min(lookback, bars.length);
  for (let i = 3; i < lb - 3; i++) {
    const idx = bars.length - 1 - i;
    if (idx < 0) break;
    const window = bars.slice(Math.max(0, idx - 3), idx + 4).map(b => b.low);
    if (bars[idx].low === Math.min(...window) && bars[idx].low < latest) supports.push(bars[idx].low);
  }
  const recentLow = Math.min(...bars.slice(-lb).map(b => b.low));
  if (recentLow < latest) supports.push(recentLow);
  const last = bars[bars.length - 1];
  if (!isNaN(last.bbLower) && last.bbLower < latest) supports.push(last.bbLower);
  if (!isNaN(last.sma50)   && last.sma50   < latest) supports.push(last.sma50);
  if (!isNaN(last.sma20)   && last.sma20   < latest) supports.push(last.sma20);
  if (supports.length === 0) return recentLow < latest ? recentLow : latest * 0.95;
  return Math.max(...supports);
}

function calcResistance(bars: OHLCVBar[], lookback = 30): number | null {
  if (bars.length < 10) return null;
  const latest = bars[bars.length - 1].close;
  const resistances: number[] = [];
  const lb = Math.min(lookback, bars.length);
  for (let i = 3; i < lb - 3; i++) {
    const idx = bars.length - 1 - i;
    if (idx < 0) break;
    const window = bars.slice(Math.max(0, idx - 3), idx + 4).map(b => b.high);
    if (bars[idx].high === Math.max(...window) && bars[idx].high > latest) resistances.push(bars[idx].high);
  }
  const recentHigh = Math.max(...bars.slice(-lb).map(b => b.high));
  if (recentHigh > latest) resistances.push(recentHigh);
  const last = bars[bars.length - 1];
  if (!isNaN(last.bbUpper) && last.bbUpper > latest) resistances.push(last.bbUpper);
  if (!isNaN(last.sma20)   && last.sma20   > latest) resistances.push(last.sma20);
  if (!isNaN(last.sma50)   && last.sma50   > latest) resistances.push(last.sma50);
  if (resistances.length === 0) return recentHigh > latest ? recentHigh : latest * 1.05;
  return Math.min(...resistances);
}

function calcStopLoss(bars: OHLCVBar[], atrMultiplier: number): number | null {
  if (bars.length < 14) return null;
  const last = bars[bars.length - 1];
  const atrStop = last.close - atrMultiplier * last.atr;
  const support = calcSupport(bars);
  if (support && support < last.close) return Math.max(atrStop, support * 0.99);
  return atrStop;
}

function calcFibTargets(bars: OHLCVBar[]): FibTargets {
  if (bars.length < 20) return { t1: null, t2: null, t3: null, swing_low: null, base_move: null };
  const last = bars[bars.length - 1];
  const recentLow = Math.min(...bars.slice(-20).map(b => b.low));
  let baseMove = last.close - recentLow;
  if (baseMove <= 0) baseMove = last.close * 0.05;
  return {
    t1: Math.round((last.close + baseMove * 0.272) * 100) / 100,
    t2: Math.round((last.close + baseMove * 0.618) * 100) / 100,
    t3: Math.round((last.close + baseMove * 1.0)   * 100) / 100,
    swing_low: recentLow, base_move: baseMove,
  };
}

function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildMetrics(
  symbol: string, trades: Trade[], bars: OHLCVBar[], config: AppConfig,
  runningEquity: number, initialCapital: number, equityCurve: number[],
  equityDates: string[], drawdownHistory: number[], killSwitchActive: boolean,
  signalBars: number
): BacktestResult {
  if (trades.length === 0) return buildEmptyResults(symbol, bars, config, killSwitchActive, equityCurve, equityDates);

  const winners = trades.filter(t => t.return > 0);
  const losers  = trades.filter(t => t.return <= 0);
  const winRate  = winners.length / trades.length;
  const avgWin   = winners.length > 0 ? mean(winners.map(t => t.return)) : 0;
  const avgLoss  = losers.length  > 0 ? mean(losers.map(t => t.return))  : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    dailyReturns.push(prev > 0 ? (equityCurve[i] - prev) / prev : 0);
  }
  const drMean = mean(dailyReturns);
  const drStd  = Math.sqrt(mean(dailyReturns.map(r => (r - drMean) ** 2)));
  const sharpe = drStd > 0 ? (drMean * 252) / (drStd * Math.sqrt(252)) : 0;

  const downsideReturns = dailyReturns.filter(r => r < 0);
  const drDownStd = downsideReturns.length > 0 ? Math.sqrt(mean(downsideReturns.map(r => r ** 2))) : 0;
  const sortino = drDownStd > 0 ? (drMean * 252) / (drDownStd * Math.sqrt(252)) : 0;

  let peak = equityCurve[0]; let maxDrawdown = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const grossProfit = winners.reduce((a, t) => a + t.pnl, 0);
  const grossLoss   = Math.abs(losers.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const buyHoldShares = initialCapital / bars[0].close;
  const totalReturn   = (runningEquity - initialCapital) / initialCapital;
  const buyHoldReturn = (bars[bars.length - 1].close * buyHoldShares - initialCapital) / initialCapital;
  const alpha         = totalReturn - buyHoldReturn;
  const annualizedReturn = totalReturn * (252 / bars.length);
  const calmarRatio   = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  const ec = equityCurve;
  const totalReturn250d = ec.length > 250 ? (ec[ec.length-1] - ec[ec.length-251]) / ec[ec.length-251] : totalReturn;
  const totalReturn500d = ec.length > 500 ? (ec[ec.length-1] - ec[ec.length-501]) / ec[ec.length-501] : totalReturn;

  const squaredDDs = drawdownHistory.map(d => d ** 2);
  const ulcerIndex = Math.sqrt(mean(squaredDDs)) * 100;
  const gains  = dailyReturns.filter(r => r > 0).reduce((a, b) => a + b, 0);
  const losses2 = Math.abs(dailyReturns.filter(r => r <= 0).reduce((a, b) => a + b, 0));
  const omegaRatio = losses2 > 0 ? gains / losses2 : 0;

  const holdingPeriods   = trades.map(t => t.bars_held);
  const winnerDurations  = winners.map(t => t.bars_held);
  const loserDurations   = losers.map(t => t.bars_held);

  const last = bars[bars.length - 1];
  const week52High = bars.length >= 252 ? Math.max(...bars.slice(-252).map(b => b.high)) : Math.max(...bars.map(b => b.high));
  const week52Low  = bars.length >= 252 ? Math.min(...bars.slice(-252).map(b => b.low))  : Math.min(...bars.map(b => b.low));
  const volMean20  = mean(bars.slice(-21, -1).map(b => b.volume));

  const exitReasons: Record<string, number> = {};
  for (const t of trades) exitReasons[t.exit_reason] = (exitReasons[t.exit_reason] ?? 0) + 1;

  return {
    symbol, trades, num_trades: trades.length,
    win_rate: winRate * 100, expectancy: expectancy * 100,
    total_return: totalReturn * 100, total_return_250d: totalReturn250d * 100, total_return_500d: totalReturn500d * 100,
    sharpe, sortino, max_drawdown: maxDrawdown * 100, profit_factor: profitFactor,
    avg_win: avgWin * 100, avg_loss: avgLoss * 100,
    r_multiples: trades.map(t => t.r_multiple),
    equity_curve: equityCurve, equity_dates: equityDates,
    signal_bars: signalBars,
    buy_hold_return: buyHoldReturn * 100, alpha: alpha * 100,
    alpha_status: alpha > 0 ? "ADDING VALUE" : "DESTROYING VALUE",
    calmar_ratio: calmarRatio, ulcer_index: ulcerIndex, omega_ratio: omegaRatio,
    exit_reasons: exitReasons,
    avg_mae: mean(trades.map(t => t.mae_pct)), avg_mfe: mean(trades.map(t => t.mfe_pct)),
    winner_mae: winners.length > 0 ? mean(winners.map(t => t.mae_pct)) : 0,
    loser_mae:  losers.length  > 0 ? mean(losers.map(t => t.mae_pct))  : 0,
    winner_mfe: winners.length > 0 ? mean(winners.map(t => t.mfe_pct)) : 0,
    kill_switch_triggered: killSwitchActive,
    latest_atr: last.atr, latest_price: last.close,
    rsi_divergence: last.rsiDivergence, rsi_divergence_type: last.rsiDivergenceType,
    avg_duration: mean(holdingPeriods), median_duration: median(holdingPeriods),
    min_duration: holdingPeriods.length > 0 ? Math.min(...holdingPeriods) : 0,
    max_duration: holdingPeriods.length > 0 ? Math.max(...holdingPeriods) : 0,
    avg_winner_duration: mean(winnerDurations), avg_loser_duration: mean(loserDurations),
    median_winner_duration: median(winnerDurations), median_loser_duration: median(loserDurations),
    score_history: bars.slice(-20).map(b => b.score),
    rsi: last.rsi, macd_hist: last.macdHist, adx: last.adx,
    atr_pct: last.close > 0 ? (last.atr / last.close) * 100 : null,
    vol_ratio: volMean20 > 0 ? last.volume / volMean20 : 1,
    bb_position: last.bbPosition,
    support_level: calcSupport(bars), resistance_level: calcResistance(bars),
    stop_loss_price: calcStopLoss(bars, config.risk.atrMultiplier),
    fib_targets: calcFibTargets(bars),
    week_52_high: week52High, week_52_low: week52Low,
    sma_20: last.sma20, sma_50: last.sma50, ema_20: last.ema20 ?? null,
    candlestick_patterns: detectCandlestickPatterns(bars, 5),
  };
}

// ─── SCORE ALPHA BACKTEST ─────────────────────────────────────
// Matches Python: alpha_mode=True, velocity_entry=True, vol_capped_stop=True
export function runBacktest(
  bars: OHLCVBar[], symbol: string, config: AppConfig, exchange = "DEFAULT"
): BacktestResult {
  const { initialCapital, commissionRate: commission, slippageRate: slippage, use_van_tharp: useVanTharp } = config.backtest;
  const { riskPerTrade } = config.risk;
  const { killSwitchEnabled, maxDrawdownThreshold: maxDdThreshold, coolingPeriodDays } = config.portfolioRisk;

  // Vol-capped stop: 15% max stop distance (matches Python vol_capped_stop=True, vol_cap_pct=0.15)
  const VOL_CAP_PCT = 0.15;
  // Velocity slope bars (matches Python velocity_slope_bars=3)
  const VELOCITY_SLOPE_BARS = 3;

  const trades: Trade[] = [];
  let position: Record<string, number | string | boolean | null> | null = null;
  const equityCurve: number[] = [initialCapital];
  const equityDates: string[] = [bars[0].date];
  let portfolioPeak = initialCapital;
  let killSwitchActive = false;
  let killSwitchTriggerIdx: number | null = null;
  const drawdownHistory: number[] = [];
  let runningEquity = initialCapital;
  let tradeNum = 0;

  for (let i = 1; i < bars.length; i++) {
    const cur  = bars[i];
    const prev = bars[i - 1];
    const currentEquity = equityCurve[equityCurve.length - 1];

    if (currentEquity > portfolioPeak) portfolioPeak = currentEquity;
    const portfolioDrawdown = portfolioPeak > 0 ? (portfolioPeak - currentEquity) / portfolioPeak : 0;
    drawdownHistory.push(portfolioDrawdown);

    if (killSwitchEnabled && portfolioDrawdown >= maxDdThreshold && !killSwitchActive) {
      killSwitchActive = true; killSwitchTriggerIdx = i;
    }
    if (killSwitchActive && killSwitchTriggerIdx !== null) {
      if (i - killSwitchTriggerIdx >= coolingPeriodDays) { killSwitchActive = false; killSwitchTriggerIdx = null; }
    }

    // ── ENTRY ────────────────────────────────────────────────────
    if (position === null && cur.entrySignal === "BUY" && !killSwitchActive) {
      // V14: Velocity Entry runtime check (Python: velocity_entry=True in run_backtest)
      // Applied per-bar at entry time, AFTER Entry_Signal check.
      // Skip this bar if velocity conditions fail — same as Python `continue`
      const ema20 = cur.ema20 ?? 0;
      const ema20Prev = i >= VELOCITY_SLOPE_BARS ? (bars[i - VELOCITY_SLOPE_BARS].ema20 ?? 0) : 0;
      const emaSlope = ema20Prev > 0 ? (ema20 - ema20Prev) / ema20Prev : 0;
      const velocityPass = cur.close > ema20 && emaSlope > 0;
      if (!velocityPass) {
        // Push equity and continue — don't enter this bar
        equityCurve.push(runningEquity);
        equityDates.push(cur.date);
        continue;
      }

      const entryPrice  = cur.open * (1 + slippage);
      const entryAtr    = cur.atr;
      const entryRegime = prev.regime ?? "NEUTRAL";

      // Alpha mode parameter lookups
      const entryAtrMult       = getAtrMultiplier(entryRegime);
      const entryTrailingMult  = getAlphaTrailingAtrMult(entryRegime);   // wider in strong trends
      const entryMaxHold       = getMaxHoldingDays(entryRegime);
      const entryConfirmBars   = getConfirmBars(entryRegime, exchange);
      const entryProfitTarget  = getAlphaProfitTargetAtr(entryRegime);   // 999x for strong trends
      const entryTrailTrigger  = getTrailTrigger(entryRegime);
      const ignoreSignalExit   = shouldIgnoreSignalExit(entryRegime);    // true for STRONG trends

      let shares: number;
      if (useVanTharp) {
        shares = entryAtr > 0 ? (runningEquity * riskPerTrade) / (entryAtrMult * entryAtr) : 1;
      } else {
        shares = Math.floor((runningEquity * 0.998) / entryPrice);
      }

      const entryCostPerShare = entryPrice * (1 + commission);

      // Vol-capped stop: max(ATR stop, 15% floor) — tighter stop to lock in momentum
      const atrStopRaw  = entryPrice - entryAtrMult * entryAtr;
      const volCapStop  = entryPrice * (1 - VOL_CAP_PCT);
      const atrStop     = Math.max(atrStopRaw, volCapStop);

      const profitTarget = entryPrice + entryProfitTarget * entryAtr;

      position = {
        entry_date: cur.date, entry_price: entryPrice,
        entry_cost_per_share: entryCostPerShare,
        entry_cost_total: entryCostPerShare * shares,
        entry_atr: entryAtr, shares, entry_equity: runningEquity,
        atr_stop_price: atrStop, original_stop_price: atrStop,
        profit_target: profitTarget,
        breakeven_triggered: false, breakeven_level_1: false, breakeven_level_2: false,
        bars_held: 0, highest_price: entryPrice, trailing_stop: null,
        mae: 0, mfe: 0, mae_pct: 0, mfe_pct: 0,
        entry_regime: entryRegime, max_hold_days: entryMaxHold,
        entry_idx: i, atr_mult: entryAtrMult,
        trail_mult: entryTrailingMult, trail_trigger: entryTrailTrigger,
        confirm_bars: entryConfirmBars,
        ignore_signal_exit: ignoreSignalExit,   // Alpha mode flag
      };
    }

    // ── MANAGE POSITION ──────────────────────────────────────────
    else if (position !== null) {
      (position.bars_held as number)++;
      if (cur.high > (position.highest_price as number)) position.highest_price = cur.high;

      const adverse = (position.entry_price as number) - cur.low;
      if (adverse > (position.mae as number)) { position.mae = adverse; position.mae_pct = adverse / (position.entry_price as number); }
      const favorable = cur.high - (position.entry_price as number);
      if (favorable > (position.mfe as number)) { position.mfe = favorable; position.mfe_pct = favorable / (position.entry_price as number); }

      const currentAtr    = cur.atr;
      const trailMult     = position.trail_mult as number;
      const trailTrigger  = position.trail_trigger as number;
      const riskDistance  = (position.entry_price as number) - (position.original_stop_price as number);
      const profitSoFar   = cur.close - (position.entry_price as number);
      const rLevel        = riskDistance > 0 ? profitSoFar / riskDistance : 0;

      // Two-step breakeven
      if (rLevel >= 1.5 && !position.breakeven_level_2) {
        position.atr_stop_price = (position.entry_price as number) + 0.1 * currentAtr;
        position.breakeven_level_2 = true; position.breakeven_triggered = true;
      } else if (rLevel >= 0.75 && !position.breakeven_level_1) {
        position.atr_stop_price = (position.entry_price as number) - riskDistance * 0.5;
        position.breakeven_level_1 = true;
      }

      // Trailing stop (alpha mode: wider multiplier in strong trends)
      if (profitSoFar >= trailTrigger * riskDistance) {
        const newTrailing = (position.highest_price as number) - trailMult * currentAtr;
        if (position.trailing_stop === null || newTrailing > (position.trailing_stop as number)) {
          position.trailing_stop = newTrailing;
        }
      }

      // ── EXIT CONDITIONS ──────────────────────────────────────────
      // Alpha mode: ignore SELL signal exits for strong trends
      const ignoreSignal   = position.ignore_signal_exit as boolean;
      const exitSignal     = prev.signalConfirmed === "SELL" && !ignoreSignal;
      const maxDaysReached = (position.bars_held as number) >= (position.max_hold_days as number);
      const atrStopHit     = cur.low <= (position.atr_stop_price as number);
      const trailingStopHit = position.trailing_stop !== null && cur.low <= (position.trailing_stop as number);
      const profitTargetHit = cur.high >= (position.profit_target as number);

      let rangingExit = false;
      if (position.entry_regime === "RANGING" && (position.bars_held as number) >= 3) {
        if (!isNaN(cur.bbMid) && cur.close > cur.bbMid) rangingExit = true;
      }

      if (exitSignal || maxDaysReached || atrStopHit || trailingStopHit || rangingExit || profitTargetHit) {
        let exitPrice: number; let exitReason: string;

        if (profitTargetHit) {
          exitPrice = position.profit_target as number; exitReason = "Profit Target";
        } else if (atrStopHit && !trailingStopHit) {
          exitPrice = position.atr_stop_price as number; exitReason = "ATR Stop";
        } else if (trailingStopHit) {
          exitPrice = position.trailing_stop as number; exitReason = "Trailing Stop";
        } else if (rangingExit) {
          exitPrice = cur.open; exitReason = "Range Mean Reversion";
        } else if (exitSignal) {
          exitPrice = cur.open; exitReason = "Signal";
        } else {
          exitPrice = cur.open; exitReason = "Max Days";
        }

        exitPrice *= (1 - slippage);
        const exitProceedsPerShare = exitPrice * (1 - commission);
        const perSharePnl = exitProceedsPerShare - (position.entry_cost_per_share as number);
        const totalPnl    = perSharePnl * (position.shares as number);
        const returnPct   = (exitPrice - (position.entry_price as number)) / (position.entry_price as number);
        runningEquity     = (position.entry_equity as number) + totalPnl;

        const riskPerShare = (position.entry_price as number) - (position.original_stop_price as number);
        const actualRiskPct = riskPerShare > 0 ? riskPerShare / (position.entry_price as number) : 0.02;
        const rMultiple = actualRiskPct > 0 ? returnPct / actualRiskPct : 0;

        tradeNum++;
        trades.push({
          trade_num: tradeNum, entry_date: position.entry_date as string, exit_date: cur.date,
          entry_idx: position.entry_idx as number, exit_idx: i,
          entry_price: position.entry_price as number, exit_price: exitPrice,
          return: returnPct, pnl: totalPnl, shares: position.shares as number,
          bars_held: position.bars_held as number, r_multiple: rMultiple, exit_reason: exitReason,
          atr_stop_price: position.atr_stop_price as number,
          trailing_stop: position.trailing_stop as number | null,
          mae_pct: (position.mae_pct as number) * 100, mfe_pct: (position.mfe_pct as number) * 100,
          actual_risk_pct: actualRiskPct * 100, entry_regime: position.entry_regime as string,
          atr_mult: position.atr_mult as number, trail_mult: position.trail_mult as number,
          max_hold_days: position.max_hold_days as number,
        });
        position = null;
      }
    }

    const curValue = position !== null
      ? (position.entry_equity as number) + (cur.close - (position.entry_price as number)) * (position.shares as number)
      : runningEquity;
    equityCurve.push(curValue);
    equityDates.push(cur.date);
  }

  return buildMetrics(symbol, trades, bars, config, runningEquity, initialCapital,
    equityCurve, equityDates, drawdownHistory, killSwitchActive, config.signal.signalConfirmationBars);
}

function buildEmptyResults(
  symbol: string, bars: OHLCVBar[], config: AppConfig,
  killSwitch: boolean, equityCurve: number[], equityDates: string[]
): BacktestResult {
  const last = bars[bars.length - 1];
  const buyHoldReturn = bars.length > 1 ? (last.close - bars[0].close) / bars[0].close : 0;
  const week52High = bars.length >= 252 ? Math.max(...bars.slice(-252).map(b => b.high)) : Math.max(...bars.map(b => b.high));
  const week52Low  = bars.length >= 252 ? Math.min(...bars.slice(-252).map(b => b.low))  : Math.min(...bars.map(b => b.low));
  return {
    symbol, trades: [], num_trades: 0, win_rate: 0, expectancy: 0, total_return: 0,
    total_return_250d: 0, total_return_500d: 0, sharpe: 0, sortino: 0, max_drawdown: 0,
    profit_factor: 0, avg_win: 0, avg_loss: 0, r_multiples: [],
    equity_curve: equityCurve, equity_dates: equityDates,
    signal_bars: config.signal.signalConfirmationBars,
    buy_hold_return: buyHoldReturn * 100, alpha: -buyHoldReturn * 100, alpha_status: "NO TRADES",
    calmar_ratio: 0, ulcer_index: 0, omega_ratio: 0, exit_reasons: {},
    avg_mae: 0, avg_mfe: 0, winner_mae: 0, loser_mae: 0, winner_mfe: 0,
    kill_switch_triggered: killSwitch, latest_atr: last.atr, latest_price: last.close,
    rsi_divergence: last.rsiDivergence ?? 0, rsi_divergence_type: last.rsiDivergenceType ?? "None",
    avg_duration: 0, median_duration: 0, min_duration: 0, max_duration: 0,
    avg_winner_duration: 0, avg_loser_duration: 0, median_winner_duration: 0, median_loser_duration: 0,
    score_history: bars.slice(-20).map(b => b.score),
    rsi: last.rsi, macd_hist: last.macdHist, adx: last.adx,
    atr_pct: last.close > 0 ? (last.atr / last.close) * 100 : null,
    vol_ratio: last.volRatio, bb_position: last.bbPosition,
    support_level: calcSupport(bars), resistance_level: calcResistance(bars),
    stop_loss_price: calcStopLoss(bars, config.risk.atrMultiplier),
    fib_targets: calcFibTargets(bars), week_52_high: week52High, week_52_low: week52Low,
    sma_20: last.sma20, sma_50: last.sma50, ema_20: last.ema20 ?? null,
    candlestick_patterns: detectCandlestickPatterns(bars, 5),
  };
}

// ─── SUPERTREND BACKTEST ──────────────────────────────────────
// Python: strategy_type='supertrend', no alpha_mode, no velocity_entry
// Exit: cur.low <= ST trailing stop OR prev.supertrendSignal === 'SELL'
export function runSupertrendBacktest(
  bars: OHLCVBar[], symbol: string, config: AppConfig
): BacktestResult {
  const { initialCapital, commissionRate: commission, slippageRate: slippage, use_van_tharp: useVanTharp } = config.backtest;

  const trades: Trade[] = [];
  let position: Record<string, number | string | boolean | null> | null = null;
  const equityCurve: number[] = [initialCapital];
  const equityDates: string[] = [bars[0].date];
  let runningEquity = initialCapital;
  let tradeNum = 0;
  const drawdownHistory: number[] = [];
  let portfolioPeak = initialCapital;

  for (let i = 1; i < bars.length; i++) {
    const cur  = bars[i];
    const prev = bars[i - 1];
    const currentEquity = equityCurve[equityCurve.length - 1];
    if (currentEquity > portfolioPeak) portfolioPeak = currentEquity;
    drawdownHistory.push(portfolioPeak > 0 ? (portfolioPeak - currentEquity) / portfolioPeak : 0);

    if (position === null) {
      if (cur.stEntrySignal === "BUY") {
        const entryPrice = cur.open * (1 + slippage);
        const entryAtr   = cur.atr;
        let shares: number;
        if (useVanTharp) {
          const riskDist = 2 * entryAtr;
          shares = riskDist > 0 ? (runningEquity * config.risk.riskPerTrade) / riskDist : 1;
        } else {
          shares = Math.floor((runningEquity * 0.998) / entryPrice);
        }
        // Initial stop = prev bar's ST line
        const stStop = (!isNaN(prev.supertrend) && prev.supertrend > 0) ? prev.supertrend : entryPrice - 2 * entryAtr;
        position = {
          entry_date: cur.date, entry_price: entryPrice,
          entry_cost_per_share: entryPrice * (1 + commission),
          shares, entry_equity: runningEquity,
          bars_held: 0, highest_price: entryPrice,
          mae: 0, mfe: 0, mae_pct: 0, mfe_pct: 0,
          entry_idx: i, atr_stop_price: stStop, original_stop: stStop,
        };
      }
    } else {
      (position.bars_held as number)++;
      if (cur.high > (position.highest_price as number)) position.highest_price = cur.high;
      const adverse = (position.entry_price as number) - cur.low;
      if (adverse > (position.mae as number)) { position.mae = adverse; position.mae_pct = adverse / (position.entry_price as number); }
      const favorable = cur.high - (position.entry_price as number);
      if (favorable > (position.mfe as number)) { position.mfe = favorable; position.mfe_pct = favorable / (position.entry_price as number); }

      // Trail ST line upward only
      if (!isNaN(cur.supertrend) && cur.supertrend > (position.atr_stop_price as number)) {
        position.atr_stop_price = cur.supertrend;
      }

      const stStopHit  = cur.low <= (position.atr_stop_price as number);
      const stSellSignal = prev.supertrendSignal === "SELL";

      if (stStopHit || stSellSignal) {
        const rawExit  = Math.min(position.atr_stop_price as number, cur.open);
        const exitPrice = rawExit * (1 - slippage);
        const exitProceedsPerShare = exitPrice * (1 - commission);
        const perSharePnl = exitProceedsPerShare - (position.entry_cost_per_share as number);
        const totalPnl    = perSharePnl * (position.shares as number);
        const returnPct   = (exitPrice - (position.entry_price as number)) / (position.entry_price as number);
        runningEquity     = (position.entry_equity as number) + totalPnl;

        const entryBar  = bars[position.entry_idx as number];
        const riskPerShare = (position.entry_price as number) - (position.original_stop as number ?? (position.entry_price as number) - 2 * entryBar.atr);
        const actualRiskPct = riskPerShare > 0 ? riskPerShare / (position.entry_price as number) : 0.02;
        const rMultiple = actualRiskPct > 0 ? returnPct / actualRiskPct : 0;

        tradeNum++;
        trades.push({
          trade_num: tradeNum, entry_date: position.entry_date as string, exit_date: cur.date,
          entry_idx: position.entry_idx as number, exit_idx: i,
          entry_price: position.entry_price as number, exit_price: exitPrice,
          return: returnPct, pnl: totalPnl, shares: position.shares as number,
          bars_held: position.bars_held as number, r_multiple: rMultiple,
          exit_reason: "SuperTrend Exit",
          atr_stop_price: position.original_stop as number, trailing_stop: null,
          mae_pct: (position.mae_pct as number) * 100, mfe_pct: (position.mfe_pct as number) * 100,
          actual_risk_pct: actualRiskPct * 100, entry_regime: entryBar.regime,
          atr_mult: 2, trail_mult: 0, max_hold_days: 9999,
        });
        position = null;
      }
    }

    const curValue = position !== null
      ? (position.entry_equity as number) + (cur.close - (position.entry_price as number)) * (position.shares as number)
      : runningEquity;
    equityCurve.push(curValue);
    equityDates.push(cur.date);
  }

  return buildMetrics(symbol, trades, bars, config, runningEquity, initialCapital,
    equityCurve, equityDates, drawdownHistory, false, 0);
}
