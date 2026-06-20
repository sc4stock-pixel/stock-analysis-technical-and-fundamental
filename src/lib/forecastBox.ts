import { KronosForecast, TimesfmPriceTargets } from "@/types";

export interface ForecastCell {
  price: number;
  pct: number;
}

export interface ForecastRowData {
  /** [5d, 10d, 20d] — each null when that horizon is unavailable. */
  cells: (ForecastCell | null)[];
  /** historical 20-session direction hits (out of 20); null if absent. */
  dirHits: number | null;
}

export type Agreement = "agree-up" | "agree-down" | "diverge" | null;

const finite = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v);

/** % move of a forecast price vs the model's own baseline close. */
export function cell(
  price: number | null | undefined,
  baseline: number | null | undefined,
): ForecastCell | null {
  if (!finite(price)) return null;
  if (!finite(baseline) || baseline <= 0) return null;
  return { price, pct: ((price - baseline) / baseline) * 100 };
}

/** Kronos: forward.p50[4/9/19] for 5/10/20d, % vs kronos.last_price. */
export function kronosRow(k: KronosForecast | undefined): ForecastRowData | null {
  if (!k) return null;
  const p = Array.isArray(k.forward?.p50) ? k.forward.p50 : [];
  const base = k.last_price;
  return {
    cells: [p[4], p[9], p[19]].map((v) => cell(v, base)),
    dirHits: k.historical?.dir_hits ?? null,
  };
}

/** TimesFM: t1/t2/t3 for 5/10/20d, % vs its own last_price (fallback to currentPrice). */
export function timesfmRow(
  t: TimesfmPriceTargets | undefined,
  currentPrice: number,
): ForecastRowData | null {
  if (!t) return null;
  const base = finite(t.last_price) && t.last_price! > 0 ? t.last_price! : currentPrice;
  return {
    cells: [t.t1, t.t2, t.t3].map((v) => cell(v, base)),
    dirHits: t.historical?.dir_hits ?? null,
  };
}

/** 20d directional agreement between two model rows. null if either 20d cell is missing. */
export function agreement20(
  a: ForecastRowData | null,
  b: ForecastRowData | null,
): Agreement {
  const ca = a?.cells[2];
  const cb = b?.cells[2];
  if (!ca || !cb) return null;
  const aUp = ca.pct >= 0;
  const bUp = cb.pct >= 0;
  if (aUp === bUp) return aUp ? "agree-up" : "agree-down";
  return "diverge";
}
