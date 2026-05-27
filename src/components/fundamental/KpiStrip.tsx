// src/components/fundamental/KpiStrip.tsx
'use client';
import type { FundamentalsPayload } from '../../app/api/fundamentals/route';
import { fmtPct, fmtBps, fmtMoney, thresholdColor, tailwindBand } from './format';

interface Props { data: FundamentalsPayload; }

function Sparkline({ values, stroke }: { values: (number | null)[]; stroke: string }) {
  const clean = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (clean.length < 2) return <div className="h-6 w-16 opacity-30">—</div>;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const w = 64, h = 24;
  const pts = clean.map((v, i) =>
    `${(i / (clean.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function Tile({ label, value, sparkValues, dotColor, sparkColor }: {
  label: string; value: string;
  sparkValues: (number | null)[];
  dotColor: "emerald" | "amber" | "rose";
  sparkColor: string;
}) {
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" }[dotColor];
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-neutral-800 rounded-md bg-neutral-900/40">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-sm font-mono text-neutral-100">{value}</div>
      </div>
      <Sparkline values={sparkValues} stroke={sparkColor} />
    </div>
  );
}

export default function KpiStrip({ data }: Props) {
  const periods = data.periods;
  const step = data.frequency === "H" ? 2 : 4;

  const revYoY = (() => {
    const curr = periods[0]?.revenue;
    const prior = periods[step]?.revenue;
    if (!curr || !prior) return null;
    return ((curr - prior) / Math.abs(prior)) * 100;
  })();
  const revYoYSeries = periods.slice(0, 4).map((p, i) => {
    const prior = periods[i + step]?.revenue;
    if (!p.revenue || !prior) return null;
    return ((p.revenue - prior) / Math.abs(prior)) * 100;
  });

  const gmDelta = (() => {
    const c = periods[0], p = periods[1];
    if (!c?.revenue || !c?.grossProfit || !p?.revenue || !p?.grossProfit) return null;
    return ((c.grossProfit / c.revenue) - (p.grossProfit / p.revenue)) * 10000;
  })();
  const gmSeries = periods.slice(0, 4).map(p =>
    p.revenue && p.grossProfit ? (p.grossProfit / p.revenue) * 100 : null
  );

  const fcfTtm = (() => {
    const ttmN = data.frequency === "H" ? 2 : 4;
    const slice = periods.slice(0, ttmN).map(p => p.fcf).filter((v): v is number => v != null);
    if (slice.length < ttmN) return null;
    return slice.reduce((a, b) => a + b, 0);
  })();
  const fcfSeries = periods.slice(0, 4).map(p => p.fcf ?? null);

  const z = data.derived.altmanZ[0];
  const f = data.derived.piotroskiF[0];
  const zVariant = data.derived.zVariant ?? "Z";
  const zLabelPrefix = zVariant === "Zpp" ? "Z″" : "Z";

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <Tile
        label="Revenue YoY"
        value={fmtPct(revYoY)}
        sparkValues={[...revYoYSeries].reverse()}
        dotColor={(revYoY ?? 0) >= 0 ? "emerald" : "rose"}
        sparkColor="#3b82f6"
      />
      <Tile
        label="Gross Margin Δ"
        value={fmtBps(gmDelta)}
        sparkValues={[...gmSeries].reverse()}
        dotColor={(gmDelta ?? 0) >= 0 ? "emerald" : "rose"}
        sparkColor="#d97706"
      />
      <Tile
        label="FCF/share TTM"
        value={fmtMoney(fcfTtm)}
        sparkValues={[...fcfSeries].reverse()}
        dotColor={(fcfTtm ?? 0) >= 0 ? "emerald" : "rose"}
        sparkColor="#10b981"
      />
      <div className={`flex items-center gap-2 px-3 py-2 border rounded-md ${tailwindBand(thresholdColor("Z", z ?? null, zVariant))}`}>
        <div className="text-[10px] uppercase tracking-wider opacity-70">Quality</div>
        <div className="flex items-center gap-2 text-sm font-mono">
          <span>{zLabelPrefix} {z?.toFixed(2) ?? "—"}</span>
          <span className="opacity-40">·</span>
          <span>F {f ?? "—"}/9</span>
        </div>
      </div>
    </div>
  );
}
