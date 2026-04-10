// ============================================================
// BACKTEST ENGINE — exact port of Python V12.5.6 BacktestEngine
// Includes: two-step breakeven, trailing stops, kill switch,
//           Van Tharp sizing, regime-adaptive parameters
// ============================================================

import {
  getAtrMultiplier, getTrailingAtrMult, getProfitTargetAtr,
  getTrailTrigger, getMaxHoldingDays, getConfirmBars,
} from "./regime";
import { AppConfig, Trade, BacktestResult, FibTargets, CandlestickPattern, OHLCVBar } from "@/types";
import { detectCandlestickPatterns } from "./candlestick";



function calcSupport(bars: OHLCVBar[], lookback = 30): number | null {
  if (bars.length < 10) return null;
  const latest = bars[bars.length - 1].close;
  const supports: number[] = [];
  const lb = Math.min(lookback, bars.length);

  // Swing lows (3-bar local minima)
  for (let i = 3; i < lb - 3; i++) {
    const idx = bars.length - 1 - i;
    if (idx < 0) break;
    const window = bars.slice(Math.max(0, idx - 3), idx + 4).map((b) => b.low);
    const minV = Math.min(...window);
    if (bars[idx].low === minV && bars[idx].low < latest) {
      supports.push(bars[idx].low);
    }
  }

  const recentLow = Math.min(...bars.slice(-lb).map((b) => b.low));
  if (recentLow < latest) supports.push(recentLow);

  const last = bars[bars.length - 1];
  if (!isNaN(last.bbLower) && last.bbLower < latest) supports.push(last.bbLower);
  if (!isNaN(last.sma50) && last.sma50 < latest) supports.push(last.sma50);
  if (!isNaN(last.sma20) && last.sma20 < latest) supports.push(last.sma20);

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
    const window = bars.slice(Math.max(0, idx - 3), idx + 4).map((b) => b.high);
    const maxV = Math.max(...window);
    if (bars[idx].high === maxV && bars[idx].high > latest) {
      resistances.push(bars[idx].high);
    }
  }

  const recentHigh = Math.max(...bars.slice(-lb).map((b) => b.high));
  if (recentHigh > latest) resistances.push(recentHigh);

  const last = bars[bars.length - 1];
  if (!isNaN(last.bbUpper) && last.bbUpper > latest) resistances.push(last.bbUpper);
  if (!isNaN(last.sma20) && last.sma20 > latest) resistances.push(last.sma20);
  if (!isNaN(last.sma50) && last.sma50 > latest) resistances.push(last.sma50);

  if (resistances.length === 0) return recentHigh > latest ? recentHigh : latest * 1.05;
  return Math.min(...resistances);
}

function calcStopLoss(bars: OHLCVBar[], atrMultiplier: number): number | null {
  if (bars.length < 14) return null;
  const last = bars[bars.length - 1];
  const atrStop = last.close - atrMultiplier * last.atr;
  const support = calcSupport(bars);
  if (support && support < last.close) {
    const supportStop = support * 0.99;
    return Math.max(atrStop, supportStop);
  }
  return atrStop;
}

