import { NextResponse } from "next/server";
import { stripNaN } from "@/lib/fill-command";
import { completePoints, type BreadthPoint } from "@/lib/breadth-history";
import { buildRatioSeries, currentLead, type RatioPoint } from "@/lib/rotation-ratio";
import { fetchYahooOHLCV } from "@/lib/marketData";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // external Yahoo fetches (CLAUDE.md guardrail)

/** Index symbols for the relative-strength ratio. Indices, not the tradable ETFs. */
const HK_TECH = "^HSTECH";
const US_TECH = "^NDX";

/** Bars pulled for the ratio: enough for the 50-day mean plus a readable window. */
const RATIO_LOOKBACK_DAYS = 200;

/** Trading days shown in the panel. The mean is computed on the full pull, then sliced. */
const DISPLAY_DAYS = 90;

export interface RotationResponse {
  /** Sessions where BOTH regions reported, oldest first. */
  breadth: BreadthPoint[];
  /** `^HSTECH / ^NDX` with its trailing mean, oldest first. */
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
  } else {
    warnings.push("ratio series unavailable");
  }

  const body: RotationResponse = { breadth, ratio, lead: currentLead(ratio) };
  if (warnings.length > 0) body.warning = warnings.join("; ");
  return NextResponse.json(body);
}
