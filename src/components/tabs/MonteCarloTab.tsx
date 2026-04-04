"use client";
// ============================================================
// MONTE CARLO FAN CHART TAB
// Fan Chart = side-by-side: equity path simulation (left) +
//             horizontal histogram of final outcomes (right)
// Runs 200 block-bootstrap paths CLIENT-SIDE from the equity curve.
// ============================================================
import { useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";

interface Props { result: StockAnalysisResult; }

// ── Block-bootstrap re-simulation (client-side, 200 paths) ───
function runClientMC(equityCurve: number[], initialCapital: number, runs = 200) {
  if (equityCurve.length < 10) return null;

  // Daily returns from the actual equity curve
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) returns.push((equityCurve[i] - prev) / prev);
  }
  if (returns.length < 5) return null;

  const n = returns.length;
  const blockSize = Math.max(3, Math.round(Math.sqrt(n)));

  // Generate simulation paths
  const paths: number[][] = [];
  const finalValues: number[] = [];

  for (let r = 0; r < runs; r++) {
    const path: number[] = [initialCapital];
    let equity = initialCapital;

    // Block bootstrap
    const bootstrapped: number[] = [];
    while (bootstrapped.length < n) {
      const start = Math.floor(Math.random() * n);
      for (let j = 0; j < blockSize && bootstrapped.length < n; j++) {
        bootstrapped.push(returns[(start + j) % n]);
      }
    }

    for (let i = 0; i < n; i++) {
      equity *= 1 + bootstrapped[i];
      path.push(equity);
    }
    paths.push(path);
    finalValues.push(equity);
  }

  finalValues.sort((a, b) => a - b);

  // Percentile helpers
  const pct = (arr: number[], p: number) => {
    const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
    return arr[idx];
  };

  const p5  = pct(finalValues, 5);
  const p25 = pct(finalValues, 25);
  const p50 = pct(finalValues, 50);
  const p75 = pct(finalValues, 75);
  const p95 = pct(finalValues, 95);

  // Build time-series data: for each time step, compute percentile bands
  const steps = paths[0].length;
  const timeData: {
    t: number; p5: number; p25: number; p50: number; p75: number; p95: number;
    // Sample of individual paths for the "spaghetti" lines
    [key: string]: number;
  }[] = [];

  // Pick 60 representative paths for display (spread across percentile range)
  const sampleIndices: number[] = [];
  for (let i = 0; i < Math.min(60, runs); i++) {
    sampleIndices.push(Math.floor((i / Math.min(60, runs)) * runs));
  }

  for (let t = 0; t < steps; t++) {
    const stepValues = paths.map(p => p[t]).sort((a, b) => a - b);
    const row: Record<string, number> = {
      t,
      p5:  pct(stepValues, 5),
      p25: pct(stepValues, 25),
      p50: pct(stepValues, 50),
      p75: pct(stepValues, 75),
      p95: pct(stepValues, 95),
    };
    // Attach sampled paths
    sampleIndices.forEach((si, li) => {
      row[`path${li}`] = paths[si][t];
    });
    timeData.push(row as typeof timeData[0]);
  }

  // Histogram: 20 bins for final equity distribution
  const minVal = finalValues[0] * 0.98;
  const maxVal = finalValues[finalValues.length - 1] * 1.02;
  const bins = 20;
  const binWidth = (maxVal - minVal) / bins;
  const histData: { midpoint: number; count: number; profit: boolean }[] = [];

  for (let b = 0; b < bins; b++) {
    const lo = minVal + b * binWidth;
    const hi = lo + binWidth;
    const mid = (lo + hi) / 2;
    const count = finalValues.filter(v => v >= lo && v < hi).length;
    histData.push({ midpoint: Math.round(mid), count, profit: mid >= initialCapital });
  }

  const probProfit = (finalValues.filter(v => v >= initialCapital).length / runs) * 100;

  return {
    timeData,
    histData,
    sampleCount: sampleIndices.length,
    p5, p25, p50, p75, p95,
    probProfit,
    finalValues,
    initialCapital,
    n,
  };
}

// ── Custom tooltip for the fan chart ────────────────────────────
function FanTooltip({ active, payload, label, initial }: {
  active?: boolean;
  payload?: { name: string; value: number }[];
  label?: number;
  initial: number;
}) {
  if (!active || !payload?.length) return null;
  const p50 = payload.find(p => p.name === "p50")?.value;
  const p5  = payload.find(p => p.name === "p5")?.value;
  const p95 = payload.find(p => p.name === "p95")?.value;
  if (!p50) return null;
  const ret = ((p50 - initial) / initial * 100).toFixed(1);
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2 py-1.5 text-[0.65rem] font-mono shadow-xl">
      <div className="text-[#4a6080] mb-1">Day {label}</div>
      {p95 != null && <div className="text-[#00ff88]/70">95th: ${p95.toFixed(0)}</div>}
      <div className="text-[#ffa502] font-bold">Median: ${p50.toFixed(0)} ({ret}%)</div>
      {p5  != null && <div className="text-[#ff4757]/70">5th: ${p5.toFixed(0)}</div>}
    </div>
  );
}

