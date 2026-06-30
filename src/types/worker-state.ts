export type WorkerEventType =
  | "flip_buy" | "flip_exit" | "tt_stripped" | "tt_regained"
  | "sma50_cross_up" | "sma50_cross_down";

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
