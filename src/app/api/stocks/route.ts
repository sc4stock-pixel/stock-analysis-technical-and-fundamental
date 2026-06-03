// src/app/api/stocks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { AppConfig } from "@/types";
import { analyzeStock } from "@/lib/analyze-stock";

export const maxDuration = 30;
// Force dynamic rendering — never cache the API response
// This ensures config changes always trigger a full recompute
export const dynamic = "force-dynamic";

// ─── POST handler ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body   = await req.json().catch(() => ({}));
    const config: AppConfig = body.config ?? DEFAULT_CONFIG;

    if (body.symbol) {
      const stock = config.stocks.PORTFOLIO.find((s) => s.symbol === body.symbol)
        ?? { symbol: body.symbol, name: body.symbol, exchange: "US" };
      const result = await analyzeStock(stock, config);
      return NextResponse.json(result);
    }

    const portfolio = config.stocks.PORTFOLIO;
    const results = [];
    for (const stock of portfolio) {
      results.push(await analyzeStock(stock, config));
    }
    return NextResponse.json({ results, timestamp: new Date().toISOString(), config });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── GET handler ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const stock = DEFAULT_CONFIG.stocks.PORTFOLIO.find((s) => s.symbol === symbol)
    ?? { symbol, name: symbol, exchange: "US" };
  const result = await analyzeStock(stock, DEFAULT_CONFIG);
  return NextResponse.json(result);
}
