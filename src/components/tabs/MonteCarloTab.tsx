"use client";
// ============================================================
// MONTE CARLO FAN CHART TAB — V2 (all issues fixed)
//
// FIX 1 — Fan chart X-axis full width:
//   type="number" + domain={[0, sim.n]} + scale="linear" forces
//   Recharts to treat t as a continuous numeric axis, not categorical.
//   Without this, 60 path{i} dataKeys each add a category slot,
//   making paths appear to stop at ~1/3 of the chart width.
//
// FIX 2 — Histogram Y-axis ascending (low→high, red bottom, green top):
//   histData sorted ascending by midpoint before BarChart + Cell array.
//   Recharts layout="vertical" with ascending data renders lowest bar
//   at bottom. type="number" YAxis with domain=[yMin,yMax] gives
//   continuous scale matching the fan chart orientation exactly.
//
// FIX 3 — Shared Y domain:
//   Both charts use identical yMin=p5*0.97 → yMax=p95*1.03 and
//   the same yFmt formatter, so Y-axes are perfectly aligned.
// ============================================================
import { useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";

interface Props { result: StockAnalysisResult; }

// ── Block-bootstrap re-simulation (client-side, 200 paths) ──────
function runClientMC(equityCurve: number[], initialCapital: number, runs = 200) {
  if (equityCurve.length < 10) return null;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) returns.push((equityCurve[i] - prev) / prev);
  }
  if (returns.length < 5) return null;

  const n         = returns.length;
  const blockSize = Math.max(3, Math.round(Math.sqrt(n)));

  const paths: number[][] = [];
  const finalValues: number[] = [];

  for (let r = 0; r < runs; r++) {
    const path: number[] = [initialCapital];
    let equity = initialCapital;

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

  // ── Time-series data: percentile bands + sampled paths ────────
  const steps = paths[0].length; // n+1 (includes t=0 initial capital)

  // Sample 60 paths evenly across the sorted final-value range
  const sampleIndices: number[] = [];
  const sortedByFinal = paths
    .map((p, i) => ({ i, final: p[p.length - 1] }))
    .sort((a, b) => a.final - b.final);
  for (let i = 0; i < Math.min(60, runs); i++) {
    sampleIndices.push(sortedByFinal[Math.floor((i / Math.min(60, runs)) * runs)].i);
  }

  const timeData: Record<string, number>[] = [];
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
    sampleIndices.forEach((si, li) => { row[`path${li}`] = paths[si][t]; });
    timeData.push(row);
  }

  // ── Histogram: 20 bins, SORTED ASCENDING for correct bar order ──
  const minVal  = finalValues[0]                    * 0.98;
  const maxVal  = finalValues[finalValues.length - 1] * 1.02;
  const bins    = 20;
  const binWidth = (maxVal - minVal) / bins;

  // Build and SORT ascending so lowest equity is first
  // Recharts layout="vertical" renders first item at top by default,
  // BUT with type="number" YAxis and domain, it uses the midpoint
  // value to position each bar on the continuous axis → correct!
  const histData = Array.from({ length: bins }, (_, b) => {
    const lo  = minVal + b * binWidth;
    const hi  = lo + binWidth;
    const mid = Math.round((lo + hi) / 2);
    const count = finalValues.filter(v => v >= lo && v < hi).length;
    return { midpoint: mid, count, profit: mid >= initialCapital };
  }).sort((a, b) => a.midpoint - b.midpoint); // ascending = low→high

  const probProfit = (finalValues.filter(v => v >= initialCapital).length / runs) * 100;

  return {
    timeData, histData,
    sampleCount: sampleIndices.length,
    p5, p25, p50, p75, p95,
    probProfit, initialCapital, n,
  };
}

