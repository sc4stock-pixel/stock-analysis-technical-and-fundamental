"use client";
import { StockAnalysisResult } from "@/types";

interface Props { results: StockAnalysisResult[]; }

export default function PortfolioSummaryBar({ results }: Props) {
  const buy = results.filter((r) => r.signal === "BUY").length;
  const sell = results.filter((r) => r.signal === "SELL").length;
  const hold = results.filter((r) => r.signal === "HOLD").length;
  const total = results.length;

  // Regime distribution
  const regimes: Record<string, number> = {};
  for (const r of results) {
    const key = r.regime ?? "UNKNOWN";
    regimes[key] = (regimes[key] ?? 0) + 1;
  }
  const topRegimes = Object.entries(regimes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Avg metrics
  const withBt = results.filter((r) => r.backtest?.num_trades > 0);
  const avgSharpe = withBt.length > 0
    ? withBt.reduce((a, r) => a + r.backtest.sharpe, 0) / withBt.length
    : 0;
  const avgWinRate = withBt.length > 0
    ? withBt.reduce((a, r) => a + r.backtest.win_rate, 0) / withBt.length
    : 0;
  const avgAlpha = results.length > 0
    ? results.reduce((a, r) => a + (r.backtest?.alpha ?? 0), 0) / results.length
    : 0;

  return (
    <div className="px-4 py-2 flex items-center gap-6 flex-wrap text-xs overflow-x-auto">
      {/* Signal distribution */}
      <div className="flex items-center gap-2">
        <span className="text-[#4a6080]">SIGNALS:</span>
        {buy > 0 && <span className="badge-buy px-2 py-0.5 rounded text-xs">▲ {buy} BUY</span>}
        {sell > 0 && <span className="badge-sell px-2 py-0.5 rounded text-xs">▼ {sell} SELL</span>}
        {hold > 0 && <span className="badge-hold px-2 py-0.5 rounded text-xs">◆ {hold} HOLD</span>}
        <span className="text-[#4a6080]">/ {total}</span>
      </div>

      <div className="h-4 w-px bg-[#1e2d4a]" />

      {/* Portfolio metrics */}
      <div className="flex items-center gap-4">
        <span className="text-[#4a6080]">
          SHARPE: <span className={avgSharpe >= 1 ? "text-[#00ff88]" : avgSharpe >= 0.5 ? "text-[#ffa502]" : "text-[#ff4757]"}>
            {avgSharpe.toFixed(2)}
          </span>
        </span>
        <span className="text-[#4a6080]">
          WIN RATE: <span className={avgWinRate >= 55 ? "text-[#00ff88]" : avgWinRate >= 45 ? "text-[#ffa502]" : "text-[#ff4757]"}>
            {avgWinRate.toFixed(1)}%
          </span>
        </span>
        <span className="text-[#4a6080]">
          α: <span className={avgAlpha >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
            {avgAlpha >= 0 ? "+" : ""}{avgAlpha.toFixed(1)}%
          </span>
        </span>
      </div>

      <div className="h-4 w-px bg-[#1e2d4a]" />

      {/* Regime distribution */}
      <div className="flex items-center gap-2">
        <span className="text-[#4a6080]">REGIMES:</span>
        {topRegimes.map(([regime, count]) => (
          <span key={regime} className="text-[#6b85a0]">
            {regime.replace(/_/g, " ")}: <span className="text-[#c8d8f0]">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
