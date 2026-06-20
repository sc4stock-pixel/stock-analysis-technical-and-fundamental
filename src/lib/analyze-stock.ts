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
export interface AvQuarter { fiscalDateEnding: string; reportedEPS: string; }
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
// ETFs / cache missing / insufficient data → null → badge shows "—"
//
// AUDIT FIX (2026-06-10): YoY lookup is DATE-aware, not positional. The cache
// builder drops invalid/zero-EPS quarters (US) and FY-only years (HK
// semi-annual), so quarters[i + step] could be a different period entirely —
// silently comparing mismatched quarters. Now the year-ago period is matched
// by fiscalDateEnding (~365d back, ±45d), and the 3 recent periods must be
// genuinely consecutive (~91d apart for Q, ~182d for H). Any gap → null
// ("—" badge) instead of a wrong answer.
const MS_PER_DAY = 86_400_000;

function periodTime(q: AvQuarter): number {
  return new Date(`${q.fiscalDateEnding}T00:00:00Z`).getTime();
}

/** Period ending ~1 year before quarters[i] (±45 days), or null if absent.
 *  ±45d absorbs fiscal-calendar drift (4-4-5 calendars, HK report-date wobble)
 *  while staying well clear of the adjacent period (91d for Q, 182d for H).
 *  Exported for unit tests. */
export function findYearAgo(quarters: AvQuarter[], i: number): AvQuarter | null {
  const target = periodTime(quarters[i]) - 365 * MS_PER_DAY;
  let best: AvQuarter | null = null;
  let bestDiff = Infinity;
  for (const q of quarters) {
    const diff = Math.abs(periodTime(q) - target);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return bestDiff <= 45 * MS_PER_DAY ? best : null;
}

function normalizeCacheEntry(raw: unknown): { frequency: "Q" | "H"; quarters: AvQuarter[] } {
  if (Array.isArray(raw)) {
    return { frequency: "Q", quarters: raw as AvQuarter[] }; // old format — US quarterly array
  }
  const entry = raw as SymbolData;
  return { frequency: entry.frequency ?? "Q", quarters: entry.quarters ?? [] };
}

/** Pure Code 33 evaluation — exported for unit tests. */
export function evaluateCode33(frequency: "Q" | "H", quarters: AvQuarter[]): boolean | null {
  // Need 3 recent periods + their year-ago matches (4 per year for Q, 2 for H)
  const perYear = frequency === "H" ? 2 : 4;
  if (quarters.length < perYear + 3) return null;

  // The 3 most recent periods must be consecutive — a dropped period in the
  // cache must not silently shift the acceleration window.
  const periodDays = frequency === "H" ? 182 : 91;
  for (let i = 0; i < 2; i++) {
    const gapDays = (periodTime(quarters[i]) - periodTime(quarters[i + 1])) / MS_PER_DAY;
    if (gapDays < periodDays * 0.5 || gapDays > periodDays * 1.5) return null;
  }

  // quarters sorted newest-first
  const growthRates: number[] = [];
  for (let i = 0; i < 3; i++) {
    const recent  = parseFloat(quarters[i].reportedEPS);
    const yearAgoQ = findYearAgo(quarters, i);
    if (!yearAgoQ) return null;
    const yearAgo = parseFloat(yearAgoQ.reportedEPS);
    if (isNaN(recent) || isNaN(yearAgo) || Math.abs(yearAgo) < 0.001) return null;
    growthRates.push((recent - yearAgo) / Math.abs(yearAgo));
  }

  // growthRates[0]=most recent, [1]=prior, [2]=oldest
  // Acceleration: each period's YoY rate must be higher than the one before it
  return growthRates[0] > growthRates[1] && growthRates[1] > growthRates[2];
}

async function fetchCode33(symbol: string, _exchange: string): Promise<boolean | null> {
  const cache = await getAvCache();
  const raw = cache?.[symbol];
  if (!raw) return null;
  const { frequency, quarters } = normalizeCacheEntry(raw);
  return evaluateCode33(frequency, quarters);
}

// ─── EPS quarters for OverviewTab chart ───────────────────────
// Reads the same in-memory AV cache (no extra network call).
// Returns last 4 individual EPS periods, newest first, with YoY and label.
const MONTH_ABBR = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function buildEpsQuarters(symbol: string): Promise<EpsQuarter[]> {
  const cache = await getAvCache();
  const raw   = cache?.[symbol];
  if (!raw) return [];

  const { quarters } = normalizeCacheEntry(raw);
  const count = Math.min(4, quarters.length);

  return quarters.slice(0, count).map((q, i) => {
    const eps     = parseFloat(q.reportedEPS);
    // Date-aware year-ago lookup (same rationale as fetchCode33 above):
    // positional i+step breaks whenever the cache has a dropped period.
    const yaQ     = findYearAgo(quarters, i);
    const yaRaw   = yaQ ? parseFloat(yaQ.reportedEPS) : null;
    const yoy     = yaRaw !== null && !isNaN(yaRaw) && Math.abs(yaRaw) >= 0.001
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
