"use client";
import { StockAnalysisResult } from "@/types";
import { supertrend, sma } from "@/lib/indicators";

interface Props {
  results: StockAnalysisResult[];
  onRowClick: (symbol: string) => void;
}

interface OpenPosition {
  symbol: string;
  name: string;
  exchange: string;
  entryDate: string;
  entryPrice: number;
  currentPrice: number;
  stopPrice: number;
  pnlPct: number;
  daysHeld: number;
  rMultiple: number;
  distToStop: number;
  entryType: "FLIP" | "SMA50_CROSS"; // how entry was triggered
  optLabel: string;
}

// ── Replicate pipeline.ts open position detection ─────────────
// Entry rules (matching pipeline.ts exactly):
//   1. FLIP entry: optStSigArr[i] === "BUY" && close > sma50
//      → stEntrySignal = "BUY" on bar i+1 → entry at bar[i+1].open
//   2. RE-ENTRY: optStDirArr[i] === 1 && close > sma50 && prev.close <= prev.sma50
//      → stEntrySignal = "BUY" on bar i+1 → entry at bar[i+1].open
//   Stop: prev bar's ST line value at entry, trailed upward each bar
//   Exit: low <= trailing stop OR prev ST signal === "SELL"
function detectOpenPosition(result: StockAnalysisResult): OpenPosition | null {
  const bars = result.chart_bars;
  if (!bars || bars.length < 52) return null;

  const optAtr = result.st_opt_params?.atrPeriod ?? 10;
  const optMul = result.st_opt_params?.multiplier ?? 3.0;

  const highs  = bars.map(b => b.high  ?? b.close ?? 0);
  const lows   = bars.map(b => b.low   ?? b.close ?? 0);
  const closes = bars.map(b => b.close ?? 0);

  const [stLine, stDir, stSig] = supertrend(highs, lows, closes, optAtr, optMul);
  const sma50arr = sma(closes, 50);

  const slippage   = 0.0005;
  const commission = 0.001;

  // Build stEntrySignal array — same logic as pipeline.ts
  const stEntry: ("BUY" | "SELL" | "HOLD")[] = new Array(bars.length).fill("HOLD");
  const entryType: ("FLIP" | "SMA50_CROSS" | null)[] = new Array(bars.length).fill(null);

  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = closes[i];
    const prev = closes[i - 1];
    const curSMA50  = sma50arr[i]  ?? 0;
    const prevSMA50 = sma50arr[i - 1] ?? 0;

    if (stSig[i] === "SELL") {
      stEntry[i + 1] = "SELL";
      continue;
    }

    // Flip entry: ST just flipped bullish AND price above SMA50
    if (stSig[i] === "BUY") {
      if (cur > curSMA50) {
        stEntry[i + 1] = "BUY";
        entryType[i + 1] = "FLIP";
      }
      continue;
    }

    // Re-entry: ST already bullish + SMA50 upward crossover
    if (stDir[i] === 1) {
      const smaUpCross = cur > curSMA50 && prev <= prevSMA50;
      if (smaUpCross) {
        stEntry[i + 1] = "BUY";
        entryType[i + 1] = "SMA50_CROSS";
      }
    }
  }

  // Simulate position tracking — find the open position if any
  let pos: {
    entryIdx: number;
    entryDate: string;
    entryPrice: number;
    entryCost: number;
    stop: number;
    originalStop: number;
    type: "FLIP" | "SMA50_CROSS";
  } | null = null;

  for (let i = 1; i < bars.length; i++) {
    const bar  = bars[i];
    const prevST = stLine[i - 1] ?? 0;

    if (pos === null) {
      if (stEntry[i] === "BUY") {
        const ep   = (bar.open ?? bar.close ?? 0) * (1 + slippage);
        const stop = (!isNaN(prevST) && prevST > 0) ? prevST : ep * 0.95;
        pos = {
          entryIdx:   i,
          entryDate:  bar.date ?? "",
          entryPrice: ep,
          entryCost:  ep * (1 + commission),
          stop,
          originalStop: stop,
          type: entryType[i] ?? "FLIP",
        };
      }
    } else {
      // Trail stop upward only
      const curST = stLine[i] ?? NaN;
      if (!isNaN(curST) && curST > pos.stop) {
        pos.stop = curST;
      }

      // Exit conditions
      const stopHit  = (bar.low ?? bar.close ?? 0) <= pos.stop;
      const sellSig  = stSig[i - 1] === "SELL";

      if (stopHit || sellSig) {
        pos = null; // position closed
      }
    }
  }

  // If pos is still open, we have an open position
  if (!pos) return null;

  const currentPrice = result.current_price;
  if (!currentPrice || currentPrice <= 0) return null;

  const pnlPct    = (currentPrice - pos.entryPrice) / pos.entryPrice * 100;
  const riskPct   = pos.originalStop > 0
    ? (pos.entryPrice - pos.originalStop) / pos.entryPrice
    : 0.02;
  const rMultiple = riskPct > 0 ? (pnlPct / 100) / riskPct : 0;
  const distToStop = pos.stop > 0
    ? (currentPrice - pos.stop) / currentPrice * 100
    : 0;

  // Days held from entry date to today
  const entryMs  = new Date(pos.entryDate).getTime();
  const nowMs    = Date.now();
  const daysHeld = Math.max(0, Math.floor((nowMs - entryMs) / (1000 * 60 * 60 * 24)));

  return {
    symbol:       result.symbol,
    name:         result.name,
    exchange:     result.exchange,
    entryDate:    pos.entryDate,
    entryPrice:   pos.entryPrice,
    currentPrice,
    stopPrice:    pos.stop,
    pnlPct,
    daysHeld,
    rMultiple,
    distToStop,
    entryType:    pos.type,
    optLabel:     result.st_opt_params
      ? `ATR${result.st_opt_params.atrPeriod}×${result.st_opt_params.multiplier}`
      : "ATR10×3.0",
  };
}

