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

type Range = "1M" | "3M" | "6M" | "1Y";
const RANGE_BARS: Record<Range, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

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
  const [showBB, setShowBB]         = useState(true);
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
    return {
      date: b.date,
      dateShort: b.date.slice(5), // MM-DD
      Close: b.close,
      SMA20: isNaN(b.sma20)   ? null : b.sma20,
      SMA50: isNaN(b.sma50)   ? null : b.sma50,
      BBU:   isNaN(b.bbUpper) ? null : b.bbUpper,
      BBL:   isNaN(b.bbLower) ? null : b.bbLower,
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

  // ── Trades in view ───────────────────────────────────────────────
  const datesInView = new Set(sliced.map(b => b.date));
  const tradesInView = (bt?.trades ?? []).filter(
    t => datesInView.has(t.entry_date) || datesInView.has(t.exit_date)
  );
  const winsInView   = tradesInView.filter(t => t.return > 0).length;
  const lossesInView = tradesInView.filter(t => t.return <= 0).length;

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
          {(["1M","3M","6M","1Y"] as Range[]).map(r => <RangeBtn key={r} r={r} />)}
        </div>
        <div className="h-3 w-px bg-[#1e2d4a]" />
        {/* Overlays */}
        <Tog label="SMA"   active={showSMA}    onClick={() => setShowSMA(v => !v)}
          activeClass="border-[#ffa502]/60 text-[#ffa502] bg-[#ffa502]/10" />
        <Tog label="BB"    active={showBB}     onClick={() => setShowBB(v => !v)}
          activeClass="border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/08" />
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
          label={`Trades${showTrades && tradesInView.length > 0 ? ` (${winsInView}W ${lossesInView}L)` : ""}`}
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
        {showBB && (
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-[#00d4ff] inline-block rounded opacity-40" style={{ borderTop: "1px dashed #00d4ff" }} />
            BB(20,2)
          </span>
        )}
        {showTrades && <>
          <span className="flex items-center gap-1.5">
            <span className="text-[#00ff88] text-sm leading-none">▲</span> Entry
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[#ff4757] text-sm leading-none">▼</span> Exit
          </span>
        </>}
      </div>

      {/* ── Trades in view table ── */}
      {showTrades && tradesInView.length > 0 && (
        <div className="mt-1">
          <div className="text-[#4a6080] text-xs mb-1 font-bold">
            TRADES IN VIEW — {tradesInView.length} trades · <span className="text-[#00ff88]">{winsInView}W</span> <span className="text-[#ff4757]">{lossesInView}L</span>
          </div>
          <div className="overflow-x-auto rounded border border-[#1e2d4a]/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#4a6080] bg-[#0f1629] border-b border-[#1e2d4a]">
                  <th className="text-left py-1 px-2">#</th>
                  <th className="text-left py-1 px-2">Entry Date</th>
                  <th className="text-left py-1 px-2">Exit Date</th>
                  <th className="text-right py-1 px-2">Entry $</th>
                  <th className="text-right py-1 px-2">Exit $</th>
                  <th className="text-right py-1 px-2">Ret%</th>
                  <th className="text-right py-1 px-2">R</th>
                  <th className="text-right py-1 px-2">Bars</th>
                  <th className="text-left py-1 px-2">Exit Reason</th>
                  <th className="text-left py-1 px-2">Regime</th>
                </tr>
              </thead>
              <tbody>
                {tradesInView.map(t => (
                  <tr key={t.trade_num}
                    className={`border-b border-[#1e2d4a]/30 hover:bg-[#00d4ff]/5 transition-colors ${
                      t.return > 0 ? "bg-[#00ff88]/3" : "bg-[#ff4757]/3"
                    }`}>
                    <td className="py-1 px-2 text-[#4a6080]">{t.trade_num}</td>
                    <td className="py-1 px-2 font-mono">
                      <span className="text-[#00ff88]">▲</span>
                      <span className="text-[#6b85a0] ml-1">{t.entry_date}</span>
                    </td>
                    <td className="py-1 px-2 font-mono">
                      <span className="text-[#ff4757]">▼</span>
                      <span className="text-[#6b85a0] ml-1">{t.exit_date}</span>
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
                    <td className="py-1 px-2 text-[#6b85a0] max-w-[100px] truncate">{t.exit_reason}</td>
                    <td className="py-1 px-2 text-[#4a6080] text-[0.6rem] max-w-[90px] truncate">
                      {t.entry_regime?.replace(/_/g, " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
