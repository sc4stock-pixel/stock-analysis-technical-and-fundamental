import { KronosForecast, ModelSkill } from "@/types";

export interface ForecastCell {
  price: number;
  pct: number;
}

export interface ForecastRowData {
  /** [5d, 10d, 20d] — each null when that horizon is unavailable. */
  cells: (ForecastCell | null)[];
}

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
  };
}

// --- 5d conviction helpers ---

export const CONVICTION_PCT = 5.0; // PARITY: keep in lockstep with scripts/naive_baseline.py + report/forecast_display.py
export const REL_MAE_WARN = 15.0; // % relative MAE -> low-reliability flag
const DRIFT_WINDOW = 60, // PARITY: keep in lockstep with scripts/naive_baseline.py + report/forecast_display.py
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
  return { cells: [cell(price, last), null, null] };
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
    // Only the 5d high-conviction bucket earns an "edge" claim — that is what the
    // display is about. EDGE_BROAD (a longer-horizon signal) is NOT surfaced as an
    // edge here: it lacks a same-horizon naive control and is under separate study.
    case "EDGE_HIGH_CONVICTION":
      return {
        tone: "edge",
        label: "5d high-conviction edge (provisional)",
        detail,
      };
    case "EDGE_BROAD":
      return {
        tone: "muted",
        label: "No proven 5d edge · longer-horizon under study",
        detail,
      };
    case "INSUFFICIENT":
      return { tone: "pending", label: "Gathering track record", detail };
    default:
      return { tone: "muted", label: "No measured edge", detail };
  }
}
