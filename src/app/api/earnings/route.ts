// src/app/api/earnings/route.ts
// Uses Alpha Vantage EARNINGS_CALENDAR endpoint (free, 500 req/day)
// Set ALPHA_VANTAGE_KEY in Vercel environment variables.
// Free key: https://www.alphavantage.co/support/#api-key (instant, no CC)
//
// Fallback: Yahoo Finance quoteSummary earningsDate (no key needed)

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export interface EarningsDate {
  symbol: string;
  reportDate: string;      // ISO date string YYYY-MM-DD
  daysUntil: number;       // negative = already reported
  fiscalQuarter: string;   // e.g. "Q1 2026"
  estimate: number | null; // EPS estimate
  source: "alphavantage" | "yahoo" | "unknown";
}

async function fetchAlphaVantage(symbol: string): Promise<EarningsDate | null> {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) return null;

  try {
    // EARNINGS_CALENDAR returns CSV for a 3-month horizon
    const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=${encodeURIComponent(symbol)}&horizon=3month&apikey=${key}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;

    // CSV: symbol,name,reportDate,fiscalDateEnding,estimate,currency
    // The name column can contain commas (e.g. "Company, Inc.") — a naive
    // split shifts every later column. Split on commas outside double quotes.
    const splitCsvLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length < 3) continue;
      const sym        = cols[0]?.trim();
      const reportDate = cols[2]?.trim();
      const fiscal     = cols[3]?.trim();
      const estimate   = parseFloat(cols[4] ?? "");

      if (!sym || !reportDate) continue;
      // Match symbol (AV may return base symbol without exchange suffix)
      const baseSymbol = symbol.replace(/\.(HK|US)$/i, "");
      if (sym.toUpperCase() !== symbol.toUpperCase() &&
          sym.toUpperCase() !== baseSymbol.toUpperCase()) continue;

      const reportMs  = new Date(reportDate).getTime();
      const nowMs     = Date.now();
      const daysUntil = Math.round((reportMs - nowMs) / 86400000);
      // Calendar quarter of the fiscal period end. getMonth() is 0-based, so
      // floor(month/3)+1 — the old ceil(month/3) gave "Q0" for January and
      // mislabeled Apr/Jul/Oct period-ends one quarter early.
      const fiscalDate = fiscal ? new Date(fiscal) : null;
      const quarter   = fiscalDate && !isNaN(fiscalDate.getTime())
        ? `Q${Math.floor(fiscalDate.getUTCMonth() / 3) + 1} ${fiscalDate.getUTCFullYear()}`
        : "—";

      return {
        symbol,
        reportDate,
        daysUntil,
        fiscalQuarter: quarter,
        estimate: isNaN(estimate) ? null : estimate,
        source: "alphavantage",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchYahooEarnings(symbol: string): Promise<EarningsDate | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;

    // Yahoo sometimes exposes earningsTimestamp in meta
    const ts = meta?.earningsTimestamp ?? meta?.earningsTimestampStart;
    if (!ts || typeof ts !== "number") return null;

    const reportDate = new Date(ts * 1000).toISOString().split("T")[0];
    const daysUntil  = Math.round((ts * 1000 - Date.now()) / 86400000);

    return {
      symbol,
      reportDate,
      daysUntil,
      fiscalQuarter: "—",
      estimate: null,
      source: "yahoo",
    };
  } catch {
    return null;
  }
}

// POST: { symbols: string[] }
export async function POST(req: NextRequest) {
  try {
    const { symbols } = await req.json();
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: "symbols array required" }, { status: 400 });
    }

    const results: Record<string, EarningsDate | null> = {};

    for (const sym of symbols) {
      // Try Alpha Vantage first, fall back to Yahoo
      let date = await fetchAlphaVantage(sym);
      if (!date) date = await fetchYahooEarnings(sym);
      results[sym] = date;
      // Small delay to respect AV rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// GET: ?symbol=AAPL
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  let date = await fetchAlphaVantage(symbol);
  if (!date) date = await fetchYahooEarnings(symbol);
  return NextResponse.json(date ?? { symbol, reportDate: null, daysUntil: null });
}
