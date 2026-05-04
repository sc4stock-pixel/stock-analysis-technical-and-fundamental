"use client";
import { useState } from "react";
import { StockAnalysisResult, ChartBar, AppConfig } from "@/types";
import { supertrend } from "@/lib/indicators";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, BarChart, Cell,
} from "recharts";

interface TimesfmStPersistence {
  current_dir: number;
  persistence_prob: number;
  flip_risk: string;
  p50_distances: number[];
}

interface TimesfmPriceTargets {
  t1: number;
  t2: number;
  t3: number;
  p10: number[];
  p50: number[];
  p90: number[];
  st_persistence?: TimesfmStPersistence;
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
  P50: number | null;
  TunnelLo: number | null;
  TunnelHi: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PriceTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const get = (name: string) => payload.find((x: {name:string;value:number}) => x.name === name)?.value as number | undefined;
  const close = get("Close"); const p50 = get("P50");
  const sma20 = get("SMA20"); const sma50 = get("SMA50");
  const ema20 = get("EMA20"); const ema50 = get("EMA50");
  const stBull = get("ST_Bull"); const stBear = get("ST_Bear");
  const vol = get("Volume"); const rsi = get("RSI"); const macdH = get("MACD H");
  const entry = get("Entry"); const exit = get("Exit");
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2.5 py-2 text-xs font-mono shadow-xl max-w-[220px]">
      <div className="text-[#6b85a0] mb-1.5 border-b border-[#1e2d4a] pb-1">{label}{p50 != null ? " 🔮" : ""}</div>
      {close  != null && <div className="text-[#c8d8f0]">Close: <span className="text-[#00d4ff] font-bold">{close.toFixed(2)}</span></div>}
      {p50    != null && <div className="text-[#a78bfa] font-bold">P50 Forecast: {p50.toFixed(2)}</div>}
      {sma20  != null && <div className="text-[#00ff88]">SMA20: {sma20.toFixed(2)}</div>}
      {sma50  != null && <div className="text-[#ff7f50]">SMA50: {sma50.toFixed(2)}</div>}
      {ema20  != null && <div className="text-[#a78bfa]">EMA20: {ema20.toFixed(2)}</div>}
      {ema50  != null && <div className="text-[#f59e0b]">EMA50: {ema50.toFixed(2)}</div>}
      {stBull != null && <div className="text-[#00ff88]">ST 🟢: {stBull.toFixed(2)}</div>}
      {stBear != null && <div className="text-[#ff4757]">ST 🔴: {stBear.toFixed(2)}</div>}
      {rsi    != null && <div className="text-[#a78bfa]">RSI: {rsi.toFixed(1)}</div>}
      {macdH  != null && <div className={macdH >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>MACD H: {macdH.toFixed(3)}</div>}
      {vol    != null && <div className="text-[#4a6080]">Vol: {(vol / 1_000_000).toFixed(1)}M</div>}
      {entry  != null && <div className="text-[#00ff88] font-bold mt-1">▲ ENTRY @ {entry.toFixed(2)}</div>}
      {exit   != null && <div className="text-[#ff4757] font-bold mt-1">▼ EXIT @ {exit.toFixed(2)}</div>}
    </div>
  );
};

