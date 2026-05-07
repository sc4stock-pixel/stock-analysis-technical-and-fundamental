"use client";
import { useState, useEffect, useCallback } from "react";
import { StockAnalysisResult } from "@/types";

interface EarningsDate {
  symbol: string;
  reportDate: string | null;
  daysUntil: number | null;
  fiscalQuarter: string;
  estimate: number | null;
  source: string;
}

interface OpenPosition {
  symbol: string;
  name: string;
  exchange: string;
  entryPrice: number;
  currentPrice: number;
  pnlPct: number;
  stopPrice: number;
  stopDistPct: number;
  daysHeld: number;
  rMultiple: number;
  riskAmount: number;        // % of entry risked to stop
  stOptLabel: string;
  entryDate: string;
}

interface Props {
  results: StockAnalysisResult[];
}

function riskColor(rMultiple: number): string {
  if (rMultiple >= 2)  return "text-[#00ff88]";
  if (rMultiple >= 1)  return "text-[#00d4ff]";
  if (rMultiple >= 0)  return "text-[#ffa502]";
  return "text-[#ff4757]";
}

function pnlColor(pct: number): string {
  if (pct >= 5)  return "text-[#00ff88] font-bold";
  if (pct >= 0)  return "text-[#00ff88]";
  if (pct >= -3) return "text-[#ffa502]";
  return "text-[#ff4757] font-bold";
}

function earningsBadge(days: number | null): { text: string; color: string; urgent: boolean } | null {
  if (days == null) return null;
  if (days < 0)     return null; // already reported
  if (days === 0)   return { text: "📅 TODAY",    color: "text-[#ff4757] font-bold", urgent: true };
  if (days <= 3)    return { text: `📅 ${days}d`,  color: "text-[#ff4757] font-bold", urgent: true };
  if (days <= 7)    return { text: `📅 ${days}d`,  color: "text-[#ffa502]",           urgent: true };
  if (days <= 14)   return { text: `📅 ${days}d`,  color: "text-[#6b85a0]",           urgent: false };
  return null; // too far out — don't clutter
}

function buildOpenPositions(results: StockAnalysisResult[]): OpenPosition[] {
  const positions: OpenPosition[] = [];

  for (const r of results) {
    // Only show confirmed open ST positions
    if (r.st_direction !== 1) continue;
    if (r.st_open_return_pct === null || r.st_open_return_pct === undefined) continue;

    const bt = r.backtest;
    const trades = r.comparison?.supertrend?.trades ?? [];

    // Find the last ST trade (open position = no exit yet after last entry)
    // The most recent trade in the list is the open one when st_open_return_pct exists
    const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null;

    const entryPrice  = lastTrade?.entry_price ?? (r.current_price / (1 + r.st_open_return_pct / 100));
    const entryDate   = lastTrade?.entry_date ?? "—";
    const currentPrice = r.current_price;
    const stopPrice   = r.st_value > 0 ? r.st_value : 0;
    const stopDistPct = r.st_stop_distance_pct ?? 0;
    const pnlPct      = r.st_open_return_pct;

    // Days held: from entry_date to today
    let daysHeld = lastTrade?.bars_held ?? 0;
    if (lastTrade?.entry_date) {
      const entryMs = new Date(lastTrade.entry_date).getTime();
      daysHeld = Math.round((Date.now() - entryMs) / 86400000);
    }

    // R-multiple: pnl / initial risk
    const riskAmount = entryPrice > 0 && stopPrice > 0
      ? ((entryPrice - stopPrice) / entryPrice) * 100
      : 2.0; // fallback 2% risk assumption
    const rMultiple = riskAmount > 0 ? pnlPct / riskAmount : 0;

    const optLabel = r.st_opt_params
      ? `ATR${r.st_opt_params.atrPeriod}×${r.st_opt_params.multiplier}`
      : "—";

    positions.push({
      symbol:       r.symbol,
      name:         r.name,
      exchange:     r.exchange,
      entryPrice,
      currentPrice,
      pnlPct,
      stopPrice,
      stopDistPct,
      daysHeld,
      rMultiple,
      riskAmount,
      stOptLabel:   optLabel,
      entryDate,
    });
  }

  // Sort by P&L descending
  return positions.sort((a, b) => b.pnlPct - a.pnlPct);
}

