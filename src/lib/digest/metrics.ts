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
export function distanceToFlipPct(t: Pick<WorkerTickerState, "price" | "flipPx">): number | null {
  if (!t.flipPx || !t.price) return null;
  return Math.round(((t.price - t.flipPx) / t.price) * 100000) / 1000;
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
