"use client";
// ChartTab — real OHLCV price chart with entry/exit markers
// Uses chart_bars from the pipeline (actual close/open/high/low/volume)
// Entry ▲ = green triangle up | Exit ▼ = red triangle down
import { StockAnalysisResult, ChartBar } from "@/types";
import { useState } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

interface Props { result: StockAnalysisResult; }

type Range = "1M" | "3M" | "6M" | "1Y" | "2Y";
const RANGE_BARS: Record<Range, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "2Y": 500 };

// ── Custom entry/exit SVG markers rendered as chart dots ────────
const EntryMarker = (props: { cx?: number; cy?: number; value?: number }) => {
  if (!props.value || !props.cx || !props.cy) return null;
  const { cx, cy } = props;
  return (
    <g>
      <polygon
        points={`${cx},${cy - 9} ${cx - 6},${cy + 3} ${cx + 6},${cy + 3}`}
        fill="#00ff88" stroke="#00ff88" strokeWidth={1} opacity={0.95}
      />
      <line x1={cx} y1={cy + 3} x2={cx} y2={cy + 14} stroke="#00ff88" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
    </g>
  );
};

const ExitMarker = (props: { cx?: number; cy?: number; value?: number }) => {
  if (!props.value || !props.cx || !props.cy) return null;
  const { cx, cy } = props;
  return (
    <g>
      <polygon
        points={`${cx},${cy + 9} ${cx - 6},${cy - 3} ${cx + 6},${cy - 3}`}
        fill="#ff4757" stroke="#ff4757" strokeWidth={1} opacity={0.95}
      />
      <line x1={cx} y1={cy - 3} x2={cx} y2={cy - 14} stroke="#ff4757" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
    </g>
  );
};

// ── Tooltip ──────────────────────────────────────────────────────
interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}
const PriceTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const p = (name: string) => payload.find(x => x.name === name)?.value;
  const close = p("Close");
  const sma20 = p("SMA20");
  const sma50 = p("SMA50");
  const ema20 = p("EMA20");
  const ema50 = p("EMA50");
  const stBull = p("ST_Bull");
  const stBear = p("ST_Bear");
  const vol = p("Volume");
  const rsi = p("RSI");
  const macdH = p("MACD H");
  const entry = p("Entry");
  const exit = p("Exit");
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2.5 py-2 text-xs font-mono shadow-xl">
      <div className="text-[#6b85a0] mb-1.5 border-b border-[#1e2d4a] pb-1">{label}</div>
      {close != null && <div className="text-[#c8d8f0]">Close: <span className="text-[#00d4ff] font-bold">{close.toFixed(2)}</span></div>}
      {sma20 != null && <div className="text-[#00ff88]">SMA20: {sma20.toFixed(2)}</div>}
      {sma50 != null && <div className="text-[#ff7f50]">SMA50: {sma50.toFixed(2)}</div>}
      {ema20 != null && <div className="text-[#a78bfa]">EMA20: {ema20.toFixed(2)} <span className="text-[#4a6080]">(velocity)</span></div>}
      {ema50 != null && <div className="text-[#f59e0b]">EMA50: {ema50.toFixed(2)} <span className="text-[#4a6080]">(ST filter)</span></div>}
      {stBull != null && <div className="text-[#00ff88]">ST 🟢: {stBull.toFixed(2)} (support)</div>}
      {stBear != null && <div className="text-[#ff4757]">ST 🔴: {stBear.toFixed(2)} (resistance)</div>}
      {rsi != null && <div className="text-[#a78bfa]">RSI: {rsi.toFixed(1)}</div>}
      {macdH != null && (
        <div className={macdH >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
          MACD H: {macdH.toFixed(3)}
        </div>
      )}
      {vol != null && <div className="text-[#4a6080]">Vol: {(vol / 1_000_000).toFixed(1)}M</div>}
      {entry != null && <div className="text-[#00ff88] font-bold mt-1">▲ ENTRY @ {entry.toFixed(2)}</div>}
      {exit != null && <div className="text-[#ff4757] font-bold mt-1">▼ EXIT @ {exit.toFixed(2)}</div>}
    </div>
  );
};

