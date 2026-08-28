import { SepaMetadata, TrendTemplateCriteria, KronosForecasts, ForecastSkill, SkillStat } from "@/types";
import { htmlEscape } from "@/lib/telegram";
import { buildAlertModel } from "@/lib/alert-model";
import { CONVICTION_PCT } from "@/lib/forecastBox";
import type { StockAnalysisResult } from "@/types";
import type { BreadthMovers } from "@/lib/breadth-movers";
import { spreadSuffix, type BreadthPoint } from "@/lib/breadth-history";
import { buildReceipt } from "@/lib/reportReceipt";

const dispSymForReport = (s: string) => s.replace(".HK", "");

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

export function reportHeaderLabel(market: "us" | "hk", bothClosed: boolean): string {
  if (bothClosed) return "🏖️ Holiday Status";
  return market === "us" ? "🌅 Morning Brief" : "🌇 HK Close";
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
        `<b>${htmlEscape(dispSymForReport(r.symbol))}</b> (${fmtChg(r.change_pct)})`
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
// Kronos 5d forecast table (compact, US then HK, sorted by |kPct| desc)
// ============================================================
interface ForecastRow {
  label: string; isHK: boolean;
  kPct: number | null;      // 5d
  kPct20: number | null;    // 20d — shown alongside, NOT ranked above 5d
}

export function buildForecastSection(
  ordered: { symbol: string }[],
  kronosData: KronosForecasts | null | undefined,
  skill: ForecastSkill | null | undefined,
): string[] {
  const rows: ForecastRow[] = [];
  for (const r of ordered) {
    const kro = kronosData?.[r.symbol];
    if (!kro) continue;
    const kLast = kro.last_price ?? null;
    const p50 = Array.isArray(kro.forward.p50) ? kro.forward.p50 : [];
    const kPct = (kLast && p50.length >= 5)
      ? ((p50[4] - kLast) / kLast) * 100 : null;
    const kPct20 = (kLast && p50.length >= 20)
      ? ((p50[19] - kLast) / kLast) * 100 : null;
    const isHK = r.symbol.endsWith(".HK");
    rows.push({
      // strip ".HK" — stops Telegram auto-linking "9988.HK" as a URL
      label: isHK ? r.symbol.replace(".HK", "") : r.symbol,
      isHK,
      kPct,
      kPct20,
    });
  }
  if (rows.length === 0) return [];

  // Sort by absolute predicted move descending (biggest conviction first)
  const byAbsPct = (a: ForecastRow, b: ForecastRow) =>
    Math.abs(b.kPct ?? 0) - Math.abs(a.kPct ?? 0);
  const us = rows.filter(x => !x.isHK).sort(byAbsPct);
  const hk = rows.filter(x => x.isHK).sort(byAbsPct);

  const pct = (v: number | null) => v == null ? "  —  " : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  // ✦ stays tied to the 5d value: CONVICTION_PCT (5%) is calibrated for a 5-day move.
  // A >5% move over 20 days is unremarkable, so flagging it there would be noise.
  const fmtRow = (x: ForecastRow) => {
    const lbl = x.label.padEnd(5);
    const flag = x.kPct != null && Math.abs(x.kPct) > CONVICTION_PCT ? "✦" : " ";
    return `${lbl}${pct(x.kPct).padStart(7)}${flag} ${pct(x.kPct20).padStart(7)}`;
  };
  const header = `${"".padEnd(5)}${"5d".padStart(7)}  ${"20d".padStart(7)}`;

  const table: string[] = [];
  if (us.length) { table.push("US", header); us.forEach(x => table.push(fmtRow(x))); }
  if (hk.length) { table.push("HK", header); hk.forEach(x => table.push(fmtRow(x))); }

  const result: string[] = [
    `\n📊 <b>KRONOS FORECASTS</b> <i>display-only · ✦ = large 5d move</i>`,
    `<pre>${table.join("\n")}</pre>`,
  ];

  // Skill footer — OOS hit-rate scoreboard.
  //
  // BENCHMARK NOTE (2026-08-10): the correct control is the CONTRARIAN rule
  // (fade the 60-day drift = inverse-naive), NOT naive itself. Kronos mean-reverts to
  // its context-window mean by construction, so it is structurally the opposite of a
  // trend-follower — scoring it against naive flatters it by ~20pp and produced a
  // bogus "edge" at 15/20d. Measured against the contrarian rule, Kronos adds ~0.
  // The naive rate is still shown, but as what it actually is: a REGIME GAUGE
  // (low = mean-reverting market, high = trending market).
  if (skill) {
    const K = skill.KRONOS, N = skill.NAIVE;
    const pc = (r: number) => `${Math.round(r * 100)}%`;
    const rows = (["5d", "15d", "20d"] as const)
      .map((h) => {
        const k = K.horizons?.[h] as SkillStat | null | undefined;
        const nv = N.horizons?.[h] as SkillStat | null | undefined;
        if (!k || !nv) return null;
        const inv = 1 - nv.rate;                 // contrarian baseline
        const d = (k.rate - inv) * 100;
        // Only claim an edge if the CI lower bound clears the contrarian baseline.
        const beats = k.ci_lo > inv ? "  ✅" : "";
        const ds = `${d >= 0 ? "+" : ""}${d.toFixed(0)}`;
        return `${h.padEnd(4)}${pc(k.rate).padStart(5)}${pc(inv).padStart(12)}${ds.padStart(6)}${beats}`;
      })
      .filter((r): r is string => r != null);
    const n20 = N.horizons?.["20d"] as SkillStat | null | undefined;
    if (rows.length) {
      const head = `${"".padEnd(4)}${"Kronos".padStart(5)}${"contrarian".padStart(12)}${"diff".padStart(6)}`;
      // The "no edge" claim must follow the data, not be hardcoded — if a horizon ever
      // genuinely clears the contrarian rule, this line has to say so.
      const cleared = (["5d", "15d", "20d"] as const).filter((h) => {
        const k = K.horizons?.[h] as SkillStat | null | undefined;
        const nv = N.horizons?.[h] as SkillStat | null | undefined;
        return !!k && !!nv && k.ci_lo > 1 - nv.rate;
      });
      const verdict = cleared.length
        ? `<b>${cleared.join(", ")} now clear${cleared.length === 1 ? "s" : ""}`
          + ` the contrarian rule</b> — worth a fresh look`
        : `no horizon has cleared it`;
      // Regime-invariant wording: Kronos is contrarian BY CONSTRUCTION, so when the
      // market turns trending both columns fall below 50% together. Describing that in
      // advance stops the inversion from reading as a malfunction.
      const regime = n20
        ? `${n20.rate < 0.45 ? "mean-reverting" : n20.rate > 0.55 ? "trending" : "mixed"}`
        : "unknown";
      // Regime reminder only — the "% columns describe the market" explainer and the
      // "diff is the only column about Kronos" preamble were cut as noise (2026-08-15).
      const regimeNote = n20
        ? ` Currently <b>${regime}</b> (trend-following wins ${pc(n20.rate)} at 20d).`
        : "";
      result.push(
        `\n📈 <b>Kronos vs a one-line contrarian rule</b>`,
        `<pre>${head}\n${rows.join("\n")}</pre>`,
        `<i>• ${verdict}.${regimeNote}</i>`
      );
    }
  }

  return result;
}

// ============================================================
// Main: buildEodReport
// ============================================================
export function buildEodReport(
  results: SlimResult[],
  market: "us" | "hk",
  kronosData?: KronosForecasts | null,
  skill?: ForecastSkill | null,
  movers?: BreadthMovers | null,   // SMA50 breadth movers vs the prior report's snapshot
  breadthHistory?: BreadthPoint[] | null, // HK-vs-US spread series, for the spread suffix
  expectedUniverse?: readonly string[],   // portfolio of record; flags NEVER ANALYSED
): string {
  const valid = results.filter(r => !r.error && r.current_price > 0);

  const actRows = buildAlertModel([], {}, valid as unknown as StockAnalysisResult[]).actOnThis;

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
  const header = `<b>${reportHeaderLabel(market, !!bothClosed)}</b> [${dateStr}]`;

  // Region splits (used by breadth + ordering)
  const hkStocks = valid.filter(r => r.exchange === "HK");
  const usStocks = valid.filter(r => r.exchange !== "HK");

  // Breadth: count stocks where close > SMA50, split by region
  const isAboveSma50 = (r: typeof valid[number]) =>
    r.sepa_metadata?.trend_template_criteria?.c5_price_above_sma50 === true;
  const aboveSma50 = valid.filter(isAboveSma50);
  const breadthPct = valid.length > 0
    ? Math.round((aboveSma50.length / valid.length) * 100)
    : 0;
  const breadthEmoji = breadthPct >= 70 ? "🟢" : breadthPct >= 40 ? "🟡" : "🔴";
  const usAbove = usStocks.filter(isAboveSma50).length;
  const hkAbove = hkStocks.filter(isAboveSma50).length;

  // Order by exchange of interest first
  const ordered  = market === "hk"
    ? [...hkStocks, ...usStocks]
    : [...usStocks, ...hkStocks];

  const bullish = ordered
    .filter(r => r.st_direction === 1)
    .sort((a, b) => (b.sepa_metadata?.sepa_score ?? 0) - (a.sepa_metadata?.sepa_score ?? 0));
  const bearish = ordered.filter(r => r.st_direction !== 1);

  const proximity = detectProximity(valid);

  const lines: string[] = [header];

  // Holiday line
  if (holiday) {
    const which = bothClosed
      ? "US &amp; HK Markets Closed Today"
      : holiday.us ? "US Market Closed Today" : "HK Market Closed Today";
    lines.push(`⚠️ <b>${which}</b> (${htmlEscape(holiday.label)})`);
  }

  // ACT ON THIS — replaces the old RECENT FLIPS block
  if (actRows.length > 0) {
    lines.push(`\n⚡ <b>ACT ON THIS</b>`);
    actRows.forEach(r => {
      // Tag = the position state machine (STRATEGY.md): LONG only when the
      // strategy actually holds; a next-open fill is 🕒 ENTRY; a below-SMA50
      // flip that never entered is ⏳ WAIT.
      const tag = r.stance === "out" ? "🔴 OUT"
        : r.posState === "waiting" ? "⏳ WAIT"
        : r.posState === "pending" ? "🕒 ENTRY"
        : "🟢 LONG";
      const when = r.barsSince === 0 ? "today" : `${r.barsSince}d ago`;
      const tt = r.ttFlag ? ` ${htmlEscape(r.ttFlag.replace("→", "->"))}` : "";
      // Asymmetric 100/40 target weight (exposure layer — targetWeight.ts)
      const w = r.targetWeight != null ? ` · tgt ${r.targetWeight}%` : "";
      lines.push(`  • <b>${htmlEscape(dispSymForReport(r.symbol))}</b> ${r.change}${tt} (${when}) — ${tag}${w}`);
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
  // The spread suffix (` · spread +78 (5d +12)`) answers HK-vs-US rotation: the static
  // counts alone don't say whether one side's favour is building or fading. Degrades to
  // "" when the series is too short, leaving the line exactly as it was before.
  lines.push(`  US ${usAbove}/${usStocks.length} · HK ${hkAbove}/${hkStocks.length}${spreadSuffix(breadthHistory)}`);

  // Breadth movers since the prior report (which stock crossed SMA50). Omitted on the
  // first run (no prior snapshot) and on quiet days (no crossings).
  if (movers && (movers.up.length > 0 || movers.down.length > 0)) {
    const parts: string[] = [];
    if (movers.up.length > 0)
      parts.push(`↑ crossed above: ${movers.up.map(dispSymForReport).map(htmlEscape).join(", ")}`);
    if (movers.down.length > 0)
      parts.push(`↓ fell below: ${movers.down.map(dispSymForReport).map(htmlEscape).join(", ")}`);
    lines.push(`  ${parts.join("   ")}`);
  }

  // ST BULLISH — monospace block for column alignment
  if (bullish.length > 0) {
    lines.push(`\n🟢 <b>ST BULLISH (${bullish.length})</b> — ranked by SEPA`);
    const maxSymLen = Math.max(...bullish.map(r => r.symbol.length));
    const rows: string[] = [];
    bullish.forEach((r) => {
      const sepa = r.sepa_metadata ? fmtSepa(r.sepa_metadata) : "—";
      const chg  = fmtChg(r.change_pct);
      const sym  = r.symbol.padEnd(maxSymLen);
      rows.push(`${sym} ${sepa} ${chg}`);
    });
    // Wrap in <pre> so Telegram renders monospace and preserves column alignment
    lines.push(`<pre>${rows.join("\n")}</pre>`);
  }

  // ST BEARISH — consolidated inline lists grouped by exchange flag (3 per line)
  if (bearish.length > 0) {
    lines.push(`\n🔴 <b>ST BEARISH (${bearish.length})</b>`);
    lines.push(...groupedInline(bearish, 3));
  }

  // FORECASTS — Kronos 5d forecast table
  if (kronosData) {
    lines.push(...buildForecastSection(ordered, kronosData, skill));
  }

  const failed = results.filter(r => !valid.includes(r));
  const errorNote = failed.length > 0
    ? ` · ⚠️ ${failed.length} failed: ${failed.map(r => htmlEscape(r.symbol)).join(", ")}`
    : "";

  // Receipt — proves every monitored stock reached a section. See reportReceipt.ts.
  const receipt = buildReceipt(
    valid.map(r => r.symbol),
    [
      { label: "bullish", symbols: bullish.map(r => r.symbol) },
      { label: "bearish", symbols: bearish.map(r => r.symbol) },
    ],
    { display: dispSymForReport, renderedText: lines.join("\n"), expected: expectedUniverse },
  );
  lines.push(`\n🧾 <i>${htmlEscape(receipt.text)}</i>`);

  lines.push(`<i>${valid.length} stocks monitored · HKT ${timeStr}${errorNote}</i>`);

  return lines.join("\n");
}
