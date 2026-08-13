import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/telegram-report";
import { sendTelegramMessage } from "@/lib/telegram";
import { fetchKronosForecasts } from "@/lib/kronos";
import { fetchForecastSkill } from "@/lib/forecastSkill";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";
import { detectFlip, type ChartBar } from "@/lib/flip";
import { classifyValidity, degradedAlertText } from "@/lib/pipeline-health";
import { aboveSma50Map, computeBreadthMovers, isAboveSma50, type BreadthSnapshot } from "@/lib/breadth-movers";
import {
  mergeRegion, sessionDate, type BreadthPoint, type RegionBreadth,
} from "@/lib/breadth-history";
import { stripNaN } from "@/lib/fill-command";

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

// Breadth-spread history: the longitudinal HK-vs-US series behind the Rotation panel.
// ONE shared key (not per-market) because a session's spread needs both halves; each run
// merges only its own region in, via `mergeRegion`. Best-effort like the snapshot above.
async function readBreadthHistory(): Promise<BreadthPoint[]> {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return [];
  try {
    const res = await fetch(`${url}/get/breadth_history`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!res.ok) return [];
    const { result } = (await res.json()) as { result: string | null };
    if (!result) return [];
    // Reader NaN guardrail (CLAUDE.md): bare NaN/Infinity parse in Python json but throw
    // in JS JSON.parse. `stripNaN` is single-sourced so read/write regexes can't drift.
    const parsed = JSON.parse(stripNaN(result));
    return Array.isArray(parsed) ? (parsed as BreadthPoint[]) : [];
  } catch { return []; }
}

async function writeBreadthHistory(history: BreadthPoint[]): Promise<void> {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/breadth_history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(history),
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
  const [kronosData, skill, prevSnapshot, priorHistory] = await Promise.all([
    fetchKronosForecasts().catch(() => null),
    fetchForecastSkill().catch(() => null),
    readBreadthSnapshot(market),
    readBreadthHistory(),
  ]);

  // Breadth movers: diff this run's above-SMA50 map vs the prior report's snapshot.
  // Build the map over the same valid set the report's breadth count uses.
  const validRows = (payload as Array<Record<string, unknown>>).filter(
    r => !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0,
  );
  const currentAbove = aboveSma50Map(validRows as unknown as Parameters<typeof aboveSma50Map>[0]);
  const movers = computeBreadthMovers(currentAbove, prevSnapshot);

  // Breadth-spread history: merge THIS run's own region into the shared series before
  // building the message, so the report's spread line reflects today. Each run owns only
  // its half — the HK run reports the session that just closed, the US run reports the
  // overnight US session, which `sessionDate` maps back onto the same session date.
  const ownRows = validRows.filter(r =>
    market === "hk" ? r.exchange === "HK" : r.exchange !== "HK",
  );
  const reading: RegionBreadth = {
    above: ownRows.filter(
      r => isAboveSma50(r as unknown as Parameters<typeof isAboveSma50>[0]),
    ).length,
    total: ownRows.length,
    asOf:  new Date().toISOString(),
  };
  const history = ownRows.length > 0
    ? mergeRegion(priorHistory, sessionDate(market), market, reading)
    : priorHistory;

  // Always send EOD report — no skip gate (unlike alerts which skip on quiet days)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message  = buildEodReport(payload as any, market, kronosData, skill, movers, history);
  const tgResult = await sendTelegramMessage(message, "reports");

  // Persist this run's map as the baseline for the next report (only on a valid run —
  // degraded runs returned earlier and never reach here).
  await writeBreadthSnapshot(market, { asOf: new Date().toISOString(), above: currentAbove });
  if (history !== priorHistory) await writeBreadthHistory(history);

  return NextResponse.json({
    ok:       tgResult.ok,
    error:    tgResult.error,
    market,
    analyzed: payload.length,
    movers,
  });
}
