import { TimesfmForecasts, TimesfmPriceTargets } from "@/types";

interface RawStockForecast {
  price_targets?: {
    t1: number;
    t2: number;
    t3: number;
    p10: number[];
    p50: number[];
    p90: number[];
  };
  st_persistence?: {
    current_dir: number;
    persistence_prob: number;
    flip_risk: string;
    p50_distances: number[];
  };
  // flat format support
  t1?: number;
  t2?: number;
  t3?: number;
  p10?: number[];
  p50?: number[];
  p90?: number[];
}

export async function fetchTimesfmForecasts(): Promise<TimesfmForecasts | null> {
  try {
    const url =
      "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/timesfm_forecasts.json";
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("fetch failed");
    const raw = await res.json() as Record<string, RawStockForecast>;

    // Normalize: JSON has { price_targets: {...}, st_persistence: {...} }
    // But types expect flat { t1, t2, t3, p10, p50, p90, st_persistence }
    const normalized: TimesfmForecasts = {};
    for (const [symbol, data] of Object.entries(raw)) {
      if (!data) continue;
      const pt = data.price_targets;
      if (pt && pt.t1 != null && Array.isArray(pt.p50) && pt.p50.length > 0) {
        normalized[symbol] = {
          t1: pt.t1,
          t2: pt.t2,
          t3: pt.t3,
          p10: pt.p10 ?? [],
          p50: pt.p50 ?? [],
          p90: pt.p90 ?? [],
          st_persistence: data.st_persistence,
        } as TimesfmPriceTargets;
      } else if (data.t1 != null && Array.isArray(data.p50) && data.p50.length > 0) {
        normalized[symbol] = {
          t1: data.t1!,
          t2: data.t2!,
          t3: data.t3!,
          p10: data.p10 ?? [],
          p50: data.p50 ?? [],
          p90: data.p90 ?? [],
          st_persistence: data.st_persistence,
        } as TimesfmPriceTargets;
      }
    }
    return normalized;
  } catch {
    return null;
  }
}
