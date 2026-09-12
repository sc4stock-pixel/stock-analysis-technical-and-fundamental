"use client";
import { useState, useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import { supertrend, sma } from "@/lib/indicators";
import InfoTooltip from "@/components/InfoTooltip";
import { targetWeightOfResult, weightTone, WEIGHT_FLOOR, WEIGHT_TRIM, WEIGHT_FULL } from "@/lib/targetWeight";

/** Fixed top of the trigger-ladder scale, in percent. Deliberately NOT auto-scaled
 *  to the day's widest name — a quiet book must not render like a dangerous one. */
const LADDER_SCALE = 12;
/** Inside this distance the trigger is live for the coming session. */
const LADDER_NEAR = 2;

type SortKey = "weight" | "dist";
/** First click on each column: heaviest exposure first, nearest trigger first. */
const SORT_FIRST_DIR: Record<SortKey, 1 | -1> = { weight: -1, dist: 1 };

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
  /** Asymmetric target weight (100 / 40). Under 100/40 the book is NEVER flat,
   *  so a name with no ST long is still a held position at some weight. */
  targetWeight: number;
  /** True when there is no ST long — the row is a floor/hold-only holding and
   *  has no entry price, P&L or R-multiple to show. */
  weightOnly: boolean;
  /** Close > own SMA200 (TT c2). Drives WHERE a 100% name lands when it flips
   *  down: the 70% trim tier, or straight to the 40% floor (skip-the-trim).
   *  undefined = unknown, which falls toward the trim tier. */
  aboveSma200?: boolean;
}

// ── Reconstruct open position from bar-by-bar simulation ─────
// Mirrors the logic in pipeline.ts runSupertrendBacktest +
// open position detection, with SMA50 filter applied.
type SimulatedPosition = Omit<OpenPosition, "targetWeight" | "weightOnly">;

