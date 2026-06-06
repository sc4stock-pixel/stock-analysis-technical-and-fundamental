import { NextRequest, NextResponse } from "next/server";
import { checkFreshness } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Freshness sentinel — guarded like the other machine endpoints. Returns per-artifact
// ages plus a top-level `stale[]`; the Pipeline Health Probe workflow alerts only when
// `stale[]` is non-empty. See docs/freshness-sentinel-spec.md.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await checkFreshness();
    return NextResponse.json(report);
  } catch (e) {
    console.error("[/api/freshness]", e);
    return NextResponse.json({ error: "freshness check failed" }, { status: 500 });
  }
}
