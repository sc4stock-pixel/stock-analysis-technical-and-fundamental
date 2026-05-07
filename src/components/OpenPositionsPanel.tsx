"use client";
import { useState, useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import { supertrend, sma } from "@/lib/indicators";

interface Props {
  results: StockAnalysisResult[];
  onSymbolClick: (symbol: string) => void;
}

interface OpenPosition {
  symbol: string;
  name: string;
  exchange: string;
  entryDate: string;
  entryPrice: number;
  currentPrice: number;
  stopPrice: number;
  daysHeld: number;
  pnlPct: number;
  rMultiple: number;
  stopDistPct: number;
  optLabel: string;
  sma50AtEntry: number | null;
  blockedBySma: boolean; // flip happened but sma50 blocked — waiting
}

// ── Reconstruct open position from bar-by-bar simulation ─────
// Mirrors the logic in pipeline.ts runSupertrendBacktest +
// open position detection, with SMA50 filter applied.
function detectOpenPosition(result: StockAnalysisResult): OpenPosition | null {
  const bars = result.chart_bars;
  if (!bars || bars.length < 52) return null;

  const currentPrice = result.current_price;
  if (!currentPrice || currentPrice <= 0) return null;

  const optAtr = result.st_opt_params?.atrPeriod ?? 10;
  const optMul = result.st_opt_params?.multiplier ?? 3.0;

  const highs  = bars.map(b => b.high  ?? b.close ?? 0);
  const lows   = bars.map(b => b.low   ?? b.close ?? 0);
  const closes = bars.map(b => b.close ?? 0);

  const [stLine, stDir, stSig] = supertrend(highs, lows, closes, optAtr, optMul);
  const sma50arr = sma(closes, 50);

  // Check current ST direction — must be bullish to have an open position
  const lastDir = stDir[stDir.length - 1] ?? -1;
  if (lastDir !== 1) return null;

  // Build stEntrySignal array (mirrors pipeline.ts logic exactly)
  const stEntry: string[] = new Array(bars.length).fill("HOLD");
  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = bars[i];
    const prev = bars[i - 1];
    const curSMA50  = sma50arr[i]     ?? 0;
    const prevSMA50 = sma50arr[i - 1] ?? 0;
    const curClose  = closes[i];
    const prevClose = closes[i - 1];

    if (stSig[i] === "SELL") {
      stEntry[i + 1] = "SELL";
      continue;
    }
    // Bullish flip — apply SMA50 filter
    if (stSig[i] === "BUY") {
      if (curClose > curSMA50) stEntry[i + 1] = "BUY";
      continue;
    }
    // ST already bullish — SMA50 upward crossover re-entry
    if (stDir[i] === 1) {
      const smaUpCross = curClose > curSMA50 && prevClose <= prevSMA50;
      if (smaUpCross) stEntry[i + 1] = "BUY";
    }
  }

  // Simulate forward to find the current open position
  let openEntryIdx: number | null   = null;
  let openEntryPrice: number | null = null;
  let openStop: number | null       = null;

  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];

    if (openEntryPrice === null) {
      if (stEntry[i] === "BUY") {
        openEntryPrice = closes[i - 1]; // entry at next bar open ≈ prev close
        openEntryIdx   = i;
        openStop       = (!isNaN(stLine[i - 1]) && stLine[i - 1] > 0)
          ? stLine[i - 1]
          : openEntryPrice - 2 * (cur.rsi ?? 1); // fallback
      }
    } else {
      // Trail stop up with ST line
      const curST = stLine[i];
      if (!isNaN(curST) && curST > 0 && curST > (openStop ?? 0)) {
        openStop = curST;
      }
      // Check exit conditions
      const stopHit  = closes[i] <= (openStop ?? 0);
      const sellSig  = stEntry[i] === "SELL" || stSig[i - 1] === "SELL";
      if (stopHit || sellSig) {
        // Position was closed — reset
        openEntryPrice = null;
        openEntryIdx   = null;
        openStop       = null;
      }
    }
  }

  if (openEntryPrice === null || openEntryIdx === null) return null;

  // Final trailing stop = last ST line value
  const finalStop = result.st_value > 0 ? result.st_value : (openStop ?? 0);

  const daysHeld   = bars.length - 1 - openEntryIdx;
  const pnlPct     = ((currentPrice - openEntryPrice) / openEntryPrice) * 100;
  const riskPerShare = openEntryPrice - (openStop ?? openEntryPrice * 0.95);
  const rMultiple  = riskPerShare > 0
    ? (currentPrice - openEntryPrice) / riskPerShare
    : 0;
  const stopDistPct = finalStop > 0 && currentPrice > 0
    ? ((currentPrice - finalStop) / currentPrice) * 100
    : 0;

  const entryBar   = bars[openEntryIdx];
  const entryDate  = entryBar?.date ?? "—";
  const sma50AtEntry = (!isNaN(sma50arr[openEntryIdx] ?? NaN))
    ? sma50arr[openEntryIdx]
    : null;

  return {
    symbol:      result.symbol,
    name:        result.name,
    exchange:    result.exchange,
    entryDate,
    entryPrice:  Math.round(openEntryPrice * 100) / 100,
    currentPrice,
    stopPrice:   Math.round(finalStop * 100) / 100,
    daysHeld,
    pnlPct:      Math.round(pnlPct * 10) / 10,
    rMultiple:   Math.round(rMultiple * 100) / 100,
    stopDistPct: Math.round(stopDistPct * 10) / 10,
    optLabel:    `ATR${optAtr}×${optMul}`,
    sma50AtEntry,
    blockedBySma: false,
  };
}

