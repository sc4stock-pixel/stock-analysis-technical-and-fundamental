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
    const entries: NavEntry[] = result ? JSON.parse(result) : [];
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