export default function ChartTab({ result }: Props) {
  const [range, setRange] = useState<Range>("1Y");
  const [showSMA, setShowSMA]       = useState(true);
  const [showEMA20, setShowEMA20]   = useState(true);  // EMA20 = Velocity filter line (Score Alpha)
  const [showEMA50, setShowEMA50]   = useState(true);  // EMA50 = ST entry filter line
  const [showBB, setShowBB]         = useState(true);
  const [showST, setShowST]         = useState(true);
  const [showVol, setShowVol]       = useState(true);
  const [showRSI, setShowRSI]       = useState(false);
  const [showMACD, setShowMACD]     = useState(false);
  const [showTrades, setShowTrades] = useState(true);

  const chartBars = result.chart_bars;
  const bt = result.backtest;

  if (!chartBars || chartBars.length === 0) {
    return (
      <div className="p-4 text-[#4a6080] text-xs">
        Chart data unavailable. Run analysis to load.
      </div>
    );
  }

  // ── Slice to selected range ─────────────────────────────────────
  const barsToShow = Math.min(RANGE_BARS[range], chartBars.length);
  const sliced: ChartBar[] = chartBars.slice(-barsToShow);

  // ── Build trade entry/exit date maps ─────────────────────────────
  const entryMap: Record<string, number> = {};
  const exitMap:  Record<string, number> = {};
  const exitReturnMap: Record<string, number> = {};
  for (const t of bt?.trades ?? []) {
    if (t.entry_date) entryMap[t.entry_date] = t.entry_price;
    if (t.exit_date) {
      exitMap[t.exit_date]       = t.exit_price;
      exitReturnMap[t.exit_date] = t.return;
    }
  }

  // ── Build chart rows ────────────────────────────────────────────
  const chartData = sliced.map((b) => {
    const entry = entryMap[b.date] ?? null;
    const exit  = exitMap[b.date]  ?? null;
    const stVal = (!b.supertrend || isNaN(b.supertrend)) ? null : b.supertrend;
    return {
      date: b.date,
      dateShort: b.date.slice(5), // MM-DD
      Close: b.close,
      SMA20: isNaN(b.sma20)   ? null : b.sma20,
      SMA50: isNaN(b.sma50)   ? null : b.sma50,
      EMA20: (!b.ema20 || isNaN(b.ema20)) ? null : b.ema20,
      EMA50: (!b.ema50 || isNaN(b.ema50)) ? null : b.ema50,
      BBU:   isNaN(b.bbUpper) ? null : b.bbUpper,
      BBL:   isNaN(b.bbLower) ? null : b.bbLower,
      // ST line: split into two keys so we can color by direction
      ST_Bull: stVal !== null && b.supertrendDir === 1  ? stVal : null,
      ST_Bear: stVal !== null && b.supertrendDir === -1 ? stVal : null,
      Volume: b.volume,
      RSI:    b.rsi,
      "MACD H": b.macdHist,
      Entry: entry,
      Exit:  exit,
      exitReturn: exit != null ? exitReturnMap[b.date] : null,
    };
  });

  // ── Y domain with padding ───────────────────────────────────────
  const prices = chartData.map(d => d.Close).filter(Boolean) as number[];
  const extras = [
    ...(showBB ? chartData.map(d => d.BBU).filter(Boolean) as number[] : []),
    ...(showBB ? chartData.map(d => d.BBL).filter(Boolean) as number[] : []),
    ...(showST ? chartData.map(d => d.ST_Bull ?? d.ST_Bear).filter(Boolean) as number[] : []),
    ...(showEMA20 ? chartData.map(d => d.EMA20).filter(Boolean) as number[] : []),
    ...(showEMA50 ? chartData.map(d => d.EMA50).filter(Boolean) as number[] : []),
    ...(showTrades ? chartData.filter(d => d.Entry).map(d => d.Entry!) : []),
    ...(showTrades ? chartData.filter(d => d.Exit).map(d => d.Exit!) : []),
  ];
  const allY = [...prices, ...extras];
  const yPad = (Math.max(...allY) - Math.min(...allY)) * 0.05;
  const yMin = Math.min(...allY) - yPad;
  const yMax = Math.max(...allY) + yPad;

  // ── Volume Y domain ──────────────────────────────────────────────
  const maxVol = Math.max(...chartData.map(d => d.Volume ?? 0));

  // ── X ticks — show ~8 labels ────────────────────────────────────
  // Build sparse monthly tick positions for clean X-axis (avoids dense grid lines)
  // Pick ~8-10 evenly spaced ticks regardless of range
  const tickCount = Math.min(8, chartData.length);
  const tickStep = Math.max(1, Math.floor(chartData.length / tickCount));
  const sparseTicks = chartData
    .filter((_, i) => i === 0 || i === chartData.length - 1 || i % tickStep === 0)
    .map(d => d.dateShort);

  // ── Trades in view (for chart MARKERS only — limited to visible bars) ──────
  const datesInView = new Set(sliced.map(b => b.date));
  const tradesInView = (bt?.trades ?? []).filter(
    t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date)
  );
  const winsInView   = tradesInView.filter(t => t.return > 0).length;
  const lossesInView = tradesInView.filter(t => t.return <= 0).length;

  // ALL trades for tables (full backtest period, not just visible window)
  const allScoreTrades = bt?.trades ?? [];
  const allStTrades = result.comparison?.supertrend?.trades ?? [];

  // ST chart markers (visible window only)
  const stTradesInView = allStTrades.filter(
    t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date)
  );
  const stWinsInView = stTradesInView.filter(t => t.return > 0).length;
  const stLossesInView = stTradesInView.filter(t => t.return <= 0).length;

  // ── Toggle button helper ─────────────────────────────────────────
  const Tog = ({
    label, active, onClick, activeClass,
  }: { label: string; active: boolean; onClick: () => void; activeClass: string }) => (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded border transition-all ${
        active ? activeClass : "border-[#1e2d4a] text-[#4a6080] hover:border-[#4a6080]"
      }`}
    >
      {label}
    </button>
  );

  const RangeBtn = ({ r }: { r: Range }) => (
    <button
      onClick={() => setRange(r)}
      className={`px-2 py-0.5 text-xs rounded border transition-all ${
        range === r
          ? "bg-[#00d4ff]/15 border-[#00d4ff] text-[#00d4ff]"
          : "border-[#1e2d4a] text-[#4a6080] hover:border-[#00d4ff]/40 hover:text-[#6b85a0]"
      }`}
    >
      {r}
    </button>
  );

  // ── Main panel height changes based on sub-charts shown ──────────
  const subCount = (showVol ? 1 : 0) + (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  const priceH = subCount === 0 ? 280 : subCount === 1 ? 230 : 190;
  const subH   = 70;

  return (
    <div className="p-3 space-y-2">

      {/* ── Controls row ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Range */}
        <div className="flex gap-1">
          {(["1M","3M","6M","1Y","2Y"] as Range[]).map(r => <RangeBtn key={r} r={r} />)}
        </div>
        <div className="h-3 w-px bg-[#1e2d4a]" />
        {/* Overlays */}
        <Tog label="SMA"   active={showSMA}    onClick={() => setShowSMA(v => !v)}
          activeClass="border-[#ffa502]/60 text-[#ffa502] bg-[#ffa502]/10" />
        <Tog label="EMA20" active={showEMA20}  onClick={() => setShowEMA20(v => !v)}
          activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="EMA50" active={showEMA50}  onClick={() => setShowEMA50(v => !v)}
          activeClass="border-[#f59e0b]/70 text-[#f59e0b] bg-[#f59e0b]/10" />
        <Tog label="BB"    active={showBB}     onClick={() => setShowBB(v => !v)}
          activeClass="border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/08" />
        <Tog label="ST"    active={showST}     onClick={() => setShowST(v => !v)}
          activeClass="border-[#f97316]/60 text-[#f97316] bg-[#f97316]/10" />
        <div className="h-3 w-px bg-[#1e2d4a]" />
        {/* Sub-charts */}
        <Tog label="Vol"   active={showVol}    onClick={() => setShowVol(v => !v)}
          activeClass="border-[#6b85a0]/60 text-[#6b85a0] bg-[#6b85a0]/10" />
        <Tog label="RSI"   active={showRSI}    onClick={() => setShowRSI(v => !v)}
          activeClass="border-[#a78bfa]/60 text-[#a78bfa] bg-[#a78bfa]/10" />
        <Tog label="MACD"  active={showMACD}   onClick={() => setShowMACD(v => !v)}
          activeClass="border-[#34d399]/60 text-[#34d399] bg-[#34d399]/10" />
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <Tog
          label={`Trades${showTrades ? ` (${allScoreTrades.length}S ${allStTrades.length}ST)` : ""}`}
          active={showTrades}
          onClick={() => setShowTrades(v => !v)}
          activeClass="border-[#00ff88]/50 text-[#00ff88] bg-[#00ff88]/08"
        />
      </div>

      {/* ── Price chart ── */}
      <div style={{ height: priceH }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
            <XAxis
              dataKey="dateShort"
              tick={{ fontSize: 9, fill: "#4a6080" }}
              tickLine={false}
              axisLine={{ stroke: "#1e2d4a" }}
              ticks={sparseTicks}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 9, fill: "#4a6080" }}
              tickFormatter={(v: number) => v.toFixed(1)}
              width={46}
              tickLine={false}
            />
            <Tooltip content={<PriceTooltip />} />

            {/* Bollinger Bands — filled area */}
            {showBB && (
              <>
                <Line dataKey="BBU" stroke="#00d4ff" strokeWidth={1} dot={false}
                  name="BB Upper" strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" />
                <Line dataKey="BBL" stroke="#00d4ff" strokeWidth={1} dot={false}
                  name="BB Lower" strokeOpacity={0.35} strokeDasharray="3 3" legendType="none" />
              </>
            )}

            {/* SMA lines */}
            {showSMA && (
              <>
                <Line dataKey="SMA20" stroke="#00ff88" strokeWidth={1.5} dot={false}
                  name="SMA20" strokeOpacity={0.85} legendType="none" />
                <Line dataKey="SMA50" stroke="#ff7f50" strokeWidth={1.5} dot={false}
                  name="SMA50" strokeOpacity={0.85} legendType="none" />
              </>
            )}

            {/* EMA20 — Score Alpha Velocity Entry filter (purple, dashed) */}
            {showEMA20 && (
              <Line dataKey="EMA20" stroke="#a78bfa" strokeWidth={1.5} dot={false}
                name="EMA20" strokeOpacity={0.9} strokeDasharray="4 2" legendType="none" />
            )}

            {/* EMA50 — ST entry filter line (amber, dashed) */}
            {showEMA50 && (
              <Line dataKey="EMA50" stroke="#f59e0b" strokeWidth={1.5} dot={false}
                name="EMA50" strokeOpacity={0.9} strokeDasharray="6 3" legendType="none" />
            )}

            {/* SuperTrend lines — green when bullish (support), red when bearish (resistance) */}
            {showST && (
              <>
                <Line
                  dataKey="ST_Bull"
                  stroke="#00ff88"
                  strokeWidth={2}
                  dot={false}
                  name="ST_Bull"
                  strokeOpacity={0.9}
                  strokeDasharray="5 2"
                  legendType="none"
                  connectNulls={false}
                />
                <Line
                  dataKey="ST_Bear"
                  stroke="#ff4757"
                  strokeWidth={2}
                  dot={false}
                  name="ST_Bear"
                  strokeOpacity={0.9}
                  strokeDasharray="5 2"
                  legendType="none"
                  connectNulls={false}
                />
              </>
            )}

            {/* Close price — main line */}
            <Line
              dataKey="Close"
              stroke="#00d4ff"
              strokeWidth={2}
              dot={false}
              name="Close"
              activeDot={{ r: 3, fill: "#00d4ff", stroke: "#0a0e1a" }}
              legendType="none"
            />

            {/* Entry markers — green triangles pointing up */}
            {showTrades && (
              <Line
                dataKey="Entry"
                stroke="transparent"
                dot={<EntryMarker />}
                activeDot={false}
                name="Entry"
                legendType="none"
                isAnimationActive={false}
              />
            )}

            {/* Exit markers — red triangles pointing down */}
            {showTrades && (
              <Line
                dataKey="Exit"
                stroke="transparent"
                dot={<ExitMarker />}
                activeDot={false}
                name="Exit"
                legendType="none"
                isAnimationActive={false}
              />
            )}

            {/* Current price reference */}
            <ReferenceLine
              y={result.current_price}
              stroke="#c8d8f0"
              strokeDasharray="4 2"
              strokeOpacity={0.3}
              label={{ value: result.current_price.toFixed(2), position: "right", fontSize: 9, fill: "#6b85a0" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Volume sub-chart ── */}
      {showVol && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46}
                tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`} />
              <Bar dataKey="Volume" name="Volume" fill="#4a6080" opacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#4a6080] text-[0.6rem] text-right pr-2 -mt-1">VOLUME</div>
        </div>
      )}

      {/* ── RSI sub-chart ── */}
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

      {/* ── MACD sub-chart ── */}
      {showMACD && (
        <div style={{ height: subH }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="dateShort" hide />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={46}
                tickFormatter={(v: number) => v.toFixed(2)} />
              <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
              <ReferenceLine y={0} stroke="#4a6080" />
              <Bar dataKey="MACD H" name="MACD H"
                fill="#34d399" opacity={0.8}
                // Color each bar based on sign
                label={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[#34d399] text-[0.6rem] text-right pr-2 -mt-1">MACD HISTOGRAM</div>
        </div>
      )}

      {/* ── Legend strip ── */}
      <div className="flex flex-wrap gap-3 text-[0.65rem] text-[#4a6080] pt-1">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-[#00d4ff] inline-block rounded" /> Price
        </span>
        {showSMA && <>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-[#00ff88] inline-block rounded" /> SMA20
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-[#ff7f50] inline-block rounded" /> SMA50
          </span>
        </>}
        {showEMA20 && (
          <span className="flex items-center gap-1.5">
            <span className="w-5 inline-block" style={{ borderTop: "2px dashed #a78bfa" }} /> EMA20 <span className="text-[#4a6080] text-[0.6rem]">(velocity)</span>
          </span>
        )}
        {showEMA50 && (
          <span className="flex items-center gap-1.5">
            <span className="w-5 inline-block" style={{ borderTop: "2px dashed #f59e0b" }} /> EMA50 <span className="text-[#4a6080] text-[0.6rem]">(ST filter)</span>
          </span>
        )}
        {showBB && (
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-[#00d4ff] inline-block rounded opacity-40" style={{ borderTop: "1px dashed #00d4ff" }} />
            BB(20,2)
          </span>
        )}
        {showST && <>
          <span className="flex items-center gap-1.5">
            <span className="w-5 inline-block" style={{ borderTop: "2px dashed #00ff88" }} /> ST Bull
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 inline-block" style={{ borderTop: "2px dashed #ff4757" }} /> ST Bear
          </span>
        </>}
        {showTrades && <>
          <span className="flex items-center gap-1.5">
            <span className="text-[#00ff88] text-sm leading-none">▲</span> Entry
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[#ff4757] text-sm leading-none">▼</span> Exit
          </span>
        </>}
      </div>

      {/* ── ST Status strip ── */}
      {(() => {
        const dir = result.st_direction ?? -1;
        const dist = result.st_stop_distance_pct ?? 0;
        const openRet = result.st_open_return_pct;
        const stVal = result.st_value;
        return (
          <div className={`flex items-center gap-3 px-2 py-1 rounded border text-xs font-mono ${
            dir === 1 ? "border-[#00ff88]/30 bg-[#00ff88]/5" : "border-[#ff4757]/30 bg-[#ff4757]/5"
          }`}>
            <span className={dir === 1 ? "text-[#00ff88] font-bold" : "text-[#ff4757] font-bold"}>
              {dir === 1 ? "🟢 ST BULLISH" : "🔴 ST BEARISH"}
            </span>
            {stVal > 0 && (
              <span className="text-[#4a6080]">
                line: <span className="text-[#c8d8f0]">{stVal.toFixed(2)}</span>
              </span>
            )}
            {dir === 1 && (
              <span className="text-[#4a6080]">
                dist: <span className="text-[#c8d8f0]">{dist.toFixed(1)}%</span>
              </span>
            )}
            {dir === 1 && openRet !== null && openRet !== undefined && (
              <span className="text-[#4a6080]">
                open: <span className={openRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>
                  {openRet >= 0 ? "+" : ""}{openRet.toFixed(1)}%
                </span>
              </span>
            )}
            {dir === -1 && (
              <span className="text-[#4a6080]">wait for flip to bullish before entry</span>
            )}
          </div>
        );
      })()}

      {/* ── Score Trades — ALL trades, most recent first ── */}
      {showTrades && allScoreTrades.length > 0 && (
        <div className="mt-1">
          <div className="text-[#00d4ff] text-xs mb-1 font-bold">
            SCORE TRADES — {allScoreTrades.length} total ·{" "}
            <span className="text-[#00ff88]">{allScoreTrades.filter(t => t.return > 0).length}W</span>{" "}
            <span className="text-[#ff4757]">{allScoreTrades.filter(t => t.return <= 0).length}L</span>
            <span className="text-[#4a6080] font-normal ml-2 text-[0.65rem]">
              ({tradesInView.length} in chart view)
            </span>
          </div>
          <div className="overflow-x-auto rounded border border-[#1e2d4a]/60 max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="text-[#4a6080] bg-[#0f1629] border-b border-[#1e2d4a]">
                  <th className="text-left py-1 px-2">#</th>
                  <th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th>
                  <th className="text-right py-1 px-2">Entry $</th>
                  <th className="text-right py-1 px-2">Exit $</th>
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
                      className={`border-b border-[#1e2d4a]/30 hover:bg-[#00d4ff]/5 transition-colors ${
                        t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"
                      } ${inView ? "ring-1 ring-inset ring-[#00d4ff]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono">
                        <span className="text-[#00ff88]">▲</span>
                        <span className="text-[#6b85a0] ml-1">{t.entry_date?.slice(5)}</span>
                      </td>
                      <td className="py-1 px-2 font-mono">
                        <span className="text-[#ff4757]">▼</span>
                        <span className="text-[#6b85a0] ml-1">{t.exit_date?.slice(5)}</span>
                      </td>
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
                      <td className="py-1 px-2 text-[#4a6080] text-[0.6rem] max-w-[80px] truncate">
                        {t.entry_regime?.replace(/_/g, " ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SuperTrend Trades — ALL trades, most recent first ── */}
      {allStTrades.length > 0 && showTrades && (
        <div className="mt-2">
          <div className="text-[#ffa502] text-xs mb-1 font-bold">
            ST TRADES — {allStTrades.length} total ·{" "}
            <span className="text-[#00ff88]">{allStTrades.filter(t => t.return > 0).length}W</span>{" "}
            <span className="text-[#ff4757]">{allStTrades.filter(t => t.return <= 0).length}L</span>
            <span className="text-[#4a6080] font-normal ml-2 text-[0.65rem]">
              ({stTradesInView.length} in chart view · exit = trend reversal + trailing stop)
            </span>
          </div>
          <div className="overflow-x-auto rounded border border-[#ffa502]/20 max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="text-[#4a6080] bg-[#0f1629] border-b border-[#1e2d4a]">
                  <th className="text-left py-1 px-2">#</th>
                  <th className="text-left py-1 px-2">Entry</th>
                  <th className="text-left py-1 px-2">Exit</th>
                  <th className="text-right py-1 px-2">Entry $</th>
                  <th className="text-right py-1 px-2">Exit $</th>
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
                      className={`border-b border-[#1e2d4a]/30 hover:bg-[#ffa502]/5 transition-colors ${
                        t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"
                      } ${inView ? "ring-1 ring-inset ring-[#ffa502]/20" : "opacity-70"}`}>
                      <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                      <td className="py-1 px-2 font-mono">
                        <span className="text-[#ffa502]">▲</span>
                        <span className="text-[#6b85a0] ml-1">{t.entry_date?.slice(5)}</span>
                      </td>
                      <td className="py-1 px-2 font-mono">
                        <span className="text-[#ff4757]">▼</span>
                        <span className="text-[#6b85a0] ml-1">{t.exit_date?.slice(5)}</span>
                      </td>
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