function calcFibTargets(bars: OHLCVBar[]): FibTargets {
  if (bars.length < 20) return { t1: null, t2: null, t3: null, swing_low: null, base_move: null };
  const last = bars[bars.length - 1];
  const recent20 = bars.slice(-20).map((b) => b.low);
  const recentLow = Math.min(...recent20);
  let baseMove = last.close - recentLow;
  if (baseMove <= 0) baseMove = last.close * 0.05;
  return {
    t1: Math.round((last.close + baseMove * 0.272) * 100) / 100,
    t2: Math.round((last.close + baseMove * 0.618) * 100) / 100,
    t3: Math.round((last.close + baseMove * 1.0) * 100) / 100,
    swing_low: recentLow,
    base_move: baseMove,
  };
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ─── MAIN BACKTEST ────────────────────────────────────────────
export function runBacktest(
  bars: OHLCVBar[],
  symbol: string,
  config: AppConfig,
  exchange = "DEFAULT"
): BacktestResult {
  const btConfig = config.backtest;
  const riskConfig = config.risk;
  const initialCapital = btConfig.initialCapital;
  const commission = btConfig.commissionRate;
  const slippage = btConfig.slippageRate;
  const riskPerTrade = riskConfig.riskPerTrade;
  const killSwitchEnabled = config.portfolioRisk.killSwitchEnabled;
  const maxDdThreshold = config.portfolioRisk.maxDrawdownThreshold;
  const coolingPeriodDays = config.portfolioRisk.coolingPeriodDays;
  const useVanTharp = btConfig.use_van_tharp;

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

  const firstPrice = bars[0].close;
  const buyHoldShares = initialCapital / firstPrice;

  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const currentEquity = equityCurve[equityCurve.length - 1];

    if (currentEquity > portfolioPeak) portfolioPeak = currentEquity;
    const portfolioDrawdown = portfolioPeak > 0 ? (portfolioPeak - currentEquity) / portfolioPeak : 0;
    drawdownHistory.push(portfolioDrawdown);

    // Kill switch trigger
    if (killSwitchEnabled && portfolioDrawdown >= maxDdThreshold && !killSwitchActive) {
      killSwitchActive = true;
      killSwitchTriggerIdx = i;
    }
    // Cooling period recovery
    if (killSwitchActive && killSwitchTriggerIdx !== null) {
      const daysSinceTrigger = i - killSwitchTriggerIdx;
      if (daysSinceTrigger >= coolingPeriodDays) {
        killSwitchActive = false;
        killSwitchTriggerIdx = null;
      }
    }

    // ── ENTRY ──────────────────────────────────────────────────
    if (position === null && prev.entrySignal === "BUY" && !killSwitchActive) {
      const entryPrice = cur.open * (1 + slippage);
      const entryAtr = cur.atr;
      const entryRegime = prev.regime ?? "NEUTRAL";

      const entryAtrMult = getAtrMultiplier(entryRegime);
      const entryTrailingMult = getTrailingAtrMult(entryRegime);
      const entryMaxHold = getMaxHoldingDays(entryRegime);
      const entryConfirmBars = getConfirmBars(entryRegime, exchange);
      const entryProfitTargetAtr = getProfitTargetAtr(entryRegime);
      const entryTrailTrigger = getTrailTrigger(entryRegime);

      let shares: number;
      if (useVanTharp) {
        const riskAmount = runningEquity * riskPerTrade;
        shares = entryAtr > 0 ? riskAmount / (entryAtrMult * entryAtr) : 1;
      } else {
        shares = Math.floor((runningEquity * 0.998) / entryPrice);
      }

      const entryCostPerShare = entryPrice * (1 + commission);
      const entryCostTotal = entryCostPerShare * shares;
      const atrStop = entryPrice - entryAtrMult * entryAtr;
      const profitTarget = entryPrice + entryProfitTargetAtr * entryAtr;

      position = {
        entry_date: cur.date,
        entry_price: entryPrice,
        entry_cost_per_share: entryCostPerShare,
        entry_cost_total: entryCostTotal,
        entry_atr: entryAtr,
        shares,
        entry_equity: runningEquity,
        atr_stop_price: atrStop,
        original_stop_price: atrStop, // BUG FIX G: immutable reference
        profit_target: profitTarget,
        breakeven_triggered: false,
        breakeven_level_1: false,
        breakeven_level_2: false,
        bars_held: 0,
        highest_price: entryPrice,
        trailing_stop: null,
        mae: 0,
        mfe: 0,
        mae_pct: 0,
        mfe_pct: 0,
        entry_regime: entryRegime,
        max_hold_days: entryMaxHold,
        entry_idx: i,
        atr_mult: entryAtrMult,
        trail_mult: entryTrailingMult,
        trail_trigger: entryTrailTrigger,
        confirm_bars: entryConfirmBars,
      };
    }

    // ── MANAGE POSITION ────────────────────────────────────────
    else if (position !== null) {
      (position.bars_held as number)++;
      if (cur.high > (position.highest_price as number)) {
        position.highest_price = cur.high;
      }

      const adverse = (position.entry_price as number) - cur.low;
      if (adverse > (position.mae as number)) {
        position.mae = adverse;
        position.mae_pct = adverse / (position.entry_price as number);
      }
      const favorable = cur.high - (position.entry_price as number);
      if (favorable > (position.mfe as number)) {
        position.mfe = favorable;
        position.mfe_pct = favorable / (position.entry_price as number);
      }

      const currentAtr = cur.atr;
      const trailMult = position.trail_mult as number;
      const trailTrigger = position.trail_trigger as number;

      // BUG FIX V12.5.6 G RESIDUAL: always use original_stop_price for R calc
      const riskDistance = (position.entry_price as number) - (position.original_stop_price as number);
      const profitSoFar = cur.close - (position.entry_price as number);
      const rLevel = riskDistance > 0 ? profitSoFar / riskDistance : 0;

      // Two-step breakeven
      if (rLevel >= 1.5 && !position.breakeven_level_2) {
        position.atr_stop_price = (position.entry_price as number) + 0.1 * currentAtr;
        position.breakeven_level_2 = true;
        position.breakeven_triggered = true;
      } else if (rLevel >= 0.75 && !position.breakeven_level_1) {
        const halfRisk = riskDistance * 0.5;
        position.atr_stop_price = (position.entry_price as number) - halfRisk;
        position.breakeven_level_1 = true;
      }

      // Trailing stop — only activates after trail_trigger R
      const trailThreshold = trailTrigger * riskDistance;
      if (profitSoFar >= trailThreshold) {
        const newTrailing = (position.highest_price as number) - trailMult * currentAtr;
        if (position.trailing_stop === null || newTrailing > (position.trailing_stop as number)) {
          position.trailing_stop = newTrailing;
        }
      }

      // ── EXIT CONDITIONS ──────────────────────────────────────
      const exitSignal = prev.signalConfirmed === "SELL";
      const maxDaysReached = (position.bars_held as number) >= (position.max_hold_days as number);
      const atrStopHit = cur.low <= (position.atr_stop_price as number);
      const trailingStopHit = position.trailing_stop !== null && cur.low <= (position.trailing_stop as number);
      const profitTargetHit = cur.high >= (position.profit_target as number);

      // Ranging mean-reversion exit
      let rangingExit = false;
      if (position.entry_regime === "RANGING" && (position.bars_held as number) >= 3) {
        if (!isNaN(cur.bbMid) && cur.close > cur.bbMid) rangingExit = true;
      }

      if (exitSignal || maxDaysReached || atrStopHit || trailingStopHit || rangingExit || profitTargetHit) {
        let exitPrice: number;
        let exitReason: string;

        if (profitTargetHit) {
          exitPrice = position.profit_target as number;
          exitReason = "Profit Target";
        } else if (atrStopHit && !trailingStopHit) {
          exitPrice = position.atr_stop_price as number;
          exitReason = "ATR Stop";
        } else if (trailingStopHit) {
          exitPrice = position.trailing_stop as number;
          exitReason = "Trailing Stop";
        } else if (rangingExit) {
          exitPrice = cur.open;
          exitReason = "Range Mean Reversion";
        } else if (exitSignal) {
          exitPrice = cur.open;
          exitReason = "Signal";
        } else {
          exitPrice = cur.open;
          exitReason = "Max Days";
        }

        exitPrice *= (1 - slippage);

        const exitProceedsPerShare = exitPrice * (1 - commission);
        const perSharePnl = exitProceedsPerShare - (position.entry_cost_per_share as number);
        const totalPnl = perSharePnl * (position.shares as number);
        const returnPct = (exitPrice - (position.entry_price as number)) / (position.entry_price as number);

        runningEquity = (position.entry_equity as number) + totalPnl;

        // R-multiple uses ORIGINAL stop (BUG FIX G)
        const riskPerShare = (position.entry_price as number) - (position.original_stop_price as number);
        const actualRiskPct = position.entry_price as number > 0 ? riskPerShare / (position.entry_price as number) : 0.02;
        const rMultiple = actualRiskPct > 0 ? returnPct / actualRiskPct : 0;

        tradeNum++;

        trades.push({
          trade_num: tradeNum,
          entry_date: position.entry_date as string,
          exit_date: cur.date,
          entry_idx: position.entry_idx as number,
          exit_idx: i,
          entry_price: position.entry_price as number,
          exit_price: exitPrice,
          return: returnPct,
          pnl: totalPnl,
          shares: position.shares as number,
          bars_held: position.bars_held as number,
          r_multiple: rMultiple,
          exit_reason: exitReason,
          atr_stop_price: position.atr_stop_price as number,
          trailing_stop: position.trailing_stop as number | null,
          mae_pct: (position.mae_pct as number) * 100,
          mfe_pct: (position.mfe_pct as number) * 100,
          actual_risk_pct: actualRiskPct * 100,
          entry_regime: position.entry_regime as string,
          atr_mult: position.atr_mult as number,
          trail_mult: position.trail_mult as number,
          max_hold_days: position.max_hold_days as number,
        });

        position = null;
      }
    }

    // Equity curve (mark-to-market)
    let curValue: number;
    if (position !== null) {
      const unrealizedPnl = (cur.close - (position.entry_price as number)) * (position.shares as number);
      curValue = (position.entry_equity as number) + unrealizedPnl;
    } else {
      curValue = runningEquity;
    }
    equityCurve.push(curValue);
    equityDates.push(cur.date);
  }

  // ── EMPTY RESULTS ─────────────────────────────────────────────
  if (trades.length === 0) {
    return buildEmptyResults(symbol, bars, config, killSwitchActive, equityCurve, equityDates);
  }

  // ── METRICS ──────────────────────────────────────────────────
  const returns = trades.map((t) => t.return);
  const winners = trades.filter((t) => t.return > 0);
  const losers = trades.filter((t) => t.return <= 0);

  const winRate = winners.length / trades.length;
  const avgWin = winners.length > 0 ? mean(winners.map((t) => t.return)) : 0;
  const avgLoss = losers.length > 0 ? mean(losers.map((t) => t.return)) : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  const equitySeries = equityCurve;
  const dailyReturns: number[] = [];
  for (let i = 1; i < equitySeries.length; i++) {
    const prev = equitySeries[i - 1];
    dailyReturns.push(prev > 0 ? (equitySeries[i] - prev) / prev : 0);
  }

  const drMean = mean(dailyReturns);
  const drStd = Math.sqrt(mean(dailyReturns.map((r) => (r - drMean) ** 2)));
  const sharpe = drStd > 0 ? (drMean * 252) / (drStd * Math.sqrt(252)) : 0;

  const downsideReturns = dailyReturns.filter((r) => r < 0);
  const drDownStd = downsideReturns.length > 0
    ? Math.sqrt(mean(downsideReturns.map((r) => r ** 2)))
    : 0;
  const sortino = drDownStd > 0 ? (drMean * 252) / (drDownStd * Math.sqrt(252)) : 0;

  // Max drawdown
  let peak = equitySeries[0];
  let maxDrawdown = 0;
  for (const v of equitySeries) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const grossProfit = winners.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  // BUG FIX C: use running_equity (realized cash)
  const totalReturn = (runningEquity - initialCapital) / initialCapital;
  const buyHoldReturn = (bars[bars.length - 1].close * buyHoldShares - initialCapital) / initialCapital;
  const alpha = totalReturn - buyHoldReturn;
  const annualizedReturn = totalReturn * (252 / bars.length);
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Ulcer Index
  const squaredDDs = drawdownHistory.map((d) => d ** 2);
  const ulcerIndex = Math.sqrt(mean(squaredDDs)) * 100;

  // Omega Ratio
  const gains = dailyReturns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses2 = Math.abs(dailyReturns.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const omegaRatio = losses2 > 0 ? gains / losses2 : 0;

  // Exit reasons
  const exitReasons: Record<string, number> = {};
  for (const t of trades) {
    exitReasons[t.exit_reason] = (exitReasons[t.exit_reason] ?? 0) + 1;
  }

  // Duration stats
  const holdingPeriods = trades.map((t) => t.bars_held);
  const winnerDurations = winners.map((t) => t.bars_held);
  const loserDurations = losers.map((t) => t.bars_held);

  // Score history (last 20 bars)
  const scoreHistory = bars.slice(-20).map((b) => b.score);

  const last = bars[bars.length - 1];
  const support = calcSupport(bars);
  const resistance = calcResistance(bars);
  const stopLoss = calcStopLoss(bars, config.risk.atrMultiplier);
  const fibTargets = calcFibTargets(bars);
  const week52High = bars.length >= 252 ? Math.max(...bars.slice(-252).map((b) => b.high)) : Math.max(...bars.map((b) => b.high));
  const week52Low = bars.length >= 252 ? Math.min(...bars.slice(-252).map((b) => b.low)) : Math.min(...bars.map((b) => b.low));

  const volMean20 = mean(bars.slice(-21, -1).map((b) => b.volume));
  const volRatioLatest = volMean20 > 0 ? last.volume / volMean20 : 1;

  return {
    symbol,
    trades,
    num_trades: trades.length,
    win_rate: winRate * 100,
    expectancy: expectancy * 100,
    total_return: totalReturn * 100,
    sharpe,
    sortino,
    max_drawdown: maxDrawdown * 100,
    profit_factor: profitFactor,
    avg_win: avgWin * 100,
    avg_loss: avgLoss * 100,
    r_multiples: trades.map((t) => t.r_multiple),
    equity_curve: equityCurve,
    equity_dates: equityDates,
    signal_bars: config.signal.signalConfirmationBars,
    buy_hold_return: buyHoldReturn * 100,
    alpha: alpha * 100,
    alpha_status: alpha > 0 ? "ADDING VALUE" : "DESTROYING VALUE",
    calmar_ratio: calmarRatio,
    ulcer_index: ulcerIndex,
    omega_ratio: omegaRatio,
    exit_reasons: exitReasons,
    avg_mae: mean(trades.map((t) => t.mae_pct)),
    avg_mfe: mean(trades.map((t) => t.mfe_pct)),
    winner_mae: winners.length > 0 ? mean(winners.map((t) => t.mae_pct)) : 0,
    loser_mae: losers.length > 0 ? mean(losers.map((t) => t.mae_pct)) : 0,
    winner_mfe: winners.length > 0 ? mean(winners.map((t) => t.mfe_pct)) : 0,
    kill_switch_triggered: killSwitchActive,
    latest_atr: last.atr,
    latest_price: last.close,
    rsi_divergence: last.rsiDivergence,
    rsi_divergence_type: last.rsiDivergenceType,
    avg_duration: mean(holdingPeriods),
    median_duration: median(holdingPeriods),
    min_duration: Math.min(...holdingPeriods),
    max_duration: Math.max(...holdingPeriods),
    avg_winner_duration: mean(winnerDurations),
    avg_loser_duration: mean(loserDurations),
    median_winner_duration: median(winnerDurations),
    median_loser_duration: median(loserDurations),
    score_history: scoreHistory,
    rsi: last.rsi,
    macd_hist: last.macdHist,
    adx: last.adx,
    atr_pct: last.close > 0 ? (last.atr / last.close) * 100 : null,
    vol_ratio: volRatioLatest,
    bb_position: last.bbPosition,
    support_level: support,
    resistance_level: resistance,
    stop_loss_price: stopLoss,
    fib_targets: fibTargets,
    week_52_high: week52High,
    week_52_low: week52Low,
    sma_20: last.sma20,
    sma_50: last.sma50,
    candlestick_patterns: detectCandlestickPatterns(bars, 5),
  };
}

function buildEmptyResults(
  symbol: string,
  bars: OHLCVBar[],
  config: AppConfig,
  killSwitch: boolean,
  equityCurve: number[],
  equityDates: string[]
): BacktestResult {
  const last = bars[bars.length - 1];
  const buyHoldReturn = bars.length > 1
    ? (last.close - bars[0].close) / bars[0].close
    : 0;
  const scoreHistory = bars.slice(-20).map((b) => b.score);
  const week52High = bars.length >= 252 ? Math.max(...bars.slice(-252).map((b) => b.high)) : Math.max(...bars.map((b) => b.high));
  const week52Low = bars.length >= 252 ? Math.min(...bars.slice(-252).map((b) => b.low)) : Math.min(...bars.map((b) => b.low));

  return {
    symbol, trades: [], num_trades: 0,
    win_rate: 0, expectancy: 0, total_return: 0,
    sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0,
    avg_win: 0, avg_loss: 0, r_multiples: [],
    equity_curve: equityCurve, equity_dates: equityDates,
    signal_bars: config.signal.signalConfirmationBars,
    buy_hold_return: buyHoldReturn * 100,
    alpha: -buyHoldReturn * 100, alpha_status: "NO TRADES",
    calmar_ratio: 0, ulcer_index: 0, omega_ratio: 0,
    exit_reasons: {}, avg_mae: 0, avg_mfe: 0,
    winner_mae: 0, loser_mae: 0, winner_mfe: 0,
    kill_switch_triggered: killSwitch,
    latest_atr: last.atr, latest_price: last.close,
    rsi_divergence: last.rsiDivergence ?? 0,
    rsi_divergence_type: last.rsiDivergenceType ?? "None",
    avg_duration: 0, median_duration: 0, min_duration: 0, max_duration: 0,
    avg_winner_duration: 0, avg_loser_duration: 0,
    median_winner_duration: 0, median_loser_duration: 0,
    score_history: scoreHistory,
    rsi: last.rsi, macd_hist: last.macdHist, adx: last.adx,
    atr_pct: last.close > 0 ? (last.atr / last.close) * 100 : null,
    vol_ratio: last.volRatio,
    bb_position: last.bbPosition,
    support_level: calcSupport(bars),
    resistance_level: calcResistance(bars),
    stop_loss_price: calcStopLoss(bars, config.risk.atrMultiplier),
    fib_targets: calcFibTargets(bars),
    week_52_high: week52High, week_52_low: week52Low,
    sma_20: last.sma20, sma_50: last.sma50,
    candlestick_patterns: detectCandlestickPatterns(bars, 5),
  };
}

// ============================================================
// SUPERTREND BACKTEST — exits ONLY on trend reversal
// NO ATR stop, NO profit target, NO max days, NO trailing stop
// The SuperTrend line IS the trailing stop (trend reversal = exit)
// ============================================================
export function runSupertrendBacktest(
  bars: OHLCVBar[],
  symbol: string,
  config: AppConfig
): BacktestResult {
  const btConfig = config.backtest;
  const initialCapital = btConfig.initialCapital;
  const commission = btConfig.commissionRate;
  const slippage = btConfig.slippageRate;
  const useVanTharp = btConfig.use_van_tharp;
  const riskConfig = config.risk;

  const trades: Trade[] = [];
  let position: Record<string, number | string | boolean | null> | null = null;
  const equityCurve: number[] = [initialCapital];
  const equityDates: string[] = [bars[0].date];

  let runningEquity = initialCapital;
  let tradeNum = 0;
  const firstPrice = bars[0].close;
  const buyHoldShares = initialCapital / firstPrice;
  const drawdownHistory: number[] = [];
  let portfolioPeak = initialCapital;

  // Track whether we've already entered the current bullish run
  // so we don't re-enter on every bar while bullish with no position
  let enteredCurrentBullRun = false;

  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const currentEquity = equityCurve[equityCurve.length - 1];
    if (currentEquity > portfolioPeak) portfolioPeak = currentEquity;
    const portfolioDrawdown = portfolioPeak > 0 ? (portfolioPeak - currentEquity) / portfolioPeak : 0;
    drawdownHistory.push(portfolioDrawdown);

    // Reset flag when trend goes bearish (new bullish run will be a new entry opportunity)
    if (prev.supertrendDir === -1) {
      enteredCurrentBullRun = false;
    }

    // ── ENTRY ────────────────────────────────────────────────────
    // Enter on the FIRST bar after a bearish→bullish flip, if EMA filter passes.
    // enteredCurrentBullRun prevents re-entering on every subsequent bullish bar.
    if (position === null && prev.supertrendDir === 1 && !enteredCurrentBullRun) {
      const emaFilter = prev.close > prev.ema50;
      if (emaFilter) {
        const entryPrice = cur.open * (1 + slippage);
        const entryAtr = cur.atr;

        let shares: number;
        if (useVanTharp) {
          const riskAmount = runningEquity * riskConfig.riskPerTrade;
          const riskDist = 2 * entryAtr;
          shares = riskDist > 0 ? riskAmount / riskDist : 1;
        } else {
          shares = Math.floor((runningEquity * 0.998) / entryPrice);
        }

        const entryCostPerShare = entryPrice * (1 + commission);
        position = {
          entry_date: cur.date,
          entry_price: entryPrice,
          entry_cost_per_share: entryCostPerShare,
          shares,
          entry_equity: runningEquity,
          bars_held: 0,
          highest_price: entryPrice,
          mae: 0,
          mfe: 0,
          mae_pct: 0,
          mfe_pct: 0,
          entry_idx: i,
        };
        enteredCurrentBullRun = true;
      }
    }

    // ── MANAGE / EXIT ────────────────────────────────────────────
    else if (position !== null) {
      (position.bars_held as number)++;
      if (cur.high > (position.highest_price as number)) position.highest_price = cur.high;

      const adverse = (position.entry_price as number) - cur.low;
      if (adverse > (position.mae as number)) {
        position.mae = adverse;
        position.mae_pct = adverse / (position.entry_price as number);
      }
      const favorable = cur.high - (position.entry_price as number);
      if (favorable > (position.mfe as number)) {
        position.mfe = favorable;
        position.mfe_pct = favorable / (position.entry_price as number);
      }

      // ST exit: direction flips to BEARISH (supertrendDir === -1)
      // Use prev bar's direction (signal already shifted)
      const stReversed = cur.supertrendDir === -1 && prev.supertrendDir === 1;

      if (stReversed) {
        // Exit at ST line value (the price where trend flipped) or open, whichever is more conservative
        const exitPrice = Math.min(cur.open, cur.supertrend) * (1 - slippage);
        const exitProceedsPerShare = exitPrice * (1 - commission);
        const perSharePnl = exitProceedsPerShare - (position.entry_cost_per_share as number);
        const totalPnl = perSharePnl * (position.shares as number);
        const returnPct = (exitPrice - (position.entry_price as number)) / (position.entry_price as number);

        runningEquity = (position.entry_equity as number) + totalPnl;

        // R-multiple: use 2×ATR as risk proxy
        const approxRisk = 2 * bars[position.entry_idx as number].atr;
        const rMultiple = approxRisk > 0 ? (exitPrice - (position.entry_price as number)) / approxRisk : 0;

        tradeNum++;
        trades.push({
          trade_num: tradeNum,
          entry_date: position.entry_date as string,
          exit_date: cur.date,
          entry_idx: position.entry_idx as number,
          exit_idx: i,
          entry_price: position.entry_price as number,
          exit_price: exitPrice,
          return: returnPct,
          pnl: totalPnl,
          shares: position.shares as number,
          bars_held: position.bars_held as number,
          r_multiple: rMultiple,
          exit_reason: "ST Reversal",
          atr_stop_price: cur.supertrend,
          trailing_stop: null,
          mae_pct: (position.mae_pct as number) * 100,
          mfe_pct: (position.mfe_pct as number) * 100,
          actual_risk_pct: approxRisk > 0 ? (approxRisk / (position.entry_price as number)) * 100 : 2,
          entry_regime: bars[position.entry_idx as number].regime,
          atr_mult: 2,
          trail_mult: 0,
          max_hold_days: 9999,
        });
        position = null;
      }
    }

    // Equity mark-to-market
    let curValue: number;
    if (position !== null) {
      const unrealizedPnl = (cur.close - (position.entry_price as number)) * (position.shares as number);
      curValue = (position.entry_equity as number) + unrealizedPnl;
    } else {
      curValue = runningEquity;
    }
    equityCurve.push(curValue);
    equityDates.push(cur.date);
  }

  // ── Close open position at end (mark-to-market) ─────────────
  // (leave open positions unclosed — same as score backtest)

  if (trades.length === 0) {
    return buildEmptyResults(symbol, bars, config, false, equityCurve, equityDates);
  }

  // ── Metrics — identical equity-curve method as runBacktest() ─
  const winners = trades.filter((t) => t.return > 0);
  const losers = trades.filter((t) => t.return <= 0);
  const winRate = winners.length / trades.length;
  const avgWin = winners.length > 0 ? mean(winners.map((t) => t.return)) : 0;
  const avgLoss = losers.length > 0 ? mean(losers.map((t) => t.return)) : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  // Sharpe: use FULL equity curve daily returns, identical to runBacktest().
  // Do NOT use in-trade-only returns: with 2 uniformly losing trades the
  // variance collapses → nonsensical positive Sharpe (e.g. -7.5% return, +1.1 Sharpe).
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    dailyReturns.push(prev > 0 ? (equityCurve[i] - prev) / prev : 0);
  }
  const drMean = mean(dailyReturns);
  const drStd = Math.sqrt(mean(dailyReturns.map((r) => (r - drMean) ** 2)));
  const sharpe = drStd > 0 ? (drMean * 252) / (drStd * Math.sqrt(252)) : 0;

  const downsideReturns = dailyReturns.filter((r) => r < 0);
  const drDownStd = downsideReturns.length > 0 ? Math.sqrt(mean(downsideReturns.map((r) => r ** 2))) : 0;
  const sortino = drDownStd > 0 ? (drMean * 252) / (drDownStd * Math.sqrt(252)) : 0;

  let peak = equityCurve[0];
  let maxDrawdown = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const grossProfit = winners.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const totalReturn = (runningEquity - initialCapital) / initialCapital;
  const buyHoldReturn = (bars[bars.length - 1].close * buyHoldShares - initialCapital) / initialCapital;
  const alpha = totalReturn - buyHoldReturn;
  const annualizedReturn = totalReturn * (252 / bars.length);
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  const squaredDDs = drawdownHistory.map((d) => d ** 2);
  const ulcerIndex = Math.sqrt(mean(squaredDDs)) * 100;
  const gains = dailyReturns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses2 = Math.abs(dailyReturns.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const omegaRatio = losses2 > 0 ? gains / losses2 : 0;

  const holdingPeriods = trades.map((t) => t.bars_held);
  const winnerDurations = winners.map((t) => t.bars_held);
  const loserDurations = losers.map((t) => t.bars_held);

  const last = bars[bars.length - 1];
  const week52High = bars.length >= 252 ? Math.max(...bars.slice(-252).map((b) => b.high)) : Math.max(...bars.map((b) => b.high));
  const week52Low = bars.length >= 252 ? Math.min(...bars.slice(-252).map((b) => b.low)) : Math.min(...bars.map((b) => b.low));
  const volMean20 = mean(bars.slice(-21, -1).map((b) => b.volume));
  const volRatioLatest = volMean20 > 0 ? last.volume / volMean20 : 1;

  return {
    symbol,
    trades,
    num_trades: trades.length,
    win_rate: winRate * 100,
    expectancy: expectancy * 100,
    total_return: totalReturn * 100,
    sharpe,
    sortino,
    max_drawdown: maxDrawdown * 100,
    profit_factor: profitFactor,
    avg_win: avgWin * 100,
    avg_loss: avgLoss * 100,
    r_multiples: trades.map((t) => t.r_multiple),
    equity_curve: equityCurve,
    equity_dates: equityDates,
    signal_bars: 0,
    buy_hold_return: buyHoldReturn * 100,
    alpha: alpha * 100,
    alpha_status: alpha > 0 ? "ADDING VALUE" : "DESTROYING VALUE",
    calmar_ratio: calmarRatio,
    ulcer_index: ulcerIndex,
    omega_ratio: omegaRatio,
    exit_reasons: { "ST Reversal": trades.length },
    avg_mae: mean(trades.map((t) => t.mae_pct)),
    avg_mfe: mean(trades.map((t) => t.mfe_pct)),
    winner_mae: winners.length > 0 ? mean(winners.map((t) => t.mae_pct)) : 0,
    loser_mae: losers.length > 0 ? mean(losers.map((t) => t.mae_pct)) : 0,
    winner_mfe: winners.length > 0 ? mean(winners.map((t) => t.mfe_pct)) : 0,
    kill_switch_triggered: false,
    latest_atr: last.atr,
    latest_price: last.close,
    rsi_divergence: last.rsiDivergence,
    rsi_divergence_type: last.rsiDivergenceType,
    avg_duration: mean(holdingPeriods),
    median_duration: median(holdingPeriods),
    min_duration: holdingPeriods.length > 0 ? Math.min(...holdingPeriods) : 0,
    max_duration: holdingPeriods.length > 0 ? Math.max(...holdingPeriods) : 0,
    avg_winner_duration: mean(winnerDurations),
    avg_loser_duration: mean(loserDurations),
    median_winner_duration: median(winnerDurations),
    median_loser_duration: median(loserDurations),
    score_history: bars.slice(-20).map((b) => b.score),
    rsi: last.rsi,
    macd_hist: last.macdHist,
    adx: last.adx,
    atr_pct: last.close > 0 ? (last.atr / last.close) * 100 : null,
    vol_ratio: volRatioLatest,
    bb_position: last.bbPosition,
    support_level: calcSupport(bars),
    resistance_level: calcResistance(bars),
    stop_loss_price: last.supertrend, // ST line IS the stop
    fib_targets: calcFibTargets(bars),
    week_52_high: week52High,
    week_52_low: week52Low,
    sma_20: last.sma20,
    sma_50: last.sma50,
    candlestick_patterns: [],
  };
}
