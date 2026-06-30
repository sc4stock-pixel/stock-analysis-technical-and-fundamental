/**
 * Breadth-mover detection for the stateless EOD/Morning report.
 *
 * The report (`/api/cron/report`) reruns the pipeline fresh each call and has no
 * concept of "yesterday". To name WHICH stock moved the above-SMA50 breadth count,
 * the route persists the current per-stock above-SMA50 map to KV after each run and
 * diffs the next run against it. These helpers are the pure core of that diff.
 *
 * "Above SMA50" is single-sourced from the Trend-Template `c5_price_above_sma50`
 * criterion — the same field the breadth count itself uses.
 */

export interface BreadthSnapshot {
  /** ISO timestamp the snapshot was taken. */
  asOf: string;
  /** Per-stock above-SMA50 flag, keyed by raw symbol (e.g. "TSM", "0700.HK"). */
  above: Record<string, boolean>;
}

export interface BreadthMovers {
  /** Symbols that crossed from below to above SMA50 since the prior snapshot. */
  up: string[];
  /** Symbols that fell from above to below SMA50 since the prior snapshot. */
  down: string[];
}

/** A result row carrying enough to read its above-SMA50 status. */
interface AboveSma50Row {
  symbol: string;
  sepa_metadata?: { trend_template_criteria?: { c5_price_above_sma50?: boolean } | null } | null;
}

/** True when a result currently has its price above SMA50 (TT criterion c5). */
export function isAboveSma50(r: AboveSma50Row): boolean {
  return r.sepa_metadata?.trend_template_criteria?.c5_price_above_sma50 === true;
}

/** Build the current per-stock above-SMA50 map over a set of result rows. */
export function aboveSma50Map(rows: AboveSma50Row[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of rows) out[r.symbol] = isAboveSma50(r);
  return out;
}

/**
 * Diff the current above-SMA50 map against the prior snapshot.
 *
 * Only symbols present in BOTH maps can be movers — a stock freshly added to the
 * portfolio (absent from `prev`) is not a "mover", and a dropped stock is ignored.
 * Returns empty arrays when there is no prior snapshot (first run).
 */
export function computeBreadthMovers(
  current: Record<string, boolean>,
  prev: BreadthSnapshot | null | undefined,
): BreadthMovers {
  const up: string[] = [];
  const down: string[] = [];
  if (!prev || !prev.above) return { up, down };
  for (const [sym, nowAbove] of Object.entries(current)) {
    if (!(sym in prev.above)) continue;
    const wasAbove = prev.above[sym] === true;
    if (nowAbove && !wasAbove) up.push(sym);
    else if (!nowAbove && wasAbove) down.push(sym);
  }
  up.sort();
  down.sort();
  return { up, down };
}
