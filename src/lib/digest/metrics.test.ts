import { describe, it, expect } from "vitest";
import { pct20d, downsideToStopPct, distanceToFlipPct, eventCount, isDefaultParams, fmtPct, fmtKronos } from "./metrics";

describe("digest metrics", () => {
  it("pct20d: last/last_price - 1 as percent, 1dp", () => {
    expect(pct20d([100, 102, 110], 100)).toBeCloseTo(10, 5);
    expect(pct20d([], 100)).toBeNull();
    expect(pct20d([110], 0)).toBeNull();
    expect(pct20d(undefined, 100)).toBeNull();
  });
  it("downsideToStopPct: only for dir up", () => {
    expect(downsideToStopPct({ dir: "up", price: 421.07, stop: 395.9 } as any)).toBeCloseTo(5.98, 1);
    expect(downsideToStopPct({ dir: "down", price: 100, stop: 110 } as any)).toBeNull();
  });
  it("distanceToFlipPct: (price-flipPx)/price", () => {
    expect(distanceToFlipPct({ price: 737.76, flipPx: 737.55 } as any)).toBeCloseTo(0.028, 2);
    expect(distanceToFlipPct({ price: 100, flipPx: 0 } as any)).toBeNull();
  });
  it("eventCount tallies events for a ticker", () => {
    const ev = [{ ticker: "3033.HK" }, { ticker: "3033.HK" }, { ticker: "TSM" }] as any;
    expect(eventCount(ev, "3033.HK")).toBe(2);
    expect(eventCount(ev, "AAPL")).toBe(0);
  });
  it("isDefaultParams: ATR10 x3.0", () => {
    expect(isDefaultParams({ atrPeriod: 10, mult: 3.0 } as any)).toBe(true);
    expect(isDefaultParams({ atrPeriod: 10, mult: 2.5 } as any)).toBe(false);
  });
  it("fmtPct: signed 1dp or dash", () => {
    expect(fmtPct(6.0)).toBe("+6.0");
    expect(fmtPct(-1.3)).toBe("-1.3");
    expect(fmtPct(null)).toBe("—");
  });
  it("fmtKronos: flags noise beyond ±25", () => {
    expect(fmtKronos(-7.4)).toBe("-7.4");
    expect(fmtKronos(-50.7)).toBe("noise");
    expect(fmtKronos(null)).toBe("—");
  });
});
