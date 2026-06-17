import type { ReconciledEvent } from "@/lib/worker-events";
import type { StockAnalysisResult } from "@/types";
import { supertrend } from "@/lib/indicators";

export const ACT_WINDOW_SESSIONS = 10;
export const FLIP_ALERT_DAYS = 3;

export type Stance = "long" | "out";

export interface ActionableRow {
  symbol: string;
  arrow: "▲" | "▼" | "↔";
  stance: Stance;
  change: string;        // "entered uptrend" | "exited uptrend" | "whipsawing · N flips/2wk"
  barsSince: number;     // freshness; 0 => TODAY pill
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

/** Most-recent SuperTrend flip from a result's own bars (client-stance gap-fill).
 *  Ported from the former computeOptimizedFlip in AlertsPanel. */
export function clientFlip(result: StockAnalysisResult): ClientFlip {
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
