import { NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { supertrend } from "@/lib/indicators";
import { computeTrendTemplateCriteria } from "@/lib/trendTemplate";
import { fetchYahooOHLCV, getSTParams } from "@/lib/marketData";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Single source of truth for the universe — the same portfolio.json the worker reads.
const PORTFOLIO_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/portfolio.json";

interface ReconcileTicker {
  dir: "up" | "down";
  atrPeriod: number;
  mult: number;
  score: number;   // 7-criterion TT count
}

async function loadUniverse(): Promise<string[]> {
  const res = await fetch(PORTFOLIO_URL, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const port = Array.isArray(data?.portfolio) ? data.portfolio : [];
  return port.map((s: { symbol: string }) => s.symbol).filter(Boolean);
}

async function computeOne(symbol: string): Promise<ReconcileTicker | null> {
  const ohlcv = await fetchYahooOHLCV(symbol, DEFAULT_CONFIG.backtest.lookbackDays);
  if (!ohlcv) return null;

  // Same params source as the worker; fall back to the worker's default if absent.
  const p = (await getSTParams(symbol)) ?? { atrPeriod: 14, multiplier: 3.0 };

  const highs  = ohlcv.bars.map(b => b.high);
  const lows   = ohlcv.bars.map(b => b.low);
  const closes = ohlcv.bars.map(b => b.close);

  const [, dirArr] = supertrend(highs, lows, closes, p.atrPeriod, p.multiplier);
  const dir = (dirArr[dirArr.length - 1] === 1) ? "up" : "down";
  const score = computeTrendTemplateCriteria(closes, DEFAULT_CONFIG.analysis.smaLong).criteria_met;

  return { dir, atrPeriod: p.atrPeriod, mult: p.multiplier, score };
}

export async function GET() {
  try {
    const symbols = await loadUniverse();
    const results = await Promise.all(
      symbols.map(async (sym) => [sym, await computeOne(sym)] as const)
    );
    const tickers: Record<string, ReconcileTicker> = {};
    for (const [sym, t] of results) {
      if (t) tickers[sym] = t;
    }
    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      tickers,
    });
  } catch (e) {
    console.error("[/api/reconcile]", e);
    return NextResponse.json({ error: "reconcile failed" }, { status: 500 });
  }
}
