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

  // FMP requires an API key — set FMP_KEY in Vercel environment variables.
  // Free tier: financialmodelingprep.com → 250 req/day, no credit card.
  const apiKey = process.env.FMP_KEY;
  if (!apiKey) return empty;  // no key → return empty (columns show dashes)

  const base = "https://financialmodelingprep.com/api/v3";
  const headers = { "Accept": "application/json" };

  try {
    // All 3 endpoints in parallel — 3 req per stock
    const [profileRes, ratiosRes, targetRes] = await Promise.all([
      fetch(`${base}/profile/${encodeURIComponent(symbol)}?apikey=${apiKey}`,                  { headers }),
      fetch(`${base}/ratios-ttm/${encodeURIComponent(symbol)}?apikey=${apiKey}`,               { headers }),
      fetch(`${base}/price-target-consensus/${encodeURIComponent(symbol)}?apikey=${apiKey}`,   { headers }),
    ]);

    // ── Profile: pe, eps ─────────────────────────────────────
    let pe: number | null          = null;
    let epsTrailing: number | null = null;

    if (profileRes.ok) {
      const pd = await profileRes.json();
      const p  = Array.isArray(pd) ? pd[0] : pd;
      if (p && typeof p === "object") {
        pe          = typeof p.pe  === "number" && p.pe  > 0 ? Math.round(p.pe  * 10) / 10 : null;
        epsTrailing = typeof p.eps === "number"              ? Math.round(p.eps * 100) / 100 : null;
      }
    }

    // ── Ratios TTM: peRatioTTM (more accurate), epsGrowthTTM ─
    let peTTM: number | null      = null;
    let epsGrowth: number | null  = null;

    if (ratiosRes.ok) {
      const rd = await ratiosRes.json();
      const r  = Array.isArray(rd) ? rd[0] : rd;
      if (r && typeof r === "object") {
        // peRatioTTM is more accurate than profile.pe
        const rawPE = r.peRatioTTM ?? r.priceEarningsRatioTTM ?? null;
        if (typeof rawPE === "number" && rawPE > 0 && rawPE < 5000) {
          peTTM = Math.round(rawPE * 10) / 10;
        }
        // EPS growth: try multiple fields (decimal, e.g. 0.21 = 21%)
        const rawGrowth = r.epsGrowthTTM ?? r.netIncomePerShareGrowthTTM ?? r.revenueGrowthTTM ?? null;
        if (typeof rawGrowth === "number" && isFinite(rawGrowth)) {
          // FMP returns as decimal (0.21 = 21%) — convert to %
          epsGrowth = Math.round(rawGrowth * 1000) / 10;
          // Sanity-check: cap at ±999%
          if (Math.abs(epsGrowth) > 999) epsGrowth = null;
        }
      }
    }

    // ── Price target consensus ────────────────────────────────
    let analystTarget: number | null = null;

    if (targetRes.ok) {
      const td = await targetRes.json();
      const t  = Array.isArray(td) ? td[0] : td;
      if (t && typeof t === "object") {
        const tgt = t.targetConsensus ?? t.targetMedian ?? null;
        if (typeof tgt === "number" && tgt > 0) {
          analystTarget = Math.round(tgt * 100) / 100;
        }
      }
    }

    return {
      pe_ratio:       peTTM ?? pe,   // prefer TTM over profile.pe
      forward_pe:     null,           // FMP v3 free tier doesn't give forward PE reliably
      eps_trailing:   epsTrailing,
      eps_forward:    null,
      eps_growth:     epsGrowth,
      analyst_target: analystTarget,
      analyst_rating: null,           // FMP consensus string needs paid tier
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
    const calendarDays = Math.floor(lookbackDays * 7 / 5) + 30;
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
        backtest: null, monte_carlo: null, st_monte_carlo: null,
        walk_forward: null, kelly: null,
        st_direction: -1, st_value: 0, st_stop_distance_pct: 0, st_open_return_pct: null,
        comparison: null,
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
      backtest: null, monte_carlo: null, st_monte_carlo: null,
      walk_forward: null, kelly: null,
      st_direction: -1, st_value: 0, st_stop_distance_pct: 0, st_open_return_pct: null,
      comparison: null,
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
