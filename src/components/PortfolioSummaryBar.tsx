"use client";
import { useState, useCallback } from "react";
import { StockAnalysisResult } from "@/types";

interface Props {
  results: StockAnalysisResult[];
  onRowClick: (symbol: string) => void;
}

function grade(score: number): { label: string; color: string } {
  if (score >= 8.0) return { label: "A+", color: "text-[#00ff88] font-bold" };
  if (score >= 7.0) return { label: "A",  color: "text-[#00ff88] font-bold" };
  if (score >= 6.0) return { label: "B",  color: "text-[#00d4ff] font-bold" };
  if (score >= 5.0) return { label: "C",  color: "text-[#ffa502]" };
  if (score >= 4.0) return { label: "D",  color: "text-[#ff7f50]" };
  return { label: "F", color: "text-[#ff4757]" };
}

function regimeCell(regime: string): { icon: string; short: string; color: string } {
  const r = regime ?? "UNKNOWN";
  const G = "text-[#00ff88]", R = "text-[#ff4757]", A = "text-[#ffa502]",
        C = "text-[#00d4ff]", D = "text-[#c8d8f0]";
  if (r === "STRONG_UPTREND")               return { icon: "🚀",   short: "Strong UP",    color: G };
  if (r === "STRONG_DOWNTREND")             return { icon: "💣",   short: "Strong DN",    color: R };
  if (r === "STRENGTHENING_UPTREND")        return { icon: "↗↗",  short: "Str'ing UP",   color: G };
  if (r === "STRENGTHENING_DOWNTREND")      return { icon: "↓↓",  short: "Str'ing DN",   color: R };
  if (r === "WEAKENING_UPTREND")            return { icon: "↗↘",  short: "Weakening UP", color: A };
  if (r === "WEAKENING_DOWNTREND")          return { icon: "↘↘",  short: "Weakening DN", color: R };
  if (r === "EXHAUSTING_UPTREND")           return { icon: "🔥↗", short: "Exhaust UP",   color: A };
  if (r === "EXHAUSTING_DOWNTREND")         return { icon: "🔥↓", short: "Exhaust DN",   color: R };
  if (r === "UPTREND")                      return { icon: "↗",   short: "Uptrend",      color: G };
  if (r === "DOWNTREND")                    return { icon: "↓",   short: "Downtrend",    color: R };
  if (r === "WEAK_UPTREND")                 return { icon: "↗",   short: "Weak UP",      color: G };
  if (r === "WEAK_DOWNTREND")               return { icon: "↘",   short: "Weak DN",      color: R };
  if (r === "WEAK_UPTREND_STRENGTHENING")   return { icon: "↗↑",  short: "Wk UP↑",       color: G };
  if (r === "WEAK_DOWNTREND_STRENGTHENING") return { icon: "↘↑",  short: "Wk DN↑",       color: A };
  if (r === "WEAK_UPTREND_WEAKENING")       return { icon: "↗↘",  short: "Wk UP↓",       color: A };
  if (r === "WEAK_DOWNTREND_WEAKENING")     return { icon: "↓↓",  short: "Wk DN↓",       color: R };
  if (r === "BEAR_RALLY")                   return { icon: "📉↑", short: "Bear Rally",    color: A };
  if (r === "WEAK_BEAR_RALLY")              return { icon: "📉",  short: "Wk Bear Rly",  color: A };
  if (r === "RANGING")                      return { icon: "↔",   short: "Ranging",       color: C };
  if (r === "OVERBOUGHT")                   return { icon: "🔴",  short: "Overbought",    color: A };
  if (r === "OVERSOLD")                     return { icon: "🟢",  short: "Oversold",      color: G };
  if (r === "NEUTRAL")                      return { icon: "—",   short: "Neutral",       color: D };
  if (r.startsWith("HIGH_VOL_") && r.includes("UPTREND")) return { icon: "🚀⚡", short: "HV UP", color: G };
  if (r.startsWith("HIGH_VOL_"))            return { icon: "⚡",  short: "High Vol", color: A };
  if (r.startsWith("EXTREME_VOL"))          return { icon: "⚡⚡", short: "Extr Vol", color: R };
  return { icon: "—", short: r.replace(/_/g, " ").slice(0, 12), color: D };
}

