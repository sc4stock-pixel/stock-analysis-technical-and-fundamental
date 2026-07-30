/**
 * HK-vs-US breadth-spread history — the persisted series behind the Rotation panel.
 *
 * The EOD report (`/api/cron/report`) is stateless and reruns the whole pipeline each
 * call, so a longitudinal view of breadth can only exist if each run appends its counts
 * to KV. This module is the pure core of that append; the route owns the KV I/O, exactly
 * as it already does for `breadth_snapshot_{market}`.
 *
 * Why raw counts and not just a percentage: the US book is 9 names and HK is 7, so one
 * ticker entering or leaving the portfolio moves the percentage ~11 points with no market
 * move at all. Storing numerator and denominator lets the panel show "7/7" and lets the
 * spread be recomputed if the universe changes.
 *
 * Why each region is stored separately (the load-bearing detail): the HK EOD run fires
 * 16:30 HKT on day D, the US EOD run 08:55 HKT on day D+1 — different HK dates, but the
 * US session it reports is D's. So each run writes ONLY its own region's half of the row
 * for the session date it actually covers (`sessionDate`). Writing whole rows would pair
 * HK(D) with US(D-1) under one date and quietly skew the spread by a day. A region whose
 * market was closed simply never writes, leaving an honest gap instead of a carried-
 * forward value dressed up as a fresh reading.
 *
 * "Above SMA50" is single-sourced from the Trend-Template `c5_price_above_sma50`
 * criterion via `isAboveSma50` in `breadth-movers.ts` — the same field the EOD breadth
 * count itself uses. This module never recomputes it.
 *
 * NOT PORTED to the Python report, worker preflight, or the Morning Digest, and that is
 * deliberate (cross-surface parity rule, CLAUDE.md D3): the rotation series is a new
 * surface consisting of the web panel plus one Telegram EOD line, not a new per-ticker
 * field. There is no per-stock stance or alert here to keep in sync.
 */

export type Region = "us" | "hk";

/** One region's breadth reading for a session. */
export interface RegionBreadth {
  above: number;
  total: number;
  /** ISO timestamp of the run that wrote this half. */
  asOf: string;
}

/** One session's breadth, with each region filled in by its own EOD run. */
export interface BreadthPoint {
  /** Session date, `YYYY-MM-DD` on the HK calendar. The merge key. */
  date: string;
  hk?: RegionBreadth;
  us?: RegionBreadth;
}

/** Roughly one trading year. At ~110 bytes/row this stays a few KB in KV. */
export const HISTORY_CAP = 250;

/** Default lookback for the "is favour building or fading" delta on the Telegram line. */
export const DELTA_LOOKBACK = 5;

/** The HK-calendar date (`YYYY-MM-DD`) for an instant. en-CA yields ISO-ordered Y-M-D. */
export function hkDateKey(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
}

/**
 * The session date a given EOD run is reporting on.
 *
 * The HK run reports the session that just closed — today, HK time. The US run fires the
 * following HK morning about a US session that closed overnight, so it belongs to the
 * previous HK date. Aligning both regions onto that shared session date is what makes the
 * spread a same-day comparison.
 */
export function sessionDate(market: Region, at: Date = new Date()): string {
  if (market === "hk") return hkDateKey(at);
  return hkDateKey(new Date(at.getTime() - 24 * 60 * 60 * 1000));
}

/** Percentage of a region's names above SMA50. Null when the region is empty or absent. */
export function pct(r: RegionBreadth | undefined): number | null {
  if (!r || !Number.isFinite(r.above) || !Number.isFinite(r.total) || r.total <= 0) return null;
  return Math.round((r.above / r.total) * 100);
}

/**
 * The spread, in percentage points: HK breadth minus US breadth.
 *
 * Positive = HK favoured. Null unless BOTH regions reported for the session — a spread
 * against a missing half would render as a misleading ±100.
 */
export function spreadOf(p: BreadthPoint | undefined): number | null {
  if (!p) return null;
  const hk = pct(p.hk);
  const us = pct(p.us);
  if (hk === null || us === null) return null;
  return hk - us;
}

/** Rows that have both halves, oldest first — the plottable subset of the series. */
export function completePoints(history: BreadthPoint[] | null | undefined): BreadthPoint[] {
  if (!Array.isArray(history)) return [];
  return history.filter(p => spreadOf(p) !== null);
}

/**
 * Merge one region's reading into the series, keeping it date-sorted and capped.
 *
 * Only the named region's half is touched, so the counterpart region's earlier write for
 * the same session survives. The input array is never mutated.
 */
export function mergeRegion(
  history: BreadthPoint[] | null | undefined,
  date: string,
  market: Region,
  reading: RegionBreadth,
  cap: number = HISTORY_CAP,
): BreadthPoint[] {
  const rows: BreadthPoint[] = Array.isArray(history)
    ? history.filter(p => p && typeof p.date === "string").map(p => ({ ...p }))
    : [];
  const existing = rows.find(p => p.date === date);
  if (existing) {
    existing[market] = reading;
  } else {
    rows.push({ date, [market]: reading } as BreadthPoint);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.length > cap ? rows.slice(rows.length - cap) : rows;
}

/**
 * Change in spread over the last `lookback` COMPLETE rows, for the Telegram line.
 *
 * A static "+78" says nothing about direction, which is the actionable part. Incomplete
 * rows are skipped rather than treated as gaps of zero. Null when there is not enough
 * complete history, so the caller omits the delta instead of printing a fabricated zero.
 */
export function spreadDelta(
  history: BreadthPoint[] | null | undefined,
  lookback: number = DELTA_LOOKBACK,
): number | null {
  const rows = completePoints(history);
  if (rows.length < lookback + 1) return null;
  const now = spreadOf(rows[rows.length - 1]);
  const then = spreadOf(rows[rows.length - 1 - lookback]);
  if (now === null || then === null) return null;
  return now - then;
}

/** Signed integer for display: `+78`, `-12`, `0`. */
export function signed(n: number): string {
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

/**
 * The spread suffix appended to the EOD report's existing `US x/y · HK a/b` line.
 *
 * Returns "" when no spread is computable, so the line degrades to exactly what it
 * printed before this feature existed. Plain text — no HTML — since the caller embeds it
 * in an already-escaped line.
 */
export function spreadSuffix(
  history: BreadthPoint[] | null | undefined,
  lookback: number = DELTA_LOOKBACK,
): string {
  const rows = completePoints(history);
  if (rows.length === 0) return "";
  const s = spreadOf(rows[rows.length - 1]);
  if (s === null) return "";
  const d = spreadDelta(history, lookback);
  const deltaPart = d === null ? "" : ` (${lookback}d ${signed(d)})`;
  return ` · spread ${signed(s)}${deltaPart}`;
}
