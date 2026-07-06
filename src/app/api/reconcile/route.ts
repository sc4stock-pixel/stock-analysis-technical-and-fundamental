import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { supertrend, sma } from "@/lib/indicators";
import { computeTrendTemplateCriteria } from "@/lib/trendTemplate";
import { fetchYahooOHLCV, getSTParams } from "@/lib/marketData";
import { simulatePositionState } from "@/lib/positionState";

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
  entryReady: boolean; // strategy SMA50 gate: dir up AND c5 (see STRATEGY.md)
  inLong: boolean;     // strategy position state (STRATEGY.md state machine)
  barDate: string; // YYYY-MM-DD of the last bar used for computation
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

  const [, dirArr, sigArr] = supertrend(highs, lows, closes, p.atrPeriod, p.multiplier);
  const dir = (dirArr[dirArr.length - 1] === 1) ? "up" : "down";
  const tt = computeTrendTemplateCriteria(closes, DEFAULT_CONFIG.analysis.smaLong);
  // Strategy SMA50 gate (STRATEGY.md): same derivation as the worker's entryReady.
  const entryReady = dir === "up" && tt.c5_price_above_sma50 === true;
  // Strategy position state — independent recompute of the worker's inLong so
  // Tier-2 catches the two engines disagreeing about holding a position.
  const { inLong } = simulatePositionState(closes, dirArr, sigArr, sma(closes, 50));
  const barDate = ohlcv.bars[ohlcv.bars.length - 1].date;

  return { dir, atrPeriod: p.atrPeriod, mult: p.multiplier,
           score: tt.criteria_met, entryReady, inLong, barDate };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.RECONCILE_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
