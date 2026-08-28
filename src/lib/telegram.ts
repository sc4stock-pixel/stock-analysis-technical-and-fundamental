import { StockAnalysisResult, SepaMetadata, TrendTemplateCriteria } from "@/types";
import { holidayStatus } from "@/lib/telegram-report";
import { buildAlertModel, clientFlip } from "@/lib/alert-model";
import { buildReceipt } from "@/lib/reportReceipt";
import { targetWeightOfResult, exitActionLabel, weightTone } from "@/lib/targetWeight";

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
// Weight-bucket classification — the report is organised by the exposure the
// strategy wants, not by "should I buy this" (STRATEGY.md position sizing).
// ============================================================
/** The three exposure buckets. Every valid result lands in exactly one, so a
 *  classification gap shows up as a missing name in the receipt rather than a
 *  silently shrunken message. */
export type Bucket = "full" | "trim" | "floor";

/** Assigns a result to its weight bucket. This is a RENDERING grouping derived
 *  from targetWeight.ts — never a second derivation of the sizing rule. */
export function bucketOf(r: ResultWithSepa): Bucket {
  return weightTone(targetWeightOfResult(r).weight);
}

// ============================================================
// Main: buildTelegramMessage — execution alerts to ALERTS channel
// ============================================================
export function buildTelegramMessage(
  results: ResultWithFlip[],
  source: "manual" | "cron" | "intraday" = "manual",
  expectedUniverse?: readonly string[],   // portfolio of record; flags NEVER ANALYSED
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
  // avgBookLine is appended after the buckets are known (see compose).

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

  // ---------- Weight-bucket assembly ----------
  // ONE classifier, exhaustive by construction: every valid result lands in exactly
  // one exposure bucket, so a name can never be silently dropped (the 2026-05/08
  // tier-gap bug that lost GOOGL and 0939.HK from the scan).
  const buckets: Record<Bucket, ResultWithSepa[]> = { full: [], trim: [], floor: [] };
  for (const r of valid) buckets[bucketOf(r)].push(r);

  // Within a bucket, sort by score desc so the strongest names read first.
  const byScore = (a: ResultWithSepa, b: ResultWithSepa) => (b.score ?? 0) - (a.score ?? 0);
  buckets.full.sort(byScore); buckets.trim.sort(byScore); buckets.floor.sort(byScore);

  const avgWeight = valid.length
    ? valid.reduce((acc, r) => acc + targetWeightOfResult(r).weight, 0) / valid.length
    : 0;

  const avgScore = (valid.reduce((s, r) => s + r.score, 0) / valid.length).toFixed(1);

  // ---------- Row renderers ----------
  // Monospace rows (no <b>; escaping done by preBlock). .HK stripped throughout.
  const pctVs200 = (r: ResultWithSepa): string => {
    // Prefer the scalar: chart_bars is stripped from the cron payload, so
    // reading the 200-day from it made this column vanish in the live alert.
    const bars = r.chart_bars;
    const s200 = r.backtest?.sma_200 ?? bars?.[bars.length - 1]?.sma200;
    if (!s200 || s200 <= 0 || !r.current_price) return "";
    const d = (r.current_price / s200 - 1) * 100;
    return `${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs 200d`;
  };

  // FULL bucket: the strategy is long, so signal + structure are what matter.
  const fmtFullRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    const sig = (r.signal ?? "").padEnd(4);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(8);
    const chg = fmtChg(r.change_pct).padStart(6);
    const tt  = ttFor(r);
    const met = tt?.criteria_met;
    const ttStr = met === undefined ? "  —" : `${met}/7`;
    // TT<5 is the old "stripped from buys" idea, kept as a row flag: the name is
    // still held at 100% (ST is long), but its structure is failing.
    const flag = met !== undefined && met < 5 ? " ⚠ structural"
      : tt ? (listTtFailures(tt) ? ` ✗${listTtFailures(tt)}` : "") : "";
    // Distance to the 200-day on FULL rows too, because it decides how far this
    // name falls if ST flips: above the 200-day it steps down to 70%, below it
    // it drops straight to the 40% floor. A name can be TT-healthy and still be
    // below its 200-day, so the ⚠ structural flag does not cover this.
    const d200 = pctVs200(r);
    const drop = d200 && d200.startsWith("-") ? " ↓40 if flip" : "";
    return `${sym} ${sig} ${sc} ${px} ${chg}  ${ttStr}  ${d200}${drop}${flag}`.trimEnd();
  };

  // TRIM / FLOOR buckets: no ST long, so distance to the 200-day is the number
  // that decides the weight and the one worth watching.
  const fmtWeightRow = (r: ResultWithSepa): string => {
    const sym = dispSym(r.symbol).padEnd(5);
    // Keep the score signal here too: a BUY in the trim/floor buckets means the
    // score model likes the name while ST does not — i.e. a re-entry candidate.
    const sig = (r.signal ?? "").padEnd(4);
    const sc  = r.score.toFixed(1);
    const px  = fmtPrice(r.current_price, r.exchange).padStart(8);
    const chg = fmtChg(r.change_pct).padStart(6);
    const met = ttFor(r)?.criteria_met;
    const ttStr = met === undefined ? "  —" : `${met}/7`;
    const d200 = pctVs200(r);
    return `${sym} ${sig} ${sc} ${px} ${chg}  ${ttStr}  ${d200}`.trimEnd();
  };

  // ---------- Weight-change line ----------
  // The one line worth reading on a quiet day. A weight change is exactly a
  // fresh ST flip (entry -> full, exit -> trim/floor); everything else holds.
  const changes = todayFlips.map(({ r, flipType, barsSince }) => {
    const to = targetWeightOfResult(r).weight;
    // A bullish flip raises exposure (the gate decides to what); a bearish flip
    // lowers it from full. Vocabulary contract: this is EXPOSURE, never "LONG".
    const from = flipType === "BULLISH" ? "40/70" : "100";
    const when = barsSince === 0 ? "today" : `${barsSince}d`;
    const gate = flipType === "BULLISH" && to !== 100 ? " · awaiting SMA50" : "";
    return `${dispSym(r.symbol).padEnd(6)} ${from}% → ${to}%  (${when})${gate}`;
  });
  const changeLine = changes.length
    ? `\n🔔 <b>WEIGHT CHANGES (${changes.length})</b>\n${preBlock(changes)}`
    : `\n✅ <i>No weight changes today</i>`;

  // ---------- Compose message ----------
  const lines: string[] = [headerLine, dataState];
  lines.push(changeLine);

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
      // Asymmetric 100/40 sizing (targetWeight.ts): an ST flip-down is a TRIM
      // to the 40% floor — or NO ACTION when the name still holds its 200-day.
      // Layer: exposure mapping on top of the layer-2 exit event.
      const act = exitActionLabel(targetWeightOfResult(r));
      lines.push(`  • 🛑 <b>${htmlEscape(dispSym(r.symbol))}</b>: ST FLIP → 📉 BEARISH (${when}) → <b>${htmlEscape(act)}</b>`);
      lines.push(`    ${detail}`);
    });
  }

  // ---------- Weight buckets ----------
  // Organised by the exposure the strategy wants, not by "should I buy this".
  // Each name appears exactly once.
  if (buckets.full.length > 0) {
    lines.push(`\n🟢 <b>100% · ST LONG (${buckets.full.length})</b>`);
    lines.push(preBlock(buckets.full.map(fmtFullRow)));
  }

  if (buckets.trim.length > 0) {
    lines.push(`\n🔵 <b>70% · TRIM (${buckets.trim.length})</b> <i>ST bearish, still above 200d</i>`);
    lines.push(preBlock(buckets.trim.map(fmtWeightRow)));
  }

  if (buckets.floor.length > 0) {
    lines.push(`\n🟠 <b>40% · FLOOR (${buckets.floor.length})</b> <i>ST bearish, below 200d</i>`);
    lines.push(preBlock(buckets.floor.map(fmtWeightRow)));
  }

  // Receipt — reconciles the assets that went in against the rows actually rendered.
  // Checked against the composed body, so it also catches a tier that was computed
  // and then never pushed, or a name lost anywhere else in the compose step.
  const receipt = buildReceipt(
    valid.map(r => r.symbol),
    [
      { label: "full",  symbols: buckets.full.map(r => r.symbol)  },
      { label: "trim",  symbols: buckets.trim.map(r => r.symbol)  },
      { label: "floor", symbols: buckets.floor.map(r => r.symbol) },
    ],
    { display: dispSym, renderedText: lines.join("\n"), expected: expectedUniverse },
  );
  lines.push(`\n🧾 <i>${htmlEscape(receipt.text)}</i>`);

  // Footer
  lines.push(`📊 <i>Avg book ${avgWeight.toFixed(0)}% · Avg score ${avgScore}/10 · ${valid.length} assets · HKT ${timeStr}</i>`);

  return lines.join("\n");
}
