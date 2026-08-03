import { NextResponse } from "next/server";
import { stripNaN } from "@/lib/fill-command";
import { completePoints, type BreadthPoint } from "@/lib/breadth-history";
import { buildRatioSeries, currentLead, type RatioPoint } from "@/lib/rotation-ratio";
import { fetchYahooOHLCV } from "@/lib/marketData";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // external Yahoo fetches (CLAUDE.md guardrail)

// Symbols for the relative-strength ratio. ETFs, not indices — NOT a preference but a
// data constraint: Yahoo's /v8/finance/chart has no Hang Seng TECH index series. `^HSTECH`
// and `^HSTC` 404, and `HSTECH.HK` resolves but serves a single bar. `^HSCE` (HSCEI) has
// full history but is broad China large-cap, not tech, so it would answer a different
// question. The HK-hours-vs-US-hours mismatch people cite against ETF pairs applies to any
// cross-market pair, index or not, so it isn't a reason to prefer one here; what's left is
// tracking error, which is small against the moves this chart exists to show. Both legs are
// ETFs so at least the two sides are consistent instruments.
// VERIFY WITH A LIVE FETCH before changing either symbol — a 404 here degrades silently to
// an empty chart (it did, on first deploy).
const HK_TECH = "3067.HK"; // iShares Hang Seng TECH ETF
const US_TECH = "QQQ";     // Invesco QQQ (Nasdaq-100)

/** Bars pulled for the ratio: enough for the 50-day mean plus a readable window. */
const RATIO_LOOKBACK_DAYS = 200;

/** Trading days shown in the panel. The mean is computed on the full pull, then sliced. */
const DISPLAY_DAYS = 90;

export interface RotationResponse {
  /** Sessions where BOTH regions reported, oldest first. */
  breadth: BreadthPoint[];
  /** `3067.HK / QQQ` with its trailing mean, oldest first. */
  ratio: RatioPoint[];
  /** Which side the ratio currently favours; null before the mean is established. */
  lead: "hk" | "us" | null;
  /** Present when a piece degraded, so the panel can say so instead of showing blanks. */
  warning?: string;
}

/** The breadth series from KV. Absent/unset key is a normal empty state, not an error. */
async function readBreadthHistory(): Promise<BreadthPoint[]> {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return [];
  const res = await fetch(`${url}/get/breadth_history`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV error ${res.status}`);
  const { result } = (await res.json()) as { result: string | null };
  if (!result) return [];
  const parsed = JSON.parse(stripNaN(result));
  return Array.isArray(parsed) ? (parsed as BreadthPoint[]) : [];
}

export async function GET() {
  // The two halves are independent: KV holds the breadth series, Yahoo serves the ratio.
  // Settled separately so one failing still renders the other rather than blanking the
  // whole panel.
  const [breadthRes, hkRes, usRes] = await Promise.allSettled([
    readBreadthHistory(),
    fetchYahooOHLCV(HK_TECH, RATIO_LOOKBACK_DAYS),
    fetchYahooOHLCV(US_TECH, RATIO_LOOKBACK_DAYS),
  ]);

  const warnings: string[] = [];

  let breadth: BreadthPoint[] = [];
  if (breadthRes.status === "fulfilled") {
    breadth = completePoints(breadthRes.value).slice(-DISPLAY_DAYS);
  } else {
    console.error("[/api/rotation] breadth", breadthRes.reason);
    warnings.push("breadth history unavailable");
  }

  let ratio: RatioPoint[] = [];
  const hkBars = hkRes.status === "fulfilled" ? hkRes.value?.bars ?? null : null;
  const usBars = usRes.status === "fulfilled" ? usRes.value?.bars ?? null : null;
  if (hkBars && usBars) {
    ratio = buildRatioSeries(hkBars, usBars).slice(-DISPLAY_DAYS);
    // A non-empty fetch on both legs can still yield nothing if their calendars never
    // line up — a distinct failure from a bad symbol, so it gets a distinct message.
    if (ratio.length === 0) warnings.push("ratio: no overlapping sessions");
  } else {
    // Name the failing leg. The first deploy reported a bare "ratio series unavailable",
    // which took a manual Yahoo probe to trace to a symbol that 404s.
    const dead = [!hkBars && HK_TECH, !usBars && US_TECH].filter(Boolean).join(" + ");
    console.error(`[/api/rotation] no bars for ${dead}`);
    warnings.push(`ratio unavailable — no data for ${dead}`);
  }

  const body: RotationResponse = { breadth, ratio, lead: currentLead(ratio) };
  if (warnings.length > 0) body.warning = warnings.join("; ");
  return NextResponse.json(body);
}