// ── Main Tab ─────────────────────────────────────────────────
export default function MonteCarloTab({ result }: Props) {
  const mc      = result.monte_carlo;
  const bt      = result.backtest;
  const initial = bt?.equity_curve?.[0] ?? 10000;

  // Re-run MC client-side for visualisation
  const sim = useMemo(() => {
    if (!bt?.equity_curve || bt.equity_curve.length < 10) return null;
    return runClientMC(bt.equity_curve, initial, 200);
  }, [bt?.equity_curve, initial]);

  if (!mc && !sim) {
    return (
      <div className="p-4 text-[#4a6080] text-xs">
        {bt?.num_trades === 0 ? "No trades to simulate" : "Insufficient equity curve data"}
      </div>
    );
  }

  const probPct    = sim?.probProfit ?? mc?.prob_profit ?? 0;
  const probColor  = probPct >= 60 ? "#00ff88" : probPct >= 50 ? "#ffa502" : "#ff4757";
  const p5Val      = sim?.p5  ?? mc?.worst_equity ?? initial;
  const p50Val     = sim?.p50 ?? mc?.median_equity ?? initial;
  const p95Val     = sim?.p95 ?? mc?.best_equity ?? initial;

  const retPct = (v: number) => ((v - initial) / initial * 100).toFixed(1);

  return (
    <div className="p-3 space-y-3">

      {/* ── Header stats row ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[#4a6080] text-[0.65rem] mb-0.5">PROB. OF PROFIT · {mc?.runs?.toLocaleString() ?? 200} runs</div>
          <div className="text-2xl font-bold font-mono" style={{ color: probColor }}>
            {probPct.toFixed(1)}%
          </div>
        </div>
        <div className="flex gap-3 text-xs">
          {[
            { label: "5th pct", val: p5Val,  color: "#ff4757" },
            { label: "Median",  val: p50Val, color: "#ffa502" },
            { label: "95th pct",val: p95Val, color: "#00ff88" },
          ].map(m => (
            <div key={m.label} className="text-center">
              <div className="text-[#4a6080] text-[0.6rem]">{m.label}</div>
              <div className="font-mono font-bold" style={{ color: m.color }}>${m.val.toFixed(0)}</div>
              <div className="text-[#4a6080] text-[0.6rem]">{retPct(m.val)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FAN CHART (left) + HISTOGRAM (right) ── */}
      {sim ? (
        <div className="flex gap-2" style={{ height: 260 }}>

          {/* LEFT: Fan Chart — equity path simulation */}
          <div style={{ flex: "0 0 68%" }}>
            <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">SIMULATION PATHS (200)</div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={sim.timeData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 8, fill: "#4a6080" }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e2d4a" }}
                  tickFormatter={v => v === 0 ? "Start" : `D${v}`}
                  ticks={[0, Math.floor(sim.n * 0.25), Math.floor(sim.n * 0.5), Math.floor(sim.n * 0.75), sim.n]}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "#4a6080" }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e2d4a" }}
                  width={46}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<FanTooltip initial={initial} />} />

                {/* Individual spaghetti paths — very low opacity */}
                {Array.from({ length: sim.sampleCount }).map((_, i) => (
                  <Line
                    key={`path${i}`}
                    dataKey={`path${i}`}
                    stroke={sim.timeData[sim.timeData.length - 1]?.[`path${i}`] >= initial
                      ? "#00ff88" : "#ff4757"}
                    strokeWidth={0.6}
                    dot={false}
                    opacity={0.12}
                    isAnimationActive={false}
                    legendType="none"
                  />
                ))}

                {/* 90% confidence cone (5th–95th) — outer shaded area */}
                <Area
                  dataKey="p95"
                  data={sim.timeData}
                  fill="#00ff88"
                  fillOpacity={0.06}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                  name="p95"
                />
                <Area
                  dataKey="p5"
                  data={sim.timeData}
                  fill="#ff4757"
                  fillOpacity={0.08}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                  name="p5"
                />

                {/* 50% IQR cone (25th–75th) — inner shaded area */}
                <Area
                  dataKey="p75"
                  data={sim.timeData}
                  fill="#ffa502"
                  fillOpacity={0.10}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                  name="p75"
                />
                <Area
                  dataKey="p25"
                  data={sim.timeData}
                  fill="#ffa502"
                  fillOpacity={0.10}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                  name="p25"
                />

                {/* Percentile boundary lines */}
                <Line dataKey="p95" stroke="#00ff88" strokeWidth={1.2} dot={false}
                  strokeDasharray="4 3" opacity={0.7} isAnimationActive={false} legendType="none" name="p95" />
                <Line dataKey="p75" stroke="#ffa502" strokeWidth={0.8} dot={false}
                  opacity={0.5} isAnimationActive={false} legendType="none" name="p75" />
                <Line dataKey="p25" stroke="#ffa502" strokeWidth={0.8} dot={false}
                  opacity={0.5} isAnimationActive={false} legendType="none" name="p25" />
                <Line dataKey="p5"  stroke="#ff4757" strokeWidth={1.2} dot={false}
                  strokeDasharray="4 3" opacity={0.7} isAnimationActive={false} legendType="none" name="p5" />

                {/* Median — bold central line */}
                <Line dataKey="p50" stroke="#ffa502" strokeWidth={2.5} dot={false}
                  isAnimationActive={false} legendType="none" name="p50" />

                {/* Break-even reference */}
                <ReferenceLine y={initial} stroke="#c8d8f0" strokeDasharray="3 3" strokeOpacity={0.4}
                  label={{ value: "Break-even", position: "insideTopRight", fontSize: 8, fill: "#6b85a0" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* RIGHT: Horizontal histogram of final outcomes */}
          <div style={{ flex: "0 0 32%" }}>
            <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">FINAL EQUITY DIST.</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={sim.histData}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                barCategoryGap="2%"
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 7, fill: "#4a6080" }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e2d4a" }}
                  tickFormatter={v => `${v}`}
                  label={{ value: "Count", position: "insideBottom", offset: -2, fontSize: 7, fill: "#4a6080" }}
                />
                <YAxis
                  type="category"
                  dataKey="midpoint"
                  tick={{ fontSize: 7, fill: "#4a6080" }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e2d4a" }}
                  width={44}
                  tickFormatter={v => `$${Number(v) >= 1000 ? `${(Number(v)/1000).toFixed(1)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                  formatter={(v: number, _: string, entry: { payload: { midpoint: number } }) => [
                    `${v} paths`,
                    `${entry.payload.midpoint >= initial
                      ? "+" : ""}${((entry.payload.midpoint - initial) / initial * 100).toFixed(1)}%`,
                  ]}
                />
                <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                  {sim.histData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.profit ? "#00ff88" : "#ff4757"}
                      fillOpacity={entry.profit ? 0.75 : 0.65}
                    />
                  ))}
                </Bar>
                {/* Break-even line */}
                <ReferenceLine
                  y={initial}
                  stroke="#c8d8f0"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        // Fallback if equity curve too short for client MC
        <div className="text-[#4a6080] text-xs p-2">
          Simulation paths unavailable (insufficient trade data)
        </div>
      )}

      {/* ── Legend strip ── */}
      <div className="flex flex-wrap gap-3 text-[0.6rem] text-[#4a6080] border-t border-[#1e2d4a] pt-2">
        <span className="flex items-center gap-1">
          <span className="w-4 border-t-2 border-dashed border-[#00ff88] inline-block opacity-70" />
          95th pct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-[#ffa502] inline-block opacity-50" />
          IQR (25–75)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t-2 border-[#ffa502] inline-block" />
          Median path
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t-2 border-dashed border-[#ff4757] inline-block opacity-70" />
          5th pct (VaR)
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <span className="w-2 h-2 rounded-sm bg-[#00ff88] opacity-70 inline-block" /> Profit zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#ff4757] opacity-65 inline-block" /> Loss zone
        </span>
      </div>

      {/* ── Key stats row ── */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { label: "Avg Max DD",  val: `${mc?.avg_max_dd?.toFixed(1)}%`,  color: "text-[#ff4757]" },
          { label: "VaR (5%)",    val: `${mc?.var_5?.toFixed(1)}%`,        color: "text-[#ff4757]" },
          { label: "Confidence",  val: mc?.confidence ?? "—",              color: mc?.confidence === "HIGH" ? "text-[#00ff88]" : "text-[#ffa502]" },
        ].map(m => (
          <div key={m.label} className="bg-[#0a0e1a] border border-[#1e2d4a] rounded p-1.5 text-center">
            <div className="text-[#4a6080] text-[0.6rem]">{m.label}</div>
            <div className={`font-mono font-bold ${m.color}`}>{m.val}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
