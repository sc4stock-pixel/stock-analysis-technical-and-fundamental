"use client";
import { useState } from "react";
import { StockAnalysisResult, AppConfig, CandlestickPattern, BacktestResult } from "@/types";
import { regimeColor } from "@/lib/regime";
import OverviewTab    from "./tabs/OverviewTab";
import BacktestTab   from "./tabs/BacktestTab";
import MonteCarloTab from "./tabs/MonteCarloTab";
import TradingPlanTab from "./tabs/TradingPlanTab";
import ChartTab      from "./tabs/ChartTab";

interface Props {
  result: StockAnalysisResult;
  config: AppConfig;
}

type Strategy = "score" | "supertrend";
const TABS = ["OVERVIEW", "CHART", "BACKTEST", "MONTE CARLO", "PLAN"] as const;
type Tab = (typeof TABS)[number];

function signalBadge(signal: string) {
  if (signal === "BUY")  return "badge-buy";
  if (signal === "SELL") return "badge-sell";
  return "badge-hold";
}

function patternBadge(p: CandlestickPattern) {
  const color =
    p.sentiment === "bullish" ? "text-[#00ff88] border-[#00ff88]/30" :
    p.sentiment === "bearish" ? "text-[#ff4757] border-[#ff4757]/30" :
    "text-[#ffa502] border-[#ffa502]/30";
  return (
    <span key={p.pattern + p.bar_index}
      className={`text-xs border rounded px-1.5 py-0.5 bg-black/30 ${color}`}>
      {p.pattern}{p.label !== "Latest" ? ` [${p.label}]` : ""}
    </span>
  );
}

/**
 * Build a "SuperTrend view" of the result by splicing the ST backtest metrics
 * into the result object so all existing tabs render ST data transparently.
 * Only backtest metrics change — price, regime, chart_bars, etc. stay the same.
 */
function buildSTView(result: StockAnalysisResult): StockAnalysisResult {
  const cmp = result.comparison;
  if (!cmp) return result;

  const stMetrics = cmp.supertrend;
  const scoreBt = result.backtest;
  if (!scoreBt) return result;

  // Reconstruct a simplified ST equity curve from trade PnLs
  // Start at same initialCapital, step through trades in order
  const initialCapital = scoreBt.equity_curve[0] ?? 10000;
  const stEquityCurve: number[] = [initialCapital];
  const stEquityDates: string[] = [scoreBt.equity_dates[0] ?? ""];
  let runningEq = initialCapital;
  // Sort trades by entry index
  const sortedTrades = [...stMetrics.trades].sort((a, b) => a.entry_idx - b.entry_idx);
  for (const t of sortedTrades) {
    // Flat equity during pre-entry period
    const barsBefore = Math.max(0, t.entry_idx - stEquityCurve.length + 1);
    for (let b = 0; b < barsBefore; b++) stEquityCurve.push(runningEq);
    // Approximate linear equity during trade
    const pnl = t.pnl;
    const barsHeld = Math.max(1, t.bars_held);
    for (let b = 0; b < barsHeld; b++) {
      stEquityCurve.push(runningEq + (pnl * (b + 1)) / barsHeld);
    }
    runningEq += pnl;
  }
  // Pad to match score equity length with final equity
  while (stEquityCurve.length < scoreBt.equity_curve.length) {
    stEquityCurve.push(runningEq);
  }

  const winners = stMetrics.trades.filter(t => t.return > 0);
  const losers  = stMetrics.trades.filter(t => t.return <= 0);
  const fn = (arr: typeof stMetrics.trades, key: keyof typeof stMetrics.trades[0]) =>
    arr.length > 0 ? arr.reduce((a, t) => a + (t[key] as number), 0) / arr.length : 0;

  const stBt: BacktestResult = {
    ...scoreBt,
    trades: stMetrics.trades,
    num_trades: stMetrics.num_trades,
    win_rate: stMetrics.win_rate,
    total_return: stMetrics.total_return,
    profit_factor: stMetrics.profit_factor,
    max_drawdown: stMetrics.max_drawdown,
    sharpe: stMetrics.sharpe,
    sortino: stMetrics.sortino ?? 0,
    expectancy: stMetrics.expectancy ?? 0,
    avg_win: stMetrics.avg_win ?? 0,
    avg_loss: stMetrics.avg_loss ?? 0,
    alpha: stMetrics.alpha,
    alpha_status: stMetrics.alpha >= 0 ? "ADDING VALUE" : "DESTROYING VALUE",
    exit_reasons: stMetrics.trades.reduce((acc, t) => {
      acc[t.exit_reason] = (acc[t.exit_reason] ?? 0) + 1; return acc;
    }, {} as Record<string, number>),
    stop_loss_price: result.st_value > 0 ? result.st_value : scoreBt.stop_loss_price,
    r_multiples: stMetrics.trades.map(t => t.r_multiple),
    equity_curve: stEquityCurve,
    equity_dates: stEquityDates,
    total_return_250d: stMetrics.total_return_250d ?? stMetrics.total_return,
    total_return_500d: stMetrics.total_return_500d ?? stMetrics.total_return,
    avg_mae: fn(stMetrics.trades, "mae_pct"),
    avg_mfe: fn(stMetrics.trades, "mfe_pct"),
    winner_mae: fn(winners, "mae_pct"),
    winner_mfe: fn(winners, "mfe_pct"),
    loser_mae:  fn(losers,  "mae_pct"),
    avg_duration: fn(stMetrics.trades, "bars_held"),
    median_duration: 0,
    min_duration: stMetrics.trades.length > 0 ? Math.min(...stMetrics.trades.map(t => t.bars_held)) : 0,
    max_duration: stMetrics.trades.length > 0 ? Math.max(...stMetrics.trades.map(t => t.bars_held)) : 0,
    avg_winner_duration: fn(winners, "bars_held"),
    avg_loser_duration:  fn(losers,  "bars_held"),
    median_winner_duration: 0,
    median_loser_duration: 0,
    kill_switch_triggered: false,
    calmar_ratio: 0,
    ulcer_index: 0,
    omega_ratio: 0,
    signal_bars: 0,
  };

  return { ...result, backtest: stBt };
}

