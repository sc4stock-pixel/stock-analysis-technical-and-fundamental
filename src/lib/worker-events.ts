import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";

/**
 * A worker event annotated with reconciliation status, so the AUTOPILOT panel can
 * render the raw KV event log without it looking self-contradictory.
 *
 * The worker's `events[]` is an append-only log: it keeps a provisional (intraday)
 * AND a confirmed (eod) entry for the same flip, and keeps old flips after the stock
 * has since reversed. The authoritative current state is `tickers[ticker].dir`, NOT
 * "the newest event" (a provisional can be reverted by the close). We anchor on dir.
 */
export interface ReconciledEvent extends WorkerEvent {
  /** An older/other flip for this ticker that is not the one currently in effect. */
  superseded: boolean;
  /** The flip currently in effect (its implied direction matches the worker's dir). */
  current: boolean;
  /** Superseded AND its implied direction contradicts the current dir (e.g. a
   *  provisional exit that never confirmed). */
  reverted: boolean;
  /** The worker's current direction for this ticker, if known. */
  currentDir?: "up" | "down";
}

const FLIP_TYPES = new Set<WorkerEvent["type"]>(["flip_buy", "flip_exit"]);

const impliedDir = (type: WorkerEvent["type"]): "up" | "down" | null =>
  type === "flip_buy" ? "up" : type === "flip_exit" ? "down" : null;

// Higher key = more recent. Same bar: eod (confirmed) ranks after intraday (provisional).
const recencyKey = (e: WorkerEvent): string => `${e.barDate}:${e.confirmed ? 1 : 0}`;

/**
 * Reconcile the worker event log against current ticker state.
 *
 * 1. Collapse provisional+confirmed duplicates per (ticker, type, barDate) — confirmed wins.
 * 2. For each ticker, the in-effect flip = the most recent flip whose implied direction
 *    matches `tickers[ticker].dir` (falls back to newest flip if dir is unknown).
 * 3. Annotate every survivor with current / superseded / reverted flags.
 *
 * Order of the input (newest-first) is preserved for the survivors.
 */
export function reconcileWorkerEvents(
  events: WorkerEvent[],
  tickers: Record<string, WorkerTickerState> = {},
): ReconciledEvent[] {
  // 1) Dedup (confirmed supersedes provisional for the same flip on the same bar).
  const byKey = new Map<string, WorkerEvent>();
  for (const e of events) {
    const key = `${e.ticker}|${e.type}|${e.barDate}`;
    const prev = byKey.get(key);
    if (!prev || (e.confirmed && !prev.confirmed)) byKey.set(key, e);
  }
  const deduped = Array.from(byKey.values());

  // 2) Per ticker, choose the flip currently in effect.
  const flipsByTicker = new Map<string, WorkerEvent[]>();
  for (const e of deduped) {
    if (!FLIP_TYPES.has(e.type)) continue;
    const list = flipsByTicker.get(e.ticker) ?? [];
    list.push(e);
    flipsByTicker.set(e.ticker, list);
  }
  const liveFlip = new Map<string, WorkerEvent>();
  flipsByTicker.forEach((flips, ticker) => {
    const dir = tickers[ticker]?.dir;
    const newestFirst = flips.slice().sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
    const live = (dir ? newestFirst.find(e => impliedDir(e.type) === dir) : undefined) ?? newestFirst[0];
    liveFlip.set(ticker, live);
  });

  // 3) Annotate.
  return deduped.map((e): ReconciledEvent => {
    const dir = tickers[e.ticker]?.dir;
    if (!FLIP_TYPES.has(e.type)) {
      return { ...e, superseded: false, current: false, reverted: false, currentDir: dir };
    }
    const isCurrent = liveFlip.get(e.ticker) === e;
    const reverted = !isCurrent && dir != null && impliedDir(e.type) !== dir;
    return { ...e, superseded: !isCurrent, current: isCurrent, reverted, currentDir: dir };
  });
}
