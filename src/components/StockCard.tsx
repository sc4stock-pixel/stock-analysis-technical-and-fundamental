"use client";
import { useState } from "react";
import { AppConfig, StockAnalysisResult, TimesfmPriceTargets } from "@/types";
import OverviewTab from "@/components/tabs/OverviewTab";
import ChartTab from "@/components/tabs/ChartTab";
import ScoreBreakdownTab from "@/components/tabs/ScoreBreakdownTab";
import BacktestTab from "@/components/tabs/BacktestTab";
import FundamentalsTab from "@/components/tabs/FundamentalsTab";

interface Props {
  result: StockAnalysisResult;
  config: AppConfig;
  timesfm?: TimesfmPriceTargets;
}

const TABS = ["Overview", "Chart", "Score", "Backtest", "Fundamentals"] as const;
type TabName = (typeof TABS)[number];

export default function StockCard({ result, config, timesfm }: Props) {
  const [activeTab, setActiveTab] = useState<TabName>("Overview");

  const renderTab = () => {
    switch (activeTab) {
      case "Overview":
        return <OverviewTab result={result} config={config} />;
      case "Chart":
        return <ChartTab result={result} config={config} timesfm={timesfm} />;
      case "Score":
        return <ScoreBreakdownTab result={result} />;
      case "Backtest":
        return <BacktestTab result={result} />;
      case "Fundamentals":
        return <FundamentalsTab result={result} />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0a0e1a] border-b border-[#1e2d4a]">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold">{result.symbol}</span>
          <span className="text-[#4a6080] text-xs">{result.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#c8d8f0]">{result.current_price?.toFixed(2)}</span>
          <span className={result.change_pct >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
            {result.change_pct >= 0 ? "+" : ""}{result.change_pct?.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Signal / Regime row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1e2d4a]/50 text-xs">
        <span className={`px-2 py-0.5 rounded font-mono font-bold ${
          result.signal === "BUY" ? "bg-[#00ff88]/15 text-[#00ff88]" :
          result.signal === "SELL" ? "bg-[#ff4757]/15 text-[#ff4757]" :
          "bg-[#ffa502]/15 text-[#ffa502]"
        }`}>
          {result.signal}
        </span>
        <span className="text-[#4a6080]">Score: {result.score.toFixed(1)}</span>
        <span className="text-[#4a6080]">Regime: {result.regime}</span>
        {/* ST direction badge */}
        {result.st_direction !== undefined && (
          <span className={`text-xs font-mono ${result.st_direction === 1 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
            {result.st_direction === 1 ? "🟢 ST BULL" : "🔴 ST BEAR"}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1e2d4a] bg-[#0a0e1a]">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs transition-colors ${
              activeTab === tab
                ? "text-[#00d4ff] border-b-2 border-[#00d4ff]"
                : "text-[#4a6080] hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-0">{renderTab()}</div>

      {/* ── TIMESFM AI PRICE TARGETS ── */}
      {timesfm && (
        <div className="mx-3 mb-3 border border-[#a78bfa]/40 rounded p-3 text-xs">
          <div className="text-[#a78bfa] font-bold mb-2">🔮 TIMESFM PREDICTIONS</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="text-center bg-[#0f1629] rounded p-2">
              <div className="text-[#4a6080]">T1 (5d)</div>
              <div className="text-white font-bold">{timesfm.t1.toFixed(2)}</div>
              <div className={timesfm.t1 >= result.current_price ? "text-green-400" : "text-red-400"}>
                {((timesfm.t1 / result.current_price - 1) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-center bg-[#0f1629] rounded p-2">
              <div className="text-[#4a6080]">T2 (10d)</div>
              <div className="text-white font-bold">{timesfm.t2.toFixed(2)}</div>
              <div className={timesfm.t2 >= result.current_price ? "text-green-400" : "text-red-400"}>
                {((timesfm.t2 / result.current_price - 1) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-center bg-[#0f1629] rounded p-2">
              <div className="text-[#4a6080]">T3 (20d)</div>
              <div className="text-white font-bold">{timesfm.t3.toFixed(2)}</div>
              <div className={timesfm.t3 >= result.current_price ? "text-green-400" : "text-red-400"}>
                {((timesfm.t3 / result.current_price - 1) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
