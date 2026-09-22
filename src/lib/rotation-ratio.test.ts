import { describe, it, expect } from "vitest";
import {
  trailingMean,
  buildRatioSeries,
  currentLead,
  lastBarDate,
  joinGap,
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

describe("lastBarDate", () => {
  it("returns the latest date regardless of input order", () => {
    expect(lastBarDate(bars([["2026-07-03", 120], ["2026-07-01", 100]]))).toBe("2026-07-03");
  });

  it("ignores the bars buildRatioSeries would skip", () => {
    const mixed = bars([["2026-07-01", 100], ["2026-07-02", NaN], ["2026-07-03", 0]]);
    expect(lastBarDate(mixed)).toBe("2026-07-01");
  });

  it("is null when there is no usable bar", () => {
    expect(lastBarDate([])).toBeNull();
    expect(lastBarDate(null)).toBeNull();
    expect(lastBarDate(undefined)).toBeNull();
  });
});

describe("joinGap", () => {
  it("is null when the legs end together — the normal case", () => {
    expect(
      joinGap(
        bars([["2026-09-17", 4.218], ["2026-09-18", 4.32]]),
        bars([["2026-09-17", 738.1], ["2026-09-18", 739.4]]),
      ),
    ).toBeNull();
  });

  it("is null when a leg is merely shorter — no hole, just an earlier end", () => {
    // HK stops at 09-18 while QQQ reaches 09-21. Nothing was skipped on the way to either
    // last bar, so the join is as fresh as the data allows and must stay quiet.
    expect(
      joinGap(
        bars([["2026-09-17", 4.218], ["2026-09-18", 4.32]]),
        bars([["2026-09-17", 738.1], ["2026-09-18", 739.4], ["2026-09-21", 741.47]]),
      ),
    ).toBeNull();
  });

  it("stays quiet during HK hours, when the HK leg carries a live same-day bar", () => {
    // 3033.HK has a live 09-22 bar while QQQ's last is the 09-21 US close. The legs differ
    // by a day with nothing missing, so comparing the last dates directly would fire here
    // every HK morning. Taking the earlier of the two is what keeps this case silent.
    expect(
      joinGap(
        bars([["2026-09-18", 4.32], ["2026-09-21", 4.384], ["2026-09-22", 4.41]]),
        bars([["2026-09-18", 739.4], ["2026-09-21", 741.47]]),
      ),
    ).toBeNull();
  });

  it("reports a skipped session at the tail — the 2026-09-22 case", () => {
    // Measured live: 3033.HK had 09-17, 09-18 and a live 09-22, with NO 09-21 bar, while
    // QQQ had 09-21. Both series reach 09-21 yet the join's last point is 09-18, so
    // currentLead was reading a bar three sessions older than the data allowed.
    const hk = bars([["2026-09-17", 4.218], ["2026-09-18", 4.32], ["2026-09-22", 4.384]]);
    const us = bars([["2026-09-17", 738.1], ["2026-09-18", 739.4], ["2026-09-21", 741.47]]);
    expect(joinGap(hk, us)).toEqual({ lastJoined: "2026-09-18", through: "2026-09-21" });
    // The join is right to drop the unpaired dates; it is wrong to do so silently.
    expect(buildRatioSeries(hk, us, 2).map(p => p.date)).toEqual(["2026-09-17", "2026-09-18"]);
  });

  it("reports a skipped session on the denominator side too", () => {
    expect(
      joinGap(
        bars([["2026-09-17", 4.218], ["2026-09-18", 4.32], ["2026-09-21", 4.4]]),
        bars([["2026-09-17", 738.1], ["2026-09-18", 739.4], ["2026-09-22", 741.9]]),
      ),
    ).toEqual({ lastJoined: "2026-09-18", through: "2026-09-21" });
  });

  it("is null when either leg is missing or has no usable bar", () => {
    const one = bars([["2026-09-18", 4.32]]);
    expect(joinGap(null, one)).toBeNull();
    expect(joinGap(one, undefined)).toBeNull();
    expect(joinGap(bars([["2026-09-18", 0]]), one)).toBeNull();
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
