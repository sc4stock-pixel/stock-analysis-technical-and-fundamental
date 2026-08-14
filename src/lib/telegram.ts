import { StockAnalysisResult, SepaMetadata, TrendTemplateCriteria } from "@/types";
import { holidayStatus } from "@/lib/telegram-report";
import { buildAlertModel, clientFlip } from "@/lib/alert-model";
import { buildReceipt } from "@/lib/reportReceipt";

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

const ttFor = (r: ResultWithSepa): TrendTemplateCriteria | undefined =>
  r.sepa_metadata?.trend_template_criteria;

// ============================================================
// Tier classification — exhaustive by construction
// ============================================================
/** The execution-alert tiers. `other` is the catch-all net: anything that matches no
 *  named tier still gets rendered, so a classification gap shows up in the message
 *  instead of silently shrinking it. */
export type Tier =
  | "freshBuy" | "tactical" | "hold" | "emerging" | "stripped" | "watchlist" | "other";

/** Assigns a result to exactly one tier (first match wins). Exported for the coverage test.
 *  `freshBullishSyms` = symbols with a bullish ST flip within 2 bars. */
export function tierOf(r: ResultWithSepa, freshBullishSyms: Set<string>): Tier {
  if (r.st_direction !== 1) return "watchlist";          // ST↓ — passive watchlist

  const met = ttFor(r)?.criteria_met;
  // No trend-template data at all: don't guess a structure score in either direction
  // (the old code defaulted to 0 in the buy tiers and 7 in the weak-structure test,
  // so these names matched nothing). Surface them instead.
  if (met === undefined) return "other";

  // ST↑ but structure unconfirmed (<5/7) — signal-agnostic, as before.
  if (met < 5) return freshBullishSyms.has(r.symbol) ? "emerging" : "stripped";

  // ST↑ with confirmed structure (≥5/7)
  if (r.signal === "BUY")  return met === 7 ? "freshBuy" : "tactical";
  if (r.signal === "HOLD") return "hold";                // 5/7, 6/7 and 7/7 all land here
  return "other";                                        // e.g. SELL while ST↑ and TT≥5
}

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
  // ONE first-match classifier, not a set of independent filters. Every valid result
  // lands in exactly one tier and every tier is rendered, so no asset can be dropped
  // silently. (Independent predicates left ST↑ + TT≥5/7 + non-BUY names in no bucket
  // at all from 2026-05-26 until 2026-08-14 — GOOGL and 0939.HK vanished from the scan.)
  const tiers: Record<Tier, ResultWithSepa[]> = {
    freshBuy: [], tactical: [], hold: [], emerging: [], stripped: [], watchlist: [], other: [],
  };
  for (const r of valid) tiers[tierOf(r, freshBullishSyms)].push(r);

  const freshBuys  = tiers.freshBuy;
  const tacticals  = tiers.tactical;
  const holdsTier  = tiers.hold;
  const emerging   = tiers.emerging;
  const stripped   = tiers.stripped;
  const watchlist  = tiers.watchlist;
  const other      = tiers.other;

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
    // Strategy SMA50 gate (TT c5): a flip below SMA50 is NOT an entry yet.
    const gate = tt?.c5_price_above_sma50 === true ? "✓entry"
      : tt?.c5_price_above_sma50 === false ? "⏳SMA50" : "";
    return `${sym} ${chg} ${px} ${ttStr} ${gate}`.trimEnd();
  };

  // Catch-all row: shows the signal too, since the whole point is "why is this here?".
  const fmtOtherRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const sig = r.signal.padEnd(4);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(7);
    const chg = fmtChg(r.change_pct).padStart(6);
    const tt  = ttFor(r);
    const ttTag = tt ? `TT${tt.criteria_met}/7` : "TT—";
    return `${sym} ${sig} ${px} ${chg} ${ttTag}`;
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
      // Tag = the position state machine: LONG only when the strategy holds.
      const tag = r.stance === "out" ? "OUT"
        : r.posState === "waiting" ? "WAIT"
        : r.posState === "pending" ? "ENTRY" : "LONG";
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
    lines.push(`\n🔵 <b>HOLDS (${holdsTier.length})</b> <i>ST↑ HOLD TT≥5/7</i>`);
    lines.push(preBlock(holdsTier.map(fmtTacticalRow)));
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

  // UNCLASSIFIED — the net. Should always be empty; if it isn't, the tier rules have a
  // gap and this makes it visible in the message rather than shrinking the row count.
  if (other.length > 0) {
    lines.push(`\n❓ <b>UNCLASSIFIED (${other.length})</b> <i>matched no tier — check the data</i>`);
    lines.push(preBlock(other.map(fmtOtherRow)));
  }

  // Receipt — reconciles the assets that went in against the rows actually rendered.
  // Checked against the composed body, so it also catches a tier that was computed
  // and then never pushed, or a name lost anywhere else in the compose step.
  const receipt = buildReceipt(
    valid.map(r => r.symbol),
    [
      { label: "buy",       symbols: freshBuys.map(r => r.symbol) },
      { label: "tactical",  symbols: tacticals.map(r => r.symbol) },
      { label: "hold",      symbols: holdsTier.map(r => r.symbol) },
      { label: "emerging",  symbols: emerging.map(r => r.symbol)  },
      { label: "stripped",  symbols: stripped.map(r => r.symbol)  },
      { label: "watch",     symbols: watchlist.map(r => r.symbol) },
      { label: "unclassified", symbols: other.map(r => r.symbol)  },
    ],
    { display: dispSym, renderedText: lines.join("\n") },
  );
  lines.push(`\n🧾 <i>${htmlEscape(receipt.text)}</i>`);

  // Footer
  lines.push(`📊 <i>Avg ${avgScore}/10 · ${valid.length} assets · HKT ${timeStr}</i>`);

  return lines.join("\n");
}
