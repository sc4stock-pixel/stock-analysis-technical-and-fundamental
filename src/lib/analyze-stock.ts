// src/lib/analyze-stock.ts
// Extracted from src/app/api/stocks/route.ts — pure move, no logic changes.
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline } from "@/lib/pipeline";
import { getSTParams, fetchYahooOHLCV } from "@/lib/marketData";
import { AppConfig, EpsQuarter } from "@/types";

export type Stock = { symbol: string; name: string; exchange: string };

// ─── Fundamentals via FMP /stable/ endpoints ──────────────────
// FMP migrated from /api/v3/ (legacy, blocked Aug 2025) to /stable/.
// Free tier provides: ratios-ttm, price-target-consensus.
// Quarterly income-statement requires paid tier (402).
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

  const apiKey = process.env.FMP_KEY;
  if (!apiKey) return empty;

  const base    = "https://financialmodelingprep.com/stable";
  const headers = { "Accept": "application/json" };

  try {
    const [ratiosRes, targetRes] = await Promise.all([
      fetch(`${base}/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,              { headers }),
      fetch(`${base}/price-target-consensus?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,  { headers }),
    ]);

    // ── Ratios TTM: PE + EPS trailing ────────────────────────
    let pe: number | null          = null;
    let epsTrailing: number | null = null;

    if (ratiosRes.ok) {
      const rd = await ratiosRes.json();
      const r  = Array.isArray(rd) ? rd[0] : rd;
      if (r && typeof r === "object") {
        const rawPE = r.priceToEarningsRatioTTM ?? null;
        if (typeof rawPE === "number" && rawPE > 0 && rawPE < 5000) {
          pe = Math.round(rawPE * 10) / 10;
        }
        // netIncomePerShareTTM ≈ EPS TTM
        const rawEPS = r.netIncomePerShareTTM ?? null;
        if (typeof rawEPS === "number" && isFinite(rawEPS)) {
          epsTrailing = Math.round(rawEPS * 100) / 100;
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
      pe_ratio:       pe,
      forward_pe:     null,
      eps_trailing:   epsTrailing,
      eps_forward:    null,
      eps_growth:     null,   // not available on FMP free tier
      analyst_target: analystTarget,
      analyst_rating: null,
    };
  } catch {
    return empty;
  }
}


// ─── Earnings cache (Alpha Vantage + Akshare) ─────────────────
// Populated weekly by GitHub Actions (scripts/fetch_av_earnings.py).
// Tier 1 — US:  Alpha Vantage EARNINGS endpoint, frequency='Q'
// Tier 2 — HK:  Akshare/Eastmoney, frequency='Q' or 'H' (semi-annual)
// AV is never called directly from this route — only the cache file is read.
interface AvQuarter  { fiscalDateEnding: string; reportedEPS: string; }
interface SymbolData { frequency: "Q" | "H"; quarters: AvQuarter[]; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let avCache: Record<string, any> | null = null;
let avCacheFetchedAt = 0;
const AV_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const AV_CACHE_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/av_earnings_cache.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAvCache(): Promise<Record<string, any> | null> {
  const now = Date.now();
  if (avCache && now - avCacheFetchedAt < AV_CACHE_TTL_MS) return avCache;
  try {
    const res = await fetch(AV_CACHE_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    avCache = (json.data && Object.keys(json.data).length > 0) ? json.data : null;
    avCacheFetchedAt = now;
    return avCache;
  } catch {
    return null;
  }
}

// ─── Code 33: EPS acceleration check ─────────────────────────
// Handles both cache formats for backward compatibility:
//   Old format (US only):  symbol → AvQuarter[]          (array, frequency assumed 'Q')
//   New format (US + HK):  symbol → {frequency, quarters} (object, 'Q' or 'H')
// HK semi-annual step=2, quarterly step=4.
// ETFs / cache missing / insufficient data → null → badge shows "—"
async function fetchCode33(symbol: string, _exchange: string): Promise<boolean | null> {
  const cache = await getAvCache();
  const raw = cache?.[symbol];
  if (!raw) return null;

  // Normalise both cache formats into {frequency, quarters}
  let frequency: "Q" | "H" = "Q";
  let quarters: AvQuarter[];
  if (Array.isArray(raw)) {
    quarters = raw as AvQuarter[];            // old format — US quarterly array
  } else {
    const entry = raw as SymbolData;
    frequency = entry.frequency ?? "Q";
    quarters  = entry.quarters  ?? [];
  }

  // step=4 for quarterly (compare same quarter YoY), step=2 for semi-annual
  const step   = frequency === "H" ? 2 : 4;
  const needed = step + 3; // 7 for Q, 5 for H

  if (quarters.length < needed) return null;

  // quarters sorted newest-first
  const growthRates: number[] = [];
  for (let i = 0; i < 3; i++) {
    const recent  = parseFloat(quarters[i].reportedEPS);
    const yearAgo = parseFloat(quarters[i + step].reportedEPS);
    if (isNaN(recent) || isNaN(yearAgo) || Math.abs(yearAgo) < 0.001) return null;
    growthRates.push((recent - yearAgo) / Math.abs(yearAgo));
  }

  // growthRates[0]=most recent, [1]=prior, [2]=oldest
  // Acceleration: each period's YoY rate must be higher than the one before it
  return growthRates[0] > growthRates[1] && growthRates[1] > growthRates[2];
}

// ─── EPS quarters for OverviewTab chart ───────────────────────
// Reads the same in-memory AV cache (no extra network call).
// Returns last 4 individual EPS periods, newest first, with YoY and label.
const MONTH_ABBR = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function buildEpsQuarters(symbol: string): Promise<EpsQuarter[]> {
  const cache = await getAvCache();
  const raw   = cache?.[symbol];
  if (!raw) return [];

  let frequency: "Q" | "H" = "Q";
  let quarters: AvQuarter[];
  if (Array.isArray(raw)) {
    quarters = raw as AvQuarter[];
  } else {
    const entry = raw as SymbolData;
    frequency = entry.frequency ?? "Q";
    quarters  = entry.quarters  ?? [];
  }

  const step  = frequency === "H" ? 2 : 4;
  const count = Math.min(4, quarters.length);

  return quarters.slice(0, count).map((q, i) => {
    const eps     = parseFloat(q.reportedEPS);
    const yaIdx   = i + step;
    const yaRaw   = yaIdx < quarters.length ? parseFloat(quarters[yaIdx].reportedEPS) : null;
    const yoy     = yaRaw !== null && Math.abs(yaRaw) >= 0.001
      ? (eps - yaRaw) / Math.abs(yaRaw)
      : null;

    const mo      = parseInt(q.fiscalDateEnding.slice(5, 7));
    const yr2     = q.fiscalDateEnding.slice(2, 4);
    const period  = `${MONTH_ABBR[mo] ?? "?"} '${yr2}`;

    return { period, eps: isNaN(eps) ? 0 : eps, yoy };
  });
}

// ─── Single stock analysis ─────────────────────────────────────
export async function analyzeStock(
  stock: Stock,
  config: AppConfig = DEFAULT_CONFIG
) {
  try {
    // Fetch OHLCV, fundamentals, and Code 33 in parallel
    const [data, fundamentals, code33] = await Promise.all([
      fetchYahooOHLCV(stock.symbol, config.backtest.lookbackDays),
      fetchFundamentals(stock.symbol),
      fetchCode33(stock.symbol, stock.exchange),
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

    // Inject monthly-cached ST params so the pipeline skips live optimization.
    // Mirrors Python's STParamsCache: same source file, same monthly cadence.
    const cachedST = await getSTParams(stock.symbol);
    const configWithST: AppConfig = cachedST
      ? { ...config, supertrend: { ...config.supertrend, ...cachedST, useCachedParams: true } }
      : config;

    const result = runPipeline(data.bars, stock, configWithST, data.currentPrice, data.changePct);

    // Patch code_33 + eps_quarters into sepa_metadata.
    // buildEpsQuarters reads the same in-memory AV cache — no extra network call.
    if (result.sepa_metadata) {
      result.sepa_metadata.code_33 = code33;
      result.sepa_metadata.sepa_score = [
        result.sepa_metadata.trend_template,
        code33 === true,
        result.sepa_metadata.vcp_detected,
      ].filter(Boolean).length;
      result.sepa_metadata.eps_quarters = await buildEpsQuarters(stock.symbol);
    }

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
