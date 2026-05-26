import { SepaMetadata, TrendTemplateCriteria } from "@/types";
import { htmlEscape } from "@/lib/telegram";

type Flip = { flipType: "BULLISH" | "BEARISH" | null; barsSince: number };

type SlimResult = {
  symbol: string;
  name: string;
  exchange: string;
  st_direction: number;
  current_price: number;
  change_pct: number;
  st_stop_distance_pct?: number;
  sepa_metadata?: SepaMetadata;
  error?: string;
  _flip?: Flip;
};

// ---------- Holiday detection ----------
// Hardcoded map of dates (YYYY-MM-DD in HKT) where US and/or HK markets are closed.
// Extend each year. Sources: NYSE calendar, HKEX calendar.
const HOLIDAYS: Record<string, { us: boolean; hk: boolean; label: string }> = {
  // 2026
  "2026-01-01": { us: true,  hk: true,  label: "New Year's Day" },
  "2026-01-19": { us: true,  hk: false, label: "MLK Day (US)" },
  "2026-02-16": { us: true,  hk: false, label: "Presidents Day (US)" },
  "2026-02-17": { us: false, hk: true,  label: "Lunar New Year (HK)" },
  "2026-02-18": { us: false, hk: true,  label: "Lunar New Year (HK)" },
  "2026-02-19": { us: false, hk: true,  label: "Lunar New Year (HK)" },
  "2026-04-03": { us: true,  hk: true,  label: "Good Friday" },
  "2026-04-06": { us: false, hk: true,  label: "Easter Monday (HK)" },
  "2026-04-07": { us: false, hk: true,  label: "Ching Ming (HK)" },
  "2026-05-01": { us: false, hk: true,  label: "Labour Day (HK)" },
  "2026-05-25": { us: true,  hk: true,  label: "Memorial Day / Buddha's Bday" },
  "2026-06-19": { us: true,  hk: false, label: "Juneteenth (US)" },
  "2026-07-01": { us: false, hk: true,  label: "HKSAR Day" },
  "2026-07-03": { us: true,  hk: false, label: "Independence Day obs. (US)" },
  "2026-09-07": { us: true,  hk: false, label: "Labor Day (US)" },
  "2026-09-26": { us: false, hk: true,  label: "Mid-Autumn (HK)" },
  "2026-10-01": { us: false, hk: true,  label: "National Day (HK)" },
  "2026-10-19": { us: false, hk: true,  label: "Chung Yeung (HK)" },
  "2026-11-26": { us: true,  hk: false, label: "Thanksgiving (US)" },
  "2026-12-25": { us: true,  hk: true,  label: "Christmas" },
  "2026-12-26": { us: false, hk: true,  label: "Boxing Day (HK)" },
};

function todayHkIso(): string {
  // YYYY-MM-DD in Asia/Hong_Kong
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
}

export function holidayStatus(): { us: boolean; hk: boolean; label: string } | null {
  const key = todayHkIso();
  return HOLIDAYS[key] ?? null;
}

