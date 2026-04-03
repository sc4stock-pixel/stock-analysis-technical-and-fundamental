// src/app/api/stocks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline, RawOHLCV } from "@/lib/pipeline";
import { AppConfig } from "@/types";

export const maxDuration = 30;
// Force dynamic rendering — never cache the API response
// This ensures config changes always trigger a full recompute
export const dynamic = "force-dynamic";

// ─── Fundamentals via Yahoo v7/finance/quote ──────────────────
// v7/quote works from Vercel server-side (v10/quoteSummary is often blocked)
interface Fundamentals {
  pe_ratio: number | null;
  forward_pe: number | null;
  eps_trailing: number | null;
  eps_forward: number | null;
  eps_growth: number | null;
  analyst_target: number | null;
  analyst_rating: string | null;
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const empty: Fundamentals = {
    pe_ratio: null, forward_pe: null,
    eps_trailing: null, eps_forward: null, eps_growth: null,
    analyst_target: null, analyst_rating: null,
  };
  try {
    // Yahoo v7/finance/quote — works from server-side on Vercel
    // No ?fields= restriction — let Yahoo return all available fields
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      next: { revalidate: 3600 }, // cache 1h
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q) return empty;

    const pe           = q.trailingPE          ?? null;
    const forwardPE    = q.forwardPE            ?? null;
    // v7 uses 'epsTrailingTwelveMonths'; v7 also sometimes has 'trailingEps'
    const epsTrailing  = q.epsTrailingTwelveMonths ?? q.trailingEps ?? null;
    const epsForward   = q.epsForward ?? q.forwardEps ?? null;
    const analystTarget = q.targetMeanPrice     ?? null;

    // EPS growth: use earningsGrowth if available, else compute from eps
    // earningsGrowth from v7 (may be null for HK stocks — computed from EPS as fallback)
    let epsGrowth: number | null = q.earningsGrowth ?? null;
    if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
      epsGrowth = (epsForward - epsTrailing) / Math.abs(epsTrailing);
    }

    // Analyst rating from recommendationMean (1=Strong Buy → 5=Strong Sell)
    const recMean: number | null = q.recommendationMean ?? null;
    let analystRating: string | null = q.recommendationKey ?? null;
    if (!analystRating && recMean != null) {
      if      (recMean <= 1.5) analystRating = "Strong Buy";
      else if (recMean <= 2.5) analystRating = "Buy";
      else if (recMean <= 3.5) analystRating = "Hold";
      else if (recMean <= 4.5) analystRating = "Sell";
      else                     analystRating = "Strong Sell";
    }
    // Capitalise recommendationKey (yahoo returns lowercase e.g. "buy")
    if (analystRating) {
      analystRating = analystRating.charAt(0).toUpperCase() + analystRating.slice(1).toLowerCase();
    }

    return {
      pe_ratio:       pe            != null ? Math.round(pe * 10) / 10            : null,
      forward_pe:     forwardPE     != null ? Math.round(forwardPE * 10) / 10     : null,
      eps_trailing:   epsTrailing,
      eps_forward:    epsForward,
      eps_growth:     epsGrowth     != null ? Math.round(epsGrowth * 1000) / 10   : null, // as %
      analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
      analyst_rating: analystRating,
    };
  } catch {
    return empty;
  }
}

