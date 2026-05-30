import { sma } from "./indicators";
import type { TrendTemplateCriteria } from "@/types";

/**
 * 7-criterion Minervini Trend Template, computed from a close series.
 * Extracted verbatim from runPipeline() in pipeline.ts so /api/stocks and
 * /api/reconcile share ONE implementation (never duplicate ST/TT logic — that is
 * the divergence this guards against). `smaLong` mirrors config.analysis.smaLong
 * (default 50); SMA150/200 windows are fixed, matching the original.
 */
export function computeTrendTemplateCriteria(
  closes: number[],
  smaLong = 50,
): TrendTemplateCriteria {
  const lastIdx   = closes.length - 1;
  const lastClose = closes[lastIdx];

  const sma50Arr  = sma(closes, smaLong);
  const sma150Arr = sma(closes, 150);
  const sma200Arr = sma(closes, 200);

  const lastSMA50  = sma50Arr[lastIdx];
  const lastSMA150 = sma150Arr[lastIdx] ?? 0;
  const lastSMA200 = sma200Arr[lastIdx] ?? 0;

  // 52-week high/low from the last 252 trading bars (or all bars if fewer)
  const bars252 = closes.slice(Math.max(0, closes.length - 252));
  const high52  = bars252.length > 0 ? Math.max(...bars252) : lastClose;
  const low52   = bars252.length > 0 ? Math.min(...bars252) : lastClose;

  // SMA200 slope: now vs 20 bars ago (proxy for Minervini #3 "1 month uptrend")
  const sma200_20barsAgo = lastIdx >= 20 ? (sma200Arr[lastIdx - 20] ?? 0) : 0;
  const sma200TrendingUp = lastSMA200 > 0 && sma200_20barsAgo > 0 && lastSMA200 > sma200_20barsAgo;

  const ttCriteria: TrendTemplateCriteria = {
    c1_price_above_sma150:     lastSMA150 > 0 && lastClose > lastSMA150,
    c2_price_above_sma200:     lastSMA200 > 0 && lastClose > lastSMA200,
    c3_sma150_above_sma200:    lastSMA150 > 0 && lastSMA200 > 0 && lastSMA150 > lastSMA200,
    c4_sma200_trending_up:     sma200TrendingUp,
    c5_price_above_sma50:      lastSMA50 > 0 && lastClose > lastSMA50,
    c6_above_25pct_of_low52:   low52 > 0 && lastClose >= low52 * 1.25,
    c7_within_25pct_of_high52: high52 > 0 && lastClose >= high52 * 0.75,
    criteria_met: 0,
    passes: false,
  };
  const ttCount = [
    ttCriteria.c1_price_above_sma150,  ttCriteria.c2_price_above_sma200,
    ttCriteria.c3_sma150_above_sma200, ttCriteria.c4_sma200_trending_up,
    ttCriteria.c5_price_above_sma50,   ttCriteria.c6_above_25pct_of_low52,
    ttCriteria.c7_within_25pct_of_high52,
  ].filter(Boolean).length;
  ttCriteria.criteria_met = ttCount;
  ttCriteria.passes       = ttCount >= 5;

  return ttCriteria;
}
