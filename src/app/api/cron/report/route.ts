import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/telegram-report";
import { sendTelegramMessage } from "@/lib/telegram";
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

  // ?market=us (morning brief) or ?market=hk (HK close) — defaults to hk
  const market = (new URL(req.url).searchParams.get("market") ?? "hk") as "us" | "hk";

  const baseUrl   = new URL(req.url).origin;
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;

  // Fetch all stocks in parallel — same pattern as /api/cron/analyze
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
          symbol:        stock.symbol,
          name:          stock.name,
          exchange:      stock.exchange,
          st_direction:  0,
          current_price: 0,
          change_pct:    0,
          error:         String(e),
        };
      }
    })
  );

  // Detect flips from chart_bars then strip them (same as analyze route)
  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    const bars = chart_bars;
    if (bars && bars.length >= 2) {
      const stParams = (slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined);
      const atr = stParams?.atrPeriod ?? 10;
      const mul = stParams?.multiplier ?? 3.0;
      const [, dir] = supertrend(
        bars.map(b => b.high),
        bars.map(b => b.low),
        bars.map(b => b.close),
        atr,
        mul,
      );
      let flipType: "BULLISH" | "BEARISH" | null = null;
      let barsSince = 999;
      for (let i = dir.length - 1; i >= 1; i--) {
        if (dir[i] !== dir[i - 1]) {
          barsSince = dir.length - 1 - i;
          flipType  = dir[i] === 1 ? "BULLISH" : "BEARISH";
          break;
        }
      }
      return { ...slim, _flip: { flipType, barsSince } };
    }
    return slim;
  });

  // Always send EOD report — no skip gate (unlike alerts which skip on quiet days)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message  = buildEodReport(payload as any, market);
  const tgResult = await sendTelegramMessage(message, "reports");

  return NextResponse.json({
    ok:       tgResult.ok,
    error:    tgResult.error,
    market,
    analyzed: payload.length,
  });
}
