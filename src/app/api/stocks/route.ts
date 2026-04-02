// src/app/api/stocks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline, RawOHLCV } from "@/lib/pipeline";
import { AppConfig } from "@/types";

export const maxDuration = 30;

// ─── Fundamentals from Yahoo v10/quoteSummary ─────────────────
interface Fundamentals {
  pe_ratio: number | null;
  forward_pe: number | null;
  eps_trailing: number | null;
  eps_forward: number | null;
  eps_growth: number | null;       // trailing EPS YoY growth %
  analyst_target: number | null;
  analyst_rating: string | null;   // "Buy" / "Hold" / "Sell"
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const empty: Fundamentals = {
    pe_ratio: null, forward_pe: null,
    eps_trailing: null, eps_forward: null, eps_growth: null,
    analyst_target: null, analyst_rating: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics,summaryDetail,recommendationTrend`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 }, // 1h cache for fundamentals
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return empty;

    const fin = result.financialData ?? {};
    const stats = result.defaultKeyStatistics ?? {};
    const summary = result.summaryDetail ?? {};

    const pe = summary.trailingPE?.raw ?? stats.trailingPE?.raw ?? null;
    const forwardPE = summary.forwardPE?.raw ?? stats.forwardPEG?.raw ?? null;
    const epsTrailing = stats.trailingEps?.raw ?? fin.trailingEps?.raw ?? null;
    const epsForward = stats.forwardEps?.raw ?? fin.forwardEps?.raw ?? null;

    // EPS growth: (forward - trailing) / |trailing|  OR use earningsGrowth
    let epsGrowth: number | null = fin.earningsGrowth?.raw ?? null;
    if (epsGrowth == null && epsTrailing != null && epsForward != null && epsTrailing !== 0) {
      epsGrowth = ((epsForward - epsTrailing) / Math.abs(epsTrailing));
    }

    const analystTarget = fin.targetMeanPrice?.raw ?? null;
    // Recommendation: 1=Strong Buy 2=Buy 3=Hold 4=Sell 5=Strong Sell
    const recMean = fin.recommendationMean?.raw ?? null;
    let analystRating: string | null = null;
    if (recMean != null) {
      if (recMean <= 1.5) analystRating = "Strong Buy";
      else if (recMean <= 2.5) analystRating = "Buy";
      else if (recMean <= 3.5) analystRating = "Hold";
      else if (recMean <= 4.5) analystRating = "Sell";
      else analystRating = "Strong Sell";
    }

    return {
      pe_ratio: pe != null ? Math.round(pe * 10) / 10 : null,
      forward_pe: forwardPE != null ? Math.round(forwardPE * 10) / 10 : null,
      eps_trailing: epsTrailing,
      eps_forward: epsForward,
      eps_growth: epsGrowth != null ? Math.round(epsGrowth * 1000) / 10 : null, // as %
      analyst_target: analystTarget != null ? Math.round(analystTarget * 100) / 100 : null,
      analyst_rating: analystRating,
    };
  } catch {
    return empty;
  }
}

// ─── OHLCV + price/change fetch ───────────────────────────────
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
      next: { revalidate: 900 },
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

    // ── Current price ─────────────────────────────────────────
    const lastBar = bars[bars.length - 1];
    let currentPrice: number = meta.regularMarketPrice ?? lastBar.close;
    if (!currentPrice || currentPrice <= 0) currentPrice = lastBar.close;

    // ── Change % — normalise Yahoo's regularMarketChangePercent ──
    // Yahoo returns this field inconsistently:
    //   - After market close: decimal fraction e.g. 0.029 meaning +2.9%
    //   - During market hours: sometimes already a % e.g. 2.9
    // Strategy: prefer computing from previousClose (always reliable),
    // then cross-check with regularMarketChangePercent.
    const prevClose =
      meta.chartPreviousClose ??
      meta.previousClose ??
      bars[bars.length - 2]?.close ??
      null;

    let changePct = 0;
    if (prevClose && prevClose > 0 && currentPrice > 0) {
      changePct = ((currentPrice - prevClose) / prevClose) * 100;
    } else if (meta.regularMarketChangePercent != null) {
      // Fallback: normalise the Yahoo field
      const raw = meta.regularMarketChangePercent as number;
      // If |raw| < 1 it's likely a fraction (0.029 → 2.9%); else it's already %
      changePct = Math.abs(raw) < 1 ? raw * 100 : raw;
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
        regime_info: { regime: "UNKNOWN", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
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
      regime_info: { regime: "ERROR", atr_ratio: 1, adx_slope: 0, bullish_count: 0, is_high_volatility: false, is_extreme_dislocation: false },
      current_price: 0, change_pct: 0,
      fundamentals: { pe_ratio: null, forward_pe: null, eps_trailing: null, eps_forward: null, eps_growth: null, analyst_target: null, analyst_rating: null },
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
