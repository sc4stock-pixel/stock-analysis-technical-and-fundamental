import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/telegram-report";
import { sendTelegramMessage } from "@/lib/telegram";
import { fetchKronosForecasts } from "@/lib/kronos";
import { fetchForecastSkill } from "@/lib/forecastSkill";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";
import { detectFlip, type ChartBar } from "@/lib/flip";
import { classifyValidity, degradedAlertText } from "@/lib/pipeline-health";
import { aboveSma50Map, computeBreadthMovers, type BreadthSnapshot } from "@/lib/breadth-movers";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Breadth-movers snapshot: the report is stateless (reruns the pipeline each call),
// so to name WHICH stock moved the above-SMA50 count we persist the per-stock map to
// KV and diff the next run against it. Keyed per market so US/HK each diff vs their
// own prior run. Best-effort — KV failures never block the report.
async function readBreadthSnapshot(market: "us" | "hk"): Promise<BreadthSnapshot | null> {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/breadth_snapshot_${market}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!res.ok) return null;
    const { result } = (await res.json()) as { result: string | null };
    return result ? (JSON.parse(result) as BreadthSnapshot) : null;
  } catch { return null; }
}

async function writeBreadthSnapshot(market: "us" | "hk", snap: BreadthSnapshot): Promise<void> {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/breadth_snapshot_${market}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const market = (new URL(req.url).searchParams.get("market") ?? "hk") as "us" | "hk";
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;

  const results = await Promise.all(
    portfolio.map(s => analyzeStock(s, DEFAULT_CONFIG))
  );

  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    if (chart_bars && chart_bars.length >= 2) {
      const p = slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined;
      const flip = detectFlip(chart_bars, p?.atrPeriod ?? 10, p?.multiplier ?? 3.0);
      return { ...slim, _flip: { flipType: flip.flipType, barsSince: flip.barsSince } };
    }
    return slim;
  });

  const validity = classifyValidity(payload as Array<Record<string, unknown>>);
  if (validity.degraded) {
    await sendTelegramMessage(degradedAlertText(validity, `EOD report (${market})`), "alerts");
    return NextResponse.json({ ok: false, ...validity, market });
  }

  // Fetch forecast data + prior breadth snapshot in parallel (all best-effort —
  // failures don't block the report).
  const [kronosData, skill, prevSnapshot] = await Promise.all([
    fetchKronosForecasts().catch(() => null),
    fetchForecastSkill().catch(() => null),
    readBreadthSnapshot(market),
  ]);

  // Breadth movers: diff this run's above-SMA50 map vs the prior report's snapshot.
  // Build the map over the same valid set the report's breadth count uses.
  const validRows = (payload as Array<Record<string, unknown>>).filter(
    r => !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0,
  );
  const currentAbove = aboveSma50Map(validRows as unknown as Parameters<typeof aboveSma50Map>[0]);
  const movers = computeBreadthMovers(currentAbove, prevSnapshot);

  // Always send EOD report — no skip gate (unlike alerts which skip on quiet days)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message  = buildEodReport(payload as any, market, kronosData, undefined, skill, movers);
  const tgResult = await sendTelegramMessage(message, "reports");

  // Persist this run's map as the baseline for the next report (only on a valid run —
  // degraded runs returned earlier and never reach here).
  await writeBreadthSnapshot(market, { asOf: new Date().toISOString(), above: currentAbove });

  return NextResponse.json({
    ok:       tgResult.ok,
    error:    tgResult.error,
    market,
    analyzed: payload.length,
    movers,
  });
}
