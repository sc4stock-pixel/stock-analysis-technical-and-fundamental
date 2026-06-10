import { describe, it, expect } from "vitest";
import { analyzeStock, evaluateCode33, findYearAgo, type AvQuarter } from "@/lib/analyze-stock";

describe("analyze-stock module", () => {
  it("exports a callable analyzeStock", () => { expect(typeof analyzeStock).toBe("function"); });
});

// Helper: build newest-first quarter list from [date, eps] pairs
const qs = (pairs: Array<[string, number]>): AvQuarter[] =>
  pairs.map(([d, e]) => ({ fiscalDateEnding: d, reportedEPS: String(e) }));

describe("findYearAgo (date-aware YoY lookup)", () => {
  it("finds the same calendar quarter one year back", () => {
    const quarters = qs([
      ["2026-03-31", 2.0], ["2025-12-31", 1.8], ["2025-09-30", 1.5],
      ["2025-06-30", 1.4], ["2025-03-31", 1.2],
    ]);
    expect(findYearAgo(quarters, 0)?.fiscalDateEnding).toBe("2025-03-31");
  });

  it("returns null instead of a mismatched period when the year-ago quarter is missing", () => {
    // 2025-03-31 dropped from the cache (e.g. invalid EPS filtered out).
    // Positional i+4 would have silently compared against 2024-12-31.
    const quarters = qs([
      ["2026-03-31", 2.0], ["2025-12-31", 1.8], ["2025-09-30", 1.5],
      ["2025-06-30", 1.4], ["2024-12-31", 1.1],
    ]);
    expect(findYearAgo(quarters, 0)).toBeNull();
  });

  it("tolerates fiscal-calendar drift within ±45 days", () => {
    const quarters = qs([["2026-04-02", 2.0], ["2025-03-28", 1.0]]);
    expect(findYearAgo(quarters, 0)?.fiscalDateEnding).toBe("2025-03-28");
  });

  it("works for HK semi-annual periods (H1/H2, ~182d apart)", () => {
    const quarters = qs([
      ["2025-12-31", 1.0], ["2025-06-30", 0.8],
      ["2024-12-31", 0.7], ["2024-06-30", 0.6],
    ]);
    // Year-ago of Dec H2 is the previous Dec H2, not the Jun H1
    expect(findYearAgo(quarters, 0)?.fiscalDateEnding).toBe("2024-12-31");
    expect(findYearAgo(quarters, 1)?.fiscalDateEnding).toBe("2024-06-30");
  });
});

describe("evaluateCode33", () => {
  // US quarterly, accelerating YoY (oldest → newest): the three most recent
  // periods vs their year-ago counterparts grow at increasing rates.
  const accelerating = qs([
    ["2026-03-31", 1.5], ["2025-12-31", 1.2], ["2025-09-30", 1.0],
    ["2025-06-30", 0.9], ["2025-03-31", 1.0], ["2024-12-31", 0.9],
    ["2024-09-30", 0.8],
  ]);

  it("detects acceleration on a clean quarterly series", () => {
    expect(evaluateCode33("Q", accelerating)).toBe(true);
  });

  it("returns null (not a wrong answer) when a recent period is missing", () => {
    // Drop 2025-12-31: recent window is no longer consecutive
    const gapped = accelerating.filter(q => q.fiscalDateEnding !== "2025-12-31");
    expect(evaluateCode33("Q", gapped)).toBeNull();
  });

  it("returns null when a year-ago period is missing", () => {
    // Drop 2025-03-31 (year-ago of newest) but keep 7 entries so the length
    // guard passes — the date-aware lookup itself must return null
    const gapped = [
      ...accelerating.filter(q => q.fiscalDateEnding !== "2025-03-31"),
      ...qs([["2024-06-30", 0.7]]),
    ];
    expect(evaluateCode33("Q", gapped)).toBeNull();
  });

  it("handles HK semi-annual series with ~182d spacing", () => {
    // H-frequency, accelerating YoY
    const hk = qs([
      ["2026-06-30", 1.2], ["2025-12-31", 1.0], ["2025-06-30", 0.8],
      ["2024-12-31", 0.8], ["2024-06-30", 0.7],
    ]);
    expect(evaluateCode33("H", hk)).toBe(true);
  });

  it("returns null on insufficient data", () => {
    expect(evaluateCode33("Q", accelerating.slice(0, 4))).toBeNull();
  });

  it("returns null when the year-ago EPS is ~0 (division guard)", () => {
    const zeroBase = qs([
      ["2026-03-31", 1.5], ["2025-12-31", 1.2], ["2025-09-30", 1.0],
      ["2025-06-30", 0.9], ["2025-03-31", 0.0005], ["2024-12-31", 0.9],
      ["2024-09-30", 0.8],
    ]);
    expect(evaluateCode33("Q", zeroBase)).toBeNull();
  });

  it("handles negative year-ago EPS (HK loss quarter) without sign errors", () => {
    // Newest YoY vs a -0.5 base uses |base| as denominator — must return a
    // boolean (no null, no NaN poisoning).
    const lossBase = qs([
      ["2026-03-31", 1.5], ["2025-12-31", 1.2], ["2025-09-30", 1.0],
      ["2025-06-30", 0.9], ["2025-03-31", -0.5], ["2024-12-31", 0.9],
      ["2024-09-30", 0.8],
    ]);
    expect(typeof evaluateCode33("Q", lossBase)).toBe("boolean");
  });
});
