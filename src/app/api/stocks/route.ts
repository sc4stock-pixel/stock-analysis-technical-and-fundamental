// src/app/api/stocks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline, RawOHLCV } from "@/lib/pipeline";
import { AppConfig } from "@/types";

export const maxDuration = 30;

// ─── Yahoo Finance OHLCV fetch ────────────────────────────────
async function fetchYahooOHLCV(
  symbol: string,
  lookbackDays: number
): Promise<{ bars: RawOHLCV[]; currentPrice: number; changePct: number } | null> {
  try {
    const calendarDays = Math.floor(lookbackDays * 7 / 5) + 15;
    const end = Math.floor(Date.now() / 1000);
    const start = end - calendarDays * 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=div,splits`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 900 }, // 15-min cache
    });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const ohlcv = result.indicators?.quote?.[0];
    const meta = result.meta ?? {};
    if (!ohlcv || timestamps.length === 0) return null;

    const bars: RawOHLCV[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = ohlcv.open?.[i];
      const h = ohlcv.high?.[i];
      const l = ohlcv.low?.[i];
      const c = ohlcv.close?.[i];
      const v = ohlcv.volume?.[i];
      if (o == null || h == null || l == null || c == null || c <= 0) continue;
      bars.push({
        date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
        open: o, high: h, low: l, close: c, volume: v ?? 0,
      });
    }
    if (bars.length < 50) return null;

    // ── Current price & change ──────────────────────────────────
    // Yahoo meta.regularMarketPrice = live/latest price
    // Yahoo meta.regularMarketChangePercent = already a percentage (e.g. 2.9 means +2.9%)
    // BUT: during market hours it may be a small decimal (0.029). We normalise both cases.
    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];

    // Prefer live meta price; fall back to last OHLCV close
    let currentPrice: number = meta.regularMarketPrice ?? lastBar.close;
    if (!currentPrice || currentPrice <= 0) currentPrice = lastBar.close;

    // Change % — use previous close from OHLCV as the most reliable source
    // This avoids the Yahoo decimal/percent ambiguity entirely
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? prevBar?.close ?? lastBar.open;
    let changePct = 0;
    if (prevClose && prevClose > 0 && currentPrice > 0) {
      changePct = ((currentPrice - prevClose) / prevClose) * 100;
    }

    return { bars, currentPrice, changePct };
  } catch {
    return null;
  }
}

// ─── Single stock analysis ────────────────────────────────────
async function analyzeStock(
  stock: { symbol: string; name: string; exchange: string },
  config: AppConfig
) {
  try {
    const data = await fetchYahooOHLCV(stock.symbol, config.backtest.lookbackDays);

    if (!data) {
      return {
        symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
        signal: "ERROR", score: 0, confidence: 0,
        regime: "UNKNOWN",
        regime_info: { regime: "UNKNOWN", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
        current_price: 0, change_pct: 0,
        backtest: null, monte_carlo: null, walk_forward: null, kelly: null,
        error: "Insufficient data",
      };
    }

    const result = runPipeline(
      data.bars, stock, config, data.currentPrice, data.changePct
    );
    return result;
  } catch (e) {
    return {
      symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
      signal: "ERROR", score: 0, confidence: 0,
      regime: "ERROR",
      regime_info: { regime: "ERROR", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
      current_price: 0, change_pct: 0,
      backtest: null, monte_carlo: null, walk_forward: null, kelly: null,
      error: String(e),
    };
  }
}

// ─── POST handler ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const config: AppConfig = body.config ?? DEFAULT_CONFIG;

    if (body.symbol) {
      const stock = config.stocks.PORTFOLIO.find((s) => s.symbol === body.symbol)
        ?? { symbol: body.symbol, name: body.symbol, exchange: "US" };
      const result = await analyzeStock(stock, config);
      return NextResponse.json(result);
    }

    const portfolio = config.stocks.PORTFOLIO;
    const results = [];
    for (const stock of portfolio) {
      results.push(await analyzeStock(stock, config));
    }
    return NextResponse.json({ results, timestamp: new Date().toISOString(), config });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const stock = DEFAULT_CONFIG.stocks.PORTFOLIO.find((s) => s.symbol === symbol)
    ?? { symbol, name: symbol, exchange: "US" };
  const result = await analyzeStock(stock, DEFAULT_CONFIG);
  return NextResponse.json(result);
}
