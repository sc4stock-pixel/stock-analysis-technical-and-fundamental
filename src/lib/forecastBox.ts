import { KronosForecast, TimesfmPriceTargets, ModelSkill } from "@/types";

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

// --- 5d conviction helpers (parity with scripts/naive_baseline.py) ---

export const CONVICTION_PCT = 5.0; // PARITY with scripts/naive_baseline.py + harness
export const REL_MAE_WARN = 15.0; // % relative MAE -> low-reliability flag
const DRIFT_WINDOW = 60,
  HORIZON = 5;

/** Naive drift baseline from a close series (oldest->newest). cells:[5d,null,null]. */
export function naiveRow(
  closes: number[] | undefined,
): ForecastRowData | null {
  if (!closes || closes.length < DRIFT_WINDOW + 1) return null;
  const w = closes.slice(-(DRIFT_WINDOW + 1));
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++)
    if (w[i - 1] > 0 && w[i] > 0) rets.push(Math.log(w[i] / w[i - 1]));
  if (!rets.length) return null;
  const drift = rets.reduce((a, b) => a + b, 0) / rets.length;
  const last = w[w.length - 1];
  const price = last * Math.exp(drift * HORIZON);
  return { cells: [cell(price, last), null, null], dirHits: null };
}

export interface Flags {
  high: boolean;
  unreliable: boolean;
}
/** Conviction (|5d%|>threshold) + reliability (recent relMae%). Independent — both can show. */
export function convictionFlags(
  c5d: ForecastCell | null,
  relMaePct: number | null,
): Flags {
  return {
    high: !!c5d && Math.abs(c5d.pct) > CONVICTION_PCT,
    unreliable: relMaePct != null && relMaePct > REL_MAE_WARN,
  };
}

export interface Badge {
  tone: "edge" | "muted" | "pending";
  label: string;
  detail: string;
}
/** Model-level skill badge from forecast_skill.json. naive = the NAIVE ModelSkill (for "vs naive"). */
export function skillBadge(
  k: ModelSkill | null,
  naive: ModelSkill | null,
): Badge {
  const kr = k?.conviction_5d?.gt5?.rate,
    nr = naive?.conviction_5d?.gt5?.rate;
  const detail =
    kr != null
      ? `hi-conv ${Math.round(kr * 100)}%${nr != null ? ` vs naive ${Math.round(nr * 100)}%` : ""}`
      : "";
  switch (k?.verdict) {
    case "EDGE_HIGH_CONVICTION":
    case "EDGE_BROAD":
      return {
        tone: "edge",
        label: "Edge on high-conviction calls (provisional)",
        detail,
      };
    case "INSUFFICIENT":
      return { tone: "pending", label: "Gathering track record", detail };
    default:
      return { tone: "muted", label: "No measured edge", detail };
  }
}
