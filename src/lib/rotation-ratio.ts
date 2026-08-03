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
