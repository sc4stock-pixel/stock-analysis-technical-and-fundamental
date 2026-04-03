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

  // ── Helper: extract a .raw numeric value from Yahoo quoteSummary objects ──
  const raw = (obj: Record<string, unknown> | null | undefined, key: string): number | null => {
    if (!obj) return null;
    const v = obj[key];
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null && "raw" in v) return (v as { raw: number }).raw;
    return null;
  };

  // ── Attempt 1: Yahoo v11/finance/quoteSummary (same as Python yfinance internally) ──
  // This is the most complete source — matches ticker.info fields exactly.
  // Try both query1 and query2 hosts; Vercel IPs sometimes get 401 on one but not both.
  const v11Modules = "financialData,defaultKeyStatistics,summaryDetail";
  const v11Hosts = ["query1", "query2"];
  
  for (const host of v11Hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${v11Modules}&crumbStore={}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://finance.yahoo.com/",
          "Origin": "https://finance.yahoo.com",
        },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.quoteSummary?.result?.[0];
      if (!result) continue;

      const fin   = result.financialData       as Record<string, unknown> ?? {};
      const stats = result.defaultKeyStatistics as Record<string, unknown> ?? {};
      const summ  = result.summaryDetail        as Record<string, unknown> ?? {};

      // P/E: summaryDetail > defaultKeyStatistics
      const pe        = raw(summ, "trailingPE") ?? raw(stats, "trailingPE") ?? null;
      const forwardPE = raw(summ, "forwardPE")  ?? raw(stats, "forwardPEG") ?? null;

      // EPS
      const epsTrailing = raw(stats, "trailingEps") ?? raw(fin, "trailingEps") ?? null;
      const epsForward  = raw(stats, "forwardEps")  ?? raw(fin, "forwardEps")  ?? null;

      // EPS growth: financialData.earningsGrowth preferred, else compute
      let epsGrowth = raw(fin, "earningsGrowth") ?? null;
      if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
        epsGrowth = (epsForward - epsTrailing) / Math.abs(epsTrailing);
      }

      const analystTarget = raw(fin, "targetMeanPrice") ?? null;
      const recMean       = raw(fin, "recommendationMean") ?? null;
      const recKey        = typeof fin.recommendationKey === "string"
        ? fin.recommendationKey : null;

      let analystRating: string | null = recKey
        ? recKey.charAt(0).toUpperCase() + recKey.slice(1).toLowerCase()
        : null;
      if (!analystRating && recMean != null) {
        if      (recMean <= 1.5) analystRating = "Strong Buy";
        else if (recMean <= 2.5) analystRating = "Buy";
        else if (recMean <= 3.5) analystRating = "Hold";
        else if (recMean <= 4.5) analystRating = "Sell";
        else                     analystRating = "Strong Sell";
      }

      // Only return if we got at least one useful field
      if (pe != null || epsTrailing != null || analystTarget != null) {
        return {
          pe_ratio:       pe            != null ? Math.round(pe * 10) / 10            : null,
          forward_pe:     forwardPE     != null ? Math.round(forwardPE * 10) / 10     : null,
          eps_trailing:   epsTrailing,
          eps_forward:    epsForward,
          eps_growth:     epsGrowth     != null ? Math.round(epsGrowth * 1000) / 10   : null,
          analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
          analyst_rating: analystRating,
        };
      }
    } catch { /* try next host */ }
  }

  // ── Attempt 2: Yahoo v7/finance/quote (lighter, no modules) ──
  for (const host of ["query1", "query2"]) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com/",
        },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const q = json?.quoteResponse?.result?.[0] as Record<string, unknown> | undefined;
      if (!q) continue;

      const getNum = (k: string): number | null => {
        const v = q[k];
        return typeof v === "number" ? v : null;
      };

      const pe          = getNum("trailingPE")  ?? null;
      const forwardPE   = getNum("forwardPE")   ?? null;
      // v7 uses epsTrailingTwelveMonths, not trailingEps
      const epsTrailing = getNum("epsTrailingTwelveMonths") ?? getNum("trailingEps") ?? null;
      const epsForward  = getNum("epsForward")  ?? getNum("forwardEps") ?? null;
      let   epsGrowth   = getNum("earningsGrowth") ?? null;
      if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
        epsGrowth = (epsForward - epsTrailing) / Math.abs(epsTrailing);
      }

      const analystTarget = getNum("targetMeanPrice") ?? null;
      const recMean       = getNum("recommendationMean") ?? null;
      const recKey = typeof q.recommendationKey === "string" ? q.recommendationKey : null;
      let analystRating: string | null = recKey
        ? recKey.charAt(0).toUpperCase() + recKey.slice(1).toLowerCase()
        : null;
      if (!analystRating && recMean != null) {
        if      (recMean <= 1.5) analystRating = "Strong Buy";
        else if (recMean <= 2.5) analystRating = "Buy";
        else if (recMean <= 3.5) analystRating = "Hold";
        else if (recMean <= 4.5) analystRating = "Sell";
        else                     analystRating = "Strong Sell";
      }

      if (pe != null || epsTrailing != null || analystTarget != null) {
        return {
          pe_ratio:       pe            != null ? Math.round(pe * 10) / 10            : null,
          forward_pe:     forwardPE     != null ? Math.round(forwardPE * 10) / 10     : null,
          eps_trailing:   epsTrailing,
          eps_forward:    epsForward,
          eps_growth:     epsGrowth     != null ? Math.round(epsGrowth * 1000) / 10   : null,
          analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
          analyst_rating: analystRating,
        };
      }
    } catch { /* try next */ }
  }

  return empty;
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
