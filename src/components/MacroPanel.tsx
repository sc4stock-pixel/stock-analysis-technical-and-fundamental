"use client";
import { useState, useCallback } from "react";
import { MacroData, MacroFactor, mbsLabel } from "@/lib/macro";

interface Props {
  data: MacroData | null;
  loading: boolean;
  onRefresh: () => void;
}

function signalColor(s: MacroFactor["signal"]): string {
  if (s === "bullish") return "text-[#00ff88]";
  if (s === "bearish") return "text-[#ff4757]";
  return "text-[#ffa502]";
}

function signalIcon(s: MacroFactor["signal"]): string {
  if (s === "bullish") return "🟢";
  if (s === "bearish") return "🔴";
  return "🟡";
}

function mbsColor(mbs: number): string {
  if (mbs >= 7.0) return "text-[#00ff88]";
  if (mbs >= 5.5) return "text-[#ffa502]";
  if (mbs >= 4.0) return "text-[#ffa502]";
  return "text-[#ff4757]";
}

function mbsBorderColor(mbs: number): string {
  if (mbs >= 7.0) return "border-[#00ff88]/40";
  if (mbs >= 5.5) return "border-[#ffa502]/40";
  if (mbs >= 4.0) return "border-[#ffa502]/30";
  return "border-[#ff4757]/40";
}

function mbsBg(mbs: number): string {
  if (mbs >= 7.0) return "bg-[#00ff88]/5";
  if (mbs >= 5.5) return "bg-[#ffa502]/5";
  if (mbs >= 4.0) return "bg-[#ffa502]/5";
  return "bg-[#ff4757]/5";
}

function mbsWarningLabel(label: string): string {
  if (label === "BULLISH")  return "✅ BULLISH";
  if (label === "NEUTRAL")  return "— NEUTRAL";
  if (label === "CAUTION")  return "⚠️ CAUTION";
  if (label === "RISK-OFF") return "🚨 RISK-OFF";
  return "🛑 AVOID";
}

