import { NextResponse } from "next/server";
import { computeRegionStats, type NavEntry } from "@/lib/navStats";

export const dynamic = "force-dynamic";

export async function GET() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return NextResponse.json({ error: "KV not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(`${kvUrl}/get/nav_history`, {
      headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: `KV error ${res.status}` }, { status: 502 });
    const { result } = await res.json() as { result: string | null };
    // Python json.dumps can emit bare NaN (the st_params 2026-06-06 lesson, repeated
    // by the NAV writer 2026-06-10): sanitize to null and drop poisoned entries
    // instead of letting JSON.parse 500 the whole route.
    const entries: NavEntry[] = result
      ? (JSON.parse(result.replace(/\bNaN\b/g, "null")) as NavEntry[])
          .filter((e) => typeof e.ret === "number" && Number.isFinite(e.ret))
      : [];
    return NextResponse.json({
      US: computeRegionStats(entries.filter(e => e.region === "US")),
      HK: computeRegionStats(entries.filter(e => e.region === "HK")),
      lastDate: entries.length ? entries[entries.length - 1].date : null,
    });
  } catch (e) {
    console.error("[/api/nav]", e);
    return NextResponse.json({ error: "Failed to read nav history" }, { status: 500 });
  }
}
