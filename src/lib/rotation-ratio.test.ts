import { describe, it, expect } from "vitest";
import {
  trailingMean,
  buildRatioSeries,
  currentLead,
  type CloseBar,
} from "./rotation-ratio";

const bars = (specs: Array<[date: string, close: number]>): CloseBar[] =>
  specs.map(([date, close]) => ({ date, close }));

describe("trailingMean", () => {
  it("null-pads until the window is full, then averages", () => {
    expect(trailingMean([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("uses a fixed window rather than an expanding one", () => {
    // Window of 2 over [1,2,3,10]: last value is (3+10)/2 = 6.5, not the running mean.
    expect(trailingMean([1, 2, 3, 10], 2)).toEqual([null, 1.5, 2.5, 6.5]);
  });

  it("returns an empty array for no input", () => {
    expect(trailingMean([], 3)).toEqual([]);
  });
});

describe("buildRatioSeries", () => {
  it("divides numerator by denominator on matching dates", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100], ["2026-07-02", 110]]),
      bars([["2026-07-01", 200], ["2026-07-02", 200]]),
      2,
    );
    expect(out.map(p => p.ratio)).toEqual([0.5, 0.55]);
  });

  it("inner-joins: a date missing from either side is dropped, not carried forward", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100], ["2026-07-02", 110], ["2026-07-03", 120]]),
      // US shut on the 2nd.
      bars([["2026-07-01", 200], ["2026-07-03", 200]]),
      2,
    );
    expect(out.map(p => p.date)).toEqual(["2026-07-01", "2026-07-03"]);
  });

  it("drops a bar whose close is zero, negative, or non-finite", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100], ["2026-07-02", 0], ["2026-07-03", NaN], ["2026-07-04", 120]]),
      bars([
        ["2026-07-01", 200], ["2026-07-02", 200], ["2026-07-03", 200], ["2026-07-04", 200],
      ]),
      2,
    );
    expect(out.map(p => p.date)).toEqual(["2026-07-01", "2026-07-04"]);
  });

  it("drops a date whose denominator close is zero rather than dividing by it", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100], ["2026-07-02", 110]]),
      bars([["2026-07-01", 200], ["2026-07-02", 0]]),
      2,
    );
    expect(out.map(p => p.date)).toEqual(["2026-07-01"]);
    expect(out.every(p => Number.isFinite(p.ratio))).toBe(true);
  });

  it("sorts by date so the trailing mean is not order-dependent", () => {
    const out = buildRatioSeries(
      bars([["2026-07-03", 120], ["2026-07-01", 100], ["2026-07-02", 110]]),
      bars([["2026-07-01", 200], ["2026-07-02", 200], ["2026-07-03", 200]]),
      2,
    );
    expect(out.map(p => p.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(out[2].ma).toBeCloseTo((0.55 + 0.6) / 2, 10);
  });

  it("attaches a null ma until the window fills", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100], ["2026-07-02", 110], ["2026-07-03", 120]]),
      bars([["2026-07-01", 200], ["2026-07-02", 200], ["2026-07-03", 200]]),
      3,
    );
    expect(out.map(p => p.ma === null)).toEqual([true, true, false]);
  });

  it("returns empty for null or non-array input", () => {
    expect(buildRatioSeries(null, bars([["2026-07-01", 1]]))).toEqual([]);
    expect(buildRatioSeries(bars([["2026-07-01", 1]]), undefined)).toEqual([]);
  });

  it("returns empty when the two calendars never overlap", () => {
    const out = buildRatioSeries(
      bars([["2026-07-01", 100]]),
      bars([["2026-08-01", 200]]),
      2,
    );
    expect(out).toEqual([]);
  });
});

describe("currentLead", () => {
  const mk = (ratio: number, ma: number | null) => [{ date: "2026-07-30", ratio, ma }];

  it("reads HK when the ratio is at or above its mean", () => {
    expect(currentLead(mk(0.55, 0.5))).toBe("hk");
    expect(currentLead(mk(0.5, 0.5))).toBe("hk");
  });

  it("reads US when the ratio is below its mean", () => {
    expect(currentLead(mk(0.45, 0.5))).toBe("us");
  });

  it("is null before the mean is established, rather than guessing", () => {
    expect(currentLead(mk(0.55, null))).toBeNull();
    expect(currentLead([])).toBeNull();
  });
});
