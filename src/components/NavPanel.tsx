"use client";
import { useState, useEffect } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import type { RegionStats } from "@/lib/navStats";
import { MIN_OBS_FOR_REGRESSION } from "@/lib/navStats";

interface NavApiResponse {
  US: RegionStats;
  HK: RegionStats;
  lastDate: string | null;
}

const ACCENT = "#00d4ff";
const MUTED  = "#4a6080";

// Compact inline SVG line chart: nav (accent) + benchNav (muted).
// benchNav segments are simply absent where null (line stops).
function NavChart({ series }: { series: RegionStats["navSeries"] }) {
  const W = 260, H = 64, PAD = 3;
  const navVals   = series.map(p => p.nav);
  const benchVals = series.filter(p => p.benchNav !== null).map(p => p.benchNav as number);
  const all = [...navVals, ...benchVals];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  const navPts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.nav).toFixed(1)}`).join(" ");
  const benchPts = series
    .map((p, i) => (p.benchNav !== null ? `${x(i).toFixed(1)},${y(p.benchNav).toFixed(1)}` : null))
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      {benchPts.split(" ").length >= 2 && (
        <polyline points={benchPts} fill="none" stroke={MUTED} strokeWidth={1} opacity={0.7} />
      )}
      <polyline points={navPts} fill="none" stroke={ACCENT} strokeWidth={1.5} />
    </svg>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="text-[0.72rem] font-mono px-1.5 py-0.5 rounded border border-[#1e2d4a] bg-[#080d1a]">
      <span className="text-[#4a6080]">{label} </span>
      <span className={color ?? "text-[#c8d8f0]"}>{value}</span>
    </span>
  );
}

function RegionBlock({ region, stats }: { region: "US" | "HK"; stats: RegionStats }) {
  const ret = stats.totalReturnPct;
  const retColor = ret >= 0 ? "text-[#00ff88]" : "text-[#ff4757]";
  const ddColor = stats.maxDrawdownPct < 0 ? "text-[#ff4757]" : "text-[#c8d8f0]";

  return (
    <div className="flex-1 bg-[#080d1a] border border-[#1e2d4a] rounded p-2 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.72rem] font-mono font-bold text-[#6b85a0] tracking-widest">
          {region} <span className="text-[#2a3d5a]">· {region === "US" ? "vs SPY" : "vs HSI"}</span>
        </span>
        <span className="text-[0.72rem] font-mono text-[#4a6080]">{stats.observations}d</span>
      </div>

      {stats.navSeries.length >= 2 ? (
        <NavChart series={stats.navSeries} />
      ) : (
        <div className="h-16 flex items-center justify-center text-[0.72rem] text-[#4a6080] font-mono">
          accruing data — {stats.observations} day{stats.observations === 1 ? "" : "s"}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <StatChip label="Ret" value={`${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`} color={retColor} />
        <StatChip label="Sharpe" value={stats.annSharpe !== null ? stats.annSharpe.toFixed(2) : "—"} />
        <StatChip label="MaxDD" value={`${stats.maxDrawdownPct.toFixed(1)}%`} color={ddColor} />
        {stats.alpha !== null && stats.beta !== null ? (
          <>
            <StatChip
              label="α"
              value={`${stats.alpha >= 0 ? "+" : ""}${(stats.alpha * 100).toFixed(1)}%`}
              color={stats.alpha >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}
            />
            <StatChip label="β" value={stats.beta.toFixed(2)} />
          </>
        ) : (
          <span className="text-[0.72rem] font-mono px-1.5 py-0.5 rounded border border-[#1e2d4a]/50 text-[#4a6080]">
            α/β {Math.min(stats.observations, MIN_OBS_FOR_REGRESSION)}/{MIN_OBS_FOR_REGRESSION} obs
          </span>
        )}
      </div>
    </div>
  );
}

export default function NavPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<NavApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/nav")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData(body as NavApiResponse);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  const empty = data !== null && data.US.observations === 0 && data.HK.observations === 0;

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded p-3 my-3">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[#00d4ff] text-sm font-bold">📈 AUTOPILOT REALIZED NAV</span>
          <InfoTooltip id="nav" />
          {data?.lastDate && (
            <span className="text-[#4a6080] text-xs font-mono">last entry {data.lastDate}</span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="mt-2">
          {loading && (
            <div className="text-[0.72rem] text-[#4a6080] font-mono">loading NAV history…</div>
          )}
          {!loading && error && (
            <div className="text-[0.72rem] text-[#4a6080] font-mono">nav history unavailable — {error}</div>
          )}
          {!loading && !error && empty && (
            <div className="text-[0.72rem] text-[#4a6080] font-mono">
              no NAV entries yet — accrues daily from EOD Autopilot runs
            </div>
          )}
          {!loading && !error && data && !empty && (
            <div className="flex flex-col sm:flex-row gap-3">
              <RegionBlock region="US" stats={data.US} />
              <RegionBlock region="HK" stats={data.HK} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
