import { NextRequest, NextResponse } from "next/server";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram";
import { DEFAULT_CONFIG } from "@/lib/config";
import { supertrend } from "@/lib/indicators";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ChartBar = { high: number; low: number; close: number };

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const baseUrl  = new URL(req.url).origin;
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;

  // Analyze all stocks in parallel — each /api/stocks call is within its own timeout
  const results = await Promise.all(
    portfolio.map(async stock => {
      try {
        const res = await fetch(`${baseUrl}/api/stocks`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ symbol: stock.symbol }),
          signal:  AbortSignal.timeout(25000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        return {
          symbol: stock.symbol, exchange: stock.exchange,
          signal: "ERROR", score: 0, current_price: 0, change_pct: 0,
          regime: "ERROR", st_direction: 0, st_stop_distance_pct: 0,
          st_open_return_pct: null, error: String(e),
        };
      }
    })
  );

  // Compute flip info from chart_bars (available here server-side), then strip them
  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    const bars = chart_bars;
    if (bars && bars.length >= 2) {
      const stParams = (slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined);
      const atr = stParams?.atrPeriod ?? 10;
      const mul = stParams?.multiplier ?? 3.0;
      const [stArr, dir] = supertrend(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atr, mul);
      let flipType: "BULLISH" | "BEARISH" | null = null;
      let barsSince = 999;
      let stopAtFlip: number | null = null;   // previous bar's ST stop (the line that was breached)
      let closeAtFlip: number | null = null;  // close on the actual flip bar
      for (let i = dir.length - 1; i >= 1; i--) {
        if (dir[i] !== dir[i - 1]) {
          barsSince   = dir.length - 1 - i;
          flipType    = dir[i] === 1 ? "BULLISH" : "BEARISH";
          stopAtFlip  = stArr[i - 1] ?? null;   // bullish stop from the bar before flip
          closeAtFlip = bars[i].close;           // close that violated/cleared the stop
          break;
        }
      }
      return { ...slim, _flip: { flipType, barsSince, stopAtFlip, closeAtFlip } };
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