function signalBadge(s: string) {
  if (s === "BUY")  return <span className="badge-buy  px-1.5 py-0.5 rounded text-xs font-bold">BUY</span>;
  if (s === "SELL") return <span className="badge-sell px-1.5 py-0.5 rounded text-xs font-bold">SELL</span>;
  return                   <span className="badge-hold px-1.5 py-0.5 rounded text-xs">HOLD</span>;
}

const n  = (v: number | null | undefined, d = 1, sfx = "") =>
  v == null || isNaN(Number(v)) ? "—" : `${Number(v).toFixed(d)}${sfx}`;
const sn = (v: number | null | undefined, d = 1, sfx = "") =>
  v == null || isNaN(Number(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}${sfx}`;
const numColor = (v: number | null | undefined, good = 0) =>
  v == null || isNaN(Number(v)) ? "text-[#4a6080]" : Number(v) >= good ? "text-[#00ff88]" : "text-[#ff4757]";

// ── Column definitions ────────────────────────────────────────
// SC columns: blue (#00d4ff)   ST columns: orange (#ffa502)
type ColKey =
  | "symbol" | "price" | "change_pct" | "regime" | "grade" | "score"
  | "signal" | "st_status" | "rsi" | "macd_hist"
  | "sc_500d" | "st_500d" | "sc_250d" | "st_250d"
  | "sc_sharpe" | "sc_alpha" | "st_sharpe" | "st_alpha";

interface ColDef {
  key: ColKey;
  label: string;
  labelColor?: string;   // header color override
  align: "left" | "right" | "center";
  sortVal: (r: StockAnalysisResult) => number;
}

// SC = blue, ST = orange
const SC_HDR = "text-[#00d4ff]";
const ST_HDR = "text-[#ffa502]";

const COLS: ColDef[] = [
  { key: "symbol",     label: "Ticker",     align: "left",   sortVal: r => r.symbol.charCodeAt(0) },
  { key: "price",      label: "Price",      align: "right",  sortVal: r => r.current_price },
  { key: "change_pct", label: "Chg%",      align: "right",  sortVal: r => r.change_pct ?? 0 },
  { key: "regime",     label: "Regime",     align: "left",   sortVal: r => r.regime?.charCodeAt(0) ?? 0 },
  { key: "grade",      label: "Grd",        align: "center", sortVal: r => r.score ?? 0 },
  { key: "score",      label: "Score",      align: "right",  sortVal: r => r.score ?? 0 },
  { key: "signal",     label: "Signal",     align: "center", sortVal: r => r.signal === "BUY" ? 2 : r.signal === "HOLD" ? 1 : 0 },
  { key: "st_status",  label: "ST",         align: "center", sortVal: r => (r.st_direction ?? -1) === 1 ? 1 : 0 },
  { key: "rsi",        label: "RSI",        align: "right",  sortVal: r => r.backtest?.rsi ?? 0 },
  { key: "macd_hist",  label: "MACD H",     align: "right",  sortVal: r => r.backtest?.macd_hist ?? 0 },
  { key: "sc_500d",    label: "SC 500d%",   labelColor: SC_HDR, align: "right",  sortVal: r => r.backtest?.total_return_500d ?? 0 },
  { key: "st_500d",    label: "ST 500d%",   labelColor: ST_HDR, align: "right",  sortVal: r => r.comparison?.supertrend.total_return_500d ?? 0 },
  { key: "sc_250d",    label: "SC 250d%",   labelColor: SC_HDR, align: "right",  sortVal: r => r.backtest?.total_return_250d ?? 0 },
  { key: "st_250d",    label: "ST 250d%",   labelColor: ST_HDR, align: "right",  sortVal: r => r.comparison?.supertrend.total_return_250d ?? 0 },
  { key: "sc_sharpe",  label: "SC Sharpe",  labelColor: SC_HDR, align: "right",  sortVal: r => r.backtest?.sharpe ?? 0 },
  { key: "sc_alpha",   label: "SC Alpha",   labelColor: SC_HDR, align: "right",  sortVal: r => r.backtest?.alpha ?? 0 },
  { key: "st_sharpe",  label: "ST Sharpe",  labelColor: ST_HDR, align: "right",  sortVal: r => r.comparison?.supertrend.sharpe ?? 0 },
  { key: "st_alpha",   label: "ST Alpha",   labelColor: ST_HDR, align: "right",  sortVal: r => r.comparison?.supertrend.alpha ?? 0 },
];

export default function PortfolioSummaryBar({ results, onRowClick }: Props) {
  const [sortKey, setSortKey] = useState<ColKey>("signal");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [flashSymbol, setFlashSymbol] = useState<string | null>(null);

  const handleSort = useCallback((key: ColKey) => {
    if (sortKey === key) setSortDir(d => (d === -1 ? 1 : -1));
    else { setSortKey(key); setSortDir(-1); }
  }, [sortKey]);

  const handleRowClick = useCallback((symbol: string) => {
    setFlashSymbol(symbol);
    setTimeout(() => setFlashSymbol(null), 600);
    onRowClick(symbol);
  }, [onRowClick]);

  if (results.length === 0) return null;

  const col    = COLS.find(c => c.key === sortKey)!;
  const sorted = [...results].sort((a, b) => sortDir * (col.sortVal(b) - col.sortVal(a)));

  // SC aggregates
  const buy      = results.filter(r => r.signal === "BUY").length;
  const sell     = results.filter(r => r.signal === "SELL").length;
  const hold     = results.filter(r => r.signal === "HOLD").length;
  const withBt   = results.filter(r => (r.backtest?.num_trades ?? 0) > 0);
  const avgSharpe  = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.sharpe ?? 0), 0) / withBt.length : 0;
  const avgWinRate = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.win_rate ?? 0), 0) / withBt.length : 0;
  const avgAlpha   = results.length ? results.reduce((a, r) => a + (r.backtest?.alpha ?? 0), 0) / results.length : 0;
  const avgSc500d  = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.total_return_500d ?? 0), 0) / withBt.length : 0;
  const avgSc250d  = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.total_return_250d ?? 0), 0) / withBt.length : 0;

  // ST aggregates
  const stBull     = results.filter(r => (r.st_direction ?? -1) === 1).length;
  const stBear     = results.filter(r => (r.st_direction ?? -1) === -1).length;
  const withST     = results.filter(r => (r.comparison?.supertrend.num_trades ?? 0) > 0);
  const avgST500d  = withST.length ? withST.reduce((a, r) => a + (r.comparison?.supertrend.total_return_500d ?? 0), 0) / withST.length : 0;
  const avgST250d  = withST.length ? withST.reduce((a, r) => a + (r.comparison?.supertrend.total_return_250d ?? 0), 0) / withST.length : 0;
  const avgSTSharpe = withST.length ? withST.reduce((a, r) => a + (r.comparison?.supertrend.sharpe ?? 0), 0) / withST.length : 0;
  const avgSTAlpha  = withST.length ? withST.reduce((a, r) => a + (r.comparison?.supertrend.alpha ?? 0), 0) / withST.length : 0;
  const avgSTWin    = withST.length ? withST.reduce((a, r) => a + (r.comparison?.supertrend.win_rate ?? 0), 0) / withST.length : 0;

  const SortTh = ({ col: c }: { col: ColDef }) => {
    const active = sortKey === c.key;
    // Use labelColor if set, else default dim color; active overrides to bright version
    const baseColor = c.labelColor ?? "text-[#4a6080]";
    const activeColor = c.labelColor ?? "text-[#00d4ff]";
    return (
      <th
        onClick={() => handleSort(c.key)}
        className={`px-2 py-1.5 font-mono font-normal whitespace-nowrap cursor-pointer select-none
          ${c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : "text-left"}
          transition-colors hover:opacity-100
          ${active ? `${activeColor} opacity-100` : `${baseColor} opacity-70 hover:opacity-90`}`}
      >
        {c.label}
        <span className="ml-0.5 text-[0.6rem]">
          {active ? (sortDir === -1 ? "▼" : "▲") : "⇅"}
        </span>
      </th>
    );
  };

  return (
    <div className="mx-4 my-3">
      {/* Header strip */}
      <div className="mb-2 space-y-1">
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-[#00d4ff] font-bold tracking-widest">◈ SCORE</span>
          <span>
            {buy  > 0 && <span className="text-[#00ff88] font-bold mr-2">▲{buy} BUY</span>}
            {sell > 0 && <span className="text-[#ff4757] font-bold mr-2">▼{sell} SELL</span>}
            {hold > 0 && <span className="text-[#ffa502]">◆{hold} HOLD</span>}
          </span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080]">500d <span className={numColor(avgSc500d, 0)}>{sn(avgSc500d, 1, "%")}</span></span>
          <span className="text-[#4a6080]">250d <span className={numColor(avgSc250d, 0)}>{sn(avgSc250d, 1, "%")}</span></span>
          <span className="text-[#4a6080]">SC Sharpe <span className={numColor(avgSharpe, 0.5)}>{avgSharpe.toFixed(2)}</span></span>
          <span className="text-[#4a6080]">Win% <span className={numColor(avgWinRate, 50)}>{avgWinRate.toFixed(0)}%</span></span>
          <span className="text-[#4a6080]">SC α <span className={numColor(avgAlpha, 0)}>{sn(avgAlpha, 1, "%")}</span></span>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-[#ffa502] font-bold tracking-widest">◈ ST</span>
          <span>
            <span className="text-[#00ff88] font-bold mr-2">🟢{stBull} BULL</span>
            <span className="text-[#ff4757]">🔴{stBear} BEAR</span>
          </span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080]">500d <span className={numColor(avgST500d, 0)}>{sn(avgST500d, 1, "%")}</span></span>
          <span className="text-[#4a6080]">250d <span className={numColor(avgST250d, 0)}>{sn(avgST250d, 1, "%")}</span></span>
          <span className="text-[#4a6080]">ST Sharpe <span className={numColor(avgSTSharpe, 0.5)}>{avgSTSharpe.toFixed(2)}</span></span>
          <span className="text-[#4a6080]">Win% <span className={numColor(avgSTWin, 50)}>{avgSTWin.toFixed(0)}%</span></span>
          <span className="text-[#4a6080]">ST α <span className={numColor(avgSTAlpha, 0)}>{sn(avgSTAlpha, 1, "%")}</span></span>
          <span className="text-[#4a6080] text-[0.65rem] ml-auto">↕ Click header to sort &nbsp;·&nbsp; ↵ Click row to jump</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-[#1e2d4a]">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="bg-[#0f1629] border-b border-[#1e2d4a] uppercase tracking-wider">
              {COLS.map(c => <SortTh key={c.key} col={c} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const bt  = r.backtest;
              const cmp = r.comparison;
              const rl  = regimeCell(r.regime);
              const g   = grade(r.score ?? 0);
              const rsi = bt?.rsi ?? 50;
              const rsiC = rsi < 30 ? "text-[#00ff88]" : rsi > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]";
              const chg  = r.change_pct ?? 0;
              const isFlashing = flashSymbol === r.symbol;

              return (
                <tr
                  key={r.symbol}
                  onClick={() => handleRowClick(r.symbol)}
                  title={`Click to jump to ${r.symbol} card`}
                  className={`border-b border-[#1e2d4a]/40 cursor-pointer select-none transition-all
                    ${isFlashing ? "bg-[#00d4ff]/20 border-[#00d4ff]/40"
                      : idx % 2 === 0 ? "bg-[#0a0e1a] hover:bg-[#00d4ff]/8 active:bg-[#00d4ff]/20"
                      : "bg-[#0f1629] hover:bg-[#00d4ff]/8 active:bg-[#00d4ff]/20"}`}
                >
                  {/* Ticker */}
                  <td className="px-2 py-1.5">
                    <div className="text-[#00d4ff] font-bold leading-tight">{r.symbol}</div>
                    <div className="text-[#4a6080] text-[0.6rem] leading-tight truncate max-w-[80px]">{r.name}</div>
                  </td>
                  {/* Price */}
                  <td className="px-2 py-1.5 text-right font-mono text-[#c8d8f0] whitespace-nowrap">
                    {r.current_price > 0 ? r.current_price.toFixed(2) : "—"}
                  </td>
                  {/* Chg% */}
                  <td className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${numColor(chg, 0)}`}>
                    {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%
                  </td>
                  {/* Regime */}
                  <td className={`px-2 py-1.5 whitespace-nowrap ${rl.color}`}>
                    <span className="mr-1">{rl.icon}</span>{rl.short}
                  </td>
                  {/* Grade */}
                  <td className={`px-2 py-1.5 text-center text-sm ${g.color}`}>{g.label}</td>
                  {/* Score */}
                  <td className={`px-2 py-1.5 text-right font-mono font-bold ${(r.score ?? 0) >= 6.5 ? "text-[#00ff88]" : (r.score ?? 0) >= 5.5 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
                    {r.score?.toFixed(1) ?? "—"}
                  </td>
                  {/* Signal */}
                  <td className="px-2 py-1.5 text-center">{signalBadge(r.signal)}</td>
                  {/* ST Status */}
                  <td className="px-2 py-1.5 text-center font-mono text-xs whitespace-nowrap">
                    {(() => {
                      const dir = r.st_direction ?? -1;
                      const dist = r.st_stop_distance_pct ?? 0;
                      const openRet = r.st_open_return_pct;
                      if (dir !== 1) return <span className="text-[#ff4757]" title="ST Bearish">🔴</span>;
                      if (openRet !== null && openRet !== undefined) {
                        const retColor = openRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]";
                        return (
                          <span title={`Open: ${openRet>=0?"+":""}${openRet.toFixed(1)}% · Stop dist: ${dist.toFixed(1)}%`}>
                            <span className="text-[#00ff88]">🟢 </span>
                            <span className={`font-bold ${retColor}`}>{openRet >= 0 ? "+" : ""}{openRet.toFixed(1)}%</span>
                            <span className="text-[#2a3d5a]"> ·</span>
                            <span className="text-[#4a6080]"> {dist.toFixed(1)}%</span>
                          </span>
                        );
                      }
                      return (
                        <span title={`ST Bullish, no position · Stop dist: ${dist.toFixed(1)}%`}>
                          <span className="text-[#00ff88]">🟢 </span>
                          <span className="text-[#4a6080] italic">{dist.toFixed(1)}%↑</span>
                        </span>
                      );
                    })()}
                  </td>
                  {/* RSI */}
                  <td className={`px-2 py-1.5 text-right font-mono ${rsiC}`}>{n(rsi, 0)}</td>
                  {/* MACD Hist */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.macd_hist, 0)}`}>{n(bt?.macd_hist, 3)}</td>
                  {/* SC 500d% */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.total_return_500d, 0)}`}>
                    {bt?.total_return_500d != null ? sn(bt.total_return_500d, 1, "%") : "—"}
                  </td>
                  {/* ST 500d% */}
                  {(() => {
                    const v = cmp?.supertrend.total_return_500d;
                    return <td className={`px-2 py-1.5 text-right font-mono ${v == null ? "text-[#4a6080]" : numColor(v, 0)}`}>{v != null ? sn(v, 1, "%") : "—"}</td>;
                  })()}
                  {/* SC 250d% */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.total_return_250d, 0)}`}>
                    {bt?.total_return_250d != null ? sn(bt.total_return_250d, 1, "%") : "—"}
                  </td>
                  {/* ST 250d% */}
                  {(() => {
                    const v = cmp?.supertrend.total_return_250d;
                    return <td className={`px-2 py-1.5 text-right font-mono ${v == null ? "text-[#4a6080]" : numColor(v, 0)}`}>{v != null ? sn(v, 1, "%") : "—"}</td>;
                  })()}
                  {/* SC Sharpe */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.sharpe, 0.5)}`}>{n(bt?.sharpe, 2)}</td>
                  {/* SC Alpha */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.alpha, 0)}`}>{sn(bt?.alpha, 1, "%")}</td>
                  {/* ST Sharpe */}
                  {(() => {
                    const v = cmp?.supertrend.sharpe;
                    return <td className={`px-2 py-1.5 text-right font-mono ${v == null ? "text-[#4a6080]" : numColor(v, 0.5)}`}>{v != null ? n(v, 2) : "—"}</td>;
                  })()}
                  {/* ST Alpha */}
                  {(() => {
                    const v = cmp?.supertrend.alpha;
                    return <td className={`px-2 py-1.5 text-right font-mono ${v == null ? "text-[#4a6080]" : numColor(v, 0)}`}>{v != null ? sn(v, 1, "%") : "—"}</td>;
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
