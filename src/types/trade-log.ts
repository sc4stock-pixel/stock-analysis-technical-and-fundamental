// One record in the KV "trade_log" array, authored by the autopilot worker
// (worker/trade_log.py). The web app reads all fields and patches only
// actual_fill_price / actual_fill_date via the Telegram /fill command.
export interface TradeLogRecord {
  id: string;                 // `${ticker}|${date}|${type}`
  date: string;               // signal bar date, YYYY-MM-DD
  logged_at: string;
  session: "eod" | "intraday";
  confirmed: boolean;
  ticker: string;
  region: string;             // UPPERCASE
  type: "entry" | "exit";
  /** Strategy SMA50 gate at signal time (worker: dir up AND TT c5). false = raw
   *  flip below SMA50 — a phantom entry the strategy never takes (not fillable).
   *  Absent on legacy/exit records; derive from criteria[4] via entryReadyOfRecord. */
  entry_ready?: boolean | null;
  direction: "long";
  signal_price: number | null;
  stop: number | null;
  atr_period: number | null;
  multiplier: number | null;
  params_source: string | null; // "optimized" | "default_fallback" | ...
  tt_score: number | null;
  criteria: boolean[] | null;
  sma_stack: string | null;
  piotroski_f: number | null;
  altman_z: number | null;
  z_variant: string | null;
  op_margin: number[];
  actual_fill_price: number | null;
  actual_fill_date: string | null;
  // present on exit records (added by pair_exit in the worker)
  entry_id?: string | null;
  signal_return_pct?: number | null;
  hold_days?: number | null;
}
