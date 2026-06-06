// Freshness sentinel (Layer A): checks each published data artifact's "last updated"
// time against an expected cadence, so stale/silently-frozen data is alerted instead
// of silently rendering as valid. See docs/freshness-sentinel-spec.md.
import type { WorkerState } from "@/types/worker-state";
import { tradingDaysBetween } from "@/lib/marketCalendar";

const REPO = "sc4stock-pixel/stock-analysis-technical-and-fundamental";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

export interface FreshnessItem {
  artifact: string;
  lastUpdated: string | null; // ISO timestamp, or null if it couldn't be determined
  ageHours: number | null;
  stale: boolean;
  missing: boolean;
  detail: string;
}

export interface FreshnessReport {
  checkedAt: string;
  stale: string[]; // artifact names that are stale or missing
  items: FreshnessItem[];
}

// A calendar-hours threshold (fixed cadence) OR a trading-days threshold (market cadence).
type Threshold =
  | { maxAgeHours: number }
  | { maxTradingDays: number; region: string };

interface Check {
  artifact: string;
  // How to obtain lastUpdated:
  source:
    | { kind: "embedded"; file: string; field: string } // a date/timestamp field inside the JSON
    | { kind: "commit"; file: string } // GitHub commit date of the file
    | { kind: "kv"; region: string }; // autopilot KV state per-region last run
  threshold: Threshold;
}

export const CHECKS: Check[] = [
  { artifact: "st_params.json", source: { kind: "embedded", file: "st_params.json", field: "last_optimized" }, threshold: { maxAgeHours: 40 * 24 } },
  { artifact: "timesfm_forecasts.json", source: { kind: "commit", file: "timesfm_forecasts.json" }, threshold: { maxTradingDays: 2, region: "us" } },
  { artifact: "kronos_forecasts.json", source: { kind: "commit", file: "kronos_forecasts.json" }, threshold: { maxTradingDays: 2, region: "us" } },
  { artifact: "av_earnings_cache.json", source: { kind: "commit", file: "av_earnings_cache.json" }, threshold: { maxAgeHours: 1 } }, // TEMP: forced-stale alert test — revert to 9 * 24
  { artifact: "fundamentals_cache.json", source: { kind: "commit", file: "fundamentals_cache.json" }, threshold: { maxAgeHours: 9 * 24 } },
  { artifact: "southbound_data.json", source: { kind: "commit", file: "southbound_data.json" }, threshold: { maxTradingDays: 2, region: "hk" } },
  { artifact: "kv:state:us", source: { kind: "kv", region: "us" }, threshold: { maxTradingDays: 2, region: "us" } },
  { artifact: "kv:state:hk", source: { kind: "kv", region: "hk" }, threshold: { maxTradingDays: 2, region: "hk" } },
];

// ── Pure evaluation (unit-tested; no I/O) ─────────────────────────────────────
export function evaluate(check: Check, lastUpdated: Date | null, now: Date): FreshnessItem {
  if (!lastUpdated || isNaN(lastUpdated.getTime())) {
    return { artifact: check.artifact, lastUpdated: null, ageHours: null, stale: true, missing: true, detail: "no timestamp resolved" };
  }
  const ageHours = (now.getTime() - lastUpdated.getTime()) / 3_600_000;
  let stale: boolean;
  let detail: string;
  if ("maxAgeHours" in check.threshold) {
    stale = ageHours > check.threshold.maxAgeHours;
    detail = `${ageHours.toFixed(1)}h old (max ${check.threshold.maxAgeHours}h)`;
  } else {
    const td = tradingDaysBetween(lastUpdated, now, check.threshold.region);
    stale = td > check.threshold.maxTradingDays;
    detail = `${td} trading day(s) old (max ${check.threshold.maxTradingDays})`;
  }
  return { artifact: check.artifact, lastUpdated: lastUpdated.toISOString(), ageHours: Number(ageHours.toFixed(1)), stale, missing: false, detail };
}

// ── I/O: resolve lastUpdated for one check ────────────────────────────────────
async function resolveLastUpdated(check: Check): Promise<Date | null> {
  const { source } = check;
  try {
    if (source.kind === "embedded") {
      const res = await fetch(`${RAW}/${source.file}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      // Tolerate bare NaN tokens (see st_params NaN incident).
      const data = JSON.parse((await res.text()).replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null"));
      const v = data?.[source.field];
      return v ? new Date(v) : null;
    }
    if (source.kind === "commit") {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const url = `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(source.file)}&per_page=1`;
      const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const arr = await res.json() as Array<{ commit?: { committer?: { date?: string } } }>;
      const date = arr?.[0]?.commit?.committer?.date;
      return date ? new Date(date) : null;
    }
    // kv
    const kvUrl = process.env.KV_REST_API_URL, kvToken = process.env.KV_REST_API_TOKEN;
    if (!kvUrl || !kvToken) return null;
    const res = await fetch(`${kvUrl}/get/state`, { headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const { result } = await res.json() as { result: string | null };
    if (!result) return null;
    const state = JSON.parse(result) as WorkerState;
    const ts = state.regionLastRun?.[source.region] ?? state.updatedAt;
    return ts ? new Date(ts) : null;
  } catch {
    return null;
  }
}

export async function checkFreshness(now: Date = new Date()): Promise<FreshnessReport> {
  const items = await Promise.all(
    CHECKS.map(async (c) => evaluate(c, await resolveLastUpdated(c), now)),
  );
  return { checkedAt: now.toISOString(), stale: items.filter(i => i.stale).map(i => i.artifact), items };
}