// SVG Radar Chart for 6 macro factors
function RadarChart({ factors }: { factors: MacroData["factors"] }) {
  const vals = [
    factors.fearGreed.score,
    factors.vixStructure.score,
    factors.indexTrends.score,
    factors.adRatio.score,
    factors.newsSentiment.score,
    factors.breadth.score,
  ];
  const labels = ["F&G", "VIX", "Idx", "A/D", "News", "Breadth"];
  const n = vals.length;
  const cx = 80, cy = 80, r = 60;
  const maxVal = 10;

  function polarToXY(angle: number, radius: number) {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  const angleStep = 360 / n;
  const gridLevels = [2, 4, 6, 8, 10];

  // Data polygon
  const dataPoints = vals.map((v, i) => {
    const { x, y } = polarToXY(i * angleStep, (v / maxVal) * r);
    return `${x},${y}`;
  });

  // Grid polygons
  const gridPolygons = gridLevels.map(level => {
    const pts = Array.from({ length: n }, (_, i) => {
      const { x, y } = polarToXY(i * angleStep, (level / maxVal) * r);
      return `${x},${y}`;
    });
    return pts.join(" ");
  });

  // Axis lines
  const axes = Array.from({ length: n }, (_, i) => {
    const end = polarToXY(i * angleStep, r);
    return end;
  });

  // Label positions (slightly outside)
  const labelPts = Array.from({ length: n }, (_, i) => {
    return polarToXY(i * angleStep, r + 14);
  });

  return (
    <svg viewBox="0 0 160 160" width="160" height="160">
      {/* Grid */}
      {gridPolygons.map((pts, gi) => (
        <polygon key={gi} points={pts}
          fill="none" stroke="#1e2d4a" strokeWidth={gi === 4 ? 1 : 0.5} />
      ))}
      {/* Axes */}
      {axes.map((end, i) => (
        <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y}
          stroke="#1e2d4a" strokeWidth={0.8} />
      ))}
      {/* Data */}
      <polygon points={dataPoints.join(" ")}
        fill="rgba(0,212,255,0.15)" stroke="#00d4ff" strokeWidth={1.5} />
      {vals.map((v, i) => {
        const { x, y } = polarToXY(i * angleStep, (v / maxVal) * r);
        return <circle key={i} cx={x} cy={y} r={2.5}
          fill={v >= 7 ? "#00ff88" : v >= 5 ? "#ffa502" : "#ff4757"} />;
      })}
      {/* Labels */}
      {labelPts.map((pt, i) => (
        <text key={i} x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="middle"
          fontSize="7" fill="#6b85a0" fontFamily="monospace">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

function FactorCard({ factor }: { factor: MacroFactor }) {
  const scoreBar = Math.min(100, (factor.score / 10) * 100);
  const barColor = factor.score >= 7 ? "#00ff88" : factor.score >= 5 ? "#ffa502" : "#ff4757";

  return (
    <div className="bg-[#080d1a] border border-[#1e2d4a] rounded p-2 min-w-[120px]">
      <div className="text-[#4a6080] text-[0.6rem] font-bold mb-1 tracking-wide uppercase">{factor.label}</div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-bold font-mono ${factor.score >= 7 ? "text-[#00ff88]" : factor.score >= 5 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
          {typeof factor.value === "number" ? factor.value : factor.value}
        </span>
        <span className="text-xs">{signalIcon(factor.signal)}</span>
      </div>
      <div className="h-1 bg-[#1e2d4a] rounded mb-1">
        <div className="h-1 rounded transition-all" style={{ width: `${scoreBar}%`, background: barColor }} />
      </div>
      <div className={`text-[0.6rem] font-mono ${signalColor(factor.signal)}`}>{factor.detail}</div>
    </div>
  );
}

export default function MacroPanel({ data, loading, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!data && !loading) return null;

  const mbs = data?.mbs ?? 5.0;
  const label = data?.mbsLabel ?? "NEUTRAL";

  return (
    <div className={`mx-4 my-3 rounded border ${data ? mbsBorderColor(mbs) : "border-[#1e2d4a]"} ${data ? mbsBg(mbs) : ""}`}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-[#00d4ff] text-xs font-bold tracking-widest">🌐 MARKET INTELLIGENCE</span>
          {data && (
            <>
              <span className="text-[#1e2d4a]">|</span>
              <span className={`text-xs font-bold font-mono ${mbsColor(mbs)}`}>
                MBS {mbs.toFixed(1)}/10
              </span>
              <span className={`text-xs font-mono ${mbsColor(mbs)}`}>
                {mbsWarningLabel(label)}
              </span>
              {data.factors && (
                <div className="hidden sm:flex gap-1.5 ml-2">
                  {Object.values(data.factors).map((f, i) => (
                    <span key={i} title={`${f.label}: ${f.score}/10`}>
                      <span className={`text-[0.55rem] font-mono ${f.score >= 7 ? "text-[#00ff88]" : f.score >= 5 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
                        {f.score.toFixed(0)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          {loading && <span className="text-[#ffa502] text-xs blink">· fetching…</span>}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={e => { e.stopPropagation(); onRefresh(); }}
              className="text-[#4a6080] hover:text-[#00d4ff] text-xs transition-colors px-1"
              title="Refresh macro data"
            >
              ↺
            </button>
          )}
          <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
        </div>
      </div>

      {/* ── Body ── */}
      {!collapsed && data && (
        <div className="px-3 pb-3 border-t border-[#1e2d4a]/50">

          {/* Factor cards + Radar */}
          <div className="flex gap-3 mt-3 overflow-x-auto">
            {/* Factor cards */}
            <div className="flex gap-2 flex-wrap">
              {Object.values(data.factors).map((f, i) => (
                <FactorCard key={i} factor={f} />
              ))}
            </div>

            {/* Radar chart */}
            <div className="shrink-0 flex flex-col items-center justify-center ml-auto">
              <div className="text-[#4a6080] text-[0.6rem] mb-1 font-bold tracking-widest">FACTOR RADAR</div>
              <RadarChart factors={data.factors} />
            </div>
          </div>

          {/* MBS Score bar */}
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[#4a6080] text-xs shrink-0">MACRO SCORE</span>
            <div className="flex-1 h-2 bg-[#1e2d4a] rounded">
              <div
                className="h-2 rounded transition-all"
                style={{
                  width: `${(mbs / 10) * 100}%`,
                  background: mbs >= 7 ? "#00ff88" : mbs >= 5.5 ? "#ffa502" : mbs >= 4 ? "#ffa502" : "#ff4757",
                }}
              />
            </div>
            <span className={`text-sm font-bold font-mono ${mbsColor(mbs)}`}>{mbs.toFixed(1)}/10</span>
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${mbsColor(mbs)} ${mbsBorderColor(mbs)}`}>
              {mbsWarningLabel(label)}
            </span>
          </div>

          {/* Score adjustment note */}
          <div className="mt-1.5 text-[0.6rem] text-[#4a6080] font-mono">
            {mbs >= 7.0 && "📈 Macro tailwind — SCR score +0.5 bonus applied"}
            {mbs >= 5.5 && mbs < 7.0 && "— Neutral macro — no SCR adjustment"}
            {mbs >= 4.0 && mbs < 5.5 && "⚠️ Caution — SCR score −0.3 penalty applied"}
            {mbs >= 2.5 && mbs < 4.0 && "🚨 Risk-off — SCR score −0.5 penalty applied"}
            {mbs < 2.5 && "🛑 Avoid entries — SCR score −1.0 penalty applied"}
            <span className="ml-2 text-[#1e2d4a]">· SuperTrend unaffected</span>
          </div>

          {/* Headlines */}
          {data.headlines.length > 0 && (
            <div className="mt-3 border-t border-[#1e2d4a]/50 pt-2">
              <div className="text-[#4a6080] text-xs font-bold mb-1.5 tracking-widest">📰 HEADLINES</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {data.headlines.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 text-[0.65rem]">
                    <span className="shrink-0 mt-0.5">{signalIcon(h.sentiment)}</span>
                    <span className={`leading-relaxed ${h.sentiment === "bullish" ? "text-[#c8d8f0]" : h.sentiment === "bearish" ? "text-[#9bacc0]" : "text-[#6b85a0]"}`}>
                      {h.title}
                    </span>
                    <span className="shrink-0 text-[#2a3d5a] text-[0.55rem] ml-auto">{h.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fetch time */}
          <div className="mt-2 text-[#2a3d5a] text-[0.55rem] text-right">
            fetched {new Date(data.fetchedAt).toLocaleTimeString()}
            {data.error && <span className="text-[#ff4757] ml-2">⚠ partial data</span>}
          </div>
        </div>
      )}
    </div>
  );
}
