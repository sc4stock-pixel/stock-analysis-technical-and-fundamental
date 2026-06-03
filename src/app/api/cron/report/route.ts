import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/telegram-report";
import { sendTelegramMessage } from "@/lib/telegram";
import { fetchKronosForecasts } from "@/lib/kronos";
import { fetchTimesfmForecasts } from "@/lib/timesfm";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";
import { detectFlip, type ChartBar } from "@/lib/flip";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  // Fetch forecast data in parallel (best-effort — failures don't block the report)
  const [kronosData, timesfmData] = await Promise.all([
    fetchKronosForecasts().catch(() => null),
    fetchTimesfmForecasts().catch(() => null),
  ]);

  // Always send EOD report — no skip gate (unlike alerts which skip on quiet days)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message  = buildEodReport(payload as any, market, kronosData, timesfmData);
  const tgResult = await sendTelegramMessage(message, "reports");

  return NextResponse.json({
    ok:       tgResult.ok,
    error:    tgResult.error,
    market,
    analyzed: payload.length,
  });
}