// Format date mm/dd/yy
function fmtDate(iso: string): string {
  if (!iso || iso === "—") return "—";
  const parts = iso.split("T")[0].split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  return `${m}/${d}/${y.slice(2)}`;
}

export default function OpenPositionsPanel({ results, onSymbolClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const positions = useMemo(() => {
    const pos: OpenPosition[] = [];
    for (const r of results) {
      // Only process if ST direction is bullish
      if ((r.st_direction ?? -1) !== 1) continue;
      const p = detectOpenPosition(r);
      if (p) pos.push(p);
    }
    // Sort by P&L% descending
    pos.sort((a, b) => b.pnlPct - a.pnlPct);
    return pos;
  }, [results]);

  if (positions.length === 0) return null;

  // Aggregate stats
  const avgPnl     = positions.reduce((s, p) => s + p.pnlPct, 0) / positions.length;
  const winners    = positions.filter(p => p.pnlPct > 0).length;
  const avgDays    = Math.round(positions.reduce((s, p) => s + p.daysHeld, 0) / positions.length);
  const avgR       = positions.reduce((s, p) => s + p.rMultiple, 0) / positions.length;
  const atRisk     = positions.filter(p => p.stopDistPct < 3).length;

  return (
    <div className="mx-4 my-3 rounded border border-[#00ff88]/30 bg-[#00ff88]/3">

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#00ff88] text-xs font-bold tracking-widest">
            🟢 OPEN ST POSITIONS
          </span>
          <span className="text-[#4a6080] text-xs">({positions.length})</span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080] text-xs">
            Avg P&L{" "}
            <span className={avgPnl >= 0 ? "text-[#00ff88] font-bold" : "text-[#ff4757] font-bold"}>
              {avgPnl >= 0 ? "+" : ""}{avgPnl.toFixed(1)}%
            </span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Win <span className="text-[#00ff88]">{winners}/{positions.length}</span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Avg <span className="text-[#c8d8f0]">{avgDays}d</span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Avg R <span className={avgR >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
              {avgR >= 0 ? "+" : ""}{avgR.toFixed(2)}R
            </span>
          </span>
          {atRisk > 0 && (
            <span className="text-[#ff4757] text-xs font-bold border border-[#ff4757]/40 rounded px-1.5 py-0.5 blink">
              ⚠️ {atRisk} NEAR STOP
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {/* Table */}
      {!collapsed && (
        <div className="px-3 pb-3 border-t border-[#1e2d4a]/50">
          <div className="overflow-x-auto mt-2 rounded border border-[#1e2d4a]">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="bg-[#0f1629] border-b border-[#1e2d4a] text-[#4a6080] uppercase tracking-wider">
                  <th className="text-left px-2 py-1.5 font-mono font-normal">Symbol</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Entry Date</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Entry $</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Current $</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">P&L %</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Stop $</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Stop Dist</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Days</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">R-Mult</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Params</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => {
                  const isNearStop = pos.stopDistPct < 3;
                  const isWinner   = pos.pnlPct > 0;
                  const isHighR    = pos.rMultiple >= 2;

                  return (
                    <tr
                      key={pos.symbol}
                      onClick={() => onSymbolClick(pos.symbol)}
                      title={`Click to jump to ${pos.symbol}`}
                      className={`border-b border-[#1e2d4a]/40 cursor-pointer transition-all
                        hover:bg-[#00ff88]/5 active:bg-[#00ff88]/10
                        ${idx % 2 === 0 ? "bg-[#0a0e1a]" : "bg-[#0f1629]"}
                        ${isNearStop ? "border-l-2 border-l-[#ff4757]" : ""}`}
                    >
                      {/* Symbol */}
                      <td className="px-2 py-1.5">
                        <div className="text-[#00d4ff] font-bold">{pos.symbol}</div>
                        <div className="text-[#4a6080] text-[0.6rem] truncate max-w-[70px]">{pos.name}</div>
                      </td>

                      {/* Entry Date */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#6b85a0]">
                        {fmtDate(pos.entryDate)}
                      </td>

                      {/* Entry Price */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#c8d8f0]">
                        {pos.entryPrice.toFixed(2)}
                      </td>

                      {/* Current Price */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#00d4ff] font-bold">
                        {pos.currentPrice.toFixed(2)}
                      </td>

                      {/* P&L % */}
                      <td className={`px-2 py-1.5 text-right font-mono font-bold
                        ${isWinner ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(1)}%
                      </td>

                      {/* Stop Price */}
                      <td className={`px-2 py-1.5 text-right font-mono
                        ${isNearStop ? "text-[#ff4757] font-bold" : "text-[#ff4757]/70"}`}>
                        {pos.stopPrice > 0 ? pos.stopPrice.toFixed(2) : "—"}
                      </td>

                      {/* Stop Distance */}
                      <td className={`px-2 py-1.5 text-right font-mono
                        ${isNearStop ? "text-[#ff4757] font-bold" : "text-[#4a6080]"}`}>
                        {isNearStop && "⚠️ "}
                        {pos.stopDistPct.toFixed(1)}%
                      </td>

                      {/* Days Held */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#6b85a0]">
                        {pos.daysHeld}d
                      </td>

                      {/* R-Multiple */}
                      <td className={`px-2 py-1.5 text-right font-mono font-bold
                        ${isHighR ? "text-[#00ff88]"
                          : pos.rMultiple > 0 ? "text-[#00d4ff]"
                          : "text-[#ff4757]"}`}>
                        {pos.rMultiple >= 0 ? "+" : ""}{pos.rMultiple.toFixed(2)}R
                        {isHighR && " 🔥"}
                      </td>

                      {/* Params */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#ffa502]/60 text-[0.6rem]">
                        {pos.optLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="mt-2 text-[0.6rem] text-[#2a3d5a] font-mono">
            Entry determined by ST bullish flip + SMA50 filter · Stop = trailing ST line (optimized params) · Click row to jump to card
          </div>
        </div>
      )}
    </div>
  );
}