// ── Custom tooltip ────────────────────────────────────────────────
function FanTooltip({ active, payload, label, initial }: {
  active?: boolean;
  payload?: { name: string; value: number }[];
  label?: number;
  initial: number;
}) {
  if (!active || !payload?.length) return null;
  const get = (name: string) => payload.find(p => p.name === name)?.value;
  const p50 = get("p50"); const p5 = get("p5"); const p95 = get("p95");
  if (p50 == null) return null;
  const ret = ((p50 - initial) / initial * 100).toFixed(1);
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded px-2 py-1.5 text-[0.65rem] font-mono shadow-xl">
      <div className="text-[#4a6080] mb-1">Day {label}</div>
      {p95 != null && <div className="text-[#00ff88]/80">95th:  ${p95.toFixed(0)}</div>}
      <div className="text-[#ffa502] font-bold">Median: ${p50.toFixed(0)} ({ret}%)</div>
      {p5  != null && <div className="text-[#ff4757]/80">5th:   ${p5.toFixed(0)}</div>}
    </div>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────
export default function MonteCarloTab({ result }: Props) {
  const mc      = result.monte_carlo;
  const bt      = result.backtest;
  const initial = bt?.equity_curve?.[0] ?? 10000;

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

  const probPct   = sim?.probProfit ?? mc?.prob_profit ?? 0;
  const probColor = probPct >= 60 ? "#00ff88" : probPct >= 50 ? "#ffa502" : "#ff4757";
  const p5Val     = sim?.p5  ?? mc?.worst_equity  ?? initial;
  const p50Val    = sim?.p50 ?? mc?.median_equity ?? initial;
  const p95Val    = sim?.p95 ?? mc?.best_equity   ?? initial;
  const retPct    = (v: number) => ((v - initial) / initial * 100).toFixed(1);

  return (
    <div className="p-3 space-y-3">

      {/* ── Header: prob of profit + percentile stats ── */}
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
            { label: "5th pct",  val: p5Val,  color: "#ff4757" },
            { label: "Median",   val: p50Val, color: "#ffa502" },
            { label: "95th pct", val: p95Val, color: "#00ff88" },
          ] as const).map(m => (
            <div key={m.label} className="text-center">
              <div className="text-[#4a6080] text-[0.6rem]">{m.label}</div>
              <div className="font-mono font-bold" style={{ color: m.color }}>${m.val.toFixed(0)}</div>
              <div className="text-[#4a6080] text-[0.6rem]">{retPct(m.val)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Fan Chart + Histogram ── */}
      {sim ? (() => {
        // ── Shared Y domain: same scale on both charts ──────────
        // FIX 3: Both charts use identical yMin→yMax and yFmt
        const yMin = Math.round(sim.p5  * 0.97);
        const yMax = Math.round(sim.p95 * 1.03);
        const yFmt = (v: number) =>
          `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`;

        // Tick positions for the shared Y scale (5 evenly spaced)
        const yRange  = yMax - yMin;
        const yTicks  = [yMin, yMin + yRange * 0.25, yMin + yRange * 0.5,
                         yMin + yRange * 0.75, yMax].map(Math.round);

        return (
          <div className="flex gap-2" style={{ height: 280 }}>

            {/* ── LEFT: Fan Chart ── */}
            <div style={{ flex: "0 0 62%" }}>
              <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">
                SIMULATION PATHS ({sim.sampleCount})
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart
                  data={sim.timeData}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="1 6" stroke="#1e2d4a" vertical={false} />

                  {/* FIX 1: type="number" + explicit domain = paths fill full width */}
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

                  {/* FIX 3: Shared Y domain — matches histogram */}
                  <YAxis
                    type="number"
                    domain={[yMin, yMax]}
                    ticks={yTicks}
                    tick={{ fontSize: 8, fill: "#4a6080" }}
                    tickLine={false}
                    axisLine={{ stroke: "#1e2d4a" }}
                    width={46}
                    tickFormatter={yFmt}
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

                  {/* 90% confidence cone */}
                  <Area dataKey="p95" stroke="none" fill="#00ff88" fillOpacity={0.06}
                    isAnimationActive={false} legendType="none" name="p95_area" />
                  <Area dataKey="p5"  stroke="none" fill="#ff4757" fillOpacity={0.08}
                    isAnimationActive={false} legendType="none" name="p5_area" />

                  {/* IQR cone */}
                  <Area dataKey="p75" stroke="none" fill="#ffa502" fillOpacity={0.10}
                    isAnimationActive={false} legendType="none" name="p75_area" />
                  <Area dataKey="p25" stroke="none" fill="#ffa502" fillOpacity={0.10}
                    isAnimationActive={false} legendType="none" name="p25_area" />

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

                  {/* Median — bold gold */}
                  <Line dataKey="p50" stroke="#ffa502" strokeWidth={2.5} dot={false}
                    isAnimationActive={false} legendType="none" name="p50" />

                  {/* Break-even */}
                  <ReferenceLine y={initial} stroke="#c8d8f0" strokeDasharray="3 3"
                    strokeOpacity={0.4}
                    label={{ value: "Break-even", position: "insideTopRight",
                             fontSize: 8, fill: "#6b85a0" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* ── RIGHT: Histogram ── */}
            {/* FIX 2: histData sorted ascending → red bars at bottom, green at top
                FIX 3: same yMin/yMax domain as fan chart                          */}
            <div style={{ flex: "0 0 38%" }}>
              <div className="text-[#4a6080] text-[0.6rem] mb-0.5 font-bold tracking-widest">
                FINAL EQUITY DIST.
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={sim.histData}  {/* already sorted ascending */}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  barCategoryGap="2%"
                >
                  {/* X-axis = path count */}
                  <XAxis
                    type="number"
                    tick={{ fontSize: 7, fill: "#4a6080" }}
                    tickLine={false}
                    axisLine={{ stroke: "#1e2d4a" }}
                    label={{ value: "Count", position: "insideBottom",
                             offset: -2, fontSize: 7, fill: "#4a6080" }}
                  />

                  {/* FIX 2+3: Y-axis = equity value, same domain as fan chart
                      type="number" + ascending domain → low at bottom, high at top */}
                  <YAxis
                    type="number"
                    dataKey="midpoint"
                    domain={[yMin, yMax]}
                    ticks={yTicks}
                    tick={{ fontSize: 7, fill: "#4a6080" }}
                    tickLine={false}
                    axisLine={{ stroke: "#1e2d4a" }}
                    width={44}
                    tickFormatter={yFmt}
                  />

                  <Tooltip
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

                  {/* Bars: color by profit/loss */}
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
                    label={{ value: "Break-even", position: "insideTopRight",
                             fontSize: 7, fill: "#6b85a0" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

          </div>
        );
      })() : (
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