// ─── OHLCV + current price ─────────────────────────────────────
async function fetchYahooOHLCV(
  symbol: string,
  lookbackDays: number
): Promise<{ bars: RawOHLCV[]; currentPrice: number; changePct: number } | null> {
  try {
    const calendarDays = Math.floor(lookbackDays * 7 / 5) + 15;
    const end   = Math.floor(Date.now() / 1000);
    const start = end - calendarDays * 86400;
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=div,splits`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store", // always fetch fresh so config changes recompute correctly
    });
    if (!res.ok) return null;

    const json   = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[]  = result.timestamp ?? [];
    const ohlcv                 = result.indicators?.quote?.[0];
    const meta                  = result.meta ?? {};
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
        date:   new Date(timestamps[i] * 1000).toISOString().split("T")[0],
        open: o, high: h, low: l, close: c, volume: v ?? 0,
      });
    }
    if (bars.length < 50) return null;

    // ── Current price ──────────────────────────────────────────
    // Use regularMarketPrice (live/delayed quote) if available; else last bar
    const lastBar     = bars[bars.length - 1];
    const secondLast  = bars[bars.length - 2];
    let currentPrice: number = meta.regularMarketPrice ?? lastBar.close;
    if (!currentPrice || currentPrice <= 0) currentPrice = lastBar.close;

    // ── Change % ───────────────────────────────────────────────
    // ROOT-CAUSE FIX: meta.chartPreviousClose = close BEFORE the chart's first
    // bar (i.e. ~252 trading days ago), NOT yesterday's close.
    // The only reliable source is bars[-2].close = prior trading day's close.
    // We fall back to regularMarketChange if bar data is unavailable.
    let changePct = 0;

    if (secondLast && secondLast.close > 0 && currentPrice > 0) {
      // Primary: (today's price − yesterday's bar close) / yesterday's bar close
      // This uses the OHLCV series we already fetched — always correct.
      changePct = ((currentPrice - secondLast.close) / secondLast.close) * 100;
    } else if (meta.regularMarketChange != null && lastBar.close > 0) {
      // Fallback: Yahoo's absolute dollar change ÷ implied prev close
      const impliedPrev = currentPrice - (meta.regularMarketChange as number);
      if (impliedPrev > 0) {
        changePct = ((meta.regularMarketChange as number) / impliedPrev) * 100;
      }
    }

    // Clamp: no stock moves > 50% in a single day (catches any remaining bad data)
    if (Math.abs(changePct) > 50) changePct = 0;

    return { bars, currentPrice, changePct };
  } catch {
    return null;
  }
}

// ─── Single stock analysis ─────────────────────────────────────
async function analyzeStock(
  stock: { symbol: string; name: string; exchange: string },
  config: AppConfig
) {
  try {
    // Fetch OHLCV and fundamentals in parallel
    const [data, fundamentals] = await Promise.all([
      fetchYahooOHLCV(stock.symbol, config.backtest.lookbackDays),
      fetchFundamentals(stock.symbol),
    ]);

    if (!data) {
      return {
        symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
        signal: "ERROR", score: 0, confidence: 0,
        regime: "UNKNOWN",
        regime_info: {
          regime: "UNKNOWN", atr_ratio: 1, adx_slope: 0,
          bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false,
        },
        current_price: 0, change_pct: 0,
        fundamentals,
        backtest: null, monte_carlo: null, walk_forward: null, kelly: null,
        error: "Insufficient data",
      };
    }

    const result = runPipeline(data.bars, stock, config, data.currentPrice, data.changePct);
    // Spread result (which includes chart_bars) + add fundamentals
    return { ...result, fundamentals };
  } catch (e) {
    return {
      symbol: stock.symbol, name: stock.name, exchange: stock.exchange,
      signal: "ERROR", score: 0, confidence: 0,
      regime: "ERROR",
      regime_info: {
        regime: "ERROR", atr_ratio: 1, adx_slope: 0,
        bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false,
      },
      current_price: 0, change_pct: 0,
      fundamentals: {
        pe_ratio: null, forward_pe: null, eps_trailing: null,
        eps_forward: null, eps_growth: null, analyst_target: null, analyst_rating: null,
      },
      backtest: null, monte_carlo: null, walk_forward: null, kelly: null,
      error: String(e),
    };
  }
}

// ─── POST handler ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body   = await req.json().catch(() => ({}));
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

// ─── GET handler ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const stock = DEFAULT_CONFIG.stocks.PORTFOLIO.find((s) => s.symbol === symbol)
    ?? { symbol, name: symbol, exchange: "US" };
  const result = await analyzeStock(stock, DEFAULT_CONFIG);
  return NextResponse.json(result);
}
