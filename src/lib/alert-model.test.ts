import { describe, it, expect } from "vitest";
import { isActionable, type ActionableRow, daysAgo, clientFlip, buildAlertModel } from "./alert-model";
import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";
import { reconcileWorkerEvents } from "@/lib/worker-events";

const NOW = new Date("2026-06-17T12:00:00+08:00");

const wEvents: WorkerEvent[] = [
  { type: "flip_exit",   ticker: "SPY",     region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "flip_exit",   ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "tt_stripped", ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-15", confirmed: true },
  { type: "flip_exit",   ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-14", confirmed: true },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-12", confirmed: true },
  { type: "flip_buy",    ticker: "0939.HK", region: "hk", session: "eod",      barDate: "2026-06-17", confirmed: true },
];
const wTickers = {
  "SPY": { dir: "down" }, "MSFT": { dir: "down" },
  "3033.HK": { dir: "down" }, "0939.HK": { dir: "up" },
} as unknown as Record<string, WorkerTickerState>;

describe("buildAlertModel — worker actionable rows", () => {
  const m = buildAlertModel(wEvents, wTickers, [], { now: NOW });
  const bySym = (s: string) => m.actOnThis.find(r => r.symbol === s)!;

  it("emits one folded row per ticker with a current flip in window", () => {
    expect(new Set(m.actOnThis.map(r => r.symbol))).toEqual(new Set(["SPY", "MSFT", "3033.HK", "0939.HK"]));
  });
  it("uses entered/exited uptrend copy from stance", () => {
    expect(bySym("0939.HK").change).toBe("entered uptrend");
    expect(bySym("SPY").change).toBe("exited uptrend");
    expect(bySym("0939.HK").stance).toBe("long");
    expect(bySym("SPY").stance).toBe("out");
  });
  it("folds a whipsawing ticker into one row with a flip count", () => {
    const r = bySym("3033.HK");
    expect(r.whipsaw).toBe(true);
    expect(r.arrow).toBe("↔");
    expect(r.change).toBe("whipsawing · 3 flips/2wk");
    expect(r.rawCount).toBe(3);
  });
  it("escalates a coincident TT strip into the flip row", () => {
    expect(bySym("MSFT").ttFlag).toBe("+ TT 5→4");
  });
  it("sorts by severity: double-signal/exits before entries", () => {
    const order = m.actOnThis.map(r => r.symbol);
    expect(order.indexOf("MSFT")).toBeLessThan(order.indexOf("0939.HK"));
    expect(order.indexOf("SPY")).toBeLessThan(order.indexOf("0939.HK"));
  });
  it("sets TODAY (barsSince 0) for a same-day flip", () => {
    expect(bySym("0939.HK").barsSince).toBe(0);
  });
});
import type { StockAnalysisResult } from "@/types";

const row = (symbol: string): ActionableRow => ({
  symbol, arrow: "▼", stance: "out", change: "exited uptrend",
  barsSince: 1, whipsaw: false, severity: 1, source: "worker",
});

describe("isActionable", () => {
  it("returns true for any row when no heldSet is given (Option A stance basis)", () => {
    expect(isActionable(row("SPY"))).toBe(true);
  });
  it("filters to held tickers when a heldSet is given (Option B)", () => {
    const held = new Set(["AAPL"]);
    expect(isActionable(row("AAPL"), held)).toBe(true);
    expect(isActionable(row("SPY"), held)).toBe(false);
  });
});

describe("daysAgo", () => {
  it("counts whole calendar days between barDate and now", () => {
    const now = new Date("2026-06-17T12:00:00+08:00");
    expect(daysAgo("2026-06-17", now)).toBe(0);
    expect(daysAgo("2026-06-12", now)).toBe(5);
  });
});

describe("clientFlip", () => {
  it("returns null flip when there are too few bars", () => {
    const r = { chart_bars: [] } as unknown as StockAnalysisResult;
    expect(clientFlip(r).flipType).toBeNull();
  });
  it("detects the most recent SuperTrend flip direction and bars since", () => {
    const bars = [
      ...Array.from({ length: 20 }, (_, i) => ({ high: 100 - i, low: 98 - i, close: 99 - i })),
      { high: 95, low: 90, close: 94 }, { high: 110, low: 94, close: 109 }, { high: 120, low: 108, close: 119 },
    ];
    const r = { chart_bars: bars, st_opt_params: { atrPeriod: 10, multiplier: 3.0 } } as unknown as StockAnalysisResult;
    const f = clientFlip(r);
    expect(f.flipType).toBe("BULLISH");
    expect(f.barsSince).toBeGreaterThanOrEqual(0);
    expect(f.barsSince).toBeLessThanOrEqual(2);
  });
});

const longBars = (dirUpLast: boolean) => {
  const base = Array.from({ length: 20 }, (_, i) => ({ high: 60 + i, low: 58 + i, close: 59 + i }));
  const tail = dirUpLast
    ? [{ high: 95, low: 90, close: 94 }, { high: 110, low: 94, close: 109 }]
    : [{ high: 60, low: 40, close: 41 }, { high: 50, low: 30, close: 31 }];
  return [...base, ...tail];
};

describe("buildAlertModel — client gap-fill + otherAlerts + audit", () => {
  it("passes the full reconciled list through as auditLog", () => {
    const m = buildAlertModel(wEvents, wTickers, [], { now: NOW });
    expect(m.auditLog.length).toBe(reconcileWorkerEvents(wEvents, wTickers).length);
  });

  it("gap-fills a client flip only for tickers the worker did not report", () => {
    const results = [
      { symbol: "NVDA", exchange: "US", chart_bars: longBars(false),
        st_opt_params: { atrPeriod: 10, multiplier: 3.0 } },
      { symbol: "SPY", exchange: "US", chart_bars: longBars(false),
        st_opt_params: { atrPeriod: 10, multiplier: 3.0 } },
    ] as unknown as StockAnalysisResult[];
    const m = buildAlertModel(wEvents, wTickers, results, { now: NOW });
    const syms = m.actOnThis.filter(r => r.source === "client").map(r => r.symbol);
    expect(syms).toContain("NVDA");
    expect(syms).not.toContain("SPY");
  });

  it("routes RSI divergence into otherAlerts", () => {
    const results = [
      { symbol: "TSM", exchange: "US",
        backtest: { rsi_divergence_type: "Bearish" } },
    ] as unknown as StockAnalysisResult[];
    const m = buildAlertModel([], {}, results, { now: NOW });
    expect(m.otherAlerts.some(a => a.alertType === "rsi_div" && a.symbol === "TSM")).toBe(true);
  });
});
