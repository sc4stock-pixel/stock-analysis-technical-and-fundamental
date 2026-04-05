"use client";
import { useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";

interface Props { result: StockAnalysisResult; }

// ── Block-bootstrap simulation (client-side, 200 paths) ──────────
function runClientMC(equityCurve: number[], initialCapital: number, runs = 200) {
  if (equityCurve.length < 10) return null;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) returns.push((equityCurve[i] - prev) / prev);
  }
  if (returns.length < 5) return null;

  const n = returns.length;
  const blockSize = Math.max(3, Math.round(Math.sqrt(n)));
  const paths: number[][] = [];
  const finalValues: number[] = [];

  for (let r = 0; r < runs; r++) {
    let equity = initialCapital;
    const path: number[] = [equity];
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
  const pct = (arr: number[], p: number) =>
    arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

  const p5  = pct(finalValues, 5);
  const p25 = pct(finalValues, 25);
  const p50 = pct(finalValues, 50);
  const p75 = pct(finalValues, 75);
  const p95 = pct(finalValues, 95);

  // Time-series: percentile bands + 60 sampled paths
  const steps = paths[0].length;
  const sampleIndices = Array.from({ length: Math.min(60, runs) }, (_, i) =>
    Math.floor((i / Math.min(60, runs)) * runs)
  );
  const timeData: Record<string, number>[] = [];
  for (let t = 0; t < steps; t++) {
    const sv = paths.map(p => p[t]).sort((a, b) => a - b);
    const row: Record<string, number> = {
      t,
      p5:  pct(sv, 5),
      p25: pct(sv, 25),
      p50: pct(sv, 50),
      p75: pct(sv, 75),
      p95: pct(sv, 95),
    };
    sampleIndices.forEach((si, li) => { row[`path${li}`] = paths[si][t]; });
    timeData.push(row);
  }

  // Histogram — 25 bins, NOT pre-sorted (numeric YAxis handles positioning)
  const minVal   = finalValues[0]                      * 0.98;
  const maxVal   = finalValues[finalValues.length - 1] * 1.02;
  const bins     = 25;
  const binWidth = (maxVal - minVal) / bins;
  const histData = Array.from({ length: bins }, (_, b) => {
    const lo  = minVal + b * binWidth;
    const hi  = lo + binWidth;
    const mid = (lo + hi) / 2;
    return {
      midpoint: mid,
      count: finalValues.filter(v => v >= lo && v < hi).length,
      profit: mid >= initialCapital,
    };
  });

  return {
    timeData, histData,
    sampleCount: sampleIndices.length,
    p5, p25, p50, p75, p95,
    initialCapital, n,
    probProfit: (finalValues.filter(v => v >= initialCapital).length / runs) * 100,
  };
}

