The issue is almost certainly that **Yahoo Finance is blocking the request** from Vercel's servers. Your logs likely show `401 Unauthorized` or `403 Forbidden`, causing the function to return the `empty` object (which renders as "—").

This happens because:
1.  **v11 Endpoint**: Requires a valid "Crumb" token/cookie pair, which is hard to manage on serverless.
2.  **Headers**: `Origin` and `Referer` headers on the `v7` request can actually trigger stricter bot detection.

### The Fix

1.  **Prioritize `v7/quote`**: It is lighter and requires less strict authentication.
2.  **Clean Headers**: Remove `Origin` and `Referer` for `v7`, as they expose the server-side nature of the request.
3.  **Add Logging**: I added `console.error` so you can see exactly *why* it fails in your Vercel logs.

Here is the corrected `src/app/api/stocks/route.ts`.

```typescript
// src/app/api/stocks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline, RawOHLCV } from "@/lib/pipeline";
import { AppConfig } from "@/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// ─── Fundamentals Interface ─────────────────────────────────────
interface Fundamentals {
  pe_ratio: number | null;
  forward_pe: number | null;
  eps_trailing: number | null;
  eps_forward: number | null;
  eps_growth: number | null;
  analyst_target: number | null;
  analyst_rating: string | null;
}

// ─── Main Fetch Function ────────────────────────────────────────
async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const empty: Fundamentals = {
    pe_ratio: null, forward_pe: null,
    eps_trailing: null, eps_forward: null, eps_growth: null,
    analyst_target: null, analyst_rating: null,
  };

  // Helper to extract number (handles {raw: val} or raw number)
  const getNum = (obj: any, key: string): number | null => {
    if (!obj) return null;
    const v = obj[key];
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v.raw != null) return v.raw;
    return null;
  };

  // ── STRATEGY 1: Yahoo v7/finance/quote (Most Reliable on Vercel) ──
  // This endpoint is lightweight and often works where v11 fails.
  const hosts = ["query2", "query1"]; // Try query2 first, often less loaded
  
  for (const host of hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
      
      // Minimal headers to look like a generic HTTP client
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Connection": "keep-alive",
        },
        next: { revalidate: 3600 }, // Cache 1hr
      });

      if (!res.ok) {
        // Log failure to Vercel logs
        console.error(`[Fundamentals] ${host} v7 failed: ${res.status}`);
        continue; 
      }

      const json = await res.json();
      const quote = json?.quoteResponse?.result?.[0];

      if (quote) {
        const pe = getNum(quote, "trailingPE");
        const forwardPE = getNum(quote, "forwardPE");
        const epsTrailing = getNum(quote, "epsTrailingTwelveMonths");
        const epsForward = getNum(quote, "epsForward");
        const analystTarget = getNum(quote, "targetMeanPrice");
        
        // Calculate Growth if possible
        let epsGrowth = getNum(quote, "earningsGrowth"); // Sometimes present
        if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
           epsGrowth = (epsForward - epsTrailing) / Math.abs(epsTrailing);
        }

        const recKey = typeof quote.recommendationKey === "string" ? quote.recommendationKey : null;
        let analystRating: string | null = recKey 
          ? (recKey.charAt(0).toUpperCase() + recKey.slice(1)) 
          : null;

        // If we got at least PE, we have valid data
        if (pe != null) {
          return {
            pe_ratio: pe != null ? Math.round(pe * 10) / 10 : null,
            forward_pe: forwardPE != null ? Math.round(forwardPE * 10) / 10 : null,
            eps_trailing: epsTrailing,
            eps_forward: epsForward,
            eps_growth: epsGrowth != null ? Math.round(epsGrowth * 1000) / 10 : null,
            analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
            analyst_rating: analystRating,
          };
        }
      }
    } catch (e) {
      console.error(`[Fundamentals] Network error ${host}:`, e);
    }
  }

  // ── STRATEGY 2: Yahoo v11 (Fallback - Rarely works on Vercel without Crumb) ──
  // Keeping this as backup in case v7 is deprecated for a specific symbol
  for (const host of hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics,summaryDetail`;
      const res = await fetch(url, {
        headers: {
           "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
           "Accept": "*/*",
        },
        next: { revalidate: 3600 },
      });
      
      if (!res.ok) continue;
      
      const json = await res.json();
      const result = json?.quoteSummary?.result?.[0];
      if (!result) continue;

      const fin = result.financialData || {};
      const stats = result.defaultKeyStatistics || {};
      const summ = result.summaryDetail || {};

      const pe = getNum(summ, "trailingPE") ?? getNum(stats, "trailingPE");
      const forwardPE = getNum(summ, "forwardPE");
      const epsTrailing = getNum(stats, "trailingEps");
      const epsForward = getNum(fin, "forwardEps");
      const analystTarget = getNum(fin, "targetMeanPrice");
      
      let epsGrowth = getNum(fin, "earningsGrowth");
      if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
         epsGrowth = (epsForward - epsTrailing) / Math.abs(epsTrailing);
      }

      if (pe != null) {
         return {
            pe_ratio: pe != null ? Math.round(pe * 10) / 10 : null,
            forward_pe: forwardPE != null ? Math.round(forwardPE * 10) / 10 : null,
            eps_trailing: epsTrailing,
            eps_forward: epsForward,
            eps_growth: epsGrowth != null ? Math.round(epsGrowth * 1000) / 10 : null,
            analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
            analyst_rating: null, // Harder to get from v11 without extra parsing
         };
      }
    } catch (e) {
      console.error(`[Fundamentals] v11 error:`, e);
    }
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
      cache: "no-store", 
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

    const lastBar     = bars[bars.length - 1];
    const secondLast  = bars[bars.length - 2];
    let currentPrice: number = meta.regularMarketPrice ?? lastBar.close;
    if (!currentPrice || currentPrice <= 0) currentPrice = lastBar.close;

    let changePct = 0;
    if (secondLast && secondLast.close > 0 && currentPrice > 0) {
      changePct = ((currentPrice - secondLast.close) / secondLast.close) * 100;
    } else if (meta.regularMarketChange != null && lastBar.close > 0) {
      const impliedPrev = currentPrice - (meta.regularMarketChange as number);
      if (impliedPrev > 0) {
        changePct = ((meta.regularMarketChange as number) / impliedPrev) * 100;
      }
    }

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
```