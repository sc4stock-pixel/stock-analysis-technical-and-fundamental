import { StockAnalysisResult } from "@/types";

const TELEGRAM_API = "https://api.telegram.org";

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fmtPrice(price: number, exchange: string): string {
  if (price <= 0) return "—";
  if (exchange === "HK") return price.toFixed(2);
  return price < 10 ? price.toFixed(2) : price.toFixed(2);
}

function fmtChg(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function fmtRegime(regime: string): string {
  return regime.replace(/_/g, " ");
}

export function buildTelegramMessage(results: StockAnalysisResult[]): string {
  const valid = results.filter(r => r.signal !== "ERROR" && !r.error);
  if (valid.length === 0) return "📊 TA Report — no valid results.";

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    timeZone: "Asia/Hong_Kong",
  });

  const buys       = valid.filter(r => r.signal === "BUY");
  const sells      = valid.filter(r => r.signal === "SELL" || r.signal === "STRONG_SELL");
  const holds      = valid.filter(r => r.signal === "HOLD");
  const stBullish  = valid.filter(r => r.st_direction === 1).map(r => r.symbol);
  const stBearish  = valid.filter(r => r.st_direction === -1).map(r => r.symbol);
  const avgScore   = (valid.reduce((s, r) => s + r.score, 0) / valid.length).toFixed(1);

  const fmtRow = (r: StockAnalysisResult) =>
    `  • <b>${r.symbol}</b>  ${r.score.toFixed(1)}/10 | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)} | ${fmtRegime(r.regime)}`;

  const lines: string[] = [`📊 <b>TA Report — ${now}</b>`];

  if (buys.length > 0) {
    lines.push(`\n🟢 <b>BUY (${buys.length})</b>`);
    buys.forEach(r => lines.push(fmtRow(r)));
  }

  if (sells.length > 0) {
    lines.push(`\n🔴 <b>SELL (${sells.length})</b>`);
    sells.forEach(r => lines.push(fmtRow(r)));
  }

  if (holds.length > 0) {
    lines.push(`\n⚪ <b>HOLD (${holds.length})</b>: ${holds.map(r => r.symbol).join(", ")}`);
  }

  if (stBullish.length > 0)
    lines.push(`\n📈 <b>ST ↑ Bullish</b>: ${stBullish.join(", ")}`);
  if (stBearish.length > 0)
    lines.push(`📉 <b>ST ↓ Bearish</b>: ${stBearish.join(", ")}`);

  lines.push(`\n<i>Avg Score ${avgScore}/10 · ${valid.length} stocks · HKT ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })}</i>`);

  return lines.join("\n");
}
