import { StockAnalysisResult, SepaMetadata, TrendTemplateCriteria } from "@/types";
import { holidayStatus } from "@/lib/telegram-report";
import { buildAlertModel, clientFlip } from "@/lib/alert-model";

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

/** Display symbol: strip ".HK" so Telegram doesn't auto-linkify e.g. "0700.HK" as a URL. */
function dispSym(symbol: string): string {
  return symbol.replace(".HK", "");
}

/** Compact regime code so each alert row fits one phone line (monospace <pre>). */
function regimeAbbr(regime: string): string {
  const r = regime.toUpperCase().replace(/_/g, " ");
  const hv = r.includes("HIGH VOL") ? "HV-" : "";
  let core: string;
  if (r.includes("WEAK") && r.includes("STRENGTHEN")) core = "WK→STR";
  else if (r.includes("STRENGTHENING"))               core = "STR'ng";
  else if (r.includes("EXHAUST"))                     core = "EXH↑";
  else if (r.includes("STRONG UPTREND"))              core = "STR↑";
  else if (r.includes("WEAK UPTREND"))                core = "WK↑";
  else if (r.includes("UPTREND"))                     core = "UP↑";
  else if (r.includes("DOWNTREND"))                   core = "DN↓";
  else if (r.includes("RANGING") || r.includes("RANGE")) core = "RNG";
  else core = r.slice(0, 6);
  return hv + core;
}

/** Wrap monospace rows in a full-width <pre> block; htmlEscape so literal `>`/`<`
 *  (e.g. TT fails "150>200") don't break Telegram's HTML parser inside <pre>. */
function preBlock(rows: string[]): string {
  return `<pre>${htmlEscape(rows.join("\n"))}</pre>`;
}

type ResultWithFlip = StockAnalysisResult & {
  _flip?: {
    flipType:    "BULLISH" | "BEARISH" | null;
    barsSince:   number;
    stopAtFlip:  number | null;   // prev-bar ST stop (the level that was breached)
    closeAtFlip: number | null;   // close on the actual flip bar
  };
};

// Flip detection is single-sourced in alert-model.ts (clientFlip) — it honors a
// precomputed _flip when chart_bars was stripped, identical to the old local helper.

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
    .map(r => ({ r, ...clientFlip(r) }))
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
  // Monospace rows (no <b>; escaping done by preBlock). .HK stripped throughout.
  const fmtBuyRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(7);
    const chg = fmtChg(r.change_pct).padStart(6);
    return `${sym} ${sc} ${px} ${chg} ${regimeAbbr(r.regime)}`;
  };

  const fmtTacticalRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(7);
    const chg = fmtChg(r.change_pct).padStart(6);
    const tt  = ttFor(r);
    const ttTag = tt ? `TT${tt.criteria_met}/7 ✗${listTtFailures(tt)}` : "TT—";
    return `${sym} ${sc} ${px} ${chg} ${ttTag}`;
  };

  const fmtStrippedRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(7);
    const tt  = ttFor(r);
    const ttTag = tt ? `TT${tt.criteria_met}/7 ✗${listTtFailures(tt)}` : "TT—";
    return `${sym} ${px} ${ttTag}`;
  };

  const fmtEmergingRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const chg = fmtChg(r.change_pct).padStart(6);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(7);
    const tt  = ttFor(r);
    const ttStr = tt ? `TT${tt.criteria_met}/7` : "TT—";
    return `${sym} ${chg} ${px} ${ttStr}`;
  };

  // Watchlist: HK first then US, inline 3-per-line, " · " separator, .HK stripped, no flag
  const fmtWatchlistLines = (stocks: ResultWithSepa[], perLine = 3): string[] => {
    const hk = stocks.filter(r => r.exchange === "HK");
    const us = stocks.filter(r => r.exchange !== "HK");
    const lines: string[] = [];
    for (const group of [hk, us]) {
      for (let i = 0; i < group.length; i += perLine) {
        const chunk = group.slice(i, i + perLine);
        const parts = chunk.map(r => `${htmlEscape(dispSym(r.symbol))} ${fmtChg(r.change_pct)}`);
        lines.push(`  ${parts.join(" · ")}`);
      }
    }
    return lines;
  };

  // Act-on-this — client-stance (Engine A has no worker events → pass []).
  const actRows = buildAlertModel([], {}, valid as unknown as StockAnalysisResult[]).actOnThis;
  let actBlock = "";
  if (actRows.length > 0) {
    const rows = actRows.map(r => {
      const sym = dispSym(r.symbol).padEnd(6);
      const tag = r.stance === "out" ? "OUT" : "LONG";
      const when = r.barsSince === 0 ? "today" : `${r.barsSince}d`;
      const tt = r.ttFlag ? ` ${r.ttFlag.replace("→", "->")}` : "";  // defensive; ttFlag is empty on this surface
      return `${sym} ${r.change}${tt} (${when}) [${tag}]`;
    });
    actBlock = `\n⚡ <b>ACT ON THIS</b>\n${preBlock(rows)}`;
  }

  // ---------- Compose message ----------
  const lines: string[] = [headerLine, dataState];
  if (actBlock) lines.push(actBlock);

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
      lines.push(`  • 🛑 <b>${htmlEscape(dispSym(r.symbol))}</b>: ST FLIP → 📉 BEARISH (${when})`);
      lines.push(`    ${detail}`);
    });
  }

  // Buy/hold tiers — each rendered as a full-width monospace <pre> table
  if (freshBuys.length > 0) {
    lines.push(`\n🟢 <b>CONFLUENCE BUYS (${freshBuys.length})</b> <i>ST↑ BUY TT7/7</i>`);
    lines.push(preBlock(freshBuys.map(fmtBuyRow)));
  }

  if (tacticals.length > 0) {
    lines.push(`\n🟢 <b>TACTICAL BUYS (${tacticals.length})</b> <i>ST↑ BUY TT≥5/7</i>`);
    lines.push(preBlock(tacticals.map(fmtTacticalRow)));
  }

  if (holdsTier.length > 0) {
    lines.push(`\n🔵 <b>CONFLUENCE HOLDS (${holdsTier.length})</b> <i>ST↑ HOLD TT7/7</i>`);
    lines.push(preBlock(holdsTier.map(fmtBuyRow)));
  }

  if (emerging.length > 0) {
    lines.push(`\n🚀 <b>EMERGING UPTRENDS (${emerging.length})</b> <i>fresh ST↑ flip, TT&lt;5</i>`);
    lines.push(preBlock(emerging.map(fmtEmergingRow)));
  }

  if (stripped.length > 0) {
    lines.push(`\n⚠️ <b>STRIPPED FROM BUYS (${stripped.length})</b> <i>structural fail, TT&lt;5</i>`);
    lines.push(preBlock(stripped.map(fmtStrippedRow)));
  }

  // PASSIVE WATCHLIST — ST↓ (inline, not a table)
  if (watchlist.length > 0) {
    lines.push(`\n⚪ <b>WATCHLIST ST↓ (${watchlist.length})</b>`);
    lines.push(...fmtWatchlistLines(watchlist, 3));
  }

  // Footer
  lines.push(`\n📊 <i>Avg ${avgScore}/10 · ${valid.length} assets · HKT ${timeStr}</i>`);

  return lines.join("\n");
}
