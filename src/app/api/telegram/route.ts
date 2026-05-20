import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage, buildTelegramMessage } from "@/lib/telegram";
import { StockAnalysisResult } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" },
      { status: 503 }
    );
  }

  try {
    const body                       = await req.json();
    const results: StockAnalysisResult[] = body.results ?? [];
    if (results.length === 0) {
      return NextResponse.json({ ok: false, error: "no results" }, { status: 400 });
    }

    const message = buildTelegramMessage(results);
    const ok      = await sendTelegramMessage(message);
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
