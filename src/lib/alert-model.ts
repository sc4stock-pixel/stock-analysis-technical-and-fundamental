import type { ReconciledEvent } from "@/lib/worker-events";
import { reconcileWorkerEvents, entryReadyOf } from "@/lib/worker-events";
import type { StockAnalysisResult } from "@/types";
import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";
import { supertrend } from "@/lib/indicators";

export const ACT_WINDOW_SESSIONS = 10;
export const FLIP_ALERT_DAYS = 3;

export type Stance = "long" | "out";

/** Strategy position state for a dir-up row (STRATEGY.md state machine):
 *  "long"    — entered via the SMA50 gate, holding until ST exit;
 *  "pending" — entry signal on the latest bar, fill is next session's open;
 *  "waiting" — ST flipped up but the gate never passed (no position). */
export type PosState = "long" | "pending" | "waiting";

/** Derive PosState from worker ticker state; falls back to the entryReady gate
 *  for pre-upgrade KV states that lack inLong. */
export function posStateOf(
  ts: Pick<WorkerTickerState, "dir" | "inLong" | "entryPending" | "entryReady" | "criteria"> | undefined,
): PosState | undefined {
  if (!ts || ts.dir !== "up") return undefined;
  if (typeof ts.inLong === "boolean") {
    if (ts.inLong) return "long";
    if (ts.entryPending) return "pending";
    return "waiting";
  }
  const gate = entryReadyOf(ts);
  return gate === undefined ? undefined : gate ? "long" : "waiting";
}

export interface ActionableRow {
  symbol: string;
  arrow: "▲" | "▼" | "↔";
  stance: Stance;
  change: string;        // "entered uptrend" | "exited uptrend" | "whipsawing · N flips/2wk"
  barsSince: number;     // freshness; 0 => TODAY pill
  /** Strategy SMA50 gate at signal time. true = real entry ("LONG"); false =
   *  raw flip below SMA50 ("awaiting SMA50", NOT a long); undefined = unknown. */
  entryReady?: boolean;
  /** Strategy position state for long-stance rows (see PosState). */
  posState?: PosState;
  whipsaw: boolean;
  rawCount?: number;     // raw events folded (whipsaw caption)
  ttFlag?: string;       // e.g. "+ TT 5→4"
  severity: number;      // sort key, lower = more urgent
  source: "worker" | "client";
}

export interface InfoAlert {
  icon: string;
  text: string;          // may contain <strong>…</strong>
  alertType: "score_buy" | "rsi_div" | "candlestick" | "correlation" | "reentry";
  symbol?: string;
}

export interface AlertModel {
  actOnThis: ActionableRow[];
  auditLog: ReconciledEvent[];
  otherAlerts: InfoAlert[];
}

export interface BuildOpts {
  heldSet?: Set<string>;
  actWindowSessions?: number;
  now?: Date;            // injectable for tests
}

/** Swappable actionability predicate. No heldSet => stance basis (Option A);
 *  heldSet => filter to held positions (Option B). */
export function isActionable(row: ActionableRow, heldSet?: Set<string>): boolean {
  return heldSet ? heldSet.has(row.symbol) : true;
}