// ── Phase 2: Persistence Histogram ───────────────────────────
function PersistenceHistogram({ persistence, stDir }: {
  persistence: TimesfmStPersistence;
  stDir: number;
}) {
  const p50 = Array.isArray(persistence.p50_distances) ? persistence.p50_distances : [];

  const survivalAt = (day: number): number => {
    const slice = p50.slice(0, Math.min(day, p50.length));
    if (slice.length === 0) return Math.round(persistence.persistence_prob);
    const sameSide = slice.filter(v => stDir === 1 ? v > 0 : v < 0).length;
    return Math.round((sameSide / slice.length) * 100);
  };

  const bars = [
    { day: "5d",  prob: survivalAt(5) },
    { day: "10d", prob: survivalAt(10) },
    { day: "20d", prob: Math.round(persistence.persistence_prob) },
  ];

  const riskColor = (prob: number) =>
    prob >= 70 ? "#00ff88" : prob >= 45 ? "#ffa502" : "#ff4757";

  const riskLabel =
    persistence.flip_risk === "low"    ? { text: "LOW FLIP RISK",  color: "#00ff88" } :
    persistence.flip_risk === "medium" ? { text: "MED FLIP RISK",  color: "#ffa502" } :
                                         { text: "HIGH FLIP RISK", color: "#ff4757" };

  return (
    <div className="border border-[#1e2d4a] rounded p-2.5 bg-[#080d1a]">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <div className="text-[#a78bfa] text-[0.65rem] font-bold tracking-widest">🔮 ST PERSISTENCE</div>
          <div className="text-[#4a6080] text-[0.58rem] mt-0.5">Prob. trend direction holds</div>
        </div>
        <div className="text-right">
          <div className="text-[0.65rem] font-bold font-mono" style={{ color: riskLabel.color }}>{riskLabel.text}</div>
          <div className={`text-[0.58rem] font-mono ${stDir === 1 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
            {stDir === 1 ? "🟢 BULLISH" : "🔴 BEARISH"}
          </div>
        </div>
      </div>

      <div style={{ height: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 2, right: 4, left: 0, bottom: 0 }} barSize={28}>
            <CartesianGrid strokeDasharray="1 4" stroke="#1e2d4a" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#6b85a0" }} tickLine={false} axisLine={{ stroke: "#1e2d4a" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "#4a6080" }} tickLine={false} axisLine={false}
              width={26} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine y={50} stroke="#4a6080" strokeDasharray="3 3" strokeOpacity={0.6} />
            <Tooltip
              contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
              formatter={(v: number) => [`${v}%`, "Persist"]}
            />
            <Bar dataKey="prob" radius={[3, 3, 0, 0]}>
              {bars.map((b, i) => (
                <Cell key={i} fill={riskColor(b.prob)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-around mt-1">
        {bars.map(b => (
          <div key={b.day} className="text-center">
            <div className="text-[#4a6080] text-[0.58rem]">{b.day}</div>
            <div className="font-mono font-bold text-xs" style={{ color: riskColor(b.prob) }}>{b.prob}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChartTab({ result, config, timesfm }: Props) {
  // ── All hooks first ───────────────────────────────────────────
  const [range, setRange]             = useState<Range>("1Y");
  const [showSMA, setShowSMA]         = useState(true);
  const [showEMA20, setShowEMA20]     = useState(false);
  const [showEMA50, setShowEMA50]     = useState(false);
  const [showBB, setShowBB]           = useState(true);
  const [showST, setShowST]           = useState(true);
  const [showVol, setShowVol]         = useState(true);
  const [showRSI, setShowRSI]         = useState(false);
  const [showMACD, setShowMACD]       = useState(false);
  const [showTrades, setShowTrades]   = useState(true);
  const [showForecast, setShowForecast] = useState(true);

  // ── Early returns after hooks ─────────────────────────────────
  if (!result) return <div className="p-4 text-[#4a6080] text-xs">No result data.</div>;

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

  // ── Optimized ST ──────────────────────────────────────────────
  const optAtr = optParams?.atrPeriod ?? 10;
  const optMul = optParams?.multiplier ?? 3.0;
  const allHighs:  number[] = chartBars.map(b => b.high  ?? b.close ?? 0);
  const allLows:   number[] = chartBars.map(b => b.low   ?? b.close ?? 0);
  const allCloses: number[] = chartBars.map(b => b.close ?? 0);
  const [fullStLine, fullStDir] = supertrend(allHighs, allLows, allCloses, optAtr, optMul);
  const stOffset  = Math.max(0, chartBars.length - barsToShow);
  const optStLine = Array.isArray(fullStLine) ? fullStLine.slice(stOffset) : [];
  const optStDir  = Array.isArray(fullStDir)  ? fullStDir.slice(stOffset)  : [];

  // ── Trade maps ───────────────────────────────────────────────
  const entryMap: Record<string, number> = {};
  const exitMap:  Record<string, number> = {};
  for (const t of bt?.trades ?? []) {
    if (t.entry_date) entryMap[t.entry_date] = t.entry_price;
    if (t.exit_date)  exitMap[t.exit_date]   = t.exit_price;
  }

  // ── Build historical data points ──────────────────────────────
  const histData: ChartDataPoint[] = sliced.map((b, i) => {
    const stVal = (optStLine[i] != null && !isNaN(optStLine[i])) ? optStLine[i] : null;
    const stDir = optStDir[i] ?? -1;
    return {
      date: b.date ?? "", dateShort: (b.date ?? "").slice(5),
      Close:    b.close  ?? null,
      SMA20:    (!isNaN(b.sma20  ?? NaN)) ? b.sma20   : null,
      SMA50:    (!isNaN(b.sma50  ?? NaN)) ? b.sma50   : null,
      EMA20:    (!isNaN(b.ema20  ?? NaN)) ? b.ema20   : null,
      EMA50:    (!isNaN(b.ema50  ?? NaN)) ? b.ema50   : null,
      BBU:      (!isNaN(b.bbUpper ?? NaN)) ? b.bbUpper : null,
      BBL:      (!isNaN(b.bbLower ?? NaN)) ? b.bbLower : null,
      ST_Bull:  (stVal !== null && stDir === 1)  ? stVal : null,
      ST_Bear:  (stVal !== null && stDir === -1) ? stVal : null,
      Volume:   b.volume  ?? null,
      RSI:      b.rsi     ?? null,
      "MACD H": b.macdHist ?? null,
      Entry:    entryMap[b.date ?? ""] ?? null,
      Exit:     exitMap[b.date  ?? ""] ?? null,
      P50:      null,
      TunnelLo: null,
      TunnelHi: null,
    };
  });

  // ── Phase 1: Forecast tunnel data ────────────────────────────
  const lastClose = sliced.length > 0 ? (sliced[sliced.length - 1].close ?? result.current_price) : result.current_price;
  const lastDateShort = sliced.length > 0 ? (sliced[sliced.length - 1].date ?? "").slice(5) : "";

  const hasForecast =
    showForecast &&
    timesfm != null &&
    Array.isArray(timesfm.p50) && timesfm.p50.length > 0 &&
    Array.isArray(timesfm.p10) && timesfm.p10.length > 0 &&
    Array.isArray(timesfm.p90) && timesfm.p90.length > 0;

  const forecastPoints: ChartDataPoint[] = hasForecast ? [
    // Bridge point — connects history to forecast seamlessly
    {
      date: "bridge", dateShort: lastDateShort,
      Close: null, SMA20: null, SMA50: null, EMA20: null, EMA50: null,
      BBU: null, BBL: null, ST_Bull: null, ST_Bear: null,
      Volume: null, RSI: null, "MACD H": null, Entry: null, Exit: null,
      P50: lastClose, TunnelLo: lastClose, TunnelHi: lastClose,
    },
    ...timesfm!.p50.map((v, i) => ({
      date: `F+${i + 1}`, dateShort: `+${i + 1}d`,
      Close: null, SMA20: null, SMA50: null, EMA20: null, EMA50: null,
      BBU: null, BBL: null, ST_Bull: null, ST_Bear: null,
      Volume: null, RSI: null, "MACD H": null, Entry: null, Exit: null,
      P50: v,
      TunnelLo: timesfm!.p10[i] ?? v,
      TunnelHi: timesfm!.p90[i] ?? v,
    })),
  ] : [];

  const allData: ChartDataPoint[] = [...histData, ...forecastPoints];

  // ── Y-axis domain ─────────────────────────────────────────────
  const prices = histData.map(d => d.Close).filter((v): v is number => v != null);
  const tunnelVals: number[] = hasForecast
    ? [
        ...timesfm!.p10.filter((v): v is number => v != null),
        ...timesfm!.p90.filter((v): v is number => v != null),
      ]
    : [];
  const maVals: number[] = [
    ...(showBB    ? histData.flatMap(d => [d.BBU, d.BBL]).filter((v): v is number => v != null) : []),
    ...(showST    ? histData.map(d => d.ST_Bull ?? d.ST_Bear).filter((v): v is number => v != null) : []),
    ...(showEMA20 ? histData.map(d => d.EMA20).filter((v): v is number => v != null) : []),
    ...(showEMA50 ? histData.map(d => d.EMA50).filter((v): v is number => v != null) : []),
  ];
  const allY = [...prices, ...maVals, ...(hasForecast ? tunnelVals : [])];
  const yPad = allY.length > 1 ? (Math.max(...allY) - Math.min(...allY)) * 0.06 : 1;
  const yMin = allY.length > 0 ? Math.min(...allY) - yPad : 0;
  const yMax = allY.length > 0 ? Math.max(...allY) + yPad : 100;

  // ── X-axis ticks ──────────────────────────────────────────────
  const tickStep   = Math.max(1, Math.floor(allData.length / Math.min(8, allData.length)));
  const sparseTicks = allData
    .filter((_, i) => i === 0 || i === allData.length - 1 || i % tickStep === 0)
    .map(d => d.dateShort);

  // ── Trade lists ───────────────────────────────────────────────
  const datesInView    = new Set(sliced.map(b => b.date ?? ""));
  const allScoreTrades = bt?.trades ?? [];
  const allStTrades    = result.comparison?.supertrend?.trades ?? [];
  const tradesInView   = allScoreTrades.filter(t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date));
  const stTradesInView = allStTrades.filter(t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date));

  const subCount = (showVol ? 1 : 0) + (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  const priceH   = subCount === 0 ? 290 : subCount === 1 ? 240 : 195;
  const subH     = 70;

  // ── ST status ─────────────────────────────────────────────────
  const lastOptDir = optStDir.length > 0 ? (optStDir[optStDir.length - 1] ?? -1) : -1;
  const lastOptST  = optStLine.length > 0 ? (optStLine[optStLine.length - 1] ?? 0) : 0;
  const stDist     = lastOptST > 0 && lastClose > 0 ? ((lastClose - lastOptST) / lastClose) * 100 : 0;
  const openRet    = result.st_open_return_pct;
  const stPersistence = timesfm?.st_persistence;

  const Tog = ({ label, active, onClick, activeClass }: {
    label: string; active: boolean; onClick: () => void; activeClass: string;
  }) => (
    <button onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded border transition-all ${active ? activeClass : "border-[#1e2d4a] text-[#4a6080] hover:border-[#4a6080]"}`}>
      {label}
    </button>
  );
  const RangeBtn = ({ r }: { r: Range }) => (
    <button onClick={() => setRange(r)}
      className={`px-2 py-0.5 text-xs rounded border transition-all ${range === r ? "bg-[#00d4ff]/15 border-[#00d4ff] text-[#00d4ff]" : "border-[#1e2d4a] text-[#4a6080] hover:border-[#00d4ff]/40"}`}>
      {r}
    </button>
  );

  return (
    <div className="p-3 space-y-2">

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1">{(["1M","3M","6M","1Y","2Y"] as Range[]).map(r => <RangeBtn key={r} r={r} />)}</div>
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog label="SMA"    active={showSMA}    onClick={() => setShowSMA(v=>!v)}    activeClass="border-[#ffa502]/60 text-[#ffa502] bg-[#ffa502]/10" />
        <Tog label="EMA20"  active={showEMA20}  onClick={() => setShowEMA20(v=>!v)}  activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="EMA50"  active={showEMA50}  onClick={() => setShowEMA50(v=>!v)}  activeClass="border-[#f59e0b]/70 text-[#f59e0b] bg-[#f59e0b]/10" />
        <Tog label="BB"     active={showBB}     onClick={() => setShowBB(v=>!v)}     activeClass="border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/08" />
        <Tog label="ST"     active={showST}     onClick={() => setShowST(v=>!v)}     activeClass="border-[#f97316]/60 text-[#f97316] bg-[#f97316]/10" />
        {timesfm && (
          <Tog label="🔮 Forecast" active={showForecast} onClick={() => setShowForecast(v=>!v)}
            activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        )}
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog label="Vol"  active={showVol}  onClick={() => setShowVol(v=>!v)}  activeClass="border-[#6b85a0]/60 text-[#6b85a0] bg-[#6b85a0]/10" />
        <Tog label="RSI"  active={showRSI}  onClick={() => setShowRSI(v=>!v)}  activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="MACD" active={showMACD} onClick={() => setShowMACD(v=>!v)} activeClass="border-[#34d399]/60 text-[#34d399] bg-[#34d399]/10" />
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog
          label={`Trades${showTrades ? ` (${allScoreTrades.length}S ${allStTrades.length}ST)` : ""}`}
          active={showTrades} onClick={() => setShowTrades(v=>!v)}
          activeClass="border-[#00ff88]/50 text-[#00ff88] bg-[#00ff88]/08" />
      </div>

      {/* ── Main price chart (Phase 1: confidence tunnel overlay) ── */}
      <div style={{ height: priceH }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={allData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="tunnelGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.06} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
            <XAxis dataKey="dateShort" tick={{ fontSize: 9, fill: "#4a6080" }} tickLine={false}
              axisLine={{ stroke: "#1e2d4a" }} ticks={sparseTicks} />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: "#4a6080" }}
              tickFormatter={(v: number) => v.toFixed(1)} width={46} tickLine={false} />
            <Tooltip content={<PriceTooltip />} />

            {/* Forecast separator line */}
            {hasForecast && (
              <ReferenceLine x={lastDateShort} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.6}
                label={{ value: "▶ Forecast", position: "insideTopRight", fontSize: 8, fill: "#a78bfa" }} />
            )}

            {/* Phase 1: Confidence tunnel — P10 baseline + P10→P90 band */}
            {hasForecast && <>
              {/* Lower boundary (P10) */}
              <Area
                dataKey="TunnelLo"
                stroke="#a78bfa"
                strokeWidth={0.8}
                strokeOpacity={0.4}
                strokeDasharray="3 3"
                fill="transparent"
                legendType="none"
                name="P10"
                connectNulls={false}
              />
              {/* Upper boundary (P90) fills down to P10 — the cloud */}
              <Area
                dataKey="TunnelHi"
                stroke="#a78bfa"
                strokeWidth={0.8}
                strokeOpacity={0.4}
                strokeDasharray="3 3"
                fill="url(#tunnelGrad)"
                legendType="none"
                name="P90"
                connectNulls={false}
              />
              {/* P50 median forecast */}
              <Line
                dataKey="P50"
                stroke="#a78bfa"
                strokeWidth={2.2}
                dot={false}
                strokeDasharray="7 3"
                legendType="none"
                name="P50"
                connectNulls={false}
              />
            </>}

            {/* BB */}
            {showBB && <>
              <Line dataKey="BBU" stroke="#00d4ff" strokeWidth={1} dot={false} strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" name="BB Upper" />
              <Line dataKey="BBL" stroke="#00d4ff" strokeWidth={1} dot={false} strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" name="BB Lower" />
            </>}

            {/* SMA/EMA */}
            {showSMA && <>
              <Line dataKey="SMA20" stroke="#00ff88" strokeWidth={1.5} dot={false} strokeOpacity={0.85} legendType="none" name="SMA20" />
              <Line dataKey="SMA50" stroke="#ff7f50" strokeWidth={1.5} dot={false} strokeOpacity={0.85} legendType="none" name="SMA50" />
            </>}
            {showEMA20 && <Line dataKey="EMA20" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeOpacity={0.9} strokeDasharray="4 2" legendType="none" name="EMA20" />}
            {showEMA50 && <Line dataKey="EMA50" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeOpacity={0.9} strokeDasharray="6 3" legendType="none" name="EMA50" />}

            {/* SuperTrend */}
            {showST && <>
              <Line dataKey="ST_Bull" stroke="#00ff88" strokeWidth={2} dot={false} strokeOpacity={0.9} strokeDasharray="5 2" legendType="none" name="ST_Bull" connectNulls={false} />
              <Line dataKey="ST_Bear" stroke="#ff4757" strokeWidth={2} dot={false} strokeOpacity={0.9} strokeDasharray="5 2" legendType="none" name="ST_Bear" connectNulls={false} />
            </>}

            {/* Price */}
            <Line dataKey="Close" stroke="#00d4ff" strokeWidth={2} dot={false} name="Close"
              activeDot={{ r: 3, fill: "#00d4ff", stroke: "#0a0e1a" }} legendType="none" />

            {/* Trade markers */}
            {showTrades && <>
              <Line dataKey="Entry" stroke="transparent" dot={<EntryMarker />} activeDot={false} name="Entry" legendType="none" isAnimationActive={false} />
              <Line dataKey="Exit"  stroke="transparent" dot={<ExitMarker />}  activeDot={false} name="Exit"  legendType="none" isAnimationActive={false} />
            </>}

            <ReferenceLine y={result.current_price} stroke="#c8d8f0" strokeDasharray="4 2" strokeOpacity={0.3}
              label={{ value: result.current_price.toFixed(2), position: "right", fontSize: 9, fill: "#6b85a0" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Phase 1: Forecast target strip */}
      {hasForecast && timesfm && (
        <div className="flex items-center gap-2 flex-wrap text-[0.65rem] font-mono">
          <span className="text-[#a78bfa] font-bold">🔮</span>
          {[
            { label: "T1 5d",  val: timesfm.t1 },
            { label: "T2 10d", val: timesfm.t2 },
            { label: "T3 20d", val: timesfm.t3 },
          ].map(t => {
            const pct = result.current_price > 0
              ? ((t.val - result.current_price) / result.current_price) * 100
              : 0;
            return (
              <span key={t.label}
                className="flex items-center gap-1 border border-[#a78bfa]/30 rounded px-2 py-0.5 bg-[#a78bfa]/5">
                <span className="text-[#4a6080]">{t.label}:</span>
                <span className="text-[#a78bfa] font-bold">{t.val.toFixed(2)}</span>
                <span className={pct >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                </span>
              </span>
            );
          })}
          <span className="text-[#4a6080] text-[0.58rem] ml-1">P10–P90 cloud · P50 median dashed</span>
        </div>
      )}

      {/* Sub-charts (volume/RSI/MACD use histData only — no forecast bars) */}
      {showVol && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={histData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46}
                tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`} />
              <Bar dataKey="Volume" name="Volume" fill="#4a6080" opacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#4a6080] text-[0.6rem] text-right pr-2 -mt-1">VOLUME</div>
        </div>
      )}
      {showRSI && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={histData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
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
            <ComposedChart data={histData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46}
                tickFormatter={(v: number) => v.toFixed(2)} />
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
        {hasForecast && <>
          <span className="flex items-center gap-1.5"><span className="w-5 inline-block" style={{ borderTop: "2px dashed #a78bfa" }} /> P50 Forecast</span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-3 rounded-sm inline-block" style={{ background: "rgba(167,139,250,0.2)" }} /> P10–P90 Cloud
          </span>
        </>}
        {showTrades && <>
          <span className="flex items-center gap-1.5"><span className="text-[#00ff88] text-sm leading-none">▲</span> Entry</span>
          <span className="flex items-center gap-1.5"><span className="text-[#ff4757] text-sm leading-none">▼</span> Exit</span>
        </>}
      </div>

      {/* ── ST Status + Phase 2: Persistence side by side ── */}
      <div className={`grid gap-2 ${stPersistence ? "grid-cols-2" : "grid-cols-1"}`}>

        {/* ST Status */}
        <div className={`flex flex-col justify-center px-3 py-2.5 rounded border text-xs font-mono
          ${lastOptDir === 1 ? "border-[#00ff88]/30 bg-[#00ff88]/5" : "border-[#ff4757]/30 bg-[#ff4757]/5"}`}>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`font-bold ${lastOptDir === 1 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
              {lastOptDir === 1 ? "🟢 ST BULLISH" : "🔴 ST BEARISH"}
            </span>
            {optLabel && (
              <span className="text-[#ffa502] border border-[#ffa502]/40 rounded px-1.5 py-0.5 text-[0.6rem]">
                {optLabel}
              </span>
            )}
          </div>
          {lastOptST > 0 && (
            <div className="text-[#4a6080]">ST line: <span className="text-[#c8d8f0]">{lastOptST.toFixed(2)}</span></div>
          )}
          {lastOptDir === 1 && (
            <div className="text-[#4a6080]">Dist to stop: <span className="text-[#c8d8f0]">{stDist.toFixed(1)}%</span></div>
          )}
          {lastOptDir === 1 && openRet !== null && openRet !== undefined && (
            <div className="text-[#4a6080]">Open P&L:{" "}
              <span className={`font-bold ${openRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}`}>
                {openRet >= 0 ? "+" : ""}{openRet.toFixed(1)}%
              </span>
            </div>
          )}
          {lastOptDir === -1 && (
            <div className="text-[#4a6080] text-[0.6rem] mt-1">Wait for bullish flip before entry</div>
          )}
        </div>

        {/* Phase 2: Persistence Histogram */}
        {stPersistence && (
          <PersistenceHistogram persistence={stPersistence} stDir={lastOptDir} />
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
                  <th className="text-left py-1 px-2">#</th>
                  <th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th>
                  <th className="text-right py-1 px-2">In $</th>
                  <th className="text-right py-1 px-2">Out $</th>
                  <th className="text-right py-1 px-2">Ret%</th>
                  <th className="text-right py-1 px-2">R</th>
                  <th className="text-right py-1 px-2">Bars</th>
                  <th className="text-left py-1 px-2">Reason</th>
                  <th className="text-left py-1 px-2">Regime</th>
                </tr>
              </thead>
              <tbody>
                {[...allScoreTrades].reverse().map(t => {
                  const inView = datesInView.has(t.entry_date) || datesInView.has(t.exit_date);
                  return (
                    <tr key={t.trade_num}
                      className={`border-b border-[#1e2d4a]/30 hover:bg-[#00d4ff]/5
                        ${t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"}
                        ${inView ? "ring-1 ring-inset ring-[#00d4ff]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#00ff88]">▲</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.entry_date)}</span></td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ff4757]">▼</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.exit_date)}</span></td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.entry_price.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.exit_price.toFixed(2)}</td>
                      <td className={`py-1 px-2 text-right font-mono font-bold ${t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%
                      </td>
                      <td className={`py-1 px-2 text-right font-mono ${t.r_multiple > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(2)}R
                      </td>
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
                  <th className="text-left py-1 px-2">#</th>
                  <th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th>
                  <th className="text-right py-1 px-2">In $</th>
                  <th className="text-right py-1 px-2">Out $</th>
                  <th className="text-right py-1 px-2">Ret%</th>
                  <th className="text-right py-1 px-2">R</th>
                  <th className="text-right py-1 px-2">Bars</th>
                  <th className="text-left py-1 px-2">Exit</th>
                </tr>
              </thead>
              <tbody>
                {[...allStTrades].reverse().map(t => {
                  const inView = datesInView.has(t.entry_date) || datesInView.has(t.exit_date);
                  return (
                    <tr key={t.trade_num}
                      className={`border-b border-[#1e2d4a]/30 hover:bg-[#ffa502]/5
                        ${t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"}
                        ${inView ? "ring-1 ring-inset ring-[#ffa502]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ffa502]">▲</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.entry_date)}</span></td>
                      <td className="py-1 px-2 font-mono"><span className="text-[#ff4757]">▼</span><span className="text-[#6b85a0] ml-1">{fmtDate(t.exit_date)}</span></td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.entry_price.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono text-[#c8d8f0]">{t.exit_price.toFixed(2)}</td>
                      <td className={`py-1 px-2 text-right font-mono font-bold ${t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%
                      </td>
                      <td className={`py-1 px-2 text-right font-mono ${t.r_multiple > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                        {t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(2)}R
                      </td>
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