// ---------- Formatters ----------
function fmtChg(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

// Priority order for which failing TT criterion to surface (most actionable first).
// c2 (200SMA) is the institutional distribution check — flag first.
const TT_FAIL_PRIORITY: Array<{ key: keyof TrendTemplateCriteria; label: string }> = [
  { key: "c2_price_above_sma200",   label: "Below 200SMA"     },
  { key: "c1_price_above_sma150",   label: "Below 150SMA"     },
  { key: "c3_sma150_above_sma200",  label: "150SMA below 200" },
  { key: "c4_sma200_trending_up",   label: "200SMA ↓"         },
  { key: "c5_price_above_sma50",    label: "Below 50SMA"      },
  { key: "c6_above_25pct_of_low52", label: "Below 52wL+25%"   },
  { key: "c7_within_25pct_of_high52", label: "Off 52wH by 25%+" },
];

function fmtTtFailure(tt: TrendTemplateCriteria | undefined): string {
  if (!tt || tt.passes) return "—";
  for (const { key, label } of TT_FAIL_PRIORITY) {
    if (tt[key] === false) return label;
  }
  return "—";
}

function fmtSepa(s: SepaMetadata): string {
  const ttPasses = s.trend_template_criteria?.passes ?? s.trend_template;
  const ttIcon   = ttPasses ? "T✅" : "T❌";
  const ttDetail = ttPasses ? "—" : fmtTtFailure(s.trend_template_criteria);
  const dots = "●".repeat(s.sepa_score) + "○".repeat(3 - s.sepa_score);
  return `${dots} [${ttIcon} ${ttDetail}]`;
}

function flagFor(exchange: string): string {
  return exchange === "HK" ? "🇭🇰" : "🇺🇸";
}

// Build inline grouped lines: prefix flag, 3 per line, " · " separator
function groupedInline(stocks: SlimResult[], perLine = 3): string[] {
  // Split by exchange first, US then HK
  const us = stocks.filter(r => r.exchange !== "HK");
  const hk = stocks.filter(r => r.exchange === "HK");
  const lines: string[] = [];
  for (const group of [us, hk]) {
    for (let i = 0; i < group.length; i += perLine) {
      const chunk = group.slice(i, i + perLine);
      const flag  = flagFor(chunk[0].exchange);
      const parts = chunk.map(r =>
        `<b>${htmlEscape(r.symbol)}</b> (${fmtChg(r.change_pct)})`
      );
      lines.push(`  ${flag} ${parts.join(" · ")}`);
    }
  }
  return lines;
}

// ---------- Proximity ----------
const PROXIMITY_THRESHOLD_PCT = 2.0;

type ProximityHit = { r: SlimResult; kind: "near_stop" | "near_bull_flip"; dist: number };

function detectProximity(valid: SlimResult[]): ProximityHit[] {
  const hits: ProximityHit[] = [];
  for (const r of valid) {
    const d = r.st_stop_distance_pct;
    if (d === undefined || d === null || !isFinite(d) || d === 0) continue;
    if (r.st_direction === 1 && d > 0 && d < PROXIMITY_THRESHOLD_PCT) {
      hits.push({ r, kind: "near_stop", dist: d });
    } else if (r.st_direction !== 1 && d < 0 && d > -PROXIMITY_THRESHOLD_PCT) {
      hits.push({ r, kind: "near_bull_flip", dist: d });
    }
  }
  // Tightest distance first
  return hits.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
}

// ============================================================
// Main: buildEodReport
// ============================================================
export function buildEodReport(
  results: SlimResult[],
  market: "us" | "hk",
): string {
  const valid = results.filter(r => !r.error && r.current_price > 0);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    timeZone: "Asia/Hong_Kong",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong",
  });

  const holiday = holidayStatus();
  const bothClosed = holiday?.us && holiday?.hk;

  // Header — swaps to "Holiday Status" when both markets closed
  const headerLabel = bothClosed
    ? "Holiday Status"
    : market === "us" ? "US Close" : "HK Close";
  const header = `🌅 <b>Morning Brief · ${headerLabel}</b> [${dateStr}]`;

  // Breadth: count stocks where close > SMA50
  const aboveSma50 = valid.filter(r =>
    r.sepa_metadata?.trend_template_criteria?.c5_price_above_sma50 === true
  );
  const breadthPct = valid.length > 0
    ? Math.round((aboveSma50.length / valid.length) * 100)
    : 0;
  const breadthEmoji = breadthPct >= 70 ? "🟢" : breadthPct >= 40 ? "🟡" : "🔴";

  // Order by exchange of interest first
  const hkStocks = valid.filter(r => r.exchange === "HK");
  const usStocks = valid.filter(r => r.exchange !== "HK");
  const ordered  = market === "hk"
    ? [...hkStocks, ...usStocks]
    : [...usStocks, ...hkStocks];

  const bullish = ordered
    .filter(r => r.st_direction === 1)
    .sort((a, b) => (b.sepa_metadata?.sepa_score ?? 0) - (a.sepa_metadata?.sepa_score ?? 0));
  const bearish = ordered.filter(r => r.st_direction !== 1);

  const recentFlips = valid
    .filter(r => r._flip?.flipType && (r._flip?.barsSince ?? 999) <= 2)
    .sort((a, b) => (a._flip?.barsSince ?? 0) - (b._flip?.barsSince ?? 0));

  const proximity = detectProximity(valid);

  const lines: string[] = [header];

  // Holiday line
  if (holiday) {
    const which = bothClosed
      ? "US &amp; HK Markets Closed Today"
      : holiday.us ? "US Market Closed Today" : "HK Market Closed Today";
    lines.push(`⚠️ <b>${which}</b> (${htmlEscape(holiday.label)})`);
  }

  // RECENT FLIPS — moved up top per refined template
  if (recentFlips.length > 0) {
    lines.push(`\n⚡ <b>RECENT FLIPS</b> (≤2 bars)`);
    recentFlips.forEach(r => {
      const flip = r._flip!;
      const when = flip.barsSince === 0 ? "today" : `${flip.barsSince} bar${flip.barsSince > 1 ? "s" : ""} ago`;
      const icon = flip.flipType === "BULLISH" ? "📈" : "📉";
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b> → ${icon} ${flip.flipType} (${when})`);
    });
  }

  // ST PROXIMITY — low-priority warnings using cached ST params
  if (proximity.length > 0) {
    lines.push(`\n⚠️ <b>ST PROXIMITY</b> (within ${PROXIMITY_THRESHOLD_PCT.toFixed(0)}%)`);
    proximity.forEach(({ r, kind, dist }) => {
      const label = kind === "near_stop" ? "Near Stop" : "Near Bullish Flip";
      const detail = kind === "near_stop"
        ? `price ${dist.toFixed(1)}% above ST`
        : `price ${Math.abs(dist).toFixed(1)}% below ST`;
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b>: ${label} (${detail})`);
    });
  }

  // Market breadth
  lines.push(`\n${breadthEmoji} <b>MARKET BREADTH:</b> ${aboveSma50.length}/${valid.length} above SMA50 (${breadthPct}%)`);

  // ST BULLISH — monospace block for column alignment
  if (bullish.length > 0) {
    lines.push(`\n🟢 <b>ST BULLISH (${bullish.length})</b> — ranked by SEPA`);
    // Column widths
    const maxSymLen = Math.max(...bullish.map(r => r.symbol.length));
    const rows: string[] = [];
    bullish.forEach((r, i) => {
      const sepa = r.sepa_metadata ? fmtSepa(r.sepa_metadata) : "—";
      const chg  = fmtChg(r.change_pct);
      const idx  = `${i + 1}.`.padEnd(3);
      const sym  = r.symbol.padEnd(maxSymLen);
      rows.push(`  ${idx} ${sym}  ${sepa}  ${chg}`);
    });
    // Wrap in <pre> so Telegram renders monospace and preserves column alignment
    lines.push(`<pre>${rows.join("\n")}</pre>`);
  }

  // ST BEARISH — consolidated inline lists grouped by exchange flag (3 per line)
  if (bearish.length > 0) {
    lines.push(`\n🔴 <b>ST BEARISH (${bearish.length})</b>`);
    lines.push(...groupedInline(bearish, 3));
  }

  const errorCount = results.length - valid.length;
  const errorNote  = errorCount > 0 ? ` · ⚠️ ${errorCount} failed` : "";
  lines.push(`\n<i>${valid.length} stocks monitored · HKT ${timeStr}${errorNote}</i>`);

  return lines.join("\n");
}
