// US (NYSE) + HK (HKEX) market holidays, used by the freshness sentinel to avoid
// false "stale" alerts over weekends/holidays.
//
// KEEP IN SYNC with autopilot/worker/market_calendar.py — extend each January.
// (Dual-maintenance is intentional for now; the web app cannot import the Python
// worker's calendar. Candidate to single-source later via a published holidays.json.)
const HOLIDAYS: Record<string, Set<string>> = {
  us: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  ]),
  hk: new Set([
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03",
    "2026-04-06", "2026-05-01", "2026-07-01", "2026-10-01", "2026-12-25",
  ]),
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isTradingDay(region: string, d: Date): boolean {
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  return !(HOLIDAYS[region]?.has(ymd(d)) ?? false);
}

/**
 * Number of region trading days strictly after `from`, up to and including `to`.
 * Granularity is whole UTC calendar days — sufficient given the padded thresholds.
 */
export function tradingDaysBetween(from: Date, to: Date, region: string): number {
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let count = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isTradingDay(region, cur)) count++;
  }
  return count;
}
