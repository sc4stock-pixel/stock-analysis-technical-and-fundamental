import type { WorkerTickerState, WorkerEvent } from "@/types/worker-state";

export const KRONOS_NOISE_THRESHOLD = 25;

export function pct20d(p50: number[] | undefined, lastPrice: number | undefined): number | null {
  if (!p50 || p50.length === 0 || !lastPrice) return null;
  return Math.round((p50[p50.length - 1] / lastPrice - 1) * 1000) / 10;
}
export function downsideToStopPct(t: Pick<WorkerTickerState, "dir" | "price" | "stop">): number | null {
  if (t.dir !== "up" || !t.stop || !t.price) return null;
  return Math.round(((t.price - t.stop) / t.price) * 1000) / 10;
}
// Distance from price to the live SuperTrend line (`stop`), which IS the level a
// close must cross to flip direction (resistance in a downtrend, support in an
// uptrend). Sign: + = stop is ABOVE price → must rally that % to flip up (down-trend
// names, a potential buy trigger); − = stop is BELOW price → must fall that % to flip
// down (open longs). |value| → 0 = knife-edge, about to flip.
// NOTE: do NOT use `flipPx` here — that is the close on the PAST bar where the trend
// last changed (a historical anchor), not a forward trigger. (Bug fixed 2026-06-18.)
export function distanceToFlipPct(t: Pick<WorkerTickerState, "price" | "stop">): number | null {
  if (!t.stop || !t.price) return null;
  return Math.round(((t.stop - t.price) / t.price) * 1000) / 10;
}
export function eventCount(events: WorkerEvent[], ticker: string): number {
  return events.filter((e) => e.ticker === ticker).length;
}
export function isDefaultParams(t: Pick<WorkerTickerState, "atrPeriod" | "mult">): boolean {
  return t.atrPeriod === 10 && t.mult === 3.0;
}
export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}
export function fmtKronos(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) > KRONOS_NOISE_THRESHOLD) return "noise";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}
