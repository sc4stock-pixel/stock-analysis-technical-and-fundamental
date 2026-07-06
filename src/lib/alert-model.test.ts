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
// ---- SMA50 strategy gate (entry_ready) invariants ------------------------
// The strategy is SuperTrend + Close>SMA50. "entered uptrend" / LONG must be
// reserved for gate-passing entries; a raw flip below SMA50 must render as
// awaiting-SMA50 on EVERY surface. (2026-07-04 audit — 1211.HK/META case.)
describe("buildAlertModel — SMA50 entry gate", () => {
  const crit = (c5: boolean) => [true, true, true, true, c5, true, false];
  const flipUp = (ticker: string): WorkerEvent[] => [
    { type: "flip_buy", ticker, region: "hk", session: "eod", barDate: "2026-06-17", confirmed: true },
  ];

  it("labels a flip below SMA50 as awaiting, not entered (entryReady false)", () => {
    const tickers = { "1211.HK": { dir: "up", criteria: crit(false) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("1211.HK"), tickers, [], { now: NOW });
    const r = m.actOnThis[0];
    expect(r.entryReady).toBe(false);
    expect(r.change).toBe("flipped up · awaiting SMA50");
  });

  it("labels a gate-passing flip as entered uptrend (entryReady true)", () => {
    const tickers = { "AAPL": { dir: "up", criteria: crit(true) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("AAPL"), tickers, [], { now: NOW });
    const r = m.actOnThis[0];
    expect(r.entryReady).toBe(true);
    expect(r.change).toBe("entered uptrend");
  });

  it("prefers the worker's explicit entryReady flag over criteria", () => {
    const tickers = { "AAPL": { dir: "up", entryReady: false, criteria: crit(true) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("AAPL"), tickers, [], { now: NOW });
    expect(m.actOnThis[0].entryReady).toBe(false);
  });

  it("renders a standalone entry_buy (SMA50 reclaim) as re-entry", () => {
    const ev: WorkerEvent[] = [
      { type: "entry_buy", ticker: "META", region: "us", session: "eod", barDate: "2026-06-17", confirmed: true },
    ];
    const tickers = { "META": { dir: "up", entryReady: true, criteria: crit(true) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(ev, tickers, [], { now: NOW });
    expect(m.actOnThis[0].change).toBe("re-entered above SMA50");
    expect(m.actOnThis[0].entryReady).toBe(true);
  });

  it("META case: inLong survives a dip below SMA50 — stays 'entered uptrend'", () => {
    // Entered via the gate on the flip; price has since dipped under SMA50
    // (c5 false, entryReady false) — but the strategy holds until an ST exit.
    const tickers = { "META": { dir: "up", inLong: true, entryPending: false, entryReady: false, criteria: crit(false) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("META"), tickers, [], { now: NOW });
    expect(m.actOnThis[0].posState).toBe("long");
    expect(m.actOnThis[0].change).toBe("entered uptrend");
  });

  it("AAPL case: signal on latest bar renders as pending fill, not LONG", () => {
    const tickers = { "AAPL": { dir: "up", inLong: false, entryPending: true, entryReady: true, criteria: crit(true) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("AAPL"), tickers, [], { now: NOW });
    expect(m.actOnThis[0].posState).toBe("pending");
    expect(m.actOnThis[0].change).toBe("entry signal · fills next open");
  });

  it("falls back to the entryReady gate when inLong is absent (pre-upgrade KV)", () => {
    const tickers = { "1211.HK": { dir: "up", criteria: crit(false) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(flipUp("1211.HK"), tickers, [], { now: NOW });
    expect(m.actOnThis[0].posState).toBe("waiting");
  });

  it("does not count a same-bar flip_buy+entry_buy pair as extra whipsaw flips", () => {
    const ev: WorkerEvent[] = [
      { type: "flip_buy",  ticker: "AAPL", region: "us", session: "eod", barDate: "2026-06-17", confirmed: true },
      { type: "entry_buy", ticker: "AAPL", region: "us", session: "eod", barDate: "2026-06-17", confirmed: true },
      { type: "flip_exit", ticker: "AAPL", region: "us", session: "eod", barDate: "2026-06-16", confirmed: true },
    ];
    const tickers = { "AAPL": { dir: "up", entryReady: true, criteria: crit(true) } } as unknown as Record<string, WorkerTickerState>;
    const m = buildAlertModel(ev, tickers, [], { now: NOW });
    expect(m.actOnThis[0].whipsaw).toBe(false); // 2 raw flips, not 3
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

describe("clientFlip — precomputed _flip fallback", () => {
  it("uses result._flip when chart_bars is absent (cron payloads strip bars)", () => {
    const r = { symbol: "AAPL", _flip: { flipType: "BEARISH", barsSince: 1 } } as unknown as StockAnalysisResult;
    const f = clientFlip(r);
    expect(f.flipType).toBe("BEARISH");
    expect(f.barsSince).toBe(1);
  });
  it("still computes from chart_bars when no _flip is present", () => {
    const bars = [
      ...Array.from({ length: 20 }, (_, i) => ({ high: 100 - i, low: 98 - i, close: 99 - i })),
      { high: 95, low: 90, close: 94 }, { high: 110, low: 94, close: 109 }, { high: 120, low: 108, close: 119 },
    ];
    const r = { chart_bars: bars, st_opt_params: { atrPeriod: 10, multiplier: 3.0 } } as unknown as StockAnalysisResult;
    expect(clientFlip(r).flipType).toBe("BULLISH");
  });
});

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
