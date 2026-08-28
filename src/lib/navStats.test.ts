import { describe, it, expect } from "vitest";
import { computeRegionStats } from "@/lib/navStats";

// ── Asymmetric 100/40 second line ────────────────────────────────────────────
describe("asym line", () => {
  const e = (date: string, ret: number, asym?: number | null) => ({
    date, region: "US" as const, ret, bench_ret: 0.001, bh_ret: 0.002,
    ...(asym === undefined ? {} : { asym_ret: asym }),
  });

  it("is absent (null), not flat, before the worker starts writing it", () => {
    const s = computeRegionStats([e("2026-08-01", 0.01), e("2026-08-02", 0.01)]);
    expect(s.navSeries.every(p => p.asymNav === null)).toBe(true);
    expect(s.asymTotalReturnPct).toBeNull();
    expect(s.asymObservations).toBe(0);
  });

  it("starts compounding from 1.0 on its first real entry, not from the series start", () => {
    const s = computeRegionStats([
      e("2026-08-01", 0.05), e("2026-08-02", 0.05),   // legacy only
      e("2026-08-03", 0.05, 0.10),                     // asym begins
    ]);
    expect(s.navSeries[0].asymNav).toBeNull();
    expect(s.navSeries[2].asymNav).toBeCloseTo(1.10, 10);
    expect(s.asymTotalReturnPct).toBeCloseTo(10, 10);
    expect(s.asymObservations).toBe(1);
  });

  it("a null asym_ret mid-series does not count as a 0% day", () => {
    const s = computeRegionStats([
      e("2026-08-01", 0.0, 0.10), e("2026-08-02", 0.0, null), e("2026-08-03", 0.0, 0.10),
    ]);
    expect(s.asymTotalReturnPct).toBeCloseTo(21, 6);   // 1.1 * 1.1
    expect(s.asymObservations).toBe(2);
  });

  it("legacy ret/alpha/beta are untouched by the new field", () => {
    const withAsym = computeRegionStats([e("2026-08-01", 0.05, 0.99), e("2026-08-02", 0.05, -0.5)]);
    const without  = computeRegionStats([e("2026-08-01", 0.05), e("2026-08-02", 0.05)]);
    expect(withAsym.totalReturnPct).toBeCloseTo(without.totalReturnPct, 12);
    expect(withAsym.maxDrawdownPct).toBeCloseTo(without.maxDrawdownPct, 12);
  });
});
