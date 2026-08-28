export interface NavEntry { date: string; region: "US" | "HK"; ret: number; bench_ret: number | null; bh_ret?: number | null;
  /** Asymmetric 100/40 line (worker nav.asym_daily_return, from 2026-08-28).
   *  Absent/null on every earlier entry — treat as "line not started yet",
   *  NEVER as a 0% day, or the series shows a long flat run that never happened. */
  asym_ret?: number | null; }

export interface RegionStats {
  navSeries: { date: string; nav: number; benchNav: number | null; bhNav: number | null; asymNav: number | null }[];
  totalReturnPct: number;
  /** Asymmetric 100/40 cumulative return; null until the line has data. */
  asymTotalReturnPct: number | null;
  /** Days the asym line has been recorded (it starts far behind `observations`). */
  asymObservations: number;
  bhTotalReturnPct: number | null; // universe buy-and-hold; null unless full series has bh data
  annSharpe: number | null;
  maxDrawdownPct: number;
  alpha: number | null;          // annualized, vs region benchmark
  beta: number | null;
  observations: number;
}

export const MIN_OBS_FOR_REGRESSION = 60;

export function computeRegionStats(entries: NavEntry[]): RegionStats {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let nav = 1, benchNav = 1, bhNav = 1, peak = 1, maxDD = 0;
  // The asym line begins the day the worker starts writing asym_ret; before
  // that it is null (absent), not 1.0 (flat) — see NavEntry.asym_ret.
  let asymNav: number | null = null;
  const navSeries: RegionStats["navSeries"] = [];
  for (const e of sorted) {
    nav *= 1 + e.ret;
    benchNav *= 1 + (e.bench_ret ?? 0);
    bhNav *= 1 + (e.bh_ret ?? 0);
    if (e.asym_ret != null) asymNav = (asymNav ?? 1) * (1 + e.asym_ret);
    peak = Math.max(peak, nav);
    maxDD = Math.min(maxDD, nav / peak - 1);
    navSeries.push({ date: e.date, nav, benchNav, bhNav, asymNav });
  }
  const hasBench = sorted.some(e => e.bench_ret !== null);
  const hasBh = sorted.some(e => e.bh_ret != null);
  const asymObs = sorted.filter(e => e.asym_ret != null).length;
  const rets = sorted.map(e => e.ret);
  const n = rets.length;
  const mean = n ? rets.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const annSharpe = n > 1 && sd > 0 ? (mean / sd) * Math.sqrt(252) : null;

  let alpha: number | null = null, beta: number | null = null;
  const paired = sorted.filter(e => e.bench_ret !== null) as (NavEntry & { bench_ret: number })[];
  if (paired.length >= MIN_OBS_FOR_REGRESSION) {
    const bMean = paired.reduce((a, e) => a + e.bench_ret, 0) / paired.length;
    const pMean = paired.reduce((a, e) => a + e.ret, 0) / paired.length;
    let cov = 0, varB = 0;
    for (const e of paired) { cov += (e.ret - pMean) * (e.bench_ret - bMean); varB += (e.bench_ret - bMean) ** 2; }
    if (varB > 0) { beta = cov / varB; alpha = (pMean - beta * bMean) * 252; }
  }
  return { navSeries, totalReturnPct: (nav - 1) * 100,
           asymTotalReturnPct: asymNav != null ? (asymNav - 1) * 100 : null,
           asymObservations: asymObs,
           bhTotalReturnPct: hasBh && n > 0 ? (bhNav - 1) * 100 : null, annSharpe,
           maxDrawdownPct: maxDD * 100, alpha, beta, observations: n };
}
