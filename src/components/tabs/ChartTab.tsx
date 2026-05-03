"use client";
import { useState } from "react";
import { StockAnalysisResult, ChartBar, AppConfig } from "@/types";
import { supertrend } from "@/lib/indicators";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area,
} from "recharts";

// TimesfmPriceTargets imported inline to avoid circular deps
interface TimesfmPriceTargets {
  t1: number;
  t2: number;
  t3: number;
  p10: number[];
  p50: number[];
  p90: number[];
  st_persistence?: {
    current_dir: number;
    persistence_prob: number;
    flip_risk: string;
    p50_distances: number[];
  };
}

interface Props {
  result: StockAnalysisResult;
  config: AppConfig;
  timesfm?: TimesfmPriceTargets;
}

type Range = "1M" | "3M" | "6M" | "1Y" | "2Y";
const RANGE_BARS: Record<Range, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "2Y": 500 };

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const parts = iso.split("T")[0].split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  return `${m}/${d}/${y.slice(2)}`;
}

const EntryMarker = (props: { cx?: number; cy?: number; value?: number }) => {
  if (!props.value || !props.cx || !props.cy) return null;
  const { cx, cy } = props;
  return (
    <g>
      <polygon points={`${cx},${cy - 9} ${cx - 6},${cy + 3} ${cx + 6},${cy + 3}`} fill="#00ff88" stroke="#00ff88" strokeWidth={1} opacity={0.95} />
      <line x1={cx} y1={cy + 3} x2={cx} y2={cy + 14} stroke="#00ff88" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
    </g>
  );
};

const ExitMarker = (props: { cx?: number; cy?: number; value?: number }) => {
  if (!props.value || !props.cx || !props.cy) return null;
  const { cx, cy } = props;
  return (
    <g>
      <polygon points={`${cx},${cy + 9} ${cx - 6},${cy - 3} ${cx + 6},${cy - 3}`} fill="#ff4757" stroke="#ff4757" strokeWidth={1} opacity={0.95} />
      <line x1={cx} y1={cy - 3} x2={cx} y2={cy - 14} stroke="#ff4757" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
    </g>
  );
};

interface ChartDataPoint {
  date: string;
  dateShort: string;
  Close: number | null;
  SMA20: number | null;
  SMA50: number | null;
  EMA20: number | null;
  EMA50: number | null;
  BBU: number | null;
  BBL: number | null;
  ST_Bull: number | null;
  ST_Bear: number | null;
  Volume: number | null;
  RSI: number | null;
  "MACD H": number | null;
  Entry: number | null;
  Exit: number | null;
  P50?: number;
  P10?: number;
  P90?: number;
}

