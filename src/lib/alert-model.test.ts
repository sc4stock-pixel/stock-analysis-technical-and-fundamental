import { describe, it, expect } from "vitest";
import { isActionable, type ActionableRow, daysAgo, clientFlip } from "./alert-model";
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
