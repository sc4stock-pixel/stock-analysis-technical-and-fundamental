import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TELEGRAM_API = "https://api.telegram.org";
const GITHUB_RAW   = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main";

async function replyTo(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function handleCheck(token: string, chatId: number, ticker: string): Promise<void> {
  if (!ticker) {
    await replyTo(token, chatId, "Usage: <code>/check SYMBOL</code>\nExample: <code>/check 0175.HK</code>");
    return;
  }
  const sym = ticker.toUpperCase().trim();

  try {
    const [paramsRes, portfolioRes] = await Promise.all([
      fetch(`${GITHUB_RAW}/st_params.json`),
      fetch(`${GITHUB_RAW}/portfolio.json`),
    ]);
    if (!paramsRes.ok) throw new Error(`st_params.json fetch failed: ${paramsRes.status}`);
    if (!portfolioRes.ok) throw new Error(`portfolio.json fetch failed: ${portfolioRes.status}`);

    const params:    Record<string, { atrPeriod: number; multiplier: number; sharpe: number; numTrades: number; last_optimized?: string }> = await paramsRes.json();
    const portfolio: { portfolio: { symbol: string; name: string; exchange: string }[] } = await portfolioRes.json();

    const entry = params[sym];
    const stock = portfolio.portfolio.find(s => s.symbol.toUpperCase() === sym);
    const name  = stock?.name ?? sym;
    const exch  = stock?.exchange ?? "—";

    if (!entry) {
      await replyTo(token, chatId,
        `❓ <b>${sym}</b> not found in ST params cache.\nRun "Optimize ST" to add it, or check the ticker spelling.`
      );
      return;
    }

    const optimizedOn = entry.last_optimized ? entry.last_optimized.slice(0, 10) : "unknown";

    const lines = [
      `📊 <b>${sym}</b> — ${name} (${exch})`,
      ``,
      `<b>ST Params (cached)</b>`,
      `  ATR Period : ${entry.atrPeriod}`,
      `  Multiplier : ${entry.multiplier}`,
      `  Sharpe     : ${entry.sharpe.toFixed(2)}`,
      `  Trades     : ${entry.numTrades}`,
      `  Optimized  : ${optimizedOn}`,
      ``,
      `<i>Shallow check — params only. Run analysis on dashboard for live ST direction &amp; score.</i>`,
    ];
    await replyTo(token, chatId, lines.join("\n"));
  } catch (e) {
    await replyTo(token, chatId, `⚠️ Error fetching data: ${String(e)}`);
  }
}

async function handlePortfolio(token: string, chatId: number): Promise<void> {
  try {
    const res = await fetch(`${GITHUB_RAW}/portfolio.json`);
    if (!res.ok) throw new Error(`portfolio.json fetch failed: ${res.status}`);

    const data: { portfolio: { symbol: string; name: string; exchange: string }[] } = await res.json();
    const stocks = data.portfolio;

    if (stocks.length === 0) {
      await replyTo(token, chatId, "📋 Portfolio is empty.");
      return;
    }

    const hk = stocks.filter(s => s.exchange === "HK");
    const us = stocks.filter(s => s.exchange === "US");

    const lines = [`📋 <b>Portfolio (${stocks.length} stocks)</b>`, ""];
    if (hk.length > 0) {
      lines.push(`🇭🇰 <b>HK (${hk.length})</b>`);
      hk.forEach(s => lines.push(`  • ${s.symbol} — ${s.name}`));
    }
    if (us.length > 0) {
      if (hk.length > 0) lines.push("");
      lines.push(`🇺🇸 <b>US (${us.length})</b>`);
      us.forEach(s => lines.push(`  • ${s.symbol} — ${s.name}`));
    }
    lines.push("", `<i>For live analysis, open the dashboard.</i>`);

    await replyTo(token, chatId, lines.join("\n"));
  } catch (e) {
    await replyTo(token, chatId, `⚠️ Error fetching portfolio: ${String(e)}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Validate Telegram webhook secret
  const secret         = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "bot token not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Extract message from the Telegram update object
  const message = body.message as { text?: string; chat?: { id: number } } | undefined;
  const text    = message?.text ?? "";
  const chatId  = message?.chat?.id;

  // Acknowledge immediately — Telegram re-delivers if no 200 within 5s
  if (!chatId) return NextResponse.json({ ok: true });

  // Parse command — strip @botname suffix Telegram adds in group chats
  const [rawCmd, ...argParts] = text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  // Await handlers — fire-and-forget is cut off by Vercel's serverless execution model
  if (cmd === "/check") {
    const ticker = argParts.join("").toUpperCase();
    await handleCheck(token, chatId, ticker).catch(() => {});
  } else if (cmd === "/portfolio") {
    await handlePortfolio(token, chatId).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
