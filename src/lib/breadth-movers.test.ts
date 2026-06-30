import { describe, it, expect } from "vitest";
import { aboveSma50Map, computeBreadthMovers, isAboveSma50, type BreadthSnapshot } from "./breadth-movers";

const row = (symbol: string, above: boolean) => ({
  symbol,
  sepa_metadata: { trend_template_criteria: { c5_price_above_sma50: above } },
});

const snap = (above: Record<string, boolean>): BreadthSnapshot => ({ asOf: "2026-06-29T00:00:00Z", above });

describe("isAboveSma50 / aboveSma50Map", () => {
  it("reads the c5 criterion, defaulting missing/false to false", () => {
    expect(isAboveSma50(row("TSM", true))).toBe(true);
    expect(isAboveSma50(row("AAPL", false))).toBe(false);
    expect(isAboveSma50({ symbol: "X" })).toBe(false);
    expect(isAboveSma50({ symbol: "Y", sepa_metadata: null })).toBe(false);
  });

  it("builds a per-symbol map", () => {
    expect(aboveSma50Map([row("TSM", true), row("AAPL", false)])).toEqual({ TSM: true, AAPL: false });
  });
});

describe("computeBreadthMovers", () => {
  it("returns no movers on first run (no prior snapshot)", () => {
    expect(computeBreadthMovers({ TSM: true, AAPL: false }, null)).toEqual({ up: [], down: [] });
    expect(computeBreadthMovers({ TSM: true }, undefined)).toEqual({ up: [], down: [] });
  });

  it("detects up-crosses (below -> above)", () => {
    const movers = computeBreadthMovers({ TSM: true, AAPL: false }, snap({ TSM: false, AAPL: false }));
    expect(movers).toEqual({ up: ["TSM"], down: [] });
  });

  it("detects down-crosses (above -> below)", () => {
    const movers = computeBreadthMovers({ NVDA: false }, snap({ NVDA: true }));
    expect(movers).toEqual({ up: [], down: ["NVDA"] });
  });

  it("detects both directions and sorts symbols", () => {
    const current = { TSM: true, MSFT: true, NVDA: false, AMD: false };
    const prev = snap({ TSM: false, MSFT: false, NVDA: true, AMD: true });
    expect(computeBreadthMovers(current, prev)).toEqual({ up: ["MSFT", "TSM"], down: ["AMD", "NVDA"] });
  });

  it("ignores stocks with no change", () => {
    expect(computeBreadthMovers({ TSM: true, AAPL: false }, snap({ TSM: true, AAPL: false }))).toEqual({ up: [], down: [] });
  });

  it("ignores a newly-added stock absent from the prior snapshot", () => {
    // GOOGL is new this run — not a 'mover' even though it is above SMA50.
    const movers = computeBreadthMovers({ TSM: true, GOOGL: true }, snap({ TSM: false }));
    expect(movers).toEqual({ up: ["TSM"], down: [] });
  });

  it("ignores a dropped stock present only in the prior snapshot", () => {
    const movers = computeBreadthMovers({ TSM: true }, snap({ TSM: false, DELISTED: true }));
    expect(movers).toEqual({ up: ["TSM"], down: [] });
  });

  it("tolerates a malformed prior snapshot with no above map", () => {
    expect(computeBreadthMovers({ TSM: true }, { asOf: "x" } as BreadthSnapshot)).toEqual({ up: [], down: [] });
  });
});
