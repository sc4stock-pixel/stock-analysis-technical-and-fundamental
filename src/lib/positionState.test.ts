import { describe, it, expect } from "vitest";
import { simulatePositionState } from "./positionState";

// n=8 bars; sma50Arr passed explicitly so the gate is easy to stage.
const SMA = new Array(8).fill(100);

function dirs(flipAt: number, n = 8): number[] {
  return Array.from({ length: n }, (_, i) => (i >= flipAt ? 1 : -1));
}
function sigs(buyAt: number, n = 8): string[] {
  const s = new Array(n).fill("HOLD");
  s[buyAt] = "BUY";
  return s;
}

describe("simulatePositionState — STRATEGY.md state machine", () => {
  it("flip above SMA50 mid-series → inLong", () => {
    const closes = [90, 90, 90, 110, 110, 110, 110, 110];
    expect(simulatePositionState(closes, dirs(3), sigs(3), SMA))
      .toEqual({ inLong: true, entryPending: false });
  });

  it("flip below SMA50, never reclaimed → out (waiting)", () => {
    const closes = [90, 90, 90, 95, 95, 95, 95, 95];
    expect(simulatePositionState(closes, dirs(3), sigs(3), SMA))
      .toEqual({ inLong: false, entryPending: false });
  });

  it("META case: entered, price later dips under SMA50 → still inLong", () => {
    const closes = [90, 90, 90, 110, 110, 95, 95, 95];
    expect(simulatePositionState(closes, dirs(3), sigs(3), SMA))
      .toEqual({ inLong: true, entryPending: false });
  });

  it("AAPL case: gate-passing flip on the LATEST bar → entryPending", () => {
    const closes = [90, 90, 90, 90, 90, 90, 90, 110];
    expect(simulatePositionState(closes, dirs(7), sigs(7), SMA))
      .toEqual({ inLong: false, entryPending: true });
  });

  it("re-entry: flip below SMA50, later crosses above while bullish → inLong", () => {
    const closes = [90, 90, 90, 95, 95, 110, 110, 110];
    expect(simulatePositionState(closes, dirs(3), sigs(3), SMA))
      .toEqual({ inLong: true, entryPending: false });
  });

  it("dir down → flat regardless of history", () => {
    const closes = [90, 90, 90, 110, 110, 110, 110, 110];
    const d = new Array(8).fill(-1);
    expect(simulatePositionState(closes, d, sigs(3), SMA))
      .toEqual({ inLong: false, entryPending: false });
  });
});
