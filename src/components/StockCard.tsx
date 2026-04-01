"use client";
import { useState } from "react";
import { StockAnalysisResult, AppConfig, CandlestickPattern } from "@/types";
import { regimeColor } from "@/lib/regime";
import OverviewTab from "./tabs/OverviewTab";
import BacktestTab from "./tabs/BacktestTab";
import MonteCarloTab from "./tabs/MonteCarloTab";
import TradesTab from "./tabs/TradesTab";
import TradingPlanTab from "./tabs/TradingPlanTab";

interface Props {
  result: StockAnalysisResult;
  config: AppConfig;
}

const TABS = ["OVERVIEW", "BACKTEST", "MONTE CARLO", "TRADES", "PLAN"] as const;
type Tab = (typeof TABS)[number];

function signalBadge(signal: string) {
  if (signal === "BUY") return "badge-buy";
  if (signal === "SELL") return "badge-sell";
  return "badge-hold";
}

function patternBadge(p: CandlestickPattern) {
  const color =
    p.sentiment === "bullish" ? "text-[#00ff88] border-[#00ff88]/30" :
    p.sentiment === "bearish" ? "text-[#ff4757] border-[#ff4757]/30" :
    "text-[#ffa502] border-[#ffa502]/30";
  return (
    <span key={p.pattern} className={`text-xs border rounded px-1.5 py-0.5 bg-black/30 ${color}`}>
      {p.pattern} {p.label !== "Latest" ? p.label : ""}
    </span>
  );
}

export default function StockCard({ result, config }: Props) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const bt = result.backtest;
  const isError = result.signal === "ERROR";

  const priceFmt = (p: number) => {
    if (!p || p === 0) return "—";
    return result.exchange === "HK" ? `HK$${p.toFixed(2)}` : `$${p.toFixed(2)}`;
  };

  return (
    <div className="card flex flex-col">
      {/* ── CARD HEADER ── */}
      <div className="p-3 border-b border-[#1e2d4a] flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Symbol + name + price */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#00d4ff] font-bold text-sm">{result.symbol}</span>
            <span className="text-[#4a6080] text-xs">{result.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${signalBadge(result.signal)}`}>
              {result.signal}
            </span>
          </div>
          {/* Price line */}
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[#c8d8f0] text-sm font-bold">{priceFmt(result.current_price)}</span>
            <span className={`text-xs ${result.change_pct >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
              {result.change_pct >= 0 ? "+" : ""}{result.change_pct?.toFixed(2)}%
            </span>
            {/* Score */}
            <span className={`text-xs font-bold ${result.score >= 6.5 ? "text-[#00ff88]" : result.score >= 5 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
              SCORE: {result.score?.toFixed(1)}
            </span>
            <span className="text-[#4a6080] text-xs">
              CONF: {result.confidence?.toFixed(0)}%
            </span>
          </div>
          {/* Regime + patterns */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded border ${regimeColor(result.regime)}`}>
              {result.regime?.replace(/_/g, " ")}
            </span>
            {result.backtest?.candlestick_patterns?.map((p) => patternBadge(p))}
          </div>
        </div>

        {/* Mini score gauge */}
        <div className="flex flex-col items-center shrink-0">
          <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center"
            style={{ borderColor: result.score >= 6.5 ? "#00ff88" : result.score >= 5 ? "#ffa502" : "#ff4757" }}>
            <span className="text-xs font-bold" style={{ color: result.score >= 6.5 ? "#00ff88" : result.score >= 5 ? "#ffa502" : "#ff4757" }}>
              {result.score?.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="flex border-b border-[#1e2d4a]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-xs transition-all ${
              tab === t
                ? "text-[#00d4ff] border-b-2 border-[#00d4ff] bg-[#00d4ff]/5"
                : "text-[#4a6080] hover:text-[#6b85a0]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-auto">
        {isError ? (
          <div className="p-4 text-[#ff4757] text-xs">{result.error ?? "Error fetching data"}</div>
        ) : (
          <>
            {tab === "OVERVIEW" && <OverviewTab result={result} />}
            {tab === "BACKTEST" && <BacktestTab result={result} />}
            {tab === "MONTE CARLO" && <MonteCarloTab result={result} />}
            {tab === "TRADES" && <TradesTab result={result} />}
            {tab === "PLAN" && <TradingPlanTab result={result} />}
          </>
        )}
      </div>
    </div>
  );
}
