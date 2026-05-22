import { StockAnalysisResult, SepaMetadata } from "@/types";
import { supertrend } from "@/lib/indicators";

const TELEGRAM_API = "https://api.telegram.org";

/** Escapes HTML special chars in dynamic string content for HTML parse_mode messages. */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Resolves the Telegram chat_id for a given logical channel.
 *  Falls back to TELEGRAM_CHAT_ID if the segmented var is not set (backwards compat). */
function resolveChatId(channel: "alerts" | "reports"): string {
  if (channel === "reports") {
    return process.env.TELEGRAM_CHAT_ID_REPORTS ?? process.env.TELEGRAM_CHAT_ID ?? "";
  }
  return process.env.TELEGRAM_CHAT_ID_ALERTS ?? process.env.TELEGRAM_CHAT_ID ?? "";
}

export async function sendTelegramMessage(
  text: string,
  channel: "alerts" | "reports" = "alerts",
): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = resolveChatId(channel);
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

type ResultWithFlip = StockAnalysisResult & {
  _flip?: { flipType: "BULLISH" | "BEARISH" | null; barsSince: number };
};

// Returns flipType and barsSince — uses precomputed _flip if chart_bars was stripped.
function detectFlip(r: ResultWithFlip): { flipType: "BULLISH" | "BEARISH" | null; barsSince: number } {
  if (r._flip) return r._flip;
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

export function buildTelegramMessage(results: ResultWithFlip[]): string {
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
    `  • <b>${htmlEscape(r.symbol)}</b>  ${r.score.toFixed(1)}/10 | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)} | ${htmlEscape(fmtRegime(r.regime))}`;

  // Exit signals: bearish flip within 2 bars — strategy says close any long
  const exitSignals = todayFlips.filter(x => x.flipType === "BEARISH");
  // Non-exit flips (bullish flips)
  const otherFlips  = todayFlips.filter(x => x.flipType !== "BEARISH");

  const lines: string[] = [`📊 <b>TA Report — ${now}</b>`];

  if (exitSignals.length > 0) {
    lines.push(`\n🚨 <b>EXIT SIGNAL${exitSignals.length > 1 ? "S" : ""} (${exitSignals.length})</b>`);
    exitSignals.forEach(({ r, barsSince }) => {
      const when = barsSince === 0 ? "TODAY" : "yesterday";
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b>: ST → BEARISH (${when}) — close long if open | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)}`);
    });
  }

  if (otherFlips.length > 0) {
    lines.push(`\n⚡ <b>ST FLIPS</b>`);
    otherFlips.forEach(({ r, flipType, barsSince }) => {
      const when = barsSince === 0 ? "TODAY" : "yesterday";
      const icon = flipType === "BULLISH" ? "📈" : "📉";
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b>: ${flipType} ${icon} (${when}) | ${fmtPrice(r.current_price, r.exchange)} ${fmtChg(r.change_pct)}`);
    });
  }

  // Trend Template warnings: ST bullish but failing Minervini criteria
  type ResultWithSepa = ResultWithFlip & { sepa_metadata?: SepaMetadata };
  const ttWarnings = (valid as ResultWithSepa[]).filter(r => {
    if (r.st_direction !== 1) return false;                          // only ST bullish
    const tt = r.sepa_metadata?.trend_template_criteria;
    if (!tt) return r.sepa_metadata?.trend_template === false;       // fallback: old boolean
    return !tt.passes;                                               // new: fails < 5/7
  });

  if (ttWarnings.length > 0) {
    lines.push(`\n⚠️ <b>TREND TEMPLATE WARNINGS</b> (ST ↑ but structure weak)`);
    ttWarnings.forEach(r => {
      const tt = (r as ResultWithSepa).sepa_metadata?.trend_template_criteria;
      const score    = tt ? `${tt.criteria_met}/7` : "fail";
      const failList = tt ? [
        !tt.c1_price_above_sma150    ? "SMA150" : "",
        !tt.c2_price_above_sma200    ? "SMA200" : "",
        !tt.c3_sma150_above_sma200   ? "SMA150&gt;200" : "",
        !tt.c4_sma200_trending_up    ? "SMA200↓" : "",
        !tt.c5_price_above_sma50     ? "SMA50" : "",
        !tt.c6_above_25pct_of_low52  ? "52wkLow" : "",
        !tt.c7_within_25pct_of_high52 ? "52wkHigh" : "",
      ].filter(Boolean).join(", ") : "criteria not met";
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b>: TT ${score} — fails: ${failList} | ${fmtPrice(r.current_price, r.exchange)}`);
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
    lines.push(`\n⚪ <b>HOLD (${holds.length})</b>: ${holds.map(r => htmlEscape(r.symbol)).join(", ")}`);
  }

  const stBullish = valid.filter(r => r.st_direction === 1).map(r => htmlEscape(r.symbol));
  const stBearish = valid.filter(r => r.st_direction === -1).map(r => htmlEscape(r.symbol));
  if (stBullish.length > 0) lines.push(`\n📈 <b>ST ↑ Bullish</b>: ${stBullish.join(", ")}`);
  if (stBearish.length > 0) lines.push(`📉 <b>ST ↓ Bearish</b>: ${stBearish.join(", ")}`);

  lines.push(`\n<i>Avg Score ${avgScore}/10 · ${valid.length} stocks · HKT ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })}</i>`);

  return lines.join("\n");
}
