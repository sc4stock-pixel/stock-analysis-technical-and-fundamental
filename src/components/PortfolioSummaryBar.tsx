"use client";
import { useState, useCallback } from "react";
import { StockAnalysisResult } from "@/types";

interface Props {
  results: StockAnalysisResult[];
  onSymbolClick?: (symbol: string) => void;
}

// ── Grade: A+=8+  A=7+  B=6+  C=5+  D=4+  F=below
function grade(score: number): { label: string; color: string } {
  if (score >= 8.0) return { label: "A+", color: "text-[#00ff88] font-bold" };
  if (score >= 7.0) return { label: "A",  color: "text-[#00ff88] font-bold" };
  if (score >= 6.0) return { label: "B",  color: "text-[#00d4ff] font-bold" };
  if (score >= 5.0) return { label: "C",  color: "text-[#ffa502]" };
  if (score >= 4.0) return { label: "D",  color: "text-[#ff7f50]" };
  return { label: "F", color: "text-[#ff4757]" };
}

// ── Regime: icon + short label + colour class
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
  if (r.startsWith("HIGH_VOL_") && r.includes("UPTREND"))
    return { icon: "🚀⚡", short: "HV UP", color: G };
  if (r.startsWith("HIGH_VOL_"))
    return { icon: "⚡",  short: "High Vol", color: A };
  if (r.startsWith("EXTREME_VOL"))
    return { icon: "⚡⚡", short: "Extr Vol", color: R };
  return { icon: "—", short: r.replace(/_/g, " ").slice(0, 12), color: D };
}

function signalBadge(s: string) {
  if (s === "BUY")  return <span className="badge-buy  px-1.5 py-0.5 rounded text-xs font-bold">BUY</span>;
  if (s === "SELL") return <span className="badge-sell px-1.5 py-0.5 rounded text-xs font-bold">SELL</span>;
  return                   <span className="badge-hold px-1.5 py-0.5 rounded text-xs">HOLD</span>;
}

const n  = (v: number | null | undefined, d = 1, sfx = "") =>
  v == null || isNaN(Number(v)) ? "—" : `${Number(v).toFixed(d)}${sfx}`;
function ratingColor(r: string | null | undefined): string {
  if (!r) return "text-[#4a6080]";
  const l = r.toLowerCase();
  if (l.includes("strong buy")) return "text-[#00ff88] font-bold";
  if (l.includes("buy"))        return "text-[#00d4ff]";
  if (l.includes("hold"))       return "text-[#ffa502]";
  return "text-[#ff4757]";
}

