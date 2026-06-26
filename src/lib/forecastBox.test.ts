import { describe, it, expect } from "vitest";
import { cell, kronosRow } from "@/lib/forecastBox";
import { KronosForecast } from "@/types";

describe("cell", () => {
  it("computes % vs baseline", () => {
    expect(cell(110, 100)).toEqual({ price: 110, pct: 10 });
  });
  it("returns null for missing/invalid price", () => {
    expect(cell(null, 100)).toBeNull();
    expect(cell(NaN, 100)).toBeNull();
  });
  it("returns null for non-positive or missing baseline", () => {
    expect(cell(110, 0)).toBeNull();
    expect(cell(110, null)).toBeNull();
  });
});

describe("kronosRow", () => {
  const k: KronosForecast = {
    last_price: 100, last_date: "2026-06-10",
    forward: { p50: [101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120] },
    historical: { anchor: 100, pred: [], actual: [], dir_hits: 13, mae: 1 },
  };
  it("maps 5/10/20d to p50[4]/[9]/[19] vs last_price", () => {
    const r = kronosRow(k)!;
    expect(r.cells[0]).toEqual({ price: 105, pct: 5 });
    expect(r.cells[1]).toEqual({ price: 110, pct: 10 });
    expect(r.cells[2]).toEqual({ price: 120, pct: 20 });
  });
  it("returns null when undefined", () => {
    expect(kronosRow(undefined)).toBeNull();
  });
  it("yields null cells when p50 too short", () => {
    const short = { ...k, forward: { p50: [101, 102] } };
    const r = kronosRow(short)!;
    expect(r.cells).toEqual([null, null, null]);
  });
});

// --- 5d conviction helpers ---
import { naiveRow, convictionFlags, skillBadge, CONVICTION_PCT } from "@/lib/forecastBox";

describe("naiveRow", () => {
  it("computes 5d drift % from 60d window", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * 1.001 ** i);
    const r = naiveRow(closes)!;
    expect(r.cells[0]!.pct).toBeCloseTo((Math.exp(0.001 * 5) - 1) * 100, 1);
  });
  it("returns null when series too short", () => {
    expect(naiveRow(Array(10).fill(100))).toBeNull();
  });
});

describe("convictionFlags", () => {
  it("HIGH when |5d%| > 5", () => {
    expect(convictionFlags({ pct: 6.3, price: 1 } as any, 2).high).toBe(true);
  });
  it("low when |5d%| <= 5", () => {
    expect(convictionFlags({ pct: 2.1, price: 1 } as any, 2).high).toBe(false);
  });
  it("warns when relMae large; flags coexist (do not override)", () => {
    const f = convictionFlags({ pct: -8.1, price: 1 } as any, 30);
    expect(f.high).toBe(true);
    expect(f.unreliable).toBe(true);
  });
});

describe("skillBadge", () => {
  it("provisional edge text for EDGE_HIGH_CONVICTION", () => {
    const b = skillBadge({ verdict: "EDGE_HIGH_CONVICTION",
      conviction_5d: { gt5: { rate: 0.81 } } } as any,
      { conviction_5d: { gt5: { rate: 0.52 } } } as any);
    expect(b.label).toMatch(/provisional/i);
    expect(b.detail).toMatch(/81%/);
    expect(b.detail).toMatch(/52%/);
  });
  it("muted no-edge label for NO_EDGE", () => {
    expect(skillBadge({ verdict: "NO_EDGE" } as any, null).tone).toBe("muted");
  });
});
