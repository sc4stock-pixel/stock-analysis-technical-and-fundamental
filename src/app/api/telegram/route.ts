import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage, buildTelegramMessage } from "@/lib/telegram";
import { StockAnalysisResult } from "@/types";

export const dynamic = "force-dynamic";

// GET /api/telegram — sends a test ping to verify bot + chat ID are working
export async function GET() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" },
      { status: 503 }
    );
  }
  const result = await sendTelegramMessage("✅ <b>TA Dashboard connected</b>\nTelegram notifications are working.");
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" },
      { status: 503 }
    );
  }

  try {
    const body                           = await req.json();
    const results: StockAnalysisResult[] = body.results ?? [];
    if (results.length === 0) {
      return NextResponse.json({ ok: false, error: "no results" }, { status: 400 });
    }

    const message = buildTelegramMessage(results);
    const result  = await sendTelegramMessage(message);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
