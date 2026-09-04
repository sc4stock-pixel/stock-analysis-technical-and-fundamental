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

// Yahoo's chart API occasionally rate-limits/times out a single ticker out of a
// batch of parallel requests from the same IP. One retry after a short delay
// recovers most of these without materially slowing the whole batch.
const YAHOO_FETCH_RETRIES = 1;
const YAHOO_RETRY_DELAY_MS = 500;

export async function fetchYahooOHLCV(
  symbol: string,
  lookbackDays: number
): Promise<{ bars: RawOHLCV[]; currentPrice: number; changePct: number } | null> {
  for (let attempt = 0; attempt <= YAHOO_FETCH_RETRIES; attempt++) {
    const result = await fetchYahooOHLCVOnce(symbol, lookbackDays);
    if (result) return result;
    if (attempt < YAHOO_FETCH_RETRIES) {
      await new Promise(r => setTimeout(r, YAHOO_RETRY_DELAY_MS));
    }
  }
  return null;
}

// ── Null-Close repair (mirrors autopilot worker/data_source.py) ──────────
// Yahoo sometimes publishes a COMPLETED session's bar with `close: null` while
// Open/High/Low/Volume are populated and `meta.regularMarketPrice` holds the
// real settle — seen on all 9 US tickers on 2026-09-03. The old code dropped
// that bar, so the web ended one session behind the worker while still showing
// the newer price in `currentPrice`. Two consequences, both silent:
//   * the app mixed a 09-03 price against SMAs/stops computed through 09-02;
//   * /api/reconcile skips any name whose barDates differ, so the drift check
//     compared 0/9 US names and reported "drift: 0" (see reconcile.py).
//
// A settle may only be substituted when it is unambiguously FINAL, hence two
// conservative guards (the second is the web-only analogue of the worker's
// `repair_final_bar=False` for intraday runs):
const SETTLE_QUOTE_MIN_AGE_MS = 60 * 60 * 1000; // quote must have stopped moving

/** UTC calendar day (YYYY-MM-DD) of a unix-seconds timestamp. */
const utcDay = (tsSec: number): string =>
  new Date(tsSec * 1000).toISOString().split("T")[0];

/**
 * Settled close for the bar dated `barTsSec`, or null when it can't be trusted.
 *
 * Guard 1 — `meta.regularMarketTime` must fall on the bar's own UTC day, so a
 *           quote belonging to a different session is never borrowed.
 * Guard 2 — that quote must be at least an hour old. During a live session
 *           `regularMarketTime` tracks the clock, so a fresh timestamp means
 *           intraday (a live quote is NOT a close) and the bar must be dropped.
 */
export function settledCloseForBar(
  meta: Record<string, unknown> | undefined | null,
  barTsSec: number,
  nowMs: number = Date.now(),
): number | null {
  if (!meta) return null;
  const px = meta.regularMarketPrice;
  const ts = meta.regularMarketTime;
  if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (utcDay(ts) !== utcDay(barTsSec)) return null;        // guard 1: same session
  if (nowMs - ts * 1000 < SETTLE_QUOTE_MIN_AGE_MS) return null; // guard 2: not live
  return px;
}

async function fetchYahooOHLCVOnce(
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
    const lastIdx = timestamps.length - 1;
    let finalBarDropped = false;
    for (let i = 0; i < timestamps.length; i++) {
      const o = ohlcv.open?.[i];
      const h = ohlcv.high?.[i];
      const l = ohlcv.low?.[i];
      const c = ohlcv.close?.[i];
      const v = ohlcv.volume?.[i];
      if (o == null || h == null || l == null) continue;

      let close = c;
      if ((c == null || c <= 0) && i === lastIdx) {
        // Final bar with no Close. Recover the settle rather than dropping the
        // bar — but only if the settle lands inside the bar's own [low, high],
        // which is the last available proof that it belongs to this session.
        const settle = settledCloseForBar(meta, timestamps[i]);
        if (settle != null && settle >= l && settle <= h) {
          console.warn(
            `[marketData] ${symbol}: repaired null close on ${utcDay(timestamps[i])} -> ${settle}`
          );
          close = settle;
        } else {
          console.warn(
            `[marketData] ${symbol}: dropped incomplete bar ${utcDay(timestamps[i])} (null Close, no trusted settle)`
          );
          finalBarDropped = true;
          continue;
        }
      }
      if (close == null || close <= 0) continue;

      bars.push({
        date:   utcDay(timestamps[i]),
        open: o, high: h, low: l, close, volume: v ?? 0,
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

    if (finalBarDropped) {
      // bars now end one session early, so secondLast is TWO sessions back and
      // measuring against it would report a two-day move as one day's. Yahoo's
      // own quote change is struck against the correct prior close — prefer it.
      changePct = metaChangePct() ?? 0;
    } else if (secondLast && secondLast.close > 0 && currentPrice > 0) {
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
