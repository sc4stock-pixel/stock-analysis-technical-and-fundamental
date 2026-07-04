import { NextRequest, NextResponse } from "next/server";
import { parseFillCommand, selectFillTarget, applyFill, stripNaN, isFillable } from "@/lib/fill-command";
import { slippageLabel } from "@/lib/slippage";
import type { TradeLogRecord } from "@/types/trade-log";

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

    const paramsJson: { stocks?: Record<string, { atr_period: number; multiplier: number; sharpe: number; num_trades: number; last_optimized?: string }> } & Record<string, unknown> = await paramsRes.json();
    const portfolio: { portfolio: { symbol: string; name: string; exchange: string }[] } = await portfolioRes.json();

    const stocksMap = paramsJson.stocks ?? (paramsJson as Record<string, unknown>);
    const entry = stocksMap[sym] as { atr_period: number; multiplier: number; sharpe: number; num_trades: number; last_optimized?: string } | undefined;
    const stock = portfolio.portfolio.find(s => s.symbol.toUpperCase() === sym);
    const name  = stock?.name ?? sym;
    const exch  = stock?.exchange ?? "—";

    if (!entry) {
      await replyTo(token, chatId,
        `❓ <b>${sym}</b> not found in ST params cache.\nRun "Optimize ST" to add it, or check the ticker spelling.`
      );
      return;
    }

    const optimizedOn = entry.last_optimized?.slice(0, 10)
      ?? (typeof paramsJson.last_optimized === "string" ? paramsJson.last_optimized.slice(0, 10) : "unknown");

    const lines = [
      `📊 <b>${sym}</b> — ${name} (${exch})`,
      ``,
      `<b>ST Params (cached)</b>`,
      `  ATR Period : ${entry.atr_period}`,
      `  Multiplier : ${entry.multiplier}`,
      `  Sharpe     : ${entry.sharpe.toFixed(2)}`,
      `  Trades     : ${entry.num_trades}`,
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

async function readTradeLog(kvUrl: string, kvToken: string): Promise<TradeLogRecord[]> {
  const res = await fetch(`${kvUrl}/get/trade_log`, {
    headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV get ${res.status}`);
  const { result } = (await res.json()) as { result: string | null };
  return result ? (JSON.parse(stripNaN(result)) as TradeLogRecord[]) : [];
}

async function writeTradeLog(kvUrl: string, kvToken: string, log: TradeLogRecord[]): Promise<void> {
  const body = JSON.stringify(log);
  if (/\bNaN\b|Infinity/.test(body)) throw new Error("refusing to write non-finite to trade_log");
  const res = await fetch(`${kvUrl}/set/trade_log`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`KV set ${res.status}`);
}

function todayHKT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function handleFill(token: string, chatId: number, text: string): Promise<void> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) { await replyTo(token, chatId, "KV not configured."); return; }

  const cmd = parseFillCommand(text);
  if (cmd.mode === "error") {
    const msg = cmd.reason === "price" ? "Invalid price."
      : cmd.reason === "date" ? "Invalid date (use YYYY-MM-DD)."
      : "Usage: <code>/fill TICKER PRICE [YYYY-MM-DD]</code>";
    await replyTo(token, chatId, msg); return;
  }

  try {
    const log = await readTradeLog(kvUrl, kvToken);

    if (cmd.mode === "list") {
      const fillable = log.filter(isFillable);
      const provisional = log.filter((r) => r.actual_fill_price == null && !r.confirmed);
      if (fillable.length === 0 && provisional.length === 0) {
        await replyTo(token, chatId, "No unfilled records."); return;
      }
      const out: string[] = [];
      if (fillable.length) {
        out.push("<b>Fillable records</b>");
        fillable.forEach((r, i) =>
          out.push(`${i + 1}. <code>${r.id.replace(/\.HK/g, "")}</code> @ ${r.signal_price}`));
        out.push("", "Reply: <code>/fill TICKER PRICE [date]</code>");
      }
      if (provisional.length) {
        if (out.length) out.push("");
        out.push("⏳ <b>Provisional — not fillable</b> (unconfirmed intraday flips)");
        provisional.forEach((r) =>
          out.push(`• <code>${r.id.replace(/\.HK/g, "")}</code> @ ${r.signal_price}`));
      }
      await replyTo(token, chatId, out.join("\n"));
      return;
    }

    const target = selectFillTarget(log, cmd.selector);
    if (target.kind === "none") {
      await replyTo(token, chatId, "No matching unfilled record. Try <code>/fill</code> to list.");
      return;
    }
    if (target.kind === "provisional") {
      await replyTo(token, chatId,
        `⏳ <code>${target.id.replace(/\.HK/g, "")}</code> is a provisional (unconfirmed intraday) flip — not fillable. It may never have executed.`);
      return;
    }
    if (target.kind === "not_entry_ready") {
      await replyTo(token, chatId,
        `🚫 <code>${target.id.replace(/\.HK/g, "")}</code> is a raw ST flip below SMA50 — the strategy never entered (no SMA50 gate pass), so there is nothing to fill.`);
      return;
    }
    if (target.kind === "ambiguous") {
      const lines = target.ids.map((id) => `<code>${id.replace(/\.HK/g, "")}</code>`);
      await replyTo(token, chatId, ["Multiple unfilled records — specify the id:", ...lines].join("\n"));
      return;
    }

    const date = cmd.date ?? todayHKT();
    const updated = applyFill(log, target.id, cmd.price, date);
    await writeTradeLog(kvUrl, kvToken, updated);

    const rec = updated.find((r) => r.id === target.id)!;
    const label = slippageLabel(rec);
    await replyTo(token, chatId, [
      `Filled <b>${rec.ticker.replace(/\.HK/g, "")}</b> ${rec.type}`,
      `signal ${rec.signal_price} → fill ${rec.actual_fill_price} (${date})`,
      `slippage: ${label}`,
    ].join("\n"));
  } catch (e) {
    await replyTo(token, chatId, `⚠️ Error: ${String(e)}`);
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
  } else if (cmd === "/fill") {
    const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!adminId || String(chatId) !== adminId) {
      await replyTo(token, chatId, "⛔ Not authorized.").catch(() => {});
    } else {
      await handleFill(token, chatId, text).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
