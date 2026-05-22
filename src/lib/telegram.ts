import { StockAnalysisResult } from "@/types";
import { supertrend } from "@/lib/indicators";

const TELEGRAM_API = "https://api.telegram.org";

export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: "env vars not set" };

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const desc = typeof body?.description === "string" ? body.description : `HTTP ${res.status}`;
    return { ok: false, error: desc };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function fmtPrice(price: number, exchange: string): string {
  if (price <= 0) return "—";
  if (exchange === "HK") return price.toFixed(2);
  return price.toFixed(2);
}

function fmtChg(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function fmtRegime(regime: string): string {
  return regime.replace(/_/g, " ");
}

// Returns flipType and barsSince for a stock based on its cached chart data.
function detectFlip(r: StockAnalysisResult): { flipType: "BULLISH" | "BEARISH" | null; barsSince: number } {
  const bars = r.chart_bars;
  if (!bars || bars.length < 2) return { flipType: null, barsSince: 999 };
  const atr = r.st_opt_params?.atrPeriod ?? 10;
  const mul = r.st_opt_params?.multiplier ?? 3.0;
  const [, dir] = supertrend(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atr, mul);
  if (dir.length < 2) return { flipType: null, barsSince: 999 };
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      const barsSince = dir.length - 1 - i;
      return { flipType: dir[i] === 1 ? "BULLISH" : "BEARISH", barsSince };
    }
  }
  return { flipType: null, barsSince: 999 };
}

export function buildTelegramMessage(results: StockAnalysisResult[]): string {
  const valid = results.filter(r => r.signal !== "ERROR" && !r.error);
  if (valid.length === 0) return "📊 TA Report — no valid results.";

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    timeZone: "Asia/Hong_Kong",
  });

  const buys    = valid.filter(r => r.signal === "BUY");
  const sells   = valid.filter(r => r.signal === "SELL" || r.signal === "STRONG_SELL");
  const holds   = valid.filter(r => r.signal === "HOLD");
  const avgScore = (valid.reduce((s, r) => s + r.score, 0) / valid.length).toFixed(1);

  // ST flips within the last 1 bar (today)
  const todayFlips = valid
    .map(r => ({ r, ...detectFlip(r) }))
    .filter(x => x.flipType !== null && x.barsSince <= 1);

  const fmtRow = (r: StockAnalysisResult) =>
    `  • <b>${r.symbol}</b>  ${r.score.toFixed(1)}/10 | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)} | ${fmtRegime(r.regime)}`;

  const lines: string[] = [`📊 <b>TA Report — ${now}</b>`];

  // ST flip alerts are highest priority — show first
  if (todayFlips.length > 0) {
    lines.push(`\n⚡ <b>ST FLIPS TODAY</b>`);
    todayFlips.forEach(({ r, flipType, barsSince }) => {
      const when = barsSince === 0 ? "TODAY" : "yesterday";
      const icon = flipType === "BULLISH" ? "📈" : "📉";
      lines.push(`  • <b>${r.symbol}</b>: ${flipType} ${icon} (${when}) | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)}`);
    });
  }

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

  const stBullish = valid.filter(r => r.st_direction === 1).map(r => r.symbol);
  const stBearish = valid.filter(r => r.st_direction === -1).map(r => r.symbol);
  if (stBullish.length > 0) lines.push(`\n📈 <b>ST ↑ Bullish</b>: ${stBullish.join(", ")}`);
  if (stBearish.length > 0) lines.push(`📉 <b>ST ↓ Bearish</b>: ${stBearish.join(", ")}`);

  lines.push(`\n<i>Avg Score ${avgScore}/10 · ${valid.length} stocks · HKT ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })}</i>`);

  return lines.join("\n");
}
