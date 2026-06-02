import { StockAnalysisResult, SepaMetadata, TrendTemplateCriteria } from "@/types";
import { supertrend } from "@/lib/indicators";
import { holidayStatus } from "@/lib/telegram-report";

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
  _flip?: {
    flipType:    "BULLISH" | "BEARISH" | null;
    barsSince:   number;
    stopAtFlip:  number | null;   // prev-bar ST stop (the level that was breached)
    closeAtFlip: number | null;   // close on the actual flip bar
  };
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

// ---------- Trend Template failure labels (the 7 real Minervini criteria) ----------
// Display labels use ">" which is HTML-unsafe; entire fails-list string is htmlEscape'd
// before insertion so Telegram renders `>` as plain text.
const TT_FAIL_LABELS: Array<{ key: keyof TrendTemplateCriteria; label: string }> = [
  { key: "c1_price_above_sma150",     label: "Price>150SMA"   },
  { key: "c2_price_above_sma200",     label: "Price>200SMA"   },
  { key: "c3_sma150_above_sma200",    label: "150>200"        },
  { key: "c4_sma200_trending_up",     label: "200SMA↓"        },
  { key: "c5_price_above_sma50",      label: "Price>50SMA"    },
  { key: "c6_above_25pct_of_low52",   label: "52wLow+25%"     },
  { key: "c7_within_25pct_of_high52", label: "52wHigh-25%"    },
];

function listTtFailures(tt: TrendTemplateCriteria): string {
  return TT_FAIL_LABELS
    .filter(({ key }) => tt[key] === false)
    .map(({ label }) => label)
    .join(", ");
}

function flagFor(exchange: string): string {
  return exchange === "HK" ? "🇭🇰" : "🇺🇸";
}

type ResultWithSepa = ResultWithFlip & { sepa_metadata?: SepaMetadata };

