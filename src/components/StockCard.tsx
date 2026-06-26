"use client";
import { useState, useEffect } from "react";
import { StockAnalysisResult, AppConfig, CandlestickPattern, BacktestResult, TimesfmPriceTargets, ForecastSkill } from "@/types";
import { regimeColor } from "@/lib/regime";
import { kronosRow, naiveRow, convictionFlags, skillBadge } from "@/lib/forecastBox";
import OverviewTab    from "./tabs/OverviewTab";
import BacktestTab   from "./tabs/BacktestTab";
import MonteCarloTab from "./tabs/MonteCarloTab";
import TradingPlanTab from "./tabs/TradingPlanTab";
import ChartTab      from "./tabs/ChartTab";
import FundamentalReport from "./FundamentalReport";

interface Props {
  result: StockAnalysisResult;
  config: AppConfig;
  timesfm?: TimesfmPriceTargets;
  kronos?: import("@/types").KronosForecast;
  forecastSkill?: ForecastSkill | null;
  forcedTab?: Tab;
}

type Strategy = "score" | "supertrend";
export const TABS = ["OVERVIEW", "CHART", "BACKTEST", "MONTE CARLO", "PLAN", "FUNDAMENTAL"] as const;
export type Tab = (typeof TABS)[number];

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

function buildSTView(result: StockAnalysisResult): StockAnalysisResult {
  // ... (unchanged – same as original)
  const cmp = result.comparison;
  if (!cmp) return result;

  const stMetrics = cmp.supertrend;
  const scoreBt = result.backtest;
  if (!scoreBt) return result;

  const initialCapital = scoreBt.equity_curve[0] ?? 10000;
  const stEquityCurve: number[] = [initialCapital];
  const stEquityDates: string[] = [scoreBt.equity_dates[0] ?? ""];
  let runningEq = initialCapital;
  const sortedTrades = [...stMetrics.trades].sort((a, b) => a.entry_idx - b.entry_idx);
  for (const t of sortedTrades) {
    const barsBefore = Math.max(0, t.entry_idx - stEquityCurve.length + 1);
    for (let b = 0; b < barsBefore; b++) stEquityCurve.push(runningEq);
    const pnl = t.pnl;
    const barsHeld = Math.max(1, t.bars_held);
    for (let b = 0; b < barsHeld; b++) {
      stEquityCurve.push(runningEq + (pnl * (b + 1)) / barsHeld);
    }
    runningEq += pnl;
  }
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


export default function StockCard({ result, config, timesfm, kronos, forecastSkill, forcedTab }: Props) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [strategy, setStrategy] = useState<Strategy>("score");

  // When a global tab override is broadcast, snap all cards to that tab.
  // The user can still click any individual tab afterward to navigate freely.
  useEffect(() => {
    if (forcedTab) setTab(forcedTab);
  }, [forcedTab]);

  const bt = result.backtest;
  const isError = result.signal === "ERROR";
  const hasST = !!result.comparison;

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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#00d4ff] font-bold text-sm">{result.symbol}</span>
            <span className="text-[#4a6080] text-xs">{result.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${signalBadge(result.signal)}`}>
              {result.signal}
            </span>
            <span className={`text-xs px-1 py-0.5 rounded border font-mono ${
              stDir === 1
                ? "border-[#00ff88]/30 text-[#00ff88] bg-[#00ff88]/5"
                : "border-[#ff4757]/30 text-[#ff4757] bg-[#ff4757]/5"
            }`}>
              {stDir === 1 ? "🟢 ST" : "🔴 ST"}
            </span>
            {result.sepa_metadata && (() => {
              const s = result.sepa_metadata;
              const pip = (active: boolean | null, label: string) => {
                if (active === null) return (
                  <span key={label} className="text-[0.6rem] px-1 py-0.5 rounded border text-[#2a3d5a] border-[#2a3d5a]/20 opacity-30">—</span>
                );
                return (
                  <span key={label}
                    className={`text-[0.6rem] font-bold px-1 py-0.5 rounded border
                      ${active
                        ? "text-[#00ff88] border-[#00ff88]/40 bg-[#00ff88]/8"
                        : "text-[#2a3d5a] border-[#2a3d5a]/30 opacity-40"}`}>
                    {label}
                  </span>
                );
              };
              return (
                <span className="flex items-center gap-0.5 border border-[#1e2d4a] rounded px-1 py-0.5"
                  title={(() => {
                const tt = s.trend_template_criteria;
                const ttStr = tt
                  ? `TT:${tt.criteria_met}/7${!tt.passes ? ` (fails: ${[
                      !tt.c1_price_above_sma150    && "SMA150",
                      !tt.c2_price_above_sma200    && "SMA200",
                      !tt.c3_sma150_above_sma200   && "SMA150>200",
                      !tt.c4_sma200_trending_up    && "SMA200↓",
                      !tt.c5_price_above_sma50     && "SMA50",
                      !tt.c6_above_25pct_of_low52  && "52wkLow",
                      !tt.c7_within_25pct_of_high52 && "52wkHigh",
                    ].filter(Boolean).join(", ")})` : ""}`
                  : `TT:${s.trend_template}`;
                return `SEPA ${s.sepa_score}/3 · ${ttStr} · 33:${s.code_33} · VCP:${s.vcp_detected}${s.vcp_detected ? ` (${s.current_contraction_pct.toFixed(1)}%)` : ""}`;
              })()}>
                  {pip(s.trend_template, "T")}
                  {pip(s.code_33, "33")}
                  {pip(s.vcp_detected, "VCP")}
                </span>
              );
            })()}
          </div>
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
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded border ${regimeColor(result.regime ?? "")}`}>
              {(result.regime ?? "UNKNOWN").replace(/_/g, " ")}
            </span>
            {bt?.candlestick_patterns?.map((p) => patternBadge(p))}
          </div>
        </div>

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
            {tab === "CHART"       && <ChartTab       result={result} config={config} timesfm={timesfm} kronos={kronos} />}
            {tab === "OVERVIEW"    && <OverviewTab    result={activeResult} />}
            {tab === "BACKTEST"    && <BacktestTab    result={activeResult} />}
            {tab === "MONTE CARLO" && <MonteCarloTab  result={
              strategy === "supertrend" && hasST && result.st_monte_carlo
                ? { ...activeResult, monte_carlo: result.st_monte_carlo }
                : activeResult
            } />}
            {tab === "PLAN"        && <TradingPlanTab result={activeResult} />}
            {tab === "FUNDAMENTAL" && <FundamentalReport ticker={result.symbol} />}
          </>
        )}
      </div>

      {/* ── KRONOS PREDICTION (5d-primary, display-only) ── */}
      {kronos && (() => {
        const kRow = kronosRow(kronos);
        const c5d = kRow?.cells[0] ?? null;
        const c10d = kRow?.cells[1] ?? null;
        const c20d = kRow?.cells[2] ?? null;
        const relMae = kronos.historical?.mae != null && kronos.last_price > 0
          ? (kronos.historical.mae / kronos.last_price) * 100
          : null;
        const flags = convictionFlags(c5d, relMae);
        const closes = result.chart_bars?.map(b => b.close);
        const nRow = naiveRow(closes);
        const naive5d = nRow?.cells[0] ?? null;
        const badge = skillBadge(forecastSkill?.KRONOS ?? null, forecastSkill?.NAIVE ?? null);
        const badgeCls =
          badge.tone === "edge"   ? "text-[#00ff88] border-[#00ff88]/40 bg-[#00ff88]/10" :
                                    "text-[#4a6080] border-[#1e2d4a] bg-[#0c1322]";
        return (
          <div className="mx-3 mb-3 border border-[#ff8c42]/40 rounded p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[#ff8c42] font-bold flex items-center gap-1.5">
                🔮 KRONOS PREDICTION
                {flags.high && <span className="text-[#00ff88]" title="High conviction (|5d| &gt; 5%)">✦</span>}
                {flags.unreliable && <span className="text-[#ffa502]" title="High recent MAE — low reliability">⚠</span>}
              </div>
            </div>
            {/* Hero 5d cell */}
            <div className="text-center bg-[#0f1629] rounded p-3 mb-2">
              <div className="text-[#4a6080] text-[0.6rem]">5d</div>
              {c5d ? (
                <>
                  <div className="text-white font-bold text-lg font-mono">{c5d.price.toFixed(2)}</div>
                  <div className={`font-mono ${c5d.pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {c5d.pct >= 0 ? "+" : ""}{c5d.pct.toFixed(1)}%
                  </div>
                </>
              ) : (
                <div className="text-[#3a4a64]">—</div>
              )}
              {/* Naive 5d benchmark */}
              {naive5d && (
                <div className="text-[#4a6080] text-[0.6rem] font-mono mt-1">
                  naive {naive5d.pct >= 0 ? "+" : ""}{naive5d.pct.toFixed(1)}%
                </div>
              )}
            </div>
            {/* Secondary 10d / 20d */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              {[{ lbl: "10d", c: c10d }, { lbl: "20d", c: c20d }].map(({ lbl, c }) => (
                <div key={lbl} className="text-center bg-[#0c1322] rounded p-2">
                  <div className="text-[#3a4a64] text-[0.55rem]">{lbl}</div>
                  {c ? (
                    <>
                      <div className="text-[#6b85a0] font-mono text-[0.7rem]">{c.price.toFixed(2)}</div>
                      <div className={`text-[0.65rem] font-mono ${c.pct >= 0 ? "text-green-400/60" : "text-red-400/60"}`}>
                        {c.pct >= 0 ? "+" : ""}{c.pct.toFixed(1)}%
                      </div>
                    </>
                  ) : (
                    <div className="text-[#3a4a64] text-[0.7rem]">—</div>
                  )}
                </div>
              ))}
            </div>
            {/* Skill badge */}
            <div className={`text-[0.6rem] font-mono px-2 py-1 rounded border ${badgeCls}`}>
              <span>{badge.tone === "edge" ? "⚡ " : ""}{badge.label}</span>
              {badge.detail && <span className="text-[#4a6080] ml-1">· {badge.detail}</span>}
            </div>
          </div>
        );
      })()}

    </div>
  );
}