// ── Fan chart tooltip ─────────────────────────────────────────────
function FanTooltip({ active, payload, initial }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  initial: number;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload as Record<string, number>;
  const ret = ((d.p50 - initial) / initial * 100).toFixed(1);
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2 py-1.5 text-[0.65rem] font-mono shadow-xl">
      <div className="text-[#4a6080] mb-1">Day {d.t}</div>
      <div className="text-[#00ff88]/80">95th:  ${d.p95?.toFixed(0)}</div>
      <div className="text-[#ffa502] font-bold">Median: ${d.p50?.toFixed(0)} ({ret}%)</div>
      <div className="text-[#ff4757]/80">5th:   ${d.p5?.toFixed(0)}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function MonteCarloTab({ result }: Props) {
  const mc      = result.monte_carlo;
  const bt      = result.backtest;
  const initial = bt?.equity_curve?.[0] ?? 10000;

  const sim = useMemo(() => {
    if (!bt?.equity_curve || bt.equity_curve.length < 10) return null;
    return runClientMC(bt.equity_curve, initial, 200);
  }, [bt?.equity_curve, initial]);

  // Shared Y domain — computed once, used by both charts
  const { yMin, yMax, yTicks } = useMemo(() => {
    if (!sim) return { yMin: 0, yMax: 0, yTicks: [] };
    const buffer = (sim.p95 - sim.p5) * 0.15;
    const min    = Math.max(0, sim.p5  - buffer);
    const max    = sim.p95 + buffer;
    const step   = (max - min) / 4;
    return {
      yMin:   min,
      yMax:   max,
      yTicks: [min, min + step, min + step * 2, min + step * 3, max],
    };
  }, [sim]);

  if (!sim) {
    return (
      <div className="p-4 text-[#4a6080] text-xs">
        {bt?.num_trades === 0 ? "No trades to simulate" : "Insufficient equity curve data"}
      </div>
    );
  }

  const yFmt     = (v: number) => `$${(v / 1000).toFixed(1)}k`;
  const probPct  = sim.probProfit;
  const probColor = probPct >= 60 ? "#00ff88" : probPct >= 50 ? "#ffa502" : "#ff4757";
  const retPct   = (v: number) => ((v - initial) / initial * 100).toFixed(1);

  return (
    <div className="p-3 space-y-3">

      {/* ── Header: probability + percentile stats ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[#4a6080] text-[0.65rem] mb-0.5">
            PROB. OF PROFIT · {mc?.runs?.toLocaleString() ?? 200} runs
          </div>
          <div className="text-2xl font-bold font-mono" style={{ color: probColor }}>
            {probPct.toFixed(1)}%
          </div>
        </div>
        <div className="flex gap-4 text-xs">
          {([
            { label: "5th pct",  val: sim.p5,  color: "#ff4757" },
            { label: "Median",   val: sim.p50, color: "#ffa502" },
            { label: "95th pct", val: sim.p95, color: "#00ff88" },
          ] as const).map(m => (
            <div key={m.label} className="text-center">
              <div className="text-[#4a6080] text-[0.6rem]">{m.label}</div>
              <div className="font-mono font-bold" style={{ color: m.color }}>
                ${m.val.toFixed(0)}
              </div>
              <div className="text-[#4a6080] text-[0.6rem]">{retPct(m.val)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Charts side by side ── */}
      <div className="flex gap-1" style={{ height: 280 }}>

        {/* LEFT: Fan chart */}
        <div style={{ flex: "0 0 65%" }}>
          <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">
            SIMULATION PATHS ({sim.sampleCount})
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={sim.timeData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />

              {/* Numeric X-axis: fills full width regardless of path count */}
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, sim.n]}
                scale="linear"
                tick={{ fontSize: 8, fill: "#4a6080" }}
                tickLine={false}
                axisLine={{ stroke: "#1e2d4a" }}
                tickFormatter={(v: number) => v === 0 ? "Start" : `D${v}`}
                ticks={[0,
                  Math.round(sim.n * 0.25),
                  Math.round(sim.n * 0.5),
                  Math.round(sim.n * 0.75),
                  sim.n]}
              />

              {/* Left Y-axis — shared domain */}
              <YAxis
                domain={[yMin, yMax]}
                ticks={yTicks}
                tickFormatter={yFmt}
                tick={{ fontSize: 8, fill: "#4a6080" }}
                tickLine={false}
                axisLine={{ stroke: "#1e2d4a" }}
                width={46}
              />

              <Tooltip content={<FanTooltip initial={initial} />} />

              {/* Spaghetti paths */}
              {Array.from({ length: sim.sampleCount }).map((_, i) => {
                const lastVal = sim.timeData[sim.timeData.length - 1]?.[`path${i}`] as number | undefined;
                return (
                  <Line
                    key={`path${i}`}
                    dataKey={`path${i}`}
                    stroke={lastVal != null && lastVal >= initial ? "#00ff88" : "#ff4757"}
                    strokeWidth={0.5}
                    dot={false}
                    opacity={0.10}
                    isAnimationActive={false}
                    legendType="none"
                    connectNulls
                  />
                );
              })}

              {/* Confidence cones */}
              <Area dataKey="p95" stroke="none" fill="#00ff88" fillOpacity={0.06}
                isAnimationActive={false} legendType="none" />
              <Area dataKey="p5"  stroke="none" fill="#ff4757" fillOpacity={0.08}
                isAnimationActive={false} legendType="none" />
              <Area dataKey="p75" stroke="none" fill="#ffa502" fillOpacity={0.10}
                isAnimationActive={false} legendType="none" />
              <Area dataKey="p25" stroke="none" fill="#ffa502" fillOpacity={0.10}
                isAnimationActive={false} legendType="none" />

              {/* Percentile lines */}
              <Line dataKey="p95" stroke="#00ff88" strokeWidth={1.2} dot={false}
                strokeDasharray="4 3" opacity={0.7} isAnimationActive={false}
                legendType="none" name="p95" />
              <Line dataKey="p75" stroke="#ffa502" strokeWidth={0.8} dot={false}
                opacity={0.5} isAnimationActive={false} legendType="none" name="p75" />
              <Line dataKey="p25" stroke="#ffa502" strokeWidth={0.8} dot={false}
                opacity={0.5} isAnimationActive={false} legendType="none" name="p25" />
              <Line dataKey="p5"  stroke="#ff4757" strokeWidth={1.2} dot={false}
                strokeDasharray="4 3" opacity={0.7} isAnimationActive={false}
                legendType="none" name="p5" />
              <Line dataKey="p50" stroke="#ffa502" strokeWidth={2.5} dot={false}
                isAnimationActive={false} legendType="none" name="p50" />

              <ReferenceLine y={initial} stroke="#c8d8f0" strokeDasharray="3 3"
                strokeOpacity={0.4}
                label={{ value: "Break-even", position: "insideTopRight",
                         fontSize: 8, fill: "#6b85a0" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RIGHT: Histogram — standard vertical columns (X=equity bins, Y=count) */}
        <div style={{ flex: "1" }}>
          <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">
            FINAL EQUITY DIST.
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={[...sim.histData].sort((a, b) => a.midpoint - b.midpoint)}
              margin={{ top: 4, right: 4, left: 0, bottom: 16 }}
              barCategoryGap="4%"
            >
              <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />

              {/* X-axis = equity value bins */}
              <XAxis
                dataKey="midpoint"
                tick={{ fontSize: 7, fill: "#4a6080" }}
                tickLine={false}
                axisLine={{ stroke: "#1e2d4a" }}
                tickFormatter={yFmt}
                label={{ value: "Final Equity", position: "insideBottom",
                         offset: -10, fontSize: 7, fill: "#4a6080" }}
              />

              {/* Y-axis = count of paths */}
              <YAxis
                tick={{ fontSize: 7, fill: "#4a6080" }}
                tickLine={false}
                axisLine={{ stroke: "#1e2d4a" }}
                width={22}
              />

              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a",
                                fontSize: 10 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: number, _: string, item: any) => {
                  const mid = item?.payload?.midpoint as number | undefined;
                  if (mid == null) return [`${v} paths`, ""];
                  const pct = ((mid - initial) / initial * 100).toFixed(1);
                  return [`${v} paths`, `${mid >= initial ? "+" : ""}${pct}%`];
                }}
              />

              {/* Break-even vertical reference */}
              <ReferenceLine
                x={initial}
                stroke="#c8d8f0"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
                label={{ value: "B/E", position: "top",
                         fontSize: 7, fill: "#6b85a0" }}
              />

              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {[...sim.histData].sort((a, b) => a.midpoint - b.midpoint).map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.profit ? "#00ff88" : "#ff4757"}
                    fillOpacity={entry.profit ? 0.75 : 0.65}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

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
          <span className="w-2 h-2 rounded-sm bg-[#00ff88] opacity-75 inline-block" /> Profit
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#ff4757] opacity-65 inline-block" /> Loss
        </span>
      </div>

      {/* ── Key stats ── */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {([
          { label: "Avg Max DD", val: `${mc?.avg_max_dd?.toFixed(1) ?? "—"}%`,  color: "text-[#ff4757]" },
          { label: "VaR (5%)",   val: `${mc?.var_5?.toFixed(1) ?? "—"}%`,       color: "text-[#ff4757]" },
          { label: "Confidence", val: mc?.confidence ?? "—",
            color: mc?.confidence === "HIGH" ? "text-[#00ff88]" : "text-[#ffa502]" },
        ] as const).map(m => (
          <div key={m.label} className="bg-[#0a0e1a] border border-[#1e2d4a] rounded p-1.5 text-center">
            <div className="text-[#4a6080] text-[0.6rem]">{m.label}</div>
            <div className={`font-mono font-bold ${m.color}`}>{m.val}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
