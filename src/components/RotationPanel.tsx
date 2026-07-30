"use client";
import { useState, useEffect } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import { spreadOf, pct, signed, DELTA_LOOKBACK, spreadDelta, type BreadthPoint } from "@/lib/breadth-history";
import { RATIO_MA_PERIOD, type RatioPoint } from "@/lib/rotation-ratio";

interface RotationApiResponse {
  breadth: BreadthPoint[];
  ratio: RatioPoint[];
  lead: "hk" | "us" | null;
  warning?: string;
}

// HK and US are IDENTITIES, not outcomes — so they get two neutral hues (cyan / amber)
// rather than the green/red used elsewhere for good/bad. A red "US favoured" bar would
// read as a loss when it only means the other side is leading.
const HK    = "#00d4ff";
const US    = "#ffa502";
const MUTED = "#4a6080";

/**
 * Diverging column chart of the HK−US breadth spread, one column per session.
 *
 * Zero is the whole point of this series, so the mark flips colour across it and the
 * baseline is drawn explicitly. Columns rather than a line because a long run of one
 * colour is what tells you favour is established rather than a one-day artifact.
 */
function SpreadChart({ points }: { points: BreadthPoint[] }) {
  const W = 260, H = 64, PAD = 3;
  const mid = H / 2;
  const n = points.length;
  // Fixed ±100 domain: the spread is bounded by definition, and a self-scaling axis would
  // make a quiet ±10 stretch of tape look as dramatic as a genuine ±80 divergence.
  const y = (v: number) => mid - (v / 100) * (mid - PAD);
  const bw = Math.max(1, Math.min(6, (W - 2 * PAD) / Math.max(n, 1) - 1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      <line x1={0} y1={mid} x2={W} y2={mid} stroke={MUTED} strokeWidth={0.5} opacity={0.6} />
      {points.map((p, i) => {
        const s = spreadOf(p);
        if (s === null) return null;
        const cx = PAD + (n === 1 ? (W - 2 * PAD) / 2 : (i / (n - 1)) * (W - 2 * PAD));
        const top = s >= 0 ? y(s) : mid;
        const h = Math.max(0.5, Math.abs(y(s) - mid));
        return (
          <rect
            key={p.date}
            x={(cx - bw / 2).toFixed(1)}
            y={top.toFixed(1)}
            width={bw.toFixed(1)}
            height={h.toFixed(1)}
            fill={s >= 0 ? HK : US}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

/**
 * `^HSTECH / ^NDX` against its trailing mean.
 *
 * Self-scaling here, unlike the spread chart — a ratio has no natural bounds, and what
 * matters is the shape relative to its own mean rather than an absolute level.
 */
function RatioChart({ points }: { points: RatioPoint[] }) {
  const W = 260, H = 64, PAD = 3;
  const withMa = points.filter(p => p.ma !== null);
  const all = [...points.map(p => p.ratio), ...withMa.map(p => p.ma as number)];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => PAD + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  const ratioPts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.ratio).toFixed(1)}`).join(" ");
  const maPts = points
    .map((p, i) => (p.ma !== null ? `${x(i).toFixed(1)},${y(p.ma).toFixed(1)}` : null))
    .filter((s): s is string => s !== null)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      {maPts.split(" ").length >= 2 && (
        <polyline points={maPts} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="3 2" />
      )}
      <polyline points={ratioPts} fill="none" stroke={HK} strokeWidth={1.5} />
    </svg>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="text-[0.72rem] font-mono px-1.5 py-0.5 rounded border border-[#1e2d4a] bg-[#080d1a]">
      <span className="text-[#4a6080]">{label} </span>
      <span style={color ? { color } : undefined} className={color ? undefined : "text-[#c8d8f0]"}>{value}</span>
    </span>
  );
}

export default function RotationPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<RotationApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rotation")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData(body as RotationApiResponse);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  const breadth = data?.breadth ?? [];
  const latest = breadth[breadth.length - 1];
  const spread = latest ? spreadOf(latest) : null;
  const delta = spreadDelta(breadth);
  const hkPct = latest ? pct(latest.hk) : null;
  const usPct = latest ? pct(latest.us) : null;
  const ratio = data?.ratio ?? [];

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded p-3 my-3">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[#00d4ff] text-sm font-bold">🔄 HK vs US ROTATION</span>
          <InfoTooltip id="rotation" />
          {spread !== null && (
            <span className="text-xs font-mono" style={{ color: spread >= 0 ? HK : US }}>
              spread {signed(spread)}
              {delta !== null && (
                <span className="text-[#4a6080]"> ({DELTA_LOOKBACK}d {signed(delta)})</span>
              )}
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="mt-2">
          {loading && (
            <div className="text-[0.72rem] text-[#4a6080] font-mono">loading rotation series…</div>
          )}
          {!loading && error && (
            <div className="text-[0.72rem] text-[#4a6080] font-mono">rotation unavailable — {error}</div>
          )}
          {!loading && !error && data && (
            <>
              {data.warning && (
                <div className="text-[0.72rem] text-[#ffa502] font-mono mb-1.5">⚠ {data.warning}</div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 bg-[#080d1a] border border-[#1e2d4a] rounded p-2 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[0.72rem] font-mono font-bold text-[#6b85a0] tracking-widest">
                      BREADTH SPREAD <span className="text-[#2a3d5a]">· HK − US</span>
                    </span>
                    <span className="text-[0.72rem] font-mono text-[#4a6080]">{breadth.length}d</span>
                  </div>
                  {breadth.length >= 2 ? (
                    <SpreadChart points={breadth} />
                  ) : (
                    <div className="h-16 flex items-center justify-center text-[0.72rem] text-[#4a6080] font-mono text-center px-2">
                      accrues daily from EOD reports — needs both regions for a session
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {hkPct !== null && latest?.hk && (
                      <Chip label="HK" value={`${latest.hk.above}/${latest.hk.total} · ${hkPct}%`} color={HK} />
                    )}
                    {usPct !== null && latest?.us && (
                      <Chip label="US" value={`${latest.us.above}/${latest.us.total} · ${usPct}%`} color={US} />
                    )}
                    {latest && <Chip label="as of" value={latest.date} />}
                  </div>
                  <div className="text-[0.66rem] font-mono text-[#4a6080] mt-1">
                    <span style={{ color: HK }}>▮</span> HK favoured · <span style={{ color: US }}>▮</span> US favoured
                  </div>
                </div>

                <div className="flex-1 bg-[#080d1a] border border-[#1e2d4a] rounded p-2 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[0.72rem] font-mono font-bold text-[#6b85a0] tracking-widest">
                      TECH RS <span className="text-[#2a3d5a]">· HSTECH ÷ NDX</span>
                    </span>
                    <span className="text-[0.72rem] font-mono text-[#4a6080]">{ratio.length}d</span>
                  </div>
                  {ratio.length >= 2 ? (
                    <RatioChart points={ratio} />
                  ) : (
                    <div className="h-16 flex items-center justify-center text-[0.72rem] text-[#4a6080] font-mono">
                      ratio series unavailable
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {data.lead && (
                      <Chip
                        label="leading"
                        value={data.lead === "hk" ? "HK tech" : "US tech"}
                        color={data.lead === "hk" ? HK : US}
                      />
                    )}
                    {ratio.length > 0 && (
                      <Chip label="ratio" value={ratio[ratio.length - 1].ratio.toFixed(4)} />
                    )}
                  </div>
                  <div className="text-[0.66rem] font-mono text-[#4a6080] mt-1">
                    <span style={{ color: HK }}>—</span> ratio · <span style={{ color: MUTED }}>- -</span> {RATIO_MA_PERIOD}d mean
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
