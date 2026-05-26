import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// /api/cron/daily?market=us|hk
//
// Wrapper that fires both /api/cron/analyze (signal alerts → ALERTS channel,
// skip-gated) and /api/cron/report (EOD market breadth → REPORTS channel,
// always sends). Intended for external schedulers (cron-job.org) so a single
// cron-job.org entry per slot covers the full daily fan-out.
//
// Security: requires x-cron-secret header matching CRON_SECRET env var.
//
// Returns combined status for both downstream calls so cron-job.org logs
// surface partial failures.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const market = (new URL(req.url).searchParams.get("market") ?? "hk") as "us" | "hk";
  const baseUrl = new URL(req.url).origin;
  const headers = {
    "Content-Type":   "application/json",
    "x-cron-secret":  secret,
  };

  // Fire both sequentially. Each one already runs its own internal parallel
  // /api/stocks fan-out, so back-to-back calls add ~5-8s total, well under
  // the 60s maxDuration budget.
  const callRoute = async (path: string) => {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method:  "POST",
        headers,
        body:    "{}",
        signal:  AbortSignal.timeout(55000),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, error: String(e) };
    }
  };

  const analyze = await callRoute("/api/cron/analyze");
  const report  = await callRoute(`/api/cron/report?market=${market}`);

  return NextResponse.json({
    ok:       analyze.ok && report.ok,
    market,
    analyze,
    report,
  });
}