export default function StockCard({ result, config }: Props) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [strategy, setStrategy] = useState<Strategy>("score");

  const bt = result.backtest;
  const isError = result.signal === "ERROR";
  const hasST = !!result.comparison;

  // Build the result view for the active strategy
  const activeResult = strategy === "supertrend" && hasST
    ? buildSTView(result)
    : result;

  const priceFmt = (p: number) => {
    if (!p || p === 0) return "—";
    return result.exchange === "HK" ? `HK$${p.toFixed(2)}` : `$${p.toFixed(2)}`;
  };

  const chg = result.change_pct ?? 0;
  const stDir = result.st_direction ?? -1;

  return (
    <div className="card flex flex-col">
      {/* ── CARD HEADER ── */}
      <div className="p-3 border-b border-[#1e2d4a] flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Symbol row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#00d4ff] font-bold text-sm">{result.symbol}</span>
            <span className="text-[#4a6080] text-xs">{result.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${signalBadge(result.signal)}`}>
              {result.signal}
            </span>
            {/* ST direction badge inline */}
            <span className={`text-xs px-1 py-0.5 rounded border font-mono ${
              stDir === 1
                ? "border-[#00ff88]/30 text-[#00ff88] bg-[#00ff88]/5"
                : "border-[#ff4757]/30 text-[#ff4757] bg-[#ff4757]/5"
            }`}>
              {stDir === 1 ? "🟢 ST" : "🔴 ST"}
            </span>
          </div>
          {/* Price row */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[#c8d8f0] text-sm font-bold">{priceFmt(result.current_price)}</span>
            <span className={`text-xs font-mono ${chg >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
              {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%
            </span>
            <span className={`text-xs font-bold ${
              (result.score ?? 0) >= 6.5 ? "text-[#00ff88]" :
              (result.score ?? 0) >= 5.5 ? "text-[#ffa502]" : "text-[#ff4757]"
            }`}>
              {result.score?.toFixed(1)} / 10
            </span>
            <span className="text-[#4a6080] text-xs">{result.confidence?.toFixed(0)}% conf</span>
          </div>
          {/* Regime + patterns */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded border ${regimeColor(result.regime ?? "")}`}>
              {(result.regime ?? "UNKNOWN").replace(/_/g, " ")}
            </span>
            {bt?.candlestick_patterns?.map((p) => patternBadge(p))}
          </div>
        </div>

        {/* Score ring */}
        <div className="shrink-0">
          <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center"
            style={{
              borderColor:
                (result.score ?? 0) >= 6.5 ? "#00ff88" :
                (result.score ?? 0) >= 5.5 ? "#ffa502" : "#ff4757",
            }}>
            <span className="text-xs font-bold" style={{
              color:
                (result.score ?? 0) >= 6.5 ? "#00ff88" :
                (result.score ?? 0) >= 5.5 ? "#ffa502" : "#ff4757",
            }}>
              {result.score?.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* ── STRATEGY TOGGLE + TABS ── */}
      <div className="flex items-center border-b border-[#1e2d4a] overflow-x-auto">
        {/* Strategy toggle — compact pill left of tabs */}
        {hasST && (
          <div className="flex shrink-0 border-r border-[#1e2d4a] mr-1">
            <button
              onClick={() => setStrategy("score")}
              className={`px-2 py-1.5 text-xs font-mono transition-all whitespace-nowrap ${
                strategy === "score"
                  ? "text-[#00d4ff] bg-[#00d4ff]/10 border-b-2 border-[#00d4ff]"
                  : "text-[#4a6080] hover:text-[#6b85a0]"
              }`}
              title="Score multi-indicator strategy"
            >
              SCR
            </button>
            <button
              onClick={() => setStrategy("supertrend")}
              className={`px-2 py-1.5 text-xs font-mono transition-all whitespace-nowrap ${
                strategy === "supertrend"
                  ? "text-[#ffa502] bg-[#ffa502]/10 border-b-2 border-[#ffa502]"
                  : "text-[#4a6080] hover:text-[#6b85a0]"
              }`}
              title="SuperTrend trend-following strategy"
            >
              ST
            </button>
          </div>
        )}

        {/* Tabs */}
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-xs whitespace-nowrap px-2 transition-all ${
              tab === t
                ? strategy === "supertrend"
                  ? "text-[#ffa502] border-b-2 border-[#ffa502] bg-[#ffa502]/5"
                  : "text-[#00d4ff] border-b-2 border-[#00d4ff] bg-[#00d4ff]/5"
                : "text-[#4a6080] hover:text-[#6b85a0]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── STRATEGY CONTEXT BANNER ── */}
      {strategy === "supertrend" && hasST && (
        <div className="flex items-center gap-2 px-3 py-1 bg-[#ffa502]/5 border-b border-[#ffa502]/20 text-xs">
          <span className="text-[#ffa502] font-mono font-bold">ST MODE</span>
          <span className="text-[#4a6080]">·</span>
          <span className="text-[#4a6080]">exits on trend reversal only · no ATR stop / target / max days</span>
          <button
            onClick={() => setStrategy("score")}
            className="ml-auto text-[#4a6080] hover:text-[#ffa502] transition-colors"
            title="Switch back to Score strategy"
          >
            ← Score
          </button>
        </div>
      )}

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isError ? (
          <div className="p-4 text-[#ff4757] text-xs">{result.error ?? "Error fetching data"}</div>
        ) : (
          <>
            {tab === "CHART"       && <ChartTab       result={result} />}
            {tab === "OVERVIEW"    && <OverviewTab    result={activeResult} />}
            {tab === "BACKTEST"    && <BacktestTab    result={activeResult} />}
            {tab === "MONTE CARLO" && <MonteCarloTab  result={
              strategy === "supertrend" && hasST && result.st_monte_carlo
                ? { ...activeResult, monte_carlo: result.st_monte_carlo }
                : activeResult
            } />}
            {tab === "PLAN"        && <TradingPlanTab result={activeResult} />}
          </>
        )}
      </div>
    </div>
  );
}

