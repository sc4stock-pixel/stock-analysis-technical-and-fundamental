// src/app/api/stocks/route.ts
// Fetches live OHLCV from Yahoo Finance and runs the full analysis pipeline
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline, RawOHLCV } from "@/lib/pipeline";
import { AppConfig } from "@/types";

export const maxDuration = 30;

// ─── Yahoo Finance OHLCV fetch ────────────────────────────────
async function fetchYahooOHLCV(symbol: string, lookbackDays: number): Promise<RawOHLCV[] | null> {
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
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v ?? 0,
      });
    }
    return bars.length >= 50 ? bars : null;
  } catch {
    return null;
  }
}

// ─── Current price fetch ──────────────────────────────────────
async function fetchCurrentPrice(symbol: string): Promise<{ price: number; change_pct: number }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return { price: 0, change_pct: 0 };
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    return {
      price: meta?.regularMarketPrice ?? meta?.previousClose ?? 0,
      change_pct: meta?.regularMarketChangePercent ?? 0,
    };
  } catch {
    return { price: 0, change_pct: 0 };
  }
}

// ─── Single stock handler ─────────────────────────────────────
async function analyzeStock(
  stock: { symbol: string; name: string; exchange: string },
  config: AppConfig
) {
  try {
    const [bars, priceInfo] = await Promise.all([
      fetchYahooOHLCV(stock.symbol, config.backtest.lookbackDays),
      fetchCurrentPrice(stock.symbol),
    ]);

    if (!bars) {
      return {
        symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
        signal: "ERROR", score: 0, confidence: 0,
        regime: "UNKNOWN", regime_info: { regime: "UNKNOWN", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
        current_price: priceInfo.price, change_pct: priceInfo.change_pct,
        backtest: null, monte_carlo: null, walk_forward: null, kelly: null,
        error: "Insufficient data",
      };
    }

    const result = runPipeline(bars, stock, config, priceInfo.price, priceInfo.change_pct);
    return result;
  } catch (e) {
    return {
      symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
      signal: "ERROR", score: 0, confidence: 0,
      regime: "ERROR", regime_info: { regime: "ERROR", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
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

    // Single symbol mode
    if (body.symbol) {
      const stock = config.stocks.PORTFOLIO.find((s) => s.symbol === body.symbol)
        ?? { symbol: body.symbol, name: body.symbol, exchange: "US" };
      const result = await analyzeStock(stock, config);
      return NextResponse.json(result);
    }

    // Portfolio mode — analyze all stocks (sequential to stay within timeout)
    const portfolio = config.stocks.PORTFOLIO;
    const results = [];
    for (const stock of portfolio) {
      const r = await analyzeStock(stock, config);
      results.push(r);
    }

    return NextResponse.json({
      results,
      timestamp: new Date().toISOString(),
      config,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── GET handler (single symbol query param) ──────────────────
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const stock = DEFAULT_CONFIG.stocks.PORTFOLIO.find((s) => s.symbol === symbol)
    ?? { symbol, name: symbol, exchange: "US" };
  const result = await analyzeStock(stock, DEFAULT_CONFIG);
  return NextResponse.json(result);
}
