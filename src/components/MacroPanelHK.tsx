"use client";
import { useState } from "react";
import { HKMacroData, MacroFactor } from "@/lib/macro-types";

interface Props {
  data: HKMacroData | null;
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

// HK Radar — factor order: VHSI, USD/HKD, HSI/HSTECH, Southbound, HIBOR, Breadth
function HKRadarChart({ factors }: { factors: HKMacroData["factors"] }) {
  const vals = [
    factors.vhsi.score,
    factors.usdHkd.score,
    factors.hsiTrends.score,
    factors.southbound.score,
    factors.hibor.score,
    factors.breadth.score,
  ];
  const labels = ["VHSI", "USD/HKD", "HSI/Tech", "S-bound", "HIBOR", "Breadth"];
  const n = vals.length;
  const cx = 80, cy = 80, r = 58;

  function polarToXY(angle: number, radius: number) {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  const step = 360 / n;
  const gridLevels = [2, 4, 6, 8, 10];

  const dataPoints = vals.map((v, i) => {
    const { x, y } = polarToXY(i * step, (v / 10) * r);
    return `${x},${y}`;
  });

  const gridPolys = gridLevels.map(lv =>
    Array.from({ length: n }, (_, i) => {
      const { x, y } = polarToXY(i * step, (lv / 10) * r);
      return `${x},${y}`;
    }).join(" ")
  );

  const axes  = Array.from({ length: n }, (_, i) => polarToXY(i * step, r));
  const lblPts = Array.from({ length: n }, (_, i) => polarToXY(i * step, r + 14));

  return (
    <svg viewBox="0 0 160 160" width="150" height="150">
      {gridPolys.map((pts, gi) => (
        <polygon key={gi} points={pts} fill="none" stroke="#1e2d4a" strokeWidth={gi === 4 ? 1 : 0.5} />
      ))}
      {axes.map((end, i) => (
        <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#1e2d4a" strokeWidth={0.8} />
      ))}
      {/* HK uses red accent for panel identity */}
      <polygon points={dataPoints.join(" ")} fill="rgba(255,71,87,0.10)" stroke="#ff7f50" strokeWidth={1.5} />
      {vals.map((v, i) => {
        const { x, y } = polarToXY(i * step, (v / 10) * r);
        return <circle key={i} cx={x} cy={y} r={2.5}
          fill={v >= 7 ? "#00ff88" : v >= 5 ? "#ffa502" : "#ff4757"} />;
      })}
      {lblPts.map((pt, i) => (
        <text key={i} x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="middle"
          fontSize="6.5" fill="#6b85a0" fontFamily="monospace">{labels[i]}</text>
      ))}
    </svg>
  );
}

function FactorCard({ factor }: { factor: MacroFactor }) {
  const barColor   = factor.score >= 7 ? "#00ff88" : factor.score >= 5 ? "#ffa502" : "#ff4757";
  const scoreColor = factor.score >= 7 ? "text-[#00ff88]" : factor.score >= 5 ? "text-[#ffa502]" : "text-[#ff4757]";
  return (
    <div className="bg-[#080d1a] border border-[#1e2d4a] rounded p-2 min-w-[110px]">
      <div className="text-[#4a6080] text-[0.58rem] font-bold mb-1 tracking-wide uppercase">{factor.label}</div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-bold font-mono ${scoreColor}`}>{factor.value}</span>
        <span className="text-xs">{signalIcon(factor.signal)}</span>
      </div>
      <div className="h-1 bg-[#1e2d4a] rounded mb-1">
        <div className="h-1 rounded" style={{ width: `${(factor.score / 10) * 100}%`, background: barColor }} />
      </div>
      <div className={`text-[0.58rem] font-mono truncate ${signalColor(factor.signal)}`}>{factor.detail}</div>
    </div>
  );
}

export default function MacroPanelHK({ data, loading, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!data && !loading) return null;

  const mbs   = data?.mbs ?? 5.0;
  const label = data?.mbsLabel ?? "NEUTRAL";

  return (
    <div className={`mx-4 my-2 rounded border ${data ? mbsBorderColor(mbs) : "border-[#1e2d4a]"} ${data ? mbsBg(mbs) : ""}`}>

      {/* Header — red accent to distinguish from US panel */}
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(v => !v)}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#ff7f50] text-xs font-bold tracking-widest">🇭🇰 HK MARKET INTELLIGENCE</span>
          {data && (
            <>
              <span className="text-[#1e2d4a]">|</span>
              <span className={`text-xs font-bold font-mono ${mbsColor(mbs)}`}>MBS {mbs.toFixed(1)}/10</span>
              <span className={`text-xs font-mono ${mbsColor(mbs)}`}>{mbsWarningLabel(label)}</span>
              <div className="hidden sm:flex items-center gap-1 ml-1">
                {Object.values(data.factors).map((f, i) => (
                  <span key={i} title={`${f.label}: ${f.score}/10`}
                    className={`text-[0.55rem] font-mono ${f.score >= 7 ? "text-[#00ff88]" : f.score >= 5 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
                    {f.score}
                  </span>
                ))}
              </div>
            </>
          )}
          {loading && <span className="text-[#ffa502] text-xs blink">· fetching HK macro…</span>}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <button onClick={e => { e.stopPropagation(); onRefresh(); }}
              className="text-[#4a6080] hover:text-[#ff7f50] text-xs transition-colors px-1" title="Refresh HK macro">
              ↺
            </button>
          )}
          <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
        </div>
      </div>

      {/* Body */}
      {!collapsed && data && (
        <div className="px-3 pb-3 border-t border-[#1e2d4a]/50">

          {/* Factor cards + Radar */}
          <div className="flex gap-3 mt-3 items-start overflow-x-auto">
            <div className="flex gap-2 flex-wrap">
              {Object.values(data.factors).map((f, i) => <FactorCard key={i} factor={f} />)}
            </div>
            <div className="shrink-0 flex flex-col items-center ml-auto">
              <div className="text-[#4a6080] text-[0.58rem] mb-1 font-bold tracking-widest">FACTOR RADAR</div>
              <HKRadarChart factors={data.factors} />
            </div>
          </div>

          {/* MBS bar */}
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[#4a6080] text-xs shrink-0">HK MACRO SCORE</span>
            <div className="flex-1 h-2 bg-[#1e2d4a] rounded overflow-hidden">
              <div className="h-2 rounded transition-all" style={{
                width: `${(mbs / 10) * 100}%`,
                background: mbs >= 7 ? "#00ff88" : mbs >= 5.5 ? "#ffa502" : "#ff4757",
              }} />
            </div>
            <span className={`text-sm font-bold font-mono ${mbsColor(mbs)}`}>{mbs.toFixed(1)}/10</span>
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${mbsColor(mbs)} ${mbsBorderColor(mbs)}`}>
              {mbsWarningLabel(label)}
            </span>
          </div>

          {/* Adjustment note */}
          <div className="mt-1 text-[0.6rem] text-[#4a6080] font-mono">
            {mbs >= 7.0  && "📈 HK macro tailwind — HK SCR score +0.5 bonus applied"}
            {mbs >= 5.5  && mbs < 7.0  && "— Neutral HK macro — no SCR adjustment"}
            {mbs >= 4.0  && mbs < 5.5  && "⚠️ HK Caution — HK SCR score −0.3 penalty applied"}
            {mbs >= 2.5  && mbs < 4.0  && "🚨 HK Risk-off — HK SCR score −0.5 penalty applied"}
            {mbs < 2.5   && "🛑 Avoid HK entries — SCR score −1.0 penalty applied"}
            <span className="ml-2 text-[#2a3d5a]">· SuperTrend unaffected · applies to HK stocks only</span>
          </div>

          {/* Factor weights legend */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.55rem] text-[#2a3d5a] font-mono">
            <span>VHSI 25%</span>
            <span>USD/HKD 25%</span>
            <span>HSI/Tech 20%</span>
            <span>Southbound 15%</span>
            <span>HIBOR 7.5%</span>
            <span>Breadth 7.5%</span>
          </div>

          {/* HK Headlines */}
          {data.headlines.length > 0 && (
            <div className="mt-3 border-t border-[#1e2d4a]/50 pt-2">
              <div className="text-[#4a6080] text-xs font-bold mb-1.5 tracking-widest">📰 HK HEADLINES</div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {data.headlines.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 text-[0.63rem]">
                    <span className="shrink-0 mt-0.5">{signalIcon(h.sentiment)}</span>
                    <span className={`leading-relaxed ${h.sentiment === "bullish" ? "text-[#c8d8f0]" : h.sentiment === "bearish" ? "text-[#8a9bb0]" : "text-[#5a7090]"}`}>
                      {h.title}
                    </span>
                    <span className="shrink-0 text-[#2a3d5a] text-[0.55rem] ml-auto">{h.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[#2a3d5a] text-[0.55rem] font-mono">
              fetched {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
            {data.error && <span className="text-[#ff4757] text-[0.55rem]">⚠ partial data</span>}
          </div>
        </div>
      )}
    </div>
  );
}