/** Whole calendar days between a YYYY-MM-DD barDate and `now`. */
export function daysAgo(barDate: string, now: Date = new Date()): number {
  const d0 = Date.parse(`${barDate}T00:00:00+08:00`);
  const d1 = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00+08:00`);
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) return 999;
  return Math.max(0, Math.round((d1 - d0) / 86_400_000));
}

export interface ClientFlip {
  flipType: "BULLISH" | "BEARISH" | null;
  barsSince: number;
}

// entry_buy included: a fresh SMA50-reclaim re-entry is actionable even when the
// underlying dir flip is older than the window. Whipsaw counting stays on raw
// flips only (RAW_FLIP_SET) so a same-bar flip_buy+entry_buy pair counts once.
const FLIP_SET = new Set<WorkerEvent["type"]>(["flip_buy", "flip_exit", "entry_buy"]);
const RAW_FLIP_SET = new Set<WorkerEvent["type"]>(["flip_buy", "flip_exit"]);

// Trend Template passes at criteria_met >= 5 (see CLAUDE.md). Derive the escalation
// label from the threshold so it can't silently go stale if the threshold changes.
const TT_PASS = 5;

function ttFlagFor(events: ReconciledEvent[]): string | undefined {
  if (events.some(e => e.type === "tt_stripped")) return `+ TT ${TT_PASS}→${TT_PASS - 1}`;
  if (events.some(e => e.type === "tt_regained")) return `+ TT ${TT_PASS - 1}→${TT_PASS}`;
  return undefined;
}

function severityOf(stance: Stance, whipsaw: boolean, ttFlag?: string): number {
  if (stance === "out" && ttFlag) return 0; // double-signal exit — most urgent
  if (stance === "out" && !whipsaw) return 1;
  if (whipsaw) return 2;
  return 3;                                  // fresh entry — opportunity, last
}

function workerActionable(
  reconciled: ReconciledEvent[],
  tickers: Record<string, WorkerTickerState>,
  window: number,
  now: Date,
): ActionableRow[] {
  const byTicker = new Map<string, ReconciledEvent[]>();
  for (const e of reconciled) {
    const list = byTicker.get(e.ticker) ?? [];
    list.push(e);
    byTicker.set(e.ticker, list);
  }

  const rows: ActionableRow[] = [];
  byTicker.forEach((events, ticker) => {
    const liveFlip = events.find(e => e.current && FLIP_SET.has(e.type));
    if (!liveFlip) return;
    const since = daysAgo(liveFlip.barDate, now);
    if (since > window) return;

    const flips = events.filter(e => RAW_FLIP_SET.has(e.type) && daysAgo(e.barDate, now) <= window);
    const whipsaw = flips.length >= 3;
    const stance: Stance = tickers[ticker]?.dir === "up" ? "long" : "out";
    const ttFlag = ttFlagFor(events.filter(e => daysAgo(e.barDate, now) <= window));
    const entryReady = stance === "long" ? entryReadyOf(tickers[ticker]) : undefined;
    const posState = stance === "long" ? posStateOf(tickers[ticker]) : undefined;

    // Copy is driven by the POSITION state machine (STRATEGY.md), not the raw
    // flip: a below-SMA50 flip is "awaiting", a signal on the latest bar is a
    // pending fill, and an entered position stays "entered" even if price later
    // dips under SMA50 (exits are ST-flip only — the META 2026-07-02 case).
    const change = whipsaw
      ? `whipsawing · ${flips.length} flips/2wk`
      : stance === "out" ? "exited uptrend"
      : posState === "waiting" ? "flipped up · awaiting SMA50"
      : posState === "pending" ? "entry signal · fills next open"
      : liveFlip.type === "entry_buy" && !flips.some(f => f.type === "flip_buy" && f.barDate === liveFlip.barDate)
        ? "re-entered above SMA50"
        : "entered uptrend";
    const arrow: ActionableRow["arrow"] = whipsaw ? "↔" : stance === "long" ? "▲" : "▼";

    rows.push({
      symbol: ticker, arrow, stance, change, barsSince: since, whipsaw, entryReady, posState,
      rawCount: whipsaw ? flips.length : undefined,
      ttFlag, severity: severityOf(stance, whipsaw, ttFlag), source: "worker",
    });
  });
  return rows;
}

function clientActionable(
  results: StockAnalysisResult[],
  reportedTickers: Set<string>,
  now: Date,
): ActionableRow[] {
  const rows: ActionableRow[] = [];
  for (const r of results) {
    if (reportedTickers.has(r.symbol)) continue;          // worker is truth — no double-render
    const { flipType, barsSince } = clientFlip(r);
    if (!flipType || barsSince > FLIP_ALERT_DAYS) continue;
    const stance: Stance = flipType === "BULLISH" ? "long" : "out";
    // Client-side gate: TT c5 (Close>SMA50) from sepa_metadata — same strategy
    // gate the worker's entryReady carries.
    const c5 = r.sepa_metadata?.trend_template_criteria?.c5_price_above_sma50;
    const entryReady = stance === "long"
      ? (typeof c5 === "boolean" ? c5 : undefined) : undefined;
    // Client-side position state: the pipeline already simulates the open
    // position (st_open_return_pct is non-null iff the strategy holds a long).
    // A fresh gate-passing flip without an open position = fill pending.
    const posState: PosState | undefined = stance !== "long" ? undefined
      : r.st_open_return_pct != null ? "long"
      : entryReady === true ? "pending"
      : entryReady === false ? "waiting"
      : undefined;
    rows.push({
      symbol: r.symbol,
      arrow: stance === "long" ? "▲" : "▼",
      stance,
      change: stance === "out" ? "exited uptrend"
        : posState === "waiting" ? "flipped up · awaiting SMA50"
        : posState === "pending" ? "entry signal · fills next open"
        : "entered uptrend",
      entryReady, posState,
      barsSince, whipsaw: false,
      severity: severityOf(stance, false, undefined),
      source: "client",
    });
  }
  return rows;
}

function extractOtherAlerts(results: StockAnalysisResult[]): InfoAlert[] {
  const out: InfoAlert[] = [];
  for (const r of results) {
    const bt = r.backtest;
    if (bt?.rsi_divergence_type && bt.rsi_divergence_type !== "None") {
      out.push({ icon: "⚠️", text: `<strong>${r.symbol}</strong>: RSI ${bt.rsi_divergence_type} Divergence`,
        alertType: "rsi_div", symbol: r.symbol });
    }
    if (r.kelly?.correlated_with) {
      out.push({ icon: "🔗", text: `<strong>${r.symbol}</strong>: Correlated with ${r.kelly.correlated_with}`,
        alertType: "correlation", symbol: r.symbol });
    }
    const patterns = bt?.candlestick_patterns || [];
    const recent = patterns.filter(p =>
      (p.bar_index !== undefined && p.bar_index <= 3) ||
      (p.label === "Latest" || /^[1-3]d ago/.test(p.label ?? "")));
    const confirm: Record<string, string[]> = {
      BUY:  ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
      SELL: ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
    };
    const caution: Record<string, string[]> = {
      BUY:  ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
      SELL: ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
    };
    for (const p of recent) {
      const label = p.label === "Latest" ? "Today" : p.label || "";
      if ((confirm[r.signal] || []).includes(p.pattern)) {
        out.push({ icon: "✅", text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Confirms ${r.signal}`,
          alertType: "candlestick", symbol: r.symbol });
      } else if ((caution[r.signal] || []).includes(p.pattern)) {
        out.push({ icon: "⚠️", text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Caution on ${r.signal}`,
          alertType: "candlestick", symbol: r.symbol });
      }
    }
  }
  return out;
}

export function buildAlertModel(
  workerEvents: WorkerEvent[],
  tickers: Record<string, WorkerTickerState>,
  clientResults: StockAnalysisResult[],
  opts: BuildOpts = {},
): AlertModel {
  const window = opts.actWindowSessions ?? ACT_WINDOW_SESSIONS;
  const now = opts.now ?? new Date();
  const reconciled = reconcileWorkerEvents(workerEvents, tickers);

  const workerRows = workerActionable(reconciled, tickers, window, now)
    .filter(r => isActionable(r, opts.heldSet));

  const reportedTickers = new Set(workerEvents.map(e => e.ticker));
  const clientRows = clientActionable(clientResults, reportedTickers, now)
    .filter(r => isActionable(r, opts.heldSet));

  const actOnThis = [...workerRows, ...clientRows]
    .sort((a, b) => a.severity - b.severity || a.barsSince - b.barsSince);

  return { actOnThis, auditLog: reconciled, otherAlerts: extractOtherAlerts(clientResults) };
}

/** Most-recent SuperTrend flip from a result's own bars (client-stance gap-fill).
 *  Ported from the former computeOptimizedFlip in AlertsPanel. */
export function clientFlip(result: StockAnalysisResult): ClientFlip {
  const pre = (result as { _flip?: { flipType: "BULLISH" | "BEARISH" | null; barsSince: number } })._flip;
  if (pre && (pre.flipType === "BULLISH" || pre.flipType === "BEARISH" || pre.flipType === null)) {
    return { flipType: pre.flipType, barsSince: pre.barsSince ?? 999 };
  }
  const bars = result.chart_bars;
  if (!bars || bars.length < 2) return { flipType: null, barsSince: 999 };
  const atr = result.st_opt_params?.atrPeriod ?? 10;
  const mul = result.st_opt_params?.multiplier ?? 3.0;
  const [, dir] = supertrend(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atr, mul);
  if (dir.length < 2) return { flipType: null, barsSince: 999 };
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      const barsSince = dir.length - 1 - i;
      return { flipType: dir[i] === 1 ? "BULLISH" : "BEARISH", barsSince };
    }
  }
  return { flipType: null, barsSince: 999 };
}
