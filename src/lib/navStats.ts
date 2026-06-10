export interface NavEntry { date: string; region: "US" | "HK"; ret: number; bench_ret: number | null; }

export interface RegionStats {
  navSeries: { date: string; nav: number; benchNav: number | null }[];
  totalReturnPct: number;
  annSharpe: number | null;
  maxDrawdownPct: number;
  alpha: number | null;          // annualized, vs region benchmark
  beta: number | null;
  observations: number;
}

const MIN_OBS_FOR_REGRESSION = 60;

export function computeRegionStats(entries: NavEntry[]): RegionStats {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let nav = 1, benchNav = 1, peak = 1, maxDD = 0;
  let benchOk = true;
  const navSeries: RegionStats["navSeries"] = [];
  for (const e of sorted) {
    nav *= 1 + e.ret;
    if (e.bench_ret === null) benchOk = false; else benchNav *= 1 + e.bench_ret;
    peak = Math.max(peak, nav);
    maxDD = Math.min(maxDD, nav / peak - 1);
    navSeries.push({ date: e.date, nav, benchNav: benchOk ? benchNav : null });
  }
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
  return { navSeries, totalReturnPct: (nav - 1) * 100, annSharpe,
           maxDrawdownPct: maxDD * 100, alpha, beta, observations: n };
}
