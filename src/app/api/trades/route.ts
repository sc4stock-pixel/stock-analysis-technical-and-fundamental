import { NextResponse } from "next/server";
import type { TradeLogRecord } from "@/types/trade-log";

export const dynamic = "force-dynamic";

// Reader NaN guardrail (CLAUDE.md): bare NaN parses in Python json but throws
// in JS JSON.parse. Strip to null before parsing.
function parseTradeLog(raw: string): TradeLogRecord[] {
  const safe = raw.replace(/\bNaN\b/g, "null").replace(/-?Infinity\b/g, "null");
  return JSON.parse(safe) as TradeLogRecord[];
}

export async function GET() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return NextResponse.json({ error: "KV not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(`${kvUrl}/get/trade_log`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `KV error ${res.status}` }, { status: 502 });
    }
    const { result } = (await res.json()) as { result: string | null };
    if (!result) return NextResponse.json([]);
    return NextResponse.json(parseTradeLog(result));
  } catch (e) {
    console.error("[/api/trades]", e);
    return NextResponse.json({ error: "Failed to read trade_log" }, { status: 500 });
  }
}
