import { describe, it, expect } from "vitest";
import {
  sessionDate,
  hkDateKey,
  pct,
  spreadOf,
  completePoints,
  mergeRegion,
  spreadDelta,
  signed,
  spreadSuffix,
  type BreadthPoint,
} from "./breadth-history";

const at = (iso: string) => new Date(iso);
const reading = (above: number, total: number, asOf = "2026-07-30T08:30:00.000Z") => ({
  above, total, asOf,
});

/** A complete series of `n` rows with fixed counts, dates ascending from 2026-07-01. */
function series(specs: Array<[hkAbove: number, usAbove: number]>): BreadthPoint[] {
  return specs.map(([hkAbove, usAbove], i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    hk: reading(hkAbove, 7),
    us: reading(usAbove, 9),
  }));
}

describe("hkDateKey", () => {
  it("returns an ISO-ordered HK-calendar date", () => {
    expect(hkDateKey(at("2026-07-30T08:30:00Z"))).toBe("2026-07-30");
  });

  it("rolls to the next HK date for a late-UTC instant", () => {
    // 23:00 UTC is 07:00 next day in HK (+8).
    expect(hkDateKey(at("2026-07-30T23:00:00Z"))).toBe("2026-07-31");
  });
});

describe("sessionDate", () => {
  it("maps the HK EOD run to today's HK date", () => {
    // 16:30 HKT = 08:30 UTC.
    expect(sessionDate("hk", at("2026-07-30T08:30:00Z"))).toBe("2026-07-30");
  });

  it("maps the US EOD run back to the prior HK date it reports on", () => {
    // 08:55 HKT on the 31st = 00:55 UTC; the US session it covers is the 30th.
    expect(sessionDate("us", at("2026-07-31T00:55:00Z"))).toBe("2026-07-30");
  });

  it("lands both EOD runs on the SAME session date so the spread is same-day", () => {
    const hk = sessionDate("hk", at("2026-07-30T08:30:00Z"));
    const us = sessionDate("us", at("2026-07-31T00:55:00Z"));
    expect(us).toBe(hk);
  });
});

describe("pct", () => {
  it("rounds to whole percentage points", () => {
    expect(pct(reading(2, 9))).toBe(22);
    expect(pct(reading(7, 7))).toBe(100);
  });

  it("is null for an absent or empty region rather than 0", () => {
    expect(pct(undefined)).toBeNull();
    expect(pct(reading(0, 0))).toBeNull();
  });
});

describe("spreadOf", () => {
  it("computes HK minus US in percentage points", () => {
    // Today's live reading: HK 7/7 = 100, US 2/9 = 22.
    expect(spreadOf({ date: "d", hk: reading(7, 7), us: reading(2, 9) })).toBe(78);
  });

  it("is negative when the US book is broader", () => {
    expect(spreadOf({ date: "d", hk: reading(1, 7), us: reading(9, 9) })).toBe(-86);
  });

  it("is null when only one region has reported", () => {
    expect(spreadOf({ date: "d", hk: reading(7, 7) })).toBeNull();
    expect(spreadOf({ date: "d", us: reading(2, 9) })).toBeNull();
    expect(spreadOf(undefined)).toBeNull();
  });
});

