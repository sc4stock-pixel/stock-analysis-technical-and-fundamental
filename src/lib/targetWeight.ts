// Target-weight layer (STRATEGY.md "position sizing", added 2026-08-27).
//
// THE strategy's state machine is UNCHANGED (SuperTrend flip + SMA50 gate,
// STRATEGY.md layers 1-3). This module adds the ASYMMETRIC 100/40 position-size
// mapping on top of it:
//
//   in position (LONG or ENTRY-PENDING)        -> 100%
//   out of position, Close > own SMA200        -> 100%   (trend intact: hold)
//   out of position, Close <= own SMA200       ->  40%   (floor, never 0)
//
// Validated 2026-08-26/27: beats the 0/100 mapping in 12/16 portfolio names on
// BOTH the 7-year daily backtest and the 23-month OOS replay (exp_oos_replay.py
// SCALED/ASYM variants). vs buy-and-hold it wins risk-adjusted over 7y but not
// over 2024-26 — see the strategy-faceoff artifact for the full evidence.
//
// LAYERING (vocabulary contract): target weight is EXPOSURE, not entry state.
// A 100% weight from the SMA200 leg alone is NOT "LONG" — LONG/entry wording
// still derives exclusively from entryReady/entry_buy/inLong. Never label a
// row LONG because its weight is 100.
//
// This is the SINGLE derivation. Surfaces must call one of these helpers, never
// re-derive the mapping inline (D3 cross-surface drift).

import type { WorkerTickerState } from "@/types/worker-state";

/** Full exposure, percent. */
export const WEIGHT_FULL = 100;
/** Floor exposure, percent — held when out of position below the 200-day. */
export const WEIGHT_FLOOR = 40;

export interface TargetWeightInputs {
  /** Strategy position state: LONG or ENTRY-PENDING (fill next open). */
  inPosition: boolean;
  /** Close > own SMA200 (TT criterion c2). undefined = unknown. */
  aboveSma200: boolean | undefined;
}

export interface TargetWeight {
  /** 100 or 40 (percent of the name's full allocation). */
  weight: number;
  /** Why: which leg produced the weight (drives per-surface copy). */
  reason: "in_position" | "above_sma200" | "floor" | "unknown_sma200";
}

/** Core mapping — the only place the 100/40 rule exists. */
export function targetWeight(inp: TargetWeightInputs): TargetWeight {
  if (inp.inPosition) return { weight: WEIGHT_FULL, reason: "in_position" };
  if (inp.aboveSma200 === true) return { weight: WEIGHT_FULL, reason: "above_sma200" };
  if (inp.aboveSma200 === false) return { weight: WEIGHT_FLOOR, reason: "floor" };
  // SMA200 unknown (short history / stale KV): fail toward the floor so a data
  // gap can never silently report full size on a broken trend.
  return { weight: WEIGHT_FLOOR, reason: "unknown_sma200" };
}

/** Derivation from worker KV ticker state (server surfaces: alerts, digest).
 *  criteria[1] = TT c2 (Close > SMA200), same indexing entryReadyOf uses for c5. */
export function targetWeightOfWorker(
  ts?: Pick<WorkerTickerState, "dir" | "inLong" | "entryPending" | "criteria">,
): TargetWeight | undefined {
  if (!ts) return undefined;
  const inPosition = ts.inLong === true || ts.entryPending === true;
  const c2 = Array.isArray(ts.criteria) ? ts.criteria[1] : undefined;
  return targetWeight({ inPosition, aboveSma200: typeof c2 === "boolean" ? c2 : undefined });
}

/** Derivation from a client pipeline result (web UI, Telegram execution alert).
 *  `inPosition` comes from the pipeline's open-position sim (st_open_return_pct
 *  is non-null only while the strategy holds); SMA200 from TT c2. */
export function targetWeightOfResult(r: {
  st_open_return_pct?: number | null;
  sepa_metadata?: { trend_template_criteria?: { c2_price_above_sma200?: boolean } } | null;
}): TargetWeight {
  const inPosition = r.st_open_return_pct !== null && r.st_open_return_pct !== undefined;
  const c2 = r.sepa_metadata?.trend_template_criteria?.c2_price_above_sma200;
  return targetWeight({ inPosition, aboveSma200: typeof c2 === "boolean" ? c2 : undefined });
}

/** Uniform short label for monospace surfaces (Telegram <pre>, tables). */
export function weightTag(tw: TargetWeight | undefined): string {
  if (!tw) return "";
  return `${tw.weight}%`;
}

/** One-line action phrasing for alert surfaces. Exit alerts use this so an ST
 *  flip-down no longer reads as "sell everything". */
export function exitActionLabel(tw: TargetWeight): string {
  return tw.weight === WEIGHT_FULL
    ? `HOLD ${WEIGHT_FULL}% (above 200D)`
    : `TRIM to ${WEIGHT_FLOOR}%`;
}