const sn = (v: number | null | undefined, d = 1, sfx = "") =>
  v == null || isNaN(Number(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}${sfx}`;
const numColor = (v: number | null | undefined, good = 0) =>
  v == null || isNaN(Number(v)) ? "text-[#4a6080]" : Number(v) >= good ? "text-[#00ff88]" : "text-[#ff4757]";

// ── Column definitions ─────────────────────────────────────────
type ColKey =
  | "symbol" | "price" | "change_pct" | "regime" | "grade" | "score"
  | "signal" | "rsi" | "macd_hist" | "sharpe" | "alpha" | "win_rate"
  | "calmar" | "eps_growth" | "pe" | "analyst_target";

interface ColDef {
  key: ColKey;
  label: string;
  align: "left" | "right" | "center";
  sortVal: (r: StockAnalysisResult) => number;
}

const COLS: ColDef[] = [
  { key: "symbol",        label: "Ticker",    align: "left",   sortVal: r => r.symbol.charCodeAt(0) },
  { key: "price",         label: "Price",     align: "right",  sortVal: r => r.current_price },
  { key: "change_pct",    label: "Chg%",      align: "right",  sortVal: r => r.change_pct ?? 0 },
  { key: "regime",        label: "Regime",    align: "left",   sortVal: r => r.regime?.charCodeAt(0) ?? 0 },
  { key: "grade",         label: "Grd",       align: "center", sortVal: r => r.score ?? 0 },
  { key: "score",         label: "Score",     align: "right",  sortVal: r => r.score ?? 0 },
  { key: "signal",        label: "Signal",    align: "center", sortVal: r => r.signal === "BUY" ? 2 : r.signal === "HOLD" ? 1 : 0 },
  { key: "rsi",           label: "RSI",       align: "right",  sortVal: r => r.backtest?.rsi ?? 0 },
  { key: "macd_hist",     label: "MACD H",    align: "right",  sortVal: r => r.backtest?.macd_hist ?? 0 },
  { key: "sharpe",        label: "Sharpe",    align: "right",  sortVal: r => r.backtest?.sharpe ?? 0 },
  { key: "alpha",         label: "Alpha",     align: "right",  sortVal: r => r.backtest?.alpha ?? 0 },
  { key: "win_rate",      label: "Win%",      align: "right",  sortVal: r => r.backtest?.win_rate ?? 0 },
  { key: "calmar",        label: "Calmar",    align: "right",  sortVal: r => r.backtest?.calmar_ratio ?? 0 },
  { key: "eps_growth",    label: "EPS Grw",   align: "right",  sortVal: r => r.fundamentals?.eps_growth ?? -999 },
  { key: "pe",            label: "P/E",       align: "right",  sortVal: r => r.fundamentals?.pe_ratio ?? 9999 },
  { key: "analyst_target",label: "Analyst TP",align: "right",  sortVal: r => r.fundamentals?.analyst_target ?? 0 },

];

export default function PortfolioSummaryBar({ results, onSymbolClick }: Props) {
  const [sortKey, setSortKey] = useState<ColKey>("signal");
  const [sortDir, setSortDir] = useState<1 | -1>(-1); // -1 = desc

  const handleSort = useCallback((key: ColKey) => {
    if (sortKey === key) setSortDir(d => (d === -1 ? 1 : -1));
    else { setSortKey(key); setSortDir(-1); }
  }, [sortKey]);

  if (results.length === 0) return null;

  const col = COLS.find(c => c.key === sortKey)!;
  const sorted = [...results].sort((a, b) => sortDir * (col.sortVal(b) - col.sortVal(a)));

  const buy  = results.filter(r => r.signal === "BUY").length;
  const sell = results.filter(r => r.signal === "SELL").length;
  const hold = results.filter(r => r.signal === "HOLD").length;
  const withBt = results.filter(r => (r.backtest?.num_trades ?? 0) > 0);
  const avgSharpe  = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.sharpe ?? 0), 0) / withBt.length : 0;
  const avgWinRate = withBt.length ? withBt.reduce((a, r) => a + (r.backtest?.win_rate ?? 0), 0) / withBt.length : 0;
  const avgAlpha   = results.length ? results.reduce((a, r) => a + (r.backtest?.alpha ?? 0), 0) / results.length : 0;

  const SortTh = ({ col: c }: { col: ColDef }) => {
    const active = sortKey === c.key;
    return (
      <th
        onClick={() => handleSort(c.key)}
        className={`px-2 py-1.5 font-mono font-normal whitespace-nowrap cursor-pointer select-none
          text-${c.align === "center" ? "center" : c.align}
          transition-colors hover:text-[#00d4ff]
          ${active ? "text-[#00d4ff]" : "text-[#4a6080]"}`}
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
      {/* ── Strip ── */}
      <div className="flex items-center gap-4 mb-2 text-xs flex-wrap">
        <span className="text-[#00d4ff] font-bold tracking-widest">◈ PORTFOLIO SUMMARY</span>
        <span>
          {buy  > 0 && <span className="text-[#00ff88] font-bold mr-2">▲{buy} BUY</span>}
          {sell > 0 && <span className="text-[#ff4757] font-bold mr-2">▼{sell} SELL</span>}
          {hold > 0 && <span className="text-[#ffa502]">◆{hold} HOLD</span>}
        </span>
        <span className="text-[#1e2d4a]">|</span>
        <span className="text-[#4a6080]">Sharpe <span className={numColor(avgSharpe,0.5)}>{avgSharpe.toFixed(2)}</span></span>
        <span className="text-[#4a6080]">Win% <span className={numColor(avgWinRate,50)}>{avgWinRate.toFixed(0)}%</span></span>
        <span className="text-[#4a6080]">α <span className={numColor(avgAlpha,0)}>{sn(avgAlpha,1,"%")}</span></span>
        <span className="text-[#4a6080] text-[0.65rem]">Click column header to sort · Click row to jump to stock card</span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded border border-[#1e2d4a]">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-[#0f1629] border-b border-[#1e2d4a] uppercase tracking-wider">
              {COLS.map(c => <SortTh key={c.key} col={c} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const bt   = r.backtest;
              const fund = r.fundamentals;
              const rl   = regimeCell(r.regime);
              const g    = grade(r.score ?? 0);
              const rsi  = bt?.rsi ?? 50;
              const rsiC = rsi < 30 ? "text-[#00ff88]" : rsi > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]";
              const chg  = r.change_pct ?? 0;
              const upside = fund?.analyst_target && r.current_price > 0
                ? ((fund.analyst_target - r.current_price) / r.current_price) * 100
                : null;

              return (
                <tr key={r.symbol}
                  onClick={() => onSymbolClick?.(r.symbol)}
                  className={`border-b border-[#1e2d4a]/40 transition-colors
                    ${onSymbolClick ? "cursor-pointer hover:bg-[#00d4ff]/10 active:bg-[#00d4ff]/20" : "hover:bg-[#00d4ff]/5"}
                    ${idx % 2 === 0 ? "bg-[#0a0e1a]" : "bg-[#0f1629]"}`}>

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
                  <td className={`px-2 py-1.5 text-right font-mono font-bold ${
                    (r.score??0)>=6.5?"text-[#00ff88]":(r.score??0)>=5.5?"text-[#ffa502]":"text-[#ff4757]"}`}>
                    {r.score?.toFixed(1) ?? "—"}
                  </td>

                  {/* Signal */}
                  <td className="px-2 py-1.5 text-center">{signalBadge(r.signal)}</td>

                  {/* RSI */}
                  <td className={`px-2 py-1.5 text-right font-mono ${rsiC}`}>{n(rsi, 0)}</td>

                  {/* MACD Hist */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.macd_hist, 0)}`}>
                    {n(bt?.macd_hist, 3)}
                  </td>

                  {/* Sharpe */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.sharpe, 0.5)}`}>
                    {n(bt?.sharpe, 2)}
                  </td>

                  {/* Alpha */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.alpha, 0)}`}>
                    {sn(bt?.alpha, 1, "%")}
                  </td>

                  {/* Win% */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.win_rate, 50)}`}>
                    {n(bt?.win_rate, 0, "%")}
                  </td>

                  {/* Calmar */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(bt?.calmar_ratio, 0)}`}>
                    {n(bt?.calmar_ratio, 2)}
                  </td>

                  {/* EPS Growth */}
                  <td className={`px-2 py-1.5 text-right font-mono ${numColor(fund?.eps_growth, 0)}`}>
                    {fund?.eps_growth != null ? sn(fund.eps_growth, 1, "%") : "—"}
                  </td>

                  {/* P/E */}
                  <td className="px-2 py-1.5 text-right font-mono text-[#c8d8f0]">
                    {fund?.pe_ratio != null ? n(fund.pe_ratio, 1) : "—"}
                  </td>

                  {/* Analyst Target */}
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                    {fund?.analyst_target != null ? (
                      <span>
                        <span className="text-[#c8d8f0]">{fund.analyst_target.toFixed(2)}</span>
                        {upside != null && (
                          <span className={`ml-1 text-[0.65rem] ${numColor(upside, 0)}`}>
                            {sn(upside, 0, "%")}
                          </span>
                        )}
                      </span>
                    ) : "—"}
                    {fund?.analyst_rating && (
                      <div className={`text-[0.6rem] ${ratingColor(fund.analyst_rating)}`}>
                        {fund.analyst_rating}
                      </div>
                    )}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