// ============================================================
// Main: buildTelegramMessage — execution alerts to ALERTS channel
// ============================================================
export function buildTelegramMessage(
  results: ResultWithFlip[],
  source: "manual" | "cron" | "intraday" = "manual",
): string {
  const valid = (results as ResultWithSepa[]).filter(r => r.signal !== "ERROR" && !r.error);
  if (valid.length === 0) return "📊 TA Report — no valid results.";

  // Header — branded by trigger source
  const headerLine =
    source === "cron"     ? "📅 <b>Daily Market Brief (Scheduled Scan)</b>"
    : source === "intraday" ? "⚡ <b>HK Intraday Flip Alert</b> <i>(provisional — based on the in-progress bar)</i>"
    : "⚡ <b>TA Execution Alert (On-Demand Scan)</b>";

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    timeZone: "Asia/Hong_Kong",
  });
  const timeStr = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong",
  });

  // Data state — adds (Holiday Close) when today is a holiday
  const holiday = holidayStatus();
  const holidayTag = holiday ? ` (Holiday Close — ${htmlEscape(holiday.label)})` : "";
  const dataState = `📅 <i>Data State: ${dateStr}${holidayTag}</i>`;

  // ---------- ST flips (recent, ≤2 bars) ----------
  const todayFlips = valid
    .map(r => ({ r, ...detectFlip(r) }))
    .filter(x => x.flipType !== null && x.barsSince <= 2);

  // Actionable exits: bearish ST flips within 2 bars
  const exitSignals = todayFlips.filter(x => x.flipType === "BEARISH");

  // Symbols with a FRESH bullish ST flip/re-entry (≤2 bars) — used to separate
  // genuinely-deteriorating names from brand-new upside breakouts that are still
  // below their SMAs (low TT) only because the move just started.
  const freshBullishSyms = new Set(
    todayFlips.filter(x => x.flipType === "BULLISH").map(x => x.r.symbol),
  );

  // ---------- Tier classification ----------
  const ttFor = (r: ResultWithSepa): TrendTemplateCriteria | undefined =>
    r.sepa_metadata?.trend_template_criteria;

  const isFreshConfluence = (r: ResultWithSepa) =>
    r.signal === "BUY" && r.st_direction === 1 && (ttFor(r)?.criteria_met ?? 0) === 7;

  const isTacticalBuy = (r: ResultWithSepa) => {
    if (r.signal !== "BUY" || r.st_direction !== 1) return false;
    const met = ttFor(r)?.criteria_met ?? 0;
    return met >= 5 && met < 7;
  };

  const isConfluenceHold = (r: ResultWithSepa) =>
    r.signal === "HOLD" && r.st_direction === 1 && (ttFor(r)?.criteria_met ?? 0) === 7;

  // ST↑ but trend-template not yet confirmed (< 5/7)
  const isWeakStructure = (r: ResultWithSepa) =>
    r.st_direction === 1 && (ttFor(r)?.criteria_met ?? 7) < 5;
  // Emerging = weak structure BUT a fresh bullish flip → new breakout, not decay
  const isEmerging = (r: ResultWithSepa) =>
    isWeakStructure(r) && freshBullishSyms.has(r.symbol);
  // Stripped = weak structure WITHOUT a fresh flip → genuine deterioration
  const isStripped = (r: ResultWithSepa) =>
    isWeakStructure(r) && !freshBullishSyms.has(r.symbol);

  const isWatchlist = (r: ResultWithSepa) => r.st_direction !== 1;

  const freshBuys  = valid.filter(isFreshConfluence);
  const tacticals  = valid.filter(isTacticalBuy);
  const holdsTier  = valid.filter(isConfluenceHold);
  const emerging   = valid.filter(isEmerging);
  const stripped   = valid.filter(isStripped);
  const watchlist  = valid.filter(isWatchlist);

  const avgScore = (valid.reduce((s, r) => s + r.score, 0) / valid.length).toFixed(1);

  // ---------- Row renderers ----------
  const fmtBuyRow = (r: ResultWithSepa): string => {
    const sym = htmlEscape(r.symbol).padEnd(5);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange);
    const chg = fmtChg(r.change_pct);
    const reg = htmlEscape(fmtRegime(r.regime));
    return `  • <b>${sym}</b> ${sc}/10 | ${px} [${chg}] | ${reg}`;
  };

  const fmtTacticalRow = (r: ResultWithSepa): string => {
    const sym = htmlEscape(r.symbol).padEnd(5);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange);
    const chg = fmtChg(r.change_pct);
    const tt  = ttFor(r);
    const fails = tt ? listTtFailures(tt) : "";
    const ttTag = tt ? htmlEscape(`[TT: ${tt.criteria_met}/7 — Fails: ${fails}]`) : "";
    return `  • <b>${sym}</b> ${sc}/10 | ${px} [${chg}] | ${ttTag}`;
  };

  const fmtStrippedRow = (r: ResultWithSepa): string => {
    const flag = flagFor(r.exchange);
    const sym  = htmlEscape(r.symbol);
    const px   = fmtPrice(r.current_price, r.exchange);
    const tt   = ttFor(r);
    if (!tt) return `  • ${flag} <b>${sym}</b> [TT data missing] | ${px}`;
    const tag = htmlEscape(`[TT ${tt.criteria_met}/7 — Fails: ${listTtFailures(tt)}]`);
    return `  • ${flag} <b>${sym}</b> ${tag} | ${px}`;
  };

  const fmtEmergingRow = (r: ResultWithSepa): string => {
    const flag = flagFor(r.exchange);
    const sym  = htmlEscape(r.symbol);
    const px   = fmtPrice(r.current_price, r.exchange);
    const chg  = fmtChg(r.change_pct);
    const tt   = ttFor(r);
    const ttStr = tt ? `TT ${tt.criteria_met}/7` : "TT —";
    return `  • ${flag} <b>${sym}</b> [${chg}] | ${ttStr} forming | ${px}`;
  };

  // Watchlist: HK first then US, inline 3-per-line with " · " separator, % change in parens
  const fmtWatchlistLines = (stocks: ResultWithSepa[], perLine = 3): string[] => {
    const hk = stocks.filter(r => r.exchange === "HK");
    const us = stocks.filter(r => r.exchange !== "HK");
    const lines: string[] = [];
    for (const group of [hk, us]) {
      for (let i = 0; i < group.length; i += perLine) {
        const chunk = group.slice(i, i + perLine);
        const flag  = flagFor(chunk[0].exchange);
        const parts = chunk.map(r => `<b>${htmlEscape(r.symbol)}</b> (${fmtChg(r.change_pct)})`);
        lines.push(`  ${flag} ${parts.join(" · ")}`);
      }
    }
    return lines;
  };

  // ---------- Compose message ----------
  const lines: string[] = [headerLine, dataState];

  // ACTIONABLE EXITS — top priority
  if (exitSignals.length > 0) {
    lines.push(`\n🚨 <b>ACTIONABLE EXITS (${exitSignals.length})</b>`);
    exitSignals.forEach(({ r, barsSince }) => {
      const when = barsSince === 0 ? "TODAY" : `${barsSince} bar${barsSince > 1 ? "s" : ""} ago`;

      // Use the bullish stop from the bar BEFORE the flip (the level that was
      // actually breached), not r.st_value (which is the post-flip bearish line).
      const stop  = r._flip?.stopAtFlip  ?? null;
      const close = r._flip?.closeAtFlip ?? r.current_price;  // flip-bar close if available

      const stopStr = stop !== null && stop > 0 ? fmtPrice(stop, r.exchange) : "—";
      const closeStr = fmtPrice(close, r.exchange);

      // Violation = how far the flip-bar close fell below the prior bullish stop
      const violatedPct = stop !== null && stop > 0
        ? ((close - stop) / stop) * 100
        : null;
      const violatedStr = violatedPct !== null
        ? (violatedPct >= 0 ? `+${violatedPct.toFixed(1)}%` : `${violatedPct.toFixed(1)}%`)
        : "—";

      const detail = htmlEscape(`[ST Stop: ${stopStr} | Violated by ${violatedStr} | Close: ${closeStr}]`);
      lines.push(`  • 🛑 <b>${htmlEscape(r.symbol)}</b>: ST FLIP → 📉 BEARISH (${when})`);
      lines.push(`    ${detail}`);
    });
  }

  // FRESH CONFLUENCE BUYS — strict 7/7
  if (freshBuys.length > 0) {
    lines.push(`\n🟢 <b>CONFLUENCE BUYS (${freshBuys.length})</b> — ST↑ + BUY + TT 7/7`);
    freshBuys.forEach(r => lines.push(fmtBuyRow(r)));
  }

  // TACTICAL BUYS — 5-6/7
  if (tacticals.length > 0) {
    lines.push(`\n🟢 <b>TACTICAL BUYS (${tacticals.length})</b> — ST↑ + BUY + TT ≥5/7`);
    tacticals.forEach(r => lines.push(fmtTacticalRow(r)));
  }

  // CONFLUENCE HOLDS — HOLD signal but strict 7/7
  if (holdsTier.length > 0) {
    lines.push(`\n🔵 <b>CONFLUENCE HOLDS (${holdsTier.length})</b> — ST↑ + HOLD + TT 7/7`);
    holdsTier.forEach(r => lines.push(fmtBuyRow(r)));
  }

  // EMERGING UPTRENDS — fresh bullish ST flip/re-entry, structure still forming
  if (emerging.length > 0) {
    lines.push(`\n🚀 <b>EMERGING UPTRENDS (${emerging.length})</b> — fresh ST↑ flip, structure forming (TT &lt; 5/7)`);
    emerging.forEach(r => lines.push(fmtEmergingRow(r)));
  }

  // STRIPPED — ST↑ but <5/7 with no fresh flip (genuine deterioration)
  if (stripped.length > 0) {
    lines.push(`\n⚠️ <b>STRIPPED FROM BUYS (${stripped.length})</b> — Severe Structural Failures (TT &lt; 5/7)`);
    stripped.forEach(r => lines.push(fmtStrippedRow(r)));
  }

  // PASSIVE WATCHLIST — ST↓
  if (watchlist.length > 0) {
    lines.push(`\n⚪ <b>PASSIVE WATCHLIST (${watchlist.length})</b> — ST↓ (No Action)`);
    lines.push(...fmtWatchlistLines(watchlist, 3));
  }

  // Footer
  lines.push(`\n📊 <i>Portfolio Avg Score: ${avgScore}/10 · ${valid.length} Assets · HKT ${timeStr}</i>`);

  return lines.join("\n");
}