export default function OpenPositionsPanel({ results }: Props) {
  const [collapsed, setCollapsed]       = useState(false);
  const [earnings, setEarnings]         = useState<Record<string, EarningsDate>>({});
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsFetched, setEarningsFetched] = useState(false);

  const positions = buildOpenPositions(results);

  // Fetch earnings for open positions
  const fetchEarnings = useCallback(async () => {
    if (positions.length === 0 || earningsFetched) return;
    setEarningsLoading(true);
    try {
      const symbols = positions.map(p => p.symbol);
      const res = await fetch("/api/earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      if (res.ok) {
        const data = await res.json();
        setEarnings(data);
        setEarningsFetched(true);
      }
    } catch {
      // silently fail — earnings is enhancement not critical
    } finally {
      setEarningsLoading(false);
    }
  }, [positions, earningsFetched]);

  // Auto-fetch on mount when positions exist
  useEffect(() => {
    if (positions.length > 0 && !earningsFetched) {
      fetchEarnings();
    }
  }, [positions.length, earningsFetched, fetchEarnings]);

  if (positions.length === 0) return null;

  // Aggregate stats
  const avgPnl      = positions.reduce((a, p) => a + p.pnlPct, 0) / positions.length;
  const totalWinners = positions.filter(p => p.pnlPct > 0).length;
  const atRisk      = positions.filter(p => p.stopDistPct < 3).length;
  const earningsRisk = positions.filter(p => {
    const e = earnings[p.symbol];
    return e?.daysUntil != null && e.daysUntil >= 0 && e.daysUntil <= 7;
  }).length;

  return (
    <div className="mx-4 my-3 border border-[#00ff88]/30 rounded bg-[#080d1a]">

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#00ff88] text-xs font-bold tracking-widest">
            📊 OPEN ST POSITIONS
          </span>
          <span className="text-[#00ff88] text-xs font-mono border border-[#00ff88]/30 rounded px-1.5 py-0.5">
            {positions.length} active
          </span>
          <span className={`text-xs font-mono ${avgPnl >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
            Avg P&L: {avgPnl >= 0 ? "+" : ""}{avgPnl.toFixed(1)}%
          </span>
          <span className="text-xs text-[#4a6080]">
            {totalWinners}W {positions.length - totalWinners}L
          </span>
          {atRisk > 0 && (
            <span className="text-[#ffa502] text-xs font-bold blink">
              ⚠ {atRisk} near stop
            </span>
          )}
          {earningsRisk > 0 && (
            <span className="text-[#ff4757] text-xs font-bold">
              📅 {earningsRisk} earnings &lt;7d
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); fetchEarnings(); }}
            disabled={earningsLoading}
            className="text-[0.6rem] px-2 py-0.5 border border-[#1e2d4a] text-[#4a6080] hover:text-[#00d4ff] hover:border-[#00d4ff]/40 rounded transition-all disabled:opacity-40"
          >
            {earningsLoading ? "⏳" : "📅 Earnings"}
          </button>
          <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
        </div>
      </div>

      {/* Table */}
      {!collapsed && (
        <div className="border-t border-[#1e2d4a]/50 overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="bg-[#0f1629] border-b border-[#1e2d4a] text-[#4a6080] uppercase tracking-wider">
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-right px-2 py-2">Entry</th>
                <th className="text-right px-2 py-2">Current</th>
                <th className="text-right px-2 py-2">P&L %</th>
                <th className="text-right px-2 py-2">Stop</th>
                <th className="text-right px-2 py-2">Dist%</th>
                <th className="text-right px-2 py-2">Days</th>
                <th className="text-right px-2 py-2">R-Mult</th>
                <th className="text-left px-2 py-2">Earnings</th>
                <th className="text-left px-2 py-2">Params</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, idx) => {
                const earningInfo  = earnings[p.symbol];
                const eBadge       = earningsBadge(earningInfo?.daysUntil ?? null);
                const stopWarning  = p.stopDistPct < 3;
                const stopAmber    = p.stopDistPct < 5;

                return (
                  <tr
                    key={p.symbol}
                    className={`border-b border-[#1e2d4a]/40 transition-colors
                      ${eBadge?.urgent ? "bg-[#ff4757]/3" : idx % 2 === 0 ? "bg-[#0a0e1a]" : "bg-[#0f1629]"}
                      hover:bg-[#00ff88]/5`}
                  >
                    {/* Symbol */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[#00ff88] font-bold">🟢 {p.symbol}</span>
                        <span className={`text-[0.58rem] px-1 rounded ${p.exchange === "HK" ? "bg-[#ffa502]/10 text-[#ffa502]" : "bg-[#00d4ff]/10 text-[#00d4ff]"}`}>
                          {p.exchange}
                        </span>
                      </div>
                      <div className="text-[#4a6080] text-[0.58rem] truncate max-w-[100px]">{p.name}</div>
                    </td>

                    {/* Entry */}
                    <td className="px-2 py-2 text-right font-mono">
                      <div className="text-[#c8d8f0]">{p.entryPrice.toFixed(2)}</div>
                      {p.entryDate !== "—" && (
                        <div className="text-[#4a6080] text-[0.58rem]">
                          {p.entryDate.slice(5).replace("-", "/")}
                        </div>
                      )}
                    </td>

                    {/* Current */}
                    <td className="px-2 py-2 text-right font-mono text-[#c8d8f0]">
                      {p.currentPrice.toFixed(2)}
                    </td>

                    {/* P&L */}
                    <td className={`px-2 py-2 text-right font-mono text-sm ${pnlColor(p.pnlPct)}`}>
                      {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)}%
                    </td>

                    {/* Stop */}
                    <td className={`px-2 py-2 text-right font-mono ${stopWarning ? "text-[#ff4757]" : stopAmber ? "text-[#ffa502]" : "text-[#6b85a0]"}`}>
                      {p.stopPrice > 0 ? p.stopPrice.toFixed(2) : "—"}
                    </td>

                    {/* Dist% */}
                    <td className={`px-2 py-2 text-right font-mono ${stopWarning ? "text-[#ff4757] font-bold" : stopAmber ? "text-[#ffa502]" : "text-[#6b85a0]"}`}>
                      {stopWarning && "⚠ "}{p.stopDistPct.toFixed(1)}%
                    </td>

                    {/* Days */}
                    <td className="px-2 py-2 text-right font-mono text-[#6b85a0]">
                      {p.daysHeld}d
                    </td>

                    {/* R-Multiple */}
                    <td className={`px-2 py-2 text-right font-mono font-bold ${riskColor(p.rMultiple)}`}>
                      {p.rMultiple >= 0 ? "+" : ""}{p.rMultiple.toFixed(2)}R
                    </td>

                    {/* Earnings */}
                    <td className="px-2 py-2">
                      {earningsLoading ? (
                        <span className="text-[#4a6080] text-[0.6rem]">…</span>
                      ) : eBadge ? (
                        <div>
                          <span className={`text-[0.65rem] font-mono font-bold ${eBadge.color}`}>
                            {eBadge.text}
                          </span>
                          {earningInfo?.fiscalQuarter && earningInfo.fiscalQuarter !== "—" && (
                            <div className="text-[#4a6080] text-[0.55rem]">{earningInfo.fiscalQuarter}</div>
                          )}
                          {earningInfo?.estimate != null && (
                            <div className="text-[#4a6080] text-[0.55rem]">EPS est: {earningInfo.estimate.toFixed(2)}</div>
                          )}
                        </div>
                      ) : earningInfo?.reportDate ? (
                        <span className="text-[#2a3d5a] text-[0.6rem] font-mono">
                          {earningInfo.reportDate.slice(5)}
                        </span>
                      ) : (
                        <span className="text-[#2a3d5a] text-[0.6rem]">—</span>
                      )}
                    </td>

                    {/* Params */}
                    <td className="px-2 py-2">
                      <span className="text-[#ffa502]/70 text-[0.58rem] font-mono border border-[#ffa502]/20 rounded px-1">
                        {p.stOptLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer summary */}
          <div className="px-3 py-2 border-t border-[#1e2d4a]/30 flex items-center gap-4 text-[0.6rem] text-[#4a6080] font-mono flex-wrap">
            <span>P&L range: <span className={positions[positions.length-1]?.pnlPct < 0 ? "text-[#ff4757]" : "text-[#ffa502]"}>{positions[positions.length-1]?.pnlPct.toFixed(1)}%</span> → <span className="text-[#00ff88]">{positions[0]?.pnlPct.toFixed(1)}%</span></span>
            <span>Avg dist to stop: <span className="text-[#c8d8f0]">{(positions.reduce((a,p) => a + p.stopDistPct, 0) / positions.length).toFixed(1)}%</span></span>
            <span>Avg R: <span className={riskColor(positions.reduce((a,p) => a + p.rMultiple, 0) / positions.length)}>{(positions.reduce((a,p) => a + p.rMultiple, 0) / positions.length).toFixed(2)}R</span></span>
            {!process.env.ALPHA_VANTAGE_KEY && earningsFetched && (
              <span className="text-[#4a6080]">💡 Add ALPHA_VANTAGE_KEY to Vercel env for earnings dates</span>
            )}
            <span className="ml-auto text-[#2a3d5a]">Sorted by P&L · Stop dist &lt;3% flagged ⚠</span>
          </div>
        </div>
      )}
    </div>
  );
}