function detectOpenPosition(result: StockAnalysisResult): SimulatedPosition | null {
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
      if (r.signal === "ERROR" || r.error) continue;
      const tw = targetWeightOfResult(r).weight;
      const above200 = r.sepa_metadata?.trend_template_criteria?.c2_price_above_sma200;
      // An ST long -> full simulated position row (entry, P&L, R).
      const p = (r.st_direction ?? -1) === 1 ? detectOpenPosition(r) : null;
      if (p) { pos.push({ ...p, targetWeight: tw, weightOnly: false, aboveSma200: above200 }); continue; }
      // No ST long, but under the asymmetric rule the book still HOLDS this
      // name (100% above its own 200-day, else the 40% floor). Show it as a
      // weight-only row rather than omitting it — omitting understated the
      // book by roughly half.
      pos.push({
        symbol: r.symbol, name: r.name, exchange: r.exchange,
        entryDate: "—", entryPrice: 0, currentPrice: r.current_price,
        stopPrice: r.st_value > 0 ? r.st_value : 0,
        daysHeld: 0, pnlPct: 0, rMultiple: 0,
        stopDistPct: r.st_stop_distance_pct ?? 0,
        optLabel: `ATR${r.st_opt_params?.atrPeriod ?? 10}×${r.st_opt_params?.multiplier ?? 3}`,
        sma50AtEntry: null, blockedBySma: false,
        targetWeight: tw, weightOnly: true, aboveSma200: above200,
      });
    }
    // ST longs first (they carry P&L), then weight-only rows; each by P&L desc.
    pos.sort((a, b) => Number(a.weightOnly) - Number(b.weightOnly) || b.pnlPct - a.pnlPct);
    return pos;
  }, [results]);

  // Click-to-sort on Target wt / Stop Dist. Three-state cycle: default order ->
  // preferred direction -> reversed -> back to default. Ties fall back to symbol
  // so the row order never jitters between renders.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  function toggleSort(key: SortKey) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: SORT_FIRST_DIR[key] };
      if (prev.dir === SORT_FIRST_DIR[key]) return { key, dir: (SORT_FIRST_DIR[key] * -1) as 1 | -1 };
      return null;
    });
  }
  const sorted = useMemo(() => {
    if (!sort) return positions;
    return [...positions].sort((a, b) =>
      sort.dir * (sort.key === "weight" ? a.targetWeight - b.targetWeight : a.stopDistPct - b.stopDistPct)
      || a.symbol.localeCompare(b.symbol));
  }, [positions, sort]);

  const sortHead = (key: SortKey, label: string) => (
    <th
      className="text-right px-2 py-1.5 font-mono font-normal cursor-pointer select-none whitespace-nowrap hover:text-[#c8d8f0]"
      onClick={() => toggleSort(key)}
      title={`Sort by ${label} — click again to reverse, a third time to restore the default order`}
    >
      {label}
      <span className="ml-1 text-[#00d4ff]">{sort?.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );

  // Trigger ladder: the whole book's distance to the level that moves it, grouped
  // by current weight tier and nearest-first inside each tier. Mirrors the email
  // pre-session trigger card (100 / 70 / 40 groups) on the same numbers.
  const ladderGroups = useMemo(() => {
    const tiers: Array<{ weight: number; label: string }> = [
      { weight: WEIGHT_FULL,  label: `AT ${WEIGHT_FULL}% — a close below trims to ${WEIGHT_TRIM}%` },
      { weight: WEIGHT_TRIM,  label: `AT ${WEIGHT_TRIM}% — a close above restores ${WEIGHT_FULL}%` },
      { weight: WEIGHT_FLOOR, label: `AT ${WEIGHT_FLOOR}% — a close above restores ${WEIGHT_FULL}%` },
    ];
    return tiers
      .map(t => ({
        ...t,
        members: positions
          .filter(p => p.targetWeight === t.weight)
          .sort((a, b) => a.stopDistPct - b.stopDistPct || a.symbol.localeCompare(b.symbol)),
      }))
      .filter(g => g.members.length > 0);
  }, [positions]);

  if (positions.length === 0) return null;

  // Aggregate stats — P&L/R/days come from ST LONGS ONLY. Weight-only rows have
  // no entry price, so folding their zeros in would drag every average toward 0.
  const longs      = positions.filter(p => !p.weightOnly);
  const nL         = longs.length || 1;
  const avgPnl     = longs.reduce((s, p) => s + p.pnlPct, 0) / nL;
  const winners    = longs.filter(p => p.pnlPct > 0).length;
  const avgDays    = Math.round(longs.reduce((s, p) => s + p.daysHeld, 0) / nL);
  const avgR       = longs.reduce((s, p) => s + p.rMultiple, 0) / nL;
  // "Near stop" only matters for an ST long — and it now means a TRIM to the
  // floor, not an exit (and nothing at all when the name is above its 200-day).
  const atRisk     = longs.filter(p => p.stopDistPct < 3 && p.targetWeight === WEIGHT_FLOOR).length;
  const atFloor    = positions.filter(p => p.targetWeight === WEIGHT_FLOOR).length;
  const avgWeight  = positions.reduce((s, p) => s + p.targetWeight, 0) / positions.length;

  return (
    <div className="mx-4 my-3 rounded border border-[#00ff88]/30 bg-[#00ff88]/3">

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#00ff88] text-xs font-bold tracking-widest">
            🟢 BOOK &amp; ST POSITIONS
          </span>
          <InfoTooltip id="positions" />
          <span className="text-[#4a6080] text-xs">
            ({longs.length} ST long / {positions.length} held)
          </span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080] text-xs">
            Avg wt <span className="text-[#00d4ff] font-bold">{avgWeight.toFixed(0)}%</span>
            {atFloor > 0 && <span className="text-[#ffa502]"> · {atFloor} at floor</span>}
          </span>
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
            <span className="text-[#ffa502] text-xs font-bold border border-[#ffa502]/40 rounded px-1.5 py-0.5"
                  title="Close to the ST line AND below the 200-day — a stop hit trims to 40%, it does not exit">
              ⚠️ {atRisk} NEAR TRIM
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
                  {sortHead("weight", "Target wt")}
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Entry Date</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Entry $</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Current $</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">P&L %</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Stop $</th>
                  {sortHead("dist", "Stop Dist")}
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Days</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">R-Mult</th>
                  <th className="text-right px-2 py-1.5 font-mono font-normal">Params</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((pos, idx) => {
                  const isNearStop = !pos.weightOnly && pos.stopDistPct < 3
                                     && pos.targetWeight === WEIGHT_FLOOR;
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

                      {/* Target weight — the asymmetric 100/40 exposure */}
                      <td className="px-2 py-1.5 text-right">
                        {(() => {
                          const tone = weightTone(pos.targetWeight);
                          const cls = tone === "full" ? "bg-[#00d4ff]/10 border-[#00d4ff]/35 text-[#00d4ff]"
                            : tone === "trim" ? "bg-[#7dd3fc]/10 border-[#7dd3fc]/35 text-[#7dd3fc]"
                            : "bg-[#ffa502]/12 border-[#ffa502]/40 text-[#ffa502]";
                          const tip = tone === "full" ? "Full size — in an ST long"
                            : tone === "trim" ? "Trimmed to 70% — ST bearish, but price still above its own 200-day SMA"
                            : "Floor 40% — ST bearish AND below its own 200-day SMA";
                          return (
                            <span className={`font-mono font-bold text-[0.65rem] px-1.5 py-0.5 rounded border ${cls}`} title={tip}>
                              {pos.targetWeight}%
                            </span>
                          );
                        })()}
                      </td>

                      {/* Entry Date */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#6b85a0]">
                        {pos.weightOnly ? "—" : fmtDate(pos.entryDate)}
                      </td>

                      {/* Entry Price */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#c8d8f0]">
                        {pos.weightOnly ? "—" : pos.entryPrice.toFixed(2)}
                      </td>

                      {/* Current Price */}
                      <td className="px-2 py-1.5 text-right font-mono text-[#00d4ff] font-bold">
                        {pos.currentPrice.toFixed(2)}
                      </td>

                      {/* P&L % */}
                      <td className={`px-2 py-1.5 text-right font-mono font-bold
                        ${pos.weightOnly ? "text-[#4a6080]" : isWinner ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {pos.weightOnly ? "—" : `${pos.pnlPct >= 0 ? "+" : ""}${pos.pnlPct.toFixed(1)}%`}
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
                        {pos.weightOnly ? "—" : `${pos.daysHeld}d`}
                      </td>

                      {/* R-Multiple */}
                      <td className={`px-2 py-1.5 text-right font-mono font-bold
                        ${isHighR ? "text-[#00ff88]"
                          : pos.rMultiple > 0 ? "text-[#00d4ff]"
                          : "text-[#ff4757]"}`}>
                        {pos.weightOnly ? "—" : `${pos.rMultiple >= 0 ? "+" : ""}${pos.rMultiple.toFixed(2)}R`}
                        {!pos.weightOnly && isHighR && " 🔥"}
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

          {/* Trigger ladder — every held name's distance to the level that moves
              the book, grouped by tier. Same numbers as the email trigger card. */}
          <div className="mt-2.5 pt-2 border-t border-[#1e2d4a]/50">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[0.6rem] text-[#4a6080] font-mono tracking-wider">
                TRIGGER LADDER
              </span>
              <span className="text-[0.6rem] text-[#2a3d5a] font-mono">
                0 · {LADDER_NEAR}% · 6% · {LADDER_SCALE}% · ! = inside {LADDER_NEAR}%
              </span>
            </div>

            {ladderGroups.map(g => (
              <div key={g.weight} className="mb-1.5">
                <div className="text-[0.6rem] text-[#4a6080] font-mono mb-0.5">{g.label}</div>
                {g.members.map(p => {
                  const near = p.stopDistPct < LADDER_NEAR;
                  const tone = weightTone(p.targetWeight);
                  const fill = near ? "#ff4757"
                    : tone === "full" ? "#00d4ff"
                    : tone === "trim" ? "#7dd3fc"
                    : "#ffa502";
                  // Where this row lands if it flips. A 100% name below its own
                  // 200-day skips the trim tier and drops straight to the floor.
                  const dest = p.targetWeight >= WEIGHT_FULL
                    ? (p.aboveSma200 === false ? WEIGHT_FLOOR : WEIGHT_TRIM)
                    : WEIGHT_FULL;
                  const showDest = p.targetWeight >= WEIGHT_FULL && dest !== WEIGHT_TRIM;
                  const word = p.targetWeight >= WEIGHT_FULL ? "below" : "above";
                  return (
                    <div
                      key={p.symbol}
                      className="flex items-center gap-1.5 font-mono text-[0.65rem] leading-[13px]"
                      title={`${p.symbol} — a close ${word} ${p.stopPrice > 0 ? p.stopPrice.toFixed(2) : "—"} moves it to ${dest}%`}
                    >
                      <span className="w-2 text-[#ff4757]">{near ? "!" : ""}</span>
                      <span className="w-[54px] text-[#c8d8f0]">{p.symbol}</span>
                      <span className="w-[52px] text-right text-[#4a6080]">
                        {p.stopPrice > 0 ? p.stopPrice.toFixed(2) : "—"}
                      </span>
                      <span className="relative flex-1 h-[7px] bg-[#141d33] rounded-sm">
                        <span
                          className="absolute left-0 top-0 h-[7px] rounded-sm"
                          style={{ width: `${Math.min(p.stopDistPct / LADDER_SCALE, 1) * 100}%`, background: fill }}
                        />
                        <span className="absolute left-[16.7%] top-[-2px] h-[11px] w-px bg-[#3d5478]" />
                        <span className="absolute left-[50%] top-[-2px] h-[11px] w-px bg-[#2a3d5a]" />
                      </span>
                      <span className={`w-[34px] text-right ${near ? "text-[#ff4757]" : "text-[#6b85a0]"}`}>
                        {p.stopDistPct.toFixed(1)}%
                      </span>
                      {showDest && <span className="w-[30px] text-right text-[#ffa502]">&rarr;{dest}</span>}
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="mt-1 text-[0.6rem] text-[#2a3d5a] font-mono">
              Bar = % away from the level that moves the book · fixed 0&ndash;{LADDER_SCALE}% scale · a flip-up also needs Close &gt; SMA50 to license a long
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-2 text-[0.6rem] text-[#2a3d5a] font-mono">
            Asymmetric sizing: every name is held — 100% in an ST long · 70% when ST is bearish but price holds its own 200-day SMA · 40% floor below it. Rows with “—” have no ST long, so no entry price or P&amp;L; they are still held at the shown weight. A stop hit TRIMS to 40%, it does not exit. Avg P&amp;L / R / days cover ST longs only. Click row to jump to card
          </div>
        </div>
      )}
    </div>
  );
}