describe("mergeRegion", () => {
  it("creates a row when the session is new", () => {
    const out = mergeRegion([], "2026-07-30", "hk", reading(7, 7));
    expect(out).toHaveLength(1);
    expect(out[0].hk?.above).toBe(7);
    expect(out[0].us).toBeUndefined();
  });

  it("fills the counterpart half without clobbering the existing one", () => {
    const after1 = mergeRegion([], "2026-07-30", "hk", reading(7, 7));
    const after2 = mergeRegion(after1, "2026-07-30", "us", reading(2, 9));
    expect(after2).toHaveLength(1);
    expect(after2[0].hk?.above).toBe(7);
    expect(after2[0].us?.above).toBe(2);
    expect(spreadOf(after2[0])).toBe(78);
  });

  it("replaces its own region on a same-session re-run instead of duplicating", () => {
    const a = mergeRegion([], "2026-07-30", "hk", reading(4, 7));
    const b = mergeRegion(a, "2026-07-30", "hk", reading(7, 7));
    expect(b).toHaveLength(1);
    expect(b[0].hk?.above).toBe(7);
  });

  it("does not mutate the input array or its rows", () => {
    const before = mergeRegion([], "2026-07-30", "hk", reading(7, 7));
    const snapshot = JSON.stringify(before);
    mergeRegion(before, "2026-07-30", "us", reading(2, 9));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("keeps rows sorted by date regardless of write order", () => {
    let h = mergeRegion([], "2026-07-30", "hk", reading(7, 7));
    h = mergeRegion(h, "2026-07-28", "hk", reading(5, 7));
    h = mergeRegion(h, "2026-07-29", "hk", reading(6, 7));
    expect(h.map(p => p.date)).toEqual(["2026-07-28", "2026-07-29", "2026-07-30"]);
  });

  it("trims to the cap from the OLD end, keeping the most recent rows", () => {
    let h: BreadthPoint[] = [];
    for (let d = 1; d <= 6; d++) {
      h = mergeRegion(h, `2026-07-0${d}`, "hk", reading(d, 7), 3);
    }
    expect(h.map(p => p.date)).toEqual(["2026-07-04", "2026-07-05", "2026-07-06"]);
  });

  it("tolerates a malformed stored series without throwing", () => {
    const junk = [null, { nope: true }, { date: "2026-07-01", hk: reading(3, 7) }] as never;
    const out = mergeRegion(junk, "2026-07-02", "us", reading(2, 9));
    expect(out.map(p => p.date)).toEqual(["2026-07-01", "2026-07-02"]);
  });
});

describe("completePoints", () => {
  it("drops rows missing a half", () => {
    const h: BreadthPoint[] = [
      { date: "2026-07-01", hk: reading(7, 7), us: reading(2, 9) },
      { date: "2026-07-02", hk: reading(7, 7) },
    ];
    expect(completePoints(h).map(p => p.date)).toEqual(["2026-07-01"]);
  });

  it("is empty for null input", () => {
    expect(completePoints(null)).toEqual([]);
  });
});

describe("spreadDelta", () => {
  it("measures the change over the lookback window", () => {
    // HK constant at 7/7 (100); US falls 9/9 (100) -> 2/9 (22) over 5 rows.
    const h = series([[7, 9], [7, 8], [7, 6], [7, 4], [7, 3], [7, 2]]);
    // spread: 0, 11, 33, 56, 67, 78  → over 5 rows, +78.
    expect(spreadDelta(h, 5)).toBe(78);
  });

  it("is null when there is not enough complete history", () => {
    expect(spreadDelta(series([[7, 2], [7, 2]]), 5)).toBeNull();
  });

  it("skips incomplete rows rather than counting them as zero", () => {
    const h: BreadthPoint[] = [
      { date: "2026-07-01", hk: reading(7, 7), us: reading(7, 9) },
      { date: "2026-07-02", hk: reading(7, 7) },
      { date: "2026-07-03", hk: reading(7, 7), us: reading(2, 9) },
    ];
    // Only two complete rows: 100-78=22 and 100-22=78 → delta over 1 = 56.
    expect(spreadDelta(h, 1)).toBe(56);
  });
});

describe("signed", () => {
  it("prefixes positives and preserves negatives", () => {
    expect(signed(78)).toBe("+78");
    expect(signed(-12)).toBe("-12");
    expect(signed(0)).toBe("0");
  });

  it("rounds float artifacts out of the displayed number", () => {
    expect(signed(11.999999999)).toBe("+12");
  });
});

describe("spreadSuffix", () => {
  it("renders spread and the lookback delta", () => {
    const h = series([[7, 9], [7, 8], [7, 6], [7, 4], [7, 3], [7, 2]]);
    expect(spreadSuffix(h, 5)).toBe(" · spread +78 (5d +78)");
  });

  it("omits the delta when history is too short, but still shows the spread", () => {
    expect(spreadSuffix(series([[7, 2]]), 5)).toBe(" · spread +78");
  });

  it("degrades to an empty string when nothing is computable", () => {
    expect(spreadSuffix([], 5)).toBe("");
    expect(spreadSuffix(null, 5)).toBe("");
    expect(spreadSuffix([{ date: "2026-07-01", hk: reading(7, 7) }], 5)).toBe("");
  });

  it("contains no HTML, since the caller embeds it in an escaped line", () => {
    const out = spreadSuffix(series([[7, 2]]), 5);
    expect(out).not.toMatch(/[<>&]/);
  });
});
