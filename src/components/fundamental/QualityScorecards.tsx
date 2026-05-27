// src/components/fundamental/QualityScorecards.tsx
'use client';
import type { FundamentalsPayload } from '../../app/api/fundamentals/route';
import { thresholdColor, tailwindBand } from './format';

interface Props { data: FundamentalsPayload; }

function MiniSparkline({ values, stroke }: { values: (number | null)[]; stroke: string }) {
  const clean = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (clean.length < 2) return <div className="text-xs opacity-40">—</div>;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const w = 80, h = 24;
  const pts = clean.map((v, i) =>
    `${(i / (clean.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
      {clean.map((v, i) => (
        <circle key={i}
          cx={(i / (clean.length - 1)) * w}
          cy={h - ((v - min) / range) * h}
          r="1.5" fill={stroke} />
      ))}
    </svg>
  );
}

function Scorecard({ title, value, label, sparkValues, color }: {
  title: string; value: string; label: string;
  sparkValues: (number | null)[];
  color: "emerald" | "amber" | "rose";
}) {
  const stroke = { emerald: "#10b981", amber: "#d97706", rose: "#f43f5e" }[color];
  return (
    <div className={`rounded-md border p-4 ${tailwindBand(color)}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80 mb-2">{title}</div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-3xl font-mono">{value}</div>
        <div className="text-xs font-mono opacity-80">{label}</div>
      </div>
      <MiniSparkline values={sparkValues} stroke={stroke} />
      <div className="text-[10px] opacity-60 mt-1">4-period trend</div>
    </div>
  );
}

export default function QualityScorecards({ data }: Props) {
  const z = data.derived.altmanZ[0];
  const f = data.derived.piotroskiF[0];
  const zColor = thresholdColor("Z", z ?? null);
  const fColor = thresholdColor("F", f ?? null);
  const zLabel = z === null || z === undefined ? "—" : z > 2.99 ? "SAFE" : z >= 1.81 ? "GRAY" : "DISTRESS";
  const fLabel = f === null || f === undefined ? "—" : f >= 7 ? "ELITE" : f >= 4 ? "MID" : "WEAK";

  const insight = (() => {
    if (f != null && f >= 7 && z != null && z > 2.99)
      return { text: "📈 VISUAL INSIGHT: Elite quality score + safe Z-score — strong structural confirmation 🟢", color: "text-emerald-400" };
    if (f != null && f >= 7)
      return { text: "📊 VISUAL INSIGHT: Elite Piotroski score — high operational quality 🟢", color: "text-emerald-400" };
    if (f != null && f <= 3)
      return { text: "⚠️ VISUAL INSIGHT: Low Piotroski score — fundamental weakness detected 🔴", color: "text-rose-400" };
    return null;
  })();

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Scorecard
          title="Altman Z-Score"
          value={z != null ? z.toFixed(2) : "—"}
          label={zLabel}
          sparkValues={data.derived.altmanZ}
          color={zColor}
        />
        <Scorecard
          title="Piotroski F-Score"
          value={f != null ? `${f}/9` : "—"}
          label={fLabel}
          sparkValues={data.derived.piotroskiF}
          color={fColor}
        />
      </div>
      {insight && <p className={`mt-2 text-[10px] font-mono ${insight.color}`}>{insight.text}</p>}
    </div>
  );
}