interface TTP { name: string; value: number; color: string; }
const PriceTooltip = ({ active, payload, label }: { active?: boolean; payload?: TTP[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const p = (name: string) => payload.find(x => x.name === name)?.value;
  const close = p("Close"); const sma20 = p("SMA20"); const sma50 = p("SMA50");
  const ema20 = p("EMA20"); const ema50 = p("EMA50");
  const stBull = p("ST_Bull"); const stBear = p("ST_Bear");
  const vol = p("Volume"); const rsi = p("RSI"); const macdH = p("MACD H");
  const entry = p("Entry"); const exit = p("Exit");
  const p50 = p("P50"); const p10 = p("P10"); const p90 = p("P90");
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2.5 py-2 text-xs font-mono shadow-xl max-w-[250px]">
      <div className="text-[#6b85a0] mb-1.5 border-b border-[#1e2d4a] pb-1">{label}</div>
      {close  != null && <div className="text-[#c8d8f0]">Close: <span className="text-[#00d4ff] font-bold">{close.toFixed(2)}</span></div>}
      {sma20  != null && <div className="text-[#00ff88]">SMA20: {sma20.toFixed(2)}</div>}
      {sma50  != null && <div className="text-[#ff7f50]">SMA50: {sma50.toFixed(2)}</div>}
      {ema20  != null && <div className="text-[#a78bfa]">EMA20: {ema20.toFixed(2)}</div>}
      {ema50  != null && <div className="text-[#f59e0b]">EMA50: {ema50.toFixed(2)}</div>}
      {stBull != null && <div className="text-[#00ff88]">ST 🟢: {stBull.toFixed(2)}</div>}
      {stBear != null && <div className="text-[#ff4757]">ST 🔴: {stBear.toFixed(2)}</div>}
      {rsi    != null && <div className="text-[#a78bfa]">RSI: {rsi.toFixed(1)}</div>}
      {macdH  != null && <div className={macdH >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>MACD H: {macdH.toFixed(3)}</div>}
      {vol    != null && <div className="text-[#4a6080]">Vol: {(vol / 1_000_000).toFixed(1)}M</div>}
      {p50    != null && <div className="text-[#a78bfa]">P50 Fcst: {p50.toFixed(2)}</div>}
      {p10    != null && <div className="text-[#4a6080]">P10 band: {p10.toFixed(2)}</div>}
      {p90    != null && <div className="text-[#4a6080]">P90 band: {p90.toFixed(2)}</div>}
      {entry  != null && <div className="text-[#00ff88] font-bold mt-1">▲ ENTRY @ {entry.toFixed(2)}</div>}
      {exit   != null && <div className="text-[#ff4757] font-bold mt-1">▼ EXIT @ {exit.toFixed(2)}</div>}
    </div>
  );
};

export default function ChartTab({ result, config, timesfm }: Props) {
  const [range, setRange]           = useState<Range>("1Y");
  const [showSMA, setShowSMA]       = useState(true);
  const [showEMA20, setShowEMA20]   = useState(false);
  const [showEMA50, setShowEMA50]   = useState(false);
  const [showBB, setShowBB]         = useState(true);
  const [showST, setShowST]         = useState(true);
  const [showVol, setShowVol]       = useState(true);
  const [showRSI, setShowRSI]       = useState(false);
  const [showMACD, setShowMACD]     = useState(false);
  const [showTrades, setShowTrades] = useState(true);

  // ── EARLY RETURNS before any data access ─────────────────────
  if (!result) {
    return <div className="p-4 text-[#4a6080] text-xs">No result data.</div>;
  }

  const rawChartBars = result.chart_bars;
  if (!rawChartBars || !Array.isArray(rawChartBars) || rawChartBars.length === 0) {
    return <div className="p-4 text-[#4a6080] text-xs">Chart data unavailable.</div>;
  }

  const chartBars: ChartBar[] = rawChartBars;
  const bt        = result.backtest;
  const optParams = result.st_opt_params;
  const optLabel  = optParams ? `ATR${optParams.atrPeriod} × ${optParams.multiplier}` : null;

  const barsToShow = Math.min(RANGE_BARS[range], chartBars.length);
  const sliced: ChartBar[] = chartBars.slice(-barsToShow);

  if (sliced.length === 0) {
    return <div className="p-4 text-[#4a6080] text-xs">Chart data unavailable for selected range.</div>;
  }

  // ── Compute optimized ST on full chartBars, slice to view ────
  const optAtr = optParams?.atrPeriod ?? 10;
  const optMul = optParams?.multiplier ?? 3.0;

  const allHighs:  number[] = chartBars.map(b => (b.high  ?? b.close ?? 0));
  const allLows:   number[] = chartBars.map(b => (b.low   ?? b.close ?? 0));
  const allCloses: number[] = chartBars.map(b => (b.close ?? 0));

  const [fullStLine, fullStDir] = supertrend(allHighs, allLows, allCloses, optAtr, optMul);
  const offset    = Math.max(0, chartBars.length - barsToShow);
  const optStLine = Array.isArray(fullStLine) ? fullStLine.slice(offset) : [];
  const optStDir  = Array.isArray(fullStDir)  ? fullStDir.slice(offset)  : [];

  // ── Trade maps ───────────────────────────────────────────────
  const entryMap: Record<string, number> = {};
  const exitMap:  Record<string, number> = {};
  for (const t of bt?.trades ?? []) {
    if (t.entry_date) entryMap[t.entry_date] = t.entry_price;
    if (t.exit_date)  exitMap[t.exit_date]   = t.exit_price;
  }

  // ── Build chart data ─────────────────────────────────────────
  let chartData: ChartDataPoint[] = sliced.map((b, i) => {
    const stVal = (optStLine[i] != null && !isNaN(optStLine[i])) ? optStLine[i] : null;
    const stDir = optStDir[i] ?? -1;
    return {
      date: b.date ?? "", dateShort: (b.date ?? "").slice(5),
      Close: b.close ?? null,
      SMA20: (b.sma20 != null && !isNaN(b.sma20)) ? b.sma20 : null,
      SMA50: (b.sma50 != null && !isNaN(b.sma50)) ? b.sma50 : null,
      EMA20: (b.ema20 != null && !isNaN(b.ema20)) ? b.ema20 : null,
      EMA50: (b.ema50 != null && !isNaN(b.ema50)) ? b.ema50 : null,
      BBU:   (b.bbUpper != null && !isNaN(b.bbUpper)) ? b.bbUpper : null,
      BBL:   (b.bbLower != null && !isNaN(b.bbLower)) ? b.bbLower : null,
      ST_Bull: (stVal !== null && stDir === 1)  ? stVal : null,
      ST_Bear: (stVal !== null && stDir === -1) ? stVal : null,
      Volume: b.volume ?? null,
      RSI:    b.rsi ?? null,
      "MACD H": b.macdHist ?? null,
      Entry: entryMap[b.date ?? ""] ?? null,
      Exit:  exitMap[b.date ?? ""]  ?? null,
    };
  });

  // ── TimesFM forecast overlay ──────────────────────────────────
  if (timesfm && Array.isArray(timesfm.p50) && timesfm.p50.length > 0) {
    const p10 = timesfm.p10 ?? [];
    const p50 = timesfm.p50;
    const p90 = timesfm.p90 ?? [];
    const forecastBars: ChartDataPoint[] = p50.map((v, i) => ({
      date: `F+${i + 1}`, dateShort: `+${i + 1}`,
      Close: null, SMA20: null, SMA50: null, EMA20: null, EMA50: null,
      BBU: null, BBL: null, ST_Bull: null, ST_Bear: null,
      Volume: null, RSI: null, "MACD H": null, Entry: null, Exit: null,
      P50: v,
      P10: p10[i] ?? undefined,
      P90: p90[i] ?? undefined,
    }));
    chartData = [...chartData, ...forecastBars];
  }

  // ── Y-axis domain ─────────────────────────────────────────────
  const prices = chartData.map(d => d.Close).filter((v): v is number => v != null);
  const extras: number[] = [
    ...(showBB    ? chartData.flatMap(d => [d.BBU, d.BBL]).filter((v): v is number => v != null) : []),
    ...(showST    ? chartData.map(d => d.ST_Bull ?? d.ST_Bear).filter((v): v is number => v != null) : []),
    ...(showEMA20 ? chartData.map(d => d.EMA20).filter((v): v is number => v != null) : []),
    ...(showEMA50 ? chartData.map(d => d.EMA50).filter((v): v is number => v != null) : []),
  ];
  const allY = [...prices, ...extras];
  const yPad = allY.length > 0 ? (Math.max(...allY) - Math.min(...allY)) * 0.05 || 1 : 1;
  const yMin = allY.length > 0 ? Math.min(...allY) - yPad : 0;
  const yMax = allY.length > 0 ? Math.max(...allY) + yPad : 100;

  // ── X-axis ticks ──────────────────────────────────────────────
  const tickCount  = Math.min(8, chartData.length);
  const tickStep   = Math.max(1, Math.floor(chartData.length / tickCount));
  const sparseTicks = chartData
    .filter((_, i) => i === 0 || i === chartData.length - 1 || i % tickStep === 0)
    .map(d => d.dateShort);

  // ── Trade lists ───────────────────────────────────────────────
  const datesInView    = new Set(sliced.map(b => b.date ?? ""));
  const allScoreTrades = bt?.trades ?? [];
  const allStTrades    = result.comparison?.supertrend?.trades ?? [];
  const tradesInView   = allScoreTrades.filter(t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date));
  const stTradesInView = allStTrades.filter(t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date));

  const subCount = (showVol ? 1 : 0) + (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  const priceH   = subCount === 0 ? 280 : subCount === 1 ? 230 : 190;
  const subH     = 70;

  const Tog = ({ label, active, onClick, activeClass }: { label: string; active: boolean; onClick: () => void; activeClass: string }) => (
    <button onClick={onClick} className={`px-2 py-0.5 text-xs rounded border transition-all ${active ? activeClass : "border-[#1e2d4a] text-[#4a6080] hover:border-[#4a6080]"}`}>{label}</button>
  );
  const RangeBtn = ({ r }: { r: Range }) => (
    <button onClick={() => setRange(r)} className={`px-2 py-0.5 text-xs rounded border transition-all ${range === r ? "bg-[#00d4ff]/15 border-[#00d4ff] text-[#00d4ff]" : "border-[#1e2d4a] text-[#4a6080] hover:border-[#00d4ff]/40"}`}>{r}</button>
  );

  // ── ST status values ──────────────────────────────────────────
  const lastOptDir = optStDir.length > 0 ? (optStDir[optStDir.length - 1] ?? -1) : -1;
  const lastOptST  = optStLine.length > 0 ? (optStLine[optStLine.length - 1] ?? 0) : 0;
  const lastClose  = sliced.length > 0 ? (sliced[sliced.length - 1].close ?? result.current_price) : result.current_price;
  const stDist     = lastOptST > 0 && lastClose > 0 ? ((lastClose - lastOptST) / lastClose) * 100 : 0;
  const openRet    = result.st_open_return_pct;

  return (
    <div className="p-3 space-y-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1">{(["1M","3M","6M","1Y","2Y"] as Range[]).map(r => <RangeBtn key={r} r={r} />)}</div>
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog label="SMA"   active={showSMA}    onClick={() => setShowSMA(v => !v)}    activeClass="border-[#ffa502]/60 text-[#ffa502] bg-[#ffa502]/10" />
        <Tog label="EMA20" active={showEMA20}  onClick={() => setShowEMA20(v => !v)}  activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="EMA50" active={showEMA50}  onClick={() => setShowEMA50(v => !v)}  activeClass="border-[#f59e0b]/70 text-[#f59e0b] bg-[#f59e0b]/10" />
        <Tog label="BB"    active={showBB}     onClick={() => setShowBB(v => !v)}     activeClass="border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/08" />
        <Tog label="ST"    active={showST}     onClick={() => setShowST(v => !v)}     activeClass="border-[#f97316]/60 text-[#f97316] bg-[#f97316]/10" />
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog label="Vol"  active={showVol}  onClick={() => setShowVol(v => !v)}   activeClass="border-[#6b85a0]/60 text-[#6b85a0] bg-[#6b85a0]/10" />
        <Tog label="RSI"  active={showRSI}  onClick={() => setShowRSI(v => !v)}   activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="MACD" active={showMACD} onClick={() => setShowMACD(v => !v)}  activeClass="border-[#34d399]/60 text-[#34d399] bg-[#34d399]/10" />
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog label={`Trades${showTrades ? ` (${allScoreTrades.length}S ${allStTrades.length}ST)` : ""}`}
          active={showTrades} onClick={() => setShowTrades(v => !v)}
          activeClass="border-[#00ff88]/50 text-[#00ff88] bg-[#00ff88]/08" />
      </div>

      {/* Price chart */}
      <div style={{ height: priceH }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
            <XAxis dataKey="dateShort" tick={{ fontSize: 9, fill: "#4a6080" }} tickLine={false} axisLine={{ stroke: "#1e2d4a" }} ticks={sparseTicks} />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: "#4a6080" }} tickFormatter={(v: number) => v.toFixed(1)} width={46} tickLine={false} />
            <Tooltip content={<PriceTooltip />} />
            {showBB && <>
              <Line dataKey="BBU" stroke="#00d4ff" strokeWidth={1} dot={false} strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" name="BB Upper" />
              <Line dataKey="BBL" stroke="#00d4ff" strokeWidth={1} dot={false} strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" name="BB Lower" />
            </>}
            {showSMA && <>
              <Line dataKey="SMA20" stroke="#00ff88" strokeWidth={1.5} dot={false} strokeOpacity={0.85} legendType="none" name="SMA20" />
              <Line dataKey="SMA50" stroke="#ff7f50" strokeWidth={1.5} dot={false} strokeOpacity={0.85} legendType="none" name="SMA50" />
            </>}
            {showEMA20 && <Line dataKey="EMA20" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeOpacity={0.9} strokeDasharray="4 2" legendType="none" name="EMA20" />}
            {showEMA50 && <Line dataKey="EMA50" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeOpacity={0.9} strokeDasharray="6 3" legendType="none" name="EMA50" />}
            {showST && <>
              <Line dataKey="ST_Bull" stroke="#00ff88" strokeWidth={2} dot={false} strokeOpacity={0.9} strokeDasharray="5 2" legendType="none" name="ST_Bull" connectNulls={false} />
              <Line dataKey="ST_Bear" stroke="#ff4757" strokeWidth={2} dot={false} strokeOpacity={0.9} strokeDasharray="5 2" legendType="none" name="ST_Bear" connectNulls={false} />
            </>}
            <Line dataKey="Close" stroke="#00d4ff" strokeWidth={2} dot={false} name="Close" activeDot={{ r: 3, fill: "#00d4ff", stroke: "#0a0e1a" }} legendType="none" />
            {showTrades && <>
              <Line dataKey="Entry" stroke="transparent" dot={<EntryMarker />} activeDot={false} name="Entry" legendType="none" isAnimationActive={false} />
              <Line dataKey="Exit"  stroke="transparent" dot={<ExitMarker />}  activeDot={false} name="Exit"  legendType="none" isAnimationActive={false} />
            </>}
            <ReferenceLine y={result.current_price} stroke="#c8d8f0" strokeDasharray="4 2" strokeOpacity={0.3}
              label={{ value: result.current_price.toFixed(2), position: "right", fontSize: 9, fill: "#6b85a0" }} />
            {timesfm && Array.isArray(timesfm.p50) && timesfm.p50.length > 0 && <>
              <Line dataKey="P50" stroke="#a78bfa" strokeWidth={2} dot={false} strokeDasharray="5 5" name="P50 Forecast" connectNulls={false} />
              <Area dataKey="P90" stroke="none" fill="#a78bfa" fillOpacity={0.1} name="P90 band" />
              <Area dataKey="P10" stroke="none" fill="#a78bfa" fillOpacity={0.1} name="P10 band" />
            </>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Sub-charts */}
      {showVol && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46} tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`} />
              <Bar dataKey="Volume" name="Volume" fill="#4a6080" opacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#4a6080] text-[0.6rem] text-right pr-2 -mt-1">VOLUME</div>
        </div>
      )}
      {showRSI && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "#4a6080" }} width={46} />
              <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
              <ReferenceLine y={70} stroke="#ff4757" strokeDasharray="3 3" strokeOpacity={0.5} />
              <ReferenceLine y={30} stroke="#00ff88" strokeDasharray="3 3" strokeOpacity={0.5} />
              <Line dataKey="RSI" name="RSI" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#a78bfa] text-[0.6rem] text-right pr-2 -mt-1">RSI(14)</div>
        </div>
      )}
      {showMACD && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46} tickFormatter={(v: number) => v.toFixed(2)} />
              <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
              <ReferenceLine y={0} stroke="#4a6080" />
              <Bar dataKey="MACD H" name="MACD H" fill="#34d399" opacity={0.8} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#34d399] text-[0.6rem] text-right pr-2 -mt-1">MACD HISTOGRAM</div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[0.65rem] text-[#4a6080] pt-1">
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-[#00d4ff] inline-block rounded" /> Price</span>
        {showSMA && <>
          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-[#00ff88] inline-block rounded" /> SMA20</span>
          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-[#ff7f50] inline-block rounded" /> SMA50</span>
        </>}
        {showEMA20 && <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #a78bfa" }} /> EMA20</span>}
        {showEMA50 && <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #f59e0b" }} /> EMA50</span>}
        {showST && <>
          <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #00ff88" }} /> ST Bull</span>
          <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #ff4757" }} /> ST Bear</span>
        </>}
        {timesfm && <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #a78bfa" }} /> P50 Forecast</span>}
        {showTrades && <>
          <span className="flex items-center gap-1.5"><span className="text-[#00ff88] text-sm leading-none">▲</span> Entry</span>
          <span className="flex items-center gap-1.5"><span className="text-[#ff4757] text-sm leading-none">▼</span> Exit</span>
        </>}
      </div>

      {/* ST Status strip */}
      <div className={`flex items-center gap-3 px-2 py-1 rounded border text-xs font-mono ${lastOptDir === 1 ? "border-[#00ff88]/30 bg-[#00ff88]/5" : "border-[#ff4757]/30 bg-[#ff4757]/5"}`}>
        <span className={lastOptDir === 1 ? "text-[#00ff88] font-bold" : "text-[#ff4757] font-bold"}>
          {lastOptDir === 1 ? "🟢 ST BULLISH" : "🔴 ST BEARISH"}
        </span>
        {lastOptST > 0 && <span className="text-[#4a6080]">line: <span className="text-[#c8d8f0]">{lastOptST.toFixed(2)}</span></span>}
        {lastOptDir === 1 && <span className="text-[#4a6080]">dist: <span className="text-[#c8d8f0]">{stDist.toFixed(1)}%</span></span>}
        {lastOptDir === 1 && openRet !== null && openRet !== undefined && (
          <span className="text-[#4a6080]">open: <span className={openRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>{openRet >= 0 ? "+" : ""}{openRet.toFixed(1)}%</span></span>
        )}
        {lastOptDir === -1 && <span className="text-[#4a6080]">wait for flip to bullish before entry</span>}
        {optLabel && (
          <span className="ml-auto text-[#ffa502] border border-[#ffa502]/40 rounded px-1.5 py-0.5 text-[0.6rem] font-mono">
            {optLabel}
          </span>
        )}
      </div>

      {/* Score Trades */}
      {showTrades && allScoreTrades.length > 0 && (
        <div className="mt-1">
          <div className="text-[#00d4ff] text-xs mb-1 font-bold">
            SCORE TRADES — {allScoreTrades.length} total ·{" "}
            <span className="text-[#00ff88]">{allScoreTrades.filter(t => t.return > 0).length}W</span>{" "}
            <span className="text-[#ff4757]">{allScoreTrades.filter(t => t.return <= 0).length}L</span>
            <span className="text-[#4a6080] font-normal ml-2 text-[0.65rem]">({tradesInView.length} in chart view)</span>
          </div>
          <div className="overflow-x-auto rounded border border-[#1e2d4a]/60 max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="text-[#4a6080] bg-[#0f1629] border-b border-[#1e2d4a]">
                  <th className="text-left py-1 px-2">#</th><th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th><th className="text-right py-1 px-2">In $</th>
                  <th className="text-right py-1 px-2">Out $</th><th className="text-right py-1 px-2">Ret%</th>
                  <th className="text-right py-1 px-2">R</th><th className="text-right py-1 px-2">Bars</th>
                  <th className="text-left py-1 px-2">Reason</th><th className="text-left py-1 px-2">Regime</th>
                </tr>
              </thead>
              <tbody>
                {[...allScoreTrades].reverse().map(t => {
                  const inView = datesInView.has(t.entry_date) || datesInView.has(t.exit_date);
                  return (
                    <tr key={t.trade_num} className={`border-b border-[#1e2d4a]/30 hover:bg-[#00d4ff]/5 ${t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"} ${inView ? "ring-1 ring-inset ring-[#00d4ff]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#00ff88]">▲</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.entry_date)}</span></td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ff4757]">▼</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.exit_date)}</span></td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.entry_price.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.exit_price.toFixed(2)}</td>
                      <td className={`py-1 px-2 text-right font-mono font-bold ${t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>{t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%</td>
                      <td className={`py-1 px-2 text-right font-mono ${t.r_multiple > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>{t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(2)}R</td>
                      <td className="py-1 px-2 text-right text-[#6b85a0]">{t.bars_held}</td>
                      <td className="py-1 px-2 text-[#6b85a0] max-w-[90px] truncate">{t.exit_reason}</td>
                      <td className="py-1 px-2 text-[#4a6080] text-[0.6rem] max-w-[80px] truncate">{t.entry_regime?.replace(/_/g, " ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ST Trades */}
      {allStTrades.length > 0 && showTrades && (
        <div className="mt-2">
          <div className="text-[#ffa502] text-xs mb-1 font-bold">
            ST TRADES — {allStTrades.length} total ·{" "}
            <span className="text-[#00ff88]">{allStTrades.filter(t => t.return > 0).length}W</span>{" "}
            <span className="text-[#ff4757]">{allStTrades.filter(t => t.return <= 0).length}L</span>
            <span className="text-[#4a6080] font-normal ml-2 text-[0.65rem]">
              ({stTradesInView.length} in view{optLabel ? ` · ${optLabel}` : ""})
            </span>
          </div>
          <div className="overflow-x-auto rounded border border-[#ffa502]/20 max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="text-[#4a6080] bg-[#0f1629] border-b border-[#1e2d4a]">
                  <th className="text-left py-1 px-2">#</th><th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th><th className="text-right py-1 px-2">In $</th>
                  <th className="text-right py-1 px-2">Out $</th><th className="text-right py-1 px-2">Ret%</th>
                  <th className="text-right py-1 px-2">R</th><th className="text-right py-1 px-2">Bars</th>
                  <th className="text-left py-1 px-2">Exit</th>
                </tr>
              </thead>
              <tbody>
                {[...allStTrades].reverse().map(t => {
                  const inView = datesInView.has(t.entry_date) || datesInView.has(t.exit_date);
                  return (
                    <tr key={t.trade_num} className={`border-b border-[#1e2d4a]/30 hover:bg-[#ffa502]/5 ${t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"} ${inView ? "ring-1 ring-inset ring-[#ffa502]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ffa502]">▲</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.entry_date)}</span></td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ff4757]">▼</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.exit_date)}</span></td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.entry_price.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.exit_price.toFixed(2)}</td>
                      <td className={`py-1 px-2 text-right font-mono font-bold ${t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>{t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%</td>
                      <td className={`py-1 px-2 text-right font-mono ${t.r_multiple > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>{t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(2)}R</td>
                      <td className="py-1 px-2 text-right text-[#6b85a0]">{t.bars_held}</td>
                      <td className="py-1 px-2 text-[#ffa502]/70 text-[0.6rem] truncate">{t.exit_reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