function fmtDate(iso: string): string {
  const parts = iso.split("T")[0].split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  return `${m}/${d}/${y.slice(2)}`;
}

function pnlColor(pct: number): string {
  if (pct >= 10) return "text-[#00ff88] font-bold";
  if (pct >= 5)  return "text-[#00ff88]";
  if (pct >= 0)  return "text-[#4dff99]";
  if (pct >= -3) return "text-[#ffa502]";
  return "text-[#ff4757]";
}

function rMultipleColor(r: number): string {
  if (r >= 2)   return "text-[#00ff88] font-bold";
  if (r >= 1)   return "text-[#00ff88]";
  if (r >= 0)   return "text-[#ffa502]";
  return "text-[#ff4757]";
}

function stopDistColor(pct: number): string {
  if (pct < 2)  return "text-[#ff4757] font-bold"; // danger
  if (pct < 5)  return "text-[#ffa502]";            // caution
  return "text-[#c8d8f0]";
}

export default function OpenPositionsPanel({ results, onRowClick }: Props) {
  // Detect open positions across all results
  const positions: OpenPosition[] = results
    .map(r => detectOpenPosition(r))
    .filter((p): p is OpenPosition => p !== null)
    .sort((a, b) => b.pnlPct - a.pnlPct); // best P&L first

  if (positions.length === 0) return null;

  // Portfolio-level stats
  const avgPnl     = positions.reduce((s, p) => s + p.pnlPct, 0) / positions.length;
  const avgR       = positions.reduce((s, p) => s + p.rMultiple, 0) / positions.length;
  const winners    = positions.filter(p => p.pnlPct >= 0).length;
  const atRisk     = positions.filter(p => p.distToStop < 3).length;

  return (
    <div className="mx-4 my-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[#00ff88] font-bold text-xs tracking-widest">
            📈 OPEN ST POSITIONS
          </span>
          <span className="text-[#4a6080] text-xs">
            {positions.length} position{positions.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080] text-xs">
            Avg P&L:{" "}
            <span className={avgPnl >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
              {avgPnl >= 0 ? "+" : ""}{avgPnl.toFixed(1)}%
            </span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Avg R:{" "}
            <span className={avgR >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
              {avgR >= 0 ? "+" : ""}{avgR.toFixed(2)}R
            </span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Win: <span className="text-[#00ff88]">{winners}/{positions.length}</span>
          </span>
          {atRisk > 0 && (
            <span className="text-[#ff4757] text-xs font-bold blink">
              ⚠️ {atRisk} near stop
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-[0.6rem] font-mono">
          SMA50 filter applied · click row to jump
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-[#00ff88]/20">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#0a1a0a] border-b border-[#00ff88]/20 text-[#4a6080] uppercase tracking-wider">
              <th className="text-left px-3 py-2 font-mono font-normal">Symbol</th>
              <th className="text-left px-3 py-2 font-mono font-normal">Entry Date</th>
              <th className="text-right px-3 py-2 font-mono font-normal">Entry $</th>
              <th className="text-right px-3 py-2 font-mono font-normal">Current $</th>
              <th className="text-right px-3 py-2 font-mono font-normal">P&amp;L%</th>
              <th className="text-right px-3 py-2 font-mono font-normal">Stop $</th>
              <th className="text-right px-3 py-2 font-mono font-normal">→ Stop</th>
              <th className="text-right px-3 py-2 font-mono font-normal">Days</th>
              <th className="text-right px-3 py-2 font-mono font-normal">R-Mult</th>
              <th className="text-left  px-3 py-2 font-mono font-normal">Entry Type</th>
              <th className="text-left  px-3 py-2 font-mono font-normal">Params</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => (
              <tr
                key={pos.symbol}
                onClick={() => onRowClick(pos.symbol)}
                className={`border-b border-[#1e2d4a]/40 cursor-pointer transition-all
                  hover:bg-[#00ff88]/5 active:bg-[#00ff88]/10
                  ${idx % 2 === 0 ? "bg-[#0a0e1a]" : "bg-[#0d1220]"}
                  ${pos.distToStop < 2 ? "border-l-2 border-l-[#ff4757]" : ""}
                  ${pos.distToStop >= 2 && pos.distToStop < 5 ? "border-l-2 border-l-[#ffa502]" : ""}
                `}
              >
                {/* Symbol */}
                <td className="px-3 py-2">
                  <div className="text-[#00d4ff] font-bold">{pos.symbol}</div>
                  <div className="text-[#4a6080] text-[0.6rem] truncate max-w-[70px]">{pos.name}</div>
                </td>

                {/* Entry Date */}
                <td className="px-3 py-2 font-mono text-[#6b85a0]">
                  {fmtDate(pos.entryDate)}
                </td>

                {/* Entry Price */}
                <td className="px-3 py-2 text-right font-mono text-[#c8d8f0]">
                  {pos.exchange === "HK"
                    ? `HK$${pos.entryPrice.toFixed(2)}`
                    : `$${pos.entryPrice.toFixed(2)}`}
                </td>

                {/* Current Price */}
                <td className="px-3 py-2 text-right font-mono text-[#00d4ff] font-bold">
                  {pos.exchange === "HK"
                    ? `HK$${pos.currentPrice.toFixed(2)}`
                    : `$${pos.currentPrice.toFixed(2)}`}
                </td>

                {/* P&L% */}
                <td className={`px-3 py-2 text-right font-mono ${pnlColor(pos.pnlPct)}`}>
                  {pos.pnlPct >= 0 ? "▲+" : "▼"}{Math.abs(pos.pnlPct).toFixed(2)}%
                </td>

                {/* Stop Price */}
                <td className="px-3 py-2 text-right font-mono text-[#ff4757]">
                  {pos.exchange === "HK"
                    ? `HK$${pos.stopPrice.toFixed(2)}`
                    : `$${pos.stopPrice.toFixed(2)}`}
                </td>

                {/* Distance to Stop */}
                <td className={`px-3 py-2 text-right font-mono ${stopDistColor(pos.distToStop)}`}
                  title="Distance from current price to stop">
                  {pos.distToStop.toFixed(1)}%
                  {pos.distToStop < 2 && <span className="ml-1 text-[#ff4757]">⚠️</span>}
                </td>

                {/* Days Held */}
                <td className="px-3 py-2 text-right font-mono text-[#6b85a0]">
                  {pos.daysHeld}d
                </td>

                {/* R-Multiple */}
                <td className={`px-3 py-2 text-right font-mono ${rMultipleColor(pos.rMultiple)}`}>
                  {pos.rMultiple >= 0 ? "+" : ""}{pos.rMultiple.toFixed(2)}R
                </td>

                {/* Entry Type */}
                <td className="px-3 py-2">
                  {pos.entryType === "FLIP" ? (
                    <span className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border border-[#00ff88]/30 text-[#00ff88] bg-[#00ff88]/5">
                      ST FLIP
                    </span>
                  ) : (
                    <span className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border border-[#a78bfa]/30 text-[#a78bfa] bg-[#a78bfa]/5">
                      SMA50 ✕
                    </span>
                  )}
                </td>

                {/* Params */}
                <td className="px-3 py-2">
                  <span className="text-[0.6rem] font-mono text-[#ffa502]/70">
                    {pos.optLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-1.5 text-[0.58rem] text-[#4a6080] font-mono flex-wrap">
        <span><span className="inline-block w-2 h-2 border-l-2 border-l-[#ff4757] mr-1" />Danger: &lt;2% to stop</span>
        <span><span className="inline-block w-2 h-2 border-l-2 border-l-[#ffa502] mr-1" />Caution: &lt;5% to stop</span>
        <span>ST FLIP = bullish flip + price above SMA50</span>
        <span>SMA50 ✕ = delayed re-entry when price crossed SMA50</span>
        <span>R-Mult = return ÷ initial risk</span>
      </div>
    </div>
  );
}
