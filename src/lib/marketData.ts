// Shared market-data helpers used by /api/stocks and /api/reconcile.
// Single-sourced so both surfaces fetch prices + ST params identically (never
// duplicate this logic — divergence here is exactly what the reconcile guard checks).
import type { RawOHLCV } from "@/lib/pipeline";

// ─── Monthly ST params cache (mirrors Python STParamsCache) ───────────────────
// st_params.json is written monthly by .github/workflows/optimize-supertrend.yml
// (same file Python reads). Fetching it here makes the web use the same stable
// monthly params instead of re-optimizing live on every request.
export const ST_PARAMS_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/st_params.json";

// Module-level in-memory cache: one fetch shared across all stocks in a request
// batch. Revalidated hourly between request batches.
let _stParamsCache: Record<string, { atr_period: number; multiplier: number }> | null = null;
let _stParamsFetchedAt = 0;
const ST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getSTParams(symbol: string): Promise<{ atrPeriod: number; multiplier: number } | null> {
  const now = Date.now();
  if (!_stParamsCache || now - _stParamsFetchedAt > ST_CACHE_TTL_MS) {
    try {
      const res = await fetch(ST_PARAMS_URL, { cache: "no-store" });
      if (res.ok) {
        // Defend against bare NaN/Infinity tokens: the Python optimizer can
        // emit them (valid for json.load, invalid for JSON.parse), and a single
        // one would otherwise throw here and silently default EVERY symbol to
        // (14, 3). Coerce non-finite literals → null before parsing.
        const text = await res.text();
        const data = JSON.parse(
          text.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null")
        );
        _stParamsCache = data?.stocks ?? {};
        _stParamsFetchedAt = now;
      } else {
        // Fail loud — never let a bad fetch masquerade as "no params".
        console.error(`[getSTParams] st_params fetch failed: HTTP ${res.status} — falling back to default params`);
      }
    } catch (e) {
      console.error("[getSTParams] st_params fetch/parse error — falling back to default params:", e);
      _stParamsCache = _stParamsCache ?? {}; // keep stale on error
    }
  }
  const entry = _stParamsCache?.[symbol];
  if (!entry || !entry.atr_period || !entry.multiplier) return null;
  return { atrPeriod: entry.atr_period, multiplier: entry.multiplier };
}

export async function fetchYahooOHLCV(
  symbol: string,
  lookbackDays: number
): Promise<{ bars: RawOHLCV[]; currentPrice: number; changePct: number } | null> {
  try {
    const calendarDays = Math.floor(lookbackDays * 7 / 5) + 20;
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
    // meta.chartPreviousClose = close BEFORE the chart's first bar (~252 days ago),
    // NOT yesterday. bars[-2].close = prior trading day's close is the reliable source.
    let changePct = 0;

    const metaChangePct = (): number | null => {
      if (meta.regularMarketChange == null || lastBar.close <= 0) return null;
      const impliedPrev = currentPrice - (meta.regularMarketChange as number);
      return impliedPrev > 0
        ? ((meta.regularMarketChange as number) / impliedPrev) * 100
        : null;
    };

    if (secondLast && secondLast.close > 0 && currentPrice > 0) {
      changePct = ((currentPrice - secondLast.close) / secondLast.close) * 100;
    } else {
      changePct = metaChangePct() ?? 0;
    }

    // Sanity gate: a computed move > 50% almost always means a bad prev-close
    // bar, not a real move. Before zeroing (the old behavior, which also hid
    // genuine large moves), cross-check against Yahoo's own quote change —
    // if both agree it's > 50%, trust it; otherwise prefer the meta figure.
    if (Math.abs(changePct) > 50) {
      const mc = metaChangePct();
      changePct = mc !== null && Math.abs(mc) <= Math.abs(changePct) ? mc : 0;
    }

    return { bars, currentPrice, changePct };
  } catch {
    return null;
  }
}
