import { describe, it, expect } from "vitest";
import { isActionable, type ActionableRow } from "./alert-model";

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
