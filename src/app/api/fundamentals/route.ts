// src/app/api/fundamentals/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const FUND_CACHE_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/fundamentals_cache.json";
// 10 min TTL — bounds per-instance staleness after GHA cache updates.
// 6h previously caused an instance to keep serving pre-update data for hours
// even though the GitHub raw cache had refreshed (2026-05-27 Z'' rollout).
const TTL_MS = 10 * 60 * 1000;

interface PeriodRow {
  endDate: string;
  revenue?: number | null; grossProfit?: number | null; operatingIncome?: number | null;
  netIncome?: number | null; ebit?: number | null;
  cfo?: number | null; capex?: number | null; fcf?: number | null;
  ar?: number | null; inventory?: number | null; ap?: number | null;
  totalAssets?: number | null; totalLiab?: number | null;
  currentAssets?: number | null; currentLiab?: number | null;
  workingCapital?: number | null; retainedEarnings?: number | null;
  sharesOutstanding?: number | null; longTermDebt?: number | null;
}

export interface FundamentalsPayload {
  frequency: "Q" | "H";
  periods: PeriodRow[];
  derived: {
    altmanZ: (number | null)[];
    piotroskiF: (number | null)[];
    /** "Z" = standard Altman (US); "Zpp" = Z'' Emerging Markets (HK). Picks threshold bands. */
    zVariant?: "Z" | "Zpp";
  };
}

let cache: Record<string, FundamentalsPayload> | null = null;
let cacheFetchedAt = 0;

async function getCache(): Promise<Record<string, FundamentalsPayload> | null> {
  const now = Date.now();
  if (cache && now - cacheFetchedAt < TTL_MS) return cache;
  try {
    const res = await fetch(FUND_CACHE_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    cache = (json.data && Object.keys(json.data).length > 0) ? json.data : null;
    cacheFetchedAt = now;
    return cache;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol query param required" }, { status: 400 });
  }
  const all = await getCache();
  const data = all?.[symbol] ?? null;
  return NextResponse.json({ symbol, data });
}
