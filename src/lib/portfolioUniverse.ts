import { DEFAULT_CONFIG } from "@/lib/config";
import type { StockConfig } from "@/types";

/**
 * The portfolio of record.
 *
 * `portfolio.json` at the repo root is the single source of truth for the universe —
 * the browser dashboard, the worker, the Kronos generator and /api/reconcile all read
 * it. The scheduled routes did not: they used the hardcoded DEFAULT_CONFIG array, which
 * had drifted to 15 names while portfolio.json held 16. 0939.HK was therefore never
 * fetched, never analysed and never appeared in a scheduled report, and nothing noticed
 * because each report only ever reconciled against the list it was handed.
 *
 * The hardcoded array stays as the offline fallback (raw.githubusercontent is a network
 * dependency inside a cron), but it is a fallback, not a second source of truth.
 */
const PORTFOLIO_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/portfolio.json";

export interface Universe {
  stocks: StockConfig[];
  /** Where the list came from — surfaced so a silent fallback is still visible. */
  source: "portfolio.json" | "fallback";
}

/**
 * Fetches portfolio.json, falling back to DEFAULT_CONFIG on any failure.
 * Never throws: a scheduled report degrades to the fallback rather than not sending.
 */
export async function fetchPortfolioUniverse(): Promise<Universe> {
  try {
    const res = await fetch(PORTFOLIO_URL, { cache: "no-store" });
    if (!res.ok) return { stocks: DEFAULT_CONFIG.stocks.PORTFOLIO, source: "fallback" };
    const data = (await res.json()) as { portfolio?: unknown };
    const list = Array.isArray(data?.portfolio) ? data.portfolio : [];
    const stocks = list.filter(
      (s: unknown): s is StockConfig =>
        !!s && typeof (s as StockConfig).symbol === "string" && !!(s as StockConfig).symbol,
    );
    if (stocks.length === 0) return { stocks: DEFAULT_CONFIG.stocks.PORTFOLIO, source: "fallback" };
    return { stocks, source: "portfolio.json" };
  } catch {
    return { stocks: DEFAULT_CONFIG.stocks.PORTFOLIO, source: "fallback" };
  }
}
