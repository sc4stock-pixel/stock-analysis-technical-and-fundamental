import { NextRequest, NextResponse } from "next/server";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram";
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
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;
  const results = await Promise.all(portfolio.map(s => analyzeStock(s, DEFAULT_CONFIG)));

  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    if (chart_bars && chart_bars.length >= 2) {
      const p = slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined;
      const flip = detectFlip(chart_bars, p?.atrPeriod ?? 10, p?.multiplier ?? 3.0);
      return { ...slim, _flip: flip };
    }
    return slim;
  });

  // Only send Telegram if there are actionable signals or recent flips
  const hasSignals    = payload.some((r: Record<string, unknown>) => r.signal === "BUY" || r.signal === "SELL" || r.signal === "STRONG_SELL");
  const hasRecentFlip = payload.some((r: Record<string, unknown>) => {
    const flip = r._flip as { flipType: string | null; barsSince: number } | undefined;
    return flip?.flipType && flip.barsSince <= 1;
  });

  if (!hasSignals && !hasRecentFlip) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no signals or flips", analyzed: payload.length });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message  = buildTelegramMessage(payload as any, "cron");
  const tgResult = await sendTelegramMessage(message, "alerts");

  return NextResponse.json({
    ok:             tgResult.ok,
    error:          tgResult.error,
    analyzed:       payload.length,
    hasSignals,
    hasRecentFlip,
  });
}
