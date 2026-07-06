export type WorkerEventType =
  | "flip_buy" | "flip_exit" | "tt_stripped" | "tt_regained"
  | "sma50_cross_up" | "sma50_cross_down"
  // STRATEGY ENTRY (ST flip/re-entry + Close>SMA50) — the automatable signal.
  // flip_buy alone is raw trend telemetry, NOT an entry.
  | "entry_buy";

export interface WorkerEvent {
  type: WorkerEventType;
  ticker: string;
  region: string;
  session: "eod" | "intraday";
  barDate: string;
  confirmed: boolean;
  fromScore?: number;
  toScore?: number;
}

export interface WorkerTickerState {
  region: string;
  price: number;
  barDate: string;
  dir: "up" | "down";
  flipPx: number;
  stop: number;
  atrPeriod: number;
  mult: number;
  score: number;
  criteria: boolean[];
  smaStack: string;
  /** Strategy SMA50 gate: dir=="up" AND TT c5 (Close>SMA50). Optional until the
   *  worker PR deploys; derive via entryReadyOf() which falls back to criteria[4]. */
  entryReady?: boolean;
  /** Strategy POSITION state (STRATEGY.md state machine): entered via the gate
   *  and no ST exit since. Stays true when price later dips under SMA50 —
   *  exits are ST-flip only. Optional until the worker deploys it. */
  inLong?: boolean;
  /** Entry signal fired on the latest bar — the fill is next session's open. */
  entryPending?: boolean;
  entryDate?: string | null;
  entryPx?: number | null;
  funds: {
    f: number | null;
    z: number | null;
    zVariant: string;
    opMargin: number[];
  };
}

export interface WorkerState {
  version: number;
  updatedAt: string | null;
  regionLastRun: Record<string, string>;
  tickers: Record<string, WorkerTickerState>;
  lastAlert: Record<string, string>;
  events: WorkerEvent[];
}
