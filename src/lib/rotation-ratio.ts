/**
 * HK-vs-US tech relative-strength ratio — the second Rotation panel chart.
 *
 * `3033.HK / QQQ`, plotted against its own 50-day mean. Above and rising = HK tech
 * leading; below and falling = US tech leading. Crossings of the mean are the rotation
 * signal.
 *
 * ETFs rather than indices because Yahoo has no Hang Seng TECH index series to use — see
 * the symbol constants in `app/api/rotation/route.ts` for the probe results. This module
 * is symbol-agnostic; it divides whatever two close series it is handed.
 *
 * Nothing here is persisted. Unlike the breadth spread — which is derived from the
 * portfolio and cannot be reconstructed after the fact — index history is re-fetchable
 * from Yahoo at any time, so the API route pulls it live and keeps KV out of it.
 *
 * The ratio is left in raw units rather than indexed to 100. Indexing would make the
 * numbers prettier but would peg them to whichever day the window happens to start on;
 * the 50-day mean already supplies the reference line that makes direction readable, and
 * a mean crossing is scale-invariant either way.
 */

/** Minimal bar shape — a subset of `RawOHLCV`, so callers can pass those straight in. */
export interface CloseBar {
  date: string;
  close: number;
}

/** One plottable point of the ratio series. */
export interface RatioPoint {
  date: string;
  ratio: number;
  /** Trailing mean of `ratio`; null until the window is full. */
  ma: number | null;
}

export const RATIO_MA_PERIOD = 50;

/** Trailing simple mean, null-padded until `period` values are available. */
export function trailingMean(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/**
 * Inner-join two close series by date and divide.
 *
 * HK and US do not share a trading calendar — typhoon days, HK-only and US-only
 * holidays. An inner join drops any date where either market was shut, which is the
 * honest handling: a ratio built from one side's stale close would show a move that never
 * happened. Non-finite and non-positive closes are skipped for the same reason.
 */
export function buildRatioSeries(
  numerator: CloseBar[] | null | undefined,
  denominator: CloseBar[] | null | undefined,
  period: number = RATIO_MA_PERIOD,
): RatioPoint[] {
  if (!Array.isArray(numerator) || !Array.isArray(denominator)) return [];

  const denByDate = new Map<string, number>();
  for (const b of denominator) {
    if (b && typeof b.date === "string" && Number.isFinite(b.close) && b.close > 0) {
      denByDate.set(b.date, b.close);
    }
  }

  const dates: string[] = [];
  const ratios: number[] = [];
  for (const b of numerator) {
    if (!b || typeof b.date !== "string") continue;
    if (!Number.isFinite(b.close) || b.close <= 0) continue;
    const d = denByDate.get(b.date);
    if (d === undefined) continue;
    dates.push(b.date);
    ratios.push(b.close / d);
  }

  // Yahoo returns bars ascending, but sort defensively — the mean is order-sensitive.
  const order = dates.map((_, i) => i).sort((a, b) => dates[a].localeCompare(dates[b]));
  const sortedDates = order.map(i => dates[i]);
  const sortedRatios = order.map(i => ratios[i]);

  const mas = trailingMean(sortedRatios, period);
  return sortedDates.map((date, i) => ({ date, ratio: sortedRatios[i], ma: mas[i] }));
}

/** Latest date carrying a usable bar, or null when the series has none. */
export function lastBarDate(bars: CloseBar[] | null | undefined): string | null {
  if (!Array.isArray(bars)) return null;
  let last: string | null = null;
  for (const b of bars) {
    if (!b || typeof b.date !== "string") continue;
    if (!Number.isFinite(b.close) || b.close <= 0) continue;
    if (last === null || b.date.localeCompare(last) > 0) last = b.date;
  }
  return last;
}

/**
 * A hole at the tail of the join, which the inner join cannot report on its own.
 *
 * Dropping unpaired dates is right for a gap *inside* the window: both sides have a bar
 * that day, one market was shut, and carrying the other side's stale close forward would
 * invent a move. The failure this catches is narrower — a date the join SHOULD have paired
 * but could not, because one leg skipped a session the other traded and then resumed on a
 * later one. `currentLead` then reads an older bar than the data supports, silently,
 * because the series is still non-empty.
 *
 * The rule is `lastJoined < min(lastNumerator, lastDenominator)`: a date both series reach
 * that the join still did not produce. Comparing the two legs' last dates directly is NOT
 * the same test and would fire every HK morning — during HK hours `3033.HK` carries a live
 * same-day bar while QQQ's last bar is the prior US close, so the legs legitimately differ
 * by a day with nothing missing. `min` removes that case, and a genuine holiday gap too.
 *
 * Measured 2026-09-22: `3033.HK` had bars for 09-17, 09-18 and a live 09-22, with **no
 * 09-21 bar at all**, while QQQ had 09-21. `min` = 09-21, last joined = 09-18, so this fires
 * and the panel can say the ratio is older than the data allows.
 *
 * Returns both dates for the message; null in the normal case.
 */
export function joinGap(
  numerator: CloseBar[] | null | undefined,
  denominator: CloseBar[] | null | undefined,
): { lastJoined: string; through: string } | null {
  const n = lastBarDate(numerator);
  const d = lastBarDate(denominator);
  if (n === null || d === null) return null;
  const through = n.localeCompare(d) <= 0 ? n : d;

  const denDates = new Set<string>();
  if (Array.isArray(denominator)) {
    for (const b of denominator) {
      if (!b || typeof b.date !== "string") continue;
      if (!Number.isFinite(b.close) || b.close <= 0) continue;
      denDates.add(b.date);
    }
  }

  let lastJoined: string | null = null;
  if (Array.isArray(numerator)) {
    for (const b of numerator) {
      if (!b || typeof b.date !== "string") continue;
      if (!Number.isFinite(b.close) || b.close <= 0) continue;
      if (!denDates.has(b.date)) continue;
      if (lastJoined === null || b.date.localeCompare(lastJoined) > 0) lastJoined = b.date;
    }
  }

  if (lastJoined === null || lastJoined.localeCompare(through) >= 0) return null;
  return { lastJoined, through };
}

/**
 * Where the latest point sits relative to its mean — the one-word read for the panel.
 *
 * "hk" / "us" name the side currently favoured; null when the mean isn't established yet
 * (fewer than `period` joined bars), rather than guessing from an incomplete window.
 */
export function currentLead(series: RatioPoint[]): "hk" | "us" | null {
  const last = series[series.length - 1];
  if (!last || last.ma === null) return null;
  return last.ratio >= last.ma ? "hk" : "us";
}
