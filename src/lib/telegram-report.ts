import { SepaMetadata } from "@/types";
import { htmlEscape } from "@/lib/telegram";

type Flip = { flipType: "BULLISH" | "BEARISH" | null; barsSince: number };

type SlimResult = {
  symbol: string;
  name: string;
  exchange: string;
  st_direction: number;
  current_price: number;
  change_pct: number;
  sepa_metadata?: SepaMetadata;
  error?: string;
  _flip?: Flip;
};

function fmtChg(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function fmtSepa(s: SepaMetadata): string {
  const tt  = s.trend_template ? "T✅" : "T❌";
  const vcp = s.vcp_detected   ? "VCP" : "—";
  const dots = "●".repeat(s.sepa_score) + "○".repeat(3 - s.sepa_score);
  return `${dots} [${tt} ${vcp}]`;
}

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

  const header = market === "us"
    ? `🌅 <b>Morning Brief · US Close</b> [${dateStr}]`
    : `🌏 <b>HK Close</b> [${dateStr}]`;

  // Market breadth: count stocks where close > SMA50 (c5 criterion)
  const aboveSma50 = valid.filter(r =>
    r.sepa_metadata?.trend_template_criteria?.c5_price_above_sma50 === true
  );
  const breadthPct = valid.length > 0
    ? Math.round((aboveSma50.length / valid.length) * 100)
    : 0;
  const breadthEmoji = breadthPct >= 70 ? "🟢" : breadthPct >= 40 ? "🟡" : "🔴";

  // Split by exchange for ordering
  const hkStocks = valid.filter(r => r.exchange === "HK");
  const usStocks = valid.filter(r => r.exchange === "US");
  const ordered  = market === "hk"
    ? [...hkStocks, ...usStocks]
    : [...usStocks, ...hkStocks];

  const bullish = ordered
    .filter(r => r.st_direction === 1)
    .sort((a, b) => (b.sepa_metadata?.sepa_score ?? 0) - (a.sepa_metadata?.sepa_score ?? 0));

  const bearish = ordered.filter(r => r.st_direction !== 1);

  // Recent flips (within 2 bars)
  const recentFlips = valid
    .filter(r => r._flip?.flipType && (r._flip?.barsSince ?? 999) <= 2)
    .sort((a, b) => (a._flip?.barsSince ?? 0) - (b._flip?.barsSince ?? 0));

  const lines: string[] = [header, ""];

  // Breadth
  lines.push(`${breadthEmoji} <b>MARKET BREADTH:</b> ${aboveSma50.length}/${valid.length} above SMA50 (${breadthPct}%)`);

  // Bullish leaderboard
  if (bullish.length > 0) {
    lines.push(`\n🟢 <b>ST BULLISH (${bullish.length})</b> — ranked by SEPA`);
    bullish.forEach((r, i) => {
      const sepa  = r.sepa_metadata ? fmtSepa(r.sepa_metadata) : "—";
      const chg   = fmtChg(r.change_pct);
      lines.push(`  ${i + 1}. <b>${htmlEscape(r.symbol)}</b> ${sepa}  ${chg}`);
    });
  }

  // Bearish list
  if (bearish.length > 0) {
    lines.push(`\n🔴 <b>ST BEARISH (${bearish.length})</b>`);
    bearish.forEach(r => {
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b> ${htmlEscape(r.name)}  ${fmtChg(r.change_pct)}`);
    });
  }

  // Recent flips
  if (recentFlips.length > 0) {
    lines.push(`\n⚡ <b>RECENT FLIPS</b> (≤2 bars)`);
    recentFlips.forEach(r => {
      const flip = r._flip!;
      const when = flip.barsSince === 0 ? "today" : "yesterday";
      const icon = flip.flipType === "BULLISH" ? "📈" : "📉";
      lines.push(`  • <b>${htmlEscape(r.symbol)}</b> → ${icon} ${flip.flipType} (${when})`);
    });
  }

  const errorCount = results.length - valid.length;
  const errorNote  = errorCount > 0 ? ` · ⚠️ ${errorCount} failed` : "";
  lines.push(`\n<i>${valid.length} stocks · HKT ${timeStr}${errorNote}</i>`);

  return lines.join("\n");
}
